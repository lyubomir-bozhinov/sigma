import { describe, expect, it } from 'vitest';
import { chooseToolChoice, resolveMaxSteps } from './agent';

describe('resolveMaxSteps', () => {
  it('uses the default for a missing or non-numeric value', () => {
    expect(resolveMaxSteps(undefined)).toBe(6);
    expect(resolveMaxSteps('')).toBe(6);
    expect(resolveMaxSteps('abc')).toBe(6);
  });

  it('falls back to the default for 0 or a negative value (never stalls the loop)', () => {
    expect(resolveMaxSteps('0')).toBe(6);
    expect(resolveMaxSteps('-4')).toBe(6);
  });

  it('clamps an over-large value to the hard ceiling (never uncaps BgGPT calls)', () => {
    expect(resolveMaxSteps('9999')).toBe(20);
  });

  it('passes a sane in-range value through (flooring fractions)', () => {
    expect(resolveMaxSteps('3')).toBe(3);
    expect(resolveMaxSteps('20')).toBe(20);
    expect(resolveMaxSteps('4.9')).toBe(4);
  });
});

describe('chooseToolChoice', () => {
  const base = {
    stepNumber: 2,
    maxSteps: 6,
    hasResults: true,
    reportEmitted: false,
    lastStepFailedEmit: false,
  };

  it('forces a real tool call on the first step (no prose narration of the call)', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 0 })).toBe('required');
  });

  it('lets the model choose freely mid-turn', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 2 })).toBe('auto');
  });

  it('forces emit_report near the budget when data exists but no report yet (no silent turn)', () => {
    // maxSteps 6 → final two steps are 4 and 5.
    expect(chooseToolChoice({ ...base, stepNumber: 4 })).toEqual({
      type: 'tool',
      toolName: 'emit_report',
    });
    expect(chooseToolChoice({ ...base, stepNumber: 5 })).toEqual({
      type: 'tool',
      toolName: 'emit_report',
    });
  });

  it('does NOT force-finalize once a valid report already exists', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 5, reportEmitted: true })).toBe('auto');
  });

  it('does NOT force emit_report near the budget when there is no data to bind', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 5, hasResults: false })).toBe('auto');
  });

  it('forces a retry after a failed emit_report (mid-turn)', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 2, lastStepFailedEmit: true })).toBe('required');
  });

  it('near-budget force-finalize takes precedence over the failed-emit retry', () => {
    expect(chooseToolChoice({ ...base, stepNumber: 5, lastStepFailedEmit: true })).toEqual({
      type: 'tool',
      toolName: 'emit_report',
    });
  });
});
