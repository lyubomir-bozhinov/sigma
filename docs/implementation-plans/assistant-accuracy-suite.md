---
name: assistant-accuracy-suite
status: revised-after-review
created: 2026-07-16
updated: 2026-07-16
---

# Implementation Plan: AI Assistant Accuracy Test Suite (rev. 2)

> Rev. 2 folds in a 3-agent review (test-design, architecture, CI/safety). The review overturned two
> load-bearing assumptions in rev. 1 — see **What the review changed**.

## Executive summary

- **Goal:** An extendable test suite for the Sigma AI assistant, grounded in the 50-question manual eval
  (`~/Downloads/message (1).txt`) + new corner cases, so accuracy regressions are caught by automation.
- **Base:** worktree `../sigma-assistant-tests`, branch `test/assistant-accuracy`, off
  `fork/feat/ai-assistant-contracts` (PR #17).
- **Two tiers, cleanly separated by what's observable:**
  - **Tier B — deterministic** (per-build CI, no model): golden fixtures + unit/asset tests against code
    where SQL/pure functions ARE visible. Plain tests, **not** `EvalCase`s.
  - **Tier A — live accuracy eval** (manual dispatch, hits the running assistant): an `EvalCase` catalog
    scored **only on what the client wire carries — the rendered `emit_report`** (numbers, entities,
    labels, decline/error). No SQL-level scoring is possible live.

## What the review changed (vs rev. 1)

1. **The live SSE stream never carries SQL.** `stream-phase.ts` forwards a strict allowlist (text, phase
   markers, the redacted `emit_report`) and **drops run_sql's SQL, its D1 rows, and tool names**; it's
   wired on the main agent stream at `agent.ts:598` (`stream.pipeThrough(createPhaseFilter())`, import
   `agent.ts:26`). → `RunOutput.sqlRun`/`tools` are **unpopulatable
   live**. `sqlMatches`/`sqlNotMatches`/`usesAmountEur`/`guardRejects` move to **Tier B only**. Live
   scoring asserts the **answer** (report content), which is the correct level for accuracy anyway.
2. **The adversarial guard suite already exists and is a blocking CI gate** (`sql-guard-adversarial.test.ts`,
   run at `ci.yml:70-73` — covers DROP/UPDATE/DELETE/stacked/injection/exfiltration, parser-differential).
   → **Phase-1 "adversarial locks" is deleted**; we only extend it if a genuinely-missing vector exists.
3. **Deterministic cases can't be `EvalCase`s.** A `{prompt, checks}` case needs a model to become SQL;
   Tier B has no model. → Tier B is ordinary unit/golden tests; the `EvalCase` catalog is **live-only**.
   The extensibility promise ("new feature → new questions") applies to the live catalog.
4. **Reuse the typed wire contract.** The response is an AI-SDK v6 `UIMessageChunk` stream with an
   existing typed contract (`assistant-contract/stream.ts`) + consumer (`useAssistantChat.ts`). The
   runner parses `UIMessageChunk`s (`tool-output-available` for emit_report, `data-report-ready`), not
   hand-rolled SSE text — one parser, no drift.
5. **Endpoint reality:** POST `/assistant/chat`, body `{ messages: UIMessage[], clientRequestId?,
   filterContext? }` (not `{prompt}`), `Content-Type: application/json`, **spoofed `Sec-Fetch-Site:
   same-origin`** (CSRF guard, `request-guard.ts`). **Turnstile** (`turnstile.ts`) blocks any headless
   client — no token is mintable outside a browser; the runner only works against a target where
   `TURNSTILE_SECRET` is unset (non-prod). There is **no API-key auth** to model.
6. **CI:** nightly `schedule:` doesn't compose — previews are per-PR, torn down on close; a cron has no
   URL. → Live lane is **`workflow_dispatch:`-only** against an explicit `SIGMA_EVAL_URL` input, with a
   case-count cap (paid, multi-step generations share `BGGPT_CIRCUIT_BREAKER`). No cron in v1.
7. **Lane isolation must be config-level**, not a runtime `skipIf`. → Add `vitest.eval.config.ts` +
   exclude from `vitest.config.ts`'s node project + own `test:eval:live` step — mirroring the golden lane.
8. **Baselines drift with the dev D1** (previews share it, re-ETL shifts every number). → Record a
   `dataVersion` next to each `baseline`; the scorecard flags version mismatch. Tolerances absorb minor drift.

## Guiding principle (scoped)

The **`eval/` subsystem** is data, not code: a live question is one catalog entry, a check is one scorer,
cases are glob-discovered — adding a question or a category file never edits the runner. (This does **not**
extend to the golden lane, which keeps its per-negative-fixture `it()` cost.)

## Current state (verified)

Post-fix branch. Every deterministic bug in the eval is already fixed AND locked (Q17/Q19 token cap; Q41
opcode BitAnd; Q6/Q11 grand-total rule at `report-schema.ts:531-536`; Q24/Q25 CPV `mapSectorWord` →
`['33','85']`; Q41 region-is-name in `describe-schema.ts`). Existing infra to reuse: the golden harness
(`golden/*`, 28 fixtures, separate `vitest.golden.config.ts` + `test:golden` CI step); the adversarial
guard suite (`sql-guard-adversarial.test.ts`, CI-gated); the typed wire contract (`assistant-contract/stream.ts`).

**Real gaps:** (1) grand-total negative golden fixture; (2) `cpv-map` hard-reject of 38/31; (3) region-
never-a-code contract test; (4) the entire live-eval tier scored on report content.

## Target architecture

```
apps/web/app/lib/assistant/eval/
  catalog/                     # DATA — live cases, one file per category, glob-discovered
    _schema.ts                 # EvalCase + Check union (report-content checks only) + builders
    _template.cases.ts
    <category>.cases.ts        # ~12 files
  scorers/                     # pure fns over RunOutput (report content): numeric, reconciles,
    index.ts …                 #   declines, contentIncludes/Excludes. NO sql* scorers here.
  runner/
    drive.ts                   # POST /assistant/chat (UIMessage body + CSRF headers) → read
                               #   UIMessageChunks via ai SDK → RunOutput. MUST NOT import assistant-dock/*.
    cassette.ts                # record/replay a captured UIMessageChunk stream (harness self-test)
  load.ts                      # glob *.cases.ts → EvalCase[]; unique-id + registered-kind checks
  scorecard.ts                 # flat ✅/⚠️/❌ table (+ baseline compare; trend deferred)
  eval.live.test.ts            # Tier A — collected ONLY by vitest.eval.config.ts (dispatch lane)
  README.md
# Tier B lives as ordinary tests next to the code they lock:
  golden/fixtures/9x-neg-grand-total-on-multirow.golden.json  + a negative-path it() in reports.golden.test.ts
  workers/assistant/cpv-map.test.ts   (hardened)
  <region-contract>.test.ts
```

### EvalCase — the live extensibility contract

```ts
export type Verdict = '✅' | '⚠️' | '❌';

export interface EvalCase {
  id: string;                 // unique (load-time checked)
  category: string;           // = filename stem
  prompt: string;             // becomes the UIMessage text
  checks: Check[];            // report-content checks only
  baseline?: Verdict;         // manual-eval verdict — the regression anchor
  dataVersion?: string;       // dataset the baseline numbers came from
  knownLimitation?: string;   // documents an accepted ⚠️/❌
  tags?: string[];
}

// Check = serialisable descriptor (not a closure). Discriminated union → assertNever completeness.
// Every kind must be answerable from emit_report content alone.
export type Check =
  | { kind: 'numeric'; metric?: string; expect: number; tolerancePct: number } // absorbs data-refresh drift
  | { kind: 'reconciles'; partsMetric: string; totalMetric: string; tolerancePct: number }
  | { kind: 'declines' }                                   // no report / honest "не успях"
  | { kind: 'reportPresent' }                              // answered vs errored (e.g. Q17/Q19 no-500)
  | { kind: 'contentIncludes'; re: string; flags?: string }   // e.g. non-Sofia entity present (Q41 symptom)
  | { kind: 'contentExcludes'; re: string; flags?: string };  // e.g. label „31" absent (Q25 symptom)

export interface CheckResult { pass: boolean; detail: string }
export type Scorer = (run: RunOutput, check: Check) => CheckResult;
```

Two extension axes, stated honestly: **new question / new category file = zero harness edit**; **new
check kind = one `_schema.ts` union member + one scorer** (a shared-file edit, but never a runner/loader
edit). The union is pressure-tested against ≥1 case per category in Phase 2 so it doesn't churn mid-Phase-4.

### RunOutput — only what the wire carries

```ts
export interface RunOutput {
  report: ResolvedReport | null;  // from the emit_report tool-output-available chunk (redacted on failure)
  declined: boolean;              // no report emitted / decline text
  error?: { status: number };     // e.g. 500, 429, 403
  chunks: string[];               // observed UIMessageChunk types (for the shape-contract test)
}
// NO sqlRun / tools — the phase filter strips them (stream-phase.ts). SQL-level checks are Tier B.
```

## Implementation phases (TDD)

### Phase 1 — Tier B deterministic locks (verifiable green now) — ~0.5 day
- Grand-total **negative golden fixture** (a `totals` item ref'd at a multi-row `R1` → `bindReport`
  rejects, `report-schema.ts:531-536`) + a `NegativeKind` member + a negative-path `it()` in
  `reports.golden.test.ts`.
- `cpv-map.test.ts`: `mapSectorWord('здравеопазване').divisions` **toEqual** `['33','85']`;
  `not.toContain('38')`, `not.toContain('31')`.
- Region-contract test: on a seeded fixture DB, `SELECT … WHERE region LIKE 'BG%'` → 0 rows; + a
  `describe-schema` content lock asserting the "НЕ е NUTS3 код" warning string is present.
  **First check `packages/db/src/queries/regions.test.ts` and `describe-schema.test.ts` (both exist) —
  extend them rather than add a parallel file if either already asserts the region contract.**
- **(Dropped: adversarial guard locks — already shipped + CI-gated.)**
- Verify: `pnpm --filter @sigma/web test:golden` + `test` green; `pnpm -r typecheck` 0.

### Phase 2 — eval schema + report-content scorers + loader — ~0.5 day
- Tests first: `scorers/*.test.ts` (pure fns, hardcoded `RunOutput`); `load.test.ts` (glob, unique ids,
  every `Check.kind` has a scorer via `assertNever`). Pressure-test the `Check` union against 1 real case
  from **each** planned category; add any missing kind now.
- Implement `_schema.ts`, `scorers/`, `load.ts`.

### Phase 3 — live runner (typed) + cassette + scorecard — ~1 day
- Tests first (all cassette-driven, no network): `drive.test.ts` builds `RunOutput` from a recorded
  `UIMessageChunk` stream (report, decline, 500, 429); a **shape-contract test** asserting the observed
  chunk types are the allowlisted set (catches wire drift — promoted from a footnote to a deliverable);
  `scorecard.test.ts` renders the flat table + baseline compare.
- Implement `runner/drive.ts` (POST UIMessage body + `Content-Type` + spoofed `Sec-Fetch-Site`; read
  chunks via the `ai` SDK / `assistant-contract/stream.ts`; **no `assistant-dock/*` import**),
  `runner/cassette.ts`, `scorecard.ts`. `eval.live.test.ts` collected only by the eval config.

### Phase 4 — fill the catalog — ~1 day
- ~80–100 cases across ~12 categories, each `live` case with `baseline` + `dataVersion`. SQL-symptom
  traps (Q41 geo, Q24/25 CPV) scored via `contentIncludes/Excludes` on the answer; `knownLimitation`
  documents accepted ⚠️/❌ (Q26/27, Q32, Q40).

### Phase 5 — CI wiring — ~0.5 day (new surface, not a wire-up)
- Tier B rides existing `test` / `test:golden` steps (per-build, blocking).
- `vitest.eval.config.ts` (include `eval.live.test.ts`), excluded from the node project; `test:eval:live`.
- New `.github/workflows/assistant-eval.yml`: **`workflow_dispatch:` only**, input `SIGMA_EVAL_URL`
  (a turnstile-off target), case-count cap, publishes the scorecard artifact, **non-blocking**. No cron.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live stream carries no SQL → no SQL-level live scoring | SQL checks are Tier B (guards/golden, SQL visible); live scores the answer. |
| Turnstile blocks headless runner | Target must run `TURNSTILE_SECRET` unset (non-prod); documented coverage gap. |
| No persistent eval URL (previews ephemeral) | `workflow_dispatch:` + explicit `SIGMA_EVAL_URL`; no cron until a stable target exists. |
| Unbounded token spend / shared circuit breaker | Manual dispatch only + case-count cap + per-run cost note. |
| Baselines drift with dev D1 re-ETL | `dataVersion` per case; scorecard flags mismatch; percentage tolerances. |
| LLM non-determinism | Live lane is non-blocking; tolerance-banded; trended, never a per-commit gate. |
| Wire-format drift on SDK bump | Reuse the typed contract + a shape-contract test. |
| Live lane leaks into per-build CI | Config-level exclusion (not just runtime skip). |

## Open decision for the user
Tier A depends on an eval target that **doesn't exist yet** (a persistent, turnstile-off assistant deploy
+ a pinned dataset). Options: **(a)** build Tier B now (real, verifiable, high value) and build Tier A's
harness against cassettes, deferring live runs until you stand up such a target; **(b)** build both now and
you provide/point `SIGMA_EVAL_URL` at a local `pnpm dev` (turnstile-off) with a seeded D1. Rev. 2 assumes
**(a)** unless you choose (b).

## Success criteria
- [ ] Tier B: grand-total negative fixture, cpv-map hard-reject, region-contract — green in per-build CI.
- [ ] `EvalCase` + report-content scorers + loader; `assertNever` completeness; add-a-question = one entry.
- [ ] Typed live runner (UIMessage POST + CSRF headers + `UIMessageChunk` parse) + cassette + shape-contract test.
- [ ] Flat scorecard reproduces ✅/⚠️/❌ + baseline compare with `dataVersion` guard.
- [ ] `vitest.eval.config.ts` isolates the live lane; `assistant-eval.yml` is dispatch-only, non-blocking.
- [ ] No product-code behaviour change; `pnpm -r typecheck` 0.

---
**Status:** Revised after 3-agent review — awaiting approval
