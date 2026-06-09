import { CPV_SECTORS } from '@sigma/config';
import type { SectorRef } from '@sigma/api-contract';

const BY_CODE = new Map(CPV_SECTORS.map((s) => [s.code, s]));

/** Resolve a 2-digit CPV division to a display SectorRef (label + short name), or null if unknown. */
export function sectorRef(division: string | null | undefined): SectorRef | null {
  if (!division) return null;
  const s = BY_CODE.get(division);
  if (!s) return null;
  return { code: s.code, label: s.label, short: s.short ?? s.label };
}
