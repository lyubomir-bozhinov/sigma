// Cache-Control for public, anonymous pages: serve from the edge and revalidate
// in the background. See docs/architecture/ADR-0001 (§2 rendering).
export function publicCache(maxAgeSeconds: number, staleWhileRevalidateSeconds = 86_400): string {
  return `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}
