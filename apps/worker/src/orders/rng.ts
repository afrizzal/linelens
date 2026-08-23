/**
 * Seeded deterministic randomness for order generation (04-01-PLAN.md Task
 * 1: "seeded rng from contracts + sim-day as salt -> deterministic").
 *
 * Deliberately a self-contained mirror of apps/simulator/src/rng.ts's
 * mulberry32 + FNV-1a hash — apps/worker cannot import from apps/simulator
 * (ARCHITECTURE.md "never direct imports across service boundaries, only
 * through contracts/db"), and this file is not part of the shared
 * @linelens/contracts package. Same algorithm, independent random stream
 * (seeded with a `${globalSeed}:orders:${simDay}` salt instead of a
 * machineId), so order generation and the simulator's own machine-state
 * randomness never collide or depend on each other.
 */

/** FNV-1a 32-bit hash, used to derive a deterministic per-sim-day seed. */
export const seedForDay = (globalSeed: number, simDay: string): number => {
  const input = `${globalSeed}:orders:${simDay}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** mulberry32: fast, deterministic 32-bit PRNG. Returns a function producing floats in [0, 1). */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface Rng {
  /** Uniform float draw in [0, 1). */
  next: () => number;
  /** Uniform float draw in [a, b). */
  uniform: (a: number, b: number) => number;
  /** Triangular distribution draw with the given min/mode/max. */
  triangular: (min: number, mode: number, max: number) => number;
}

/** Build a full Rng helper bundle, seeded deterministically for one sim-day. */
export const makeDayRng = (globalSeed: number, simDay: string): Rng => {
  const draw = mulberry32(seedForDay(globalSeed, simDay));
  const uniform = (a: number, b: number): number => a + draw() * (b - a);
  const triangular = (min: number, mode: number, max: number): number => {
    const u = draw();
    const fc = (mode - min) / (max - min);
    if (u < fc) {
      return min + Math.sqrt(u * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  };
  return { next: draw, uniform, triangular };
};
