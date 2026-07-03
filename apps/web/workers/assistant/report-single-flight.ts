// F2 — `ReportSingleFlight` Durable Object (thin durable wrapper around the SingleFlight coordinator).
//
// One instance per freshness-folded dedup key (`idFromName`), so every concurrent request for the same
// question routes to ONE isolate — upgrading the coordinator's in-isolate collapse to a cross-isolate
// single-flight. Option 2 (spec §3): the DRIVER generates in the request isolate and keeps its rich
// stream; this DO only brokers driver/waiter and wakes waiters with the driver's report.
//
// ALL decision logic lives in the pure `SingleFlight` coordinator (exhaustively unit-tested). This class
// is thin platform glue — RPC surface, the driver-crash alarm, and R2-exists — and is verified by
// typecheck + deploy, not a unit test (the repo has no Workers/DO test harness; the coordinator does the
// testable work). Keep it small enough to read-verify.
//
// A `Promise`/closure can't cross the RPC boundary, so a waiter BLOCKS inside `claimAndWait` until the
// driver settles and the DO returns a plain, structured-cloneable result.

import { DurableObject } from 'cloudflare:workers';
import { SingleFlight, type GeneratorResult } from './single-flight';
import type { DedupLayer, DedupPayload, ResolveSignals } from './dedup';

// Upper bound a driver may hold the flight before waiters are released to regenerate. ≥ the model
// step budget (agent.ts SETTLE_BACKSTOP_MS 60s + tool loop); generous so a slow-but-live generation is
// not cut off, bounded so a crashed driver can't hang waiters forever. Fail toward regeneration.
const GENERATION_TIMEOUT_MS = 130_000;

export type ClaimResult =
  | { kind: 'hit'; reportId: string; createdAt: string; layer: DedupLayer }
  | { kind: 'driver' }
  | { kind: 'ready'; reportId: string; createdAt: string }
  | { kind: 'regenerate' };

export interface ReportSingleFlightEnv {
  DEDUP_KV: KVNamespace;
  REPORTS?: R2Bucket;
}

export class ReportSingleFlight extends DurableObject<ReportSingleFlightEnv> {
  private readonly flight: SingleFlight;

  constructor(ctx: DurableObjectState, env: ReportSingleFlightEnv) {
    super(ctx, env);
    this.flight = new SingleFlight({
      kv: env.DEDUP_KV,
      r2Exists: async (reportId) => {
        if (!env.REPORTS) return false;
        return (await env.REPORTS.head(`report/${reportId}.json`)) !== null;
      },
    });
  }

  /**
   * Route entry. Live hit → serve; first miss → 'driver' (route generates, then calls complete/fail);
   * concurrent miss → block until the driver settles → 'ready', or 'regenerate' on failure/timeout.
   */
  async claimAndWait(signals: ResolveSignals, freshness: string): Promise<ClaimResult> {
    const outcome = await this.flight.claim(signals, freshness);
    if (outcome.role === 'hit') {
      return {
        kind: 'hit',
        reportId: outcome.reportId,
        createdAt: outcome.createdAt,
        layer: outcome.layer,
      };
    }
    if (outcome.role === 'driver') {
      await this.ctx.storage.setAlarm(Date.now() + GENERATION_TIMEOUT_MS);
      return { kind: 'driver' };
    }
    try {
      const result = await outcome.result;
      return { kind: 'ready', reportId: result.reportId, createdAt: result.createdAt };
    } catch {
      return { kind: 'regenerate' };
    }
  }

  /** Driver succeeded: cache under every layer, wake waiters, disarm the crash alarm. */
  async complete(
    recordAs: DedupPayload[],
    freshness: string,
    result: GeneratorResult,
  ): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.flight.complete(recordAs, freshness, result);
  }

  /** Driver failed/aborted: release waiters to regenerate, disarm the alarm. */
  async fail(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    this.flight.fail();
  }

  /** Crash safety: a driver that never settled → release waiters so the next request regenerates. */
  async alarm(): Promise<void> {
    this.flight.fail(new Error('generation timed out'));
  }
}
