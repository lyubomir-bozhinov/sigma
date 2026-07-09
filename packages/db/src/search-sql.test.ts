/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEARCH_HITS_SQL } from './queries/search';

// Integration test for the search-side свързани-лица SQL. The queries/search unit tests use a fake D1 and
// never run the real FTS + joins; this runs the EXACT exported SEARCH_HITS_SQL (which is used for EVERY kind,
// so a syntax slip would break all search) and the officials-index INSERT against a real SQLite built from
// the production migrations. Asserts: the query executes, officials dedupe to one row per person, only
// PUBLISHED links index/flag, and the company badge join keys correctly on the winner's ЕИК.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const migration0 = resolve(root, 'packages/db/migrations/0000_init.sql');
const migration2 = resolve(root, 'packages/db/migrations/0002_related_persons_foundation.sql');

function readScript(dbPath: string, path: string): void {
  execFileSync('sqlite3', ['-bail', dbPath], { input: `.read ${path}\n`, stdio: 'pipe' });
}
function exec(dbPath: string, sql: string): void {
  execFileSync('sqlite3', ['-bail', dbPath], { input: sql, encoding: 'utf8' });
}
function lit(sql: string, ...vals: (string | number)[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = vals[i++];
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  });
}
function rows(dbPath: string, sql: string): Record<string, string | number | null>[] {
  const out = execFileSync('sqlite3', ['-json', dbPath], { input: sql, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

// АЛФА + ГАМА both linked to one official (Иван) → dedupes to a single official row; БЕТА has no PUBLISHED
// link (Георги's link to it is 'held') → БЕТА must NOT be flagged and Георги must NOT be indexed.
const FIXTURE = `
INSERT INTO bidders (id, name, eik_normalized, eik_valid, kind) VALUES
  ('eik:111','АЛФА ООД','111111111',1,'company'),
  ('eik:222','БЕТА ООД','222222222',1,'company'),
  ('eik:333','ГАМА ООД','333333333',1,'company');
INSERT INTO company_totals (bidder_id, name, kind, eik, eik_valid, won_eur, contracts, authorities) VALUES
  ('eik:111','АЛФА ООД','company','111111111',1,1000000,1,1),
  ('eik:222','БЕТА ООД','company','222222222',1,500000,1,1),
  ('eik:333','ГАМА ООД','company','333333333',1,200000,1,1);
INSERT INTO persons (id, name) VALUES ('person:ИВАН МИНЕВ','Иван Минев'),('person:ГЕОРГИ ПЕТРОВ','Георги Петров');
INSERT INTO declarations (id, person_id, xml_file, control_hash, folder_year, declared_year, template, category, institution, position, source_url) VALUES
  ('decl:i','person:ИВАН МИНЕВ','i.xml','H1','2024','2023','assets','','ОБЩИНА РУСЕ','', 'https://register.cacbg.bg/2024/i.xml'),
  ('decl:g','person:ГЕОРГИ ПЕТРОВ','g.xml','H2','2024','2023','assets','','МИНИСТЕРСТВО Х','', 'https://register.cacbg.bg/2024/g.xml');
INSERT INTO interest_links
  (id, link_key, person_id, bidder_id, eik, entity_key, match_method, matcher_version, publish_tier, relation, interest_class, contemporaneous, own_institution, evidence_count, first_declared_year, last_declared_year, contract_count, contract_value_eur, first_contract_year, last_contract_year, status) VALUES
  ('il:ia','person:ИВАН МИНЕВ|111','person:ИВАН МИНЕВ','eik:111','111111111','АЛФА ООД','exact_name_key','v1','B_distinctive','owns','private_ownership',1,'none',1,'2020','2023',1,1000000,'2021','2021','published'),
  ('il:ig','person:ИВАН МИНЕВ|333','person:ИВАН МИНЕВ','eik:333','333333333','ГАМА ООД','exact_name_key','v1','B_distinctive','owns','private_ownership',0,'none',1,'2020','2023',1,200000,'2021','2021','published'),
  ('il:gb','person:ГЕОРГИ ПЕТРОВ|222','person:ГЕОРГИ ПЕТРОВ','eik:222','222222222','БЕТА ООД','exact_name_key','v1','C_hold','owns','private_ownership',0,'none',1,'2020','2020',1,500000,'2021','2021','held');
`;

// Search-index population — mirrors scripts/precompute.sql (company + officials). Kept here so the test
// exercises the same INSERT shape the ship runs; keep in sync with precompute.sql / refresh-slice.sql.
const POPULATE_INDEX = `
INSERT INTO search_index (kind, ref, title, ident, subtitle, amount)
SELECT 'company', ct.bidder_id, ct.name, COALESCE(ct.eik, ''), COALESCE(ct.settlement, ''), ct.won_eur
FROM company_totals ct;
INSERT INTO search_index (kind, ref, title, ident, subtitle, amount)
SELECT 'official', il.person_id, p.name, NULL,
  (SELECT d.institution FROM declarations d WHERE d.person_id = il.person_id
   ORDER BY d.declared_year DESC LIMIT 1),
  SUM(il.contract_value_eur)
FROM interest_links il JOIN persons p ON p.id = il.person_id
WHERE il.status = 'published' AND il.interest_class IN ('private_ownership', 'family_ownership')
GROUP BY il.person_id, p.name;
`;

function withDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(resolve(tmpdir(), 'search-sql-'));
  const dbPath = resolve(dir, 'test.db');
  try {
    readScript(dbPath, migration0);
    readScript(dbPath, migration2);
    exec(dbPath, FIXTURE);
    exec(dbPath, POPULATE_INDEX);
    fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('search свързани-лица SQL', () => {
  it('indexes one official row per person (dedupes multiple links), PUBLISHED only', () => {
    withDb((dbPath) => {
      // Иван has two published links (АЛФА + ГАМА) → ONE official row, amount = their sum. Георги's only
      // link is 'held' → not indexed at all (the surface never published him).
      const officials = rows(dbPath, lit(SEARCH_HITS_SQL, 'official', 'иван*', 10));
      expect(officials).toHaveLength(1);
      expect(officials[0]!.ref).toBe('person:ИВАН МИНЕВ');
      expect(officials[0]!.title).toBe('Иван Минев');
      expect(officials[0]!.subtitle).toBe('ОБЩИНА РУСЕ'); // latest institution disambiguates homonyms
      expect(officials[0]!.amount).toBe(1200000); // 1_000_000 + 200_000
      expect(rows(dbPath, lit(SEARCH_HITS_SQL, 'official', 'георги*', 10))).toHaveLength(0);
    });
  });

  it('flags a company with a PUBLISHED link and not one without (badge join keys on ЕИК)', () => {
    withDb((dbPath) => {
      const alfa = rows(dbPath, lit(SEARCH_HITS_SQL, 'company', 'алфа*', 10));
      expect(alfa).toHaveLength(1);
      expect(alfa[0]!.has_conflict).toBe(1); // АЛФА is Иван's declared stake
      // БЕТА's only link is 'held' → the published-only join must NOT flag it.
      const beta = rows(dbPath, lit(SEARCH_HITS_SQL, 'company', 'бета*', 10));
      expect(beta).toHaveLength(1);
      expect(beta[0]!.has_conflict).toBe(0);
    });
  });

  it('runs SEARCH_HITS_SQL for every kind without error and returns the FTS rank', () => {
    withDb((dbPath) => {
      // The query is shared across kinds — a rank/join slip would break company/contract search too. Prove
      // it executes and yields a numeric rank (the value the relevance gate reads).
      const hit = rows(dbPath, lit(SEARCH_HITS_SQL, 'company', 'гама*', 10));
      expect(hit).toHaveLength(1);
      expect(typeof hit[0]!.rank).toBe('number');
      expect(hit[0]!.has_conflict).toBe(1); // ГАМА is Иван's second stake
    });
  });
});
