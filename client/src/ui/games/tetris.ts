import { nextRandom } from './rng';

// Cubetris, the phone's falling-block puzzle (a Tetris clone), as pure state transitions: every move returns a new
// state (or the same object when nothing changed), and the component only times and draws them.

export const COLS = 10;
export const ROWS = 20;

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Each piece in its spawn orientation inside its square box; rotating turns the whole box. */
const SHAPES: Record<PieceType, string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
};

type Offsets = [number, number][];

function cellsOf(rows: string[]): Offsets {
  const out: Offsets = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c === 'X' && out.push([x, y])));
  return out;
}

/** Turns an n-by-n box a quarter turn clockwise. */
function turn(rows: string[]): string[] {
  const n = rows.length;
  return rows.map((_, y) => rows.map((__, x) => rows[n - 1 - x][y]).join(''));
}

/** Cell offsets for every piece and rotation (0 = spawn, then clockwise). */
const ROTATIONS = Object.fromEntries(
  PIECES.map((t) => {
    const r: string[][] = [SHAPES[t]];
    for (let i = 1; i < 4; i++) r.push(turn(r[i - 1]));
    return [t, r.map(cellsOf)];
  }),
) as Record<PieceType, Offsets[]>;

export type Cell = PieceType | null;
/** [row][col], row 0 at the top. */
export type Board = Cell[][];

/** x, y: the top-left corner of the piece's box on the board. */
export interface Piece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

export interface TetrisState {
  board: Board;
  piece: Piece;
  /** Upcoming pieces, next first; refilled a shuffled bag of all seven at a time. */
  queue: PieceType[];
  seed: number;
  score: number;
  lines: number;
  level: number;
  over: boolean;
  /** Rows cleared by the most recent lock (before the stack fell), for the flash. */
  cleared: number[];
  /** Counts locked pieces, so the component can tell a new lock from an old one. */
  locks: number;
}

export const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));

/** Where a piece's cells are on the board. */
export function pieceCells(p: Piece): Offsets {
  return ROTATIONS[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
}

/** Cells of a piece in its spawn orientation, for the "next" preview. */
export const previewCells = (t: PieceType): Offsets => ROTATIONS[t][0];

/** True when the piece is off the sides or bottom, or overlaps the stack. Above the top is allowed. */
export function collides(board: Board, p: Piece): boolean {
  return pieceCells(p).some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== null));
}

/** A new piece at the top middle, its first filled row on row 0. */
export function spawn(type: PieceType): Piece {
  const size = SHAPES[type].length;
  const top = Math.min(...ROTATIONS[type][0].map(([, y]) => y));
  return { type, rot: 0, x: Math.floor((COLS - size) / 2), y: -top };
}

function fillQueue(queue: PieceType[], seed: number): { queue: PieceType[]; seed: number } {
  const q = [...queue];
  let s = seed;
  while (q.length < PIECES.length) {
    const bag = [...PIECES];
    for (let i = bag.length - 1; i > 0; i--) {
      const [r, next] = nextRandom(s);
      s = next;
      const j = Math.floor(r * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    q.push(...bag);
  }
  return { queue: q, seed: s };
}

export function newTetris(seed: number): TetrisState {
  const filled = fillQueue([], seed);
  const [first, ...queue] = filled.queue;
  const more = fillQueue(queue, filled.seed);
  return { board: emptyBoard(), piece: spawn(first), queue: more.queue, seed: more.seed, score: 0, lines: 0, level: 1, over: false, cleared: [], locks: 0 };
}

/** Milliseconds between gravity steps: a bit faster every level, never below 80. */
export const dropMs = (level: number) => Math.max(80, Math.round(800 * 0.85 ** (level - 1)));

const LINE_SCORES = [0, 100, 300, 500, 800];

/** Removes full rows; the rows above fall into their place. */
export function clearLines(board: Board): { board: Board; rows: number[] } {
  const rows: number[] = [];
  const kept = board.filter((row, y) => {
    const full = row.every((c) => c !== null);
    if (full) rows.push(y);
    return !full;
  });
  if (!rows.length) return { board, rows };
  const fresh = Array.from({ length: rows.length }, () => Array<Cell>(COLS).fill(null));
  return { board: [...fresh, ...kept], rows };
}

/** Moves the piece if it fits; returns the same state object when it doesn't. */
export function move(s: TetrisState, dx: number, dy = 0): TetrisState {
  if (s.over) return s;
  const piece = { ...s.piece, x: s.piece.x + dx, y: s.piece.y + dy };
  return collides(s.board, piece) ? s : { ...s, piece };
}

// Wall kicks: nudges tried in order when a rotation doesn't fit where it is.
const KICKS: Offsets = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];
const KICKS_I: Offsets = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
];

/** Rotates clockwise (1) or counter-clockwise (-1), kicking off walls and the stack when it has to. */
export function rotate(s: TetrisState, dir: 1 | -1 = 1): TetrisState {
  if (s.over || s.piece.type === 'O') return s;
  const rot = (s.piece.rot + dir + 4) % 4;
  for (const [kx, ky] of s.piece.type === 'I' ? KICKS_I : KICKS) {
    const piece = { ...s.piece, rot, x: s.piece.x + kx, y: s.piece.y + ky };
    if (!collides(s.board, piece)) return { ...s, piece };
  }
  return s;
}

/** How far the piece can fall. */
export function dropDistance(s: TetrisState): number {
  let d = 0;
  while (!collides(s.board, { ...s.piece, y: s.piece.y + d + 1 })) d++;
  return d;
}

/** Fixes the piece into the stack, clears lines, scores them and brings in the next piece. */
export function lock(s: TetrisState): TetrisState {
  if (s.over) return s;
  const cells = pieceCells(s.piece);
  const board = s.board.map((row) => [...row]);
  let toppedOut = false;
  for (const [x, y] of cells) {
    if (y < 0) toppedOut = true;
    else board[y][x] = s.piece.type;
  }
  const { board: after, rows } = clearLines(board);
  const lines = s.lines + rows.length;
  const score = s.score + LINE_SCORES[rows.length] * s.level;
  const level = 1 + Math.floor(lines / 10);
  const [nextType, ...rest] = s.queue;
  const filled = fillQueue(rest, s.seed);
  const piece = spawn(nextType);
  const over = toppedOut || collides(after, piece);
  return { board: after, piece, queue: filled.queue, seed: filled.seed, score, lines, level, over, cleared: rows, locks: s.locks + 1 };
}

/** One gravity step: fall a row, or lock when it's resting on something. */
export function tick(s: TetrisState): TetrisState {
  if (s.over) return s;
  const moved = move(s, 0, 1);
  return moved === s ? lock(s) : moved;
}

/** Down arrow: fall a row for a point, or lock. */
export function softDrop(s: TetrisState): TetrisState {
  if (s.over) return s;
  const moved = move(s, 0, 1);
  return moved === s ? lock(s) : { ...moved, score: moved.score + 1 };
}

/** Space: straight to the bottom (two points a row) and lock. */
export function hardDrop(s: TetrisState): TetrisState {
  if (s.over) return s;
  const d = dropDistance(s);
  return lock({ ...s, piece: { ...s.piece, y: s.piece.y + d }, score: s.score + d * 2 });
}
