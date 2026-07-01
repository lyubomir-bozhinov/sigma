import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { rateLimitAggregationRoute } from './aggregation-rate-limit';
import { rateLimitAssistantRoute } from './assistant-rate-limit';
import { rateLimitCsvExport } from './csv-rate-limit';
import { rateLimitSearchRoute } from './search-rate-limit';

// Runs ONLY under vitest.workers.config.ts (real workerd). `cloudflare:test` `env` carries the actual
// `ratelimit` unsafe bindings from wrangler.test.jsonc — miniflare enforces the real limit/period — so
// these prove the .data twin fix against the production runtime and a genuine limiter, closing the gap
// the node suite (which stubs the binding) can't: URL parsing + the real throttle both hold in workerd.

// `env` is typed as the (empty) ProvidedEnv without an env.d.ts; assert the binding shape we rely on.
const rl = env as unknown as {
  SEARCH_RATE_LIMITER: RateLimit;
  AGG_RATE_LIMITER: RateLimit;
  CSV_RATE_LIMITER: RateLimit;
  ASSISTANT_RATE_LIMITER: RateLimit;
};
const IS_PROD = true;

const getReq = (path: string, ip: string) =>
  new Request(`https://sigma.test${path}`, { headers: { 'CF-Connecting-IP': ip } });

describe('.data twins throttle against the REAL miniflare ratelimit bindings (#184)', () => {
  it('SEARCH_RATE_LIMITER (limit 20/60) throttles the /search.data twin', async () => {
    const ip = '198.51.100.10';
    let allowed = 0;
    let throttled = 0;
    for (let i = 0; i < 25; i++) {
      const res = await rateLimitSearchRoute(getReq('/search.data?q=a', ip), rl, IS_PROD);
      if (res === null) allowed++;
      else if (res.status === 429) throttled++;
    }
    // Under the limit it lets requests through; past it the real binding returns 429 for the twin.
    expect(allowed).toBeGreaterThan(0);
    expect(throttled).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(20); // never allow more than the configured limit
  });

  it('the /search.data twin and bare /search share ONE per-IP budget (the fix, proven live)', async () => {
    const ip = '198.51.100.11';
    // Exhaust the budget entirely through the .data twin...
    for (let i = 0; i < 25; i++)
      await rateLimitSearchRoute(getReq('/search.data?q=a', ip), rl, IS_PROD);
    // ...then the BARE path for the same IP is already throttled — the twin was not a separate channel.
    const bare = await rateLimitSearchRoute(getReq('/search?q=a', ip), rl, IS_PROD);
    expect(bare?.status).toBe(429);
  });

  it('does not throttle a fresh client on its first /search.data request', async () => {
    const res = await rateLimitSearchRoute(
      getReq('/search.data?q=a', '198.51.100.12'),
      rl,
      IS_PROD,
    );
    expect(res).toBeNull();
  });

  it('CSV_RATE_LIMITER (limit 10/60) throttles the /contracts.csv.data twin', async () => {
    const ip = '198.51.100.20';
    let throttled = 0;
    for (let i = 0; i < 15; i++) {
      const res = await rateLimitCsvExport(getReq('/contracts.csv.data', ip), rl, IS_PROD);
      if (res?.status === 429) throttled++;
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('AGG_RATE_LIMITER (limit 30/60) throttles the /companies.data twin', async () => {
    const ip = '198.51.100.30';
    let throttled = 0;
    for (let i = 0; i < 35; i++) {
      const res = await rateLimitAggregationRoute(getReq('/companies.data', ip), rl, IS_PROD);
      if (res?.status === 429) throttled++;
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('ASSISTANT_RATE_LIMITER (limit 10/60) throttles the POST /assistant/chat.data twin', async () => {
    const ip = '198.51.100.40';
    let throttled = 0;
    for (let i = 0; i < 15; i++) {
      const req = new Request('https://sigma.test/assistant/chat.data', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      });
      const res = await rateLimitAssistantRoute(req, rl, IS_PROD);
      if (res?.status === 429) throttled++;
    }
    expect(throttled).toBeGreaterThan(0);
  });
});
