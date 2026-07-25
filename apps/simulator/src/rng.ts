/**
 * Seeded deterministic randomness for the simulator (SIM-03/SIM-06).
 *
 * mulberry32 PRNG, seeded per-machine via an FNV-1a hash of
 * `${globalSeed}:${machineId}` so each machine gets its own independent,
 * reproducible stream — same global seed always reproduces the same
 * per-machine event sequence (speed-invariant, see machine.ts/plant.ts).
 */

/** FNV-1a 32-bit hash, used to derive a per-machine seed from the global seed + machineId. */
export const seedFor = (globalSeed: number, machineId: string): number => {
  const input = `${globalSeed}:${machineId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** mulberry32: fast, deterministic 32-bit PRNG. Returns a function producing floats in [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
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
  /** Exponential draw with the given mean (same units as meanMs), via inverse-CDF. */
  exponential: (mean: number) => number;
  /** Triangular distribution draw with the given min/mode/max. */
  triangular: (min: number, mode: number, max: number) => number;
}

/** Build a full Rng helper bundle from a mulberry32 draw function. */
export const makeRng = (seed: number): Rng => {
  const draw = mulberry32(seed);
  const uniform = (a: number, b: number): number => a + draw() * (b - a);
  const exponential = (mean: number): number => -mean * Math.log(1 - draw());
  const triangular = (min: number, mode: number, max: number): number => {
    const u = draw();
    const fc = (mode - min) / (max - min);
    if (u < fc) {
      return min + Math.sqrt(u * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  };
  return { next: draw, uniform, exponential, triangular };
};
