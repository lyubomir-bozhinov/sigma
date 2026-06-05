import { streamContractSitemap } from '@sigma/db';
import type { Route } from './+types/sitemap-contracts';
import { withDataSource } from '../lib/dataSource';

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('p') ?? '1') || 1);
  return withDataSource(streamContractSitemap(context.cloudflare.env.DB, url.origin, page));
}
