// Run the scoped re-derive (scripts/refresh-slice.sql) inside D1. The SQL string is injected by the
// caller (the Worker imports it as a bundled text asset) so this stays a pure, testable function.

/** Split a multi-statement SQL script into individual statements. Strips `--` line comments outside
 *  single-quoted string literals, and splits on `;` only outside literals. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inLiteral = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (!inLiteral && ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      if (i < sql.length) current += sql[i];
      continue;
    }

    if (ch === "'") {
      current += ch;
      if (inLiteral && next === "'") {
        current += next;
        i += 1;
      } else {
        inLiteral = !inLiteral;
      }
      continue;
    }

    if (!inLiteral && ch === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      continue;
    }

    current += ch;
  }

  const statement = current.trim();
  if (statement.length > 0) statements.push(statement);
  return statements;
}

/**
 * Execute the refresh-slice script as one D1 batch (transactional: all-or-nothing), then return the
 * number of refresh-derived ('c:o:%') contracts now in the domain.
 */
export async function runRefreshSlice(db: D1Database, refreshSliceSql: string): Promise<number> {
  const statements = splitSqlStatements(refreshSliceSql);
  await db.batch(statements.map((s) => db.prepare(s)));
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM contracts WHERE id LIKE 'c:o:%'")
    .first<{ n: number }>();
  return row?.n ?? 0;
}
