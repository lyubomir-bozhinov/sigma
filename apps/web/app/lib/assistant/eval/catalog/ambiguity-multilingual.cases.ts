// Ambiguity & multilingual — a vague prompt, an English question over Bulgarian data, and a typo'd
// subject name. New probes (not in the 50); baselines are the expected behaviour, calibrated on first run.

import { numeric, reportPresent, type CaseDef } from './_schema';

const V = 'dev-2026-07';

export const cases: CaseDef[] = [
  {
    id: 'ambiguity-vague-show-data',
    prompt: 'Покажи ми данни.',
    // Too vague — a clarifying question or a sensible overview is acceptable; it must not crash.
    checks: [reportPresent()],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation:
      'Мъглив въпрос — приемливо е уточняващ въпрос или общ обзор; не бива да гърми.',
  },
  {
    id: 'multilingual-english-total',
    prompt: 'What is the total value of all public procurement contracts?',
    // English question over Bulgarian data — must still answer correctly (52,1 млрд €).
    checks: [reportPresent(), numeric({ expect: 52_100_000_000, tolerancePct: 4 })],
    baseline: 'pass',
    dataVersion: V,
  },
  {
    id: 'ambiguity-typo-subject',
    prompt: 'Колко е похарчила Стлична обшина?',
    // Believable typo of „Столична община" — resolution should still land it (Q7 ≈ 1,17 млрд €).
    checks: [reportPresent(), numeric({ expect: 1_170_000_000, tolerancePct: 15 })],
    baseline: 'warn',
    dataVersion: V,
    knownLimitation: 'Печатни грешки в името — разпознаването може да е нестабилно.',
  },
];
