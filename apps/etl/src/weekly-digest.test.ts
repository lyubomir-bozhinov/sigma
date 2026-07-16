import { priorIsoWeek as priorIsoWeekOfWeek } from '@sigma/db';
import { priorIsoWeek as priorIsoWeekFromNow } from '@sigma/report';
import { describe, expect, it } from 'vitest';
import { digestEnabled, generateWeeklyDigest, type WeeklyDigestEnv } from './weekly-digest';

// Fixed clock: a Monday, so `priorIsoWeek(now)` resolves to the FULL Mon–Sun week immediately before
// the one containing `now` — the week this cron run targets.
const NOW = new Date('2024-01-15T07:00:00Z');
const TARGET = priorIsoWeekFromNow(NOW);
const PRIOR_WEEK = priorIsoWeekOfWeek(TARGET.iso);

interface LargestRawRow {
  id: string;
  source_id: string;
  authority_id: string;
  bidder_id: string;
  bidder_name: string;
  amount_eur: number;
  signed_at: string;
}

interface TopContractRawRow {
  id: string;
  source_id: string;
  title: string;
  authority_id: string;
  authority_name: string;
  bidder_id: string;
  bidder_name: string;
  amount_eur: number;
  signed_at: string;
}

interface SectorRawRow {
  division: string | null;
  contracts: number;
  value_eur: number;
}

interface AuthorityRawRow {
  authority_id: string;
  authority_name: string;
  contracts: number;
  value_eur: number;
}

interface FakeWeekData {
  asOf: string | null;
  homeTotalEur: number;
  totalsByWeek: Record<string, number>;
  counts: { contracts: number; tenders: number };
  largest: LargestRawRow | null;
  singleBid: { single_bid: number | null; sample: number };
  topContracts: TopContractRawRow[];
  sectors: SectorRawRow[];
  authorities: AuthorityRawRow[];
  existingDigestRow: boolean;
}

interface UpsertRow {
  isoWeek: string;
  asOf: string;
  refreshedAt: string;
  status: string;
  totalEur: number;
}

// A fully-populated "happy path" week: settled, non-zero, internally consistent (largest <= total,
// delta within a plausible range).
function happyPathData(): FakeWeekData {
  return {
    asOf: '2024-01-15',
    homeTotalEur: 500_000,
    totalsByWeek: {
      [TARGET.iso]: 100_000,
      [PRIOR_WEEK]: 80_000,
    },
    counts: { contracts: 12, tenders: 10 },
    largest: {
      id: 'c1',
      source_id: '00042-2024-0001',
      authority_id: 'auth:111',
      bidder_id: 'eik:222',
      bidder_name: 'Изпълнител ЕООД',
      amount_eur: 40_000,
      signed_at: '2024-01-10',
    },
    singleBid: { single_bid: 8, sample: 22 },
    topContracts: [
      {
        id: 'c1',
        source_id: '00042-2024-0001',
        title: 'Доставка на офис консумативи',
        authority_id: 'auth:111',
        authority_name: 'Община Пример',
        bidder_id: 'eik:222',
        bidder_name: 'Изпълнител ЕООД',
        amount_eur: 40_000,
        signed_at: '2024-01-10',
      },
    ],
    sectors: [{ division: '45', contracts: 6, value_eur: 60_000 }],
    authorities: [
      {
        authority_id: 'auth:111',
        authority_name: 'Община Пример',
        contracts: 4,
        value_eur: 45_000,
      },
    ],
    existingDigestRow: false,
  };
}

function fakeWeeklyDb(data: FakeWeekData, upserts: UpsertRow[]): D1Database {
  const db = {
    prepare(sql: string) {
      if (sql.includes('as_of AS as_of')) {
        return { first: async () => ({ value_eur: data.homeTotalEur, as_of: data.asOf }) };
      }
      if (sql.includes('FROM weekly_digests WHERE iso_week')) {
        return {
          bind: (isoWeek: string) => ({
            first: async () => (data.existingDigestRow ? { iso_week: isoWeek } : null),
          }),
        };
      }
      if (sql.includes('INSERT INTO weekly_digests')) {
        return {
          bind: (
            isoWeek: string,
            asOf: string,
            refreshedAt: string,
            status: string,
            totalEur: number,
          ) => ({
            run: async () => {
              upserts.push({ isoWeek, asOf, refreshedAt, status, totalEur });
              return { success: true };
            },
          }),
        };
      }
      if (sql.includes('FROM home_totals')) {
        // reconcileWeeklyTotal's plain value_eur lookup (no bind — direct .first()).
        return { first: async () => ({ value_eur: data.homeTotalEur }) };
      }
      if (sql.trim().endsWith('LIMIT 1')) {
        return { bind: (_iso: string) => ({ first: async () => data.largest }) };
      }
      if (sql.includes('t.title')) {
        return { bind: (_iso: string) => ({ all: async () => ({ results: data.topContracts }) }) };
      }
      if (sql.includes('GROUP BY t.authority_id')) {
        return { bind: (_iso: string) => ({ all: async () => ({ results: data.authorities }) }) };
      }
      if (sql.includes('GROUP BY division')) {
        return { bind: (_iso: string) => ({ all: async () => ({ results: data.sectors }) }) };
      }
      if (sql.includes('single_bid')) {
        return { bind: (_iso: string) => ({ first: async () => data.singleBid }) };
      }
      if (sql.includes('COUNT(DISTINCT c.tender_id)')) {
        return { bind: (_iso: string) => ({ first: async () => data.counts }) };
      }
      if (sql.includes('AS total_eur')) {
        return {
          bind: (isoWeek: string) => ({
            first: async () => ({ total_eur: data.totalsByWeek[isoWeek] ?? 0 }),
          }),
        };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
  return db as unknown as D1Database;
}

interface PutCall {
  key: string;
  body: string;
  opts: unknown;
}

function fakeBucket(puts: PutCall[]): R2Bucket {
  return {
    put: async (key: string, body: string, opts?: unknown) => {
      puts.push({ key, body, opts });
      return null as unknown as R2Object;
    },
  } as unknown as R2Bucket;
}

function baseEnv(db: D1Database, bucket: R2Bucket): WeeklyDigestEnv {
  return { DB: db, REPORTS: bucket };
}

// A `generate` mock that answers BOTH call shapes the pipeline can make with the same injected fn:
// the narrative call (plain prose) and, if `needsVerification` trips (a ranking chart + real prose),
// the role-④ verifier call (strict JSON verdicts). Extracts the claim ids the verifier envelope
// actually asks about from its own prompt, so it never "misses" a claim the way a hand-written fixed
// verdict list would as the report's block set evolves.
function mockGenerate(
  narrativeMd: string,
): (input: { system: string; prompt: string }) => Promise<string> {
  return async ({ system, prompt }) => {
    if (system.includes('verification critic')) {
      const ids = [...prompt.matchAll(/^(C\d+):/gm)].map((m) => m[1]);
      return JSON.stringify({ verdicts: ids.map((id) => ({ id, verdict: 'supported' })) });
    }
    return narrativeMd;
  };
}

describe('digestEnabled (kill-switch, dispatch-layer gate)', () => {
  it('is OFF (fail-dark) when unset', () => {
    expect(digestEnabled(undefined)).toBe(false);
  });

  it('is OFF for the committed "false"', () => {
    expect(digestEnabled('false')).toBe(false);
  });

  it('is OFF for garbage input', () => {
    expect(digestEnabled('yes-please')).toBe(false);
  });

  it('is ON for "true"/"1"/"on" (case/whitespace tolerant)', () => {
    expect(digestEnabled('true')).toBe(true);
    expect(digestEnabled(' TRUE ')).toBe(true);
    expect(digestEnabled('1')).toBe(true);
    expect(digestEnabled('on')).toBe(true);
  });
});

describe('generateWeeklyDigest — gate matrix', () => {
  it('unsettled week: skips without calling generate or writing to R2', async () => {
    const data = happyPathData();
    data.asOf = '2024-01-10'; // < target.sundayIso — the week is still accumulating
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];
    let generateCalls = 0;

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async () => {
        generateCalls += 1;
        return 'never';
      },
    });

    expect(generateCalls).toBe(0);
    expect(puts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it('missing as_of: skips without calling generate or writing to R2', async () => {
    const data = happyPathData();
    data.asOf = null;
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];
    let generateCalls = 0;

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async () => {
        generateCalls += 1;
        return 'never';
      },
    });

    expect(generateCalls).toBe(0);
    expect(puts).toHaveLength(0);
  });

  it('SECURITY: zero contracts — no LLM call and no R2 put', async () => {
    const data = happyPathData();
    data.counts = { contracts: 0, tenders: 0 };
    data.totalsByWeek[TARGET.iso] = 0;
    data.largest = null;
    data.topContracts = [];
    data.sectors = [];
    data.authorities = [];
    data.singleBid = { single_bid: null, sample: 0 };
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];
    let generateCalls = 0;

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async () => {
        generateCalls += 1;
        return 'never';
      },
    });

    expect(generateCalls).toBe(0);
    expect(puts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it('sanity gate: negative total blocks publish', async () => {
    const data = happyPathData();
    data.totalsByWeek[TARGET.iso] = -1;
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];
    let generateCalls = 0;

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async () => {
        generateCalls += 1;
        return 'ok';
      },
    });

    expect(generateCalls).toBe(0);
    expect(puts).toHaveLength(0);
  });

  it('sanity gate: largest contract exceeding the weekly total blocks publish', async () => {
    const data = happyPathData();
    if (!data.largest) throw new Error('fixture missing largest');
    data.largest.amount_eur = data.totalsByWeek[TARGET.iso]! + 1;
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async () => 'ok',
    });

    expect(puts).toHaveLength(0);
  });

  it('valid path: persists a StoredReport at weeks/{iso}.json with bound numbers', async () => {
    const data = happyPathData();
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: mockGenerate(
        'Изминалата седмица бе разнообразна за обществените поръчки в страната.',
      ),
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe(`weeks/${TARGET.iso}.json`);
    const stored = JSON.parse(puts[0]!.body);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.id).toBe(TARGET.iso);
    expect(stored.report.title).toContain(TARGET.iso);
    const totalsBlock = stored.report.blocks.find((b: { type: string }) => b.type === 'totals');
    expect(totalsBlock).toBeTruthy();
    expect(totalsBlock.items[0].value).toBe(data.totalsByWeek[TARGET.iso]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.isoWeek).toBe(TARGET.iso);
    expect(upserts[0]!.status).toBe('ok');
    expect(upserts[0]!.totalEur).toBe(data.totalsByWeek[TARGET.iso]);
  });

  it('reissue: a second run for an already-written week is stamped "коригирано"', async () => {
    const data = happyPathData();
    data.existingDigestRow = true;
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: mockGenerate('Кратко резюме на седмицата.'),
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.status).toBe('коригирано');
  });

  it('narrative invalid after every regen attempt: AI-free fallback is persisted, no unbound prose numbers', async () => {
    const data = happyPathData();
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];
    let narrativeCalls = 0;

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async ({ system }: { system: string; prompt: string }) => {
        if (system.includes('verification critic')) {
          return JSON.stringify({ verdicts: [{ id: 'C0', verdict: 'supported' }] });
        }
        narrativeCalls += 1;
        // Always violates guardrail E2 (material number in prose) — every attempt must be rejected.
        return `Разходите достигнаха 5000000 лв. през седмицата.`;
      },
    });

    // Exactly MAX_NARRATIVE_ATTEMPTS narrative calls, never more.
    expect(narrativeCalls).toBe(2);
    expect(puts).toHaveLength(1);
    const stored = JSON.parse(puts[0]!.body);
    // No text block survived — the AI-free fallback carries only the deterministic data blocks plus
    // the fixed methodology callout.
    expect(stored.report.blocks.some((b: { type: string }) => b.type === 'text')).toBe(false);
    expect(stored.report.blocks.at(-1).title).toBe('Как е изчислено');
    expect(stored.provenance.model).toBe('none (ai-free fallback)');
    expect(upserts[0]!.status).toBe('fallback');

    // Re-scan every prose surface (title + callout) for a material number — the fallback report must
    // contain none (mirrors report-schema.ts's own gate, applied here as an end-to-end assertion).
    const proseNumberPattern =
      /\d{5,}|млн|млрд|хил\.?|%|\d[\d.,\s]{0,40}(?:€|лв\.?|eur|евро|лева)/iu;
    expect(proseNumberPattern.test(stored.report.title)).toBe(false);
    for (const block of stored.report.blocks) {
      if (block.type === 'text' || block.type === 'callout') {
        expect(proseNumberPattern.test(block.md ?? '')).toBe(false);
        if (block.title) expect(proseNumberPattern.test(block.title)).toBe(false);
      }
    }
  });

  it('narrative call throwing every attempt: falls back the same as a rejected narrative', async () => {
    const data = happyPathData();
    const upserts: UpsertRow[] = [];
    const puts: PutCall[] = [];

    await generateWeeklyDigest(baseEnv(fakeWeeklyDb(data, upserts), fakeBucket(puts)), {
      now: NOW,
      generate: async ({ system }: { system: string; prompt: string }) => {
        if (system.includes('verification critic')) {
          return JSON.stringify({ verdicts: [{ id: 'C0', verdict: 'supported' }] });
        }
        throw new Error('gateway timeout');
      },
    });

    expect(puts).toHaveLength(1);
    const stored = JSON.parse(puts[0]!.body);
    expect(stored.report.blocks.some((b: { type: string }) => b.type === 'text')).toBe(false);
  });
});
