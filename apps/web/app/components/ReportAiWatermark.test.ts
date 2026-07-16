import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportAiWatermark } from './ReportAiWatermark';

describe('ReportAiWatermark', () => {
  it('renders the AI disclaimer for an ai-generated report', () => {
    const html = renderToStaticMarkup(
      createElement(ReportAiWatermark, { report: { watermark: 'ai-generated' } }),
    );
    expect(html).toContain('Генерирано с изкуствен интелект');
    expect(html).toContain('Проверявайте важни данни');
  });

  it('shows freshness (as formatted date) and model', () => {
    const html = renderToStaticMarkup(
      createElement(ReportAiWatermark, {
        report: { watermark: 'ai-generated' },
        asOf: '2026-06-18',
        model: 'bggpt-gemma-3-27b-fp8',
      }),
    );
    expect(html).toContain('Данни към 18.06.2026');
    expect(html).toContain('bggpt-gemma-3-27b-fp8');
  });

  it('renders source links when provided', () => {
    const html = renderToStaticMarkup(
      createElement(ReportAiWatermark, {
        report: { watermark: 'ai-generated' },
        sources: [{ label: 'ЦАИС ЕОП', href: 'https://app.eop.bg' }],
      }),
    );
    expect(html).toContain('href="https://app.eop.bg"');
    expect(html).toContain('ЦАИС ЕОП');
  });

  it('renders nothing when the report is not ai-generated', () => {
    const html = renderToStaticMarkup(
      // A pure-template fallback carries no ai-generated watermark.
      createElement(ReportAiWatermark, {
        report: { watermark: 'none' as unknown as 'ai-generated' },
      }),
    );
    expect(html).toBe('');
  });
});
