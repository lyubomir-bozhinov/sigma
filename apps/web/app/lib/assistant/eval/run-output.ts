// The normalized capture of one assistant turn, as observed from the CLIENT wire.
//
// The live SSE stream forwards only an allowlist (stream-phase.ts): conversational text, phase markers,
// the redacted `emit_report`, and `data-report-ready`. It DROPS run_sql's SQL, its D1 rows, and tool
// names. So this shape deliberately carries NO sql/rows/tool-args — the eval scores the ANSWER the user
// sees (the resolved report), never the SQL behind it. SQL-level guarantees are locked deterministically
// in the guard/golden suites, not here.

import type { ResolvedReport } from '../report-schema';

export interface RunOutput {
  /** The resolved report the client rendered, or null when the turn produced none. */
  report: ResolvedReport | null;
  /** The assistant honestly declined (no data / could-not-compose text), distinct from a crash. */
  declined: boolean;
  /** A transport/provider failure (e.g. 500 token overflow, 429 rate limit, 403 gate). */
  error?: { status: number };
  /** The UIMessageChunk `type`s observed, in order — drives the shape-contract test against wire drift. */
  chunks: string[];
}
