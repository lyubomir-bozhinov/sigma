// Catalog loader. `assembleCases` is the pure core (flatten + stamp category + enforce unique ids);
// `loadCases` is the thin fs glob that feeds it every `<category>.cases.ts` in ./catalog. A new category
// file is discovered automatically — the loader never changes when the corpus grows.

import { readdirSync } from 'node:fs';
import type { CaseDef, EvalCase } from './catalog/_schema';

export interface CaseGroup {
  category: string;
  defs: CaseDef[];
}

/** Flatten groups into EvalCases, stamping `category` and rejecting a duplicate id across the corpus. */
export function assembleCases(groups: CaseGroup[]): EvalCase[] {
  const out: EvalCase[] = [];
  const seen = new Set<string>();
  for (const { category, defs } of groups) {
    for (const def of defs) {
      if (seen.has(def.id)) throw new Error(`duplicate eval case id: ${def.id}`);
      seen.add(def.id);
      out.push({ ...def, category });
    }
  }
  return out;
}

/** The category stem of a catalog filename, or null for a non-catalog / underscore-prefixed file. */
export function categoryOf(fileName: string): string | null {
  if (fileName.startsWith('_')) return null; // _schema.ts, _template.cases.ts
  const m = /^(.+)\.cases\.ts$/.exec(fileName);
  return m ? m[1]! : null;
}

const CATALOG_DIR = new URL('./catalog/', import.meta.url);

/** Discover and load every catalog file under ./catalog (or `dir`), assembled into one corpus. */
export async function loadCases(dir: URL = CATALOG_DIR): Promise<EvalCase[]> {
  const groups: CaseGroup[] = [];
  for (const fileName of readdirSync(dir).sort()) {
    const category = categoryOf(fileName);
    if (!category) continue;
    const mod = (await import(new URL(fileName, dir).href)) as { cases?: CaseDef[] };
    if (!Array.isArray(mod.cases)) throw new Error(`${fileName}: must export a \`cases\` array`);
    groups.push({ category, defs: mod.cases });
  }
  return assembleCases(groups);
}
