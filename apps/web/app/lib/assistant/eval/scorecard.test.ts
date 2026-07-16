import { describe, expect, it } from 'vitest';
import type { ResolvedReport } from '../report-schema';
import type { EvalCase } from './catalog/_schema';
import { contentExcludes, declines, numeric } from './catalog/_schema';
import type { RunOutput } from './run-output';
import { evaluateCase, renderScorecard, scorecard, type CaseRun } from './scorecard';

function totalsReport(value: number): ResolvedReport {
  return {
    title: 'T',
    question: 'Q',
    watermark: 'ai-generated',
    blocks: [{ type: 'totals', items: [{ label: 'Общо', value, format: 'money' }] }],
  };
}
const answered = (value: number): RunOutput => ({
  report: totalsReport(value),
  declined: false,
  chunks: [],
});
const declinedRun: RunOutput = { report: null, declined: true, chunks: [] };

const kase = (over: Partial<EvalCase> & Pick<EvalCase, 'id' | 'checks'>): EvalCase => ({
  category: 'test',
  prompt: 'q',
  ...over,
});

describe('evaluateCase', () => {
  it('✅ when every check passes', () => {
    const r = evaluateCase({
      case: kase({
        id: 'a',
        checks: [numeric({ expect: 52_100_000_000, tolerancePct: 1 })],
        baseline: '✅',
      }),
      run: answered(52_100_000_000),
    });
    expect(r.verdict).toBe('✅');
    expect(r.regressed).toBe(false);
  });

  it('❌ when every check fails', () => {
    const r = evaluateCase({
      case: kase({ id: 'b', checks: [numeric({ expect: 1, tolerancePct: 1 })] }),
      run: answered(999),
    });
    expect(r.verdict).toBe('❌');
  });

  it('⚠️ on a partial pass', () => {
    const r = evaluateCase({
      case: kase({
        id: 'c',
        checks: [numeric({ expect: 5, tolerancePct: 1 }), contentExcludes('Общо')],
      }),
      run: answered(5), // numeric passes, contentExcludes fails (label „Общо" present)
    });
    expect(r.verdict).toBe('⚠️');
    expect(r.passed).toBe(1);
    expect(r.total).toBe(2);
  });

  it('flags a regression when a ✅ baseline no longer passes', () => {
    const r = evaluateCase({
      case: kase({ id: 'd', checks: [numeric({ expect: 5, tolerancePct: 1 })], baseline: '✅' }),
      run: answered(999),
    });
    expect(r.verdict).toBe('❌');
    expect(r.regressed).toBe(true);
  });

  it('does not flag a regression when the baseline was already ❌', () => {
    const r = evaluateCase({
      case: kase({ id: 'e', checks: [declines()], baseline: '❌' }),
      run: answered(1), // produced a report instead of declining → still ❌, but baseline was ❌
    });
    expect(r.verdict).toBe('❌');
    expect(r.regressed).toBe(false);
  });
});

describe('scorecard', () => {
  const runs: CaseRun[] = [
    {
      case: kase({ id: 'ok', checks: [numeric({ expect: 5, tolerancePct: 1 })], baseline: '✅' }),
      run: answered(5),
    },
    {
      case: kase({ id: 'reg', checks: [numeric({ expect: 5, tolerancePct: 1 })], baseline: '✅' }),
      run: answered(9),
    },
    { case: kase({ id: 'dec', checks: [declines()], baseline: '❌' }), run: declinedRun },
  ];

  it('summarises verdicts and collects regressions', () => {
    const sc = scorecard(runs);
    expect(sc.summary).toEqual({ '✅': 2, '⚠️': 0, '❌': 1, total: 3 });
    expect(sc.regressions.map((r) => r.id)).toEqual(['reg']);
  });

  it('renders a table with the summary and the regression id', () => {
    const md = renderScorecard(scorecard(runs));
    expect(md).toContain('✅ 2');
    expect(md).toContain('❌ 1');
    expect(md).toContain('регресии: 1');
    expect(md).toContain('reg');
  });
});
