import { data } from 'react-router';
import type { Route } from './+types/weeks.$iso';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PageHeader } from '../components/PageHeader';
import { ReportBlockRenderer } from '../components/ReportBlockRenderer';
import { ReportAiWatermark } from '../components/ReportAiWatermark';
import { DigestFooter } from '../components/DigestFooter';
import { publicCache } from '../lib/cache';
import { seoMeta } from '../lib/meta';
import { isValidIsoWeek, isoWeekKey, readStoredReport } from '../lib/assistant/stored-report';

const IMMUTABLE = 'public, s-maxage=31536000, immutable';
const EOP_SOURCE = { label: 'ЦАИС ЕОП', href: 'https://app.eop.bg' };

// The freshness string is stored as e.g. "D1: 2026-06-18"; pull the ISO date so the watermark/footer
// can format it. Null when no date is embedded (watermark falls back to a generic note).
function freshnessAsOf(freshness: string): string | null {
  return /(\d{4}-\d{2}-\d{2})/.exec(freshness)?.[1] ?? null;
}

export function meta({ matches, data: d }: Route.MetaArgs) {
  const title = d ? `${d.stored.report.title} — Седмицата в пари` : 'Седмичен обзор';
  return seoMeta({
    matches,
    path: d ? `/weeks/${d.iso}` : '/weeks',
    title,
    description:
      'Автоматизиран седмичен обзор на обществените поръчки: колко е законтрактувано, най-големите договори и възложители, конкуренция — с числа директно от данните.',
  });
}

// Settled weeks are immutable; a re-issued (corrected, late-data) week caches shorter so the
// correction propagates. The loader sets Cache-Control per artifact; pass it through here.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? publicCache(3600) };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const iso = params.iso;
  if (!iso || !isValidIsoWeek(iso)) throw new Response('Not Found', { status: 404 });
  // Serve path reads ONLY the immutable R2 artifact — no D1, no LLM (spec §6, §11). A week without an
  // artifact (no data, or not yet settled) is a 404.
  const stored = await readStoredReport(context.cloudflare.env.REPORTS, isoWeekKey(iso));
  if (!stored) throw new Response('Not Found', { status: 404 });
  const cache = stored.refreshedAt ? publicCache(3600) : IMMUTABLE;
  return data({ iso, stored }, { headers: { 'Cache-Control': cache } });
}

export default function WeekDigest({ loaderData }: Route.ComponentProps) {
  const { iso, stored } = loaderData;
  const { report, provenance, model, refreshedAt, createdAt } = stored;
  const asOf = freshnessAsOf(provenance.freshness);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Начало', to: '/' },
          { label: 'Седмични обзори', to: '/weeks' },
          { label: iso },
        ]}
      />
      <main id="main">
        <PageHeader kicker="Седмицата в пари" title={report.title} />
        <ReportBlockRenderer report={report} />
        <ReportAiWatermark report={report} asOf={asOf} model={model} sources={[EOP_SOURCE]} />
        <DigestFooter asOf={asOf} generatedAt={createdAt} refreshedAt={refreshedAt} />
      </main>
    </>
  );
}
