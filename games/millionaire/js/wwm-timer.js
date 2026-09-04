/* ============================================================
   Millionaire — lifeline countdown DOM glue
   Paints the red-block strip and the seconds readout for the Ask
   the Audience and Phone a Friend windows. Both are CUES ONLY:
   hitting zero flashes the strip and changes nothing in the game
   state — the host still closes the window with a button, exactly
   as the spec (08 §1) asks. The countdown reads the deadline that
   already lives in the core state, so a reload picks the window
   back up where it was; nothing here is ever serialised.
   Block math lives in the pure TimerCore.
   ============================================================ */

"use strict";

const WwmTimer = (function () {
  const TICK_MS = 200;   // an interval, not rAF, so a background tab keeps up

  /** Fixed slots — each names its two containers in index.html. */
  const SLOTS = {
    audience: { blocks: "wwm-audience-blocks", count: "wwm-audience-seconds" },
    phone: { blocks: "wwm-phone-blocks", count: "wwm-phone-seconds" },
  };

  /** slot -> {deadline:number|null, seconds:number, lastSecond:number} */
  const live = new Map();
  let intervalId = 0;
  let onTick = null;

  const core = () => window.TimerCore || null;
  const node = (id) => document.getElementById(id);

  function buildBlocks(host, count) {
    host.replaceChildren();
    for (let i = 0; i < count; i += 1) {
      const block = document.createElement("span");
      block.className = "timer-block";
      host.appendChild(block);
    }
  }

  /** Seconds still to run, rounded up; 0 once the deadline has passed. */
  function secondsLeft(entry) {
    if (!Number.isFinite(entry.deadline)) return entry.seconds;
    return Math.max(0, Math.ceil((entry.deadline - Date.now()) / 1000));
  }

  function paint(slot) {
    const entry = live.get(slot);
    const ids = SLOTS[slot];
    const tc = core();
    if (!entry || !ids || !tc) return;
    const blocks = node(ids.blocks);
    const count = node(ids.count);
    const left = secondsLeft(entry);
    if (count) count.textContent = entry.seconds > 0 ? String(left) : "";
    if (blocks) paintBlocks(blocks, tc, entry, left);
    if (left !== entry.lastSecond) {
      entry.lastSecond = left;
      if (onTick && left > 0 && left <= 5 && entry.seconds > 0) onTick(slot, left);
    }
  }

  function paintBlocks(host, tc, entry, left) {
    if (entry.seconds <= 0 || !Number.isFinite(entry.deadline)) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    if (host.children.length !== tc.BLOCKS) buildBlocks(host, tc.BLOCKS);
    const totalMs = entry.seconds * 1000;
    const lit = tc.litBlocks(totalMs - left * 1000, totalMs);
    const firstLit = (tc.BLOCKS - lit) / 2;
    for (let i = 0; i < host.children.length; i += 1) {
      host.children[i].classList.toggle("off", i < firstLit || i >= firstLit + lit);
    }
    host.classList.toggle("timer-done", left <= 0);
  }

  function ensureRunning() {
    if (intervalId || !live.size) return;
    intervalId = window.setInterval(() => {
      live.forEach((entry, slot) => paint(slot));
      if (!live.size) stopLoop();
    }, TICK_MS);
  }

  function stopLoop() {
    if (!intervalId) return;
    window.clearInterval(intervalId);
    intervalId = 0;
  }

  /**
   * Declarative form for render loops: keep the slot counting down to
   * `deadline` (null = no timer, just show the window), stop it when `open`
   * goes false. Calling this every render is safe and cheap.
   */
  function sync(slot, open, deadline, seconds) {
    if (!SLOTS[slot]) return;
    if (!open) { clear(slot); return; }
    const entry = live.get(slot);
    const next = {
      deadline: Number.isFinite(deadline) ? deadline : null,
      seconds: Number.isFinite(seconds) ? seconds : 0,
      lastSecond: entry ? entry.lastSecond : -1,
    };
    if (entry && entry.deadline === next.deadline && entry.seconds === next.seconds) {
      paint(slot);
      return;
    }
    live.set(slot, next);
    ensureRunning();
    paint(slot);
  }

  function clear(slot) {
    if (!live.has(slot)) return;
    live.delete(slot);
    const ids = SLOTS[slot];
    const blocks = ids && node(ids.blocks);
    const count = ids && node(ids.count);
    if (blocks) { blocks.classList.add("hidden", "timer-done"); blocks.classList.remove("timer-done"); blocks.replaceChildren(); }
    if (count) count.textContent = "";
    if (!live.size) stopLoop();
  }

  return {
    sync,
    clear,
    /** Whole seconds left on a slot (0 when idle). */
    remaining: (slot) => (live.has(slot) ? secondsLeft(live.get(slot)) : 0),
    /** @param {function(string, number)} fn called at 5, 4, 3, 2, 1 seconds. */
    setOnTick: (fn) => { onTick = typeof fn === "function" ? fn : null; },
  };
})();

window.WwmTimer = WwmTimer;
