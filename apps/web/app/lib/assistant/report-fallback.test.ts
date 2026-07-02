import { describe, expect, it } from 'vitest';
import {
  buildFallbackReport,
  FALLBACK_TITLE,
  guessFormat,
  humanizeColumn,
} from './report-fallback';
import type { QueryResult } from './report-schema';

describe('buildFallbackReport — server-side last-resort finalizer', () => {
  it('renders a single-row numeric result as a totals block with server-bound values', () => {
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['total_spent_eur', 'contract_count'], rows: [[250264972.88, 293]] },
    ];
    const out = buildFallbackReport(results, 'Колко похарчи Столична община през 2023 г.?');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.report.title).toBe(FALLBACK_TITLE);
      expect(out.report.question).toBe('Колко похарчи Столична община през 2023 г.?');
      expect(out.report.watermark).toBe('ai-generated');
      const block = out.report.blocks[0]!;
      expect(block.type).toBe('totals');
      if (block.type === 'totals') {
        // labels are humanized Bulgarian, not the raw SQL column names
        expect(block.items).toEqual([
          { label: 'Общо похарчено (€)', value: 250264972.88, format: 'money' },
          { label: 'Брой договори', value: 293, format: 'number' },
        ]);
      }
    }
  });

  it('renders a multi-row result as a table taken wholesale from the result', () => {
    const results: QueryResult[] = [
      {
        handle: 'R1',
        columns: ['name', 'spent_eur'],
        rows: [
          ['СОФЕКОСТРОЙ ЕАД', 91800000],
          ['СОФИНВЕСТ ЕАД', 73600000],
        ],
      },
    ];
    const out = buildFallbackReport(results, 'топ изпълнители');
    expect(out.ok).toBe(true);
    if (out.ok) {
      const block = out.report.blocks[0]!;
      expect(block.type).toBe('table');
      if (block.type === 'table') {
        expect(block.columns.map((c) => c.key)).toEqual(['name', 'spent_eur']);
        expect(block.rows).toHaveLength(2);
        expect(block.rows[0]!.cells).toEqual(['СОФЕКОСТРОЙ ЕАД', 91800000]);
      }
    }
  });

  it('renders a single text-only row as a table (no numeric totals to show)', () => {
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['name'], rows: [['СТОЛИЧНА ОБЩИНА']] },
    ];
    const out = buildFallbackReport(results, 'q');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.blocks[0]!.type).toBe('table');
  });

  it('picks the LAST non-empty result (the model’s final answer query)', () => {
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['x'], rows: [[1]] },
      { handle: 'R2', columns: ['final_eur'], rows: [[999]] },
    ];
    const out = buildFallbackReport(results, 'q');
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]!.type === 'totals') {
      expect(out.report.blocks[0].items[0]!.value).toBe(999);
    }
  });

  it('skips a trailing EMPTY result and falls back to the last one that has rows', () => {
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['spent_eur'], rows: [[500]] },
      { handle: 'R2', columns: ['x'], rows: [] }, // a refinement that returned nothing
    ];
    const out = buildFallbackReport(results, 'q');
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]!.type === 'totals') {
      expect(out.report.blocks[0].items[0]!.value).toBe(500);
    }
  });

  it('downgrades a share-named column to a number when its value is not a 0..1 ratio', () => {
    // guessFormat picks 'percent' from a „share/дял" column name; if the single-row value is actually a
    // raw sum (not a 0..1 ratio) it must not render as an absurd „…%".
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['share'], rows: [[1342360573264.6]] },
    ];
    const out = buildFallbackReport(results, 'дял с една оферта');
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]!.type === 'totals') {
      expect(out.report.blocks[0].items[0]!.format).toBe('number');
      expect(out.report.blocks[0].items[0]!.value).toBe(1342360573264.6);
    }
  });

  it('keeps percent format for a genuine 0..1 share value', () => {
    const results: QueryResult[] = [
      { handle: 'R1', columns: ['single_offer_share'], rows: [[0.318]] },
    ];
    const out = buildFallbackReport(results, 'дял с една оферта');
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]!.type === 'totals') {
      expect(out.report.blocks[0].items[0]!.format).toBe('percent');
    }
  });

  it('returns ok:false when there is nothing to summarise (no rows anywhere)', () => {
    expect(buildFallbackReport([], 'q').ok).toBe(false);
    expect(buildFallbackReport([{ handle: 'R1', columns: ['a'], rows: [] }], 'q').ok).toBe(false);
  });

  it('the fixed title carries no material number, so it can never trip the E2 gate', () => {
    // A single row whose SQL total is huge must still bind — the title is a constant, never the number.
    const results: QueryResult[] = [{ handle: 'R1', columns: ['sum_eur'], rows: [[12000000000]] }];
    const out = buildFallbackReport(results, 'общо усвоени');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.title).toBe(FALLBACK_TITLE);
  });
});

describe('guessFormat', () => {
  it('maps common column names to display formats', () => {
    expect(guessFormat('total_spent_eur')).toBe('money');
    expect(guessFormat('amount_eur')).toBe('money');
    expect(guessFormat('contract_count')).toBe('number');
    expect(guessFormat('single_offer_share')).toBe('percent');
    expect(guessFormat('signed_at')).toBe('date');
    expect(guessFormat('authority_name')).toBe('text');
  });
});

describe('humanizeColumn', () => {
  it('maps the columns the model produces to Bulgarian labels (no raw identifiers)', () => {
    expect(humanizeColumn('total_spent_eur')).toBe('Общо похарчено (€)');
    expect(humanizeColumn('contracts_count')).toBe('Брой договори');
    expect(humanizeColumn('contract_count')).toBe('Брой договори');
    expect(humanizeColumn('won_eur')).toBe('Спечелено (€)');
    expect(humanizeColumn('total_eur')).toBe('Обща стойност (€)');
    expect(humanizeColumn('authority_name')).toBe('Възложител');
    expect(humanizeColumn('bidder_name')).toBe('Изпълнител');
    expect(humanizeColumn('single_offer_share')).toBe('Дял с една оферта');
    expect(humanizeColumn('period')).toBe('Период');
    expect(humanizeColumn('year')).toBe('Година');
  });

  it('degrades an unmapped column to a de-snaked, capitalised label — never the raw identifier', () => {
    expect(humanizeColumn('some_custom_field')).toBe('Some custom field');
    expect(humanizeColumn('widget_id')).toBe('Widget');
  });
});
