/* ============================================================
   Deal or No Deal — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The speaker preference is shared with the rest of the
   hub under localStorage key `gsc-sound` (architecture 00 §10).

   The show's signature is dread: a low bed under every case, a
   bright sting when a small amount goes and a falling one when a
   big amount does, and the banker's phone ringing over the top of
   everything.
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
    /** The contestant chooses the case they keep: a warm gold chime. */
    pick() {
      tone(523, 0.28, { type: "triangle", volume: 0.2 });
      tone(784, 0.4, { type: "triangle", volume: 0.16, delay: 0.09 });
    },
    /** A case is lifted: a short mechanical click under the reveal. */
    open() { tone(240, 0.08, { type: "square", volume: 0.1 }); },
    /** A small amount has gone — good news: two bright rising notes. */
    good() {
      tone(660, 0.2, { type: "triangle", volume: 0.2, delay: 0.06 });
      tone(990, 0.32, { type: "triangle", volume: 0.17, delay: 0.18 });
    },
    /** A big amount has gone — the room groans: a heavy falling note. */
    bad() {
      tone(220, 0.55, { type: "sawtooth", volume: 0.16, slideTo: 90, delay: 0.05 });
      tone(110, 0.8, { type: "sine", volume: 0.14, delay: 0.12 });
    },
    /** The banker's phone: the two-tone ring, twice. */
    ring() {
      [0, 0.42].forEach((at) => {
        tone(880, 0.16, { type: "square", volume: 0.12, delay: at });
        tone(660, 0.16, { type: "square", volume: 0.12, delay: at + 0.18 });
      });
      tone(70, 1.1, { type: "sine", volume: 0.13 });
    },
    /** Deal: the case closes and the money is real.  */
    deal() {
      [523, 659, 784, 1046].forEach((f, i) => {
        tone(f, 0.36, { type: "triangle", volume: 0.2, delay: i * 0.12 });
      });
    },
    /** No deal: one flat, defiant stab. */
    nodeal() {
      tone(196, 0.3, { type: "sawtooth", volume: 0.18 });
      tone(147, 0.5, { type: "square", volume: 0.12, delay: 0.08 });
    },
    /** The final case, whatever is in it. */
    win() {
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => {
        tone(f, 0.4, { type: "triangle", volume: 0.21, delay: i * 0.13 });
      });
      tone(196, 1.5, { type: "sine", volume: 0.15, delay: 0.75 });
    },
    /** A quiet blip when the room's advice moves. */
    vote() { tone(1320, 0.04, { type: "square", volume: 0.06 }); },
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
    CUES,
  };

  root.DondSound = Sound;
})(typeof window !== "undefined" ? window : globalThis);
