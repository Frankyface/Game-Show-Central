/* ============================================================
   Weakest Link — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
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

  /**
   * One shaped tone. `type` is an oscillator shape; `slideTo` bends the pitch
   * across the note, which is what makes the goodbye sting read as a sting.
   */
  function tone(freq, duration, options) {
    const c = audio();
    if (!c) return;
    const o = options || {};
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + (o.delay || 0);
    const vol = (o.volume === undefined ? 0.22 : o.volume);
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
    /** One second of clock left: a dry tick. */
    tick() { tone(1180, 0.05, { type: "square", volume: 0.1 }); },
    /** Right answer: a rising two-note blip. */
    correct() {
      tone(660, 0.09, { type: "triangle", volume: 0.2 });
      tone(990, 0.13, { type: "triangle", volume: 0.2, delay: 0.08 });
    },
    /** Wrong answer: a short low buzz. */
    wrong() { tone(150, 0.3, { type: "sawtooth", volume: 0.16, slideTo: 90 }); },
    /** Bank: a bright cha-ching. */
    bank() {
      tone(1320, 0.1, { type: "triangle", volume: 0.2 });
      tone(1760, 0.22, { type: "triangle", volume: 0.18, delay: 0.07 });
    },
    /** Goodbye: the descending two-note sting. */
    goodbye() {
      tone(392, 0.34, { type: "sawtooth", volume: 0.2 });
      tone(196, 0.7, { type: "sawtooth", volume: 0.22, delay: 0.3, slideTo: 130 });
    },
    /** The round is over. */
    roundEnd() { tone(330, 0.45, { type: "sine", volume: 0.18, slideTo: 220 }); },
    /** Winner fanfare. */
    win() {
      [523, 659, 784, 1046].forEach((f, i) => {
        tone(f, 0.28, { type: "triangle", volume: 0.2, delay: i * 0.12 });
      });
    },
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

  root.WlSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
