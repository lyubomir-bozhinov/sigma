// Extract structured staging from the raw CACBG cache (re-runnable; no network).
// Reads scratch/cacbg/raw/<year>/{list.xml, *.xml}, parses both declaration templates, and writes:
//   • staging/holdings.jsonl  — company-bearing declared interests (shares/participation/management/
//                               sole_trader). PUBLIC data (official + company). This feeds the matcher.
//   • staging/related.jsonl   — declared THIRD-PARTY people (related-persons / conflict-contracts).
//                               PII → INTERNAL only (§8); git-ignored, never published as-is.
// PII rails: addresses/passport/phone are never extracted (parse.mjs); a non-empty EGN is counted, not stored.

import fs from 'node:fs';
import path from 'node:path';
import { parseList, parseDeclaration } from './parse.mjs';
import { assertScratchIgnored, SCRATCH } from './guard.mjs';

const RAW = path.join(SCRATCH, 'raw');
const STAGING = path.join(SCRATCH, 'staging');

function run() {
  assertScratchIgnored();
  fs.mkdirSync(STAGING, { recursive: true });
  const holdingsOut = fs.createWriteStream(path.join(STAGING, 'holdings.jsonl'));
  const relatedOut = fs.createWriteStream(path.join(STAGING, 'related.jsonl'));
  const stats = { decls: 0, assets: 0, interests: 0, unknown: 0, egnHits: 0, holdings: 0, related: 0, byKind: {} };

  const folders = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => /^20\d{2}$/.test(f)).sort() : [];
  for (const folder of folders) {
    const dir = path.join(RAW, folder);
    const listPath = path.join(dir, 'list.xml');
    if (!fs.existsSync(listPath)) { console.log(`  ${folder}: no list.xml, skip`); continue; }
    // xmlFile → context (first listing wins; a person with multiple positions shares one filing)
    const ctx = new Map();
    for (const r of parseList(fs.readFileSync(listPath, 'utf8'))) {
      if (!ctx.has(r.xmlFile)) ctx.set(r.xmlFile, r);
    }
    let n = 0;
    for (const file of fs.readdirSync(dir)) {
      if (file === 'list.xml' || !file.endsWith('.xml')) continue;
      const d = parseDeclaration(fs.readFileSync(path.join(dir, file), 'utf8'));
      stats.decls++;
      stats[d.templateType] = (stats[d.templateType] ?? 0) + 1;
      if (d.egnPresent) stats.egnHits++;
      const c = ctx.get(file) ?? {};
      const person = c.person || d.declarant;
      for (const it of d.interests) {
        holdingsOut.write(JSON.stringify({
          folder, year: d.year, template: d.templateType,
          category: c.category ?? '', institution: c.institution ?? '', person, position: c.position ?? d.position ?? '',
          entity: it.entity, kind: it.kind, detail: it.detail, timing: it.timing, seat: it.seat ?? '',
          controlHash: d.controlHash,
        }) + '\n');
        stats.holdings++;
        stats.byKind[it.kind] = (stats.byKind[it.kind] ?? 0) + 1;
      }
      for (const rp of d.relatedPersons) {
        relatedOut.write(JSON.stringify({
          folder, year: d.year, person, institution: c.institution ?? '',
          related_name: rp.name, related_kind: rp.kind, info: rp.info, timing: rp.timing,
        }) + '\n');
        stats.related++;
      }
      n++;
    }
    console.log(`  ${folder}: ${n} declarations parsed`);
  }
  holdingsOut.end();
  relatedOut.end();
  console.log('\n=== extract summary ===');
  console.log(JSON.stringify(stats, null, 2));
}

run();
