import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'wrangler-render.mjs');

// A minimal-but-valid web config: the D1 sentinel (so SIGMA_D1_ID substitution is exercised), the two
// gateway URLs carrying a 32-hex account id, and the four rate limiters assertRateLimiters requires.
const OLD_ACCT = 'ffffffffffffffffffffffffffffffff';
const NEW_ACCT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FIXTURE = {
  name: 'sigma',
  d1_databases: [
    { binding: 'DB', database_name: 'sigma', database_id: '00000000-0000-0000-0000-000000000000' },
  ],
  vars: {
    AI_GATEWAY_BASE_URL: `https://gateway.ai.cloudflare.com/v1/${OLD_ACCT}/sigma-assistant/custom-bggpt/v1`,
    BGGPT_STT_BASE_URL: `https://gateway.ai.cloudflare.com/v1/${OLD_ACCT}/sigma-assistant/custom-bggpt-voice`,
  },
  unsafe: {
    bindings: [
      {
        name: 'CSV_RATE_LIMITER',
        type: 'ratelimit',
        namespace_id: '1001',
        simple: { limit: 10, period: 60 },
      },
      {
        name: 'AGG_RATE_LIMITER',
        type: 'ratelimit',
        namespace_id: '1002',
        simple: { limit: 30, period: 60 },
      },
      {
        name: 'SEARCH_RATE_LIMITER',
        type: 'ratelimit',
        namespace_id: '1003',
        simple: { limit: 20, period: 60 },
      },
      {
        name: 'ASSISTANT_RATE_LIMITER',
        type: 'ratelimit',
        namespace_id: '1005',
        simple: { limit: 10, period: 60 },
      },
    ],
  },
};

// Render the fixture in a throwaway dir with a controlled env (SIGMA_* stripped so the host shell can't
// leak overrides into the assertion), returning the parsed wrangler.deploy.json.
function render(extraEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-render-'));
  const input = join(dir, 'wrangler.json');
  writeFileSync(input, JSON.stringify(FIXTURE, null, 2));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('SIGMA_')),
  );
  try {
    execFileSync('node', [SCRIPT, input], {
      env: { ...env, SIGMA_D1_ID: 'test-d1-id', ...extraEnv },
    });
    return JSON.parse(readFileSync(join(dir, 'wrangler.deploy.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('wrangler-render: SIGMA_AI_GATEWAY_ACCOUNT', () => {
  it('swaps the account id in both gateway URLs when set', () => {
    const out = render({ SIGMA_AI_GATEWAY_ACCOUNT: NEW_ACCT });
    assert.equal(
      out.vars.AI_GATEWAY_BASE_URL,
      `https://gateway.ai.cloudflare.com/v1/${NEW_ACCT}/sigma-assistant/custom-bggpt/v1`,
    );
    assert.equal(
      out.vars.BGGPT_STT_BASE_URL,
      `https://gateway.ai.cloudflare.com/v1/${NEW_ACCT}/sigma-assistant/custom-bggpt-voice`,
    );
    // Only the account segment moves — gateway slug + path are preserved.
    assert.ok(!JSON.stringify(out.vars).includes(OLD_ACCT));
  });

  it('leaves the gateway URLs byte-identical when unset (prod/staging invariant)', () => {
    const out = render({});
    assert.equal(out.vars.AI_GATEWAY_BASE_URL, FIXTURE.vars.AI_GATEWAY_BASE_URL);
    assert.equal(out.vars.BGGPT_STT_BASE_URL, FIXTURE.vars.BGGPT_STT_BASE_URL);
    // The D1 sentinel is still substituted regardless of the gateway override.
    assert.equal(out.d1_databases[0].database_id, 'test-d1-id');
  });
});
