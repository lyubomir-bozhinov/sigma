// Time — relative-date resolution: „тази/миналата година", last week, partial current year, month-by-
// month (eval Q5, 18, 19, 35, 38). „тази година" is 2026 and partial; the answer must reflect that.

import { contentIncludes, numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'time-spend-2020-today',
    prompt: 'Как се разпределят разходите по години от 2020 до днес?',
    checks: [reportPresent(), contentIncludes('2025')],
    baseline: 'pass',
    dataVersion: V,
  }, // Q5
  {
    id: 'time-this-year',
    prompt: 'Дай ми поръчките за тази година.',
    // „тази година" = 2026 (частична): Q18 → 5,58 млрд € / 15 537 договора.
    checks: [reportPresent(), numeric({ expect: 5_580_000_000, tolerancePct: 12 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q18
  {
    id: 'time-last-week',
    prompt: 'Покажи договорите, подписани през последната седмица.',
    checks: [reportPresent()],
    baseline: 'pass',
    dataVersion: V,
    knownLimitation: 'Малка, подвижна извадка — проверяваме само че връща списък, не точна сума.',
  }, // Q19
  {
    id: 'time-monthly-2024',
    prompt: 'Как се променят разходите месец по месец през 2024 г.?',
    checks: [reportPresent(), numeric({ expect: 9_650_000_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q35
  {
    id: 'time-contracts-2022',
    prompt: 'Колко договора са подписани през 2022 г.?',
    checks: [numeric({ expect: 29_621, tolerancePct: 4 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q38
  {
    id: 'time-last-year',
    prompt: 'Колко е похарчено през миналата година?',
    // „миналата година" = 2025 (спрямо 2026); ≈ 11,1 млрд € (Q36).
    checks: [reportPresent(), numeric({ expect: 11_100_000_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  },
];
