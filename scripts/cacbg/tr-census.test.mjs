// TR census — structural field detection + deterministic tier-C promotion.
// Run: node --import ./scripts/cacbg/register-ts.mjs --test scripts/cacbg/tr-census.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractEntity, buildCensus, promote } from './tr-census.mjs';

let dir, dump, dbPath;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-census-'));
  dump = path.join(dir, 'tr.json');
  // TR records with varied field names — detection must find ЕИК (9/13 digits) + name structurally.
  fs.writeFileSync(dump, JSON.stringify([
    { EIK: '444444447', Naименование: 'СИЙ АД', hash: 'abc' },            // globally unique → promote
    { code: '555555556', firm_name: 'ОБЩА ФИРМА ООД', town: 'София' },     // one of two namesakes
    { code: '666666663', firm_name: 'Обща Фирма ООД', town: 'Варна' },     // second namesake → NOT unique
  ]));

  dbPath = path.join(dir, 'db.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE interest_links(link_key TEXT PRIMARY KEY, eik TEXT, entity_key TEXT, status TEXT, publish_tier TEXT, match_method TEXT);
    INSERT INTO interest_links VALUES ('p1|444444447','444444447','СИЙ АД','held','C_hold','exact_name_key');
    INSERT INTO interest_links VALUES ('p2|555555556','555555556','ОБЩА ФИРМА ООД','held','C_hold','exact_name_key');
  `);
  db.close();
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('extractEntity finds ЕИК (9/13 digits) and name regardless of field names', () => {
  assert.deepEqual(extractEntity({ EIK: '444444447', Naименование: 'СИЙ АД' }), { eik: '444444447', name: 'СИЙ АД' });
  assert.deepEqual(extractEntity({ x: '2018060520', y: 'Дълга Фирма ЕООД' }).eik, null); // 10 digits ≠ ЕИК
  assert.equal(extractEntity({ code: '5555555560000', name: 'X ООД' }).eik, '5555555560000'); // 13-digit ЕИК
});

test('buildCensus indexes name-key → set of ЕИК over the whole dump', () => {
  const c = buildCensus(dump);
  assert.equal(c.get('СИЙ АД').size, 1);
  assert.equal(c.get('ОБЩА ФИРМА ООД').size, 2); // both namesakes fold to one key → genuinely non-unique
});

test('promote publishes only globally-unique tier-C links; shared names stay held', () => {
  const db = new DatabaseSync(dbPath);
  const res = promote(db, buildCensus(dump));
  assert.equal(res.promoted, 1);
  const rows = new Map(db.prepare('SELECT link_key,status,match_method FROM interest_links').all().map((r) => [r.link_key, r]));
  assert.equal(rows.get('p1|444444447').status, 'published'); // unique → promoted
  assert.match(rows.get('p1|444444447').match_method, /tr_census/);
  assert.equal(rows.get('p2|555555556').status, 'held'); // two namesakes → stays held
  db.close();
});
