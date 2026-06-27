// Renders a full ResolvedReport inline inside the 400 px dock panel.
// Lazy-loaded by AssistantTranscript so chart/formatting deps stay out of the SSR Worker bundle.

import { Link } from 'react-router';
import { money, count, pct } from '@sigma/shared';
import { TotalsStrip } from '../../components/TotalsStrip';
import { FactsList } from '../../components/FactsList';
import { TimeseriesChart } from '../../components/TimeseriesChart';
import { sanitizeMarkdown } from '../sanitize-markdown';
import type { ResolvedBlock, ResolvedReport, CellFormat } from './contract';

function fmt(value: string | number | null, format?: CellFormat): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (format === 'money') return money(Number.isFinite(n) ? n : null);
  if (format === 'percent') return pct(Number.isFinite(n) ? n : null);
  if (format === 'number') return count(Number.isFinite(n) ? n : null);
  return String(value);
}

function DockBlock({ block }: { block: ResolvedBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <div
          className="dock-report__text"
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.md) }}
        />
      );

    case 'callout':
      return (
        <div className="callout warning dock-report__callout">
          <strong>{block.title}</strong>
          <div dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.md) }} />
        </div>
      );

    case 'totals':
      return (
        <TotalsStrip
          totals={block.items.map((item) => ({
            num: fmt(item.value, item.format),
            label: item.label,
          }))}
        />
      );

    case 'facts':
      return (
        <FactsList rows={block.items.map((r) => ({ term: r.term, value: r.value, sub: r.sub }))} />
      );

    case 'table':
      return (
        <div className="dock-report__table-wrap">
          <table className="dock-report__table">
            <thead>
              <tr>
                {block.columns.map((col) => (
                  <th key={col.key} className={col.align === 'right' ? 'num' : undefined}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {block.columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={col.align === 'right' ? 'num' : undefined}
                      data-label={col.header}
                    >
                      {fmt(row.cells[ci] ?? null, col.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'bar': {
      const max = Math.max(1, ...block.points.map((p) => p.value));
      return (
        <ul className="dock-report__bars" role="list">
          {block.points.slice(0, 10).map((pt, i) => (
            <li key={i} className="rb-row">
              <span
                className="rb-fill"
                style={{ width: `${Math.max(3, (pt.value / max) * 100).toFixed(1)}%` }}
                aria-hidden="true"
              />
              <span className="rb-name">{pt.label ?? '—'}</span>
              <span className="rb-val num">{money(pt.value)}</span>
            </li>
          ))}
        </ul>
      );
    }

    case 'flows': {
      const top = [...block.edges]
        .sort((a, b) => b.valueEur - a.valueEur)
        .slice(0, 8);
      if (top.length === 0) return null;
      return (
        <ul className="dock-report__flows" role="list">
          {top.map((e, i) => (
            <li key={i} className="dock-report__flow-row">
              <span className="dock-report__flow-names">
                <span className="dock-report__flow-from">{e.from}</span>
                <span className="dock-report__flow-arrow">→</span>
                <span className="dock-report__flow-to">{e.to}</span>
              </span>
              <span className="dock-report__flow-val num">{money(e.valueEur)}</span>
            </li>
          ))}
        </ul>
      );
    }

    case 'timeseries': {
      const pts = block.points?.map((p) => ({ period: String(p.period ?? ''), value: p.value }));
      const srs = block.series?.map((s) => ({
        label: s.label,
        points: s.points.map((p) => ({ period: String(p.period ?? ''), value: p.value })),
      }));
      return <TimeseriesChart points={pts} series={srs} />;
    }
  }
}

interface InlineDockReportProps {
  report: ResolvedReport;
  href: string;
}

export function InlineDockReport({ report, href }: InlineDockReportProps) {
  return (
    <article className="dock-report">
      <header className="dock-report__header">
        <h3 className="dock-report__title">{report.title}</h3>
      </header>

      <div className="dock-report__blocks">
        {report.blocks.map((block, i) => (
          <div key={i} className="dock-report__block">
            <DockBlock block={block} />
          </div>
        ))}
      </div>

      <footer className="dock-report__footer">
        <Link className="dock-report__page-link" to={href}>
          Отвори пълна страница ↗
        </Link>
        <span className="dock-report__watermark">AI-генерирано, неофициално</span>
      </footer>
    </article>
  );
}
