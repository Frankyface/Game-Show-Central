/* ============================================================
   Weakest Link — pure-core unit tests (success states K-U1…K-U10,
   spec 05 §8). Zero dependencies: `node --test` from
   games/weakest-link. The core is loaded through createRequire
   because it ships as a UMD script for the browser.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const WL = require("../js/wl-core.js");
const SHIPPED = JSON.parse(readFileSync(join(HERE, "..", "questions.json"), "utf8"));
const FALLBACK = require("../js/data.js");

/* ============ Fixtures ============ */

/** A minimal valid game: `n` questions, deterministic text. */
function makeGame(n, settings) {
  const questions = [];
  for (let i = 0; i < n; i += 1) {
    questions.push({ q: `Question ${i}?`, a: `Answer ${i}`, category: `Cat ${i % 4}` });
  }
  return { title: "Test", settings: settings || {}, questions };
}

function makePlayers(n) {
  const names = ["Ada", "Ben", "Cleo", "Dev", "Eve", "Fay", "Gus", "Hana"];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ pid: `p${i + 1}`, name: names[i] });
  return out;
}

/** Fold a list of events over a state. */
function play(state, events, now) {
  return events.reduce((s, e) => WL.reduce(s, typeof e === "string" ? { type: e } : e, now), state);
}

function started(playerCount, settings, questionCount) {
  const game = makeGame(questionCount || 60, settings);
  const s = WL.createState(game, makePlayers(playerCount), {});
  return WL.reduce(s, { type: "start" });
}

/** Everyone votes for `target` (self-votes are skipped by the reducer). */
function allVoteFor(state, target) {
  return state.active.reduce(
    (s, voter) => WL.reduce(s, { type: "vote", voter, target: voter === target ? otherThan(s, voter, target) : target }),
    state
  );
}

function otherThan(state, voter, avoid) {
  return state.active.find((pid) => pid !== voter && pid !== avoid) || state.active.find((pid) => pid !== voter);
}

function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k], marks));
  return Object.freeze(value);
}

/* ============================================================
   K-U1 — validateGame
   ============================================================ */

test("K-U1 validateGame accepts the shipped questions.json (160 questions)", () => {
  assert.equal(WL.validateGame(SHIPPED), true);
  assert.ok(SHIPPED.questions.length >= 160, `expected >= 160, got ${SHIPPED.questions.length}`);
  const cats = new Set(SHIPPED.questions.map((r) => r.category));
  assert.ok(cats.size >= 8, `expected >= 8 categories, got ${cats.size}`);
});

test("K-U1 js/data.js mirrors questions.json exactly", () => {
  assert.deepEqual(FALLBACK, SHIPPED);
});

test("K-U1 rejects 39 questions", () => {
  assert.throws(() => WL.validateGame(makeGame(39)), /at least 40 questions/);
});

test("K-U1 rejects a non-increasing chain", () => {
  assert.throws(
    () => WL.validateGame(makeGame(40, { chain: [1000, 1000, 5000] })),
    /must increase at every step/
  );
  assert.throws(
    () => WL.validateGame(makeGame(40, { chain: [1000, 500] })),
    /list of 3 to 12 money values/
  );
});

test("K-U1 rejects finalPlayers 3", () => {
  assert.throws(() => WL.validateGame(makeGame(40, { finalPlayers: 3 })), /must be 2/);
});

test("K-U1 rejects an empty answer", () => {
  const g = makeGame(40);
  g.questions[7].a = "   ";
  assert.throws(() => WL.validateGame(g), /Question 8 has no answer/);
});

test("K-U1 rejects roundSeconds containing 0", () => {
  assert.throws(() => WL.validateGame(makeGame(40, { roundSeconds: [150, 0] })), /from 1 to 600/);
});

test("K-U1 other malformed content is rejected with a plain-English message", () => {
  const cases = [
    [null, /not a Weakest Link game/],
    [{ questions: "nope" }, /must be a list/],
    [makeGame(40, { finalQuestionsEach: 0 }), /from 1 to 10/],
    [makeGame(40, { finalMultiplier: 9 }), /from 1 to 5/],
    [makeGame(40, { currency: "dollars" }), /at most 3 characters/],
    [makeGame(40, { roundSeconds: [900] }), /from 1 to 600/],
  ];
  for (const [game, re] of cases) assert.throws(() => WL.validateGame(game), re);
});

test("K-U1 normalizeGame fills defaults and never mutates its input", () => {
  const raw = deepFreeze(makeGame(40));
  const g = WL.normalizeGame(raw);
  assert.deepEqual(g.settings.chain, WL.DEFAULT_CHAIN);
  assert.deepEqual(g.settings.roundSeconds, WL.DEFAULT_ROUND_SECONDS);
  assert.equal(g.settings.finalMultiplier, 3);
  assert.equal(g.settings.topOfChainEndsRound, true);
  assert.equal(raw.settings.chain, undefined);
});

test("K-U1 warningsFor flags a thin question pool", () => {
  assert.match(WL.warningsFor(makeGame(60))[0], /Only 60 questions/);
  assert.deepEqual(WL.warningsFor(SHIPPED), []);
});

/* ============================================================
   K-U2 — the money chain
   ============================================================ */

test("K-U2 correct climbs the chain, wrong resets it to zero", () => {
  let s = started(4);
  assert.equal(WL.chainValue(s), 0);
  s = WL.reduce(s, { type: "correct" });
  assert.equal(WL.chainValue(s), 1000);
  s = WL.reduce(s, { type: "correct" });
  assert.equal(WL.chainValue(s), 2500);
  s = WL.reduce(s, { type: "wrong" });
  assert.equal(WL.chainValue(s), 0);
  assert.equal(s.roundBank, 0);
});

test("K-U2 bank moves the chain into the round bank and resets the chain", () => {
  let s = started(4);
  s = play(s, ["correct", "correct", "correct"]);
  assert.equal(WL.chainValue(s), 5000);
  const banker = s.turnPid;
  s = WL.reduce(s, { type: "bank" });
  assert.equal(s.roundBank, 5000);
  assert.equal(WL.chainValue(s), 0);
  assert.equal(s.stats[banker].banked, 5000);
  // Banking does not consume a question or change whose turn it is.
  assert.equal(s.turnPid, banker);
});

test("K-U2 banking nothing is ignored", () => {
  const s = started(4);
  assert.equal(WL.reduce(s, { type: "bank" }), s);
});

test("K-U2 top of the chain auto-banks and ends the round when enabled", () => {
  let s = started(4, { topOfChainEndsRound: true });
  s = play(s, new Array(8).fill("correct"));
  assert.equal(s.roundBank, 125000);
  assert.equal(WL.chainValue(s), 0);
  assert.equal(s.phase, "voting", "the round should end at the top of the chain");
  assert.equal(s.total, 125000);
});

test("K-U2 top of the chain auto-banks but keeps playing when disabled", () => {
  let s = started(4, { topOfChainEndsRound: false });
  s = play(s, new Array(8).fill("correct"));
  assert.equal(s.roundBank, 125000);
  assert.equal(s.phase, "round");
  // A round can never bank more than the top of the chain.
  s = play(s, new Array(8).fill("correct"));
  assert.equal(s.roundBank, 125000);
});

/* ============================================================
   K-U3 — the clock (injected `now`, deadline timestamps only)
   ============================================================ */

test("K-U3 clockStart/clockPause track remaining time against injected now", () => {
  let s = started(4);
  assert.deepEqual(s.clock, { running: false, deadline: null, remainingMs: 150000 });
  s = WL.reduce(s, { type: "clockStart" }, 1000);
  assert.equal(s.clock.running, true);
  assert.equal(s.clock.deadline, 151000);
  s = WL.reduce(s, { type: "clockPause" }, 41000);
  assert.deepEqual(s.clock, { running: false, deadline: null, remainingMs: 110000 });
  // Resuming re-bases the deadline on the new `now`.
  s = WL.reduce(s, { type: "clockStart" }, 500000);
  assert.equal(s.clock.deadline, 610000);
});

test("K-U3 expiry lets the in-flight question be judged, then ends the round", () => {
  let s = started(4);
  s = play(s, ["correct", "correct"]);          // 2500 riding on the chain
  s = WL.reduce(s, { type: "bank" });            // 2500 in the round bank
  s = play(s, ["correct"]);                      // 1000 back on the chain
  s = WL.reduce(s, { type: "clockStart" }, 0);
  s = WL.reduce(s, { type: "clockExpired" }, 150000);
  assert.equal(s.expired, true);
  assert.equal(s.phase, "round", "the in-flight question can still be judged");
  assert.match(s.notice, /Time is up/);
  // A second expiry is ignored (the glue may fire it once per frame).
  assert.equal(WL.reduce(s, { type: "clockExpired" }, 150001), s);
  s = WL.reduce(s, { type: "correct" });
  assert.equal(s.phase, "voting", "the round ends after the last judgement");
  assert.equal(s.total, 2500, "unbanked chain money is lost");
  assert.equal(s.roundBank, 2500);
  assert.equal(s.lastRoundBank, 2500);
});

test("K-U3 endRound is the manual escape hatch and moves the bank to the total", () => {
  let s = started(4);
  s = play(s, ["correct", "correct", "bank", "correct"]);
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(s.total, 2500);
  assert.equal(s.phase, "voting");
  assert.equal(s.roundHistory.length, 1);
});

/* ============================================================
   K-U4 — turn order
   ============================================================ */

test("K-U4 turn order rotates through the active players and wraps", () => {
  let s = started(4);
  assert.equal(s.turnPid, "p1");
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    seen.push(s.turnPid);
    s = WL.reduce(s, { type: "wrong" });
  }
  assert.deepEqual(seen, ["p1", "p2", "p3", "p4", "p1"]);
});

test("K-U4 eliminated players are skipped and the strongest link starts the next round", () => {
  let s = started(4);
  // p1 answers two right (strongest); p2, p3, p4 get one wrong each.
  s = play(s, ["correct", "wrong", "wrong", "wrong", "correct", "wrong", "wrong", "wrong"]);
  assert.equal(s.stats.p1.correct, 2);
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(s.phase, "voting");
  assert.equal(WL.strongestLink(s, 0, s.active), "p1");
  assert.equal(WL.weakestLink(s, 0, s.active), "p2", "p2 is first among the equally weak by seat order");
  s = allVoteFor(s, "p3");
  s = WL.reduce(s, { type: "revealAll" });
  assert.equal(s.eliminatedPid, "p3");
  s = play(s, ["eliminate", "nextRound"]);
  assert.deepEqual(s.active, ["p1", "p2", "p4"]);
  assert.equal(s.turnPid, "p1", "the previous round's strongest link starts");
  assert.equal(s.roundIndex, 1);
  assert.equal(s.clock.remainingMs, 140000);
  // Rotation now skips the eliminated p3.
  const order = [];
  let t = s;
  for (let i = 0; i < 4; i += 1) { order.push(t.turnPid); t = WL.reduce(t, { type: "wrong" }); }
  assert.deepEqual(order, ["p1", "p2", "p4", "p1"]);
});

/* ============================================================
   K-U5 — statistics tie-breaks
   ============================================================ */

test("K-U5 strongest link: most correct, then most banked, then fewest wrong", () => {
  const base = started(4);
  const s = {
    ...base,
    roundStats: {
      p1: { correct: 3, wrong: 1, banked: 0 },
      p2: { correct: 3, wrong: 0, banked: 5000 },   // same correct, more banked -> strongest
      p3: { correct: 3, wrong: 0, banked: 0 },      // ties p1 on banked, fewer wrong
      p4: { correct: 1, wrong: 4, banked: 0 },
    },
  };
  assert.equal(WL.strongestLink(s), "p2");
  assert.deepEqual(WL.rankBy(s, undefined, null, 1).slice(0, 3), ["p2", "p3", "p1"]);
});

test("K-U5 weakest link: fewest correct, then least banked, then most wrong", () => {
  const base = started(4);
  const s = {
    ...base,
    roundStats: {
      p1: { correct: 1, wrong: 2, banked: 1000 },
      p2: { correct: 1, wrong: 2, banked: 0 },     // same correct, banked less -> weakest
      p3: { correct: 1, wrong: 5, banked: 1000 },  // ties p1 on banked, more wrong
      p4: { correct: 4, wrong: 0, banked: 0 },
    },
  };
  assert.equal(WL.weakestLink(s), "p2");
  assert.deepEqual(WL.rankBy(s, undefined, null, -1).slice(0, 3), ["p2", "p3", "p1"]);
});

test("K-U5 stats for a finished round are read from the round history", () => {
  let s = started(3);
  s = play(s, ["correct", "wrong", "wrong"]);          // p1 right, p2 + p3 wrong
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(WL.strongestLink(s, 0, s.active), "p1");
  assert.equal(s.roundHistory[0].stats.p1.correct, 1);
});

/* ============================================================
   K-U6 — voting
   ============================================================ */

test("K-U6 one vote per voter, changeable until the reveal, self-votes rejected", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "endRound" });
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p1" });
  assert.deepEqual(s.votes, {}, "a self-vote is ignored");
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p9" });
  assert.deepEqual(s.votes, {}, "a vote for a stranger is ignored");
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p2" });
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p3" });
  assert.deepEqual(s.votes, { p1: "p3" }, "a voter may change their mind");
  assert.equal(WL.canVote(s, "p1", "p2"), true);
  assert.equal(WL.canVote(s, "p1", "p1"), false);
});

test("K-U6 reveal needs every vote in, then reveals one at a time", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" },
    { type: "vote", voter: "p2", target: "p4" },
    { type: "vote", voter: "p3", target: "p2" },
  ]);
  assert.equal(WL.reduce(s, { type: "revealVote" }), s, "3 of 4 votes in — reveal is refused");
  s = WL.reduce(s, { type: "vote", voter: "p4", target: "p2" });
  s = WL.reduce(s, { type: "revealVote" });
  assert.deepEqual(s.revealed, ["p1"]);
  assert.deepEqual(WL.revealedTally(s), { p4: 1 });
  assert.equal(s.phase, "voting");
  // Votes are locked once the reveal has started.
  assert.equal(WL.reduce(s, { type: "vote", voter: "p2", target: "p3" }).votes.p2, "p4");
  s = play(s, ["revealVote", "revealVote", "revealVote"]);
  assert.deepEqual(s.revealed, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(WL.voteTally(s), { p4: 2, p2: 2 });
});

test("K-U6 a clear majority is eliminated", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" },
    { type: "vote", voter: "p2", target: "p4" },
    { type: "vote", voter: "p3", target: "p4" },
    { type: "vote", voter: "p4", target: "p1" },
    "revealAll",
  ]);
  assert.equal(s.phase, "voteResult");
  assert.equal(s.eliminatedPid, "p4");
  s = WL.reduce(s, { type: "eliminate" });
  assert.equal(s.phase, "goodbye");
  assert.deepEqual(s.active, ["p1", "p2", "p3"]);
  assert.deepEqual(s.eliminated, ["p4"]);
  assert.match(s.notice, /You are the weakest link/);
});

test("K-U6 a two-way tie stops the elimination and asks the strongest link", () => {
  let s = started(4);
  s = play(s, ["correct", "wrong", "wrong", "wrong"]);  // p1 is the strongest link
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p3" },
    { type: "vote", voter: "p2", target: "p3" },
    { type: "vote", voter: "p3", target: "p2" },
    { type: "vote", voter: "p4", target: "p2" },
  ]);
  assert.deepEqual(WL.voteTally(s), { p3: 2, p2: 2 });
  s = WL.reduce(s, { type: "revealAll" });
  assert.equal(s.phase, "tiebreak");
  assert.deepEqual(s.tied, ["p2", "p3"], "the tied targets, in seat order");
  assert.equal(s.eliminatedPid, null, "nobody leaves until the tie is broken");
  assert.equal(s.tiebreakPid, "p1");
  assert.match(s.notice, /It is a tie/);
});

test("K-U6 tiebreak: breakTie only accepts a tied target and only from the tiebreak phase", () => {
  let s = started(4);
  s = play(s, ["correct", "wrong", "wrong", "wrong"]);  // p1 strongest
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p2" },
    { type: "vote", voter: "p2", target: "p3" },
    { type: "vote", voter: "p3", target: "p2" },
    { type: "vote", voter: "p4", target: "p3" },
    "revealAll",
  ]);
  assert.equal(s.phase, "tiebreak");
  assert.deepEqual(s.tied.slice().sort(), ["p2", "p3"]);
  assert.equal(s.tiebreakPid, "p1", "the strongest link decides");
  assert.equal(WL.reduce(s, { type: "breakTie", target: "p4" }), s, "an untied target is refused");
  s = WL.reduce(s, { type: "breakTie", target: "p3" });
  assert.equal(s.phase, "voteResult");
  assert.equal(s.eliminatedPid, "p3");
  assert.equal(s.tied, null);
});

/* ============================================================
   K-U7 — the head-to-head final
   ============================================================ */

/** Play a 3-player game down to the finalIntro. Spec §1: the last two players
    never play a round of their own — the vote that leaves two goes straight to
    the head-to-head, and it is the last FULL-TEAM round that is multiplied. */
function toFinal(settings) {
  let s = started(3, settings);
  s = play(s, ["correct", "correct", "bank"]);   // 2500 banked in round 1
  s = WL.reduce(s, { type: "endRound" });
  return play(s, [
    { type: "vote", voter: "p1", target: "p3" },
    { type: "vote", voter: "p2", target: "p3" },
    { type: "vote", voter: "p3", target: "p1" },
    "revealAll", "eliminate", "nextRound",
  ]);
}

test("K-U7 the last full round's bank is tripled before the head-to-head", () => {
  const s = toFinal();
  assert.equal(s.phase, "finalIntro");
  assert.equal(s.roundIndex, 0, "no extra two-player round was played");
  assert.equal(s.lastRoundBank, 2500);
  assert.equal(s.finalBonus, 5000);
  assert.equal(s.total, 2500 * 3, "round 1's 2500 counts three times");
  assert.deepEqual(s.final.pids, ["p1", "p2"]);
});

test("K-U7 finalMultiplier 1 leaves the bank alone", () => {
  const s = toFinal({ finalMultiplier: 1 });
  assert.equal(s.finalBonus, 0);
  assert.equal(s.total, 2500);
});

test("K-U7 first-player choice, alternating five each, winner by correct count", () => {
  let s = toFinal();
  assert.equal(WL.reduce(s, { type: "finalFirst", pid: "p9" }), s, "a stranger cannot go first");
  s = WL.reduce(s, { type: "finalFirst", pid: "p2" });
  assert.equal(s.phase, "final");
  assert.equal(s.turnPid, "p2");
  const turns = [];
  // p2 gets 3 right, p1 gets 2.
  const script = [true, true, true, false, true, true, false, false, false, false];
  for (const correct of script) {
    turns.push(s.turnPid);
    s = WL.reduce(s, { type: "finalAnswer", correct });
  }
  assert.deepEqual(turns, ["p2", "p1", "p2", "p1", "p2", "p1", "p2", "p1", "p2", "p1"]);
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p2");
  const tally = WL.finalTally(s);
  assert.equal(tally.find((r) => r.pid === "p2").correct, 3);
  assert.equal(tally.find((r) => r.pid === "p1").correct, 2);
});

test("K-U7 a tied final goes to sudden death, decided only when a pair splits", () => {
  let s = toFinal();
  s = WL.reduce(s, { type: "finalFirst", pid: "p1" });
  // Each player is asked on alternate turns, so the first six right = 3 each.
  for (let i = 0; i < 10; i += 1) s = WL.reduce(s, { type: "finalAnswer", correct: i < 6 });
  assert.equal(s.phase, "suddenDeath", "5 each — sudden death");
  assert.equal(s.turnPid, "p1", "the player who went first leads each pair");
  // Pair 1: both right -> still level.
  s = play(s, [{ type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: true }]);
  assert.equal(s.phase, "suddenDeath");
  assert.equal(s.turnPid, "p1");
  // Pair 2: both wrong -> still level.
  s = play(s, [{ type: "finalAnswer", correct: false }, { type: "finalAnswer", correct: false }]);
  assert.equal(s.phase, "suddenDeath");
  assert.equal(s.final.sudden.length, 2);
  // Pair 3: p1 wrong, p2 right -> p2 wins.
  s = play(s, [{ type: "finalAnswer", correct: false }, { type: "finalAnswer", correct: true }]);
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p2");
  assert.match(s.notice, /wins \$/);
});

test("K-U7 finalQuestionsEach is honoured", () => {
  let s = toFinal({ finalQuestionsEach: 2 });
  s = WL.reduce(s, { type: "finalFirst", pid: "p1" });
  s = play(s, [
    { type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: false },
    { type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: false },
  ]);
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p1");
});

/* ============================================================
   K-U8 — the question pool
   ============================================================ */

test("K-U8 shuffle is deterministic under an injected rng", () => {
  const seeded = () => {
    let x = 42;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  };
  const a = WL.buildOrder(50, true, seeded());
  const b = WL.buildOrder(50, true, seeded());
  assert.deepEqual(a, b, "the same seed gives the same order");
  assert.notDeepEqual(a, WL.buildOrder(50, false));
  assert.deepEqual(a.slice().sort((x, y) => x - y), WL.buildOrder(50, false), "it is a permutation");
});

test("K-U8 questions are drawn in file order by default", () => {
  let s = started(4, {}, 60);
  assert.equal(WL.currentQuestion(s).q, "Question 0?");
  s = WL.reduce(s, { type: "wrong" });
  assert.equal(WL.currentQuestion(s).q, "Question 1?");
  // Banking does not burn a question: only the judged answer moved the pointer.
  s = play(s, ["correct", "bank", "bank"]);
  assert.equal(WL.currentQuestion(s).q, "Question 2?");
});

test("K-U8 wrapping the pool sets repeating and says so", () => {
  let s = started(4, {}, 40);
  for (let i = 0; i < 39; i += 1) s = WL.reduce(s, { type: "wrong" });
  assert.equal(s.repeating, false);
  s = WL.reduce(s, { type: "wrong" });
  assert.equal(s.repeating, true);
  assert.equal(s.qIndex, 0);
  assert.match(s.notice, /Questions are repeating/);
});

/* ============================================================
   K-U9 — undo, illegal events, immutability
   ============================================================ */

test("K-U9 undo restores the previous state exactly", () => {
  const before = started(4);
  const after = WL.reduce(before, { type: "correct" });
  const back = WL.reduce(after, { type: "undo" });
  assert.deepEqual(back, before);
  const fresh = WL.createState(makeGame(60), makePlayers(4), {});
  assert.equal(WL.reduce(fresh, { type: "undo" }), fresh, "nothing to undo");
});

test("K-U9 undo unwinds several steps in order", () => {
  const s0 = started(4);
  const s1 = WL.reduce(s0, { type: "correct" });
  const s2 = WL.reduce(s1, { type: "correct" });
  const s3 = WL.reduce(s2, { type: "bank" });
  assert.deepEqual(WL.reduce(s3, { type: "undo" }), s2);
  assert.deepEqual(WL.reduce(WL.reduce(s3, { type: "undo" }), { type: "undo" }), s1);
});

test("K-U9 illegal and unknown events leave the state untouched", () => {
  const setup = WL.createState(makeGame(60), makePlayers(4), {});
  const round = started(4);
  const cases = [
    [setup, { type: "correct" }],
    [setup, { type: "bank" }],
    [setup, { type: "vote", voter: "p1", target: "p2" }],
    [setup, { type: "nextRound" }],
    [round, { type: "start" }],
    [round, { type: "revealVote" }],
    [round, { type: "breakTie", target: "p2" }],
    [round, { type: "eliminate" }],
    [round, { type: "finalFirst", pid: "p1" }],
    [round, { type: "finalAnswer", correct: true }],
    [round, { type: "finalAnswer" }],
    [round, { type: "clockPause" }],
    [round, { type: "not-a-real-event" }],
    [round, {}],
    [round, null],
  ];
  for (const [state, event] of cases) {
    assert.equal(WL.reduce(state, event, 0), state, `expected no change for ${JSON.stringify(event)}`);
  }
});

test("K-U9 the reducer never mutates a frozen state or event", () => {
  const s = deepFreeze(started(4));
  const events = [
    { type: "correct" }, { type: "wrong" }, { type: "bank" },
    { type: "clockStart" }, { type: "endRound" }, { type: "undo" },
  ];
  for (const ev of events) {
    assert.doesNotThrow(() => WL.reduce(s, deepFreeze(ev), 1000), `mutated on ${ev.type}`);
  }
  // And a whole game runs against frozen inputs.
  let live = deepFreeze(started(4));
  for (const ev of ["correct", "correct", "bank", "wrong", "endRound"]) {
    live = deepFreeze(WL.reduce(live, deepFreeze({ type: ev }), 1000));
  }
  assert.equal(live.phase, "voting");
});

/* ============================================================
   K-U10 — the phone boundary
   ============================================================ */

test("K-U10 validatePhoneMsg accepts only well-formed votes and tiebreaks", () => {
  assert.deepEqual(WL.validatePhoneMsg({ t: "vote", target: "p2" }), { t: "vote", target: "p2" });
  assert.deepEqual(WL.validatePhoneMsg({ t: "tiebreak", target: "p3" }), { t: "tiebreak", target: "p3" });
  const junk = [
    null, undefined, 7, "vote", [], {}, { t: "vote" }, { t: "vote", target: 3 },
    { t: "vote", target: "" }, { t: "vote", target: "x".repeat(200) },
    { t: "correct" }, { t: "eliminate", target: "p2" },
  ];
  for (const bad of junk) assert.equal(WL.validatePhoneMsg(bad), null, JSON.stringify(bad));
  // Control characters are stripped, not trusted.
  assert.deepEqual(WL.validatePhoneMsg({ t: "vote", target: "p2" }), { t: "vote", target: "p2" });
});

test("K-U10 votes are only accepted during voting, from players still in the game", () => {
  let s = started(4);
  assert.equal(WL.canVote(s, "p1", "p2"), false, "not during a round");
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(WL.canVote(s, "p1", "p2"), true);
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" },
    { type: "vote", voter: "p2", target: "p4" },
    { type: "vote", voter: "p3", target: "p4" },
    { type: "vote", voter: "p4", target: "p1" },
    "revealAll", "eliminate",
  ]);
  assert.equal(WL.canVote(s, "p4", "p1"), false, "an eliminated player cannot vote");
  s = WL.reduce(s, { type: "nextRound" });
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(WL.canVote(s, "p1", "p4"), false, "an eliminated player cannot be voted for");
});

test("K-U10 phoneView never leaks the answer text or another player's vote", () => {
  let s = started(4);
  const answer = WL.currentQuestion(s).a;
  const waiting = WL.phoneView(s, "p2");
  assert.equal(waiting.screen, "wait");
  assert.equal(waiting.turnName, "Ada");
  assert.equal(waiting.myTurn, false);
  assert.ok(!JSON.stringify(waiting).includes(answer), "the answer must stay on the host screen");
  assert.ok(!JSON.stringify(waiting).includes(WL.currentQuestion(s).q));

  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" },
    { type: "vote", voter: "p2", target: "p3" },
  ]);
  const view = WL.phoneView(s, "p2");
  assert.equal(view.screen, "vote");
  assert.equal(view.myVote, "p3", "a phone sees its own vote");
  assert.equal(view.castCount, 2);
  assert.equal(view.voterCount, 4);
  assert.deepEqual(view.choices.map((c) => c.pid), ["p1", "p3", "p4"], "never yourself");
  assert.equal(view.votes, undefined, "no vote map ever reaches a phone");
  const p3view = WL.phoneView(s, "p3");
  assert.equal(p3view.myVote, null, "p3 has not voted yet and cannot see p1's or p2's choice");
});

test("K-U10 phoneView routes the eliminated player to goodbye, then to the standings", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" },
    { type: "vote", voter: "p2", target: "p4" },
    { type: "vote", voter: "p3", target: "p4" },
    { type: "vote", voter: "p4", target: "p1" },
    "revealAll", "eliminate",
  ]);
  assert.equal(WL.phoneView(s, "p4").screen, "goodbye");
  assert.equal(WL.phoneView(s, "p1").screen, "wait");
  s = WL.reduce(s, { type: "nextRound" });
  const out = WL.phoneView(s, "p4");
  assert.equal(out.screen, "out");
  assert.equal(out.standings.length, 4);
});

test("K-U10 phoneView shows the tiebreak only to the strongest link, and the final tally to all", () => {
  let s = started(4);
  s = play(s, ["correct", "wrong", "wrong", "wrong"]);
  s = WL.reduce(s, { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p2" },
    { type: "vote", voter: "p2", target: "p3" },
    { type: "vote", voter: "p3", target: "p2" },
    { type: "vote", voter: "p4", target: "p3" },
    "revealAll",
  ]);
  assert.equal(s.phase, "tiebreak");
  assert.equal(WL.phoneView(s, "p1").screen, "tiebreak");
  assert.deepEqual(WL.phoneView(s, "p1").choices.map((c) => c.pid).sort(), ["p2", "p3"]);
  assert.equal(WL.phoneView(s, "p2").screen, "wait");

  let f = toFinal();
  f = WL.reduce(f, { type: "finalFirst", pid: "p1" });
  const fv = WL.phoneView(f, "p2");
  assert.equal(fv.screen, "final");
  assert.equal(fv.myTurn, false);
  assert.equal(fv.tally.length, 2);
  f = play(f, new Array(10).fill({ type: "finalAnswer", correct: true }));
  assert.equal(f.phase, "suddenDeath");
  f = play(f, [{ type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: false }]);
  assert.equal(f.phase, "result");
  const rv = WL.phoneView(f, "p1");
  assert.equal(rv.screen, "result");
  assert.equal(rv.winner, "Ada");
  assert.equal(rv.won, true);
  assert.equal(WL.phoneView(f, "p3").screen, "result", "even the eliminated see the result");
});
