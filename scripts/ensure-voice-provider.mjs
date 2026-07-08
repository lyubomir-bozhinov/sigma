#!/usr/bin/env node
// Idempotently ensure the assistant's AI-Gateway objects that the VOICE lane routes through:
//
//   1. the gateway            `sigma-assistant`        (shared with chat — ensure-exists only, never
//                                                        mutate its settings here or we clobber chat)
//   2. the custom provider    `bggpt-voice`            (BgGPT Whisper upstream, https://api.bggpt.ai)
//   3. the dynamic route      `voice`                  (graph committed in ai-gateway/voice-route.json;
//                                                        converge the ACTIVE version to it, then deploy)
//
// Why this exists — same GitOps rationale as scripts/ensure-kv-namespace.mjs: the route/provider were
// first stood up by hand in the dashboard; hand state drifts silently and isn't reviewable. This makes
// the desired state git-declared (the graph JSON) and CI-applied. `wrangler` cannot touch AI Gateway,
// so this goes straight at the account-scoped REST API (verified endpoint shapes, see each function).
//
// SAFETY: dry-run by default (prints the exact planned mutations); pass --apply to execute — mirrors
// scripts/bootstrap.mjs. Reads never mutate; only --apply issues POSTs.
//
// usage:  node scripts/ensure-voice-provider.mjs [--apply]
//   env:  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN  (token needs AI Gateway:Edit)
//         VOICE_ASSISTANT_API_KEY                       (optional — see ensureCustomProvider)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';

// The hand-provisioned names this script converges toward. Changing a name here creates a NEW object;
// it does not rename the existing one — rename in the dashboard first if that is ever needed.
export const GATEWAY_ID = 'sigma-assistant';
export const PROVIDER_SLUG = 'bggpt-voice';
export const PROVIDER_NAME = 'BgGPT Voice';
export const PROVIDER_BASE_URL = 'https://api.bggpt.ai';
export const ROUTE_NAME = 'voice';

function summariseErrors(status, body) {
  const errs = Array.isArray(body?.errors) ? body.errors : [];
  // The routes/* endpoints return a flat `{success:false,error:"..."}`, not an errors[] — cover both.
  const flat = typeof body?.error === 'string' ? body.error : '';
  return errs.map((e) => `${e.code} ${e.message}`).join('; ') || flat || `HTTP ${status}`;
}

// One request + uniform error surfacing. Returns the parsed body; callers read `.result` or `.data`
// (the AI-Gateway API is inconsistent: gateways/providers use `result`, routes use `data`).
async function req(fetchImpl, url, { method = 'GET', token, body } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json();
  if (!res.ok || !parsed.success) {
    throw new Error(`${method} ${url} failed: ${summariseErrors(res.status, parsed)}`);
  }
  return parsed;
}

function requireCreds({ accountId, token }) {
  if (!accountId || !token) {
    throw new Error(
      'ensure-voice-provider: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.',
    );
  }
}

// --- gateway ---------------------------------------------------------------------------------------
// GET /accounts/{a}/ai-gateway/gateways -> { result: [{ id, ... }] }  (verified)
export async function ensureGateway({
  accountId,
  token,
  gatewayId = GATEWAY_ID,
  fetchImpl = fetch,
}) {
  requireCreds({ accountId, token });
  const list = await req(
    fetchImpl,
    `${API}/accounts/${accountId}/ai-gateway/gateways?per_page=50`,
    {
      token,
    },
  );
  // ponytail: single page — the account holds ~1 gateway. Paginate if that ever grows past 50.
  if ((list.result ?? []).some((g) => g.id === gatewayId)) return gatewayId;
  // INFERRED body shape: gateway create takes at least { id }. Verify on first --apply.
  await req(fetchImpl, `${API}/accounts/${accountId}/ai-gateway/gateways`, {
    method: 'POST',
    token,
    body: { id: gatewayId },
  });
  return gatewayId;
}

// --- custom provider -------------------------------------------------------------------------------
// GET /accounts/{a}/ai-gateway/custom-providers -> { result: [{ id, slug, base_url, headers, ... }] }
// (verified). Auth model: if VOICE_ASSISTANT_API_KEY is supplied we store it as the provider's
// Authorization header (provisioning owns the key — the clean split from Niki's request-routing code).
// If absent, the provider is created key-less (per-request-auth model, like the chat `bggpt` provider)
// and we warn. Idempotent: when the provider already exists we do NOT re-PUT the secret every run
// (GET masks it, so drift is undetectable) — existence + base_url are enough.
export async function ensureCustomProvider({
  accountId,
  token,
  slug = PROVIDER_SLUG,
  name = PROVIDER_NAME,
  baseUrl = PROVIDER_BASE_URL,
  apiKey,
  fetchImpl = fetch,
  warn = () => {},
}) {
  requireCreds({ accountId, token });
  const list = await req(
    fetchImpl,
    `${API}/accounts/${accountId}/ai-gateway/custom-providers?per_page=50`,
    {
      token,
    },
  );
  const existing = (list.result ?? []).find((p) => p.slug === slug);
  if (existing) {
    if (existing.base_url && existing.base_url !== baseUrl) {
      warn(`provider "${slug}" base_url is ${existing.base_url}, expected ${baseUrl} — left as-is`);
    }
    return existing.id ?? slug;
  }
  if (!apiKey) {
    warn(
      `VOICE_ASSISTANT_API_KEY not set — creating provider "${slug}" without stored auth (per-request-auth model)`,
    );
  }
  // INFERRED body shape from the GET record ({ name, slug, base_url, headers }). Verify on first --apply.
  const created = await req(fetchImpl, `${API}/accounts/${accountId}/ai-gateway/custom-providers`, {
    method: 'POST',
    token,
    body: {
      name,
      slug,
      base_url: baseUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : null,
    },
  });
  return created.result?.id ?? slug;
}

// --- route -----------------------------------------------------------------------------------------
// Order-insensitive graph compare: the nodes reference each other by elementId, so their array order
// carries no meaning — sort by id before comparing, else a reordered read triggers a needless new
// version every run (breaks idempotence).
function normalizeGraph(nodes) {
  const sortKeys = (v) =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.keys(v)
            .sort()
            .reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {})
        : v;
  return JSON.stringify(
    sortKeys([...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)))),
  );
}

export function graphEqual(a, b) {
  return normalizeGraph(a) === normalizeGraph(b);
}

// GET  /gateways/{g}/routes                 -> { data: { routes: [{ id, name, ... }] } }   (verified)
// GET  /gateways/{g}/routes/{id}            -> { result: { version: { version_id, data, active } } }  (verified)
// POST /gateways/{g}/routes                 -> create route ({ name, elements })
// POST /gateways/{g}/routes/{id}/versions   -> new version ({ elements } -> { result: { version_id } })
// POST /gateways/{g}/routes/{id}/deployments-> deploy      ({ version_id }) — makes the version live
// Asymmetry to watch: the WRITE key is `elements`, but reads return the same graph under `data` (sending
// `data` yields Cloudflare's `7001 Required`). Verified against the AI Gateway dynamic-routing API docs.
// Returns { routeId, changed }.
export async function ensureRoute({
  accountId,
  token,
  gatewayId = GATEWAY_ID,
  name = ROUTE_NAME,
  graph,
  fetchImpl = fetch,
}) {
  requireCreds({ accountId, token });
  if (!Array.isArray(graph) || graph.length === 0) {
    throw new Error('ensure-voice-provider: a non-empty route graph is required.');
  }
  const base = `${API}/accounts/${accountId}/ai-gateway/gateways/${gatewayId}/routes`;
  const list = await req(fetchImpl, `${base}?per_page=50`, { token });
  const existing = (list.data?.routes ?? []).find((r) => r.name === name);

  if (!existing) {
    // New route: create with the graph as its first version (the dashboard creates+deploys v1 in one
    // step this way). If the API does not auto-deploy, the deploy below is a harmless second step.
    const created = await req(fetchImpl, base, {
      method: 'POST',
      token,
      body: { name, elements: graph },
    });
    const routeId = created.result?.id ?? created.data?.id;
    return { routeId, changed: true };
  }

  const routeId = existing.id;
  const detail = await req(fetchImpl, `${base}/${routeId}`, { token });
  const active = detail.result?.version;
  if (active?.active && graphEqual(active.data ?? [], graph)) {
    return { routeId, changed: false }; // already converged — no-op
  }
  const version = await req(fetchImpl, `${base}/${routeId}/versions`, {
    method: 'POST',
    token,
    body: { elements: graph },
  });
  const versionId = version.result?.version_id ?? version.result?.id ?? version.data?.version_id;
  await req(fetchImpl, `${base}/${routeId}/deployments`, {
    method: 'POST',
    token,
    body: { version_id: versionId },
  });
  return { routeId, changed: true };
}

// Dry-run decorator: GETs pass through (safe); every mutation is logged as WOULD … and answered with a
// synthetic success so the full plan prints in one pass without touching the account.
function dryRunFetch(real, log) {
  return async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    if (method === 'GET') return real(url, opts);
    log(`  WOULD ${method} ${url}${opts.body ? ` ${opts.body}` : ''}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { id: 'DRY-RUN', version_id: 'DRY-RUN', slug: 'DRY-RUN' },
        data: { id: 'DRY-RUN' },
      }),
    };
  };
}

function loadGraph() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(resolve(here, 'ai-gateway', 'voice-route.json'), 'utf8'));
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const apiKey = process.env.VOICE_ASSISTANT_API_KEY;
  const log = (m) => process.stdout.write(`${m}\n`);
  const warn = (m) => process.stderr.write(`!! ${m}\n`);
  const fetchImpl = apply ? fetch : dryRunFetch(fetch, log);

  try {
    requireCreds({ accountId, token });
    const graph = loadGraph();
    log(apply ? '==> Applying AI-Gateway desired state' : '==> Dry run (pass --apply to execute)');

    await ensureGateway({ accountId, token, fetchImpl });
    log(`  gateway    ${GATEWAY_ID} ok`);

    await ensureCustomProvider({ accountId, token, apiKey, fetchImpl, warn });
    log(`  provider   ${PROVIDER_SLUG} ok`);

    const { changed } = await ensureRoute({ accountId, token, graph, fetchImpl });
    log(
      `  route      ${ROUTE_NAME} ${changed ? 'converged (new version deployed)' : 'already up to date'}`,
    );
  } catch (err) {
    warn(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv);
}
