// Consumer-side helpers for the weekly digest (/weeks, /weeks/:iso). The StoredReport shape, its
// R2 read/write and the iso-week math live in `@sigma/report`; these are the digest-only bits: the
// deterministic key scheme and the R2 archive listing that backs the /weeks index.

const WEEKS_PREFIX = 'weeks/';
// Week number is 01–53 (ISO 8601 has no W00 and at most 53 weeks) — reject W00/W54–99 up front so a
// well-formed-but-impossible week 404s at validation rather than after a pointless R2 lookup.
const WEEK_NUM = '(?:0[1-9]|[1-4]\\d|5[0-3])';
const ISO_WEEK = new RegExp(`^\\d{4}-W${WEEK_NUM}$`);
const ISO_WEEK_KEY = new RegExp(`^weeks/(\\d{4}-W${WEEK_NUM})\\.json$`);

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
 * List the weeks that HAVE an artifact (spec §11: weeks without data simply do not appear). Reads the
 * total from each object's customMetadata so the archive needs no per-week fetch. Newest first
 * (ISO-week strings sort chronologically).
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
