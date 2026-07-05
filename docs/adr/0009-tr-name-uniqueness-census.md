# ADR-0009: TR name-uniqueness census (promoting tier-C generic-name matches)

- Status: Accepted (design; implemented as a Phase-1 pipeline step)
- Date: 2026-07-05
- Deciders: lb, Claude
- Related: [ADR-0003](0003-name-uniqueness-guard-and-publish-tiers.md); spec §5

## Context

ADR-0003 holds back "tier C" matches — a *generic* company name (e.g. „В и К" ООД) with exactly one
*winner* namesake — because the winner set alone cannot prove the name is **globally** unique in the
Trade Register. Phase 0 left 63 such matches unpublished. To promote them safely we need a global
name→ЕИК multiplicity check, from a lawful, deterministic, public source.

## Decision

Use the **Commercial Register open-data dump** published on `data.egov.bg` (provided by the State
e-Government Agency) as the census source:

- It is **public open data** and **DPA-safe** — ЕГН/ЛНЧ are hashed out; company name + ЕИК are retained.
  Using it to compute a name-frequency index is an internal uniqueness check, not third-party republication.
- Daily full snapshots in JSON/XML (bulk `.zip`). Ingest one snapshot → build a
  **`companyNameKey(name) → count(distinct ЕИК)`** index over all active entities (same normalizer,
  ADR-0002, so the census key space is identical to the matcher's).
- **Promotion rule (deterministic):** a tier-C match promotes to publishable iff its name-key has
  **exactly one** entity in TR **and** that ЕИК equals the matched winner ЕИК. Key count > 1 → the name
  is genuinely shared → stays held (or routes to seat/other disambiguation). No heuristic in the promotion.

## Consequences

- Closes the last residual libel surface for generic names with a purely deterministic, public check.
- Cost: a large bulk download + index build; it rides the same fetch→extract→R2 pattern as CACBG
  (ADR-0006), refreshed on the same cron cadence (TR changes daily; a stale census can wrongly promote).
- Scope guard: the TR dump is used **only** for the name-multiplicity index and per-ЕИК owner lookups
  (leg 2) — never bulk-republished, per the TR reuse constraints noted in the spec.
- Until the census runs, tier-C stays unpublished — fail-closed, never a guessed publish.
