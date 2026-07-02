// Deterministic temporal resolver — the fix for relative Bulgarian date phrases (issue: the weak 31B
// model resolved „тази година" / „този месец" / „предходния месец" from its STALE TRAINING PRIOR (2025)
// instead of the real clock, so „поръчките за тази година" filtered the wrong year.
//
// Design (see docs / the date-resolution design workflow):
//   - The model performs ZERO date arithmetic. This pure module resolves every relative Bulgarian phrase
//     to ABSOLUTE half-open ISO bounds from an INJECTED clock (`now` is always passed in — this module
//     never reads the wall clock, so it is fully deterministic and unit-testable at any frozen date).
//   - „now" is converted to the Europe/Sofia CIVIL date via Intl.DateTimeFormat (DST-correct, no tz
//     dependency on Workers) BEFORE any Y/M/D arithmetic — so a turn near UTC midnight anchors to the
//     correct Sofia day. All calendar arithmetic then runs on a UTC-noon anchor of that civil date, which
//     is immune to DST day-shift (arithmetic in UTC, no offset transitions at noon).
//   - Bounds are HALF-OPEN (`signed_at >= sinceIso AND signed_at < untilIso`). Half-open on the TEXT ISO
//     `signed_at` column avoids Feb/leap/time-suffix off-by-one bugs and needs no strftime. Lexicographic
//     compare is correct because signed_at is zero-padded ISO; the canonical query's GLOB well-formedness
//     guard (`substr(signed_at,1,4) GLOB '[0-9][0-9][0-9][0-9]'`) is preserved in the injected template.
//   - Current periods („тази година", „това тримесечие", „този месец") are clamped to-date (upper bound =
//     tomorrow) per the product decision „show the data until now"; fully-past periods keep their full
//     span. `recencyCaveat` flags any period recent enough that ingest lag could make it empty/partial, so
//     an empty result reads as „data not yet landed", NOT the defamatory „no procurement happened".
//   - A question with NO relative phrase (pure aggregate — „разход по година", „най-големите възложители")
//     resolves to `null`, so no spurious date filter is ever injected (the critical negative case).
//
// The resolved context is rendered into the system prompt (system-prompt.ts) as a copy-verbatim block;
// the model only classifies the phrase and copies the literal bounds.

export type TemporalGrain = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'range';

/** One resolved period: inclusive `sinceIso` .. EXCLUSIVE `untilIso`, both `YYYY-MM-DD`. */
export interface ResolvedPeriod {
  /** Stable key for provenance/tests, e.g. `this-year`. */
  key: string;
  /** Canonical Bulgarian phrase this resolves, e.g. „тази година". */
  phrase: string;
  /** Human display label, e.g. „2026", „юли 2026", „Q3 2026". */
  label: string;
  /** Inclusive lower bound `YYYY-MM-DD`. */
  sinceIso: string;
  /** EXCLUSIVE upper bound `YYYY-MM-DD`. */
  untilIso: string;
  grain: TemporalGrain;
  /** The period is recent enough that ingest lag may leave it empty/partial — disclose freshness. */
  recencyCaveat: boolean;
}

export interface TemporalContext {
  /** Sofia civil date of `now`, `YYYY-MM-DD` — the authoritative „today". */
  todayIso: string;
  /** Compact human anchor line, e.g. „година 2026, месец юли 2026, тримесечие Q3 2026". */
  anchorLabel: string;
  /** The period the question actually asks for (drives the report title/filter). */
  primary: ResolvedPeriod;
  /**
   * Pre-resolved bounds for the common phrases, ALWAYS computed from `now` — rendered as a table so the
   * model can also cover comparison questions („тази година спрямо миналата") without any arithmetic.
   */
  common: ResolvedPeriod[];
}

// Ingest lag can leave a recent period empty/partial. Any period whose (exclusive) end falls within this
// many days of „today" gets a freshness caveat so an empty result is read as „data not yet landed", not
// „no procurement". Conservative (over-disclose) by design; a fully-settled prior year (e.g. 2025 asked in
// mid-2026) falls outside it and carries no caveat.
const LAG_WINDOW_DAYS = 120;

const BG_MONTHS = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];

const pad = (n: number): string => String(n).padStart(2, '0');

/** Sofia civil (year, month 1-12, day) of an injected instant — via Intl, DST-correct, no tz dependency. */
function sofiaCivilDate(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const isoOf = (dt: Date): string =>
  `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

/** First day of month `m1` (1-based; over/underflow normalizes across years), as `YYYY-MM-01`. */
const monthStartIso = (y: number, m1: number): string =>
  isoOf(new Date(Date.UTC(y, m1 - 1, 1, 12)));

const yearStartIso = (y: number): string => `${y}-01-01`;

/** Add `n` days to an ISO date, DST-immune (UTC-noon anchor). */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoOf(dt);
}

/** Lexicographic min of two ISO dates (valid because both are zero-padded ISO). */
const minIso = (a: string, b: string): string => (a <= b ? a : b);

/** Weekday of an ISO date, Monday=0 .. Sunday=6. */
function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
}

// Parse a Bulgarian count — digits or a small set of number words. Returns null for anything unrecognized
// (the phrase then falls through unmatched, i.e. no filter is injected — safe). Word coverage is
// deliberately limited to the common cases; unknown wordings degrade to today's behavior, never a wrong
// filter.
const BG_NUMERALS: Record<string, number> = {
  един: 1,
  една: 1,
  едно: 1,
  два: 2,
  две: 2,
  три: 3,
  четири: 4,
  пет: 5,
  шест: 6,
  седем: 7,
  осем: 8,
  девет: 9,
  десет: 10,
  единадесет: 11,
  единайсет: 11,
  дванадесет: 12,
  дванайсет: 12,
  двайсет: 20,
  двадесет: 20,
  трийсет: 30,
  тридесет: 30,
  шейсет: 60,
  шестдесет: 60,
};

function parseBgCount(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  }
  return BG_NUMERALS[token] ?? null;
}

interface Anchor {
  todayIso: string;
  tomorrowIso: string;
  lagThresholdIso: string;
  y: number;
  m: number; // 1-12
}

/** Clamp a period end to „to date" (tomorrow) — so current periods show data until now. */
const clampEnd = (untilIso: string, a: Anchor): string => minIso(untilIso, a.tomorrowIso);

/** A period gets the freshness caveat when its (exclusive) end is within the ingest-lag window of today. */
const isRecent = (untilIso: string, a: Anchor): boolean => untilIso > a.lagThresholdIso;

function period(
  key: string,
  phrase: string,
  label: string,
  sinceIso: string,
  untilRawIso: string,
  grain: TemporalGrain,
  a: Anchor,
): ResolvedPeriod {
  const untilIso = clampEnd(untilRawIso, a);
  return { key, phrase, label, sinceIso, untilIso, grain, recencyCaveat: isRecent(untilIso, a) };
}

// --- Common pre-resolved periods (always computed, independent of the question) ---

function commonPeriods(a: Anchor): ResolvedPeriod[] {
  const { y, m } = a;
  const q = Math.floor((m - 1) / 3); // 0-3
  const qStartMonth = q * 3 + 1;
  const thisMondayIso = addDaysIso(a.todayIso, -isoWeekday(a.todayIso));
  return [
    period('this-year', 'тази година', String(y), yearStartIso(y), yearStartIso(y + 1), 'year', a),
    period(
      'last-year',
      'миналата година',
      String(y - 1),
      yearStartIso(y - 1),
      yearStartIso(y),
      'year',
      a,
    ),
    period(
      'this-month',
      'този месец',
      `${BG_MONTHS[m - 1]} ${y}`,
      monthStartIso(y, m),
      monthStartIso(y, m + 1),
      'month',
      a,
    ),
    period(
      'last-month',
      'миналия месец',
      `${BG_MONTHS[(m + 10) % 12]} ${m === 1 ? y - 1 : y}`,
      monthStartIso(y, m - 1),
      monthStartIso(y, m),
      'month',
      a,
    ),
    period(
      'this-quarter',
      'това тримесечие',
      `Q${q + 1} ${y}`,
      monthStartIso(y, qStartMonth),
      monthStartIso(y, qStartMonth + 3),
      'quarter',
      a,
    ),
    period(
      'last-quarter',
      'миналото тримесечие',
      `Q${((q + 3) % 4) + 1} ${qStartMonth <= 3 ? y - 1 : y}`,
      monthStartIso(y, qStartMonth - 3),
      monthStartIso(y, qStartMonth),
      'quarter',
      a,
    ),
    period(
      'this-week',
      'тази седмица',
      `седмица ${thisMondayIso}`,
      thisMondayIso,
      addDaysIso(thisMondayIso, 7),
      'week',
      a,
    ),
    period(
      'last-30-days',
      'последните 30 дни',
      `последните 30 дни`,
      addDaysIso(a.todayIso, -29),
      a.tomorrowIso,
      'day',
      a,
    ),
  ];
}

// --- Primary-phrase detection (whitelist; relative phrases win over a bare explicit year) ---

function detectPrimary(q: string, a: Anchor, common: ResolvedPeriod[]): ResolvedPeriod | null {
  const byKey = (k: string): ResolvedPeriod => common.find((p) => p.key === k)!;

  // 1. Explicit range: „между 2021 и 2023" — inclusive of BOTH endpoint years (half-open upper = year2+1).
  const range = q.match(/между\s+((?:19|20)\d{2})\s+и\s+((?:19|20)\d{2})/);
  if (range) {
    const y1 = Number(range[1]);
    const y2 = Number(range[2]);
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    return period(
      'range',
      `между ${lo} и ${hi}`,
      `${lo}–${hi}`,
      yearStartIso(lo),
      yearStartIso(hi + 1),
      'range',
      a,
    );
  }

  // 2. Rolling last-N-days: „последните 30 дни", „последните 7 дена".
  const days = q.match(/последн(?:ите|и)\s+([a-zа-я0-9]+)\s+(?:дни|дена|ден)/);
  if (days) {
    const n = parseBgCount(days[1]);
    if (n !== null && n >= 1 && n <= 366) {
      return period(
        'last-n-days',
        `последните ${n} дни`,
        `последните ${n} дни`,
        addDaysIso(a.todayIso, -(n - 1)),
        a.tomorrowIso,
        'day',
        a,
      );
    }
  }

  // 3. Trailing calendar months: „последните N месеца" — lower bound = first day of the month N-1 back.
  const months = q.match(/последн(?:ите|и)\s+([a-zа-я0-9]+)\s+(?:месец|месеца|месеци)/);
  if (months) {
    const n = parseBgCount(months[1]);
    if (n !== null && n >= 1 && n <= 60) {
      return period(
        'last-n-months',
        `последните ${n} месеца`,
        `последните ${n} месеца`,
        monthStartIso(a.y, a.m - (n - 1)),
        monthStartIso(a.y, a.m + 1),
        'month',
        a,
      );
    }
  }

  // 4. Relative year.
  if (/(?:мина|предход|изминал)[а-я]*\s+година|миналогодишн/.test(q)) return byKey('last-year');
  if (/(?:тази|таз|настоящ[а-я]*|текущ[а-я]*|тазгодишн[а-я]*)\s+година/.test(q))
    return byKey('this-year');

  // 5. Relative quarter. „последното/това/текущото тримесечие" = current quarter to date (product
  //    decision); „миналото/предходното/изминалото тримесечие" = previous quarter.
  if (/тримесечи/.test(q)) {
    if (/(?:мина|предход|изминал)[а-я]*\s+тримесечи/.test(q)) return byKey('last-quarter');
    return byKey('this-quarter');
  }

  // 6. Relative month.
  if (/(?:мина|предход|изминал)[а-я]*\s+месец/.test(q)) return byKey('last-month');
  if (/(?:този|настоящ[а-я]*|текущ[а-я]*)\s+месец/.test(q)) return byKey('this-month');

  // 7. Relative week.
  if (/(?:мина|предход|изминал)[а-я]*\s+седмиц/.test(q)) {
    const thisMondayIso = byKey('this-week').sinceIso;
    return period(
      'last-week',
      'миналата седмица',
      `седмица ${addDaysIso(thisMondayIso, -7)}`,
      addDaysIso(thisMondayIso, -7),
      thisMondayIso,
      'week',
      a,
    );
  }
  if (/(?:тази|таз|настоящ[а-я]*|текущ[а-я]*)\s+седмиц/.test(q)) return byKey('this-week');

  // 8. Single day. (Cyrillic-aware boundary — ASCII \b does not fire around Cyrillic letters.)
  if (/(?<![а-я])днес(?![а-я])/.test(q))
    return period('today', 'днес', a.todayIso, a.todayIso, a.tomorrowIso, 'day', a);
  if (/(?<![а-я])вчера(?![а-я])/.test(q)) {
    const y = addDaysIso(a.todayIso, -1);
    return period('yesterday', 'вчера', y, y, a.todayIso, 'day', a);
  }

  // 9. Explicit calendar year: „през 2023", „за 2024", or a bare 4-digit year — LAST, so a relative
  //    phrase is never shadowed by a stray year token.
  const year = q.match(/\b((?:19|20)\d{2})\b/);
  if (year) {
    const y = Number(year[1]);
    return period('explicit-year', `${y}`, `${y}`, yearStartIso(y), yearStartIso(y + 1), 'year', a);
  }

  return null;
}

/**
 * Resolve the temporal context for a question against an INJECTED clock. Returns `null` when the question
 * carries no relative/explicit period phrase — the caller then injects NO temporal block (no spurious
 * filter). `now` must always be supplied; this module never reads the wall clock.
 */
export function resolveTemporalContext(question: string, now: Date): TemporalContext | null {
  const q = (question ?? '').toLowerCase();
  if (!q.trim()) return null;

  const { y, m, d } = sofiaCivilDate(now);
  const todayIso = `${y}-${pad(m)}-${pad(d)}`;
  const a: Anchor = {
    todayIso,
    tomorrowIso: addDaysIso(todayIso, 1),
    lagThresholdIso: addDaysIso(todayIso, -LAG_WINDOW_DAYS),
    y,
    m,
  };

  const common = commonPeriods(a);
  const primary = detectPrimary(q, a, common);
  if (!primary) return null;

  const quarter = Math.floor((m - 1) / 3) + 1;
  const anchorLabel = `година ${y}, месец ${BG_MONTHS[m - 1]} ${y}, тримесечие Q${quarter} ${y}`;
  return { todayIso, anchorLabel, primary, common };
}
