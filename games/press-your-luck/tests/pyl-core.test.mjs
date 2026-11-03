/* ============================================================
   Press Your Luck — unit suite (success states L-U1 … L-U10)
   Spec 17 §6. Pure core only: no DOM, no network, no timers.
   Run with `cd games/press-your-luck && node --test`.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const Core = require("../js/pyl-core.js");
const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = join(HERE, "..");

/* ============ Fixtures ============ */

const cash = (n, extra) => Object.assign({ cash: n }, extra || {});
const WHAMMY = { whammy: true };

/** 18 squares: 0 cash, 1 cash + a spin, 2 Whammy, 3 a prize, 16/17 Whammies. */
function boardA() {
  const board = [cash(100), cash(200, { spin: true }), WHAMMY, { prize: "Trip", value: 1000 }];
  for (let i = 4; i < 16; i += 1) board.push(cash(300 + i * 10));
  board.push(WHAMMY, WHAMMY);
  return board;
}

/** The round-two board: bigger money, a different shape. */
function boardB() {
  const board = [cash(5000), cash(4000), cash(3000), WHAMMY];
  for (let i = 4; i < 16; i += 1) board.push(cash(1000 + i * 100));
  board.push(WHAMMY, WHAMMY);
  return board;
}

function questions(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ q: `Question ${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`], answer: i % 3 });
  }
  return out;
}

function makeGame(patch) {
  return Object.assign({
    title: "Test board",
    settings: { currency: "$", questionsPerRound: 2, buzzSpins: 3, pickSpins: 1, whammyLimit: 4, rounds: 2 },
    boards: [boardA(), boardB()],
    questions: questions(24),
  }, patch || {});
}

const PLAYERS = [
  { name: "Ada", pid: "p1" },
  { name: "Ben", pid: "p2" },
  { name: "Cleo", pid: "p3" },
];

/** A state that has already started, with a known question order. */
function started(patch, players) {
  const state = Core.createState(makeGame(patch), players || PLAYERS, { order: [[0, 1], [2, 3]] });
  return Core.reduce(state, { type: "start" });
}

/** A state as plain data, without its undo stack, for deep comparison. */
function bare(state) {
  const copy = Object.assign({}, state);
  delete copy.history;
  return JSON.parse(JSON.stringify(copy));
}

/** rng that lands the light on square `index`. */
const land = (index) => () => (index + 0.5) / Core.SQUARES;

/** rng returning each value in turn, then repeating the last one. */
function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Play one whole question: seat `buzzer` buzzes and is judged, then picks. */
function playQuestion(state, buzzer, correct, picks) {
  let s = Core.reduce(state, { type: "arm", on: true });
  if (buzzer !== null) s = Core.reduce(s, { type: "buzz", seat: buzzer });
  s = Core.reduce(s, { type: "judgeBuzz", correct: !!correct });
  const answer = Core.currentQuestion(s).answer;
  Object.keys(picks || {}).forEach((seat) => {
    const idx = picks[seat] === true ? answer : (picks[seat] === false ? (answer + 1) % 3 : picks[seat]);
    s = Core.reduce(s, { type: "pick", seat: Number(seat), idx });
  });
  return Core.reduce(s, { type: "revealPicks" });
}

/** Run both questions of a round and open the board. */
function toBoardWith(state, spinsPlan) {
  let s = state;
  s = playQuestion(s, spinsPlan.buzzer, true, spinsPlan.picks || {});
  s = Core.reduce(s, { type: "nextQuestion" });
  s = playQuestion(s, null, false, spinsPlan.picks2 || {});
  return Core.reduce(s, { type: "toBoard" }, land(0));
}

/* ============================================================
   L-U1 — the validator: 18 squares, whammy counts, questions
   ============================================================ */

test("L-U1 the validator accepts the shipped file and every set in the library", () => {
  const shipped = JSON.parse(readFileSync(join(GAME_DIR, "board.json"), "utf8"));
  assert.equal(Core.validateGame(shipped), true);
  assert.equal(shipped.questions.length, 40);
  assert.equal(shipped.boards.length, 2);
  shipped.boards.forEach((board) => assert.equal(board.length, 18));

  const manifest = JSON.parse(readFileSync(join(GAME_DIR, "sets", "index.json"), "utf8"));
  assert.ok(manifest.length >= 2, "at least two library sets ship");
  manifest.forEach((entry) => {
    assert.match(entry.file, /^[A-Za-z0-9._-]+\.json$/, "a bare file name, no slashes");
    const set = JSON.parse(readFileSync(join(GAME_DIR, "sets", entry.file), "utf8"));
    assert.equal(Core.validateGame(set), true, `${entry.file} validates`);
    assert.ok(set.questions.length >= Core.MIN_QUESTIONS);
  });
});

test("L-U1 a board must have exactly 18 squares", () => {
  const short = makeGame({ boards: [boardA().slice(0, 17), boardB()] });
  assert.throws(() => Core.validateGame(short), /17 squares/);
  const long = makeGame({ boards: [boardA().concat([cash(1)]), boardB()] });
  assert.throws(() => Core.validateGame(long), /19 squares/);
});

test("L-U1 a board needs between three and six Whammies", () => {
  const few = boardA().map((sq) => (sq.whammy ? cash(500) : sq));
  assert.throws(() => Core.validateGame(makeGame({ boards: [few, boardB()] })), /0 Whammies/);
  const many = boardA().slice();
  for (let i = 4; i < 11; i += 1) many[i] = WHAMMY;
  assert.throws(() => Core.validateGame(makeGame({ boards: [many, boardB()] })), /Whammies/);
});

test("L-U1 squares, questions and settings are all checked, with plain English", () => {
  const bad = boardA().slice();
  bad[0] = { cash: 100, whammy: true };
  assert.throws(() => Core.validateGame(makeGame({ boards: [bad, boardB()] })), /cannot also carry cash/);

  const noValue = boardA().slice();
  noValue[0] = { prize: "Car" };
  assert.throws(() => Core.validateGame(makeGame({ boards: [noValue, boardB()] })), /needs a whole "value"/);

  assert.throws(() => Core.validateGame(makeGame({ questions: questions(23) })), /at least 24 questions/);
  const twoOptions = questions(24);
  twoOptions[3] = { q: "Only two?", options: ["a", "b"], answer: 0 };
  assert.throws(() => Core.validateGame(makeGame({ questions: twoOptions })), /exactly 3 options/);
  const repeats = questions(24);
  repeats[5] = { q: "Same?", options: ["a", "A", "b"], answer: 0 };
  assert.throws(() => Core.validateGame(makeGame({ questions: repeats })), /repeats an option/);
  const badAnswer = questions(24);
  badAnswer[6] = { q: "Out of range?", options: ["a", "b", "c"], answer: 3 };
  assert.throws(() => Core.validateGame(makeGame({ questions: badAnswer })), /"answer" between 0 and 2/);

  assert.throws(
    () => Core.validateGame(makeGame({ settings: { rounds: 3 }, boards: [boardA(), boardB()] })),
    /only has 2 board/,
  );
  assert.throws(() => Core.validateGame("not a game"), /not a Press Your Luck game object/);
  assert.throws(() => Core.validateGame(makeGame({ settings: { buzzSpins: 0, pickSpins: 0 } })), /nobody could ever reach the board/);
});

test("L-U1 normalizeGame never mutates the caller's object", () => {
  const raw = makeGame();
  const before = JSON.stringify(raw);
  const clean = Core.normalizeGame(raw);
  assert.equal(JSON.stringify(raw), before);
  clean.boards[0][0].cash = 999999;
  assert.equal(raw.boards[0][0].cash, 100);
});

/* ============================================================
   L-U2 — spin awards: 3 for a correct buzz-in, 1 per correct pick
   ============================================================ */

test("L-U2 a correct buzz-in banks buzzSpins and every correct pick banks pickSpins", () => {
  let s = started();
  s = Core.reduce(s, { type: "arm", on: true });
  s = Core.reduce(s, { type: "buzz", pid: "p1" });
  assert.equal(s.q.buzzed, 0);
  s = Core.reduce(s, { type: "judgeBuzz", correct: true });
  assert.deepEqual(s.spins, [3, 0, 0]);

  const answer = Core.currentQuestion(s).answer;
  s = Core.reduce(s, { type: "pick", pid: "p2", idx: answer });
  s = Core.reduce(s, { type: "pick", pid: "p3", idx: (answer + 1) % 3 });
  assert.deepEqual(s.spins, [3, 0, 0], "picks pay nothing until the reveal");
  s = Core.reduce(s, { type: "revealPicks" });
  assert.deepEqual(s.spins, [3, 1, 0]);
});

test("L-U2 the buzzer is locked out of the picks, and a wrong buzz-in pays nothing", () => {
  let s = started();
  s = Core.reduce(s, { type: "arm", on: true });
  s = Core.reduce(s, { type: "buzz", seat: 1 });
  s = Core.reduce(s, { type: "judgeBuzz", correct: false });
  assert.deepEqual(s.spins, [0, 0, 0]);
  assert.deepEqual(Core.eligiblePickers(s), [0, 2]);

  const answer = Core.currentQuestion(s).answer;
  const blocked = Core.reduce(s, { type: "pick", seat: 1, idx: answer });
  assert.equal(blocked, s, "the player who buzzed cannot also pick");
  s = Core.reduce(s, { type: "pick", seat: 0, idx: answer });
  s = Core.reduce(s, { type: "pick", seat: 2, idx: answer });
  s = Core.reduce(s, { type: "revealPicks" });
  assert.deepEqual(s.spins, [1, 0, 1]);
});

test("L-U2 buzzers arm and only the first buzz counts", () => {
  let s = started();
  const early = Core.reduce(s, { type: "buzz", seat: 2 });
  assert.equal(early, s, "a buzz before the host arms does nothing");
  s = Core.reduce(s, { type: "arm", on: true });
  s = Core.reduce(s, { type: "buzz", seat: 2 });
  const late = Core.reduce(s, { type: "buzz", seat: 0 });
  assert.equal(late, s, "the second buzz is ignored");
  assert.equal(s.q.buzzed, 2);
  assert.equal(s.q.armed, false);
});

test("L-U2 with nobody on the buzzer, everyone gets the options", () => {
  let s = started();
  s = Core.reduce(s, { type: "arm", on: true });
  const wrongly = Core.reduce(s, { type: "judgeBuzz", correct: true });
  assert.equal(wrongly, s, "nobody buzzed, so there is nothing to mark correct");
  s = Core.reduce(s, { type: "judgeBuzz", correct: false });
  assert.deepEqual(Core.eligiblePickers(s), [0, 1, 2]);
  const answer = Core.currentQuestion(s).answer;
  [0, 1, 2].forEach((seat) => { s = Core.reduce(s, { type: "pick", seat, idx: answer }); });
  s = Core.reduce(s, { type: "revealPicks" });
  assert.deepEqual(s.spins, [1, 1, 1]);
});

/* ============================================================
   L-U3 — the spin order rule
   ============================================================ */

test("L-U3 fewest spins goes first; ties break on the lower total, then the seat", () => {
  const s = started();
  const withSpins = Object.assign({}, s, { spins: [3, 1, 2], totals: [0, 0, 0] });
  assert.deepEqual(Core.spinOrder(withSpins), [1, 2, 0]);

  const tied = Object.assign({}, s, { spins: [2, 2, 2], totals: [500, 100, 100] });
  assert.deepEqual(Core.spinOrder(tied), [1, 2, 0], "level on spins, poorest first, then seat order");

  const noneLeft = Object.assign({}, s, { spins: [0, 0, 0] });
  assert.deepEqual(Core.spinOrder(noneLeft), []);
});

test("L-U3 a player holding passed spins is always brought up first", () => {
  const s = started();
  const state = Object.assign({}, s, { spins: [1, 5, 0], passed: [0, 0, 2], totals: [0, 0, 0] });
  assert.deepEqual(Core.spinOrder(state), [2, 0, 1]);
});

test("L-U3 toBoard opens on the first spinner and skips the board when nobody earned a spin", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: false }, picks2: { 0: true } });
  // Ben buzzed correctly (3), Ada picked right twice (1 + 1), Cleo nothing.
  assert.deepEqual(s.spins, [2, 3, 0]);
  assert.equal(s.phase, "board");
  assert.equal(s.control, 0, "Ada has the fewest spins, so Ada goes first");

  let dry = started();
  dry = playQuestion(dry, null, false, {});
  dry = Core.reduce(dry, { type: "nextQuestion" });
  dry = playQuestion(dry, null, false, {});
  dry = Core.reduce(dry, { type: "toBoard" });
  assert.equal(dry.phase, "roundDone");
  assert.match(dry.notice, /stays dark/);
});

/* ============================================================
   L-U4 — STOP lands where the rng says, and pays what is there
   ============================================================ */

test("L-U4 the light lands on exactly the square the rng picks, for all 18 squares", () => {
  const base = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  for (let i = 0; i < Core.SQUARES; i += 1) {
    const after = Core.reduce(base, { type: "stop" }, land(i));
    assert.equal(after.landing.index, i, `rng asked for square ${i}`);
    assert.equal(after.landing.seat, base.control);
  }
});

test("L-U4 cash, a prize, and a + one spin square all pay what they say", () => {
  const base = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const seat = base.control;

  const money = Core.reduce(base, { type: "stop" }, land(0));           // $100
  assert.equal(money.totals[seat], 100);
  assert.equal(money.landing.gained, 100);
  assert.equal(money.spins[seat], base.spins[seat] - 1);

  const prize = Core.reduce(base, { type: "stop" }, land(3));           // Trip, $1000
  assert.equal(prize.totals[seat], 1000);
  assert.equal(prize.landing.square.prize, "Trip");

  const extra = Core.reduce(base, { type: "stop" }, land(1));           // $200 + one spin
  assert.equal(extra.totals[seat], 200);
  assert.equal(extra.landing.extraSpin, true);
  assert.equal(extra.spins[seat], base.spins[seat], "one spent, one handed back");
  assert.equal(extra.awaiting, null, "still their turn");
});

test("L-U4 a spin is only legal for the player in control, and only while they have one", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const seat = s.control;
  const other = s.players.findIndex((p, i) => i !== seat);
  assert.equal(Core.reduce(s, { type: "stop", pid: s.players[other].pid }, land(0)), s);
  assert.equal(Core.reduce(s, { type: "stop", seat: other }, land(0)), s);

  const left = Core.spinsLeft(s, seat);
  for (let i = 0; i < left; i += 1) s = Core.reduce(s, { type: "stop" }, land(0));
  assert.equal(Core.spinsLeft(s, seat), 0);
  assert.equal(s.awaiting, "advance");
  assert.equal(Core.reduce(s, { type: "stop" }, land(0)), s, "no spins left, no spin");
});

test("L-U4 the board rotates only when the file asks, and the landing uses the face on show", () => {
  const rotating = boardA().slice();
  rotating[5] = { cash: 500, alternatives: [{ cash: 900 }, { whammy: true }] };
  const game = makeGame({
    boards: [rotating, boardB()],
    settings: { currency: "$", questionsPerRound: 2, buzzSpins: 3, pickSpins: 1, whammyLimit: 4, rounds: 2, rotate: true },
  });
  let s = Core.reduce(Core.createState(game, PLAYERS, { order: [[0, 1], [2, 3]] }), { type: "start" });
  s = toBoardWith(s, { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  // faces[5] === 2 means alternative 2 (the Whammy) is showing.
  const shown = Object.assign({}, s, { faces: s.faces.map((f, i) => (i === 5 ? 2 : 0)) });
  const after = Core.reduce(shown, { type: "stop" }, land(5));
  assert.equal(after.landing.whammy, true, "what you see on the square is what you get");

  const still = Object.assign({}, s, { faces: s.faces.map(() => 0) });
  assert.equal(Core.reduce(still, { type: "stop" }, land(5)).landing.gained, 500);
});

/* ============================================================
   L-U5 — the Whammy zeroes the total and counts
   ============================================================ */

test("L-U5 a Whammy wipes the total, counts once, and ends the turn", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const seat = s.control;
  s = Object.assign({}, s, { spins: s.spins.map((n, i) => (i === seat ? 3 : n)) });
  s = Core.reduce(s, { type: "stop" }, land(3));         // +$1000
  assert.equal(s.totals[seat], 1000);
  assert.equal(s.awaiting, null);
  s = Core.reduce(s, { type: "stop" }, land(2));         // Whammy
  assert.equal(s.totals[seat], 0);
  assert.equal(s.whammies[seat], 1);
  assert.equal(s.out[seat], false);
  assert.equal(s.awaiting, "advance", "a Whammy ends the turn even with spins left");
  assert.ok(Core.spinsLeft(s, seat) > 0, "the spins that are left stay with them");
  assert.match(s.notice, /Whammy/);
});

test("L-U5 only nextSpinner moves the board on, and it hands over to somebody else", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: true }, picks2: {} });
  const first = s.control;
  s = Core.reduce(s, { type: "stop" }, land(2));            // Whammy
  assert.equal(Core.reduce(s, { type: "stop" }, land(0)), s, "no spinning while the board waits");
  assert.deepEqual(Core.legalActions(s).sort(), ["finish", "nextSpinner", "undo"].sort());
  s = Core.reduce(s, { type: "nextSpinner" });
  assert.notEqual(s.control, first, "the turn passes");
  assert.equal(s.awaiting, null);
  assert.equal(s.landing, null, "the new spinner starts with a clean board");
});

/* ============================================================
   L-U6 — four Whammies and you are out
   ============================================================ */

test("L-U6 the whammy limit eliminates a player and voids their spins", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const seat = s.control;
  s = Object.assign({}, s, {
    whammies: s.whammies.map((w, i) => (i === seat ? 3 : w)),
    spins: s.spins.map((n, i) => (i === seat ? 5 : n)),
    totals: s.totals.map((t, i) => (i === seat ? 4000 : t)),
  });
  s = Core.reduce(s, { type: "stop" }, land(2));
  assert.equal(s.whammies[seat], 4);
  assert.equal(s.out[seat], true);
  assert.equal(s.totals[seat], 0);
  assert.equal(Core.spinsLeft(s, seat), 0, "an eliminated player's spins are void");
  assert.equal(s.landing.eliminated, true);
  assert.ok(Core.alive(s).indexOf(seat) < 0);
  assert.ok(Core.spinOrder(s).indexOf(seat) < 0);
});

test("L-U6 an eliminated player cannot buzz, pick or spin again", () => {
  let s = started();
  s = Object.assign({}, s, { out: [false, false, true] });
  s = Core.reduce(s, { type: "arm", on: true });
  assert.equal(Core.reduce(s, { type: "buzz", seat: 2 }), s);
  s = Core.reduce(s, { type: "buzz", seat: 0 });
  s = Core.reduce(s, { type: "judgeBuzz", correct: true });
  assert.deepEqual(Core.eligiblePickers(s), [1]);
  assert.equal(Core.reduce(s, { type: "pick", seat: 2, idx: 0 }), s);
});

test("L-U6 when everybody is out the round ends and the game is over", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  s = Object.assign({}, s, { out: [true, true, true], spins: [0, 0, 0], awaiting: "advance" });
  s = Core.reduce(s, { type: "nextSpinner" });
  assert.equal(s.phase, "roundDone");
  s = Core.reduce(s, { type: "nextRound" });
  assert.equal(s.phase, "result", "no survivors, no round two");
});

/* ============================================================
   L-U7 — passing spins
   ============================================================ */

test("L-U7 a pass moves every earned spin, ends the turn, and forces the receiver up", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: true }, picks2: {} });
  const from = s.control;
  const to = Core.passTargets(s).find((t) => t !== from);
  const moved = s.spins[from];
  assert.ok(moved > 0);
  s = Core.reduce(s, { type: "pass", to });
  assert.equal(s.spins[from], 0);
  assert.equal(s.passed[to], moved);
  assert.equal(s.awaiting, "advance");
  s = Core.reduce(s, { type: "nextSpinner" });
  assert.equal(s.control, to, "the player who was passed to comes straight up");
});

test("L-U7 passed spins cannot be passed on, and are used before your own", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: true }, picks2: {} });
  const from = s.control;
  const to = Core.passTargets(s).find((t) => t !== from);
  s = Core.reduce(s, { type: "pass", to });
  s = Core.reduce(s, { type: "nextSpinner" });
  assert.equal(s.control, to);
  assert.deepEqual(Core.passTargets(s), [], "you cannot pass spins that were passed to you");
  assert.equal(Core.reduce(s, { type: "pass", to: from }), s);

  const ownBefore = s.spins[to];
  const passedBefore = s.passed[to];
  s = Core.reduce(s, { type: "stop" }, land(0));
  assert.equal(s.passed[to], passedBefore - 1, "the passed spin goes first");
  assert.equal(s.spins[to], ownBefore);
});

test("L-U7 a Whammy on a passed spin still counts against the player who spun it", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: true }, picks2: {} });
  const from = s.control;
  const to = Core.passTargets(s).find((t) => t !== from);
  s = Core.reduce(s, { type: "pass", to });
  s = Core.reduce(s, { type: "nextSpinner" });
  s = Object.assign({}, s, { totals: s.totals.map((t, i) => (i === to ? 2500 : t)) });
  s = Core.reduce(s, { type: "stop" }, land(2));
  assert.equal(s.whammies[to], 1);
  assert.equal(s.totals[to], 0);
});

test("L-U7 you cannot pass with no spins, to yourself, to a player who is out, or off the board", () => {
  let s = toBoardWith(started(), { buzzer: 1, picks: { 0: true, 2: true }, picks2: {} });
  const seat = s.control;
  assert.equal(Core.reduce(s, { type: "pass", to: seat }), s);
  assert.equal(Core.reduce(s, { type: "pass", to: 9 }), s);
  assert.equal(Core.reduce(s, { type: "pass", to: -1 }), s);
  assert.equal(Core.reduce(s, { type: "pass", to: "p9" }), s);

  const dead = Object.assign({}, s, { out: s.out.map((o, i) => (i === (seat + 1) % 3 ? true : o)) });
  assert.equal(Core.reduce(dead, { type: "pass", to: (seat + 1) % 3 }), dead);

  const broke = Object.assign({}, s, { spins: s.spins.map(() => 0), passed: s.passed.map(() => 0) });
  assert.deepEqual(Core.passTargets(broke), []);
});

/* ============================================================
   L-U8 — round two plays the second board
   ============================================================ */

test("L-U8 round two uses boards[1] and keeps totals, whammies and eliminations", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  assert.equal(Core.boardOf(s)[0].cash, 100, "round one plays boards[0]");
  const seat = s.control;
  s = Core.reduce(s, { type: "stop" }, land(3));         // +$1000
  while (s.phase === "board") {
    s = s.awaiting === "advance"
      ? Core.reduce(s, { type: "nextSpinner" })
      : Core.reduce(s, { type: "stop" }, land(0));
  }
  assert.equal(s.phase, "roundDone");
  const carried = s.totals.slice();
  const whammies = s.whammies.slice();

  s = Core.reduce(s, { type: "nextRound" });
  assert.equal(s.phase, "question");
  assert.equal(s.round, 1);
  assert.equal(s.qIndex, 0);
  assert.deepEqual(s.totals, carried, "the money carries into round two");
  assert.deepEqual(s.whammies, whammies);
  assert.equal(Core.boardOf(s)[0].cash, 5000, "round two plays boards[1]");
  assert.ok(s.totals[seat] >= 1000);
});

test("L-U8 the question order never repeats a question across the rounds", () => {
  const s = Core.createState(makeGame(), PLAYERS, undefined, seq([0.1, 0.9, 0.3, 0.7, 0.5]));
  const flat = s.order.reduce((all, round) => all.concat(round), []);
  assert.equal(flat.length, s.game.settings.rounds * s.game.settings.questionsPerRound);
  assert.equal(new Set(flat).size, flat.length);
  flat.forEach((i) => assert.ok(i >= 0 && i < s.game.questions.length));
});

test("L-U8 nextQuestion walks the round and only toBoard ends it", () => {
  let s = playQuestion(started(), 0, true, {});
  assert.ok(Core.legalActions(s).indexOf("nextQuestion") >= 0);
  assert.ok(Core.legalActions(s).indexOf("toBoard") < 0, "not the last question yet");
  s = Core.reduce(s, { type: "nextQuestion" });
  assert.equal(s.qIndex, 1);
  assert.equal(s.q.buzzed, null);
  s = playQuestion(s, 1, true, {});
  assert.ok(Core.legalActions(s).indexOf("nextQuestion") < 0);
  assert.ok(Core.legalActions(s).indexOf("toBoard") >= 0);
});

/* ============================================================
   L-U9 — the winner
   ============================================================ */

test("L-U9 the highest total after the last round wins, and the standings say so", () => {
  let s = started();
  s = Object.assign({}, s, { phase: "roundDone", round: 1, totals: [1200, 4500, 800] });
  s = Core.reduce(s, { type: "nextRound" });
  assert.equal(s.phase, "result");
  const rows = Core.standings(s);
  assert.deepEqual(rows.map((r) => r.name), ["Ben", "Ada", "Cleo"]);
  assert.equal(rows[0].winner, true);
  assert.equal(rows[1].winner, false);
  assert.equal(rows[0].money, "$4,500");
  assert.equal(Core.leader(s).name, "Ben");
});

test("L-U9 a level game shares the win, and an all-Whammy game has no winner", () => {
  let s = started();
  const tied = Object.assign({}, s, { phase: "result", totals: [900, 900, 100] });
  assert.deepEqual(Core.standings(tied).filter((r) => r.winner).map((r) => r.name), ["Ada", "Ben"]);

  const wiped = Object.assign({}, s, { phase: "result", totals: [0, 0, 0], whammies: [4, 4, 4], out: [true, true, true] });
  assert.deepEqual(Core.standings(wiped).filter((r) => r.winner), []);
  assert.equal(Core.leader(wiped), null);
});

test("L-U9 finish ends the game from anywhere", () => {
  const s = toBoardWith(started(), { buzzer: 0, picks: { 1: true }, picks2: {} });
  const done = Core.reduce(s, { type: "finish" });
  assert.equal(done.phase, "result");
  assert.equal(done.control, null);
  assert.equal(Core.reduce(done, { type: "finish" }), done);
});

/* ============================================================
   L-U10 — undo, illegal events, immutability, and the leak
   ============================================================ */

test("L-U10 undo puts back exactly the state before the spin", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const before = JSON.parse(JSON.stringify(Object.assign({}, s, { history: null })));
  s = Core.reduce(s, { type: "stop" }, land(2));            // a Whammy
  assert.equal(s.whammies[before.control], 1);
  s = Core.reduce(s, { type: "undo" });
  const after = JSON.parse(JSON.stringify(Object.assign({}, s, { history: null })));
  assert.deepEqual(after, before);
});

test("L-U10 undo walks back through a whole question and stops at the bottom", () => {
  let s = started();
  const opening = bare(s);
  const base = s.history.length;
  s = playQuestion(s, 0, true, { 1: true });
  assert.ok(s.history.length >= base + 3, "a question is several undo steps");
  while (s.history.length > base) s = Core.reduce(s, { type: "undo" });
  // Arming the buzzers and the notice line are deliberately not undo steps,
  // so those two are the only fields allowed to differ.
  const back = bare(s);
  back.notice = opening.notice;
  back.q.armed = opening.q.armed;
  assert.deepEqual(back, opening, "back to the top of the question, exactly");

  for (let i = 0; i < 20; i += 1) s = Core.reduce(s, { type: "undo" });
  assert.equal(s.history.length, 0);
  assert.equal(s.phase, "setup", "undo all the way is back to setup");
  assert.equal(Core.reduce(s, { type: "undo" }), s, "undo at the bottom is a no-op");
});

test("L-U10 unknown, prototype-shaped and malformed events are all no-ops", () => {
  const s = started();
  ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf", "nope"].forEach((type) => {
    assert.equal(Core.reduce(s, { type }), s, `${type} must not reach a handler`);
  });
  [null, undefined, 42, "start", [], { noType: 1 }, { type: 7 }].forEach((event) => {
    assert.equal(Core.reduce(s, event), s);
  });
  assert.equal(Core.reduce(null, { type: "start" }), null);
  assert.equal(typeof {}.polluted, "undefined");
  assert.equal(typeof Object.prototype.phase, "undefined");
});

test("L-U10 every event returns a new object and never mutates the one it was given", () => {
  let s = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  const frozen = JSON.stringify(s);
  const after = Core.reduce(s, { type: "stop" }, land(3));
  assert.notEqual(after, s);
  assert.equal(JSON.stringify(s), frozen, "the input state is untouched");
  after.spins[0] = 99;
  assert.notEqual(s.spins[0], 99, "the arrays are copies, not shared");
});

test("L-U10 phones never see the landing square, the board, or a question's answer", () => {
  const question = started();
  const armed = Core.reduce(question, { type: "arm", on: true });
  const answer = Core.currentQuestion(armed).answer;

  // Buzz screen: the question, but not the options and not the answer.
  const buzzView = Core.phoneView(armed, "p1");
  assert.equal(buzzView.screen, "buzz");
  assert.equal(buzzView.options, undefined);
  assert.equal(JSON.stringify(buzzView).indexOf("answer"), -1);

  // Pick screen: the three options, never which one is right.
  let picking = Core.reduce(armed, { type: "buzz", seat: 0 });
  picking = Core.reduce(picking, { type: "judgeBuzz", correct: true });
  const pickView = Core.phoneView(picking, "p2");
  assert.equal(pickView.screen, "pick");
  assert.equal(pickView.options.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(pickView, "answer"), false);
  assert.equal(JSON.stringify(pickView).indexOf(`"answer"`), -1);
  assert.equal(pickView.myPick, null);

  // Board screen: no squares, no faces, and no landing until STOP is pressed.
  const board = toBoardWith(started(), { buzzer: 0, picks: { 1: true, 2: true }, picks2: {} });
  assert.equal(board.landing, null, "the state itself holds no future square");
  ["p1", "p2", "p3"].forEach((pid) => {
    const view = Core.phoneView(board, pid);
    const text = JSON.stringify(view);
    assert.equal(view.screen, "board");
    assert.equal(view.last, "");
    ["board", "squares", "faces", "answer", "tiles"].forEach((key) => {
      assert.equal(Object.prototype.hasOwnProperty.call(view, key), false, `${key} must not be in a phone view`);
    });
    Core.boardTiles(board).forEach((tile) => {
      if (!tile.whammy) assert.equal(text.indexOf(tile.top), -1, `${tile.top} leaked to ${pid}`);
    });
  });

  // The same state, two different rngs, two different squares: nothing was decided in advance.
  assert.notEqual(
    Core.reduce(board, { type: "stop" }, land(4)).landing.index,
    Core.reduce(board, { type: "stop" }, land(11)).landing.index,
  );
});

test("L-U10 validatePhoneMsg accepts the four shapes and drops everything else", () => {
  assert.deepEqual(Core.validatePhoneMsg({ t: "buzz" }), { t: "buzz" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "stop" }), { t: "stop" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "pick", idx: 2 }), { t: "pick", idx: 2 });
  assert.deepEqual(Core.validatePhoneMsg({ t: "pass", to: 1 }), { t: "pass", to: 1 });
  [
    null, undefined, 5, "buzz", [], { t: 1 }, { t: "nope" },
    { t: "pick" }, { t: "pick", idx: "1" }, { t: "pick", idx: 3 }, { t: "pick", idx: -1 },
    { t: "pass" }, { t: "pass", to: "p1" }, { t: "pass", to: 4 }, { t: "pass", to: 1.5 },
  ].forEach((raw) => assert.equal(Core.validatePhoneMsg(raw), null, JSON.stringify(raw)));
  // Extra keys are dropped, not copied through.
  assert.deepEqual(Core.validatePhoneMsg({ t: "buzz", cheat: true }), { t: "buzz" });
});

test("L-U10 a phone with no seat only ever watches", () => {
  const board = toBoardWith(started(), { buzzer: 0, picks: { 1: true }, picks2: {} });
  const view = Core.phoneView(board, "p9");
  assert.equal(view.seat, null);
  assert.equal(view.mine, false);
  assert.equal(view.canStop, false);
  assert.equal(view.canPass, false);
});

test("L-U10 createState refuses rosters it cannot seat", () => {
  assert.throws(() => Core.createState(makeGame(), [{ name: "Solo" }]), /2 to 4 players/);
  assert.throws(() => Core.createState(makeGame(), new Array(5).fill({ name: "x" })), /2 to 4 players/);
  assert.throws(() => Core.createState(makeGame(), [{ name: "Ada" }, { name: "ada" }]), /different name/);
  assert.throws(() => Core.createState(makeGame(), [{ name: "Ada", pid: "p1" }, { name: "Ben", pid: "p1" }]), /two seats/);
  assert.throws(() => Core.createState(makeGame(), [{ name: "  " }, { name: "Ben" }]), /needs a name/);
  const ok = Core.createState(makeGame(), [{ name: "Ada" }, { name: "Ben" }]);
  assert.equal(ok.players.length, 2);
  assert.deepEqual(ok.players.map((p) => p.pid), [null, null]);
});
