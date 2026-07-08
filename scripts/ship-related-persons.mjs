#!/usr/bin/env node
// Ship the свързани-лица domain (persons + declarations + declared_interests + interest_links +
// interest_link_authorities + link_suppressions) from a sqlite work DB to the served D1. Kept SEPARATE
// from ship-domain.mjs so the EOP deploy path is untouched; reuses the same literal-escaping + batching.
// Migration 0002 must already be applied (the deploy runs `d1 migrations apply`). No precompute — the
// query layer reads interest_links directly.
//
// related_persons_internal (relative names — PII) is DELIBERATELY NOT shipped: no served query reads it,
// so pushing it to the public D1 is PII we never surface. It stays in the build/work DB only (load.mjs
// uses it for a census COUNT). The relative is anonymized as „свързано лице" via interest_links.relation.
//
//   node scripts/ship-related-persons.mjs --work-db data/work/backfill.sqlite --emit out/rp   # SQL only
//   node scripts/ship-related-persons.mjs --work-db … --remote --yes                          # apply to D1
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// link_suppressions is loaded first so a re-import cannot briefly expose a contested link; the rest are
// independent. Order is otherwise parents-before-children for readability (FKs are not enforced by D1).
export const TABLES = [
  'link_suppressions',
  'persons',
  'declarations',
  'declared_interests',
  'interest_links',
  'interest_link_authorities',
];
const MAX_BATCH_BYTES = 90_000;
const MAX_BATCH_ROWS = 400;

// Supports --name=value, --name value, and bare --name (boolean). A --name whose next token is another
// --flag (or absent) is a boolean; otherwise it consumes the next token as its value.
const arg = (name, def) => {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return def;
  const a = process.argv[i];
  const eq = a.indexOf('=');
  if (eq >= 0) return a.slice(eq + 1);
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

export function sqlIdent(s) {
  return `"${String(s).replaceAll('"', '""')}"`;
}
// SQL literal — the ONLY interpolation into shipped SQL. Strips NUL, doubles quotes, NULLs non-finite
// numbers. Values come from our own sqlite, but this is still the trust boundary into D1.
export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replaceAll('\x00', '').replaceAll("'", "''")}'`;
}

/** Batched multi-row INSERTs for one table, bounded by D1's statement size. Pure — unit-tested. */
export function insertStatements(table, cols, rows) {
  if (!cols.length || !rows.length) return [];
  const prefix = `INSERT INTO ${sqlIdent(table)} (${cols.map(sqlIdent).join(', ')}) VALUES\n`;
  const statements = [];
  let batch = [];
  let bytes = Buffer.byteLength(prefix) + 2;
  const flush = () => {
    if (!batch.length) return;
    statements.push(prefix + batch.join(',\n') + ';\n');
    batch = [];
    bytes = Buffer.byteLength(prefix) + 2;
  };
  for (const row of rows) {
    const tuple = `(${cols.map((c) => sqlLiteral(row[c])).join(',')})`;
    const tupleBytes = Buffer.byteLength(tuple) + 2;
    if (batch.length && (batch.length >= MAX_BATCH_ROWS || bytes + tupleBytes > MAX_BATCH_BYTES))
      flush();
    batch.push(tuple);
    bytes += tupleBytes;
  }
  flush();
  return statements;
}

function main() {
  const workDb = arg('work-db', 'data/work/backfill.sqlite');
  const emit = arg('emit', '');
  const remote = Boolean(arg('remote', false));
  const d1Name = process.env.SIGMA_D1_NAME || 'sigma';
  if (remote && !arg('yes', false))
    throw new Error('--remote requires --yes (guards against an accidental prod write)');

  const sqliteJson = (sql) => {
    const out = execFileSync('sqlite3', ['-json', String(workDb), sql], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
    return out ? JSON.parse(out) : [];
  };
  const apply = (sql) => {
    const loc = remote ? '--remote' : '--local';
    execFileSync('wrangler', ['d1', 'execute', d1Name, loc, '--yes', '--command', sql], {
      cwd: resolve('apps/web'),
      stdio: 'inherit',
    });
  };

  if (emit) mkdirSync(emit, { recursive: true });
  const summary = {};
  for (const table of TABLES) {
    const cols = sqliteJson(`PRAGMA table_info(${sqlIdent(table)})`).map((r) => r.name);
    if (!cols.length) {
      summary[table] = 'absent (skipped)';
      continue;
    }
    const rows = sqliteJson(`SELECT * FROM ${sqlIdent(table)}`);
    const stmts = [`DELETE FROM ${sqlIdent(table)};\n`, ...insertStatements(table, cols, rows)];
    summary[table] = rows.length;
    if (emit) {
      writeFileSync(resolve(emit, `${table}.sql`), stmts.join(''));
    } else {
      for (const s of stmts) apply(s);
    }
  }
  console.log(
    JSON.stringify(
      { workDb, target: emit ? `emit:${emit}` : remote ? 'D1:remote' : 'D1:local', rows: summary },
      null,
      2,
    ),
  );
}

// Only run when invoked directly (importing for tests has no side effects).
if (import.meta.url === `file://${process.argv[1]}`) main();
