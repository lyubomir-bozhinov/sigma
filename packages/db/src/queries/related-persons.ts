import type { ConflictLink, ConflictRelation, CompanyConflicts, OfficialConflicts } from '@sigma/api-contract';
import { personSlug } from './identity';

// Read-only query layer for свързани лица. The PUBLIC surface shows ONLY declared PRIVATE OWNERSHIP
// (interest_class='private_ownership' — the person declared a stake). Management/board roles without a
// declared stake are never surfaced: an appointed office-holder is not a private interest, and showing
// them would be noise at best and defamatory at worst. Only status='published' rows leave the pipeline;
// held, suppressed and withdrawn (divested) links never surface.

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

// Shared projection: published private-ownership links + names + a representative declaration URL
// (provenance for the surface, never fabricated). Callers append a scope predicate + ORDER BY.
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
  WHERE il.status = 'published' AND il.interest_class = 'private_ownership'`;

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
  ORDER BY il.contract_value_eur DESC, il.link_key LIMIT ?`;

/** The leaderboard: office-holders who declared a private ownership stake in a procurement winner,
 *  ranked by the public money their company received. */
export async function getConflictLeaderboard(db: D1Database, limit = 100): Promise<ConflictLink[]> {
  const rows = (await db.prepare(LEADERBOARD_SQL).bind(limit).all<LinkRow>()).results;
  return rows.map(toLink);
}

export const OFFICIAL_SQL = `${LINK_SELECT} AND il.person_id = ?
  ORDER BY il.contract_value_eur DESC, il.link_key`;

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
  ORDER BY il.contract_value_eur DESC, il.link_key`;

/** Office-holders with a declared ownership stake in one winner (by ЕИК). Null when there are none. */
export async function getCompanyConflicts(
  db: D1Database,
  eik: string,
): Promise<CompanyConflicts | null> {
  const rows = (await db.prepare(COMPANY_SQL).bind(eik).all<LinkRow>()).results;
  if (rows.length === 0) return null;
  return { company: rows[0]!.company, eik, links: rows.map(toLink) };
}
