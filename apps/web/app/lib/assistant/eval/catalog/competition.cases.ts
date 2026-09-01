// Competition — single-offer share/value + averages (eval Q26–30, 46). Q26/Q27 diverge from the site
// headline because the assistant uses a stricter denominator; documented as a known limitation, not a bug.

import { numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'competition-single-offer-share',
    prompt: 'Какъв е делът на договорите само с една оферта?',
    // Q26: 28,7% (по-строг знаменател) vs сайт 31,8% (по стойност).
    checks: [reportPresent()],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation:
      'Асистентът дава ~28,7% (по-строг знаменател); сайтът показва 31,8% по стойност.',
  }, // Q26
  {
    id: 'competition-single-offer-money',
    prompt: 'Колко пари са похарчени по договори с една оферта?',
    // Q27: 13,4 млрд € vs сайт 16,6 млрд €.
    checks: [reportPresent(), numeric({ expect: 13_400_000_000, tolerancePct: 12 })],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation: 'Асистентът: ~13,4 млрд €; сайтът: 16,6 млрд € (различен знаменател).',
  }, // Q27
  {
    id: 'competition-top-single-offer-authorities',
    prompt: 'Кои възложители имат най-висок дял поръчки с една оферта?',
    checks: [reportPresent()],
    baseline: 'pass',
    dataVersion: V,
  }, // Q28
  {
    id: 'competition-avg-offers',
    prompt: 'Колко оферти средно получава една поръчка?',
    checks: [numeric({ expect: 2.84, tolerancePct: 8 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q29 — 2,84 (картата закръгля към 3)
  {
    id: 'competition-no-competition-companies',
    prompt: 'Кои компании печелят предимно поръчки без конкуренция?',
    checks: [reportPresent(), numeric({ expect: 13_400_000_000, tolerancePct: 12 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q30 — препотвърждава 13,4 млрд / 72 663
  {
    id: 'competition-riskiest-contracts',
    prompt: 'Покажи най-рисковите поръчки.',
    // Q46: proxy = high-value single-offer (13,4 млрд €), прозрачно обяснено.
    checks: [reportPresent()],
    baseline: 'pass',
    dataVersion: V,
    knownLimitation:
      'Proxy през single-offer high-value; трябва да обясни, че не е официален риск-скор.',
  }, // Q46
];
