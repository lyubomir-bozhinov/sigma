import { defineConfig } from 'vitest/config';
import { testAlias } from './vitest.alias';

// The LIVE accuracy lane (*.eval-live.test.ts), isolated to its own task exactly like the golden lane.
// vitest.config.ts's node project excludes this suffix, so `pnpm test` and `pnpm test:eval:live` stay
// separate: the per-build gate never hits the model, and this lane runs only on manual dispatch. The
// live test itself also skips unless SIGMA_EVAL_URL is set (defence in depth).
export default defineConfig({
  resolve: { alias: testAlias },
  test: {
    environment: 'node',
    include: ['app/**/*.eval-live.test.ts'],
  },
});
