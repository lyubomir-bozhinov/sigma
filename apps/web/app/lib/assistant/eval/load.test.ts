import { describe, expect, it } from 'vitest';
import type { CaseDef } from './catalog/_schema';
import { numeric } from './catalog/_schema';
import { assembleCases, categoryOf } from './load';

const geo: CaseDef[] = [
  { id: 'geo-1', prompt: 'q1', checks: [numeric({ expect: 1, tolerancePct: 1 })] },
  { id: 'geo-2', prompt: 'q2', checks: [] },
];
const cpv: CaseDef[] = [{ id: 'cpv-1', prompt: 'q3', checks: [] }];

describe('assembleCases', () => {
  it('flattens groups and stamps the category from the group', () => {
    const cases = assembleCases([
      { category: 'geo', defs: geo },
      { category: 'cpv', defs: cpv },
    ]);
    expect(cases.map((c) => [c.id, c.category])).toEqual([
      ['geo-1', 'geo'],
      ['geo-2', 'geo'],
      ['cpv-1', 'cpv'],
    ]);
  });

  it('throws on a duplicate id across the whole corpus', () => {
    expect(() =>
      assembleCases([
        { category: 'geo', defs: [{ id: 'dup', prompt: 'a', checks: [] }] },
        { category: 'cpv', defs: [{ id: 'dup', prompt: 'b', checks: [] }] },
      ]),
    ).toThrowError('duplicate eval case id: dup');
  });

  it('preserves case fields verbatim while adding category', () => {
    const [only] = assembleCases([
      {
        category: 'honesty',
        defs: [{ id: 'h1', prompt: 'p', checks: [], baseline: 'fail', knownLimitation: 'annexes' }],
      },
    ]);
    expect(only).toEqual({
      id: 'h1',
      prompt: 'p',
      checks: [],
      baseline: 'fail',
      knownLimitation: 'annexes',
      category: 'honesty',
    });
  });
});

describe('categoryOf', () => {
  it('takes the stem of a catalog filename', () => {
    expect(categoryOf('geo.cases.ts')).toBe('geo');
    expect(categoryOf('topn-reconcile.cases.ts')).toBe('topn-reconcile');
  });

  it('skips underscore-prefixed and non-catalog files', () => {
    expect(categoryOf('_schema.ts')).toBe(null);
    expect(categoryOf('_template.cases.ts')).toBe(null);
    expect(categoryOf('load.ts')).toBe(null);
  });
});
