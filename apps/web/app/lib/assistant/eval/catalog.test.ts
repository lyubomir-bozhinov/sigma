// Per-build catalog integrity (deterministic, no model). Loads the real catalog and checks it is
// well-formed: discovered, unique ids, every check dispatchable, every case anchored to a baseline.
// This runs in `pnpm test`; the LIVE run (hitting the model) is a separate, dispatch-only lane.

import { describe, expect, it } from 'vitest';
import { loadCases } from './load';
import type { RunOutput } from './run-output';
import { score } from './scorers/index';

const EMPTY: RunOutput = { report: null, declined: false, chunks: [] };

describe('catalog integrity', () => {
  it('discovers the category files and loads a non-empty corpus', async () => {
    const cases = await loadCases();
    expect(cases.length).toBeGreaterThan(0);
    // loadCases throws on a duplicate id, so reaching here proves uniqueness; assert it explicitly too.
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('stamps a category on every case from its file', async () => {
    const cases = await loadCases();
    for (const c of cases) expect(c.category, c.id).toMatch(/^[a-z][a-z-]*$/);
  });

  it('gives every case at least one check', async () => {
    const cases = await loadCases();
    for (const c of cases) expect(c.checks.length, c.id).toBeGreaterThan(0);
  });

  it('never passes a check against an empty (no-report) run', async () => {
    // Real invariant (not just "returns a boolean"): a run with no answer must fail every check — this
    // catches a scorer mis-wired to pass unconditionally, which a typeof check would miss.
    const cases = await loadCases();
    for (const c of cases) {
      for (const check of c.checks) {
        expect(score(EMPTY, check).pass, `${c.id}:${check.kind}`).toBe(false);
      }
    }
  });

  it('anchors every case to a manual-eval baseline verdict', async () => {
    const cases = await loadCases();
    for (const c of cases) expect(c.baseline, c.id).toBeDefined();
  });
});
