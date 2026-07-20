import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import WeeksIndex from './weeks._index';

// loaderData is the client-safe shape the loader returns: the R2-derived week index.
const loaderData = {
  weeks: [
    { iso: '2026-W25', totalEur: 3_656_000 },
    { iso: '2026-W24', totalEur: null },
  ],
};

function render(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(WeeksIndex, { loaderData } as never)),
  );
}

describe('/weeks archive', () => {
  const html = render();

  it('links each week to its digest page', () => {
    expect(html).toContain('href="/weeks/2026-W25"');
    expect(html).toContain('href="/weeks/2026-W24"');
  });

  it('makes the whole row clickable via the row-link stretched-link pattern', () => {
    // Every data row carries `row-link`; the CSS stretches the title-cell anchor across the row.
    expect(html).toContain('class="row-link"');
    // Two data rows → two row-link rows (header row is not one).
    expect(html.match(/class="row-link"/g)?.length).toBe(2);
  });

  it('shows the total, and an em-dash when a week has no total', () => {
    expect(html).toContain('—'); // 2026-W24 has null totalEur
  });
});
