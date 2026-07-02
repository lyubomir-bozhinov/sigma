import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { ASSISTANT_ERROR_COPY } from './errors';
import { MAX_BYTES, MAX_MESSAGES } from './storage';
import { classifyingFetch, prepareChatBody } from './useAssistantChat';

const jsonResponse = (status: number, error?: string) =>
  new Response(error === undefined ? null : JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyingFetch', () => {
  it('returns the response unchanged on success', async () => {
    const ok = new Response('stream', { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok),
    );

    await expect(classifyingFetch('/assistant/chat')).resolves.toBe(ok);
  });

  it('throws the server message for a 503 JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, 'Сървърна бележка')),
    );

    await expect(classifyingFetch('/assistant/chat')).rejects.toThrow('Сървърна бележка');
  });

  it('throws curated copy for a 429 plain-text body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Too many assistant requests', { status: 429 })),
    );

    await expect(classifyingFetch('/assistant/chat')).rejects.toThrow(
      ASSISTANT_ERROR_COPY.rateLimited,
    );
  });

  it('does not leak an internal 400 JSON body to the user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(400, 'invalid JSON')),
    );

    await expect(classifyingFetch('/assistant/chat')).rejects.toThrow(
      ASSISTANT_ERROR_COPY.badRequest,
    );
  });

  it('throws the offline copy when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(classifyingFetch('/assistant/chat')).rejects.toThrow(ASSISTANT_ERROR_COPY.network);
  });

  it('re-throws a user abort so it is not surfaced as an error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      }),
    );

    await expect(classifyingFetch('/assistant/chat')).rejects.toBe(abort);
  });
});

describe('prepareChatBody', () => {
  const msg = (id: string, text: string): UIMessage =>
    ({ id, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage;

  it('short history goes out verbatim', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => msg(`m${i}`, `t${i}`));
    expect(prepareChatBody(msgs)).toEqual({ messages: msgs });
  });

  it('long history is condensed to one recap + recent turns and stays under the POST caps', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => msg(`m${i}`, `въпрос ${i} `.repeat(50)));
    const { messages } = prepareChatBody(msgs);

    expect(messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(messages[0].id).toMatch(/^recap-/);
    expect(messages[messages.length - 1].id).toBe('m39');
    expect(new TextEncoder().encode(JSON.stringify(messages)).length).toBeLessThanOrEqual(MAX_BYTES);
  });
});
