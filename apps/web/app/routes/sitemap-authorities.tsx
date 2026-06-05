import { streamAuthoritySitemap } from '@sigma/db';
import type { Route } from './+types/sitemap-authorities';
import { withDataSource } from '../lib/dataSource';

export function loader({ request, context }: Route.LoaderArgs) {
  return withDataSource(
    streamAuthoritySitemap(context.cloudflare.env.DB, new URL(request.url).origin),
  );
}
