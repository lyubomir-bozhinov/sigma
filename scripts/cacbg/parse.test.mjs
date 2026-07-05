// node:test — parsers over SYNTHETIC fixtures (no real PII). Mirrors the real CACBG shape verified
// against cached samples: list.xml root>MainCategory>Category>Institution>Person>Position>Declaration;
// declaration root <PublicPerson> with holdings in the "дружества" tables, one <Row> per holding,
// cells keyed by @_Num (4=company, 5=seat, 7=holder, 8=EGN).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseDeclaration } from './parse.mjs';

const LIST = `<?xml version="1.0"?>
<root><MainCategory><Category Name="Тест категория">
  <Institution Name="Тест институция">
    <Person><Name>Иван Петров Тестов</Name>
      <Position><Name>Директор</Name><Declaration><xmlFile>AAAA.xml</xmlFile></Declaration></Position>
    </Person>
    <Person><Name>Георги Иванов Второв</Name>
      <Position><Name>Член на съвет</Name><Declaration><xmlFile>BBBB.xml</xmlFile></Declaration></Position>
      <Position><Name>Зам.-член</Name><Declaration><xmlFile>CCCC.xml</xmlFile></Declaration></Position>
    </Person>
  </Institution>
</Category></MainCategory></root>`;

function decl({ name = 'Иван Петров Тестов', year = '2023', egn = '', address = 'ул. Тестова 1', rows = '' } = {}) {
  return `<?xml version="1.0"?>
<PublicPerson>
  <Personal><Name>${name}</Name><EGN>${egn}</EGN><Address>${address}</Address></Personal>
  <DeclarationData><Year>${year}</Year><DeclarationType>Годишна</DeclarationType><ControlHash>DEADBEEF</ControlHash></DeclarationData>
  <Tables><Table Num="11" Description="Прехвърляне на дялове в дружества с ограничена отговорност">${rows}</Table></Tables>
</PublicPerson>`;
}

const selfRow = `<Row>
  <Cell Num="1" Description="Ном. по ред">1</Cell>
  <Cell Num="2" Description="Вид на имуществото">дружествени дялове</Cell>
  <Cell Num="3" Description="Размер на дяловото участие">100%</Cell>
  <Cell Num="4" Description="Наименование на дружеството">"ТЕСТ АГРО" ЕООД</Cell>
  <Cell Num="5" Description="Седалище">София</Cell>
  <Cell Num="7" Parent="Собственик" Description="Име: собствено, бащино, фамилно">Иван Петров Тестов</Cell>
  <Cell Num="8" Description="ЕГН"></Cell>
</Row>`;
const emptyRow = `<Row><Cell Num="1">2</Cell><Cell Num="4"></Cell></Row>`;
const familyRow = `<Row>
  <Cell Num="1">3</Cell><Cell Num="4">"ФАМИЛНА" ЕООД</Cell><Cell Num="5">Пловдив</Cell>
  <Cell Num="7">Мария Спасова Роднинска</Cell>
</Row>`;

test('parseList flattens the hierarchy and handles multiple persons/positions', () => {
  const rows = parseList(LIST);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    category: 'Тест категория', institution: 'Тест институция',
    person: 'Иван Петров Тестов', position: 'Директор', xmlFile: 'AAAA.xml',
  });
  assert.deepEqual(rows.map((r) => r.xmlFile), ['AAAA.xml', 'BBBB.xml', 'CCCC.xml']);
});

test('parseDeclaration extracts self company holdings and skips empty template rows', () => {
  const d = parseDeclaration(decl({ rows: selfRow + emptyRow }));
  assert.deepEqual(d.holdings, [{ company: '"ТЕСТ АГРО" ЕООД', seat: 'София', kind: 'дялове' }]);
  assert.equal(d.familyHoldingCount, 0);
});

test('year comes from the declaration <Year>, not the folder (off-by-one guard)', () => {
  // folder 2024 publishes declarations whose declared Year is 2023 — we must read the XML, not the path
  assert.equal(parseDeclaration(decl({ year: '2023' })).year, '2023');
});

test('family holdings are counted but their names are never retained', () => {
  const d = parseDeclaration(decl({ rows: selfRow + familyRow }));
  assert.equal(d.familyHoldingCount, 1);
  assert.equal(d.holdings.length, 1); // only the self row
  const blob = JSON.stringify(d);
  assert.ok(!blob.includes('Мария'), 'family member name leaked into output');
  assert.ok(!blob.includes('ФАМИЛНА'), 'family holding company leaked into self holdings');
});

test('address / passport / phone are never extracted', () => {
  const blob = JSON.stringify(parseDeclaration(decl({ address: 'ул. Секретна 42', rows: selfRow })));
  assert.ok(!blob.includes('Секретна'), 'address leaked into output');
});

test('a non-empty EGN (personal or holder) raises egnPresent', () => {
  assert.equal(parseDeclaration(decl({ egn: '' })).egnPresent, false);
  assert.equal(parseDeclaration(decl({ egn: '7501011234' })).egnPresent, true);
  const holderEgn = `<Row><Cell Num="4">"X" ЕООД</Cell><Cell Num="7">Иван Петров Тестов</Cell><Cell Num="8">7501011234</Cell></Row>`;
  assert.equal(parseDeclaration(decl({ rows: holderEgn })).egnPresent, true);
});

test('XXE guard rejects DOCTYPE/ENTITY input', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><PublicPerson/>`;
  assert.throws(() => parseDeclaration(evil), /XXE guard/);
  assert.throws(() => parseList(evil), /XXE guard/);
});
