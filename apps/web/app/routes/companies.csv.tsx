import { streamCompaniesCsv, type CompanySort } from '@sigma/db';
import type { EntityKind } from '@sigma/api-contract';
import type { Route } from './+types/companies.csv';
import { getMulti } from '../lib/filters';
import { withDataSource } from '../lib/dataSource';

export function loader({ request, context }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  return withDataSource(
    streamCompaniesCsv(context.cloudflare.env.DB, {
      sort: (sp.get('sort') as CompanySort) || 'won',
      kinds: getMulti(sp, 'kind') as EntityKind[],
      countBucket: sp.get('count'),
    }),
  );
}
