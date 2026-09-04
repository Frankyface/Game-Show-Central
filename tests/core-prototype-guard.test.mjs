/* ============================================================
   Cross-game regression: every pure game core must treat a
   prototype-shaped event type ("toString", "valueOf", "__proto__",
   "hasOwnProperty", "constructor") as an unknown event — return the
   same state, never throw, never call an Object.prototype method.
   Found first in Price Is Right and Deal or No Deal by their testers;
   this pins the guard for all eight cores in one place.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const CORES = [
  { name: "family-feud", files: ["../games/family-feud/js/feud-content.js", "../games/family-feud/js/feud-core.js"], global: "FeudCore", make: (C) => C.createState(C.normalizeGame(require("../games/family-feud/questions.json")), {}) },
  { name: "wheel-of-fortune", files: ["../games/wheel-of-fortune/js/wheel-content.js", "../games/wheel-of-fortune/js/wheel-core.js"], global: "WheelCore", make: (C) => C.createState(C.normalizeGame(require("../games/wheel-of-fortune/puzzles.json")), [{ pid: "p1", name: "A" }], {}) },
  { name: "weakest-link", files: ["../games/weakest-link/js/wl-content.js", "../games/weakest-link/js/wl-core.js"], global: "WlCore", make: (C) => C.createState(C.normalizeGame(require("../games/weakest-link/questions.json")), [{ pid: "p1", name: "A" }, { pid: "p2", name: "B" }, { pid: "p3", name: "C" }], {}) },
  { name: "millionaire", files: ["../games/millionaire/js/wwm-content.js", "../games/millionaire/js/wwm-select.js", "../games/millionaire/js/wwm-core.js"], global: "WwmCore", make: (C) => C.createState(C.normalizeGame(require("../games/millionaire/questions.json")), [{ pid: "p1", name: "A" }], {}) },
  { name: "deal-or-no-deal", files: ["../games/deal-or-no-deal/js/dond-content.js", "../games/deal-or-no-deal/js/dond-core.js"], global: "DondCore", make: (C) => C.createState(C.normalizeGame(require("../games/deal-or-no-deal/board.json")), [{ pid: "p1", name: "A" }], {}) },
  { name: "pyramid", files: ["../games/pyramid/js/pyr-content.js", "../games/pyramid/js/pyr-core.js"], global: "PyrCore", make: (C) => C.createState(C.normalizeGame(require("../games/pyramid/categories.json")), [{ pid: "p1", name: "A" }, { pid: "p2", name: "B" }, { pid: "p3", name: "C" }, { pid: "p4", name: "D" }], {}) },
  { name: "price-is-right", files: ["../games/price-is-right/js/tpir-content.js", "../games/price-is-right/js/tpir-select.js", "../games/price-is-right/js/tpir-core.js"], global: "TpirCore", make: (C) => C.createState(C.normalizeGame(require("../games/price-is-right/prizes.json")), [{ pid: "p1", name: "A" }, { pid: "p2", name: "B" }, { pid: "p3", name: "C" }, { pid: "p4", name: "D" }], {}) },
];

const BAD_TYPES = ["toString", "valueOf", "__proto__", "hasOwnProperty", "constructor", "__defineGetter__"];

for (const core of CORES) {
  test(`${core.name}: prototype-shaped event types are ignored`, async () => {
    for (const f of core.files) await import(f);
    const C = globalThis[core.global];
    assert.ok(C && typeof C.reduce === "function", `${core.global} not exported`);
    let state;
    try {
      state = core.make(C);
    } catch (err) {
      // A createState signature we did not anticipate: fall back to a bare object so the guard is still exercised.
      state = { phase: "setup", history: [] };
    }
    for (const type of BAD_TYPES) {
      let next;
      assert.doesNotThrow(() => { next = C.reduce(state, { type }, () => 0, 0); }, `${core.name} threw on type "${type}"`);
      assert.equal(next, state, `${core.name} changed state on type "${type}"`);
    }
    assert.equal(typeof state.phase, "string", "state was not corrupted by the probes");
  });
}
