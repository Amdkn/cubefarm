// What the phone games keep in this browser: best scores and the desk pet. Storage can throw (private windows,
// blocked site data), and then the games simply don't remember.

export function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: nothing is remembered
  }
}

export type ScoredGame = 'tetris' | 'snake';
const BEST_KEY = 'cubefarm:games:best';

export function bestScore(game: ScoredGame): number {
  const raw = readJson(BEST_KEY) as Partial<Record<ScoredGame, unknown>> | null;
  const v = Number(raw?.[game]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Records a finished game's score; true when it's a new best. */
export function recordScore(game: ScoredGame, score: number): boolean {
  if (score <= bestScore(game)) return false;
  const raw = readJson(BEST_KEY);
  writeJson(BEST_KEY, { ...(raw && typeof raw === 'object' ? raw : {}), [game]: score });
  return true;
}
