// The catalog's anchored patterns, locked. These assert what the anchors BUY over the bare forms they
// replaced (third review round): each new pattern must reject an input the old one falsely accepted.
// reportText scores only string fields, so every fixture below puts its text in a label/period.
import { describe, expect, it } from 'vitest';
import type { ResolvedReport } from '../../report-schema';
import type { RunOutput } from '../run-output';
import { score } from '../scorers/index';
import { contentIncludes, numeric } from './_schema';

const run = (blocks: ResolvedReport['blocks']): RunOutput => ({
  report: { title: 'T', question: 'Q', watermark: 'ai-generated', blocks },
  declined: false,
  chunks: [],
});

// Kept in step with time.cases.ts / cpv.cases.ts by hand — a drift here is a failing test, not a silent
// weakening, which is the point of pinning them.
const YEAR = '(^|[^0-9])2025([^0-9]|$)';
const SECTOR = 'Сектор 45|45[^0-9]{0,3}[Сс]троителств';

describe('year token (time-spend-2020-today)', () => {
  it('matches a real year label, bare or in a range', () => {
    expect(
      score(
        run([{ type: 'timeseries', points: [{ period: '2025', value: 1 }] }]),
        contentIncludes(YEAR),
      ).pass,
    ).toBe(true);
    expect(
      score(
        run([{ type: 'bar', points: [{ label: '2020–2025', value: 1 }] }]),
        contentIncludes(YEAR),
      ).pass,
    ).toBe(true);
  });

  it('rejects a YYYYMM period that the bare „2025" accepted', () => {
    const r = run([{ type: 'timeseries', points: [{ period: '202501', value: 1 }] }]);
    expect(score(r, contentIncludes('2025')).pass).toBe(true); // the old, weaker form
    expect(score(r, contentIncludes(YEAR)).pass).toBe(false);
  });
});

describe('sector label (cpv-top-sector)', () => {
  it('matches the real sector label', () => {
    const r = run([
      { type: 'totals', items: [{ label: 'Сектор 45 (Строителство)', value: 1, format: 'money' }] },
    ]);
    expect(score(r, contentIncludes(SECTOR)).pass).toBe(true);
  });

  it('rejects an unrelated label carrying the digits, which bare „45" accepted', () => {
    const r = run([{ type: 'bar', points: [{ label: 'Обособена позиция 45/2', value: 1 }] }]);
    expect(score(r, contentIncludes('45')).pass).toBe(true); // the old, weaker form
    expect(score(r, contentIncludes(SECTOR)).pass).toBe(false);
  });
});

describe('metric anchors (headline-authorities-bidders)', () => {
  const swapped = run([
    {
      type: 'totals',
      items: [
        { label: 'Възложители', value: 17_540, format: 'number' },
        { label: 'Изпълнители', value: 4_449, format: 'number' },
      ],
    },
  ]);

  it('unanchored numerics both pass on a swapped answer — the gap that was reported', () => {
    expect(score(swapped, numeric({ expect: 4_449, tolerancePct: 3 })).pass).toBe(true);
    expect(score(swapped, numeric({ expect: 17_540, tolerancePct: 3 })).pass).toBe(true);
  });

  it('anchored numerics fail that swap and pass the correct assignment', () => {
    expect(
      score(swapped, numeric({ expect: 4_449, tolerancePct: 3, metric: 'възложител' })).pass,
    ).toBe(false);
    expect(
      score(swapped, numeric({ expect: 17_540, tolerancePct: 3, metric: 'изпълнител' })).pass,
    ).toBe(false);
    const ok = run([
      {
        type: 'totals',
        items: [
          { label: 'Възложители', value: 4_449, format: 'number' },
          { label: 'Изпълнители', value: 17_540, format: 'number' },
        ],
      },
    ]);
    expect(score(ok, numeric({ expect: 4_449, tolerancePct: 3, metric: 'възложител' })).pass).toBe(
      true,
    );
    expect(score(ok, numeric({ expect: 17_540, tolerancePct: 3, metric: 'изпълнител' })).pass).toBe(
      true,
    );
  });
});
