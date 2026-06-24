#!/usr/bin/env node
// One-time local setup: install deps, apply D1 migrations, seed mock data, build rollups.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps/web');
const seedFile = resolve(root, 'scripts/seed-mock.sql');
const precomputeFile = resolve(root, 'scripts/precompute.sql');

function run(cmd, args, cwd = root) {
  console.log(`==> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd });
}

console.log('==> Sigma local setup');
run('pnpm', ['install']);

// Local D1 state lives under apps/web/.wrangler — run migrate + seed from there
// so the web worker's `wrangler dev` sees the same database.
try {
  run('wrangler', ['d1', 'migrations', 'apply', 'sigma', '--local'], apiDir);
  // 1. Domain tables (authorities, bidders, tenders, contracts, nuts_regions, data_freshness)
  run('wrangler', ['d1', 'execute', 'sigma', '--local', '--file', seedFile], apiDir);
  // 2. Rollups + FTS — same step as the production import pipeline
  run('wrangler', ['d1', 'execute', 'sigma', '--local', '--file', precomputeFile], apiDir);
  console.log('\n==> Done. Start everything with: pnpm dev');
} catch {
  console.error('\n!! Local D1 setup failed — check that wrangler is on PATH, then re-run `pnpm setup`.');
  process.exitCode = 1;
}
