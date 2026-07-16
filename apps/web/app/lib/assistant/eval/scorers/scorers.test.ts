import { describe, expect, it } from 'vitest';
import type { ResolvedBlock, ResolvedReport } from '../../report-schema';
import type { RunOutput } from '../run-output';
import {
  contentExcludes,
  contentIncludes,
  declines,
  numeric,
  reconciles,
  reportPresent,
  type Check,
} from '../catalog/_schema';
import { score } from './index';

function report(blocks: ResolvedBlock[]): ResolvedReport {
  return { title: 'Заглавие', question: 'Въпрос', blocks, watermark: 'ai-generated' };
}

function withReport(r: ResolvedReport): RunOutput {
  return { report: r, declined: false, chunks: [] };
}

const declinedRun: RunOutput = { report: null, declined: true, chunks: [] };
const erroredRun: RunOutput = { report: null, declined: false, error: { status: 500 }, chunks: [] };

const totals = (label: string, value: number): ResolvedBlock => ({
  type: 'totals',
  items: [{ label, value, format: 'money' }],
});

describe('numeric', () => {
  it('passes when a totals value is within tolerance', () => {
    const run = withReport(report([totals('Общо', 52_100_000_000)]));
    expect(score(run, numeric({ expect: 52_000_000_000, tolerancePct: 2 })).pass).toBe(true);
  });

  it('fails when the value is outside tolerance', () => {
    const run = withReport(report([totals('Общо', 42_600_000_000)]));
    expect(score(run, numeric({ expect: 20_500_000_000, tolerancePct: 5 })).pass).toBe(false);
  });

  it('matches only the item whose label contains the metric', () => {
    const run = withReport(
      report([
        {
          type: 'totals',
          items: [
            { label: 'Договори', value: 195_015, format: 'number' },
            { label: 'Възложители', value: 4_449, format: 'number' },
          ],
        },
      ]),
    );
    expect(score(run, numeric({ expect: 4_449, tolerancePct: 1, metric: 'възложител' })).pass).toBe(
      true,
    );
    expect(
      score(run, numeric({ expect: 195_015, tolerancePct: 1, metric: 'възложител' })).pass,
    ).toBe(false);
  });

  it('fails with no report (a 500 is not a right answer)', () => {
    expect(score(erroredRun, numeric({ expect: 1, tolerancePct: 10 })).pass).toBe(false);
  });
});

describe('reconciles', () => {
  it('passes when the parts sum to the total within tolerance', () => {
    const run = withReport(
      report([
        {
          type: 'bar',
          points: [
            { label: 'А', value: 4_590_000_000 },
            { label: 'Б', value: 2_350_000_000 },
          ],
          format: 'money',
        },
        totals('Общо топ-2', 6_940_000_000),
      ]),
    );
    expect(score(run, reconciles({ totalMetric: 'общо', tolerancePct: 1 })).pass).toBe(true);
  });

  it('fails when the series does not sum to the stated total', () => {
    const run = withReport(
      report([
        {
          type: 'bar',
          points: [
            { label: 'А', value: 1_000_000 },
            { label: 'Б', value: 1_000_000 },
          ],
        },
        totals('Общо', 6_940_000_000),
      ]),
    );
    expect(score(run, reconciles({ totalMetric: 'общо', tolerancePct: 1 })).pass).toBe(false);
  });

  it('fails when no total item matches', () => {
    const run = withReport(report([{ type: 'bar', points: [{ label: 'А', value: 1 }] }]));
    expect(score(run, reconciles({ totalMetric: 'няма', tolerancePct: 1 })).pass).toBe(false);
  });
});

describe('declines', () => {
  it('passes on a graceful decline', () => {
    expect(score(declinedRun, declines()).pass).toBe(true);
  });

  it('fails when a report was produced instead of declining', () => {
    expect(score(withReport(report([totals('Общо', 1)])), declines()).pass).toBe(false);
  });

  it('fails on a crash — a decline must be graceful, not a 500', () => {
    expect(score(erroredRun, declines()).pass).toBe(false);
  });
});

describe('reportPresent', () => {
  it('passes when a report is produced', () => {
    expect(score(withReport(report([totals('Общо', 1)])), reportPresent()).pass).toBe(true);
  });

  it('fails on an error (guards the Q17/Q19 500 regression)', () => {
    expect(score(erroredRun, reportPresent()).pass).toBe(false);
  });

  it('fails on a decline', () => {
    expect(score(declinedRun, reportPresent()).pass).toBe(false);
  });
});

describe('content', () => {
  const run = withReport(
    report([{ type: 'callout', title: 'Сектор 45 (Строителство)', md: 'Пътни строежи ВТ' }]),
  );

  it('contentIncludes passes when the pattern is present', () => {
    expect(score(run, contentIncludes('Строителство')).pass).toBe(true);
  });

  it('contentIncludes fails when the pattern is absent', () => {
    expect(score(run, contentIncludes('Здравеопазване')).pass).toBe(false);
  });

  it('contentExcludes passes when the pattern is absent (e.g. wrong „Сектор 31" label)', () => {
    expect(score(run, contentExcludes('Сектор 31')).pass).toBe(true);
  });

  it('contentExcludes fails when the forbidden pattern appears', () => {
    expect(score(run, contentExcludes('Сектор 45')).pass).toBe(false);
  });

  it('content checks fail with no report', () => {
    expect(score(declinedRun, contentIncludes('x')).pass).toBe(false);
    expect(score(declinedRun, contentExcludes('x')).pass).toBe(false);
  });
});

describe('dispatch', () => {
  it('handles every Check kind without falling through to assertNever', () => {
    const oneOfEach: Check[] = [
      numeric({ expect: 1, tolerancePct: 1 }),
      reconciles({ totalMetric: 'b', tolerancePct: 1 }),
      declines(),
      reportPresent(),
      contentIncludes('x'),
      contentExcludes('x'),
    ];
    for (const check of oneOfEach) {
      expect(typeof score(declinedRun, check).pass).toBe('boolean');
    }
  });
});
