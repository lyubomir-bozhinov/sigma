// CPV / sector — the theme→division trap (eval Q21–25, 47). „здравеопазване" = CPV 33 (+85), never 38
// (lab) or 31 (electrical). Scored on the answer: the right total and the absence of the wrong labels.

import { contentExcludes, contentIncludes, numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'cpv-top-sector',
    prompt: 'В кой сектор (CPV) отиват най-много средства?',
    checks: [contentIncludes('45'), numeric({ expect: 19_400_000_000, tolerancePct: 6 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q21 — сектор 45 (строителство), 19,4 млрд €
  {
    id: 'cpv-construction-total',
    prompt: 'Колко е похарчено за строителство общо?',
    checks: [numeric({ expect: 19_400_000_000, tolerancePct: 6 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q22
  {
    id: 'cpv-construction-leaders',
    prompt: 'Кои са водещите изпълнители в строителството?',
    checks: [reportPresent(), numeric({ expect: 17_900_000_000, tolerancePct: 8 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q23
  {
    id: 'cpv-health-by-company',
    prompt: 'Как се разпределят парите за здравеопазване по компании?',
    // Q24: мапна „здравеопазване" → CPV 38 (лабораторно) и изброи А1 (телеком); ~400 млн вместо фарма милиарди.
    checks: [reportPresent(), contentExcludes('А1'), contentExcludes('CPV 38')],
    baseline: 'fail',
    dataVersion: V,
    knownLimitation: 'Здравеопазване = CPV 33 (+85), НЕ 38; Q24 сгреши мапинга и изброи телеком.',
  }, // Q24
  {
    id: 'cpv-fastest-growing-sectors',
    prompt: 'Кои сектори растат най-бързо от 2020 г. насам?',
    // Q25: мислабелна „Сектор 31 (Здравеопазване)" — CPV 31 = електрическо оборудване.
    checks: [reportPresent(), contentExcludes('Сектор 31 \\(Здравеопазване\\)')],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation: 'CPV 31 = електрическо оборудване, не здравеопазване (Q25 мислабелна ос).',
  }, // Q25
];
