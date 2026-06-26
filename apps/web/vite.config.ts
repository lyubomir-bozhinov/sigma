import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Remote bindings: set VITE_REMOTE=1 (or VITE_REMOTE=true) to route D1/R2/etc through the real
// Cloudflare account instead of the local miniflare state. Requires `wrangler login` or
// CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment. Bindings are resolved by
// the names in wrangler.jsonc against the authenticated account (same resources as sigma-dev).
const useRemoteBindings = process.env.VITE_REMOTE === '1' || process.env.VITE_REMOTE === 'true';

// Local dev reads the miniflare D1 shipped by `scripts/ship-domain.mjs` into .wrangler/state.
const persistPath = fileURLToPath(new URL('.wrangler/state', import.meta.url));

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      ...(useRemoteBindings ? { remoteBindings: true } : { persistState: { path: persistPath } }),
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // Bind all interfaces (IPv4 0.0.0.0 + IPv6) so devcontainer/host port-forwarding,
    // which connects over IPv4 127.0.0.1, can reach the server. Defaulting to `localhost`
    // resolves to IPv6 ::1 only on this box, leaving 127.0.0.1 unbound.
    host: true,
    port: 5173,
  },
});
