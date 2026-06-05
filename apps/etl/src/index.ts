import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  discoverOcdsDatasets,
  fetchOcdsPackage,
  findJsonResource,
  releaseToContracts,
  runRefreshSlice,
  upsertContractStaging,
  type OcdsMeta,
  type OcdsRelease,
} from '@sigma/ingest';
import refreshSliceSql from '../../../scripts/refresh-slice.sql';

export interface Env {
  DB: D1Database;
  REFRESH: Workflow;
  ETL_REFRESH_SECRET?: string;
  ETL_ALLOW_UNAUTH?: string;
  ETL_ALLOW_FIXTURES?: string;
}

interface RefreshParams {
  /** Limit to a single OCDS dataset URI (else the newest period is discovered). */
  datasetUri?: string;
  /** Test/fixture override: stage these releases directly, skipping the live fetch. */
  releases?: OcdsRelease[];
  /** Source tag for fixture releases (default 'ocds:fixture'). */
  source?: string;
}

function timingSafeEqual(expected: string, actual: string): boolean {
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= (expected.charCodeAt(i) || 0) ^ (actual.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? request.headers.get('x-sigma-etl-secret') ?? undefined;
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ETL_REFRESH_SECRET) {
    return env.ETL_ALLOW_UNAUTH === 'true';
  }
  return timingSafeEqual(env.ETL_REFRESH_SECRET, bearerToken(request) ?? '');
}

async function validatedRefreshParams(request: Request): Promise<RefreshParams | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {};
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return new Response('Bad request', { status: 400 });
  }

  const body = raw as Record<string, unknown>;
  const params: RefreshParams = {};
  if (body.datasetUri !== undefined) {
    if (typeof body.datasetUri !== 'string') return new Response('Bad request', { status: 400 });
    params.datasetUri = body.datasetUri;
  }
  if (body.source !== undefined) {
    if (typeof body.source !== 'string') return new Response('Bad request', { status: 400 });
    params.source = body.source;
  }
  if (body.releases !== undefined) {
    if (!Array.isArray(body.releases) || body.releases.length > 5000) {
      return new Response('Bad request', { status: 400 });
    }
    params.releases = body.releases as OcdsRelease[];
  }

  return params;
}

// The on-platform daily refresh. Durable, individually-retried steps: discover the newest OCDS
// period → fetch it → upsert the contract staging → scoped re-derive of the touched slice +
// refresh its rollup/FTS rows (scripts/refresh-slice.sql). The full-rebuild normalize stays off
// this path; the Queue fan-out for the TR backfill is deferred. Raw archival is delegated to the
// external BG feeder (see docs/etl-pipeline.md).
export class RefreshWorkflow extends WorkflowEntrypoint<Env, RefreshParams> {
  override async run(
    event: WorkflowEvent<RefreshParams>,
    step: WorkflowStep,
  ): Promise<{ datasets: number; staged: number; derived: number }> {
    const params = event.payload ?? {};
    const fetchedAt = new Date().toISOString();

    // 1) Which OCDS dataset(s) to refresh. A fixture (params.releases) is a single synthetic dataset.
    const datasets = await step
      .do('discover', async () => {
        if (params.releases) {
          return [
            {
              uri: 'fixture',
              resourceUri: 'fixture',
              source: params.source ?? 'ocds:fixture',
              year: null as number | null,
            },
          ];
        }
        const all = await discoverOcdsDatasets();
        const picked = params.datasetUri
          ? all.filter((d) => d.uri === params.datasetUri)
          : all.slice(0, 1);
        const out = [];
        for (const ds of picked) {
          const res = await findJsonResource(ds.uri);
          if (res)
            out.push({
              uri: ds.uri,
              resourceUri: res.uri,
              source: `ocds:${ds.year}:${ds.periodStart}`,
              year: ds.year,
            });
        }
        return out;
      })
      .catch((error) => {
        console.error(JSON.stringify({ level: 'error', event: 'etl_discovery_failed' }));
        throw error;
      });

    // 2) Per dataset: fetch + flatten + upsert staging (big payload stays inside the step; only the
    //    small {staged} count is persisted as the step result). No raw archival — the BG feeder
    //    owns that.
    let staged = 0;
    for (const ds of datasets) {
      const meta: OcdsMeta = {
        source: ds.source,
        datasetUri: ds.uri,
        resourceUri: ds.resourceUri,
        year: ds.year,
        fetchedAt,
      };
      const n = await step.do(`ingest:${ds.source}`, async () => {
        let releases: OcdsRelease[];
        if (params.releases) {
          releases = params.releases;
        } else {
          // Fetch first so the package-level publishedDate is in scope: releases that lack their
          // own `date` fall back to it (mirrors load-ocds.mjs), instead of regressing to NULL.
          const pkg = await fetchOcdsPackage(ds.resourceUri);
          meta.publishedDate = pkg.publishedDate;
          releases = pkg.releases ?? [];
        }
        const rows = releases.flatMap((rel) => releaseToContracts(rel, meta));
        return upsertContractStaging(this.env.DB, ds.source, rows);
      });
      staged += n;
    }

    if (staged === 0) {
      console.warn(JSON.stringify({ level: 'warn', event: 'etl_zero_ingest', fetchedAt }));
      return { datasets: datasets.length, staged: 0, derived: 0 };
    }

    // 3) Scoped re-derive + refresh the affected rollup/FTS rows.
    const derived = await step.do('derive-slice', async () =>
      runRefreshSlice(this.env.DB, refreshSliceSql),
    );

    return { datasets: datasets.length, staged, derived };
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'sigma-etl' });
    }
    if (!isAuthorized(request, env)) {
      return new Response(null, { status: 401 });
    }
    if (url.pathname === '/etl/refresh' && request.method === 'POST') {
      const params = await validatedRefreshParams(request);
      if (params instanceof Response) return params;
      if (params.releases && env.ETL_ALLOW_FIXTURES !== 'true') {
        return new Response('fixtures disabled', { status: 400 });
      }
      const instance = await env.REFRESH.create({ params });
      return Response.json({ id: instance.id, status: await instance.status() });
    }
    if (url.pathname.startsWith('/etl/refresh/') && request.method === 'GET') {
      const id = url.pathname.slice('/etl/refresh/'.length);
      const instance = await env.REFRESH.get(id);
      return Response.json({ id, status: await instance.status() });
    }
    return new Response('Not found', { status: 404 });
  },

  // Cron entrypoint: kick one durable refresh run (discovers the newest OCDS period itself).
  async scheduled(_controller, env): Promise<void> {
    const instance = await env.REFRESH.create();
    console.log(JSON.stringify({ level: 'info', event: 'etl_scheduled_refresh', id: instance.id }));
  },
} satisfies ExportedHandler<Env>;
