import { money } from '@sigma/shared';

// The one net-new digest chart (plan Phase 3.3 / spec §3.4): a weekly vertical bar chart of daily
// spend, with lighter "ghost" bars behind for the SAME day of the previous week, so a reader sees this
// week against last without reading a decline into missing data. Server-rendered static SVG (no chart
// JS, like TrendChart/SankeyDiagram) so it works in the post, the social card and email. role="img" +
// aria-label, paired with a screen-reader table (WCAG AA — the site convention for every chart).

export interface DayValue {
  label: string; // day label, e.g. „Пн" or a date
  value: number; // EUR
}

const W = 760;
const H = 240;
const PAD_B = 24; // room for day labels
const PAD_T = 12;
const PLOT_H = H - PAD_B - PAD_T;

export function WeeklyGhostBars({
  current,
  previous,
  ariaLabel = 'Разход по дни за седмицата',
  caption = 'Разход по дни (тази седмица спрямо миналата)',
}: {
  current: DayValue[];
  previous?: DayValue[];
  ariaLabel?: string;
  caption?: string;
}) {
  if (current.length === 0) return null;
  const n = current.length;
  // INVARIANT (#81 review, note 3): `current` and `previous` are paired by ARRAY INDEX, not by day
  // label. This is correct only because both are the same fixed 7 Mon..Sun slots (getWeeklyDailySpend
  // zero-fills each week to Mon..Sun before they reach here). Do not reuse this component with two
  // series whose indices are not day-of-week aligned — pair by label first if you do.
  const prev = previous ?? [];
  const max = Math.max(1, ...current.map((d) => d.value), ...prev.map((d) => d.value));
  const slot = W / n;
  const ghostW = slot * 0.62; // wider, sits behind
  const barW = slot * 0.4; // narrower, sits in front, centred in the slot
  const baseline = H - PAD_B;
  const barHeight = (v: number) => (Math.max(0, v) / max) * PLOT_H;

  return (
    <>
      {/* Visible key so a reader knows which bars are this week vs the prior-week ghosts. aria-hidden —
          the sr-only table below already labels both series for assistive tech. The ghost item appears
          only when there IS a prior-week series to compare against. */}
      <ul className="gb-legend" aria-hidden="true">
        <li className="gb-legend__item">
          <span className="gb-legend__swatch gb-legend__swatch--current" />
          Тази седмица
        </li>
        {prev.length > 0 && (
          <li className="gb-legend__item">
            <span className="gb-legend__swatch gb-legend__swatch--ghost" />
            Миналата седмица
          </li>
        )}
      </ul>
      <svg className="ghost-bars-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <line x1={0} y1={baseline} x2={W} y2={baseline} className="grid" />
        {current.map((d, i) => {
          const cx = i * slot + slot / 2;
          const prevVal = prev[i]?.value ?? null;
          const curH = barHeight(d.value);
          return (
            <g key={i}>
              {prevVal != null && (
                <rect
                  className="gb-ghost"
                  x={cx - ghostW / 2}
                  y={baseline - barHeight(prevVal)}
                  width={ghostW}
                  height={barHeight(prevVal)}
                  fill="currentColor"
                  fillOpacity={0.18}
                />
              )}
              <rect
                className="gb-bar"
                x={cx - barW / 2}
                y={baseline - curH}
                width={barW}
                height={curH}
                fill="currentColor"
                fillOpacity={0.72}
              />
              <text x={cx} y={H - 7} textAnchor="middle" className="label">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Ден</th>
            <th scope="col">Тази седмица (€)</th>
            <th scope="col">Миналата седмица (€)</th>
          </tr>
        </thead>
        <tbody>
          {/* Drive off the LONGER series so a prior week with a day the current week lacks isn't dropped
              from the accessible table (mirrors the exporters). In the digest both are 7 aligned slots. */}
          {Array.from({ length: Math.max(current.length, prev.length) }, (_, i) => (
            <tr key={i}>
              <td>{current[i]?.label ?? prev[i]?.label ?? ''}</td>
              <td>{current[i] ? money(current[i]!.value) : '—'}</td>
              <td>{prev[i] ? money(prev[i]!.value) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
