/* ============================================================
   Family Feud — WebAudio cues (spec 03 §3)
   Every sound is synthesised: no audio files, nothing to load.
   The AudioContext is created lazily on the first cue AFTER a user
   gesture, so nothing ever autoplays. The 🔊 preference persists
   in localStorage under the shared key `gsc-sound` (00 §10).
   Callers optional-chain `window.FeudSound`, so the game still
   runs if this file fails to load.
   ============================================================ */

"use strict";

const FeudSound = (function () {
  const KEY = "gsc-sound";
  let ctx = null;
  let enabled = true;

  try {
    enabled = localStorage.getItem(KEY) !== "off";
  } catch (err) {
    console.warn("Could not read the sound preference:", err);
  }

  function isOn() {
    return enabled;
  }

  function setOn(on) {
    enabled = !!on;
    try {
      localStorage.setItem(KEY, enabled ? "on" : "off");
    } catch (err) {
      console.warn("Could not save the sound preference:", err);
    }
    return enabled;
  }

  /** Lazily create/resume the context. Returns null when sound is off. */
  function audio() {
    if (!enabled) return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      if (!ctx) ctx = new Ctor();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (err) {
      console.warn("WebAudio unavailable:", err);
      return null;
    }
  }

  /**
   * One shaped oscillator note.
   * @param {{type?:string, freq:number, at?:number, dur?:number, gain?:number,
   *          sweepTo?:number}} spec
   */
  function note(spec) {
    const ac = audio();
    if (!ac) return;
    const start = ac.currentTime + (spec.at || 0);
    const dur = spec.dur || 0.18;
    const peak = spec.gain === undefined ? 0.18 : spec.gain;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = spec.type || "sine";
    osc.frequency.setValueAtTime(spec.freq, start);
    if (spec.sweepTo) osc.frequency.exponentialRampToValueAtTime(spec.sweepTo, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** Correct answer: the bright two-tone board "ding". */
  function ding() {
    note({ type: "sine", freq: 880, dur: 0.13, gain: 0.2 });
    note({ type: "sine", freq: 1318.5, at: 0.07, dur: 0.28, gain: 0.16 });
  }

  /** Strike: a low square-wave burst, ~500 ms (spec §3). */
  function strike() {
    note({ type: "square", freq: 150, sweepTo: 96, dur: 0.5, gain: 0.16 });
    note({ type: "square", freq: 74, dur: 0.5, gain: 0.12 });
  }

  /** Face-off buzz-in: a short rising beep. */
  function buzzIn() {
    note({ type: "triangle", freq: 520, sweepTo: 900, dur: 0.18, gain: 0.2 });
  }

  /** Fast Money duplicate: the "try again" double buzz. */
  function tryAgain() {
    note({ type: "sawtooth", freq: 220, dur: 0.16, gain: 0.15 });
    note({ type: "sawtooth", freq: 180, at: 0.2, dur: 0.22, gain: 0.15 });
  }

  /** Fast Money win: a three-note major arpeggio. */
  function fanfare() {
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      note({ type: "triangle", freq, at: i * 0.14, dur: 0.34, gain: 0.18 });
    });
    note({ type: "triangle", freq: 1046.5, at: 0.42, dur: 0.6, gain: 0.2 });
  }

  /** Round/game over: a soft descending pair. */
  function roundEnd() {
    note({ type: "sine", freq: 440, dur: 0.22, gain: 0.14 });
    note({ type: "sine", freq: 330, at: 0.18, dur: 0.35, gain: 0.14 });
  }

  const CUES = { ding, strike, buzzIn, tryAgain, fanfare, roundEnd };

  /** Play a named cue; unknown names and sound-off are silent no-ops. */
  function play(name) {
    const cue = CUES[name];
    if (cue && enabled) cue();
  }

  return { isOn, setOn, play };
})();

window.FeudSound = FeudSound;
