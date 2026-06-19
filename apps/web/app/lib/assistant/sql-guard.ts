// run_sql safety — read-only enforcement (spec §7, hardened by §9 point 4).
//
// LAYERED DEFENCE — this module is the CHEAP, deploy-independent layer. Two stronger guards must
// wrap it before run_sql is exposed (tracked in the README roadmap; they need deps/bindings this
// pure module can't carry):
//   1. AST validation with node-sql-parser (SQLite dialect): assert the parsed statement is a single
//      read-only SELECT / WITH…SELECT. Blocklists are bypassable via casing/comments/stacking — the
//      parser is the real guard. Must be fuzzed adversarially and FAIL CLOSED on parse error.
//   2. A read-only data path: the binding exposed to run_sql must not have write rights to the
//      served D1 (spec §9.4) — `env.DB` is read-write, so a parser miss would be UPDATE/DELETE on
//      production, not a "weird report".
// What this layer adds: strip comments, reject stacked statements, require a leading SELECT/WITH,
// keyword blocklist, and a hard injected LIMIT + result byte cap. Fails closed.

export const MAX_ROWS = 500;
export const RESULT_BYTE_CAP = 64 * 1024; // bytes of JSON returned to the model (spec §7)

const FORBIDDEN = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'UPSERT',
  'MERGE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'RENAME',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'REINDEX',
  'ANALYZE',
  'TRIGGER',
  'GRANT',
  'REVOKE',
];

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* block */
    .replace(/--[^\n]*/g, ' '); // -- line
}

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/** Structural read-only check. Returns the de-commented, single-statement SQL or a rejection. */
export function assertReadOnlySelect(rawSql: string): GuardResult {
  const stripped = stripComments(rawSql).trim();
  if (!stripped) return { ok: false, reason: 'empty query' };

  // Reject stacked statements: at most one trailing `;`.
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length !== 1) {
    return { ok: false, reason: 'only a single statement is allowed' };
  }
  const sql = statements[0]!;

  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: 'query must start with SELECT or WITH' };
  }

  // Whole-word keyword blocklist (cheap second layer; the AST parser is the real guard).
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(sql)) {
      return { ok: false, reason: `forbidden keyword: ${kw}` };
    }
  }
  return { ok: true, sql };
}

/** Inject a LIMIT when absent; clamp it when above `max`. Operates on a guarded single statement. */
export function enforceLimit(sql: string, max = MAX_ROWS): string {
  const m = sql.match(/\blimit\s+(\d+)\b(?![\s\S]*\blimit\b)/i);
  if (!m) return `${sql.replace(/;?\s*$/, '')} LIMIT ${max}`;
  const n = Number(m[1]);
  if (n <= max) return sql;
  return sql.slice(0, m.index) + `LIMIT ${max}` + sql.slice(m.index! + m[0].length);
}

/**
 * Cap the JSON the model sees (spec §7): keep prepending rows while under the byte budget, and flag
 * truncation so the report callout can say "results truncated". Pure — the caller supplies rows.
 */
export function capRows(
  rows: (string | number | null)[][],
  cap = RESULT_BYTE_CAP,
): { rows: (string | number | null)[][]; truncated: boolean } {
  const out: (string | number | null)[][] = [];
  let bytes = 2; // []
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (bytes + size > cap) return { rows: out, truncated: true };
    out.push(row);
    bytes += size;
  }
  return { rows: out, truncated: false };
}
