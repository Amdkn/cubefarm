import { describe, expect, it } from 'vitest';
import { RATES, STAGES, act, advance, cheer, hatch, mood, parsePet, stage, type PetState } from './pet';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 9);

const pet = (over: Partial<PetState> = {}): PetState => ({ ...hatch(T0, 0, 0), say: null, ...over });

describe('Desk Pet stats over time', () => {
  it('run down while it is awake', () => {
    const p = advance(pet(), T0 + 2 * HOUR);
    expect(p.food).toBeCloseTo(80 + 2 * RATES.awake.food);
    expect(p.fun).toBeCloseTo(80 + 2 * RATES.awake.fun);
    expect(p.energy).toBeCloseTo(80 + 2 * RATES.awake.energy);
    expect(p.at).toBe(T0 + 2 * HOUR);
    expect(p.asleep).toBe(false);
  });

  it('recharge energy while asleep, and it wakes up by itself once rested', () => {
    const p = advance(pet({ asleep: true, energy: 30 }), T0 + HOUR);
    expect(p.energy).toBeCloseTo(30 + RATES.asleep.energy);
    expect(p.asleep).toBe(true);
    const later = advance(pet({ asleep: true, energy: 30 }), T0 + 3 * HOUR);
    expect(later.asleep).toBe(false);
    // Rested after 2h; the last hour it was awake again.
    expect(later.energy).toBeCloseTo(100 + RATES.awake.energy);
  });

  it('nods off when its energy runs out', () => {
    const hoursLeft = 14 / -RATES.awake.energy;
    const p = advance(pet({ energy: 14 }), T0 + (hoursLeft + 0.5) * HOUR);
    expect(p.asleep).toBe(true);
    expect(p.energy).toBeCloseTo(0.5 * RATES.asleep.energy);
  });

  it('lands in the same place in one hop or many', () => {
    const start = pet({ food: 70, fun: 55, energy: 40 });
    const once = advance(start, T0 + 50 * HOUR);
    let many = start;
    for (let h = 1; h <= 50; h += 1) many = advance(many, T0 + h * HOUR);
    for (const k of ['food', 'fun', 'energy'] as const) expect(many[k]).toBeCloseTo(once[k], 6);
    expect(many.asleep).toBe(once.asleep);
  });

  it('never goes below zero or dies after a long time away, just gets grumpy', () => {
    const p = advance(pet(), T0 + 365 * 24 * HOUR);
    for (const k of ['food', 'fun', 'energy'] as const) {
      expect(p[k]).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(100);
    }
    expect(p.food).toBe(0);
    expect(p.fun).toBe(0);
    const awake = { ...p, asleep: false, energy: 50 };
    expect(mood(awake)).toBe('grumpy');
    // and a bit of care brings it back
    let q = act(awake, 'snack', p.at);
    q = act(q, 'snack', p.at + 1000);
    q = act(q, 'play', p.at + 2000);
    expect(mood(q)).not.toBe('grumpy');
  });

  it('ignores a clock that went backwards', () => {
    const p = advance(pet(), T0 - HOUR);
    expect(p.food).toBe(80);
    expect(p.at).toBe(T0);
  });
});

describe('Desk Pet care', () => {
  it('eats a snack, unless it is stuffed', () => {
    const p = act(pet({ food: 40 }), 'snack', T0);
    expect(p.food).toBe(70);
    expect(p.xp).toBe(1);
    expect(p.say?.text).toBeTruthy();
    const full = act(pet({ food: 95 }), 'snack', T0);
    expect(full.food).toBe(95);
    expect(full.xp).toBe(0);
  });

  it('perks up on coffee, but a second cup straight after is too much', () => {
    const p = act(pet({ energy: 40 }), 'coffee', T0);
    expect(p.energy).toBe(65);
    const jittery = act(p, 'coffee', T0 + 60_000);
    expect(jittery.fun).toBeLessThan(p.fun);
    expect(jittery.say?.text).toMatch(/too/i);
  });

  it('plays when it has the energy for it', () => {
    const p = act(pet({ fun: 20, energy: 50 }), 'play', T0);
    expect(p.fun).toBe(45);
    expect(p.energy).toBe(40);
    const tired = act(pet({ fun: 20, energy: 10 }), 'play', T0);
    expect(tired.fun).toBe(20);
  });

  it('naps and wakes up', () => {
    const asleep = act(pet({ energy: 30 }), 'nap', T0);
    expect(asleep.asleep).toBe(true);
    expect(mood(asleep)).toBe('asleep');
    expect(act(asleep, 'snack', T0 + 1000).food).toBeCloseTo(asleep.food, 2); // no snacks in its sleep
    const awake = act(asleep, 'nap', T0 + 2000);
    expect(awake.asleep).toBe(false);
    expect(act(pet({ energy: 95 }), 'nap', T0).asleep).toBe(false); // not sleepy
  });

  it('only counts a pat every few seconds', () => {
    const p = act(pet({ fun: 50 }), 'pet', T0);
    expect(p.fun).toBe(53);
    expect(act(p, 'pet', T0 + 1000).fun).toBeCloseTo(53, 1);
    expect(act(p, 'pet', T0 + 5000).fun).toBeCloseTo(56, 1);
  });

  it('gets promoted as care adds up', () => {
    const p = act(pet({ xp: STAGES[1].xp - 1, food: 10 }), 'snack', T0);
    expect(stage(p.xp)).toBe(1);
    expect(p.say?.text).toContain(STAGES[1].title);
    expect(stage(0)).toBe(0);
    expect(stage(10_000)).toBe(STAGES.length - 1);
  });

  it('cheers when someone in the office finishes a job', () => {
    const p = cheer(pet({ fun: 50 }), 'Yay, Ada finished issue #3!', T0 + HOUR);
    expect(p.fun).toBeCloseTo(50 + RATES.awake.fun + 8);
    expect(p.say).toEqual({ text: 'Yay, Ada finished issue #3!', at: T0 + HOUR });
  });
});

describe('Desk Pet moods', () => {
  it('reads its most pressing need', () => {
    expect(mood(pet({ food: 90, fun: 80, energy: 80 }))).toBe('happy');
    expect(mood(pet({ food: 60, fun: 60, energy: 60 }))).toBe('content');
    expect(mood(pet({ food: 10 }))).toBe('hungry');
    expect(mood(pet({ energy: 10 }))).toBe('tired');
    expect(mood(pet({ fun: 10 }))).toBe('bored');
    expect(mood(pet({ fun: 10, food: 10 }))).toBe('grumpy');
  });
});

describe('Desk Pet storage', () => {
  it('reads back a saved pet and rejects anything else', () => {
    const p = pet();
    expect(parsePet(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parsePet(null)).toBeNull();
    expect(parsePet('cubey')).toBeNull();
    expect(parsePet({ ...p, v: 2 })).toBeNull();
    expect(parsePet({ ...p, food: 'lots' })).toBeNull();
    expect(parsePet({ ...p, food: 250 })?.food).toBe(100);
  });
});
