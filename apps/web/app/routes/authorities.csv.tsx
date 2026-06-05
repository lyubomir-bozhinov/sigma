import { streamAuthoritiesCsv, type AuthoritySort } from '@sigma/db';
import type { Route } from './+types/authorities.csv';
import { getMulti } from '../lib/filters';
import { withDataSource } from '../lib/dataSource';

export function loader({ request, context }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  return withDataSource(
    streamAuthoritiesCsv(context.cloudflare.env.DB, {
      sort: (sp.get('sort') as AuthoritySort) || 'spent',
      types: getMulti(sp, 'type'),
      sectors: getMulti(sp, 'sector'),
      years: getMulti(sp, 'year'),
      eu: (sp.get('eu') as 'eu' | 'national' | null) || null,
    }),
  );
}
