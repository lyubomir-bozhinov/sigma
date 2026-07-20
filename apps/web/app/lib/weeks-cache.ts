// In-memory-first fetch layer for the weekly digest detail page (/weeks/:iso).
//
// Order of resolution (spec: keep data in memory; when a week has no record, fall through to the DB):
//   1. in-memory (per-isolate) cache        → serve immediately, no I/O
//   2. the immutable R2 artifact             → the real source, written by the ETL cron or the seed
//                                              script; cache it and serve
//   3. build a data-only digest from D1      → fallback so the page renders before any artifact exists;
//                                              upsert it back to R2 and cache it
//   4. null                                  → the loader turns this into a 404
//
// Step 3 reuses the SAME deterministic builders the cron producer uses (`buildDataOnlyDigest`,
// `@sigma/report`), so an on-the-fly digest is byte-for-byte the block layout a settled artifact would
// carry — minus the LLM narrative (this path never calls a model). It is gated on `contracts > 0`, the
// producer's security-critical zero-row guard, so an empty week is a 404, never a hollow report.

import { getWeeklyDigestData } from '@sigma/db';
import {
  buildDataOnlyDigest,
  persistReport,
  readStoredReport,
  type StoredReport,
} from '@sigma/report';
import { isoWeekKey } from './weeks';

/** The bindings this layer touches. Both are optional — a missing binding degrades to the next source
 *  (or a 404), never a 500, mirroring the /reports and /weeks "not yet provisioned → 404" posture. */
export interface WeeksCacheEnv {
  REPORTS?: R2Bucket;
  DB?: D1Database;
}

// Per-isolate front cache. Cloudflare module-global state lives only within a warm isolate (not shared
// across isolates, evicted at the runtime's discretion) — exactly the semantics of a best-effort
// request-coalescing cache. Bounded so a long-lived isolate serving many weeks cannot grow without
// limit; simple insertion-order LRU (Map preserves insertion order).
const MEM_MAX = 64;
const memory = new Map<string, StoredReport>();

function memGet(iso: string): StoredReport | null {
  const hit = memory.get(iso);
  if (!hit) return null;
  memory.delete(iso);
  memory.set(iso, hit); // touch → most-recently-used
  return hit;
}

function memSet(iso: string, report: StoredReport): void {
  memory.delete(iso);
  memory.set(iso, report);
  while (memory.size > MEM_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** Test-only: clear the module cache so cache-hit vs source-fetch behaviour is deterministic. */
export function __resetWeeksCache(): void {
  memory.clear();
}

/**
 * Resolve the StoredReport for an ISO week, in-memory-first with an R2 → D1 fallback chain.
 * `iso` must already be validated by the caller (`isValidIsoWeek`) — this reads it into an R2 key.
 */
export async function fetchWeekDigest(
  env: WeeksCacheEnv,
  iso: string,
): Promise<StoredReport | null> {
  const cached = memGet(iso);
  if (cached) return cached;

  // Source 1 — the immutable R2 artifact (the real, authoritative digest written by the ETL/seed).
  if (env.REPORTS) {
    let stored: StoredReport | null = null;
    try {
      stored = await readStoredReport(env.REPORTS, isoWeekKey(iso));
    } catch {
      stored = null; // treat an R2 read error as a miss and fall through to D1
    }
    if (stored) {
      memSet(iso, stored);
      return stored;
    }
  }

  // Source 2 — no artifact yet: build a data-only digest straight from D1 so the page renders before
  // the producer/seed has run. Upsert it to R2 (non-immutable) so later requests — including other
  // isolates — are served from the artifact, then cache it in memory.
  if (env.DB) {
    let built: StoredReport | null = null;
    try {
      const data = await getWeeklyDigestData(env.DB, iso);
      if (data.counts.contracts > 0) {
        const asOf = await readAdminAsOf(env.DB);
        built = buildDataOnlyDigest(data, { createdAt: new Date().toISOString(), asOf });
      }
    } catch {
      built = null; // D1 unavailable / not migrated → no fallback, 404
    }
    if (built) {
      memSet(iso, built);
      if (env.REPORTS) {
        // immutable:false is deliberate — a later corrected or LLM-authored artifact must be able to
        // overwrite this key and propagate. persistReport's `immutable` flag only sets a year-long
        // cache-control header; the write itself is an unconditional put either way.
        try {
          await persistReport(env.REPORTS, isoWeekKey(iso), built, { immutable: false });
        } catch {
          /* best-effort cache warm — a failed upsert must not fail the request */
        }
      }
      return built;
    }
  }

  return null;
}

/** The admin data-settlement date (`home_totals.as_of`), used as the digest's freshness date. Returns
 *  null on any error so a fallback build still succeeds (freshness then defaults to the build time). */
async function readAdminAsOf(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare('SELECT as_of AS as_of FROM home_totals WHERE id = 1')
      .first<{ as_of: string | null }>();
    return row?.as_of ?? null;
  } catch {
    return null;
  }
}
