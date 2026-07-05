# 0001 — Report dedup (Lane F) applies only to explicitly-resolved, settled periods

- Status: Accepted
- Date: 2026-07-05
- Relates to: [`docs/spec/ai-assistant-dedup.md`](../spec/ai-assistant-dedup.md) (Lane F), #97 (no-divergence), the L1 report-cache gate in `apps/web/workers/assistant/dedup-request.ts`

## Context

Lane F caches generated reports so identical questions reuse one immutable `/reports/:id` artifact. A cache entry is validated by an embedded **freshness token** `d:<home_totals.refreshed_at>|c:<BUILD_ID>` — a **single global data version** for the whole corpus. The spec's master invariant scopes the consistency guarantee to *"the same **fixed-period** question"* (§0), and §1 assumes precompute stamps `refreshed_at` atomically per run.

The L1 layer (`buildDedupRequest`) folds a question's resolved absolute period bounds into its key. As first implemented it deduped **any** resolved period, and deduped **all-time / no-period** questions on the freshness token alone. Two problems follow for a window that is still accruing data — a current/partial period like „за 2026" mid-year, or an all-time query (which includes the growing present):

1. The freshness token invalidates **globally every epoch**, so an open-period report is regenerated on every refresh regardless — L1 buys it no durable cross-epoch reuse. The cache value is almost entirely in **fixed** periods, whose answer is immutable.
2. The token is a single coarse global version. If any queryable contract data ever changes without bumping `refreshed_at` (the route already treats this window as possible — `assistant.chat.tsx`: *"data changes before refreshed_at updates → a stale serve"*), an L1 hit serves a report that **under-counts a NAMED partial window**. On a public transparency platform, misstating "top authorities for 2026" is an accuracy defect, and accuracy defects are hard merge blockers.

temporal.ts already computes exactly the needed signal: `ResolvedPeriod.recencyCaveat` is true when a period's (exclusive) end is within the ingest-lag window — i.e. its data may still be settling. „2025" asked in 2026 → `false`; „2026" / „този месец" / a just-closed month still in ingest lag → `true`. It is strictly better than a naïve calendar open/closed test because it also catches the just-closed-but-still-ingesting tail.

## Decision

Restrict L1 report dedup to an **explicitly-resolved, settled period**:

```
l1Safe = prompt is non-empty
       AND a period was resolved (temporal.ts pinned absolute bounds)
       AND that period is not still settling (recencyCaveat === false)
```

Everything else — no period at all (all-time / no date phrase / an unresolvable relative phrase, #97), or a settling period — **skips L1** and regenerates each turn, falling through to L0 (per-submission idempotency) when a `clientRequestId` is present. Skipping only ever costs a regenerate, never a wrong answer (fail toward regeneration).

This subsumes the earlier `hasUnresolvedRelativeDate` guard (no period ⇒ no L1 already), which is removed along with the now-dead `temporalResolved` input.

## Consequences

- **Correctness independent of the atomicity assumption** for the highest-visibility case: a named partial window is never served from a within-epoch-stale cache. The implementation now matches the spec's already-stated "fixed-period" guarantee scope.
- **Negligible cache loss.** Open/current and all-time questions never durably deduped across epochs anyway (the token busts them each refresh); within-epoch concurrent double-submits of the *same* click are still collapsed by L0. The durable dedup target — fixed past periods — is unchanged.
- **The single-flight DO key for L1 now always carries a `p:<since>..<until>` prefix.** The period-less L1 path is gone, so the field-boundary collision the escaped DO name guarded is unreachable via the public API; `escapeDoField` is kept as cheap defense for the free-text `filterContext` (FE-supplied, may contain `|`).
- If precompute ever refreshes tables independently (breaking the §1 atomicity assumption), fixed-period dedup remains safe because settled data does not change; only the open-period path — already excluded — would have been exposed.
