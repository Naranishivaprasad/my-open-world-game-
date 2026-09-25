/**
 * Seeded deterministic RNG (mulberry32).
 *
 * The city must be identical on every load and must NOT change because a React
 * component re-rendered (spec 33). All procedural placement goes through here
 * with an explicit, stable seed.
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for deriving sub-seeds from names. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const randRange = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export const randInt = (rng: Rng, min: number, max: number) => Math.floor(randRange(rng, min, max + 1));
export const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
export const chance = (rng: Rng, p: number) => rng() < p;
