// Pure request-shaping for the report dedup lane (F): turn one chat turn's identity + resolved temporal
// bounds into the dedup signals, the record payloads, and a stable single-flight key. Kept out of the
// route so the #97-critical decisions — fold the RESOLVED period bounds into L1, and skip L1 when a
// relative date phrase is unresolved — are unit-testable without the Worker/DO harness.

import { normalizeText, type DedupPayload, type ResolveSignals } from './dedup';

/**
 * Escape the single-flight DO-name field delimiter so distinct (prompt, filterContext) tuples can never
 * alias one DO instance. `\`→`\\` then `|`→`\|` is a classic reversible (hence injective) escaping: an
 * escaped field contains no bare `|`, so the `|` field separators stay unambiguous. Cheap synchronous
 * parity with the KV key's length-prefixed encodeFields, sufficient for a DO name (no hash needed).
 */
const escapeDoField = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** Minimal structural view of a resolved period — `sinceIso`..`untilIso` (half-open), both YYYY-MM-DD. */
export interface PeriodBounds {
  sinceIso: string;
  untilIso: string;
}

// Period nouns / day words. If the question contains one but temporal.ts did NOT resolve it to absolute
// bounds, L1 caching (keyed on prompt text) is unsafe: the same wording asked across a period boundary
// within ONE data-freshness epoch could serve the wrong period (#97). We then skip L1 (keep L0). Broad by
// intent — a false positive only costs a dedup miss (regenerate), never a wrong answer (fail toward regen).
// MUST cover every unit temporal.ts can match-but-fail-to-resolve — including rolling days (`последните сто
// дни`, an uncounted word → temporal returns null): the `дни|ден` stems close that gap (strict review).
const RELATIVE_HINT = /седмиц|месец|тримесеч|годин|дни|ден|дена|днес|вчера/i;

/** True when the question looks time-relative yet no absolute period was resolved — L1 is then unsafe. */
export function hasUnresolvedRelativeDate(question: string, temporalResolved: boolean): boolean {
  if (temporalResolved) return false;
  return RELATIVE_HINT.test(question);
}

/**
 * Canonical L1 filter context. Folds the RESOLVED absolute period bounds (not the phrase) so the same
 * question in two different months keys to two different reports — the concrete #97 fix. An optional
 * FE-supplied filter (facets from the page the dock was opened on) is appended. Empty string when neither
 * is present (L1 then keys on the prompt alone).
 */
export function canonicalFilterContext(
  period: PeriodBounds | undefined,
  filterContext: string | undefined,
): string {
  const parts: string[] = [];
  if (period) parts.push(`p:${period.sinceIso}..${period.untilIso}`);
  const fc = filterContext?.trim();
  if (fc) parts.push(`f:${fc}`);
  return parts.join('|');
}

export interface DedupRequestInput {
  /** FE idempotency id for this submission (L0). Absent until the dock sends it (3c). */
  clientRequestId?: string;
  /** The server-authoritative user question (bounded upstream). */
  prompt: string;
  /** Whether temporal.ts resolved a period for this question. */
  temporalResolved: boolean;
  /** The resolved primary period bounds, folded into L1. */
  period?: PeriodBounds;
  /** FE-supplied facet context (3c); folded into L1. */
  filterContext?: string;
  /** The current freshness token (data + build) — folded into the single-flight key. */
  freshness: string;
}

export interface DedupRequest {
  /** Signals for `resolveReport` (pre-generation lookup). */
  signals: ResolveSignals;
  /** Layers to record when the driver's generation settles. */
  payloads: DedupPayload[];
  /** Stable single-flight instance name; `null` ⇒ no safe key ⇒ skip dedup (generate uncoordinated). */
  doName: string | null;
}

/** Shape the dedup signals, record payloads, and single-flight key for one chat turn. Pure. */
export function buildDedupRequest(input: DedupRequestInput): DedupRequest {
  const signals: ResolveSignals = {};
  const payloads: DedupPayload[] = [];

  if (input.clientRequestId) {
    signals.clientRequestId = input.clientRequestId;
    payloads.push({ layer: 'L0', clientRequestId: input.clientRequestId });
  }

  const l1Safe =
    input.prompt.trim().length > 0 &&
    !hasUnresolvedRelativeDate(input.prompt, input.temporalResolved);
  let filterContext = '';
  if (l1Safe) {
    filterContext = canonicalFilterContext(input.period, input.filterContext);
    // Pass the RAW prompt: dedup.ts normalises it identically at hash time for both lookup and record.
    signals.prompt = input.prompt;
    signals.filterContext = filterContext;
    payloads.push({ layer: 'L1', prompt: input.prompt, filterContext });
  }

  // Single-flight instance name: strongest stable key available. L1 (freshness+prompt+context) collapses
  // concurrent identical questions; else L0 (submission idempotency); else no safe key → skip dedup.
  let doName: string | null = null;
  if (l1Safe) {
    // normalizeText the filterContext too, matching dedupKey's canonicalFields — else trivially-different
    // whitespace routes identical requests to different DO instances (missed collapse; a cost blip only).
    // ESCAPE the delimiter: normalizeText does NOT strip '|', and both prompt and filterContext are
    // free-ish text, so a raw '|'-join is non-injective — `a|b`+`c` would alias `a`+`b|c` onto ONE DO
    // instance, and on a concurrent miss the waiter is woken with the driver's DIFFERENT report (the one
    // thing this cache must never do). Escaping `\`→`\\` then `|`→`\|` makes the join injective — the
    // same guarantee the KV key gets from encodeFields's length-prefix, without an async hash for a DO name.
    doName = `L1|${input.freshness}|${escapeDoField(normalizeText(input.prompt))}|${escapeDoField(
      normalizeText(filterContext),
    )}`;
  } else if (input.clientRequestId) {
    // L0 is injective as-is: freshness is fixed-arity (`d:<alnum>|c:<alnum>`) and clientRequestId is
    // charset-validated (^[A-Za-z0-9_-]{1,100}$, no '|'), so the split is unambiguous.
    doName = `L0|${input.freshness}|${input.clientRequestId}`;
  }

  return { signals, payloads, doName };
}
