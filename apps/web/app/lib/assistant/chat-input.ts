// Pure helpers for sanitising the client-posted chat payload before it reaches the model. Kept out of
// the route module so they are unit-testable without the Worker/SDK harness.

import type { UIMessage } from 'ai';

/**
 * Select the client messages that may be sent to the model: keep only `user`/`assistant` turns, then the
 * most recent `max`. The server OWNS the system prompt (passed via streamText's `system` option) — a
 * client-supplied `system` (or `tool`) message would otherwise be converted to a model message and reach
 * BgGPT as a second system instruction, a prompt-injection amplifier the AI SDK itself warns about.
 * Filtering BEFORE the recency slice stops injected messages from evicting real turns from the window
 * (review #80, red-team R1).
 */
export function selectClientMessages(messages: unknown, max: number): UIMessage[] {
  // `messages` is UNTRUSTED client JSON: it may be a non-array, or carry items without a `parts` array.
  // Validate structurally here so downstream (messageTextChars/latestUserText/convertToModelMessages)
  // never deref `.parts` on a bad shape — otherwise a payload like {"messages":"x"} or
  // {"messages":[{"role":"user"}]} throws and surfaces as a 500 on a public endpoint (review #80).
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is UIMessage => {
      if (!m || typeof m !== 'object') return false;
      const msg = m as { role?: unknown; parts?: unknown };
      return (msg.role === 'user' || msg.role === 'assistant') && Array.isArray(msg.parts);
    })
    .slice(-max);
}
