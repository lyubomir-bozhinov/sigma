import { readStoredReport } from '@sigma/report';
import type { Route } from './+types/weeks.$iso';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PageHeader } from '../components/PageHeader';
import { ReportBlockRenderer } from '../components/ReportBlockRenderer';
import { ReportAiWatermark } from '../components/ReportAiWatermark';
import { ReportToolbar } from '../components/ReportToolbar';
import { DigestFooter } from '../components/DigestFooter';
import { DigestExplore } from '../components/DigestExplore';
import { publicCache } from '../lib/cache';
import { seoMeta } from '../lib/meta';
import { isValidIsoWeek, isoWeekKey } from '../lib/weeks';

// A settled week's artifact is effectively static, BUT the producer re-issues a corrected digest in
// place at the SAME key `weeks/{ISO}.json` (status „коригирано", spec §10.4). `immutable` would tell the
// edge never to revalidate, so a correction (or a redeploy's new HTML) would not reach readers for up to
// a year (#81 review M1). A LONG `s-maxage` is also wrong for the same reason: on a workers.dev preview
// the edge served day-old HTML across a redeploy, mismatching the freshly-built client bundle. Keep the
// fresh window SHORT so corrections + deploys propagate within minutes; `stale-while-revalidate` still
// serves instantly from the edge and refreshes in the background, so there's no latency cost.
const DIGEST_CACHE = publicCache(300, 86_400); // s-maxage 5m, stale-while-revalidate 1d

export function meta({ matches, data: d }: Route.MetaArgs) {
  const title = d ? `${d.report.title} — Седмицата в пари` : 'Седмичен обзор';
  return seoMeta({
    matches,
    path: d ? `/weeks/${d.iso}` : '/weeks',
    title,
    description:
      'Автоматизиран седмичен обзор на обществените поръчки: колко е законтрактувано, най-големите договори и възложители, конкуренция — с числа директно от данните.',
  });
}

export function headers() {
  return { 'Cache-Control': DIGEST_CACHE };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const iso = params.iso;
  if (!iso || !isValidIsoWeek(iso)) throw new Response('Not Found', { status: 404 });
  // Serve path reads ONLY the immutable R2 artifact — no D1, no LLM (spec §6, §11). A week without an
  // artifact (no data, not yet settled, or REPORTS not provisioned) is a 404.
  const bucket = context.cloudflare.env.REPORTS;
  if (!bucket) throw new Response('Not Found', { status: 404 });
  const stored = await readStoredReport(bucket, isoWeekKey(iso));
  if (!stored) throw new Response('Not Found', { status: 404 });
  // Strip provenance (SQL, model, prompt version) before it reaches the client hydration JSON — mirror
  // the /reports/:id posture. Only the non-sensitive data-freshness date is surfaced (footer).
  const asOf = stored.provenance.freshness[0]?.asOf ?? null;
  return { iso, report: stored.report, asOf, generatedAt: stored.createdAt };
}

export default function WeekDigest({ loaderData }: Route.ComponentProps) {
  const { iso, report, asOf, generatedAt } = loaderData;
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
        <ReportAiWatermark />
        <ReportToolbar report={report} />
        <ReportBlockRenderer blocks={report.blocks} />
        <DigestExplore iso={iso} />
        <DigestFooter asOf={asOf} generatedAt={generatedAt} />
      </main>
    </>
  );
}
