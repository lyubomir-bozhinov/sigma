import { describe, expect, it } from 'vitest';
import { bindReport, sanitizeProse, type EmitReportInput, type QueryResult } from './report-schema';

const results: QueryResult[] = [
  {
    handle: 'R1',
    columns: ['authority', 'authority_id', 'spent_eur'],
    rows: [
      ['Министерство на финансите', 'auth:000695089', 1234567],
      ['Община Пловдив', 'auth:000471504', 890000],
    ],
  },
  {
    handle: 'R2',
    columns: ['total_eur'],
    rows: [[2124567]],
  },
];

function emit(blocks: EmitReportInput['blocks']): EmitReportInput {
  return { title: 'Топ възложители', question: 'кои са най-големите възложители?', blocks };
}

describe('bindReport — server owns the values', () => {
  it('binds totals/facts from the result set, not from the model', () => {
    const out = bindReport(
      emit([
        {
          type: 'totals',
          items: [
            { label: 'Общо', ref: { resultId: 'R2', row: 0, col: 'total_eur' }, format: 'money' },
          ],
        },
      ]),
      results,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const t = out.report.blocks[0];
      expect(t).toEqual({
        type: 'totals',
        items: [{ label: 'Общо', value: 2124567, format: 'money' }],
      });
    }
  });

  it('takes table rows wholesale from the referenced result (model cannot inject rows)', () => {
    const out = bindReport(
      emit([
        {
          type: 'table',
          resultId: 'R1',
          columns: [
            {
              key: 'authority',
              header: 'Институция',
              format: 'text',
              link: { kind: 'authority', idCol: 'authority_id' },
            },
            { key: 'spent_eur', header: 'Похарчено (€)', align: 'right', format: 'money' },
          ],
        },
      ]),
      results,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]?.type === 'table') {
      const rows = out.report.blocks[0].rows;
      expect(rows).toHaveLength(2); // exactly the result rows — no more, no fewer
      expect(rows[0]!.cells).toEqual(['Министерство на финансите', 1234567]);
    }
  });

  it('rejects a dangling result handle', () => {
    const out = bindReport(
      emit([
        {
          type: 'totals',
          items: [
            { label: 'x', ref: { resultId: 'R9', row: 0, col: 'total_eur' }, format: 'money' },
          ],
        },
      ]),
      results,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[0]).toMatch(/unknown result handle "R9"/);
  });

  it('rejects an unknown column and an out-of-range row', () => {
    const bad = bindReport(
      emit([
        { type: 'facts', items: [{ term: 'x', ref: { resultId: 'R1', row: 0, col: 'nope' } }] },
      ]),
      results,
    );
    expect(bad.ok).toBe(false);
    const oor = bindReport(
      emit([
        {
          type: 'facts',
          items: [{ term: 'x', ref: { resultId: 'R1', row: 99, col: 'spent_eur' } }],
        },
      ]),
      results,
    );
    expect(oor.ok).toBe(false);
    if (!oor.ok) expect(oor.errors[0]).toMatch(/row 99 out of range/);
  });

  it('computes bar points from result values (renderer owns shares/colours)', () => {
    const out = bindReport(
      emit([{ type: 'bar', resultId: 'R1', labelCol: 'authority', valueCol: 'spent_eur' }]),
      results,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]?.type === 'bar') {
      expect(out.report.blocks[0].points).toEqual([
        { label: 'Министерство на финансите', value: 1234567 },
        { label: 'Община Пловдив', value: 890000 },
      ]);
    }
  });

  it('always stamps the AI-generated watermark and echoes the question', () => {
    const out = bindReport(emit([{ type: 'text', md: 'Ето резултатите.' }]), results);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.report.watermark).toBe('ai-generated');
      expect(out.report.question).toBe('кои са най-големите възложители?');
    }
  });
});

describe('sanitizeProse — no raw HTML reaches a public report', () => {
  it('strips tags from text/callout prose', () => {
    expect(sanitizeProse('Здравей <script>alert(1)</script> свят')).toBe('Здравей alert(1) свят');
    const out = bindReport(
      emit([{ type: 'callout', title: '<b>Бележка</b>', md: 'виж <img src=x onerror=y> тук' }]),
      results,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.report.blocks[0]?.type === 'callout') {
      expect(out.report.blocks[0].title).toBe('Бележка');
      expect(out.report.blocks[0].md).toBe('виж  тук');
    }
  });
});
