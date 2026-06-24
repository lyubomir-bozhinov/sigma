#!/usr/bin/env node
// Delete a deployed Cloudflare Worker by name. Used to tear down ephemeral per-PR preview workers
// (see .github/workflows/preview.yml) once a pull request closes. Counterpart to teardown.mjs, which
// only clears LOCAL miniflare state — this one talks to the Cloudflare API and removes a real worker.
//
// usage:
//   node scripts/teardown-remote.mjs --name sigma-pr-123
//   node scripts/teardown-remote.mjs --name sigma-pr-123 --apply   (default is --apply; dry-run with --dry-run)
//
// Deliberately scoped to Workers only. Preview environments share the long-lived dev D1 and R2 bucket
// (read-only from the preview worker's perspective), so there is NO per-PR D1/R2 to delete — and we
// must never delete those shared stores from here. Refuses to touch the protected long-lived names.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const name = flag('--name') || process.env.SIGMA_WEB_NAME;
if (!name) {
  console.error('teardown-remote: --name <worker-name> is required (or set SIGMA_WEB_NAME).');
  process.exit(2);
}

// Never let an ephemeral-cleanup path delete a long-lived worker, however it is invoked.
const PROTECTED = new Set([
  'sigma',
  'sigma-etl',
  'sigma-stage',
  'sigma-etl-stage',
  'sigma-dev',
  'sigma-etl-dev',
]);
if (PROTECTED.has(name)) {
  console.error(`teardown-remote: refusing to delete protected long-lived worker "${name}".`);
  process.exit(1);
}

const cmd = ['delete', '--name', name];
console.log(`==> wrangler ${cmd.join(' ')}${dryRun ? '  (dry run)' : ''}`);
if (dryRun) process.exit(0);

try {
  // --force avoids the interactive confirmation prompt; a missing worker is treated as success.
  execFileSync('wrangler', [...cmd, '--force'], { stdio: 'inherit' });
} catch {
  // Most likely the worker was already deleted (e.g. the close event fired twice). Don't fail cleanup.
  console.error(
    `!! delete of "${name}" failed — it may already be gone; treating teardown as done.`,
  );
}
