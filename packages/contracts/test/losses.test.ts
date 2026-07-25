import { describe, expect, it } from 'vitest';
import { LOSS_FACTOR, SIX_BIG_LOSSES } from '../src/losses.js';
import { REASON_CODES } from '../src/reasons.js';
import * as lossesModule from '../src/losses.js';

describe('LOSS_FACTOR', () => {
  it('maps all 6 categories to a valid OeeFactor', () => {
    for (const category of SIX_BIG_LOSSES) {
      expect(['AVAILABILITY', 'PERFORMANCE', 'QUALITY']).toContain(LOSS_FACTOR[category]);
    }
    expect(Object.keys(LOSS_FACTOR)).toHaveLength(6);
  });

  it('classifies SMALL_STOPS as PERFORMANCE, never AVAILABILITY', () => {
    expect(LOSS_FACTOR.SMALL_STOPS).toBe('PERFORMANCE');
  });

  it.each([
    ['UNPLANNED_STOPS', 'AVAILABILITY'],
    ['PLANNED_STOPS', 'AVAILABILITY'],
    ['SMALL_STOPS', 'PERFORMANCE'],
    ['SLOW_CYCLES', 'PERFORMANCE'],
    ['STARTUP_REJECTS', 'QUALITY'],
    ['PRODUCTION_REJECTS', 'QUALITY'],
  ] as const)('%s -> %s', (loss, factor) => {
    expect(LOSS_FACTOR[loss]).toBe(factor);
  });
});

describe('REASON_CODES', () => {
  it('every reason category is a valid SixBigLoss', () => {
    for (const reason of REASON_CODES) {
      expect(SIX_BIG_LOSSES).toContain(reason.category);
    }
  });

  it('has no duplicate codes', () => {
    const codes = REASON_CODES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('anti-pattern guard', () => {
  it('exports no duration-threshold constant', () => {
    const exportedNames = Object.keys(lossesModule);
    const suspicious = exportedNames.filter((n) => /threshold|minute|minMs|cutoff/i.test(n));
    expect(suspicious).toEqual([]);
  });
});
