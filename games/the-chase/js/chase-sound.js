/* ============================================================
   The Chase — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).
   The show's signature is a cold, driving pulse: a hard tick for
   the Cash Builder, a rising sting when a contestant steps down,
   a low descending growl when the Chaser does, and the flat
   buzzer at the catch.
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
    /** A Cash Builder answer banked. */
    correct() {
      tone(680, 0.09, { type: "triangle", volume: 0.18 });
      tone(1020, 0.13, { type: "triangle", volume: 0.11, delay: 0.05 });
    },
    /** A miss. Play carries straight on. */
    wrong() { tone(210, 0.12, { type: "sine", volume: 0.14, slideTo: 150 }); },
    /** A pass: a short dry click. */
    pass() { tone(320, 0.06, { type: "square", volume: 0.09, slideTo: 250 }); },
    /** A clock starts. */
    start() { tone(620, 0.1, { type: "triangle", volume: 0.16, slideTo: 930 }); },
    /** The last ten seconds of any clock. */
    tick() { tone(1150, 0.035, { type: "square", volume: 0.07 }); },
    /** Time is up. */
    buzzer() {
      tone(220, 0.7, { type: "sawtooth", volume: 0.2, slideTo: 110 });
      tone(110, 0.9, { type: "square", volume: 0.12, delay: 0.06 });
    },
    /** An answer is locked in, unseen. */
    lock() { tone(440, 0.05, { type: "square", volume: 0.09 }); },
    /** An offer taken: three chords under the amount. */
    offer() {
      [392, 523, 659].forEach((f, i) => tone(f, 0.22, { type: "triangle", volume: 0.16, delay: i * 0.07 }));
    },
    /** The contestant steps down a rung. */
    stepDown() {
      tone(520, 0.14, { type: "triangle", volume: 0.18, slideTo: 780 });
    },
    /** The Chaser steps down a rung: the same beat, one octave lower and falling. */
    chaserStep() {
      tone(300, 0.18, { type: "sawtooth", volume: 0.15, slideTo: 190 });
    },
    /** Caught. */
    caught() {
      tone(180, 0.5, { type: "sawtooth", volume: 0.2, slideTo: 80 });
      tone(90, 0.7, { type: "square", volume: 0.13, delay: 0.08 });
    },
    /** Home with the money. */
    home() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, { type: "triangle", volume: 0.19, delay: i * 0.1 }));
    },
    /** A pushback lands and the Chaser goes backwards. */
    pushback() {
      tone(880, 0.12, { type: "triangle", volume: 0.18 });
      tone(587, 0.2, { type: "triangle", volume: 0.14, delay: 0.08 });
    },
    /** The Chaser catches the team in the Final Chase. */
    chaserWins() {
      [330, 262, 196, 131].forEach((f, i) => tone(f, 0.36, { type: "sawtooth", volume: 0.17, delay: i * 0.13 }));
    },
    /** The team hold on and take the bank. */
    teamWins() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.4, { type: "triangle", volume: 0.22, delay: i * 0.13 });
      });
      tone(261, 1.3, { type: "sine", volume: 0.16, delay: 0.65 });
    },
    /** A new question on the table. */
    deal() { tone(560, 0.07, { type: "triangle", volume: 0.11, slideTo: 840 }); },
  };

  const Sound = {
    get enabled() { return enabled; },
    /** @param {string} name one of the CUES keys; unknown names are ignored. */
    play(name) {
      if (!enabled || typeof name !== "string") return;
      if (!Object.prototype.hasOwnProperty.call(CUES, name)) return;
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

  root.ChaseSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
