import type { ReactNode } from 'react';

export interface Fact {
  term: ReactNode;
  value: ReactNode;
  sub?: ReactNode; // secondary line under the value
}

// Key-facts panel: ink top rule, hairline rows, mono labels (the mock's <dl class="facts">). Falsy rows
// are dropped, so `cond && { … }` guards work — partial-coverage fields show only when present (never „N/A").
type MaybeFact = Fact | string | number | boolean | null | undefined;

export function FactsList({ rows, label }: { rows: MaybeFact[]; label?: string }) {
  const facts = rows.filter((r): r is Fact => typeof r === 'object' && r !== null);
  return (
    <dl className="facts" aria-label={label}>
      {facts.map((f) => (
        <div className="row" key={String(f.term)}>
          <dt>{f.term}</dt>
          <dd>
            {f.value}
            {f.sub != null && <span className="sub">{f.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
