import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'workers/**/*.test.ts'],
    // `*.workerd.test.ts` runs only under vitest.workers.config.ts (real workerd); it imports
    // `cloudflare:test`, which does not resolve in the node environment.
    exclude: ['**/node_modules/**', '**/*.workerd.test.ts'],
  },
});
