import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listWorkerScripts, selectStale } from './reap-previews.mjs';

// Fixed reference instant so the test is deterministic (no Date.now()).
const NOW = Date.parse('2026-06-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('selectStale', () => {
  it('selects only previews older than the max age', () => {
    const scripts = [
      { id: 'sigma-pr-1', modified_on: daysAgo(6) }, // stale
      { id: 'sigma-pr-2', modified_on: daysAgo(4) }, // fresh
      { id: 'sigma-pr-3', modified_on: daysAgo(10) }, // stale
    ];
    const stale = selectStale(scripts, { maxAgeDays: 5, nowMs: NOW });
    assert.deepEqual(
      stale.map((s) => s.name),
      ['sigma-pr-1', 'sigma-pr-3'],
    );
  });

  it('never selects long-lived / non-preview workers, however old', () => {
    const scripts = [
      { id: 'sigma', modified_on: daysAgo(400) },
      { id: 'sigma-etl', modified_on: daysAgo(400) },
      { id: 'sigma-dev', modified_on: daysAgo(400) },
      { id: 'sigma-pr-9', modified_on: daysAgo(400) }, // only this one qualifies
    ];
    const stale = selectStale(scripts, { maxAgeDays: 5, nowMs: NOW });
    assert.deepEqual(
      stale.map((s) => s.name),
      ['sigma-pr-9'],
    );
  });

  it('leaves previews with an unparseable timestamp alone', () => {
    const scripts = [{ id: 'sigma-pr-1', modified_on: 'not-a-date' }];
    assert.deepEqual(selectStale(scripts, { maxAgeDays: 5, nowMs: NOW }), []);
  });

  it('treats exactly-at-the-boundary as not yet stale', () => {
    const scripts = [{ id: 'sigma-pr-1', modified_on: daysAgo(5) }];
    assert.deepEqual(selectStale(scripts, { maxAgeDays: 5, nowMs: NOW }), []);
  });
});

describe('listWorkerScripts', () => {
  it('returns the result array on success', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ success: true, result: [{ id: 'sigma-pr-1' }] }),
    });
    const out = await listWorkerScripts({ accountId: 'a', token: 't', fetchImpl });
    assert.deepEqual(out, [{ id: 'sigma-pr-1' }]);
  });

  it('follows the cursor across pages and concatenates every result', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const onFirstPage = !url.includes('cursor=');
      return {
        ok: true,
        json: async () =>
          onFirstPage
            ? { success: true, result: [{ id: 'sigma-pr-1' }], result_info: { cursor: 'next-page' } }
            : { success: true, result: [{ id: 'sigma-pr-2' }], result_info: { cursor: '' } },
      };
    };
    const out = await listWorkerScripts({ accountId: 'a', token: 't', fetchImpl });
    assert.deepEqual(out, [{ id: 'sigma-pr-1' }, { id: 'sigma-pr-2' }]);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /cursor=next-page/);
  });

  it('throws with the API error on failure', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ message: 'bad token' }] }),
    });
    await assert.rejects(
      () => listWorkerScripts({ accountId: 'a', token: 't', fetchImpl }),
      /list scripts failed \(403\).*bad token/,
    );
  });
});
