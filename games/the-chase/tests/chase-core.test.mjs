/* ============================================================
   The Chase — success states CH-U1 … CH-U10 (spec 15 §6)
   Pure core only: no DOM, no network, no real clock. `now` is
   injected everywhere, so a whole night runs in microseconds.
   ============================================================ */

"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  Core, DEFAULT_GAME, tinyGame, TEAM, started, play, buildCash, playH2h, rightIdx, wrongIdx, seeded,
} from "./chase-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(join(HERE, "..", rel), "utf8"));

/* ============================================================
   CH-U1 — the validator
   ============================================================ */

test("CH-U1 a good file validates and normalises", () => {
  const game = tinyGame();
  assert.equal(Core.validateGame(game), true);
  const norm = Core.normalizeGame(game);
  assert.equal(norm.settings.steps, 7);
  assert.equal(norm.rapid.length, 90);
  assert.equal(norm.multi[0].options.length, 3);
  // normalise never mutates its input
  assert.equal(game.title, "Tiny Chase");
  assert.notEqual(norm.rapid, game.rapid);
});

test("CH-U1 every rejection is a plain-English message", () => {
  const cases = [
    [null, /not a Chase game/],
    [{ rapid: [], multi: [] }, /at least 80 rapid-fire/],
    [Object.assign(tinyGame(), { multi: [] }), /at least 40 head-to-head/],
    [Object.assign(tinyGame(), { title: "x".repeat(200) }), /at most 80 characters/],
    [Object.assign(tinyGame(), { settings: { steps: 2 } }), /between 3 and 12/],
    [Object.assign(tinyGame(), { settings: { steps: 7, startStep: 7 } }), /must be below/],
    [Object.assign(tinyGame(), { settings: { steps: 7, startStep: 1 } }), /between 2 and 5/],
    [Object.assign(tinyGame(), { settings: { chaserIsHost: "yes" } }), /true or false/],
    [Object.assign(tinyGame(), { settings: { currency: "dollars" } }), /at most 3 characters/],
  ];
  for (const [game, re] of cases) {
    assert.throws(() => Core.validateGame(game), re, `expected ${re} for ${JSON.stringify(game).slice(0, 60)}`);
  }
});

test("CH-U1 a head-to-head question needs three distinct options and answer 0-2", () => {
  const bad = (multi) => Object.assign(tinyGame(), { multi: tinyGame().multi.slice(0, 44).concat([multi]) });
  assert.throws(() => Core.validateGame(bad({ q: "Q?", options: ["A", "B"], answer: 0 })), /exactly 3 options/);
  assert.throws(() => Core.validateGame(bad({ q: "Q?", options: ["A", "B", "C"], answer: 3 })), /must be 0, 1 or 2/);
  assert.throws(() => Core.validateGame(bad({ q: "Q?", options: ["A", "a", "C"], answer: 0 })), /repeats another option/);
  assert.throws(() => Core.validateGame(bad({ q: "Q?", options: ["A", "", "C"], answer: 0 })), /option B is empty/);
  assert.throws(() => Core.validateGame(bad({ q: "Multi 1?", options: ["A", "B", "C"], answer: 0 })), /twice/);
});

test("CH-U1 a rapid-fire question needs a question and an answer", () => {
  const bad = (rapid) => Object.assign(tinyGame(), { rapid: tinyGame().rapid.slice(0, 89).concat([rapid]) });
  assert.throws(() => Core.validateGame(bad({ q: "", a: "x" })), /no question text/);
  assert.throws(() => Core.validateGame(bad({ q: "Q?", a: "" })), /has no answer/);
  assert.throws(() => Core.validateGame(bad("not an object")), /must be an object/);
});

test("CH-U1 warnings are advice, not errors", () => {
  const warnings = Core.warningsFor(tinyGame());
  assert.ok(warnings.some((w) => /rapid-fire questions/.test(w)));
  assert.deepEqual(Core.warningsFor({ rapid: [] }).length, 1);   // the error, as one note
});

/* ============================================================
   CH-U2 — the Cash Builder
   ============================================================ */

test("CH-U2 correct answers pay, wrong and pass do not", () => {
  let s = started();
  assert.equal(s.phase, "cashBuilder");
  assert.equal(s.cb.item.q, "Rapid 1?");
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  assert.equal(s.cb.clock.running, true);
  assert.equal(s.cb.clock.deadline, 61000);
  s = play(s, [
    { type: "cbMark", result: "correct" },
    { type: "cbMark", result: "wrong" },
    { type: "cbMark", result: "correct" },
    { type: "cbMark", result: "pass" },
  ], 1000);
  assert.equal(s.cb.correct, 2);
  assert.equal(s.cb.wrong, 1);
  assert.equal(s.cb.passed, 1);
  assert.equal(Core.cashTotal(s), 2000);
  assert.equal(s.cb.item.q, "Rapid 5?", "the fifth question is on the table");
});

test("CH-U2 nothing is judged off the clock", () => {
  let s = started();
  const before = Core.reduce(s, { type: "cbMark", result: "correct" }, 1000);
  assert.equal(before, s, "no mark before the clock starts");
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  s = Core.reduce(s, { type: "cbPause" }, 31000);
  assert.equal(s.cb.clock.running, false);
  assert.equal(s.cb.clock.remainingMs, 30000);
  assert.equal(Core.reduce(s, { type: "cbMark", result: "correct" }, 32000), s);
  s = Core.reduce(s, { type: "cbStart" }, 40000);
  assert.equal(s.cb.clock.deadline, 70000, "a resumed clock keeps the time that was left");
});

test("CH-U2 the buzzer leaves exactly one question to judge", () => {
  let s = started();
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  s = Core.reduce(s, { type: "cbMark", result: "correct" }, 2000);
  s = Core.reduce(s, { type: "cbExpired" }, 61000);
  assert.equal(s.cb.expired, true);
  assert.equal(s.cb.clock.remainingMs, 0);
  s = Core.reduce(s, { type: "cbMark", result: "correct" }, 61500);
  assert.equal(s.cb.finished, true);
  assert.equal(s.cb.correct, 2);
  assert.equal(s.results[0].cash, 2000);
  assert.equal(Core.reduce(s, { type: "cbMark", result: "correct" }, 62000), s, "and no more");
  s = Core.reduce(s, { type: "nextQuestion" }, 62000);
  assert.equal(s.phase, "offer");
});

test("CH-U2 the host may wave the last question away", () => {
  let s = started();
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  s = Core.reduce(s, { type: "cbMark", result: "correct" }, 2000);
  s = Core.reduce(s, { type: "cbExpired" }, 61000);
  s = Core.reduce(s, { type: "nextQuestion" }, 61500);
  assert.equal(s.cb.finished, true);
  assert.equal(s.cb.correct, 1);
  assert.equal(s.results[0].cash, 1000);
});

/* ============================================================
   CH-U3 — the offers
   ============================================================ */

test("CH-U3 the three amounts and the three starting steps", () => {
  const s = buildCash(started(), 6);          // $6,000
  const o = Core.offers(s);
  assert.equal(o.middle.amount, 6000);
  assert.equal(o.higher.amount, 30000);       // x5
  assert.equal(o.lower.amount, 3000);         // /2
  assert.equal(o.middle.step, 3);
  assert.equal(o.higher.step, 4, "one step closer to the Chaser");
  assert.equal(o.lower.step, 2, "one step nearer home");
});

test("CH-U3 a contestant who built nothing is still offered a high and a low", () => {
  const s = buildCash(started(), 0);
  const o = Core.offers(s);
  assert.equal(o.middle.amount, 0);
  assert.equal(o.higher.amount, 5000);
  assert.equal(o.lower.amount, 1000);
});

test("CH-U3 the offers honour the file's own multipliers and board", () => {
  const s = buildCash(started({ settings: { steps: 9, startStep: 4, higherMultiplier: 4, lowerDivisor: 4 } }), 4);
  const o = Core.offers(s);
  assert.equal(o.higher.amount, 16000);
  assert.equal(o.lower.amount, 1000);
  assert.deepEqual([o.lower.step, o.middle.step, o.higher.step], [3, 4, 5]);
});

test("CH-U3 picking an offer sets the amount and puts both markers on the board", () => {
  let s = buildCash(started(), 5);
  s = Core.reduce(s, { type: "offer", choice: "higher" }, 3000);
  assert.equal(s.phase, "headToHead");
  assert.equal(s.h2h.amount, 25000);
  assert.equal(s.h2h.cPos, 4);
  assert.equal(s.h2h.hPos, 7);
  assert.equal(s.results[0].choice, "higher");
  assert.equal(s.h2h.q.q, "Multi 1?");
  assert.equal(Core.reduce(s, { type: "offer", choice: "lower" }, 3100), s, "and only once");
});

test("CH-U3 an unknown offer is ignored", () => {
  const s = buildCash(started(), 5);
  assert.equal(Core.reduce(s, { type: "offer", choice: "enormous" }, 3000), s);
  assert.equal(Core.reduce(s, { type: "offer" }, 3000), s);
});

/* ============================================================
   CH-U4 — the head to head
   ============================================================ */

function chase(choice, settings) {
  let s = buildCash(started({ settings }), 4);
  s = Core.reduce(s, { type: "offer", choice: choice || "middle" }, 3000);
  return s;
}

test("CH-U4 a correct contestant steps down; a correct Chaser steps down too", () => {
  let s = chase();
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [3, 7]);
  s = playH2h(s, true, true);
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [2, 6]);
  assert.equal(s.h2h.outcome, null);
  s = Core.reduce(s, { type: "nextQuestion" }, 5000);
  s = playH2h(s, false, false);
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [2, 6], "two misses move nobody");
});

test("CH-U4 three correct answers take the contestant home with the money", () => {
  let s = chase("middle");
  for (let i = 0; i < 3; i += 1) {
    s = playH2h(s, true, false);
    if (i < 2) s = Core.reduce(s, { type: "nextQuestion" }, 5000 + i);
  }
  assert.equal(s.h2h.cPos, 0);
  assert.equal(s.h2h.outcome, "home");
  assert.equal(s.results[0].outcome, "home");
  assert.equal(s.results[0].amount, 4000);
  assert.equal(Core.bank(s), 4000);
});

test("CH-U4 the Chaser catches the contestant on the same step", () => {
  let s = chase("middle");
  for (let i = 0; i < 4; i += 1) {
    s = playH2h(s, false, true);
    if (s.h2h.outcome) break;
    s = Core.reduce(s, { type: "nextQuestion" }, 5000 + i);
  }
  assert.equal(s.h2h.hPos, 3);
  assert.equal(s.h2h.cPos, 3);
  assert.equal(s.h2h.outcome, "caught");
  assert.equal(s.results[0].outcome, "caught");
  assert.equal(s.results[0].amount, 0);
  assert.equal(Core.bank(s), 0);
});

test("CH-U4 catch and home are right at every start step", () => {
  for (const choice of ["lower", "middle", "higher"]) {
    const start = { lower: 2, middle: 3, higher: 4 }[choice];
    let home = chase(choice);
    assert.equal(home.h2h.cPos, start);
    for (let i = 0; i < start; i += 1) {
      home = playH2h(home, true, false);
      if (home.h2h.outcome) break;
      home = Core.reduce(home, { type: "nextQuestion" }, 6000 + i);
    }
    assert.equal(home.h2h.outcome, "home", `${choice}: home after ${start} correct`);

    let caught = chase(choice);
    const needed = 7 - start;
    for (let i = 0; i < needed; i += 1) {
      caught = playH2h(caught, false, true);
      if (caught.h2h.outcome) break;
      caught = Core.reduce(caught, { type: "nextQuestion" }, 7000 + i);
    }
    assert.equal(caught.h2h.outcome, "caught", `${choice}: caught after ${needed} Chaser answers`);
  }
});

test("CH-U4 reaching home ends the chase before the Chaser can catch", () => {
  let s = chase("lower");                   // two steps from home
  s = playH2h(s, true, true);
  s = Core.reduce(s, { type: "nextQuestion" }, 5000);
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [1, 6]);
  s = play(s, [
    { type: "lock", side: "contestant", idx: rightIdx(s) },
    { type: "lock", side: "chaser", idx: rightIdx(s) },
    { type: "revealContestant" },
  ], 6000);
  assert.equal(s.h2h.outcome, "home");
  assert.equal(Core.reduce(s, { type: "revealChaser" }, 6100), s, "the Chaser's answer no longer matters");
});

test("CH-U4 the reveal order is contestant, then Chaser", () => {
  let s = chase();
  s = play(s, [
    { type: "lock", side: "contestant", idx: 0 },
    { type: "lock", side: "chaser", idx: 0 },
  ], 4000);
  assert.equal(Core.reduce(s, { type: "revealChaser" }, 4100), s, "no Chaser reveal first");
  const c = Core.reduce(s, { type: "revealContestant" }, 4200);
  assert.equal(c.h2h.revealed.contestant, true);
  assert.equal(c.h2h.revealed.chaser, false);
  const both = Core.reduce(c, { type: "revealChaser" }, 4300);
  assert.equal(Core.bothRevealed(both), true);
});

test("CH-U4 a side cannot be revealed before it has locked, or dealt before both are shown", () => {
  let s = chase();
  assert.equal(Core.reduce(s, { type: "revealContestant" }, 4000), s);
  assert.equal(Core.reduce(s, { type: "nextQuestion" }, 4000), s);
  s = Core.reduce(s, { type: "lock", side: "contestant", idx: 1 }, 4100);
  s = Core.reduce(s, { type: "revealContestant" }, 4200);
  assert.equal(Core.reduce(s, { type: "nextQuestion" }, 4300), s, "the Chaser has not been shown");
  assert.equal(Core.reduce(s, { type: "lock", side: "contestant", idx: 2 }, 4400), s,
    "and a revealed side cannot re-lock");
});

test("CH-U4 a lock may be changed until it is revealed", () => {
  let s = chase();
  s = Core.reduce(s, { type: "lock", side: "contestant", idx: 0 }, 4000);
  s = Core.reduce(s, { type: "lock", side: "contestant", idx: 2 }, 4050);
  assert.equal(s.h2h.locks.contestant, 2);
  assert.equal(Core.reduce(s, { type: "lock", side: "contestant", idx: 5 }, 4100), s);
  assert.equal(Core.reduce(s, { type: "lock", side: "nobody", idx: 1 }, 4100), s);
});

test("CH-U4 the board selector places both markers and counts the gap", () => {
  const s = chase("higher");
  const b = Core.board(s);
  assert.equal(b.rows.length, 8, "seven steps plus home");
  assert.equal(b.rows[0].pos, 7);
  assert.equal(b.rows[0].chaser, true);
  assert.equal(b.rows[7].home, true);
  assert.equal(b.rows[3].contestant, true, "the higher offer starts on step 4");
  assert.equal(b.gap, 3);
  assert.equal(b.toHome, 4);
});

test("CH-U4 the next contestant takes the hot seat", () => {
  let s = chase();
  for (let i = 0; i < 4; i += 1) {
    s = playH2h(s, false, true);
    if (s.h2h.outcome) break;
    s = Core.reduce(s, { type: "nextQuestion" }, 8000 + i);
  }
  assert.equal(Core.hotSeat(s).name, "Ada");
  s = Core.reduce(s, { type: "nextContestant" }, 9000);
  assert.equal(s.phase, "cashBuilder");
  assert.equal(s.seat, 1);
  assert.equal(Core.hotSeat(s).name, "Ben");
  assert.equal(s.cb.correct, 0);
});

/* ============================================================
   CH-U5 — the head start
   ============================================================ */

/** Play a whole run-in: `homes` says whether each contestant got home. */
function toFinal(homes, settings) {
  const contestants = TEAM.slice(0, homes.length);
  let s = started({ contestants, settings });
  homes.forEach((home, seat) => {
    s = buildCash(s, seat + 2, 1000 + seat * 100000);
    s = Core.reduce(s, { type: "offer", choice: "middle" }, 2000 + seat * 100000);
    for (let i = 0; i < 8; i += 1) {
      s = playH2h(s, home, !home, 3000 + seat * 100000 + i * 100);
      if (s.h2h.outcome) break;
      s = Core.reduce(s, { type: "nextQuestion" }, 3500 + seat * 100000 + i * 100);
    }
    s = Core.reduce(s, { type: "nextContestant" }, 9000 + seat * 100000);
  });
  return s;
}

test("CH-U5 one step per finalist, and a lone finalist still gets one", () => {
  const solo = toFinal([true, false, false]);
  assert.equal(solo.phase, "finalTeam");
  assert.equal(solo.final.finalists.length, 1);
  assert.equal(solo.final.headStart, 1);
  assert.equal(solo.final.teamSteps, 1);

  const three = toFinal([true, true, true]);
  assert.equal(three.final.headStart, 3);
  assert.equal(three.final.teamSteps, 3);
});

test("CH-U5 the head start rules are configurable", () => {
  const s = toFinal([true, true], { headStartPerMember: 2, minHeadStart: 3 });
  assert.equal(s.final.headStart, 4);
  const floor = toFinal([true], { headStartPerMember: 0, minHeadStart: 2 });
  assert.equal(floor.final.headStart, 2);
});

test("CH-U5 nobody home means there is no Final Chase at all", () => {
  const s = toFinal([false, false]);
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.played, false);
  assert.equal(s.outcome.teamWon, false);
  assert.equal(s.outcome.bank, 0);
});

/* ============================================================
   CH-U6 — the Final Chase
   ============================================================ */

test("CH-U6 the team build a target, then the Chaser goes for it", () => {
  let s = toFinal([true, true]);
  assert.equal(s.final.teamSteps, 2);
  assert.equal(Core.reduce(s, { type: "finalTeamMark", result: "correct" }, 1), s, "not before the clock");
  s = Core.reduce(s, { type: "finalTeamStart" }, 1000);
  s = play(s, [
    { type: "finalTeamMark", result: "correct" },
    { type: "finalTeamMark", result: "correct" },
    { type: "finalTeamMark", result: "wrong" },
    { type: "finalTeamMark", result: "correct" },
    { type: "finalTeamMark", result: "pass" },
  ], 1000);
  assert.equal(s.final.teamSteps, 5);
  assert.equal(s.final.teamCorrect, 3);
  assert.equal(s.final.teamWrong, 1);
  assert.equal(s.final.teamPassed, 1);
  s = Core.reduce(s, { type: "finalTeamExpired" }, 121000);
  assert.equal(s.final.teamFinished, true);
  assert.equal(Core.reduce(s, { type: "finalTeamMark", result: "correct" }, 121500), s, "the buzzer is final");
  s = Core.reduce(s, { type: "nextQuestion" }, 122000);
  assert.equal(s.phase, "finalChaser");
  assert.equal(s.final.chaserSteps, 0);
});

/** A team target of `target`, ready for the Chaser to start. */
function chaserHalf(target, homes) {
  let s = toFinal(homes || [true, true]);
  s = Core.reduce(s, { type: "finalTeamStart" }, 1000);
  for (let i = s.final.teamSteps; i < target; i += 1) {
    s = Core.reduce(s, { type: "finalTeamMark", result: "correct" }, 1000 + i);
  }
  s = Core.reduce(s, { type: "finalTeamExpired" }, 121000);
  s = Core.reduce(s, { type: "nextQuestion" }, 122000);
  return Core.reduce(s, { type: "finalChaserStart" }, 200000);
}

test("CH-U6 a Chaser miss is offered to the team and a correct answer pushes him back", () => {
  let s = chaserHalf(4);
  s = play(s, [
    { type: "finalChaserMark", result: "correct" },
    { type: "finalChaserMark", result: "correct" },
  ], 200000);
  assert.equal(s.final.chaserSteps, 2);
  s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 200500);
  assert.ok(s.final.pushback, "the miss is on offer");
  assert.equal(s.final.chaserSteps, 2);
  assert.equal(Core.reduce(s, { type: "finalChaserMark", result: "correct" }, 200600), s,
    "the Chaser waits while the team answer");
  s = Core.reduce(s, { type: "pushback", correct: true }, 200700);
  assert.equal(s.final.chaserSteps, 1);
  assert.equal(s.final.pushbacks, 1);
  assert.equal(s.final.pushback, null);
  s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 200800);
  s = Core.reduce(s, { type: "pushback", correct: false }, 200900);
  assert.equal(s.final.chaserSteps, 1, "a missed pushback changes nothing");
  assert.equal(s.final.pushbacks, 1);
});

test("CH-U6 a pushback cannot drive the Chaser below the start line", () => {
  let s = chaserHalf(3);
  s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 200100);
  s = Core.reduce(s, { type: "pushback", correct: true }, 200200);
  assert.equal(s.final.chaserSteps, 0);
});

test("CH-U6 ending one: the Chaser reaches the target and catches the team", () => {
  let s = chaserHalf(3);
  s = play(s, [
    { type: "finalChaserMark", result: "correct" },
    { type: "finalChaserMark", result: "correct" },
    { type: "finalChaserMark", result: "correct" },
  ], 200000);
  assert.equal(s.phase, "result");
  assert.equal(s.final.caught, true);
  assert.equal(s.outcome.teamWon, false);
  assert.equal(s.outcome.chaserSteps, 3);
  assert.ok(s.outcome.share.every((x) => x.amount === 0));
  assert.equal(s.final.chaserClock.running, false);
  assert.ok(s.final.chaserClock.remainingMs > 100000, "the clock stops where the catch happened");
});

test("CH-U6 ending two: time runs out and the team take the bank", () => {
  let s = chaserHalf(6);
  s = Core.reduce(s, { type: "finalChaserMark", result: "correct" }, 200100);
  s = Core.reduce(s, { type: "finalChaserExpired" }, 320000);
  assert.equal(s.phase, "result");
  assert.equal(s.final.caught, false);
  assert.equal(s.outcome.teamWon, true);
  assert.ok(s.outcome.bank > 0);
});

test("CH-U6 the Chaser's clock pauses and resumes like every other clock", () => {
  let s = chaserHalf(6);
  s = Core.reduce(s, { type: "finalChaserPause" }, 230000);
  assert.equal(s.final.chaserClock.running, false);
  assert.equal(s.final.chaserClock.remainingMs, 90000);
  assert.equal(Core.reduce(s, { type: "finalChaserMark", result: "correct" }, 231000), s);
  s = Core.reduce(s, { type: "finalChaserStart" }, 240000);
  assert.equal(s.final.chaserClock.deadline, 330000);
});

/* ============================================================
   CH-U7 — the bank and the split
   ============================================================ */

test("CH-U7 the bank is every amount carried home, split evenly", () => {
  let s = toFinal([true, true, true]);
  const bank = Core.bank(s);
  assert.equal(bank, s.results.reduce((n, r) => n + (r.outcome === "home" ? r.amount : 0), 0));
  s = Core.reduce(s, { type: "finalTeamStart" }, 1000);
  s = Core.reduce(s, { type: "finalTeamExpired" }, 121000);
  s = Core.reduce(s, { type: "nextQuestion" }, 122000);
  s = Core.reduce(s, { type: "finalChaserStart" }, 200000);
  s = Core.reduce(s, { type: "finalChaserExpired" }, 320000);
  assert.equal(s.outcome.teamWon, true);
  const total = s.outcome.share.reduce((n, x) => n + x.amount, 0);
  assert.equal(total, bank, "not a cent is lost to rounding");
  assert.equal(s.outcome.share.length, 3);
});

test("CH-U7 an awkward split gives the remainder out one at a time", () => {
  assert.deepEqual(Core.splitBank(10, [{ pid: "a", name: "A" }, { pid: "b", name: "B" },
    { pid: "c", name: "C" }]).map((x) => x.amount), [4, 3, 3]);
  assert.deepEqual(Core.splitBank(0, [{ pid: "a", name: "A" }]).map((x) => x.amount), [0]);
  assert.deepEqual(Core.splitBank(100, []), []);
});

test("CH-U7 the standings show what each contestant built, played and won", () => {
  let s = chaserHalf(6, [true, false, true]);
  s = Core.reduce(s, { type: "finalChaserExpired" }, 320000);
  const rows = Core.standings(s);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].outcome, "caught");
  assert.equal(rows[1].winnings, 0);
  assert.ok(rows[1].played > 0, "a caught contestant still shows what they played for");
  assert.ok(rows[0].winnings > 0 && rows[2].winnings > 0);
  assert.equal(rows[0].winnings + rows[2].winnings, s.outcome.bank);
  assert.equal(Core.formatMoney(s, 25000), "$25,000");
});

/* ============================================================
   CH-U8 — undo, illegal events, immutability
   ============================================================ */

test("CH-U8 undo walks back one decision at a time", () => {
  let s = buildCash(started(), 3);
  s = Core.reduce(s, { type: "offer", choice: "higher" }, 3000);
  const board = JSON.stringify(Core.board(s));
  s = playH2h(s, true, true);
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [3, 6]);
  s = Core.reduce(s, { type: "undo" }, 5000);   // un-reveal the Chaser
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos], [3, 7]);
  s = Core.reduce(s, { type: "undo" }, 5100);   // un-reveal the contestant
  s = Core.reduce(s, { type: "undo" }, 5200);   // un-lock the Chaser
  s = Core.reduce(s, { type: "undo" }, 5300);   // un-lock the contestant
  assert.equal(JSON.stringify(Core.board(s)), board);
  assert.equal(s.h2h.locks.contestant, null);
});

test("CH-U8 undo with nothing behind it is a no-op, and the log never grows past its cap", () => {
  const fresh = Core.createState(tinyGame(), { contestants: TEAM });
  assert.equal(Core.reduce(fresh, { type: "undo" }, 0), fresh);
  let s = started();
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  for (let i = 0; i < 80; i += 1) s = Core.reduce(s, { type: "cbMark", result: "correct" }, 1000 + i);
  assert.ok(s.history.length <= Core.MAX_HISTORY);
  assert.ok(s.history.every((h) => h.history.length === 0), "a snapshot never carries its own history");
});

test("CH-U8 clock events are never undo steps", () => {
  const s0 = started();
  const depth = s0.history.length;
  let s = Core.reduce(s0, { type: "cbStart" }, 1000);
  assert.equal(s.history.length, depth);
  s = Core.reduce(s, { type: "cbPause" }, 2000);
  s = Core.reduce(s, { type: "cbStart" }, 3000);
  s = Core.reduce(s, { type: "cbExpired" }, 62000);
  assert.equal(s.history.length, depth, "no clock event is an undo step");
});

test("CH-U8 junk and hostile events are ignored, never thrown", () => {
  const s = started();
  for (const ev of [null, undefined, 7, "start", [], {}, { type: 42 }, { type: "nope" },
    { type: "toString" }, { type: "__proto__" }, { type: "constructor" },
    { type: "hasOwnProperty" }, { type: "valueOf" }]) {
    assert.equal(Core.reduce(s, ev, 1000), s, `event ${JSON.stringify(ev)} changed the state`);
  }
  assert.equal(typeof {}.toString, "function", "the prototype is intact");
  assert.equal(Core.reduce(null, { type: "start" }, 0), null);
});

test("CH-U8 out-of-phase events change nothing", () => {
  const s = started();
  for (const ev of [{ type: "start" }, { type: "offer", choice: "higher" },
    { type: "lock", side: "contestant", idx: 0 }, { type: "revealContestant" },
    { type: "revealChaser" }, { type: "nextContestant" }, { type: "finalTeamStart" },
    { type: "finalTeamMark", result: "correct" }, { type: "finalChaserStart" },
    { type: "pushback", correct: true }, { type: "finalChaserMark", result: "correct" }]) {
    assert.equal(Core.reduce(s, ev, 1000), s, `${ev.type} should be refused in ${s.phase}`);
  }
});

test("CH-U8 the reducer never mutates the state it was given", () => {
  let s = buildCash(started(), 2);
  const before = JSON.stringify(s);
  const after = Core.reduce(s, { type: "offer", choice: "middle" }, 3000);
  assert.equal(JSON.stringify(s), before);
  assert.notEqual(after, s);
  assert.notEqual(after.results, s.results);
  const b = Core.board(after);
  b.rows.length = 0;
  assert.equal(Core.board(after).rows.length, 8, "a selector hands out fresh objects");
});

test("CH-U8 a seeded shuffle is repeatable and keeps every question", () => {
  const a = started({ shuffle: true, rng: seeded(7) });
  const b = started({ shuffle: true, rng: seeded(7) });
  assert.deepEqual(a.order.rapid, b.order.rapid);
  assert.deepEqual(a.order.multi, b.order.multi);
  assert.equal(a.order.rapid.length, 90);
  assert.equal(new Set(a.order.multi.map((m) => m.q)).size, 45);
  const plain = started();
  assert.notDeepEqual(a.order.rapid.map((r) => r.q), plain.order.rapid.map((r) => r.q));
});

test("CH-U8 a night longer than the file wraps and says so", () => {
  const short = tinyGame();
  let s = started({ game: short });
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  for (let i = 0; i < 95; i += 1) s = Core.reduce(s, { type: "cbMark", result: "correct" }, 1000 + i);
  assert.equal(s.repeating, true);
  assert.equal(s.cb.item.q, "Rapid 6?");
});

test("CH-U8 the roster is validated with plain English", () => {
  assert.throws(() => Core.createState(tinyGame(), { contestants: [] }), /at least one contestant/);
  assert.throws(() => Core.createState(tinyGame(), {
    contestants: [{ pid: "a", name: "A" }, { pid: "b", name: "B" }, { pid: "c", name: "C" },
      { pid: "d", name: "D" }, { pid: "e", name: "E" }],
  }), /at most 4 contestants/);
  assert.throws(() => Core.createState(tinyGame(), {
    contestants: [{ pid: "a", name: "A" }, { pid: "a", name: "Again" }],
  }), /two seats/);
  assert.throws(() => Core.createState(tinyGame(), {
    contestants: TEAM, chaser: { isHost: false },
  }), /Pick the player who is the Chaser/);
  assert.throws(() => Core.createState(tinyGame(), {
    contestants: TEAM, chaser: { isHost: false, pid: "p1" },
  }), /cannot also be a contestant/);
});

/* ============================================================
   CH-U9 — the shipped content
   ============================================================ */

test("CH-U9 questions.json is playable and js/data.js mirrors it exactly", () => {
  const file = readJson("questions.json");
  assert.equal(Core.validateGame(file), true);
  assert.equal(file.rapid.length, 200);
  assert.equal(file.multi.length, 60);
  assert.deepEqual(DEFAULT_GAME, file, "js/data.js must be regenerated with questions.json");
  assert.equal(globalThis.CHASE_DEFAULT_GAME, DEFAULT_GAME, "data.js reaches globalThis");
});

test("CH-U9 every shipped question is unique and family-sized", () => {
  const file = readJson("questions.json");
  const seen = new Set();
  for (const r of file.rapid) {
    assert.ok(r.q.length <= 200 && r.a.length <= 80, `too long: ${r.q}`);
    assert.equal(seen.has(r.q.toLowerCase()), false, `repeated: ${r.q}`);
    seen.add(r.q.toLowerCase());
  }
  for (const m of file.multi) {
    assert.equal(m.options.length, 3);
    assert.ok(m.answer >= 0 && m.answer <= 2);
  }
  const spread = Core.countAnswers(file.multi);
  assert.ok(Math.min(...spread) >= 10, `the right answer hides in every slot: ${spread}`);
});

test("CH-U9 the set library manifest matches the sets on disk", () => {
  const index = readJson("sets/index.json");
  assert.ok(Array.isArray(index) && index.length >= 2);
  assert.ok(index.length <= 50);
  for (const entry of index) {
    assert.match(entry.file, /^[A-Za-z0-9_-]+\.json$/, "a bare file name, no slashes");
    assert.ok(entry.name && entry.description && entry.by);
    const set = readJson(`sets/${entry.file}`);
    assert.equal(Core.validateGame(set), true, `${entry.file} must validate`);
    assert.equal(set.rapid.length, entry.counts["rapid-fire"]);
    assert.equal(set.multi.length, entry.counts["head-to-head"]);
  }
});

test("CH-U9 the harness fixture is playable", () => {
  const fixture = readJson("tests/fixtures/harness-game.json");
  assert.equal(Core.validateGame(fixture), true);
  assert.equal(fixture.settings.cashBuilderSeconds, 15);
});

/* ============================================================
   CH-U10 — the leak test
   ============================================================ */

test("CH-U10 neither side sees the other's lock before the reveal", () => {
  let s = buildCash(started({ chaser: { isHost: false, pid: "cx", name: "The Beast" } }), 3);
  s = Core.reduce(s, { type: "offer", choice: "middle" }, 3000);
  const answer = s.h2h.q.answer;
  const cWrong = (answer + 1) % 3;
  s = Core.reduce(s, { type: "lock", side: "contestant", idx: cWrong }, 4000);
  s = Core.reduce(s, { type: "lock", side: "chaser", idx: answer }, 4100);

  const contestant = Core.phoneView(s, "p1");
  const chaser = Core.phoneView(s, "cx");
  const spectator = Core.phoneView(s, "p2");

  assert.equal(contestant.screen, "answer");
  assert.equal(contestant.myLock, cWrong, "their own choice is theirs to see");
  assert.equal(contestant.chaserLocked, true, "a lamp, not a letter");
  assert.equal(contestant.answer, undefined, "the right answer is not in the payload yet");
  assert.equal(JSON.stringify(contestant).includes(`"chaserLock"`), false);

  assert.equal(chaser.screen, "chaser");
  assert.equal(chaser.myLock, answer);
  assert.equal(chaser.contestantLocked, true);
  assert.equal(chaser.answer, undefined);

  assert.equal(spectator.screen, "wait");
  assert.equal(spectator.myLock, undefined);
  assert.equal(spectator.answer, undefined);

  // Only after BOTH are shown does the correct answer travel.
  let shown = Core.reduce(s, { type: "revealContestant" }, 4200);
  assert.equal(Core.phoneView(shown, "cx").answer, undefined, "one reveal is not both");
  shown = Core.reduce(shown, { type: "revealChaser" }, 4300);
  assert.equal(Core.phoneView(shown, "cx").answer, answer);
  assert.equal(Core.phoneView(shown, "p1").answer, answer);
});

test("CH-U10 rapid-fire answers never reach a phone", () => {
  let s = started();
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  const rapid = s.cb.item;
  for (const pid of ["p1", "p2", "p3", "nobody"]) {
    const text = JSON.stringify(Core.phoneView(s, pid));
    assert.equal(text.includes(rapid.a), false, `${pid} was sent the answer`);
    assert.equal(text.includes(rapid.q), false, `${pid} was sent the question`);
  }
  const final = chaserHalf(5);
  const item = final.final.item;
  for (const pid of ["p1", "p2", "p3"]) {
    const text = JSON.stringify(Core.phoneView(final, pid));
    assert.equal(text.includes(item.a), false, `${pid} was sent a Final Chase answer`);
    assert.equal(text.includes(item.q), false, `${pid} was sent a Final Chase question`);
  }
});

test("CH-U10 only the side in play may lock, and only through a validated message", () => {
  let s = buildCash(started({ chaser: { isHost: false, pid: "cx", name: "The Beast" } }), 2);
  s = Core.reduce(s, { type: "offer", choice: "middle" }, 3000);
  assert.equal(Core.lockSideFor(s, "p1"), "contestant");
  assert.equal(Core.lockSideFor(s, "cx"), "chaser");
  assert.equal(Core.lockSideFor(s, "p2"), null, "a contestant out of the hot seat cannot lock");
  assert.equal(Core.phoneCanLock(s, "p3"), false);

  assert.deepEqual(Core.validatePhoneMsg({ t: "lock", idx: 2 }), { t: "lock", idx: 2 });
  assert.deepEqual(Core.validatePhoneMsg({ t: "ready" }), { t: "ready" });
  for (const junk of [null, 7, "lock", {}, { t: "lock" }, { t: "lock", idx: 3 }, { t: "lock", idx: -1 },
    { t: "lock", idx: "1" }, { t: "reveal" }, { t: "cbMark", result: "correct" },
    { t: "finish" }, { t: "pushback", correct: true }]) {
    assert.equal(Core.validatePhoneMsg(junk), null, `accepted ${JSON.stringify(junk)}`);
  }
});

test("CH-U10 when the host is the Chaser no phone is ever the Chaser", () => {
  let s = buildCash(started(), 2);
  s = Core.reduce(s, { type: "offer", choice: "middle" }, 3000);
  assert.equal(s.chaser.isHost, true);
  for (const pid of ["p1", "p2", "p3"]) {
    assert.notEqual(Core.lockSideFor(s, pid), "chaser");
    assert.equal(Core.phoneView(s, pid).isChaser, false);
  }
  assert.equal(Core.lockSideFor(s, "p1"), "contestant");
});

test("CH-U10 every phone screen is one of the documented five", () => {
  const screens = new Set();
  let s = started({ chaser: { isHost: false, pid: "cx", name: "The Beast" } });
  const collect = (st) => ["p1", "p2", "p3", "cx"].forEach((pid) => screens.add(Core.phoneView(st, pid).screen));
  collect(s);
  s = Core.reduce(s, { type: "cbStart" }, 1000);
  collect(s);
  s = buildCash(s, 2, 1000);
  collect(s);
  s = Core.reduce(s, { type: "offer", choice: "middle" }, 3000);
  collect(s);
  s = Core.reduce(s, { type: "finish" }, 4000);
  collect(s);
  const final = chaserHalf(5);
  ["p1", "p2", "p3"].forEach((pid) => screens.add(Core.phoneView(final, pid).screen));
  assert.deepEqual([...screens].sort(), ["answer", "chaser", "final", "result", "wait"]);
});
