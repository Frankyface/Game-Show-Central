/* ============================================================
   Press Your Luck — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is the board: a dry click as the light
   hops from square to square, a bright cash register when it
   lands on money, and a squelchy falling sting for the Whammy.
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
    /** The travelling light hops one square. */
    tick() { tone(1560, 0.035, { type: "square", volume: 0.07 }); },
    /** The buzzers go live. */
    arm() { tone(520, 0.09, { type: "square", volume: 0.12 }); },
    /** Somebody got in first. */
    buzz() {
      tone(880, 0.14, { type: "square", volume: 0.18 });
      tone(660, 0.2, { type: "square", volume: 0.14, delay: 0.1 });
    },
    /** A correct call. */
    right() {
      tone(784, 0.15, { type: "triangle", volume: 0.2 });
      tone(1175, 0.28, { type: "triangle", volume: 0.18, delay: 0.1 });
    },
    /** A miss. */
    wrong() {
      tone(196, 0.42, { type: "sawtooth", volume: 0.15, slideTo: 88 });
    },
    /** Money on the board. */
    cash() {
      [1047, 1319, 1568].forEach((f, i) => tone(f, 0.22, { type: "triangle", volume: 0.2, delay: i * 0.07 }));
      tone(2093, 0.3, { type: "sine", volume: 0.12, delay: 0.2 });
    },
    /** Money AND another spin. */
    bonus() {
      [880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.24, { type: "triangle", volume: 0.2, delay: i * 0.08 }));
    },
    /** The Whammy: a squelchy fall, then a flat honk. */
    whammy() {
      tone(330, 0.55, { type: "sawtooth", volume: 0.2, slideTo: 62 });
      tone(160, 0.45, { type: "square", volume: 0.14, delay: 0.18, slideTo: 55 });
      tone(98, 0.7, { type: "sawtooth", volume: 0.12, delay: 0.42 });
    },
    /** Four Whammies. */
    outCue() {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", volume: 0.16, delay: i * 0.16 }));
    },
    /** A round is over. */
    round() {
      [523, 659, 784].forEach((f, i) => tone(f, 0.26, { type: "triangle", volume: 0.18, delay: i * 0.12 }));
    },
    /** The game is over. */
    win() {
      [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.34, { type: "triangle", volume: 0.21, delay: i * 0.14 }));
      tone(262, 1.2, { type: "sine", volume: 0.14, delay: 0.7 });
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

  root.PylSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
