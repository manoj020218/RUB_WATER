let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return _ctx;
  } catch (_) {
    return null;
  }
}

function gongPulse(ctx: AudioContext, startTime: number, gain: number) {
  const pairs: [number, number, number][] = [
    [160, gain,       2.8],
    [320, gain * 0.5, 1.8],
    [490, gain * 0.3, 1.2],
    [820, gain * 0.15, 0.8],
  ];
  pairs.forEach(([freq, amp, decay]) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(amp, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + decay);
  });
}

export async function playDangerGong(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  gongPulse(ctx, now,       1.0);
  gongPulse(ctx, now + 3.2, 0.9);
  gongPulse(ctx, now + 6.4, 0.85);
}

export function isDangerEvent(data: Record<string, string> | undefined): boolean {
  if (!data) return false;
  const ev = (data.event || '').toUpperCase();
  return ev === 'DANGER_CONFIRMED' || ev === 'ALERT_ACTION_ESCALATED';
}
