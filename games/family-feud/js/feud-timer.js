/* ============================================================
   Family Feud — Fast Money timer DOM glue
   The trimmed sibling of games/jeopardy/js/timer.js: it paints the
   red-block countdown for the two Fast Money bars (host screen and
   the phone). Purely a visual cue — hitting zero flashes the bar
   and NOTHING else: the host still accepts a late answer and the
   reducer never transitions on a timeout. Countdown state is
   ephemeral module state, never serialised. Math lives in the pure
   TimerCore; this file only paints it.
   ============================================================ */

"use strict";

const FeudTimer = (function () {
  const TICK_MS = 100;

  /** Fixed slots — each one is a container div in index.html. */
  const SLOTS = {
    host: "fm-timer", // host Fast Money screen
    phone: "player-fm-timer", // phone Fast Money answer screen
  };

  /** @type {Map<string, {intervalId:number, startAt:number, totalMs:number, key:string|null, lastLit:number}>} */
  const running = new Map();

  const core = () => window.TimerCore || null;

  function slotNode(slot) {
    const id = SLOTS[slot];
    return id ? document.getElementById(id) : null;
  }

  function buildBlocks(host, count) {
    host.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      const block = document.createElement("span");
      block.className = "timer-block";
      host.appendChild(block);
    }
  }

  /**
   * Start (or restart) a slot's countdown with `seconds` left. `totalSeconds`
   * is the ORIGINAL length, so a phone that joins late resumes at the true
   * stage instead of lighting a fresh strip. Seconds ≤ 0, a missing container
   * or a missing core all mean "no timer" — do nothing.
   */
  function start(slot, seconds, key, totalSeconds) {
    stop(slot);
    const tc = core();
    const node = slotNode(slot);
    const secs = Number.isFinite(seconds) ? seconds : 0;
    if (!tc || !node || secs <= 0) return;
    const totalSecs = Number.isFinite(totalSeconds) && totalSeconds > secs ? totalSeconds : secs;
    buildBlocks(node, tc.BLOCKS);
    node.classList.remove("hidden", "timer-done");
    const entry = {
      startAt: Date.now() - (totalSecs - secs) * 1000, // back-dated by the elapsed part
      totalMs: totalSecs * 1000,
      key: key || null,
      intervalId: 0,
      lastLit: -1,
    };
    entry.intervalId = window.setInterval(() => tick(slot, entry), TICK_MS);
    running.set(slot, entry);
    tick(slot, entry); // paint immediately
  }

  function tick(slot, entry) {
    const tc = core();
    const node = slotNode(slot);
    if (!tc || !node) {
      window.clearInterval(entry.intervalId);
      running.delete(slot);
      return;
    }
    const lit = tc.litBlocks(Date.now() - entry.startAt, entry.totalMs);
    if (lit === entry.lastLit) return;
    entry.lastLit = lit;
    const blocks = node.children;
    // Blocks extinguish pairwise from the ends: the lit ones are the centred `lit`.
    const firstLit = (tc.BLOCKS - lit) / 2;
    for (let i = 0; i < blocks.length; i += 1) {
      blocks[i].classList.toggle("off", i < firstLit || i >= firstLit + lit);
    }
    if (lit === 0 && entry.intervalId) {
      window.clearInterval(entry.intervalId);
      entry.intervalId = 0;
      node.classList.add("timer-done"); // flash, change nothing else
    }
  }

  /** Stop a slot and hide its bar. Safe when nothing is running. */
  function stop(slot) {
    const entry = running.get(slot);
    if (entry) {
      if (entry.intervalId) window.clearInterval(entry.intervalId);
      running.delete(slot);
    }
    const node = slotNode(slot);
    if (node && (entry || !node.classList.contains("hidden"))) {
      node.classList.add("hidden");
      node.classList.remove("timer-done");
      node.replaceChildren();
    }
  }

  /** Whole seconds left on a slot's clock (0 when idle or expired). */
  function remaining(slot) {
    const entry = running.get(slot);
    if (!entry) return 0;
    const leftMs = entry.totalMs - (Date.now() - entry.startAt);
    return leftMs > 0 ? Math.ceil(leftMs / 1000) : 0;
  }

  /**
   * Declarative form for render loops: keep the slot running while `key` is
   * truthy and unchanged, (re)start it when the key changes, stop it when the
   * key is null. Calling every render is safe.
   */
  function sync(slot, key, seconds, totalSeconds) {
    const entry = running.get(slot);
    if (!key) {
      if (entry) stop(slot);
      return;
    }
    if (entry && entry.key === key) return;
    start(slot, seconds, key, totalSeconds);
  }

  return { start, stop, remaining, sync };
})();

window.FeudTimer = FeudTimer;
