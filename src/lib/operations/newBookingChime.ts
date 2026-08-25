let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;
const CHIME_COOLDOWN_MS = 2500;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

export function unlockNewBookingChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
}

function tone(
  ctx: AudioContext,
  startAt: number,
  frequency: number,
  duration: number,
  gainValue: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Short two-note ding so reception notices a new booking. */
export function playNewBookingChime(): boolean {
  const now = Date.now();
  if (now - lastPlayedAt < CHIME_COOLDOWN_MS) return false;
  const ctx = getAudioContext();
  if (!ctx) return false;
  lastPlayedAt = now;
  void ctx.resume().then(() => {
    const t = ctx.currentTime;
    tone(ctx, t, 880, 0.14, 0.18);
    tone(ctx, t + 0.12, 1174, 0.22, 0.16);
  });
  return true;
}

export function __resetNewBookingChimeForTests(): void {
  lastPlayedAt = 0;
}
