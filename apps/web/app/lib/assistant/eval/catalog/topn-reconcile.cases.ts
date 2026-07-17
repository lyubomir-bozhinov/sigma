// Top-N & reconciliation — leaderboards + flows (eval Q6, 8, 9, 10, 11, 31, 33). The Q6/Q11 fix was
// "top-N list, no spurious grand-total headline"; Q33 had a raw LaTeX artifact in the title.

import { contentExcludes, contentIncludes, numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'topn-authorities-spend',
    prompt: 'Кои са 10-те най-големи възложители по похарчена сума?',
    // Q6: top-10 table, no grand-total headline; top authority ≈ 4,59 млрд €.
    checks: [reportPresent(), numeric({ expect: 4_590_000_000, tolerancePct: 8 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q6
  {
    id: 'topn-companies-won',
    prompt: 'Кои са 10-те компании с най-много спечелени поръчки по стойност?',
    // Q11: the top-10 total reconciles to 7,31 млрд € (matches the homepage top-10).
    checks: [reportPresent(), numeric({ expect: 7_310_000_000, tolerancePct: 6 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q11
  {
    id: 'topn-most-contracts-authority',
    prompt: 'Кой възложител е сключил най-много договори на брой?',
    checks: [
      reportPresent(),
      numeric({ expect: 2_165, tolerancePct: 6 }),
      contentIncludes('Столична'),
    ],
    baseline: 'pass',
    dataVersion: V,
  }, // Q8
  {
    id: 'topn-health-ministry-suppliers',
    prompt: 'Към кои компании плаща най-много Министерството на здравеопазването?',
    checks: [reportPresent(), numeric({ expect: 649_400_000, tolerancePct: 12 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q9 — top supplier 649,4 млн €
  {
    id: 'topn-avg-at-biggest-authority',
    prompt: 'Каква е средната стойност на договор при най-големия възложител?',
    checks: [reportPresent(), numeric({ expect: 6_450_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q10 — АПИ, 6,45 млн €
  {
    id: 'topn-biggest-flow',
    prompt: 'Кой е най-големият паричен поток между възложител и компания?',
    checks: [reportPresent(), numeric({ expect: 1_310_000_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q31 — МЗ ЦОП → pharma, 1,31 млрд €
  {
    id: 'topn-concentrated-pairs',
    prompt: 'Покажи най-концентрираните двойки възложител–изпълнител.',
    // Q33: cosmetic — a raw LaTeX „$\rightarrow$" artifact leaked into the title; it must not appear.
    checks: [reportPresent(), contentExcludes('rightarrow')],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation: 'Суров LaTeX „$\\rightarrow$" в заглавието (Q33 козметичен артефакт).',
  }, // Q33
];
