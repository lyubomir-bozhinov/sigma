# #167B — Weekly Digest: Consumer (render · routes · UX)

**Parent**: [#167](https://github.com/midt-bg/sigma/issues/167) · **Plan**: [`docs/implementation-plans/167-weekly-digest.md`](../implementation-plans/167-weekly-digest.md)
**Owner**: Dev B (web / render) · **Est**: ~2.5 days · **Branch**: `feat/weekly-digest` (or stacked `feat/weekly-digest-consumer`)

## Scope
The consumer side: turn a `StoredReport` artifact into the public `/weeks` pages with reused components, one net-new chart, the AI watermark, and safe-degradation UX. You **render** what Dev A produces.

## ⛔ Blocked by / depends on
- Phase 0 prerequisite merge (see plan) applies here too.
- **Soft dep on Dev A T1**: needs the frozen `StoredReport` type. **Unblock immediately** by building against the existing fixture `apps/web/app/lib/assistant/fixtures/r2-report-object.fixture.json` and the `ResolvedReport` types already on `main`. Swap to the real `@sigma/report` import once T1 lands.

## Tasks

### T1 — Report renderer components (Plan Phase 3.1–3.3) ~1.5d
Shared with the assistant's own render layer — build to be reusable by both.
- `apps/web/app/components/ReportBlockRenderer.tsx`: maps `ResolvedBlock[]` → existing components: `totals→TotalsStrip`, `bar→RankedBars`, `table→DataTable` (+links via `entityHref`), `timeseries→TrendChart`, `flows→SankeyDiagram`, `text/callout→prose`. Prose is already `sanitizeProse`'d at bind time — do not re-sanitize, but never `dangerouslySetInnerHTML` raw model output.
- `apps/web/app/components/ReportAiWatermark.tsx`: §7 disclaimer ("Генерирано с изкуствен интелект… Проверявайте важни данни от първичен източник.") + „данни към {as_of}" + model + source links. Render when `report.watermark === 'ai-generated'`.
- `apps/web/app/components/WeeklyGhostBars.tsx` — **the one net-new chart**: variant of `TrendChart`; vertical bars for the week's daily spend + lighter "ghost" bars for the prior week. `role="img"` + paired sr-only `<table>` (WCAG AA, per `docs/accessibility.md`).
- **Entity-link rule (spec §6.1 bug)**: always route through `entityHref('company'|'authority'|'contract', id)` — never hand-format a ЕИК into a URL; name-keyed companies (`name:…`) must resolve via the helper.
- **Tests first**: golden render per `ResolvedBlock` type from the fixture; watermark renders iff flag set; ghost-bars accessible table matches bar data.

### T2 — `/weeks` routes (Plan Phase 3.4) ~0.5d
- `apps/web/app/routes/weeks.$iso.tsx`: loader `readStoredReport(context.cloudflare.env.REPORTS, 'weeks/'+iso+'.json')`; **404 if null**; render via `ReportBlockRenderer` — **no D1, no LLM at serve time**. `headers()` → `Cache-Control: public, s-maxage=31536000, immutable` for settled weeks (use `publicCache` for non-immutable cases).
- `apps/web/app/routes/weeks._index.tsx`: archive index; list weeks from the `weekly_digests` D1 index (cheap) — show **only weeks with an artifact**; sparkline of weekly `total_eur`; shorter `publicCache`.
- Follow the `contracts.csv.tsx` + `lib/csv-export.ts` resource-route precedent for R2 reads (ETag/`get()`).
- **Tests first**: loader returns 404 on missing artifact; **asserts no D1/LLM call** on hit; archive lists only artifact-backed weeks.

### T3 — Safe-degradation & provenance UX (Plan Phase 5, serve side) ~0.5d
- Render the AI-free **fallback template** cleanly (numbers-only, no narrative) when the artifact carries no verified prose — must look intentional, not broken.
- Footer provenance row: source (CC-BY 4.0 АОП/ЦАИС ЕОП), „данни към {timestamp}", „генерирано автоматично", link to archive `/weeks`.
- Surface „коригирано" note when `refreshed_at` is present.
- Golden full-page snapshot for `/weeks/{ISO}` from a committed `StoredReport` fixture.

## Definition of done
- [ ] `ReportBlockRenderer` renders every `ResolvedBlock` type; reuses existing components; all entity links via `entityHref` (name-keyed companies safe).
- [ ] `ReportAiWatermark` + footer provenance present; „данни към {as_of}", model, sources shown.
- [ ] `WeeklyGhostBars` server-SVG with paired sr-only `<table>` (WCAG AA).
- [ ] `/weeks/{ISO}` renders from R2 with **no D1/LLM**; 404 for weeks without artifacts; immutable cache on settled weeks.
- [ ] `/weeks` archive lists only artifact-backed weeks; sparkline works.
- [ ] AI-free fallback renders cleanly; „коригирано" note on re-issue.
- [ ] Golden render snapshot committed; conventional commits, no `Co-Authored-By`.

## Coordination
- Freeze the `StoredReport` contract jointly with Dev A on day 1; both code against the shared fixture.
- Report-serving route + `ReportBlockRenderer` are also the assistant's Phase-2 render layer — keep them generic (not digest-specific) so the chat can reuse them. Flag to maintainers if the assistant epic wants to co-own (plan Phase 0 open question).
