import { describe, expect, it } from 'vitest';
import { seedFor, makeRng } from '../src/rng.js';

describe('rng', () => {
  it('same seed produces identical first 100 draws', () => {
    const rngA = makeRng(seedFor(42, 'L1-M1'));
    const rngB = makeRng(seedFor(42, 'L1-M1'));
    const a = Array.from({ length: 100 }, () => rngA.next());
    const b = Array.from({ length: 100 }, () => rngB.next());
    expect(a).toEqual(b);
  });

  it('different machineId produces a different stream', () => {
    const rngA = makeRng(seedFor(42, 'L1-M1'));
    const rngB = makeRng(seedFor(42, 'L1-M2'));
    const a = Array.from({ length: 20 }, () => rngA.next());
    const b = Array.from({ length: 20 }, () => rngB.next());
    expect(a).not.toEqual(b);
  });

  it('draws stay within [0, 1)', () => {
    const rng = makeRng(seedFor(1, 'X'));
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('uniform stays within [a, b)', () => {
    const rng = makeRng(seedFor(1, 'X'));
    for (let i = 0; i < 500; i++) {
      const v = rng.uniform(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it('exponential draws are non-negative and roughly match the mean over many draws', () => {
    const rng = makeRng(seedFor(1, 'X'));
    const n = 5000;
    const mean = 100;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.exponential(mean);
      expect(v).toBeGreaterThanOrEqual(0);
      sum += v;
    }
    expect(sum / n).toBeGreaterThan(mean * 0.85);
    expect(sum / n).toBeLessThan(mean * 1.15);
  });

  it('triangular draws stay within [min, max]', () => {
    const rng = makeRng(seedFor(1, 'X'));
    for (let i = 0; i < 500; i++) {
      const v = rng.triangular(0.5, 1.0, 1.8);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(1.8);
    }
  });
});
