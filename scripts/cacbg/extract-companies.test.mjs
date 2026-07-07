import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyCandidates, declaredEiks } from './extract-companies.mjs';

test('companyCandidates pulls „NAME" ФОРМА out of prose', () => {
  assert.deepEqual(companyCandidates('"ТРАНСПОМЕД" ЕООД, ЕИК 101677351'), ['"ТРАНСПОМЕД" ЕООД']);
  assert.deepEqual(companyCandidates('"Кристална вода" АД София'), ['"Кристална вода" АД']);
  // prose sentence with the real company buried
  assert.ok(
    companyCandidates('2 дружествени дяла на „ЕН-ФРЕШ" ООД, прехвърлени нотариално').some((c) =>
      /ЕН-ФРЕШ/.test(c),
    ),
  );
  // no legal form → no candidate (we don't guess bare words)
  assert.deepEqual(companyCandidates('някакъв текст без фирма'), []);
});

test('declaredEiks finds 9/13-digit ЕИК but not 10-digit ЕГН/date shapes', () => {
  assert.deepEqual(declaredEiks('"ТРАНСПОМЕД" ЕООД, ЕИК 101677351'), ['101677351']);
  assert.deepEqual(declaredEiks('ЕИК 2016176540070 нещо'), ['2016176540070']); // 13-digit
  assert.deepEqual(declaredEiks('вх.№ 2018060520 от регистъра'), []); // 10 digits ≠ ЕИК
  assert.deepEqual(declaredEiks('няма номер'), []);
});
