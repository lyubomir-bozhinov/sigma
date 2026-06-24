// SQL security guard for the run_sql tool.
//
// Defence-in-depth (no AST parser in Workers — uses structural validation instead):
//   1. Keyword blocklist — rejects DML/DDL/dangerous pragma tokens regardless of casing/whitespace.
//   2. Structural check  — must begin with SELECT or WITH (CTE), single statement (no stacked ;).
//   3. LIMIT injection   — adds LIMIT if absent; clamps if above the hard ceiling.
//   4. Result truncation — handled by the caller after executing.
//
// Data is public procurement data; the threat model is write / DoS, not data exfiltration.

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// Tokens that must not appear anywhere in the SQL (case-insensitive word boundaries).
const BLOCKLIST = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'REPLACE',
  'UPSERT',
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'REINDEX',
  'ANALYZE',
  'SAVEPOINT',
  'RELEASE',
  'ROLLBACK',
  'COMMIT',
  'BEGIN',
  'TRANSACTION',
  'WRITE',
  'LOAD_EXTENSION',
];

// Matches a token as a complete SQL word (not substring of an identifier).
const blocklistRe = new RegExp(`\\b(${BLOCKLIST.join('|')})\\b`, 'i');

export interface SqlGuardResult {
  ok: true;
  sql: string;
}

export interface SqlGuardError {
  ok: false;
  reason: string;
}

export function guardSql(raw: string): SqlGuardResult | SqlGuardError {
  const trimmed = raw.trim();

  if (!trimmed) return { ok: false, reason: 'Empty SQL' };

  // Strip line comments (--) and block comments (/* */) before structural checks.
  const stripped = trimmed
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();

  // Block dangerous keywords even if the model tried to hide them in comments.
  const blockMatch = blocklistRe.exec(stripped);
  if (blockMatch) return { ok: false, reason: `Forbidden keyword: ${blockMatch[1].toUpperCase()}` };

  // Must be a single SELECT or WITH ... SELECT statement.
  const upper = stripped.toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, reason: 'Only SELECT or WITH…SELECT statements are allowed' };
  }

  // No stacked statements (semicolon in the middle — trailing semicolon is fine).
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, reason: 'Multiple statements are not allowed' };
  }

  // Enforce LIMIT.
  const limitRe = /\bLIMIT\s+(\d+)/i;
  const limitMatch = limitRe.exec(stripped);
  let sql: string;
  if (!limitMatch) {
    sql = `${withoutTrailing} LIMIT ${DEFAULT_LIMIT}`;
  } else {
    const existing = parseInt(limitMatch[1], 10);
    if (existing > MAX_LIMIT) {
      sql = stripped.replace(limitRe, `LIMIT ${MAX_LIMIT}`);
    } else {
      sql = stripped;
    }
  }

  return { ok: true, sql };
}

// Truncate D1 result rows to stay within model context limits.
const MAX_RESULT_BYTES = 32_000;

export function truncateResult(rows: unknown[]): { rows: unknown[]; truncated: boolean } {
  let bytes = 0;
  const kept: unknown[] = [];
  for (const row of rows) {
    const chunk = JSON.stringify(row).length;
    if (bytes + chunk > MAX_RESULT_BYTES) return { rows: kept, truncated: true };
    kept.push(row);
    bytes += chunk;
  }
  return { rows: kept, truncated: false };
}
