import { describe, expect, it } from 'vitest';
import { detectCoBidding } from './cartel';

describe('detectCoBidding', () => {
  it('scores first-time co-bidders as zero', () => {
    expect(
      detectCoBidding('tender-1', [
        { bidderId: 'bidder-a', tenderIds: ['tender-1'] },
        { bidderId: 'bidder-b', tenderIds: ['tender-1'] },
      ]),
    ).toBe(0);
  });

  it('deduplicates tender histories so the score cannot exceed 100', () => {
    expect(
      detectCoBidding('tender-1', [
        { bidderId: 'bidder-a', tenderIds: ['tender-1', 'tender-2', 'tender-2', 'tender-2'] },
        { bidderId: 'bidder-b', tenderIds: ['tender-1', 'tender-2'] },
      ]),
    ).toBeLessThanOrEqual(100);
  });

  it('scores normal overlap across other tenders', () => {
    expect(
      detectCoBidding('tender-1', [
        { bidderId: 'bidder-a', tenderIds: ['tender-1', 'tender-2', 'tender-3'] },
        { bidderId: 'bidder-b', tenderIds: ['tender-1', 'tender-2', 'tender-4'] },
      ]),
    ).toBe(33.33);
  });
});
