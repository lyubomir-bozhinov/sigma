// The emit_report tool contract — the frozen interface from PR 80.
//
// ResolvedReport is the server-resolved artifact the dock and report page both consume.
// Block values are always scalars here (refs resolved by the server before this is returned).
// Canonical block vocabulary: text/callout use `md`, facts use `items`, bar uses `points`.
//
// On foundation merge, ~/lib/assistant/report-schema.ts will align to these names and this file
// will be replaced by `import type { ... } from '~/lib/assistant/report-schema'`.

export type CellFormat = 'money' | 'number' | 'percent' | 'date' | 'text';
export type EntityKind = 'company' | 'authority' | 'contract';

export interface ResolvedColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
  format: CellFormat;
  link?: { kind: EntityKind; idCol: string };
}

export interface ResolvedRow {
  cells: (string | number | null)[];
  // Resolved entity id per column for columns that declare a `link` (else null), aligned to `columns`.
  links?: (string | null)[];
}

// The resolved (server-bound) blocks the renderer/chip consume — values are already real, not refs.
export type ResolvedBlock =
  | { type: 'text'; md: string }
  | { type: 'callout'; title: string; md: string }
  | {
      type: 'totals';
      items: { label: string; value: string | number | null; format: CellFormat }[];
    }
  | { type: 'facts'; items: { term: string; value: string | number | null; sub?: string }[] }
  | { type: 'table'; columns: ResolvedColumn[]; rows: ResolvedRow[] }
  | { type: 'bar'; points: { label: string | number | null; value: number }[] }
  | { type: 'flows'; edges: { from: string; to: string; valueEur: number }[] }
  | { type: 'timeseries'; points: { period: string | number | null; value: number }[] };

export interface ResolvedReport {
  title: string;
  question: string;
  blocks: ResolvedBlock[];
  watermark: 'ai-generated';
}

// The `emit_report` tool part `output` shape (contract §3).
// On success the server returns the full resolved report plus the R2 persistence metadata (id/url).
// On failure (validation errors or storage error) it returns the error list.
export type EmitReportOutput =
  | { ok: true; id: string; url: string; report: ResolvedReport }
  | { ok: false; errors: string[] };
