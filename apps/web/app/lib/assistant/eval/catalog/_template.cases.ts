// TEMPLATE — copy this to `<category>.cases.ts` to add a category. The filename stem becomes the
// category; the loader (../load.ts) discovers the file automatically. Underscore-prefixed, so this
// template itself is never loaded as live cases.
//
// A case is pure data: a prompt + report-content checks. Pick checks from the builders in ./_schema.
// Anchor each to its manual-eval `baseline` verdict, and record the `dataVersion` the numbers came from.

import { contentExcludes, contentIncludes, declines, numeric, type CaseDef } from './_schema';

export const cases: CaseDef[] = [
  {
    id: 'template-total-spend',
    prompt: 'Каква е общата стойност на всички обществени поръчки?',
    checks: [numeric({ expect: 52_100_000_000, tolerancePct: 3 })],
    baseline: 'pass',
    dataVersion: 'dev-2026-07',
  },
  {
    id: 'template-annexes-unsupported',
    prompt: 'Има ли договори, отбелязани като съмнителни анекси?',
    checks: [declines()],
    baseline: 'fail',
    knownLimitation:
      'Рисковият слой (анекси) още не е в обхвата на асистента — трябва да откаже, не да съчини.',
  },
  {
    id: 'template-outside-sofia',
    prompt: 'Кои са най-големите възложители извън София?',
    // Symptom-level checks over the ANSWER (the wire carries no SQL): the total must be the real
    // non-Sofia figure, no Sofia-HQ authority should be listed as „извън София", and the answer should
    // actually name authorities. Add `metric: '<label-word>'` to numeric() to pin it to a specific
    // labelled total once a live run reveals the label; without it, any report number within tolerance
    // passes.
    checks: [
      numeric({ expect: 20_500_000_000, tolerancePct: 8 }),
      contentExcludes('Агенция „Пътна инфраструктура"'),
      contentIncludes('възложител'),
    ],
    baseline: 'fail',
  },
];
