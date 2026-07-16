// Scoring + the flat ✅/⚠️/❌ scorecard. Given each case's RunOutput, run its checks, roll them up to a
// per-case verdict, and compare against the manual-eval `baseline` to surface regressions. Pure — the
// live runner produces the RunOutputs; this only judges them.

import type { EvalCase, Verdict } from './catalog/_schema';
import type { RunOutput } from './run-output';
import { score } from './scorers/index';

export interface CaseRun {
  case: EvalCase;
  run: RunOutput;
}

export interface CaseResult {
  id: string;
  category: string;
  verdict: Verdict;
  baseline?: Verdict;
  /** True when this case anchored a ✅ baseline but no longer passes — the signal that matters. */
  regressed: boolean;
  passed: number;
  total: number;
  /** Details of the checks that failed, for the scorecard's notes column. */
  failures: string[];
}

/** All pass → ✅; none pass → ❌; a partial (or a case with no checks) → ⚠️. */
export function evaluateCase({ case: c, run }: CaseRun): CaseResult {
  const results = c.checks.map((check) => score(run, check));
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const verdict: Verdict =
    total === 0 || passed < total ? (passed === 0 && total > 0 ? '❌' : '⚠️') : '✅';
  return {
    id: c.id,
    category: c.category,
    verdict,
    baseline: c.baseline,
    regressed: c.baseline === '✅' && verdict !== '✅',
    passed,
    total,
    failures: results.filter((r) => !r.pass).map((r) => r.detail),
  };
}

export interface Scorecard {
  results: CaseResult[];
  summary: { '✅': number; '⚠️': number; '❌': number; total: number };
  regressions: CaseResult[];
}

export function scorecard(runs: CaseRun[]): Scorecard {
  const results = runs.map(evaluateCase);
  const summary = { '✅': 0, '⚠️': 0, '❌': 0, total: results.length };
  for (const r of results) summary[r.verdict] += 1;
  return { results, summary, regressions: results.filter((r) => r.regressed) };
}

/** A Markdown scorecard: a per-case table, a summary line, and an explicit regressions list. */
export function renderScorecard(sc: Scorecard): string {
  const lines: string[] = [];
  lines.push('| # | Категория | Verdict | Baseline | Rgr | Бележки |');
  lines.push('|---|---|---|---|---|---|');
  sc.results.forEach((r, i) => {
    const note = r.failures.length > 0 ? r.failures.join('; ') : `${r.passed}/${r.total}`;
    lines.push(
      `| ${i + 1} | ${r.category} | ${r.verdict} | ${r.baseline ?? '—'} | ${r.regressed ? '⬇️' : ''} | ${note} |`,
    );
  });
  lines.push('');
  lines.push(
    `**Общо ${sc.summary.total}** — ✅ ${sc.summary['✅']} · ⚠️ ${sc.summary['⚠️']} · ❌ ${sc.summary['❌']}` +
      (sc.regressions.length > 0
        ? ` · **регресии: ${sc.regressions.length}** (${sc.regressions.map((r) => r.id).join(', ')})`
        : ' · без регресии'),
  );
  return lines.join('\n');
}
