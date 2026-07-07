import type {
  ConflictLink,
  ConflictRelation,
  CompanyConflicts,
  OfficialConflicts,
} from '@sigma/api-contract';
import { personSlug } from './identity';

// Read-only query layer for свързани лица. The PUBLIC surface shows declared material OWNERSHIP only:
//   • private_ownership — the official declared their OWN stake (relation owns/owns+manages).
//   • family_ownership  — the official declared a CLOSE RELATIVE's stake (relation 'related'); the
//     relative is anonymized downstream as „свързано лице" (name never stored). Both rest on the
//     official's own public declaration + public procurement records.
// Management/board roles without a declared stake, and listed securities, are never surfaced (noise at
// best, defamatory at worst). Only status='published' rows leave the pipeline; held, suppressed and
// withdrawn (divested) links never surface. Ranking is NEXUS-first (own-institution, then contemporaneous)
// so the strongest signals lead — never company revenue, which surfaced blue-chip noise first.

interface LinkRow {
  link_key: string;
  person_id: string;
  official: string;
  company: string;
  eik: string;
  relation: string;
  contemporaneous: number;
  own_institution: string;
  first_declared_year: string | null;
  last_declared_year: string | null;
  match_method: string;
  contract_count: number;
  contract_value_eur: number | null;
  first_contract_year: string | null;
  last_contract_year: string | null;
  source_url: string | null;
}

// Shared projection: published material-ownership links (self + family) + names + a representative
// declaration URL (provenance, never fabricated). Callers append a scope predicate + ORDER BY.
// NEXUS_ORDER ranks the strongest conflict signal first: a contract from the official's OWN institution,
// then a stake held during a contract award, then value as a tiebreak — link_key last for stability.
export const NEXUS_ORDER = `(il.own_institution = 'exact') DESC, il.contemporaneous DESC,
    il.contract_value_eur DESC, il.link_key`;
export const LINK_SELECT = `SELECT il.link_key, il.person_id, p.name AS official, b.name AS company, il.eik,
    il.relation, il.contemporaneous, il.own_institution,
    il.first_declared_year, il.last_declared_year, il.match_method,
    il.contract_count, il.contract_value_eur, il.first_contract_year, il.last_contract_year,
    (SELECT d.source_url FROM declared_interests di JOIN declarations d ON d.id = di.declaration_id
     WHERE d.person_id = il.person_id AND di.entity_key = il.entity_key
     ORDER BY d.declared_year DESC LIMIT 1) AS source_url
  FROM interest_links il
  JOIN persons p ON p.id = il.person_id
  JOIN bidders b ON b.id = il.bidder_id
  WHERE il.status = 'published' AND il.interest_class IN ('private_ownership', 'family_ownership')
    -- Collapse each (official, company) to ONE nexus. An official can hold BOTH their own stake and a
    -- relative's stake in the same winner — two published links (own→private_ownership, relative→
    -- family_ownership), identical contract value, since load.mjs keys aggregation on (person|eik|scope).
    -- Surfacing both would (a) double-count that winner's € in the headline and (b) show the same person
    -- twice for one company: a de-anonymisation vector (own stake + a same-surname co-owner ⇒ ТР
    -- cross-reference names the "anonymous" relative). When an own-stake link exists, drop the redundant
    -- family link to the same winner. Standalone family links (a relative owns a firm the official does
    -- not) are untouched. (per (person,eik) there is at most one link per scope, so this is the only dup.)
    AND NOT (il.interest_class = 'family_ownership' AND EXISTS (
      SELECT 1 FROM interest_links s WHERE s.person_id = il.person_id AND s.bidder_id = il.bidder_id
        AND s.status = 'published' AND s.interest_class = 'private_ownership'))`;

// own_institution is a 4-value verdict; only the deterministic 'exact' surfaces as true (the
// name_contains/locality heuristics are disclosed elsewhere, never asserted as fact).
function toLink(r: LinkRow): ConflictLink {
  return {
    linkKey: r.link_key,
    officialSlug: personSlug(r.person_id),
    official: r.official,
    company: r.company,
    eik: r.eik,
    relation: r.relation as ConflictRelation,
    contemporaneous: r.contemporaneous === 1,
    ownInstitution: r.own_institution === 'exact',
    firstDeclaredYear: r.first_declared_year,
    lastDeclaredYear: r.last_declared_year,
    matchMethod: r.match_method,
    contractCount: r.contract_count,
    contractValueEur: r.contract_value_eur,
    firstContractYear: r.first_contract_year,
    lastContractYear: r.last_contract_year,
    sourceUrl: r.source_url,
  };
}

export const LEADERBOARD_SQL = `${LINK_SELECT}
  ORDER BY ${NEXUS_ORDER} LIMIT ?`;

/** The leaderboard: office-holders who declared a material ownership stake (their own or a close
 *  relative's) in a procurement winner, ranked NEXUS-first (own-institution → contemporaneous → value). */
export async function getConflictLeaderboard(db: D1Database, limit = 100): Promise<ConflictLink[]> {
  const rows = (await db.prepare(LEADERBOARD_SQL).bind(limit).all<LinkRow>()).results;
  return rows.map(toLink);
}

export const OFFICIAL_SQL = `${LINK_SELECT} AND il.person_id = ?
  ORDER BY ${NEXUS_ORDER}`;

/** One office-holder's declared ownership links. Null when there are none (the page 404s rather than
 *  render an empty page under someone's name). */
export async function getOfficialConflicts(
  db: D1Database,
  personId: string,
): Promise<OfficialConflicts | null> {
  const rows = (await db.prepare(OFFICIAL_SQL).bind(personId).all<LinkRow>()).results;
  if (rows.length === 0) return null;
  const links = rows.map(toLink);
  return { official: links[0]!.official, links };
}

export const COMPANY_SQL = `${LINK_SELECT} AND il.eik = ?
  ORDER BY ${NEXUS_ORDER}`;

/** Office-holders with a declared ownership stake in one winner (by ЕИК). Null when there are none. */
export async function getCompanyConflicts(
  db: D1Database,
  eik: string,
): Promise<CompanyConflicts | null> {
  const rows = (await db.prepare(COMPANY_SQL).bind(eik).all<LinkRow>()).results;
  if (rows.length === 0) return null;
  return { company: rows[0]!.company, eik, links: rows.map(toLink) };
}
