// Pure parsers for the CACBG register (Сметна палата, декларации по чл.75 ЗСП).
// No I/O — takes XML strings, returns plain records. PII is stripped HERE, at the boundary:
// addresses / passport / phone are never extracted; family (Spouse/Children + non-self holdings) are
// counted but their names are dropped; a non-empty EGN anywhere is surfaced as a flag so the caller
// can refuse to persist it.
//
// XXE-safe: fast-xml-parser resolves no DTDs/external entities; we also reject any DOCTYPE/ENTITY
// declaration (defense in depth over ~200k MITM-influenceable files).

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep everything as strings — deterministic, no number coercion
  trimValues: true,
});

function assertNoDoctype(xml) {
  if (/<!doctype|<!entity/i.test(xml)) throw new Error('XXE guard: DOCTYPE/ENTITY not allowed');
}

function asArray(x) {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}

function cellText(cell) {
  if (cell == null) return '';
  const t = typeof cell === 'object' ? cell['#text'] : cell;
  return t == null ? '' : String(t).trim();
}

/**
 * Parse a year's list.xml into flat person→declaration rows.
 * list.xml carries NO year (the year lives inside each declaration XML) — do not infer it here.
 * Structure: root>MainCategory[]>Category[]{@Name}>Institution{@Name}>Person[]{Name,Position{Name,Declaration{xmlFile}}}
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
              const xmlFile = decl?.xmlFile;
              if (xmlFile) out.push({ category, institution, person: name, position, xmlFile });
            }
          }
        }
      }
    }
  }
  return out;
}

// Learn the @_Num of each column we care about from the first row's @_Description labels
// (they are carried as cell attributes on row 0). Falls back to the fixed CACBG layout for
// tables 10/11 (4=company, 5=seat, 7=holder, 8=EGN) if a label is missing.
function columnMap(firstRow) {
  const map = { company: '4', seat: '5', holder: '7', egn: '8' };
  for (const cell of asArray(firstRow?.Cell)) {
    const num = cell?.['@_Num'];
    const desc = String(cell?.['@_Description'] ?? '');
    if (!num) continue;
    if (/наименование.*дружеств|фирма/i.test(desc)) map.company = num;
    else if (/седалище/i.test(desc)) map.seat = num;
    else if (/собствено.*фамил/i.test(desc)) map.holder = num;
    else if (/^егн$/i.test(desc)) map.egn = num;
  }
  return map;
}

/**
 * Parse one declaration XML. Extracts the declarant's OWN company holdings only.
 * Root element is <PublicPerson>; holdings live in the "Дялове/Прехвърляне на дялове в дружества"
 * tables, one holding per <Row>, cells keyed by @_Num.
 * @returns {{
 *   year: string|null, declarant: string, declarationType: string|null, controlHash: string|null,
 *   egnPresent: boolean, familyHoldingCount: number,
 *   holdings: {company: string, seat: string, kind: string}[]   // self-held; NO holder names/EGN/value
 * }}
 */
export function parseDeclaration(xml) {
  assertNoDoctype(xml);
  const pp = parser.parse(xml)?.PublicPerson ?? {};
  const personal = pp.Personal ?? {};
  const decl = pp.DeclarationData ?? {};
  const declarant = String(personal.Name ?? '').trim();
  const year = decl.Year != null ? String(decl.Year).trim() : null; // from the DECLARATION, never the folder
  let egnPresent = String(personal.EGN ?? '').trim().length > 0;

  const holdings = [];
  let familyHoldingCount = 0;
  for (const table of asArray(pp.Tables?.Table)) {
    if (!/дружеств/i.test(String(table['@_Description'] ?? ''))) continue; // company-holdings sections
    const rows = asArray(table.Row);
    const col = columnMap(rows[0]);
    const kind = /акци/i.test(String(table['@_Description'])) ? 'акции' : 'дялове';
    for (const row of rows) {
      const by = {};
      for (const cell of asArray(row.Cell)) by[cell?.['@_Num']] = cellText(cell);
      const company = by[col.company] ?? '';
      if (!company) continue; // empty template row
      if ((by[col.egn] ?? '').length > 0) egnPresent = true; // holder EGN should be stripped upstream
      const holder = by[col.holder] ?? '';
      // self vs family: own row iff the holder is unnamed or is the declarant. Family names NOT retained.
      if (!holder || holder === declarant) holdings.push({ company, seat: by[col.seat] ?? '', kind });
      else familyHoldingCount += 1;
    }
  }
  return {
    year,
    declarant,
    declarationType: decl.DeclarationType != null ? String(decl.DeclarationType).trim() : null,
    controlHash: decl.ControlHash != null ? String(decl.ControlHash).trim() : null,
    egnPresent,
    familyHoldingCount,
    holdings,
  };
}
