// Task 4 — deterministic matcher + measurement (feasibility spike, exploratory).
// Joins declared company holdings (scratch/cacbg/staging/holdings.jsonl) to the contract-winner set
// (bidders in the local backfill.sqlite) via the ONE production normalizer (companyNameKey). National
// trade-name uniqueness (ЗТРРЮЛНЦ чл.21) means a single exact-key hit on an eik_valid winner = the same
// legal entity → deterministic ЕИК. Everything ambiguous stays out of the auto bucket.
//
// Run: node --import ./scripts/cacbg/register-ts.mjs scripts/cacbg/match.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = path.join(ROOT, 'data/work/backfill.sqlite');
const HOLDINGS = path.join(ROOT, 'scratch/cacbg/staging/holdings.jsonl');
const REPORT = path.join(ROOT, 'scratch/cacbg/staging/findings.md');

const { companyNameKey } = await import('../../packages/shared/src/company-name-key.ts');

// --- 1. bidder index: normalized key → Map(eik → {name, valid}) -------------------------------
const db = new DatabaseSync(DB, { readOnly: true });
const bidders = db.prepare('SELECT name, eik_normalized, eik_valid FROM bidders').all();
const byKey = new Map();
for (const b of bidders) {
  const key = companyNameKey(b.name);
  if (!byKey.has(key)) byKey.set(key, new Map());
  // name-keyed bidders (no ЕИК) can't yield a deterministic id — track under a synthetic slot
  byKey.get(key).set(b.eik_normalized ?? `name:${b.name}`, { name: b.name, eik: b.eik_normalized, valid: b.eik_valid });
}

// --- 2. Real-corpus collision analysis: keys spanning >1 DISTINCT valid ЕИК ---------------------
// A key mapping to >1 ЕИК is a match hazard. Split by CAUSE, because only one cause is a normalizer bug:
//   - TRUE OVER-MERGE: the underlying name STRINGS genuinely differ (beyond case/space/quotes) yet the
//     normalizer folded them → false-accusation risk. THIS is the libel gate. Bar = 0.
//   - world collision: identical name string, multiple real ЕИКs — either a generic name shared by
//     distinct entities (e.g. regional „Водоснабдяване и канализация" ЕООД) or a source ЕИК typo.
//     Not a normalizer fault; the auto-publish rule must still quarantine these (single-ЕИК guard).
const strictKey = (s) => s.normalize('NFC').toUpperCase().replace(/[\s"„“”«»]/g, '');
const trueOverMerges = [];
const worldCollisions = [];
for (const [key, m] of byKey) {
  const valid = [...m.values()].filter((v) => v.eik && v.valid);
  const distinctEik = new Set(valid.map((v) => v.eik));
  if (distinctEik.size <= 1) continue;
  const rec = { key, eiks: [...distinctEik], names: [...new Set(valid.map((v) => v.name))] };
  const distinctStrings = new Set(valid.map((v) => strictKey(v.name)));
  (distinctStrings.size > 1 ? trueOverMerges : worldCollisions).push(rec);
}

// --- 3. match declared holdings ----------------------------------------------------------------
const holdings = fs.readFileSync(HOLDINGS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const buckets = { auto: [], multi: [], nameKeyed: [], invalidEik: [], noMatch: [] };
for (const h of holdings) {
  const m = byKey.get(companyNameKey(h.company));
  if (!m) { buckets.noMatch.push(h); continue; }
  const valid = [...m.values()].filter((v) => v.eik && v.valid);
  const distinctEik = new Set(valid.map((v) => v.eik));
  if (distinctEik.size === 1) buckets.auto.push({ ...h, eik: [...distinctEik][0], winner: valid[0].name });
  else if (distinctEik.size > 1) buckets.multi.push({ ...h, eiks: [...distinctEik] });
  else if ([...m.values()].some((v) => !v.eik)) buckets.nameKeyed.push(h);
  else buckets.invalidEik.push(h);
}

// --- 4. headline + own-institution candidates --------------------------------------------------
const officialsWithMatch = new Set(buckets.auto.map((a) => a.person));
const matchedCompanies = new Set(buckets.auto.map((a) => a.eik));
// authorities that bought from each matched winner (candidate own-institution overlaps, NOT asserted)
const authStmt = db.prepare(
  'SELECT DISTINCT a.name AS authority FROM contracts c ' +
  'JOIN tenders t ON t.id = c.tender_id JOIN authorities a ON a.id = t.authority_id ' +
  'JOIN bidders b ON b.id = c.bidder_id WHERE b.eik_normalized = ? LIMIT 20',
);
function authoritiesFor(eik) {
  try { return authStmt.all(eik).map((r) => r.authority); } catch { return []; }
}

const total = holdings.length;
const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
const summary = {
  bidders: bidders.length,
  declaredHoldings: total,
  distinctDeclaredCompanies: new Set(holdings.map((h) => companyNameKey(h.company))).size,
  autoMatched: buckets.auto.length,
  autoMatchRate: pct(buckets.auto.length),
  multiMatch: buckets.multi.length,
  nameKeyed: buckets.nameKeyed.length,
  invalidEik: buckets.invalidEik.length,
  noMatch: buckets.noMatch.length,
  officialsWithMatch: officialsWithMatch.size,
  matchedWinnerCompanies: matchedCompanies.size,
  trueOverMerge_LIBEL_GATE: trueOverMerges.length,
  worldNameCollisions: worldCollisions.length,
};
console.log(JSON.stringify(summary, null, 2));
console.log(
  trueOverMerges.length
    ? `\n!! LIBEL GATE FAILED: ${trueOverMerges.length} true over-merges (distinct name strings → one key):`
    : '\n✓ LIBEL GATE PASSED: 0 normalizer over-merges on the real winner set (every collision is one name string with multiple ЕИКs).',
);
for (const o of trueOverMerges.slice(0, 20)) console.log(`   ${o.key}  ⇐  ${o.names.join('  |  ')}  (${o.eiks.join(', ')})`);
console.log(`\nWorld name-collisions (same name string, >1 real ЕИК) auto-publish must quarantine: ${worldCollisions.length}. Auto-bucket hits on such keys: ${buckets.multi.length}.`);
for (const o of worldCollisions.slice(0, 8)) console.log(`   ${o.key}  →  ${o.eiks.length} ЕИК: ${o.eiks.join(', ')}`);

// --- 5. worked examples + findings report ------------------------------------------------------
const examples = buckets.auto.slice(0, 25).map((a) => ({
  official: a.person, institution: a.institution, position: a.position, year: a.year,
  declared: a.company, winner: a.winner, eik: a.eik, boughtBy: authoritiesFor(a.eik),
}));

const md = [
  '# Phase 0 — Свързани лица feasibility findings',
  '',
  '## Corpus',
  `- CACBG declarations ingested: see done.tsv; declared self-holdings: **${total}** rows, **${summary.distinctDeclaredCompanies}** distinct companies, **${new Set(holdings.map((h) => h.person)).size}** officials.`,
  `- Contract-winner set (bidders): **${bidders.length}**.`,
  '',
  '## Deterministic match (auto-publish scope)',
  `- **Auto-matched: ${buckets.auto.length} (${summary.autoMatchRate})** — single exact-key hit on one \`eik_valid=1\` winner.`,
  `- **Headline: ${officialsWithMatch.size} officials** hold a declared stake in **${matchedCompanies.size}** companies that won public contracts.`,
  '',
  '## Ambiguous tail (never auto-published)',
  `- >1 winner ЕИК for the key: ${buckets.multi.length}`,
  `- name-keyed winner (no ЕИК): ${buckets.nameKeyed.length}`,
  `- key hits only \`eik_valid=0\`: ${buckets.invalidEik.length}`,
  `- no winner match: ${buckets.noMatch.length}`,
  '',
  '## Libel gate (real winner corpus)',
  `- **true normalizer over-merges (distinct name STRINGS → one key): ${trueOverMerges.length} — bar = 0.**`,
  ...trueOverMerges.slice(0, 30).map((o) => `  - \`${o.key}\` ⇐ ${o.names.join(' | ')} (${o.eiks.join(', ')})`),
  `- world name-collisions (one name string, >1 real ЕИК — generic municipal names + source ЕИК typos): **${worldCollisions.length}**. Not a normalizer fault; the single-ЕИК auto-publish guard quarantines them (auto-bucket hits on such keys: **${buckets.multi.length}**).`,
  '- **Residual risk (documented):** a *generic* name (e.g. „Водоснабдяване и канализация" ЕООД) with exactly ONE winner namesake passes the single-ЕИК guard yet may not be globally unique in TR — so auto-publish needs a TR-wide name-uniqueness census (Phase 1) before trusting single-ЕИК keys for generic names.',
  ...worldCollisions.slice(0, 15).map((o) => `  - \`${o.key}\` → ${o.eiks.length} ЕИК: ${o.eiks.join(', ')}`),
  '',
  '## Worked examples (auto-matched; "boughtBy" = candidate own-institution overlap, unverified)',
  '```json',
  JSON.stringify(examples, null, 2),
  '```',
  '',
].join('\n');
fs.writeFileSync(REPORT, md);
console.log(`\nreport → ${REPORT}`);
db.close();

// Kill-criterion made executable: a true normalizer over-merge on the real corpus fails the run.
process.exitCode = trueOverMerges.length ? 1 : 0;
