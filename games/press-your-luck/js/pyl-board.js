/* ============================================================
   Press Your Luck — the travelling light
   The animation, and nothing else. The core has ALREADY decided
   which square the light stops on (pyl-core.js evStop, from the
   injected rng); this file only walks the highlight around the
   18 squares until it gets there. That is the same contract
   games/wheel-of-fortune/js/wheel-draw.js works to: the core
   decides, the animation visualises.

   Three rules it must never break:
   1. It always lands on the index it was given, exactly.
   2. Under `prefers-reduced-motion: reduce` it jumps straight
      there, with no motion at all.
   3. A wall-clock guard finishes the run even if the tab is
      backgrounded and requestAnimationFrame stops firing, so a
      host can never be locked out of their own game.
   ============================================================ */

"use strict";

const PylBoard = (function () {
  const SQUARES = 18;
  const HOP_MS = 130;                // the idle light, one square at a time
  const MIN_MS = 1500;               // the shortest a stop may take
  const MAX_MS = 3400;
  const PER_HOP_MS = 90;
  const EXTRA_LOOPS = 1;             // at least one more lap after the press
  const TICK_MIN_MS = 55;
  const GUARD_SLACK_MS = 900;

  let tiles = [];                    // the 18 tile nodes, in perimeter order
  let lit = 0;                       // where the light is right now
  let idleTimer = 0;
  let frame = 0;
  let guard = 0;
  let running = false;
  let onHop = null;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const now = () => (typeof performance !== "undefined" && performance.now
    ? performance.now() : Date.now());

  /* ============ Painting ============ */

  function paint(index) {
    tiles.forEach((tile, i) => {
      if (!tile) return;
      tile.classList.toggle("is-lit", i === index);
    });
  }

  function setLit(index, tick) {
    const next = ((index % SQUARES) + SQUARES) % SQUARES;
    if (next === lit) return;
    lit = next;
    paint(lit);
    if (tick && onHop) onHop(lit);
  }

  /* ============ The idle walk ============ */

  function stopIdle() {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = 0;
  }

  /** setTimeout, not rAF: a throttled background tab may slow this to a crawl,
      which is harmless — nothing waits on the idle light. */
  function idleStep() {
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (running) return;
      setLit(lit + 1, false);
      idleStep();
    }, HOP_MS);
  }

  /* ============ Public API ============ */

  const api = {
    SQUARES,

    /** Adopt a fresh set of tile nodes (the board is rebuilt on every render). */
    attach(nodes, index) {
      tiles = Array.isArray(nodes) ? nodes : Array.prototype.slice.call(nodes || []);
      if (Number.isInteger(index)) lit = ((index % SQUARES) + SQUARES) % SQUARES;
      paint(lit);
    },

    /** Where the light is (the harness reads this). */
    index() { return lit; },

    isRunning() { return running; },

    /** Start the light drifting around the board. */
    idle() {
      if (running || prefersReducedMotion()) return;
      stopIdle();
      idleStep();
    },

    /** Stop everything; leave the light where it is. */
    halt() {
      stopIdle();
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      if (guard) { window.clearTimeout(guard); guard = 0; }
      running = false;
    },

    /** Put the light on a square with no motion (reload, restore, reduced motion). */
    showIndex(index) {
      api.halt();
      lit = ((index % SQUARES) + SQUARES) % SQUARES;
      paint(lit);
    },

    /**
     * Walk the light to `index` and land on it.
     * @param {number} index the square the CORE chose
     * @param {{onTick?:function, onDone?:function, reduced?:boolean}} [options]
     * @returns {function} cancel — lands immediately rather than leaving it mid-air
     */
    stopAt(index, options) {
      const opts = options || {};
      const target = ((index % SQUARES) + SQUARES) % SQUARES;
      stopIdle();
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      if (guard) { window.clearTimeout(guard); guard = 0; }
      onHop = typeof opts.onTick === "function" ? opts.onTick : null;

      const reduced = opts.reduced === undefined ? prefersReducedMotion() : opts.reduced;
      if (reduced) {
        running = false;
        setLit(target, false);
        if (opts.onDone) opts.onDone(target);
        return () => {};
      }

      const from = lit;
      const steps = (((target - from) % SQUARES) + SQUARES) % SQUARES + SQUARES * EXTRA_LOOPS;
      const duration = Math.min(Math.max(steps * PER_HOP_MS, MIN_MS), MAX_MS);
      const start = now();
      let lastTickAt = -TICK_MIN_MS;
      let done = false;
      running = true;

      /** Idempotent: both the last frame and the wall-clock guard call it. */
      function finish() {
        if (done) return;
        done = true;
        running = false;
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        if (guard) { window.clearTimeout(guard); guard = 0; }
        setLit(target, false);
        onHop = null;
        if (opts.onDone) opts.onDone(target);
      }

      function step(stamp) {
        if (done) return;
        const elapsed = (stamp || now()) - start;
        const t = Math.min(elapsed / duration, 1);
        if (t >= 1) { finish(); return; }
        const hops = Math.floor(easeOutCubic(t) * steps);
        const wanted = from + hops;
        if (((wanted % SQUARES) + SQUARES) % SQUARES !== lit) {
          const tick = elapsed - lastTickAt >= TICK_MIN_MS;
          if (tick) lastTickAt = elapsed;
          setLit(wanted, tick);
        }
        frame = window.requestAnimationFrame(step);
      }

      frame = window.requestAnimationFrame(step);
      // A hidden tab stops firing rAF. Without this the spin would never end
      // and the host would be locked out of their own game.
      guard = window.setTimeout(finish, duration + GUARD_SLACK_MS);
      return finish;
    },

    /** Exposed for the unit-flavoured checks in the harness. */
    prefersReducedMotion,
  };

  return api;
})();

window.PylBoard = PylBoard;
