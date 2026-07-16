import { describe, expect, it } from 'vitest';
import { isValidIsoWeek, isoWeekKey, listStoredWeeks } from './weeks';

// A single-page R2 list stub (no pagination): `list` returns these objects, not truncated.
function bucketListing(
  objects: { key: string; customMetadata?: Record<string, string> }[],
): R2Bucket {
  return {
    list: async () => ({ objects, truncated: false }),
  } as unknown as R2Bucket;
}

describe('isoWeekKey / isValidIsoWeek', () => {
  it('builds the deterministic artifact key', () => {
    expect(isoWeekKey('2026-W25')).toBe('weeks/2026-W25.json');
  });

  it('accepts a well-formed ISO week and rejects anything else', () => {
    expect(isValidIsoWeek('2026-W01')).toBe(true);
    expect(isValidIsoWeek('2026-W25')).toBe(true);
    expect(isValidIsoWeek('2026-25')).toBe(false);
    expect(isValidIsoWeek('not-a-week')).toBe(false);
    expect(isValidIsoWeek('../weeks/x')).toBe(false);
  });
});

describe('listStoredWeeks', () => {
  it('lists weeks newest-first with totals parsed from customMetadata', async () => {
    const weeks = await listStoredWeeks(
      bucketListing([
        { key: 'weeks/2026-W24.json', customMetadata: { totalEur: '1000' } },
        { key: 'weeks/2026-W26.json', customMetadata: { totalEur: '3000' } },
        { key: 'weeks/2026-W25.json', customMetadata: { totalEur: '2000' } },
      ]),
    );
    expect(weeks.map((w) => w.iso)).toEqual(['2026-W26', '2026-W25', '2026-W24']);
    expect(weeks[0].totalEur).toBe(3000);
  });

  it('ignores objects whose key is not a weekly-digest artifact', async () => {
    const weeks = await listStoredWeeks(
      bucketListing([
        { key: 'weeks/2026-W25.json', customMetadata: { totalEur: '2000' } },
        { key: 'weeks/README.txt' },
        { key: 'report/r_abc.json' },
      ]),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].iso).toBe('2026-W25');
  });

  it('yields a null total when metadata is missing or malformed', async () => {
    const weeks = await listStoredWeeks(
      bucketListing([
        { key: 'weeks/2026-W25.json' },
        { key: 'weeks/2026-W24.json', customMetadata: { totalEur: 'NaN' } },
      ]),
    );
    expect(weeks.every((w) => w.totalEur === null)).toBe(true);
  });
});
