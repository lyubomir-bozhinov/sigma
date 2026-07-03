import { cleanName } from './format';

/**
 * Deterministic match key for a Bulgarian company name — the libel-safety surface of the
 * „свързани лица" matcher (docs/spec/related-persons-foundation.md §5).
 *
 * Bulgarian trade names are nationally unique on the FULL фирма *including* legal form
 * (ЗТРРЮЛНЦ чл.21 т.7 / ТЗ чл.7), so an exact key match = the same legal entity. To keep that
 * guarantee the key folds ONLY presentation noise and preserves every distinguishing token:
 *
 *   - case (`toUpperCase`), collapsed whitespace, and quote glyphs (curly/guillemet → straight
 *     via `cleanName`, then dropped) — pure presentation, never a distinguishing token.
 *
 * It deliberately does NOT: transliterate Cyrillic↔Latin homoglyphs, fold „и"↔„&", strip the
 * legal form, strip клон/branch or ЕТ personal-name tokens, or normalize punctuation. Each of
 * those could collapse two distinct фирми into one key — an over-merge, i.e. a false public
 * accusation. When in doubt the key stays MORE specific (a recall miss is safe; an over-merge is not).
 *
 * Pure and deterministic: same input → same output, no I/O, no locale/clock dependence.
 */
export function companyNameKey(raw: string): string {
  return cleanName(raw)
    .toUpperCase()
    .replace(/"/g, '') // quotes are presentation noise for a match key (never a distinguishing token)
    .replace(/\s+/g, ' ')
    .trim();
}
