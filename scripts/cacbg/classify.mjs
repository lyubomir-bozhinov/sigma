// Pure classification helpers for the hardened matcher. Each is deterministic; the ONE heuristic
// (name distinctiveness) is conservative — it only ever *withholds* a match, never fabricates one.

const FORM = /\b(ЕООД|ЕАД|ООД|АД|ЕТ|ДЗЗД|КД|СД|АДСИЦ|ЕАД|КООПЕРАЦИЯ|ФОНДАЦИЯ|СДРУЖЕНИЕ|АДСИЦ)\b/gu;

/**
 * Distinctiveness of a company name-key — a DISCLOSED heuristic used only to decide whether a
 * single-winner-ЕИК match is safe to auto-publish or must wait for a TR global-uniqueness census.
 * Conservative: numbers / Latin-or-brand tokens / ≥3 content words ⇒ 'distinctive' (collision-improbable);
 * a bare 1–2-word Cyrillic core (e.g. „В И К", „ДОМИНО") ⇒ 'generic' (route to census — never auto-publish).
 * @returns {'distinctive'|'generic'}
 */
export function nameDistinctiveness(key) {
  const core = String(key).replace(FORM, '').replace(/[^A-Za-zА-Яа-яЁё0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[0-9]/.test(core)) return 'distinctive'; // ordinals / registration numbers
  if (/[A-Za-z]/.test(core)) return 'distinctive'; // Latin / brand token
  const tokens = core.split(' ').filter((t) => t.length > 1);
  return tokens.length >= 3 ? 'distinctive' : 'generic';
}

const norm = (s) => String(s ?? '').normalize('NFC').toUpperCase().replace(/[\s.\-–—]+/g, ' ').trim();

// Joint-stock / listed legal form as a whole token (АД / ЕАД / АДСИЦ), bounded by string edge, whitespace
// or quotes only — NOT hyphens/dots, so „АД-ХОК ЕООД" (a hyphenated ООД name) is not misread as a company.
const JOINT_STOCK = /(?:^|[\s"„“”«»])(АД|ЕАД|АДСИЦ)(?:[\s"„“”«»]|$)/u;
/**
 * Materiality by legal form. The public ownership surface is CLOSELY-HELD companies only (ООД/ЕООД/ЕТ/
 * КД/СД/ДЗЗД or a form-unspecified name from the closely-held table). Joint-stock forms (АД/ЕАД/АДСИЦ) are
 * public-float securities — a declared parcel of listed shares is NOT a material ownership conflict, and
 * presenting it as one defames (the „11 Trace shares → €88M" trap). Excludes only an explicit АД-form token,
 * so it withholds rather than fabricates. @returns {boolean} true ⇒ material/closely-held.
 */
export function closelyHeldForm(name) {
  return !JOINT_STOCK.test(String(name ?? '').normalize('NFC').toUpperCase());
}

/** Seat proof: declared seat and winner settlement both present and equal ⇒ same entity (deterministic). */
export function seatConfirmed(declSeat, winnerSettlement) {
  const a = norm(declSeat);
  const b = norm(winnerSettlement);
  return a.length > 0 && b.length > 0 && a === b;
}

/**
 * Publish tier for a single-winner-ЕИК match:
 *   'A_seat'        — seat-confirmed: deterministic, publishable even for generic names.
 *   'B_distinctive' — single-ЕИК + structurally distinctive name: publishable (disclosed heuristic).
 *   'C_hold'        — generic name, no seat proof: withhold pending TR name-census.
 */
export function publishTier({ seatOk, distinctiveness }) {
  if (seatOk) return 'A_seat';
  return distinctiveness === 'distinctive' ? 'B_distinctive' : 'C_hold';
}

/**
 * Temporal relation of a contract to the years a stake was declared (asset decls are annual snapshots).
 * Deterministic from years alone.
 *   'contemporaneous'   — contract year within [minDecl, maxDecl] (stake provably held then).
 *   'after_last_decl'   — contract after the last declaration (stake may have been sold — do not claim current).
 *   'before_first_decl' — contract before the first declaration (stake may not yet have existed).
 *   'unknown'           — missing years.
 * @param {number[]} declYears  @param {number} contractYear
 */
export function temporalStatus(declYears, contractYear) {
  const ys = declYears.filter((y) => Number.isFinite(y));
  if (!ys.length || !Number.isFinite(contractYear)) return 'unknown';
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  if (contractYear < min) return 'before_first_decl';
  if (contractYear > max) return 'after_last_decl';
  return 'contemporaneous';
}

/**
 * Locality token of a public body, for the DISCLOSED same-region heuristic (institution↔authority).
 * „Област - Русе" / „Община Русе" → „РУСЕ"; ministries and national bodies → null (no locality).
 */
export function localityToken(institution) {
  const m = String(institution ?? '').match(/(?:Област|Община|Район)\s*[-–—]?\s*([А-Яа-яЁё]+)/);
  return m ? norm(m[1]) : null;
}
