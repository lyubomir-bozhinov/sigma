// Geography — the region traps (eval Q39–41). The wire carries no SQL, so these score the ANSWER: the
// right totals and the right entities, which is how the Q41 „извън София" bug (a 42,6 млрд phantom that
// listed Sofia-HQ bodies) would surface even without seeing the filter.

import { contentExcludes, contentIncludes, numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'geo-spend-by-region',
    prompt: 'Как се разпределят разходите по области?',
    // Sofia leads; the grand total across regions is the system total.
    checks: [numeric({ expect: 52_100_000_000, tolerancePct: 4 }), contentIncludes('София')],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'geo-outside-sofia',
    prompt: 'Кои са най-големите възложители извън София?',
    // The real non-Sofia figure (~20,5 млрд), NOT the 42,6 млрд phantom; and АПИ (Sofia-HQ) must not be
    // listed as „извън София". Generous tolerance — this is a live, model-authored aggregate.
    checks: [
      reportPresent(),
      numeric({ expect: 20_500_000_000, tolerancePct: 12 }),
      contentExcludes('Пътна инфраструктура'),
    ],
    baseline: 'fail',
    knownLimitation: 'Гео-класификацията беше ненадеждна (Q41); проверяваме симптома в отговора.',
  },
];
