import type {
  ConflictLeaderboard,
  ConflictLink,
  ConflictRelation,
  CompanyConflicts,
  InterestClass,
  OfficialConflicts,
} from '@sigma/api-contract';

// Read-only query layer for свързани лица (ADR-0013). Reads interest_links directly — the contract facts
// (count/value/years) are denormalized onto the link by the loader, so no rollup table is needed. Only
// status='published' rows surface; held/suppressed links never leave the pipeline (ADR-0001/0003).

interface LinkRow {
  link_key: string;
  official: string;
  company: string;
  eik: string;
  relation: string;
  interest_class: string;
  contemporaneous: number;
  own_institution: string;
  match_method: string;
  contract_count: number;
  contract_value_eur: number | null;
  first_contract_year: string | null;
  last_contract_year: string | null;
  source_url: string | null;
}

// Shared projection: link facts + official/company names + a representative declaration URL. The
// source_url subquery picks the most recent declaration backing this (person, entity) — provenance for
// the surface, never fabricated. Callers append a scope predicate + ORDER BY. `?` binds stay as binds.
export const LINK_SELECT = `SELECT il.link_key, p.name AS official, b.name AS company, il.eik,
    il.relation, il.interest_class, il.contemporaneous, il.own_institution, il.match_method,
    il.contract_count, il.contract_value_eur, il.first_contract_year, il.last_contract_year,
    (SELECT d.source_url FROM declared_interests di JOIN declarations d ON d.id = di.declaration_id
     WHERE d.person_id = il.person_id AND di.entity_key = il.entity_key
     ORDER BY d.declared_year DESC LIMIT 1) AS source_url
  FROM interest_links il
  JOIN persons p ON p.id = il.person_id
  JOIN bidders b ON b.id = il.bidder_id
  WHERE il.status = 'published'`;

// own_institution is a 4-value verdict; only the deterministic 'exact' surfaces as true (the
// name_contains/locality heuristics are disclosed elsewhere, never asserted as fact — ADR-0008).
function toLink(r: LinkRow): ConflictLink {
  return {
    linkKey: r.link_key,
    official: r.official,
    company: r.company,
    eik: r.eik,
    relation: r.relation as ConflictRelation,
    interestClass: r.interest_class as InterestClass,
    contemporaneous: r.contemporaneous === 1,
    ownInstitution: r.own_institution === 'exact',
    matchMethod: r.match_method,
    contractCount: r.contract_count,
    contractValueEur: r.contract_value_eur,
    firstContractYear: r.first_contract_year,
    lastContractYear: r.last_contract_year,
    sourceUrl: r.source_url,
  };
}

export const LEADERBOARD_SQL = `${LINK_SELECT} AND il.interest_class = ?
  ORDER BY il.contract_value_eur DESC, il.link_key LIMIT ?`;

/** The leaderboard: private-ownership conflicts (the headline) and ex-officio board roles as a SEPARATE
 *  list — never summed together, so appointed civil servants are not presented as conflicts (ADR-0013). */
export async function getConflictLeaderboard(
  db: D1Database,
  limit = 100,
): Promise<ConflictLeaderboard> {
  const [priv, exo] = await Promise.all([
    db.prepare(LEADERBOARD_SQL).bind('private_ownership', limit).all<LinkRow>(),
    db.prepare(LEADERBOARD_SQL).bind('ex_officio_board', limit).all<LinkRow>(),
  ]);
  return { privateOwnership: priv.results.map(toLink), exOfficio: exo.results.map(toLink) };
}

export const OFFICIAL_SQL = `${LINK_SELECT} AND il.person_id = ?
  ORDER BY il.contract_value_eur DESC, il.link_key`;

/** An official's published links, private-ownership separated from ex-officio/management roles. Null when
 *  the official has no published link (the page 404s rather than render an empty accusation). */
export async function getOfficialConflicts(
  db: D1Database,
  personId: string,
): Promise<OfficialConflicts | null> {
  const rows = (await db.prepare(OFFICIAL_SQL).bind(personId).all<LinkRow>()).results;
  if (rows.length === 0) return null;
  const links = rows.map(toLink);
  return {
    official: links[0]!.official,
    privateOwnership: links.filter((l) => l.interestClass === 'private_ownership'),
    otherRoles: links.filter((l) => l.interestClass !== 'private_ownership'),
  };
}

export const COMPANY_SQL = `${LINK_SELECT} AND il.eik = ?
  ORDER BY il.contract_value_eur DESC, il.link_key`;

/** Officials with a published declared interest in one winner (by ЕИК). Null when there are none. */
export async function getCompanyConflicts(
  db: D1Database,
  eik: string,
): Promise<CompanyConflicts | null> {
  const rows = (await db.prepare(COMPANY_SQL).bind(eik).all<LinkRow>()).results;
  if (rows.length === 0) return null;
  return { company: rows[0]!.company, eik, links: rows.map(toLink) };
}
