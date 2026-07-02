// Server-side last-resort report finalizer.
//
// The weak chat model sometimes gathers real data (one or more run_sql results) but never produces a
// VALID emit_report within the step budget — it puts a number in prose (correctly gated), gets the block
// shape wrong, or simply runs out of steps. The turn then dead-ends on „Справката не можа да бъде
// съставена" even though the answer is sitting in `ctx.results`. This module synthesizes a minimal,
// SERVER-OWNED report from those results so the turn always finalizes with the real figures.
//
// Integrity is preserved end-to-end: the blocks are authored here but bound through the SAME `bindReport`
// path as a model-emitted report — every value still references a server-executed result handle, never a
// model-written literal (spec §9.1). Only the block scaffolding (which column → which block) is chosen by
// this code, from the result's own shape.

import {
  bindReport,
  type BindResult,
  type CellFormat,
  type EmitBlock,
  type QueryResult,
} from './report-schema';

// A fixed, number-free title so the fallback can NEVER trip the material-number title gate (E2) — a
// fallback that could fail its own validation would defeat the purpose. The question is shown verbatim
// beneath it (server-authoritative), so the report still reads in context.
export const FALLBACK_TITLE = 'Справка по наличните данни';

// Guess a display format from a column name, mirroring how the model picks one so the fallback reads like
// a normal report. Unknown → text (safe; the renderer shows the raw cell).
export function guessFormat(col: string): CellFormat {
  const c = col.toLowerCase();
  if (/(eur|amount|sum|spent|won|total|paid|стойност|похарчен|сума|разход)/.test(c)) return 'money';
  if (/(share|ratio|dial|дял|percent|процент|pct)/.test(c)) return 'percent';
  if (/(count|contracts|number|броя?|договор|бр_)/.test(c)) return 'number';
  if (/(date|signed|period|year|month|дата|период|година|месец)/.test(c)) return 'date';
  return 'text';
}

/** True when every value in column `i` across all rows is numeric (or null) — safe for a `totals` item. */
function isNumericColumn(result: QueryResult, i: number): boolean {
  return result.rows.every((row) => row[i] === null || typeof row[i] === 'number');
}

/**
 * Build a minimal report from THIS turn's results, or `{ ok: false }` when there is nothing to summarise
 * (no result carried any rows). Picks the LAST non-empty result — the model's final query is normally the
 * answer — and renders it as:
 *   - a `totals` block, when the result is a single row with ≥1 numeric column (the „one number" answer),
 *   - otherwise a `table` of the whole result (rankings, breakdowns, timeseries).
 * `question` is passed as the server-authoritative displayed question (not gated, not echoed by the model).
 */
export function buildFallbackReport(results: QueryResult[], question: string): BindResult {
  const last = [...results].reverse().find((r) => r.rows.length > 0);
  if (!last) return { ok: false, errors: ['no results to summarise'] };

  let blocks: EmitBlock[];
  const totalsItems =
    last.rows.length === 1
      ? last.columns.flatMap((col, i) =>
          isNumericColumn(last, i)
            ? [
                {
                  label: col,
                  ref: { resultId: last.handle, row: 0, col },
                  format: guessFormat(col),
                },
              ]
            : [],
        )
      : [];

  if (totalsItems.length > 0) {
    blocks = [{ type: 'totals', items: totalsItems }];
  } else {
    blocks = [
      {
        type: 'table',
        resultId: last.handle,
        columns: last.columns.map((col) => ({ key: col, header: col, format: guessFormat(col) })),
      },
    ];
  }

  return bindReport({ title: FALLBACK_TITLE, question, blocks }, results, { question });
}
