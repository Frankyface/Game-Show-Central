/* ============================================================
   Wheel of Fortune — regressions for the defects the independent
   tester raised in docs/reports/wheel-of-fortune-verification.md.
   Kept apart from wheel-core.test.mjs so both files stay under
   the 800-line house limit. Zero npm deps: node:test + assert.
   Run from games/wheel-of-fortune:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import WC from "../js/wheel-core.js";

/** Deterministic LCG so every rng-injected path is reproducible. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const PLAYERS = [
  { pid: "p1", name: "Ana" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cid" },
];

/** A single-regular-round game with a wheel whose indices are known. */
function regularGame(puzzle = "THE CORNER COFFEE SHOP") {
  return {
    title: "T",
    settings: {
      vowelCost: 250,
      roundMinimum: 1000,
      wedges: [500, "BANKRUPT", "LOSE A TURN", 600, 700, 800, 900, 650, 550, 500, 700, 600],
    },
    rounds: [{ type: "regular", category: "Place", puzzle }],
  };
}

const regularState = (game = regularGame()) =>
  WC.reduce(WC.createState(game, PLAYERS), { type: "start" }, lcg(1));

const spinTo = (state, index) =>
  WC.reduce(state, { type: "spin" }, () => (index + 0.5) / state.round.wedges.length);

/** Reach the bonus round with the given grand totals already banked. */
function bonusState(totals = [3000, 5000, 1000]) {
  const game = {
    settings: { bonusPrize: "$25,000", bonusSeconds: 10 },
    rounds: [
      { type: "regular", category: "Thing", puzzle: "GAME SHOW CENTRAL" },
      { type: "bonus", category: "Place", puzzle: "THE WINNER'S CIRCLE" },
    ],
  };
  let s = WC.reduce(WC.createState(game, PLAYERS), { type: "start" }, lcg(1));
  s = { ...s, players: s.players.map((p, i) => ({ ...p, total: totals[i] })) };
  return WC.reduce(s, { type: "nextRound" });
}

test("W-D11 Next player cannot pocket a bought vowel", () => {
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // $1,000 in the pot
  s = WC.reduce(s, { type: "buyVowel" });
  assert.equal(s.players[0].round, 750, "the vowel is paid for up front");
  assert.equal(s.pendingVowel, true);
  assert.equal(WC.reduce(s, { type: "nextPlayer" }), s,
    "skipping the turn with a vowel unresolved is refused, not silently paid for");
  // Undo is still the way out, and it restores the money exactly.
  const undone = WC.reduce(s, { type: "undo" });
  assert.equal(undone.players[0].round, 1000);
  assert.equal(undone.pendingVowel, false);
  assert.equal(WC.reduce(undone, { type: "nextPlayer" }).turn, 1,
    "once nothing is pending, Next player works again");
  // Resolving the vowel releases the skip too.
  const called = WC.reduce(s, { type: "callLetter", letter: "E" });
  assert.equal(called.pendingVowel, false);
  assert.equal(WC.reduce(called, { type: "nextPlayer" }).turn, 1);
  // A pending SPIN still skips freely — no money has been spent there.
  const spun = spinTo(regularState(), 0);
  assert.equal(WC.reduce(spun, { type: "nextPlayer" }).turn, 1);
});

test("W-D6 the bonus deadline lives in state so a reload resumes the clock", () => {
  const START = 1_700_000_000_000;
  let s = bonusState();
  assert.equal(s.bonus.deadline, null, "no clock before the letters are picked");
  s = WC.reduce(s, { type: "bonusPick", letters: ["C", "D", "M", "O"], now: START });
  assert.equal(s.bonus.deadline, START + 10_000, "10 s from the moment they were picked");
  assert.equal(s.bonus.timerRunning, true);
  assert.equal(WC.bonusSecondsLeft(s, START), 10);
  assert.equal(WC.bonusSecondsLeft(s, START + 6_000), 4, "a reload 6 s in resumes at 4 s");
  assert.equal(WC.bonusSecondsLeft(s, START + 10_500), 0, "never negative once it expires");
  // The deadline survives localStorage and reaches the phone as seconds LEFT.
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(WC.bonusSecondsLeft(restored, START + 6_000), 4);
  const view = WC.phoneView(restored, "p2", START + 6_000);
  assert.equal(view.screen, "bonus");
  assert.equal(view.seconds, 10, "the full length, for the bar's width");
  assert.equal(view.secondsLeft, 4, "and what is actually left on it");
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view, "still pure JSON");
  // Judging stops the clock; an un-clocked pick simply carries no deadline.
  const judged = WC.reduce(s, { type: "bonusJudged", correct: true });
  assert.equal(judged.bonus.deadline, null);
  assert.equal(WC.bonusSecondsLeft(judged, START), 0);
  const noClock = WC.reduce(bonusState(), { type: "bonusPick", letters: ["C", "D", "M", "O"] });
  assert.equal(noClock.bonus.deadline, null);
  assert.equal(WC.bonusSecondsLeft(noClock, START), 10, "falls back to the full length");
  // bonusSeconds: 0 means no timer at all.
  const game = {
    settings: { bonusSeconds: 0 },
    rounds: [{ type: "regular", category: "T", puzzle: "GAME SHOW CENTRAL" },
      { type: "bonus", category: "P", puzzle: "THE WINNER'S CIRCLE" }],
  };
  let off = WC.reduce(WC.createState(game, PLAYERS), { type: "start" }, lcg(1));
  off = WC.reduce(off, { type: "nextRound" });
  off = WC.reduce(off, { type: "bonusPick", letters: ["C", "D", "M", "O"], now: START });
  assert.equal(off.bonus.timerRunning, false);
  assert.equal(off.bonus.deadline, null);
  assert.equal(WC.bonusSecondsLeft(off, START), 0);
});
