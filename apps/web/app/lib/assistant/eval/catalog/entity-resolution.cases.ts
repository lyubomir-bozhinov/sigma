// Entity resolution — name vs ЕИК, same-name entities, consortia (eval Q7, 12, 14, 32, 34, 44, 50).
// Q32 is the known hard case: two same-named hospitals fragment by name/ЕИК.

import { contentIncludes, numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'entity-sofia-municipality-total',
    prompt: 'Колко е похарчила Столична община общо?',
    checks: [numeric({ expect: 1_170_000_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q7
  {
    id: 'entity-sofarma-by-eik',
    prompt: 'Колко общо е спечелила компанията с ЕИК 103267194?',
    checks: [numeric({ expect: 1_280_000_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q12 — СОФАРМА ТРЕЙДИНГ
  {
    id: 'entity-most-contracts-company',
    prompt: 'Коя компания има най-много договори на брой?',
    checks: [
      reportPresent(),
      numeric({ expect: 3_163, tolerancePct: 5 }),
      contentIncludes('СОФАРМА'),
    ],
    baseline: 'pass',
    dataVersion: V,
  }, // Q14
  {
    id: 'entity-roche-by-eik',
    prompt: 'Покажи профила на компания РОШ БЪЛГАРИЯ (ЕИК 131279951).',
    checks: [reportPresent(), numeric({ expect: 444_000_000, tolerancePct: 12 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q44
  {
    id: 'entity-api-financed-companies',
    prompt: 'Колко компании е финансирала Агенция „Пътна инфраструктура"?',
    checks: [numeric({ expect: 313, tolerancePct: 8 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q34
  {
    id: 'entity-burgas-transparency',
    prompt: 'Дай справка за прозрачността на Община Бургас.',
    checks: [reportPresent(), numeric({ expect: 731_700_000, tolerancePct: 10 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q50
  {
    id: 'entity-same-name-hospital',
    prompt: 'Колко е платила УМБАЛ Св. Иван Рилски на СОФАРМА ТРЕЙДИНГ общо?',
    // Q32: resolved to a different same-name hospital (МБАЛ ЕООД vs УМБАЛ ЕАД); only a note, no total.
    checks: [reportPresent()],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation: 'Едноименни болници (УМБАЛ ЕАД vs МБАЛ ЕООД) — фрагментация по име/ЕИК (Q32).',
  }, // Q32
];
