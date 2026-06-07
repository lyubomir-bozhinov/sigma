# Gating the explorer before public launch

Sigma can be deployed to Cloudflare and kept **private until release**, then made **public by
flipping a single flag — no redeploy**. The mechanism is a password gate inside the `sigma`
worker ([apps/web](../apps/web)), toggled by a `published` flag stored in KV. This runs on the
existing `sigma.<subdomain>.workers.dev` URL with no custom domain required.

> **Status: design / not yet implemented.** This document is the agreed design and the runbook for
> once it lands. The committed `wrangler.*` files have **no KV namespace** today
> (`kv_namespaces: []`), and the worker entry has no gate. Wiring it is a small change to
> [apps/web/workers/app.ts](../apps/web/workers/app.ts) plus one KV binding — see
> [§ What to add](#what-to-add).

## Why not Cloudflare Access

Cloudflare Access (Zero Trust) is the "proper" edge authentication and was the first choice, but it
**cannot gate a `*.workers.dev` URL**: self-hosted Access applications only attach to a hostname on
a **zone in your own Cloudflare account**, and `workers.dev` is Cloudflare's shared zone. Using
Access would therefore mean:

1. registering/adding a custom domain to the account,
2. pointing the worker at it (`routes` with `custom_domain: true` in `wrangler.jsonc`), and
3. setting `workers_dev: false` so the ungated `workers.dev` URL stops responding.

That's a clean setup, but it adds a **domain dependency** v1 does not otherwise need (the explorer
is served entirely from `workers.dev` today — see [deploy.md](deploy.md)). So the decision is to
**gate inside the worker** instead: it works on the existing URL, needs no domain, and the gate code
lives where we already control it.

> **Revisit Access** if Sigma later gets a custom domain — at that point edge-level Access (email
> list or service token) is stronger than an in-app password and removes the static-asset caveat
> below. Until then, the in-worker gate is the right tradeoff.

## How it works

Two pieces of configuration drive the gate:

| Thing | Where | Role |
| --- | --- | --- |
| `published` | KV namespace `CONFIG`, key `published` | The toggle. Read at runtime, so flipping it needs **no redeploy**. |
| `GATE_PASSWORD` | Worker secret | The shared preview password. Rarely changes — keeping it separate from the flag is deliberate. |

The gate sits at the **very top** of the worker's `fetch` handler
([apps/web/workers/app.ts:89](../apps/web/workers/app.ts)), before the edge-cache lookup:

```ts
export default {
  async fetch(request, env, ctx) {
    // Gate: while unpublished, require HTTP Basic Auth against GATE_PASSWORD.
    // Missing/empty key => not published => gated (fail closed).
    const published = (await env.CONFIG.get('published', { cacheTtl: 60 })) === 'true';
    if (!published && !validBasicAuth(request, env)) {
      return new Response('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Sigma preview"' },
      });
    }
    // …existing edge-cache + SSR path, unchanged…
  },
} satisfies ExportedHandler<Env>;
```

```ts
function validBasicAuth(request: Request, env: Env): boolean {
  const [scheme, encoded] = (request.headers.get('Authorization') ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = atob(encoded);                       // "user:pass" — any user, password is what matters
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  return constantTimeEqual(supplied, env.GATE_PASSWORD); // avoid leaking the password via timing
}
```

Two properties fall out of this placement for free:

- **Fail closed.** A missing `published` key reads as `null`, so the `=== 'true'` check is `false`
  and the site is gated. A fresh deploy is therefore **private by default** until you explicitly
  flip it public.
- **No cache leak.** The gate runs *before* `edgeCache.match` ([app.ts:96](../apps/web/workers/app.ts)),
  so a cached page can never be served to an unauthenticated request. And the existing
  `isAnonymous()` ([app.ts:40](../apps/web/workers/app.ts)) already excludes any request carrying an
  `Authorization` header from the edge cache — so preview traffic never pollutes the public cache,
  and the caching logic needs no changes.

The `cacheTtl: 60` on the KV read keeps it nearly free (one read per colo per minute) at the cost of
flips taking up to ~60s to propagate. Lower it if you want a snappier toggle.

## What to add

1. **KV namespace + binding.** Mirror the `SIGMA_D1_ID` pattern in [deploy.md](deploy.md): the
   committed `wrangler.jsonc` carries a dummy id for local dev; the real id is injected at deploy
   time via [scripts/wrangler-render.mjs](../scripts/wrangler-render.mjs) (add a `SIGMA_KV_ID` env
   var alongside `SIGMA_D1_ID`), so the repo stays portable across CF accounts.

   ```bash
   wrangler kv namespace create CONFIG     # prints the id → SIGMA_KV_ID
   ```

   ```jsonc
   // apps/web/wrangler.jsonc
   "kv_namespaces": [{ "binding": "CONFIG", "id": "00000000000000000000000000000000" }]
   ```

2. **The password secret.**

   ```bash
   wrangler secret put GATE_PASSWORD       # production
   echo 'GATE_PASSWORD=<some-preview-password>' >> apps/web/.dev.vars   # local dev (gitignored)
   ```

3. **The gate code** in [apps/web/workers/app.ts](../apps/web/workers/app.ts) as sketched above,
   plus `CONFIG` and `GATE_PASSWORD` on the generated `Env` type (`wrangler types`).

## Going public — the flip

```bash
wrangler kv key put published true        # opens within ~60s, no redeploy
```

Re-gate at any time by setting it back:

```bash
wrangler kv key put published false       # or: wrangler kv key delete published  (fail-closed)
```

Because the flag is read at runtime from KV, **this never touches a deploy** — which is the whole
point versus storing the flag in `vars`/secrets (those bind at deploy time and would require a
redeploy to change).

## Static-asset caveat — soft vs hard gate

The build serves the client bundle via **Cloudflare Static Assets** (`"assets": { "directory":
"../client" }` in the generated config), and static assets are served **before the worker runs**. So
by default the gate covers **every SSR page and all D1-backed data/loaders**, but **not** the hashed
client files (`/assets/*.js`, fonts, favicon).

- **Soft gate (default).** Content and data are locked; only hashed-name JS/CSS is reachable, and
  it's meaningless without the gated HTML (every loader/data request still `401`s). Adequate for a
  normal "preview until launch" window.
- **Hard gate.** Set `run_worker_first: true` on the assets binding so the worker intercepts *every*
  request and the gate covers assets too. Costs a worker invocation per asset during preview and a
  little extra wiring (forwarding allowed asset requests to `env.ASSETS`); irrelevant after launch.

Pick soft unless "nothing whatsoever is reachable before launch" is a hard requirement.

## Notes

- **HTTPS only.** `workers.dev` is always HTTPS, so the Basic Auth credential is never sent in the
  clear.
- **Audience.** This is a shared-password preview gate for a small group, not per-user auth. If you
  need named users / audit / SSO, that's the Access path (and a custom domain).
- **The ETL is already private.** `sigma-etl` has no public HTTP surface (cron-only) — this gate is
  only about the public-facing explorer. See [deploy.md § Notes](deploy.md).
