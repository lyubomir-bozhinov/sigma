// /reports/:id — renders an immutable AI-generated report artifact from R2.
//
// D4: CSP — per-request nonce is applied automatically by entry.server.tsx.
//     No s-maxage → worker never swaps nonce for hash-based policy.
//     Cache-Control: private keeps it off the CDN edge (per-request nonce must survive).
//
// D5: AI watermark + "Как е изчислено" callout on every report.
// D6: Per-source freshness (admin/ocds/eop) surfaced in the callout.

import { useState } from 'react';
import { data } from 'react-router';
import type { SankeyLayout, SankeyNode, SankeyRibbon } from '@sigma/api-contract';
import { money } from '@sigma/shared';
import type { Route } from './+types/report';
import { sanitizeMarkdown } from '../lib/sanitize-markdown';
import type { StoredReport, ReportBlockType } from '../lib/assistant/report-schema';
import { TotalsStrip } from '../components/TotalsStrip';
import { FactsList } from '../components/FactsList';
import { SankeyDiagram } from '../components/SankeyDiagram';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { PageHeader } from '../components/PageHeader';

// ── Sankey layout from raw edges ─────────────────────────────────────────────
// Mirrors the buildSankey logic in @sigma/db but works from the agent's {from, to, valueEur} edges
// instead of pre-joined DB rows.

const Y_TOP = 20, Y_BOTTOM = 600, GAP = 6;
const A_X = 140, C_X = 540, BAR_W = 20, MID_X = 350;

function truncLabel(s: string, n = 30) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

interface FlowEdge { from: string; to: string; valueEur: number; contracts?: number }

function buildSankeyFromEdges(edges: FlowEdge[]): SankeyLayout {
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
      title: `${e.from} → ${e.to}: ${money(e.valueEur)}${e.contracts ? ` · ${e.contracts} договора` : ''}`,
      fromName: e.from,
      toName: e.to,
      valueEur: e.valueEur,
      contracts: e.contracts ?? 0,
    };
  });

  return { viewBox: '-150 -6 990 614', width: 990, height: 614, nodes, ribbons };
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ params, context }: Route.LoaderArgs) {
  const { id } = params;
  const store = context.cloudflare.env.REPORT_STORE;

  if (!store) {
    throw data('Докладите не са конфигурирани на тази среда.', { status: 503 });
  }

  const obj = await store.get(`${id}.json`);
  if (!obj) {
    throw data('Докладът не е намерен.', { status: 404 });
  }

  const report = (await obj.json()) as StoredReport;
  return { id, report };
}

export function headers() {
  return { 'Cache-Control': 'private, max-age=31536000, immutable' };
}

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.report?.title ?? 'AI доклад';
  return [
    { title: `${title} — СИГМА` },
    { name: 'robots', content: 'noindex' },
  ];
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatValue(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (format === 'money') return money(Number(value));
  if (format === 'percent') return `${(Number(value) * 100).toFixed(1)} %`;
  if (format === 'number') return Number(value).toLocaleString('bg');
  return String(value);
}

function entityHref(kind: string, id: string): string {
  if (kind === 'authority') return `/authorities/${id}`;
  if (kind === 'company') return `/companies/${id}`;
  if (kind === 'contract') return `/contracts/${id}`;
  return '#';
}

// ── Markdown export ───────────────────────────────────────────────────────────

function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function reportToMarkdown(report: StoredReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  if (report.lede) lines.push(`\n${report.lede}`);
  if (report.scope) lines.push(`\n_Обхват: ${report.scope}_`);
  lines.push('');

  for (const block of report.blocks) {
    switch (block.type) {
      case 'text':
        lines.push(block.content, '');
        break;

      case 'callout':
        if (block.title) lines.push(`> **${block.title}**`);
        lines.push(
          ...block.content.split('\n').map((l) => `> ${l}`),
          '',
        );
        break;

      case 'totals':
        if (block.label) lines.push(`## ${block.label}`);
        lines.push(
          mdTable(
            ['Показател', 'Стойност'],
            block.items.map((i) => [i.label, formatValue(i.value, i.format)]),
          ),
          '',
        );
        break;

      case 'facts':
        if (block.label) lines.push(`## ${block.label}`);
        lines.push(
          mdTable(
            ['Поле', 'Стойност'],
            block.rows.map((r) => [r.term, r.sub ? `${r.value} _(${r.sub})_` : r.value]),
          ),
          '',
        );
        break;

      case 'table':
        if (block.caption) lines.push(`## ${block.caption}`);
        lines.push(
          mdTable(
            block.columns.map((c) => c.header),
            block.rows.map((row) =>
              block.columns.map((c) =>
                formatValue(row[c.key] as string | number | null, c.format),
              ),
            ),
          ),
          '',
        );
        break;

      case 'bar':
        if (block.label) lines.push(`## ${block.label}`);
        lines.push(
          ...block.items.map(
            (item, i) =>
              `${i + 1}. ${item.label} — ${block.unit ? `${block.unit}${item.value.toLocaleString('bg')}` : money(item.value)}`,
          ),
          '',
        );
        break;

      case 'flows':
        if (block.label) lines.push(`## ${block.label}`);
        lines.push(
          mdTable(
            ['Възложител', 'Компания', 'Стойност (EUR)', 'Договори'],
            block.edges.map((e) => [
              e.from,
              e.to,
              money(e.valueEur),
              String(e.contracts ?? ''),
            ]),
          ),
          '',
        );
        break;

      case 'timeseries': {
        if (block.label) lines.push(`## ${block.label}`);
        const pts = block.points ?? block.series?.[0]?.points ?? [];
        if (block.series && block.series.length > 1) {
          const headers = ['Период', ...block.series.map((s) => s.label)];
          const periodMap = new Map<string, string[]>();
          block.series.forEach((s, si) => {
            s.points.forEach(({ period, value }) => {
              if (!periodMap.has(period)) periodMap.set(period, Array(block.series!.length).fill(''));
              periodMap.get(period)![si] = money(value);
            });
          });
          lines.push(mdTable(headers, [...periodMap.entries()].map(([p, vals]) => [p, ...vals])), '');
        } else {
          lines.push(
            mdTable(
              ['Период', 'Стойност'],
              pts.map(({ period, value }) => [period, money(value)]),
            ),
            '',
          );
        }
        break;
      }
    }
  }

  if (report.methodology) {
    lines.push('---', '## Как е изчислено', '', report.methodology, '');
  }

  lines.push(
    '---',
    `_Генерирано от СИГМА AI на ${new Date(report.generatedAt).toLocaleDateString('bg')}. Неофициално._`,
  );

  return lines.join('\n');
}

function MarkdownButton({ report }: { report: StoredReport }) {
  function handleDownload() {
    const md = reportToMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      className="report-pdf-btn"
      onClick={handleDownload}
      aria-label="Изтегли като Markdown"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" width="16" height="16">
        <path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h9v2H3v-2z" fill="currentColor"/>
      </svg>
      Markdown
    </button>
  );
}

// ── Block renderers ───────────────────────────────────────────────────────────

function BlockRenderer({ block }: { block: ReportBlockType }) {
  switch (block.type) {

    case 'text':
      return (
        <div
          className="report-text"
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.content) }}
        />
      );

    case 'callout':
      return (
        <div className={`callout${block.variant === 'warning' ? ' warning' : ''}`}>
          {block.title && <strong>{block.title}</strong>}
          <div dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(block.content) }} />
        </div>
      );

    case 'totals':
      return (
        <TotalsStrip
          label={block.label}
          totals={block.items.map((item) => ({
            num: formatValue(item.value, item.format),
            label: item.label,
          }))}
        />
      );

    case 'facts':
      return (
        <FactsList
          label={block.label}
          rows={block.rows.map((r) => ({ term: r.term, value: r.value, sub: r.sub }))}
        />
      );

    case 'table': {
      return (
        <div className="table-wrap tbl-cards">
          <table>
            {block.caption && <caption className="sr-only">{block.caption}</caption>}
            <thead>
              <tr>
                {block.columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.align === 'money' || col.align === 'num' ? 'num' : col.align ?? undefined}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {block.columns.map((col) => {
                    const raw = row[col.key];
                    const display = formatValue(raw as string | number | null, col.format);
                    const linked = col.link && raw != null;
                    return (
                      <td
                        key={col.key}
                        className={col.align === 'money' || col.align === 'num' ? 'num' : col.align ?? undefined}
                        data-label={col.header}
                      >
                        {linked ? (
                          <a href={entityHref(col.link!.kind, String(row[col.link!.field] ?? raw))}>
                            {display}
                          </a>
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
      const max = Math.max(1, ...block.items.map((i) => i.value));
      return (
        <ul className="ranked-bars" aria-label={block.label}>
          {block.items.map((item, i) => (
            <li key={i} className="rb-row">
              <span
                className="rb-fill"
                style={{ width: `${Math.max(3, (item.value / max) * 100).toFixed(1)}%` }}
                aria-hidden="true"
              />
              <span className="rb-name">{item.label}</span>
              <span className="rb-val num">
                {block.unit ? `${block.unit}${item.value.toLocaleString('bg')}` : money(item.value)}
              </span>
            </li>
          ))}
        </ul>
      );
    }

    case 'flows': {
      const layout = buildSankeyFromEdges(block.edges);
      return <SankeyDiagram layout={layout} />;
    }

    case 'timeseries':
      return (
        <TimeseriesChart
          points={block.points}
          series={block.series}
          label={block.label}
          unit={block.unit}
        />
      );
  }
}

// ── D5: Watermark + methodology callout (D6: per-source freshness) ────────────

function MethodologyCallout({ report }: { report: StoredReport }) {
  const hasFreshness = report.freshness && report.freshness.length > 0;
  if (!report.methodology && !hasFreshness) return null;
  return (
    <div className="callout warning report-methodology">
      <strong>Как е изчислено</strong>
      {report.methodology && (
        <div dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(report.methodology) }} />
      )}
      {hasFreshness && (
        <dl className="report-freshness">
          {report.freshness!.map((f) => (
            <div key={f.source} className="row">
              <dt>{f.label}</dt>
              <dd>{f.asOf}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PDF_SERVER = import.meta.env.VITE_PDF_SERVER_URL ?? '';

function PdfButton({ reportId }: { reportId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleDownload() {
    if (!PDF_SERVER) return;
    setState('loading');
    try {
      const res = await fetch(`${PDF_SERVER}/pdf/${encodeURIComponent(reportId)}`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  if (!PDF_SERVER) return null;

  return (
    <button
      type="button"
      className="report-pdf-btn"
      onClick={handleDownload}
      disabled={state === 'loading'}
      aria-label="Изтегли като PDF"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" width="16" height="16">
        <path d="M10 13L6 9h3V3h2v6h3l-4 4z" fill="currentColor"/>
        <path d="M3 15h14v2H3v-2z" fill="currentColor"/>
      </svg>
      {state === 'loading' ? 'Генериране…' : state === 'error' ? 'Грешка' : 'PDF'}
    </button>
  );
}

export default function ReportPage({ loaderData }: Route.ComponentProps) {
  const { id, report } = loaderData;

  return (
    <main id="main" className="report-page">
      <div className="report-top-bar">
        <div className="report-watermark" role="note" aria-label="Предупреждение">
          AI-генерирано, неофициално
        </div>
        <div className="report-top-bar__actions">
          <MarkdownButton report={report} />
          <button
            type="button"
            className="report-pdf-btn"
            onClick={() => window.print()}
            aria-label="Принтирай / запази като PDF"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" width="16" height="16">
              <path d="M10 13L6 9h3V3h2v6h3l-4 4z" fill="currentColor"/>
              <path d="M3 15h14v2H3v-2z" fill="currentColor"/>
            </svg>
            Принтирай
          </button>
          <PdfButton reportId={id} />
        </div>
      </div>

      <PageHeader kicker="AI Доклад" title={report.title} lede={report.lede} />

      {report.scope && <p className="report-scope muted">{report.scope}</p>}

      <MethodologyCallout report={report} />

      <div className="report-blocks">
        {report.blocks.map((block, i) => (
          <section key={i} className="report-block">
            <BlockRenderer block={block} />
          </section>
        ))}
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const msg =
    error && typeof error === 'object' && 'data' in error
      ? String((error as { data: unknown }).data)
      : 'Докладът не може да се зареди.';
  return (
    <main id="main">
      <PageHeader kicker="AI Доклад" title="Грешка" lede={msg} />
    </main>
  );
}
