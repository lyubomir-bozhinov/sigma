/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPANY_SQL, LEADERBOARD_SQL, OFFICIAL_SQL } from './queries/related-persons';

// Integration test for the свързани-лица SQL. The query layer's unit tests (queries/related-persons.test)
// use a fake D1 and never run the aggregation; this runs the EXACT exported SQL against a real SQLite
// built from the production migrations (0000 + 0002) with a deterministic fixture, asserting the private
// vs ex-officio separation (ADR-0013), the value ordering, and the source_url provenance subquery.
// Mirrors the sqlite3-CLI harness of competition-sql.test.ts (no better-sqlite3 dependency).

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const migration0 = resolve(root, 'packages/db/migrations/0000_init.sql');
const migration2 = resolve(root, 'packages/db/migrations/0002_related_persons_foundation.sql');

function sqlite(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath], { input: sql, encoding: 'utf8' }).trim();
}
function readScript(dbPath: string, path: string): void {
  execFileSync('sqlite3', ['-bail', dbPath], { input: `.read ${path}\n`, stdio: 'pipe' });
}
// Substitute D1 `?` binds with SQL literals so the exported query runs through the sqlite3 CLI unchanged.
function lit(sql: string, ...vals: (string | number)[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = vals[i++];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}
// Rows as objects keyed by column name — JSON output, since link_key itself contains a '|' that would
// break a pipe-split of the default list mode.
function rows(dbPath: string, sql: string): Record<string, string | number | null>[] {
  const out = execFileSync('sqlite3', ['-json', dbPath], { input: sql, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

// Иван OWNS ТРЕЙС (private_ownership, own institution, €88M). Борис + Виктор both MANAGE ХОЛДИНГ 9
// (declared by two officials → ex_officio_board, €5M each). Кмет declares a CLOSE RELATIVE's stake in
// ЕВРОСТРОЙ (family_ownership, own institution, €250k — anonymized). Голям owns ГОЛЯМ (private, €50M, NO
// nexus) — a high-value link with no own-institution tie, to prove NEXUS-first ordering beats raw value.
// Only Иван has a declaration row → his link resolves a source_url; the others do not (NULL).
const FIXTURE = `
INSERT INTO bidders (id, name, bulstat, eik_normalized, eik_valid, kind) VALUES
  ('eik:111','ТРЕЙС ГРУП ХОЛД АД','111','111',1,'company'),
  ('eik:222','ХОЛДИНГ 9 ЕАД','222','222',1,'company'),
  ('eik:333','ЕВРОСТРОЙ 21 ЕООД','333','333',1,'company'),
  ('eik:444','ГОЛЯМ ООД','444','444',1,'company');
INSERT INTO persons (id, name) VALUES
  ('person:ivan','Иван Минев'),('person:boris','Борис Манолов'),('person:viktor','Виктор Асенов'),
  ('person:kmet','Кмет Тестов'),('person:big','Голям Официал');
INSERT INTO declarations (id, person_id, xml_file, control_hash, folder_year, declared_year, template, category, institution, position, source_url) VALUES
  ('decl:i','person:ivan','i.xml','H1','2024','2023','assets','','ТЕСТ','', 'https://register.cacbg.bg/2024/i.xml');
INSERT INTO declared_interests (id, declaration_id, entity_raw, entity_key, kind, detail, timing, seat) VALUES
  ('di:i','decl:i','ТРЕЙС ГРУП ХОЛД АД','ТРЕЙС ГРУП ХОЛД АД','shares','','annual','');
INSERT INTO interest_links
  (id, link_key, person_id, bidder_id, eik, entity_key, match_method, matcher_version, publish_tier, relation, interest_class, contemporaneous, own_institution, evidence_count, first_declared_year, last_declared_year, contract_count, contract_value_eur, first_contract_year, last_contract_year, status) VALUES
  ('il:ivan','person:ivan|111','person:ivan','eik:111','111','ТРЕЙС ГРУП ХОЛД АД','exact_name_key','v1','B_distinctive','owns','private_ownership',1,'exact',1,'2019','2023',35,88000000,'2021','2024','published'),
  ('il:boris','person:boris|222','person:boris','eik:222','222','ХОЛДИНГ 9 ЕАД','exact_name_key','v1','B_distinctive','manages','ex_officio_board',0,'none',1,'2023','2023',10,5000000,'2023','2023','published'),
  ('il:viktor','person:viktor|222','person:viktor','eik:222','222','ХОЛДИНГ 9 ЕАД','exact_name_key','v1','B_distinctive','manages','ex_officio_board',0,'none',1,'2023','2023',10,5000000,'2023','2023','published'),
  ('il:fam','person:kmet|333|family','person:kmet','eik:333','333','ЕВРОСТРОЙ 21 ЕООД','exact_name_key','v1','B_distinctive','related','family_ownership',1,'exact',1,'2018','2020',5,250000,'2019','2020','published'),
  ('il:big','person:big|444','person:big','eik:444','444','ГОЛЯМ ООД','exact_name_key','v1','B_distinctive','owns','private_ownership',1,'none',1,'2020','2021',10,50000000,'2020','2021','published'),
  -- a HELD link must never surface in any query
  ('il:held','person:ivan|999','person:ivan','eik:111','999','НЯКОЙ ООД','exact_name_key','v1','C_hold','owns','private_ownership',0,'none',1,'2022','2022',3,1000,'2022','2022','held'),
  -- a WITHDRAWN (divested — later filing omits the company) link must never surface either (§8/E11)
  ('il:gone','person:viktor|111','person:viktor','eik:111','111','ТРЕЙС ГРУП ХОЛД АД','exact_name_key','v1','B_distinctive','owns','private_ownership',0,'none',1,'2015','2015',5,2000000,'2016','2016','withdrawn');
`;

describe('свързани-лица SQL (real SQLite)', () => {
  function withDb<T>(fn: (dbPath: string) => T): T {
    const dir = mkdtempSync(resolve(tmpdir(), 'sigma-related-'));
    const dbPath = resolve(dir, 'test.sqlite');
    try {
      readScript(dbPath, migration0);
      readScript(dbPath, migration2);
      sqlite(dbPath, FIXTURE);
      return fn(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('leaderboard returns material ownership (self + family), NEXUS-ranked; held/withdrawn/ex-officio excluded', () => {
    withDb((dbPath) => {
      const board = rows(dbPath, lit(LEADERBOARD_SQL, 100));
      // held €1000, withdrawn €2M, and BOTH ex-officio board links are excluded → 3 material links remain
      expect(board.map((r) => r.official)).toEqual(['Иван Минев', 'Кмет Тестов', 'Голям Официал']);
      // NEXUS-first: the €250k family link (own institution) OUTRANKS the €50M link with no nexus — the
      // old value-only ordering would have put Голям (€50M) first. This is the anti-noise fix.
      expect(board[1]!.official).toBe('Кмет Тестов');
      expect(board[1]!.relation).toBe('related'); // family stake — the relative is anonymized in the UI
      expect(board[2]!.official).toBe('Голям Официал'); // highest value, but no nexus → ranked last
      // Иван's private stake keeps its provenance + declared span
      expect(board[0]!.official).toBe('Иван Минев');
      expect(board[0]!.contract_value_eur).toBe(88_000_000);
      expect(board[0]!.first_declared_year).toBe('2019');
      expect(board[0]!.last_declared_year).toBe('2023');
      expect(board[0]!.source_url).toBe('https://register.cacbg.bg/2024/i.xml');
    });
  });

  it('a family (close-relative) link surfaces on the winner + official views, carrying relation=related', () => {
    withDb((dbPath) => {
      const byCompany = rows(dbPath, lit(COMPANY_SQL, '333'));
      expect(byCompany).toHaveLength(1);
      expect(byCompany[0]!.official).toBe('Кмет Тестов'); // official named (their public declaration)
      expect(byCompany[0]!.company).toBe('ЕВРОСТРОЙ 21 ЕООД'); // company named (public winner)
      expect(byCompany[0]!.relation).toBe('related'); // holder anonymized as свързано лице in the UI layer
      const byOfficial = rows(dbPath, lit(OFFICIAL_SQL, 'person:kmet'));
      expect(byOfficial.map((r) => r.relation)).toEqual(['related']);
    });
  });

  it('ex-officio / management roles are never surfaced — not even on the winner’s own page', () => {
    withDb((dbPath) => {
      // ЕИК 222 has only ex-officio board links (Борис + Виктор) → the company view is empty, not a list of them
      const board = rows(dbPath, lit(COMPANY_SQL, '222'));
      expect(board).toHaveLength(0);
    });
  });

  it('official view returns one office-holder’s ownership links; withdrawn links excluded on the winner view', () => {
    withDb((dbPath) => {
      const ivan = rows(dbPath, lit(OFFICIAL_SQL, 'person:ivan'));
      expect(ivan).toHaveLength(1); // published private only — the held link is excluded
      expect(ivan[0]!.company).toBe('ТРЕЙС ГРУП ХОЛД АД');

      // ЕИК 111: only Иван (published) — Виктор's withdrawn (divested) link to the same winner is excluded
      const trace = rows(dbPath, lit(COMPANY_SQL, '111'));
      expect(trace.map((r) => r.official)).toEqual(['Иван Минев']);
    });
  });
});
