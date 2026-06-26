// /reports/:id — renders a single AI-generated report from the browser's localStorage transcript.
// SSR renders an empty shell; the client fills it on mount (server is stateless per spec §5).
// The report ID is the UIMessage.id that carried the emit_report tool output.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import type { SankeyLayout, SankeyNode, SankeyRibbon } from '@sigma/api-contract';
import { money, count, pct } from '@sigma/shared';
import { PageHeader } from '../components/PageHeader';
import { TotalsStrip } from '../components/TotalsStrip';
import { FactsList } from '../components/FactsList';
import { SankeyDiagram } from '../components/SankeyDiagram';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { loadTranscript } from '../lib/assistant-dock/storage';
import { reportOutputFromMessage } from '../lib/assistant-dock/report-projection';
import { sanitizeMarkdown } from '../lib/sanitize-markdown';
import type { ResolvedReport, ResolvedBlock, CellFormat } from '../lib/assistant-dock/contract';

// ── Value formatting ──────────────────────────────────────────────────────────

function formatValue(value: string | number | null, format?: CellFormat): string {
  if (value === null || value === undefined) return '—';
  if (format === 'money') return money(typeof value === 'number' ? value : Number(value));
  if (format === 'percent') return pct(typeof value === 'number' ? value : Number(value));
  if (format === 'number') return count(typeof value === 'number' ? value : Number(value));
  return String(value);
}

// ── Sankey helper (flows block) ───────────────────────────────────────────────

const Y_TOP = 20, Y_BOTTOM = 600, GAP = 6;
const A_X = 140, C_X = 540, BAR_W = 20, MID_X = 350;

function truncLabel(s: string, n = 30) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function buildSankeyFromEdges(edges: { from: string; to: string; valueEur: number }[]): SankeyLayout {
  const authAgg = new Map<string, number>();
  const compAgg = new Map<string, number>();
  for (const e of edges) {
    authAgg.set(e.from, (authAgg.get(e.from) ?? 0) + e.valueEur);
    compAgg.set(e.to, (compAgg.get(e.to) ?? 0) + e.valueEur);
  }
  const authKeys = [...authAgg.keys()].sort((a, b) => authAgg.get(b)! - authAgg.get(a)!);
  const compKeys = [...compAgg.keys()].sort((a, b) => compAgg.get(b)! - compAgg.get(a)!);
  const total = [...authAgg.values()].reduce((s, v) => s + v, 0) || 1;
  const scaleA = (Y_BOTTOM - Y_TOP - (authKeys.length - 1) * GAP) / total;
  const scaleC = (Y_BOTTOM - Y_TOP - (compKeys.length - 1) * GAP) / total;

  const aPos = new Map<string, { y: number; h: number; off: number; index: number }>();
  const cPos = new Map<string, { y: number; h: number; off: number; index: number }>();
  const nodes: SankeyNode[] = [];

  let ay = Y_TOP;
  authKeys.forEach((key, i) => {
    const h = Math.max(1, authAgg.get(key)! * scaleA);
    aPos.set(key, { y: ay, h, off: ay, index: i });
    nodes.push({ label: truncLabel(key), valueEur: authAgg.get(key)!, side: 'authority', x: A_X, y: ay, width: BAR_W, height: h, labelY: ay + h / 2 });
    ay += h + GAP;
  });
  let cy = Y_TOP;
  compKeys.forEach((key, i) => {
    const h = Math.max(1, compAgg.get(key)! * scaleC);
    cPos.set(key, { y: cy, h, off: cy, index: i });
    nodes.push({ label: truncLabel(key), valueEur: compAgg.get(key)!, side: 'company', x: C_X, y: cy, width: BAR_W, height: h, labelY: cy + h / 2 });
    cy += h + GAP;
  });

  const ordered = [...edges].sort(
    (a, b) => aPos.get(a.from)!.index - aPos.get(b.from)!.index || cPos.get(a.to)!.index - cPos.get(b.to)!.index,
  );
  const ribbons: SankeyRibbon[] = ordered.map((e) => {
    const a = aPos.get(e.from)!;
    const c = cPos.get(e.to)!;
    const a0 = a.off, a1 = a0 + e.valueEur * scaleA;
    a.off = a1;
    const c0 = c.off, c1 = c0 + e.valueEur * scaleC;
    c.off = c1;
    const ax = A_X + BAR_W;
    return {
      d: `M${ax},${a0.toFixed(1)} C${MID_X},${a0.toFixed(1)} ${MID_X},${c0.toFixed(1)} ${C_X},${c0.toFixed(1)} L${C_X},${c1.toFixed(1)} C${MID_X},${c1.toFixed(1)} ${MID_X},${a1.toFixed(1)} ${ax},${a1.toFixed(1)} Z`,
      title: `${e.from} → ${e.to}: ${money(e.valueEur)}`,
      fromName: e.from,
      toName: e.to,
      valueEur: e.valueEur,
      contracts: 0,
    };
  });

  return { viewBox: '-150 -6 990 614', width: 990, height: 614, nodes, ribbons };
}

// ── Block renderer ────────────────────────────────────────────────────────────

function entityHref(kind: string, id: string): string {
  if (kind === 'authority') return `/authorities/${id}`;
  if (kind === 'company') return `/companies/${id}`;
  if (kind === 'contract') return `/contracts/${id}`;
  return '#';
}

function BlockRenderer({ block }: { block: ResolvedBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <div
          className="report-text"
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.md) }}
        />
      );

    case 'callout':
      return (
        <div className="callout warning">
          <strong>{block.title}</strong>
          <div dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.md) }} />
        </div>
      );

    case 'totals':
      return (
        <TotalsStrip
          totals={block.items.map((item) => ({
            num: formatValue(item.value, item.format),
            label: item.label,
          }))}
        />
      );

    case 'facts':
      return (
        <FactsList
          rows={block.items.map((r) => ({ term: r.term, value: r.value, sub: r.sub }))}
        />
      );

    case 'table': {
      return (
        <div className="table-wrap tbl-cards">
          <table>
            <thead>
              <tr>
                {block.columns.map((col) => (
                  <th key={col.key} scope="col" className={col.align === 'right' ? 'num' : undefined}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {block.columns.map((col, ci) => {
                    const raw = row.cells[ci] ?? null;
                    const display = formatValue(raw, col.format);
                    const linkId = col.link ? (row.links?.[ci] ?? null) : null;
                    return (
                      <td
                        key={col.key}
                        className={col.align === 'right' ? 'num' : undefined}
                        data-label={col.header}
                      >
                        {linkId != null ? (
                          <a href={entityHref(col.link!.kind, linkId)}>{display}</a>
                        ) : (
                          display
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'bar': {
      const max = Math.max(1, ...block.points.map((p) => p.value));
      return (
        <ul className="ranked-bars" role="list">
          {block.points.map((pt, i) => (
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
      if (block.edges.length === 0) return null;
      const layout = buildSankeyFromEdges(block.edges);
      return <SankeyDiagram layout={layout} />;
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

// ── Markdown export ───────────────────────────────────────────────────────────

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function reportToMarkdown(report: ResolvedReport): string {
  const lines: string[] = [`# ${report.title}`, ''];

  for (const block of report.blocks) {
    switch (block.type) {
      case 'text':
        lines.push(block.md, '');
        break;
      case 'callout':
        lines.push(`> **${block.title}**`, ...block.md.split('\n').map((l) => `> ${l}`), '');
        break;
      case 'totals':
        lines.push(mdTable(['Показател', 'Стойност'], block.items.map((i) => [i.label, formatValue(i.value, i.format)])), '');
        break;
      case 'facts':
        lines.push(mdTable(['Поле', 'Стойност'], block.items.map((r) => [r.term, r.sub ? `${String(r.value)} _(${r.sub})_` : String(r.value ?? '—')])), '');
        break;
      case 'table':
        lines.push(mdTable(
          block.columns.map((c) => c.header),
          block.rows.map((row) => block.columns.map((c, ci) => formatValue(row.cells[ci] ?? null, c.format))),
        ), '');
        break;
      case 'bar':
        lines.push(...block.points.map((pt, i) => `${i + 1}. ${pt.label} — ${money(pt.value)}`), '');
        break;
      case 'flows':
        lines.push(mdTable(['Възложител', 'Изпълнител', 'Стойност (EUR)'], block.edges.map((e) => [e.from, e.to, money(e.valueEur)])), '');
        break;
      case 'timeseries': {
        const pts = block.points ?? block.series?.[0]?.points ?? [];
        lines.push(mdTable(['Период', 'Стойност'], pts.map(({ period, value }) => [String(period ?? ''), money(value)])), '');
        break;
      }
    }
  }

  lines.push('---', '_AI-генерирано, неофициално — СИГМА_');
  return lines.join('\n');
}

function MarkdownExportButton({ report }: { report: ResolvedReport }) {
  function handleClick() {
    const md = reportToMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.slice(0, 40).replace(/[^а-яa-z0-9]/gi, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="report-action-btn" onClick={handleClick}>
      <svg viewBox="0 0 20 20" aria-hidden="true" width="15" height="15">
        <path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h9v2H3v-2z" fill="currentColor" />
      </svg>
      Markdown
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ReportClient({ id }: { id: string }) {
  const [report, setReport] = useState<ResolvedReport | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const messages = loadTranscript();
    const msg = messages.find((m) => m.id === id);
    if (!msg) { setNotFound(true); return; }
    const output = reportOutputFromMessage(msg);
    if (!output?.ok) { setNotFound(true); return; }
    setReport(output.report);
  }, [id]);

  if (notFound) {
    return (
      <div className="report-not-found">
        <p className="muted">Справката не е намерена в този браузър.</p>
        <Link to="/reports">← Всички справки</Link>
      </div>
    );
  }

  if (!report) {
    return <p className="muted">Зареждане…</p>;
  }

  return (
    <>
      <div className="report-toolbar">
        <span className="report-watermark">AI-генерирано, неофициално</span>
        <div className="report-toolbar__actions">
          <MarkdownExportButton report={report} />
          <button type="button" className="report-action-btn" onClick={() => window.print()}>
            <svg viewBox="0 0 20 20" aria-hidden="true" width="15" height="15">
              <path d="M5 2h10v4H5V2zM3 8h14v7h-3v3H6v-3H3V8zm2 2v4h10v-4H5zm6 5H9v2h2v-2z" fill="currentColor" />
            </svg>
            Принтирай
          </button>
        </div>
      </div>

      {report.question && (
        <p className="report-question muted">Въпрос: {report.question}</p>
      )}

      <div className="report-blocks">
        {report.blocks.map((block, i) => (
          <section key={i} className="report-block">
            <BlockRenderer block={block} />
          </section>
        ))}
      </div>
    </>
  );
}

export function meta() {
  return [
    { title: 'AI Справка — СИГМА' },
    { name: 'robots', content: 'noindex' },
  ];
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main id="main" className="report-page">
      <PageHeader kicker="AI Справка" title="Справка" />
      {mounted && id ? <ReportClient id={id} /> : null}
    </main>
  );
}
