// Assistant orchestrator (spec §2). Drives a bounded PROMPTED-JSON action loop against the chat model,
// routed through the Cloudflare AI Gateway (§9.5), and streams the result as the UI-message Response the
// chat route hands back to the dock.
//
// Why not native tool-calling: the BgGPT/mamay vLLM upstream is served WITHOUT
// `--enable-auto-tool-choice --tool-call-parser`, so any `tools`/`tool_choice` in the request → HTTP 400.
// Instead the model emits ONE JSON action object per step ({"action":"run_sql",…} / {"action":"emit_report",…}),
// which we parse (json-action.ts) and dispatch to the SAME SDK-agnostic tool registry (tools.ts). Every
// downstream seam is reused unchanged: the SQL guards, `runTool`, `finalizeReport`/`bindReport`/persistence,
// the `report-fallback`, the stream-phase filter, and the entire dock client. We just hand-write the same
// `data-phase` + `tool-emit_report` chunk shapes the SDK path used to produce.

import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { buildSystemPrompt } from './system-prompt';
import { createPhaseFilter } from './stream-phase';
import { EMIT_REPORT_TOOL, PHASE_PART, type AssistantPhase } from '../assistant-contract/stream';
import { finalizeReport, runTool, type ToolContext } from './tools';
import { buildFallbackReport } from './report-fallback';
import { bggptChat, type BggptChatConfig, type ChatTurnMessage } from './bggpt-chat';
import { parseAction } from './json-action';
import type { TemporalContext } from './temporal';

export interface AgentEnv {
  /** Provider API key (BgGPT/mamay key today). SECRET — set via GitHub Environment → `wrangler secret put`. */
  ASSISTANT_API_KEY: string;
  /**
   * REQUIRED — OpenAI-compatible endpoint of the Cloudflare AI Gateway upstream, e.g.
   * `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/custom-bggpt/v1`. Empty ⇒ fail closed
   * (we never call the provider directly). This is the single lever that guarantees LLM traffic transits
   * the gateway for logging / cost / rate-limit visibility (§9.5).
   */
  AI_GATEWAY_BASE_URL?: string;
  /** Model id (e.g. `bggpt-gemma4-31b-it-bg-gptq-w4a16`). Swappable via config alone. */
  ASSISTANT_MODEL?: string;
  MAX_STEPS?: string;
}

const DEFAULT_MODEL = 'bggpt-gemma4-31b-it-bg-gptq-w4a16';
const DEFAULT_MAX_STEPS = 6;
// Hard ceiling on the loop length regardless of env, bounding worst-case model calls per turn. `MAX_STEPS`
// is operator-supplied config — a misconfigured deploy could otherwise stall the loop (0/negative) or
// uncap it (a huge value).
const MAX_STEPS_CAP = 20;
// Bounded protocol-correction nudges (parse failures + rejected emit_report shapes) before we give up on
// the model and fall back — mirrors kolkostruva's 2-correction budget. Prevents burning every step on a
// model that keeps emitting malformed JSON.
const MAX_CORRECTIONS = 2;

/**
 * Resolve the loop step budget from the (untrusted) env string: fall back to the default on a missing /
 * non-numeric / < 1 value, and clamp to [1, MAX_STEPS_CAP].
 */
export function resolveMaxSteps(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_STEPS;
  return Math.min(Math.floor(n), MAX_STEPS_CAP);
}

// Shown when the loop ends with no report and no bindable data (an empty/unparseable model turn).
// Guarantees the dock never renders a blank turn. Mirrors the client NO_ANSWER_FALLBACK wording.
const EMPTY_COMPLETION_MESSAGE =
  'Не успях да съставя справка за този въпрос. Опитайте отново или го формулирайте по-конкретно — ' +
  'напр. посочете възложител, период или сектор.';

// Graceful degradation (§7): a provider outage / 4xx / timeout surfaces as a readable Bulgarian line
// instead of a broken stream.
const PROVIDER_ERROR_MESSAGE = 'Асистентът временно не е достъпен. Опитай отново след малко.';

// System-prompt version string for StoredReport provenance — a FNV-1a fingerprint of the CANONICAL prompt
// (empty input), so any semantic edit to system-prompt.ts / describe-schema.ts re-fingerprints on deploy.
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const PROMPT_VERSION = `sp_${fnv1a(buildSystemPrompt({}))}`;

/** Generate a URL-safe random report ID (e.g. `r_a3f8c2d1e9b4`). */
function randomReportId(): string {
  return `r_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

// Whitelist of recognised freshness sources; rows with any other value are dropped (no internal leaks).
const KNOWN_FRESHNESS_SOURCES = new Set(['admin', 'ocds', 'eop'] as const);

async function fetchFreshness(db: D1Database): Promise<{ source: string; asOf: string }[]> {
  try {
    const { results } = await db
      .prepare('SELECT source, as_of FROM data_freshness WHERE as_of IS NOT NULL')
      .all<{ source: string; as_of: string }>();
    return (results ?? [])
      .filter((r) => KNOWN_FRESHNESS_SOURCES.has(r.source as 'admin' | 'ocds' | 'eop'))
      .map((r) => ({ source: r.source, asOf: r.as_of }));
  } catch {
    return [];
  }
}

/** Persist a resolved report to R2 and return its ID. Returns null on any write failure. */
async function persistReport(
  ctx: ToolContext,
  report: ReturnType<typeof finalizeReport> & { ok: true },
  modelId: string,
): Promise<string | null> {
  if (!ctx.reports) return null;
  const id = randomReportId();
  const stored = {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    report: report.report,
    provenance: {
      question: ctx.userQuestion ?? '',
      sources: ctx.sources,
      snapshot: ctx.results,
      freshness: await fetchFreshness(ctx.db),
      model: modelId,
      promptVersion: PROMPT_VERSION,
    },
  };
  try {
    await ctx.reports.put(`report/${id}.json`, JSON.stringify(stored), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        title: report.report.title,
        question: ctx.userQuestion ?? '',
        createdAt: stored.createdAt,
      },
    });
    return id;
  } catch (err) {
    console.error('[assistant] failed to persist report to R2', err);
    return null;
  }
}

export interface RunAssistantOptions {
  env: AgentEnv;
  ctx: ToolContext;
  messages: UIMessage[];
  schemaContext?: string[];
  freshness?: string;
  // Deterministic, server-resolved temporal context for this turn (temporal.ts).
  temporal?: TemporalContext;
  abortSignal?: AbortSignal; // wire `request.signal` so a disconnect cancels the model loop
}

/** Minimal writer surface used by the loop — matches the `createUIMessageStream` execute writer. */
interface StreamWriter {
  write(chunk: unknown): void;
}

/** Flatten UI messages to plain chat turns (text parts only). Non-text parts are dropped. */
function toChatMessages(msgs: UIMessage[]): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = [];
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
    const text = (m.parts ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && 'text' in p)
      .map((p) => p.text)
      .join('');
    if (text.trim().length > 0) out.push({ role: m.role, content: text });
  }
  return out;
}

/** Emit the coarse turn phase as a transient data part (allowlisted by the phase filter). */
function writePhase(writer: StreamWriter, phase: AssistantPhase): void {
  writer.write({ type: PHASE_PART, data: { phase }, transient: true });
}

/** Write a plain text message to the transcript (start → delta → end). */
function writeText(writer: StreamWriter, text: string): void {
  const id = `t_${randomReportId()}`;
  writer.write({ type: 'text-start', id });
  writer.write({ type: 'text-delta', id, delta: text });
  writer.write({ type: 'text-end', id });
}

/**
 * Write the terminal `tool-emit_report` part sequence the dock projects into a report chip. Identical
 * shape to what the SDK tool path produced, so the client renders it unchanged.
 */
function writeReport(
  writer: StreamWriter,
  report: (ReturnType<typeof finalizeReport> & { ok: true })['report'],
  storedId: string | null,
): void {
  const toolCallId = `emit_${randomReportId()}`;
  writer.write({ type: 'tool-input-start', toolCallId, toolName: EMIT_REPORT_TOOL });
  writer.write({ type: 'tool-input-available', toolCallId, toolName: EMIT_REPORT_TOOL, input: {} });
  writer.write({
    type: 'tool-output-available',
    toolCallId,
    output: { ok: true as const, report, ...(storedId ? { storedId } : {}) },
  });
}

/**
 * Run one assistant turn: a bounded prompted-JSON action loop (chat model via the AI Gateway) + the
 * reused tool/report machinery, returned as the streamed UI-message Response the chat route hands to the
 * dock. Fail closed: refuse to reach the provider unless the gateway base URL is configured.
 */
export async function runAssistant(opts: RunAssistantOptions): Promise<Response> {
  const baseURL = opts.env.AI_GATEWAY_BASE_URL?.trim();
  if (!baseURL) {
    throw new Error(
      'AI_GATEWAY_BASE_URL is not set — refusing to reach the model provider outside the Cloudflare AI Gateway',
    );
  }
  const maxSteps = resolveMaxSteps(opts.env.MAX_STEPS);
  const modelId = opts.env.ASSISTANT_MODEL || DEFAULT_MODEL;
  const cfg: BggptChatConfig = {
    baseURL,
    apiKey: opts.env.ASSISTANT_API_KEY,
    model: modelId,
    fetchImpl: opts.ctx.fetchImpl as typeof fetch | undefined,
  };

  const system = buildSystemPrompt({
    schemaContext: opts.schemaContext,
    freshness: opts.freshness,
    temporal: opts.temporal,
  });
  const messages: ChatTurnMessage[] = [
    { role: 'system', content: system },
    ...toChatMessages(opts.messages),
  ];

  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      const w = writer as unknown as StreamWriter;
      w.write({ type: 'start' });
      w.write({ type: 'start-step' });
      writePhase(w, 'thinking');

      let emitted = false;
      let providerErrored = false;
      let corrections = 0;

      try {
        for (let step = 0; step < maxSteps && !emitted; step++) {
          let content: string;
          try {
            content = await bggptChat(cfg, messages, {
              temperature: 0.2,
              maxTokens: 8192,
              signal: opts.abortSignal,
            });
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') return; // client gone — stop quietly
            console.error('[assistant] model call failed', err);
            providerErrored = true;
            break;
          }
          messages.push({ role: 'assistant', content });

          const { action } = parseAction(content);
          if (!action) {
            // Unparseable — nudge back to the protocol, bounded; else fall through to the fallback.
            if (corrections < MAX_CORRECTIONS) {
              corrections++;
              messages.push({
                role: 'user',
                content:
                  'Отговори със САМО ЕДИН валиден JSON обект според протокола (напр. ' +
                  '{"action":"run_sql","sql":"…"} или {"action":"emit_report","title":"…","question":"…","blocks":[…]}), ' +
                  'без друг текст и без код-блокове.',
              });
              continue;
            }
            break;
          }

          if (action.action === EMIT_REPORT_TOOL) {
            writePhase(w, 'composing');
            const r = finalizeReport(action.args, opts.ctx);
            if (!r.ok) {
              // Shape errors → hand them back so the model fixes the blocks (bounded), never leak to client.
              if (corrections < MAX_CORRECTIONS) {
                corrections++;
                messages.push({
                  role: 'user',
                  content:
                    'emit_report беше отхвърлен (невалидни блокове). Поправи и върни отново валиден ' +
                    'JSON {"action":"emit_report", …}, като блоковете реферират съществуващи хендъли (R1…). ' +
                    `Проблеми: ${JSON.stringify(r.errors).slice(0, 400)}`,
                });
                continue;
              }
              break;
            }
            opts.ctx.reportEmitted = true;
            const storedId = await persistReport(opts.ctx, r, modelId);
            writeReport(w, r.report, storedId);
            emitted = true;
            break;
          }

          // Any other action → a mid-turn tool. Run it and feed the result back as a user message.
          writePhase(w, 'querying');
          const result = await runTool(action.action, action.args, opts.ctx);
          messages.push({
            role: 'user',
            content:
              `РЕЗУЛТАТ от ${action.action}: ${result}\n` +
              'Продължи със следващото JSON действие. Когато вече имаш нужните данни, върни ' +
              '{"action":"emit_report", …} с блокове, рефериращи хендълите.',
          });
        }

        // ── Fallbacks — never end a turn on a blank transcript. ────────────────────────────────────
        if (!emitted && !providerErrored) {
          if (opts.ctx.results.length > 0) {
            // Had bindable data but no valid report (budget/shape) → synthesize one server-side, bound
            // through the same bindReport (server-owned values, never model-written).
            const built = buildFallbackReport(opts.ctx.results, opts.ctx.userQuestion ?? '');
            if (built.ok) {
              const storedId = await persistReport(opts.ctx, built, modelId);
              writeReport(w, built.report, storedId);
              opts.ctx.reportEmitted = true;
            } else {
              console.warn('[assistant] fallback finalizer produced no valid report', {
                errors: built.errors,
                resultCount: opts.ctx.results.length,
              });
              writeText(w, EMPTY_COMPLETION_MESSAGE);
            }
          } else {
            writeText(w, EMPTY_COMPLETION_MESSAGE);
          }
        }
        if (providerErrored) writeText(w, PROVIDER_ERROR_MESSAGE);
      } catch (err) {
        // Never let the loop throw out of execute (would abort the body); surface a readable line.
        console.error('[assistant] turn failed', err);
        if (!emitted) writeText(w, PROVIDER_ERROR_MESSAGE);
      } finally {
        w.write({ type: 'finish-step' });
        w.write({ type: 'finish' });
      }
    },
    onError: (error) => {
      console.error('[assistant] stream error', error);
      return PROVIDER_ERROR_MESSAGE;
    },
  });

  // Only phases + prose + the resolved report reach the dock — internals never leave the Worker.
  return createUIMessageStreamResponse({ stream: stream.pipeThrough(createPhaseFilter()) });
}
