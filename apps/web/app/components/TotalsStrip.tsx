// Bordered metric strip (ink hairlines, serif numerics). Each cell is a big number + a mono caps label.
export interface Total {
  num: string;
  label: string;
}

export function TotalsStrip({ totals, label }: { totals: Total[]; label?: string }) {
  return (
    <div className="totals-wrap">
      {label && <p className="totals-section-label">{label}</p>}
      <dl className="totals" aria-label={label}>
        {totals.map((t) => (
          <div className="cell" key={t.label}>
            <span className="label">{t.label}</span>
            <span className="num">{t.num}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}
