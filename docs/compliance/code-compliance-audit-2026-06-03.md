# Sigma — Code compliance audit (2026-06-03)

_An audit of the application code/pipeline against the regulatory framework. **Deduplicated against [`../qa/code-review-2026-06-03.md`](../qa/code-review-2026-06-03.md):** this file lists **only compliance items with no technical-finding equivalent there.** The overlapping items — personal-data exposure (was A1–A3), service security (was S1–S8), and data accuracy (was D1–D2) — are tracked as findings in the code review; their legal analysis is in [`regulatory-map-2026-06-03.md`](regulatory-map-2026-06-03.md)._

**Operator status:** public-sector body (МИДТ). **Controlling legal basis:** the АОП–МИДТ agreement (`/.policy-source/midt/Proekt_na_sporazumenie_AOP-МИДТ_v3.md`), **чл. 8 — full anonymization of personal data *and* trade-secret data before any use or publication.**

**Risk:** 🔴 non-compliant (running code breaches an obligation) · 🟠 gap (obligation unmet) · 🟡 at-risk (fragile / future trigger).

## Tracked in the code review — not repeated here

The compliance-relevant defects already enumerated at `file:line` in [`../qa/code-review-2026-06-03.md`](../qa/code-review-2026-06-03.md) (with the obligation each touches in the regulatory map):

- **Personal data (АОП чл. 8 · GDPR · *Sovim*):** `bidders.name` publishes ЕТ/natural-person names; `beneficial_owners`/`company_owners` store named persons; consortium fragments auto-linked to search.
- **Service security (Наредба за мрежова и информационна сигурност · NIS2):** unauthenticated `POST /etl/refresh`; admin fail-open; CSV formula injection; `load-fx` SQL injection; feed-URI path traversal; missing security headers; edge-cache nonce/`Vary`; CI/deploy gaps + `xlsx@0.18.5`.
- **Data accuracy (GDPR Art. 5(1)(d)):** `annex_suspect` total divergence; `INSERT OR IGNORE` drops; refresh-slice column/GROUP-BY loss; fabricated deep-page ranks; silent cron-403 freeze + false freshness; home-counter mismatch.

Fix those in the code-review backlog; the compliance obligations they trigger are in `regulatory-map-2026-06-03.md`.

---

## Findings unique to this audit

### A4 🟠 No in-pipeline anonymization enforcement or guard
- **Assessment:** Gap. чл. 8 requires anonymization applied **programmatically and deterministically before publication** (`/.policy-source/midt/misc/io-letter-aop-opendata.md`). The per-surface redaction the code review recommends treats the symptoms (the A-series findings); there is no **systemic enforcement** — no classification/redaction stage Sigma itself controls, and no test asserting that **no natural-person name reaches any published field** (CSV / JSON / sitemap / `search_index`).
- **Where:** `packages/ingest/*`, `scripts/normalize-egov.sql`, CI (`.github/workflows/ci.yml`).
- **Why:** АОП чл. 8 + чл. 9 (technical/organizational measures). Sits above the per-finding fixes; not duplicated by the code review.

### Ac1 🟠 Focus not managed on client-side route change / Back
- **Assessment:** Gap — WCAG 2.1 AA SC 2.4.3. Focus drops to `<body>` after SPA navigation to a detail page and isn't restored on browser Back. Sourced from [`../qa/qa-2026-05-30.md`](../qa/qa-2026-05-30.md) #7/#8; **not in the code review.**

### Ac2 🟠 Touch targets <24px; mobile horizontal overflow
- **Assessment:** Gap — SC 2.5.8 (targets) and SC 1.4.10 (reflow). Header search/menu controls are below 24×24; `/methodology` and the company detail overflow horizontally on mobile. QA-sourced; **not in the code review.** (The related disabled-pagination a11y defect *is* a code-review item — excluded here.)

### O1 🟡 Re-published open data carries no licence/attribution
- **Assessment:** At-risk — Open Data Directive / HVD → ЗДОИ. CSV/JSON/API exports carry no licence or attribution and there is no per-dataset attribution register, though Sigma re-uses АОП/ТР/OCDS open data where attribution conditions attach. (The `apps/api` `authorityName` mislabel is a separate code-review item — excluded here.)

### Al1 🟡 No algorithmic transparency for the (parked) risk layer
- **Assessment:** At-risk / forward-looking — reform agenda #6 + наредба за алгоритмичен одит #20. The risk-score / red-flag layer is parked (`sigma/core-scope.md`); when it resumes the framework requires **public algorithms, per-score explainability, an appeal/challenge path, and logged algorithmic decisions** — none implemented. (The analysis-package correctness bugs that would feed it are code-review items — excluded here.)

### H1 🟡 Production hosting vs. operating model
- **Assessment:** At-risk — NIS2 / ЗЕУ data-residency. Intended production is the Държавен облак under ИО's SOC (`/.policy-source/midt/misc/роли-и-отговорности-МИДТ-ИО-съветник.md`), but the app runs on Cloudflare (`sigma.midt.bg`). A deploy-config / data-residency reconciliation, not a code bug — lands in `wrangler.*` / deploy scripts.

---

## Non-code dependencies (team-owned — not assessed here)

Recorded for traceability only; not code.

- Signed АОП–МИДТ agreement (vs. the v3 draft); annex if Търговски регистър owner data is to be used.
- The **чл. 8 anonymization spec/ruleset** (esp. ЕТ / natural-person handling) — the control **A4** would enforce.
- DPIA (Art. 35), Art. 6(1)(e/f) lawful basis / LIA, RoPA (Art. 30), privacy notice (Arts 13–14), Art. 21 objection/erasure process.
- Accessibility statement (декларация за достъпност) + feedback mechanism (depends on **Ac1/Ac2** + the code-review pagination fix).
- NIS2 essential-entity registration with МЕУ; incident-response plan; the **H1** hosting decision; DPO appointment.
- Trade-secret exclusion list (reform #18); open-data licence/attribution policy (bears on **O1**).
- Final законови промени texts (20 amendments + 2 наредби).

## Not assessed / residual
- `sigma/raw_files/New - AI powered functionalities - CAIS EOP.docx` — `.docx` only, not machine-read.
- Law PDFs in `kolkostruva/laws/` — separate initiative, not read.
- Codex workers unusable here (`bwrap: No permissions to create a new namespace`).
