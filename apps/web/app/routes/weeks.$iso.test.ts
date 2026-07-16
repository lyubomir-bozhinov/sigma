import { describe, expect, it } from 'vitest';
import fixtureData from '../lib/assistant/fixtures/r2-report-object.fixture.json';
import { loader } from './weeks.$iso';

const fixtureJson = JSON.stringify(fixtureData);

// A context whose D1 binding THROWS on any access — proving the serve path never touches D1 (spec §6).
// REPORTS returns the fixture text (hit) or null (miss). `getCalls` records the key requested.
function makeContext(objectText: string | null) {
  const getCalls: string[] = [];
  const DB = new Proxy(
    {},
    {
      get() {
        throw new Error('D1 was accessed during /weeks serve — the serve path must be R2-only');
      },
    },
  );
  const REPORTS = {
    get: async (key: string) => {
      getCalls.push(key);
      return objectText === null ? null : { text: async () => objectText };
    },
  };
  const context = { cloudflare: { env: { DB, REPORTS } } };
  return { context, getCalls };
}

function callLoader(iso: string, objectText: string | null) {
  const { context, getCalls } = makeContext(objectText);
  const args = {
    params: { iso },
    context,
    request: new Request(`https://sigma.bg/weeks/${iso}`),
  } as unknown as Parameters<typeof loader>[0];
  return { promise: loader(args), getCalls };
}

describe('weeks.$iso loader', () => {
  it('reads the artifact from R2 and returns it — without touching D1', async () => {
    const { promise, getCalls } = callLoader('2026-W25', fixtureJson);
    const result = (await promise) as unknown as {
      data: { iso: string; stored: { schemaVersion: number } };
      init: { headers: Record<string, string> };
    };
    expect(result.data.iso).toBe('2026-W25');
    expect(result.data.stored.schemaVersion).toBe(1);
    expect(getCalls).toEqual(['weeks/2026-W25.json']);
  });

  it('sets an immutable Cache-Control for a clean (not re-issued) week', async () => {
    const { promise } = callLoader('2026-W25', fixtureJson);
    const result = (await promise) as unknown as { init: { headers: Record<string, string> } };
    expect(result.init.headers['Cache-Control']).toBe('public, s-maxage=31536000, immutable');
  });

  it('throws 404 when the week has no artifact', async () => {
    const { promise } = callLoader('2099-W01', null);
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(404);
  });

  it('throws 404 on a malformed iso without reading R2', async () => {
    const { promise, getCalls } = callLoader('not-a-week', 'ignored');
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(404);
    expect(getCalls).toEqual([]);
  });
});
