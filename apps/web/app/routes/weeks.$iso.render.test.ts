import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import fixtureData from '../lib/assistant/fixtures/r2-report-object.fixture.json';
import type { StoredReport } from '../lib/assistant/stored-report';
import WeekDigest from './weeks.$iso';

const stored = fixtureData as unknown as StoredReport;

function renderPage(loaderData: { iso: string; stored: StoredReport }): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(WeekDigest, { loaderData } as never)),
  );
}

describe('/weeks/:iso page (golden)', () => {
  const html = renderPage({ iso: '2026-W25', stored });

  it('renders the report title as the page heading', () => {
    expect(html).toContain('Най-големи възложители по похарчено');
  });

  it('shows the AI watermark with freshness derived from provenance', () => {
    expect(html).toContain('Генерирано с изкуствен интелект');
    expect(html).toContain('Данни към 18.06.2026');
  });

  it('deep-links entity cells to their canonical pages', () => {
    expect(html).toContain('href="/authorities/000695089"');
    expect(html).toContain('Министерство на финансите');
  });

  it('renders the provenance footer and the week breadcrumb', () => {
    expect(html).toContain('генерирано автоматично');
    expect(html).toContain('2026-W25');
  });
});

describe('/weeks/:iso page — AI-free fallback', () => {
  // A fallback digest carries only value blocks (no model narrative). It must still render cleanly.
  const fallback: StoredReport = {
    ...stored,
    report: {
      ...stored.report,
      blocks: stored.report.blocks.filter((b) => b.type === 'totals' || b.type === 'table'),
    },
  };
  const html = renderPage({ iso: '2026-W25', stored: fallback });

  it('renders the numbers-only report without the narrative prose', () => {
    expect(html).toContain('Похарчено (топ 3)');
    expect(html).not.toContain('Първите няколко възложители');
  });

  it('still renders the provenance footer', () => {
    expect(html).toContain('генерирано автоматично');
  });
});
