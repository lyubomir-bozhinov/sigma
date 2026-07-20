// Shared weekly-digest report assembly. These builders turn a deterministic `WeeklyDigestData`
// (from `@sigma/db`) into the report's result sets + emit blocks. They were previously private to the
// ETL producer (`apps/etl/src/weekly-digest.ts`); they live here so the consumer's on-demand,
// AI-free build path (`apps/web`) reuses exactly the same block layout the cron producer emits —
// there is one source of truth for the digest's shape, not two that can drift.
//
// Nothing here calls a model. `buildEmitInput(data, null)` emits NO `text` block, so an AI-free
// digest carries no model-authored claims and needs no verifier LLM pass (see `buildDataOnlyDigest`).

import type {
  WeeklyAuthoritySlice,
  WeeklyDigestData,
  WeeklySectorSlice,
  WeeklyTopContract,
} from '@sigma/db';
import type { StoredReport } from './contract';
import { buildStoredReport } from './persist';
import {
  bindReport,
  type CellFormat,
  type CellRef,
  type EmitBlock,
  type EmitReportInput,
  type QueryResult,
} from './report-schema';

// The fixed, server-owned "question" shown on the digest report (§4/§9.1: passing it via
// `BindOptions.question` means bindReport does NOT gate it for material numbers — there is no
// model-authored question here to gate).
export const DIGEST_QUESTION = 'Седмичен обзор на обществените поръчки в България';

export const DIGEST_PROMPT_VERSION = 'weekly-digest-v2'; // v2: 3–4 paragraph „Какво се случи" narrative (§3.3)

const METHODOLOGY_CALLOUT_TITLE = 'Как е изчислено';
const METHODOLOGY_CALLOUT_MD =
  'Изчислено от чисти (amount_eur ненулеви) договори, подписани в рамките на пълна календарна ' +
  'седмица (понеделник–неделя). Справката е автоматично генерирана — сигнали, не присъди: цифрите ' +
  'показват какво е подписано, не приписват вина или намерение.';

export function buildQueryResults(data: WeeklyDigestData): QueryResult[] {
  const results: QueryResult[] = [
    {
      handle: 'R1',
      columns: [
        'total_eur',
        'contracts',
        'contracts_with_amount',
        'tenders',
        'delta_eur',
        'delta_pct',
        'prior_total_eur',
        'single_bid_rate',
      ],
      rows: [
        [
          data.total.totalEur,
          data.counts.contracts,
          data.counts.contractsWithAmount,
          data.counts.tenders,
          data.delta.deltaEur,
          data.delta.deltaPct,
          data.delta.priorEur,
          data.singleBidRate.rate,
        ],
      ],
    },
  ];

  if (data.largest) {
    const l = data.largest;
    results.push({
      handle: 'R2',
      columns: [
        'contract_slug',
        'tender_unp',
        'authority_slug',
        'bidder_slug',
        'bidder_name',
        'amount_eur',
        'signed_at',
      ],
      rows: [
        [
          l.contractSlug,
          l.tenderUnp,
          l.authoritySlug,
          l.bidderSlug,
          l.bidderName,
          l.amountEur,
          l.signedAt,
        ],
      ],
    });
  }

  results.push({
    handle: 'R3',
    columns: [
      'contract_slug',
      'tender_unp',
      'subject',
      'authority_id',
      'authority_name',
      'bidder_id',
      'bidder_name',
      'amount_eur',
      'signed_at',
    ],
    rows: data.topContracts.map((c: WeeklyTopContract) => [
      c.contractSlug,
      c.tenderUnp,
      c.subject,
      c.authorityId,
      c.authorityName,
      c.bidderId,
      c.bidderName,
      c.amountEur,
      c.signedAt,
    ]),
  });

  results.push({
    handle: 'R4',
    columns: ['division', 'contracts', 'value_eur'],
    rows: data.sectors.map((s: WeeklySectorSlice) => [s.division, s.contracts, s.valueEur]),
  });

  results.push({
    handle: 'R5',
    columns: ['authority_id', 'authority_name', 'contracts', 'value_eur'],
    rows: data.authorities.map((a: WeeklyAuthoritySlice) => [
      a.authorityId,
      a.authorityName,
      a.contracts,
      a.valueEur,
    ]),
  });

  // R6 (this week) + R7 (prior week) — the two 7-day series behind the ghost-bar chart (§3.4).
  results.push({
    handle: 'R6',
    columns: ['day', 'value_eur'],
    rows: data.dailySpend.current.map((d) => [d.label, d.valueEur]),
  });
  results.push({
    handle: 'R7',
    columns: ['day', 'value_eur'],
    rows: data.dailySpend.previous.map((d) => [d.label, d.valueEur]),
  });

  // R8 — competition concentration (§3.8): single-bid vs multi-bid contract counts over the reported
  // sample. Pushed under the SAME guard as the bar block in buildEmitInput (rate !== null, i.e. the
  // sample cleared the reporting floor), so the persisted snapshot never carries a dead result no block
  // references (#81 review, note 1).
  if (data.singleBidRate.rate !== null) {
    const { singleBid, sample } = data.singleBidRate;
    results.push({
      handle: 'R8',
      columns: ['label', 'count'],
      rows: [
        ['С една оферта', singleBid],
        ['С няколко оферти', Math.max(0, sample - singleBid)],
      ],
    });
  }

  return results;
}

/** Build the model-facing EmitReportInput. `narrativeMd` null ⇒ AI-free fallback (no text block, no
 *  model-authored prose anywhere but the fixed title/methodology strings this module itself owns). */
export function buildEmitInput(
  data: WeeklyDigestData,
  narrativeMd: string | null,
): EmitReportInput {
  const blocks: EmitBlock[] = [];
  if (narrativeMd) blocks.push({ type: 'text', md: narrativeMd });

  const totalsItems: { label: string; ref: CellRef; format: CellFormat }[] = [
    { label: 'Обща стойност', ref: { resultId: 'R1', row: 0, col: 'total_eur' }, format: 'money' },
    // Binds the CLEAN-amount count, not the raw volume: this sits next to „Обща стойност" in the same
    // strip, and a (count, sum) shown as one KPI set must cover one row set (precompute.sql's
    // COUNT/SUM CONSISTENCY rule) — else total/count reads as a wrong average contract value.
    {
      label: 'Договори',
      ref: { resultId: 'R1', row: 0, col: 'contracts_with_amount' },
      format: 'number',
    },
  ];
  if (data.delta.deltaPct !== null) {
    totalsItems.push({
      label: 'Промяна спрямо предходната седмица',
      ref: { resultId: 'R1', row: 0, col: 'delta_pct' },
      format: 'percent',
    });
  }
  if (data.largest) {
    totalsItems.push({
      label: 'Най-голяма поръчка',
      ref: { resultId: 'R2', row: 0, col: 'amount_eur' },
      format: 'money',
    });
  }
  if (data.singleBidRate.rate !== null) {
    totalsItems.push({
      label: 'Дял с една оферта',
      ref: { resultId: 'R1', row: 0, col: 'single_bid_rate' },
      format: 'percent',
    });
  }
  blocks.push({ type: 'totals', items: totalsItems });

  // Daily spend, this week vs the prior week's ghost bars (§3.4). Always emitted (7 zero-filled slots),
  // so the digest carries a temporal view even on a quiet week.
  blocks.push({
    type: 'weekbars',
    currentId: 'R6',
    previousId: 'R7',
    labelCol: 'day',
    valueCol: 'value_eur',
  });

  if (data.topContracts.length > 0) {
    blocks.push({
      type: 'table',
      resultId: 'R3',
      columns: [
        { key: 'subject', header: 'Предмет', format: 'text' },
        {
          key: 'authority_name',
          header: 'Възложител',
          format: 'text',
          link: { kind: 'authority', idCol: 'authority_id' },
        },
        {
          key: 'bidder_name',
          header: 'Изпълнител',
          format: 'text',
          link: { kind: 'company', idCol: 'bidder_id' },
        },
        { key: 'amount_eur', header: 'Стойност', format: 'money' },
        { key: 'signed_at', header: 'Подписан на', format: 'date' },
      ],
    });
  }

  if (data.sectors.length > 0) {
    blocks.push({
      type: 'bar',
      resultId: 'R4',
      labelCol: 'division',
      valueCol: 'value_eur',
      format: 'money',
    });
  }

  if (data.authorities.length > 0) {
    blocks.push({
      type: 'table',
      resultId: 'R5',
      columns: [
        {
          key: 'authority_name',
          header: 'Възложител',
          format: 'text',
          link: { kind: 'authority', idCol: 'authority_id' },
        },
        { key: 'contracts', header: 'Договори', format: 'number' },
        { key: 'value_eur', header: 'Стойност', format: 'money' },
      ],
    });
  }

  // Competition concentration (§3.8): single-bid vs multi-bid contract counts. Only shown when the
  // reported-bid sample clears the floor (rate !== null) — below it the split would swing on a few rows.
  if (data.singleBidRate.rate !== null) {
    blocks.push({
      type: 'bar',
      resultId: 'R8',
      labelCol: 'label',
      valueCol: 'count',
      format: 'number',
    });
  }

  blocks.push({ type: 'callout', title: METHODOLOGY_CALLOUT_TITLE, md: METHODOLOGY_CALLOUT_MD });

  return { title: `Седмичен обзор — ${data.isoWeek}`, question: DIGEST_QUESTION, blocks };
}

/**
 * Build a data-only (AI-free) `StoredReport` from `WeeklyDigestData`, with no model call anywhere.
 *
 * This is the consumer's on-demand fallback: when no artifact exists in R2 for a week, the /weeks
 * loader can synthesize one straight from D1 so the page renders. It is deliberately the SAME content
 * class the cron producer emits when its narrative is stripped/unavailable — `buildEmitInput(data,
 * null)` emits no `text` block, so there are no model claims and the verification is `'skipped'`
 * (exactly what `verifyReport` returns for a claim-free report). Returns `null` if the binder rejects
 * the input (a producer bug, not a data condition) so the caller can 404 rather than serve garbage.
 */
export function buildDataOnlyDigest(
  data: WeeklyDigestData,
  opts: { createdAt: string; asOf: string | null },
): StoredReport | null {
  const results = buildQueryResults(data);
  const bound = bindReport(buildEmitInput(data, null), results, { question: DIGEST_QUESTION });
  if (!bound.ok) return null;
  return buildStoredReport({
    id: data.isoWeek,
    createdAt: opts.createdAt,
    report: bound.report,
    question: DIGEST_QUESTION,
    sources: results.map((r) => ({ handle: r.handle, tool: 'weekly_digest_query' })),
    snapshot: results,
    // `asOf` is the admin data-settlement date; when the caller can't supply it, fall back to the
    // build timestamp so the freshness field is always a concrete date (SourceFreshness requires one).
    freshness: [{ source: 'admin', asOf: opts.asOf ?? opts.createdAt }],
    model: 'none (ai-free fallback)',
    promptVersion: DIGEST_PROMPT_VERSION,
    verification: { status: 'skipped', strippedClaimIds: [], uncertainClaimIds: [] },
  });
}
