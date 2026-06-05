// URLSearchParams ⇄ typed filter state. All list/sort/page state lives in the query string so every
// view has a shareable, reproducible address (a methodology principle). Formatting helpers live in
// @sigma/shared; this module is only about reading/writing the URL.

export const PAGE_SIZE = { contracts: 15, companies: 25, authorities: 25 } as const;

/** Parse a repeated/CSV multi-value param (`?year=2025&year=2024` or `?year=2025,2024`) to a string[]. */
export function getMulti(params: URLSearchParams, key: string): string[] {
  const all = params
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

// Canonical serialization order so the same logical state always yields the same URL string —
// good for history/bookmarks/caching. Keys not listed keep their existing relative order, appended
// after the known ones. Filter facets first, then search/sort, then the paging cursor markers.
const PARAM_ORDER = [
  'q',
  'type',
  'kind',
  'sector',
  'year',
  'procedure',
  'funding',
  'eu',
  'value',
  'authority',
  'bidder',
  'top',
  'count',
  'sort',
  'cursor',
  'page',
];

/**
 * Build a new query string from a base, overriding/removing the given keys. Drops empty values and
 * serializes params in a fixed, stable key order regardless of which control changed.
 */
export function withParams(
  base: URLSearchParams,
  overrides: Record<string, string | number | string[] | null | undefined>,
): string {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    next.delete(key);
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v) next.append(key, v);
    } else {
      next.set(key, String(value));
    }
  }
  const canonical = new URLSearchParams();
  const order = (key: string) => {
    const i = PARAM_ORDER.indexOf(key);
    return i === -1 ? PARAM_ORDER.length : i;
  };
  const keys = Array.from(new Set(Array.from(next.keys()))).sort((a, b) => order(a) - order(b));
  for (const key of keys) {
    for (const v of next.getAll(key)) if (v !== '') canonical.append(key, v);
  }
  const s = canonical.toString();
  return s ? `?${s}` : '';
}

/** A href with the `sort` swapped (and cursor/page reset — a new sort starts at page 1). */
export function sortHref(base: URLSearchParams, sort: string): string {
  return withParams(base, { sort, cursor: null, page: null });
}

export interface PageNav {
  page: number; // 1-based, for display
  pageCount: number;
  prevHref: string | null;
  nextHref: string | null;
}

/** Compute Prev/Next hrefs + page display from keyset cursors and the URL's `page` marker. */
export function pageNav(opts: {
  base: URLSearchParams;
  total: number;
  pageSize: number;
  nextCursor: string | null;
  prevCursor: string | null;
}): PageNav {
  const { base, total, pageSize, nextCursor, prevCursor } = opts;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // ?page is a display/rank marker; real data is cursor-driven. Without a cursor the rows are the
  // first page, so force page 1. Otherwise clamp to the valid range to avoid impossible "N от M".
  const page = !base.get('cursor')
    ? 1
    : Math.min(Math.max(1, Number(base.get('page') ?? '1') || 1), pageCount);
  return {
    page,
    pageCount,
    prevHref:
      page > 1 && prevCursor ? withParams(base, { cursor: prevCursor, page: page - 1 }) : null,
    nextHref: nextCursor ? withParams(base, { cursor: nextCursor, page: page + 1 }) : null,
  };
}
