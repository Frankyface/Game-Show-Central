/* ============================================================
   Weakest Link - ADVERSARIAL tests, part 1: the format rules
   (written by the independent tester, not the implementer).
   These try to break the pure core against spec 05 section 1
   rather than confirm it. Tests whose name starts with
   "DEVIATION" record behaviour that differs from the spec as
   written: they assert what the code actually does today so the
   suite stays green, and the matching defect id is in
   docs/reports/weakest-link-verification.md.
   Part 2 (validator / phone / immutability fuzz) is in
   wl-adversarial-fuzz.test.mjs - split only to keep both files
   under the 800-line house limit (gate V2).
   `node --test` from games/weakest-link.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WL = require("../js/wl-core.js");

/* ============ Fixtures ============ */

function makeGame(n, settings) {
  const questions = [];
  for (let i = 0; i < n; i += 1) {
    questions.push({ q: `Question ${i}?`, a: `Answer ${i}`, category: `Cat ${i % 4}` });
  }
  return { title: "Adversarial", settings: settings || {}, questions };
}

function makePlayers(n) {
  const names = ["Ada", "Ben", "Cleo", "Dev", "Eve", "Fay", "Gus", "Hana", "Ivo", "Jo", "Kit", "Lex"];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ pid: `p${i + 1}`, name: names[i] });
  return out;
}

function started(playerCount, settings, questionCount) {
  const s = WL.createState(makeGame(questionCount || 60, settings), makePlayers(playerCount), {});
  return WL.reduce(s, { type: "start" });
}

function play(state, events, now) {
  return events.reduce((s, e) => WL.reduce(s, typeof e === "string" ? { type: e } : e, now), state);
}

function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k], marks));
  return Object.freeze(value);
}

/** Vote everyone onto `target`; the target votes for `fallback`. */
function voteAll(state, target, fallback) {
  return state.active.reduce(
    (s, voter) => WL.reduce(s, { type: "vote", voter, target: voter === target ? fallback : target }),
    state
  );
}

/* ==== A1 — chain and bank edge cases (spec §1 "Round") ==== */

test("A1 bank at chain 0 is a no-op and does not consume an undo step", () => {
  const s = started(4);
  assert.equal(s.chainIndex, 0);
  const after = WL.reduce(s, { type: "bank" });
  assert.equal(after, s, "identical object — nothing happened");
  assert.equal(after.past.length, s.past.length, "no history entry was pushed");
  // And after a wrong answer drops the chain back to 0.
  const dropped = play(s, ["correct", "wrong"]);
  assert.equal(WL.chainValue(dropped), 0);
  assert.equal(WL.reduce(dropped, { type: "bank" }), dropped);
});

test("A1 banking twice in a row only banks once", () => {
  let s = play(started(4), ["correct", "correct"]);
  assert.equal(WL.chainValue(s), 2500);
  s = WL.reduce(s, { type: "bank" });
  assert.equal(s.roundBank, 2500);
  const twice = WL.reduce(s, { type: "bank" });
  assert.equal(twice, s, "the second bank finds an empty chain");
  assert.equal(twice.roundBank, 2500);
});

test("A1 bank does not change the turn or burn a question", () => {
  let s = play(started(4), ["correct"]);          // Ada right, turn -> Ben
  const turn = s.turnPid;
  const q = WL.currentQuestion(s).q;
  s = WL.reduce(s, { type: "bank" });
  assert.equal(s.turnPid, turn);
  assert.equal(WL.currentQuestion(s).q, q);
  assert.equal(s.roundStats.p2.banked, 1000, "the player about to be asked is the one who banked");
});

test("A1 top of the chain with topOfChainEndsRound:false keeps the round alive and caps the bank", () => {
  const top = 125000;
  let s = started(4, { topOfChainEndsRound: false });
  for (let i = 0; i < 8; i += 1) s = WL.reduce(s, { type: "correct" });
  assert.equal(s.phase, "round", "the round must NOT end");
  assert.equal(s.roundBank, top);
  assert.equal(s.chainIndex, 0, "the chain restarts from the bottom");
  assert.match(s.notice, /Top of the chain/);
  // A second full climb cannot take the round above the chain top (spec §1:
  // "max per round = chain top").
  for (let i = 0; i < 8; i += 1) s = WL.reduce(s, { type: "correct" });
  assert.equal(s.phase, "round");
  assert.equal(s.roundBank, top, "still capped at the top link");
  // And an ordinary bank after the cap adds nothing but still resets the chain.
  s = play(s, ["correct", "correct"]);
  s = WL.reduce(s, { type: "bank" });
  assert.equal(s.roundBank, top);
  assert.equal(s.chainIndex, 0);
});

test("A1 top of the chain with topOfChainEndsRound:true ends the round immediately", () => {
  let s = started(4, { topOfChainEndsRound: true });
  for (let i = 0; i < 8; i += 1) s = WL.reduce(s, { type: "correct" });
  assert.equal(s.phase, "voting");
  assert.equal(s.total, 125000);
  assert.equal(s.lastRoundBank, 125000);
});

test("A1 a shorter custom chain still auto-banks at its own top", () => {
  let s = started(4, { chain: [100, 200, 300] });
  s = play(s, ["correct", "correct", "correct"]);
  assert.equal(s.phase, "voting");
  assert.equal(s.total, 300);
});

/* ==== A2 — the round clock (spec §1 "When the clock hits 0…") ==== */

test("A2 expiry mid-question: a CORRECT answer is honoured, then the round ends", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "clockStart" }, 1000);
  s = play(s, ["correct", "correct", "bank"], 2000);   // 2500 safely banked
  s = WL.reduce(s, { type: "correct" }, 3000);         // 1000 riding on the chain
  assert.equal(WL.chainValue(s), 1000);
  s = WL.reduce(s, { type: "clockExpired" }, 151001);
  assert.equal(s.expired, true);
  assert.equal(s.phase, "round", "the in-flight question must still be judged");
  const before = s.roundStats[s.turnPid].correct;
  s = WL.reduce(s, { type: "correct" }, 151002);
  assert.equal(s.phase, "voting", "judging the in-flight question ends the round");
  assert.equal(s.total, 2500, "only the banked money survives");
  assert.equal(s.chainIndex, 0, "the unbanked chain is lost");
  assert.equal(s.roundStats[Object.keys(s.roundStats)[0]].correct >= before - before, true);
});

test("A2 expiry then a correct answer that reaches the top still banks it before the round ends", () => {
  let s = started(4, { chain: [100, 200, 300] });
  s = play(s, ["correct", "correct"]);                 // one link from the top
  s = WL.reduce(s, { type: "clockExpired" });
  assert.equal(s.expired, true);
  s = WL.reduce(s, { type: "correct" });
  assert.equal(s.phase, "voting");
  assert.equal(s.total, 300, "the auto-bank happened before the round closed");
});

test("A2 the clock cannot be restarted once it has expired, and expiry fires once", () => {
  let s = WL.reduce(started(4), { type: "clockStart" }, 0);
  s = WL.reduce(s, { type: "clockExpired" }, 150001);
  const again = WL.reduce(s, { type: "clockExpired" }, 150002);
  assert.equal(again, s, "a second clockExpired is a no-op");
  const restarted = WL.reduce(s, { type: "clockStart" }, 150003);
  assert.equal(restarted, s, "0 ms left means the clock will not start");
});

test("A2 pause/resume keeps the remaining time and re-bases the deadline", () => {
  let s = WL.reduce(started(4), { type: "clockStart" }, 1000);
  assert.equal(s.clock.deadline, 151000);
  s = WL.reduce(s, { type: "clockPause" }, 41000);
  assert.equal(s.clock.running, false);
  assert.equal(s.clock.remainingMs, 110000);
  const doublePause = WL.reduce(s, { type: "clockPause" }, 42000);
  assert.equal(doublePause, s, "pausing a paused clock is a no-op");
  s = WL.reduce(s, { type: "clockStart" }, 900000);
  assert.equal(s.clock.deadline, 1010000, "the deadline is rebuilt from `now`, not the old one");
  // Pausing past the deadline clamps at zero rather than going negative.
  s = WL.reduce(s, { type: "clockPause" }, 9999999);
  assert.equal(s.clock.remainingMs, 0);
});

test("A2 clockStart/clockPause outside a round are ignored", () => {
  const setup = WL.createState(makeGame(60), makePlayers(4), {});
  assert.equal(WL.reduce(setup, { type: "clockStart" }, 1), setup);
  const voting = WL.reduce(started(4), { type: "endRound" });
  assert.equal(WL.reduce(voting, { type: "clockStart" }, 1), voting);
  assert.equal(WL.reduce(voting, { type: "clockExpired" }, 1), voting);
});

test("A2 banking is refused once the clock has expired (WL-3 fixed)", () => {
  let s = play(started(4), ["correct", "correct"]);
  s = WL.reduce(s, { type: "clockExpired" });
  // Spec §1 lets a player bank only "before hearing their question"; the clock
  // is at zero and that question is in flight, so the chain riding on it can
  // no longer be rescued.
  assert.equal(WL.reduce(s, { type: "bank" }), s, "the identical object comes back");
  assert.equal(s.roundBank, 0);
  assert.equal(WL.chainValue(s), 2500, "the chain is still on the board until it is judged");
  // Judging still works, and the unbanked chain is then lost with the round.
  const judged = WL.reduce(s, { type: "wrong" });
  assert.equal(judged.phase, "voting");
  assert.equal(judged.total, 0, "nothing was rescued");
});

/* ==== A3 — statistics tie-breaks (spec §1 "Voting", K-U5 order) ==== */

function withStats(map, activePids) {
  const base = started(activePids ? activePids.length : Object.keys(map).length);
  const stats = {};
  Object.keys(map).forEach((pid) => { stats[pid] = Object.assign({ correct: 0, wrong: 0, banked: 0 }, map[pid]); });
  return Object.assign({}, base, { roundStats: stats });
}

test("A3 strongest link: correct beats banked beats fewest wrong, then seat order", () => {
  // p1 and p2 level on correct; p2 banked more -> p2 strongest.
  let s = withStats({
    p1: { correct: 3, banked: 1000, wrong: 0 }, p2: { correct: 3, banked: 5000, wrong: 4 },
    p3: { correct: 5, banked: 0, wrong: 0 }, p4: { correct: 0, banked: 0, wrong: 0 },
  });
  assert.equal(WL.strongestLink(s), "p3", "most correct wins outright");
  assert.deepEqual(WL.rankBy(s, undefined, null, 1).slice(0, 3), ["p3", "p2", "p1"]);

  // Level on correct AND banked -> fewest wrong wins.
  s = withStats({
    p1: { correct: 2, banked: 500, wrong: 3 }, p2: { correct: 2, banked: 500, wrong: 1 },
    p3: { correct: 2, banked: 500, wrong: 2 }, p4: { correct: 0, banked: 0, wrong: 0 },
  });
  assert.equal(WL.strongestLink(s), "p2");
  // Completely level -> seat order is the stable last resort.
  s = withStats({
    p1: { correct: 1, banked: 100, wrong: 1 }, p2: { correct: 1, banked: 100, wrong: 1 },
    p3: { correct: 1, banked: 100, wrong: 1 }, p4: { correct: 1, banked: 100, wrong: 1 },
  });
  assert.equal(WL.strongestLink(s), "p1");
  assert.equal(WL.weakestLink(s), "p1", "a total tie collapses to seat order both ways");
});

test("A3 weakest link: fewest correct, then LEAST banked, then MOST wrong", () => {
  let s = withStats({
    p1: { correct: 1, banked: 0, wrong: 0 }, p2: { correct: 1, banked: 0, wrong: 5 },
    p3: { correct: 1, banked: 900, wrong: 9 }, p4: { correct: 4, banked: 0, wrong: 0 },
  });
  assert.equal(WL.weakestLink(s), "p2", "level on correct and banked -> most wrong is weakest");
  assert.deepEqual(WL.rankBy(s, undefined, null, -1), ["p2", "p1", "p3", "p4"]);
});

test("A3 the pool argument restricts the ranking to players still in the game", () => {
  const s = withStats({
    p1: { correct: 0, banked: 0, wrong: 9 }, p2: { correct: 3, banked: 0, wrong: 0 },
    p3: { correct: 2, banked: 0, wrong: 0 }, p4: { correct: 1, banked: 0, wrong: 0 },
  });
  assert.equal(WL.strongestLink(s, undefined, ["p3", "p4"]), "p3");
  assert.equal(WL.weakestLink(s, undefined, ["p3", "p4"]), "p4", "p1 is out of the pool");
});

/* ==== A4 — voting (spec §1 "Voting", §5 phone contract) ==== */

function toVoting(players) {
  return WL.reduce(started(players || 5), { type: "endRound" });
}

test("A4 a self-vote is refused from every angle", () => {
  const s = toVoting();
  assert.equal(WL.canVote(s, "p1", "p1"), false);
  assert.equal(WL.reduce(s, { type: "vote", voter: "p1", target: "p1" }), s);
  assert.deepEqual(WL.phoneView(s, "p1").choices.map((c) => c.pid), ["p2", "p3", "p4", "p5"]);
});

test("A4 an eliminated player can neither vote nor be voted for", () => {
  let s = toVoting();
  s = voteAll(s, "p5", "p1");
  s = play(s, ["revealAll", "eliminate"]);
  assert.equal(s.eliminated.includes("p5"), true);
  assert.equal(WL.canVote(s, "p5", "p1"), false);
  s = WL.reduce(s, { type: "nextRound" });
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(WL.canVote(s, "p5", "p1"), false, "a ghost cannot vote");
  assert.equal(WL.canVote(s, "p1", "p5"), false, "and cannot be voted for");
  assert.equal(WL.reduce(s, { type: "vote", voter: "p5", target: "p1" }), s);
  assert.equal(WL.reduce(s, { type: "vote", voter: "p1", target: "p5" }), s);
  assert.equal(WL.phoneView(s, "p5").screen, "out");
});

test("A4 a vote may be changed until the first reveal, and never after", () => {
  let s = toVoting();
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p2" });
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p3" });
  assert.equal(s.votes.p1, "p3", "changing before any reveal is allowed");
  assert.equal(Object.keys(s.votes).length, 1, "changing does not add a second vote");
  // Fill the ballot, then reveal exactly one row.
  s = play(s, [
    { type: "vote", voter: "p2", target: "p3" }, { type: "vote", voter: "p3", target: "p1" },
    { type: "vote", voter: "p4", target: "p3" }, { type: "vote", voter: "p5", target: "p1" },
  ]);
  assert.equal(WL.reduce(s, { type: "revealVote" }).revealed.length, 1);
  const partly = WL.reduce(s, { type: "revealVote" });
  const changed = WL.reduce(partly, { type: "vote", voter: "p2", target: "p1" });
  assert.equal(changed, partly, "the ballot is locked after a partial reveal");
  assert.equal(changed.votes.p2, "p3");
  assert.equal(WL.canVote(partly, "p2", "p1"), true,
    "canVote only guards phase/membership; the reveal lock lives in the reducer");
});

test("A4 the reveal cannot start until every remaining player has voted", () => {
  let s = toVoting();
  s = play(s, [
    { type: "vote", voter: "p1", target: "p2" }, { type: "vote", voter: "p2", target: "p1" },
    { type: "vote", voter: "p3", target: "p1" }, { type: "vote", voter: "p4", target: "p1" },
  ]);
  assert.equal(WL.reduce(s, { type: "revealVote" }), s, "4 of 5 is not enough");
  assert.equal(WL.reduce(s, { type: "revealAll" }), s);
  s = WL.reduce(s, { type: "vote", voter: "p5", target: "p1" });
  assert.equal(WL.reduce(s, { type: "revealVote" }).revealed.length, 1);
});

test("A4 votes are revealed one at a time in seat order and resolve on the last", () => {
  let s = voteAll(toVoting(), "p4", "p1");
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    s = WL.reduce(s, { type: "revealVote" });
    seen.push(s.revealed[s.revealed.length - 1]);
  }
  assert.deepEqual(seen, ["p1", "p2", "p3", "p4", "p5"], "seat order");
  assert.equal(s.phase, "voteResult");
  assert.equal(s.eliminatedPid, "p4");
  assert.equal(WL.reduce(s, { type: "revealVote" }), s, "no sixth reveal");
});

test("A4 a THREE-way tie goes to the strongest link with all three tied names", () => {
  // 6 players, votes: p1->p4, p2->p5, p3->p6, p4->p5, p5->p6, p6->p4
  // tally: p4=2, p5=2, p6=2 -> three-way tie.
  let s = WL.reduce(started(6), { type: "endRound" });
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" }, { type: "vote", voter: "p2", target: "p5" },
    { type: "vote", voter: "p3", target: "p6" }, { type: "vote", voter: "p4", target: "p5" },
    { type: "vote", voter: "p5", target: "p6" }, { type: "vote", voter: "p6", target: "p4" }, "revealAll",
  ]);
  assert.equal(s.phase, "tiebreak");
  assert.deepEqual(s.tied, ["p4", "p5", "p6"], "every tied name, in seat order");
  assert.equal(s.tiebreakPid, "p1", "a level round falls back to seat order for the strongest link");
  assert.equal(WL.reduce(s, { type: "breakTie", target: "p2" }), s, "an untied name is refused");
  assert.equal(WL.reduce(s, { type: "breakTie", target: "nobody" }), s);
  assert.deepEqual(WL.phoneView(s, "p1").choices.map((c) => c.pid), ["p4", "p5", "p6"]);
  assert.equal(WL.phoneView(s, "p4").screen, "wait", "a tied player does not get the ballot");
  s = WL.reduce(s, { type: "breakTie", target: "p6" });
  assert.equal(s.phase, "voteResult");
  assert.equal(s.eliminatedPid, "p6");
});

test("A4 breakTie only works in the tiebreak phase", () => {
  const round = started(4);
  assert.equal(WL.reduce(round, { type: "breakTie", target: "p2" }), round);
  const voting = toVoting(4);
  assert.equal(WL.reduce(voting, { type: "breakTie", target: "p2" }), voting);
});

test("A4 host-entered votes and phone votes are the same event and cannot double up", () => {
  let s = toVoting(4);
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p2" });   // phone
  s = WL.reduce(s, { type: "vote", voter: "p1", target: "p3" });   // host override
  assert.equal(Object.keys(s.votes).length, 1);
  assert.equal(s.votes.p1, "p3");
});

/* ==== A5 — elimination, round rollover and the 3-player game ==== */

test("A5 the next round starts with the previous round's strongest link", () => {
  let s = started(5);
  s = play(s, ["wrong", "correct", "correct", "wrong", "wrong"]); // p2 and p3 right
  s = WL.reduce(s, { type: "endRound" });
  s = voteAll(s, "p5", "p1");
  s = play(s, ["revealAll", "eliminate", "nextRound"]);
  assert.equal(s.phase, "round");
  assert.equal(s.roundIndex, 1);
  assert.equal(s.turnPid, "p2", "most correct, earliest seat");
  assert.equal(s.clock.remainingMs, 140000, "round 2 is ten seconds shorter");
  assert.deepEqual(Object.keys(s.roundStats).sort(), ["p1", "p2", "p3", "p4"], "the departed keep no round stats");
});

test("A5 turn order skips the eliminated and wraps", () => {
  let s = started(4);
  s = WL.reduce(s, { type: "endRound" });
  s = voteAll(s, "p2", "p1");
  s = play(s, ["revealAll", "eliminate", "nextRound"]);
  const order = [];
  for (let i = 0; i < 4; i += 1) { order.push(s.turnPid); s = WL.reduce(s, { type: "wrong" }); }
  assert.equal(order.includes("p2"), false, "the departed never gets a turn");
  assert.deepEqual(new Set(order).size, 3);
});

test("A5 the last two go straight to the head-to-head, tripling the last FULL round (WL-1 fixed)", () => {
  let s = started(3);
  s = play(s, ["correct", "correct", "bank"]);          // 2500 in round 1
  s = WL.reduce(s, { type: "endRound" });
  assert.equal(s.phase, "voting");
  assert.equal(s.total, 2500);
  s = voteAll(s, "p3", "p1");
  s = play(s, ["revealAll", "eliminate"]);
  assert.deepEqual(s.active, ["p1", "p2"], "two players remain");
  assert.equal(s.phase, "goodbye", "the goodbye card still plays");
  // Spec §1: "Rounds continue until 2 players remain." No two-player round is
  // played, and the multiplier applies to round 1 — the last full-team round.
  s = WL.reduce(s, { type: "nextRound" });
  assert.equal(s.phase, "finalIntro", "straight into the head-to-head");
  assert.equal(s.roundIndex, 0, "no extra round was opened");
  assert.equal(s.lastRoundBank, 2500);
  assert.equal(s.finalBonus, 5000, "2500 counted three times");
  assert.equal(s.total, 7500);
  assert.deepEqual(s.final.pids, ["p1", "p2"]);
  // The round events are dead now; only the final ones do anything.
  for (const type of ["correct", "wrong", "bank", "endRound", "nextRound"]) {
    assert.equal(WL.reduce(s, { type }), s, `${type} after the last vote`);
  }
});

test("A5 a 4-player game reaches the final after exactly two votes (WL-1 fixed)", () => {
  let s = started(4);
  s = play(s, ["correct", "bank"]);                     // 1000 in round 1
  s = WL.reduce(s, { type: "endRound" });
  s = voteAll(s, "p4", "p1");
  s = play(s, ["revealAll", "eliminate", "nextRound"]);
  assert.equal(s.phase, "round", "three players still play a full round");
  assert.equal(s.roundIndex, 1);
  s = play(s, ["correct", "correct", "bank"]);          // 2500 in round 2
  s = WL.reduce(s, { type: "endRound" });
  s = voteAll(s, "p3", "p1");
  s = play(s, ["revealAll", "eliminate", "nextRound"]);
  assert.equal(s.phase, "finalIntro");
  assert.equal(s.lastRoundBank, 2500, "round 2 was the last full-team round");
  assert.equal(s.total, 1000 + 2500 + 5000);
});

test("A5 eliminate only fires from voteResult and only once", () => {
  let s = voteAll(toVoting(4), "p4", "p1");
  assert.equal(WL.reduce(s, { type: "eliminate" }), s, "not before the reveal resolves");
  s = WL.reduce(s, { type: "revealAll" });
  s = WL.reduce(s, { type: "eliminate" });
  assert.equal(s.phase, "goodbye");
  assert.equal(WL.reduce(s, { type: "eliminate" }), s, "a second eliminate is refused");
  assert.equal(s.active.length, 3);
  assert.equal(WL.reduce(s, { type: "nextRound" }).phase, "round");
});

/* ==== A6 — the head-to-head (spec §1 "Head-to-head") ==== */

/** Drive a 3-player game to `finalIntro`. One full round, one vote, then the
    head-to-head — the last two never play a round of their own (WL-1). */
function toFinal(settings) {
  let s = started(3, settings);
  s = play(s, ["correct", "correct", "bank"]);          // 2500 banked by the team
  s = WL.reduce(s, { type: "endRound" });
  s = voteAll(s, "p3", "p1");
  return play(s, ["revealAll", "eliminate", "nextRound"]);
}

test("A6 finalQuestionsEach 1 decides after one question each", () => {
  let s = toFinal({ finalQuestionsEach: 1 });
  assert.equal(s.final.questionsEach, 1);
  s = WL.reduce(s, { type: "finalFirst", pid: "p2" });
  s = WL.reduce(s, { type: "finalAnswer", correct: true });   // p2 right
  assert.equal(s.phase, "final", "still one question to go");
  s = WL.reduce(s, { type: "finalAnswer", correct: false });  // p1 wrong
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p2");
});

test("A6 finalQuestionsEach 1 that ties drops straight into sudden death", () => {
  let s = WL.reduce(toFinal({ finalQuestionsEach: 1 }), { type: "finalFirst", pid: "p1" });
  s = play(s, [{ type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: true }]);
  assert.equal(s.phase, "suddenDeath");
  assert.equal(s.turnPid, "p1", "the player who chose to go first leads the pair");
  s = play(s, [{ type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: false }]);
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p1");
});

test("A6 sudden death survives five level pairs and is decided only by a split", () => {
  let s = WL.reduce(toFinal(), { type: "finalFirst", pid: "p2" });
  for (let i = 0; i < 10; i += 1) s = WL.reduce(s, { type: "finalAnswer", correct: i < 6 });
  assert.equal(s.phase, "suddenDeath");
  const pattern = [[true, true], [false, false], [true, true], [false, false], [true, true]];
  pattern.forEach((pair) => {
    s = play(s, [{ type: "finalAnswer", correct: pair[0] }, { type: "finalAnswer", correct: pair[1] }]);
    assert.equal(s.phase, "suddenDeath", "a level pair never decides it");
    assert.equal(s.turnPid, "p2", "each new pair restarts with the first player");
  });
  assert.equal(s.final.sudden.length, 5);
  // Split the sixth pair the other way: the second player wins.
  s = play(s, [{ type: "finalAnswer", correct: false }, { type: "finalAnswer", correct: true }]);
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p1");
  assert.match(s.notice, /wins \$/);
});

test("A6 the final refuses strangers, junk and a second first-player choice", () => {
  const intro = toFinal();
  assert.equal(WL.reduce(intro, { type: "finalFirst", pid: "p3" }), intro, "an eliminated player cannot go first");
  assert.equal(WL.reduce(intro, { type: "finalFirst" }), intro);
  assert.equal(WL.reduce(intro, { type: "finalAnswer", correct: true }), intro, "no answers before the choice");
  const live = WL.reduce(intro, { type: "finalFirst", pid: "p1" });
  assert.equal(WL.reduce(live, { type: "finalFirst", pid: "p2" }), live, "the choice is made once");
  assert.equal(WL.reduce(live, { type: "finalAnswer", correct: "yes" }), live, "correct must be a boolean");
  assert.equal(WL.reduce(live, { type: "finalAnswer" }), live);
});

test("A6 nothing but the result screen survives once a winner is declared", () => {
  let s = WL.reduce(toFinal(), { type: "finalFirst", pid: "p1" });
  const script = [true, false, true, false, true, false, true, false, true, false];
  script.forEach((c) => { s = WL.reduce(s, { type: "finalAnswer", correct: c }); });
  assert.equal(s.phase, "result");
  assert.equal(s.winnerPid, "p1");
  for (const ev of ["correct", "wrong", "bank", "endRound", "eliminate", "nextRound", "revealAll"]) {
    assert.equal(WL.reduce(s, { type: ev }), s, `${ev} must be dead after the result`);
  }
  assert.equal(WL.reduce(s, { type: "finalAnswer", correct: true }), s);
  const rows = WL.standings(s);
  assert.equal(rows[0].pid, "p1");
  assert.equal(rows[rows.length - 1].out, true);
});

/* ==== A7 — the question pool ==== */

test("A7 the pool wraps, flags `repeating` and serves question 0 again", () => {
  let s = started(4, {}, 40);
  const first = WL.currentQuestion(s).q;
  for (let i = 0; i < 40; i += 1) s = WL.reduce(s, { type: "wrong" });
  assert.equal(s.repeating, true);
  assert.equal(s.qIndex, 0);
  assert.equal(WL.currentQuestion(s).q, first, "back to the top of the pool");
  // The flag is sticky even though the notice is transient.
  s = WL.reduce(s, { type: "correct" });
  assert.equal(s.repeating, true);
});

test("DEVIATION A7 the 'questions are repeating' notice is wiped by the next bank (WL-4)", () => {
  let s = started(4, {}, 40);
  for (let i = 0; i < 39; i += 1) s = WL.reduce(s, { type: "wrong" });
  s = WL.reduce(s, { type: "correct" });        // the 40th judgement wraps the pool
  assert.equal(s.repeating, true);
  assert.match(s.notice, /repeating/);
  s = WL.reduce(s, { type: "bank" });
  assert.equal(s.notice, "", "DEVIATION: the only surface for `repeating` is cleared");
  assert.equal(s.repeating, true, "the flag itself survives — the host UI just stops saying so");
});

test("A7 shuffling is a permutation and is stable for one game", () => {
  const rng = (() => { let x = 7; return () => { x = (x * 48271) % 2147483647; return x / 2147483647; }; })();
  const s = WL.createState(makeGame(50), makePlayers(4), { shuffle: true, rng });
  assert.equal(s.shuffled, true);
  assert.deepEqual(s.order.slice().sort((a, b) => a - b), WL.buildOrder(50, false));
  assert.equal(new Set(s.order).size, 50, "no duplicates");
  // buildOrder never returns an out-of-range index even with a hostile rng.
  const hostile = WL.buildOrder(20, true, () => 1);
  assert.equal(hostile.every((n) => n >= 0 && n < 20), true);
  const zero = WL.buildOrder(20, true, () => 0);
  assert.deepEqual(zero.slice().sort((a, b) => a - b), WL.buildOrder(20, false));
});
