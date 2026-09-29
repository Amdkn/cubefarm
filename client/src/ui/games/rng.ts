// A seeded random number generator for the phone games, so their logic stays pure and testable: every
// function that needs luck takes a seed and hands back the next one.

/** mulberry32: the next number in [0, 1) and the seed to use after it. */
export function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
