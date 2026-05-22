#!/usr/bin/env node
// Fetch ECB euro reference rates (via the no-auth frankfurter.app API, which serves ECB data)
// for the SIGNING DATES of the foreign-currency contracts, into the fx_rates table — so
// scripts/normalize-egov.sql can convert those contracts to canonical EUR at the date-of-signing
// rate (see packages/db/migrations/0007_data_quality.sql).
//
//   node scripts/load-fx.mjs            # fetch → data/fx-load.sql
//   node scripts/load-fx.mjs --apply    # also load into local D1
//   node scripts/load-fx.mjs --apply --remote
//
// The lev (BGN) is a fixed peg (1 EUR = 1.95583 BGN) handled inline in normalize; only the
// genuinely foreign currencies (USD/CHF/GBP/TRY/SEK/CZK …) need a market rate, and they are few.
// We store eur_per_unit = EUR for 1 unit of the foreign currency, keyed by the contract date we
// asked for (frankfurter returns the nearest prior business-day rate for weekends/holidays).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(root, 'apps/api');
const outFile = resolve(root, 'data/fx-load.sql');
const apply = process.argv.includes('--apply');
const remoteFlag = process.argv.includes('--remote') ? '--remote' : '--local';
const API = 'https://api.frankfurter.app';

const sqlStr = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

function d1(sql) {
  const out = execFileSync('wrangler', ['d1', 'execute', 'sigma', remoteFlag, '--json', '--command', sql], {
    cwd: apiDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const pairs = d1(
  "SELECT DISTINCT currency, contract_date FROM raw_egov_contracts " +
    "WHERE source LIKE 'admin:%' AND currency NOT IN ('BGN','EUR') AND contract_date IS NOT NULL " +
    'ORDER BY currency, contract_date',
);
console.log(`foreign (currency, date) pairs to price: ${pairs.length}`);

const rows = [];
for (const { currency, contract_date } of pairs) {
  const url = `${API}/${contract_date}?base=${currency}&symbols=EUR`;
  let rate = null;
  try {
    const res = await fetch(url);
    const j = await res.json();
    rate = j?.rates?.EUR ?? null;
  } catch (e) {
    console.warn(`  ! ${currency} ${contract_date}: ${e.message}`);
  }
  if (rate == null) {
    console.warn(`  ! no rate for ${currency} ${contract_date}`);
    continue;
  }
  rows.push({ currency, contract_date, rate });
  console.log(`  ${currency} ${contract_date} → ${rate} EUR/unit`);
}

const now = new Date().toISOString();
const values = rows
  .map((r) => `(${sqlStr(r.currency)}, ${sqlStr(r.contract_date)}, ${r.rate}, 'ecb:frankfurter', ${sqlStr(now)})`)
  .join(',\n  ');
const sql =
  "DELETE FROM fx_rates WHERE source = 'ecb:frankfurter';\n" +
  (rows.length
    ? `INSERT INTO fx_rates (base_currency, rate_date, eur_per_unit, source, fetched_at) VALUES\n  ${values};\n`
    : '');
writeFileSync(outFile, sql);
console.log(`\nwrote ${rows.length} rates → ${outFile}`);

if (apply) {
  execFileSync('wrangler', ['d1', 'execute', 'sigma', remoteFlag, '--file', outFile], { cwd: apiDir, stdio: 'inherit' });
  console.log('applied to D1.');
}
