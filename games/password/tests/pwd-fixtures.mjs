/* ============================================================
   Password — shared fixtures for the unit suites
   Deterministic builders and the leak assertion used by
   tests/pwd-core.test.mjs and tests/pwd-adversarial.test.mjs.
   Split out only to keep every file under the 800-line house cap.
   Pure: no DOM, no timers, no real randomness.
   ============================================================ */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const Core = require("../js/pwd-core.js");
export const Content = require("../js/pwd-content.js");

/** A seeded linear congruential generator, so every draw is repeatable. */
export function rngOf(seed) {
  let s = seed || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/**
 * Letters only — a password may not contain a digit, so nor may a fixture —
 * and every fixture word is the SAME length, so no word is a prefix of another
 * and the leak assertion can use a plain substring search.
 */
export function alpha(i) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return letters[Math.floor(i / 26) % 26] + letters[i % 26];
}

export function words(n) {
  return Array.from({ length: n }, (_, i) => `Word${alpha(i)}`);
}

/** A legal file whose shape the caller controls. */
export function game(opts) {
  const o = Object.assign({ count: 80 }, opts || {});
  return {
    title: "Fixture Password",
    settings: Object.assign({
      currency: "$", targetScore: 25, startValue: 10,
      lightningSeconds: 60, lightningWords: 5, lightningValue: 100,
      allFiveBonus: true, swapRoles: true,
    }, o.settings || {}),
    words: o.words || words(o.count),
  };
}

export const TEAMS = [
  { name: "Reds", members: [{ pid: "p1", name: "Ada" }, { pid: "p2", name: "Ben" }] },
  { name: "Blues", members: [{ pid: "p3", name: "Cleo" }, { pid: "p4", name: "Dev" }] },
];

/** A started game: the first password is already on the table. */
export function boot(opts) {
  const o = opts || {};
  return Core.reduce(
    Core.createState(game(o), o.teams || TEAMS, { firstTeam: o.firstTeam, shuffle: o.shuffle, rng: o.rng }),
    { type: "start" }, 0,
  );
}

/** Give one clue and answer it. `result` is "correct" | "wrong". */
export function clueAnd(state, result, team) {
  const after = Core.reduce(state, { type: "clueGiven", team }, 0);
  return Core.reduce(after, { type: "guess", result }, 0);
}

/** Run `n` clue/wrong pairs, alternating exactly as the rules say. */
export function wrongTimes(state, n) {
  let s = state;
  for (let i = 0; i < n; i += 1) s = clueAnd(s, "wrong");
  return s;
}

/** Play whole words until `team` has at least `points`, then return the state. */
export function scoreTo(state, team, points) {
  let s = state;
  let guard = 0;
  while (Core.scores(s)[team] < points && guard < 60) {
    if (s.phase !== "word") break;
    if (s.round.turn !== team) s = Core.reduce(s, { type: "setFirst", team }, 0);
    s = clueAnd(s, "correct");
    if (s.phase === "word" && s.round.finished) s = Core.reduce(s, { type: "nextWord" }, 0);
    guard += 1;
  }
  return s;
}

/**
 * The assertion the whole game rests on: no view except a giver's may carry a
 * password, and no view may carry a password the player is not entitled to.
 * @param {object} state @param {string[]} allowed pids that may see `word`
 */
export function assertNoLeak(state, allowed) {
  const secrets = [state.round ? state.round.word : null]
    .concat(state.lightning ? state.lightning.words.map((w) => w.text) : [])
    .filter(Boolean);
  const pids = ["p1", "p2", "p3", "p4", "px"];
  pids.forEach((pid) => {
    const view = Core.phoneView(state, pid);
    const text = JSON.stringify(view);
    if (allowed.indexOf(pid) >= 0) return;
    secrets.forEach((secret) => {
      assert.equal(text.indexOf(secret), -1,
        `phoneView(${pid}) leaked “${secret}”: ${text}`);
    });
  });
}
