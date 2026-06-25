// F2 — single-flight report generation (coordinator).
//
// One generation per key, ever. Two people asking the same fixed-period question concurrently must
// collapse onto ONE generation, not race two that could diverge (a #97 violation). The Durable
// Object addressed `idFromName(L2key)` routes every request for a key to one isolate; this
// coordinator is what then collapses the concurrent calls inside that isolate onto a single shared
// in-flight promise. JS is single-threaded within an isolate, so a shared promise IS the lock —
// no extra synchronisation needed. See docs/spec/ai-assistant-dedup.md §3.
//
// The DO key folds the freshness token (L2 keys do — see dedup.ts), so one instance is implicitly
// pinned to one freshness: a data refresh changes the L2 key, hence idFromName, hence the isolate.
// We therefore take freshness per-run rather than per-instance and do not re-check it here.
//
// Fail toward regeneration everywhere: a KV hit whose R2 artifact was GC'd is a miss; a generator
// throw clears the flight so the next request regenerates; a failed cache write is swallowed.

import {
  record,
  resolveReport,
  type DedupKv,
  type DedupHit,
  type DedupLayer,
  type DedupPayload,
  type ResolveSignals,
} from './dedup';

export type ProgressPhase = 'planning' | 'querying' | 'composing' | 'binding';

export interface ProgressEvent {
  phase: ProgressPhase;
  label: string;
}

/** A finished report. `createdAt` is the generator's ISO timestamp (not read from a clock here). */
export interface GeneratorResult {
  reportId: string;
  createdAt: string;
}

/** Supplied by the orchestrator/chat route. Emits coarse progress; resolves to the report. */
export type Generator = (emit: (event: ProgressEvent) => void) => Promise<GeneratorResult>;

export type ProgressSubscriber = (event: ProgressEvent) => void;

export interface SingleFlightDeps {
  kv: DedupKv;
  /** True iff the report artifact still exists in R2. A GC'd artifact ⇒ treat any KV hit as a miss. */
  r2Exists: (reportId: string) => Promise<boolean>;
}

export interface ResolveOutcome {
  reportId: string;
  createdAt: string;
  /** true = served from cache (KV hit + R2 present), no generation ran. */
  deduped: boolean;
  /** Which dedup layer produced a cache hit; absent when freshly generated. */
  layer?: DedupLayer;
}

/**
 * One instance per key (one per DO instance). Collapses concurrent `run` calls onto a single
 * generation and rebroadcasts that generation's coarse progress to every waiter.
 */
export class SingleFlight {
  private inFlight: Promise<ResolveOutcome> | null = null;
  private readonly subscribers = new Set<ProgressSubscriber>();
  private lastProgress: ProgressEvent | null = null;

  constructor(private readonly deps: SingleFlightDeps) {}

  /**
   * Resolve a report: serve a live cache hit, else run (or join) the single generation for this key.
   * @param recordAs the layer key the freshly generated report is cached under (typically L2/L2.5).
   * @param onProgress receives coarse progress; late waiters immediately get the last event (catch-up).
   */
  async run(
    freshness: string,
    signals: ResolveSignals,
    recordAs: DedupPayload,
    generator: Generator,
    onProgress?: ProgressSubscriber,
  ): Promise<ResolveOutcome> {
    const hit = await this.resolveLive(signals, freshness);
    if (hit) {
      return { reportId: hit.reportId, createdAt: hit.createdAt, deduped: true, layer: hit.layer };
    }

    if (onProgress) {
      this.subscribers.add(onProgress);
      if (this.lastProgress) onProgress(this.lastProgress);
    }

    // First caller becomes the leader and starts the one generation; the rest await the same promise.
    if (!this.inFlight) {
      this.inFlight = this.generate(freshness, recordAs, generator).finally(() => {
        this.inFlight = null;
        this.subscribers.clear();
        this.lastProgress = null;
      });
    }

    try {
      return await this.inFlight;
    } finally {
      if (onProgress) this.subscribers.delete(onProgress);
    }
  }

  /** A cache hit counts only if its R2 artifact still exists; any error falls toward regeneration. */
  private async resolveLive(signals: ResolveSignals, freshness: string): Promise<DedupHit | null> {
    const hit = await resolveReport(this.deps.kv, signals, freshness);
    if (!hit) return null;
    try {
      return (await this.deps.r2Exists(hit.reportId)) ? hit : null;
    } catch {
      return null;
    }
  }

  private async generate(
    freshness: string,
    recordAs: DedupPayload,
    generator: Generator,
  ): Promise<ResolveOutcome> {
    // Throws propagate to every waiter; the `.finally` above clears the flight so the next call retries.
    const result = await generator((event) => this.broadcast(event));
    await record(this.deps.kv, recordAs, freshness, result).catch(() => {
      // best-effort cache write; a lost write just causes a future miss (regeneration)
    });
    return { reportId: result.reportId, createdAt: result.createdAt, deduped: false };
  }

  private broadcast(event: ProgressEvent): void {
    this.lastProgress = event;
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch {
        // a faulty subscriber must not break generation or starve other waiters
      }
    }
  }
}
