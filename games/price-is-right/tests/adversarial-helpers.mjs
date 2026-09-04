/* ============================================================
   The Price Is Right - shared fixtures for the ADVERSARIAL suites
   (tpir-adversarial.test.mjs and tpir-adversarial-show.test.mjs).
   Split out only so both files stay under the 800-line house limit.
   ============================================================ */

import assert from "node:assert/strict";
import { Core, fixed, PLAYERS, tiny, started, run } from "./helpers.mjs";

/** rng that returns the wheel index `i` out of 20 (pickIndex floors rng*20). */
const wheelAt = (i) => fixed((i + 0.5) / 20);

/** Roster of n players p1..pn. */
const roster = (n) => Array.from({ length: n }, (_, i) => ({ pid: `p${i + 1}`, name: `P${i + 1}` }));

/**
 * Drive a whole episode up to (and into) the first Showcase Showdown.
 * `winners` names, per pricing game, which seat index takes the row.
 */
function toShowdownWith(opts) {
  const o = opts || {};
  const g = tiny();
  g.settings.gamesPerShowdown = o.per === undefined ? 3 : o.per;
  if (o.wheel) g.settings.wheel = o.wheel;
  const players = o.players || PLAYERS;
  let s = started(g, players, fixed(0));
  const per = g.settings.gamesPerShowdown;
  for (let i = 0; i < per; i += 1) {
    const pid = o.winner ? o.winner : s.row.seats[i % s.row.seats.length];
    s = run(s, [
      { type: "bid", pid, amount: 1 },
      { type: "revealBids" },
      { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" },
    ], fixed(0));
  }
  assert.equal(s.phase, "showdown", "expected the showdown segment");
  return s;
}

/** Push a fresh episode to the Showcase with two distinct finalists. */
function toShowcaseState() {
  const g = tiny();
  g.settings.gamesPerShowdown = 1;
  let s = started(g, PLAYERS, fixed(0));
  ["p1", "p2"].forEach((pid) => {
    s = run(s, [
      { type: "bid", pid, amount: 1 },
      { type: "revealBids" },
      { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" },
      { type: "spin" }, { type: "stay" },
      { type: "nextSegment" },
    ], wheelAt(3));
  });
  assert.equal(s.phase, "showcase");
  return s;
}

function cliffGame(rng) {
  const s = started(tiny(), PLAYERS, rng || fixed(0));
  const on = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }, { type: "nextSegment" }],
    rng || fixed(0));
  return Core.reduce(on, { type: "pickGame", kind: "cliffhangers" }, rng || fixed(0));
}

function plinkoGame(rng) {
  const s = started(tiny(), PLAYERS, rng || fixed(0));
  const on = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }, { type: "nextSegment" }],
    rng || fixed(0));
  return Core.reduce(on, { type: "pickGame", kind: "plinko" }, rng || fixed(0));
}

function l7Game() {
  const s = started(tiny(), PLAYERS, fixed(0));
  const on = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }, { type: "nextSegment" }],
    fixed(0));
  return Core.reduce(on, { type: "pickGame", kind: "luckyseven" }, fixed(0));
}

/** Set up a claimed showcase and return {state, chooser, other, actuals}. */
function claimedShowcase() {
  const s = Core.reduce(toShowcaseState(), { type: "showcasePass", pass: true }, fixed(0));
  const sc = s.showcase;
  const chooser = sc.chooser;
  const other = sc.finalists.find((p) => p !== chooser);
  const actual = (pid) => s.content.showcases[sc.assignments[pid]].total;
  return { s, chooser, other, actual };
}

export {
  wheelAt, roster, toShowdownWith, toShowcaseState,
  cliffGame, plinkoGame, l7Game, claimedShowcase,
};
