/* ============================================================
   1 vs 100 — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is the Mob: a bright electronic pulse
   while they answer, a descending sweep as tiles go dark, and a
   rising run of coins when the bank grows.
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
    /** The answer window opens: two bright electronic blips. */
    open() {
      [740, 988].forEach((f, i) => tone(f, 0.11, { type: "square", volume: 0.12, delay: i * 0.1 }));
    },
    /** The Mob locks: a short descending gate. */
    close() {
      tone(520, 0.22, { type: "triangle", volume: 0.18, slideTo: 240 });
    },
    /** The contestant commits. */
    lock() {
      tone(180, 0.42, { type: "sine", volume: 0.22, slideTo: 110 });
      tone(90, 0.7, { type: "sine", volume: 0.14, delay: 0.14 });
    },
    /** Right: a rising three-note run, the Mob going dark underneath it. */
    correct() {
      [523, 784, 1175].forEach((f, i) => tone(f, 0.26, { type: "triangle", volume: 0.19, delay: i * 0.09 }));
    },
    /** Tiles going out: a quick falling sweep. */
    eliminate() {
      tone(880, 0.3, { type: "sawtooth", volume: 0.1, slideTo: 220 });
    },
    /** The bank grows: a short run of coins. */
    money() {
      [988, 1319, 1568].forEach((f, i) => tone(f, 0.12, { type: "square", volume: 0.1, delay: i * 0.07 }));
    },
    /** Wrong: flat and final. */
    wrong() {
      tone(196, 0.6, { type: "sawtooth", volume: 0.18, slideTo: 70 });
      tone(98, 0.9, { type: "square", volume: 0.1, delay: 0.05 });
    },
    /** The whole Mob is gone: a full fanfare. */
    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.4, { type: "triangle", volume: 0.22, delay: i * 0.13 });
      });
      tone(261, 1.3, { type: "sine", volume: 0.15, delay: 0.66 });
    },
    /** Walking away with the money. */
    walk() {
      tone(660, 0.2, { type: "sine", volume: 0.18 });
      tone(440, 0.4, { type: "sine", volume: 0.16, delay: 0.16 });
    },
    /** A help is spent. */
    help() { tone(330, 0.36, { type: "triangle", volume: 0.15, slideTo: 990 }); },
    /** One second gone on the answer window. */
    tick() { tone(1180, 0.04, { type: "square", volume: 0.07 }); },
  };

  const Sound = {
    get enabled() { return enabled; },
    /** @param {string} name one of the CUES keys; unknown names are ignored. */
    play(name) {
      if (!enabled) return;
      const cue = CUES[name];
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

  root.OvhSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
