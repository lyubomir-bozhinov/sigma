import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: node --test scripts/wrangler-render.test.mjs
// wrangler-render.mjs is a CLI script (runs at top level), so we exercise it as a subprocess rather than
// import its internals — this covers the real render path end to end.

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'wrangler-render.mjs');

// Render `tomlText` through the script with the given SIGMA_* env, returning the produced deploy config.
// The env is built WITHOUT any inherited SIGMA_* vars so a CI runner's deploy vars can't leak in and make
// the "prod, unset" case non-deterministic.
function render(tomlText, sigmaEnv = {}) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('SIGMA_')),
  );
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-render-'));
  try {
    const input = join(dir, 'wrangler.toml');
    writeFileSync(input, tomlText);
    execFileSync('node', [SCRIPT, input], { env: { ...clean, ...sigmaEnv }, stdio: 'pipe' });
    return readFileSync(join(dir, 'wrangler.deploy.toml'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Minimal etl-shaped config: a top-level worker name plus the single REPORTS R2 binding. No zero-UUID
// sentinel, so no SIGMA_D1_ID is needed to render.
const ETL_TOML = `name = "sigma-etl"
main = "src/index.ts"

[[r2_buckets]]
binding = "REPORTS"
bucket_name = "sigma-reports"
`;

describe('wrangler-render: REPORTS R2 bucket rename (etl TOML path)', () => {
  it('renames the REPORTS bucket when SIGMA_REPORTS_NAME is set (non-prod)', () => {
    const out = render(ETL_TOML, { SIGMA_REPORTS_NAME: 'sigma-reports-dev' });
    assert.match(out, /^bucket_name = "sigma-reports-dev"$/m);
    // The committed prod name must be gone (guard against "sigma-reports-dev" partially matching it).
    assert.doesNotMatch(out, /^bucket_name = "sigma-reports"$/m);
  });

  it('leaves the committed sigma-reports bucket untouched when SIGMA_REPORTS_NAME is unset (prod omits the -dev suffix)', () => {
    const out = render(ETL_TOML, {}); // no SIGMA_* — production behavior
    assert.match(out, /^bucket_name = "sigma-reports"$/m);
    assert.doesNotMatch(out, /sigma-reports-dev/);
  });

  it('renames by binding, not position — a non-REPORTS bucket is left alone', () => {
    const twoBuckets =
      ETL_TOML + '\n[[r2_buckets]]\nbinding = "OTHER"\nbucket_name = "sigma-other"\n';
    const out = render(twoBuckets, { SIGMA_REPORTS_NAME: 'sigma-reports-dev' });
    assert.match(out, /binding = "REPORTS"\nbucket_name = "sigma-reports-dev"/);
    assert.match(out, /binding = "OTHER"\nbucket_name = "sigma-other"/);
  });

  it('renames REPORTS alongside the worker name in one pass', () => {
    const out = render(ETL_TOML, { SIGMA_ETL_NAME: 'sigma-etl-dev', SIGMA_REPORTS_NAME: 'sigma-reports-dev' });
    assert.match(out, /^name = "sigma-etl-dev"$/m);
    assert.match(out, /^bucket_name = "sigma-reports-dev"$/m);
  });
});
