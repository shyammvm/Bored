import { mediaManager } from './mediaManager.js';

// Web Audio API synthesized sound effects - zero external audio asset dependencies

function getAudioContext() {
  if (mediaManager && mediaManager.isDeafened) {
    return null; // Mute all sound effects while deafened
  }
  return mediaManager ? mediaManager.getAudioContext() : null;
}

/**
 * Play a soothing meditation singing bowl / chime for Pomodoro completion
 */
export function playBell() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [528, 792, 1056]; // Harmonious 528Hz Solfeggio frequency

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const baseVolume = 0.18 / (idx + 1);
      gain.gain.setValueAtTime(baseVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 3.3);
    });
  } catch (e) {
    console.warn('Audio synthesis error:', e);
  }
}

/**
 * Play a modern digital electronic beep sequence
 */
export function playDigitalBeep() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const tones = [880, 1174.66, 1760]; // A5, D6, A6

    tones.forEach((freq, idx) => {
      const startTime = now + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.11);
    });
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

/**
 * Play a gentle musical marimba chime
 */
export function playGentleChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [587.33, 739.99, 880, 1174.66]; // D5, F#5, A5, D6

    freqs.forEach((freq, idx) => {
      const startTime = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.14, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.9);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.95);
    });
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

/**
 * Play configured Pomodoro alert sound
 */
export function playPomodoroSound(soundType = 'singingBowl') {
  if (soundType === 'none') return;
  if (soundType === 'digitalBeep') {
    playDigitalBeep();
  } else if (soundType === 'gentleChime') {
    playGentleChime();
  } else {
    playBell();
  }
}


/**
 * Play a light, pleasant bubble pop for new chat messages
 */
export function playPop() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

/**
 * Play an uplifting celebration arpeggio when a task is finished
 */
export function playCelebration() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 major chord

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteTime = now + (i * 0.09);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.15, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.45);
    });
  } catch (e) {
    console.warn('Celebration audio error:', e);
  }
}

/**
 * Subtle UI click sound
 */
export function playClick() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.04);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {
    // ignore
  }
}
