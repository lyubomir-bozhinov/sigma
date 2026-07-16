// The immutable R2 artifact a report is persisted as, and the read side of that contract.
//
// INTERIM (ticket #167B, soft-dep on #167A / plan Phase 1): `persistReport` + the canonical type will
// move to the shared `@sigma/report` package when the producer extraction lands. This module mirrors
// the agreed shape EXACTLY as captured in `fixtures/r2-report-object.fixture.json` so the consumer
// (the /weeks routes + ReportBlockRenderer) can be built and tested now against the fixture, then swap
// this import for `@sigma/report` with no call-site changes. Read-only here: the digest cron (ETL)
// owns the write path.

import type { ResolvedReport } from './report-schema';

/** One executed query behind the report — kept for audit + so the SSR path never re-queries D1 (§6). */
export interface StoredQuery {
  handle: string; // "R1" — matches the QueryResult handle the blocks referenced
  sql: string;
  rows: number; // row count the query returned (snapshot size), for audit
}

/** Provenance travels with the artifact so a served report is fully self-describing (spec §6, §11). */
export interface StoredProvenance {
  question: string;
  queries: StoredQuery[];
  freshness: string; // e.g. "D1: 2026-06-18" — the as_of the numbers were computed against
}

/** The persisted, immutable report artifact. `report` is server-authoritative; nothing here is model-writable at serve time. */
export interface StoredReport {
  schemaVersion: number;
  id: string;
  createdAt: string; // ISO 8601
  model: string; // the LLM that authored the narrative, shown in the watermark (§7)
  report: ResolvedReport;
  provenance: StoredProvenance;
  // Set ONLY when a settled period was re-issued with corrected/late data (§10.4). Its presence drives
  // the „коригирано" note; absent on a first, clean publish.
  refreshedAt?: string;
}

// ── Deterministic R2 key scheme for weekly digests (spec §6, §11) ────────────────────────────────
const WEEKS_PREFIX = 'weeks/';
const ISO_WEEK = /^\d{4}-W\d{2}$/;
const ISO_WEEK_KEY = /^weeks\/(\d{4}-W\d{2})\.json$/;

/** `2026-W25` → `weeks/2026-W25.json`, the immutable artifact's addressable key. */
export function isoWeekKey(iso: string): string {
  return `${WEEKS_PREFIX}${iso}.json`;
}

/** Reject a malformed `:iso` route param before any R2 read (→ 404). */
export function isValidIsoWeek(iso: string): boolean {
  return ISO_WEEK.test(iso);
}

/** One archive-index row for `/weeks`: the week and its total spend (for the sparkline), if published. */
export interface WeekIndexEntry {
  iso: string;
  totalEur: number | null;
}

/**
 * List the weeks that HAVE an artifact (spec §11: weeks without data simply do not appear). Interim
 * source: R2 LIST under `weeks/`, reading the total from each object's customMetadata so the archive
 * needs no per-week fetch. When #167A's `weekly_digests` D1 index lands, swap this for that cheaper
 * query — the route consumes the same `WeekIndexEntry[]`. Newest first (ISO-week strings sort
 * chronologically).
 */
export async function listStoredWeeks(bucket: R2Bucket): Promise<WeekIndexEntry[]> {
  const out: WeekIndexEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: WEEKS_PREFIX, include: ['customMetadata'], cursor });
    for (const o of page.objects) {
      const m = ISO_WEEK_KEY.exec(o.key);
      if (!m) continue;
      const raw = o.customMetadata?.totalEur;
      const total = raw != null && /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
      out.push({ iso: m[1]!, totalEur: total });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
}

// A shape-guard, not a schema validator: a corrupt/legacy artifact must not render as a half-report.
// Kept deliberately shallow — the write path (ETL) is authoritative; this only rejects obvious garbage.
function isStoredReport(v: unknown): v is StoredReport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const report = o.report as Record<string, unknown> | undefined;
  return (
    typeof o.schemaVersion === 'number' &&
    typeof o.id === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.model === 'string' &&
    typeof report === 'object' &&
    report !== null &&
    Array.isArray(report.blocks) &&
    report.watermark === 'ai-generated'
  );
}

/**
 * Read a persisted report artifact from R2 by its deterministic key (e.g. `weeks/2026-W25.json`).
 * Returns `null` when the object is ABSENT — the caller turns that into a 404 (week without data or
 * not yet settled, spec §11). A present-but-corrupt object throws, since that is a server fault, not a
 * "no such week". No D1, no LLM — the SSR path only reads this artifact (spec §6).
 */
export async function readStoredReport(
  bucket: R2Bucket,
  key: string,
): Promise<StoredReport | null> {
  const obj = await bucket.get(key);
  if (obj === null) return null;
  const parsed: unknown = JSON.parse(await obj.text());
  if (!isStoredReport(parsed)) {
    throw new Error(`corrupt report artifact at "${key}": does not match StoredReport shape`);
  }
  return parsed;
}
