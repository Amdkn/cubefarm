import { noise, tone } from '../sfx';

// Little blips for the phone games, through the office mixer (so the volume slider and M mute them too). Kept
// quiet: they play a lot.

export const blip = {
  move: () => tone({ freq: 420, type: 'square', dur: 0.03, peak: 0.012 }),
  rotate: () => tone({ freq: 560, to: 700, type: 'triangle', dur: 0.06, peak: 0.04 }),
  land: () => {
    noise({ dur: 0.07, peak: 0.07, freq: 500, q: 0.8 });
    tone({ freq: 180, to: 120, type: 'triangle', dur: 0.08, peak: 0.05 });
  },
  lines: (n: number) => [659, 784, 988, 1318.5].slice(0, Math.max(2, n + 1)).forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.06, dur: 0.22, peak: 0.07 })),
  levelUp: () => [523, 659, 784, 1046.5].forEach((freq, i) => tone({ freq, type: 'square', at: i * 0.08, dur: 0.14, peak: 0.03 })),
  over: () => {
    tone({ freq: 392, to: 370, type: 'triangle', dur: 0.22, peak: 0.1 });
    tone({ freq: 311, to: 156, type: 'triangle', at: 0.22, dur: 0.6, peak: 0.1 });
  },
  best: () => [784, 988, 1175, 1568].forEach((freq, i) => tone({ freq, type: 'triangle', at: 0.5 + i * 0.07, dur: 0.28, peak: 0.08 })),
  chomp: () => tone({ freq: 300, to: 620, type: 'square', dur: 0.07, peak: 0.035 }),
  slurp: () => {
    noise({ dur: 0.2, peak: 0.05, filter: 'bandpass', freq: 400, to: 2200, q: 2, attack: 0.03 });
    tone({ freq: 523, to: 1046, type: 'triangle', at: 0.12, dur: 0.16, peak: 0.06 });
  },
  start: () => [523, 784].forEach((freq, i) => tone({ freq, type: 'triangle', at: i * 0.08, dur: 0.14, peak: 0.07 })),
  pause: () => tone({ freq: 660, to: 440, type: 'triangle', dur: 0.12, peak: 0.05 }),
  happy: () => {
    tone({ freq: 660, to: 1320, type: 'square', dur: 0.1, peak: 0.03 });
    tone({ freq: 1320, to: 990, type: 'triangle', at: 0.1, dur: 0.12, peak: 0.07 });
  },
  nom: () => [0, 0.12, 0.24].forEach((at) => tone({ freq: 250, to: 180, type: 'triangle', at, dur: 0.08, peak: 0.06 })),
  boing: () => tone({ freq: 220, to: 660, type: 'sine', dur: 0.25, peak: 0.1 }),
  snore: () => tone({ freq: 140, to: 90, type: 'sine', dur: 0.6, peak: 0.05, attack: 0.2 }),
  grumble: () => tone({ freq: 160, to: 120, type: 'sawtooth', dur: 0.25, peak: 0.025 }),
};
