/* ============================================================
   Pyramid — ADVERSARIAL suite, part 1: the rules (A1 … A6)
   Written against docs/11-pyramid-spec.md by the independent
   tester, who did not write games/pyramid/js/**. Everything here
   tries to break the format: the secret-word surface, word
   cycling, both clocks, the tiebreak, role rotation and the
   Winner's Circle. Part 2 (tests/pyr-hostile.test.mjs) attacks
   the transport, the validator, immutability and undo.
   Shared builders live in tests/pyr-fixtures.mjs.
   Run with:  cd games/pyramid && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Core, game, TEAMS, rngOf, boot, runCategory, playWholeBoard, toCircle,
  levelBoard, openCircle, PIDS, assertViewsClean,
} from "./pyr-fixtures.mjs";

/* ============================================================
   A1 — the leak surface: every pid × every phase × every event
   ============================================================ */

test("A1 no pid sees a word, a hint or host state in any phase of a whole game", () => {
  let s = boot();
  assertViewsClean(s, "board/turn A");

  const plans = [
    ["correct", "pass", "illegal", "pass"],
    ["pass", "pass", "pass", "correct"],
    ["illegal", "correct", "correct", "pass"],
  ];
  let t = 1000;
  let n = 0;
  while (s.phase === "board") {
    const index = s.board.findIndex((slot) => slot.team === null);
    s = Core.reduce(s, { type: "pickCategory", index }, t);
    assertViewsClean(s, "just picked");
    s = Core.reduce(s, { type: "clockStart" }, t);
    assertViewsClean(s, "clock running");
    plans[n % plans.length].forEach((result, i) => {
      s = Core.reduce(s, { type: "mark", result }, t + i + 1);
      assertViewsClean(s, `after ${result}`);
    });
    s = Core.reduce(s, { type: "clockPause" }, t + 20);
    assertViewsClean(s, "paused");
    s = Core.reduce(s, { type: "clockStart" }, t + 30);
    s = Core.reduce(s, { type: "clockExpired" }, t + 60000);
    assertViewsClean(s, "buzzer");
    if (!s.round.finished) s = Core.reduce(s, { type: "mark", result: "correct" }, t + 60001);
    assertViewsClean(s, "round over");
    s = Core.reduce(s, { type: "undo" }, t + 60002);
    assertViewsClean(s, "after undo");
    if (!s.round.finished) s = Core.reduce(s, { type: "mark", result: "pass" }, t + 60003);
    s = Core.reduce(s, { type: "nextTurn" }, t + 60100);
    assertViewsClean(s, "next turn");
    t += 200000;
    n += 1;
  }
  assert.equal(s.phase, "mainResult");
  assertViewsClean(s, "mainResult");

  s = toCircle(s, 0);
  assertViewsClean(s, "circle before the clock");
  s = Core.reduce(s, { type: "circleStart" }, 900100);
  assertViewsClean(s, "circle running");
  ["correct", "pass", "illegal", "correct", "pass", "correct"].forEach((result, i) => {
    s = Core.reduce(s, { type: "circleMark", result }, 900200 + i);
    assertViewsClean(s, `circle ${result}`);
  });
  s = Core.reduce(s, { type: "circleExpired" }, 999999);
  assertViewsClean(s, "circle buzzer");
  s = Core.reduce(s, { type: "finish" }, 1000000);
  assertViewsClean(s, "standings");
});

test("A1 a level game leaks nothing through the tiebreak either", () => {
  let s = levelBoard(4);
  assertViewsClean(s, "level mainResult");
  s = Core.reduce(s, { type: "tiebreak" }, 100000);
  let t = 100000;
  while (s.phase === "play" && !s.round.finished) {
    assertViewsClean(s, "tiebreak word");
    s = Core.reduce(s, { type: "clockStart" }, t);
    assertViewsClean(s, "tiebreak clock");
    s = Core.reduce(s, { type: "mark", result: t % 2000 ? "correct" : "pass" }, t + 1);
    t += 1000;
  }
  assertViewsClean(s, "tiebreak over");
});

test("A1 the giver's own view carries exactly one word and nothing else secret", () => {
  let s = boot();
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  const view = Core.phoneView(s, s.round.giverPid);
  const text = JSON.stringify(view);
  const shown = s.round.words.filter((w) => text.includes(w.text));
  assert.equal(shown.length, 1, "the giver's view must carry the current word and no other");
  assert.equal(view.word, Core.currentWord(s));
  assert.equal(view.screen, "giver");
  s.circleSet.boxes.forEach((b) => assert.equal(text.includes(b.category), false));
  s.board.slice(1).forEach((slot) => slot.words.forEach((w) => assert.equal(text.includes(w), false)));
});

test("A1 the giver loses the word the instant the round closes", () => {
  let s = boot({ wordsPerCategory: 3 });
  s = runCategory(s, 0, ["correct", "correct", "correct"], 1000);
  assert.equal(s.round.finished, true);
  assert.equal(Core.phoneView(s, s.round.giverPid).word, undefined);
  assert.equal(Core.currentWord(s), null);
  assert.deepEqual(Core.remainingWords(s), []);
  assertViewsClean(s, "round closed");
});

test("A1 the guesser gets the clock and the count and nothing that helps them cheat", () => {
  let s = boot();
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  const guesser = Core.phoneView(s, s.round.guesserPid);
  assert.equal(guesser.screen, "guesser");
  assert.equal(guesser.word, undefined);
  assert.equal(guesser.hint, undefined);
  assert.equal(guesser.circleCategory, undefined);
  assert.equal(guesser.clock.deadline, s.round.clock.deadline, "both phones read the host's deadline");
  assert.deepEqual(guesser.count, Core.wordCount(s));
  // The category TITLE is public: it is printed on the pyramid the room is watching.
  assert.equal(guesser.category, s.round.title);
});

/* ============================================================
   A2 — word cycling: many passes with an illegal in the middle
   ============================================================ */

test("A2 passes cycle for ever, an illegal in the middle removes exactly one word", () => {
  let s = boot({ wordsPerCategory: 4 });
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  const list = s.round.words.map((w) => w.text);

  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    seen.push(Core.currentWord(s));
    s = Core.reduce(s, { type: "mark", result: "pass" }, 1100 + i);
  }
  assert.deepEqual(seen, [...list, ...list, ...list], "passed words must cycle in order");
  assert.equal(s.round.words.every((w) => w.status === "passed"), true);

  const doomed = Core.currentWord(s);
  s = Core.reduce(s, { type: "mark", result: "illegal" }, 1200);
  assert.equal(s.round.words.find((w) => w.text === doomed).status, "illegal");
  assert.equal(Core.wordCount(s).left, 3);
  const after = [];
  for (let i = 0; i < 6; i += 1) {
    after.push(Core.currentWord(s));
    s = Core.reduce(s, { type: "mark", result: "pass" }, 1300 + i);
  }
  assert.equal(after.includes(doomed), false, "an illegal word must never come back");
  assert.equal(new Set(after).size, 3);
  assert.equal(Core.scores(s)[0], 0, "an illegal clue scores nothing");
});

test("A2 a correct word never comes back and the count only ever counts correct", () => {
  let s = boot({ wordsPerCategory: 4 });
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  const taken = Core.currentWord(s);
  s = Core.reduce(s, { type: "mark", result: "correct" }, 1100);
  for (let i = 0; i < 9; i += 1) {
    assert.notEqual(Core.currentWord(s), taken);
    s = Core.reduce(s, { type: "mark", result: "pass" }, 1200 + i);
  }
  assert.deepEqual(Core.wordCount(s), { done: 1, total: 4, left: 3 });
  assert.equal(s.board[0].correct, 1);
});

test("A2 the very last live word keeps its place when it is passed", () => {
  let s = boot({ wordsPerCategory: 3 });
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  s = Core.reduce(s, { type: "mark", result: "correct" }, 1100);
  s = Core.reduce(s, { type: "mark", result: "illegal" }, 1200);
  const last = Core.currentWord(s);
  for (let i = 0; i < 5; i += 1) {
    s = Core.reduce(s, { type: "mark", result: "pass" }, 1300 + i);
    assert.equal(Core.currentWord(s), last);
    assert.equal(s.round.finished, false, "a pass must never end the round on its own");
  }
});

test("A2 remainingWords is the queue in the order it will actually come round", () => {
  let s = boot({ wordsPerCategory: 4 });
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  s = Core.reduce(s, { type: "mark", result: "correct" }, 1100);
  s = Core.reduce(s, { type: "mark", result: "pass" }, 1200);
  const queue = Core.remainingWords(s).map((w) => w.text);
  const walked = [];
  let t = s;
  for (let i = 0; i < queue.length; i += 1) {
    walked.push(Core.currentWord(t));
    t = Core.reduce(t, { type: "mark", result: "pass" }, 1300 + i);
  }
  assert.deepEqual(walked, queue);
});

/* ============================================================
   A3 — the clock: marks in flight, marks out of time
   ============================================================ */

test("A3 a mark before the clock starts is refused, in a category and in the circle", () => {
  let s = boot();
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  ["correct", "pass", "illegal"].forEach((result) => {
    assert.equal(Core.reduce(s, { type: "mark", result }, 1100), s, `${result} scored before the clock`);
  });
  const full = playWholeBoard(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), ["correct", "correct", "correct"]);
  let c = toCircle(full, 0);
  ["correct", "pass", "illegal"].forEach((result) => {
    assert.equal(Core.reduce(c, { type: "circleMark", result }, 100), c, `${result} banked before the clock`);
  });
  c = Core.reduce(c, { type: "circleStart" }, 200);
  assert.notEqual(Core.reduce(c, { type: "circleMark", result: "correct" }, 300), c);
});

test("A3 the buzzer while a mark is in flight: one last judgement, then the round shuts", () => {
  ["correct", "pass", "illegal"].forEach((result) => {
    let s = runCategory(boot({ wordsPerCategory: 4 }), 0, ["correct"], 1000);
    const before = Core.scores(s)[0];
    s = Core.reduce(s, { type: "clockExpired" }, 31000);
    assert.equal(s.round.expired, true);
    assert.equal(s.round.finished, false, "the buzzer must not cut off the word being described");
    assert.equal(s.round.clock.running, false);
    assert.equal(Core.phoneView(s, s.round.giverPid).word, Core.currentWord(s), "the giver keeps the word");

    s = Core.reduce(s, { type: "mark", result }, 31500);
    assert.equal(s.round.finished, true, `${result} at the buzzer must close the round`);
    assert.equal(Core.scores(s)[0], before + (result === "correct" ? 1 : 0));
    assert.equal(Core.reduce(s, { type: "mark", result: "correct" }, 31600), s, "no second bite");
    assert.equal(Core.reduce(s, { type: "clockStart" }, 31700), s, "and the clock cannot be restarted");
  });
});

test("A3 the same buzzer rule holds in the Winner's Circle", () => {
  let c = openCircle(0);
  c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900200);
  c = Core.reduce(c, { type: "circleExpired" }, 960000);
  assert.equal(c.circle.expired, true);
  assert.equal(c.circle.finished, false);
  assert.equal(Core.phoneView(c, c.circle.giverPid).circleCategory, c.circle.boxes[c.circle.cursor].category);
  c = Core.reduce(c, { type: "circleMark", result: "correct" }, 960100);
  assert.equal(c.circle.finished, true);
  assert.equal(c.outcome.winnings, 500);
  assert.equal(Core.reduce(c, { type: "circleMark", result: "correct" }, 960200), c);
});

test("A3 the clock is pure arithmetic: start, pause, resume, expire", () => {
  let s = boot();
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 10000);
  s = Core.reduce(s, { type: "clockStart" }, 10000);
  assert.equal(s.round.clock.deadline, 40000);
  assert.equal(Core.secondsLeft(s.round.clock, 25000), 15);
  s = Core.reduce(s, { type: "clockPause" }, 22000);
  assert.equal(s.round.clock.running, false);
  assert.equal(s.round.clock.remainingMs, 18000);
  assert.equal(Core.reduce(s, { type: "clockPause" }, 23000), s, "pausing twice is a no-op");
  s = Core.reduce(s, { type: "clockStart" }, 50000);
  assert.equal(s.round.clock.deadline, 68000, "resume keeps the time that was left");
  assert.equal(Core.reduce(s, { type: "clockStart" }, 51000), s, "starting twice is a no-op");
  assert.equal(Core.reduce(s, { type: "clockExpired" }, 51000).round.expired, true);
  const paused = Core.reduce(s, { type: "clockPause" }, 60000);
  assert.equal(Core.reduce(paused, { type: "clockExpired" }, 61000), paused, "a stopped clock cannot expire");
});

test("A3 clock events leave no undo history", () => {
  let s = Core.reduce(boot(), { type: "pickCategory", index: 0 }, 1000);
  const depth = s.history.length;
  ["clockStart", "clockPause", "clockStart", "clockExpired"].forEach((type, i) => {
    s = Core.reduce(s, { type }, 1000 + i * 100);
  });
  assert.equal(s.history.length, depth, "a clock tick is not a decision and must not be undoable");
});

/* ============================================================
   A4 — the tiebreak (spec 11 §1: one category, ONE WORD EACH)
   ============================================================ */

test("A4 a level board offers exactly one tiebreak and alternates one word each", () => {
  let s = levelBoard(4);
  assert.equal(s.phase, "mainResult");
  assert.deepEqual(Core.scores(s), [1, 1]);
  assert.equal(Core.leader(s), null);

  s = Core.reduce(s, { type: "tiebreak" }, 100000);
  assert.equal(s.phase, "play");
  assert.equal(s.round.tiebreak, true);
  assert.equal(s.round.team, 0, "Team A leads off (documented limit)");

  const order = [];
  let t = 100000;
  for (let i = 0; i < 3 && !s.round.finished; i += 1) {
    order.push(s.round.team);
    s = Core.reduce(s, { type: "clockStart" }, t);
    s = Core.reduce(s, { type: "mark", result: i === 2 ? "correct" : "pass" }, t + 1);
    t += 1000;
  }
  assert.deepEqual(order.slice(0, 3), [0, 1, 0], "the tiebreak alternates one word each");
});

test("A4 the tiebreak is decided only at the end of a complete pair", () => {
  let s = Core.reduce(levelBoard(4), { type: "tiebreak" }, 100000);
  s = Core.reduce(s, { type: "clockStart" }, 100000);
  s = Core.reduce(s, { type: "mark", result: "correct" }, 100001);   // A takes one
  assert.equal(s.round.finished, false, "A cannot win before B has had its word");
  s = Core.reduce(s, { type: "clockStart" }, 101000);
  s = Core.reduce(s, { type: "mark", result: "illegal" }, 101001);   // B misses
  assert.equal(s.round.finished, true);
  assert.equal(s.round.tbWinner, 0);
  s = Core.reduce(s, { type: "nextTurn" }, 102000);
  assert.equal(s.phase, "mainResult");
  assert.equal(Core.leader(s), 0, "the tiebreak winner leads even though the board is level");
  assert.equal(s.tiebreakPlayed, true);
  assert.equal(Core.reduce(s, { type: "tiebreak" }, 103000), s, "the tiebreak can only be played once");
});

test("A4 running out of tiebreak words must not hand it to whoever had the extra word", () => {
  // Three words, both teams perfect: A, B, then A alone — the words run out
  // mid-pair. Spec 11 §1 says "one word each", so an unmatched word cannot
  // decide the Winner's Circle; the host picks instead (tieWinner stays null).
  let s = Core.reduce(levelBoard(3), { type: "tiebreak" }, 100000);
  let t = 100000;
  const turns = [];
  while (s.phase === "play" && !s.round.finished && turns.length < 6) {
    turns.push(s.round.team);
    s = Core.reduce(s, { type: "clockStart" }, t);
    s = Core.reduce(s, { type: "mark", result: "correct" }, t + 1);
    t += 1000;
  }
  assert.equal(s.round.finished, true);
  assert.deepEqual(turns, [0, 1, 0]);
  assert.deepEqual(s.round.tbScores, [2, 1]);
  assert.equal(s.round.tbWinner, null,
    "an odd number of tiebreak words is not a result — Team A had one word more than Team B");
  s = Core.reduce(s, { type: "nextTurn" }, t);
  assert.equal(s.phase, "mainResult");
  assert.equal(Core.leader(s), null, "the host must pick the team when the tiebreak ran out level");
  assert.equal(toCircle(s, 1).circle.team, 1);
  assert.equal(toCircle(s, 0).circle.team, 0);
});

test("A4 a tiebreak pass keeps the word alive and hands the turn over", () => {
  let s = Core.reduce(levelBoard(4), { type: "tiebreak" }, 100000);
  const first = Core.currentWord(s);
  s = Core.reduce(s, { type: "clockStart" }, 100000);
  s = Core.reduce(s, { type: "mark", result: "pass" }, 100001);
  assert.equal(s.round.team, 1);
  assert.equal(s.round.started, false, "every tiebreak word gets its own clock");
  assert.equal(s.round.clock.remainingMs, 15000);
  assert.equal(s.round.giverPid, s.teams[1].members[1].pid, "the roles follow the team");
  assert.notEqual(Core.currentWord(s), first);
  assert.equal(s.round.words.find((w) => w.text === first).status, "passed");
});

test("A4 a decided board never offers a tiebreak", () => {
  let s = boot({ wordsPerCategory: 3, categoriesPerTeam: 1 });
  s = runCategory(s, 0, ["correct", "correct", "correct"], 1000);
  s = Core.reduce(s, { type: "nextTurn" }, 2000);
  s = runCategory(s, 1, ["illegal", "illegal", "illegal"], 3000);
  s = Core.reduce(s, { type: "nextTurn" }, 4000);
  assert.equal(s.phase, "mainResult");
  assert.equal(Core.reduce(s, { type: "tiebreak" }, 5000), s);
  assert.equal(Core.leader(s), 0);
});

/* ============================================================
   A5 — role swap on and off
   ============================================================ */

function giversFor(swapRoles) {
  let s = boot({ wordsPerCategory: 3, categoriesPerTeam: 3, swapRoles });
  const seen = [];
  let t = 1000;
  while (s.phase === "board") {
    const index = s.board.findIndex((slot) => slot.team === null);
    s = Core.reduce(s, { type: "pickCategory", index }, t);
    seen.push({ team: s.round.team, giver: s.round.giverPid, guesser: s.round.guesserPid });
    s = Core.reduce(s, { type: "clockStart" }, t);
    ["correct", "correct", "correct"].forEach((r, i) => { s = Core.reduce(s, { type: "mark", result: r }, t + i + 1); });
    s = Core.reduce(s, { type: "nextTurn" }, t + 10);
    t += 100000;
  }
  return { rows: seen, state: s };
}

test("A5 swapRoles:true alternates giver and guesser within each team", () => {
  const { rows, state } = giversFor(true);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.team), [0, 1, 0, 1, 0, 1], "the teams alternate picks");
  assert.deepEqual(rows.filter((r) => r.team === 0).map((r) => r.giver), ["p1", "p2", "p1"]);
  assert.deepEqual(rows.filter((r) => r.team === 1).map((r) => r.giver), ["p3", "p4", "p3"]);
  rows.forEach((r) => assert.notEqual(r.giver, r.guesser));
  const c = toCircle(state, 0);
  assert.equal(c.circle.giverPid, "p2", "the rotation carries on into the Winner's Circle");
  assert.equal(c.circle.guesserPid, "p1");
});

test("A5 swapRoles:false keeps the pair on the roles they started with", () => {
  const { rows, state } = giversFor(false);
  assert.deepEqual(rows.filter((r) => r.team === 0).map((r) => r.giver), ["p1", "p1", "p1"]);
  assert.deepEqual(rows.filter((r) => r.team === 1).map((r) => r.giver), ["p3", "p3", "p3"]);
  assert.deepEqual(rows.filter((r) => r.team === 0).map((r) => r.guesser), ["p2", "p2", "p2"]);
  assert.equal(toCircle(state, 1).circle.giverPid, "p3");
});

test("A5 firstGiver:1 starts the other member, and toCircle can override the giver", () => {
  const teams = [
    { name: "Reds", firstGiver: 1, members: TEAMS[0].members },
    { name: "Blues", members: TEAMS[1].members },
  ];
  let s = Core.createState(game({ wordsPerCategory: 3, categoriesPerTeam: 1 }), teams, { rng: rngOf(4) });
  s = Core.reduce(s, { type: "start" }, 0);
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  assert.equal(s.round.giverPid, "p2");
  assert.equal(s.round.guesserPid, "p1");
  const full = playWholeBoard(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), ["correct", "correct", "correct"]);
  assert.equal(Core.reduce(full, { type: "toCircle", team: 0, giver: 1 }, 5000).circle.giverPid, "p2");
  assert.equal(Core.reduce(full, { type: "toCircle", team: 0, giver: 0 }, 5000).circle.giverPid, "p1");
});

/* ============================================================
   A6 — the Winner's Circle
   ============================================================ */

test("A6 an illegal clue blocks that box, banks what is won, and play carries on", () => {
  let c = openCircle(0);
  c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900200);   // $200
  c = Core.reduce(c, { type: "circleMark", result: "illegal" }, 900300);   // $300 blocked
  assert.equal(c.circle.finished, false, "a blocked box must not end the Winner's Circle");
  assert.equal(c.circle.boxes[1].status, "blocked");
  assert.equal(Core.circleWinnings(c), 200, "money already won is kept");
  assert.equal(c.circle.cursor, 2, "play moves to the next box");

  ["correct", "correct", "correct", "correct"].forEach((result, i) => {
    c = Core.reduce(c, { type: "circleMark", result }, 900400 + i);
  });
  assert.equal(c.circle.finished, true);
  assert.equal(c.circle.boxes.filter((b) => b.status === "won").length, 5);
  assert.equal(c.outcome.cleared, false);
  assert.equal(c.outcome.winnings, 200 + 400 + 500 + 800 + 1000);
  assert.equal(Core.circleWinnings(c), 2900);
  assert.notEqual(Core.circleWinnings(c), 10000, "a blocked box rules the grand prize out for good");
});

test("A6 a blocked box can never be revisited or rescued by undoing later marks", () => {
  let c = openCircle(0);
  c = Core.reduce(c, { type: "circleMark", result: "illegal" }, 900200);
  const visited = [];
  for (let i = 0; i < 10; i += 1) {
    visited.push(c.circle.cursor);
    c = Core.reduce(c, { type: "circleMark", result: "pass" }, 900300 + i);
  }
  assert.equal(visited.includes(0), false, "the blocked box is out of the rotation");
  assert.equal(new Set(visited).size, 5);
});

test("A6 all six inside the time pays the grand prize INSTEAD of the box values", () => {
  let c = openCircle(0);
  for (let i = 0; i < 6; i += 1) c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900200 + i);
  assert.equal(c.circle.finished, true);
  assert.equal(c.outcome.cleared, true);
  assert.equal(c.outcome.boxesWon, 6);
  assert.equal(c.outcome.winnings, 10000);
  assert.equal(Core.circleWinnings(c), 10000);
  assert.notEqual(c.outcome.winnings, 3200, "the grand prize replaces the box values, it is not added to them");
  const rows = Core.standings(c);
  assert.equal(rows[0].winnings, 10000);
  assert.equal(rows[1].winnings, 0);
  assert.deepEqual(rows[0].members.map((m) => m.pid), ["p1", "p2"], "the money is the whole team's");
  const shown = Core.reduce(c, { type: "nextTurn" }, 900400);
  assert.equal(shown.phase, "result");
  PIDS.slice(0, 2).forEach((pid) => {
    assert.equal(Core.phoneView(shown, pid).mine, "$10,000", `${pid} must be told what they won`);
  });
  assert.equal(Core.phoneView(shown, "p3").mine, null, "the losing team is told nothing is theirs");
  assert.equal(Core.phoneView(shown, "ghost").mine, null);
});

test("A6 passed boxes are revisited; the circle only closes when nothing is left", () => {
  let c = openCircle(0);
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    order.push(c.circle.boxes[c.circle.cursor].category);
    c = Core.reduce(c, { type: "circleMark", result: "pass" }, 900200 + i);
  }
  assert.equal(new Set(order).size, 6, "a lap of passes visits all six");
  assert.equal(c.circle.finished, false);
  assert.equal(c.circle.boxes[c.circle.cursor].category, order[0], "and comes back round");
  assert.equal(Core.circleWinnings(c), 0);
});

test("A6 the box values map onto the pyramid in the spec's order", () => {
  const c = openCircle(0);
  assert.deepEqual(c.circle.boxes.map((b) => b.value), [200, 300, 400, 500, 800, 1000]);
  assert.equal(c.circle.cursor, 0, "the circle starts on the cheapest box");
});

test("A6 a custom currency, values, prize and label all survive to the standings", () => {
  const g = game({ wordsPerCategory: 3, categoriesPerTeam: 1 });
  g.settings.currency = "£";
  g.settings.circleValues = [50, 60, 70, 80, 90, 100];
  g.settings.grandPrize = 2500;
  g.settings.grandPrizeLabel = "£2,500";
  let s = Core.reduce(Core.createState(g, TEAMS, { rng: rngOf(3) }), { type: "start" }, 0);
  s = playWholeBoard(s, ["correct", "correct", "correct"]);
  s = Core.reduce(toCircle(s, 0), { type: "circleStart" }, 900100);
  s = Core.reduce(s, { type: "circleMark", result: "correct" }, 900200);
  s = Core.reduce(s, { type: "circleMark", result: "illegal" }, 900300);
  assert.equal(Core.formatMoney(s, Core.circleWinnings(s)), "£50");
  assert.equal(s.game.settings.grandPrizeLabel, "£2,500");
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "circleMark", result: "correct" }, 900400 + i);
  assert.equal(s.outcome.winnings, 50 + 70 + 80 + 90 + 100);
});

test("A6 the losing team never banks the winner's money", () => {
  let c = openCircle(1);
  assert.equal(c.circle.team, 1);
  for (let i = 0; i < 6; i += 1) c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900200 + i);
  const rows = Core.standings(c);
  assert.equal(rows[0].winnings, 0);
  assert.equal(rows[1].winnings, 10000);
  assert.equal(rows.reduce((sum, r) => sum + r.winnings, 0), 10000, "the prize is paid exactly once");
});
