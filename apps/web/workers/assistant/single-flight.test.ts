import { describe, it, expect } from 'vitest';
import { SingleFlight, type Generator, type ProgressEvent } from './single-flight';
import {
  freshnessToken,
  record,
  type DedupKv,
  type DedupPayload,
  type ResolveSignals,
} from './dedup';

class FakeKv implements DedupKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush microtasks AND the real async crypto in resolveLive (a macrotask boundary). */
const flush = () => new Promise((r) => setTimeout(r, 0));

const FRESH = freshnessToken({ refreshedAt: '2026-06-24T00:00:00Z', buildId: 'b1' });
const SIGNALS: ResolveSignals = { sql: 's', params: [] };
const RECORD_AS: DedupPayload = { layer: 'L2', sql: 's', params: [] };
const alwaysPresent = async () => true;

describe('SingleFlight — collapse', () => {
  it('runs the generator exactly once under N concurrent calls for one key', async () => {
    const kv = new FakeKv();
    const gate = deferred<{ reportId: string; createdAt: string }>();
    let calls = 0;
    const gen: Generator = async () => {
      calls += 1;
      return gate.promise;
    };
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });

    const runs = [
      sf.run(FRESH, SIGNALS, RECORD_AS, gen),
      sf.run(FRESH, SIGNALS, RECORD_AS, gen),
      sf.run(FRESH, SIGNALS, RECORD_AS, gen),
    ];
    await flush();
    gate.resolve({ reportId: 'rep_1', createdAt: '2026-06-24T01:00:00Z' });
    const outs = await Promise.all(runs);

    expect(calls).toBe(1);
    expect(outs.map((o) => o.reportId)).toEqual(['rep_1', 'rep_1', 'rep_1']);
    expect(outs.every((o) => !o.deduped)).toBe(true);
  });
});

describe('SingleFlight — cache fast path', () => {
  it('serves a live cache hit without generating', async () => {
    const kv = new FakeKv();
    await record(kv, RECORD_AS, FRESH, { reportId: 'rep_0', createdAt: 't' });
    let calls = 0;
    const gen: Generator = async () => {
      calls += 1;
      return { reportId: 'never', createdAt: 't' };
    };
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });

    const out = await sf.run(FRESH, SIGNALS, RECORD_AS, gen);
    expect(out).toMatchObject({ reportId: 'rep_0', deduped: true, layer: 'L2' });
    expect(calls).toBe(0);
  });

  it('regenerates when the cached report’s R2 artifact is gone', async () => {
    const kv = new FakeKv();
    await record(kv, RECORD_AS, FRESH, { reportId: 'rep_0', createdAt: 't' });
    let calls = 0;
    const gen: Generator = async () => {
      calls += 1;
      return { reportId: 'rep_new', createdAt: 't2' };
    };
    const sf = new SingleFlight({ kv, r2Exists: async () => false });

    const out = await sf.run(FRESH, SIGNALS, RECORD_AS, gen);
    expect(out).toMatchObject({ reportId: 'rep_new', deduped: false });
    expect(calls).toBe(1);
  });

  it('records the fresh report so the next call dedups', async () => {
    const kv = new FakeKv();
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });
    const ok: Generator = async () => ({ reportId: 'rep_1', createdAt: 't' });

    await sf.run(FRESH, SIGNALS, RECORD_AS, ok);
    const explode: Generator = async () => {
      throw new Error('should not generate again');
    };
    const out = await sf.run(FRESH, SIGNALS, RECORD_AS, explode);
    expect(out).toMatchObject({ reportId: 'rep_1', deduped: true });
  });
});

describe('SingleFlight — fail toward regeneration', () => {
  it('propagates a generator throw and lets the next request regenerate', async () => {
    const kv = new FakeKv();
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });
    let calls = 0;
    const boom: Generator = async () => {
      calls += 1;
      throw new Error('boom');
    };
    await expect(sf.run(FRESH, SIGNALS, RECORD_AS, boom)).rejects.toThrow('boom');

    const ok: Generator = async () => {
      calls += 1;
      return { reportId: 'rep_ok', createdAt: 't' };
    };
    const out = await sf.run(FRESH, SIGNALS, RECORD_AS, ok);
    expect(out.reportId).toBe('rep_ok');
    expect(calls).toBe(2);
  });
});

describe('SingleFlight — progress', () => {
  it('broadcasts progress to the leader and a late waiter (catch-up)', async () => {
    const kv = new FakeKv();
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });
    const gate = deferred<{ reportId: string; createdAt: string }>();
    const planning: ProgressEvent = { phase: 'planning', label: 'P' };
    const gen: Generator = async (emit) => {
      emit(planning);
      return gate.promise;
    };

    const leaderEvents: ProgressEvent[] = [];
    const waiterEvents: ProgressEvent[] = [];

    const leader = sf.run(FRESH, SIGNALS, RECORD_AS, gen, (e) => leaderEvents.push(e));
    await flush(); // leader has emitted 'planning' and stored it as lastProgress
    const waiter = sf.run(FRESH, SIGNALS, RECORD_AS, gen, (e) => waiterEvents.push(e));
    await flush();

    gate.resolve({ reportId: 'rep_1', createdAt: 't' });
    const [a, b] = await Promise.all([leader, waiter]);

    expect(leaderEvents).toContainEqual(planning);
    expect(waiterEvents).toContainEqual(planning); // received via late-waiter catch-up
    expect(a.reportId).toBe('rep_1');
    expect(b.reportId).toBe('rep_1');
  });

  it('a throwing subscriber does not break generation or starve other waiters', async () => {
    const kv = new FakeKv();
    const sf = new SingleFlight({ kv, r2Exists: alwaysPresent });
    const gate = deferred<{ reportId: string; createdAt: string }>();
    const gen: Generator = async (emit) => {
      emit({ phase: 'planning', label: 'P' });
      return gate.promise;
    };
    const good: ProgressEvent[] = [];
    const leader = sf.run(FRESH, SIGNALS, RECORD_AS, gen, () => {
      throw new Error('bad subscriber');
    });
    await flush();
    const waiter = sf.run(FRESH, SIGNALS, RECORD_AS, gen, (e) => good.push(e));
    await flush();
    gate.resolve({ reportId: 'rep_1', createdAt: 't' });

    const [a, b] = await Promise.all([leader, waiter]);
    expect(a.reportId).toBe('rep_1');
    expect(b.reportId).toBe('rep_1');
    expect(good).toContainEqual({ phase: 'planning', label: 'P' });
  });
});
