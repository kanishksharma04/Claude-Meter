// The alert sounds. They are synthesised with Web Audio rather than shipped as
// audio files: a sound is just a short list of notes, each an oscillator with
// a quick attack and a decay. A service worker has no audio output of its own,
// so they are played by the offscreen document (src/offscreen/).

/**
 * Each note: [frequency in Hz, start in seconds, length in seconds, oscillator type].
 * Kept gentle — these may go off in the middle of a meeting.
 */
export const SOUNDS = {
  chime: {
    label: "Chime",
    notes: [
      [659.25, 0, 0.55, "sine"], // E5
      [880, 0.16, 0.7, "sine"], // A5
    ],
  },
  ping: {
    label: "Ping",
    notes: [[1046.5, 0, 0.4, "sine"]], // C6
  },
  knock: {
    label: "Knock",
    notes: [
      [196, 0, 0.14, "triangle"], // G3
      [196, 0.2, 0.14, "triangle"],
    ],
  },
  pulse: {
    label: "Pulse",
    notes: [
      [880, 0, 0.12, "triangle"],
      [880, 0.2, 0.12, "triangle"],
      [880, 0.4, 0.12, "triangle"],
    ],
  },
};

export const DEFAULT_SOUND = "chime";

/** How long a sound runs, start to silence, in seconds. */
export function soundLength(name) {
  const { notes } = SOUNDS[name] ?? SOUNDS[DEFAULT_SOUND];
  return Math.max(...notes.map(([, start, length]) => start + length));
}

/** A volume setting (0–100) as a gain value, with a curve that makes the slider feel even. */
export function gainFor(volumePercent) {
  const fraction = Math.max(0, Math.min(100, Number(volumePercent) || 0)) / 100;
  return fraction * fraction * 0.5;
}

/**
 * Schedules a sound on an AudioContext, starting now.
 * @param {AudioContext} context
 * @param {string} name - a key of SOUNDS; anything else plays the default
 * @param {number} volumePercent - 0–100
 * @returns {number} how long it will run, in seconds
 */
export function scheduleSound(context, name, volumePercent) {
  const { notes } = SOUNDS[name] ?? SOUNDS[DEFAULT_SOUND];
  const peak = gainFor(volumePercent);
  const now = context.currentTime;

  for (const [frequency, start, length, type] of notes) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    // Up in a hundredth of a second, then an exponential fall: no click at either end.
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now + start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + start + length);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + length + 0.02);
  }
  return soundLength(name);
}
