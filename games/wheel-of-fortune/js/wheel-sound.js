/* ============================================================
   Wheel of Fortune — WebAudio sounds (00 §10)
   Everything is synthesised: no audio files, no network. The
   AudioContext is created lazily on the first user gesture and
   nothing ever autoplays. The 0/1 toggle persists under the
   shared "gsc-sound" key. Every call is a no-op when sound is
   off or WebAudio is unavailable, so callers never guard.
   Browser only; exported as window.WheelSound.
   ============================================================ */

"use strict";

const WheelSound = (function () {
  const KEY = "gsc-sound";
  const TICK_MIN_MS = 40; // hard throttle so a fast spin cannot machine-gun

  let ctx = null;
  let enabled = true;
  let lastTickAt = 0;

  try {
    enabled = window.localStorage.getItem(KEY) !== "0";
  } catch (err) {
    console.warn("Sound preference unavailable:", err);
  }

  function audio() {
    if (!enabled) return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
      } catch (err) {
        console.warn("WebAudio unavailable:", err);
        return null;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  /**
   * One synthesised blip.
   * @param {object} o {type, from, to, dur, gain, delay}
   */
  function tone(o) {
    const ac = audio();
    if (!ac) return;
    const at = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.from, at);
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.dur);
    const peak = o.gain === undefined ? 0.12 : o.gain;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }

  /** A short filtered noise burst — used for BANKRUPT. */
  function noise(dur, gainPeak) {
    const ac = audio();
    if (!ac) return;
    const frames = Math.floor(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ac.createGain();
    gain.gain.value = gainPeak === undefined ? 0.18 : gainPeak;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start();
  }

  const api = {
    /** Wheel tick — throttled so a fast spin stays a texture, not a buzz. */
    tick() {
      const now = Date.now();
      if (now - lastTickAt < TICK_MIN_MS) return;
      lastTickAt = now;
      tone({ type: "square", from: 1150, to: 820, dur: 0.035, gain: 0.05 });
    },
    /** A letter is on the board. */
    ding() {
      tone({ type: "sine", from: 880, to: 1320, dur: 0.16, gain: 0.14 });
      tone({ type: "sine", from: 1320, to: 1760, dur: 0.2, gain: 0.09, delay: 0.07 });
    },
    /** Letter not in the puzzle / wrong solve. */
    buzz() {
      tone({ type: "sawtooth", from: 190, to: 110, dur: 0.42, gain: 0.13 });
    },
    /** BANKRUPT. */
    bankrupt() {
      noise(0.5, 0.2);
      tone({ type: "sawtooth", from: 260, to: 70, dur: 0.6, gain: 0.16 });
    },
    /** Lose a turn. */
    loseTurn() {
      tone({ type: "triangle", from: 520, to: 260, dur: 0.35, gain: 0.12 });
    },
    /** Money added. */
    cash() {
      [1046, 1318, 1568].forEach((f, i) =>
        tone({ type: "triangle", from: f, to: f, dur: 0.12, gain: 0.1, delay: i * 0.055 }));
    },
    /** Solved / bonus win. */
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone({ type: "triangle", from: f, to: f, dur: 0.26, gain: 0.12, delay: i * 0.13 }));
    },
    /** Toss-up buzz-in. */
    buzzIn() {
      tone({ type: "square", from: 660, to: 660, dur: 0.18, gain: 0.13 });
      tone({ type: "square", from: 880, to: 880, dur: 0.22, gain: 0.11, delay: 0.16 });
    },
    /** Bonus timer expired. */
    timesUp() {
      [440, 415, 392].forEach((f, i) =>
        tone({ type: "sawtooth", from: f, to: f, dur: 0.3, gain: 0.12, delay: i * 0.22 }));
    },

    isOn() { return enabled; },

    set(on) {
      enabled = !!on;
      try {
        window.localStorage.setItem(KEY, enabled ? "1" : "0");
      } catch (err) {
        console.warn("Could not save the sound preference:", err);
      }
      if (!enabled && ctx) ctx.suspend().catch(() => {});
      return enabled;
    },

    toggle() { return api.set(!enabled); },

    /** Called from a click handler so the context starts on a real gesture. */
    unlock() { audio(); },
  };

  return api;
})();

window.WheelSound = WheelSound;
