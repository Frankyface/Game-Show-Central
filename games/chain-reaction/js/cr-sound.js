/* ============================================================
   Chain Reaction — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is the letter tick: a dry electric click
   as each letter lands, a bright two-note chime when a word
   goes up in lights, a flat buzz for a wrong call, and a
   metronome beat under the Speed Chain clock.
   ============================================================ */

"use strict";

(function (root) {
  const KEY = "gsc-sound";
  let ctx = null;
  let enabled = true;

  try {
    enabled = root.localStorage.getItem(KEY) !== "off";
  } catch (err) {
    console.warn("Sound preference unavailable:", err);
  }

  /** Lazily create the AudioContext — never before a gesture. */
  function audio() {
    if (!enabled) return null;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) {
      try { ctx = new Ctor(); } catch (err) { console.warn("No audio:", err); return null; }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  /** One shaped tone; `slideTo` bends the pitch across the note. */
  function tone(freq, duration, options) {
    const c = audio();
    if (!c) return;
    const o = options || {};
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + (o.delay || 0);
    const vol = (o.volume === undefined ? 0.2 : o.volume);
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  const CUES = {
    /** A letter lands on the board. */
    tick() { tone(1320, 0.05, { type: "square", volume: 0.09 }); },
    /** A word goes up in lights. */
    reveal() {
      tone(659, 0.16, { type: "triangle", volume: 0.2 });
      tone(988, 0.3, { type: "triangle", volume: 0.18, delay: 0.1 });
    },
    /** Wrong — control moves. */
    wrong() {
      tone(196, 0.45, { type: "sawtooth", volume: 0.16, slideTo: 82 });
      tone(98, 0.7, { type: "square", volume: 0.09, delay: 0.04 });
    },
    /** The whole chain is up. */
    chain() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: "triangle", volume: 0.2, delay: i * 0.11 }));
    },
    /** The Speed Chain clock starts. */
    start() {
      [440, 880].forEach((f, i) => tone(f, 0.14, { type: "square", volume: 0.14, delay: i * 0.11 }));
    },
    /** One second of the Speed Chain clock. */
    beat() { tone(760, 0.05, { type: "square", volume: 0.1 }); },
    /** Time is up. */
    times() {
      tone(220, 0.8, { type: "sawtooth", volume: 0.18, slideTo: 70 });
    },
    /** All six in the Speed Chain. */
    bonus() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.4, { type: "triangle", volume: 0.22, delay: i * 0.13 });
      });
      tone(261, 1.3, { type: "sine", volume: 0.15, delay: 0.65 });
    },
    /** The night is over. */
    win() {
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.35, { type: "triangle", volume: 0.2, delay: i * 0.16 }));
    },
  };

  const Sound = {
    get enabled() { return enabled; },
    /** @param {string} name one of the CUES keys; unknown names are ignored. */
    play(name) {
      if (!enabled) return;
      const cue = Object.prototype.hasOwnProperty.call(CUES, name) ? CUES[name] : null;
      if (cue) cue();
    },
    /** @param {boolean} on @returns {boolean} the value actually stored. */
    setEnabled(on) {
      enabled = !!on;
      try { root.localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (err) {
        console.warn("Could not save the sound preference:", err);
      }
      return enabled;
    },
    toggle() { return Sound.setEnabled(!enabled); },
  };

  root.CrSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
