import { contractIdFromSlug, getContract } from '@sigma/db';
import type { Route } from './+types/contract.json';
import { publicCache } from '../lib/cache';
import { withDataSource } from '../lib/dataSource';

// Resource route: the assembled contract record as machine-readable JSON (/contracts/:id.json).
export async function loader({ params, context }: Route.LoaderArgs) {
  const id = (params.id ?? '').replace(/\.json$/, '');
  const record = await getContract(context.cloudflare.env.DB, contractIdFromSlug(id));
  if (!record) return withDataSource(Response.json({ error: 'not_found' }, { status: 404 }));
  return withDataSource(
    Response.json(record, {
      headers: { 'Cache-Control': publicCache(3600) },
    }),
  );
}
