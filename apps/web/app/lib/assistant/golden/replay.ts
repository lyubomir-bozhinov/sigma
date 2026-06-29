// Golden replay driver — runs a fixture through the REAL server pipeline.
//
// For each recorded step it calls the live `runTool('run_sql', …)` (so every wired guard — the
// structural/AST/opcode read-only gates, the default-filter gate, the rows-read budget — runs exactly
// as in production), then calls the live `finalizeReport` to re-bind the emit against the server's own
// result handles. Nothing here re-implements pipeline logic: the harness only feeds recorded inputs and
// inspects the real outputs.

import { DEFAULT_ROWS_READ_BUDGET, finalizeReport, runTool, type ToolContext } from '../tools';
import type { BindResult } from '../report-schema';
import type { GoldenFixture, GoldenStep } from './types';

/** A run_sql return is a successful result handle iff it is a `forModel` head line (`R1 (колони: …)`). */
export const RESULT_HANDLE_RE = /^R\d+ \(/;

/** Both spellings of the rejection prefix run_sql emits when a guard refuses a query. */
export const REJECTION_RE = /^(?:Заявката е отхвърлена|Заявката е отхвырлена|Грешка)/;

const BENIGN_READ_PLAN = [{ opcode: 'Init' }, { opcode: 'ResultRow' }, { opcode: 'Halt' }];

/**
 * A minimal D1-like stub that satisfies BOTH probes `runSqlTool` issues, in order, per step:
 *   1. the opcode guard's `EXPLAIN <sql>` — answered with a benign all-allowlisted READ plan so the
 *      compiled-plan gate passes (the harness exercises the guard wiring, not SQLite itself);
 *   2. the real query — answered with the CURRENT step's recorded rows + zero-cost rows_read meta.
 * The step cursor advances only on non-EXPLAIN calls, so steps are consumed in recorded order.
 *
 * Typed/cast through `ToolContext['db']` rather than naming the `D1Database` worker global directly, so
 * the harness adds no dependency on the worker-types lib being present in a given tsc project graph.
 */
export function fakeDb(steps: GoldenStep[]): ToolContext['db'] {
  let stepIndex = 0;
  return {
    prepare(sql: string) {
      const isExplain = sql.startsWith('EXPLAIN ');
      return {
        bind() {
          return this;
        },
        async all<T>() {
          if (isExplain) {
            return { results: BENIGN_READ_PLAN as T[], meta: { rows_read: 0, total_attempts: 1 } };
          }
          const step = steps[stepIndex];
          stepIndex += 1;
          if (!step) {
            throw new Error(`fakeDb: no recorded step at index ${stepIndex - 1}`);
          }
          return {
            results: step.result.rows as T[],
            meta: { rows_read: 0, total_attempts: 1 },
          };
        },
        async first<T>() {
          return null as T;
        },
      };
    },
  } as unknown as ToolContext['db'];
}

export interface ReplayOutcome {
  ctx: ToolContext;
  /** The run_sql return string for each step, in order. */
  stepReturns: string[];
  /** The result of re-binding the recorded emit against the server-executed results. */
  bind: BindResult;
}

/**
 * Replay one fixture through the real pipeline: feed each recorded SQL to the live run_sql tool, then
 * finalize the recorded emit. Does NOT assert — it returns the raw pipeline outputs for assertions.ts /
 * the test to inspect (so a NEGATIVE fixture, whose emit is meant to fail binding, still replays here).
 */
export async function replayFixture(fixture: GoldenFixture): Promise<ReplayOutcome> {
  const ctx: ToolContext = {
    db: fakeDb(fixture.steps),
    results: [],
    userQuestion: fixture.prompt,
    rowsRead: 0,
    rowsReadBudget: DEFAULT_ROWS_READ_BUDGET,
  };

  const stepReturns: string[] = [];
  for (const step of fixture.steps) {
    stepReturns.push(await runTool('run_sql', { sql: step.sql }, ctx));
  }

  const bind = finalizeReport(fixture.emit, ctx);
  return { ctx, stepReturns, bind };
}
