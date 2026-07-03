# Assistant dock — markdown rendering in conversational prose

**Date:** 2026-07-03
**Branch/PR:** feature change on `feat/ai-assistant-contracts` (ephemeral PR #17), mirrored to `feat/ai-assistant` (upstream line) per the dual-PR parity model.
**Status:** design approved (direction); pending spec review.

## Problem

The dock renders assistant conversational prose as **plain text** — `AssistantMessage.tsx` does
`<p className="assistant-message__text">{text}</p>`, deliberately (React escapes it, no markup injection).
But the model (Gemma/BgGPT) formats prose the way every LLM does: `**bold**`, `*` bullet lists, `---`
rules, and occasionally pipe-tables. All of it renders as literal syntax.

**Empirically confirmed** (Playwright, `sigma-pr-17` ephemeral env, 2026-07-03). Two render paths:

| Turn | Type | Path | Raw markdown leaked? |
|---|---|---|---|
| „топ 5 поръчки за 2025" | tabular | `emit_report` → emit failed → clean error affordance | No (handled) |
| „обясни възложител vs изпълнител + примери" | explanatory | **prose** (`<p>{text}</p>`) | **Yes — 10 bold spans, 7 bullets, a `---` rule, all literal** |

The decisive point: the second turn is a *legitimate* prose turn — an explanation, correctly **not** a
report (no tabular data to bind). The system prompt keeps such turns as prose by design (§9.10). So the
dock **must** render a safe markdown subset; fixing the `emit_report` seam alone cannot help a turn that
has no table.

## Decision

Reuse and extend the markdown stack **already in the repo** rather than add a dependency.

At HEAD the repo already ships the exact "safe React-node renderer, no dep" approach, used for report
text/callout blocks and named in `sanitizeProse`'s own comment as the intended "Phase-2 renderer":

- **`components/MarkdownBlock.tsx`** — renders `**bold**`, `*italic*`, `` `code` ``, `[links]`,
  paragraphs as React elements. No `dangerouslySetInnerHTML`, no raw-HTML passthrough (raw `<script>`
  renders inert — tested). Missing: lists, `---`, tables.
- **`lib/sanitize-markdown.ts`** (`sanitizeLinkHref` / `isSafeHref`) — client link-protocol allowlist
  (http/https/relative; rejects `javascript:`/`data:`/`//host`).
- **`lib/assistant/report-schema.ts` → `sanitizeProse`** — pure, dependency-free (client-importable):
  HTML strip + numeric-entity decode + scheme defang, ReDoS-guarded, adversarially tested.

Adding `react-markdown` was rejected: it would be a **second** markdown renderer (code duplication, a
second XSS surface with different sanitization semantics than the `sanitizeProse`/`sanitizeLinkHref`
contract) plus a new edge-bundle dependency.

## Architecture

Four changes, smallest-diff-first. All additive; no new dependency.

### 1. Extend `MarkdownBlock` — block-level forms (the core change)

Today `MarkdownBlock` splits on blank lines (`\n{2,}`) into paragraphs and runs an inline tokenizer per
paragraph. That per-paragraph split is **insufficient** for the new forms: a tight list (single `\n`
between items) or a text line immediately followed by a list would land in one block and be misclassified.

Replace it with a **line-based block grouper**: walk the input line by line and emit blocks —

- **Unordered list** — a run of consecutive lines matching `^\s*[-*]\s+` → `<ul><li>`, each `<li>` =
  `renderInline(rest)`. The run ends at the first non-matching line.
- **Ordered list** — a run of `^\s*\d+\.\s+` → `<ol><li>`.
- **Horizontal rule** — a line that is only `---` / `***` / `___` → `<hr>`.
- **Table** — a header row of `| … |` **immediately followed by a delimiter row** (`| --- | :--: |`),
  then consecutive body rows → `<table>`. **The delimiter row is mandatory** (GFM semantics): this is the
  guard that stops a prose line containing a stray `|` (no delimiter beneath it) from being misparsed as a
  table. Verified no golden fixture contains a pipe, so existing report rendering is unaffected. Each cell
  = `renderInline`.
- **Paragraph** — any other run of non-blank lines, split on blank lines exactly as today, `renderInline`
  per paragraph. Preserves current behaviour for prose that has none of the new forms.

Nested lists, multi-line cells, escaped `\|` inside cells, and `#` headings are out of scope (the model
does not emit them in this dock; add heading downgrade if the sweep later shows `#…`). YAGNI.

**Streaming note:** the dock re-renders on every token, so partial markdown (an unclosed `**bold`, a
header row whose delimiter hasn't streamed yet) renders as literal text until its tokens complete, then
snaps into place. Transient and self-correcting — no correctness issue; a test asserts a partial table
(header only, no delimiter) renders as a paragraph, not a broken table.

### 2. Wire `MarkdownBlock` into `AssistantMessage` — assistant role only

`AssistantMessage` renders **both** roles (`AssistantTranscript.tsx:98` calls it for every message). Only
**assistant** prose should be markdown-rendered; **user** echo must stay verbatim plain text (a user
typing `a * b * c` or `- x` should see exactly that, and there is no reason to run `sanitizeProse` on
their own input). So:

```tsx
{message.role === 'assistant'
  ? <MarkdownBlock md={text} className="assistant-message__text" />
  : <p className="assistant-message__text">{text}</p>}
```

`messageText()` preprocessing (pre-tool preamble strip + `<tool_response>` echo drop) is unchanged — it
still selects the visible prose and still returns a raw string (so `condense.ts`, which calls
`messageText().split('\n')`, is unaffected); `MarkdownBlock` only changes how assistant prose is rendered.

**No `sanitizeProse` on the dock path** (both review agents). It is not load-bearing for XSS — the
authoritative barriers are `renderInline`'s React-escaping + the `sanitizeLinkHref` allowlist — and it is
lossy on chat prose (`stripTags` eats `<ЕИК>`/`<име>` placeholders and angle-autolinks; rewrites a literal
`javascript:` mention to `unsafe:`). Dropping it also avoids importing all of `report-schema.ts` into the
client bundle. `MarkdownBlock` never emits raw HTML, so a raw `<script>`/`<img onerror>` in prose renders
as inert escaped text.

### 3. Prompt nudge (seam reinforcement)

`system-prompt.ts` already carries the emit_report policy (§9.10: any number/ranking/comparison/breakdown
MUST call `emit_report`; only clarifying/meta turns stay prose). Add one line: *in prose, never format
multi-row data as a markdown table — call `emit_report`.* Auto-captured by the derived `PROMPT_VERSION`
(fnv1a fingerprint), no manual bump.

### 4. Layer-3 = verification, not new code (integrity-safe)

The original "route prose-tables into `emit_report`" idea is **rejected as an integrity violation**:
report values are bound by reference from server-executed SQL (`ctx.results`), never model-written
numbers. Parsing a prose table's model-typed numbers into a report would launder unverified data into the
provenance-backed surface.

The safe behaviour is **already built**: `messageText()` discards prose *before* the last tool part (its
comment cites "a partial table `| Изпълнител…`"), and the fallback finalizer (`agent.ts`) synthesises a
**bound** report from `ctx.results` when the model gathered data but didn't emit one. So when data exists,
a prose table is already suppressed and replaced by a bound report. Add a test that asserts this; no new
stream code.

Note (informed trade-off): the user chose to render tables in the dock. A stray pipe-table therefore
renders as a real `<table>` styled with `overflow-x:auto`. Its cells still escape HTML (React text
nodes) and it lives in the chat surface, not a report card.

### 5. Shared-surface impact — `MarkdownBlock` also renders report text/callout blocks

`MarkdownBlock` is not dock-only: `ReportBlockRenderer` renders report `text` and `callout` blocks
through it. Extending it therefore **also** grants lists/hr/tables to report prose. This is a conscious,
additive change, not a side effect:

- Lists/hr in a report callout are an improvement (better structure, better a11y).
- A table inside a report **callout** is the same integrity signal we discussed for the dock, but report
  callouts are methodology/source prose, not data — low risk. Report **data** never flows through
  `MarkdownBlock`; it renders through the typed `table` block (`ReportBlockRenderer`), unaffected.
- Report text/callout md is already server-`sanitizeProse`'d, so the security posture is unchanged.

Decision: extend unconditionally (one renderer, simplest) and add a **report-side regression test** that a
callout with a list/hr renders correctly and existing text blocks are unchanged. (Alternative, if reports
must stay frozen: gate the new forms behind a `MarkdownBlock` prop the dock opts into — more code; not
recommended.)

Accessibility bonus: rendering real `<ul>`/`<table>`/`<hr>` instead of literal syntax is a strict
screen-reader improvement on an accessibility-first platform.

## Security / integrity invariants (preserved)

- No `dangerouslySetInnerHTML`; renderer emits React elements only; text is React-escaped.
- No raw-HTML passthrough; the tokenizer never emits HTML tags.
- Link `href` gated by `sanitizeLinkHref` (http/https/relative only); unsafe → plain text.
- Table cells run through `renderInline` → React-escaped; no cell can inject markup.
- Report values remain bound-by-reference; prose numbers are never promoted to a report.

## CSS

Add dock prose styles to `styles/assistant.css` scoped under `.assistant-message__text`: list
indentation/markers, `hr` rule, and `table { display:block; overflow-x:auto }` (+ cell padding/borders)
so a wide table survives the narrow dock without breaking layout. Styled distinctly from a report card so
a chat table does not read as a vetted report.

## Testing

- **`MarkdownBlock.test.tsx`** (extend — file exists): unordered list, ordered list, `hr`, table
  (header+delimiter+body) each render to the expected elements; a single line with a stray `|` and **no**
  delimiter row stays a paragraph (false-match guard); a partial table (header only, no delimiter row yet)
  renders as a paragraph (streaming guard); a text line immediately followed by a list (single `\n`)
  produces a paragraph **then** a list (mixed-block / line-grouping guard); existing XSS tests still pass;
  a `<script>`/`onerror` inside a table cell renders inert; a `javascript:` link inside a list item
  degrades to text.
- **`AssistantMessage.test.tsx`** (extend — file exists): an **assistant** message with bold+bullets+hr
  renders structured elements (not literal syntax); a **user** message with `*` / `-` renders **verbatim
  plain text** (role gating); `messageText` preamble/echo filtering unchanged; raw `<script>` in assistant
  prose renders inert text.
- **Report regression** (`ReportBlockRenderer` / `MarkdownBlock`): a report callout containing a list/hr
  renders correctly; a plain text block is unchanged (shared-surface guard).
- **`agent`/stream test** (layer 3): a completed prose turn containing a markdown table **with**
  `ctx.results` yields the fallback bound report and the prose table is not surfaced.
- **`system-prompt.test.ts`**: the new table-nudge line is present; `PROMPT_VERSION` re-fingerprints.
- Gates: `pnpm --filter web run typecheck`, vitest (web + golden), prettier `--check`.

## Scope

- **In:** the four changes above + tests + CSS. Feature change → lands on both `feat/ai-assistant-contracts`
  and `feat/ai-assistant` (parity). Same PR as the assistant work, per the "same PR" instruction.
- **Out (YAGNI):** react-markdown/any md dep; nested lists; multi-line table cells; blockquotes; headings
  (`#` — model does not emit them in prose; add later if observed); server-side stream surgery to strip
  tables; routing prose numbers into reports (integrity-barred).

## Verification target

Re-run the reproduced turn („обясни възложител vs изпълнител…") on the `sigma-pr-17` ephemeral env after
deploy; confirm bold/bullets/hr render structured. Spot-check a table-producing turn.
