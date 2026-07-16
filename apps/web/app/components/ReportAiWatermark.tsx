import { date } from '@sigma/shared';
import type { ResolvedReport } from '../lib/assistant/report-schema';

// The unattended-generation disclaimer (spec §7): an AI narrative is published without a human in the
// loop, so the watermark is the reader's warning + the provenance trail. Rendered ONLY for an
// ai-generated report; a pure-template fallback (no model prose) omits it. `asOf` is the data freshness
// the numbers were computed against; `model` is the LLM that wrote the narrative; `sources` deep-link
// the primary registry so „важни данни" can be checked at source.
export function ReportAiWatermark({
  report,
  asOf,
  model,
  sources,
}: {
  report: Pick<ResolvedReport, 'watermark'>;
  asOf?: string | null;
  model?: string | null;
  sources?: { label: string; href: string }[];
}) {
  if (report.watermark !== 'ai-generated') return null;
  return (
    <aside className="report-watermark" role="note" aria-label="Бележка за произход на текста">
      <p>
        <strong>Генерирано с изкуствен интелект.</strong> Свързващият текст е съставен автоматично и
        може да допуска грешки. Числата идват директно от заявки към данните. Проверявайте важни
        данни от първичен източник.
      </p>
      <p className="small muted">
        {asOf ? `Данни към ${date(asOf)}` : 'Данни към момента на генериране'}
        {model ? ` · Модел: ${model}` : ''}
        {sources && sources.length > 0 ? ' · Източници: ' : ''}
        {sources?.map((s, i) => (
          <span key={s.href}>
            {i > 0 ? ', ' : ''}
            <a href={s.href} target="_blank" rel="noopener noreferrer">
              {s.label}
            </a>
          </span>
        ))}
      </p>
    </aside>
  );
}
