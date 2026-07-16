import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ResolvedBlock, ResolvedReport } from '../lib/assistant/report-schema';
import { ReportBlockRenderer } from './ReportBlockRenderer';

function render(blocks: ResolvedBlock[]): string {
  const report: ResolvedReport = {
    title: 'Заглавие',
    question: 'Въпрос',
    watermark: 'ai-generated',
    blocks,
  };
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ReportBlockRenderer, { report })),
  );
}

describe('ReportBlockRenderer — text', () => {
  it('renders each double-newline paragraph as its own <p>', () => {
    const html = render([{ type: 'text', md: 'Абзац едно\n\nАбзац две' }]);
    expect(html).toContain('<p>Абзац едно</p>');
    expect(html).toContain('<p>Абзац две</p>');
  });

  it('escapes markup in prose (no raw HTML passthrough)', () => {
    const html = render([{ type: 'text', md: '<b>получер</b> текст' }]);
    expect(html).toContain('&lt;b&gt;получер&lt;/b&gt;');
    expect(html).not.toContain('<b>получер</b>');
  });
});

describe('ReportBlockRenderer — totals', () => {
  it('formats a number value via the site formatter', () => {
    const html = render([
      { type: 'totals', items: [{ label: 'Брой възложители', value: 3, format: 'number' }] },
    ]);
    expect(html).toContain('Брой възложители');
    expect(html).toContain('<span class="num">3</span>');
  });
});

describe('ReportBlockRenderer — table', () => {
  const tableBlock: ResolvedBlock = {
    type: 'table',
    columns: [
      {
        key: 'authority',
        header: 'Възложител',
        format: 'text',
        link: { kind: 'authority', idCol: 'authority_id' },
      },
      { key: 'spent', header: 'Похарчено', align: 'right', format: 'money' },
    ],
    rows: [{ cells: ['Община Пловдив', 890000], links: ['auth:000471504', null] }],
    truncated: false,
  };

  it('links an entity cell to the canonical href via entityHref', () => {
    const html = render([tableBlock]);
    expect(html).toContain('href="/authorities/000471504"');
    expect(html).toContain('Община Пловдив');
  });

  it('formats a money column through the magnitude-tier formatter', () => {
    const html = render([tableBlock]);
    expect(html).toContain('890');
    expect(html).toContain('хил');
  });

  it('surfaces a truncation note when the backing result was capped', () => {
    const html = render([{ ...tableBlock, truncated: true }]);
    expect(html).toContain('съкратени');
  });
});

describe('ReportBlockRenderer — bar', () => {
  const barBlock: ResolvedBlock = {
    type: 'bar',
    points: [{ label: 'Понеделник', value: 640 }],
    truncated: false,
  };

  it('renders a labelled bar visual', () => {
    const html = render([barBlock]);
    expect(html).toContain('report-bars');
    expect(html).toContain('Понеделник');
  });

  it('pairs the bar visual with a screen-reader table (WCAG AA)', () => {
    const html = render([barBlock]);
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('role="img"');
  });
});

describe('ReportBlockRenderer — flows', () => {
  it('renders a from → to edge list', () => {
    const html = render([
      {
        type: 'flows',
        edges: [{ from: 'МФ', to: 'Фирма ЕООД', valueEur: 1234 }],
        truncated: false,
      },
    ]);
    expect(html).toContain('МФ');
    expect(html).toContain('Фирма ЕООД');
    expect(html).toContain('От');
  });
});

describe('ReportBlockRenderer — timeseries', () => {
  it('renders a TrendChart SVG plus a screen-reader table', () => {
    const html = render([
      {
        type: 'timeseries',
        points: [
          { period: '2026-01', value: 100 },
          { period: '2026-02', value: 200 },
        ],
        truncated: false,
      },
    ]);
    expect(html).toContain('trend-svg');
    expect(html).toContain('2026-01');
  });
});

describe('ReportBlockRenderer — facts + callout', () => {
  it('renders facts term and value', () => {
    const html = render([{ type: 'facts', items: [{ term: 'Свежест', value: '2026-06-18' }] }]);
    expect(html).toContain('Свежест');
    expect(html).toContain('2026-06-18');
  });

  it('renders a callout title and body', () => {
    const html = render([{ type: 'callout', title: 'Източник', md: 'Данни от АОП.' }]);
    expect(html).toContain('Източник');
    expect(html).toContain('Данни от АОП.');
  });
});

describe('ReportBlockRenderer — layout', () => {
  it('wraps each block in a report-block container', () => {
    const html = render([
      { type: 'text', md: 'едно' },
      { type: 'text', md: 'две' },
    ]);
    expect((html.match(/class="report-block"/g) ?? []).length).toBe(2);
  });
});
