import { describe, expect, it } from 'vitest';
import {
  getCompanyConflicts,
  getConflictLeaderboard,
  getOfficialConflicts,
} from './related-persons';
import { personSlug } from './identity';

// Unit coverage for the TS logic the SQL can't exercise: row→DTO mapping (booleans, own-institution
// truth only on 'exact'), the private-vs-other split, and null-on-empty. The SQL itself is covered
// end-to-end against a real SQLite in ../related-persons-sql.test.ts.

function row(over: Record<string, unknown> = {}) {
  return {
    link_key: 'p1|111',
    person_id: 'person:ИВАН МИНЕВ',
    official: 'Иван Минев',
    company: 'ТРЕЙС ГРУП ХОЛД АД',
    eik: '111',
    relation: 'owns',
    interest_class: 'private_ownership',
    contemporaneous: 1,
    own_institution: 'exact',
    match_method: 'exact_name_key',
    contract_count: 35,
    contract_value_eur: 88_000_000,
    first_contract_year: '2021',
    last_contract_year: '2024',
    source_url: 'https://register.cacbg.bg/2024/i.xml',
    ...over,
  };
}

// Minimal D1 stand-in: all() returns the rows registered for the FIRST bound value (the scope key).
function fakeDb(byKey: Record<string, unknown[]>): D1Database {
  return {
    prepare() {
      let key = '';
      return {
        bind(...p: unknown[]) {
          key = String(p[0]);
          return this;
        },
        async all() {
          return { results: byKey[key] ?? [] };
        },
        async first() {
          return null;
        },
      };
    },
  } as unknown as D1Database;
}

describe('related-persons queries', () => {
  it('leaderboard maps rows and keeps ex-officio a separate list from private ownership', async () => {
    const db = fakeDb({
      private_ownership: [row({ link_key: 'p1|111' })],
      ex_officio_board: [
        row({
          link_key: 'p2|222',
          interest_class: 'ex_officio_board',
          relation: 'manages',
          own_institution: 'none',
          contemporaneous: 0,
        }),
      ],
    });
    const lb = await getConflictLeaderboard(db, 10);
    expect(lb.privateOwnership.map((l) => l.linkKey)).toEqual(['p1|111']);
    expect(lb.exOfficio.map((l) => l.linkKey)).toEqual(['p2|222']);
    // mapping: 1/0 → booleans; ownInstitution true ONLY on the deterministic 'exact' verdict
    expect(lb.privateOwnership[0]!.ownInstitution).toBe(true);
    expect(lb.privateOwnership[0]!.contemporaneous).toBe(true);
    expect(lb.privateOwnership[0]!.contractValueEur).toBe(88_000_000);
    // person_id is encoded to a URL-safe slug, never surfaced raw (drives /conflicts/official/:slug)
    expect(lb.privateOwnership[0]!.officialSlug).toBe(personSlug('person:ИВАН МИНЕВ'));
    expect(lb.privateOwnership[0]!.officialSlug).not.toContain(' ');
    expect(lb.exOfficio[0]!.ownInstitution).toBe(false);
    expect(lb.exOfficio[0]!.contemporaneous).toBe(false);
  });

  it('own-institution is false for every non-exact verdict', async () => {
    for (const verdict of ['name_contains', 'locality', 'none']) {
      const db = fakeDb({
        private_ownership: [row({ own_institution: verdict })],
        ex_officio_board: [],
      });
      const lb = await getConflictLeaderboard(db, 10);
      expect(lb.privateOwnership[0]!.ownInstitution).toBe(false);
    }
  });

  it('official conflicts split private ownership from other roles, and 404 (null) when none', async () => {
    const db = fakeDb({
      'person:ivan': [
        row({ link_key: 'a', interest_class: 'private_ownership' }),
        row({ link_key: 'b', interest_class: 'ex_officio_board' }),
        row({ link_key: 'c', interest_class: 'management_role' }),
      ],
    });
    const res = await getOfficialConflicts(db, 'person:ivan');
    expect(res?.official).toBe('Иван Минев');
    expect(res?.privateOwnership.map((l) => l.linkKey)).toEqual(['a']);
    expect(res?.otherRoles.map((l) => l.linkKey)).toEqual(['b', 'c']);
    expect(await getOfficialConflicts(fakeDb({}), 'person:none')).toBeNull();
  });

  it('company conflicts return the officials, and null when none', async () => {
    const db = fakeDb({ '111': [row(), row({ link_key: 'p2|111', official: 'Друг' })] });
    const res = await getCompanyConflicts(db, '111');
    expect(res?.eik).toBe('111');
    expect(res?.company).toBe('ТРЕЙС ГРУП ХОЛД АД');
    expect(res?.links).toHaveLength(2);
    expect(await getCompanyConflicts(fakeDb({}), '999')).toBeNull();
  });
});
