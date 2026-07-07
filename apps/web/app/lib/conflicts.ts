import type { ConflictLink } from '@sigma/api-contract';

// Pure presentation logic for the свързани-лица (conflict-of-interest) surface. Everything the conflict
// routes branch on lives here so the JSX stays a declarative shell (the repo does not render-test
// components — see search.suggest.test.ts) and every decision is unit-covered. NONE of this touches
// related_persons_internal; only PUBLISHED material-ownership links reach the DTO. 'related' links are
// a close relative's stake declared by the official — anonymized as „свързано лице", relative never named.

const RELATION_LABEL: Record<string, string> = {
  owns: 'притежава дял',
  manages: 'управлява',
  'owns+manages': 'притежава дял и управлява',
  related: 'дял на свързано лице', // a close relative's stake — the relative is never named
};

/** Bulgarian label for a declared relation. Unknown values pass through — never invent a stronger claim. */
export function relationLabel(relation: string): string {
  return RELATION_LABEL[relation] ?? relation;
}

/** A family link: the stake is a close relative's, declared by the official. Rendered anonymized —
 *  the official + company + value are shown, the relative only as „свързано лице". */
export function isFamilyLink(link: ConflictLink): boolean {
  return link.relation === 'related';
}

/** /conflicts/official/:slug — the office-holder's page (slug already base64url-encoded). */
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

/** Leaderboard headline: total public money to linked winners, counts, and the family (свързано лице)
 *  subset. A null contract value counts as 0 (never NaN) — the money figure must never read as fabricated. */
export function privateOwnershipHeadline(links: ConflictLink[]): {
  linkCount: number;
  officialCount: number;
  totalEur: number;
  familyLinkCount: number;
  familyEur: number;
} {
  const officials = new Set<string>();
  let totalEur = 0;
  let familyLinkCount = 0;
  let familyEur = 0;
  for (const l of links) {
    officials.add(l.officialSlug);
    totalEur += l.contractValueEur ?? 0;
    if (isFamilyLink(l)) {
      familyLinkCount += 1;
      familyEur += l.contractValueEur ?? 0;
    }
  }
  return {
    linkCount: links.length,
    officialCount: officials.size,
    totalEur,
    familyLinkCount,
    familyEur,
  };
}
