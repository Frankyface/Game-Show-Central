/* ============================================================
   Pyramid — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is a fast, warm bed: a bright ding for a
   word taken, a soft woodblock for a pass, a flat buzz for an
   illegal clue, and a rising arpeggio when the circle is cleared.
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
    /** A word taken: a short bright ding. */
    correct() {
      tone(880, 0.12, { type: "triangle", volume: 0.2 });
      tone(1320, 0.16, { type: "triangle", volume: 0.12, delay: 0.05 });
    },
    /** Pass: a dry woodblock, deliberately unexciting. */
    pass() { tone(300, 0.08, { type: "square", volume: 0.1, slideTo: 220 }); },
    /** An illegal clue: the flat buzzer everybody in the room knows. */
    illegal() {
      tone(180, 0.45, { type: "sawtooth", volume: 0.18, slideTo: 90 });
      tone(90, 0.5, { type: "square", volume: 0.1, delay: 0.04 });
    },
    /** The clock starts. */
    start() { tone(660, 0.1, { type: "triangle", volume: 0.16, slideTo: 990 }); },
    /** Time is up. */
    buzzer() {
      tone(220, 0.7, { type: "sawtooth", volume: 0.2, slideTo: 110 });
      tone(110, 0.9, { type: "square", volume: 0.12, delay: 0.06 });
    },
    /** One second left on the clock. */
    tick() { tone(1180, 0.04, { type: "square", volume: 0.07 }); },
    /** A category card is turned over. */
    pick() { tone(520, 0.09, { type: "triangle", volume: 0.14, slideTo: 780 }); },
    /** A Winner's Circle box lights up. */
    box() {
      [660, 880].forEach((f, i) => tone(f, 0.16, { type: "triangle", volume: 0.18, delay: i * 0.07 }));
    },
    /** All six: the full fanfare. */
    grand() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.4, { type: "triangle", volume: 0.22, delay: i * 0.13 });
      });
      tone(261, 1.3, { type: "sine", volume: 0.16, delay: 0.65 });
    },
    /** The circle ends short of the top. */
    close() {
      tone(560, 0.22, { type: "sine", volume: 0.18 });
      tone(420, 0.4, { type: "sine", volume: 0.15, delay: 0.18 });
    },
  };

  const Sound = {
    get enabled() { return enabled; },
    /** @param {string} name one of the CUES keys; unknown names are ignored. */
    play(name) {
      if (!enabled) return;
      const cue = CUES[name];
      if (typeof cue === "function") cue();
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

  root.PyrSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
