// Report-content scorers — pure functions over a RunOutput (the rendered report the client saw).
//
// Each returns a CheckResult; `score` dispatches by Check.kind with an assertNever default, so adding a
// Check variant without a scorer is a compile error. Nothing here inspects SQL — the wire never carries
// it (see ../run-output.ts); these score the ANSWER.

import type { ResolvedReport } from '../../report-schema';
import type { Check } from '../catalog/_schema';
import type { RunOutput } from '../run-output';

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export type Scorer = (run: RunOutput, check: Check) => CheckResult;

function assertNever(x: never): never {
  throw new Error(`unhandled check kind: ${JSON.stringify(x)}`);
}

/** A (label, value) numeric datapoint pulled from a resolved block. */
interface NumericItem {
  label: string;
  value: number;
}

/** Parse a cell to a finite number. Report values are raw numbers; a formatted string with units
 *  („52,1 млрд") is intentionally NOT parsed — only a plain numeric literal is. */
function toNumber(v: string | number | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Every numeric datapoint the report exposes, each tagged with the label a reader would read it by. */
function numericItems(report: ResolvedReport): NumericItem[] {
  const out: NumericItem[] = [];
  for (const b of report.blocks) {
    switch (b.type) {
      case 'totals':
        for (const it of b.items) {
          const n = toNumber(it.value);
          if (n !== null) out.push({ label: it.label, value: n });
        }
        break;
      case 'facts':
        for (const it of b.items) {
          const n = toNumber(it.value);
          if (n !== null) out.push({ label: it.term, value: n });
        }
        break;
      case 'bar':
        for (const p of b.points)
          if (Number.isFinite(p.value)) out.push({ label: String(p.label ?? ''), value: p.value });
        break;
      case 'timeseries':
        for (const p of b.points)
          if (Number.isFinite(p.value)) out.push({ label: String(p.period ?? ''), value: p.value });
        break;
      case 'flows':
        for (const e of b.edges)
          if (Number.isFinite(e.valueEur))
            out.push({ label: `${e.from}→${e.to}`, value: e.valueEur });
        break;
      case 'table':
        for (const row of b.rows) {
          row.cells.forEach((c, i) => {
            const n = toNumber(c);
            if (n !== null) out.push({ label: b.columns[i]?.header ?? '', value: n });
          });
        }
        break;
      case 'text':
      case 'callout':
        break;
      default:
        assertNever(b);
    }
  }
  return out;
}

/** The report's ANSWER text — title + block prose/labels/string cells — for content checks. Deliberately
 *  EXCLUDES report.question (the echoed prompt): a content check must inspect the answer, not the ask, or
 *  contentIncludes/Excludes would match words the user typed (e.g. a prompt that names „DROP"). */
function reportText(report: ResolvedReport): string {
  const parts: string[] = [report.title];
  for (const b of report.blocks) {
    switch (b.type) {
      case 'text':
        parts.push(b.md);
        break;
      case 'callout':
        parts.push(b.title, b.md);
        break;
      case 'totals':
        for (const it of b.items) parts.push(it.label);
        break;
      case 'facts':
        for (const it of b.items) parts.push(it.term, it.sub ?? '');
        break;
      case 'table':
        for (const col of b.columns) parts.push(col.header);
        for (const row of b.rows)
          for (const c of row.cells) if (typeof c === 'string') parts.push(c);
        break;
      case 'bar':
        for (const p of b.points) if (typeof p.label === 'string') parts.push(p.label);
        break;
      case 'timeseries':
        for (const p of b.points) if (typeof p.period === 'string') parts.push(p.period);
        break;
      case 'flows':
        for (const e of b.edges) parts.push(e.from, e.to);
        break;
      default:
        assertNever(b);
    }
  }
  return parts.join('\n');
}

function noReport(run: RunOutput): string {
  return `no report (declined=${run.declined}${run.error ? `, status ${run.error.status}` : ''})`;
}

/** Numeric tolerance check. With `metric` it matches only items whose label contains it; WITHOUT `metric`
 *  it scans EVERY number in the report and passes if any is within tolerance — handy when the answer's
 *  label is unknown, but it can pass a wrong headline if an unrelated sibling number coincidentally lands
 *  in range. Prefer adding `metric` (and a tight band) once a live run reveals the real labels. */
function scoreNumeric(run: RunOutput, check: Extract<Check, { kind: 'numeric' }>): CheckResult {
  if (!run.report) return { pass: false, detail: noReport(run) };
  const metric = check.metric?.toLowerCase();
  const items = numericItems(run.report).filter(
    (it) => !metric || it.label.toLowerCase().includes(metric),
  );
  if (items.length === 0) {
    return {
      pass: false,
      detail: metric ? `no numeric item labelled ~"${check.metric}"` : 'report exposes no numbers',
    };
  }
  const tol = Math.abs(check.expect) * (check.tolerancePct / 100);
  const hit = items.find((it) => Math.abs(it.value - check.expect) <= tol);
  if (hit) {
    return {
      pass: true,
      detail: `${hit.label || 'value'}=${hit.value} within ${check.tolerancePct}% of ${check.expect}`,
    };
  }
  const closest = items.reduce((a, b) =>
    Math.abs(b.value - check.expect) < Math.abs(a.value - check.expect) ? b : a,
  );
  return {
    pass: false,
    detail: `closest ${closest.label || 'value'}=${closest.value}, expected ${check.expect} ±${check.tolerancePct}%`,
  };
}

function scoreReconciles(
  run: RunOutput,
  check: Extract<Check, { kind: 'reconciles' }>,
): CheckResult {
  if (!run.report) return { pass: false, detail: noReport(run) };
  // Parts = the series points (a top-N chart / flow / timeline); total = a labelled totals-or-facts item.
  // Sums every bar/timeseries/flows block, so a report with two unrelated series would over-sum — fine for
  // single-chart cases; scope by a series label if a multi-chart reconcile case ever appears.
  let partsSum = 0;
  let partsCount = 0;
  const totalMetric = check.totalMetric.toLowerCase();
  let total: number | null = null;
  for (const b of run.report.blocks) {
    switch (b.type) {
      case 'bar':
      case 'timeseries':
        for (const p of b.points) {
          if (!Number.isFinite(p.value)) continue; // a non-number point can't sum — never string-concat
          partsSum += p.value;
          partsCount += 1;
        }
        break;
      case 'flows':
        for (const e of b.edges) {
          if (!Number.isFinite(e.valueEur)) continue;
          partsSum += e.valueEur;
          partsCount += 1;
        }
        break;
      case 'totals':
        for (const it of b.items) {
          const n = toNumber(it.value);
          if (n !== null && total === null && it.label.toLowerCase().includes(totalMetric))
            total = n;
        }
        break;
      case 'facts':
        for (const it of b.items) {
          const n = toNumber(it.value);
          if (n !== null && total === null && it.term.toLowerCase().includes(totalMetric))
            total = n;
        }
        break;
      default:
        break;
    }
  }
  if (partsCount === 0) return { pass: false, detail: 'no series points to reconcile' };
  if (total === null)
    return { pass: false, detail: `no total item labelled ~"${check.totalMetric}"` };
  const tol = Math.abs(total) * (check.tolerancePct / 100);
  const pass = Math.abs(partsSum - total) <= tol;
  return {
    pass,
    detail: `${partsCount} parts sum ${partsSum} vs total ${total} (±${check.tolerancePct}%)`,
  };
}

function scoreDeclines(run: RunOutput): CheckResult {
  if (run.error) {
    return {
      pass: false,
      detail: `crashed (status ${run.error.status}) — a decline must be graceful`,
    };
  }
  const pass = run.declined && run.report === null;
  return {
    pass,
    detail: pass
      ? 'declined gracefully, no fabricated report'
      : 'expected a decline but a report was produced',
  };
}

function scoreReportPresent(run: RunOutput): CheckResult {
  if (run.error) return { pass: false, detail: `errored (status ${run.error.status})` };
  const pass = run.report !== null;
  return { pass, detail: pass ? 'report produced' : 'no report (declined)' };
}

function scoreContent(
  run: RunOutput,
  check: Extract<Check, { kind: 'contentIncludes' | 'contentExcludes' }>,
): CheckResult {
  if (!run.report) return { pass: false, detail: noReport(run) };
  let re: RegExp;
  try {
    re = new RegExp(check.pattern, check.flags);
  } catch {
    // A malformed pattern (repo-authored) fails the case with a clear reason, never crashes the run.
    return { pass: false, detail: `invalid regex /${check.pattern}/${check.flags ?? ''}` };
  }
  const matched = re.test(reportText(run.report));
  const want = check.kind === 'contentIncludes';
  return {
    pass: matched === want,
    detail: `/${check.pattern}/${check.flags ?? ''} ${matched ? 'matched' : 'absent'} (wanted ${want ? 'present' : 'absent'})`,
  };
}

/** Dispatch a single check. Exhaustive: a new Check kind without a case here fails to compile. */
export function score(run: RunOutput, check: Check): CheckResult {
  switch (check.kind) {
    case 'numeric':
      return scoreNumeric(run, check);
    case 'reconciles':
      return scoreReconciles(run, check);
    case 'declines':
      return scoreDeclines(run);
    case 'reportPresent':
      return scoreReportPresent(run);
    case 'contentIncludes':
    case 'contentExcludes':
      return scoreContent(run, check);
    default:
      return assertNever(check);
  }
}
