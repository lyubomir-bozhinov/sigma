// CACBG crawler (Task 2, feasibility spike). One-time polite crawl of the public declaration
// register into a LOCAL, git-ignored staging file. The source is immutable per year, so this is
// resumable and idempotent: a declaration already in done.tsv is never re-fetched.
//
// PII posture (spec §8): raw declaration XML is NEVER written to disk — it is parsed in memory and
// only the structured, non-PII extract (declarant public official, institution, company, seat, year)
// is persisted. Addresses, EGN, passport, phone, and family member names are dropped at parse time.
//
// Usage:
//   node scripts/cacbg/fetch.mjs                       # full crawl, all discovered folders
//   node scripts/cacbg/fetch.mjs --years 2025 --limit 200   # smoke test one folder
//   node scripts/cacbg/fetch.mjs --concurrency 4

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getPinned, CACBG_HOST } from './tls.mjs';
import { parseList, parseDeclaration } from './parse.mjs';
import { assertScratchIgnored, SCRATCH, safeXmlFile, safeYear } from './guard.mjs';

const BASE = `https://${CACBG_HOST}`;
const STAGING = path.join(SCRATCH, 'staging');
const HOLDINGS = path.join(STAGING, 'holdings.jsonl');
const DONE = path.join(STAGING, 'done.tsv');
const CANDIDATE_YEARS = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// Fetch with 403/5xx treated as throttling: exponential backoff, then give up after `tries`.
async function politeGet(url, { headers, tries = 5 } = {}) {
  let wait = 500;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await getPinned(url, { headers });
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      if (attempt >= tries) return res; // let caller see the terminal status
      await sleep(wait);
      wait *= 2;
      continue;
    }
    return res;
  }
}

async function discoverFolders(years) {
  const found = [];
  for (const y of years) {
    const res = await politeGet(`${BASE}/${safeYear(y)}/list.xml`, { tries: 2 }).catch(() => null);
    if (res && res.status === 200) found.push(y);
    else console.log(`  folder ${y}: ${res ? res.status : 'error'} (skipped)`);
    await sleep(150);
  }
  return found;
}

function loadDone() {
  const done = new Set();
  if (fs.existsSync(DONE)) {
    for (const line of fs.readFileSync(DONE, 'utf8').split('\n')) {
      const key = line.split('\t')[0];
      if (key) done.add(key);
    }
  }
  return done;
}

// Bounded-concurrency pool over items; worker returns nothing (writes are side effects).
async function pool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function run() {
  assertScratchIgnored();
  fs.mkdirSync(STAGING, { recursive: true });

  const years = (arg('years', '') ? arg('years', '').split(',') : CANDIDATE_YEARS).map(safeYear);
  const limit = arg('limit', '') ? Number(arg('limit', '')) : Infinity;
  const concurrency = Number(arg('concurrency', '4'));

  console.log(`Discovering folders among ${years.join(', ')} …`);
  const folders = await discoverFolders(years);
  console.log(`Folders to crawl: ${folders.join(', ') || '(none)'}`);

  const done = loadDone();
  const holdingsOut = fs.createWriteStream(HOLDINGS, { flags: 'a' });
  const doneOut = fs.createWriteStream(DONE, { flags: 'a' });
  const stats = { folders: {}, fetched: 0, skipped: 0, withHoldings: 0, egnHits: 0, errors: 0 };

  try {
    for (const folder of folders) {
      const listRes = await politeGet(`${BASE}/${folder}/list.xml`);
      if (listRes.status !== 200) {
        console.log(`  ${folder}/list.xml → ${listRes.status}, skipping folder`);
        continue;
      }
      let rows = parseList(listRes.body.toString('utf8'));
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
      stats.folders[folder] = rows.length;
      console.log(`  ${folder}: ${rows.length} declarations`);

      let consecutiveErrors = 0;
      await pool(rows, concurrency, async (row) => {
        let xmlFile;
        try {
          xmlFile = safeXmlFile(row.xmlFile);
        } catch {
          stats.errors++;
          return;
        }
        const key = `${folder}/${xmlFile}`;
        if (done.has(key)) { stats.skipped++; return; }

        let res;
        try {
          res = await politeGet(`${BASE}/${folder}/${xmlFile}`);
        } catch (err) {
          stats.errors++;
          if (++consecutiveErrors > 25) throw new Error(`circuit breaker: 25 consecutive fetch errors near ${key}`);
          return;
        }
        if (res.status !== 200) { stats.errors++; return; }
        consecutiveErrors = 0;

        let d;
        try {
          d = parseDeclaration(res.body.toString('utf8'));
        } catch {
          stats.errors++;
          return;
        }
        stats.fetched++;
        if (d.egnPresent) stats.egnHits++;
        // one JSONL row per declared self-holding; declarations with no holdings still mark done
        for (const h of d.holdings) {
          holdingsOut.write(JSON.stringify({
            folder, year: d.year, category: row.category, institution: row.institution,
            person: row.person, position: row.position,
            company: h.company, seat: h.seat, kind: h.kind,
            controlHash: d.controlHash, familyHoldingCount: d.familyHoldingCount,
          }) + '\n');
        }
        if (d.holdings.length) stats.withHoldings++;
        done.add(key);
        doneOut.write(`${key}\t${d.controlHash ?? ''}\n`);
        await sleep(20); // politeness jitter
      });
    }
  } finally {
    await new Promise((r) => holdingsOut.end(r));
    await new Promise((r) => doneOut.end(r));
  }

  console.log('\n=== crawl summary ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`holdings → ${HOLDINGS}`);
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
