import { describe, expect, it } from 'vitest';
import { isPhasePart } from './stream';

describe('isPhasePart', () => {
  it('accepts each of the three valid phase keys', () => {
    expect(isPhasePart({ type: 'data-phase', data: { phase: 'thinking' } })).toBe(true);
    expect(isPhasePart({ type: 'data-phase', data: { phase: 'querying' } })).toBe(true);
    expect(isPhasePart({ type: 'data-phase', data: { phase: 'composing' } })).toBe(true);
  });

  it('rejects a part whose type is not data-phase', () => {
    expect(isPhasePart({ type: 'data-report-ready', data: { phase: 'thinking' } })).toBe(false);
  });

  it('rejects a phase part with no data', () => {
    expect(isPhasePart({ type: 'data-phase' })).toBe(false);
  });

  it('rejects an unknown phase key', () => {
    expect(isPhasePart({ type: 'data-phase', data: { phase: 'running' } })).toBe(false);
  });

  it('rejects a non-string phase', () => {
    expect(isPhasePart({ type: 'data-phase', data: { phase: 2 } })).toBe(false);
  });
});
