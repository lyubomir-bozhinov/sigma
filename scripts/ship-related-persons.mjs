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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

/**
 * Refuse to ship when the published (surfaced) link count is below a floor. Empty/partial staging — a
 * cold cache on a `full_crawl=false` run, or a broken extract — yields 0 published links; `audit.mjs`
 * then passes trivially (0 links = 0 violations), and the per-table `DELETE FROM` below would WIPE the
 * live public surface with zero re-inserts. This floor is the last gate before that. Override deliberately
 * with `--min-links=<N>` when a genuinely smaller set is expected. Pure — unit-tested.
 */
export function assertShipFloor(publishedCount, minLinks) {
  if (publishedCount < minLinks) {
    throw new Error(
      `refusing to ship: ${publishedCount} published links < floor ${minLinks}. Empty/partial staging ` +
        `would wipe the live surface. If this smaller set is intentional, re-run with --min-links=${publishedCount}.`,
    );
  }
}

/**
 * Parse the --min-links floor. Footgun guarded: `arg()` returns boolean `true` for a VALUELESS `--min-links`
 * flag, and `Number(true) === 1` — which silently collapses the anti-wipe floor from 50 to 1 while passing a
 * naive integer check. Reject the bare `true` explicitly, then require a positive integer. Pure — unit-tested.
 */
export function parseMinLinks(raw) {
  if (raw === true)
    throw new Error(
      '--min-links requires a value, e.g. --min-links=25 — a bare flag would collapse the anti-wipe floor to 1.',
    );
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--min-links must be a positive integer, got ${JSON.stringify(raw)}.`);
  return n;
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
  const minLinks = parseMinLinks(arg('min-links', 50));
  if (remote && !arg('yes', false))
    throw new Error('--remote requires --yes (guards against an accidental prod write)');

  const sqliteJson = (sql) => {
    const out = execFileSync('sqlite3', ['-json', String(workDb), sql], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
    return out ? JSON.parse(out) : [];
  };
  // Floor gate BEFORE any destructive write (see assertShipFloor). Only when actually applying — `--emit`
  // just writes SQL files and wipes nothing. Counts surfaced links only: status='published' is the public
  // surface (load.mjs assigns non-surfaced classes 'internal', not 'published').
  if (!emit) {
    const published =
      sqliteJson(`SELECT COUNT(*) AS n FROM interest_links WHERE status = 'published'`)[0]?.n ?? 0;
    assertShipFloor(Number(published), minLinks);
  }

  // Apply each table as ONE wrangler call over a temp .sql file: its DELETE + INSERTs reach D1 in a single
  // batched request (D1 batches are atomic), so an interrupted ship (timeout/kill) can no longer leave a
  // table half-wiped with no rollback — the failure mode of N separate --command calls. Suppressions still
  // ship first so a contested link is never briefly re-exposed. ponytail: a table exceeding D1's per-batch
  // size ceiling would need chunking; not a concern at current scale (hundreds–thousands of rows).
  const tmp = emit ? null : mkdtempSync(join(tmpdir(), 'sigma-ship-'));
  const applyFile = (table, sql) => {
    const f = join(tmp, `${table}.sql`);
    writeFileSync(f, sql);
    try {
      execFileSync(
        'wrangler',
        ['d1', 'execute', d1Name, remote ? '--remote' : '--local', '--yes', '--file', f],
        { cwd: resolve('apps/web'), stdio: 'inherit' },
      );
    } finally {
      rmSync(f, { force: true });
    }
  };

  if (emit) mkdirSync(emit, { recursive: true });
  const summary = {};
  try {
    for (const table of TABLES) {
      const cols = sqliteJson(`PRAGMA table_info(${sqlIdent(table)})`).map((r) => r.name);
      if (!cols.length) {
        summary[table] = 'absent (skipped)';
        continue;
      }
      const rows = sqliteJson(`SELECT * FROM ${sqlIdent(table)}`);
      const sql = [
        `DELETE FROM ${sqlIdent(table)};\n`,
        ...insertStatements(table, cols, rows),
      ].join('');
      summary[table] = rows.length;
      if (emit) writeFileSync(resolve(emit, `${table}.sql`), sql);
      else applyFile(table, sql);
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
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
