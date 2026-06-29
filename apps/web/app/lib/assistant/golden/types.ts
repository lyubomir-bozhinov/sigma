// Golden-reports replay harness (G1 step 10) — fixture type.
//
// A GoldenFixture is one recorded canonical run: a prompt, the run_sql step(s) the server executed
// (with their recorded result rows), the emit_report the model produced, and the invariants the
// replayed report must satisfy. The harness (golden.test.ts) replays each fixture through the REAL
// server pipeline (runTool('run_sql', …) → finalizeReport) and asserts six integrity properties
// (assertions.ts) — so a regression in any guard surfaces as a failing golden run, not a silent drift.
//
// Fixtures assert SUBSTRINGS / invariants, never exact SQL or row equality, so a benign refactor of the
// guards (e.g. a reworded callout, an injected LIMIT) does not churn the corpus.

import type { EmitReportInput } from '../report-schema';

/** A valid rollup reconcile target — the amount_eur-filtered rollups (never `home_totals`). */
export type RollupTarget = 'sector_totals' | 'authority_totals' | 'company_totals';

/** A single recorded server-executed run_sql step: the SQL issued and the rows D1 returned for it. */
export interface GoldenStep {
  tool: 'run_sql';
  sql: string;
  result: { rows: Record<string, string | number | null>[] };
}

/**
 * The reconcile expectation for a fixture: the live aggregate (count, sum) the run produced and the
 * precomputed rollup row it must reconcile against, AT THE SAME `grain`. `target` is widened to string
 * so a NEGATIVE fixture can record an invalid target (`home_totals`) that assertion 4 must reject.
 */
export interface RollupExpectation {
  target: RollupTarget | string;
  grain: Record<string, string>;
  aggregate: { count: number; sumEur: number };
  rollupRow: { count: number; sumEur: number };
}

export interface GoldenExpect {
  /** Does any step read the base `contracts` table (so the default-filter gate + callout must fire)? */
  queriesContracts: boolean;
  /**
   * Default-filter opt-outs this run documents. Each names a deterministic opt-out whose `ВНИМАНИЕ:`
   * warning line is sourced directly from `applyDefaultFilters({…})` by assertion 3.
   */
  optOuts?: ('includeUnsummable' | 'includeSynthetic' | 'publishedAt')[];
  /** A legitimately empty result (0 rows) — assertion 6 then permits empty data blocks. */
  emptyOk?: boolean;
  /** Present when the run presents a reconciled count/sum (assertion 4). */
  rollup?: RollupExpectation;
}

/**
 * A NEGATIVE fixture marks the single integrity property it is built to VIOLATE, so the negative-path
 * tests can target it. Absent ⇒ a positive fixture that must satisfy all six assertions.
 */
export type NegativeKind =
  | 'prose-number' // emit smuggles a material number into text/callout prose → bind must fail
  | 'home-totals' // reconcile target is `home_totals` → assertion 4 must reject
  | 'reconcile-mismatch' // aggregate disagrees with the rollup → assertReconciled must throw
  | 'dangling-handle'; // emit references a missing column/handle → bind must fail

export interface GoldenFixture {
  id: string;
  prompt: string;
  steps: GoldenStep[];
  emit: EmitReportInput;
  expect: GoldenExpect;
  negative?: NegativeKind;
}
