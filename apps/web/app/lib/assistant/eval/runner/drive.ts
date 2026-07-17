// The live runner: POST a question to /assistant/chat and reduce the AI-SDK UIMessage stream to a
// RunOutput. Two pure parts (parseSse, interpret) do all the reduction and are cassette-tested with no
// network; `drive` is the thin impure fetch around them.
//
// The wire is the Vercel AI SDK v6 UIMessage stream (see fixtures/sse-stream.fixture.txt): SSE lines
// `data: <json>`, each a UIMessageChunk. The resolved report rides `tool-output-available` for
// emit_report as `output: { ok: true, report }`; run_sql's output is a plain string and is ignored.

import {
  INSUFFICIENT_DATA_MESSAGE,
  REPORT_FAILED_MESSAGE,
} from '../../../assistant-contract/stream';
import type { ResolvedReport } from '../../report-schema';
import type { RunOutput } from '../run-output';

/** Chunk `type`s the client wire may carry after the phase filter (stream-phase.ts). A cassette type
 *  outside this set means the wire shape drifted — the shape-contract test guards it. */
export const CLIENT_WIRE_CHUNK_TYPES: ReadonlySet<string> = new Set([
  'start',
  'start-step',
  'text-start',
  'text-delta',
  'text-end',
  'data-phase',
  'tool-input-start',
  'tool-input-available',
  'tool-input-error',
  'tool-output-available',
  'tool-output-error',
  'data-report-ready',
  'finish-step',
  'finish',
  'error',
]);

// A graceful decline: the two canonical no-answer sentences, plus the model's own phrasings observed in
// the eval („Не успях да съставя справка…"). Absence of a report WITHOUT one of these is a silent
// failure, not an honest decline — so it must NOT read as declined.
const DECLINE_RE = /не успях|не разполагам|не мога|нямам достатъчно/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Split an AI-SDK SSE payload into its JSON chunk objects (skips `[DONE]` and malformed lines). */
export function parseSse(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // A malformed line is dropped, not thrown — a partial stream must still reduce.
    }
  }
  return out;
}

/** Reduce a chunk sequence + HTTP status to the normalized RunOutput. Pure; the unit-of-test. */
export function interpret(chunks: unknown[], status: number): RunOutput {
  const types: string[] = [];
  let report: ResolvedReport | null = null;
  let text = '';
  let sawErrorChunk = false;

  for (const c of chunks) {
    if (!isRecord(c) || typeof c.type !== 'string') continue;
    types.push(c.type);
    if (c.type === 'text-delta' && typeof c.delta === 'string') {
      text += c.delta;
    } else if (c.type === 'error') {
      sawErrorChunk = true;
    } else if (c.type === 'tool-output-available') {
      const output = c.output;
      // Only emit_report carries an object output with { ok, report }; run_sql's is a plain string.
      // Trust boundary: the report is server-authored + validated server-side, but a buggy/hostile
      // endpoint could still send a malformed one — so confirm the one shape the scorers iterate (`blocks`
      // is an array) before accepting it. A report that fails this stays null → scored as a no-report
      // failure, never a crash mid-run.
      if (
        isRecord(output) &&
        output.ok === true &&
        isRecord(output.report) &&
        Array.isArray(output.report.blocks)
      ) {
        report = output.report as unknown as ResolvedReport;
      }
    }
  }

  const error = status !== 200 ? { status } : sawErrorChunk ? { status: 500 } : undefined;
  const declined =
    report === null &&
    !error &&
    (text.includes(INSUFFICIENT_DATA_MESSAGE) ||
      text.includes(REPORT_FAILED_MESSAGE) ||
      DECLINE_RE.test(text));

  return error ? { report, declined, chunks: types, error } : { report, declined, chunks: types };
}

export interface DriveOptions {
  /** Full URL of the assistant chat endpoint, e.g. http://localhost:5173/assistant/chat. */
  url: string;
  /** Extra headers merged over the defaults (content-type + the first-party CSRF spoof). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Build the request body the route expects: a single first-party user UIMessage. */
export function chatRequestBody(prompt: string): string {
  return JSON.stringify({
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: prompt }] }],
  });
}

/** POST one question and reduce the stream. Live-only (needs a turnstile-off target); the parsing it
 *  delegates to is what the cassette tests cover. */
export async function drive(prompt: string, opts: DriveOptions): Promise<RunOutput> {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Satisfy firstPartyRejection (request-guard.ts) from a headless client. Turnstile must be off
      // on the target (no browser token is mintable) — a documented coverage constraint.
      'sec-fetch-site': 'same-origin',
      ...opts.headers,
    },
    body: chatRequestBody(prompt),
    signal: opts.signal,
  });
  return interpret(parseSse(await res.text()), res.status);
}
