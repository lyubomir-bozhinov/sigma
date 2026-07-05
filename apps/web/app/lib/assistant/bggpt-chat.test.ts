import { describe, expect, it, vi } from 'vitest';
import { bggptChat, type BggptChatConfig } from './bggpt-chat';

const cfg = (fetchImpl: typeof fetch): BggptChatConfig => ({
  baseURL: 'https://gw.example/custom-bggpt/v1',
  apiKey: 'k',
  model: 'bggpt-gemma4-31b-it-bg-gptq-w4a16',
  fetchImpl,
});

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('bggptChat request shape', () => {
  it('sends NO tools/tool_choice and disables thinking (prevents the vLLM 400)', async () => {
    let captured: { url: string; body: Record<string, unknown>; auth: string } | undefined;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: JSON.parse(init.body as string),
        auth: (init.headers as Record<string, string>).Authorization,
      };
      return ok('hi');
    }) as unknown as typeof fetch;

    const out = await bggptChat(cfg(fetchImpl), [{ role: 'user', content: 'здравей' }]);

    expect(out).toBe('hi');
    expect(captured!.url).toBe('https://gw.example/custom-bggpt/v1/chat/completions');
    expect(captured!.auth).toBe('Bearer k');
    expect(captured!.body.model).toBe('bggpt-gemma4-31b-it-bg-gptq-w4a16');
    expect(captured!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    // The whole point: these keys must never be present, or the mamay vLLM rejects the request.
    expect('tools' in captured!.body).toBe(false);
    expect('tool_choice' in captured!.body).toBe(false);
  });

  it('retries a 5xx then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls < 2 ? new Response('busy', { status: 503 }) : ok('recovered');
    }) as unknown as typeof fetch;

    expect(await bggptChat(cfg(fetchImpl), [{ role: 'user', content: 'x' }])).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('does NOT retry a 4xx and surfaces the status', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response('bad', { status: 400 });
    }) as unknown as typeof fetch;

    await expect(bggptChat(cfg(fetchImpl), [{ role: 'user', content: 'x' }])).rejects.toThrow(
      /BgGPT 400/,
    );
    expect(calls).toBe(1);
  });

  it('returns empty string when the response has no content', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await bggptChat(cfg(fetchImpl), [{ role: 'user', content: 'x' }])).toBe('');
  });
});
