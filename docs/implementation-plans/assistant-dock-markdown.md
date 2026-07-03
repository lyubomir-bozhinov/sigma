# Implementation Plan: Assistant dock markdown rendering

**Spec:** `docs/superpowers/specs/2026-07-03-assistant-dock-markdown-design.md`
**Created:** 2026-07-03
**Branch:** `feat/ai-assistant-contracts` → mirror to `feat/ai-assistant` (dual-PR parity)
**Complexity:** Low–Medium · **Risk:** Medium (XSS surface, shared renderer) · **Est:** ~½ day
**Status:** Draft — under review

## Executive summary

The dock renders assistant prose as literal text; the model emits `**bold**`, `*` lists, `---`, pipe
tables (empirically confirmed on `sigma-pr-17`). Fix by **reusing + extending** the existing safe
renderer `MarkdownBlock` (no new dep, no `dangerouslySetInnerHTML`), wiring it into `AssistantMessage`
for the **assistant role only**, adding a one-line prompt nudge, and covering it with tests. Integrity
model (report values bound from SQL, never prose numbers) is untouched.

## Critical standards (CLAUDE.md)

- No `dangerouslySetInnerHTML`; React elements only; text React-escaped.
- No new dependency (reuse `MarkdownBlock` — no code duplication).
- Tests written alongside; 100% meaningful coverage of new logic; no cheater tests.
- Every failure path handled (unsafe href → text; malformed table → paragraph).
- Prettier + typecheck + vitest (web + golden) green; secret-scan clean.

## Current state (verified at HEAD `0461dfc`)

| File | Role | Change |
|---|---|---|
| `apps/web/app/components/MarkdownBlock.tsx` | safe renderer (bold/italic/code/links/para) | **extend**: lists, hr, tables via line-based grouper |
| `apps/web/app/lib/assistant-dock/AssistantMessage.tsx` | dock prose (`<p>{text}</p>`, both roles) | **edit**: assistant-role → `MarkdownBlock`, user stays plain |
| `apps/web/app/lib/sanitize-markdown.ts` | `sanitizeLinkHref` allowlist (authoritative href barrier) | reuse (no change) |
| `apps/web/app/lib/assistant/report-schema.ts` | `sanitizeProse` (report path only) | **not touched** — deliberately NOT used on dock prose (lossy + redundant) |
| `apps/web/app/lib/assistant/system-prompt.ts` | prompt (§9.10 seam) | **edit**: +1 table-nudge line |
| `apps/web/app/styles/assistant.css` | dock CSS | **edit**: list/hr/table prose styles |
| `apps/web/app/components/MarkdownBlock.test.tsx` | tests (exists) | **extend** |
| `apps/web/app/lib/assistant-dock/AssistantMessage.test.tsx` | tests (exists) | **extend** |

## Target design — extended `MarkdownBlock`

Replace the `md.split(/\n{2,}/)` paragraph loop with a **line-based block grouper** (`renderBlocks`).
**Normalize line endings first** (`md.replace(/\r\n?/g, '\n')`) so CRLF paste / non-LF sources don't leak
a `\r` into list-item or paragraph text (review finding #2). Walk lines; emit blocks; each list item /
table cell / paragraph runs through the **unchanged** `renderInline`. Predicates:

```ts
const isUl    = (l: string) => /^\s*[-*]\s+/.test(l);
const isOl    = (l: string) => /^\s*\d+\.\s+/.test(l);
const isHr    = (l: string) => /^\s*([-*_])\1{2,}\s*$/.test(l);      // ---, ***, ___ (3+), no pipes
const isRow   = (l: string) => /^\s*\|.*\|\s*$/.test(l);            // a pipe row
const isDelim = (l: string) => {                                    // GFM delimiter row (mandatory)
  const t = l.trim();
  return t.includes('|') && t.includes('-') && /^[\s|:-]+$/.test(t);
};
const splitRow = (l: string) =>
  l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
```

Grouping order per non-blank line: **hr → table (row + next-line delimiter) → ul → ol → paragraph**
(paragraph accumulates until a blank line or any block-form boundary; joined with `\n`, then **`.trim()`**
to match the old `p.trim()` behaviour, then `renderInline`). Table branch **MUST bounds-check before the
lookahead**: `isRow(line) && i + 1 < lines.length && isDelim(lines[i + 1])` — calling `isDelim(undefined)`
throws (`undefined.trim()`), and the last-line-is-a-row case is exactly the streaming partial-table test
(review finding #1, HIGH). A lone `|` row with no delimiter beneath falls to paragraph (false-match guard).
Table = `<table><thead>` (header cells) `<tbody>` (body rows); every cell `renderInline`. Lists =
`<ul>/<ol>` of `<li>{renderInline(rest)}</li>`. Keys are positional (stateless render — a mid-stream key
shift is a cosmetic flash that self-corrects; tests assert the **settled** output, not intermediate
streaming states — review finding #6).

No raw HTML is ever emitted; unsafe link hrefs already degrade to text via `sanitizeLinkHref`. So a
`<script>` / `onerror` / `javascript:` inside any cell or item is inert exactly as in the existing tests.

## Implementation phases (TDD — RED before GREEN)

### Phase 1 — extend `MarkdownBlock` (I implement; risky/XSS → not offloaded)

**1.0 RED — `MarkdownBlock.test.tsx`** (add cases, run, watch fail):
- ul: `"- a\n- b"` → `<ul>` with 2 `<li>`; ol: `"1. a\n2. b"` → `<ol>`.
- hr: `"a\n\n---\n\nb"` → `<hr>` between two `<p>`.
- table: header+delimiter+2 rows → `<table>` with 1 header row + 2 body rows; cell `**x**` → `<strong>`.
- false-match: `"A | B тест"` (no delimiter) → one `<p>`, **no** `<table>`.
- streaming: `"| a | b |"` alone (no delimiter yet) → `<p>`, no `<table>`.
- mixed block: `"въведение\n- a\n- b"` → `<p>въведение</p>` **then** `<ul>` (line-grouping).
- XSS (lock the invariant — every href sink stays behind `sanitizeLinkHref`, per security review):
  `<script>` / `<img src=x onerror=…>` in a cell and in a list item → inert text (no element);
  `[x](javascript:alert(1))` in a `<li>` → text, no `<a>`;
  `| [x](javascript&#58;alert(1)) |` entity-encoded scheme in a **cell** → no `<a>`;
  `| [x](java<TAB>script:alert(1)) |` tab-split scheme in a **cell** → no `<a>` (URL parser strips tabs);
  `<https://x>` autolink in a **cell** → no `<a>` (no autolink rule; angle text stays literal).
- existing bold/italic/code/link/paragraph/blank-input tests still pass.

**1.1 GREEN** — add `renderBlocks` + predicates above; `MarkdownBlock` returns
`<div className={className}>{renderBlocks(md)}</div>`. `renderInline` untouched.

**Verify:** `pnpm --filter web exec vitest run app/components/MarkdownBlock.test.tsx`

### Phase 2 — wire into `AssistantMessage` (assistant-role only)

**2.0 RED — `AssistantMessage.test.tsx`**: an assistant message `"**x**\n- a\n- b"` renders `<strong>` +
`<ul>` (not literal); a **user** message `"a * b * c"` renders verbatim plain text (no `<em>`); raw
`<script>` in assistant prose → inert text; an angle-bracket placeholder like `"<ЕИК>"` renders **visibly**
(not stripped); `messageText` preamble/echo filtering unchanged.

**2.1 GREEN** — in `AssistantMessage`:
```tsx
{message.role === 'assistant'
  ? <MarkdownBlock md={text} className="assistant-message__text" />
  : <p className="assistant-message__text">{text}</p>}
```
Import `MarkdownBlock` from `~/components/MarkdownBlock`. `messageText()` unchanged.

**Decision — do NOT run `sanitizeProse` on dock prose** (both reviewers). It is **not load-bearing for
XSS** (the authoritative barriers are `renderInline`'s React-escaping + the `sanitizeLinkHref` allowlist —
security review confirmed every sink is gated, incl. entity-encoded/tab-split schemes and raw
`<img onerror>` in cells). Running it would be actively **lossy**: `stripTags` silently eats legit chat
content — `<ЕИК>`/`<име>` placeholders, angle-autolinks — and rewrites a literal `javascript:` mention to
`unsafe:`. Dropping it also removes the bundle-weight concern of importing all of `report-schema.ts`
(636 lines, no tree-shake annotation — React review finding #5). One decision resolves both findings.

**Verify:** `pnpm --filter web exec vitest run app/lib/assistant-dock/AssistantMessage.test.tsx`

### Phase 3 — dock CSS (`styles/assistant.css`)

Under `.assistant-message__text`: `ul,ol` indent + markers; `li` spacing; `hr` thin rule with margin;
`table { display:block; overflow-x:auto; border-collapse:collapse }`, `th,td { padding; border; text-align:left }`,
`th { font-weight:600 }`. Styled distinctly from a report card (chat table ≠ vetted report). No JS.

**Verify:** visual on `sigma-pr-17` post-deploy; `prettier --check`.

### Phase 4 — prompt nudge (`system-prompt.ts`)

**4.0 RED — `system-prompt.test.ts`**: assert the built prompt contains the new instruction substring;
assert `PROMPT_VERSION` differs from the pre-edit fingerprint (or that `buildSystemPrompt({})` changed).

**4.1 GREEN** — append one BG line to the emit_report policy block: in prose, never format multi-row data
as a markdown table — call `emit_report`. Auto-captured by the fnv1a `PROMPT_VERSION`.

**Verify:** `pnpm --filter web exec vitest run app/lib/assistant/system-prompt.test.ts`

### Phase 5 — layer-3 verification (no new code, integrity guard)

Add an `agent`/stream test asserting: a completed prose turn whose text contains a markdown table, **with**
`ctx.results` present and no model `emit_report`, yields the fallback **bound** report and the prose table
is not surfaced (via `messageText` after-last-tool-part slice). Confirms the safe path is already built;
fails loudly if a refactor ever regresses it. If the existing harness can't express this cheaply, assert
the two invariants directly (`messageText` drops pre-tool text; fallback fires when `results>0 && !reportEmitted`).

### Phase 6 — report-callout regression (shared-surface guard)

Test (`MarkdownBlock`/`ReportBlockRenderer`): a report callout md with a list/hr renders the new elements
**intentionally** (a callout „Забележка" body with a bullet/numbered line is realistic); a callout with
**no** list/table/hr content renders unchanged for that content — **not** "byte-for-byte unchanged" overall
(review finding #3: any existing text/callout md with a `- `/`* `/`N. ` line now renders as a list, by
design). Confirms extending the shared renderer disturbs the report surface only where intended; report
**data** (typed `table` block) is untouched. If tests compare `textContent`, normalize whitespace (the
paragraph path now `.trim()`s but line-internal whitespace differs cosmetically — review finding #4).

### Phase 7 — gates + mirror

- `pnpm --filter web run typecheck` · vitest (web + golden) · `prettier --check .` · secret-scan.
- Commit on contracts; **cherry-pick `-x`** the same commits onto `feat/ai-assistant`; assert
  `diff(feat, contracts) == deploy-layer-only` (parity invariant). Push only when asked.

## Testing strategy

TDD per phase (RED→GREEN). New logic (grouper, predicates, role gate, prompt line) at 100% meaningful
coverage — adversarial cases (XSS-in-cell, false-match, mixed-block, streaming-partial) are the point, not
happy-path. No mocking of the renderer; render real React and assert the DOM.

## Risk assessment

| Risk | Sev | Mitigation |
|---|---|---|
| XSS via new block forms (table cell / list item) | High | All text → `renderInline` → React-escaped; no raw HTML emitted; href allowlist; explicit inert-in-cell tests |
| Stray `|` in report/dock prose misparsed as table | Med | Mandatory delimiter row; verified no golden fixture has pipes; false-match test |
| Shared-renderer change regresses report text/callout | Med | Additive forms only; report-callout regression test; report data unaffected (typed block) |
| Streaming shows transient literal markdown | Low | Cosmetic, self-correcting; documented; partial-table test |
| Table-in-dock implies vetted data | Low (accepted) | User's informed choice; distinct styling; integrity path unchanged |

## Rollout

Pre: gates green, parity asserted. Deploy: ephemeral `sigma-pr-17` (contracts) — re-run the reproduced
turn („обясни възложител vs изпълнител…") and a table-producing turn; confirm structured render. No data
migration, no config, no secret. Rollback: revert the renderer/wiring commits (pure UI; no state).

## Success criteria

- [ ] Assistant prose renders bold/italic/lists/hr/tables as elements, not literal syntax
- [ ] User echo stays verbatim plain text
- [ ] `<script>`/`onerror`/`javascript:` inert in every position (para, list, cell, link)
- [ ] Stray-pipe and partial-table stay paragraphs (guards)
- [ ] Report text/callout regression test green; report data unchanged
- [ ] Prompt nudge present; `PROMPT_VERSION` re-fingerprints
- [ ] Layer-3 invariant test green (prose numbers never promoted to a report)
- [ ] typecheck + vitest + prettier green; parity invariant holds; no new dep

## Multi-agent review (consensus)

Two focused reviewers (proportionate to a single-renderer change), independent, adversarial.

**Security (frontend-security-coder) — PASS, no exploitable XSS.** Traced every text→DOM path: `renderInline`
is the sole sink, all string children React-escaped, `<a>` the only dynamic attribute and always behind
`sanitizeLinkHref`; `splitRow` runs before `renderInline` so a link can't span cells; no ReDoS in
`isDelim`/`isRow`/`isHr` (short-circuits + single-quantifier). Verified inert: entity-encoded scheme,
tab/newline-split scheme (URL parser strips), raw `<img onerror>`, markup-as-link-text, autolinks.
Actionable: **drop client `sanitizeProse`** (redundant + lossy) — adopted; +3 cell XSS tests — adopted.

**React correctness (react-quality-engineer) — 1 HIGH + 2 MED + 3 LOW, all resolved in-plan:**
- HIGH #1 — `isDelim(lines[i+1])` throws on a last-line row (streaming) → **fixed**: bounds-check before lookahead.
- MED #2 — CRLF leaves `\r` in content → **fixed**: normalize `\r\n?`→`\n` at entry.
- MED #3 — Phase 6 "byte-for-byte unchanged" false for callouts with list-like lines → **fixed**: reworded + adversarial test.
- LOW #4 — paragraph join dropped old `p.trim()` → **fixed**: `.trim()` retained.
- LOW #5 — `sanitizeProse` import ships all of `report-schema.ts` → **resolved by dropping it** (same decision as security).
- LOW #6 — positional keys shift mid-stream (stateless, cosmetic) → **noted**: tests assert settled output.
- Confirmed: React-Compiler compatible, no `forwardRef`/manual memo, `report-schema.ts` client-safe.

Consensus: **approved with the above changes applied.** No open disagreements.

---
**Status:** Reviewed — pending user approval
