import type { ConflictLink, InterestClass } from '@sigma/api-contract';

// Pure presentation logic for the свързани-лица (conflict-of-interest) surface. Everything the conflict
// routes branch on lives here so the JSX stays a declarative shell (the repo does not render-test
// components — see search.suggest.test.ts) and every decision is unit-covered. NONE of this touches
// related_persons_internal; only PUBLISHED interest_links reach the DTO (ADR-0001/0013).

const RELATION_LABEL: Record<string, string> = {
  owns: 'притежава дял',
  manages: 'управлява',
  'owns+manages': 'притежава дял и управлява',
};

/** Bulgarian label for a declared relation. Unknown values pass through — never invent a stronger claim. */
export function relationLabel(relation: string): string {
  return RELATION_LABEL[relation] ?? relation;
}

const INTEREST_CLASS_LABEL: Record<InterestClass, string> = {
  private_ownership: 'частен дял',
  ex_officio_board: 'служебен борд',
  management_role: 'управленска роля',
};

/** Short Bulgarian label for the interpretation class (ADR-0013). */
export function interestClassLabel(c: InterestClass): string {
  return INTEREST_CLASS_LABEL[c] ?? c;
}

/** /conflicts/official/:slug — the official's conflict page (slug already base64url-encoded). */
export function officialHref(officialSlug: string): string {
  return `/conflicts/official/${officialSlug}`;
}

/** /conflicts/company/:eik — officials with a declared interest in this winner. */
export function companyConflictsHref(eik: string): string {
  return `/conflicts/company/${eik}`;
}

/** /companies/:eik — the winner's spending profile (matched winners always carry a valid ЕИК). */
export function companyProfileHref(eik: string): string {
  return `/companies/${eik}`;
}

/** Contract-activity span for a link: a range, a single year, or „—". */
export function contractYearsLabel(first: string | null, last: string | null): string {
  if (first && last && first !== last) return `${first} – ${last}`;
  return first ?? last ?? '—';
}

/** Leaderboard headline: total public money to privately-owned winners, link count, distinct officials.
 *  A null contract value counts as 0 (never NaN) — the money figure must never read as fabricated. */
export function privateOwnershipHeadline(links: ConflictLink[]): {
  linkCount: number;
  officialCount: number;
  totalEur: number;
} {
  const officials = new Set<string>();
  let totalEur = 0;
  for (const l of links) {
    officials.add(l.officialSlug);
    totalEur += l.contractValueEur ?? 0;
  }
  return { linkCount: links.length, officialCount: officials.size, totalEur };
}
