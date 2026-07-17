// LIVE accuracy lane — runs the whole catalog against a REAL assistant and prints a scorecard.
//
// Isolated from per-build CI two ways (defence in depth): the `.eval-live.test.ts` suffix is excluded
// from vitest.config.ts's node project (so `pnpm test` never collects it), AND it skips unless
// SIGMA_EVAL_URL is set. Run it with `SIGMA_EVAL_URL=… pnpm --filter @sigma/web test:eval:live`. The
// target must be a turnstile-off (non-prod) deployment with a seeded D1 — no browser token is mintable.
//
// It is a MONITOR, not a gate: it asserts only that the run completed, and prints the ✅/⚠️/❌ scorecard
// (+ regressions) as the artifact. LLM non-determinism means accuracy is trended, never hard-failed here.

import { describe, expect, it } from 'vitest';
import { loadCases } from './load';
import { drive } from './runner/drive';
import { renderScorecard, scorecard, type CaseRun } from './scorecard';

const EVAL_URL = process.env.SIGMA_EVAL_URL;

describe.skipIf(!EVAL_URL)('assistant accuracy (live)', () => {
  it('runs the catalog and reports a scorecard', async () => {
    const cases = await loadCases();
    const runs: CaseRun[] = [];
    for (const c of cases) {
      // Isolate each turn: a network failure (or any throw) on one case is recorded as an errored run,
      // never aborts the loop — the monitor must always reach the scorecard for the other N-1 cases.
      try {
        runs.push({ case: c, run: await drive(c.prompt, { url: EVAL_URL! }) });
      } catch (err) {
        console.warn(
          `eval: case ${c.id} threw — ${err instanceof Error ? err.message : String(err)}`,
        );
        runs.push({
          case: c,
          run: { report: null, declined: false, error: { status: 0 }, chunks: [] },
        });
      }
    }
    const sc = scorecard(runs);
    // The scorecard is the deliverable — surfaced in the workflow log / artifact.
    console.log(`\n${renderScorecard(sc)}\n`);
    expect(runs.length).toBe(cases.length);
  }, 600_000);
});
