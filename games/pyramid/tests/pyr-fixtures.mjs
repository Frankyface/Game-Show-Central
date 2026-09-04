/* ============================================================
   Pyramid — shared fixtures for the adversarial suites
   Deterministic builders and the leak assertion used by both
   tests/pyr-adversarial.test.mjs and tests/pyr-hostile.test.mjs.
   Split out only to keep every file under the 800-line house cap.
   Pure: no DOM, no timers, no real randomness.
   ============================================================ */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const Core = require("../js/pyr-core.js");
export const Content = require("../js/pyr-content.js");

/** A seeded linear congruential generator, so every draw is repeatable. */
export function rngOf(seed) {
  let s = seed || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

export function words(prefix, n) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

/** A legal game whose shape the caller controls. */
export function game(opts) {
  const o = Object.assign({ wordsPerCategory: 4, categoriesPerTeam: 3, categories: 13, swapRoles: true }, opts || {});
  return {
    title: "Adversary Pyramid",
    settings: {
      currency: "$", categorySeconds: 30, circleSeconds: 60, tiebreakSeconds: 15,
      wordsPerCategory: o.wordsPerCategory, categoriesPerTeam: o.categoriesPerTeam,
      swapRoles: o.swapRoles,
      circleValues: [200, 300, 400, 500, 800, 1000], grandPrize: 10000, grandPrizeLabel: "$10,000",
    },
    categories: Array.from({ length: o.categories }, (_, i) => ({
      title: `Cat ${i + 1}`, hint: `Hint ${i + 1}`, words: words(`w${i + 1}_`, o.wordsPerCategory),
    })),
    circles: [
      { boxes: words("subject", 6).map((c) => ({ category: c })) },
      { boxes: words("other", 6).map((c) => ({ category: c })) },
    ],
  };
}

export const TEAMS = [
  { name: "Reds", members: [{ pid: "p1", name: "Ada" }, { pid: "p2", name: "Ben" }] },
  { name: "Blues", members: [{ pid: "p3", name: "Cleo" }, { pid: "p4", name: "Dev" }] },
];

export function boot(opts) {
  return Core.reduce(Core.createState(game(opts), TEAMS, { rng: rngOf(11) }), { type: "start" }, 0);
}

/** Pick, start the clock, then apply `plan`. Does NOT press Next. */
export function runCategory(state, index, plan, at) {
  const t = at || 1000;
  let s = Core.reduce(state, { type: "pickCategory", index }, t);
  s = Core.reduce(s, { type: "clockStart" }, t);
  plan.forEach((result, i) => { s = Core.reduce(s, { type: "mark", result }, t + i + 1); });
  return s;
}

/** Fill the whole board with `plan`, closing each round, and stop at mainResult. */
export function playWholeBoard(state, plan) {
  let s = state;
  let t = 1000;
  while (s.phase === "board") {
    const index = s.board.findIndex((slot) => slot.team === null);
    s = runCategory(s, index, plan, t);
    if (!s.round.finished) {
      s = Core.reduce(s, { type: "clockExpired" }, t + 60000);
      s = Core.reduce(s, { type: "mark", result: "illegal" }, t + 60001);
    }
    s = Core.reduce(s, { type: "nextTurn" }, t + 500);
    t += 100000;
  }
  return s;
}

export function toCircle(state, team) {
  return Core.reduce(state, Object.assign({ type: "toCircle" }, team === undefined ? {} : { team }), 900000);
}

/** A board that ends dead level, so the tiebreak is on offer. */
export function levelBoard(wordsPerCategory) {
  let s = boot({ wordsPerCategory: wordsPerCategory || 3, categoriesPerTeam: 1 });
  [[0, 1000], [1, 50000]].forEach(([index, t]) => {
    s = runCategory(s, index, ["correct"], t);
    s = Core.reduce(s, { type: "clockExpired" }, t + 39000);
    s = Core.reduce(s, { type: "mark", result: "illegal" }, t + 39100);
    s = Core.reduce(s, { type: "nextTurn" }, t + 39200);
  });
  return s;
}

/** A Winner's Circle with the clock already running. */
export function openCircle(team) {
  const full = playWholeBoard(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), ["correct", "correct", "correct"]);
  return Core.reduce(toCircle(full, team === undefined ? 0 : team), { type: "circleStart" }, 900100);
}

export function deepFreeze(value, seen) {
  const marks = seen || new WeakSet();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], marks));
  return Object.freeze(value);
}

/* ============ The leak assertion ============ */

/** Real players, a spectator, and three pids that are Object.prototype keys. */
export const PIDS = ["p1", "p2", "p3", "p4", "ghost", "", "__proto__", "constructor", "toString"];

/** Every word and every circle subject anywhere in this state. */
export function secretsOf(state) {
  const out = [];
  state.board.forEach((slot) => slot.words.forEach((w) => out.push(w)));
  if (state.tiebreakCat) state.tiebreakCat.words.forEach((w) => out.push(w));
  if (state.circleSet) state.circleSet.boxes.forEach((b) => out.push(b.category));
  if (state.round) state.round.words.forEach((w) => out.push(w.text));
  if (state.circle) state.circle.boxes.forEach((b) => out.push(b.category));
  return [...new Set(out)];
}

/** The hints: the giver's private steer, spec 11 §2 ("shown only to the giver"). */
export function hintsOf(state) {
  return state.board.map((s) => s.hint)
    .concat(state.tiebreakCat ? [state.tiebreakCat.hint] : [])
    .filter(Boolean);
}

export function allowedGiver(state) {
  if (state.phase === "play" && state.round && !state.round.finished) return state.round.giverPid;
  if (state.phase === "circle" && state.circle && !state.circle.finished) return state.circle.giverPid;
  return null;
}

const HOST_ONLY_KEYS = ["board", "game", "history", "round", "circle", "circleSet",
  "tiebreakCat", "words", "boxes", "outcome", "hint"];

/**
 * The load-bearing assertion of the whole game: for every pid that is not the
 * current giver, the view carries no word, no hint and no circle subject — and
 * NO view, the giver's included, carries any of the host's own state.
 */
export function assertViewsClean(state, label) {
  const giver = allowedGiver(state);
  const secrets = secretsOf(state);
  const hints = hintsOf(state);
  PIDS.forEach((pid) => {
    const view = Core.phoneView(state, pid);
    const text = JSON.stringify(view);
    HOST_ONLY_KEYS.forEach((key) => {
      if (key === "hint" && pid === giver) return;      // the giver alone may hold the theme
      assert.equal(Object.prototype.hasOwnProperty.call(view, key), false,
        `${label}: ${pid}'s view exposes host state "${key}"`);
    });
    if (pid === giver) return;
    secrets.forEach((secret) => {
      assert.equal(text.includes(secret), false, `${label}: ${pid} leaked the secret "${secret}"`);
    });
    hints.forEach((hint) => {
      assert.equal(text.includes(hint), false, `${label}: ${pid} leaked the giver-only hint "${hint}"`);
    });
  });
}
