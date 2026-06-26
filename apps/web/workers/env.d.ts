interface Env {
  LOG_IP_KEY?: string;
  REPORT_STORE?: R2Bucket;
  BGGPT_API_KEY?: string;
  ASSISTANT_MAX_STEPS?: string; // default 6
  CHAT_RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  BROWSER?: Fetcher;
}
