import { describe, it, expect } from 'vitest';
import {
  buildDedupRequest,
  canonicalFilterContext,
  hasUnresolvedRelativeDate,
  type PeriodBounds,
} from './dedup-request';

const FRESH = 'd:2026070412|c:build9';
const JULY: PeriodBounds = { sinceIso: '2026-07-01', untilIso: '2026-08-01' };
const AUG: PeriodBounds = { sinceIso: '2026-08-01', untilIso: '2026-09-01' };

describe('hasUnresolvedRelativeDate', () => {
  it('is false when temporal resolved, regardless of wording', () => {
    expect(hasUnresolvedRelativeDate('поръчките този месец', true)).toBe(false);
  });

  it('is true when a period word is present but nothing resolved', () => {
    // The resolver failed to pin these to absolute bounds → L1 keying on the text alone is unsafe (#97).
    // 'последните сто дни' is the strict-review repro: temporal.ts matches the rolling-days shape but
    // parseBgCount('сто') is null → returns null → the `дни` stem must still flag it unsafe.
    for (const q of [
      'преди няколко месеца',
      'ланшната година',
      'тази седмица май',
      'днес-утре',
      'последните сто дни',
      'резултати за днешния ден',
    ]) {
      expect(hasUnresolvedRelativeDate(q, false)).toBe(true);
    }
  });

  it('is false for a non-temporal question with nothing resolved', () => {
    for (const q of ['кой е този възложител', 'най-големите доставчици', 'разход по CPV']) {
      expect(hasUnresolvedRelativeDate(q, false)).toBe(false);
    }
  });
});

describe('canonicalFilterContext', () => {
  it('folds resolved period bounds (not the phrase)', () => {
    expect(canonicalFilterContext(JULY, undefined)).toBe('p:2026-07-01..2026-08-01');
  });

  it('distinguishes two periods for the same question — the concrete #97 fix', () => {
    expect(canonicalFilterContext(JULY, undefined)).not.toBe(
      canonicalFilterContext(AUG, undefined),
    );
  });

  it('appends and trims an FE filter', () => {
    expect(canonicalFilterContext(JULY, '  възложител=Х ')).toBe(
      'p:2026-07-01..2026-08-01|f:възложител=Х',
    );
    expect(canonicalFilterContext(undefined, 'сектор=строителство')).toBe('f:сектор=строителство');
  });

  it('is empty when neither is present', () => {
    expect(canonicalFilterContext(undefined, undefined)).toBe('');
    expect(canonicalFilterContext(undefined, '   ')).toBe('');
  });
});

describe('buildDedupRequest', () => {
  it('L0 only from clientRequestId when there is no prompt', () => {
    const r = buildDedupRequest({
      clientRequestId: 'req-abc_1',
      prompt: '   ',
      temporalResolved: false,
      freshness: FRESH,
    });
    expect(r.signals).toEqual({ clientRequestId: 'req-abc_1' });
    expect(r.payloads).toEqual([{ layer: 'L0', clientRequestId: 'req-abc_1' }]);
    expect(r.doName).toBe(`L0|${FRESH}|req-abc_1`);
  });

  it('L1 folds the resolved bounds; signals + record payload agree; DO keyed on L1', () => {
    const r = buildDedupRequest({
      prompt: 'разходи този месец',
      temporalResolved: true,
      period: JULY,
      freshness: FRESH,
    });
    expect(r.signals).toEqual({
      prompt: 'разходи този месец',
      filterContext: 'p:2026-07-01..2026-08-01',
    });
    expect(r.payloads).toEqual([
      { layer: 'L1', prompt: 'разходи този месец', filterContext: 'p:2026-07-01..2026-08-01' },
    ]);
    expect(r.doName).toBe(`L1|${FRESH}|разходи този месец|p:2026-07-01..2026-08-01`);
  });

  it('carries both L0 and L1; DO prefers the stronger L1 key', () => {
    const r = buildDedupRequest({
      clientRequestId: 'req-1',
      prompt: 'най-големите възложители',
      temporalResolved: false, // non-temporal question → L1 safe with empty context
      freshness: FRESH,
    });
    expect(r.payloads).toEqual([
      { layer: 'L0', clientRequestId: 'req-1' },
      { layer: 'L1', prompt: 'най-големите възложители', filterContext: '' },
    ]);
    expect(r.signals).toEqual({
      clientRequestId: 'req-1',
      prompt: 'най-големите възложители',
      filterContext: '',
    });
    expect(r.doName).toBe(`L1|${FRESH}|най-големите възложители|`);
  });

  it('skips L1 for an unresolved relative date, falling back to the L0 key', () => {
    const r = buildDedupRequest({
      clientRequestId: 'req-2',
      prompt: 'какво стана преди няколко месеца',
      temporalResolved: false,
      freshness: FRESH,
    });
    expect(r.payloads).toEqual([{ layer: 'L0', clientRequestId: 'req-2' }]);
    expect(r.signals.prompt).toBeUndefined();
    expect(r.doName).toBe(`L0|${FRESH}|req-2`);
  });

  it('skips dedup entirely when L1 is unsafe and there is no L0 key', () => {
    const r = buildDedupRequest({
      prompt: 'разходите тази седмица',
      temporalResolved: false, // relative but unresolved, no clientRequestId
      freshness: FRESH,
    });
    expect(r.payloads).toEqual([]);
    expect(r.signals).toEqual({});
    expect(r.doName).toBeNull();
  });

  it('DO key normalises whitespace so trivially-different phrasings collapse', () => {
    const a = buildDedupRequest({
      prompt: 'най-големите   възложители',
      temporalResolved: false,
      freshness: FRESH,
    });
    const b = buildDedupRequest({
      prompt: '  най-големите възложители  ',
      temporalResolved: false,
      freshness: FRESH,
    });
    expect(a.doName).toBe(b.doName);
  });

  it('DO key normalises the filterContext too, so whitespace-variant filters collapse', () => {
    const withDoubleSpace = buildDedupRequest({
      prompt: 'разходи',
      temporalResolved: true,
      period: JULY,
      filterContext: 'сектор  =  строителство',
      freshness: FRESH,
    });
    const withSingleSpace = buildDedupRequest({
      prompt: 'разходи',
      temporalResolved: true,
      period: JULY,
      filterContext: 'сектор = строителство',
      freshness: FRESH,
    });
    expect(withDoubleSpace.doName).toBe(withSingleSpace.doName);
  });

  it('folds an FE filterContext into L1 alongside the period', () => {
    const r = buildDedupRequest({
      prompt: 'разходи този месец',
      temporalResolved: true,
      period: JULY,
      filterContext: 'сектор=здравеопазване',
      freshness: FRESH,
    });
    expect(r.signals.filterContext).toBe('p:2026-07-01..2026-08-01|f:сектор=здравеопазване');
  });

  it('DO name is INJECTIVE — a `|` in the prompt cannot alias the prompt/context boundary', () => {
    // Pre-fix these two DIFFERENT questions collided onto ONE DO instance: the raw `${prompt}|${context}`
    // join is identical whether the `|` ends the prompt or starts the folded context. On a concurrent miss
    // the second request (a waiter) would then be woken with the first's DIFFERENT report. The escaped join
    // must keep the DO names distinct. (KV lookup was already injective via encodeFields; this closes the
    // single-flight routing key to match.)
    const a = buildDedupRequest({
      prompt: 'x',
      temporalResolved: true,
      period: JULY, // folds context → 'p:2026-07-01..2026-08-01|f:sector=z'
      filterContext: 'sector=z',
      freshness: FRESH,
    });
    const b = buildDedupRequest({
      prompt: 'x|p:2026-07-01..2026-08-01', // the `|` shifted into the prompt
      temporalResolved: false,
      filterContext: 'sector=z',
      freshness: FRESH,
    });
    expect(a.doName).not.toBe(b.doName);
  });
});
