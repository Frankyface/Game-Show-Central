/* ============================================================
   Weakest Link — storage namespacing
   `?store=NAME` moves this page's localStorage into its own
   namespace. The loopback harness runs with `?store=harness` so a
   test run can never leave a half-played game (or harness
   questions) in the real host's save on the same origin.
   Anything but letters, digits and hyphens is stripped.

   Loaded before wl-app.js / wl-editor.js / wl-lobby.js, which all
   read the keys defined here.
   ============================================================ */

"use strict";

/** @returns {string} "" or "-name", ready to append to a storage key. */
function wlStoreSuffix() {
  if (typeof location === "undefined") return "";
  const raw = new URLSearchParams(location.search).get("store") || "";
  const clean = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  return clean ? `-${clean}` : "";
}

const WL_STORAGE_KEY = `gsc-wl-state-v1${wlStoreSuffix()}`;
const WL_DRAFT_KEY = `gsc-wl-draft-v1${wlStoreSuffix()}`;

/* ============ Saved-state shape (WL-6) ============ */

/** Every field the reducer and the renderers dereference without a guard. */
const WL_CORE_ARRAYS = ["players", "active", "eliminated", "order", "past", "revealed", "roundHistory"];
const WL_CORE_OBJECTS = ["clock", "votes", "stats", "roundStats"];
const WL_CORE_NUMBERS = ["roundIndex", "chainIndex", "roundBank", "total", "lastRoundBank", "qIndex"];
const WL_FINAL_PHASES = ["finalIntro", "final", "suddenDeath"];

/** Is this a state the reducer can safely be handed? A hand-edited or half-written
    `gsc-wl-state-v1` is REJECTED here, not discovered by a handler dereferencing
    a missing field (WL-6). */
function wlUsableCore(core) {
  if (!core || typeof core !== "object") return false;
  if (typeof core.phase !== "string" || window.WlCore.PHASES.indexOf(core.phase) < 0) return false;
  if (!core.game || typeof core.game !== "object") return false;
  if (WL_CORE_ARRAYS.some((k) => !Array.isArray(core[k]))) return false;
  if (WL_CORE_OBJECTS.some((k) => !core[k] || typeof core[k] !== "object" || Array.isArray(core[k]))) return false;
  if (WL_CORE_NUMBERS.some((k) => !Number.isFinite(core[k]))) return false;
  if (typeof core.clock.remainingMs !== "number") return false;
  // The embedded game is what every money selector reads.
  const settings = core.game.settings;
  if (!Array.isArray(core.game.questions) || !settings || !Array.isArray(settings.chain)) return false;
  // The head-to-head screens dereference `final` directly.
  if (WL_FINAL_PHASES.indexOf(core.phase) >= 0) {
    return !!core.final && Array.isArray(core.final.pids) && core.final.pids.length === 2;
  }
  return true;
}


if (typeof globalThis !== "undefined") {
  globalThis.WlStore = { suffix: wlStoreSuffix, STATE_KEY: WL_STORAGE_KEY, DRAFT_KEY: WL_DRAFT_KEY };
}
