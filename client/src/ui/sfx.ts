let ctx: AudioContext | null = null;

/** The phone's message chirp: two quick rising blips. */
export function chirp() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    [1046.5, 1568].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t0 = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  } catch {
    // audio is optional
  }
}

/** The elevator "ding": two soft sine tones, no audio files needed. */
export function ding() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 1.2);
    });
  } catch {
    // audio is optional
  }
}
