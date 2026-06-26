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
        lines.push(block.md, '');
        break;

      case 'callout':
        lines.push(`> **${block.title}**`);
        lines.push(
          ...block.md.split('\n').map((l) => `> ${l}`),
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
            block.items.map((r) => [r.term, r.sub ? `${r.value} _(${r.sub})_` : r.value]),
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
              block.columns.map((c, ci) =>
                formatValue(row.cells[ci] ?? null, c.format),
              ),
            ),
          ),
          '',
        );
        break;

      case 'bar':
        if (block.label) lines.push(`## ${block.label}`);
        lines.push(
          ...block.points.map(
            (pt, i) =>
              `${i + 1}. ${pt.label} — ${block.unit ? `${block.unit}${pt.value.toLocaleString('bg')}` : money(pt.value)}`,
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

// ── DOCX export ───────────────────────────────────────────────────────────────
// docx is imported lazily (dynamic import) so the library never executes at
// module initialisation time during SSR — it injects a <link> into <head>
// which would cause a hydration mismatch.

async function reportToDocx(report: StoredReport): Promise<Blob> {
  const {
    AlignmentType, Document, HeadingLevel, Packer, Paragraph,
    Table, TableCell, TableRow, TextRun, WidthType, BorderStyle,
    convertMillimetersToTwip, ShadingType,
  } = await import('docx');

  // ── inline helpers (need docx constructors in scope) ──────────────────────

  function parseInline(text: string) {
    const runs = [];
    const re = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) runs.push(new TextRun(text.slice(last, match.index)));
      const token = match[0];
      if (token.startsWith('**')) runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
      else if (token.startsWith('_')) runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
      else runs.push(new TextRun({ text: token.slice(1, -1), font: 'Courier New', size: 18 }));
      last = match.index + token.length;
    }
    if (last < text.length) runs.push(new TextRun(text.slice(last)));
    return runs;
  }

  function mdParagraph(text: string, opts?: { indent?: boolean; spacing?: number }) {
    return new Paragraph({
      children: parseInline(text),
      indent: opts?.indent ? { left: convertMillimetersToTwip(12) } : undefined,
      spacing: opts?.spacing != null ? { after: opts.spacing } : { after: 120 },
    });
  }

  const HEADER_SHADING = { fill: 'F2F2F2', type: ShadingType.SOLID, color: 'auto' };
  const NO_BORDER = { style: BorderStyle.NIL, size: 0, color: 'auto' };
  const THIN = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };

  function makeTable(headers: string[], rows: (string | number | null)[][]) {
    const colWidth = Math.floor(9000 / headers.length);
    return new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((h) =>
            new TableCell({
              shading: HEADER_SHADING,
              borders: { top: THIN, bottom: THIN, left: NO_BORDER, right: NO_BORDER },
              width: { size: colWidth, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
            }),
          ),
        }),
        ...rows.map((row) =>
          new TableRow({
            children: row.map((cell) =>
              new TableCell({
                borders: { top: THIN, bottom: THIN, left: NO_BORDER, right: NO_BORDER },
                width: { size: colWidth, type: WidthType.DXA },
                children: [new Paragraph({ children: parseInline(cell == null ? '—' : String(cell)), spacing: { after: 60 } })],
              }),
            ),
          }),
        ),
      ],
    });
  }

  function spacer(points = 200) {
    return new Paragraph({ text: '', spacing: { after: points } });
  }

  function blockToDocx(block: ReportBlockType) {
    switch (block.type) {
      case 'text':
        return block.md.split('\n\n').filter(Boolean).map((para) => mdParagraph(para));

      case 'callout': {
        const border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'E8A317', space: 8 } };
        return [
          new Paragraph({ children: [new TextRun({ text: block.title, bold: true })], indent: { left: convertMillimetersToTwip(8) }, spacing: { after: 60 }, border }),
          ...block.md.split('\n\n').filter(Boolean).map((para) =>
            new Paragraph({ children: parseInline(para), indent: { left: convertMillimetersToTwip(8) }, spacing: { after: 80 }, border }),
          ),
        ];
      }

      case 'totals': {
        const out = [];
        if (block.label) out.push(new Paragraph({ text: block.label, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        out.push(makeTable(['Показател', 'Стойност'], block.items.map((i) => [i.label, formatValue(i.value, i.format)])));
        return out;
      }

      case 'facts': {
        const out = [];
        if (block.label) out.push(new Paragraph({ text: block.label, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        out.push(makeTable(['Поле', 'Стойност'], block.items.map((r) => [r.term, r.sub ? `${r.value} (${r.sub})` : r.value])));
        return out;
      }

      case 'table': {
        const out = [];
        if (block.caption) out.push(new Paragraph({ text: block.caption, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        out.push(makeTable(
          block.columns.map((c) => c.header),
          block.rows.map((row) => block.columns.map((c, ci) => formatValue(row.cells[ci] ?? null, c.format))),
        ));
        return out;
      }

      case 'bar': {
        const out = [];
        if (block.label) out.push(new Paragraph({ text: block.label, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        out.push(makeTable(
          ['#', 'Наименование', 'Стойност'],
          block.points.map((pt, i) => [i + 1, pt.label, block.unit ? `${block.unit}${Number(pt.value).toLocaleString('bg')}` : money(pt.value)]),
        ));
        return out;
      }

      case 'flows': {
        const out = [];
        if (block.label) out.push(new Paragraph({ text: block.label, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        out.push(makeTable(['Възложител', 'Изпълнител', 'Стойност (EUR)'], block.edges.map((e) => [e.from, e.to, money(e.valueEur)])));
        return out;
      }

      case 'timeseries': {
        const out = [];
        if (block.label) out.push(new Paragraph({ text: block.label, heading: HeadingLevel.HEADING_3, spacing: { after: 100 } }));
        if (block.series && block.series.length > 1) {
          const periodMap = new Map<string, (string | number | null)[]>();
          block.series.forEach((s, si) => {
            s.points.forEach(({ period, value }) => {
              if (!periodMap.has(period)) periodMap.set(period, Array(block.series!.length).fill(null));
              periodMap.get(period)![si] = money(value);
            });
          });
          out.push(makeTable(['Период', ...block.series.map((s) => s.label)], [...periodMap.entries()].map(([p, vals]) => [p, ...vals])));
        } else {
          const pts = block.points ?? block.series?.[0]?.points ?? [];
          out.push(makeTable(['Период', 'Стойност'], pts.map(({ period, value }) => [period, money(value)])));
        }
        return out;
      }
    }
  }

  // ── build document ─────────────────────────────────────────────────────────

  const children = [];

  children.push(new Paragraph({ text: report.title, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'AI-генерирано, неофициално', italics: true, color: '888888', size: 18 })],
    spacing: { after: 160 },
  }));
  if (report.lede) children.push(new Paragraph({ children: parseInline(report.lede), spacing: { after: 160 } }));
  if (report.scope) children.push(new Paragraph({
    children: [new TextRun({ text: `Обхват: ${report.scope}`, italics: true, size: 18 })],
    spacing: { after: 240 },
  }));

  for (const block of report.blocks) {
    children.push(...blockToDocx(block), spacer());
  }

  if (report.methodology) {
    children.push(
      new Paragraph({ text: 'Как е изчислено', heading: HeadingLevel.HEADING_2, spacing: { after: 120 } }),
      ...report.methodology.split('\n\n').filter(Boolean).map((p) => mdParagraph(p)),
      spacer(),
    );
  }

  children.push(new Paragraph({
    children: [new TextRun({
      text: `Генерирано от СИГМА AI на ${new Date(report.generatedAt).toLocaleDateString('bg')}. Неофициално.`,
      italics: true,
      size: 16,
      color: '888888',
    })],
    alignment: AlignmentType.CENTER,
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: {
        top: convertMillimetersToTwip(20), bottom: convertMillimetersToTwip(20),
        left: convertMillimetersToTwip(25), right: convertMillimetersToTwip(25),
      } } },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

function DocxButton({ report }: { report: StoredReport }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleDownload() {
    setState('loading');
    try {
      const blob = await reportToDocx(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.id}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

  return (
    <button
      type="button"
      className="report-pdf-btn"
      onClick={handleDownload}
      disabled={state === 'loading'}
      aria-label="Изтегли като Word документ"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" width="16" height="16">
        <path d="M4 2h8l4 4v12H4V2zm8 0v4h4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 10l1.5 4 1.5-4 1.5 4 1.5-4" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
      {state === 'loading' ? 'Генериране…' : state === 'error' ? 'Грешка' : 'Word'}
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
          rows={block.items.map((r) => ({ term: r.term, value: r.value, sub: r.sub }))}
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
                  {block.columns.map((col, ci) => {
                    const raw = row.cells[ci] ?? null;
                    const display = formatValue(raw, col.format);
                    const linkId = col.link ? (row.links?.[ci] ?? null) : null;
                    return (
                      <td
                        key={col.key}
                        className={col.align === 'money' || col.align === 'num' ? 'num' : col.align ?? undefined}
                        data-label={col.header}
                      >
                        {linkId != null ? (
                          <a href={entityHref(col.link!.kind, linkId)}>
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
      const max = Math.max(1, ...block.points.map((p) => p.value));
      return (
        <ul className="ranked-bars" aria-label={block.label}>
          {block.points.map((pt, i) => (
            <li key={i} className="rb-row">
              <span
                className="rb-fill"
                style={{ width: `${Math.max(3, (pt.value / max) * 100).toFixed(1)}%` }}
                aria-hidden="true"
              />
              <span className="rb-name">{pt.label}</span>
              <span className="rb-val num">
                {block.unit ? `${block.unit}${pt.value.toLocaleString('bg')}` : money(pt.value)}
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

// ── PDF export (client-side, pdfmake + Roboto for Cyrillic) ──────────────────

const INK = '#1f1a14';
const INK_SOFT = '#888880';
const RULE = '#d6d4ce';
const ACCENT = '#9b2a1a';
const ACCENT_BG = '#fdf4f2';

async function reportToPdf(report: StoredReport): Promise<void> {
  const [{ default: pdfMake }, robotoModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/fonts/Roboto'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfMake as any).addFontContainer((robotoModule as any).default ?? robotoModule);

  // ── inline markdown parser ────────────────────────────────────────────────
  function parseInline(text: string) {
    const runs: object[] = [];
    const re = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index) });
      const tok = m[0];
      if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), bold: true });
      else if (tok.startsWith('_')) runs.push({ text: tok.slice(1, -1), italics: true });
      else runs.push({ text: tok.slice(1, -1), fontSize: 9, color: ACCENT });
      last = m.index + tok.length;
    }
    if (last < text.length) runs.push({ text: text.slice(last) });
    return runs.length === 1 && 'text' in runs[0] ? (runs[0] as { text: string }).text : runs;
  }

  function para(text: string, opts?: object) {
    return { text: parseInline(text), margin: [0, 0, 0, 6] as [number,number,number,number], ...opts };
  }

  function tableBlock(headers: string[], rows: (string | number | null)[][]) {
    return {
      margin: [0, 4, 0, 10] as [number,number,number,number],
      table: {
        headerRows: 1,
        widths: headers.map(() => '*'),
        body: [
          headers.map((h) => ({ text: h, bold: true, fontSize: 9, color: INK_SOFT, fillColor: '#f5f4f1' })),
          ...rows.map((row) =>
            row.map((cell) => ({ text: cell == null ? '—' : String(cell), fontSize: 10 }))
          ),
        ],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
          i === 0 || i === node.table.body.length ? 1 : 0.5,
        vLineWidth: () => 0,
        hLineColor: () => RULE,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
    };
  }

  function blockToPdf(block: ReportBlockType): object[] {
    switch (block.type) {
      case 'text':
        return block.md.split('\n\n').filter(Boolean).map((p) => para(p));

      case 'callout':
        return [{
          margin: [0, 4, 0, 10] as [number,number,number,number],
          table: {
            widths: [4, '*'],
            body: [[
              { text: '', fillColor: ACCENT, border: [false,false,false,false] },
              {
                stack: [
                  { text: block.title, bold: true, fontSize: 11, margin: [0,0,0,4] },
                  ...block.md.split('\n\n').filter(Boolean).map((p) => para(p)),
                ],
                fillColor: ACCENT_BG,
                border: [false,false,false,false],
                margin: [10, 8, 8, 8] as [number,number,number,number],
              },
            ]],
          },
          layout: { defaultBorder: false },
        }];

      case 'totals': {
        const out: object[] = [];
        if (block.label) out.push({ text: block.label, style: 'h3' });
        out.push(tableBlock(['Показател', 'Стойност'], block.items.map((i) => [i.label, formatValue(i.value, i.format)])));
        return out;
      }

      case 'facts': {
        const out: object[] = [];
        if (block.label) out.push({ text: block.label, style: 'h3' });
        out.push(tableBlock(['Поле', 'Стойност'], block.items.map((r) => [r.term, r.sub ? `${r.value} (${r.sub})` : r.value])));
        return out;
      }

      case 'table': {
        const out: object[] = [];
        if (block.caption) out.push({ text: block.caption, style: 'h3' });
        out.push(tableBlock(
          block.columns.map((c) => c.header),
          block.rows.map((row) => block.columns.map((c, ci) => formatValue(row.cells[ci] ?? null, c.format))),
        ));
        return out;
      }

      case 'bar': {
        const out: object[] = [];
        if (block.label) out.push({ text: block.label, style: 'h3' });
        out.push(tableBlock(
          ['#', 'Наименование', 'Стойност'],
          block.points.map((pt, i) => [i + 1, pt.label, block.unit ? `${block.unit}${Number(pt.value).toLocaleString('bg')}` : money(pt.value)]),
        ));
        return out;
      }

      case 'flows': {
        const out: object[] = [];
        if (block.label) out.push({ text: block.label, style: 'h3' });
        out.push(tableBlock(['Възложител', 'Изпълнител', 'Стойност (EUR)'], block.edges.map((e) => [e.from, e.to, money(e.valueEur)])));
        return out;
      }

      case 'timeseries': {
        const out: object[] = [];
        if (block.label) out.push({ text: block.label, style: 'h3' });
        if (block.series && block.series.length > 1) {
          const periodMap = new Map<string, (string | number | null)[]>();
          block.series.forEach((s, si) => {
            s.points.forEach(({ period, value }) => {
              if (!periodMap.has(period)) periodMap.set(period, Array(block.series!.length).fill(null));
              periodMap.get(period)![si] = money(value);
            });
          });
          out.push(tableBlock(['Период', ...block.series.map((s) => s.label)], [...periodMap.entries()].map(([p, vals]) => [p, ...vals])));
        } else {
          const pts = block.points ?? block.series?.[0]?.points ?? [];
          out.push(tableBlock(['Период', 'Стойност'], pts.map(({ period, value }) => [period, money(value)])));
        }
        return out;
      }
    }
  }

  // ── assemble document ─────────────────────────────────────────────────────
  const content: object[] = [];

  content.push({ text: 'AI-генерирано, неофициално', fontSize: 8, color: INK_SOFT, margin: [0,0,0,16] as [number,number,number,number] });
  content.push({ text: report.title, style: 'h1' });
  if (report.lede) content.push({ text: report.lede, fontSize: 12, color: INK_SOFT, margin: [0,0,0,12] as [number,number,number,number] });
  if (report.scope) content.push({ text: `Обхват: ${report.scope}`, fontSize: 10, italics: true, color: INK_SOFT, margin: [0,0,0,20] as [number,number,number,number] });

  for (const block of report.blocks) {
    content.push(...blockToPdf(block), { text: '', margin: [0,0,0,6] as [number,number,number,number] });
  }

  if (report.methodology) {
    content.push({ text: 'Как е изчислено', style: 'h2' });
    content.push(...report.methodology.split('\n\n').filter(Boolean).map((p) => para(p)));
  }

  content.push({
    text: `Генерирано от СИГМА AI на ${new Date(report.generatedAt).toLocaleDateString('bg')}. Неофициално.`,
    fontSize: 8,
    color: INK_SOFT,
    italics: true,
    alignment: 'center',
    margin: [0, 20, 0, 0] as [number,number,number,number],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pdfMake as any).createPdf({
    content,
    styles: {
      h1: { fontSize: 22, bold: false, font: 'Roboto', color: INK, margin: [0, 0, 0, 12] },
      h2: { fontSize: 15, bold: true, color: INK, margin: [0, 16, 0, 8] },
      h3: { fontSize: 11, bold: true, color: INK_SOFT, margin: [0, 12, 0, 4] },
    },
    defaultStyle: { font: 'Roboto', fontSize: 11, color: INK, lineHeight: 1.4 },
    pageMargins: [40, 40, 40, 40] as [number,number,number,number],
    pageSize: 'A4',
  }).download(`${report.id}.pdf`);
}

// ── Page ──────────────────────────────────────────────────────────────────────

function PdfButton({ report }: { report: StoredReport }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function handleDownload() {
    setState('loading');
    try {
      await reportToPdf(report);
      setState('idle');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }

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
  const { report } = loaderData;

  return (
    <main id="main" className="report-page">
      <div className="report-top-bar">
        <div className="report-watermark" role="note" aria-label="Предупреждение">
          AI-генерирано, неофициално
        </div>
        <div className="report-top-bar__actions">
          <MarkdownButton report={report} />
          <DocxButton report={report} />
          <PdfButton report={report} />
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
