// The live accuracy catalog's data contract.
//
// A catalog file (`<category>.cases.ts`) exports `cases: CaseDef[]` — one entry per question. The loader
// (../load.ts) glob-discovers every such file and stamps `category` from the filename, so adding a
// question is one entry and adding a feature is one file: the runner/loader never change.
//
// A `Check` is a SERIALISABLE descriptor (a plain object, never a closure) so a case file has no import
// of the runner and stays pure data. Each kind is answerable from the resolved report ALONE — the client
// wire carries no SQL (see ../run-output.ts), so there are deliberately no SQL-level checks here; those
// live in the deterministic guard/golden suites.

// Plain-word verdicts in code; the scorecard maps them to ✅/⚠️/❌ only when rendering the log.
export type Verdict = 'pass' | 'warn' | 'fail';

/**
 * A report-content check. Discriminated by `kind` so the scorer dispatch (../scorers) is exhaustive
 * via assertNever — a new kind is a compile error until it has a scorer.
 */
export type Check =
  | { kind: 'numeric'; expect: number; tolerancePct: number; metric?: string }
  | { kind: 'reconciles'; totalMetric: string; tolerancePct: number }
  | { kind: 'declines' }
  | { kind: 'reportPresent' }
  | { kind: 'contentIncludes'; pattern: string; flags?: string }
  | { kind: 'contentExcludes'; pattern: string; flags?: string };

/** One catalog entry BEFORE the loader stamps its category (= filename stem). */
export interface CaseDef {
  /** Unique across the whole catalog (loader enforces). */
  id: string;
  /** The user question — becomes the UIMessage text the runner POSTs. */
  prompt: string;
  /** Report-content checks; all must pass for the case to pass. */
  checks: Check[];
  /** The manual-eval verdict this case anchors to — the regression reference in the scorecard. */
  baseline?: Verdict;
  /** The dataset the `expect` numbers were taken from; the scorecard flags a mismatch. */
  dataVersion?: string;
  /** Documents an accepted ⚠️/❌ (e.g. same-name entity fragmentation) so it isn't read as a new bug. */
  knownLimitation?: string;
  tags?: readonly string[];
}

/** A loaded case: a CaseDef with its category stamped from the filename. */
export interface EvalCase extends CaseDef {
  category: string;
}

// ── Check builders — ergonomic, defaulted, type-checked. Case files use these, not raw literals. ──

/** The answered figure must fall within `tolerancePct` of `expect`. `metric` narrows to items whose
 *  label contains it (case-insensitive); omit to match any numeric value in the report. Tolerance
 *  absorbs data-refresh drift — set it wide enough for the dataset's churn, not for a wrong answer. */
export function numeric(opts: { expect: number; tolerancePct: number; metric?: string }): Check {
  return { kind: 'numeric', ...opts };
}

/** The series blocks (bar/timeseries/flows points) must sum to the `totalMetric` totals item within
 *  tolerance — top-N parts vs the stated grand total (Q6/Q11/Q23). */
export function reconciles(opts: { totalMetric: string; tolerancePct: number }): Check {
  return { kind: 'reconciles', ...opts };
}

/** The assistant must honestly decline (no report / „не разполагам…"), not fabricate — and not crash. */
export function declines(): Check {
  return { kind: 'declines' };
}

/** The turn must produce a report at all (guards a regression back to a 500/empty turn, e.g. Q17/Q19). */
export function reportPresent(): Check {
  return { kind: 'reportPresent' };
}

/** The rendered report must contain a match for `pattern` (e.g. a non-Sofia authority name for Q41). */
export function contentIncludes(pattern: string, flags?: string): Check {
  return { kind: 'contentIncludes', pattern, flags };
}

/** The rendered report must NOT contain `pattern` (e.g. a wrong „Сектор 31" health label for Q25). */
export function contentExcludes(pattern: string, flags?: string): Check {
  return { kind: 'contentExcludes', pattern, flags };
}
