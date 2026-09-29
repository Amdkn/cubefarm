import { nextRandom } from './rng';

// Cable Snake, the phone's Snake clone: a network cable that crawls around the office carpet eating bugs (and the
// odd coffee), growing longer with every one. Pure state transitions; the component times and draws them.

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Pt {
  x: number;
  y: number;
}
export type FoodKind = 'bug' | 'coffee';
export type SnakeEnd = 'wall' | 'self' | 'desk' | 'won';

export interface SnakeState {
  cols: number;
  rows: number;
  /** Head first. */
  body: Pt[];
  dir: Dir;
  /** Turns pressed but not taken yet (two at most), so quick double taps both count. */
  queue: Dir[];
  /** Cells taken by desks, which the cable can't cross. */
  desks: Pt[];
  food: Pt & { kind: FoodKind };
  /** Segments still to add: the tail stays put while this is above zero. */
  grow: number;
  score: number;
  eaten: number;
  seed: number;
  over: SnakeEnd | null;
  /** What the latest step ate, for the chomp sound and the pop. */
  ate: FoodKind | null;
}

const DELTA: Record<Dir, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Points for a bug and for a coffee (every fifth snack is a coffee). */
export const POINTS: Record<FoodKind, number> = { bug: 10, coffee: 50 };
const GROWTH: Record<FoodKind, number> = { bug: 1, coffee: 2 };

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** Four two-cell desks near the corners, clear of the starting row. */
export function deskCells(cols: number, rows: number): Pt[] {
  const left = Math.floor(cols * 0.2);
  const right = cols - left - 2;
  const top = Math.floor(rows * 0.2);
  const bottom = rows - top - 1;
  return [left, right].flatMap((x) => [top, bottom].flatMap((y) => [{ x, y }, { x: x + 1, y }]));
}

/** A random free cell for the next snack, or null when the cable fills the office. */
export function placeFood(cols: number, rows: number, taken: Pt[], seed: number): { at: Pt | null; seed: number } {
  const blocked = new Set(taken.map((p) => p.y * cols + p.x));
  const free: Pt[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!blocked.has(y * cols + x)) free.push({ x, y });
  if (!free.length) return { at: null, seed };
  const [r, next] = nextRandom(seed);
  return { at: free[Math.floor(r * free.length)], seed: next };
}

export function newSnake(seed: number, cols = 16, rows = 16): SnakeState {
  const y = Math.floor(rows / 2);
  const x = Math.floor(cols / 2) - 1;
  const body = [0, 1, 2].map((i) => ({ x: x - i, y }));
  const desks = deskCells(cols, rows);
  const placed = placeFood(cols, rows, [...body, ...desks], seed);
  return { cols, rows, body, dir: 'right', queue: [], desks, food: { ...(placed.at ?? { x: 0, y: 0 }), kind: 'bug' }, grow: 0, score: 0, eaten: 0, seed: placed.seed, over: null, ate: null };
}

/** Queues a turn. Reversing into yourself, repeating a direction and a third queued turn are ignored. */
export function turn(s: SnakeState, dir: Dir): SnakeState {
  if (s.over) return s;
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (dir === last || dir === OPPOSITE[last] || s.queue.length >= 2) return s;
  return { ...s, queue: [...s.queue, dir] };
}

/** One move forward: turn if a turn is queued, then crawl, eat, grow or crash. */
export function step(s: SnakeState): SnakeState {
  if (s.over) return s;
  const [dir = s.dir, ...queue] = s.queue;
  const d = DELTA[dir];
  const head = { x: s.body[0].x + d.x, y: s.body[0].y + d.y };
  const end = (over: SnakeEnd): SnakeState => ({ ...s, dir, queue, over, ate: null });
  if (head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows) return end('wall');
  if (s.desks.some((p) => same(p, head))) return end('desk');
  // The tail moves out of the way this step unless the cable is growing.
  const stays = s.grow > 0 ? s.body : s.body.slice(0, -1);
  if (stays.some((p) => same(p, head))) return end('self');
  const body = [head, ...stays];
  let grow = Math.max(0, s.grow - 1);
  if (!same(head, s.food)) return { ...s, body, dir, queue, grow, ate: null };

  const kind = s.food.kind;
  const eaten = s.eaten + 1;
  grow += GROWTH[kind];
  const placed = placeFood(s.cols, s.rows, [...body, ...s.desks], s.seed);
  const next = { ...s, body, dir, queue, grow, eaten, score: s.score + POINTS[kind], seed: placed.seed, ate: kind };
  if (!placed.at) return { ...next, over: 'won' };
  return { ...next, food: { ...placed.at, kind: (eaten + 1) % 5 === 0 ? 'coffee' : 'bug' } };
}

/** Milliseconds per step: quicker with every snack, never below 70. */
export const stepMs = (s: SnakeState) => Math.max(70, 165 - s.eaten * 4);
