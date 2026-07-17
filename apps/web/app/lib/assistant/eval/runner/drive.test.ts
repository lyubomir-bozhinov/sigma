import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { score } from '../scorers/index';
import { declines, numeric } from '../catalog/_schema';
import { CLIENT_WIRE_CHUNK_TYPES, interpret, parseSse } from './drive';
import { loadCassette, replay } from './cassette';

const cassette = (name: string) =>
  loadCassette(new URL(`./cassettes/${name}.cassette.json`, import.meta.url));

describe('parseSse', () => {
  it('parses the real AI-SDK SSE fixture into chunk objects, skipping [DONE]', () => {
    const text = readFileSync(
      new URL('../../fixtures/sse-stream.fixture.txt', import.meta.url),
      'utf8',
    );
    const chunks = parseSse(text);
    // The fixture ends with a `finish` then `[DONE]`; [DONE] must not become a chunk.
    expect(chunks.every((c) => typeof c === 'object' && c !== null)).toBe(true);
    expect(chunks.some((c) => (c as { type: string }).type === 'tool-output-available')).toBe(true);
    expect(chunks.some((c) => (c as { type: string }).type === 'finish')).toBe(true);
  });

  it('reduces the real fixture to a bound report (run_sql string output is ignored)', () => {
    const text = readFileSync(
      new URL('../../fixtures/sse-stream.fixture.txt', import.meta.url),
      'utf8',
    );
    const out = interpret(parseSse(text), 200);
    expect(out.report).not.toBe(null);
    expect(out.report?.blocks[0]?.type).toBe('table');
  });
});

describe('interpret via cassettes', () => {
  it('success: binds the report, not declined, no error', () => {
    const out = replay(cassette('success'));
    expect(out.report).not.toBe(null);
    expect(out.declined).toBe(false);
    expect(out.error).toBeUndefined();
    // and the resolved report scores correctly through the real scorer
    expect(score(out, numeric({ expect: 52_100_000_000, tolerancePct: 1 })).pass).toBe(true);
  });

  it('decline: no report, declined true (the canonical no-answer sentence)', () => {
    const out = replay(cassette('decline'));
    expect(out.report).toBe(null);
    expect(out.declined).toBe(true);
    expect(out.error).toBeUndefined();
  });

  it('error: HTTP 500 surfaces as an error, not a decline', () => {
    const out = replay(cassette('error'));
    expect(out.report).toBe(null);
    expect(out.declined).toBe(false);
    expect(out.error).toEqual({ status: 500 });
  });

  it('silent no-report (no decline sentence) is NOT an honest decline', () => {
    const out = replay(cassette('silent-no-report'));
    expect(out.report).toBe(null);
    expect(out.declined).toBe(false);
    expect(out.error).toBeUndefined();
  });

  it('a silent no-report fails the declines() check (not a free pass)', () => {
    expect(score(replay(cassette('silent-no-report')), declines()).pass).toBe(false);
  });

  it('an error chunk on a 200 stream surfaces as an error', () => {
    const out = replay(cassette('stream-error'));
    expect(out.report).toBe(null);
    expect(out.error).toEqual({ status: 500 });
  });
});

describe('shape contract', () => {
  it('the success cassette uses only allowlisted client-wire chunk types', () => {
    // Guards against wire drift: a new/renamed chunk type on the real endpoint fails here.
    for (const type of replay(cassette('success')).chunks) {
      expect(CLIENT_WIRE_CHUNK_TYPES.has(type), type).toBe(true);
    }
  });
});
