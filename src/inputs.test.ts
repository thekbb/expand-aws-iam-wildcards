import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLLAPSE_THRESHOLD,
  parseCollapseThreshold,
} from './inputs.js';

describe('parseCollapseThreshold', () => {
  it('returns the default threshold for undefined input', () => {
    expect(parseCollapseThreshold(undefined)).toBe(DEFAULT_COLLAPSE_THRESHOLD);
  });

  it('returns the default threshold for empty input', () => {
    expect(parseCollapseThreshold('')).toBe(DEFAULT_COLLAPSE_THRESHOLD);
    expect(parseCollapseThreshold('   ')).toBe(DEFAULT_COLLAPSE_THRESHOLD);
  });

  it('parses a normal integer threshold', () => {
    expect(parseCollapseThreshold('5')).toBe(5);
    expect(parseCollapseThreshold('12')).toBe(12);
  });

  it('allows zero', () => {
    expect(parseCollapseThreshold('0')).toBe(0);
  });

  it('rejects negative thresholds', () => {
    expect(() => parseCollapseThreshold('-1')).toThrow(
      'Invalid collapse-threshold input: "-1". Expected a non-negative safe integer.',
    );
  });

  it('rejects decimal thresholds', () => {
    expect(() => parseCollapseThreshold('3.5')).toThrow(
      'Invalid collapse-threshold input: "3.5". Expected a non-negative safe integer.',
    );
  });

  it('rejects non-numeric thresholds', () => {
    expect(() => parseCollapseThreshold('five')).toThrow(
      'Invalid collapse-threshold input: "five". Expected a non-negative safe integer.',
    );
  });

  it('rejects thresholds above Number.MAX_SAFE_INTEGER', () => {
    expect(() => parseCollapseThreshold('9007199254740993')).toThrow(
      'Invalid collapse-threshold input: "9007199254740993". Expected a non-negative safe integer.',
    );
  });
});
