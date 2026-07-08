# Turnstile assistant gate: Firefox chat 403 (PAT + IPv6-only challenge host)

**Status:** open · **Area:** Lane H3 (assistant Turnstile bot gate) · **Reported by:** msh · 2026-07-07

## Symptom

The assistant chat works in **Chrome** but returns **403** in **Firefox** — the bot gate rejects the
request. Reproduced on a real Windows Firefox and on preview deployments (`sigma-pr-17`, `sigma-pr-65`).

## Root cause

Turnstile serves a **Private Access Token (PAT)** challenge to Firefox (Chrome gets a different flow).
The PAT flow fetches from a challenge **subdomain** `brunhild.challenges.cloudflare.com`, and that host
is **IPv6-only** — it has an `AAAA` record but **no `A` record**:

```
challenges.cloudflare.com          A 104.18.95.41 …   AAAA 2606:4700::…   (dual-stack)
brunhild.challenges.cloudflare.com A (none)           AAAA 2606:4700::…   (IPv6-only)
```

On a network without working IPv6 the host cannot be resolved/reached, so the PAT request fails:

```
"Request for the Private Access Token challenge."
Cross-Origin Request Blocked … brunhild.challenges.cloudflare.com … (Reason: CORS request did not succeed). Status (null)
GET …/cdn-cgi/challenge-platform/h/b/pat/… → HTTP 401
→ no cf-turnstile-response token → POST /assistant/chat → 403
```

Setting Firefox `network.dns.disableIPv6=true` does **not** help — `brunhild` has no IPv4 at all.
Cloudflare's own tester (`browser-compat.turnstile.workers.dev`) works because it renders a **visible**
widget, which has an interactive fallback and does not dead-end on the PAT path.

Community report of the same IPv6-only host:
<https://community.cloudflare.com/t/turnstile-net-err-name-not-resolved-error-in-console-on-brunhild-challenges/937102>

## What it is NOT

- **Not our CSP.** Our policy already matches Cloudflare's documented Turnstile requirements
  (`script-src`/`frame-src https://challenges.cloudflare.com`, `connect-src 'self'`). A trial that added
  `*.challenges.cloudflare.com` did not help (PR #65, closed) — the `brunhild` fetch is made by the
  Turnstile iframe (its own CSP), not our page, and failed at DNS, not CSP.
- **Not the `root-*.js: Missing 'unsafe-eval'` console error.** That's a bundled `try{Function('')}catch{}`
  feature probe that fails closed; harmless.

## Why our widget is maximally exposed

Our gate (`useTurnstileGate.ts`) renders an **invisible** widget (`execution:'execute'`, `display:none`)
and mints a fresh token per send. With no visible surface, Turnstile has no interactive fallback to offer
when PAT fails — so the IPv6-less Firefox user is hard-blocked.

## Options

1. **Visible "Managed" widget** — ✅ **CONFIRMED FIX** (msh, 2026-07-08, real Firefox on PR #67 /
   `experiment/turnstile-visible-widget`). Matches Cloudflare's working tester; the interactive fallback
   avoids the PAT dead-end and the chat succeeds. Trade-off: a visible Turnstile widget/challenge appears
   — a change to H3's silent design; **needs team sign-off** (see "Decision needed").
2. **Report to Cloudflare** and track their fix (make the PAT/challenge hosts dual-stack). Out of our
   control; timeline unknown — not something to block on.
3. **Graceful degradation** (product/security call): today the gate is fail-closed in prod (PR #64), so
   every IPv6-less Firefox user is fully blocked. Decide whether a token-mint failure should soft-degrade
   instead of hard-403 — weighed against the bot-protection the gate exists to provide.

## Impact

Any legitimate visitor on an **IPv6-less network using a browser Turnstile serves PAT to** (Firefox
observed) is fully blocked from the assistant once the gate is active. This is a launch-gate
consideration, not a cosmetic bug.

## Decision needed (team)

The invisible→visible switch (option 1) is a confirmed, working fix but it changes H3's agreed **silent**
design. Before polishing PR #67 into a mergeable change, the team should agree on:

- **Adopt the visible Managed widget?** (yes → we make H3 a visible gate.)
- **Placement/UX:** the prototype floats a widget bottom-left; the real version should live in/near the
  assistant dock and appear only when the dock is in use. Where exactly, and shown always or on first
  send?
- **Fallback stance:** keep fail-closed (PR #64) — accepting that any future Turnstile-serves-PAT +
  IPv6-less case is blocked — or add a soft-degrade path (option 3)?
