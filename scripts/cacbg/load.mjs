// Phase 1 — productionized loader/resolver. Reads the extracted staging (holdings.jsonl / related.jsonl),
// resolves each declared interest to a winning bidder's ЕИК via the ONE production normalizer, and
// persists the свързани-лица domain (persons / declarations / declared_interests / interest_links /
// related_persons_internal) into the target SQLite/D1 per migration 0002. Idempotent: it rebuilds the
// domain tables from staging each run (link_suppressions — human-curated — persist).
//
// Integrity gate = certainty 1.0: 0 normalizer over-merges (else fail); only tier A|B links are
// 'published'; every link carries provenance + matcher_version.
//
// Run: node --import ./scripts/cacbg/register-ts.mjs scripts/cacbg/load.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameDistinctiveness, seatConfirmed, publishTier, temporalStatus, localityToken } from './classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.CACBG_DB || path.join(ROOT, 'data/work/backfill.sqlite');
const STAGING = process.env.CACBG_STAGING || path.join(ROOT, 'scratch/cacbg/staging');
const MIGRATION = path.join(ROOT, 'packages/db/migrations/0002_related_persons_foundation.sql');
const REPORT = path.join(STAGING, 'findings.md');
const MATCHER_VERSION = 'cnk-1+classify-1'; // bump when the normalizer or classify logic changes
const { companyNameKey } = await import('../../packages/shared/src/company-name-key.ts');

const norm = (s) => String(s ?? '').normalize('NFC').toUpperCase().replace(/[\s.\-–—]+/g, ' ').trim();
const yr = (s) => { const m = String(s ?? '').match(/\b(20\d{2})\b/); return m ? Number(m[1]) : NaN; };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const db = new DatabaseSync(DB);
db.exec('PRAGMA foreign_keys=ON');
// Full idempotent rebuild that also picks up schema changes: preserve human-curated suppressions,
// drop the CACBG tables (children first — FK-safe), re-apply migration 0002, restore suppressions.
let savedSuppressions = [];
if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='link_suppressions'").get()) {
  savedSuppressions = db.prepare('SELECT link_key,reason,suppressed_by,suppressed_at FROM link_suppressions').all();
}
for (const t of ['interest_link_authorities', 'interest_links', 'declared_interests', 'related_persons_internal', 'declarations', 'persons', 'link_suppressions']) db.exec(`DROP TABLE IF EXISTS ${t}`);
db.exec(fs.readFileSync(MIGRATION, 'utf8'));
const insSupp = db.prepare('INSERT INTO link_suppressions(link_key,reason,suppressed_by,suppressed_at) VALUES(?,?,?,?)');
for (const s of savedSuppressions) insSupp.run(s.link_key, s.reason, s.suppressed_by, s.suppressed_at);
const suppressed = new Set(savedSuppressions.map((s) => s.link_key));

// --- bidder index + libel gate ------------------------------------------------------------------
const bidders = db.prepare('SELECT id, name, eik_normalized eik, eik_valid valid, settlement FROM bidders').all();
const byKey = new Map();
for (const b of bidders) {
  const k = companyNameKey(b.name);
  if (!byKey.has(k)) byKey.set(k, new Map());
  byKey.get(k).set(b.eik ?? `name:${b.name}`, b);
}
const strictKey = (s) => s.normalize('NFC').toUpperCase().replace(/[\s"„“”«».,\-]/g, '');
let trueOverMerges = 0;
for (const [, m] of byKey) {
  const valid = [...m.values()].filter((v) => v.eik && v.valid);
  if (new Set(valid.map((v) => v.eik)).size > 1 && new Set(valid.map((v) => strictKey(v.name))).size > 1) trueOverMerges++;
}

// --- load staging → persons / declarations / declared_interests ; resolve → agg ------------------
const insPerson = db.prepare('INSERT OR IGNORE INTO persons(id,name) VALUES(?,?)');
const insDecl = db.prepare('INSERT OR IGNORE INTO declarations(id,person_id,xml_file,control_hash,folder_year,declared_year,template,category,institution,position,source_url) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
const insDI = db.prepare('INSERT INTO declared_interests(id,declaration_id,entity_raw,entity_key,kind,detail,timing,seat) VALUES(?,?,?,?,?,?,?,?)');
const insRP = db.prepare('INSERT INTO related_persons_internal(id,declaration_id,related_name,related_kind,info,timing) VALUES(?,?,?,?,?,?)');
const personId = (name) => `person:${companyNameKey(name)}`;
const agg = new Map();
let diN = 0, noMatch = 0, quarantined = 0;

db.exec('BEGIN');
for (const h of readJsonl(path.join(STAGING, 'holdings.jsonl'))) {
  const pid = personId(h.person);
  const did = `decl:${h.xmlFile}`;
  insPerson.run(pid, h.person);
  insDecl.run(did, pid, h.xmlFile, h.controlHash ?? null, h.folder, h.year ?? null, h.template, h.category ?? '', h.institution ?? '', h.position ?? '', `https://register.cacbg.bg/${h.folder}/${h.xmlFile}`);
  const key = companyNameKey(h.entity);
  insDI.run(`di:${did}:${diN++}`, did, h.entity, key, h.kind, h.detail ?? '', h.timing ?? 'annual', h.seat ?? '');
  // resolve
  const m = byKey.get(key);
  if (!m) { noMatch++; continue; }
  const valid = [...m.values()].filter((v) => v.eik && v.valid);
  const eiks = new Set(valid.map((v) => v.eik));
  if (eiks.size !== 1) { quarantined++; continue; }
  const eik = [...eiks][0];
  const gid = `${pid}|${eik}`;
  let rec = agg.get(gid);
  if (!rec) rec = agg.set(gid, { pid, eik, bidder: valid[0], person: h.person, key, kinds: new Set(), declYears: new Set(), seats: new Set(), institutions: new Set() }).get(gid);
  rec.kinds.add(h.kind);
  const y = yr(h.year); if (Number.isFinite(y)) rec.declYears.add(y);
  if (h.seat) rec.seats.add(h.seat);
  if (h.institution) rec.institutions.add(h.institution);
}
// related persons (internal/PII)
let rpN = 0;
for (const r of readJsonl(path.join(STAGING, 'related.jsonl'))) {
  const did = `decl:${r.xmlFile}`;
  if (!db.prepare('SELECT 1 FROM declarations WHERE id=?').get(did)) {
    insPerson.run(personId(r.person), r.person);
    insDecl.run(did, personId(r.person), r.xmlFile, null, r.folder, r.year ?? null, 'interests', '', r.institution ?? '', '', `https://register.cacbg.bg/${r.folder}/${r.xmlFile}`);
  }
  insRP.run(`rp:${did}:${rpN++}`, did, r.related_name, r.related_kind, r.info ?? '', r.timing ?? 'current');
}
db.exec('COMMIT');

// --- enrich each (person,eik) → interest_links (+ per-authority breakdown) -----------------------
const contractStmt = db.prepare("SELECT strftime('%Y', c.signed_at) yr, a.id auth_id, a.name authority, c.amount_eur eur FROM contracts c JOIN tenders t ON t.id=c.tender_id JOIN authorities a ON a.id=t.authority_id JOIN bidders b ON b.id=c.bidder_id WHERE b.eik_normalized=?");
const insLink = db.prepare('INSERT INTO interest_links(id,link_key,person_id,bidder_id,eik,entity_key,match_method,matcher_version,publish_tier,relation,contemporaneous,own_institution,evidence_count,first_declared_year,last_declared_year,contract_count,contract_value_eur,first_contract_year,last_contract_year,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insILA = db.prepare('INSERT OR IGNORE INTO interest_link_authorities(link_key,authority_id,authority_name,contract_count,value_eur,own) VALUES(?,?,?,?,?,?)');
// classify one authority (whose name may be a ';'-joined blob) against the official's institutions.
// exact = deterministic name equality; name_contains/locality = DISCLOSED heuristics (candidate, not proof).
const OWN_RANK = { exact: 3, name_contains: 2, locality: 1, none: 0 };
function authOwn(authorityName, instNorms, instNormsLong, locTokens) {
  const parts = String(authorityName).split(';').map((s) => norm(s)).filter(Boolean);
  if (parts.some((p) => instNorms.includes(p))) return 'exact';
  // heuristic: a LONG institution name (≥12 chars — guards against short-abbreviation false positives)
  // that is a normalized substring of an authority component or vice versa (e.g. „Народно събрание"
  // ⊂ „Народно събрание на Република България"). Disclosed, not deterministic.
  if (instNormsLong.length && parts.some((p) => instNormsLong.some((i) => p.includes(i) || i.includes(p)))) return 'name_contains';
  if (locTokens.length && parts.some((p) => locTokens.some((t) => p.includes(t)))) return 'locality';
  return 'none';
}
db.exec('BEGIN');
for (const rec of agg.values()) {
  const declYears = [...rec.declYears];
  const instNorms = [...rec.institutions].map(norm);
  const instNormsLong = instNorms.filter((i) => i.length >= 12);
  const locTokens = [...rec.institutions].map(localityToken).filter(Boolean);
  const years = new Set();
  let cCount = 0, cValue = 0, hasValue = false;
  const perAuth = new Map(); // auth_id → {name, count, value, own}
  for (const r of contractStmt.all(rec.eik)) {
    cCount++;
    if (r.yr) years.add(Number(r.yr));
    if (r.eur != null) { cValue += r.eur; hasValue = true; }
    let a = perAuth.get(r.auth_id);
    if (!a) a = perAuth.set(r.auth_id, { name: r.authority ?? '', count: 0, value: 0, own: 'none' }).get(r.auth_id);
    a.count++;
    if (r.eur != null) a.value += r.eur;
  }
  const seatOk = [...rec.seats].some((s) => seatConfirmed(s, rec.bidder.settlement));
  const tier = publishTier({ seatOk, distinctiveness: nameDistinctiveness(rec.key) });
  const contemporaneous = [...years].some((cy) => temporalStatus(declYears, cy) === 'contemporaneous') ? 1 : 0;
  // link-level own_institution = strongest per-authority verdict (exact > name_contains > locality > none)
  let ownInst = 'none';
  for (const [, a] of perAuth) { a.own = authOwn(a.name, instNorms, instNormsLong, locTokens); if (OWN_RANK[a.own] > OWN_RANK[ownInst]) ownInst = a.own; }
  const relation = rec.kinds.has('management') ? (rec.kinds.has('shares') || rec.kinds.has('participation') ? 'owns+manages' : 'manages') : 'owns';
  const linkKey = `${rec.pid}|${rec.eik}`;
  const status = suppressed.has(linkKey) ? 'suppressed' : tier === 'C_hold' ? 'held' : 'published';
  const yrs = [...years];
  insLink.run(`il:${linkKey}`, linkKey, rec.pid, rec.bidder.id, rec.eik, rec.key, 'exact_name_key', MATCHER_VERSION,
    tier, relation, contemporaneous, ownInst, rec.kinds.size,
    declYears.length ? String(Math.min(...declYears)) : null, declYears.length ? String(Math.max(...declYears)) : null,
    cCount, hasValue ? cValue : null, yrs.length ? String(Math.min(...yrs)) : null, yrs.length ? String(Math.max(...yrs)) : null, status);
  for (const [auth_id, a] of perAuth) insILA.run(linkKey, auth_id, a.name, a.count, a.value || null, a.own);
}
db.exec('COMMIT');

// --- integrity + report -------------------------------------------------------------------------
const q = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const links = one('SELECT COUNT(*) n FROM interest_links').n;
const pub = one("SELECT COUNT(*) n FROM interest_links WHERE status='published'").n;
const S = {
  persons: one('SELECT COUNT(*) n FROM persons').n,
  declarations: one('SELECT COUNT(*) n FROM declarations').n,
  declared_interests: one('SELECT COUNT(*) n FROM declared_interests').n,
  related_internal: one('SELECT COUNT(*) n FROM related_persons_internal').n,
  interest_links: links,
  published: pub,
  held_for_census: one("SELECT COUNT(*) n FROM interest_links WHERE status='held'").n,
  suppressed: one("SELECT COUNT(*) n FROM interest_links WHERE status='suppressed'").n,
  officials_linked: one('SELECT COUNT(DISTINCT person_id) n FROM interest_links').n,
  officials_managing: one("SELECT COUNT(DISTINCT person_id) n FROM interest_links WHERE relation LIKE '%manages%'").n,
  contemporaneous: one('SELECT COUNT(*) n FROM interest_links WHERE contemporaneous=1').n,
  own_institution_exact: one("SELECT COUNT(*) n FROM interest_links WHERE own_institution='exact'").n,
  own_institution_name_contains: one("SELECT COUNT(*) n FROM interest_links WHERE own_institution='name_contains'").n,
  own_institution_locality: one("SELECT COUNT(*) n FROM interest_links WHERE own_institution='locality'").n,
  published_contract_value_eur: Math.round(one("SELECT COALESCE(SUM(contract_value_eur),0) v FROM interest_links WHERE status='published'").v),
  published_own_institution_value_eur: Math.round(one("SELECT COALESCE(SUM(value_eur),0) v FROM interest_link_authorities ila JOIN interest_links il ON il.link_key=ila.link_key WHERE il.status='published' AND ila.own='exact'").v),
  trueOverMerge_LIBEL_GATE: trueOverMerges, noMatch, quarantined,
};
console.log(JSON.stringify(S, null, 2));

const examples = q(
  "SELECT p.name official, d.institution, b.name winner, il.eik, il.relation, il.publish_tier, il.status, " +
  "il.contemporaneous, il.own_institution, il.contract_count, ROUND(il.contract_value_eur) value_eur, " +
  "il.first_contract_year||'–'||il.last_contract_year contract_years, " +
  "(SELECT GROUP_CONCAT(authority_name,' | ') FROM interest_link_authorities WHERE link_key=il.link_key AND own='exact') own_bought_by " +
  'FROM interest_links il JOIN persons p ON p.id=il.person_id JOIN bidders b ON b.id=il.bidder_id ' +
  'JOIN declarations d ON d.person_id=il.person_id ' +
  "GROUP BY il.id ORDER BY (il.own_institution='exact')*4+(il.relation LIKE '%manages%')*2+il.contemporaneous+(il.status='published') DESC, il.contract_value_eur DESC LIMIT 25",
);
const md = [
  '# Свързани лица — resolved domain (Phase 1 load)',
  '', `_matcher ${MATCHER_VERSION}; DB ${path.relative(ROOT, DB)}_`, '',
  '## Persisted domain', '```json', JSON.stringify(S, null, 1), '```', '',
  '## Strongest published leads', '```json', JSON.stringify(examples, null, 1), '```', '',
].join('\n');
fs.writeFileSync(REPORT, md);
console.log(trueOverMerges ? `\n!! LIBEL GATE FAILED (${trueOverMerges})` : '\n✓ libel gate: 0 over-merges');
console.log(`report → ${REPORT}`);
db.close();
process.exitCode = trueOverMerges ? 1 : 0;
