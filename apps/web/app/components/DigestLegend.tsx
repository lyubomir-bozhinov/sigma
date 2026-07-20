import type { ResolvedBlock } from '~/lib/assistant-contract/report';

// „Легенда" — a compact key explaining what each part of the weekly digest shows. Built from the blocks
// ACTUALLY present: the digest's blocks are conditional (e.g. the competition bar only appears when the
// single-bid sample cleared the reporting floor; the top-contracts table only when there are contracts),
// so the legend never describes a section that isn't on the page. The two `bar` blocks are told apart by
// format — sectors are money, competition is a count — matching how apps/etl emits them.
export function DigestLegend({ blocks }: { blocks: ResolvedBlock[] }) {
  const has = (fn: (b: ResolvedBlock) => boolean) => blocks.some(fn);
  const items: { term: string; desc: string }[] = [];

  if (has((b) => b.type === 'totals')) {
    items.push({ term: 'Показатели', desc: 'обобщени числа за седмицата' });
  }
  if (has((b) => b.type === 'weekbars')) {
    items.push({
      term: 'Дневен разход',
      desc: 'плътните стълбове са тази седмица, бледите — същия ден миналата седмица',
    });
  }
  if (has((b) => b.type === 'bar' && b.format === 'money')) {
    items.push({ term: 'Сектори', desc: 'подписана стойност по CPV раздели' });
  }
  if (has((b) => b.type === 'bar' && b.format === 'number')) {
    items.push({ term: 'Конкуренция', desc: 'брой поръчки с една срещу няколко оферти' });
  }
  if (has((b) => b.type === 'table')) {
    items.push({
      term: 'Топ договори',
      desc: 'най-големите поръчки с връзки към възложителя и изпълнителя',
    });
  }

  if (items.length === 0) return null;

  return (
    <section className="digest-legend" aria-label="Легенда">
      <h2>Легенда</h2>
      <dl className="digest-legend-list">
        {items.map((it) => (
          <div key={it.term} className="digest-legend-item">
            <dt>{it.term}</dt>
            <dd>{it.desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
