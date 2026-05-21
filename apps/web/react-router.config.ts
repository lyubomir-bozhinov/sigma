import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Static info pages are prerendered at build time (see ADR-0001 §2).
  prerender: ["/methodology"],
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
