// Privacy masking + `noindex` on the machine-readable twins — end-to-end through the REAL worker
// pipeline (issue #173, PR #183). This is the durable regression guard that the earlier lane
// (`apps/web/workers/app.nofollow.test.ts`) could not be: that test hand-injects the internal
// `X-Privacy-Mask` marker into a MOCKED `createRequestHandler`, so it proves the worker's
// marker→`X-Robots-Tag` translation but NOT that React Router v7's single-fetch pipeline actually
// runs a route's `headers` export (and forwards a loader-set marker) onto the `/<path>.data`
// response. RRv7's `getDocumentHeadersImpl` forwards only `Set-Cookie` by default; the `headers`
// export in `companies.tsx` / `contracts.tsx` / `company.tsx` is the explicit forward that PR #183
// relies on. Whether that forward fires on the `.data` request is the whole open question, and it
// is only answerable by driving the real handler — which the #177 integration lane does, via
// `wrangler.getPlatformProxy()` (real D1 + migrations) and `appFetch()`.
//
// Ground truth (recorded in the PR): RRv7 7.18.0 DOES run the `headers` export on `.data` and
// carries the returned marker onto the `.data` HTTP response, so `hardenResponse` translates it to
// `X-Robots-Tag: noindex` and deletes the internal marker. These assertions lock that in and would
// fail if a RRv7 upgrade, a dropped `headers` export, or a broken loader marker regressed it.
//
// The `.data` body is RRv7's single-fetch turbo-stream; `decodeSingleFetch` reconstructs the exact
// client-visible loader data so the row assertions read real objects, not a grepped flat array.

import { describe, expect, it, beforeAll } from 'vitest';
import { appFetch, seedRows } from './setup';
import { decodeSingleFetch, routeData } from './helpers/single-fetch';

// ── Fixture entities (seeded into THIS file's isolated proxy DB) ───────────────────────────────
// A sole trader (ЕТ, natural person), a legal entity (ООД, has a public ЕИК), and a consortium
// whose name leads with a sole trader — the MAJOR-class over-mask trap the `kind !== 'consortium'`
// guard exists for. ЕИК values and contract counts are chosen so each lands in a distinct
// `?count` bucket, letting a filtered request isolate a natural-person-free page.
const ET_EIK = '999000111';
const ET_NAME = 'ЕТ ДРИФТ - НИКОЛАЙ КИРОВ';
const ET_NAME_TOKEN = 'НИКОЛАЙ КИРОВ'; // the sensitive source-name fragment that must never leak
const OOD_EIK = '200000002';
const OOD_NAME = 'СТРОЙ ООД';
const CONSORTIUM_EIK = '300000003';
const CONSORTIUM_NAME = 'ЕТ Иван Петров; Строй ООД';
const CONSORTIUM_MEMBER_TOKEN = 'Строй ООД'; // a member name that must survive verbatim (not masked)
const MASK_LABEL = 'Частно лице';

const SEED: readonly string[] = [
  // Sole trader — legal_form 'ЕТ' AND a leading-"ЕТ " name both flag it as a natural person.
  `INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium, kind, legal_form)
     VALUES ('eik:${ET_EIK}', '${ET_NAME}', '${ET_EIK}', '${ET_EIK}', 1, 0, 'company', 'ЕТ')`,
  `INSERT OR IGNORE INTO company_totals (bidder_id, name, kind, eik, eik_valid, won_eur, contracts, authorities, eu_eur, first_date, last_date)
     VALUES ('eik:${ET_EIK}', '${ET_NAME}', 'company', '${ET_EIK}', 1, 9000000.0, 5, 1, 0, '2021-01-01', '2022-12-01')`,
  // Legal entity — plain ООД with a public ЕИК; must stay verbatim and out of the noindex bucket.
  `INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium, kind, legal_form, settlement)
     VALUES ('eik:${OOD_EIK}', '${OOD_NAME}', '${OOD_EIK}', '${OOD_EIK}', 1, 0, 'company', 'ООД', 'Пловдив')`,
  `INSERT OR IGNORE INTO company_totals (bidder_id, name, kind, eik, eik_valid, settlement, won_eur, contracts, authorities, eu_eur, first_date, last_date)
     VALUES ('eik:${OOD_EIK}', '${OOD_NAME}', 'company', '${OOD_EIK}', 1, 'Пловдив', 8000000.0, 50, 1, 0, '2020-01-01', '2022-12-28')`,
  // Consortium whose lead member is a sole trader — the over-mask guard target. Kept verbatim.
  `INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium, kind, legal_form)
     VALUES ('eik:${CONSORTIUM_EIK}', '${CONSORTIUM_NAME}', '${CONSORTIUM_EIK}', '${CONSORTIUM_EIK}', 1, 1, 'consortium', 'ДЗЗД')`,
  `INSERT OR IGNORE INTO company_totals (bidder_id, name, kind, eik, eik_valid, won_eur, contracts, authorities, eu_eur, first_date, last_date)
     VALUES ('eik:${CONSORTIUM_EIK}', '${CONSORTIUM_NAME}', 'consortium', '${CONSORTIUM_EIK}', 1, 7000000.0, 10, 1, 0, '2021-01-01', '2022-06-01')`,
  // One contract won by the sole trader — exercises /contracts.data (list mask) + /contracts/:id.json.
  `INSERT OR IGNORE INTO contracts (id, tender_id, bidder_id, amount, currency, signed_at, value_flag, date_flag, amount_eur, fx_converted)
     VALUES ('c:ET-1', 't:FIX-1', 'eik:${ET_EIK}', 5000000, 'BGN', '2022-06-01', 'ok', 'ok', 5000000, 0)`,
];

type ListItem = {
  slug: string;
  name: string;
  displayName: string;
  eik: string | null;
  hasEik: boolean;
  isConsortium: boolean;
};
type ContractItem = { id: string; bidderSlug: string; bidderName: string; bidderDisplayName: string };

async function getData(path: string): Promise<Response> {
  return appFetch(new Request(`https://sigma.bg${path}`, { headers: { 'CF-Connecting-IP': '203.0.113.201' } }));
}

async function companiesItems(query = ''): Promise<{ res: Response; items: ListItem[] }> {
  const res = await getData(`/companies.data${query}`);
  const data = routeData<{ page: { items: ListItem[] } }>(decodeSingleFetch(await res.text()), 'routes/companies');
  return { res, items: data.page.items };
}

function bySlug<T extends { slug?: string; bidderSlug?: string }>(items: T[], slug: string): T {
  const hit = items.find((i) => i.slug === slug || i.bidderSlug === slug);
  if (!hit) throw new Error(`row with slug ${slug} not on page; got ${items.map((i) => i.slug ?? i.bidderSlug).join(', ')}`);
  return hit;
}

describe('privacy: noindex + masking on machine-readable twins (real RRv7 single-fetch)', () => {
  beforeAll(async () => {
    await seedRows(SEED);
  });

  it('the internal X-Privacy-Mask marker never reaches the client on any .data response', async () => {
    for (const path of ['/companies.data', `/companies/${ET_EIK}.data`, '/contracts.data']) {
      const res = await getData(path);
      expect(res.headers.get('X-Privacy-Mask'), `marker leaked on ${path}`).toBeNull();
    }
  });

  it('/companies.data — masked ЕТ page carries noindex; row is masked (name + null ЕИК)', async () => {
    const { res, items } = await companiesItems();
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');

    const et = bySlug(items, ET_EIK);
    expect(et.name).toBe(MASK_LABEL);
    expect(et.displayName).toBe(MASK_LABEL);
    expect(et.eik).toBeNull();
    expect(et.hasEik).toBe(false);

    // Sensitivity: the sensitive source name must be absent from the raw twin, not just the object.
    expect(await getData('/companies.data').then((r) => r.text())).not.toContain(ET_NAME_TOKEN);
  });

  it('/companies/<et>.data — detail twin carries noindex; ЕИК masked, trading name preserved (ADR-0039)', async () => {
    const res = await getData(`/companies/${ET_EIK}.data`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');

    const company = routeData<{ company: { eik: string | null; displayName: string } }>(
      decodeSingleFetch(await res.text()),
      'routes/company',
    ).company;
    // The sensitive identifier (ЕИК) is masked; the trading name stays public — the `.data` twin is
    // the client-nav transport that re-renders the same HTML page (ADR-0039 §3).
    expect(company.eik).toBeNull();
    expect(company.displayName).toContain('НИКОЛАЙ КИРОВ');
  });

  it('/contracts.data — page with an ЕТ bidder carries noindex; bidder masked', async () => {
    const res = await getData('/contracts.data');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');

    const items = routeData<{ result: { items: ContractItem[] } }>(
      decodeSingleFetch(await res.text()),
      'routes/contracts',
    ).result.items;
    const et = bySlug(items, ET_EIK);
    expect(et.bidderName).toBe(MASK_LABEL);
    expect(et.bidderDisplayName).toBe(MASK_LABEL);
  });

  it('/contracts/<id>.json — ЕТ bidder masked, ЕИК null, server-only legal_form stripped, noindex', async () => {
    const res = await getData('/contracts/ET-1.json');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const body = (await res.json()) as {
      bidder: { name: string; displayName: string; eik: string | null };
      sourceNames: { bidder: string };
    } & Record<string, unknown>;

    expect(body.bidder.name).toBe(MASK_LABEL);
    expect(body.bidder.displayName).toBe(MASK_LABEL);
    expect(body.bidder.eik).toBeNull();
    expect(body.sourceNames.bidder).toBe(MASK_LABEL);
    // The server-only natural-person classifier must never reach the client body.
    expect('bidder_legal_form' in body).toBe(false);
  });

  it('NEGATIVE — a legal-entity-only page is NOT noindexed and keeps ЕИК + name verbatim', async () => {
    // ?count=21-100 selects the ООД (50 contracts) and the base fixture company (30), excludes the
    // ЕТ (5) and the consortium (10) — a page with zero natural persons. Proves the noindex signal
    // is data-driven, not blanket (no over-noindexing of public companies).
    const { res, items } = await companiesItems('?count=21-100');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();

    const ood = bySlug(items, OOD_EIK);
    expect(ood.name).toBe(OOD_NAME);
    expect(ood.eik).toBe(OOD_EIK);
    expect(ood.hasEik).toBe(true);
    expect(items.some((i) => i.name === MASK_LABEL)).toBe(false);
  });

  it('GUARD — a consortium led by a sole trader is NOT over-masked (name + ЕИК kept verbatim)', async () => {
    const { items } = await companiesItems();
    const consortium = bySlug(items, CONSORTIUM_EIK);
    expect(consortium.isConsortium).toBe(true);
    expect(consortium.name).not.toBe(MASK_LABEL);
    expect(consortium.name).toContain(CONSORTIUM_MEMBER_TOKEN);
    expect(consortium.eik).toBe(CONSORTIUM_EIK);
  });
});
