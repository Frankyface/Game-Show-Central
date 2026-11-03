/* ============================================================
   Match Game — WebAudio cues
   Synthesised, no audio files, nothing plays before a user
   gesture. The preference is shared with the rest of the hub
   under localStorage key `gsc-sound` (architecture 00 §10).

   The show's signature is brassy and cheap and quick: a little
   card-flip tick, a rising two-note sting for a match, a flat
   raspberry for a miss, a slot-machine rattle for the spinner
   and a proper fanfare when the Super Match pays out.
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
    const vol = (o.volume === undefined ? 0.18 : o.volume);
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

  /** A short burst of filtered noise: the card sliding out of its slot. */
  function noise(duration, options) {
    const c = audio();
    if (!c) return;
    const o = options || {};
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = o.freq || 1600;
    const gain = c.createGain();
    gain.gain.value = o.volume === undefined ? 0.1 : o.volume;
    const t0 = c.currentTime + (o.delay || 0);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
  }

  const CUES = {
    /** A card turning over. */
    flip() {
      noise(0.09, { freq: 2200, volume: 0.07 });
      tone(540, 0.06, { type: "triangle", volume: 0.08 });
    },
    /** Same answer: the brassy two-note sting. */
    match() {
      tone(523, 0.12, { type: "sawtooth", volume: 0.13 });
      tone(784, 0.24, { type: "sawtooth", volume: 0.14, delay: 0.1 });
    },
    /** Nothing doing. */
    miss() {
      tone(196, 0.26, { type: "square", volume: 0.09, slideTo: 130 });
    },
    /** A prompt card coming out. */
    deal() {
      noise(0.13, { freq: 1100, volume: 0.08 });
      tone(330, 0.1, { type: "triangle", volume: 0.09, delay: 0.05 });
    },
    /** An answer landing on the audience board. */
    vote() {
      tone(880, 0.05, { type: "sine", volume: 0.06 });
    },
    /** The board closing and the top three coming up. */
    board() {
      [392, 523, 659].forEach((f, i) => tone(f, 0.16, {
        type: "triangle", volume: 0.12, delay: i * 0.09,
      }));
    },
    /** The multiplier wheel rattling to a stop. */
    spin() {
      for (let i = 0; i < 12; i += 1) {
        noise(0.03, { freq: 900 + i * 40, volume: 0.05, delay: i * (0.04 + i * 0.006) });
      }
      tone(660, 0.2, { type: "square", volume: 0.1, delay: 0.75 });
    },
    /** The Super Match paying out. */
    payout() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, {
        type: "sawtooth", volume: 0.13, delay: i * 0.11,
      }));
    },
    /** End of the night. */
    game() {
      [392, 494, 587, 784].forEach((f, i) => tone(f, 0.36, {
        type: "triangle", volume: 0.12, delay: i * 0.14,
      }));
    },
  };

  const has = (key) => Object.prototype.hasOwnProperty.call(CUES, key);

  root.MgSound = {
    play(name) {
      if (!enabled || !has(name)) return;
      try { CUES[name](); } catch (err) { console.warn("Sound cue failed:", err); }
    },
    enabled: () => enabled,
    toggle() {
      enabled = !enabled;
      try { root.localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (err) {
        console.warn("Could not save the sound preference:", err);
      }
      if (enabled) CUES.flip();
      return enabled;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
