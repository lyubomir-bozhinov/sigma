import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReportBlockRenderer } from './ReportBlockRenderer';
import type { ResolvedBlock } from '~/lib/assistant/report-schema';

afterEach(() => {
  cleanup();
});

// Shared-surface regression: MarkdownBlock renders BOTH report text/callout blocks and dock prose.
// Extending it with lists/hr/tables must (a) newly structure report prose that uses those forms, and
// (b) leave plain report prose unchanged.
describe('ReportBlockRenderer — MarkdownBlock shared-surface', () => {
  const blocks = (...b: ResolvedBlock[]): ResolvedBlock[] => b;

  it('renders a list inside a report callout (intended additive change)', () => {
    const { container } = render(
      <ReportBlockRenderer
        blocks={blocks({ type: 'callout', title: 'Забележка', md: '- едно\n- две' })}
      />,
    );

    const items = container.querySelectorAll('.report-block--callout ul > li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('едно');
  });

  it('leaves a plain-prose text block unchanged (no regression)', () => {
    const { container } = render(
      <ReportBlockRenderer
        blocks={blocks({ type: 'text', md: 'Обикновен абзац без форматиране.' })}
      />,
    );

    const paras = container.querySelectorAll('.report-block--text p');
    expect(paras).toHaveLength(1);
    expect(paras[0].textContent).toBe('Обикновен абзац без форматиране.');
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});
