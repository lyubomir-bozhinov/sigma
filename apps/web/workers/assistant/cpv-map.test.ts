import { describe, expect, it } from 'vitest';
import { CPV_CATEGORIES, CPV_SECTORS } from '@sigma/config';
import { mapSectorWord } from './cpv-map';

// The canonical division universe per @sigma/config. cpv-map hardcodes a few synonym → division
// codes ('45', '15') and synonym → category keys; if the taxonomy drifts, these must still resolve.
const KNOWN_DIVISIONS = new Set([
  ...CPV_SECTORS.map((s) => s.code),
  ...CPV_CATEGORIES.flatMap((c) => c.divisions),
]);

describe('mapSectorWord', () => {
  it('maps "строителство" to CPV division 45, unambiguously', () => {
    const r = mapSectorWord('строителство');
    expect(r.divisions).toEqual(['45']);
    expect(r.ambiguous).toBe(false);
    expect(r.matchType).toBe('sector');
    expect(r.callout).toContain('CPV раздел 45');
    // Surfaces the related construction divisions as an explicit assumption.
    expect(r.assumption).toContain('44/43/71');
  });

  it('maps "храни" to CPV division 15', () => {
    const r = mapSectorWord('храни');
    expect(r.divisions).toEqual(['15']);
    expect(r.ambiguous).toBe(false);
  });

  it('maps a category word to multiple divisions with ambiguous: true', () => {
    const r = mapSectorWord('инфраструктура');
    expect(r.matchType).toBe('category');
    expect(r.divisions).toEqual(['45', '44', '43', '71']);
    expect(r.ambiguous).toBe(true);
    expect(r.callout).toContain('Уточнете');
  });

  it('pins health to exactly divisions 33 + 85 (Q24/Q25 — misses half the spend if 85 is dropped)', () => {
    const r = mapSectorWord('здравеопазване');
    expect(r.matchType).toBe('category');
    expect(r.divisions).toEqual(['33', '85']);
  });

  it.each([
    ['ит', ['48', '72', '30', '32', '64']],
    ['софтуер', ['48', '72', '30', '32', '64']],
    ['енергетика', ['09', '76', '14']],
    ['транспорт', ['34', '60', '63']],
  ] as const)(
    'pins category synonym "%s" to its exact @sigma/config divisions',
    (word, divisions) => {
      const r = mapSectorWord(word);
      expect(r.matchType).toBe('category');
      expect(r.divisions).toEqual(divisions);
    },
  );

  it('normalizes case, whitespace and NFC form to the same mapping', () => {
    const base = mapSectorWord('строителство');
    for (const variant of ['  Строителство  ', 'СТРОИТЕЛСТВО', 'строителство'.normalize('NFD')]) {
      const r = mapSectorWord(variant);
      expect(r.divisions).toEqual(base.divisions);
      expect(r.matchType).toBe('sector');
    }
  });

  it('surfaces an assumption for an unknown word and applies no filter', () => {
    const r = mapSectorWord('бла-бла');
    expect(r.matchType).toBe('unknown');
    expect(r.divisions).toEqual([]);
    expect(r.ambiguous).toBe(true);
    expect(r.assumption).toContain('Не разпознах');
  });

  it('treats an empty / whitespace word as unknown', () => {
    expect(mapSectorWord('   ').matchType).toBe('unknown');
    expect(mapSectorWord('').divisions).toEqual([]);
  });

  it('records a callout for every result', () => {
    for (const word of ['строителство', 'инфраструктура', 'неразпознато']) {
      expect(mapSectorWord(word).callout.length).toBeGreaterThan(0);
    }
  });

  it('maps every curated sector short to its own division', () => {
    for (const sector of CPV_SECTORS) {
      if (!sector.short) continue;
      const r = mapSectorWord(sector.short);
      expect(r.divisions).toEqual([sector.code]);
      expect(r.matchType).toBe('sector');
    }
  });

  it('maps every full CPV sector label back to its division', () => {
    for (const sector of CPV_SECTORS) {
      const r = mapSectorWord(sector.label);
      expect(r.divisions).toEqual([sector.code]);
    }
  });

  it('hardcoded sector synonyms still resolve to real @sigma/config divisions', () => {
    // Mirrors SECTOR_SYNONYMS in cpv-map.ts — guards against silent drift if the taxonomy changes.
    for (const word of ['строеж', 'строителни работи', 'хранителни продукти', 'храна']) {
      const r = mapSectorWord(word);
      expect(r.matchType).toBe('sector');
      expect(r.divisions).toHaveLength(1);
      expect(KNOWN_DIVISIONS.has(r.divisions[0])).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(mapSectorWord('строителство'))).toBe(
      JSON.stringify(mapSectorWord('строителство')),
    );
  });
});
