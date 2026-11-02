let ctx: AudioContext | null = null;
let level = 0.7;

export type BeepName = 'short' | 'high' | 'low' | 'end' | 'count';

export function unlockAudio(): void {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!ctx) ctx = new Ctx();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setVolume(value: number): void {
  level = Math.min(1, Math.max(0, value));
}

export function beep(kind: BeepName): void {
  if (!ctx || level <= 0) return;
  const freq = kind === 'high' ? 1320 : kind === 'low' ? 440 : 880;
  const dur = kind === 'end' ? 1 : kind === 'short' || kind === 'count' ? 0.08 : 0.18;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(Math.max(level, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}
