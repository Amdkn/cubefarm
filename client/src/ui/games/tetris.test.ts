import { describe, expect, it } from 'vitest';
import { COLS, PIECES, ROWS, clearLines, collides, dropMs, emptyBoard, hardDrop, lock, move, newTetris, pieceCells, rotate, softDrop, spawn, tick, type Board, type PieceType, type TetrisState } from './tetris';

const withPiece = (s: TetrisState, type: PieceType, x?: number, y?: number): TetrisState => {
  const p = spawn(type);
  return { ...s, piece: { ...p, x: x ?? p.x, y: y ?? p.y } };
};
const sorted = (cells: [number, number][]) => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

describe('pieces', () => {
  it('spawn at the top middle with their first row on row 0', () => {
    for (const t of PIECES) {
      const cells = pieceCells(spawn(t));
      expect(Math.min(...cells.map(([, y]) => y))).toBe(0);
      const xs = cells.map(([x]) => x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(3);
      expect(Math.max(...xs)).toBeLessThanOrEqual(6);
    }
  });

  it('rotate a T clockwise and back', () => {
    const s = withPiece(newTetris(1), 'T', 3, 5);
    const r = rotate(s, 1);
    expect(sorted(pieceCells(r.piece))).toEqual(sorted([[4, 5], [4, 6], [5, 6], [4, 7]]));
    expect(sorted(pieceCells(rotate(r, -1).piece))).toEqual(sorted(pieceCells(s.piece)));
  });

  it('come back to the start after four turns', () => {
    for (const t of PIECES) {
      let s = withPiece(newTetris(2), t, 3, 6);
      for (let i = 0; i < 4; i++) s = rotate(s, 1);
      expect(sorted(pieceCells(s.piece))).toEqual(sorted(pieceCells(withPiece(newTetris(2), t, 3, 6).piece)));
    }
  });

  it('leaves the O alone when rotating', () => {
    const s = withPiece(newTetris(3), 'O');
    expect(rotate(s)).toBe(s);
  });

  it('kicks off the wall instead of refusing to rotate', () => {
    // A vertical I against the left wall: rotating it flat has to shift it right.
    let s = withPiece(newTetris(4), 'I', 0, 5);
    s = rotate(s, 1); // vertical, in column 2 of its box
    while (move(s, -1) !== s) s = move(s, -1);
    expect(Math.min(...pieceCells(s.piece).map(([x]) => x))).toBe(0);
    const flat = rotate(s, 1);
    expect(flat).not.toBe(s);
    expect(collides(flat.board, flat.piece)).toBe(false);
    expect(new Set(pieceCells(flat.piece).map(([, y]) => y)).size).toBe(1);
  });
});

describe('moving', () => {
  it('stops at the walls', () => {
    let s = withPiece(newTetris(5), 'O');
    for (let i = 0; i < 20; i++) s = move(s, -1);
    expect(Math.min(...pieceCells(s.piece).map(([x]) => x))).toBe(0);
    expect(move(s, -1)).toBe(s);
    for (let i = 0; i < 20; i++) s = move(s, 1);
    expect(Math.max(...pieceCells(s.piece).map(([x]) => x))).toBe(COLS - 1);
  });

  it('soft drop scores a point a row and locks at the bottom', () => {
    let s = withPiece(newTetris(6), 'O');
    s = softDrop(s);
    expect(s.score).toBe(1);
    for (let i = 0; i < ROWS; i++) s = softDrop(s);
    expect(s.locks).toBe(1);
    expect(s.board[ROWS - 1].filter(Boolean)).toHaveLength(2);
  });

  it('hard drop goes straight down, scores two a row and locks', () => {
    const s = hardDrop(withPiece(newTetris(7), 'O'));
    expect(s.locks).toBe(1);
    expect(s.score).toBe((ROWS - 2) * 2);
    expect(s.board[ROWS - 1][4]).toBe('O');
    expect(s.board[ROWS - 2][5]).toBe('O');
  });

  it('gravity locks a resting piece and brings in the next one from the queue', () => {
    let s = withPiece(newTetris(8), 'O', 4, ROWS - 2);
    const next = s.queue[0];
    s = tick(s);
    expect(s.locks).toBe(1);
    expect(s.piece.type).toBe(next);
    expect(s.queue.length).toBeGreaterThanOrEqual(6);
  });
});

describe('lines', () => {
  it('clears full rows and drops the rest', () => {
    const board: Board = emptyBoard();
    board[ROWS - 1] = Array(COLS).fill('I');
    board[ROWS - 2] = Array(COLS).fill('T');
    board[ROWS - 2][3] = null;
    board[ROWS - 3][0] = 'S';
    const { board: after, rows } = clearLines(board);
    expect(rows).toEqual([ROWS - 1]);
    expect(after).toHaveLength(ROWS);
    expect(after[ROWS - 1][3]).toBeNull();
    expect(after[ROWS - 1][0]).toBe('T');
    expect(after[ROWS - 2][0]).toBe('S');
    expect(after[0].every((c) => c === null)).toBe(true);
  });

  it('scores by lines at once and levels up every ten lines', () => {
    const board = emptyBoard();
    // Four rows full except column 0, where a vertical I drops in.
    for (let y = ROWS - 4; y < ROWS; y++) board[y] = ['Z', ...Array(COLS - 1).fill('Z')].map((c, x) => (x === 0 ? null : c));
    let s: TetrisState = { ...newTetris(9), board, lines: 8, level: 1 };
    s = rotate(withPiece(s, 'I', 0, 0), 1); // stood up, then slid over to column 0
    while (move(s, -1) !== s) s = move(s, -1);
    s = hardDrop(s);
    expect(s.cleared).toHaveLength(4);
    expect(s.lines).toBe(12);
    expect(s.level).toBe(2);
    expect(s.score).toBeGreaterThanOrEqual(800);
    expect(s.board.every((row) => row.every((c) => c === null))).toBe(true);
  });

  it('ends the game when the stack reaches the top', () => {
    const board = emptyBoard();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 0) board[y][x] = 'L';
    const s = lock({ ...newTetris(10), board, piece: { type: 'I', rot: 1, x: -2, y: -3 } });
    expect(s.over).toBe(true);
    expect(tick(s)).toBe(s);
  });

  it('speeds up with the level but never below 80ms', () => {
    expect(dropMs(1)).toBe(800);
    expect(dropMs(5)).toBeLessThan(dropMs(4));
    expect(dropMs(99)).toBe(80);
  });
});

describe('the bag', () => {
  it('deals every piece once per seven', () => {
    const s = newTetris(11);
    const first7 = [s.piece.type, ...s.queue.slice(0, 6)];
    expect(new Set(first7).size).toBe(7);
  });

  it('is the same for the same seed', () => {
    expect(newTetris(42).queue).toEqual(newTetris(42).queue);
  });
});
