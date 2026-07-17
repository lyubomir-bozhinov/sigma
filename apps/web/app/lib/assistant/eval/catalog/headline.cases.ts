// Headline totals & counts — the system-wide aggregates (eval Q1–5, 21–22, 36, 38). These are the
// most stable numbers; tolerances are tight but non-zero to absorb dataset refreshes.

import { numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'headline-total-spend',
    prompt: 'Каква е общата стойност на всички обществени поръчки?',
    checks: [numeric({ expect: 52_100_000_000, tolerancePct: 3 })],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'headline-contract-count',
    prompt: 'Колко договора има общо в системата?',
    checks: [numeric({ expect: 195_015, tolerancePct: 3 })],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'headline-authorities-bidders',
    prompt: 'Колко възложителя и колко изпълнителя има?',
    checks: [
      numeric({ expect: 4_449, tolerancePct: 3 }),
      numeric({ expect: 17_540, tolerancePct: 3 }),
    ],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'headline-avg-contract-value',
    prompt: 'Каква е средната стойност на един договор?',
    checks: [numeric({ expect: 257_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'headline-construction-total',
    prompt: 'Колко е похарчено за строителство общо?',
    // CPV 45; reconciles with Q21. Wider tolerance — sector totals move with re-ETL.
    checks: [numeric({ expect: 19_400_000_000, tolerancePct: 6 })],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'headline-biggest-spend-year',
    prompt: 'Коя година е с най-голям общ разход?',
    // The answer is a year (2025) + its total; assert the report renders (no 500) and the total lands.
    checks: [reportPresent(), numeric({ expect: 11_100_000_000, tolerancePct: 8 })],
    baseline: 'pass',
    dataVersion: V,
  },
];
