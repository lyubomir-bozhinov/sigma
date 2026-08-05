# Plan — ChatGPT/Claude-grade compose box, voice mode & chat experience

Bring the assistant dock's **composer, voice input, and chat surface** up to the interaction
quality of ChatGPT / Claude.ai — unified input container, icon-first controls, reactive voice
feedback, and a calmer conversation view — **without** regressing the dock's accessibility
contracts, house design language, or the weak-model / step-budget constraints.

## Guardrails (non-negotiable, carry through every phase)

- **A11y contracts stay intact.** Voice is dictation → editable draft, **never auto-sent**
  (`AssistantComposer.tsx:24`). Keep the polite `role="status"` live region, the focus-stays-on-mic
  rule, the transcript's `role="log"` / settle-announcement machinery, and all WCAG 2.2 target-size
  notes already annotated in `assistant.css`.
- **House tokens only.** No webfonts, no icon library, no CSS framework. Reuse `--accent`, `--paper*`,
  `--ink*`, `--rule`, `--s-*` spacing. Inline SVGs like the existing `MIC_ICON` / `STOP_ICON`.
- **Bulgarian copy**, matching the existing register. New strings live beside the components.
- **Weak model / budget.** The assistant is a ~31B model on a tight step budget
  ([[assistant-weak-model-constraints]]). No feature here may add model round-trips. Full
  conversational voice (TTS back) is explicitly **out of the default scope** — see Phase 4.
- **Scope discipline (AGENTS.md).** One logical change per PR; don't touch report-page or ETL code.

## Reference patterns we're matching

| Pattern | ChatGPT | Claude.ai | Sigma today |
|---|---|---|---|
| Input + controls | one rounded pill | one rounded box, controls on inner bottom edge | **stacked**: bordered textarea + separate action row |
| Send | compact circular ↑, enables on text | compact circular ↑ | full-width text "Изпрати", grey when empty |
| Mic placement | inline right, next to send | inline right | detached, bottom-left |
| Voice affordances | dictation **and** conversational "Voice" | dictation | dictation only |
| Recording feedback | amplitude-reactive waveform | amplitude-reactive | **fixed** CSS equalizer (not level-driven) |
| Permission hang | prompt forces choice | prompt forces choice | **stuck in "requesting…"**, no timeout |

Verified live against the PR-17 preview on 2026-07-29 (idle / typed / requesting / recording states).

---

## Phase 1 — Unified composer shell (look)

**Goal:** the composer reads as one input surface, like both references.

**Files:** `AssistantComposer.tsx`, `assistant.css` (`.assistant-composer*`).

- Wrap the textarea + action row in a single container `.assistant-composer__box`:
  rounded (`border-radius: 12px`), `1px solid var(--rule)`, `var(--paper)` background.
- Move the border **off** `.assistant-composer__input` (it becomes borderless, transparent) and the
  focus ring **onto the box** via `:focus-within` — one accent outline for the whole control
  (keep the existing `outline: 2px solid var(--accent); outline-offset: 2px` treatment).
- Action row sits inside the box, below the textarea, no top border — mic left, primary action right.
- Keep auto-grow (`AssistantComposer.tsx:69`) and the `min/max-height` caps.

**Acceptance:** visually one pill; focus ring wraps input+controls; no layout shift when the row
appears; `AssistantComposer.test.tsx` still green (update DOM-structure assertions only).

## Phase 2 — Icon-first Send / Stop + inline mic (look + feel)

**Files:** `AssistantComposer.tsx`, `AssistantComposerMic.tsx`, `assistant.css`.

- Replace the text **"Изпрати"** with a **circular ↑ icon button**, `aria-label="Изпрати"`,
  disabled until `canSend`. Add a `SEND_ICON` inline SVG next to the existing mic/stop icons.
  Keep the accessible name so SR/cognitive users are unaffected (the reference send buttons are
  icon-only; we keep the label in the a11y tree).
- **Стоп** while busy: same circular slot, square/⏹ icon, `aria-label="Спри"` — the swap already
  exists (`AssistantComposer.tsx:126`), just restyle to the icon slot. Keep it a distinct visual
  (not accent-filled) so "stop generating" never looks like "send".
- Move the mic into the right cluster, immediately left of Send (`.assistant-composer__actions-end`).
  Collapse **"Изчисти"** into a small ✕ ghost icon button (`aria-label="Изчисти"`) shown only when
  `canSend`, so the row stays uncluttered in the ~400px dock.
- Bump primary controls to **~40px** hit area on the mobile sheet (`@media (max-width:760px)`),
  above the 24px floor the desktop dock uses.

**Acceptance:** send/stop/mic/clear all keyboard-reachable with correct names; `canSend` gating
unchanged; Enter-sends / Shift+Enter-newline unchanged; touch targets ≥40px on the sheet.

## Phase 3 — Voice dictation polish (feel + reliability)

The biggest perceived-quality gains; all within the existing record→Whisper pipeline (no model cost).

**Files:** `useVoiceInput.ts`, `AssistantComposerMic.tsx`, `errors.ts`, `assistant.css`, tests.

1. **Amplitude-reactive visualizer.** `startSilenceMonitor` already computes live RMS
   (`useVoiceInput.ts:216`). Expose a throttled level (rAF or the existing 250ms tick) and drive the
   13 bar heights from it instead of the fixed `assistant-mic-eq` keyframe. This is the single change
   that makes recording feel like ChatGPT/Claude — and it's almost free. Preserve the
   `prefers-reduced-motion` freeze (fall back to the static bars there).
2. **Requesting timeout / escape.** Add a bounded guard around `getUserMedia` (e.g. 10s): if the
   permission request neither resolves nor rejects (ignored prompt, embedded webview), fail into the
   normal error state with an actionable message instead of a dead disabled mic. Verified gap on the
   preview — the mic sat in "Изисква се достъп…" with no exit.
3. **Cancel vs. Stop while recording.** Show two controls during `recording`: **✓ Готово**
   (stop → transcribe, current behaviour) and **✕ Откажи** (discard chunks, no transcribe fetch —
   cheaper and clearer than leaning on the no-speech guard). Mirrors ChatGPT dictation's ✕/✓.
4. **Discoverability.** First-run tooltip / `aria-describedby` hint "Говорете вместо да пишете" on the
   mic, dismissed after first use (localStorage flag). Helps low-literacy users find voice.

**Acceptance:** bar heights track spoken volume; ignored permission prompt resolves to an error within
the timeout; cancel path fires **no** `/assistant/transcribe` request; existing `useVoiceInput` teardown,
VAD auto-stop, 60s cap, and Turnstile-token tests stay green.

## Phase 4 — Conversational "Voice mode" (optional, separately scoped)

ChatGPT's second affordance (speak ↔ hear spoken replies). **Not** in the default rollout.

- Would need Bulgarian **TTS** + streaming **STT** + barge-in + a full-panel voice UI, and adds
  model/latency load the current ~31B/budget setup can't absorb ([[assistant-weak-model-constraints]]).
- **Recommendation:** keep as a documented future initiative with its own cost/latency budget and a
  separate design doc. Do **not** build speculatively. If pursued, gate behind capability + an explicit
  opt-in, and reuse the Phase-3 recording UI as the entry animation.

## Phase 5 — Chat experience polish (feel)

Make the conversation view read like the references without touching the streaming/tool contract.

**Files:** `AssistantMessage.tsx` + `.assistant-message*` CSS; `AssistantTranscript.tsx`;
`AssistantEmptyState.tsx` + `.assistant-empty*`; `AssistantPhaseLine`.

- **Message bubbles.** User echo is already a right-aligned bubble (`.assistant-message--user`).
  Give assistant turns a touch more vertical rhythm and an optional avatar/label row ("Асистент") so
  the two roles read distinctly, like both references. Keep assistant prose full-width (tables/reports
  need it).
- **Streaming affordance.** Add a subtle typing/caret indicator on the in-flight turn to match the
  references' "generating" cue, driven by `busy`+last-message — without disturbing the
  `aria-live="off"` streaming rule (`AssistantTranscript.tsx:178`) or the settle announcement.
- **Empty state as suggestion chips.** `AssistantEmptyState` already renders starter prompts as a
  vertical list — restyle to chip cards (like ChatGPT's suggestion grid) using the server-authored
  `send` values already wired (`useStarterPrompts`). Copy/behaviour unchanged.
- **Message actions (optional).** Copy-to-clipboard on assistant turns (and, if cheap, a
  regenerate that re-POSTs the prior user turn). Regenerate costs a model call — gate it as optional.
- **Scroll-to-bottom pill** when the reader has scrolled up during streaming (the stick-to-bottom
  logic already exists at `AssistantTranscript.tsx:127` — surface a button when detached).

**Acceptance:** role distinction is visually clear; streaming indicator doesn't re-trigger SR
announcements; empty-state chips POST the same `send` payloads; scroll-stick behaviour unchanged.

---

## Sequencing & PRs

| PR | Scope | Risk | Model cost |
|---|---|---|---|
| 1 | Phase 1 + 2 (shell, icon send, inline mic) | low | none |
| 2 | Phase 3 (reactive viz, timeout, cancel, discoverability) | low–med | none |
| 3 | Phase 5 (chat polish, minus regenerate) | low | none |
| — | Phase 4 (conversational voice) | high | high — **defer**, own doc |
| — | regenerate / message actions | med | per-use — optional |

Branch names: `feat/assistant-composer-shell`, `feat/assistant-voice-polish`, `feat/assistant-chat-polish`.
First slice (PR 1) is the highest look-and-feel payoff at the lowest risk.

## Validation per PR (per the fork-sync runbook, Stage 4)

- **Unit/component:** update + extend the co-located tests (`AssistantComposer.test.tsx`,
  `AssistantComposerMic.test.tsx`, `useVoiceInput.test.tsx`, transcript/empty-state tests). Run via the
  `test-runner` subagent, never bare jest.
- **Adversarial review:** `/code-review-pr-strict` (or `/code-review ultra`) on the branch diff.
- **Playwright on the PR preview** (`sigma-pr-<n>.<subdomain>.workers.dev`): drive idle → typed →
  recording (stub `getUserMedia`/`MediaRecorder` as done on 2026-07-29) and the requesting-timeout path;
  capture before/after screenshots as PR evidence.
- **A11y regression pass:** keyboard-only walkthrough (Tab order mic↔clear↔send), reduced-motion check
  on the visualizer, and SR announcement of send/record/settle. Honour `html.a11y-textonly` relinearise
  rules already in `assistant.css`.

## Out of scope

- `+` attachments menu (both references have it; irrelevant to a data-transparency assistant — the slot
  is better reserved for a future page-context chip).
- Report-page (`/reports/:id`) and ETL/db changes.
- Any change to the streaming/tool-call contract or the report chip projection.
