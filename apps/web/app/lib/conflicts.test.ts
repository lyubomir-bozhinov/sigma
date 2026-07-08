import { describe, expect, it } from 'vitest';
import { moneyBare } from '@sigma/shared';
import type { ConflictContract, ConflictLink } from '@sigma/api-contract';
import {
  companyConflictsHref,
  companyProfileHref,
  contractYear,
  contractYearsLabel,
  contractsCountLabel,
  fundsCellLabel,
  hasContemporaneousContracts,
  isFamilyLink,
  linkContractsHref,
  officialHref,
  partitionContracts,
  privateOwnershipHeadline,
  relationLabel,
  temporalLabel,
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
    contemporaneousContractCount: 20,
    contemporaneousValueEur: 40_000_000,
    firstContractYear: '2021',
    lastContractYear: '2024',
    sourceUrl: 'https://register.cacbg.bg/2024/i.xml',
    ...over,
  };
}

function contract(over: Partial<ConflictContract> = {}): ConflictContract {
  return {
    signedAt: '2021-05-01',
    authority: 'Община Пловдив',
    contractKind: 'Услуги',
    contractNumber: 'Д-1',
    amountEur: 1_000_000,
    temporal: 'contemporaneous',
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
      link({ officialSlug: 'a', contractValueEur: 100, contemporaneousValueEur: 60 }),
      link({ officialSlug: 'a', contractValueEur: 50, contemporaneousValueEur: 30 }),
      link({
        officialSlug: 'b',
        contractValueEur: 25,
        contemporaneousValueEur: 10,
        relation: 'related',
      }),
    ]);
    expect(h.linkCount).toBe(3);
    expect(h.officialCount).toBe(2); // de-duped
    expect(h.totalEur).toBe(175);
    expect(h.contemporaneousEur).toBe(100); // 60 + 30 + 10 — the conflict-window subset
    expect(h.familyLinkCount).toBe(1);
    expect(h.familyEur).toBe(25);
  });
  it('treats a null contract value as zero, never NaN', () => {
    const h = privateOwnershipHeadline([
      link({ contractValueEur: null, contemporaneousValueEur: null, relation: 'related' }),
    ]);
    expect(h.totalEur).toBe(0);
    expect(h.contemporaneousEur).toBe(0);
    expect(h.familyEur).toBe(0);
    expect(Number.isNaN(h.contemporaneousEur)).toBe(false);
  });
  it('is empty-safe', () => {
    expect(privateOwnershipHeadline([])).toEqual({
      linkCount: 0,
      officialCount: 0,
      totalEur: 0,
      contemporaneousEur: 0,
      familyLinkCount: 0,
      familyEur: 0,
    });
  });
});

describe('contemporaneous split', () => {
  it('hasContemporaneousContracts is true only when a contract fell in the window', () => {
    expect(hasContemporaneousContracts(link({ contemporaneousContractCount: 3 }))).toBe(true);
    expect(hasContemporaneousContracts(link({ contemporaneousContractCount: 0 }))).toBe(false);
  });
  it('contractsCountLabel shows „X от Y" only when some are in the window', () => {
    expect(contractsCountLabel(link({ contemporaneousContractCount: 3, contractCount: 11 }))).toBe(
      '3 от 11',
    );
    // no in-window contract → just the total, never „0 от 11" (reads as a claim of zero conflict)
    expect(contractsCountLabel(link({ contemporaneousContractCount: 0, contractCount: 11 }))).toBe(
      '11',
    );
  });
  it('fundsCellLabel leads with the conflict figure and keeps the total as context', () => {
    const withWindow = fundsCellLabel(
      link({ contemporaneousContractCount: 2, contemporaneousValueEur: 2_000_000, contractValueEur: 5_000_000 }),
    );
    expect(withWindow.primary).toBe(moneyBare(2_000_000)); // conflict-window sum first
    expect(withWindow.total).toBe(moneyBare(5_000_000)); // total kept as context
    // no in-window contract → only the total, nothing to split
    const noWindow = fundsCellLabel(
      link({ contemporaneousContractCount: 0, contractValueEur: 5_000_000 }),
    );
    expect(noWindow.primary).toBe(moneyBare(5_000_000));
    expect(noWindow.total).toBeNull();
    // in-window count but no summable value → fall back to the total, no phantom split
    const noValue = fundsCellLabel(
      link({ contemporaneousContractCount: 2, contemporaneousValueEur: null, contractValueEur: 5_000_000 }),
    );
    expect(noValue.total).toBeNull();
  });
});

describe('linkContractsHref', () => {
  it('keys on the URL-safe slug + ЕИК, flagging a family link', () => {
    expect(linkContractsHref(link({ officialSlug: 'c2VydA', eik: '111' }))).toBe(
      '/conflicts/link/c2VydA/111/contracts',
    );
    expect(linkContractsHref(link({ officialSlug: 'c2VydA', eik: '111', relation: 'related' }))).toBe(
      '/conflicts/link/c2VydA/111/contracts?f=1',
    );
  });
});

describe('contract list helpers', () => {
  it('partitionContracts splits the window set from the rest', () => {
    const contracts = [
      contract({ temporal: 'contemporaneous', contractNumber: 'A' }),
      contract({ temporal: 'before', contractNumber: 'B' }),
      contract({ temporal: 'after', contractNumber: 'C' }),
      contract({ temporal: 'unknown', contractNumber: 'D' }),
    ];
    const { inConflict, outside } = partitionContracts(contracts);
    expect(inConflict.map((c) => c.contractNumber)).toEqual(['A']);
    expect(outside.map((c) => c.contractNumber)).toEqual(['B', 'C', 'D']);
  });
  it('temporalLabel names each position; only „contemporaneous" is the conflict', () => {
    expect(temporalLabel('contemporaneous')).toBe('в момент на дял');
    expect(temporalLabel('before')).toBe('преди дела');
    expect(temporalLabel('after')).toBe('след дела');
    expect(temporalLabel('unknown')).toBe('без дата');
  });
  it('contractYear takes the signing year, or „—" when undated', () => {
    expect(contractYear(contract({ signedAt: '2021-05-01' }))).toBe('2021');
    expect(contractYear(contract({ signedAt: null }))).toBe('—');
  });
});
