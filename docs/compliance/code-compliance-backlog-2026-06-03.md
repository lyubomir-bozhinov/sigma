# Sigma — Compliance-driven code backlog (2026-06-03)

_Work-item companion to [`code-compliance-audit-2026-06-03.md`](code-compliance-audit-2026-06-03.md). **Deduplicated against [`../qa/code-review-2026-06-03.md`](../qa/code-review-2026-06-03.md):** it lists **only compliance work with no code-review equivalent.** The overlapping work — personal-data redaction, the security fixes, the data-accuracy fixes — is already itemized with `file:line` + fixes in the code review and is **not repeated here.** **Paperwork** (team-owned) is parked in a checklist at the end._

**Legal basis:** the АОП–МИДТ agreement, **чл. 8 — full anonymization of personal data + trade-secret data before any use or publication.**

## Already in the code review — do those there

Tracked at `file:line` in [`../qa/code-review-2026-06-03.md`](../qa/code-review-2026-06-03.md); not duplicated below:

- **Personal-data redaction** — `bidders.name` (ЕТ names), `beneficial_owners`/`company_owners`, consortium-fragment search links.
- **Service security** — unauthenticated `POST /etl/refresh`, admin fail-open, CSV formula injection, `load-fx` SQL injection, feed-URI path traversal, missing security headers, edge-cache nonce/`Vary`, CI/deploy gaps + `xlsx@0.18.5`.
- **Data accuracy** — `annex_suspect` divergence, `INSERT OR IGNORE` drops, refresh-slice column/GROUP-BY loss, fabricated deep-page ranks, silent cron-403 freeze, home-counter mismatch.

---

## Compliance work not in the code review

### A4 · Anonymization enforcement stage + CI guard — audit **A4** 🟠
The agreement wants anonymization applied **programmatically and deterministically before publication** (`/.policy-source/midt/misc/io-letter-aop-opendata.md`). The code review's per-surface redaction fixes the symptoms; this adds the **systemic control above them**.
- **Where:** `packages/ingest/*` + `scripts/normalize-egov.sql` (a classification/redaction pass Sigma controls); a guard in CI (`.github/workflows/ci.yml`).
- **Change:** a deterministic classify-and-redact step for person-names and trade-secret-flagged fields, plus a **regression test / CI guard that fails the build if a natural-person name appears in any published field** (CSV, JSON, sitemap, `search_index`). Operationalizes чл. 8 in code.
- **Why:** АОП чл. 8 + чл. 9.

### Ac1 / Ac2 · Accessibility (QA-sourced) — audit **Ac1–Ac2** 🟠
Concrete code fixes from [`../qa/qa-2026-05-30.md`](../qa/qa-2026-05-30.md); an honest *декларация за достъпност* can't be published until these land. (The disabled-pagination a11y fix is a code-review item — do it there.)
- Restore focus to `<h1>`/`<main>` on client-side route change and on browser Back — SC 2.4.3. (QA #7/#8)
- Touch targets ≥24×24 on the header search/menu — SC 2.5.8. (QA)
- Mobile horizontal overflow — `min-width:0` on `.split > div` (`/methodology`); `overflow-wrap:anywhere` on the company H1 — SC 1.4.10. (QA #5/#6)

### O1 · Open-data licence/attribution — audit **O1** 🟡
- Add **licence + attribution** to re-published data (footer + API/CSV metadata) and keep a per-dataset attribution register — Sigma re-uses АОП/ТР/OCDS open data, where attribution conditions attach. (The `authorityName` mislabel is a code-review item — do it there.)
- **Why:** Open Data Directive / HVD → ЗДОИ.

### Al1 · Algorithmic transparency (forward-looking) — audit **Al1** 🟡
The red-flag / risk-score layer is **parked** in v1 (`sigma/core-scope.md`). When it resumes:
- Expose the scoring methodology, make each score explainable, provide a challenge/appeal mechanism, and log algorithmic decisions.
- **Why:** reform agenda #6 + наредба за алгоритмичен одит #20. (The analysis-package correctness bugs that would feed it are code-review items.)

### H1 · Hosting / operating model (infra) — audit **H1** 🟡
- Intended production is the Държавен облак under ИО's SOC, but the app runs on Cloudflare (`sigma.midt.bg`). Plan the deploy-config + data-residency migration (lands in `wrangler.*` / deploy scripts). Ref: `/.policy-source/midt/misc/роли-и-отговорности-МИДТ-ИО-съветник.md`.
- **Why:** NIS2 / ЗЕУ data-residency.

---

## Paperwork checklist (team owns — not worked in code)

Listed only so nothing is lost; these are non-code deliverables.

- [ ] **Signed** АОП–МИДТ agreement (vs. the v3 draft) + an annex if Търговски регистър owner data is to be used.
- [ ] The **чл. 8 anonymization spec/ruleset** (esp. ЕТ / natural-person handling) — the control **A4** implements; engineering needs it as the spec.
- [ ] **DPIA** (Art. 35) + **Art. 6(1)(e/f) lawful basis / LIA** + **RoPA** (Art. 30) + **privacy notice** (Arts 13–14) + **Art. 21 objection/erasure** process.
- [ ] **Accessibility statement** (декларация за достъпност) + feedback mechanism + complaint link.
- [ ] **NIS2 essential-entity registration** with МЕУ + incident-response plan; the **H1** hosting decision; DPO appointment.
- [ ] **Trade-secret exclusion list** (reform #18) and the **open-data licence/attribution policy** (bears on **O1**).
- [ ] The final **законови промени** texts (the 20 amendments + 2 наредби).

_Residual: `sigma/raw_files/New - AI powered functionalities - CAIS EOP.docx` (only `.docx`, not machine-read) — convert if the AI-functionality scope affects this backlog._
