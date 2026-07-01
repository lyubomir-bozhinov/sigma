import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Runs the rate-limiter suite inside REAL workerd (via miniflare) instead of node, so the fix is
// proven on the runtime that serves production — URL/Request parsing, and (critically) the actual
// `ratelimit` unsafe bindings from wrangler.test.jsonc, not stubs. The node config (vitest.config.ts)
// still runs the full suite for coverage + the app.ts integration test that mocks the RR build.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
  test: {
    include: [
      'workers/rate-limit.test.ts',
      'workers/search-rate-limit.test.ts',
      'workers/aggregation-rate-limit.test.ts',
      'workers/csv-rate-limit.test.ts',
      'workers/assistant-rate-limit.test.ts',
      'workers/rate-limit.workerd.test.ts',
    ],
  },
});
