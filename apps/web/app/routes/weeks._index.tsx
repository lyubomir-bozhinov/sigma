import { Link } from 'react-router';
import { money } from '@sigma/shared';
import type { Route } from './+types/weeks._index';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type Column } from '../components/DataTable';
import { publicCache } from '../lib/cache';
import { seoMeta } from '../lib/meta';
import { listStoredWeeks, type WeekIndexEntry } from '../lib/weeks';

export function meta({ matches }: Route.MetaArgs) {
  return seoMeta({
    matches,
    path: '/weeks',
    title: 'Седмицата в пари — архив',
    description:
      'Архив на автоматизираните седмични обзори на обществените поръчки. Всяка седмица с публикувани данни има свой обзор.',
  });
}

export function headers() {
  return { 'Cache-Control': publicCache(1800) };
}

export async function loader({ context }: Route.LoaderArgs) {
  // Only weeks WITH an artifact appear (spec §11). No D1 at serve time — the list comes from R2.
  // Before REPORTS is provisioned the archive is simply empty.
  const bucket = context.cloudflare.env.REPORTS;
  const weeks = bucket ? await listStoredWeeks(bucket) : [];
  return { weeks };
}

// A minimal inline sparkline of weekly totals (chronological, oldest → newest). Rendered only when at
// least two weeks carry a total. role="img" + aria-label; the table below is the accessible data.
function Sparkline({ weeks }: { weeks: WeekIndexEntry[] }) {
  const series = weeks
    .filter((w): w is WeekIndexEntry & { totalEur: number } => w.totalEur != null)
    .slice()
    .reverse();
  if (series.length < 2) return null;
  const W = 480;
  const H = 48;
  const max = Math.max(1, ...series.map((s) => s.totalEur));
  const n = series.length;
  const pts = series
    .map((s, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - (s.totalEur / max) * H).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      className="weeks-sparkline"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Обща стойност на договорите по седмици"
    >
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

export default function WeeksIndex({ loaderData }: Route.ComponentProps) {
  const { weeks } = loaderData;
  const columns: Column<WeekIndexEntry>[] = [
    {
      key: 'iso',
      header: 'Седмица',
      isTitle: true,
      cell: (w) => <Link to={`/weeks/${w.iso}`}>{w.iso}</Link>,
    },
    {
      key: 'total',
      header: 'Обща стойност (€)',
      align: 'money',
      cell: (w) => (w.totalEur != null ? money(w.totalEur) : '—'),
    },
  ];
  return (
    <main id="main">
      <PageHeader
        kicker="Седмицата в пари"
        title="Седмични обзори"
        lede="Автоматизиран обзор на обществените поръчки за всяка изминала седмица. Числата идват директно от данните; свързващият текст е генериран автоматично."
      />
      {weeks.length === 0 ? (
        <p className="small muted">Все още няма публикувани седмични обзори.</p>
      ) : (
        <>
          <Sparkline weeks={weeks} />
          <DataTable
            columns={columns}
            rows={weeks}
            getKey={(w) => w.iso}
            caption="Седмични обзори"
          />
        </>
      )}
    </main>
  );
}
