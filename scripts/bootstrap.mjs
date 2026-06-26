#!/usr/bin/env node
// Create the Cloudflare resources Sigma needs (one-time per CF account).
// Dry-run by default; pass --apply to actually create them.
import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');
const d1Name = process.env.SIGMA_D1_NAME || 'sigma';

// Page caching is done via `Cache-Control` headers + the per-colo Cache API (no KV). Raw archival
// is delegated to the external BG feeder (no R2). D1 is the only Cloudflare resource Sigma needs.
const resources = [{ kind: 'D1', cmd: ['d1', 'create', d1Name] }];

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

// ── Local dev: seed miniflare R2 with mock report data ───────────────────────
// wrangler r2 --local resolves .wrangler/state relative to cwd, so we run
// from apps/web and adjust the --file path accordingly.
const mockReports = [
  {
    key: 'mock-medisistem-2024.json',
    file: '../../scripts/mock-report-medisistem.json',
  },
];

const bucket = 'sigma-reports';
const webDir = 'apps/web';

console.log('\n==> Seeding local R2 mock reports');
for (const { key, file } of mockReports) {
  const cmd = [
    'r2', 'object', 'put',
    `${bucket}/${key}`,
    '--file', file,
    '--content-type', 'application/json',
    '--local',
  ];
  const line = `(cd ${webDir}) wrangler ${cmd.join(' ')}`;
  if (apply) {
    console.log(`==> ${line}`);
    try {
      execFileSync('wrangler', cmd, { stdio: 'inherit', cwd: webDir });
    } catch {
      console.error(`!! Seeding ${key} failed — continuing`);
    }
  } else {
    console.log(`  ${line}`);
  }
}
