import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeeklyGhostBars, type DayValue } from './WeeklyGhostBars';

const week: DayValue[] = [
  { label: 'Пн', value: 1000 },
  { label: 'Вт', value: 2000 },
  { label: 'Ср', value: 0 },
];
const prevWeek: DayValue[] = [
  { label: 'Пн', value: 800 },
  { label: 'Вт', value: 1500 },
  { label: 'Ср', value: 500 },
];

function render(props: Parameters<typeof WeeklyGhostBars>[0]): string {
  return renderToStaticMarkup(createElement(WeeklyGhostBars, props));
}

describe('WeeklyGhostBars', () => {
  it('renders an accessible SVG with an aria-label', () => {
    const html = render({ current: week });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Разход по дни за седмицата"');
  });

  it('draws one solid bar per current day', () => {
    const html = render({ current: week });
    expect((html.match(/class="gb-bar"/g) ?? []).length).toBe(3);
  });

  it('draws ghost bars only where a previous-week value exists', () => {
    const html = render({ current: week, previous: prevWeek });
    expect((html.match(/class="gb-ghost"/g) ?? []).length).toBe(3);
  });

  it('omits ghost bars entirely when no previous week is given', () => {
    const html = render({ current: week });
    expect(html).not.toContain('gb-ghost');
  });

  it('pairs the chart with a screen-reader table listing both series', () => {
    const html = render({ current: week, previous: prevWeek });
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('Тази седмица (€)');
    expect(html).toContain('Миналата седмица (€)');
  });

  it('shows an em-dash for a day with no previous-week value', () => {
    const html = render({ current: week, previous: [prevWeek[0]] });
    expect(html).toContain('<td>—</td>');
  });

  it('renders nothing for an empty week', () => {
    const html = render({ current: [] });
    expect(html).toBe('');
  });
});
