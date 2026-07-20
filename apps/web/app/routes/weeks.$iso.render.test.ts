import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import WeekDigest from './weeks.$iso';

// loaderData is the client-safe shape the loader returns (provenance already stripped).
const loaderData = {
  iso: '2026-W25',
  asOf: '2026-06-21',
  generatedAt: '2026-06-22T07:00:00.000Z',
  report: {
    title: 'Седмицата в пари: 15–21 юни 2026',
    question: 'Какво се случи през седмицата?',
    watermark: 'ai-generated' as const,
    blocks: [
      { type: 'text' as const, md: 'Обобщение за седмицата.' },
      {
        type: 'table' as const,
        columns: [
          {
            key: 'authority',
            header: 'Възложител',
            format: 'text' as const,
            link: { kind: 'authority' as const, idCol: 'authority_id' },
          },
        ],
        rows: [{ cells: ['Министерство на финансите'], links: ['auth:000695089'] }],
      },
      {
        type: 'weekbars' as const,
        current: [
          { label: 'Пн', value: 1000 },
          { label: 'Вт', value: 0 },
        ],
        previous: [
          { label: 'Пн', value: 800 },
          { label: 'Вт', value: 200 },
        ],
      },
    ],
  },
};

function render(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(WeekDigest, { loaderData } as never)),
  );
}

describe('/weeks/:iso page (golden)', () => {
  const html = render();

  it('renders the report title as the page heading', () => {
    expect(html).toContain('Седмицата в пари: 15–21 юни 2026');
  });

  it('shows the static AI watermark', () => {
    expect(html).toContain('Генерирано с изкуствен интелект');
  });

  it('deep-links entity cells to their canonical pages', () => {
    expect(html).toContain('href="/authorities/000695089"');
    expect(html).toContain('Министерство на финансите');
  });

  it('renders the provenance footer with a link back to the archive', () => {
    expect(html).toContain('генерирано автоматично');
    expect(html).toContain('href="/weeks"');
  });

  it('renders the weekly ghost-bar chart (§3.4)', () => {
    expect(html).toContain('ghost-bars-svg');
    expect(html).toContain('gb-ghost'); // the prior-week ghost series
  });

  it('renders the ghost-bar chart key (this week vs last week)', () => {
    expect(html).toContain('gb-legend');
    expect(html).toContain('Тази седмица');
    expect(html).toContain('Миналата седмица'); // shown because the fixture has a prior-week series
  });

  it('renders the „Легенда" section describing only the blocks present', () => {
    expect(html).toContain('digest-legend');
    expect(html).toContain('Легенда');
    expect(html).toContain('Дневен разход'); // weekbars block present
    expect(html).toContain('Топ договори'); // table block present
    // The fixture has no totals/bar blocks, so those legend rows must NOT appear.
    expect(html).not.toContain('Конкуренция');
    expect(html).not.toContain('Сектори');
  });

  it('renders the code-generated „Разгледай сам" deep-links (§3.10)', () => {
    expect(html).toContain('Разгледай сам');
    expect(html).toContain('href="/flows"');
    expect(html).toContain('href="/companies"');
  });

  it('renders the export toolbar (Markdown / Word / PDF) in the standard page column', () => {
    // Full-width site `main` column (like /contracts), NOT the narrow /reports 760px `report-page`.
    expect(html).not.toContain('class="report-page"');
    expect(html).toContain('report-toolbar');
    expect(html).toContain('Принтирай / PDF'); // print → PDF
    expect(html).toContain('Word'); // .docx download
    expect(html).toContain('Markdown'); // .md download
  });
});
