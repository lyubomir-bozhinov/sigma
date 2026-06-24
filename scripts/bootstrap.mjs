#!/usr/bin/env node
// Create the Cloudflare resources Sigma needs (one-time per environment).
// Dry-run by default; pass --apply to actually create them.
//
// Resource names are taken from the same env vars wrangler-render.mjs / the deploy workflow use, so a
// new environment is provisioned by exporting its names first, e.g.:
//   SIGMA_D1_NAME=sigma-dev SIGMA_CSV_CACHE_NAME=sigma-csv-cache-dev node scripts/bootstrap.mjs --apply
import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');
const d1Name = process.env.SIGMA_D1_NAME || 'sigma';
const csvCacheName = process.env.SIGMA_CSV_CACHE_NAME || 'sigma-csv-cache';

// Page caching is done via `Cache-Control` headers + the per-colo Cache API (no KV). The two durable
// resources the web worker binds are D1 (the served data) and the R2 CSV-export cache. The rate-limit
// "namespaces" are not provisioned — they are account-scoped integer ids declared inline in
// apps/web/wrangler.jsonc (shared across environments). Workflows are registered by the ETL deploy.
const resources = [
  { kind: 'D1', cmd: ['d1', 'create', d1Name] },
  { kind: 'R2', cmd: ['r2', 'bucket', 'create', csvCacheName] },
];

console.log(apply ? '==> Creating Cloudflare resources' : '==> Dry run (pass --apply to create)');

for (const r of resources) {
  const line = `wrangler ${r.cmd.join(' ')}`;
  if (apply) {
    console.log(`==> ${line}`);
    try {
      execFileSync('wrangler', r.cmd, { stdio: 'inherit' });
    } catch {
      console.error(`!! ${r.kind} creation failed (it may already exist) — continuing`);
    }
  } else {
    console.log(`  ${line}`);
  }
}

if (!apply) {
  console.log(
    '\nAfter creating, capture the printed D1 `database_id` and set it as an env var (NOT in the' +
      '\ncommitted wrangler files, which keep a zero-UUID dummy for local dev):' +
      '\n  SIGMA_D1_ID=<d1 database_id>' +
      '\nFor local deploy, put it in .env.local; for CI, set it as a repo secret. See docs/deploy.md.',
  );
}
