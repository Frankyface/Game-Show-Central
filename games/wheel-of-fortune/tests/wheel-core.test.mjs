/* ============================================================
   Wheel of Fortune — unit tests for the pure core (spec 04 §8,
   success states W-U1 … W-U10). Zero npm deps: node:test +
   node:assert only. Run from games/wheel-of-fortune:
     node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import WC from "../js/wheel-core.js";
import DEFAULT_PUZZLES from "../js/data.js";

/* ---- helpers ------------------------------------------------ */

/** Deterministic LCG so every rng-injected path is reproducible. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** An rng that returns each queued value once, then 0. */
function scripted(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

const CTRL_RE = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]");


function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

const PLAYERS = [
  { pid: "p1", name: "Ana" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cid" },
];

/** A single-regular-round game, wheel forced to a known shape. */
function regularGame(puzzle = "THE CORNER COFFEE SHOP", extra = {}) {
  return {
    title: "T",
    settings: {
      vowelCost: 250,
      roundMinimum: 1000,
      // 12 wedges: index 0 = $500, 1 = BANKRUPT, 2 = LOSE A TURN, rest $500..
      wedges: [500, "BANKRUPT", "LOSE A TURN", 600, 700, 800, 900, 650, 550, 500, 700, 600],
      ...extra,
    },
    rounds: [{ type: "regular", category: "Place", puzzle }],
  };
}

/** Start a regular round with 3 players and land the given rng. */
function regularState(game = regularGame()) {
  const s = WC.createState(game, PLAYERS);
  return WC.reduce(s, { type: "start" }, lcg(1));
}

/** Spin so that wedge `index` comes up on a 12-wedge wheel. */
const spinTo = (state, index) =>
  WC.reduce(state, { type: "spin" }, () => (index + 0.5) / state.round.wedges.length);

/* ============================================================
   W-U1 — validateGame
   ============================================================ */

test("W-U1 validateGame accepts the shipped puzzles.json", () => {
  assert.doesNotThrow(() => WC.validateGame(clone(DEFAULT_PUZZLES)));
  const g = WC.normalizeGame(clone(DEFAULT_PUZZLES));
  assert.equal(g.rounds.length, 10);
  assert.equal(g.rounds.filter((r) => r.type === "tossup").length, 2);
  assert.equal(g.rounds.filter((r) => r.type === "regular").length, 7);
  assert.equal(g.rounds.filter((r) => r.type === "bonus").length, 1);
  assert.equal(g.rounds[g.rounds.length - 1].type, "bonus");
  assert.equal(g.settings.wedges.length, 24);
});

test("W-U1 validateGame rejects bad content with a plain-English message", () => {
  const bad = (mutate, match) => {
    const data = clone(DEFAULT_PUZZLES);
    mutate(data);
    assert.throws(() => WC.validateGame(data), match, `expected a rejection for ${match}`);
  };
  // lowercase + digits: digits are never legal on the board.
  bad((d) => { d.rounds[1].puzzle = "level 42 unlocked"; }, /only use letters/);
  // 60 letters cannot fit 52 tiles.
  bad((d) => { d.rounds[1].puzzle = "AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLLL MMMM NNNN"; },
    /does not fit the board/);
  // a single word longer than the widest row
  bad((d) => { d.rounds[1].puzzle = "SUPERCALIFRAGILISTIC"; }, /does not fit the board/);
  bad((d) => { d.rounds.push({ type: "bonus", category: "X", puzzle: "TWO BONUS" }); },
    /bonus round must be the last round|Only one bonus/);
  bad((d) => { d.rounds[1].type = "bonus"; }, /bonus round must be the last round/);
  bad((d) => { d.settings.wedges = new Array(12).fill("BANKRUPT"); }, /at least one dollar wedge/);
  bad((d) => { d.settings.wedges[0] = -100; }, /positive whole number/);
  bad((d) => { d.settings.wedges[0] = 555; }, /multiple of 50/);
  bad((d) => { d.settings.wedges = [500, 600]; }, /between 12 and 32 wedges/);
  bad((d) => { d.rounds[1].category = "   "; }, /"category" is required/);
  bad((d) => { d.rounds[1].category = "x".repeat(31); }, /longer than 30/);
  bad((d) => { d.rounds = []; }, /non-empty array/);
  bad((d) => { d.settings.vowelCost = 0; }, /vowelCost/);
  bad((d) => { d.settings.bonusSeconds = 61; }, /bonusSeconds/);
  assert.throws(() => WC.validateGame(null), /must be a JSON object/);
  assert.throws(() => WC.validateGame([]), /must be a JSON object/);
});

test("W-U1 normalizeGame uppercases puzzles and fills settings defaults", () => {
  const g = WC.normalizeGame({ rounds: [{ category: "Thing", puzzle: "  hello   world " }] });
  assert.equal(g.rounds[0].puzzle, "HELLO WORLD");
  assert.equal(g.rounds[0].type, "regular");
  assert.deepEqual(g.settings.wedges, WC.DEFAULT_WEDGES.slice());
  assert.equal(g.settings.vowelCost, 250);
  assert.equal(g.settings.roundMinimum, 1000);
  assert.equal(g.settings.bonusPrize, "$25,000");
});

test("W-U1 autoOrder sorts tossup, regular, bonus", () => {
  const g = WC.normalizeGame({
    settings: { autoOrder: true },
    rounds: [
      { type: "regular", category: "A", puzzle: "ONE" },
      { type: "tossup", category: "B", puzzle: "TWO" },
      { type: "bonus", category: "C", puzzle: "THREE" },
    ],
  });
  assert.deepEqual(g.rounds.map((r) => r.type), ["tossup", "regular", "bonus"]);
});

/* ============================================================
   W-U2 — layoutPuzzle
   ============================================================ */

test("W-U2 layoutPuzzle never splits a word and respects 12/14/14/12", () => {
  const rows = WC.layoutPuzzle("HOT CHOCOLATE WITH MARSHMALLOWS");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.length), WC.ROW_CAPS);
  const text = rows.map((r) => r.map((c) => (c ? c.ch : " ")).join("").trim()).filter(Boolean);
  assert.deepEqual(text, ["HOT", "CHOCOLATE WITH", "MARSHMALLOWS"]);
  // Every word appears whole on exactly one row.
  for (const word of "HOT CHOCOLATE WITH MARSHMALLOWS".split(" ")) {
    assert.equal(text.filter((line) => line.split(" ").includes(word)).length, 1, word);
  }
});

test("W-U2 layoutPuzzle centres each row", () => {
  const rows = WC.layoutPuzzle("GAME SHOW CENTRAL");
  for (const row of rows) {
    const first = row.findIndex((c) => c);
    if (first < 0) continue;
    let last = row.length - 1;
    while (!row[last]) last -= 1;
    const left = first;
    const right = row.length - 1 - last;
    assert.ok(Math.abs(left - right) <= 1, `row not centred: left=${left} right=${right}`);
  }
});

test("W-U2 layoutPuzzle returns null when it cannot fit", () => {
  assert.equal(WC.layoutPuzzle("SUPERCALIFRAGILISTIC"), null); // 20 > widest row (14)
  assert.equal(WC.layoutPuzzle("ABCDEFGHIJKLMNO"), null); // 15 > 14
  assert.equal(WC.layoutPuzzle(
    "AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ KKKK LLLL MMMM"), null);
  assert.equal(WC.layoutPuzzle(""), null);
  assert.equal(WC.layoutPuzzle("digits 123"), null);
  assert.equal(WC.layoutPuzzle(null), null);
  assert.notEqual(WC.layoutPuzzle("ABCDEFGHIJKLMN"), null); // exactly 14 fits row 2
});

test("W-U2 punctuation occupies a tile and layout is deterministic", () => {
  const rows = WC.layoutPuzzle("THE WINNER'S CIRCLE");
  const cells = rows.flat().filter(Boolean).map((c) => c.ch).join("");
  assert.ok(cells.includes("'"), "apostrophe must own a tile");
  assert.equal(cells.replace(/'/g, "").length, "THEWINNERSCIRCLE".length);
  assert.deepEqual(WC.layoutPuzzle("THE WINNER'S CIRCLE"), rows);
  // cell.i indexes the normalised puzzle text
  const text = "THE WINNER'S CIRCLE";
  for (const cell of rows.flat().filter(Boolean)) assert.equal(text[cell.i], cell.ch);
});

/* ============================================================
   W-U3 — the wheel
   ============================================================ */

test("W-U3 spin lands on the index the injected rng picks", () => {
  const s = regularState();
  for (let i = 0; i < 12; i += 1) {
    const out = WC.reduce(s, { type: "spin" }, () => (i + 0.5) / 12);
    assert.equal(out.wedge.index, i);
    assert.equal(out.wedge.value, s.round.wedges[i]);
  }
  // rng() === 1 must stay in range rather than fall off the end.
  assert.equal(WC.reduce(s, { type: "spin" }, () => 1).wedge.index, 11);
  assert.equal(WC.reduce(s, { type: "spin" }, () => 0).wedge.index, 0);
});

test("W-U3 BANKRUPT zeroes the round total only, and passes the turn", () => {
  let s = regularState();
  s = spinTo(s, 0); // $500
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // 2 R's => $1000
  assert.equal(s.players[0].round, 1000);
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, total: 4000 } : p)) };
  s = spinTo(s, 1); // BANKRUPT
  assert.equal(s.wedge.value, WC.BANKRUPT);
  assert.equal(s.players[0].round, 0, "round total wiped");
  assert.equal(s.players[0].total, 4000, "banked total is safe");
  assert.equal(s.turn, 1, "turn passes");
  assert.equal(s.pendingSpin, false);
});

test("W-U3 LOSE A TURN passes the turn and keeps the money", () => {
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  const before = s.players[0].round;
  s = spinTo(s, 2); // LOSE A TURN
  assert.equal(s.wedge.value, WC.LOSE_TURN);
  assert.equal(s.players[0].round, before);
  assert.equal(s.turn, 1);
  assert.equal(s.pendingSpin, false);
});

test("W-U3 a dollar wedge requires a consonant next", () => {
  let s = regularState();
  s = spinTo(s, 0);
  assert.equal(s.pendingSpin, true);
  const actions = WC.legalActions(s);
  assert.equal(actions.spin, false);
  assert.equal(actions.buyVowel, false);
  assert.equal(actions.solve, false);
  assert.ok(actions.letters.includes("R"));
  assert.ok(!actions.letters.some((L) => WC.isVowel(L)), "no vowels after a spin");
  // A second spin before calling a letter is illegal.
  assert.equal(spinTo(s, 3), s);
});

/* ============================================================
   W-U4 — calling letters and buying vowels
   ============================================================ */

test("W-U4 callLetter reveals every occurrence, pays value x count, keeps the turn", () => {
  let s = regularState(); // THE CORNER COFFEE SHOP
  s = spinTo(s, 0); // $500
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  assert.equal(WC.letterCount("THE CORNER COFFEE SHOP", "R"), 2);
  assert.equal(s.players[0].round, 1000);
  assert.equal(s.turn, 0, "turn kept");
  assert.ok(s.used.includes("R"));
  const shown = WC.boardView(s).rows.flat().filter((c) => c && c.ch === "R");
  assert.equal(shown.length, 2);
});

test("W-U4 an absent letter passes the turn; a used letter is not offered", () => {
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "B" }); // no B in THE CORNER COFFEE SHOP
  assert.equal(s.players[0].round, 0);
  assert.equal(s.turn, 1);
  assert.ok(s.used.includes("B"));
  s = spinTo(s, 0);
  assert.ok(!WC.legalActions(s).letters.includes("B"), "used letters are never re-offered");
  assert.equal(WC.reduce(s, { type: "callLetter", letter: "B" }), s, "re-calling B is a no-op");
});

test("W-U4 a vowel after a spin is illegal", () => {
  let s = regularState();
  s = spinTo(s, 0);
  assert.equal(WC.reduce(s, { type: "callLetter", letter: "A" }), s);
  assert.equal(WC.reduce(s, { type: "callLetter", letter: "E" }), s);
});

test("W-U4 buying a vowel deducts and needs round >= cost", () => {
  let s = regularState();
  assert.equal(WC.legalActions(s).buyVowel, false, "broke players cannot buy");
  assert.equal(WC.reduce(s, { type: "buyVowel" }), s);
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // 2 R's => $1000
  assert.equal(WC.legalActions(s).buyVowel, true);
  s = WC.reduce(s, { type: "buyVowel" });
  assert.equal(s.players[0].round, 750, "cost deducted");
  assert.equal(s.pendingVowel, true);
  assert.deepEqual(WC.legalActions(s).letters, ["A", "E", "I", "O", "U"]);
  assert.equal(WC.reduce(s, { type: "callLetter", letter: "T" }), s, "consonants illegal now");
  s = WC.reduce(s, { type: "callLetter", letter: "E" }); // 4 E's, no money
  assert.equal(s.players[0].round, 750, "vowels never pay");
  assert.equal(s.turn, 0, "a revealed vowel keeps the turn");
  const missed = WC.reduce(
    WC.reduce(s, { type: "buyVowel" }), { type: "callLetter", letter: "I" });
  assert.equal(missed.turn, 1, "a missed vowel passes the turn");
});

/* ============================================================
   W-U5 — solving
   ============================================================ */

test("W-U5 a correct solve banks max(round, roundMinimum) and clears the others", () => {
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // Ana: $1000
  s = WC.reduce(s, { type: "nextPlayer" });
  s = spinTo(s, 5); // $800 for Ben
  s = WC.reduce(s, { type: "callLetter", letter: "T" }); // 1 T => $800
  assert.equal(s.players[1].round, 800);
  s = WC.reduce(s, { type: "solveAttempt", text: "the corner coffee shop" });
  assert.equal(s.solving, true);
  s = WC.reduce(s, { type: "solveJudged", correct: true });
  assert.equal(s.players[1].total, 1000, "$800 rounds up to the $1,000 minimum");
  assert.equal(s.players[1].round, 0);
  assert.equal(s.players[0].round, 0, "everyone else's round total resets");
  assert.equal(s.players[0].total, 0);
  assert.equal(s.roundDone, true);
  assert.ok(WC.allRevealed(s.round.puzzle, s.revealed));
  // ...and the next round advances, started by the solver.
  const next = WC.reduce(s, { type: "nextRound" });
  assert.equal(next.phase, "final", "one-round game ends after the solve");
});

test("W-U5 a big round total banks in full and the solver starts the next round", () => {
  const game = regularGame("THE CORNER COFFEE SHOP");
  game.rounds.push({ type: "regular", category: "Thing", puzzle: "GAME SHOW CENTRAL" });
  let s = regularState(game);
  s = WC.reduce(s, { type: "nextPlayer" }); // Ben on turn
  s = spinTo(s, 6); // $900
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // 2 R => $1800
  assert.equal(s.players[1].round, 1800);
  s = WC.reduce(s, { type: "solveAttempt", text: "THE CORNER COFFEE SHOP" });
  s = WC.reduce(s, { type: "solveJudged", correct: true });
  assert.equal(s.players[1].total, 1800);
  s = WC.reduce(s, { type: "nextRound" });
  assert.equal(s.roundIndex, 1);
  assert.equal(s.turn, 1, "the solver starts the next round");
  assert.equal(s.players[1].round, 0);
  assert.equal(s.players[1].total, 1800, "banked money carries over");
});

test("W-U5 a wrong solve passes the turn", () => {
  let s = regularState();
  s = WC.reduce(s, { type: "solveAttempt", text: "NOPE" });
  s = WC.reduce(s, { type: "solveJudged", correct: false });
  assert.equal(s.turn, 1);
  assert.equal(s.solving, false);
  assert.equal(s.roundDone, false);
});

/* ============================================================
   W-U6 — only-vowels-left / full board
   ============================================================ */

test("W-U6 onlyVowelsLeft disables spin", () => {
  let s = regularState(regularGame("A CAT"));
  assert.equal(WC.onlyVowelsLeft(s.round.puzzle, s.revealed), false);
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "C" });
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "T" });
  assert.equal(WC.onlyVowelsLeft(s.round.puzzle, s.revealed), true);
  const actions = WC.legalActions(s);
  assert.equal(actions.spin, false, "spin is disabled when only vowels remain");
  assert.equal(actions.solve, true);
  assert.equal(WC.reduce(s, { type: "spin" }, () => 0.5), s, "spin event is ignored");
});

test("W-U6 a fully revealed board still needs a solve confirmation", () => {
  let s = regularState(regularGame("A CAT"));
  s = WC.reduce(s, { type: "revealAll" });
  assert.equal(s.roundDone, true);
  s = regularState(regularGame("AT"));
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "T" });
  s = WC.reduce(s, { type: "buyVowel" });
  assert.equal(s.players[0].round, 250);
  s = WC.reduce(s, { type: "callLetter", letter: "A" });
  assert.ok(WC.allRevealed(s.round.puzzle, s.revealed));
  assert.equal(s.roundDone, false, "the board being full does not end the round on its own");
  const actions = WC.legalActions(s);
  assert.equal(actions.spin, false);
  assert.equal(actions.buyVowel, false);
  assert.equal(actions.solve, true, "only a confirmed solve closes the round");
  s = WC.reduce(s, { type: "solveAttempt", text: "AT" });
  s = WC.reduce(s, { type: "solveJudged", correct: true });
  assert.equal(s.roundDone, true);
});

/* ============================================================
   W-U7 — toss-up
   ============================================================ */

function tossupGame() {
  return {
    settings: { tossUpValues: [1000, 2000] },
    rounds: [
      { type: "tossup", category: "Phrase", puzzle: "EASIER SAID THAN DONE" },
      { type: "tossup", category: "Thing", puzzle: "GAME SHOW CENTRAL" },
    ],
  };
}

function startedTossup(rng = lcg(7)) {
  let s = WC.createState(tossupGame(), PLAYERS);
  s = WC.reduce(s, { type: "start" }, rng);
  return WC.reduce(s, { type: "tossupStart" }, rng);
}

test("W-U7 the reveal order is a permutation of the hidden letter positions", () => {
  const s = startedTossup();
  const puzzle = s.round.puzzle;
  const expected = [];
  for (let i = 0; i < puzzle.length; i += 1) if (/[A-Z]/.test(puzzle[i])) expected.push(i);
  const order = s.tossup.revealOrder;
  assert.equal(order.length, expected.length);
  assert.deepEqual([...order].sort((a, b) => a - b), expected);
  assert.equal(new Set(order).size, order.length, "no duplicates");
  // Deterministic for a given rng seed.
  assert.deepEqual(startedTossup(lcg(7)).tossup.revealOrder, order);
});

test("W-U7 a buzz pauses reveals and locks the other players out", () => {
  let s = startedTossup();
  s = WC.reduce(s, { type: "tossupRevealNext" });
  s = WC.reduce(s, { type: "tossupRevealNext" });
  const shown = s.revealed.filter(Boolean).length;
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p2" });
  assert.equal(s.tossup.buzzed, "p2");
  assert.equal(s.tossup.running, false);
  assert.equal(s.turn, 1);
  assert.equal(WC.reduce(s, { type: "tossupBuzz", pid: "p3" }), s, "a second buzz is ignored");
  assert.equal(WC.reduce(s, { type: "tossupRevealNext" }), s, "reveals are paused");
  assert.equal(s.revealed.filter(Boolean).length, shown);
});

test("W-U7 a wrong toss-up answer locks that player and resumes reveals", () => {
  let s = startedTossup();
  s = WC.reduce(s, { type: "tossupRevealNext" });
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p2" });
  s = WC.reduce(s, { type: "tossupJudged", correct: false });
  assert.deepEqual(s.tossup.locked, ["p2"]);
  assert.equal(s.tossup.buzzed, null);
  assert.equal(s.tossup.running, true, "reveals resume");
  assert.equal(WC.reduce(s, { type: "tossupBuzz", pid: "p2" }), s, "a locked player cannot re-buzz");
  const other = WC.reduce(s, { type: "tossupBuzz", pid: "p3" });
  assert.equal(other.tossup.buzzed, "p3");
  assert.equal(s.players[1].total, 0, "no points lost");
});

test("W-U7 a correct answer awards the nth toss-up value", () => {
  let s = startedTossup();
  s = WC.reduce(s, { type: "tossupRevealNext" });
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p1" });
  s = WC.reduce(s, { type: "tossupJudged", correct: true });
  assert.equal(s.players[0].total, 1000, "1st toss-up = tossUpValues[0]");
  assert.ok(WC.allRevealed(s.round.puzzle, s.revealed));
  assert.equal(s.roundDone, true);
  // The winner starts the next round, which is the 2nd toss-up.
  s = WC.reduce(s, { type: "nextRound" });
  assert.equal(s.round.value, 2000);
  assert.equal(s.turn, 0);
  s = WC.reduce(s, { type: "tossupStart" }, lcg(3));
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p3" });
  s = WC.reduce(s, { type: "tossupJudged", correct: true });
  assert.equal(s.players[2].total, 2000);
});

test("W-U7 nobody solving means no points", () => {
  let s = startedTossup();
  for (let i = 0; i < 200 && s.tossup.running; i += 1) {
    s = WC.reduce(s, { type: "tossupRevealNext" });
  }
  assert.equal(s.tossup.done, true);
  assert.equal(s.roundDone, true);
  assert.ok(WC.allRevealed(s.round.puzzle, s.revealed));
  assert.deepEqual(s.players.map((p) => p.total), [0, 0, 0]);
});

/* ============================================================
   W-U8 — bonus round
   ============================================================ */

function bonusState(totals = [3000, 5000, 1000]) {
  const game = {
    settings: { bonusPrize: "$25,000", bonusSeconds: 10 },
    rounds: [
      { type: "regular", category: "Thing", puzzle: "GAME SHOW CENTRAL" },
      { type: "bonus", category: "Place", puzzle: "THE WINNER'S CIRCLE" },
    ],
  };
  let s = WC.createState(game, PLAYERS);
  s = WC.reduce(s, { type: "start" }, lcg(1));
  s = { ...s, players: s.players.map((p, i) => ({ ...p, total: totals[i] })) };
  return WC.reduce(s, { type: "nextRound" });
}

test("W-U8 the leader plays the bonus round and RSTLNE are pre-revealed", () => {
  const s = bonusState();
  assert.equal(s.phase, "bonus");
  assert.equal(s.bonus.leaderPid, "p2");
  assert.equal(s.turn, 1);
  assert.deepEqual(s.used, ["R", "S", "T", "L", "N", "E"]);
  const puzzle = s.round.puzzle; // THE WINNER'S CIRCLE
  for (let i = 0; i < puzzle.length; i += 1) {
    if ("RSTLNE".includes(puzzle[i])) assert.equal(s.revealed[i], true, `${puzzle[i]}@${i}`);
    if ("WICO".includes(puzzle[i])) assert.equal(s.revealed[i], false, `${puzzle[i]}@${i}`);
  }
});

test("W-U8 ties go to the first player, and setTotal can override the leader", () => {
  assert.equal(bonusState([2000, 2000, 2000]).bonus.leaderPid, "p1");
  let s = bonusState([3000, 5000, 1000]);
  assert.equal(s.bonus.leaderPid, "p2");
  s = WC.reduce(s, { type: "setTotal", pid: "p3", total: 9000 });
  assert.equal(s.bonus.leaderPid, "p3", "host correction re-picks the bonus contestant");
  assert.equal(s.turn, 2);
  assert.deepEqual(s.used, ["R", "S", "T", "L", "N", "E"], "freebies stay revealed");
});

test("W-U8 picks must be 3 distinct unused consonants and 1 vowel", () => {
  const used = ["R", "S", "T", "L", "N", "E"];
  assert.deepEqual(WC.validateBonusPicks(["C", "D", "M", "O"], used), ["C", "D", "M", "O"]);
  assert.equal(WC.validateBonusPicks(["C", "D", "M"], used), null, "needs 4");
  assert.equal(WC.validateBonusPicks(["C", "C", "M", "O"], used), null, "distinct");
  assert.equal(WC.validateBonusPicks(["C", "D", "S", "O"], used), null, "S already used");
  assert.equal(WC.validateBonusPicks(["C", "D", "M", "E"], used), null, "E already used");
  assert.equal(WC.validateBonusPicks(["C", "A", "M", "O"], used), null, "no vowel in the first 3");
  assert.equal(WC.validateBonusPicks(["C", "D", "M", "P"], used), null, "4th must be a vowel");
  assert.equal(WC.validateBonusPicks(["C", "D", "M", "4"], used), null);
  assert.equal(WC.validateBonusPicks("CDMO", used), null);
});

test("W-U8 picks are revealed, then the host judges", () => {
  let s = bonusState();
  assert.equal(WC.reduce(s, { type: "bonusPick", letters: ["C", "D", "S", "O"] }), s, "illegal pick ignored");
  s = WC.reduce(s, { type: "bonusPick", letters: ["C", "D", "M", "O"] });
  assert.deepEqual(s.bonus.picks, ["C", "D", "M", "O"]);
  assert.equal(s.bonus.picked, true);
  assert.equal(s.bonus.timerRunning, true);
  const puzzle = s.round.puzzle;
  for (let i = 0; i < puzzle.length; i += 1) {
    if ("CO".includes(puzzle[i])) assert.equal(s.revealed[i], true);
    if (puzzle[i] === "W" || puzzle[i] === "I") assert.equal(s.revealed[i], false);
  }
  assert.equal(WC.reduce(s, { type: "bonusPick", letters: ["B", "F", "G", "A"] }), s, "one pick only");
  const win = WC.reduce(s, { type: "bonusJudged", correct: true });
  assert.equal(win.bonus.result, "win");
  assert.equal(win.bonus.timerRunning, false);
  assert.ok(win.banner.includes("$25,000"));
  assert.ok(WC.allRevealed(win.round.puzzle, win.revealed));
  const lose = WC.reduce(s, { type: "bonusJudged", correct: false });
  assert.equal(lose.bonus.result, "lose");
  assert.ok(WC.allRevealed(lose.round.puzzle, lose.revealed));
  assert.equal(WC.reduce(win, { type: "bonusJudged", correct: false }).bonus.result, "win");
});

/* ============================================================
   W-U9 — undo, illegal events, immutability
   ============================================================ */

test("W-U9 undo restores the exact previous state", () => {
  let s = regularState();
  const before = clone({ ...s, history: undefined });
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  const afterLetter = clone({ ...s, history: undefined });
  let back = WC.reduce(s, { type: "undo" });
  assert.equal(back.pendingSpin, true, "back to 'call a consonant'");
  assert.equal(back.players[0].round, 0);
  assert.deepEqual(back.used, []);
  back = WC.reduce(back, { type: "undo" });
  assert.deepEqual(clone({ ...back, history: undefined }), before, "undo is exact");
  // Redo-by-replay lands in the same place.
  let redo = spinTo(back, 0);
  redo = WC.reduce(redo, { type: "callLetter", letter: "R" });
  assert.deepEqual(clone({ ...redo, history: undefined }), afterLetter);
  // Undo past the beginning is a no-op.
  let empty = back;
  for (let i = 0; i < 5; i += 1) empty = WC.reduce(empty, { type: "undo" });
  assert.equal(WC.reduce(empty, { type: "undo" }), empty);
});

test("W-U9 illegal events are ignored (table-driven)", () => {
  const idle = WC.createState(regularGame(), PLAYERS);
  const round = regularState();
  const spun = spinTo(round, 0);
  const solving = WC.reduce(round, { type: "solveAttempt", text: "X" });
  const cases = [
    ["junk event", round, null],
    ["unknown type", round, { type: "nope" }],
    ["missing type", round, { foo: 1 }],
    ["start twice", round, { type: "start" }],
    ["spin before start", idle, { type: "spin" }],
    ["callLetter before start", idle, { type: "callLetter", letter: "R" }],
    ["callLetter without a spin", round, { type: "callLetter", letter: "R" }],
    ["callLetter junk", spun, { type: "callLetter", letter: "??" }],
    ["callLetter empty", spun, { type: "callLetter" }],
    ["buyVowel while broke", round, { type: "buyVowel" }],
    ["buyVowel mid-spin", spun, { type: "buyVowel" }],
    ["solve mid-spin", spun, { type: "solveAttempt", text: "X" }],
    ["solveJudged without an attempt", round, { type: "solveJudged", correct: true }],
    ["double solveAttempt", solving, { type: "solveAttempt", text: "Y" }],
    ["tossup events in a regular round", round, { type: "tossupStart" }],
    ["tossupBuzz in a regular round", round, { type: "tossupBuzz", pid: "p1" }],
    ["bonusPick in a regular round", round, { type: "bonusPick", letters: ["C", "D", "M", "O"] }],
    ["setTotal for an unknown pid", round, { type: "setTotal", pid: "zz", total: 5 }],
    ["setTotal with junk", round, { type: "setTotal", pid: "p1", total: "lots" }],
    ["nextRound before start", idle, { type: "nextRound" }],
  ];
  for (const [label, state, event] of cases) {
    assert.equal(WC.reduce(state, event, lcg(1)), state, `illegal: ${label}`);
  }
});

test("W-U9 the reducer never mutates its inputs", () => {
  const events = [
    { type: "spin" }, { type: "callLetter", letter: "R" }, { type: "buyVowel" },
    { type: "solveAttempt", text: "X" }, { type: "solveJudged", correct: true },
    { type: "nextPlayer" }, { type: "revealAll" }, { type: "nextRound" },
    { type: "setTotal", pid: "p1", total: 100 }, { type: "finish" }, { type: "undo" },
  ];
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  const frozen = deepFreeze(clone(s));
  const before = JSON.stringify(frozen);
  for (const ev of events) {
    assert.doesNotThrow(() => WC.reduce(frozen, deepFreeze({ ...ev }), lcg(9)), ev.type);
    assert.equal(JSON.stringify(frozen), before, `mutated on ${ev.type}`);
  }
  // Same for the toss-up and bonus paths.
  const toss = deepFreeze(clone(startedTossup()));
  const tossBefore = JSON.stringify(toss);
  for (const ev of [{ type: "tossupRevealNext" }, { type: "tossupBuzz", pid: "p1" },
    { type: "tossupStart" }, { type: "revealAll" }]) {
    WC.reduce(toss, ev, lcg(2));
    assert.equal(JSON.stringify(toss), tossBefore, `mutated on ${ev.type}`);
  }
  const bonus = deepFreeze(clone(bonusState()));
  const bonusBefore = JSON.stringify(bonus);
  WC.reduce(bonus, { type: "bonusPick", letters: ["C", "D", "M", "O"] });
  WC.reduce(bonus, { type: "setTotal", pid: "p1", total: 99999 });
  assert.equal(JSON.stringify(bonus), bonusBefore);
});

test("W-U9 state survives a JSON round-trip (localStorage restore)", () => {
  let s = regularState();
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(WC.boardView(restored), WC.boardView(s));
  assert.deepEqual(WC.legalActions(restored), WC.legalActions(s));
  const next = WC.reduce(restored, { type: "solveAttempt", text: "THE CORNER COFFEE SHOP" });
  assert.equal(next.solving, true);
});

/* ============================================================
   W-U10 — phone payloads and views
   ============================================================ */

test("W-U10 validatePhoneMsg accepts the documented shapes and rejects junk", () => {
  assert.deepEqual(WC.validatePhoneMsg({ t: "spin" }), { t: "spin" });
  assert.deepEqual(WC.validatePhoneMsg({ t: "buy-vowel" }), { t: "buy-vowel" });
  assert.deepEqual(WC.validatePhoneMsg({ t: "buzz" }), { t: "buzz" });
  assert.deepEqual(WC.validatePhoneMsg({ t: "letter", letter: " s " }), { t: "letter", letter: "S" });
  assert.deepEqual(
    WC.validatePhoneMsg({ t: "bonus-pick", letters: ["c", "d", "m", "o"] }),
    { t: "bonus-pick", letters: ["C", "D", "M", "O"] });
  for (const junk of [
    null, undefined, 42, "spin", [], {}, { t: "nope" }, { t: "letter" },
    { t: "letter", letter: "SS" }, { t: "letter", letter: "4" }, { t: "letter", letter: 7 },
    { t: "solve" }, { t: "solve", text: "   " }, { t: "solve", text: 9 },
    { t: "bonus-pick", letters: ["C", "D", "M"] }, { t: "bonus-pick", letters: "CDMO" },
    { t: "bonus-pick", letters: ["C", "D", "M", "!"] },
  ]) {
    assert.equal(WC.validatePhoneMsg(junk), null, `junk: ${JSON.stringify(junk)}`);
  }
});

test("W-U10 solve text is capped and control characters are stripped", () => {
  const dirty = `A${String.fromCharCode(7)}B\nC   D` + "x".repeat(200);
  const out = WC.validatePhoneMsg({ t: "solve", text: dirty });
  assert.equal(out.text.length, WC.SOLVE_TEXT_MAX);
  assert.ok(!CTRL_RE.test(out.text), "no control characters survive");
  assert.ok(out.text.startsWith("ABC D"), out.text.slice(0, 12));
  const s = WC.reduce(regularState(), { type: "solveAttempt", text: dirty });
  assert.equal(s.solveText.length, WC.SOLVE_TEXT_MAX);
  assert.ok(!CTRL_RE.test(s.solveText));
});

test("W-U10 phoneView never gives a non-active player the turn screen", () => {
  let s = regularState();
  assert.equal(WC.phoneView(s, "p1").screen, "turn");
  assert.equal(WC.phoneView(s, "p2").screen, "wait");
  assert.equal(WC.phoneView(s, "p3").screen, "wait");
  assert.equal(WC.phoneView(s, "nobody").screen, "wait");
  s = spinTo(s, 0);
  const turn = WC.phoneView(s, "p1");
  assert.equal(turn.wedge.value, 500);
  assert.ok(turn.actions.letters.includes("R"));
  assert.equal(WC.phoneView(s, "p2").actions.letters.length, 0, "others get no keyboard");
  assert.equal(WC.phoneView(s, "p2").wedge, null);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  s = WC.reduce(s, { type: "solveAttempt", text: "THE CORNER COFFEE SHOP" });
  assert.equal(WC.phoneView(s, "p1").screen, "solve");
  assert.equal(WC.phoneView(s, "p2").screen, "wait");
});

test("W-U10 phoneView masks unrevealed letters", () => {
  const s = regularState();
  const view = WC.phoneView(s, "p2");
  const shown = view.board.rows.flat().filter((c) => c && c.ch !== "").map((c) => c.ch).join("");
  assert.equal(shown, "", "nothing is revealed at the start of a round");
  assert.ok(!JSON.stringify(view).includes("COFFEE"), "the answer never leaves the host");
});

test("W-U10 phoneView tossup and bonus screens are player-specific", () => {
  let t = startedTossup();
  assert.equal(WC.phoneView(t, "p1").screen, "tossup");
  assert.equal(WC.phoneView(t, "p1").armed, true);
  t = WC.reduce(t, { type: "tossupBuzz", pid: "p2" });
  assert.equal(WC.phoneView(t, "p2").mine, true);
  assert.equal(WC.phoneView(t, "p1").armed, false);
  t = WC.reduce(t, { type: "tossupJudged", correct: false });
  assert.equal(WC.phoneView(t, "p2").locked, true);
  assert.equal(WC.phoneView(t, "p2").armed, false);
  assert.equal(WC.phoneView(t, "p1").armed, true);

  const b = bonusState();
  assert.equal(WC.phoneView(b, "p2").screen, "bonus");
  assert.equal(WC.phoneView(b, "p1").screen, "wait");
  assert.ok(!WC.phoneView(b, "p2").consonants.includes("R"), "freebies are not offered again");
  assert.deepEqual(WC.phoneView(b, "p2").vowels, ["A", "I", "O", "U"]);

  const done = WC.reduce(b, { type: "finish" });
  assert.equal(WC.phoneView(done, "p1").screen, "result");
  assert.deepEqual(WC.phoneView(done, "p1").standings.map((p) => p.pid), ["p2", "p1", "p3"]);
});

/* ============================================================
   Selector sanity (used by the host UI and the harness)
   ============================================================ */

test("boardView and podiumView report what the host renders", () => {
  let s = regularState();
  const board = WC.boardView(s);
  assert.equal(board.category, "Place");
  assert.equal(board.rows.length, 4);
  assert.equal(board.solved, false);
  const podium = WC.podiumView(s);
  assert.deepEqual(podium.map((p) => p.active), [true, false, false]);
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  assert.deepEqual(WC.podiumView(s).map((p) => p.round), [1000, 0, 0]);
  s = WC.reduce(s, { type: "revealAll" });
  assert.equal(WC.boardView(s).solved, true);
});

test("W-U1 a normalized game re-validates (reload-resume round-trip)", () => {
  const g = WC.normalizeGame(clone(DEFAULT_PUZZLES));
  assert.doesNotThrow(() => WC.validateGame(g), "normalizeGame must emit content validateGame accepts");
  assert.doesNotThrow(() => WC.validateGame(clone(g)));
  assert.ok(!("wedges" in g.rounds[0]), "absent overrides are omitted, not nulled");
  // A hand-written file may still use an explicit null for "no override".
  const withNulls = clone(DEFAULT_PUZZLES);
  withNulls.rounds[1].wedges = null;
  withNulls.rounds[1].value = null;
  assert.doesNotThrow(() => WC.validateGame(withNulls));
  // A saved state's game slice is what init() re-validates on reload.
  const state = WC.createState(clone(DEFAULT_PUZZLES), PLAYERS);
  const saved = JSON.parse(JSON.stringify(state));
  assert.doesNotThrow(() => WC.validateGame(saved.game));
});
