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
});
