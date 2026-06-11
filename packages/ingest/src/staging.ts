import {
  BASE_AMENDMENT_COLS,
  BASE_CONTRACT_COLS,
  BASE_TENDER_COLS,
  type BaseStagingRow,
} from './base';
import {
  AMENDMENT_STAGING_COLS,
  CONTRACT_STAGING_COLS,
  LOT_STAGING_COLS,
  PARTY_STAGING_COLS,
  type AmendmentStagingRow,
  type ContractStagingRow,
  type LotStagingRow,
  type PartyStagingRow,
} from './ocds';

const CHUNK = 100;

type StagingRow =
  | ContractStagingRow
  | AmendmentStagingRow
  | PartyStagingRow
  | LotStagingRow
  | BaseStagingRow;

async function upsertStagingRows<T extends StagingRow>(
  db: D1Database,
  table: string,
  source: string,
  cols: readonly string[],
  rows: T[],
): Promise<number> {
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE source = ?`).bind(source);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  if (rows.length === 0) {
    await db.batch([deleteStmt]);
    return 0;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const stmts = rows.slice(i, i + CHUNK).map((r) => {
      const record = r as Record<string, unknown>;
      return db.prepare(sql).bind(...cols.map((c) => record[c] ?? null));
    });
    if (i === 0) stmts.unshift(deleteStmt);
    await db.batch(stmts);
  }
  return rows.length;
}

/** Scoped DELETE + batched INSERT into raw_contracts for one OCDS source tag. */
export async function upsertContractStaging(
  db: D1Database,
  source: string,
  rows: ContractStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_contracts', source, CONTRACT_STAGING_COLS, rows);
}

export async function upsertAmendmentStaging(
  db: D1Database,
  source: string,
  rows: AmendmentStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_amendments', source, AMENDMENT_STAGING_COLS, rows);
}

export async function upsertPartyStaging(
  db: D1Database,
  source: string,
  rows: PartyStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_ocds_parties', source, PARTY_STAGING_COLS, rows);
}

export async function upsertLotStaging(
  db: D1Database,
  source: string,
  rows: LotStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_ocds_lots', source, LOT_STAGING_COLS, rows);
}

export async function upsertBaseContractStaging(
  db: D1Database,
  source: string,
  rows: BaseStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_contracts', source, BASE_CONTRACT_COLS, rows);
}

export async function upsertBaseTenderStaging(
  db: D1Database,
  source: string,
  rows: BaseStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_tenders', source, BASE_TENDER_COLS, rows);
}

export async function upsertBaseAmendmentStaging(
  db: D1Database,
  source: string,
  rows: BaseStagingRow[],
): Promise<number> {
  return upsertStagingRows(db, 'raw_amendments', source, BASE_AMENDMENT_COLS, rows);
}
