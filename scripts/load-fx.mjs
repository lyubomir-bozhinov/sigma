#!/usr/bin/env node
// Fetch ECB euro reference rates (via the no-auth frankfurter.app API, which serves ECB data)
// for the foreign-currency contracts, into the fx_rates table — so scripts/normalize-egov.sql
// can convert those contracts to canonical EUR at the date-of-signing rate.
//
//   node scripts/load-fx.mjs            # fetch → data/fx-load.sql
//   node scripts/load-fx.mjs --apply    # also load into local D1
//   node scripts/load-fx.mjs --apply --remote
//
// The lev (BGN) is a fixed peg (1 EUR = 1.95583 BGN) handled inline in normalize; only the
// genuinely foreign currencies (USD/CHF/GBP/TRY/SEK/CZK …) need a market rate, and they are few.
// ECB publishes business-day rates only, so we load each used currency's full date range and let
// normalize carry the latest prior rate forward over weekends/holidays, bounded to 10 days.

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
const FX_LOOKBACK_DAYS = 10;

const stripControls = (s) => String(s).replace(/[\x00-\x1F]/g, '');
const sqlStr = (s) => (s == null ? 'NULL' : `'${stripControls(s).replace(/'/g, "''")}'`);
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const addDays = (iso, days) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

function d1(sql) {
  const out = execFileSync(
    'wrangler',
    ['d1', 'execute', 'sigma', remoteFlag, '--json', '--command', sql],
    {
      cwd: apiDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

// EOP is the canonical historical corpus; admin is retained for legacy local staging and OCDS deltas.
const ranges = d1(
  'SELECT currency, MIN(contract_date) AS min_date, MAX(contract_date) AS max_date, ' +
    'COUNT(DISTINCT contract_date) AS contract_dates FROM raw_egov_contracts ' +
    "WHERE (source LIKE 'eop:%' OR source LIKE 'admin:%' OR source LIKE 'ocds:%') " +
    "AND currency NOT IN ('BGN','EUR') AND contract_date IS NOT NULL " +
    'GROUP BY currency ORDER BY currency',
);
console.log(`foreign currency ranges to price: ${ranges.length}`);

const rows = [];
const seen = new Set();
for (const { currency, min_date, max_date, contract_dates } of ranges) {
  const c = String(currency);
  if (!/^[A-Z]{3}$/.test(c)) {
    console.warn(`  ! invalid currency ${currency}`);
    continue;
  }
  if (!isIsoDate(min_date) || !isIsoDate(max_date)) {
    console.warn(`  ! invalid date range ${currency} ${min_date}..${max_date}`);
    continue;
  }
  const start = addDays(String(min_date), -FX_LOOKBACK_DAYS);
  const end = String(max_date);
  const url = `${API}/${encodeURIComponent(start)}..${encodeURIComponent(end)}?base=${encodeURIComponent(c)}&symbols=${encodeURIComponent('EUR')}`;
  let rates = null;
  try {
    const res = await fetch(url);
    const j = await res.json();
    rates = j?.rates ?? null;
  } catch (e) {
    console.warn(`  ! ${currency} ${start}..${end}: ${e.message}`);
  }
  if (!rates || typeof rates !== 'object') {
    console.warn(`  ! no rate series for ${currency} ${start}..${end}`);
    continue;
  }
  let loaded = 0;
  for (const [rateDate, quote] of Object.entries(rates)) {
    if (!isIsoDate(rateDate)) {
      console.warn(`  ! invalid rate date for ${currency}: ${rateDate}`);
      continue;
    }
    const n = Number(quote?.EUR);
    if (!Number.isFinite(n)) {
      console.warn(`  ! invalid rate for ${currency} ${rateDate}`);
      continue;
    }
    const key = `${c}:${rateDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ currency: c, rate_date: rateDate, rate: n });
    loaded += 1;
  }
  console.log(
    `  ${currency} ${start}..${end} → ${loaded} ECB business-day rates for ${contract_dates} contract dates`,
  );
}

const now = new Date().toISOString();
const values = rows
  .map(
    (r) =>
      `(${sqlStr(r.currency)}, ${sqlStr(r.rate_date)}, ${r.rate}, 'ecb:frankfurter', ${sqlStr(now)})`,
  )
  .join(',\n  ');
const sql =
  "DELETE FROM fx_rates WHERE source = 'ecb:frankfurter';\n" +
  (rows.length
    ? `INSERT INTO fx_rates (base_currency, rate_date, eur_per_unit, source, fetched_at) VALUES\n  ${values};\n`
    : '');
writeFileSync(outFile, sql);
console.log(`\nwrote ${rows.length} rates → ${outFile}`);

if (apply) {
  execFileSync('wrangler', ['d1', 'execute', 'sigma', remoteFlag, '--file', outFile], {
    cwd: apiDir,
    stdio: 'inherit',
  });
  console.log('applied to D1.');
}
