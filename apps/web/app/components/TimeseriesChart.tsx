// Hand-built CSS/SVG timeseries chart — no chart library, matching the house
// style of StackedBar and SankeyDiagram.  Single-series renders an area (line
// + tinted fill); multi-series renders lines only.

const PAD = { t: 20, r: 16, b: 44, l: 68 };
const VB_W = 600;
const VB_H = 260;
const PW = VB_W - PAD.l - PAD.r; // 516 — plot width
const PH = VB_H - PAD.t - PAD.b; // 196 — plot height

// Palette: accent-red for single series; distinct colours for multi.
const PALETTE = [
  'var(--accent)',
  'oklch(50% 0.16 255)',
  'oklch(45% 0.12 165)',
  'oklch(52% 0.15 320)',
];
const FILL_OPACITY = 0.12;

export interface TimeseriesPoint {
  period: string;
  value: number;
}

export interface TimeseriesSeries {
  label: string;
  points: TimeseriesPoint[];
}

export interface TimeseriesChartProps {
  /** Single-series convenience shorthand */
  points?: TimeseriesPoint[];
  /** Multi-series — overrides `points` when present */
  series?: TimeseriesSeries[];
  label?: string;
  unit?: string; // prefix for y-axis labels, e.g. '€'
}

function niceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.ceil(raw / mag) * mag;
  const top = Math.ceil(max / step) * step;
  const result: number[] = [];
  for (let v = 0; v <= top + step * 0.01; v += step) result.push(Math.round(v));
  return result;
}

function compact(v: number, unit = ''): string {
  if (v === 0) return '0';
  const prefix = unit;
  if (v >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}М`;
  if (v >= 1_000) return `${prefix}${Math.round(v / 1_000)}К`;
  return `${prefix}${v}`;
}

interface PlotSeries {
  label: string;
  points: TimeseriesPoint[];
  color: string;
}

function buildLinePath(xs: number[], ys: number[], pts: TimeseriesPoint[]): string {
  return pts.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
}

function buildAreaPath(linePath: string, xs: number[], baseline: number): string {
  const n = xs.length;
  return (
    linePath +
    ` L${xs[n - 1].toFixed(1)},${baseline.toFixed(1)}` +
    ` L${xs[0].toFixed(1)},${baseline.toFixed(1)} Z`
  );
}

export function TimeseriesChart({ points, series, label, unit = '' }: TimeseriesChartProps) {
  const plots: PlotSeries[] = series
    ? series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }))
    : points
      ? [{ label: label ?? '', points, color: PALETTE[0] }]
      : [];

  if (plots.length === 0 || plots.every((s) => s.points.length === 0)) return null;

  // Collect all periods (union across series, preserving order from first series).
  const periods = plots[0].points.map((p) => p.period);
  const n = periods.length;
  if (n === 0) return null;

  // Y scale — max across all series, rounded up to nice tick ceiling.
  const allValues = plots.flatMap((s) => s.points.map((p) => p.value));
  const maxV = Math.max(...allValues);
  const ticks = niceTicks(maxV);
  const topTick = ticks[ticks.length - 1];

  // Coordinate mappers
  const xOf = (i: number) => PAD.l + (n === 1 ? PW / 2 : (i / (n - 1)) * PW);
  const yOf = (v: number) => PAD.t + PH - (v / topTick) * PH;
  const baseline = PAD.t + PH;
  const isSingle = plots.length === 1;

  // X-label density: show every label when ≤12, else every other (≤24), else every third.
  const step = n <= 12 ? 1 : n <= 24 ? 2 : 3;

  const chartLabel = label ?? (plots[0].label || 'Времеви ред');

  return (
    <figure className="timeseries-wrap" aria-label={chartLabel}>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="timeseries-svg"
        role="img"
        aria-label={chartLabel}
      >
        <title>{chartLabel}</title>

        {/* Y grid lines + labels */}
        {ticks.map((t) => {
          const y = yOf(t);
          return (
            <g key={t}>
              <line
                x1={PAD.l}
                y1={y}
                x2={PAD.l + PW}
                y2={y}
                className={t === 0 ? 'ts-axis-line' : 'ts-grid-line'}
              />
              <text x={PAD.l - 6} y={y} dominantBaseline="middle" textAnchor="end" className="ts-label">
                {compact(t, unit)}
              </text>
            </g>
          );
        })}

        {/* X period labels */}
        {periods.map((period, i) =>
          i % step === 0 ? (
            <text
              key={period}
              x={xOf(i)}
              y={baseline + 14}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="ts-label"
            >
              {period}
            </text>
          ) : null,
        )}

        {/* Series */}
        {plots.map((s, si) => {
          const xs = s.points.map((_, i) => xOf(i));
          const ys = s.points.map((p) => yOf(p.value));
          const linePath = buildLinePath(xs, ys, s.points);
          return (
            <g key={si}>
              {isSingle && (
                <path
                  d={buildAreaPath(linePath, xs, baseline)}
                  fill={s.color}
                  fillOpacity={FILL_OPACITY}
                  stroke="none"
                />
              )}
              <path d={linePath} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* Dots — only when few points to avoid clutter */}
              {n <= 12 &&
                s.points.map((p, i) => (
                  <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r="3" fill={s.color}>
                    <title>{`${p.period}: ${compact(p.value, unit)}`}</title>
                  </circle>
                ))}
            </g>
          );
        })}

        {/* Multi-series legend */}
        {!isSingle && (
          <g transform={`translate(${PAD.l},${VB_H - 12})`}>
            {plots.map((s, i) => (
              <g key={i} transform={`translate(${i * 120},0)`}>
                <line x1={0} y1={0} x2={16} y2={0} stroke={s.color} strokeWidth="2" />
                <text x={20} y={0} dominantBaseline="middle" className="ts-legend">
                  {s.label}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </figure>
  );
}
