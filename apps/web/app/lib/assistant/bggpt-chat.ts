// Minimal OpenAI-compatible chat client for the JSON-action loop (agent.ts). Deliberately does NOT go
// through the Vercel AI SDK's tool-calling path: the BgGPT/mamay vLLM upstream is served WITHOUT
// `--enable-auto-tool-choice --tool-call-parser`, so any `tools`/`tool_choice` in the request is
// rejected with HTTP 400. This client sends neither — it drives a prompted single-JSON-action protocol
// instead (see json-action.ts + system-prompt.ts). It also always disables Gemma-4's chain-of-thought
// via `chat_template_kwargs.enable_thinking=false`, so `content` is a clean reply (no `thought…` prefix)
// and the prompt weight drops ~8× (537→66 tok on a small prompt, measured through the gateway).
//
// Traffic still transits the Cloudflare AI Gateway: `baseURL` is `AI_GATEWAY_BASE_URL`
// (…/custom-bggpt/v1), preserving the §9.5 logging/cost/rate-limit guarantee. The gateway forwards the
// non-standard `chat_template_kwargs` field to vLLM unchanged (verified end-to-end).

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BggptChatConfig {
  /** AI Gateway OpenAI-compatible base, e.g. …/sigma-assistant/custom-bggpt/v1. */
  baseURL: string;
  /** Provider key (ASSISTANT_API_KEY) — forwarded upstream as `Authorization: Bearer`. */
  apiKey: string;
  /** Model id (ASSISTANT_MODEL), e.g. `bggpt-gemma4-31b-it-bg-gptq-w4a16`. */
  model: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface BggptChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: string | null } }>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One non-streaming chat completion. Returns the assistant `content` string (never null). Retries
 * transient failures (network / 429 / 5xx) with linear backoff so a single provider hiccup doesn't
 * surface as an error to the user; 4xx (a real request problem) throws immediately. Aborts propagate.
 */
export async function bggptChat(
  cfg: BggptChatConfig,
  messages: ChatTurnMessage[],
  opts: BggptChatOptions = {},
): Promise<string> {
  const base = cfg.baseURL.replace(/\/$/, '');
  const doFetch = cfg.fetchImpl ?? fetch;
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 4096,
    // Gemma-4 is a reasoning model; with thinking on it prepends a CoT that bleeds into `content` and
    // breaks the single-JSON-object contract. The flag is ignored by upstreams that don't support it.
    chat_template_kwargs: { enable_thinking: false },
  });

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: opts.signal,
      });
    } catch (e) {
      // A client-abort must propagate immediately (the turn is cancelled); other network errors retry.
      if ((e as Error)?.name === 'AbortError') throw e;
      lastErr = (e as Error)?.message ?? 'network error';
      if (attempt < 2) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(`BgGPT request failed after retries: ${lastErr}`);
    }

    if (res.ok) {
      const data = (await res.json()) as ChatCompletionBody;
      return data.choices?.[0]?.message?.content ?? '';
    }
    // Don't retry 4xx (a real request problem — surfaces the upstream message, truncated, for the log).
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`BgGPT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    lastErr = `BgGPT ${res.status}`;
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  throw new Error(`BgGPT request failed after retries: ${lastErr}`);
}
