// Synthesized rather than shipped as an audio asset — keeps the bundle
// light and sidesteps needing to license/attribute a sound file. Lazily
// created since AudioContext can't be constructed before a user gesture.
let audioCtx = null;

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// A short two-note ascending "ding" (C6 -> E6) for transfer completion.
export function playCompletionChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [[1046.5, now, 0.16], [1318.5, now + 0.1, 0.22]].forEach(([freq, start, duration]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  } catch (err) {
    console.warn('playCompletionChime failed', err);
  }
}
