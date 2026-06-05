import { streamContractsCsv, type ContractSort } from '@sigma/db';
import type { Route } from './+types/contracts.csv';
import { getMulti } from '../lib/filters';
import { withDataSource } from '../lib/dataSource';

// Resource route (no default export): a streamed text/csv Response honouring the list filters.
export function loader({ request, context }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  return withDataSource(
    streamContractsCsv(context.cloudflare.env.DB, {
      sort: (sp.get('sort') as ContractSort) || 'value-desc',
      years: getMulti(sp, 'year'),
      sectors: getMulti(sp, 'sector'),
      procedureGroups: getMulti(sp, 'procedure'),
      valueBucket: sp.get('value'),
      eu: (sp.get('eu') as 'eu' | 'national' | null) || null,
      authority: sp.get('authority'),
      bidder: sp.get('bidder'),
    }),
  );
}
