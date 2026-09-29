import { describe, expect, it } from 'vitest';
import { POINTS, deskCells, newSnake, placeFood, step, stepMs, turn, type SnakeState } from './snake';

/** A snake with its snack placed exactly where the test wants it. */
const withFood = (s: SnakeState, x: number, y: number, kind: 'bug' | 'coffee' = 'bug'): SnakeState => ({ ...s, food: { x, y, kind } });

describe('Cable Snake', () => {
  it('starts in the middle, heading right, clear of desks and its snack', () => {
    const s = newSnake(1);
    expect(s.body).toEqual([
      { x: 7, y: 8 },
      { x: 6, y: 8 },
      { x: 5, y: 8 },
    ]);
    const taken = [...s.body, ...s.desks].map((p) => `${p.x},${p.y}`);
    expect(taken).not.toContain(`${s.food.x},${s.food.y}`);
  });

  it('crawls one cell a step, the tail following', () => {
    const s = step(withFood(newSnake(2), 0, 0));
    expect(s.body).toEqual([
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 8 },
    ]);
  });

  it('turns, but never straight back into itself', () => {
    let s = withFood(newSnake(3), 0, 0);
    expect(turn(s, 'left')).toBe(s);
    expect(turn(s, 'right')).toBe(s);
    s = step(turn(s, 'up'));
    expect(s.body[0]).toEqual({ x: 7, y: 7 });
    expect(s.dir).toBe('up');
  });

  it('keeps two quick turns for the next two steps', () => {
    let s = withFood(newSnake(4), 0, 0);
    s = turn(turn(s, 'up'), 'left');
    expect(s.queue).toEqual(['up', 'left']);
    expect(turn(s, 'down').queue).toEqual(['up', 'left']); // a third is dropped
    s = step(step(s));
    expect(s.body[0]).toEqual({ x: 6, y: 7 });
    expect(s.queue).toEqual([]);
  });

  it('eats a bug: scores, grows by one and puts out another snack', () => {
    let s = withFood(newSnake(5), 8, 8);
    s = step(s);
    expect(s.ate).toBe('bug');
    expect(s.score).toBe(POINTS.bug);
    expect(s.eaten).toBe(1);
    expect(s.body).toHaveLength(3); // the growth shows up on the next step
    expect(s.food).not.toEqual({ x: 8, y: 8, kind: 'bug' });
    s = step(withFood(s, 0, 0));
    expect(s.body).toHaveLength(4);
    expect(s.ate).toBeNull();
  });

  it('grows by two on a coffee, and every fifth snack is one', () => {
    let s = { ...withFood(newSnake(6), 8, 8, 'coffee'), eaten: 3 };
    s = step(s);
    expect(s.score).toBe(POINTS.coffee);
    expect(s.grow).toBe(2);
    expect(s.food.kind).toBe('coffee'); // the fifth
    s = step(withFood(s, 0, 0));
    s = step(s);
    expect(s.body).toHaveLength(5);
  });

  it('comes unplugged at the wall', () => {
    let s = withFood(newSnake(7), 0, 0);
    for (let i = 0; i < 20 && !s.over; i++) s = step(s);
    expect(s.over).toBe('wall');
    expect(s.body[0].x).toBe(15);
    expect(step(s)).toBe(s);
  });

  it('bumps into desks', () => {
    // The top-left desk is at (3,3)-(4,3); come at it from below.
    let s: SnakeState = { ...withFood(newSnake(8), 15, 15), body: [{ x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 }], dir: 'up' };
    s = step(step(s));
    expect(s.over).toBe('desk');
  });

  it('gets tangled when it runs into itself, but may chase its own tail', () => {
    const loop = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    // Moving down into (5,6), where the tail is leaving this very step: allowed.
    const chase = step({ ...withFood(newSnake(9), 15, 15), body: loop, dir: 'down' });
    expect(chase.over).toBeNull();
    // The same while growing: the tail stays, so that's a crash.
    const tangled = step({ ...withFood(newSnake(9), 15, 15), body: loop, dir: 'down', grow: 1 });
    expect(tangled.over).toBe('self');
  });

  it('wins when the cable fills every free cell', () => {
    const s = newSnake(10, 4, 1);
    const full: SnakeState = { ...s, desks: [], body: [{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], grow: 1, food: { x: 3, y: 0, kind: 'bug' } };
    expect(step(full).over).toBe('won');
  });

  it('places snacks only on free cells', () => {
    const taken = deskCells(16, 16);
    for (let seed = 0; seed < 50; seed++) {
      const { at } = placeFood(16, 16, taken, seed);
      expect(taken.some((p) => p.x === at!.x && p.y === at!.y)).toBe(false);
    }
    expect(placeFood(1, 1, [{ x: 0, y: 0 }], 1).at).toBeNull();
  });

  it('speeds up as it eats', () => {
    const s = newSnake(11);
    expect(stepMs({ ...s, eaten: 5 })).toBeLessThan(stepMs(s));
    expect(stepMs({ ...s, eaten: 500 })).toBe(70);
  });
});
