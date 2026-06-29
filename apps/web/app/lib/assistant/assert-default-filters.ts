// E3 — Guard G1 (step 2): the structural default-filters gate.
//
// `applyDefaultFilters` (workers/assistant/default-filters.ts) is the deterministic SOURCE of the safe
// contract defaults — it emits the exact predicate fragment the query layer appends and the callout
// surfaced to the reader. This gate is the VERIFIER for the path where the model wrote its own SQL: if
// the query reads the base `contracts` table it MUST already carry those defaults, otherwise live
// aggregates silently diverge from the rollups (amount_eur NULL rows leak in) or mix in synthetic
// orphan tenders. We do not re-derive the predicate strings here — we read them back off
// `applyDefaultFilters()` and match a normalized form, so this gate stays in lock-step with the source.
//
// Rollup tables (authority_totals/sector_totals/company_totals/home_totals) already encode the filter
// in their materialization, so a query that never touches base `contracts` BYPASSES the gate.

import { applyDefaultFilters } from '../../../workers/assistant/default-filters';

export type DefaultFiltersResult = { ok: true; callout: string[] } | { ok: false; reason: string };

// Does the query read the base `contracts` table (not a rollup)? v1 token heuristic: a `FROM`/`JOIN`
// immediately naming `contracts`. Rollup names (`*_totals`) never match, so they bypass the gate.
const BASE_CONTRACTS = /\b(?:from|join)\s+contracts\b/i;

interface RequiredPredicate {
  /** Normalized matcher for the predicate as it may appear in the user's SQL. */
  matcher: RegExp;
  /** Bulgarian label naming the default filter, used in the rejection reason. */
  label: string;
}

// Build a whitespace- and alias-tolerant matcher from a single predicate of the canonical fragment.
// The fragment qualifies columns with the contracts/tenders aliases (`c.`, `t.`) and uses a bound `?`
// for the synthetic-tender sentinel; the user's SQL may drop the alias, inline the literal, or use
// `<>`, so we relax all three while keeping the column + operator shape intact.
function buildMatcher(fragmentPredicate: string): RegExp {
  const bare = fragmentPredicate.replace(/^\s*[A-Za-z_]\w*\.\s*/, '').trim();
  let pattern = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex metachars
  pattern = pattern.replace(/\s+/g, '\\s+'); // tolerate extra/newline whitespace between tokens
  pattern = pattern.replace(/!=/g, '(?:!=|<>)'); // accept either inequality spelling
  pattern = pattern.replace(/\\\?/g, "(?:\\?|'неизвестна')"); // bound param OR inlined literal
  // Allow an optional table-alias qualifier (`c.` / `t.`) before the leading column.
  return new RegExp(`(?:\\b[A-Za-z_]\\w*\\.)?${pattern}`, 'i');
}

// Human-readable label for a predicate, keyed off the column it constrains. Falls back to the raw
// predicate so a future added default never goes unnamed in a rejection.
function labelFor(fragmentPredicate: string): string {
  if (/amount_eur/i.test(fragmentPredicate)) {
    return 'канонична стойност (amount_eur IS NOT NULL)';
  }
  if (/procedure_type/i.test(fragmentPredicate)) {
    return "синтетични поръчки (procedure_type != 'неизвестна')";
  }
  return fragmentPredicate.trim();
}

// Derive the required predicates once from the canonical fragment so this gate tracks the source.
const REQUIRED: RequiredPredicate[] = applyDefaultFilters()
  .sql.fragment.split(/\s+AND\s+/i)
  .filter(Boolean)
  .map((predicate) => ({ matcher: buildMatcher(predicate), label: labelFor(predicate) }));

/**
 * Verify a model-authored SQL query carries the default contract filters when it reads base
 * `contracts`. Pure and dependency-light.
 *
 * - Not a base-contracts query (rollup-only, or empty/whitespace) → bypass: `{ ok: true, callout: [] }`.
 * - Base-contracts query with every required default present → `{ ok: true, callout }` where `callout`
 *   is the standard `applyDefaultFilters()` callout.
 * - Base-contracts query missing any default → `{ ok: false, reason }`; `reason` is a lowercase
 *   fragment (no trailing period) naming the missing filter(s), e.g. interpolated by the caller as
 *   `Заявката е отхвърлена: ${reason}.`
 */
export function assertDefaultFilters(sql: string): DefaultFiltersResult {
  if (!BASE_CONTRACTS.test(sql)) {
    // No base contracts read (includes empty/whitespace input) — nothing for this gate to enforce.
    return { ok: true, callout: [] };
  }

  const missing = REQUIRED.filter((req) => !req.matcher.test(sql));
  if (missing.length > 0) {
    const names = missing.map((req) => req.label).join(', ');
    return { ok: false, reason: `липсва задължителен филтър по подразбиране: ${names}` };
  }

  return { ok: true, callout: applyDefaultFilters().callout };
}
