import { CONTRACT_STAGING_COLS, type ContractStagingRow } from './ocds';

/**
 * Upsert OCDS contract rows into raw_egov_contracts for one source tag: scoped DELETE + batched
 * INSERT (idempotent per period). Bound params (no literal escaping). The daily delta is small;
 * 100 prepared inserts per batch stays well within D1 limits.
 */
export async function upsertContractStaging(
  db: D1Database,
  source: string,
  rows: ContractStagingRow[],
): Promise<number> {
  const deleteStmt = db.prepare('DELETE FROM raw_egov_contracts WHERE source = ?').bind(source);
  const placeholders = CONTRACT_STAGING_COLS.map(() => '?').join(', ');
  const sql = `INSERT INTO raw_egov_contracts (${CONTRACT_STAGING_COLS.join(', ')}) VALUES (${placeholders})`;
  const CHUNK = 100;
  if (rows.length === 0) {
    await db.batch([deleteStmt]);
    return 0;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const stmts = rows
      .slice(i, i + CHUNK)
      .map((r) => db.prepare(sql).bind(...CONTRACT_STAGING_COLS.map((c) => r[c] ?? null)));
    if (i === 0) stmts.unshift(deleteStmt);
    await db.batch(stmts);
  }
  return rows.length;
}
