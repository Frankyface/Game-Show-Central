/* ============================================================
   The Price Is Right — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is bright and brassy: a two-note "come on
   down", wooden ticks for the wheel and the Plinko pegs, a
   descending slide for a loss.
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

  /** A short burst of filtered noise — a wooden knock. */
  function knock(volume, freq) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq || 900, t0);
    osc.frequency.exponentialRampToValueAtTime((freq || 900) * 0.5, t0 + 0.03);
    gain.gain.setValueAtTime(volume === undefined ? 0.06 : volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }

  const CUES = {
    /** A bid lands on a podium. */
    bid() { tone(660, 0.07, { type: "triangle", volume: 0.12 }); },
    /** The bids flip over. */
    reveal() {
      [523, 698].forEach((f, i) => tone(f, 0.16, { type: "triangle", volume: 0.16, delay: i * 0.09 }));
    },
    /** "Come on down!" — the brassy two-note call. */
    comeOnDown() {
      [392, 523, 659, 784].forEach((f, i) => {
        tone(f, 0.3, { type: "sawtooth", volume: 0.13, delay: i * 0.11 });
      });
    },
    /** An exact bid, a dollar on the wheel, a showcase won. */
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.36, { type: "triangle", volume: 0.2, delay: i * 0.12 }));
      tone(261, 1.1, { type: "sine", volume: 0.14, delay: 0.6 });
    },
    /** The climber takes a step. */
    step() { knock(0.05, 1200); },
    /** Over the edge, out of money, over a dollar. */
    fall() {
      tone(440, 0.7, { type: "sawtooth", volume: 0.16, slideTo: 70 });
      tone(120, 0.5, { type: "square", volume: 0.1, delay: 0.5 });
    },
    /** A Plinko chip clips a peg; the wheel passes a segment. */
    tick() { knock(0.045, 780); },
    /** A chip drops into a slot worth something. */
    land() {
      [784, 1046].forEach((f, i) => tone(f, 0.14, { type: "square", volume: 0.14, delay: i * 0.07 }));
    },
    /** A chip drops into a zero. */
    dud() { tone(160, 0.35, { type: "sawtooth", volume: 0.12, slideTo: 90 }); },
    /** A Lucky Seven digit is spent. */
    coin() { tone(1320, 0.08, { type: "triangle", volume: 0.1 }); },
    /** A right answer. */
    good() { [659, 880].forEach((f, i) => tone(f, 0.18, { type: "triangle", volume: 0.17, delay: i * 0.08 })); },
    /** A wrong answer. */
    bad() { tone(233, 0.35, { type: "square", volume: 0.13, slideTo: 140 }); },
    /** The wheel starts moving. */
    spin() { tone(220, 0.25, { type: "triangle", volume: 0.1, slideTo: 440 }); },
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

  root.TpirSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
