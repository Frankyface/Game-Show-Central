/* ============================================================
   Chain Reaction - regressions pinned after verification
   (docs/reports/chain-reaction-verification.md).

   CR-2  the Speed Chain clock is stored as time LEFT, never as a
         stale absolute deadline, so a save, a reload or an undo
         can neither burn the round nor end it unattended.
   CR-6  the sudden-death word is never one the teams have already
         had on the board.

   Pure core only: `now` and `rng` are injected, so every run is
   exact. Run with:  cd games/chain-reaction && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/cr-core.js");
const Library = require("../../../shared/library.js");
const SHIPPED = require("../chains.json");
const MANIFEST = require("../sets/index.json");

const rng = () => 0;
const TEAMS = [{ name: "Red", pids: ["p1", "p2"] }, { name: "Blue", pids: ["p3"] }];

/** Two rounds worth the same, so a clean sweep each leaves the scores level. */
function tieGame() {
  return {
    title: "Tiny",
    settings: { currency: "$", values: [100, 100], speedSeconds: 60, speedPerWord: 100, speedAllClear: 1000 },
    chains: [
      ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"],
      ["FIRE", "WORKS", "SHOP", "FRONT", "DOOR", "BELL", "BOY", "BAND"],
      ["SUN", "FLOWER", "POT", "HOLE", "PUNCH", "LINE", "UP", "GRADE"],
      ["BUTTER", "FLY", "PAPER", "BACK", "PACK", "RAT", "RACE", "TRACK"],
      ["COLD", "SHOWER", "CURTAIN", "CALL", "BACK", "FIRE", "PLACE", "MAT"],
      ["MOON", "LIGHT", "HOUSE", "HOLD", "UP", "RIGHT", "HAND", "BAG"],
    ],
    speedChains: [
      ["CHAIN", "REACTION", "TIME", "OUT", "SIDE", "STEP", "FATHER", "LAND"],
      ["HIGH", "SCHOOL", "BUS", "STOP", "LIGHT", "WEIGHT", "ROOM", "MATE"],
    ],
  };
}

/** Reveal until the frontier word is the target, then judge it correct. */
function solve(state, direction) {
  const s = Core.reduce(state, { type: "reveal", direction }, rng, 0);
  if (s.target === null) return s;
  return Core.reduce(s, { type: "judge", correct: true }, rng, 0);
}

/** Play every chain out, so the game sits at the Speed Chain gate. */
function toChainsDone() {
  const g = tieGame();
  let s = Core.reduce(Core.createState(g, TEAMS, {}), { type: "start" }, rng, 0);
  for (let r = 0; r < g.settings.values.length; r += 1) {
    if (r > 0) s = Core.reduce(s, { type: "nextChain" }, rng, 0);
    ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  }
  return s;
}

/* ============================================================
   C-U7b — the clock is stored as time left, never as a stale
   deadline (defect CR-2)
   ============================================================ */

test("C-U7b a fresh Speed Chain carries the whole round as remainingMs, with no deadline", () => {
  const s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  assert.equal(s.speed.remainingMs, 60000);
  assert.equal(s.speed.deadline, null);
  assert.equal(s.speed.started, false);
});

test("C-U7b pauseSpeed freezes a running clock and leaves every other clock alone", () => {
  const idle = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  assert.equal(Core.pauseSpeed(idle.speed, 5000), idle.speed, "an unstarted clock is already paused");
  assert.equal(Core.pauseSpeed(null, 0), null);
  const live = Core.reduce(idle, { type: "speedStart" }, rng, 10000);
  const paused = Core.pauseSpeed(live.speed, 25000);
  assert.equal(paused.started, false);
  assert.equal(paused.deadline, null);
  assert.equal(paused.remainingMs, 45000, "35 of the 60 seconds are gone");
  assert.equal(live.speed.started, true, "the caller's clock is untouched");
  assert.equal(Core.pauseSpeed(paused, 30000), paused, "pausing twice changes nothing");
  const late = Core.pauseSpeed(live.speed, 999999);
  assert.equal(late.remainingMs, 0, "a clock that ran out while the tab was gone is 0, never negative");
});

test("C-U7b a paused clock resumes with the time it had, not the whole round", () => {
  const idle = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  const live = Core.reduce(idle, { type: "speedStart" }, rng, 10000);
  // What a save writes, and what a reload restores.
  const restored = Object.assign({}, live, { speed: Core.pauseSpeed(live.speed, 28000) });
  assert.equal(restored.speed.remainingMs, 42000);
  const resumed = Core.reduce(restored, { type: "speedStart" }, rng, 500000);
  assert.equal(resumed.speed.deadline, 542000, "42 seconds from the moment the host presses Start");
  assert.equal(resumed.speed.remainingMs, null);
  assert.equal(resumed.speed.started, true);
});

test("C-U7b the history snapshot stores the clock paused, so undo cannot re-expire it", () => {
  const live = Core.reduce(
    Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0),
    { type: "speedStart" }, rng, 0,
  );
  const marked = Core.reduce(live, { type: "speedMark", result: "got" }, rng, 15000);
  const snap = marked.history[marked.history.length - 1];
  assert.equal(snap.speed.started, false, "the snapshot is frozen");
  assert.equal(snap.speed.deadline, null);
  assert.equal(snap.speed.remainingMs, 45000, "the time it had when the host marked the word");
  const back = Core.reduce(marked, { type: "undo" }, rng, 20000);
  assert.equal(back.speed.deadline, null, "nothing for a clock to expire against");
  assert.equal(back.speed.remainingMs, 45000);
  assert.equal(back.speed.marks.filter((m) => m === "got").length, 0, "the mark is taken back");
});

test("C-U7b undoing an expiry gives the round back with no deadline to fire on", () => {
  const live = Core.reduce(
    Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0),
    { type: "speedStart" }, rng, 0,
  );
  const banked = Core.reduce(live, { type: "speedMark", result: "got" }, rng, 1000);
  const before = banked.scores.slice();
  const timed = Core.reduce(banked, { type: "speedExpired" }, rng, 60000);
  assert.equal(timed.speed.over, true);
  assert.equal(timed.speed.remainingMs, 0);
  assert.equal(timed.speed.started, false);
  const back = Core.reduce(timed, { type: "undo" }, rng, 61000);
  assert.equal(back.speed.over, false, "the round is live again");
  assert.deepEqual(back.scores, before, "the award is taken back");
  assert.equal(back.speed.deadline, null, "and it cannot immediately expire again");
});

test("C-U7b undo also pauses a running clock restored from an older save", () => {
  // A save written before CR-2 carries `started: true` with an absolute
  // deadline. Undo must never hand that back as a live clock.
  const live = Core.reduce(
    Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0),
    { type: "speedStart" }, rng, 0,
  );
  const stale = Object.assign({}, live, {
    history: [Object.assign({}, live, { speed: live.speed, history: undefined })],
  });
  delete stale.history[0].history;
  const back = Core.reduce(stale, { type: "undo" }, rng, 30000);
  assert.equal(back.speed.started, false);
  assert.equal(back.speed.deadline, null);
  assert.equal(back.speed.remainingMs, 30000);
});


test("C-U8 the shipped file never picks a tiebreak word the teams have seen", () => {
  // Three chains played out of eighteen: whatever rng lands on, the tiebreak
  // must not be a word that was already on the board (defect CR-6).
  let s = Core.reduce(Core.createState(SHIPPED, TEAMS, {}), { type: "start" }, rng, 0);
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) s = Core.reduce(s, { type: "nextChain" }, rng, 0);
    let guard = 0;
    while (s.phase === "chain" && guard < 200) {
      guard += 1;
      s = Core.reduce(s, { type: "reveal", direction: guard % 2 ? "top" : "bottom" }, rng, 0);
      if (s.target !== null) {
        s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
        s = Core.reduce(s, { type: "passControl" }, rng, 0);
      }
    }
  }
  const seen = new Set();
  s.chainOrder.slice(0, s.chainIndex + 1).forEach((i) => SHIPPED.chains[i].forEach((w) => seen.add(w)));
  assert.equal(Core.leader(s), null, "the alternating sweep leaves it level");
  [0, 0.11, 0.29, 0.5, 0.73, 0.91, 0.999999].forEach((n) => {
    const sd = Core.reduce(s, { type: "suddenDeath" }, () => n, 0).sudden;
    assert.equal(seen.has(sd.word), false, `"${sd.word}" was already on the board`);
    assert.equal(sd.revealed.some(Boolean), false, "it starts blank");
    assert.ok(sd.before && sd.after, "its neighbours are the clue");
  });
});

/* ============================================================
   X-2 - the shipped set library (docs/19 §2)
   ============================================================ */

test("X-2 sets/index.json is a manifest the shared library accepts", () => {
  const parsed = Library.parseManifest(MANIFEST);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.sets.length, MANIFEST.length, "no row was dropped as junk");
  assert.ok(parsed.sets.length >= 2, "docs/19 §2 asks for at least two extra sets");
  parsed.sets.forEach((entry) => {
    assert.equal(Library.safeFile(entry.file), entry.file, `${entry.file} is not a bare .json name`);
    assert.ok(entry.name && entry.description, `${entry.file} needs a name and a description`);
  });
});

test("X-2 every set in the manifest is a playable Chain Reaction game", () => {
  MANIFEST.forEach((entry) => {
    const set = require(`../sets/${entry.file}`);
    assert.equal(Core.validateGame(set), true, `${entry.file} does not validate`);
    const game = Core.normalizeGame(set);
    assert.equal(game.chains.length, entry.counts.chains, `${entry.file} chain count`);
    assert.equal(game.speedChains.length, entry.counts["speed chains"], `${entry.file} speed chain count`);
    assert.deepEqual(Core.warningsFor(set), [], `${entry.file} has warnings`);
    // Playable end to end, not merely valid.
    let s = Core.reduce(Core.createState(set, TEAMS, {}), { type: "start" }, rng, 0);
    let guard = 0;
    while (s.phase === "chain" && guard < 200) {
      guard += 1;
      s = Core.reduce(s, { type: "reveal", direction: guard % 2 ? "top" : "bottom" }, rng, 0);
      if (s.target !== null) s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
    }
    assert.equal(s.phase, "chainDone", `${entry.file} could not be played out`);
  });
});

test("X-2 no set repeats a word inside a chain, and every word is 2-12 letters", () => {
  MANIFEST.forEach((entry) => {
    const set = require(`../sets/${entry.file}`);
    Core.normalizeGame(set).chains.concat(Core.normalizeGame(set).speedChains).forEach((chain, ci) => {
      const seen = new Set();
      chain.forEach((word, wi) => {
        assert.match(word, /^[A-Z]+(?:['-][A-Z]+)*$/, `${entry.file} chain ${ci + 1} word ${wi + 1}`);
        const letters = word.replace(/[^A-Z]/g, "").length;
        assert.ok(letters >= 2 && letters <= 12, `${entry.file}: ${word} is ${letters} letters`);
        assert.equal(seen.has(word), false, `${entry.file} chain ${ci + 1} repeats ${word}`);
        seen.add(word);
        if (wi > 0) assert.notEqual(word, chain[wi - 1]);
      });
    });
  });
});

test("X-2 the manifest and the default file are different content", () => {
  MANIFEST.forEach((entry) => {
    const set = require(`../sets/${entry.file}`);
    assert.notDeepEqual(set.chains, SHIPPED.chains, `${entry.file} is a copy of chains.json`);
  });
});
