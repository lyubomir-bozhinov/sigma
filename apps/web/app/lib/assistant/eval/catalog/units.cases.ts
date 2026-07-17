// Units — the лв↔€ trap. Sigma stores EUR; a question phrased in leva must convert (× 1.95583) or state
// the base, never silently keep a „лв." label on € figures (eval Q17). Scored on the answer.

import { numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'units-over-10m-leva',
    prompt: 'Покажи договорите на стойност над 10 млн. лв.',
    // Q17: върна 1163 договора / 22 млрд €, но задържа „лв." етикета без лв→€ конверсия.
    checks: [reportPresent(), numeric({ expect: 22_000_000_000, tolerancePct: 15 })],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation:
      'Данните са в €; прагът в лв трябва да се конвертира, а етикетът да не остане „лв.".',
  },
  {
    id: 'units-total-in-leva',
    prompt: 'Каква е общата стойност на всички поръчки в лева?',
    // 52,1 млрд € × 1.95583 ≈ 101,9 млрд лв — очаква се конверсия ИЛИ ясно уточнение, че базата е в €.
    checks: [reportPresent()],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation:
      'Проверява дали смесва лв/€ база; отговорът трябва да конвертира или да заяви €.',
  },
  {
    id: 'units-over-5m-leva',
    prompt: 'Кои са договорите над 5 милиона лева?',
    checks: [reportPresent()],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation:
      'Лв прагът трябва да се конвертира към € преди филтъра, иначе е праг в грешна валута.',
  },
];
