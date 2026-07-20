import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyDigestData } from '@sigma/db';
import { __resetWeeksCache, fetchWeekDigest } from './weeks-cache';

// getWeeklyDigestData is the only @sigma/db surface this layer calls that needs a real D1 — mock it so
// the D1-fallback build runs against a canned week. Everything else (@sigma/report's real
// buildDataOnlyDigest / persistReport / readStoredReport) is exercised for real against a fake bucket.
vi.mock('@sigma/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sigma/db')>()),
  getWeeklyDigestData: vi.fn(),
}));
const { getWeeklyDigestData } = await import('@sigma/db');
const mockedDigestData = vi.mocked(getWeeklyDigestData);

const daySlots = (first: number) =>
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((label, i) => ({
    dateIso: `2026-06-${String(15 + i).padStart(2, '0')}`,
    label,
    valueEur: i === 0 ? first : 0,
  }));

/** Minimal but bind-valid week: every optional block is skipped (largest null, rate null, empty lists),
 *  so the report is totals + weekbars + methodology — enough to prove the build+bind+persist path. */
function weekFixture(contracts: number): WeeklyDigestData {
  return {
    isoWeek: '2026-W25',
    total: { totalEur: 1_000_000 },
    counts: { contracts, contractsWithAmount: Math.min(contracts, 8), tenders: 7 },
    largest: null,
    singleBidRate: { rate: null, singleBid: 0, sample: 5 },
    delta: {
      isoWeek: '2026-W25',
      priorIsoWeek: '2026-W24',
      currentEur: 1_000_000,
      priorEur: 900_000,
      deltaEur: 100_000,
      deltaPct: null,
    },
    topContracts: [],
    sectors: [],
    authorities: [],
    dailySpend: { current: daySlots(1_000_000), previous: daySlots(800_000) },
  };
}

/** Map-backed R2 stub: `put` records body+opts, `get` returns an object with `.text()` (what
 *  readStoredReport reads). Spied so tests can count reads/writes. */
function fakeBucket(seed?: Record<string, string>) {
  const store = new Map<string, { body: string; opts?: unknown }>();
  if (seed) for (const [k, v] of Object.entries(seed)) store.set(k, { body: v });
  return {
    store,
    put: vi.fn(async (key: string, body: string, opts?: unknown) => {
      store.set(key, { body, opts });
    }),
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      return entry ? { text: async () => entry.body } : null;
    }),
  };
}

/** D1 stub used only by readAdminAsOf (getWeeklyDigestData is mocked) — returns a fixed as_of. */
const fakeDb = {
  prepare: () => ({ first: async () => ({ as_of: '2026-06-21' }) }),
} as unknown as D1Database;

beforeEach(() => {
  __resetWeeksCache();
  mockedDigestData.mockReset();
});

describe('fetchWeekDigest — in-memory → R2 → D1 chain', () => {
  it('serves the R2 artifact and never touches D1 when the artifact exists', async () => {
    const bucket = fakeBucket({ 'weeks/2026-W25.json': JSON.stringify(stored('from-r2')) });
    const env = { REPORTS: bucket as unknown as R2Bucket, DB: fakeDb };

    const r = await fetchWeekDigest(env, '2026-W25');
    expect(r?.report.title).toBe('from-r2');
    expect(bucket.get).toHaveBeenCalledTimes(1);
    expect(mockedDigestData).not.toHaveBeenCalled();
  });

  it('serves from the in-memory cache on the second call (no repeat R2 read)', async () => {
    const bucket = fakeBucket({ 'weeks/2026-W25.json': JSON.stringify(stored('cached')) });
    const env = { REPORTS: bucket as unknown as R2Bucket, DB: fakeDb };

    await fetchWeekDigest(env, '2026-W25');
    await fetchWeekDigest(env, '2026-W25');
    expect(bucket.get).toHaveBeenCalledTimes(1); // second call short-circuits in memory
  });

  it('falls back to a data-only D1 build, upserts it to R2 (non-immutable), and caches it', async () => {
    mockedDigestData.mockResolvedValue(weekFixture(10));
    const bucket = fakeBucket(); // empty → R2 miss
    const env = { REPORTS: bucket as unknown as R2Bucket, DB: fakeDb };

    const r = await fetchWeekDigest(env, '2026-W25');
    expect(r).not.toBeNull();
    expect(r?.provenance.model).toBe('none (ai-free fallback)');
    expect(r?.provenance.verification?.status).toBe('skipped');
    expect(mockedDigestData).toHaveBeenCalledWith(fakeDb, '2026-W25');

    // upserted to the deterministic key, and NOT immutable (a later real/corrected artifact must win).
    expect(bucket.put).toHaveBeenCalledTimes(1);
    const [key, , opts] = bucket.put.mock.calls[0]!;
    expect(key).toBe('weeks/2026-W25.json');
    expect(
      (opts as { httpMetadata?: { cacheControl?: string } }).httpMetadata?.cacheControl,
    ).toBeUndefined();

    // second call is served from memory — no second D1 build.
    await fetchWeekDigest(env, '2026-W25');
    expect(mockedDigestData).toHaveBeenCalledTimes(1);
  });

  it('returns null (→ 404) for an empty week — the zero-row guard, no artifact written', async () => {
    mockedDigestData.mockResolvedValue(weekFixture(0));
    const bucket = fakeBucket();
    const env = { REPORTS: bucket as unknown as R2Bucket, DB: fakeDb };

    const r = await fetchWeekDigest(env, '2099-W01');
    expect(r).toBeNull();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('builds from D1 even with no REPORTS binding (no upsert to attempt)', async () => {
    mockedDigestData.mockResolvedValue(weekFixture(10));
    const r = await fetchWeekDigest({ DB: fakeDb }, '2026-W25');
    expect(r?.report.title).toBe('Седмичен обзор — 2026-W25');
  });

  it('returns null when nothing is provisioned (no REPORTS, no DB)', async () => {
    expect(await fetchWeekDigest({}, '2026-W25')).toBeNull();
  });

  it('treats an R2 read error as a miss and falls through to D1', async () => {
    mockedDigestData.mockResolvedValue(weekFixture(10));
    const bucket = fakeBucket();
    bucket.get = vi.fn(async () => {
      throw new Error('R2 down');
    });
    const env = { REPORTS: bucket as unknown as R2Bucket, DB: fakeDb };
    const r = await fetchWeekDigest(env, '2026-W25');
    expect(r).not.toBeNull();
    expect(mockedDigestData).toHaveBeenCalledOnce();
  });
});

/** A tiny valid StoredReport whose title we can assert on (for the R2-hit paths). */
function stored(title: string) {
  return {
    schemaVersion: 1,
    id: '2026-W25',
    createdAt: '2026-06-22T07:00:00.000Z',
    report: { title, question: 'q', watermark: 'ai-generated', blocks: [] },
    provenance: {
      question: 'q',
      sources: [],
      snapshot: [],
      freshness: [{ source: 'admin', asOf: '2026-06-21' }],
      model: 'm',
      promptVersion: 'v1',
    },
  };
}
