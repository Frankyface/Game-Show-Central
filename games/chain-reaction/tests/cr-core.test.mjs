/* ============================================================
   Chain Reaction — unit suite (success states C-U1 … C-U10,
   spec 14 §6). Pure core only: no DOM, no network, no timers.
   `rng` and `now` are injected everywhere so every run is exact.
   Run with:  cd games/chain-reaction && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const Core = require("../js/cr-core.js");
const SHIPPED = require("../chains.json");

const rng = () => 0;
const TEAMS = [{ name: "Red", pids: ["p1", "p2"] }, { name: "Blue", pids: ["p3"] }];

/** A tiny two-round game so the tests are readable and fast. */
function tinyGame(overrides) {
  return Object.assign({
    title: "Tiny",
    settings: { currency: "$", values: [100, 200], speedSeconds: 60, speedPerWord: 100, speedAllClear: 1000 },
    chains: [
      ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"],
      ["FIRE", "WORKS", "SHOP", "FRONT", "DOOR", "BELL", "BOY", "BAND"],
      ["SUN", "FLOWER", "POT", "HOLE", "PUNCH", "LINE", "UP", "GRADE"],
      ["BUTTER", "FLY", "PAPER", "BACK", "PACK", "RAT", "RACE", "TRACK"],
      ["HORSE", "SHOE", "LACE", "CURTAIN", "CALL", "BACK", "FIRE", "PLACE"],
      ["MOON", "LIGHT", "HOUSE", "HOLD", "UP", "RIGHT", "HAND", "BAG"],
    ],
    speedChains: [
      ["CHAIN", "REACTION", "TIME", "OUT", "SIDE", "STEP", "FATHER", "LAND"],
      ["HIGH", "SCHOOL", "BUS", "STOP", "LIGHT", "WEIGHT", "ROOM", "MATE"],
    ],
  }, overrides || {});
}

/** The same chains but both rounds worth the same, so a clean sweep each ties. */
function tieGame() {
  const g = tinyGame();
  g.settings = Object.assign({}, g.settings, { values: [100, 100] });
  return g;
}

function started(game, teams) {
  const state = Core.createState(game || tinyGame(), teams || TEAMS, {});
  return Core.reduce(state, { type: "start" }, rng, 0);
}

/** Reveal letters until the word at `index` is the live target, then judge it. */
function solve(state, direction, correct) {
  let s = Core.reduce(state, { type: "reveal", direction }, rng, 0);
  if (s.target === null) return s;                 // the word was fully spelled out and given
  return Core.reduce(s, { type: "judge", correct: correct !== false }, rng, 0);
}

/* ============================================================
   C-U1 — the content validator
   ============================================================ */

test("C-U1 the shipped chains.json is a valid game", () => {
  assert.equal(Core.validateGame(SHIPPED), true);
  const g = Core.normalizeGame(SHIPPED);
  assert.equal(g.chains.length, 18, "spec 14 §2 ships 18 chains");
  assert.equal(g.speedChains.length, 4, "spec 14 §2 ships 4 speed chains");
  g.chains.concat(g.speedChains).forEach((chain) => assert.equal(chain.length, 8));
});

test("C-U1 js/data.js mirrors chains.json exactly", () => {
  const offline = require("../js/data.js");
  assert.deepEqual(offline, SHIPPED);
});

test("C-U1 every shipped word is 2–12 letters, A–Z, and unique inside its chain", () => {
  const g = Core.normalizeGame(SHIPPED);
  g.chains.concat(g.speedChains).forEach((chain, ci) => {
    const seen = new Set();
    chain.forEach((word, wi) => {
      assert.match(word, /^[A-Z]+(?:['-][A-Z]+)*$/, `chain ${ci} word ${wi}`);
      assert.ok(word.replace(/[^A-Z]/g, "").length >= 2);
      assert.ok(word.replace(/[^A-Z]/g, "").length <= 12);
      assert.ok(!seen.has(word), `chain ${ci} repeats ${word}`);
      seen.add(word);
      if (wi > 0) assert.notEqual(word, chain[wi - 1]);
    });
  });
});

test("C-U1 the validator rejects every documented fault with a plain message", () => {
  const bad = [
    [null, /not a Chain Reaction game/],
    [tinyGame({ chains: [] }), /at least 6 chains/],
    [tinyGame({ chains: tinyGame().chains.map((c, i) => (i ? c : c.slice(0, 7))) }), /exactly 8/],
    [tinyGame({ speedChains: [tinyGame().speedChains[0]] }), /at least 2 chains/],
    [tinyGame({ chains: tinyGame().chains.map((c, i) => (i ? c : ["A", ...c.slice(1)])) }), /2–12 letters/],
    [tinyGame({ chains: tinyGame().chains.map((c, i) => (i ? c : ["SPACE1", ...c.slice(1)])) }), /letters only/],
    [tinyGame({ chains: tinyGame().chains.map((c, i) => (i ? c : ["SHIP", "SHIP", ...c.slice(2)])) }), /twice in a row/],
    [tinyGame({ chains: tinyGame().chains.map((c, i) => (i ? c : ["OUT", ...c.slice(1)])) }), /more than once/],
    [tinyGame({ settings: { values: [] } }), /1–6 amounts/],
    [tinyGame({ settings: { values: [0] } }), /whole number of 1 or more/],
    [tinyGame({ settings: { values: [1, 2, 3, 4, 5, 6, 7] } }), /1–6 amounts/],
    [tinyGame({ settings: { speedSeconds: 4 } }), /between 10 and 300/],
    [tinyGame({ settings: "nope" }), /"settings" must be an object/],
  ];
  bad.forEach(([game, pattern]) => {
    assert.throws(() => Core.validateGame(game), pattern, JSON.stringify(pattern.source));
  });
});

test("C-U1 normalizeGame uppercases, trims and never mutates the input", () => {
  const raw = tinyGame();
  raw.chains[0] = [" space ", "ship", "shape", "up", "town", "hall", "way", "out"];
  const before = JSON.stringify(raw);
  const g = Core.normalizeGame(raw);
  assert.deepEqual(g.chains[0], ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"]);
  assert.equal(JSON.stringify(raw), before, "the caller's object is untouched");
  assert.equal(g.settings.speedAllClearLabel, "$1,000", "settings fall back to the defaults");
  assert.equal(g.settings.revealOnWrong, false);
});

test("C-U1 apostrophes and hyphens are allowed inside a word but not at the edges", () => {
  const ok = tinyGame();
  ok.chains[0] = ["MOTHER", "IN-LAW", "SUIT", "CASE", "STUDY", "HALL", "WAY", "OUT"];
  assert.equal(Core.validateGame(ok), true);
  const bad = tinyGame();
  bad.chains[0] = ["-SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT", "SIDE"];
  assert.throws(() => Core.validateGame(bad), /letters only/);
});

test("C-U1 wordProblem powers the editor's live per-word validation", () => {
  const siblings = ["SPACE", "SHIP", "SHIP", "UP", "TOWN", "HALL", "WAY", "OUT"];
  assert.equal(Core.wordProblem("SPACE", siblings, 0), "");
  assert.equal(Core.wordProblem("", siblings, 1), "Needs a word.");
  assert.match(Core.wordProblem("A", siblings, 1), /2–12 letters/);
  assert.match(Core.wordProblem("SH1P", siblings, 1), /letters only/);
  assert.equal(Core.wordProblem("SHIP", siblings, 1), "Same as the word below.");
  assert.equal(Core.wordProblem("SHIP", siblings, 2), "Same as the word above.");
  assert.equal(Core.wordProblem("OUT", siblings, 1), "Already used in this chain.");
});

/* ============================================================
   C-U2 — eligibility
   ============================================================ */

test("C-U2 only the two words next to a revealed one are eligible", () => {
  const s = started();
  assert.deepEqual(Core.eligibleWords(s), [1, 6], "top and bottom frontier only");
  assert.deepEqual(Core.frontier(s), { top: 1, bottom: 6 });
});

test("C-U2 the frontier walks inwards as words are solved", () => {
  let s = started();
  s = solve(s, "top");            // SHIP
  assert.deepEqual(Core.eligibleWords(s), [2, 6]);
  s = solve(s, "bottom");         // WAY
  assert.deepEqual(Core.eligibleWords(s), [2, 5]);
  s = solve(s, "bottom");         // HALL
  assert.deepEqual(Core.eligibleWords(s), [2, 4]);
});

test("C-U2 the last unsolved word is eligible from both ends, once", () => {
  let s = started();
  ["top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  assert.deepEqual(Core.eligibleWords(s), [4], "one word left, listed once");
  assert.deepEqual(Core.frontier(s), { top: 4, bottom: 4 });
});

test("C-U2 a reveal in a direction with no eligible word changes nothing", () => {
  const done = { chain: { solved: [true, true, true, true, true, true, true, true] } };
  assert.deepEqual(Core.frontier(done), { top: null, bottom: null });
  assert.deepEqual(Core.eligibleWords(done), []);
});

test("C-U2 a second reveal before judging is refused — one letter per turn", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  const again = Core.reduce(s, { type: "reveal", direction: "bottom" }, rng, 0);
  assert.equal(again, s, "the target is already chosen");
});

/* ============================================================
   C-U3 — letters reveal left to right; a full word is given
   ============================================================ */

test("C-U3 letters light left to right", () => {
  let s = started();
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
    seen.push(Core.columnRows(s.chain)[1].cells.map((c) => c.ch).join("|"));
    if (i < 2) s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  }
  assert.deepEqual(seen, ["S|||", "S|H||", "S|H|I|"]);
});

test("C-U3 the letter that completes a word gives it away — no points, control stays", () => {
  // SHIP is four letters: four reveals, and the fourth spells it out.
  let s = started();
  for (let i = 0; i < 3; i += 1) {
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
    s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  }
  const before = { control: s.control, scores: s.scores.slice() };
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  assert.equal(s.chain.solved[1], true, "the word is given");
  assert.equal(s.target, null, "there is nothing to guess");
  assert.deepEqual(s.scores, before.scores, "no points for a given word");
  assert.equal(s.control, before.control, "control stays");
  assert.match(s.notice, /fully spelled out/);
});

test("C-U3 a given word still lets the same team carry on", () => {
  let s = started();
  for (let i = 0; i < 3; i += 1) {
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
    s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  }
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);   // SHIP given
  const control = s.control;
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);   // straight on to SHAPE
  assert.equal(s.target, 2);
  assert.equal(s.control, control);
});

/* ============================================================
   C-U4 / C-U5 — judging
   ============================================================ */

test("C-U4 correct scores the chain value and keeps control", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
  assert.deepEqual(s.scores, [100, 0]);
  assert.equal(s.control, 0, "the team in control keeps it");
  assert.equal(s.chain.solved[1], true);
  assert.equal(s.chain.owner[1], 0, "the word wears that team's colour");
  assert.equal(s.target, null);
  assert.equal(s.guessText, "");
});

test("C-U4 the value follows the chain number", () => {
  let s = started();
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  assert.equal(s.phase, "chainDone");
  assert.equal(s.scores[0], 600, "six words at 100");
  s = Core.reduce(s, { type: "nextChain" }, rng, 0);
  assert.equal(Core.chainValue(s), 200);
  s = solve(s, "top");
  assert.equal(s.scores[1], 200, "chain two pays 200 and team B opens it");
});

test("C-U5 a wrong guess passes control and clears the target", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "guess", text: "boat" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  assert.equal(s.control, 1);
  assert.equal(s.target, null);
  assert.equal(s.guessText, "");
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.chain.solved[1], false, "the word stays hidden");
  assert.equal(Core.columnRows(s.chain)[1].shown, 1, "the letter already given stays given");
});

test("C-U5 the incoming team may build from either end", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  s = Core.reduce(s, { type: "reveal", direction: "bottom" }, rng, 0);
  assert.equal(s.target, 6, "the other end was open to them");
  assert.equal(s.control, 1);
});

test("C-U5 revealOnWrong hands the next letter over when the file asks for it", () => {
  const game = tinyGame();
  game.settings = Object.assign({}, game.settings, { revealOnWrong: true });
  let s = started(game);
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  assert.equal(Core.columnRows(s.chain)[1].shown, 2, "two letters now");
  assert.equal(s.control, 1);
});

test("C-U5 passControl flips the turn without touching the board", () => {
  let s = started();
  const before = JSON.stringify(s.chain);
  s = Core.reduce(s, { type: "passControl" }, rng, 0);
  assert.equal(s.control, 1);
  assert.equal(JSON.stringify(s.chain), before);
});

/* ============================================================
   C-U6 — chain completion
   ============================================================ */

test("C-U6 solving the last word completes the chain and shows the interstitial", () => {
  let s = started();
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  assert.equal(s.phase, "chainDone");
  assert.equal(Core.chainComplete(s.chain), true);
  assert.equal(Core.chainsLeft(s), 1);
  assert.equal(s.target, null);
});

test("C-U6 nextChain advances the round, the value and the opening team", () => {
  let s = started();
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  s = Core.reduce(s, { type: "nextChain" }, rng, 0);
  assert.equal(s.phase, "chain");
  assert.equal(s.chainIndex, 1);
  assert.equal(s.chain.words[0], "FIRE", "the next chain in the file");
  assert.equal(s.control, 1, "teams alternate who opens a chain");
  assert.equal(Core.chainValue(s), 200);
  assert.equal(Core.columnRows(s.chain)[1].shown, 0, "a fresh, blank column");
});

test("C-U6 nextChain does nothing once the last chain is played", () => {
  let s = started();
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  s = Core.reduce(s, { type: "nextChain" }, rng, 0);
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  assert.equal(s.phase, "chainDone");
  assert.equal(Core.chainsLeft(s), 0);
  assert.equal(Core.reduce(s, { type: "nextChain" }, rng, 0), s);
});

test("C-U6 only the top and bottom words start solved", () => {
  const s = started();
  assert.deepEqual(s.chain.solved, [true, false, false, false, false, false, false, true]);
  assert.deepEqual(Core.columnRows(s.chain).map((r) => r.shown), [5, 0, 0, 0, 0, 0, 0, 3]);
});

/* ============================================================
   C-U7 — Speed Chain
   ============================================================ */

/** Play every chain out so the game is at the Speed Chain gate. Both rounds
    pay the same by default, so a clean sweep each leaves the scores level. */
function toChainsDone(game) {
  const g = game || tieGame();
  let s = started(g);
  const rounds = g.settings.values.length;
  for (let r = 0; r < rounds; r += 1) {
    if (r > 0) s = Core.reduce(s, { type: "nextChain" }, rng, 0);
    ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  }
  return s;
}

test("C-U7 toSpeed sets up the column with the first letter of every hidden word", () => {
  let s = toChainsDone();
  s = Core.reduce(s, { type: "toSpeed", team: 0 }, rng, 0);
  assert.equal(s.phase, "speed");
  const rows = Core.speedColumn(s);
  const words = s.speed.words;
  assert.deepEqual(rows.map((r) => r.shown),
    [words[0].length, 1, 1, 1, 1, 1, 1, words[7].length],
    "top and bottom full, one letter each between");
  assert.equal(rows[1].cells[0].ch, words[1][0]);
  assert.equal(rows[1].cells.filter((c) => c.ch !== null).length, 1);
  assert.equal(Core.speedCurrent(s), 1);
  assert.equal(s.speed.started, false);
  assert.equal(s.speed.deadline, null);
});

test("C-U7 speedStart stores a deadline and nothing else", () => {
  let s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  s = Core.reduce(s, { type: "speedStart" }, rng, 10000);
  assert.equal(s.speed.deadline, 10000 + 60000);
  assert.equal(Core.secondsLeft(s.speed.deadline, 10000), 60);
  assert.equal(Core.secondsLeft(s.speed.deadline, 55000), 15);
  assert.equal(Core.secondsLeft(s.speed.deadline, 99000), 0);
  assert.equal(Core.reduce(s, { type: "speedStart" }, rng, 20000), s, "starting twice is a no-op");
});

test("C-U7 a mark before the clock starts is refused", () => {
  const s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  assert.equal(Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0), s);
});

test("C-U7 a passed word comes back at the end of the queue", () => {
  let s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  s = Core.reduce(s, { type: "speedStart" }, rng, 0);
  assert.deepEqual(s.speed.queue, [1, 2, 3, 4, 5, 6]);
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng, 0);
  assert.deepEqual(s.speed.queue, [2, 3, 4, 5, 6, 1]);
  assert.equal(Core.speedCurrent(s), 2);
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0);
  assert.deepEqual(s.speed.queue, [3, 4, 5, 6, 1]);
  assert.equal(s.speed.solved[2], true);
});

test("C-U7 all six pays the all-clear bonus and ends the round", () => {
  let s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  const before = s.scores[0];
  s = Core.reduce(s, { type: "speedStart" }, rng, 0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0);
  assert.equal(s.speed.over, true);
  assert.equal(s.speed.allClear, true);
  assert.equal(s.speed.got, 6);
  assert.equal(s.speed.award, 1000);
  assert.equal(s.scores[0], before + 1000);
  assert.equal(s.speed.deadline, null, "the clock stops");
});

test("C-U7 expiry pays per word and freezes the board", () => {
  let s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 1 }, rng, 0);
  const before = s.scores[1];
  s = Core.reduce(s, { type: "speedStart" }, rng, 0);
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0);
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0);
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng, 0);
  s = Core.reduce(s, { type: "speedExpired" }, rng, 60000);
  assert.equal(s.speed.over, true);
  assert.equal(s.speed.got, 2);
  assert.equal(s.speed.award, 200);
  assert.equal(s.scores[1], before + 200);
  assert.equal(Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0), s, "marks after time are refused");
  assert.equal(Core.reduce(s, { type: "speedExpired" }, rng, 70000), s, "expiring twice pays once");
});

test("C-U7 toSpeed defaults to the leading team and refuses a tie", () => {
  let s = toChainsDone();
  assert.deepEqual(s.scores, [600, 600], "the fixture leaves it level");
  assert.equal(s.chainIndex, 1);
  assert.equal(Core.leader(s), null);
  assert.equal(Core.reduce(s, { type: "toSpeed", team: null }, rng, 0), s, "no leader yet");
  s = Core.reduce(s, { type: "suddenDeath" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
  const chosen = Core.reduce(s, { type: "toSpeed", team: null }, rng, 0);
  assert.equal(chosen.speed.team, Core.leader(s));
});

test("C-U7 the Speed Chain cannot start before the chains are finished", () => {
  const s = started();
  assert.equal(Core.reduce(s, { type: "toSpeed", team: 0 }, rng, 0), s);
  assert.equal(Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0), s);
});

/* ============================================================
   C-U8 — sudden death
   ============================================================ */

test("C-U8 a tie after the chains goes to one sudden-death word", () => {
  let s = toChainsDone();
  assert.equal(Core.leader(s), null);
  s = Core.reduce(s, { type: "suddenDeath" }, rng, 0);
  assert.equal(s.phase, "sudden");
  assert.ok(s.sudden.word, "a word to guess");
  assert.ok(s.sudden.before && s.sudden.after, "its two neighbours are the clue");
  assert.equal(s.sudden.revealed.some(Boolean), false, "it starts blank");
  assert.equal(s.sudden.winner, null);
});

test("C-U8 sudden death reveals letters and the first correct call takes it", () => {
  let s = Core.reduce(toChainsDone(), { type: "suddenDeath" }, rng, 0);
  const first = s.control;
  const second = first === 0 ? 1 : 0;
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  assert.equal(s.sudden.revealed[0], true);
  assert.equal(s.sudden.revealed.filter(Boolean).length, 1, "one letter at a time");
  s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  assert.equal(s.control, second, "a wrong call hands it to the other team");
  assert.equal(s.sudden.winner, null);
  s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
  assert.equal(s.sudden.winner, second);
  assert.equal(s.phase, "chainDone");
  assert.equal(Core.leader(s), second, "the tie is broken");
  assert.equal(s.scores[second], 700, "600 plus the last chain's value");
  assert.equal(Core.reduce(s, { type: "judge", correct: true }, rng, 0), s, "it cannot be won twice");
});

test("C-U8 sudden death is refused when somebody is already ahead", () => {
  let s = started();
  ["top", "top", "top", "top", "bottom", "bottom"].forEach((d) => { s = solve(s, d); });
  s = Core.reduce(s, { type: "nextChain" }, rng, 0);
  ["top", "top", "top", "top", "bottom"].forEach((d) => { s = solve(s, d); });
  s = Core.reduce(s, { type: "passControl" }, rng, 0);
  s = solve(s, "bottom");
  assert.equal(s.phase, "chainDone");
  assert.notEqual(Core.leader(s), null);
  assert.equal(Core.reduce(s, { type: "suddenDeath" }, rng, 0), s);
});

test("C-U8 the sudden-death word comes from a chain nobody has played", () => {
  const s = Core.reduce(toChainsDone(), { type: "suddenDeath" }, rng, 0);
  const played = [tieGame().chains[0], tieGame().chains[1]];
  const inPlayed = played.some((chain) => chain.indexOf(s.sudden.word) >= 0);
  assert.equal(inPlayed, false, `${s.sudden.word} came from a played chain`);
});

/* ============================================================
   C-U9 — undo, illegal events, immutability
   ============================================================ */

test("C-U9 undo steps back one action and can be repeated", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
  assert.deepEqual(s.scores, [100, 0]);
  s = Core.reduce(s, { type: "undo" }, rng, 0);
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.target, 1, "back to the guess");
  s = Core.reduce(s, { type: "undo" }, rng, 0);
  assert.equal(s.target, null, "back before the reveal");
  assert.equal(Core.columnRows(s.chain)[1].shown, 0);
});

test("C-U9 undo on a fresh state is a no-op", () => {
  const s = Core.createState(tinyGame(), TEAMS, {});
  assert.equal(s.history.length, 0);
  assert.equal(Core.reduce(s, { type: "undo" }, rng, 0), s);
});

test("C-U9 typing a guess never fills the undo stack", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  const depth = s.history.length;
  s = Core.reduce(s, { type: "guess", text: "sh" }, rng, 0);
  s = Core.reduce(s, { type: "guess", text: "shi" }, rng, 0);
  s = Core.reduce(s, { type: "guess", text: "ship" }, rng, 0);
  assert.equal(s.history.length, depth, "the typing is not an undo step");
  assert.equal(s.guessText, "ship");
});

test("C-U9 the undo stack is capped", () => {
  let s = started();
  for (let i = 0; i < Core.MAX_HISTORY + 20; i += 1) s = Core.reduce(s, { type: "passControl" }, rng, 0);
  assert.equal(s.history.length, Core.MAX_HISTORY);
});

test("C-U9 unknown, malformed and prototype-shaped events return the same object", () => {
  const s = started();
  const junk = [
    { type: "nope" }, { type: "" }, {}, null, undefined, 7, "reveal", [],
    { type: "toString" }, { type: "__proto__" }, { type: "constructor" },
    { type: "hasOwnProperty" }, { type: "valueOf" },
  ];
  junk.forEach((event) => assert.equal(Core.reduce(s, event, rng, 0), s, JSON.stringify(event)));
  assert.equal(Core.reduce(null, { type: "start" }, rng, 0), null);
  assert.equal(typeof s.phase, "string", "the probes did not corrupt the state");
});

test("C-U9 illegal events for the current phase are refused", () => {
  const s = started();
  [
    { type: "start" }, { type: "nextChain" }, { type: "speedStart" },
    { type: "speedExpired" }, { type: "suddenDeath" },
    { type: "judge", correct: true }, { type: "reveal", direction: "sideways" },
    { type: "reveal" }, { type: "speedMark", result: "maybe" },
  ].forEach((event) => assert.equal(Core.reduce(s, event, rng, 0), s, JSON.stringify(event)));
});

test("C-U9 the reducer never mutates the state it is given", () => {
  const s = started();
  const before = JSON.stringify(s);
  const events = [
    { type: "reveal", direction: "top" }, { type: "judge", correct: true },
    { type: "guess", text: "x" }, { type: "passControl" }, { type: "undo" },
  ];
  events.forEach((event) => Core.reduce(s, event, rng, 0));
  assert.equal(JSON.stringify(s), before);
});

test("C-U9 createState refuses a line-up that is not two named teams", () => {
  const g = tinyGame();
  assert.throws(() => Core.createState(g, [], {}), /exactly two teams/);
  assert.throws(() => Core.createState(g, [{ name: "A" }], {}), /exactly two teams/);
  assert.throws(() => Core.createState(g, [{ name: "A" }, { name: " " }], {}), /Team 2 needs a name/);
  assert.throws(() => Core.createState(g, [{ name: "A" }, { name: "a" }], {}), /different names/);
  assert.throws(() => Core.createState(g, [{ name: "A", pids: ["p1"] }, { name: "B", pids: ["p1"] }], {}),
    /cannot play for both teams/);
});

test("C-U9 legalActions names exactly the buttons that would do something", () => {
  let s = started();
  assert.deepEqual(Core.legalActions(s).sort(), ["finish", "guess", "passControl", "reveal", "undo"]);
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  assert.ok(Core.legalActions(s).indexOf("judge") >= 0);
  assert.ok(Core.legalActions(s).indexOf("reveal") < 0);
  assert.ok(Core.legalActions(s).indexOf("undo") >= 0);
});

test("C-U9 finish ends the night from any live phase and records the winner", () => {
  let s = started();
  s = solve(s, "top");
  s = Core.reduce(s, { type: "finish" }, rng, 0);
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.winner, 0);
  assert.deepEqual(Core.standings(s).map((r) => r.name), ["Red", "Blue"]);
  assert.equal(Core.standings(s)[0].money, "$100");
});

/* ============================================================
   C-U10 — no phone view ever carries a hidden letter
   ============================================================ */

/** Every letter of an unsolved word that is NOT showing must be absent. */
function assertNoLeak(state, label) {
  const payload = JSON.stringify(Core.phoneView(state, "p1")) + JSON.stringify(Core.phoneView(state, "p3"))
    + JSON.stringify(Core.phoneView(state, "nobody"));
  const chains = [state.chain, state.speed].filter(Boolean);
  chains.forEach((chain) => {
    chain.words.forEach((word, i) => {
      if (chain.solved[i]) return;
      assert.ok(payload.indexOf(word) < 0, `${label}: "${word}" leaked`);
      const cells = Core.columnRows(chain)[i].cells;
      cells.forEach((cell, c) => {
        if (!cell.lit) assert.equal(cell.ch, null, `${label}: character ${c} of ${word} was not masked`);
      });
    });
  });
  if (state.sudden && state.sudden.winner === null) {
    const lit = state.sudden.revealed.every(Boolean);
    if (!lit) assert.ok(payload.indexOf(state.sudden.word) < 0, `${label}: the sudden-death word leaked`);
  }
}

test("C-U10 phoneView masks every unrevealed letter, in every phase", () => {
  let s = started();
  assertNoLeak(s, "fresh chain");
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  assertNoLeak(s, "one letter shown");
  s = Core.reduce(s, { type: "judge", correct: false }, rng, 0);
  assertNoLeak(s, "after a wrong guess");
  s = Core.reduce(s, { type: "reveal", direction: "bottom" }, rng, 0);
  assertNoLeak(s, "other end open");
});

test("C-U10 the Speed Chain view carries first letters only", () => {
  let s = Core.reduce(toChainsDone(), { type: "toSpeed", team: 0 }, rng, 0);
  assertNoLeak(s, "speed set up");
  s = Core.reduce(s, { type: "speedStart" }, rng, 0);
  assertNoLeak(s, "speed running");
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng, 0);
  assertNoLeak(s, "after a pass");
  const view = Core.phoneView(s, "p1");
  assert.equal(view.screen, "speed");
  assert.equal(view.column[2].cells.filter((c) => c.ch !== null).length, 1, "one letter of the next word");
});

test("C-U10 the sudden-death word is masked on every phone", () => {
  let s = Core.reduce(toChainsDone(), { type: "suddenDeath" }, rng, 0);
  assertNoLeak(s, "sudden death");
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  assertNoLeak(s, "sudden death, one letter");
  const view = Core.phoneView(s, "p1");
  assert.equal(view.column[0].cells.filter((c) => c.ch !== null).length, 1);
  assert.ok(view.sudden.before && view.sudden.after, "the neighbours are the clue");
});

test("C-U10 phoneView tells each phone only its own role", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  const mine = Core.phoneView(s, "p1");
  const theirs = Core.phoneView(s, "p3");
  const stranger = Core.phoneView(s, "zz");
  assert.equal(mine.screen, "control");
  assert.equal(mine.mine, true);
  assert.equal(theirs.screen, "watch");
  assert.equal(theirs.mine, false);
  assert.equal(stranger.screen, "watch");
  assert.equal(stranger.team, null);
  assert.equal(Core.teamOf(s, "p2"), 0);
  assert.equal(Core.teamOf(s, "p3"), 1);
  assert.equal(Core.teamOf(s, "nope"), null);
});

test("C-U10 phoneView survives a missing state and an unknown phase", () => {
  assert.equal(Core.phoneView(null, "p1").screen, "wait");
  const broken = Object.assign({}, started(), { phase: "nowhere" });
  assert.equal(Core.phoneView(broken, "p1").screen, "wait");
});

/* ============================================================
   Phone payload validation (host is authoritative)
   ============================================================ */

test("validatePhoneMsg accepts only the three documented shapes", () => {
  assert.deepEqual(Core.validatePhoneMsg({ t: "direction", dir: "top" }), { t: "direction", dir: "top" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "direction", dir: "bottom" }), { t: "direction", dir: "bottom" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "guess", text: "  ship  " }), { t: "guess", text: "ship" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "speed", result: "pass" }), { t: "speed", result: "pass" });
  [
    null, undefined, 5, "guess", [], {}, { t: "direction" }, { t: "direction", dir: "left" },
    { t: "guess" }, { t: "guess", text: "" }, { t: "guess", text: "   " },
    { t: "speed", result: "maybe" }, { t: "judge", correct: true }, { t: "start" },
  ].forEach((raw) => assert.equal(Core.validatePhoneMsg(raw), null, JSON.stringify(raw)));
});

test("validatePhoneMsg caps a typed guess and strips control characters", () => {
  const long = Core.validatePhoneMsg({ t: "guess", text: "x".repeat(200) });
  assert.equal(long.text.length, Core.GUESS_MAX);
  const dirty = Core.validatePhoneMsg({ t: "guess", text: "sh ip" });
  assert.equal(dirty.text, "ship");
});

test("a phone guess is recorded and never judged", () => {
  let s = started();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng, 0);
  s = Core.reduce(s, { type: "guess", text: "SHIP", pid: "p1" }, rng, 0);
  assert.equal(s.guessText, "SHIP");
  assert.equal(s.guessBy, "p1");
  assert.equal(s.chain.solved[1], false, "still unsolved until the host judges");
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(Core.sameWord("ship", "SHIP"), true, "the host still gets a hint");
  assert.equal(Core.sameWord("boat", "SHIP"), false);
});

test("the full shipped game plays three chains and a Speed Chain end to end", () => {
  let s = Core.reduce(Core.createState(SHIPPED, TEAMS, {}), { type: "start" }, rng, 0);
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) s = Core.reduce(s, { type: "nextChain" }, rng, 0);
    let guard = 0;
    while (s.phase === "chain" && guard < 200) {
      guard += 1;
      s = Core.reduce(s, { type: "reveal", direction: guard % 2 ? "top" : "bottom" }, rng, 0);
      if (s.target !== null) s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
    }
    assert.equal(s.phase, "chainDone", `round ${round + 1} finished`);
  }
  assert.equal(Core.chainsLeft(s), 0);
  if (Core.leader(s) === null) {
    s = Core.reduce(s, { type: "suddenDeath" }, rng, 0);
    s = Core.reduce(s, { type: "judge", correct: true }, rng, 0);
  }
  s = Core.reduce(s, { type: "toSpeed", team: null }, rng, 0);
  s = Core.reduce(s, { type: "speedStart" }, rng, 0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng, 0);
  assert.equal(s.speed.allClear, true);
  s = Core.reduce(s, { type: "finish" }, rng, 0);
  assert.equal(s.phase, "result");
  assert.ok(s.scores[0] + s.scores[1] > 0);
});

test("the harness fixture is a valid game", () => {
  const fixture = JSON.parse(readFileSync(join(HERE, "fixtures", "harness-game.json"), "utf8"));
  assert.equal(Core.validateGame(fixture), true);
});
