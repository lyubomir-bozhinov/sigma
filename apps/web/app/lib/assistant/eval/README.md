# Assistant accuracy eval

A two-tier test suite for the AI assistant, grounded in the manual 50-question eval.

- **Tier B (deterministic, per-build CI)** already lives in the guard/golden suites (`describe-schema.test.ts`,
  `report-schema.test.ts`, `sql-opcode-guard.test.ts`, `sql-guard-adversarial.test.ts`, the golden lane).
  Those lock the server guards a wrong model answer would have to pass — no model involved.
- **Tier A (this folder)** is the live accuracy monitor: a catalog of questions scored on the ANSWER the
  user sees. The wire carries no SQL (the phase filter strips it), so checks read the resolved report,
  never the query.

## What runs where

| Command               | Lane                                                     | Model?         | Blocks a build?    |
| --------------------- | -------------------------------------------------------- | -------------- | ------------------ |
| `pnpm test`           | `scorers`/`load`/`drive`/`scorecard`/`catalog` integrity | no (cassettes) | **yes**            |
| `pnpm test:eval:live` | the whole catalog vs a real endpoint                     | **yes**        | no (dispatch-only) |

The live lane (`*.eval-live.test.ts`) is isolated by `vitest.eval.config.ts` and excluded from
`vitest.config.ts`, and additionally skips unless `SIGMA_EVAL_URL` is set. Run it with:

```
SIGMA_EVAL_URL=https://<turnstile-off-target>/assistant/chat pnpm --filter @sigma/web test:eval:live
```

The target must be a **non-prod (turnstile-off)** deployment with a seeded D1 — no browser CAPTCHA token
is mintable from a headless client. The run prints a ✅/⚠️/❌ scorecard (with regressions) as its artifact;
it is a trend monitor, not a gate.

## Adding coverage

- **A new question** → one entry in the matching `catalog/<category>.cases.ts`.
- **A new feature/area** → copy `catalog/_template.cases.ts` to `catalog/<feature>.cases.ts`. The loader
  discovers it automatically (glob); nothing else changes.
- **A new kind of check** → add a variant to `Check` in `catalog/_schema.ts` and a case to `score()` in
  `scorers/index.ts`. The discriminated union + `assertNever` make a missing scorer a compile error.

A case is pure data: a `prompt`, report-content `checks` (from the `_schema` builders), a `baseline`
verdict (the manual-eval anchor — regressions are measured against it), and the `dataVersion` its numbers
came from. Because checks read the answer, tolerances absorb data-refresh drift; set them for the
dataset's churn, not for a wrong answer.

## Layout

```
catalog/        data — cases + the Check schema/builders (_schema.ts) + template (_template.cases.ts)
scorers/        pure report-content scorers + exhaustive score() dispatch
runner/         drive.ts (POST + reduce the UIMessage stream) + cassette.ts + cassettes/ fixtures
load.ts         glob-discovers the catalog
scorecard.ts    verdict roll-up + ✅/⚠️/❌ table + baseline compare
run-output.ts   the normalized client-wire capture (no SQL — the wire never carries it)
```
