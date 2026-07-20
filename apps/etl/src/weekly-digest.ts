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
  buildEmitInput,
  buildQueryResults,
  buildStoredReport,
  cpvReference,
  DIGEST_PROMPT_VERSION,
  DIGEST_QUESTION,
  MAX_RATIO_MAGNITUDE,
  persistReport,
  priorIsoWeek,
  verifyReport,
  type GenerateFn,
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
// `DIGEST_QUESTION`, `DIGEST_PROMPT_VERSION` and the deterministic report builders
// (`buildQueryResults`/`buildEmitInput`) now live in `@sigma/report` so the consumer's on-demand,
// AI-free build path reuses the exact same block layout this cron producer emits (one source of truth).
// Narrative regeneration budget: one initial attempt + one retry. A risk-scaled, tool-less prose call
// (like the verifier) does not warrant an unbounded retry loop — if the model cannot produce a
// number-free lead paragraph twice, the AI-free fallback (data blocks only) is strictly safer than a
// third attempt at the same cost.
const MAX_NARRATIVE_ATTEMPTS = 2;

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
    'седмичен обзор на обществените поръчки в България. Обясни на достъпен език какво се е ' +
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
