// BgGPT's Gemma 3 model outputs tool calls as plain-text JSON instead of using the
// OpenAI function-calling API. The model often also prepends prose explanation before
// the JSON, e.g.:
//   "За да отговоря... ще използвам run_sql.\n[{"name":"run_sql","parameters":{...}}]"
//
// This middleware buffers all text until the stream finishes, then checks whether the
// text ENDS with a Gemma-format tool call array. If yes, the prose is suppressed and
// proper tool-input-start/delta/end + tool-call events are emitted so the SDK tool
// loop actually executes the call.
//
// Pure prose responses (no trailing JSON) are emitted normally.
// Only the FIRST call in a multi-call batch is emitted per step to preserve R-handle
// sequencing: run_sql must complete before emit_report can reference its results.

import { wrapLanguageModel } from 'ai';
import type { LanguageModel, LanguageModelMiddleware } from 'ai';

interface GemmaToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

function parseGemmaToolCallsFromText(text: string): GemmaToolCall[] | null {
  const trimmed = text.trim();
  if (!trimmed.endsWith(']')) return null;

  // Find the last '[' — the Gemma JSON array always appears at the tail of the output.
  const lastBracket = trimmed.lastIndexOf('[');
  if (lastBracket === -1) return null;

  const candidate = trimmed.slice(lastBracket);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const isCall = (v: unknown): v is GemmaToolCall =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { name?: unknown }).name === 'string' &&
      typeof (v as { parameters?: unknown }).parameters === 'object';
    return parsed.every(isCall) ? parsed : null;
  } catch {
    return null;
  }
}

const gemmaToolCallMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapStream: async ({ doStream }) => {
    const result = await doStream();

    let accText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textParts: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = new ReadableStream<any>({
      async start(controller) {
        const reader = result.stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (
              value.type === 'text-start' ||
              value.type === 'text-end'
            ) {
              // Buffer text boundary markers — emit at finish once we know the outcome.
              textParts.push(value);
            } else if (value.type === 'text-delta') {
              accText += (value as { delta: string }).delta;
              textParts.push(value);
            } else if (value.type === 'finish') {
              const calls = parseGemmaToolCallsFromText(accText);
              if (calls) {
                // Emit only the first call per step (R-handle sequencing).
                const tc = calls[0];
                const id = 'gemma-tc-0';
                const input = JSON.stringify(tc.parameters);
                controller.enqueue({ type: 'tool-input-start', id, toolName: tc.name });
                controller.enqueue({ type: 'tool-input-delta', id, delta: input });
                controller.enqueue({ type: 'tool-input-end', id });
                controller.enqueue({ type: 'tool-call', toolCallId: id, toolName: tc.name, input });
                controller.enqueue({ ...value, finishReason: 'tool-calls' });
              } else {
                // Pure prose — emit buffered text normally, then finish.
                for (const p of textParts) controller.enqueue(p);
                controller.enqueue(value);
              }
            } else {
              // stream-start, response-metadata, errors, reasoning — pass through immediately.
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return { ...result, stream: stream as typeof result.stream };
  },
};

export function withGemmaToolParsing(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({ model, middleware: gemmaToolCallMiddleware });
}
