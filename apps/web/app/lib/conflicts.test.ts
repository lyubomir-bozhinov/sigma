import { describe, expect, it } from 'vitest';
import { moneyBare } from '@sigma/shared';
import type { ConflictContract, ConflictLink } from '@sigma/api-contract';
import {
  companyConflictsHref,
  companyProfileHref,
  contractHref,
  contractTimeline,
  contractYear,
  contractYearsLabel,
  contractsCountLabel,
  fundsCellLabel,
  fundsMagnitude,
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
    contractSlug: 'e:abc123',
    signedAt: '2021-05-01',
    authority: 'Община Пловдив',
    contractKind: 'Услуги',
    procedureType: 'открита процедура',
    subject: 'Ремонт на общински път',
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
      link({
        contemporaneousContractCount: 2,
        contemporaneousValueEur: 2_000_000,
        contractValueEur: 5_000_000,
      }),
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
      link({
        contemporaneousContractCount: 2,
        contemporaneousValueEur: null,
        contractValueEur: 5_000_000,
      }),
    );
    expect(noValue.total).toBeNull();
  });
});

describe('fundsMagnitude', () => {
  it('is the conflict-window share of the total (subset ≤ total)', () => {
    expect(
      fundsMagnitude(
        link({
          contemporaneousContractCount: 2,
          contemporaneousValueEur: 132_000,
          contractValueEur: 11_900_000,
        }),
      ),
    ).toBeCloseTo(132_000 / 11_900_000, 6);
  });
  it('is null when there is nothing to plot', () => {
    // no in-window contract
    expect(fundsMagnitude(link({ contemporaneousContractCount: 0 }))).toBeNull();
    // no summable window value
    expect(
      fundsMagnitude(link({ contemporaneousContractCount: 2, contemporaneousValueEur: null })),
    ).toBeNull();
    // no/zero total to divide by
    expect(
      fundsMagnitude(
        link({
          contemporaneousContractCount: 2,
          contemporaneousValueEur: 100,
          contractValueEur: 0,
        }),
      ),
    ).toBeNull();
    expect(
      fundsMagnitude(
        link({
          contemporaneousContractCount: 2,
          contemporaneousValueEur: 100,
          contractValueEur: null,
        }),
      ),
    ).toBeNull();
  });
  it('clamps to 1 rather than exceeding the bar', () => {
    expect(
      fundsMagnitude(
        link({
          contemporaneousContractCount: 2,
          contemporaneousValueEur: 120,
          contractValueEur: 100,
        }),
      ),
    ).toBe(1);
  });
});

describe('contractTimeline', () => {
  it('places dated contracts on a shared axis and shades the declared window', () => {
    const tl = contractTimeline({ firstDeclaredYear: '2024', lastDeclaredYear: '2024' }, [
      contract({ signedAt: '2019-03-01', temporal: 'before' }),
      contract({ signedAt: '2024-06-01', temporal: 'contemporaneous' }),
      contract({ signedAt: '2024-09-01', temporal: 'contemporaneous' }),
      contract({ signedAt: '2026-01-01', temporal: 'after' }),
    ]);
    expect(tl).not.toBeNull();
    expect(tl!.minYear).toBe(2019);
    expect(tl!.maxYear).toBe(2026);
    // 2019 at 0%, 2026 at 100%, 2024 at (5/7)*100
    expect(tl!.marks[0]).toMatchObject({ year: 2019, leftPct: 0, inWindow: false, stackIndex: 0 });
    expect(tl!.marks[3]).toMatchObject({ year: 2026, leftPct: 100, inWindow: false });
    expect(tl!.windowStartPct).toBeCloseTo((5 / 7) * 100, 6);
    expect(tl!.windowEndPct).toBeCloseTo((5 / 7) * 100, 6);
    // the two 2024 contracts are flagged in-window and fanned by stackIndex
    const inWin = tl!.marks.filter((m) => m.inWindow);
    expect(inWin.map((m) => m.stackIndex)).toEqual([0, 1]);
    // year ticks: a short span labels every year, start at 0% and end at 100% (middle years present)
    expect(tl!.ticks.map((t) => t.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(tl!.ticks[0].leftPct).toBe(0);
    expect(tl!.ticks[tl!.ticks.length - 1].leftPct).toBe(100);
  });
  it('thins year ticks on a long span but always keeps the end year', () => {
    // 2000 → 2020 span 20 → step ceil(21/8)=3 → 2000,2003,…,2018, then the end year 2020 appended exactly
    const tl = contractTimeline({ firstDeclaredYear: '2000', lastDeclaredYear: '2000' }, [
      contract({ signedAt: '2000-01-01', temporal: 'contemporaneous' }),
      contract({ signedAt: '2020-01-01', temporal: 'after' }),
    ]);
    const years = tl!.ticks.map((t) => t.year);
    expect(years).toEqual([2000, 2003, 2006, 2009, 2012, 2015, 2018, 2020]);
    expect(tl!.ticks[tl!.ticks.length - 1].leftPct).toBe(100);
  });
  it('renders a single centred tick when all activity is in one year', () => {
    const tl = contractTimeline({ firstDeclaredYear: '2024', lastDeclaredYear: '2024' }, [
      contract({ signedAt: '2024-01-01', temporal: 'contemporaneous' }),
    ]);
    expect(tl!.ticks).toEqual([{ year: 2024, leftPct: 50 }]);
  });
  it('returns null when no contract carries a date (nothing to plot)', () => {
    expect(
      contractTimeline({ firstDeclaredYear: '2024', lastDeclaredYear: '2024' }, [
        contract({ signedAt: null, temporal: 'unknown' }),
      ]),
    ).toBeNull();
  });
  it('centres everything when all activity is in one year (zero span, no divide-by-zero)', () => {
    const tl = contractTimeline({ firstDeclaredYear: '2024', lastDeclaredYear: '2024' }, [
      contract({ signedAt: '2024-01-01', temporal: 'contemporaneous' }),
    ]);
    expect(tl!.marks[0].leftPct).toBe(50);
    expect(tl!.windowStartPct).toBe(50);
    expect(tl!.windowEndPct).toBe(50);
  });
  it('plots marks with no band when the link declares no years', () => {
    const tl = contractTimeline({ firstDeclaredYear: null, lastDeclaredYear: null }, [
      contract({ signedAt: '2021-01-01', temporal: 'before' }),
      contract({ signedAt: '2023-01-01', temporal: 'after' }),
    ]);
    expect(tl!.windowStartPct).toBeNull();
    expect(tl!.windowEndPct).toBeNull();
    expect(tl!.marks).toHaveLength(2);
  });
  it('ignores a bogus/empty declared year rather than plotting year 0', () => {
    const tl = contractTimeline({ firstDeclaredYear: '', lastDeclaredYear: '2024' }, [
      contract({ signedAt: '2024-01-01', temporal: 'contemporaneous' }),
    ]);
    // only the valid edge remains; band collapses to that single point, min/max stay 2024
    expect(tl!.minYear).toBe(2024);
    expect(tl!.windowStartPct).toBe(50);
    expect(tl!.windowEndPct).toBe(50);
  });
});

describe('linkContractsHref', () => {
  it('keys on the URL-safe scope + slug + ЕИК; scope is a path segment, not a query param', () => {
    expect(linkContractsHref(link({ officialSlug: 'c2VydA', eik: '111' }))).toBe(
      '/conflicts/link/self/c2VydA/111/contracts',
    );
    expect(
      linkContractsHref(link({ officialSlug: 'c2VydA', eik: '111', relation: 'related' })),
    ).toBe('/conflicts/link/family/c2VydA/111/contracts');
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
  it('temporalLabel frames each contract vs the DECLARED (disclosure) period, not ownership', () => {
    // „деклариран период", never „дял" — the label must not imply an ownership boundary we can't prove
    // (real ownership usually predates the first filing; the declared years are only the disclosure window).
    expect(temporalLabel('contemporaneous')).toBe('в декларирания период');
    expect(temporalLabel('before')).toBe('преди декларирания период');
    expect(temporalLabel('after')).toBe('след декларирания период');
    expect(temporalLabel('unknown')).toBe('без дата');
  });
  it('contractYear takes the signing year, or „—" when undated', () => {
    expect(contractYear(contract({ signedAt: '2021-05-01' }))).toBe('2021');
    expect(contractYear(contract({ signedAt: null }))).toBe('—');
  });
  it('contractHref points at the contract detail page', () => {
    expect(contractHref(contract({ contractSlug: 'e:abc123' }))).toBe('/contracts/e:abc123');
  });
});
