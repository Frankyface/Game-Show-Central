/* ============================================================
   Krillion — clock glue
   The core stores a clock as a deadline (or, frozen, as the time
   remaining); this file only READS it. An interval — not rAF, so
   a background tab keeps up — paints the seconds and the bar and,
   once per deadline, reports that the clock ran out so the app
   can dispatch closePrompt (Deep Dive) or pufferPop (Puffer).
   Nothing here is ever stored in the state.
   ============================================================ */

"use strict";

const KrClock = (function () {
  const TICK_MS = 200;
  let timer = 0;
  let firedFor = null;     // the deadline we already reported
  let lastSecond = -1;
  let hooks = { core: () => null, onExpire: () => {}, onTick: () => {} };

  function leftMs(clock, now) {
    if (!clock) return null;
    if (Number.isFinite(clock.deadline)) return Math.max(0, clock.deadline - now);
    return Number.isFinite(clock.remainingMs) ? clock.remainingMs : null;
  }

  function paint(c, now) {
    const left = leftMs(c && c.clock, now);
    if (left === null) return;
    const secs = Math.ceil(left / 1000);
    const total = c.clock.seconds * 1000;
    const id = c.phase === "puffer" ? "kr-pclock" : "kr-clock";
    const node = document.getElementById(id);
    if (node) {
      node.textContent = String(secs);
      node.classList.toggle("is-low", secs <= 5);
    }
    const bar = document.getElementById("kr-clock-bar");
    if (bar && c.phase === "prompt") bar.style.width = `${total > 0 ? Math.min(100, (left / total) * 100) : 0}%`;
    if (secs !== lastSecond) {
      lastSecond = secs;
      if (secs > 0 && secs <= 5 && Number.isFinite(c.clock.deadline)) hooks.onTick(secs);
    }
  }

  function step() {
    const c = hooks.core();
    const now = Date.now();
    if (!c || !c.clock || ["prompt", "puffer"].indexOf(c.phase) < 0) return;
    paint(c, now);
    const d = c.clock.deadline;
    if (Number.isFinite(d) && now >= d && firedFor !== d) {
      firedFor = d;
      hooks.onExpire(c.phase);
    }
  }

  /** @param {{core:()=>object, onExpire:(phase:string)=>void, onTick:(s:number)=>void}} h */
  function start(h) {
    hooks = Object.assign(hooks, h || {});
    if (!timer) timer = window.setInterval(step, TICK_MS);
    step();
  }

  return { start, step, leftMs };
})();

window.KrClock = KrClock;
