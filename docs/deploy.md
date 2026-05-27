# Deploying Sigma to Cloudflare

The v1 deploy set is two workers sharing one D1: **`sigma`** (the SSR explorer — `apps/web`) and
**`sigma-etl`** (the cron-triggered refresh Workflow — `apps/etl`). `apps/api`, `apps/admin`,
`apps/assistant` are out of v1 scope and need not be deployed.

The explorer reads D1 directly; the ETL writes to the **same** D1. Locally they share one miniflare
D1 via the vite `persistState` path; in production they share it by binding the **same
`database_id`** — so the IDs below must match across the configs.

## 0. Prerequisites (one-time)

- A Cloudflare account on the **Workers Paid** plan (needed for Workflows and a ~1.4 GB D1).
- A credential. Two ways:
  - **CI (recommended):** set repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; deploys
    run from [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) on merge to `main`. No
    long-lived credential on any developer machine (per AGENTS.md).
  - **Local:** `pnpm exec wrangler login`, or export the same two env vars.

### Minimal API-token scopes

A custom token needs only these **Account**-level permissions (it cannot be scoped to a single
Worker — see "Access scoping" below): Workers Scripts **Edit**, D1 **Edit**, Workers KV Storage
**Edit**, R2 Storage **Edit**, Workflows **Edit**, Account Settings **Read**.

## 1. Provision the resources

```bash
pnpm bootstrap:apply   # creates D1 "sigma", KV "CACHE", R2 "sigma-raw"
```

Copy the printed **D1 `database_id`** and **KV namespace id** into:

- `apps/web/wrangler.jsonc` — `d1_databases[0].database_id`, `kv_namespaces[0].id`
- `apps/etl/wrangler.toml` — `[[d1_databases]] database_id`
- `apps/api/wrangler.toml` — (only if you also deploy the API)

> The D1 `database_id` **must be identical** in `web` and `etl` so the explorer reads what the refresh
> writes. These IDs are not secrets; commit them.

## 2. Load the data into the remote D1

```bash
node scripts/import.mjs --remote   # migrate → admin export → fx → NUTS → normalize → precompute
```

> **Bulk-load caveat.** `import.mjs` loads via `wrangler d1 execute --file`, which is slow over the
> API for ~190k rows. For the initial remote load, prefer `wrangler d1 execute … --remote` only for
> the schema/light steps and **`wrangler d1 import`** (server-side dump import) for the big staging +
> domain tables. The full DB is ~1.4 GB incl. staging — within the 10 GB Paid limit. After the first
> load, the daily Workflow keeps it fresh incrementally (it never reloads the base).

## 3. Deploy

**CI:** merge to `main` → [deploy.yml](../.github/workflows/deploy.yml) ships `sigma` + `sigma-etl`.

**Manual:**

```bash
pnpm --filter @sigma/web deploy   # react-router build && wrangler deploy → the `sigma` worker
pnpm --filter @sigma/etl deploy   # → the `sigma-etl` worker (registers the cron + RefreshWorkflow)
```

`apps/web` is named **`sigma`**, so this **replaces the static v1 mock** at
`sigma.<subdomain>.workers.dev` with the live SSR explorer (and attaches the D1 + KV bindings).

## 4. Verify

- Open `https://sigma.<subdomain>.workers.dev/` — real totals (190k contracts · ~50.8 bn €).
- Dashboard → **Workflows** → `sigma-refresh` is listed. Trigger one run to confirm the live
  `data.egov.bg` round-trip:
  ```bash
  curl -X POST https://sigma-etl.<subdomain>.workers.dev/etl/refresh
  curl https://sigma-etl.<subdomain>.workers.dev/etl/refresh/<id>   # poll until "complete"
  ```
- The cron (`0 */6 * * *`) then refreshes unattended.

## Notes

- **No runtime secrets** for the explorer or the ETL (read-only public data; OCDS reads need no key).
  The `.dev.vars` secrets are only for the parked `assistant`/`admin` apps.
- **Access scoping.** Cloudflare API tokens scope by permission + account, **not down to one Worker
  script** (`Workers Scripts: Edit` is account-wide). For true "only-Sigma" isolation, put the Sigma
  workers in their own Cloudflare account and scope the token to it. Otherwise use the minimal scopes
  above and keep the token in CI rather than on a laptop.
- **Reusing the `sigma` worker.** Deploying `apps/web` overwrites whatever currently serves `sigma`
  (the static mock). The ETL is necessarily a separate worker (`sigma-etl`) — it carries a cron
  trigger and the `RefreshWorkflow` class.
