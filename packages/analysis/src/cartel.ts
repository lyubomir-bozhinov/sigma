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
      const aTenders = new Set(a.tenderIds.filter((t) => t !== tenderId));
      const bTenders = new Set(b.tenderIds.filter((t) => t !== tenderId));
      const shared = [...aTenders].filter((t) => bTenders.has(t)).length;
      const union = new Set([...aTenders, ...bTenders]).size;
      const ratio = union > 0 ? clamp(shared / union, 0, 1) : 0;
      pairScore += ratio;
      pairs += 1;
    }
  }
  if (pairs === 0) return 0;
  return round2(clamp((pairScore / pairs) * 100, 0, 100));
}
