import type { ConflictContract, ConflictLink } from '@sigma/api-contract';
import { count, moneyBare } from '@sigma/shared';

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

/** True when ≥1 of the winner's contracts was signed during the declared-stake window — the actual
 *  conflict. Drives the split display and whether the row's contract list is worth expanding. */
export function hasContemporaneousContracts(link: ConflictLink): boolean {
  return link.contemporaneousContractCount > 0;
}

/** Contract-count cell: „3 от 11" when some contracts fall in the declared window, else the plain total. */
export function contractsCountLabel(link: ConflictLink): string {
  return hasContemporaneousContracts(link)
    ? `${count(link.contemporaneousContractCount)} от ${count(link.contractCount)}`
    : count(link.contractCount);
}

/** Public-funds cell: leads with the conflict-window sum (the figure the „по време на конфликта" question
 *  is about) and keeps the total as context so the row still reconciles to the headline. When no contract
 *  was signed in the window, there is nothing to split — show only the total. */
export function fundsCellLabel(link: ConflictLink): { primary: string; total: string | null } {
  if (hasContemporaneousContracts(link) && link.contemporaneousValueEur != null) {
    return {
      primary: moneyBare(link.contemporaneousValueEur),
      total: moneyBare(link.contractValueEur),
    };
  }
  return { primary: moneyBare(link.contractValueEur), total: null };
}

/** The on-demand resource URL for a link's contracts (client-fetched by the expandable row). Keyed on the
 *  URL-safe officialSlug + ЕИК (+ family flag) — never the raw link_key, which carries '|' and ':'. */
export function linkContractsHref(link: ConflictLink): string {
  const base = `/conflicts/link/${link.officialSlug}/${link.eik}/contracts`;
  return isFamilyLink(link) ? `${base}?f=1` : base;
}

const TEMPORAL_LABEL: Record<ConflictContract['temporal'], string> = {
  contemporaneous: 'в момент на дял',
  before: 'преди дела',
  after: 'след дела',
  unknown: 'без дата',
};

/** Bulgarian tag for a contract's position relative to the declared window. Only 'contemporaneous' is the
 *  claimed conflict; the rest are context, never asserted as a conflict. */
export function temporalLabel(t: ConflictContract['temporal']): string {
  return TEMPORAL_LABEL[t] ?? t;
}

/** Split a link's contracts into the conflict-window set and the rest (before/after/undated). The list
 *  arrives contemporaneous-first, so this only groups — it never reorders within a group. */
export function partitionContracts(contracts: ConflictContract[]): {
  inConflict: ConflictContract[];
  outside: ConflictContract[];
} {
  return {
    inConflict: contracts.filter((c) => c.temporal === 'contemporaneous'),
    outside: contracts.filter((c) => c.temporal !== 'contemporaneous'),
  };
}

/** A contract's signing year, or „—" when the source carries no date. */
export function contractYear(c: ConflictContract): string {
  return c.signedAt ? c.signedAt.slice(0, 4) : '—';
}

/** Leaderboard headline: total public money to linked winners, counts, and the family (свързано лице)
 *  subset. A null contract value counts as 0 (never NaN) — the money figure must never read as fabricated. */
export function privateOwnershipHeadline(links: ConflictLink[]): {
  linkCount: number;
  officialCount: number;
  totalEur: number;
  contemporaneousEur: number;
  familyLinkCount: number;
  familyEur: number;
} {
  const officials = new Set<string>();
  let totalEur = 0;
  let contemporaneousEur = 0;
  let familyLinkCount = 0;
  let familyEur = 0;
  for (const l of links) {
    officials.add(l.officialSlug);
    totalEur += l.contractValueEur ?? 0;
    contemporaneousEur += l.contemporaneousValueEur ?? 0;
    if (isFamilyLink(l)) {
      familyLinkCount += 1;
      familyEur += l.contractValueEur ?? 0;
    }
  }
  return {
    linkCount: links.length,
    officialCount: officials.size,
    totalEur,
    contemporaneousEur,
    familyLinkCount,
    familyEur,
  };
}
