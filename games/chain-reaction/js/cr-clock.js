/* ============================================================
   Chain Reaction — Speed Chain clock (DOM only)
   The pure core stores the clock as a deadline timestamp and
   never runs a timer. This file is the only place a frame loop
   lives: it reads the deadline through an injected getter,
   paints the giant seconds, and fires `onExpire` EXACTLY ONCE
   per running period. No state is written here.

   Copied in shape from games/weakest-link/js/wl-clock.js,
   including its safety interval: rAF stops in a background tab
   (and in some headless panes), which would freeze the clock and
   never report the expiry.
   ============================================================ */

"use strict";

(function (root) {
  const DANGER_MS = 10000;   // the last ten seconds turn red and beat
  const SAFETY_MS = 250;

  /** Whole seconds, rounded up, so the display reaches 0 only when time is gone. */
  function format(ms) {
    return String(Math.max(0, Math.ceil(ms / 1000)));
  }

  /**
   * @param {{el:HTMLElement, getDeadline:() => (number|null),
   *          getSeconds?:() => number, onExpire?:() => void,
   *          onTick?:(secondsLeft:number) => void, now?:() => number}} options
   */
  function create(options) {
    const el = options.el;
    const getDeadline = options.getDeadline;
    const getSeconds = typeof options.getSeconds === "function" ? options.getSeconds : () => 0;
    const onExpire = typeof options.onExpire === "function" ? options.onExpire : () => {};
    const onTick = typeof options.onTick === "function" ? options.onTick : () => {};
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    let frame = null;
    let safety = null;
    let firedFor = null;    // the deadline already reported as expired
    let lastSecond = null;  // so the beat fires once per second

    function paint() {
      const deadline = getDeadline();
      const running = Number.isFinite(deadline);
      const left = running ? Math.max(0, deadline - now()) : getSeconds() * 1000;
      const text = format(left);
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle("running", running && left > 0);
      el.classList.toggle("danger", running && left > 0 && left <= DANGER_MS);
      el.classList.toggle("done", running && left <= 0);

      if (running && left > 0 && left <= DANGER_MS) {
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSecond) { lastSecond = sec; onTick(sec); }
      } else if (!running || left > DANGER_MS) {
        lastSecond = null;
      }

      if (running && left <= 0 && firedFor !== deadline) {
        firedFor = deadline;
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
      /** Forget the "already expired" latch, e.g. on undo. */
      reset() { firedFor = null; lastSecond = null; },
      format,
      DANGER_MS,
    };
  }

  root.CrClock = { create, format, DANGER_MS };
})(typeof window !== "undefined" ? window : globalThis);
