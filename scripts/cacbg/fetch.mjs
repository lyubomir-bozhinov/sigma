// CACBG crawler (Task 2). One-time polite crawl of the public declaration register into a LOCAL,
// git-ignored raw cache. Pure I/O: it fetches list.xml + every declaration XML and writes them under
// scratch/cacbg/raw/<year>/. Parsing/extraction is a separate re-runnable step (extract.mjs) so the
// parser can evolve without re-fetching — and the raw cache mirrors the production R2 corpus.
//
// Resumable + idempotent: a declaration already on disk is skipped (the source is immutable per year).
// PII: raw XML lives ONLY in git-ignored scratch (deleted post-spike, Task 0). EGN is already stripped
// upstream; addresses/family are dropped by extract.mjs, never persisted to the structured staging.
//
// Usage:
//   node scripts/cacbg/fetch.mjs                     # all discovered folders
//   node scripts/cacbg/fetch.mjs --years 2025 --limit 300
//   node scripts/cacbg/fetch.mjs --concurrency 6

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getPinned, CACBG_HOST } from './tls.mjs';
import { parseList } from './parse.mjs';
import { assertScratchIgnored, SCRATCH, safeXmlFile, safeYear } from './guard.mjs';

const BASE = `https://${CACBG_HOST}`;
const RAW = path.join(SCRATCH, 'raw');
const CANDIDATE_YEARS = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

async function politeGet(url, { tries = 5 } = {}) {
  let wait = 500;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await getPinned(url);
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait); wait *= 2; continue;
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      if (attempt >= tries) return res;
      await sleep(wait); wait *= 2; continue;
    }
    return res;
  }
}

function atomicWrite(file, buf) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
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

async function pool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) await worker(items[i++]);
  }));
}

async function run() {
  assertScratchIgnored();
  const years = (arg('years', '') ? arg('years', '').split(',') : CANDIDATE_YEARS).map(safeYear);
  const limit = arg('limit', '') ? Number(arg('limit', '')) : Infinity;
  const concurrency = Number(arg('concurrency', '6'));

  console.log(`Discovering folders among ${years.join(', ')} …`);
  const folders = await discoverFolders(years);
  console.log(`Folders to crawl: ${folders.join(', ') || '(none)'}`);

  const stats = { folders: {}, fetched: 0, cached: 0, missing: 0, errors: 0 };
  for (const folder of folders) {
    const dir = path.join(RAW, folder);
    fs.mkdirSync(dir, { recursive: true });
    const listRes = await politeGet(`${BASE}/${folder}/list.xml`);
    if (listRes.status !== 200) { console.log(`  ${folder}/list.xml → ${listRes.status}, skip`); continue; }
    atomicWrite(path.join(dir, 'list.xml'), listRes.body); // cache list for extract.mjs
    let rows = parseList(listRes.body.toString('utf8'));
    if (Number.isFinite(limit)) rows = rows.slice(0, limit);
    stats.folders[folder] = rows.length;
    console.log(`  ${folder}: ${rows.length} declarations`);

    let consecutive = 0;
    await pool(rows, concurrency, async (row) => {
      let xmlFile;
      try { xmlFile = safeXmlFile(row.xmlFile); } catch { stats.errors++; return; }
      const dest = path.join(dir, xmlFile);
      if (fs.existsSync(dest)) { stats.cached++; return; }
      let res;
      try { res = await politeGet(`${BASE}/${folder}/${xmlFile}`); }
      catch { stats.errors++; if (++consecutive > 25) throw new Error(`circuit breaker near ${folder}/${xmlFile}`); return; }
      if (res.status === 404) { stats.missing++; consecutive = 0; return; } // listed-but-unpublished (source gap)
      if (res.status !== 200) { stats.errors++; return; }
      consecutive = 0;
      atomicWrite(dest, res.body);
      stats.fetched++;
      await sleep(15);
    });
  }
  console.log('\n=== crawl summary ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`raw cache → ${RAW}`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
