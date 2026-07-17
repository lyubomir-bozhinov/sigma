// Keyword search over contract subjects (eval Q42, 45).

import { numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'search-asphalting',
    prompt: 'Намери договорите с предмет „асфалтиране".',
    checks: [reportPresent(), numeric({ expect: 19_800_000, tolerancePct: 15 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q42
  {
    id: 'search-software-it',
    prompt: 'Кои поръчки споменават „софтуер" или „ИТ услуги"?',
    checks: [reportPresent(), numeric({ expect: 776_800_000, tolerancePct: 12 })],
    baseline: 'pass',
    dataVersion: V,
  }, // Q45
];
