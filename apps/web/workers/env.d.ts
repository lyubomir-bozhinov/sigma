interface Env {
  LOG_IP_KEY?: string;
  ASSISTANT_HMAC_KEY?: string;
  /** R2 bucket for persisted AI reports — bound by Lane C4 (persist lane). Optional until C4 deploys. */
  REPORTS?: R2Bucket;
  /** Turnstile secret (Lane H3 edge gate). SECRET — `wrangler secret put`. Absent → gate is a no-op. */
  TURNSTILE_SECRET?: string;
  /** Turnstile widget site key (public) — read by the client dock to render the invisible widget. */
  TURNSTILE_SITE_KEY?: string;
  /** AI-assistant report dedup cache (Lane F). Optional: a missing binding just disables dedup. */
  DEDUP_KV?: KVNamespace;
  /** One single-flight coordinator per freshness-folded dedup key (Lane F). Optional until provisioned. */
  REPORT_SINGLE_FLIGHT?: DurableObjectNamespace<
    import('./assistant/report-single-flight').ReportSingleFlight
  >;
  /** Build/config version for the dedup freshness token `c` (Lane F). */
  BUILD_ID?: string;
}
