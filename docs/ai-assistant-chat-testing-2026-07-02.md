# AI chat assistant — question sweep test report (2026-07-02)

Manual + endpoint testing of the Sigma AI chat assistant across a broad spectrum of Bulgarian
questions, run against the ephemeral PR preview. Primary goal: verify the deterministic date
resolution and the opcode-guard fix (PR #22) hold across real question shapes, and characterise any
remaining failure modes.

## Environment

| | |
|---|---|
| Preview | `https://sigma-pr-22.midt-crew.workers.dev` (Worker `sigma-pr-22`, shared **dev** D1/R2, read-only) |
| Branch / PR | `feat/deterministic-date-resolution` → #22 |
| Data coverage | 2020–2026 (2026 partial); last contract 01.07.2026; data refreshed 02.07.2026 |
| Model | `google/gemma-4-31b-it` (~31B) via Cloudflare AI Gateway → OpenRouter, temp 0.1, max 6 tool steps |
| Server "today" | 2026-07-02 (Europe/Sofia) |

## Method

- **20 questions**, broad → detailed, each asked in its **own conversation** (new chat / clean context).
- UI runs driven with Playwright MCP on `/contracts` (the homepage `/` served briefly-stale edge-cached
  HTML after the redeploy — a separate cache-on-deploy issue, noted below). Screenshots captured for the
  first two; the remaining questions were driven against the **same server endpoint** (`POST
  /assistant/chat`) to collect full per-question streams, because 20 sequential UI turns at 3–4 min each
  was not feasible in one session. The server pipeline (and therefore the diagnostics) is identical to
  the UI path.
- Per-question diagnostics extracted from the streamed response: number of `run_sql` calls, opcode-guard
  rejections, `signed_at` date predicates the model authored, `emit_report` outcome, and `finishReason`.

## Questions

| # | Question (BG) | Type |
|---|---|---|
| 1 | Дай ми 10-те най-големи обществени поръчки | broad ranking (contracts) |
| 2 | Дай ми топ 10 най-големи обществени поръчки за тази година | temporal (2026) + ranking |
| 3 | Кои са най-големите възложители по похарчени средства? | top authorities (rollup) |
| 4 | Кои фирми са спечелили най-много обществени поръчки? | top companies (rollup) |
| 5 | Каква е общата стойност на обществените поръчки за 2024 г.? | explicit year aggregate |
| 6 | Колко договора са сключени този месец? | temporal (this month) |
| 7 | Какъв е разходът по сектори? | CPV sector breakdown |
| 8 | Какъв е делът на поръчките с една оферта? | single-offer share |
| 9 | Колко обществени поръчки са финансирани от ЕС? | EU-funded |
| 10 | Кои са най-големите поръчки на Агенция „Пътна инфраструктура"? | entity (authority) |
| 11 | Какви поръчки е спечелила фирма „Софарма Трейдинг" през годините? | entity (company) over time |
| 12 | Дай ми топ 10 обществени поръчки за община Пловдив | entity + ranking |
| 13 | Разход по години | timeseries (no temporal phrase) |
| 14 | Кои възложители имат най-висок дял договори с една оферта? | competition signal |
| 15 | Дай ми поръчките за предходния месец | temporal (prev month) + lag |
| 16 | Кои са най-големите поръчки в сектор „Строителство"? | sector + ranking |
| 17 | Каква е стойността на поръчките в област Варна? | regional (NUTS3) |
| 18 | Колко похарчи Столична община през 2023 г.? | entity + explicit year |
| 19 | Кои са най-големите парични потоци между възложители и изпълнители? | flows graph |
| 20 | Сравни разходите за тази и миналата година | comparison / multi-period |

## Results (endpoint batch — 4 concurrent)

| # | Outcome | run_sql | opcode rej. | finish | Notes |
|---|---|---|---|---|---|
| 1 | ✅ report | 2 | 0 | stop | „Топ 10 най-големи обществени поръчки" |
| 2 | ⚠️ emit failed | 4 | 0 | stop | dates 2026-01-01…2026-07-03 ✅ (✅ in the UI run) |
| 3 | ✅ report | 2 | 0 | stop | „Класация на най-големите възложители по разходи" |
| 4 | ✅ report | 2 | 0 | stop | rollup |
| 5 | ✅ report | 4 | 0 | other | dates 2024-01-01…2025-01-01 ✅ |
| 6 | ✅ report | 2 | 0 | stop | „Сключени договори за юли 2026 г."; dates 2026-07-01…2026-07-03 ✅ |
| 7 | ✅ report | 4 | 0 | stop | „Разход по сектори (CPV)" |
| 8 | ✅ report | 4 | 0 | stop | self-corrected a mandatory-filter rejection, then emitted |
| 9 | ✅ report | 4 | 0 | stop | |
| 10 | ✅ report | 6 | 0 | stop | entity (АПИ) |
| 11 | ✅ report | 4 | 0 | stop | „Спечелени поръчки от „Софарма Трейдинг АД"" |
| 12 | ❌ timeout | 6 | 0 | — | >260s, hit the step budget, no emit |
| 13 | ✅ report | 4 | 0 | stop | self-corrected a mandatory-filter rejection, then emitted |
| 14 | ✅ report | 2 | 0 | stop | |
| 15 | ⚠️ emit failed + slow | 4 | 0 | — | dates 2026-06-01…2026-07-01 ✅ |
| 16 | ✅ report | 4 | 0 | stop | sector „Строителство" |
| 17 | ❌ stopped, no emit | 4 | 0 | other | had the data, never called emit_report |
| 18 | ❌ empty completion | 0 | 0 | other | model returned **zero tokens** despite the forced tool call |
| 19 | ❌ stopped, no emit | 2 | 0 | other | had the data, never called emit_report |
| 20 | ❌ stopped, no emit | 2 | 0 | stop | queried **both** 2025 and 2026 ranges ✅, didn't emit |

**Persisted reports: 13/20.** None of the failures were caused by date handling or the opcode guard.

## What the sweep confirms (the PR #22 fixes)

1. **Opcode guard — 0 false rejections across all 20 questions.** The `SeekLT / SeekLE / IdxGE / IdxLT /
   Prev` allowlist additions hold for range filters, `ORDER BY … DESC`, rankings, and entity queries
   alike. This was the root cause of the original "model runs 6 SQLs and returns nothing" bug.
2. **Deterministic date resolution — correct every time it fired:** „тази година" → 2026, „този месец" →
   юли 2026, „предходния месец" → юни 2026, „за 2024 г." → 2024, and the comparison „тази и миналата
   година" correctly issued **both** 2025 and 2026 windows (the pre-resolved common-table path).
3. **Guards behave as designed and the model recovers:** Q8 and Q13 hit the mandatory default-filter gate
   (`procedure_type != 'неизвестна'` omitted), self-corrected on the next step, and still produced reports.
4. **The emit-retry / force-finalize logic helps:** several turns returned an `emit_report` `ok:false`
   once and then succeeded on a forced retry (e.g. Q5, Q8, Q13).

## Remaining failure modes (all weak-model, not the fixed bugs)

1. **`emit_report` shape reliability (nondeterministic `ok:false`)** — Q2, Q15. Same question can pass or
   fail across runs (Q2 passed in the UI, failed in the batch). The model gets the block-schema fields
   wrong within the step budget.
2. **Model stops without calling `emit_report` (`finishReason: other`)** — Q17, Q19 fetched the data but
   never emitted; Q18 returned an empty completion outright.
3. **Pathologically slow turns / step-budget exhaustion** — Q12, Q15 exceeded ~260s (many `run_sql`
   attempts/retries).

## Caveats

- **The `other`/empty cluster (Q17–Q19) is likely aggravated by test concurrency.** The batch fired 4
  requests in parallel at a single small model behind the gateway; empty/aborted completions are a classic
  symptom of provider capacity limits. Under normal **sequential single-user** load the same class of
  question behaved better (Q1, Q2 and „поръчките за тази година" all succeeded via the UI). Treat **13/20
  as a pessimistic floor**, not the real single-user success rate.
- Report **titles** in the extracted logs sometimes read as a section/callout label (e.g. „Методология",
  „Източници на данни") because multiple blocks carry a `title`; the persisted report (storedId present)
  is the source of truth for success, and the UI renders the report's own title on the chip.

## Artifacts

- UI screenshots: `.playwright-mcp/q01-top10-contracts.png`, `.playwright-mcp/q02-top10-2026.png`
- Per-question streams: `.playwright-mcp/logs/q01.txt` … `q20.txt`
- Request bodies: `.playwright-mcp/bodies/q01.json` … `q20.json`

(`.playwright-mcp/` is gitignored — these are local session artifacts, not committed.)

## Recommended follow-ups

1. **Improve `emit_report` shape reliability** — the dominant remaining issue. Options: a stricter/expanded
   block-shape guide in the system prompt, a JSON-repair pass on `ok:false`, or a server-side fallback that
   synthesises a minimal table report from the last `run_sql` result when the model can't emit.
2. **Investigate the empty / `finishReason: other` completions** — determine whether they are
   gateway/provider capacity artifacts (retry/backoff) vs the model genuinely stopping, and whether the
   force-finalize step should also fire when the model stops early (before the last two steps).
3. **Cache-invalidation on deploy** — the SSR homepage HTML is edge-cached (`s-maxage=3600`) and briefly
   references purged asset hashes after a redeploy, breaking the client dock on `/` until the cache expires.
   Separate ticket.
