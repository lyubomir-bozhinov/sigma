import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureGateway,
  ensureCustomProvider,
  ensureRoute,
  graphEqual,
  GATEWAY_ID,
  PROVIDER_SLUG,
  ROUTE_NAME,
} from './ensure-voice-provider.mjs';

const CREDS = { accountId: 'acct', token: 'tok' };
const okResult = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
const okData = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

const GRAPH = [
  { id: 'START', type: 'start', outputs: { next: { elementId: 'primary-model' } } },
  {
    id: 'primary-model',
    type: 'model',
    outputs: { success: { elementId: 'END' }, fallback: { elementId: 'fallback-model' } },
    properties: { provider: 'custom-bggpt-voice', model: 'bggpt-whisper-large-v3', timeout: 20000, retries: 1 },
  },
  {
    id: 'fallback-model',
    type: 'model',
    outputs: { success: { elementId: 'END' }, fallback: { elementId: 'END' } },
    properties: { provider: 'workers-ai', model: '@cf/openai/whisper-large-v3-turbo', timeout: 30000, retries: 0 },
  },
  { id: 'END', type: 'end', outputs: {} },
];

// Records every call so tests can assert exactly which mutations fired.
function recorder(handler) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    return handler({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
  };
  return { fetchImpl, calls };
}
const posts = (calls) => calls.filter((c) => c.method === 'POST');

describe('graphEqual', () => {
  it('is order-insensitive on nodes (a reordered read is not a diff)', () => {
    const reversed = [...GRAPH].reverse();
    assert.ok(graphEqual(GRAPH, reversed));
  });
  it('detects a real property change', () => {
    const drift = structuredClone(GRAPH);
    drift[1].properties.timeout = 3000;
    assert.ok(!graphEqual(GRAPH, drift));
  });
});

describe('ensureGateway', () => {
  it('no-ops when the gateway already exists', async () => {
    const { fetchImpl, calls } = recorder(() => okResult([{ id: GATEWAY_ID }]));
    const id = await ensureGateway({ ...CREDS, fetchImpl });
    assert.equal(id, GATEWAY_ID);
    assert.equal(posts(calls).length, 0);
  });
  it('creates the gateway when absent', async () => {
    const { fetchImpl, calls } = recorder(({ method }) =>
      method === 'GET' ? okResult([{ id: 'other' }]) : okResult({ id: GATEWAY_ID }),
    );
    await ensureGateway({ ...CREDS, fetchImpl });
    assert.equal(posts(calls).length, 1);
    assert.equal(posts(calls)[0].body.id, GATEWAY_ID);
  });
});

describe('ensureCustomProvider', () => {
  it('reuses an existing provider and never re-writes the secret', async () => {
    const { fetchImpl, calls } = recorder(() =>
      okResult([{ id: 'p1', slug: PROVIDER_SLUG, base_url: 'https://api.bggpt.ai' }]),
    );
    const id = await ensureCustomProvider({ ...CREDS, apiKey: 'k', fetchImpl });
    assert.equal(id, 'p1');
    assert.equal(posts(calls).length, 0);
  });
  it('creates with a stored Authorization header when a key is supplied', async () => {
    const { fetchImpl, calls } = recorder(({ method }) =>
      method === 'GET' ? okResult([]) : okResult({ id: 'new' }),
    );
    await ensureCustomProvider({ ...CREDS, apiKey: 'secret', fetchImpl });
    const body = posts(calls)[0].body;
    assert.equal(body.slug, PROVIDER_SLUG);
    assert.equal(body.base_url, 'https://api.bggpt.ai');
    assert.equal(body.headers.Authorization, 'Bearer secret');
  });
  it('creates key-less and warns when no key is supplied', async () => {
    let warned = '';
    const { fetchImpl, calls } = recorder(({ method }) =>
      method === 'GET' ? okResult([]) : okResult({ id: 'new' }),
    );
    await ensureCustomProvider({ ...CREDS, fetchImpl, warn: (m) => (warned = m) });
    assert.equal(posts(calls)[0].body.headers, null);
    assert.match(warned, /per-request-auth/);
  });
});

describe('ensureRoute', () => {
  it('no-ops when the active version already matches the graph', async () => {
    const { fetchImpl, calls } = recorder(({ url }) =>
      url.endsWith('/routes?per_page=50')
        ? okData({ routes: [{ id: 'r1', name: ROUTE_NAME }] })
        : okResult({ version: { version_id: 'v1', active: true, data: GRAPH } }),
    );
    const { routeId, changed } = await ensureRoute({ ...CREDS, graph: GRAPH, fetchImpl });
    assert.equal(routeId, 'r1');
    assert.equal(changed, false);
    assert.equal(posts(calls).length, 0);
  });

  it('creates a new version and deploys it when the graph drifted', async () => {
    const stale = structuredClone(GRAPH);
    stale[1].properties.timeout = 3000; // the live defect
    const { fetchImpl, calls } = recorder(({ url, method }) => {
      if (method === 'GET' && url.endsWith('/routes?per_page=50'))
        return okData({ routes: [{ id: 'r1', name: ROUTE_NAME }] });
      if (method === 'GET') return okResult({ version: { version_id: 'old', active: true, data: stale } });
      if (url.endsWith('/versions')) return okResult({ version_id: 'v2' });
      return okResult({ deployment_id: 'd2' }); // deployments
    });
    const { changed } = await ensureRoute({ ...CREDS, graph: GRAPH, fetchImpl });
    assert.equal(changed, true);
    const p = posts(calls);
    assert.equal(p.length, 2);
    assert.ok(p[0].url.endsWith('/versions'));
    assert.deepEqual(p[0].body.elements, GRAPH); // WRITE key is `elements`, not `data`
    assert.equal(p[0].body.data, undefined);
    assert.ok(p[1].url.endsWith('/deployments'));
    assert.equal(p[1].body.version_id, 'v2');
  });

  it('creates the route with its first version when absent', async () => {
    const { fetchImpl, calls } = recorder(({ method }) =>
      method === 'GET' ? okData({ routes: [] }) : okResult({ id: 'r-new' }),
    );
    const { routeId, changed } = await ensureRoute({ ...CREDS, graph: GRAPH, fetchImpl });
    assert.equal(routeId, 'r-new');
    assert.equal(changed, true);
    assert.deepEqual(posts(calls)[0].body, { name: ROUTE_NAME, elements: GRAPH });
  });

  it('rejects an empty graph rather than deploying nothing', async () => {
    await assert.rejects(
      () => ensureRoute({ ...CREDS, graph: [], fetchImpl: () => assert.fail('must not call the API') }),
      /a non-empty route graph is required/,
    );
  });
});

describe('error surfacing', () => {
  it('propagates the routes/* flat {error} shape', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ success: false, error: 'Route not found' }) });
    await assert.rejects(() => ensureRoute({ ...CREDS, graph: GRAPH, fetchImpl }), /Route not found/);
  });
  it('propagates the errors[] shape and requires creds', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
    });
    await assert.rejects(() => ensureGateway({ ...CREDS, fetchImpl }), /10000 Authentication error/);
    await assert.rejects(
      () => ensureGateway({ token: 'tok', fetchImpl: () => assert.fail() }),
      /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required/,
    );
  });
});
