export * from './schema';
export * from './queries';

import type { RiskScoreRow } from './schema';

export async function upsertRiskScore(db: D1Database, row: RiskScoreRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO risk_scores (tender_id, score, band, signals, computed_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(tender_id) DO UPDATE SET
         score = excluded.score,
         band = excluded.band,
         signals = excluded.signals,
         computed_at = excluded.computed_at`,
    )
    .bind(row.tender_id, row.score, row.band, row.signals, row.computed_at)
    .run();
}
