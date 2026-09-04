/* ============================================================
   Pyramid — clock renderer (DOM only)
   The pure core stores each clock as {running, deadline,
   remainingMs} and never runs a timer. This file is the only
   place a frame loop lives: it reads the current clock through an
   injected getter, paints mm:ss, and fires `onExpire` EXACTLY
   ONCE per running period. No state is written here.

   Copied in shape from games/weakest-link/js/wl-clock.js, which
   is field-tested: rAF for smoothness plus a slow interval so a
   background tab still reaches zero and still reports it.
   ============================================================ */

"use strict";

(function (root) {
  const DANGER_MS = 10000;   // the last ten seconds go red and tick
  const SAFETY_MS = 250;     // rAF stops in a background tab; this does not

  /** mm:ss, rounded up so the display reaches 0:00 only when time is gone. */
  function format(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  /**
   * @param {{el:HTMLElement,
   *          getClock:() => ({running:boolean, deadline:number|null, remainingMs:number}|null),
   *          onExpire?:() => void, onTick?:(secondsLeft:number) => void,
   *          now?:() => number}} options
   */
  function create(options) {
    const el = options.el;
    const getClock = options.getClock;
    const onExpire = typeof options.onExpire === "function" ? options.onExpire : () => {};
    const onTick = typeof options.onTick === "function" ? options.onTick : () => {};
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    let frame = null;
    let safety = null;
    let firedFor = null;    // the deadline already reported as expired
    let lastSecond = null;  // so the tick cue fires once per second

    function remaining(clock) {
      if (!clock) return 0;
      if (!clock.running || clock.deadline === null) return clock.remainingMs;
      return Math.max(0, clock.deadline - now());
    }

    function paint() {
      const clock = getClock();
      const left = remaining(clock);
      const text = format(left);
      if (el.textContent !== text) el.textContent = text;
      const running = !!(clock && clock.running);
      el.classList.toggle("running", running);
      el.classList.toggle("danger", left > 0 && left <= DANGER_MS);
      el.classList.toggle("done", !!clock && left <= 0);

      if (running && left > 0 && left <= DANGER_MS) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSecond) { lastSecond = sec; onTick(sec); }
      } else if (!running || left > DANGER_MS) {
        lastSecond = null;
      }

      if (running && left <= 0 && firedFor !== clock.deadline) {
        firedFor = clock.deadline;
        onExpire();
      }
      if (!running) firedFor = null;
    }

    function loop() {
      paint();
      frame = root.requestAnimationFrame(loop);
    }

    return {
      /** Begin painting. Safe to call twice. */
      start() {
        if (frame === null) frame = root.requestAnimationFrame(loop);
        if (safety === null) safety = root.setInterval(paint, SAFETY_MS);
        paint();
      },
      stop() {
        if (frame !== null) root.cancelAnimationFrame(frame);
        if (safety !== null) root.clearInterval(safety);
        frame = null;
        safety = null;
      },
      /** Force one repaint (used right after a state change). */
      refresh: paint,
      /** Forget the "already expired" latch, e.g. when a new round starts. */
      reset() { firedFor = null; lastSecond = null; },
      format,
    };
  }

  root.PyrClock = { create, format, DANGER_MS };
})(typeof window !== "undefined" ? window : globalThis);
