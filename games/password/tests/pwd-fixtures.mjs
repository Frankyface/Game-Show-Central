/* ============================================================
   Password — shared fixtures for the unit suites
   Deterministic builders and the leak assertion used by
   tests/pwd-core.test.mjs, tests/pwd-adversarial.test.mjs and
   tests/pwd-fuzz.test.mjs.
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
/* ============================================================
   The adversarial harness (tests/pwd-adversarial.test.mjs)
   ============================================================ */

/** Real seats, a spectator, an empty id and two prototype-shaped ids. */
export const PIDS = ["p1", "p2", "p3", "p4", "px", "", "__proto__", "constructor"];

/** Every event the reducer answers to, in the shapes a host or a phone can send. */
export const EVENTS = [
  { type: "start" },
  { type: "clueGiven" }, { type: "clueGiven", team: 0 }, { type: "clueGiven", team: 1 },
  { type: "guess", result: "correct" }, { type: "guess", result: "wrong" },
  { type: "illegal" }, { type: "setFirst", team: 0 }, { type: "setFirst", team: 1 },
  { type: "skipWord" }, { type: "nextWord" },
  { type: "toLightning" }, { type: "toLightning", giver: 0 }, { type: "toLightning", giver: 1 },
  { type: "lightningStart" }, { type: "lightningPause" }, { type: "lightningExpired" },
  { type: "lightningMark", result: "got" }, { type: "lightningMark", result: "pass" },
  { type: "nextGame" }, { type: "finish" }, { type: "undo" },
];

/* The complete set of keys any phone view is allowed to carry. A key outside
   this list is a new surface nobody has leak-tested. */
const VIEW_KEYS = new Set([
  "screen", "name", "team", "teamName", "points", "teamNames", "target", "sub",
  "value", "clues", "turnTeam", "turnName", "yourTurn",
  "word", "canClue", "canMark",
  "count", "clock", "started", "money", "moneyText",
  "mine", "won", "standings",
]);

/** Exactly the pids the spec lets see a password in this state — nobody else. */
export function entitled(state) {
  if (state.phase === "word" && state.round && !state.round.finished) return Core.giverPids(state);
  if (state.phase === "lightning" && state.lightning && !state.lightning.finished) {
    return [state.lightning.giverPid];
  }
  return [];
}

/** Every password this state is holding: the word in play and every Lightning word. */
export function secretsOf(state) {
  return [state.round ? state.round.word : null]
    .concat(state.lightning ? state.lightning.words.map((w) => w.text) : [])
    .filter(Boolean);
}

/**
 * The invariant the whole game rests on, checked hard: nobody unentitled sees
 * ANY password, an entitled giver sees ONLY the word they are clueing right
 * now, and no view carries a key outside the audited set.
 * @param {object} state @param {string} where a label for the failure message
 */
export function auditViews(state, where) {
  const allowed = entitled(state);
  const secrets = secretsOf(state);
  PIDS.forEach((pid) => {
    const view = Core.phoneView(state, pid);
    Object.keys(view).forEach((k) => {
      assert.ok(VIEW_KEYS.has(k), `${where}: phoneView(${pid}) has un-audited key "${k}"`);
    });
    const text = JSON.stringify(view);
    if (allowed.indexOf(pid) < 0) {
      secrets.forEach((secret) => {
        assert.equal(text.indexOf(secret), -1, `${where}: phoneView(${pid}) leaked “${secret}” — ${text}`);
      });
      return;
    }
    const live = state.phase === "lightning"
      ? Core.lightningWord(state) : (state.round && state.round.word);
    assert.equal(view.word, live, `${where}: entitled ${pid} should hold the live word`);
    secrets.filter((s) => s !== live).forEach((other) => {
      assert.equal(text.indexOf(other), -1,
        `${where}: giver ${pid} saw a password that is not in play yet — “${other}”`);
    });
  });
}

/** A game won by Team A with the Lightning Round already under way at t=1000. */
export function lightningAt(opts) {
  const o = Object.assign({ settings: {} }, opts || {});
  o.settings = Object.assign({ targetScore: 10 }, o.settings);
  let s = scoreTo(boot(o), 0, o.settings.targetScore);
  s = Core.reduce(s, { type: "toLightning" }, 1000);
  return Core.reduce(s, { type: "lightningStart" }, 1000);
}

/** Freeze a state and everything under it, so any write throws in strict mode. */
export function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k], marks));
  return Object.freeze(value);
}

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
