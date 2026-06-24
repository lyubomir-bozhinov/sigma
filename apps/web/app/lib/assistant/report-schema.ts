import { z } from 'zod';

// Zod schemas for the emit_report tool — the closed block vocabulary (v1).
// These mirror the ReportArtifact types in routes/report.tsx but are the authoritative
// Zod-validated form (invalid output from the model triggers a retry via the SDK).

const FormatHint = z.enum(['money', 'number', 'percent', 'date', 'text']);

// ── Block schemas ────────────────────────────────────────────────────────────

const BlockText = z.object({
  type: z.literal('text'),
  content: z.string().describe('Markdown prose string (no raw HTML)'),
});

const BlockCallout = z.object({
  type: z.literal('callout'),
  title: z.string().optional(),
  content: z.string().describe('Markdown body text (notes, caveats, source citation)'),
  variant: z.enum(['info', 'warning']).optional().default('info'),
});

const BlockTotals = z.object({
  type: z.literal('totals'),
  label: z.string().optional(),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]),
      format: FormatHint.optional().default('text'),
    }),
  ),
});

const BlockFacts = z.object({
  type: z.literal('facts'),
  label: z.string().optional(),
  rows: z.array(
    z.object({
      term: z.string(),
      value: z.string(),
      sub: z.string().optional(),
    }),
  ),
});

const TableColumn = z.object({
  key: z.string(),
  header: z.string(),
  align: z.enum(['left', 'right', 'center', 'num', 'money']).optional(),
  format: FormatHint.optional(),
  // link: {kind, field} — renderer builds href from entity kind + value in that field
  link: z
    .object({
      kind: z.enum(['authority', 'company', 'contract']),
      field: z.string().describe('Row key whose value is the entity slug/id'),
    })
    .optional(),
});

const BlockTable = z.object({
  type: z.literal('table'),
  caption: z.string().optional(),
  columns: z.array(TableColumn),
  // Each row is a plain object keyed by column.key
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
});

// bar: renderer computes shares and palette colours from raw values
const BlockBar = z.object({
  type: z.literal('bar'),
  label: z.string().optional(),
  unit: z.string().optional().describe('e.g. "€" — displayed as prefix on value labels'),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      key: z.string().optional().describe('Stable identifier for palette determinism'),
    }),
  ),
});

// flows: raw directional edges — renderer computes full SVG Sankey layout
const BlockFlows = z.object({
  type: z.literal('flows'),
  label: z.string().optional(),
  edges: z.array(
    z.object({
      from: z.string().describe('Authority name or id'),
      to: z.string().describe('Company / bidder name or id'),
      valueEur: z.number(),
      contracts: z.number().optional(),
    }),
  ),
});

const BlockTimeseries = z.object({
  type: z.literal('timeseries'),
  label: z.string().optional(),
  unit: z.string().optional(),
  // Single series
  points: z
    .array(z.object({ period: z.string(), value: z.number() }))
    .optional(),
  // Multi-series
  series: z
    .array(
      z.object({
        label: z.string(),
        points: z.array(z.object({ period: z.string(), value: z.number() })),
      }),
    )
    .optional(),
});

export const ReportBlock = z.discriminatedUnion('type', [
  BlockText,
  BlockCallout,
  BlockTotals,
  BlockFacts,
  BlockTable,
  BlockBar,
  BlockFlows,
  BlockTimeseries,
]);

export type ReportBlockType = z.infer<typeof ReportBlock>;

// ── Freshness ────────────────────────────────────────────────────────────────

export const FreshnessSource = z.object({
  source: z.enum(['admin', 'ocds', 'eop']),
  label: z.string(),
  asOf: z.string().describe('ISO date string'),
});

// ── Full report artifact ──────────────────────────────────────────────────────

export const ReportArtifactSchema = z.object({
  title: z.string().describe('Short descriptive title (≤ 80 chars)'),
  lede: z.string().optional().describe('One-sentence summary shown below the title'),
  scope: z.string().optional().describe('Date range or subject qualifier, e.g. "2020–2024"'),
  methodology: z
    .string()
    .optional()
    .describe('Markdown — explains measure, scope, excluded flags, data sources'),
  freshness: z.array(FreshnessSource).optional(),
  blocks: z.array(ReportBlock).min(1),
});

export type ReportArtifact = z.infer<typeof ReportArtifactSchema>;

// Stored artifact: artifact + server-added metadata
export interface StoredReport extends ReportArtifact {
  id: string;
  generatedAt: string;
  promptSummary?: string; // the original user question (for /reports index)
}
