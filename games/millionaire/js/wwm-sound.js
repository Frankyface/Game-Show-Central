/* ============================================================
   Millionaire — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The 🔊 preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is tension: a low pulsing bed under the
   lock, a bright rising chime for a right answer, a dead thud
   for a wrong one.
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
    /** Picking a letter: a soft click. */
    select() { tone(520, 0.06, { type: "triangle", volume: 0.12 }); },
    /** "Final answer" — the lights go down: a low double thump. */
    lock() {
      tone(150, 0.5, { type: "sine", volume: 0.22, slideTo: 90 });
      tone(75, 0.9, { type: "sine", volume: 0.18, delay: 0.18 });
    },
    /** Right answer: the bright rising chime. */
    correct() {
      [523, 784, 1046].forEach((f, i) => {
        tone(f, 0.3, { type: "triangle", volume: 0.2, delay: i * 0.1 });
      });
    },
    /** Wrong answer: a flat, final buzz. */
    wrong() {
      tone(196, 0.6, { type: "sawtooth", volume: 0.18, slideTo: 70 });
      tone(98, 0.9, { type: "square", volume: 0.1, delay: 0.05 });
    },
    /** The million: a full fanfare. */
    million() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.42, { type: "triangle", volume: 0.22, delay: i * 0.14 });
      });
      tone(261, 1.4, { type: "sine", volume: 0.16, delay: 0.7 });
    },
    /** A lifeline is spent: a rising sweep. */
    lifeline() { tone(330, 0.4, { type: "triangle", volume: 0.16, slideTo: 990 }); },
    /** Walking away with the money. */
    walk() {
      tone(660, 0.2, { type: "sine", volume: 0.18 });
      tone(440, 0.4, { type: "sine", volume: 0.16, delay: 0.16 });
    },
    /** Fastest Finger opens. */
    fff() {
      [880, 1174].forEach((f, i) => tone(f, 0.12, { type: "square", volume: 0.14, delay: i * 0.1 }));
    },
    /** One second left on a lifeline window. */
    tick() { tone(1180, 0.04, { type: "square", volume: 0.08 }); },
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

  root.WwmSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
