/**
 * Sound — the P1 tone, the offer beep, and spoken alerts. Web Audio and speech synthesis,
 * so there is no asset to ship. Audio is a nicety: every call here fails silently, and
 * nothing a person must see is ever carried by sound alone.
 */

type ToneKind = 'critical' | 'warning' | 'offer';

const PATTERN: Record<ToneKind, number[]> = {
  critical: [988, 740, 988, 740],
  warning: [660, 520],
  offer: [880, 660],
};

export function tone(kind: ToneKind = 'offer'): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = kind === 'warning' ? 0.08 : 0.15;
    gain.connect(ctx.destination);
    PATTERN[kind].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.2);
      osc.stop(ctx.currentTime + i * 0.2 + 0.17);
    });
    setTimeout(() => void ctx.close(), PATTERN[kind].length * 220 + 200);
  } catch { /* no audio device, or the page has not been interacted with yet */ }
}

export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.lang = 'en-GB';
    synth.speak(u);
  } catch { /* speech is optional */ }
}
