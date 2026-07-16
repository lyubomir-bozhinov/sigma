import { Link } from 'react-router';
import { money } from '@sigma/shared';
import type {
  ResolvedBlock,
  ResolvedReport,
  EmitTableColumn,
} from '../lib/assistant/report-schema';
import { entityHref, formatCell } from '../lib/assistant/render-format';
import { Callout } from './ui';
import { TotalsStrip } from './TotalsStrip';
import { FactsList } from './FactsList';
import { DataTable, type Column } from './DataTable';
import { TrendChart } from './TrendChart';

// Renders a server-authoritative ResolvedReport (spec §6): the SSR path passes the blocks straight
// from the immutable R2 artifact — no LLM, no D1. Every displayed number is already bound + sanitized
// by bindReport(); this component only chooses layout. NEVER dangerouslySetInnerHTML: model prose is
// plain-text rendered so the sanitizer (report-schema.sanitizeProse) remains the sole markup barrier
// until the Phase-2 markdown renderer lands (spec §7).
//
// Reuse note: `bar` and `flows` blocks are generic (label+value / from→to+value) and carry no entity
// ids, so they CANNOT feed RankedBars (hardcodes /authorities/ links) or SankeyDiagram (needs a
// precomputed layout). They render as self-contained accessible visuals here; entity links live in
// `table` blocks (via entityHref), which is where the digest deep-links contracts/companies/authorities.

const DASH = '—';

// A non-formatted cell/label value to display text, with the site em-dash for empty/null.
function labelText(value: string | number | null): string {
  return value == null || value === '' ? DASH : String(value);
}

// A generic horizontal bar list with a paired screen-reader table (WCAG AA — the site convention for
// every chart). Inline widths guarantee bars render regardless of CSS.
function BarBlock({
  points,
  truncated,
}: {
  points: { label: string | number | null; value: number }[];
  truncated?: boolean;
}) {
  if (points.length === 0) return <p className="small muted">Няма данни за тази графика.</p>;
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <>
      <ul className="report-bars" role="img" aria-label="Стълбовидна графика по стойност">
        {points.map((p, i) => (
          <li key={i}>
            <span
              className="rb-fill"
              style={{ width: `${Math.max(3, (p.value / max) * 100).toFixed(1)}%` }}
              aria-hidden="true"
            />
            <span className="rb-name">{labelText(p.label)}</span>
            <span className="rb-val num">{money(p.value)}</span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Данни за графиката</caption>
        <thead>
          <tr>
            <th scope="col">Означение</th>
            <th scope="col">Стойност (€)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{labelText(p.label)}</td>
              <td>{money(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="small muted">Резултатите са съкратени.</p>}
    </>
  );
}

// from → to flow list. A full Sankey needs a loader-computed layout (SankeyDiagram); the immutable
// artifact carries only edges, so we render the tabular form the Sankey is paired with anyway.
function FlowsBlock({
  edges,
  truncated,
}: {
  edges: { from: string; to: string; valueEur: number }[];
  truncated?: boolean;
}) {
  if (edges.length === 0) return <p className="small muted">Няма данни за потоците.</p>;
  return (
    <>
      <div className="table-wrap tbl-cards">
        <table>
          <caption className="sr-only">Потоци по стойност</caption>
          <thead>
            <tr>
              <th scope="col">От</th>
              <th scope="col">Към</th>
              <th scope="col" className="num">
                Стойност (€)
              </th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e, i) => (
              <tr key={i}>
                <td data-label="От">{e.from || DASH}</td>
                <td data-label="Към">{e.to || DASH}</td>
                <td className="money" data-label="Стойност (€)">
                  {money(e.valueEur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <p className="small muted">Резултатите са съкратени.</p>}
    </>
  );
}

function tableColumnAlign(col: EmitTableColumn): Column<unknown>['align'] {
  if (col.format === 'money') return 'money';
  if (col.format === 'number' || col.format === 'percent') return 'num';
  return col.align === 'right' ? 'num' : undefined;
}

type TableBlock = Extract<ResolvedBlock, { type: 'table' }>;

function ReportTable({ block }: { block: TableBlock }) {
  const columns: Column<TableBlock['rows'][number]>[] = block.columns.map((col, ci) => ({
    key: col.key,
    header: col.header,
    align: tableColumnAlign(col),
    cell: (row) => {
      const display = formatCell(row.cells[ci] ?? null, col.format);
      const id = col.link ? (row.links?.[ci] ?? null) : null;
      if (col.link && id) return <Link to={entityHref(col.link.kind, id)}>{display}</Link>;
      return display;
    },
  }));
  return (
    <>
      <DataTable columns={columns} rows={block.rows} getKey={(_row, i) => i} />
      {block.truncated && <p className="small muted">Резултатите са съкратени.</p>}
    </>
  );
}

function TimeseriesBlock({
  points,
  truncated,
}: {
  points: { period: string | number | null; value: number }[];
  truncated?: boolean;
}) {
  const trendPoints = points.map((p) => ({
    period: String(p.period ?? ''),
    valueEur: p.value,
    contracts: 0,
    partial: false,
  }));
  // Month vs year granularity from the period shape; TrendChart uses this for x-axis ticks.
  const granularity: 'month' | 'year' = trendPoints.every((p) => /^\d{4}$/.test(p.period))
    ? 'year'
    : 'month';
  return (
    <>
      {trendPoints.length >= 2 ? (
        <TrendChart points={trendPoints} granularity={granularity} />
      ) : null}
      <table className="sr-only">
        <caption>Данни във времето</caption>
        <thead>
          <tr>
            <th scope="col">Период</th>
            <th scope="col">Стойност (€)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{labelText(p.period)}</td>
              <td>{money(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="small muted">Резултатите са съкратени.</p>}
    </>
  );
}

function renderBlock(block: ResolvedBlock, i: number) {
  switch (block.type) {
    case 'text':
      return (
        <div className="report-prose" key={i}>
          {block.md.split(/\n\n+/).map((para, pi) => (
            <p key={pi}>{para}</p>
          ))}
        </div>
      );
    case 'callout':
      return (
        <Callout title={block.title} key={i}>
          <p>{block.md}</p>
        </Callout>
      );
    case 'totals':
      return (
        <TotalsStrip
          key={i}
          totals={block.items.map((it) => ({
            num: formatCell(it.value, it.format),
            label: it.label,
          }))}
        />
      );
    case 'facts':
      return (
        <FactsList
          key={i}
          rows={block.items.map((it) => ({
            term: it.term,
            value: labelText(it.value),
            sub: it.sub,
          }))}
        />
      );
    case 'table':
      return <ReportTable block={block} key={i} />;
    case 'bar':
      return <BarBlock points={block.points} truncated={block.truncated} key={i} />;
    case 'flows':
      return <FlowsBlock edges={block.edges} truncated={block.truncated} key={i} />;
    case 'timeseries':
      return <TimeseriesBlock points={block.points} truncated={block.truncated} key={i} />;
  }
}

export function ReportBlockRenderer({ report }: { report: ResolvedReport }) {
  return (
    <div className="report-blocks">
      {report.blocks.map((block, i) => (
        <div className="report-block" key={i}>
          {renderBlock(block, i)}
        </div>
      ))}
    </div>
  );
}
