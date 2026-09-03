/* ============================================================
   Wheel of Fortune — bonus-round red-block timer (DOM glue)
   The same TV-podium countdown Jeopardy uses (js/timer.js),
   trimmed to this game's two slots. The math lives in the pure
   TimerCore; this file only paints it. Purely a visual cue:
   hitting zero flashes the bar and plays a sting — it never
   scores, closes or locks anything, and the host still decides
   with Correct / Time's up. The DEADLINE lives in the game state
   (bonus.deadline), so callers pass the seconds REMAINING plus
   the original length and the bar resumes at the right stage
   after a reload instead of granting a fresh countdown (W-D6).
   Every caller optional-chains window.WheelTimer.
   ============================================================ */

"use strict";

const WheelTimer = (function () {
  const TICK_MS = 100;

  /** Fixed slots — each one is a container div in index.html. */
  const SLOTS = {
    bonus: "bonus-timer", // host bonus panel
    phoneBonus: "phone-bonus-timer", // the contestant's phone
  };

  /** @type {Map<string, object>} */
  const running = new Map();
  let onExpire = null;

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
   * Start (or restart) a slot's countdown with `seconds` LEFT on the clock.
   * `totalSeconds` (defaulting to `seconds`) is the countdown's ORIGINAL
   * length: a page that reloads mid-bonus passes both, so the bar is
   * back-dated by the elapsed part and resumes at the true stage instead of
   * lighting a fresh full strip (W-D6). `seconds <= 0` paints the expired bar
   * rather than hiding it, so the host can see the time ran out.
   */
  function start(slot, seconds, key, totalSeconds) {
    stop(slot);
    const tc = core();
    const node = slotNode(slot);
    const secs = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 0;
    if (!tc || !node) return;
    const totalSecs =
      typeof totalSeconds === "number" && Number.isFinite(totalSeconds) && totalSeconds > secs
        ? totalSeconds
        : secs;
    if (totalSecs <= 0) return;
    buildBlocks(node, tc.BLOCKS);
    node.classList.remove("hidden", "timer-done");
    if (secs <= 0) {
      expire(node, key);
      return;
    }
    const entry = {
      startAt: Date.now() - (totalSecs - secs) * 1000, // back-dated by the elapsed part
      totalMs: totalSecs * 1000,
      key: key || null, intervalId: 0, lastLit: -1,
    };
    entry.intervalId = window.setInterval(() => tick(slot, entry), TICK_MS);
    running.set(slot, entry);
    tick(slot, entry); // paint the current bar immediately
  }

  /** Paint an already-expired bar: every block dark, no interval, no sting. */
  function expire(node, key) {
    for (const block of node.children) block.classList.add("off");
    node.classList.add("timer-done");
    node.dataset.timerKey = key || "";
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
    if (lit === entry.lastLit) return; // only the 6 stage changes repaint
    entry.lastLit = lit;
    const blocks = node.children;
    const firstLit = (tc.BLOCKS - lit) / 2; // blocks die pairwise from the ends
    for (let i = 0; i < blocks.length; i += 1) {
      blocks[i].classList.toggle("off", i < firstLit || i >= firstLit + lit);
    }
    if (lit === 0 && entry.intervalId) {
      window.clearInterval(entry.intervalId);
      entry.intervalId = 0;
      node.classList.add("timer-done");
      if (onExpire) onExpire(slot);
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
      delete node.dataset.timerKey;
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
    // An expired bar is not in `running`; remember its key so a re-render does
    // not rebuild (and re-flash) it every frame.
    const node = slotNode(slot);
    if (!entry && node && node.dataset.timerKey === key) return;
    start(slot, seconds, key, totalSeconds);
  }

  return {
    start, stop, sync, remaining,
    onExpire(fn) { onExpire = typeof fn === "function" ? fn : null; },
  };
})();

window.WheelTimer = WheelTimer;
