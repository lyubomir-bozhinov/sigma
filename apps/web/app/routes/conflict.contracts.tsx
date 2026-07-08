import { data } from 'react-router';
import { getLinkContracts, personIdFromSlug } from '@sigma/db';
import type { Route } from './+types/conflict.contracts';
import { publicCache } from '../lib/cache';
import { withDbRetry } from '../lib/retry';

// Resource route (loader-only): one published link's contracts, each flagged in/out the declared-stake
// window. Client-fetched by the expandable row on /conflicts. Keyed on the URL-safe officialSlug + ЕИК
// (+ ?f=1 for a family link) and reconstructed into the link_key server-side, so the raw '|'/':' key never
// hits the URL. Lives under /conflicts/ so the CONFLICTS_RATE_LIMITER already throttles enumeration.
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const personId = personIdFromSlug(params.slug ?? '');
  const eik = params.eik ?? '';
  if (!personId || !eik) throw new Response('Not Found', { status: 404 });
  const family = new URL(request.url).searchParams.get('f') === '1';
  const linkKey = family ? `${personId}|${eik}|family` : `${personId}|${eik}`;
  const contracts = await withDbRetry(() => getLinkContracts(context.cloudflare.env.DB, linkKey));
  // Only cache once there is data — an empty read just after a (re)ship should not be pinned for an hour
  // (mirrors the leaderboard loader). getLinkContracts returns [] for any non-surfaced/unknown key.
  return data(
    { linkKey, contracts },
    { headers: { 'Cache-Control': contracts.length ? publicCache(3600) : 'no-store' } },
  );
}
