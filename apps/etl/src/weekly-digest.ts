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
  isoWeekFromId,
  MAX_RATIO_MAGNITUDE,
  persistReport,
  priorIsoWeek,
  verifyReport,
  type CellFormat,
  type CellRef,
  type EmitBlock,
  type EmitReportInput,
  type GenerateFn,
  type IsoWeek,
  type QueryResult,
} from '@sigma/report';
import { CPV_SECTORS } from '@sigma/config';
import { date } from '@sigma/shared';

// CPV division code → a short, human-readable Bulgarian sector name, so the narrative prompt can hand
// BgGPT the sector NAME directly (e.g. „Строителство", „Медицинско оборудване") instead of a bare 2-digit
// code it would have to decode from the CPV dictionary. Prefers the curated `short` label where one
// exists (§ CPV_SECTORS), else the official division label. An unknown/absent code falls back to the raw
// code so the prompt never silently drops the sector.
const SECTOR_LABEL = new Map(CPV_SECTORS.map((s) => [s.code, s.short ?? s.label]));
function sectorLabel(division: string): string {
  return SECTOR_LABEL.get(division) ?? `CPV раздел ${division}`;
}

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
  /** BgGPT provider key, forwarded upstream through the AI Gateway. Same secret name the web assistant
   *  uses (apps/web ASSISTANT_API_KEY) so both workers share one credential name. Optional: unset →
   *  the digest still publishes AI-free. */
  ASSISTANT_API_KEY?: string;
  /** DIAGNOSTIC (dev-only, revert before merge): when truthy, log the generated narrative text and the
   *  verifier's raw response so a verifier-strip can be attributed to a bad narrative vs an over-eager
   *  verdict. Fail-dark like the other flags — unset/absent → no model prose ever reaches the logs. */
  DIGEST_DEBUG?: string;
}

export interface GenerateWeeklyDigestDeps {
  /** Injectable clock — stamps `refreshed_at`/`createdAt` and resolves "prior ISO week". Defaults to `new Date()`. */
  now?: Date;
  /** Injectable LLM call (verifier.ts's `GenerateFn`) — tests pass a mock; production builds one from
   *  `env` lazily (never constructed on a skip/zero-row path, so a test that never reaches the LLM step
   *  can omit both `AI_GATEWAY_BASE_URL` and this override without ever touching the network). */
  generate?: GenerateFn;
  /** Operator override (on-demand trigger / tests): generate for this explicit ISO week (`YYYY-Www`)
   *  instead of the week before `now`. The same gates (settled-week, zero-row) still apply to it. */
  targetIso?: string;
}

const DEFAULT_MODEL = 'google/gemma-4-31b-it';
// v2: the narrative is no longer a bare number-free one-liner — it may name the leading sector,
// authority and the largest contract's parties and describe the week's direction (still no MATERIAL
// numbers in prose; those stay server-bound in the tables). Bumped so the stored provenance distinguishes
// the two prompt generations.
const DIGEST_PROMPT_VERSION = 'weekly-digest-v2';
// The fixed, server-owned "question" shown on the digest report (§4/§9.1: passing it via
// `BindOptions.question` means bindReport does NOT gate it for material numbers — there is no
// model-authored question here to gate).
const DIGEST_QUESTION = 'Седмичен дайджест на обществените поръчки в България';
// Narrative regeneration budget: one initial attempt + one retry. A risk-scaled, tool-less prose call
// (like the verifier) does not warrant an unbounded retry loop — if the model cannot produce a
// number-free lead paragraph twice, the AI-free fallback (data blocks only) is strictly safer than a
// third attempt at the same cost.
const MAX_NARRATIVE_ATTEMPTS = 2;
// Verifier call timeout (mirrors apps/web's `VERIFIER_TIMEOUT_MS`): a hung gateway call fail-closes the
// verifier (stripping risk prose) rather than stalling the cron. Verdicts need only a few hundred tokens.
const VERIFIER_TIMEOUT_MS = 20_000;
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
// Mirrors apps/web/app/lib/assistant/agent.ts's `buildModel`: `createOpenAI` pointed at the Cloudflare
// AI Gateway's OpenAI-compatible endpoint, fail-closed when the gateway URL is unset (never call a
// provider directly — that would bypass the gateway's logging/cost accounting). This is the only
// etl-local model-wiring code; `verifyReport`'s validators, gates and strip logic are reused unchanged
// from `@sigma/report`, not duplicated here.

// BgGPT (`bggpt-gemma4-31b-it-*`) is a reasoning fine-tune that, by default, emits its entire
// chain-of-thought as PLAIN CONTENT (a "thought\n* …" preamble plus drafts, not a structured
// `reasoning_content` field the AI SDK could split off) — so `result.text` is the raw scratchpad, not
// the answer, and the token cap truncates before the real sentence. A `/no_think` prompt directive does
// NOT suppress it on this model (verified against the gateway); the vLLM `chat_template_kwargs.
// enable_thinking=false` body field DOES, yielding a single clean sentence. The AI SDK OpenAI provider
// has no passthrough for non-standard body fields, so we inject it via a fetch wrapper on the provider.
//
// Applied to BOTH generators. The narrative needs it for a clean sentence. The VERIFIER needs it for a
// DIFFERENT reason: with thinking ON, BgGPT's reasoning is nondeterministically long and, on a
// data-heavy week, eats the whole token budget before it emits the JSON verdict object — the verifier
// then returns "no JSON object", fail-closes, and strips everything (observed on a real settled week).
// Thinking-off is the only config that makes the verifier's JSON reliable.
function noThinkFetch(): typeof fetch {
  return (input, init) => {
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        body.chat_template_kwargs = {
          ...(body.chat_template_kwargs as Record<string, unknown> | undefined),
          enable_thinking: false,
        };
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        // A non-JSON body should never reach a chat/completions call; pass it through untouched.
      }
    }
    return fetch(input, init);
  };
}

/** The shared AI-Gateway provider for the digest's two model calls (narrative + verifier). Fail-closed
 *  when the gateway URL is unset, and thinking-suppressed via {@link noThinkFetch} — the narrative needs
 *  a clean sentence, the verifier needs reliable JSON (see noThinkFetch for why thinking breaks each). */
function createDigestProvider(env: WeeklyDigestEnv) {
  const baseURL = env.AI_GATEWAY_BASE_URL?.trim();
  if (!baseURL) {
    throw new Error(
      'AI_GATEWAY_BASE_URL is not set — refusing to reach the model provider outside the Cloudflare AI Gateway',
    );
  }
  return createOpenAI({ baseURL, apiKey: env.ASSISTANT_API_KEY, fetch: noThinkFetch() });
}

export function buildDigestGenerate(env: WeeklyDigestEnv): GenerateFn {
  const model = createDigestProvider(env).chat(env.ASSISTANT_MODEL || DEFAULT_MODEL);
  return async ({ system, prompt }) => {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0.3,
      maxRetries: 0,
      maxOutputTokens: 512,
    });
    return result.text;
  };
}

// The verifier is a SEPARATE closure from the narrative generator above — role ④ needs a strict JSON
// verdict object, not prose, so it mirrors apps/web's `buildVerifierGenerate` EXACTLY: temperature 0
// (deterministic — a small quantized model at 0.3 drifts into prose and returns no JSON object at all,
// which fail-closes and strips the very narrative we just generated) and a 1024-token cap so a
// multi-claim verdict list is never truncated. A 20s timeout bounds a hung gateway call: verifyReport
// fail-closes on the reject, stripping risk prose rather than hanging the cron. Reusing the narrative's
// 0.3/512 generator here was the drift bug that kept the summary from ever surviving verification.
export function buildDigestVerifierGenerate(env: WeeklyDigestEnv): GenerateFn {
  const model = createDigestProvider(env).chat(env.ASSISTANT_MODEL || DEFAULT_MODEL);
  return async ({ system, prompt }) => {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: 1024,
      abortSignal: AbortSignal.timeout(VERIFIER_TIMEOUT_MS),
    });
    return result.text;
  };
}

const DIGEST_SYSTEM_PROMPT = [
  'Пишеш кратък въвеждащ текст (едно до две изречения) на български за автоматичен седмичен ' +
    'дайджест на обществени поръчки в България. Текстът е лидът над таблиците — направи го ' +
    'информативен, а не общ.',
  'ЗАДЪЛЖИТЕЛНИ ПРАВИЛА:',
  '1. МОЖЕШ да назоваваш: посоката на промяната спрямо предходната седмица (нарастване/спад/без ' +
    'промяна), водещия сектор, водещия възложител и страните по най-голямата поръчка — точно както ' +
    'са ти подадени по-долу. Използвай ги, за да кажеш нещо конкретно за седмицата.',
  '2. НЕ пиши СЪЩЕСТВЕНИ числа в текста — суми, милиони/милиарди, проценти, групирани числа или ' +
    'дати. Тези стойности вече са показани в таблиците на справката; изречение със сума или процент ' +
    'ще бъде отхвърлено автоматично. Описвай качествено („нарастване", „водещ сектор"), не с цифри.',
  '3. Тон: неутрален, описателен — „сигнали, не присъди". Не квалифицирай възложители или ' +
    'изпълнители като виновни, корумпирани или подозрителни; описвай само какво е било подписано.',
  '4. Обикновен текст, без markdown синтаксис (без **, #, списъци).',
  '5. Отговори САМО с текста — без увод, без обяснение.',
  '\nРечник на CPV разделите за коректно назоваване на сектори:\n' + cpvReference(),
].join('\n');

function buildNarrativePrompt(data: WeeklyDigestData): string {
  const direction =
    data.delta.deltaEur > 0 ? 'нарастване' : data.delta.deltaEur < 0 ? 'спад' : 'без промяна';
  const topSector = data.sectors[0] ?? null;
  const topAuthority = data.authorities[0] ?? null;
  const lines = [
    `Изминалата седмица (${data.isoWeek}) спрямо предходната: ${direction} на подписаната стойност.`,
    topSector
      ? `Водещ сектор по подписана стойност: ${sectorLabel(topSector.division)} (CPV раздел ${topSector.division}).`
      : 'Няма ясно доминиращ сектор тази седмица.',
    topAuthority
      ? `Възложителят с най-много подписана стойност е „${topAuthority.authorityName}".`
      : 'Няма ясно доминиращ възложител тази седмица.',
    data.largest
      ? `Най-голямата отделна поръчка е спечелена от изпълнителя „${data.largest.bidderName}".`
      : 'Няма договор с потвърдена (value_flag=ok) стойност през седмицата.',
    // The largest contract's subject often carries a magnitude ("Доставка на 12 000 тона…") that would
    // trip the binder's material-number gate if the model quoted it verbatim; feed only the named parties
    // above and steer the model off the raw subject line.
    'Не цитирай предмета на договора дословно и не пиши никакви суми, проценти или брой — опиши седмицата качествено.',
    'Напиши въвеждащия текст сега (едно до две изречения).',
  ];
  return lines.join('\n');
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

  return results;
}

/** Build the model-facing EmitReportInput. `narrativeMd` null ⇒ AI-free fallback (no text block, no
 *  model-authored prose anywhere but the fixed title/methodology strings this module itself owns). */
function buildEmitInput(
  data: WeeklyDigestData,
  narrativeMd: string | null,
  target: IsoWeek,
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

  blocks.push({ type: 'callout', title: METHODOLOGY_CALLOUT_TITLE, md: METHODOLOGY_CALLOUT_MD });

  // Human-readable Mon–Sun range (e.g. „06.07.2026 – 12.07.2026") in place of the raw ISO week id. The
  // machine week id (target.iso) still keys the R2 object + weekly_digests row; only the heading changes.
  const range = `${date(target.mondayIso)} – ${date(target.sundayIso)}`;
  return { title: `Седмичен дайджест — ${range}`, question: DIGEST_QUESTION, blocks };
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
  const target = deps.targetIso ? isoWeekFromId(deps.targetIso) : priorIsoWeek(now);

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
  const emitInput0 = buildEmitInput(data, null, target);

  // Past every skip gate — safe to materialize the real LLM call now (never built/called on an
  // unsettled-week, zero-contracts, or sanity-failed path above).
  const generateFn: GenerateFn = deps.generate ?? buildDigestGenerate(env);

  // DIAGNOSTIC (dev-only): fail-dark model-prose logging. See WeeklyDigestEnv.DIGEST_DEBUG.
  const debug = digestEnabled(env.DIGEST_DEBUG);

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
    const trial = bindReport(buildEmitInput(data, candidate, target), results, {
      question: DIGEST_QUESTION,
    });
    if (trial.ok) {
      narrativeMd = candidate;
      if (debug) log('etl_digest_debug_narrative', { isoWeek: target.iso, attempt, narrative: candidate });
      break;
    }
    log('etl_digest_narrative_rejected', { isoWeek: target.iso, attempt, errors: trial.errors });
  }

  const emitInput = narrativeMd ? buildEmitInput(data, narrativeMd, target) : emitInput0;
  const bound = bindReport(emitInput, results, { question: DIGEST_QUESTION });
  if (!bound.ok) {
    // The AI-free fallback (no model prose beyond this module's own fixed strings) must always bind —
    // if it doesn't, that's a producer bug, not a data problem. Log loudly and skip publishing rather
    // than persist a report the binder itself rejected.
    logError('etl_digest_fallback_bind_failed', { isoWeek: target.iso, errors: bound.errors });
    return;
  }

  // Role ④ runs on its OWN generator (temp 0, JSON-reliable) — NOT the narrative's `generateFn` (temp
  // 0.3). A test that injects `deps.generate` drives both from that one mock (unchanged); production
  // splits them so the verifier gets deterministic JSON. See buildDigestVerifierGenerate.
  const baseVerifierGenerate: GenerateFn = deps.generate ?? buildDigestVerifierGenerate(env);
  // DIAGNOSTIC (dev-only): capture the verifier's raw response so a strip can be read as "the model
  // returned this verdict" rather than inferred from strippedClaimIds. Wraps, never replaces, the real
  // generator; off unless DIGEST_DEBUG is set.
  const verifierGenerate: GenerateFn = debug
    ? async (input) => {
        const out = await baseVerifierGenerate(input);
        log('etl_digest_debug_verifier_raw', { isoWeek: target.iso, raw: out.slice(0, 4000) });
        return out;
      }
    : baseVerifierGenerate;
  const verified = await verifyReport(bound.report, verifierGenerate);

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
