import { clamp, round2 } from '@sigma/shared';

export interface BidParticipation {
  bidderId: string;
  tenderIds: string[];
}

/**
 * Co-bidding signal: bidders that repeatedly appear together across the same
 * tenders may indicate coordination. Returns 0–100 for the `cartel` signal of
 * the given tender, based on average pairwise Jaccard overlap of their tender
 * histories.
 */
export function detectCoBidding(tenderId: string, participation: BidParticipation[]): number {
  const present = participation.filter((p) => p.tenderIds.includes(tenderId));
  if (present.length < 2) return 0;

  let pairScore = 0;
  let pairs = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i]!;
      const b = present[j]!;
      const shared = a.tenderIds.filter((t) => b.tenderIds.includes(t)).length;
      const union = new Set([...a.tenderIds, ...b.tenderIds]).size;
      if (union > 0) {
        pairScore += shared / union;
        pairs += 1;
      }
    }
  }
  if (pairs === 0) return 0;
  return round2(clamp((pairScore / pairs) * 100, 0, 100));
}
