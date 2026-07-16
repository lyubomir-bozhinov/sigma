import { describe, expect, it } from 'vitest';
import fixtureData from './fixtures/r2-report-object.fixture.json';
import { listStoredWeeks, readStoredReport } from './stored-report';

// The committed R2 artifact fixture IS the contract between producer (#167A) and consumer (#167B).
// Reading it through readStoredReport guards against drift: if the shape changes, this test breaks.
const fixtureJson = JSON.stringify(fixtureData);

// A minimal R2Bucket stub: only `get` is exercised. `null` models an absent object.
function bucketWith(objectText: string | null): R2Bucket {
  return {
    get: async () => (objectText === null ? null : { text: async () => objectText }),
  } as unknown as R2Bucket;
}

// A single-page R2 list stub (no pagination): `list` returns these objects, not truncated.
function bucketListing(
  objects: { key: string; customMetadata?: Record<string, string> }[],
): R2Bucket {
  return {
    list: async () => ({ objects, truncated: false }),
  } as unknown as R2Bucket;
}

describe('readStoredReport', () => {
  it('parses the committed fixture into a StoredReport', async () => {
    const stored = await readStoredReport(bucketWith(fixtureJson), 'weeks/2026-W25.json');
    expect(stored).not.toBeNull();
    expect(stored!.schemaVersion).toBe(1);
    expect(stored!.id).toBe('r_8Kx2pQ7mWvN4tLbZ9aHc3Yd');
    expect(stored!.model).toBe('bggpt-gemma-3-27b-fp8');
    expect(stored!.report.watermark).toBe('ai-generated');
    expect(stored!.report.blocks).toHaveLength(4);
    expect(stored!.provenance.queries).toHaveLength(2);
    expect(stored!.provenance.freshness).toBe('D1: 2026-06-18');
  });

  it('returns null when the object is absent (→ 404)', async () => {
    const stored = await readStoredReport(bucketWith(null), 'weeks/2099-W01.json');
    expect(stored).toBeNull();
  });

  it('throws on a present-but-corrupt artifact', async () => {
    const bad = JSON.stringify({ schemaVersion: 1, id: 'x', createdAt: 'now', model: 'm' });
    await expect(readStoredReport(bucketWith(bad), 'weeks/2026-W25.json')).rejects.toThrow(
      /corrupt report artifact/,
    );
  });

  it('rejects a report missing the ai-generated watermark', async () => {
    const noMark = JSON.stringify({
      schemaVersion: 1,
      id: 'x',
      createdAt: 'now',
      model: 'm',
      report: { title: 't', question: 'q', blocks: [], watermark: 'none' },
      provenance: { question: 'q', queries: [], freshness: 'D1: x' },
    });
    await expect(readStoredReport(bucketWith(noMark), 'weeks/2026-W25.json')).rejects.toThrow(
      /corrupt report artifact/,
    );
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
