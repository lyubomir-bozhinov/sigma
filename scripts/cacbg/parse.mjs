// Pure parsers for the CACBG register (Сметна палата, декларации по чл.75 ЗСП).
// Two templates exist, both handled here:
//   • <PublicPerson>      — asset declaration (декларация за имущество). Company SHARES in the
//                            „Дялове/Прехвърляне на дялове в дружества" tables (col 4 = company).
//   • <PublicPersonDekl2> — interests declaration (декларация за интереси). Richer: participation,
//                            MANAGEMENT/control roles, sole-trader activity, and declared related persons.
//
// No I/O — takes XML strings, returns plain records. PII is stripped at this boundary: addresses /
// passport / phone are never extracted; a non-empty EGN is surfaced as a flag; declared THIRD-PARTY
// people (related-persons/contract tables) are returned SEPARATELY (relatedPersons) so callers keep
// them internal-only (§8 — third-party data is not publishable).
//
// XXE-safe: fast-xml-parser resolves no DTDs/external entities; we also reject DOCTYPE/ENTITY input.

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // strings only — deterministic, no number coercion
  trimValues: true,
});

function assertNoDoctype(xml) {
  if (/<!doctype|<!entity/i.test(xml)) throw new Error('XXE guard: DOCTYPE/ENTITY not allowed');
}
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
function cellText(cell) {
  if (cell == null) return '';
  const t = typeof cell === 'object' ? cell['#text'] : cell;
  return t == null ? '' : String(t).trim();
}
// map a row's cells by @_Num → text
function cellsByNum(row) {
  const by = {};
  for (const c of asArray(row?.Cell)) by[c?.['@_Num']] = cellText(c);
  return by;
}
// find the @_Num of the first column whose @_Description matches `re` (labels live on the header row)
function colNum(firstRow, re, fallback) {
  for (const c of asArray(firstRow?.Cell)) {
    if (c?.['@_Num'] && re.test(String(c?.['@_Description'] ?? ''))) return c['@_Num'];
  }
  return fallback;
}
const year4 = (s) => (String(s ?? '').match(/\b(20\d{2})\b/)?.[1] ?? null);

/**
 * Parse a year's list.xml into flat person→declaration rows.
 * list.xml carries NO year (year lives inside each declaration) — do not infer it here.
 * @returns {{category:string, institution:string, person:string, position:string, xmlFile:string}[]}
 */
export function parseList(xml) {
  assertNoDoctype(xml);
  const root = parser.parse(xml)?.root;
  const out = [];
  for (const main of asArray(root?.MainCategory)) {
    for (const cat of asArray(main?.Category)) {
      const category = cat?.['@_Name'] ?? '';
      for (const inst of asArray(cat?.Institution)) {
        const institution = inst?.['@_Name'] ?? '';
        for (const person of asArray(inst?.Person)) {
          const name = person?.Name ?? '';
          for (const pos of asArray(person?.Position)) {
            const position = pos?.Name ?? '';
            for (const decl of asArray(pos?.Declaration)) {
              if (decl?.xmlFile) out.push({ category, institution, person: name, position, xmlFile: decl.xmlFile });
            }
          }
        }
      }
    }
  }
  return out;
}

// --- asset declaration (<PublicPerson>): company SHARES ------------------------------------------
function parseAssets(pp) {
  const personal = pp.Personal ?? {};
  const dd = pp.DeclarationData ?? {};
  const declarant = String(personal.Name ?? '').trim();
  let egnPresent = String(personal.EGN ?? '').trim().length > 0;
  const interests = [];
  let familyHoldingCount = 0;
  for (const table of asArray(pp.Tables?.Table)) {
    if (!/дружеств/i.test(String(table['@_Description'] ?? ''))) continue;
    const rows = asArray(table.Row);
    const cCompany = colNum(rows[0], /наименование.*дружеств|фирма/i, '4');
    const cSeat = colNum(rows[0], /седалище/i, '5');
    const cHolder = colNum(rows[0], /собствено.*фамил/i, '7');
    const cEgn = colNum(rows[0], /^егн$/i, '8');
    const kind = /акци/i.test(String(table['@_Description'])) ? 'shares' : 'shares';
    for (const row of rows) {
      const by = cellsByNum(row);
      const company = by[cCompany] ?? '';
      if (!company) continue;
      if ((by[cEgn] ?? '').length > 0) egnPresent = true;
      const holder = by[cHolder] ?? '';
      if (!holder || holder === declarant) interests.push({ entity: company, kind, detail: by[cSeat] ?? '', timing: 'annual', seat: by[cSeat] ?? '' });
      else familyHoldingCount += 1;
    }
  }
  return {
    templateType: 'assets',
    declarant,
    position: String(personal.Position ?? '').trim() || null,
    work: String(personal.Work ?? '').trim() || null,
    year: year4(dd.Year),
    declarationType: dd.DeclarationType != null ? String(dd.DeclarationType).trim() : null,
    controlHash: dd.ControlHash != null ? String(dd.ControlHash).trim() : null,
    egnPresent,
    familyHoldingCount,
    interests,
    relatedPersons: [],
  };
}

// --- interests declaration (<PublicPersonDekl2>): participation / MANAGEMENT / sole-trader / related
function parseInterests(ppd) {
  const personal = ppd.Personal ?? {};
  const dd = ppd.DeclarationData ?? {};
  const declarant = String(personal.Name ?? '').trim();
  const egnPresent = String(personal.EGN ?? '').trim().length > 0;
  const interests = [];
  const relatedPersons = []; // third-party people — INTERNAL only (§8)
  for (const table of asArray(ppd.Tables?.Table)) {
    const desc = String(table['@_Description'] ?? '');
    const rows = asArray(table.Row);
    const timing = /дванадесет месеца преди/i.test(desc) ? 'prior' : 'current';
    let kind = null;
    if (/участие в следните търговски дружества|имам участие/i.test(desc)) kind = 'participation';
    else if (/управител или член на орган|управление или контрол/i.test(desc)) kind = 'management';
    else if (/едноличен търговец|наименование на ет/i.test(desc) || /наименование на ет/i.test(String(rows[0]?.Cell?.[1]?.['@_Description'] ?? ''))) kind = 'sole_trader';
    else if (/свързани лица/i.test(desc)) kind = 'related_person';
    else if (/договори с лица/i.test(desc)) kind = 'related_contract';
    else continue;

    if (kind === 'related_person' || kind === 'related_contract') {
      const cName = colNum(rows[0], /трите имена|име.*фамил/i, '2');
      const cInfo = colNum(rows[0], /област|предмет/i, '3');
      for (const row of rows) {
        const by = cellsByNum(row);
        const name = by[cName] ?? '';
        if (name) relatedPersons.push({ name, kind, info: by[cInfo] ?? '', timing });
      }
      continue;
    }
    // company / ЕТ bearing tables: entity name in the „Дружество" / „Наименование на ЕТ" column
    const cEntity = colNum(rows[0], /^дружество$|наименование на ет|дружеств/i, '2');
    const cDetail = colNum(rows[0], /размер|участие|предмет/i, '3');
    for (const row of rows) {
      const by = cellsByNum(row);
      const entity = by[cEntity] ?? '';
      if (entity) interests.push({ entity, kind, detail: by[cDetail] ?? '', timing, seat: '' });
    }
  }
  return {
    templateType: 'interests',
    declarant,
    position: String(personal.Position ?? '').trim() || null,
    work: String(personal.Work ?? '').trim() || null,
    year: year4(dd.DeclarationDate) ?? year4(dd.EntryDate),
    declarationType: 'interests',
    controlHash: dd.ControlHash != null ? String(dd.ControlHash).trim() : null,
    egnPresent,
    familyHoldingCount: 0,
    interests,
    relatedPersons,
  };
}

/**
 * Parse one declaration XML (either template). Detects the root and dispatches.
 * @returns unified record — see parseAssets / parseInterests. `interests[]` carry {entity, kind,
 * detail, timing}; kind ∈ shares|participation|management|sole_trader. `relatedPersons[]` are
 * third-party (INTERNAL-only). Unknown roots return an empty record (not an error).
 */
export function parseDeclaration(xml) {
  assertNoDoctype(xml);
  const doc = parser.parse(xml);
  if (doc?.PublicPerson) return parseAssets(doc.PublicPerson);
  // interests declaration ships in several template versions (PublicPersonDekl2, Dekl3, …) that differ
  // only in table NUMBERING — parseInterests classifies tables by @_Description, so it handles them all.
  const dekl = Object.keys(doc ?? {}).find((k) => /^PublicPersonDekl\d+$/.test(k));
  if (dekl) return parseInterests(doc[dekl]);
  return { templateType: 'unknown', declarant: '', position: null, work: null, year: null, declarationType: null, controlHash: null, egnPresent: false, familyHoldingCount: 0, interests: [], relatedPersons: [] };
}
