import { describe, expect, it } from 'vitest';
import type { ConflictLink } from '@sigma/api-contract';
import {
  companyConflictsHref,
  companyProfileHref,
  contractYearsLabel,
  isFamilyLink,
  officialHref,
  privateOwnershipHeadline,
  relationLabel,
} from './conflicts';

function link(over: Partial<ConflictLink> = {}): ConflictLink {
  return {
    linkKey: 'person:a|111',
    officialSlug: 'c2VydA',
    official: 'Иван Минев',
    company: 'ТРЕЙС ГРУП ХОЛД АД',
    eik: '111',
    relation: 'owns',
    contemporaneous: true,
    ownInstitution: false,
    firstDeclaredYear: '2019',
    lastDeclaredYear: '2023',
    matchMethod: 'exact_name_key',
    contractCount: 35,
    contractValueEur: 88_000_000,
    firstContractYear: '2021',
    lastContractYear: '2024',
    sourceUrl: 'https://register.cacbg.bg/2024/i.xml',
    ...over,
  };
}

describe('relationLabel', () => {
  it('renders each declared relation in Bulgarian', () => {
    expect(relationLabel('owns')).toBe('притежава дял');
    expect(relationLabel('manages')).toBe('управлява');
    expect(relationLabel('owns+manages')).toBe('притежава дял и управлява');
    expect(relationLabel('related')).toBe('дял на свързано лице'); // family — relative never named
  });
  it('passes an unknown relation through rather than inventing a claim', () => {
    expect(relationLabel('mystery')).toBe('mystery');
  });
});

describe('isFamilyLink', () => {
  it('is true only for a related (close-relative) stake', () => {
    expect(isFamilyLink(link({ relation: 'related' }))).toBe(true);
    expect(isFamilyLink(link({ relation: 'owns' }))).toBe(false);
    expect(isFamilyLink(link({ relation: 'owns+manages' }))).toBe(false);
  });
});

describe('href builders', () => {
  it('point at the conflict + company routes', () => {
    expect(officialHref('c2VydA')).toBe('/conflicts/official/c2VydA');
    expect(companyConflictsHref('111')).toBe('/conflicts/company/111');
    expect(companyProfileHref('111')).toBe('/companies/111');
  });
});

describe('contractYearsLabel', () => {
  it('renders a range, a single year, or an em dash', () => {
    expect(contractYearsLabel('2021', '2024')).toBe('2021 – 2024');
    expect(contractYearsLabel('2023', '2023')).toBe('2023');
    expect(contractYearsLabel('2023', null)).toBe('2023');
    expect(contractYearsLabel(null, '2024')).toBe('2024');
    expect(contractYearsLabel(null, null)).toBe('—');
  });
});

describe('privateOwnershipHeadline', () => {
  it('sums value, counts links, de-dupes officials, and isolates the family subset', () => {
    const h = privateOwnershipHeadline([
      link({ officialSlug: 'a', contractValueEur: 100 }),
      link({ officialSlug: 'a', contractValueEur: 50 }), // same official, second company
      link({ officialSlug: 'b', contractValueEur: 25, relation: 'related' }), // family stake
    ]);
    expect(h.linkCount).toBe(3);
    expect(h.officialCount).toBe(2); // de-duped
    expect(h.totalEur).toBe(175);
    expect(h.familyLinkCount).toBe(1);
    expect(h.familyEur).toBe(25);
  });
  it('treats a null contract value as zero, never NaN', () => {
    const h = privateOwnershipHeadline([link({ contractValueEur: null, relation: 'related' })]);
    expect(h.totalEur).toBe(0);
    expect(h.familyEur).toBe(0);
    expect(Number.isNaN(h.totalEur)).toBe(false);
  });
  it('is empty-safe', () => {
    expect(privateOwnershipHeadline([])).toEqual({
      linkCount: 0,
      officialCount: 0,
      totalEur: 0,
      familyLinkCount: 0,
      familyEur: 0,
    });
  });
});
