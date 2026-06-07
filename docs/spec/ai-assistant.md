# AI Assistant — design spec

> The conversational analysis layer over СИГМА: a chat assistant that searches the
> procurement data and the source registries, runs web search, and renders **advanced
> reports** (tables + graphics) that read like native pages of the site. Built on **BgGPT**
> (text + voice). Design prose in English; all user-facing copy in **Bulgarian**.
>
> This doc captures the agreed design. All eight sections decided 2026-06-07; **no code yet** —
> implementation is sequenced in §8.

## Givens (fixed inputs, not up for design)

- **Model: BgGPT** for both text and voice — OpenAI-compatible API at `https://api.bggpt.ai/v1`,
  authenticated with the `BGGPT_API_KEY` secret (kept in `.env` / `wrangler secret`, never
  committed). Text model `bggpt-gemma-3-27b-fp8` (FP8-quantized; supports streaming and
  tool/function calling). Speech model `bggpt-whisper-large-v3` at `POST /v1/audio/transcriptions`
  (formats `flac/mp3/mp4/m4a/ogg/wav/webm`, max 25 MB; `language` as ISO-639-1, e.g. `bg`). Rate
  limits: text 20 req/min on the default plan (our working ceiling is 120 — see below);
  transcription 360 req/min.
- **Embedded in the site**, not a separate product — reports use the site's own components and
  are part of the same Worker/codebase.
- **Public open data.** The underlying corpus is public procurement data, so report contents are
  not sensitive; the constraints are quota and abuse, not data confidentiality.
- **Agentic.** The assistant works as an agent with tools: read-only SQL over the database, web
  search, and search across the known data sources.

---

## 1. Product surface & layout — *Decided 2026-06-07*

A **global chat dock**, always available like the KolkoStruva assistant, with reports opening as
first-class pages of the site. The assistant is not a place you navigate *to*; it is always
present, and the *reports* are the navigable artifacts.

- **Global dock.** Mounted once in the site root layout ([root.tsx](../../apps/web/app/root.tsx)),
  available on every route. Open by default, collapsible to an edge tab; state remembered.
  - Desktop: right-hand rail alongside the page.
  - Mobile: full-screen sheet, toggled from a launcher.
- **No `/assistant` route.** With the dock always present there is nothing to navigate to. The
  welcome / empty state (a short greeting + 3–4 example prompts, e.g. „Покажи най-рисковите
  поръчки в строителството за 2023") lives **inside the dock**.
- **Reports as compact cards in the transcript.** When the agent finishes a report it drops a
  compact card into the chat — title, one headline stat or the first block, and an „Отвори"
  action. The card is what persists in history; it is *not* the full heavy render.
- **Full report in the main area at `/reports/:id`.** Each report is an addressable, shareable
  page rendered server-side with the existing site components
  ([DataTable](../../apps/web/app/components/DataTable.tsx),
  [StackedBar](../../apps/web/app/components/StackedBar.tsx),
  [SankeyDiagram](../../apps/web/app/components/SankeyDiagram.tsx),
  [FactsList](../../apps/web/app/components/FactsList.tsx),
  [TotalsStrip](../../apps/web/app/components/TotalsStrip.tsx)). So a report reads like a richer
  search-results page, gets full width for tables/Sankeys, and is bookmarkable.
- **Re-open from history.** Producing a report auto-opens it in the main area and appends its
  card. Clicking any card — current or scrolled-back — reopens that report at its `/reports/:id`.
- **Mobile is the same flow, stacked.** Chat is full-screen; opening a report pushes a
  full-screen report view; back returns to the chat. One block-spec renders both the compact
  card and the full page, so there is a single render path, not two UIs.

```
DESKTOP                                   MOBILE
┌───────────────────────────┬─────────┐   ┌───────────────┐   ┌───────────────┐
│  MAIN AREA                 │  CHAT   │   │  CHAT (full)  │   │ REPORT (full) │
│  full report  /reports/:id │  ▸ msg  │   │  ▸ msg        │   │  table        │
│  (table / bar / sankey)    │  ▸ [card]│  │  ▸ [card] →   │ → │  bar / sankey │
│  shareable URL             │  ▸ msg  │   │  ▸ msg        │   │  ‹ назад      │
└───────────────────────────┴─────────┘   └───────────────┘   └───────────────┘
```

## 2. Agent runtime & model — *Decided 2026-06-07*

### Where it runs — one Worker

Everything ships inside **`apps/web`** — the existing React Router v7 SSR Worker. One Worker for
the entire web; no separate assistant deployment.

- The chat endpoints, the agent loop, the SQL tool, the BgGPT/Whisper proxies, and report
  rendering all run as **server-side resource routes / actions** within `apps/web`.
- D1 is already bound there as `env.DB`. We **add an R2 binding** for report storage.
- The stub [apps/assistant](../../apps/assistant/src/index.ts) and
  [apps/api](../../apps/api/src/index.ts) Workers are **retired as cleanup** — they are redundant
  placeholders.

### Agent loop — Vercel AI SDK

- Library: the **Vercel AI SDK** (`ai` + `@ai-sdk/openai`), with the provider pointed at BgGPT's
  base URL and `BGGPT_API_KEY`. It gives a first-class tool-calling loop, streaming, and React
  chat hooks, and is Workers-friendly.
- **Not LangChain** — heavy on Workers and its abstractions fight this stack.
- Text model: `bggpt-gemma-3-27b-fp8` (the only model available to us), with tool calling.

### Streaming

- **Stream when possible.** Stream the assistant's conversational text to the dock via SSE
  (`streamText`); BgGPT supports OpenAI-style streaming.
- Tool calls (SQL, web search) execute server-side mid-stream; the **report card renders when the
  final report artifact is ready** (the report block-spec is finalized via a tool/structured step
  rather than streamed token-by-token — see Open item 4).
- Fall back to a single non-streamed response only on paths that can't stream.

### Loop depth & quota config

- Cap tool iterations per turn via the SDK's `maxSteps` (configurable; default ~6) to bound
  latency and quota use.
- **Quota is a config var** — e.g. `BGGPT_RATE_LIMIT_RPM` (default 120), raised without a code
  change if the plan grows. `maxSteps` is likewise configurable.
- Config vars live in the Worker `[vars]`; `BGGPT_API_KEY` stays a **secret** (`.dev.vars`
  locally, `wrangler secret` in prod).

## 3. Tools — *Decided 2026-06-07*

The agent's capability surface: read-only data access, provenance, and live EOP pulls. Web search
is **deferred** (see below).

### Data & query tools

- **`run_sql`** — read-only `SELECT` over D1; the "any select query" capability you asked for.
  Reaches both the normalized domain tables and the raw source mirrors (`raw_egov_*`,
  `raw_ocds_*`, `raw_tr_companies`). Safety is designed in full under #7; the shape: single
  statement, must be `SELECT`/`WITH…SELECT`, keyword blocklist (`INSERT/UPDATE/DELETE/DROP/
  ATTACH/PRAGMA/…`), no extra semicolons, a hard `LIMIT`, a row/byte cap on what's returned to the
  model, and a query timeout.
- **`describe_schema`** — the curated data dictionary the model reads before writing SQL: tables,
  columns, key enum values (`status`, `procedure_type`, CPV sectors…), plus each row's `source`
  provenance tag and the `data_freshness` view. Grounded from
  [migrations/0000_init.sql](../../packages/db/migrations/0000_init.sql) +
  [schema.ts](../../packages/db/src/schema.ts). *(data-sources reading (a): provenance-aware)*
- **Curated query tools** — reliable, fast paths for the common cases with `run_sql` as the escape
  hatch (**hybrid**): `search_entities` (FTS over `search_index`),
  `get_company`/`get_authority`/`get_contract`, `explain_risk` (→ `risk_scores` +
  `@sigma/analysis`). Precedent: [assistant-tools](../../packages/assistant-tools/src/index.ts).
  Rationale: raw SQL is the power tool, but a 27B model writing free SQL is error-prone — curated
  tools cover the common 80% reliably; `run_sql` handles the bespoke 20%.

### Source tools

- **`eop_fetch`** — live pull of a day's EOP open-data bucket from `EOP_OPEN_DATA_BASE_URL`
  (default `storage.eop.bg`): `{base}/open-data-{YYYY}-{MM}-{DD}/` → 3 JSON arrays
  (поръчки/договори/анекси, camelCase, joined on `uniqueProcurementNumber`; a missing day = 403).
  For **recency / native detail** beyond the last ingest, by date or known UNP. It is **per-day,
  not a cross-day search index**, so D1 stays the primary search path. See
  [etl-eop-feed.md](../etl-eop-feed.md). *(reading (c): live fetch)*
- **`source_link`** — deterministic official deep-links (АОП / ЦАИС ЕОП / Търговски регистър) so
  every report can cite and link back to the source registry. *(reading (b): deep-link out)*

### Web search — deferred

Out of scope for now. Future intent: a **keyless** implementation via `lite.duckduckgo.com/lite`
(result list) + page fetch — no API key. Prompt-injection from fetched web content is why it's
gated behind the #7 security work when it lands.

## 4. Report model — *Decided 2026-06-07*

**Core principle: the agent emits semantic data + intent; the renderer owns all presentation.**
The agent never produces colours, SVG geometry, React, or formatted numbers — it emits labels, raw
values, and column definitions with *format hints*, and the renderer maps those onto the site
components and design tokens. This keeps reports native, prevents design drift, and lets the R2
snapshot render identically forever.

### Mechanics

- **Closed block vocabulary** emitted via a validated **`emit_report`** structured step
  (Zod / JSON-schema; invalid output → the model retries). This is the "report finalized via a
  tool step" from #2 — not streamed token-by-token.
- **Formatting by hint, not by value** — columns/totals carry
  `format: 'money' | 'number' | 'percent' | 'date' | 'text'`; the renderer applies the site's
  `money` / `pct` / `count` helpers from `@sigma/shared` (money in лева, etc.).
- **Links by entity-ref, not URL** — a row/node gives `{kind:'company', id}`; the renderer builds
  the canonical `/companies/:eik` (or `/authorities/:eik`, `/contracts/:id`) href.
- **Data snapshot is embedded** in the block-spec — the rows/edges/values the agent gathered are
  stored in the R2 artifact, so `/reports/:id` never re-queries (ties to the R2 decision below).

### Block vocabulary (v1)

| Block | Component | Agent supplies |
|---|---|---|
| `text` | prose / `PageHeader` lede | markdown string (the written answer) |
| `totals` | [TotalsStrip](../../apps/web/app/components/TotalsStrip.tsx) | `[{label, value, format}]` |
| `facts` | [FactsList](../../apps/web/app/components/FactsList.tsx) | `[{term, value, sub?}]` |
| `table` | [DataTable](../../apps/web/app/components/DataTable.tsx) | declarative `columns` (key, header, align, format, link?) + plain `rows` |
| `bar` | [StackedBar](../../apps/web/app/components/StackedBar.tsx) | `[{label, value, key?}]` — renderer computes shares **and** palette colours |
| `flows` | [SankeyDiagram](../../apps/web/app/components/SankeyDiagram.tsx) | `[{from, to, valueEur}]` edges — renderer computes the SVG layout |
| `timeseries` | **NEW** — hand-rolled CSS/SVG, no chart lib | `[{period, value}]` (+ optional multi-series) |
| `callout` | `Callout` | title + body (caveats, freshness, source note) |

- **`timeseries` is the one new component.** Procurement questions are heavily trend-over-time
  (2020→2026) and no existing graphic covers it. Built hand-rolled in CSS/SVG to match how
  StackedBar/Sankey are built — the house style is **no chart library**.
- **No map.** A NUTS/municipality choropleth needs a Bulgaria topology asset — out of scope.
- **Server-computed presentation** for `bar` (colours) and `flows` (geometry): the agent supplies
  meaning, the server supplies pixels, reusing the flows loader's layout computation (extracted if
  currently inline).

### Editorial shape

The system prompt enforces a consistent report skeleton so every report reads like a native page:
title → one-line answer (`text`) → headline `totals` → supporting `table` / `bar` / `flows` /
`timeseries` → a `callout` citing sources & data freshness. The compact chat card (#1) is a
projection of this same spec (title + first block + „Отвори") — no separate authoring.

## 5. Persistence & history — *Decided 2026-06-07*

**No user accounts (a permanent non-goal); everything is public.** The only durable server-side
artifacts are the reports (in R2); conversations live in the browser.

### Reports — immutable R2 artifacts

Decouples expensive generation from cheap viewing.

- **Generation (expensive, once).** The agent's output — the report block-spec plus metadata
  (title, the question asked, the tool/SQL calls that produced it, a snapshot of the result data,
  timestamp) — is written as a single immutable JSON object to R2 under a **random unguessable
  id**.
- **Viewing (cheap, repeatable).** `/reports/:id` reads that static object from R2 and renders it
  server-side. Immutable ⇒ `Cache-Control: immutable` ⇒ served from the CDN edge. A viral
  `/reports/:id` link **never re-runs the agent and never touches D1**.
- **Public, unlisted-by-link.** Anyone with the link can view (the underlying data is open); no
  auth to view, no gating. The unguessable id is the only — and a soft — privacy boundary.
- D1 stays for *data* queries only — no report-row bloat. R2 lifecycle rules expire stale reports
  to bound storage (a stale chip may eventually 404 — acceptable).

### Conversation state — client-side, stateless server

- The transcript (messages + report-chip refs: `id` + title) lives in the browser
  (localStorage / IndexedDB). **No server-side session store, no accounts.**
- The **server is stateless**: each turn the client posts the recent history + the new message,
  the agent loop runs and returns, and nothing per-user is persisted. The most DoS-resistant shape
  — no session state to exhaust.
- Gemma-3-27b's large context handles a normal chat; window/trim if a conversation grows huge.
- Trade-off of no accounts: no cross-device sync, and clearing storage loses chat history (saved
  `/reports/:id` links survive). This is permanent — **accounts are a non-goal**, not planned at
  any point.

### "My reports" & sharing

- A `/reports` page (or a panel in the dock) lists the report ids **this browser** generated, each
  linking to `/reports/:id` — built from the local index, with **no global enumeration** of all
  reports.
- Sharing = copy the `/reports/:id` link. Public, no login on either end.

## 6. Voice input — *Decided 2026-06-07*

Voice is purely an input method that produces text; everything downstream is the normal text flow.

- **Capture** — `MediaRecorder` from the dock's mic button, in the browser's native container
  (Chrome/Firefox → webm/opus, Safari/iOS → mp4/m4a). All are Whisper-accepted, so **no
  transcoding**.
- **Transcribe via the Worker** — the blob POSTs to a resource route (e.g. `/assistant/transcribe`);
  the Worker proxies to BgGPT `POST /v1/audio/transcriptions` with `model=bggpt-whisper-large-v3`,
  `language=bg`, `response_format=json`. The browser **never sees `BGGPT_API_KEY`** — it stays a
  server secret.
- **Transcript → input, editable** — the returned text lands in the chat input; the user reviews/
  edits and hits send (**not auto-send**), so a mishear is fixed before the agent runs and we don't
  burn agent quota on a bad transcript.
- **Bounds** — client-side max recording length **~60 s** (well under the 25 MB cap, bounds cost);
  **audio is transient** — never stored, only the resulting text (which lives client-side like any
  message).
- **Abuse** — the transcribe endpoint sits behind the same #7 protection; Whisper's 360 req/min
  limit is generous, not the constraint.
- **Fallback** — mic-permission denial or a transcription error degrades gracefully to text input.

## 7. Security & guardrails — *Decided 2026-06-07*

Auth is settled (public, no accounts — see #5). Three concerns remain: locking down `run_sql`,
containing prompt injection, and protecting the quota.

### Read-only SQL — defense in depth

- **AST-validated, not regex.** Parse the model's SQL with a SQLite-dialect parser (e.g.
  `node-sql-parser`) and assert the AST is a **single read-only `SELECT`** (`WITH…SELECT` CTEs
  allowed); reject anything else outright. A keyword blocklist
  (`INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/ATTACH/PRAGMA/…`) stays as a cheap second layer, but the
  parser is the real guard — blocklists are bypassable via comments/casing/stacked statements.
- **Injected `LIMIT`** — add one if absent, cap it if too high.
- **Result byte cap** — truncate what's returned to the model (with a "results truncated" note) so a
  large result can't blow context or cost.
- **Timeout** — bound query time; pathological cross-joins die rather than hang.
- The data is public, so SQL is a **write / DoS** risk, not a confidentiality one — the guards
  target side-effects and resource burn.

### Prompt injection — least privilege is the primary defense

- The entire toolset is **read-only and bounded** (`run_sql` SELECT, public `eop_fetch`,
  `source_link`, `emit_report`). A successful injection from DB content (a supplier literally named
  „Ignore previous instructions…") — or web content when it lands — **cannot escalate**: there is no
  write, secret, or destructive tool to hijack. Worst case is a pointless query or an odd report.
- **Prompt hardening** — the system prompt instructs the model to treat all tool/data content as
  data, never as instructions.
- **Output sanitization (critical).** Reports are **public, shareable URLs**, so a stored-XSS in a
  report would reach anyone. The renderer **never executes model-provided HTML/JS**: blocks are data
  rendered by trusted components, and `text`/`callout` markdown is **sanitized (no raw HTML)**. This
  closes the stored-XSS vector on `/reports/:id`.

### Rate-limiting & circuit-breaker

- **The view path is LLM-free** (cached R2 artifacts), so shared/viral `/reports/:id` links cannot
  eat the quota — only generation needs protecting.
- **Turnstile** — Cloudflare's keyless, invisible CAPTCHA gates the chat endpoint, stopping
  automated abuse before it reaches the model.
- **Per-client limit** — Cloudflare's native **Rate Limiting binding** keyed on IP (keyless) on the
  chat + transcribe endpoints.
- **Global circuit-breaker** — a rolling-minute counter (Durable Object or KV) of BgGPT calls; as it
  nears `BGGPT_RATE_LIMIT_RPM` (default 120), shed/queue with „опитайте пак след малко" so we never
  blow the shared upstream quota.
- **Concurrency cap** + the **`maxSteps`** cap (#2) bound per-turn cost. All thresholds are config
  `[vars]`.

---

## 8. v1 scope & phasing — *Decided 2026-06-07*

Guards travel with the tools they protect; abuse protection is a hard gate on public exposure, not
a separate late phase. **v1 = Phases 1–3 + the launch gate** — reports, voice, and `eop_fetch` are
all in v1.

### Phase 1 — Foundation & data chat (text only)

- Add the R2 binding + config `[vars]` to `apps/web`; retire the stub `apps/assistant` / `apps/api`.
- BgGPT via the Vercel AI SDK; streaming `/assistant/chat`; the global dock shell (collapsible,
  empty state with example prompts).
- `describe_schema`, `run_sql` **with the full #7 SQL guards**, the curated tools, `maxSteps`.
- *Outcome:* a working "chat with the data" assistant answering in prose.

### Phase 2 — Reports (the headline)

- `emit_report` + the block-spec schema + the renderer (existing components + the new `timeseries`).
- R2 persistence, `/reports/:id`, compact cards in chat, the re-open mechanic, the `/reports` index.
- *Outcome:* rich, shareable reports.

### Phase 3 — Voice & live sources

- Voice input (`/assistant/transcribe`).
- `eop_fetch` + `source_link`.

### Launch gate (before any public exposure)

- Turnstile + the Rate Limiting binding + the global circuit-breaker. Staging may run without;
  public launch may not.

### Deferred (post-v1)

- **Web search** (keyless `lite.duckduckgo.com/lite`) — see #3.
- **Map / NUTS choropleth block** — see #4.

### Non-goals

- **User accounts / cross-device sync** — not planned at any point (see #5).
