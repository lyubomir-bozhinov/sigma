import { afterEach, describe, expect, it, vi } from 'vitest';

// The narrative generator and the role-④ verifier generator share a provider but MUST carry different
// generation params: the narrative gets a little variety (temp 0.3), the verifier must be deterministic
// JSON (temp 0) or a small quantized model drifts into prose and returns no JSON object at all — which
// fail-closes and strips the narrative we just produced (the drift bug this suite guards against). These
// tests mock the model layer to capture exactly what each builder passes to `generateText`.

const generateTextMock = vi.fn(async (_opts: Record<string, unknown>) => ({ text: '{}' }));
const chatMock = vi.fn(() => 'FAKE_MODEL');

vi.mock('ai', () => ({
  generateText: (opts: Record<string, unknown>) => generateTextMock(opts),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ chat: chatMock }),
}));

// Import AFTER the mocks are registered so the builders bind to the mocked modules.
const { buildDigestGenerate, buildDigestVerifierGenerate } = await import('./weekly-digest');

const ENV = {
  DB: {} as never,
  REPORTS: {} as never,
  AI_GATEWAY_BASE_URL: 'https://gateway.example/v1/acct/sigma-assistant/custom-bggpt/v1',
  ASSISTANT_MODEL: 'bggpt-gemma4-31b-it-bg-gptq-w4a16',
  ASSISTANT_API_KEY: 'k',
};

afterEach(() => {
  generateTextMock.mockClear();
  chatMock.mockClear();
});

describe('weekly-digest model generation params', () => {
  it('narrative generator: temperature 0.3, 512-token cap, no retries', async () => {
    await buildDigestGenerate(ENV)({ system: 's', prompt: 'p' });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const opts = generateTextMock.mock.calls[0]![0];
    expect(opts.temperature).toBe(0.3);
    expect(opts.maxOutputTokens).toBe(512);
    expect(opts.maxRetries).toBe(0);
  });

  it('verifier generator: temperature 0 (deterministic JSON), 1024-token cap, bounded by a timeout', async () => {
    await buildDigestVerifierGenerate(ENV)({ system: 's', prompt: 'p' });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const opts = generateTextMock.mock.calls[0]![0];
    expect(opts.temperature).toBe(0);
    expect(opts.maxOutputTokens).toBe(1024);
    expect(opts.maxRetries).toBe(0);
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('both refuse to build when AI_GATEWAY_BASE_URL is unset (never bypass the gateway)', () => {
    const bare = { ...ENV, AI_GATEWAY_BASE_URL: undefined };
    expect(() => buildDigestGenerate(bare)).toThrow(/AI_GATEWAY_BASE_URL/);
    expect(() => buildDigestVerifierGenerate(bare)).toThrow(/AI_GATEWAY_BASE_URL/);
  });
});
