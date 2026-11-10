/* ============================================================
   Wheel of Fortune — host-phone selector (docs/22 §5.5 unit)
   hostView holds the right solution at each phase, nothing
   secret where there is none, stays pure/small, and leaves the
   contestant phoneView untouched. Run: node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import WC from "../js/wheel-core.js";
import WS from "../js/wheel-select.js";

const PLAYERS = [{ pid: "p1", name: "Ana" }, { pid: "p2", name: "Ben" }];
const GAME = {
  settings: { bonusPrize: "$25,000", tossUpValues: [1000] },
  rounds: [
    { type: "tossup", category: "Phrase", puzzle: "EASY DOES IT" },
    { type: "regular", category: "Place", puzzle: "THE CORNER COFFEE SHOP" },
    { type: "bonus", category: "Thing", puzzle: "THE FINAL EPISODE" },
  ],
};
const at = (rng) => () => rng;
const spinTo = (s, i) => WC.reduce(s, { type: "spin" }, at((i + 0.5) / s.round.wedges.length));

function started() { return WC.reduce(WC.createState(GAME, PLAYERS), { type: "start" }); }
function regular() { return WC.reduce(started(), { type: "nextRound" }); }
function bonus() { return WC.reduce(WC.reduce(regular(), { type: "nextRound" }), { type: "setTotal", pid: "p2", total: 5000 }); }

test("HV setup and final standings carry nothing secret", () => {
  const idle = WS.hostView(WC.createState(GAME, PLAYERS));
  assert.equal(idle.secret, false);
  assert.equal(idle.phase, "idle");
  assert.ok(!("solution" in idle) && !("next" in idle));
  const done = WS.hostView(WC.reduce(bonus(), { type: "finish" }));
  assert.equal(done.secret, false);
  assert.equal(done.phaseLabel, "Final standings");
  assert.ok(!JSON.stringify(done).includes("EPISODE"));
});

test("HV toss-up: the toss-up solution, the value and who buzzed", () => {
  let s = WC.reduce(started(), { type: "tossupStart" }, at(0.3));
  let v = WS.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.solution, "EASY DOES IT");
  assert.equal(v.category, "Phrase");
  assert.equal(v.roundLabel, "Toss-up");
  assert.equal(v.value, 1000);
  assert.equal(v.buzzed, null);
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p2" });
  assert.equal(WS.hostView(s).buzzed, "Ben");
  assert.equal(WS.hostView(s).item, "round-1");
});

test("HV regular round: full solution laid out like the board, hidden letters, turn", () => {
  let s = regular();
  let v = WS.hostView(s);
  assert.equal(v.solution, "THE CORNER COFFEE SHOP");
  assert.equal(v.item, "round-2");
  assert.equal(v.turn, "Ana");
  // Every tile carries its letter; the layout matches the public board's shape.
  const board = WC.boardView(s);
  assert.deepEqual(v.rows.map((r) => r.length), board.rows.map((r) => r.length));
  assert.equal(v.rows.flat().filter(Boolean).map((c) => c.ch).join(""), "THECORNERCOFFEESHOP");
  assert.ok(v.rows.flat().filter(Boolean).every((c) => !c.shown), "nothing revealed yet");
  assert.deepEqual(v.hidden, ["C", "E", "F", "H", "N", "O", "P", "R", "S", "T"]);
  s = spinTo(s, 0);
  assert.equal(WS.hostView(s).wedge, s.wedge.value);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  v = WS.hostView(s);
  assert.ok(!v.hidden.includes("R"));
  assert.equal(v.rows.flat().filter((c) => c && c.shown).length, 2);
  assert.deepEqual(v.used, ["R"]);
});

test("HV bonus: the bonus solution, the contestant and the picks", () => {
  let s = bonus();
  let v = WS.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.solution, "THE FINAL EPISODE");
  assert.equal(v.turn, "Ben", "the leader plays the bonus");
  assert.equal(v.prize, "$25,000");
  s = WC.reduce(s, { type: "bonusPick", letters: ["C", "D", "M", "O"], now: 0 });
  assert.deepEqual(WS.hostView(s).picks, ["C", "D", "M", "O"]);
  assert.equal(WS.hostView(s).next, null, "the bonus is the last round");
});

test("HV once a round is solved nothing about it is secret; the next round is listed", () => {
  let s = regular();
  s = WC.reduce(s, { type: "solveAttempt", text: "x" });
  s = WC.reduce(s, { type: "solveJudged", correct: true });
  const v = WS.hostView(s);
  assert.equal(v.secret, false);
  assert.equal(v.phaseLabel, "Round solved");
  assert.ok(!("solution" in v) && !("rows" in v));
  assert.equal(v.next.solution, "THE FINAL EPISODE");
  assert.equal(v.next.label, "Bonus round");
  const revealed = WS.hostView(WC.reduce(regular(), { type: "revealAll" }));
  assert.equal(revealed.secret, false);
});

test("HV is pure, deterministic, JSON-only and well under 16 KB", () => {
  const s = Object.freeze(regular());
  const before = JSON.stringify(s);
  const a = WS.hostView(s);
  assert.deepEqual(WS.hostView(s), a);
  assert.equal(JSON.stringify(s), before, "state untouched");
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 16384);
  assert.equal(WS.hostView(null).secret, false);
});

test("HV contestant phoneView is unchanged and never carries the solution", () => {
  const s = regular();
  for (const pid of ["p1", "p2"]) {
    const view = WC.phoneView(s, pid, 0);
    assert.ok(!JSON.stringify(view).includes("COFFEE"));
    assert.ok(!("solution" in view));
  }
});
