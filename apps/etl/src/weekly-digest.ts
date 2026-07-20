import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import {
  getWeeklyDigestData,
  reconcileWeeklyTotal,
  type WeeklyAuthoritySlice,
  type WeeklyDigestData,
  type WeeklySectorSlice,
  type WeeklyTopContract,
} from '@sigma/db';
import {
  bindReport,
  buildStoredReport,
  cpvReference,
  MAX_RATIO_MAGNITUDE,
  persistReport,
  priorIsoWeek,
  verifyReport,
  type CellFormat,
  type CellRef,
  type EmitBlock,
  type EmitReportInput,
  type GenerateFn,
  type QueryResult,
} from '@sigma/report';

// Weekly Digest producer (#167A T3) — the Monday cron that turns the prior ISO week's `@sigma/db`
// weekly queries into an immutable `StoredReport` at `weeks/{ISO}.json`. Mirrors suggested-prompts.ts's
// shape (`home_totals.as_of` anchor, reconciliation tripwire, UPSERT, structured `log()`), plus the one
// genuinely net-new lift: a single BgGPT/AI-Gateway `generateText` call for the digest's lead
// narrative. The narrative is the ONLY model-authored surface — every figure in the report is a
// server-bound reference into the deterministic result sets built below (spec §4's "model never writes
// data values", inherited unchanged from the chat pipeline's `bindReport`).

export interface WeeklyDigestEnv {
  DB: D1Database;
  REPORTS: R2Bucket;
  AI_GATEWAY_BASE_URL?: string;
  ASSISTANT_MODEL?: string;
  BGGPT_API_KEY?: string;
}

export interface GenerateWeeklyDigestDeps {
  /** Injectable clock — stamps `refreshed_at`/`createdAt` and resolves "prior ISO week". Defaults to `new Date()`. */
  now?: Date;
  /** Injectable LLM call (verifier.ts's `GenerateFn`) — tests pass a mock; production builds one from
   *  `env` lazily (never constructed on a skip/zero-row path, so a test that never reaches the LLM step
   *  can omit both `AI_GATEWAY_BASE_URL` and this override without ever touching the network). */
  generate?: GenerateFn;
}

const DEFAULT_MODEL = 'google/gemma-4-31b-it';
const DIGEST_PROMPT_VERSION = 'weekly-digest-v2'; // v2: 3–4 paragraph „Какво се случи" narrative (§3.3)
// The fixed, server-owned "question" shown on the digest report (§4/§9.1: passing it via
// `BindOptions.question` means bindReport does NOT gate it for material numbers — there is no
// model-authored question here to gate).
const DIGEST_QUESTION = 'Седмичен дайджест на обществените поръчки в България';
// Narrative regeneration budget: one initial attempt + one retry. A risk-scaled, tool-less prose call
// (like the verifier) does not warrant an unbounded retry loop — if the model cannot produce a
// number-free lead paragraph twice, the AI-free fallback (data blocks only) is strictly safer than a
// third attempt at the same cost.
const MAX_NARRATIVE_ATTEMPTS = 2;
const METHODOLOGY_CALLOUT_TITLE = 'Как е изчислено';
const METHODOLOGY_CALLOUT_MD =
  'Изчислено от чисти (amount_eur ненулеви) договори, подписани в рамките на пълна календарна ' +
  'седмица (понеделник–неделя). Справката е автоматично генерирана — сигнали, не присъди: цифрите ' +
  'показват какво е подписано, не приписват вина или намерение.';

// Master kill switch (mirrors apps/web/app/lib/assistant/enabled.ts's `assistantEnabled` fail-dark
// posture): an unset/absent var reads as OFF, the safe default for a producer that writes
// public-facing artifacts. Exported (rather than kept in index.ts, which imports `cloudflare:workers`
// and so cannot be unit-tested under plain vitest) so the dispatch gate itself is directly testable.
export function digestEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...extra }));
}

function logError(event: string, extra: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...extra }));
}

// ── LLM wiring (net-new — apps/etl has no model builder today) ──────────────────────────────────────
//
// Mirrors apps/web/app/lib/assistant/agent.ts's `buildModel` EXACTLY: `createOpenAI` pointed at the
// Cloudflare AI Gateway's OpenAI-compatible endpoint, fail-closed when the gateway URL is unset (never
// call a provider directly — that would bypass the gateway's logging/cost accounting). This is the only
// etl-local model-wiring code; `verifyReport`'s validators, gates and strip logic are reused unchanged
// from `@sigma/report`, not duplicated here.
function buildDigestGenerate(env: WeeklyDigestEnv): GenerateFn {
  const baseURL = env.AI_GATEWAY_BASE_URL?.trim();
  if (!baseURL) {
    throw new Error(
      'AI_GATEWAY_BASE_URL is not set — refusing to reach the model provider outside the Cloudflare AI Gateway',
    );
  }
  const provider = createOpenAI({ baseURL, apiKey: env.BGGPT_API_KEY });
  const model = provider.chat(env.ASSISTANT_MODEL || DEFAULT_MODEL);
  return async ({ system, prompt }) => {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0.3,
      maxRetries: 0,
      maxOutputTokens: 900, // room for a 3–4 paragraph „Какво се случи" narrative (spec §3.3)
    });
    return result.text;
  };
}

const DIGEST_SYSTEM_PROMPT = [
  'Пишеш кратък неутрален разказ „Какво се случи" от 3 до 4 абзаца на български за автоматичен ' +
    'седмичен дайджест на обществените поръчки в България. Обясни на достъпен език какво се е ' +
    'случило през седмицата: движението на подписаната стойност спрямо предходната седмица, кои ' +
    'сектори водят, каква е картината на конкуренцията и дали изпъква отделен голям договор.',
  'ЗАДЪЛЖИТЕЛНИ ПРАВИЛА:',
  '1. НИКОГА не пиши конкретни суми, брой договори, проценти, дати или други числа — те вече са ' +
    'показани в таблиците и графиките на справката; абзац с число ще бъде отхвърлен автоматично. ' +
    'Използвай думи като „нарасна", „спадна", „водещ", „значителен дял", а не стойности.',
  '2. Тон: неутрален, описателен — „сигнали, не присъди". Не квалифицирай възложители или ' +
    'изпълнители като виновни, корумпирани или подозрителни; описвай само какво е било подписано.',
  '3. Всеки абзац е отделен, разделен с празен ред. Обикновен текст, без markdown синтаксис ' +
    '(без **, #, списъци, заглавия).',
  '4. Назовавай секторите с думи по речника по-долу (напр. „строителство"), не с CPV кодове.',
  '5. Отговори САМО с разказа — без увод, без обяснение, без заглавие.',
  '\nРечник на CPV разделите за коректно назоваване на сектори:\n' + cpvReference(),
].join('\n');

function buildNarrativePrompt(data: WeeklyDigestData): string {
  const direction =
    data.delta.deltaEur > 0
      ? 'подписаната стойност нарасна спрямо предходната седмица'
      : data.delta.deltaEur < 0
        ? 'подписаната стойност спадна спрямо предходната седмица'
        : 'подписаната стойност е без съществена промяна спрямо предходната седмица';
  const topSectors = data.sectors.slice(0, 3).map((s) => s.division);
  const sectorLine =
    topSectors.length > 0
      ? `Водещи CPV раздели по подписана стойност (назови ги по речника): ${topSectors.join(', ')}.`
      : 'Няма ясно доминиращ сектор тази седмица.';
  // Bucket the single-bid rate into a QUALITATIVE description — never the number itself (§2 gate).
  const rate = data.singleBidRate.rate;
  const competition =
    rate === null
      ? 'Извадката с отчетени оферти е малка, затова изводът за конкуренцията е предпазлив.'
      : rate >= 0.4
        ? 'Голям дял от поръчките са възложени с една оферта — слаба ценова конкуренция.'
        : rate >= 0.2
          ? 'Умерен дял от поръчките са с една оферта.'
          : 'Малък дял с една оферта — преобладават състезателни процедури.';
  return [
    `Изминалата седмица е ${data.isoWeek}. ${direction}.`,
    sectorLine,
    competition,
    data.largest
      ? 'През седмицата изпъква поне един голям единичен договор.'
      : 'Няма отделен голям договор с потвърдена стойност през седмицата.',
    '',
    'Напиши разказа „Какво се случи" (3–4 абзаца) сега, без числа.',
  ].join('\n');
}

// ── Deterministic evidence (server-built — the model never sees or fills these rows) ────────────────

function buildQueryResults(data: WeeklyDigestData): QueryResult[] {
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
function buildEmitInput(data: WeeklyDigestData, narrativeMd: string | null): EmitReportInput {
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

  return { title: `Седмичен дайджест — ${data.isoWeek}`, question: DIGEST_QUESTION, blocks };
}

// ── Sanity gates (never persist an unvalidated number) ───────────────────────────────────────────────

function sanityErrors(data: WeeklyDigestData): string[] {
  const errors: string[] = [];
  if (data.total.totalEur < 0) errors.push(`total_eur is negative (${data.total.totalEur})`);
  if (data.largest && data.largest.amountEur > data.total.totalEur) {
    errors.push(
      `largest contract (${data.largest.amountEur}) exceeds the week's total (${data.total.totalEur})`,
    );
  }
  if (data.delta.deltaPct !== null && Math.abs(data.delta.deltaPct) > MAX_RATIO_MAGNITUDE) {
    errors.push(`week-over-week delta (${data.delta.deltaPct}) exceeds a plausible magnitude`);
  }
  return errors;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Refresh the Monday weekly digest. Anchored on `home_totals.as_of` (GATE 1: the target week must be
 * fully SETTLED — ADR-0007's posture, applied to a fixed Mon–Sun week instead of a recency-caveat
 * period), then GATE 2 short-circuits a genuinely empty week with NO LLM call and NO R2 write (the
 * `/weeks/{iso}` route stays 404 rather than publishing an empty shell). `now` and `generate` are
 * injectable for tests; production builds `generate` from `env` lazily so a test that never reaches the
 * LLM step needs neither the AI Gateway vars nor a mock.
 */
export async function generateWeeklyDigest(
  env: WeeklyDigestEnv,
  deps: GenerateWeeklyDigestDeps = {},
): Promise<void> {
  const now = deps.now ?? new Date();
  const target = priorIsoWeek(now);

  const totals = await env.DB.prepare(
    'SELECT value_eur AS value_eur, as_of AS as_of FROM home_totals WHERE id = 1',
  ).first<{ value_eur: number | null; as_of: string | null }>();
  const asOf = totals?.as_of ?? null;
  if (asOf === null) {
    log('etl_digest_no_asof', { isoWeek: target.iso });
    return;
  }

  // GATE 1 (settled week, ADR-0007 posture): the week's Sunday must already be covered by the data —
  // else the week is still accumulating and would render an undercounted digest. Skip; the following
  // Monday's cron will have moved on to the NEXT week (this week is not retried automatically — a
  // manual/backfill invocation with an explicit `now` is the reissue path; see module comment risk note).
  if (asOf < target.sundayIso) {
    log('etl_digest_week_unsettled', { isoWeek: target.iso, asOf, sundayIso: target.sundayIso });
    return;
  }

  const data = await getWeeklyDigestData(env.DB, target.iso);

  // GATE 2 (zero-row short-circuit): a genuinely empty week gets NO LLM call and NO R2 write — the
  // security-critical guarantee this producer must never regress.
  if (data.counts.contracts === 0) {
    log('etl_digest_zero_contracts', { isoWeek: target.iso, asOf });
    return;
  }

  const reconciliation = await reconcileWeeklyTotal(env.DB, target.iso);

  const sanity = sanityErrors(data);
  if (sanity.length > 0) {
    logError('etl_digest_sanity_failed', { isoWeek: target.iso, errors: sanity });
    return;
  }

  const results = buildQueryResults(data);
  const emitInput0 = buildEmitInput(data, null);

  // Past every skip gate — safe to materialize the real LLM call now (never built/called on an
  // unsettled-week, zero-contracts, or sanity-failed path above).
  const generateFn: GenerateFn = deps.generate ?? buildDigestGenerate(env);

  let narrativeMd: string | null = null;
  let narrativeAttempts = 0;
  for (let attempt = 1; attempt <= MAX_NARRATIVE_ATTEMPTS; attempt++) {
    narrativeAttempts = attempt;
    let raw: string;
    try {
      raw = await generateFn({
        system: DIGEST_SYSTEM_PROMPT,
        prompt: buildNarrativePrompt(data),
      });
    } catch (error) {
      log('etl_digest_narrative_call_failed', {
        isoWeek: target.iso,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const candidate = raw.trim();
    if (!candidate) {
      // Distinct from the throw/reject branches: an empty-after-trim response must not be silent, or
      // it reads in the logs as "the LLM step never ran". Fail loud, then fall through to the retry.
      log('etl_digest_narrative_empty', { isoWeek: target.iso, attempt });
      continue;
    }
    const trial = bindReport(buildEmitInput(data, candidate), results, {
      question: DIGEST_QUESTION,
    });
    if (trial.ok) {
      narrativeMd = candidate;
      break;
    }
    log('etl_digest_narrative_rejected', { isoWeek: target.iso, attempt, errors: trial.errors });
  }

  const emitInput = narrativeMd ? buildEmitInput(data, narrativeMd) : emitInput0;
  const bound = bindReport(emitInput, results, { question: DIGEST_QUESTION });
  if (!bound.ok) {
    // The AI-free fallback (no model prose beyond this module's own fixed strings) must always bind —
    // if it doesn't, that's a producer bug, not a data problem. Log loudly and skip publishing rather
    // than persist a report the binder itself rejected.
    logError('etl_digest_fallback_bind_failed', { isoWeek: target.iso, errors: bound.errors });
    return;
  }

  const verified = await verifyReport(bound.report, generateFn);

  const existing = await env.DB.prepare('SELECT iso_week FROM weekly_digests WHERE iso_week = ?1')
    .bind(target.iso)
    .first<{ iso_week: string }>();

  const refreshedAt = now.toISOString();
  // A narrative that BOUND but was then fully stripped by the verifier leaves an artifact with no
  // surviving model prose — the same content class as the AI-free fallback, so it must carry the same
  // labels. Keying on `narrativeMd` alone would advertise a model-authored digest whose model text is
  // gone (the archive index reads `status`, and `provenance.model` names a model that wrote nothing
  // that survived). A PARTIAL strip still leaves prose, so the text block's survival is the test.
  const narrativeSurvived =
    narrativeMd !== null && verified.report.blocks.some((b) => b.type === 'text');
  const status = existing ? 'коригирано' : narrativeSurvived ? 'ok' : 'fallback';

  const stored = buildStoredReport({
    id: target.iso,
    createdAt: refreshedAt,
    report: verified.report,
    question: DIGEST_QUESTION,
    sources: results.map((r) => ({ handle: r.handle, tool: 'weekly_digest_query' })),
    snapshot: results,
    freshness: [{ source: 'admin', asOf }],
    model: narrativeSurvived ? env.ASSISTANT_MODEL || DEFAULT_MODEL : 'none (ai-free fallback)',
    promptVersion: DIGEST_PROMPT_VERSION,
    verification: {
      status: verified.status,
      strippedClaimIds: verified.strippedClaimIds,
      uncertainClaimIds: verified.uncertainClaimIds,
      ...(verified.errors ? { errors: verified.errors } : {}),
    },
  });

  const key = `weeks/${target.iso}.json`;
  await persistReport(env.REPORTS, key, stored, { immutable: true });

  try {
    await env.DB.prepare(
      `INSERT INTO weekly_digests (iso_week, as_of, refreshed_at, status, total_eur)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(iso_week) DO UPDATE SET
         as_of = excluded.as_of,
         refreshed_at = excluded.refreshed_at,
         status = excluded.status,
         total_eur = excluded.total_eur`,
    )
      .bind(target.iso, asOf, refreshedAt, status, data.total.totalEur)
      .run();
  } catch (error) {
    logError('etl_digest_upsert_failed', {
      isoWeek: target.iso,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  log('etl_digest_written', {
    isoWeek: target.iso,
    key,
    status,
    narrativeAttempts,
    narrativeUsed: narrativeMd !== null,
    verificationStatus: verified.status,
    reconciliationWithinBounds: reconciliation.withinBounds,
  });
}
