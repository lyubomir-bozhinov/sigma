import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREVIEW_PREFIX,
  PROTECTED,
  assertDeletable,
  deleteWorker,
  ephemeralPreviewRe,
  isEphemeralPreviewName,
  isProtected,
  previewPrefix,
} from './teardown-remote.mjs';

// Run `fn` with PREVIEW_WORKER_PREFIX set to `value` (or unset when undefined), always restoring the
// prior env so test order can't leak the prefix into the default-behaviour suites above.
function withPrefix(value, fn) {
  const prior = process.env.PREVIEW_WORKER_PREFIX;
  if (value === undefined) delete process.env.PREVIEW_WORKER_PREFIX;
  else process.env.PREVIEW_WORKER_PREFIX = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env.PREVIEW_WORKER_PREFIX;
    else process.env.PREVIEW_WORKER_PREFIX = prior;
  }
}

describe('isProtected', () => {
  it('flags every long-lived worker', () => {
    for (const name of [
      'sigma',
      'sigma-etl',
      'sigma-stage',
      'sigma-etl-stage',
      'sigma-dev',
      'sigma-etl-dev',
    ]) {
      assert.equal(isProtected(name), true, name);
    }
  });

  it('does not flag ephemeral preview names', () => {
    assert.equal(isProtected('sigma-pr-123'), false);
  });
});

describe('isEphemeralPreviewName', () => {
  it('matches sigma-pr-<number>', () => {
    assert.equal(isEphemeralPreviewName('sigma-pr-1'), true);
    assert.equal(isEphemeralPreviewName('sigma-pr-99999'), true);
  });

  it('rejects anything that is not exactly sigma-pr-<number>', () => {
    for (const name of [
      'sigma',
      'sigma-dev',
      'sigma-pr-', // no number
      'sigma-pr-abc', // non-numeric
      'sigma-pr-12-x', // trailing junk
      'prod-sigma-pr-1', // prefix
      'SIGMA-PR-1', // wrong case
      undefined,
      null,
      42,
    ]) {
      assert.equal(isEphemeralPreviewName(name), false, String(name));
    }
  });
});

describe('assertDeletable', () => {
  it('allows an ephemeral preview worker', () => {
    assert.doesNotThrow(() => assertDeletable('sigma-pr-42'));
  });

  it('refuses every protected long-lived worker', () => {
    for (const name of PROTECTED) {
      assert.throws(
        () => assertDeletable(name),
        /refusing to delete protected long-lived worker/,
        name,
      );
    }
  });

  it('refuses a missing name', () => {
    assert.throws(() => assertDeletable(undefined), /a worker name is required/);
    assert.throws(() => assertDeletable(''), /a worker name is required/);
  });

  it('refuses a non-preview worker name (allowlist)', () => {
    assert.throws(() => assertDeletable('some-random-worker'), /not an ephemeral preview worker/);
  });
});

describe('deleteWorker', () => {
  it('never invokes wrangler in dry-run', () => {
    let called = false;
    const result = deleteWorker('sigma-pr-7', { dryRun: true, exec: () => (called = true) });
    assert.equal(result, 'dry-run');
    assert.equal(called, false);
  });

  it('reports "deleted" on success', () => {
    assert.equal(deleteWorker('sigma-pr-7', { exec: () => '' }), 'deleted');
  });

  it('treats a missing script (code 10007) as "already-gone"', () => {
    const exec = () => {
      const err = new Error('exit 1');
      err.stderr =
        'A request to the Cloudflare API failed. workers.api.error.script_not_found [code: 10007]';
      throw err;
    };
    assert.equal(deleteWorker('sigma-pr-7', { exec }), 'already-gone');
  });

  it('rethrows a hard failure (e.g. auth) instead of masking a leak', () => {
    const exec = () => {
      const err = new Error('exit 1');
      err.stderr = 'Authentication error [code: 10000]';
      throw err;
    };
    assert.throws(() => deleteWorker('sigma-pr-7', { exec }), /exit 1/);
  });

  it('refuses a protected worker even when handed a stub exec', () => {
    let called = false;
    assert.throws(
      () => deleteWorker('sigma-etl', { exec: () => (called = true) }),
      /refusing to delete protected long-lived worker/,
    );
    assert.equal(called, false);
  });
});

describe('configurable preview prefix (PREVIEW_WORKER_PREFIX)', () => {
  it('defaults to sigma-pr when unset or blank', () => {
    withPrefix(undefined, () => assert.equal(previewPrefix(), DEFAULT_PREVIEW_PREFIX));
    withPrefix('   ', () => assert.equal(previewPrefix(), DEFAULT_PREVIEW_PREFIX));
  });

  it('uses the configured prefix for the deletion allowlist', () => {
    withPrefix('midt-pr', () => {
      assert.equal(isEphemeralPreviewName('midt-pr-5'), true);
      assert.equal(isEphemeralPreviewName('midt-pr-99999'), true);
      // Still requires the trailing -<digits>, so the app's own workers never match.
      assert.equal(isEphemeralPreviewName('midt-pr'), false);
      assert.equal(isEphemeralPreviewName('midt'), false);
      // The old default no longer matches once a different prefix is configured.
      assert.equal(isEphemeralPreviewName('sigma-pr-5'), false);
    });
  });

  it('lets assertDeletable accept a renamed preview and name the prefix on rejection', () => {
    withPrefix('midt-pr', () => {
      assert.doesNotThrow(() => assertDeletable('midt-pr-42'));
      assert.throws(() => assertDeletable('sigma-pr-42'), /expected midt-pr-<number>/);
    });
  });

  it('escapes regex metacharacters in the prefix (no accidental wildcards)', () => {
    withPrefix('a.b', () => {
      assert.equal(ephemeralPreviewRe().source, '^a\\.b-\\d+$');
      assert.equal(isEphemeralPreviewName('a.b-1'), true);
      assert.equal(isEphemeralPreviewName('axb-1'), false); // `.` must not act as a wildcard
    });
  });
});
