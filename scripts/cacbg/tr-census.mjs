// TR name-uniqueness census (ADR-0009). Promotes tier-C held interest_links — generic company names
// with a single WINNER namesake — to 'published' iff the name is GLOBALLY unique in the Trade Register.
//
// Source: the Commercial Register open-data dump on data.egov.bg (DPA-safe: ЕГН/ЛНЧ hashed out, company
// name + ЕИК retained). We build companyNameKey(name) → {distinct ЕИК} over ALL active entities using
// the SAME normalizer as the matcher, so the key spaces are identical. Promotion is deterministic:
// key count == 1 AND that ЕИК == the matched winner ЕИК. Anything else stays held. No heuristic.
//
// Field-detection is structural (find the 9/13-digit ЕИК; find the company-name field), so it is robust
// to the exact open-data column names — confirm the mapping against the real dump before a production run.
//
// Run: node --import ./scripts/cacbg/register-ts.mjs scripts/cacbg/tr-census.mjs --dump <path.json|.jsonl>
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.CACBG_DB || path.join(ROOT, 'data/work/backfill.sqlite');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const DUMP = arg('dump') || process.env.TR_DUMP;
const { companyNameKey } = await import('../../packages/shared/src/company-name-key.ts');

const isEik = (v) => typeof v === 'string' && /^\d{9}$|^\d{13}$/.test(v.trim());
const NAME_HINT = /наименование|фирма|firm|name|ime|company|dLabel|subject/i;

// Extract {eik, name} from a TR record of unknown exact shape: ЕИК = the 9/13-digit field; name =
// a name-hinted field, else the longest non-numeric string value.
export function extractEntity(rec) {
  let eik = null, name = null, longest = '';
  for (const [k, v] of Object.entries(rec)) {
    const s = v == null ? '' : String(v);
    if (!eik && isEik(s)) eik = s.trim();
    if (typeof v === 'string' && !isEik(s)) {
      if (NAME_HINT.test(k) && !name) name = s.trim();
      if (s.length > longest.length) longest = s.trim();
    }
  }
  return { eik, name: name || longest || null };
}

// Read a TR dump as records: supports a JSON array, JSONL, or {data:[...]} envelope.
function* records(dump) {
  const raw = fs.readFileSync(dump, 'utf8');
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.data ?? parsed.records ?? parsed.result ?? [];
    yield* arr;
  } else {
    for (const line of raw.split('\n')) { const t = line.trim(); if (t) yield JSON.parse(t); }
  }
}

// Build companyNameKey → Set(ЕИК) over the whole register.
export function buildCensus(dump) {
  const census = new Map();
  for (const rec of records(dump)) {
    const { eik, name } = extractEntity(rec);
    if (!eik || !name) continue;
    const key = companyNameKey(name);
    if (!census.has(key)) census.set(key, new Set());
    census.get(key).add(eik);
  }
  return census;
}

// Promote held tier-C links that the census proves globally unique. Returns {promoted, stillHeld}.
export function promote(db, census) {
  const held = db.prepare("SELECT link_key, eik, entity_key FROM interest_links WHERE status='held' AND publish_tier='C_hold'").all();
  const upd = db.prepare("UPDATE interest_links SET status='published', match_method='exact_name_key+tr_census' WHERE link_key=?");
  let promoted = 0;
  db.exec('BEGIN');
  for (const l of held) {
    const eiks = census.get(l.entity_key);
    if (eiks && eiks.size === 1 && eiks.has(l.eik)) { upd.run(l.link_key); promoted++; }
  }
  db.exec('COMMIT');
  return { promoted, stillHeld: held.length - promoted };
}

// CLI entry (guarded so importing this module in tests has no side effects)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!DUMP) {
    console.log('no --dump provided; census not run. Provide a TR open-data snapshot to promote tier-C links.');
  } else {
    const db = new DatabaseSync(DB);
    const census = buildCensus(DUMP);
    console.log(`census: ${census.size} distinct name-keys over the TR dump`);
    const { promoted, stillHeld } = promote(db, census);
    console.log(`tier-C promotions: ${promoted} published, ${stillHeld} still held (non-unique or namesake mismatch)`);
    db.close();
  }
}
