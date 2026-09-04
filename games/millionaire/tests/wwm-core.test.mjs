/* ============================================================
   Millionaire — pure core unit tests (spec 08 §8, M-U1 … M-U10)
   Zero dependencies: node --test from games/millionaire.
   The core takes rng and now as arguments, so every scenario here
   is fully deterministic.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/wwm-core.js");
const DEFAULT_GAME = require("../js/data.js");
const SHIPPED = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));

/* ============ Fixtures ============ */

/** A deterministic rng: cycles through the values it is given. */
function seq(...values) {
  let i = 0;
  return () => values[(i += 1) - 1 < values.length ? i - 1 : (i = 1) - 1];
}

/** Always returns the same number. */
const fixed = (v) => () => v;

const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
  { pid: "p4", name: "Dev" },
];

/** A small but complete game: 3 questions on every rung of a 15-rung tree. */
function buildGame(perLevel = 3) {
  const questions = [];
  for (let level = 1; level <= 15; level += 1) {
    for (let n = 0; n < perLevel; n += 1) {
      questions.push({
        level,
        category: "Test",
        q: `Level ${level} question ${n + 1}?`,
        options: [`L${level}-${n}-A`, `L${level}-${n}-B`, `L${level}-${n}-C`, `L${level}-${n}-D`],
        answer: n % 4,
      });
    }
  }
  return {
    title: "Test Millionaire",
    settings: {
      currency: "$",
      moneyTree: Core.DEFAULT_MONEY_TREE.slice(),
      safeHavens: [5, 10],
      lifelines: { fifty: true, phone: true, audience: true, switch: true },
      phoneSeconds: 30,
      audienceSeconds: 20,
      fastestFinger: true,
    },
    questions,
    fastestFinger: [
      { q: "Order these.", options: ["W", "X", "Y", "Z"], order: [1, 0, 3, 2] },
      { q: "Order those.", options: ["A", "B", "C", "D"], order: [3, 2, 1, 0] },
    ],
  };
}

const state0 = (game = buildGame(), players = PLAYERS) => Core.createState(game, players, {});

/** Run a list of events through the reducer with one rng and clock. */
function run(state, events, rng = fixed(0), now = 1000) {
  return events.reduce((s, ev) => Core.reduce(s, ev, rng, now), state);
}

/** Seat p1 in the hot seat, facing question 1 with nothing banked (rung 0). */
function seated(game = buildGame()) {
  return run(state0(game), [{ type: "start" }, { type: "fffPick", pid: "p1" }, { type: "seat", pid: "p1" }]);
}

/** Answer the current question correctly and move on. */
function answerCorrect(state, rng = fixed(0), now = 1000) {
  const idx = state.question.answer;
  return run(state, [
    { type: "select", idx }, { type: "lock" }, { type: "reveal" }, { type: "nextQuestion" },
  ], rng, now);
}

/* ============================================================
   M-U1 — the validator
   ============================================================ */

test("M-U1 the shipped questions.json validates and mirrors data.js", () => {
  assert.equal(Core.validateGame(SHIPPED), true);
  assert.deepEqual(SHIPPED, DEFAULT_GAME, "questions.json and js/data.js must hold the same game");
  const norm = Core.normalizeGame(SHIPPED);
  assert.equal(norm.questions.length, 45);
  assert.equal(norm.fastestFinger.length, 6);
  for (let level = 1; level <= 15; level += 1) {
    assert.equal(norm.questions.filter((q) => q.level === level).length, 3, `level ${level} has 3 questions`);
  }
});

test("M-U1 every shipped answer index points at a real option", () => {
  SHIPPED.questions.forEach((q, i) => {
    assert.ok(q.options[q.answer], `question ${i + 1} has an answer option`);
  });
  // A file where every answer is "A" would be a giveaway; the shipped set varies.
  const spread = new Set(SHIPPED.questions.map((q) => q.answer));
  assert.equal(spread.size, 4, "answers use all four letters");
});

test("M-U1 the validator rejects the documented bad files", () => {
  const bad = (mutate, needle) => {
    const game = JSON.parse(JSON.stringify(SHIPPED));
    mutate(game);
    assert.throws(() => Core.validateGame(game), (err) => {
      assert.ok(err instanceof Error && err.message.length > 10, "plain-English message");
      if (needle) assert.match(err.message, needle);
      return true;
    });
  };
  bad((g) => { g.questions = g.questions.slice(0, 14); }, /at least 15/);
  bad((g) => { g.questions[0].options = ["a", "b", "c"]; }, /exactly 4 options/);
  bad((g) => { g.questions[0].options[1] = g.questions[0].options[0]; }, /repeats the option/);
  bad((g) => { g.questions[0].answer = 4; }, /answer/);
  bad((g) => { g.settings.moneyTree = [100, 200, 200, 300, 400]; }, /increase at every rung/);
  bad((g) => { g.settings.safeHavens = [5, 99]; }, /outside the money tree/);
  bad((g) => { g.fastestFinger[0].order = [0, 1, 2, 2]; }, /exactly once/);
  bad((g) => { g.questions[0].level = 99; }, /rungs/);
  bad((g) => { g.settings.lifelines = { fifty: "yes" }; }, /true or false/);
  bad((g) => { g.settings.audienceSeconds = 500; }, /0 to 120/);
  assert.throws(() => Core.validateGame(null), /JSON object/);
  assert.throws(() => Core.validateGame([]), /JSON object/);
});

test("M-U1 warningsFor flags a thin level", () => {
  const game = buildGame(3);
  game.questions = game.questions.filter((q) => q.level !== 7 || q.q.endsWith("1?"));
  const warnings = Core.warningsFor(game);
  assert.ok(warnings.some((w) => w.includes("7 (1)")), warnings.join(" | "));
  assert.deepEqual(Core.warningsFor(SHIPPED), []);
});

/* ============================================================
   M-U2 — level assignment and the no-repeat draw
   ============================================================ */

test("M-U2 questions with no level are spread evenly by file order", () => {
  const game = buildGame(1);
  game.questions.forEach((q) => { delete q.level; });
  const norm = Core.normalizeGame(game);
  assert.deepEqual(norm.questions.map((q) => q.level), Array.from({ length: 15 }, (_, i) => i + 1));
  // 30 questions over 15 rungs = 2 each.
  const wide = buildGame(2);
  wide.questions.forEach((q) => { delete q.level; });
  const spread = Core.normalizeGame(wide);
  for (let level = 1; level <= 15; level += 1) {
    assert.equal(spread.questions.filter((q) => q.level === level).length, 2);
  }
});

test("M-U2 two contestants never see the same question, and the pool wraps", () => {
  const game = buildGame(2);
  let s = seated(game);
  const seen = [];
  for (let i = 0; i < 15; i += 1) {
    seen.push(s.question.id);
    s = answerCorrect(s);
  }
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.reason, "million");
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p2" }, { type: "seat", pid: "p2" }]);
  const second = [];
  for (let i = 0; i < 15; i += 1) {
    second.push(s.question.id);
    s = answerCorrect(s);
  }
  assert.equal(new Set(seen.concat(second)).size, 30, "no question repeats across two contestants");
  assert.equal(s.wrapped, false, "two contestants fit in a 2-per-level pool");

  // A third contestant must wrap: every question has been used.
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p3" }, { type: "seat", pid: "p3" }]);
  assert.equal(s.wrapped, true);
  assert.match(s.notice, /wrapped/);
  assert.ok(seen.concat(second).includes(s.question.id));
});

/* ============================================================
   M-U3 — select, lock, reveal, safe havens
   ============================================================ */

test("M-U3 select then lock then reveal climbs the money tree", () => {
  let s = seated();
  assert.equal(s.phase, "hotseat");
  assert.equal(s.rung, 0, "nothing answered correctly yet");
  assert.equal(Core.playingRung(s), 1, "question 1 is on screen");
  assert.equal(Core.rungValue(s, Core.playingRung(s)), 100);
  s = Core.reduce(s, { type: "select", idx: s.question.answer }, fixed(0), 1);
  assert.equal(s.selected, s.question.answer);
  assert.equal(s.locked, false);
  s = Core.reduce(s, { type: "lock" }, fixed(0), 1);
  assert.equal(s.locked, true);
  assert.equal(s.revealed, false, "locking does not reveal — the host paces it");
  s = Core.reduce(s, { type: "reveal" }, fixed(0), 1);
  assert.equal(s.revealed, true);
  assert.equal(s.correct, true);
  assert.equal(s.outcome, null, "a right answer below the top is not an outcome");
  s = Core.reduce(s, { type: "nextQuestion" }, fixed(0), 1);
  assert.equal(s.rung, 1, "one banked");
  assert.equal(Core.playingRung(s), 2);
  assert.equal(Core.bankedValue(s), 100);
});

test("M-U3 a wrong answer drops to the last safe haven reached", () => {
  // A safe haven only protects you once ITS question has been answered
  // correctly: `correct` right answers, then a slip on question correct + 1.
  const cases = [
    { correct: 0, expect: 0 },      // wrong on question 1
    { correct: 4, expect: 0 },      // wrong on question 5 - the haven is not banked yet
    { correct: 5, expect: 1000 },   // wrong on question 6
    { correct: 9, expect: 1000 },   // wrong on question 10
    { correct: 10, expect: 32000 }, // wrong on question 11
    { correct: 14, expect: 32000 }, // wrong on question 15
  ];
  for (const c of cases) {
    let s = seated();
    while (s.rung < c.correct) s = answerCorrect(s);
    assert.equal(s.rung, c.correct);
    assert.equal(Core.playingRung(s), c.correct + 1);
    const wrongIdx = [0, 1, 2, 3].find((i) => i !== s.question.answer);
    s = run(s, [{ type: "select", idx: wrongIdx }, { type: "lock" }, { type: "reveal" }]);
    assert.equal(s.correct, false);
    assert.equal(s.outcome.reason, "wrong");
    assert.equal(s.outcome.won, c.expect,
      `${c.correct} right then wrong on question ${c.correct + 1} pays ${c.expect}`);
    assert.equal(Core.winningsIfWrong(s), c.expect);
    s = Core.reduce(s, { type: "nextQuestion" }, fixed(0), 1);
    assert.equal(s.phase, "result");
    const row = s.contestants.find((c2) => c2.pid === "p1");
    assert.equal(row.won, c.expect);
    assert.equal(row.rung, c.correct, "the standings record the rung actually reached");
    assert.equal(row.out, true);
  }
});

test("M-U3 the top rung pays the million", () => {
  let s = seated();
  for (let i = 0; i < 14; i += 1) s = answerCorrect(s);
  assert.equal(s.rung, 14, "fourteen banked, question 15 on screen");
  assert.equal(Core.playingRung(s), 15);
  s = run(s, [{ type: "select", idx: s.question.answer }, { type: "lock" }, { type: "reveal" }]);
  assert.equal(s.outcome.won, 1000000);
  assert.equal(s.outcome.reason, "million");
  s = Core.reduce(s, { type: "nextQuestion" }, fixed(0), 1);
  assert.equal(s.phase, "result");
  assert.equal(Core.standings(s)[0].won, 1000000);
});

/* ============================================================
   M-U4 — walking away
   ============================================================ */

test("M-U4 walking away keeps the money banked so far, and only before the lock", () => {
  let s = seated();
  assert.equal(Core.winningsIfWalk(s), 0, "walking on question 1 is worth nothing");
  for (let i = 0; i < 6; i += 1) s = answerCorrect(s);
  assert.equal(s.rung, 6, "six banked, question 7 on screen");
  assert.equal(Core.winningsIfWalk(s), 2000, "the amount for the current rung");

  const afterSelect = Core.reduce(s, { type: "select", idx: 0 }, fixed(0), 1);
  const walked = Core.reduce(afterSelect, { type: "walkAway" }, fixed(0), 1);
  assert.equal(walked.phase, "result");
  assert.equal(walked.outcome.won, 2000);
  assert.equal(walked.outcome.reason, "walk");

  const locked = Core.reduce(afterSelect, { type: "lock" }, fixed(0), 1);
  assert.equal(Core.reduce(locked, { type: "walkAway" }, fixed(0), 1), locked, "no walking after the lock");
});

/* ============================================================
   M-U5 — 50:50
   ============================================================ */

test("M-U5 50:50 removes exactly two wrong options, deterministically, once", () => {
  const s = seated();
  const answer = s.question.answer;
  const a = Core.reduce(s, { type: "useFifty" }, fixed(0), 1);
  assert.equal(a.removed.length, 2);
  assert.ok(!a.removed.includes(answer), "the right answer survives");
  assert.equal(a.lifelines.fifty, false);
  const b = Core.reduce(s, { type: "useFifty" }, fixed(0), 1);
  assert.deepEqual(b.removed, a.removed, "same rng, same pair");
  const c = Core.reduce(s, { type: "useFifty" }, seq(0.99, 0.99, 0.99), 1);
  assert.equal(c.removed.length, 2);
  assert.ok(!c.removed.includes(answer));
  assert.equal(Core.reduce(a, { type: "useFifty" }, fixed(0), 1), a, "only once per contestant");
  // A removed option cannot be selected, and the removals clear a stale pick.
  const picked = Core.reduce(s, { type: "select", idx: a.removed[0] }, fixed(0), 1);
  const cleared = Core.reduce(picked, { type: "useFifty" }, fixed(0), 1);
  assert.equal(cleared.selected, null);
  assert.equal(Core.reduce(cleared, { type: "select", idx: cleared.removed[0] }, fixed(0), 1), cleared);
});

test("M-U5 the lifelines reset for the next contestant", () => {
  let s = seated();
  s = run(s, [{ type: "useFifty" }, { type: "usePhone" }, { type: "phoneDone" }, { type: "walkAway" }]);
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p2" }, { type: "seat", pid: "p2" }]);
  assert.deepEqual(s.lifelines, { fifty: true, phone: true, audience: true, switch: true });
  assert.deepEqual(s.removed, []);
});

/* ============================================================
   M-U6 — Ask the Audience
   ============================================================ */

test("M-U6 audience votes: one per phone, contestant excluded, 100% total", () => {
  let s = seated();
  s = Core.reduce(s, { type: "useAudience" }, fixed(0), 1000);
  assert.equal(s.audience.open, true);
  assert.equal(s.audience.deadline, 1000 + 20000);
  assert.equal(s.lifelines.audience, false);

  s = Core.reduce(s, { type: "audienceVote", pid: "p1", idx: 0 }, fixed(0), 1100);
  assert.deepEqual(s.audience.votes, {}, "the contestant does not vote in their own audience");
  s = Core.reduce(s, { type: "audienceVote", pid: "p2", idx: 1 }, fixed(0), 1100);
  s = Core.reduce(s, { type: "audienceVote", pid: "p2", idx: 3 }, fixed(0), 1200);
  assert.deepEqual(s.audience.votes, { p2: 1 }, "one vote per phone — the first one counts");
  s = Core.reduce(s, { type: "audienceVote", pid: "p3", idx: 1 }, fixed(0), 1200);
  s = Core.reduce(s, { type: "audienceVote", pid: "p4", idx: 2 }, fixed(0), 1300);
  const live = Core.chart(s);
  assert.deepEqual(live.counts, [0, 2, 1, 0]);
  assert.equal(live.pcts.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(live.pcts, [0, 67, 33, 0], "largest-remainder rounding");

  // A vote after the deadline is ignored, and so is a junk index.
  const late = Core.reduce(s, { type: "audienceVote", pid: "p3x", idx: 0 }, fixed(0), 999999);
  assert.equal(late, s);
  assert.equal(Core.reduce(s, { type: "audienceVote", pid: "px", idx: 9 }, fixed(0), 1300), s);

  const closed = Core.reduce(s, { type: "audienceClose" }, fixed(0), 1400);
  assert.equal(closed.audience.open, false);
  assert.deepEqual(closed.audience.chart, [0, 67, 33, 0]);
  const after = Core.reduce(closed, { type: "audienceVote", pid: "p9", idx: 0 }, fixed(0), 1400);
  assert.equal(after, closed, "the chart is frozen once the window closes");
  assert.deepEqual(Core.chart(closed).pcts, [0, 67, 33, 0]);
});

test("M-U6 the host can type the chart instead of using phones", () => {
  let s = Core.reduce(seated(), { type: "useAudience" }, fixed(0), 1000);
  s = Core.reduce(s, { type: "audienceHostChart", pcts: [50, 20, 20, 20] }, fixed(0), 1000);
  assert.deepEqual(Core.chart(s).pcts, [46, 18, 18, 18]);
  assert.equal(Core.chart(s).pcts.reduce((a, b) => a + b, 0), 100);
  assert.equal(Core.chart(s).source, "host");
  const closed = Core.reduce(s, { type: "audienceClose" }, fixed(0), 1000);
  assert.deepEqual(closed.audience.chart, [46, 18, 18, 18]);
  assert.deepEqual(Core.largestRemainder([0, 0, 0, 0]), [0, 0, 0, 0]);
  assert.equal(Core.largestRemainder([1, 1, 1]).reduce((a, b) => a + b, 0), 100);
});

/* ============================================================
   M-U7 — Phone a Friend
   ============================================================ */

test("M-U7 phone a friend runs on an injected clock and only cues", () => {
  let s = seated();
  s = Core.reduce(s, { type: "usePhone" }, fixed(0), 5000);
  assert.equal(s.phone.open, true);
  assert.equal(s.phone.deadline, 5000 + 30000);
  assert.equal(Core.secondsLeft(s.phone.deadline, 5000), 30);
  assert.equal(Core.secondsLeft(s.phone.deadline, 20000), 15);
  assert.equal(Core.secondsLeft(s.phone.deadline, 99000), 0);
  s = Core.reduce(s, { type: "phoneFriend", name: "  Grandma  " }, fixed(0), 6000);
  assert.equal(s.phone.friend, "Grandma");

  // The deadline passing changes nothing on its own: the timer is a cue.
  const later = Core.reduce(s, { type: "select", idx: 1 }, fixed(0), 999999);
  assert.equal(later.selected, 1);
  assert.equal(later.phone.open, true);
  const done = Core.reduce(s, { type: "phoneDone" }, fixed(0), 7000);
  assert.equal(done.phone.open, false);
  assert.equal(done.phone.deadline, null);
  assert.equal(Core.reduce(done, { type: "usePhone" }, fixed(0), 8000), done, "only once");
});

test("M-U7 a zero-second setting means no timer at all", () => {
  const game = buildGame();
  game.settings.phoneSeconds = 0;
  game.settings.audienceSeconds = 0;
  const s = Core.reduce(seated(game), { type: "usePhone" }, fixed(0), 5000);
  assert.equal(s.phone.open, true);
  assert.equal(s.phone.deadline, null);
  const aud = Core.reduce(seated(game), { type: "useAudience" }, fixed(0), 5000);
  assert.equal(aud.audience.deadline, null);
  const voted = Core.reduce(aud, { type: "audienceVote", pid: "p2", idx: 0 }, fixed(0), 9e12);
  assert.deepEqual(voted.audience.votes, { p2: 0 }, "no deadline means the window stays open");
});

/* ============================================================
   M-U8 — Fastest Finger First
   ============================================================ */

test("M-U8 the fastest correct submission wins the hot seat", () => {
  let s = run(state0(), [{ type: "start" }]);
  assert.equal(s.phase, "fff");
  s = Core.reduce(s, { type: "fffOpen" }, fixed(0), 1000);
  assert.equal(s.fff.open, true);
  assert.equal(s.fff.openedAt, 1000);
  const right = s.fff.question.order.slice();
  const wrong = [right[1], right[0], right[2], right[3]];

  s = Core.reduce(s, { type: "fffSubmit", pid: "p3", order: wrong, at: 3200 }, fixed(0), 3200);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: right, at: 2100 }, fixed(0), 3300);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p4", order: right, at: 4000 }, fixed(0), 4000);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: right, at: 4500 }, fixed(0), 4500);
  assert.equal(s.fff.submissions.length, 3, "one submission per phone");
  assert.deepEqual(s.fff.submissions.map((x) => x.pid), ["p2", "p3", "p4"], "sorted by arrival time");

  let rows = Core.fffRows(s);
  assert.deepEqual(rows.map((r) => r.correct), [null, null, null], "correctness is hidden before the reveal");
  assert.deepEqual(rows.map((r) => r.ms), [1100, 2200, 3000]);

  s = Core.reduce(s, { type: "fffReveal" }, fixed(0), 5000);
  assert.equal(s.fff.revealed, true);
  assert.equal(s.fff.open, false);
  assert.equal(s.fff.winner, "p2", "fastest CORRECT wins, not the fastest overall");
  rows = Core.fffRows(s);
  assert.deepEqual(rows.map((r) => r.correct), [true, false, true]);
  assert.equal(Core.fffAnswer(s).length, 4);
  assert.deepEqual(Core.fffAnswer(s).map((r) => r.idx), s.fff.question.order);

  // A phone that never submitted is simply absent.
  assert.equal(rows.some((r) => r.pid === "p1"), false);
  s = Core.reduce(s, { type: "seat", pid: "p2" }, fixed(0), 5100);
  assert.equal(s.phase, "hotseat");
  assert.equal(s.current, "p2");
});

test("M-U8 junk submissions and a nobody-was-right round", () => {
  let s = Core.reduce(run(state0(), [{ type: "start" }]), { type: "fffOpen" }, fixed(0), 1000);
  const bad = [
    { type: "fffSubmit", pid: "p2", order: [0, 1, 2], at: 1100 },
    { type: "fffSubmit", pid: "p2", order: [0, 1, 2, 2], at: 1100 },
    { type: "fffSubmit", pid: "p2", order: "0123", at: 1100 },
    { type: "fffSubmit", pid: "", order: [0, 1, 2, 3], at: 1100 },
    { type: "fffSubmit", pid: "nobody", order: [0, 1, 2, 3], at: 1100 },
  ];
  bad.forEach((ev) => { assert.equal(Core.reduce(s, ev, fixed(0), 1100), s, JSON.stringify(ev)); });

  const wrong = s.fff.question.order.slice().reverse();
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: wrong, at: 1200 }, fixed(0), 1200);
  s = Core.reduce(s, { type: "fffReveal" }, fixed(0), 2000);
  assert.equal(s.fff.winner, null);
  assert.match(s.notice, /Nobody/);
  assert.equal(Core.reduce(s, { type: "seat", pid: "p9" }, fixed(0), 2100), s, "seat only takes a contestant");
  // The host picks by hand instead.
  s = Core.reduce(s, { type: "fffPick", pid: "p4" }, fixed(0), 2100);
  assert.equal(s.fff.winner, "p4");
  s = Core.reduce(s, { type: "seat", pid: "p4" }, fixed(0), 2200);
  assert.equal(s.current, "p4");
});

test("M-U8 without Fastest Finger the host picks straight from the roster", () => {
  const game = buildGame();
  game.settings.fastestFinger = false;
  const s = run(state0(game), [{ type: "start" }]);
  assert.equal(s.phase, "pick");
  const seatedState = Core.reduce(s, { type: "seat", pid: "p3" }, fixed(0), 1);
  assert.equal(seatedState.phase, "hotseat");
  assert.equal(seatedState.current, "p3");
  // Somebody who has already played cannot be seated again.
  const done = run(seatedState, [{ type: "walkAway" }, { type: "nextContestant" }]);
  assert.equal(done.phase, "pick");
  assert.equal(Core.reduce(done, { type: "seat", pid: "p3" }, fixed(0), 1), done);
  assert.deepEqual(Core.waitingContestants(done).map((c) => c.pid), ["p1", "p2", "p4"]);
});

/* ============================================================
   M-U9 — undo, illegal events, immutability
   ============================================================ */

test("M-U9 undo restores the previous state exactly", () => {
  let s = seated();
  const before = JSON.parse(JSON.stringify(s));
  s = run(s, [{ type: "select", idx: 1 }, { type: "lock" }]);
  assert.equal(s.locked, true);
  s = Core.reduce(s, { type: "undo" }, fixed(0), 1);
  assert.equal(s.locked, false);
  assert.equal(s.selected, 1);
  s = Core.reduce(s, { type: "undo" }, fixed(0), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), before, "two undos land exactly on the seated state");
  const empty = Core.createState(buildGame(), PLAYERS, {});
  assert.equal(Core.reduce(empty, { type: "undo" }, fixed(0), 1), empty, "undo with no history is a no-op");
});

test("M-U9 undo unwinds a whole question, including a wrong reveal", () => {
  let s = seated();
  s = answerCorrect(s);
  const atTwo = JSON.parse(JSON.stringify(s));
  const wrongIdx = [0, 1, 2, 3].find((i) => i !== s.question.answer);
  s = run(s, [{ type: "select", idx: wrongIdx }, { type: "lock" }, { type: "reveal" }, { type: "nextQuestion" }]);
  assert.equal(s.phase, "result");
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "undo" }, fixed(0), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), atTwo);
});

test("M-U9 illegal events are ignored (table-driven)", () => {
  const fresh = state0();
  const hot = seated();
  const table = [
    [fresh, { type: "select", idx: 0 }, "select before the game starts"],
    [fresh, { type: "lock" }, "lock before the game starts"],
    [fresh, { type: "reveal" }, "reveal before the game starts"],
    [fresh, { type: "seat", pid: "p1" }, "seat from setup"],
    [fresh, { type: "nextQuestion" }, "next question from setup"],
    [fresh, { type: "audienceVote", pid: "p2", idx: 0 }, "vote with no window"],
    [fresh, { type: "fffOpen" }, "fastest finger before the start"],
    [hot, { type: "lock" }, "lock with nothing selected"],
    [hot, { type: "reveal" }, "reveal before the lock"],
    [hot, { type: "select", idx: 4 }, "select D+1"],
    [hot, { type: "select", idx: -1 }, "select a negative option"],
    [hot, { type: "select", idx: "0" }, "select a string"],
    [hot, { type: "nextQuestion" }, "next question before the reveal"],
    [hot, { type: "nextContestant" }, "next contestant mid-question"],
    [hot, { type: "fffSubmit", pid: "p2", order: [0, 1, 2, 3], at: 1 }, "fastest finger in the hot seat"],
    [hot, { type: "phoneDone" }, "close a phone window that is not open"],
    [hot, { type: "audienceClose" }, "close an audience window that is not open"],
    [hot, { type: "request", pid: "p2", which: "fifty" }, "a request from someone else's phone"],
    [hot, { type: "request", pid: "p1", which: "nonsense" }, "a request for a lifeline that does not exist"],
    [hot, { type: "nope" }, "an unknown event"],
    [hot, {}, "an event with no type"],
    [hot, null, "a null event"],
    [hot, "select", "a string event"],
  ];
  table.forEach(([state, event, label]) => {
    assert.equal(Core.reduce(state, event, fixed(0), 1), state, label);
  });
});

test("M-U9 the reducer never mutates its inputs", () => {
  const deepFreeze = (obj, seen = new Set()) => {
    if (!obj || typeof obj !== "object" || seen.has(obj)) return obj;
    seen.add(obj);
    Object.values(obj).forEach((v) => deepFreeze(v, seen));
    return Object.freeze(obj);
  };
  const events = [
    { type: "select", idx: 0 }, { type: "useFifty" }, { type: "useAudience" },
    { type: "audienceVote", pid: "p2", idx: 0 }, { type: "audienceClose" },
    { type: "usePhone" }, { type: "phoneFriend", name: "Sam" }, { type: "phoneDone" },
    { type: "useSwitch" }, { type: "lock" }, { type: "reveal" }, { type: "nextQuestion" },
    { type: "undo" }, { type: "walkAway" }, { type: "finish" },
  ];
  let s = deepFreeze(seated());
  events.forEach((ev) => {
    s = deepFreeze(Core.reduce(s, ev, fixed(0.5), 2000));
    assert.ok(s && typeof s === "object");
  });
  assert.equal(s.phase, "standings");
});

test("M-U9 legalActions tracks what the host may do", () => {
  const hot = seated();
  assert.ok(Core.legalActions(hot).includes("select"));
  assert.ok(Core.legalActions(hot).includes("useFifty"));
  assert.ok(Core.legalActions(hot).includes("walkAway"));
  assert.ok(!Core.legalActions(hot).includes("reveal"));
  const locked = run(hot, [{ type: "select", idx: 0 }, { type: "lock" }]);
  assert.ok(Core.legalActions(locked).includes("reveal"));
  assert.ok(!Core.legalActions(locked).includes("walkAway"));
  assert.ok(Core.legalActions(locked).includes("undo"));
});

/* ============================================================
   M-U10 — the phone surface
   ============================================================ */

test("M-U10 validatePhoneMsg keeps only well-formed intents", () => {
  const ok = [
    [{ t: "fff", order: [1, 0, 3, 2] }, { t: "fff", order: [1, 0, 3, 2] }],
    [{ t: "answer", idx: 2 }, { t: "answer", idx: 2 }],
    [{ t: "vote", idx: 0 }, { t: "vote", idx: 0 }],
    [{ t: "walk" }, { t: "walk" }],
    [{ t: "lifeline", which: "audience" }, { t: "lifeline", which: "audience" }],
  ];
  ok.forEach(([input, want]) => assert.deepEqual(Core.validatePhoneMsg(input), want));
  const junk = [
    null, undefined, 42, "vote", [], {}, { t: 7 },
    { t: "answer", idx: 4 }, { t: "answer", idx: "1" }, { t: "answer" },
    { t: "vote", idx: -1 }, { t: "fff", order: [0, 1, 2] }, { t: "fff", order: [0, 0, 1, 2] },
    { t: "lifeline", which: "extra" }, { t: "lifeline" }, { t: "unknown" },
  ];
  junk.forEach((input) => assert.equal(Core.validatePhoneMsg(input), null, JSON.stringify(input)));
  // The copy is narrow: nothing else rides along.
  const copy = Core.validatePhoneMsg({ t: "vote", idx: 1, evil: "<script>" });
  assert.deepEqual(Object.keys(copy), ["t", "idx"]);
});

test("M-U10 phoneView never leaks the answer and never mis-seats a phone", () => {
  let s = seated();
  const contestant = Core.phoneView(s, "p1");
  assert.equal(contestant.screen, "hotseat");
  assert.equal(contestant.options.length, 4);
  ["p2", "p3", "p4", "stranger"].forEach((pid) => {
    assert.equal(Core.phoneView(s, pid).screen, "wait", `${pid} is not in the hot seat`);
  });
  const hasAnswer = (v) => JSON.stringify(v).includes("\"answer\"");
  assert.equal(hasAnswer(contestant), false);

  s = Core.reduce(s, { type: "useAudience" }, fixed(0), 1000);
  const voter = Core.phoneView(s, "p2");
  assert.equal(voter.screen, "vote");
  assert.equal(hasAnswer(voter), false, "the vote screen has no answer field");
  assert.equal(voter.myVote, null);
  assert.equal(Core.phoneView(s, "p1").screen, "hotseat", "the contestant never gets a ballot");
  const voted = Core.reduce(s, { type: "audienceVote", pid: "p2", idx: 3 }, fixed(0), 1100);
  assert.equal(Core.phoneView(voted, "p2").myVote, 3);
  assert.equal(Core.phoneView(voted, "p3").myVote, null, "a phone only ever learns its own vote");

  const wrongIdx = [0, 1, 2, 3].find((i) => i !== s.question.answer);
  const locked = run(s, [{ type: "audienceClose" }, { type: "select", idx: wrongIdx }, { type: "lock" }]);
  assert.equal(Core.phoneView(locked, "p1").screen, "locked");
  assert.equal(hasAnswer(Core.phoneView(locked, "p1")), false);

  const done = Core.reduce(locked, { type: "reveal" }, fixed(0), 1);
  const ended = Core.reduce(done, { type: "nextQuestion" }, fixed(0), 1);
  assert.equal(Core.phoneView(ended, "p1").screen, "result");
  assert.ok(Core.phoneView(ended, "p1").standings.length === 4);
  assert.equal(hasAnswer(Core.phoneView(ended, "p1")), false);
});

test("M-U10 the Fastest Finger phone screen hides the order and closes on submit", () => {
  let s = Core.reduce(run(state0(), [{ type: "start" }]), { type: "fffOpen" }, fixed(0), 1000);
  const view = Core.phoneView(s, "p2");
  assert.equal(view.screen, "fff");
  assert.equal(view.options.length, 4);
  assert.equal(JSON.stringify(view).includes("\"order\""), false, "the phone never receives the answer order");
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: [0, 1, 2, 3], at: 1100 }, fixed(0), 1100);
  assert.equal(Core.phoneView(s, "p2").screen, "wait");
  assert.equal(Core.phoneView(s, "p3").screen, "fff");
  // Somebody who already had their turn does not get to play again.
  const played = run(seated(), [{ type: "walkAway" }, { type: "nextContestant" }, { type: "fffOpen" }]);
  assert.equal(Core.phoneView(played, "p1").screen, "wait");
  assert.equal(Core.phoneView(played, "p2").screen, "fff");
});

/* ============================================================
   Extras: switch the question, requests, standings, money view
   ============================================================ */

test("switch the question swaps in an unused question of the same level", () => {
  let s = seated();
  const first = s.question.id;
  const level = s.question.level;
  s = Core.reduce(s, { type: "useSwitch" }, fixed(0.9), 1);
  assert.notEqual(s.question.id, first);
  assert.equal(s.question.level, level);
  assert.equal(s.lifelines.switch, false);
  assert.ok(s.used.includes(first) && s.used.includes(s.question.id));
  assert.equal(Core.reduce(s, { type: "useSwitch" }, fixed(0), 1), s, "only once");
});

test("a phone request waits for the host and never acts on its own", () => {
  let s = seated();
  s = Core.reduce(s, { type: "request", pid: "p1", which: "fifty" }, fixed(0), 700);
  assert.deepEqual(s.request, { pid: "p1", which: "fifty", at: 700 });
  assert.equal(s.lifelines.fifty, true, "the lifeline is untouched until the host confirms");
  assert.deepEqual(s.removed, []);
  assert.equal(Core.phoneView(s, "p1").request, "fifty");
  s = Core.reduce(s, { type: "useFifty" }, fixed(0), 800);
  assert.equal(s.request, null, "confirming clears the request");
  const walk = Core.reduce(s, { type: "request", pid: "p1", which: "walk" }, fixed(0), 900);
  assert.equal(walk.request.which, "walk");
  assert.equal(walk.phase, "hotseat", "a walk request does not end the game");
  assert.equal(Core.reduce(walk, { type: "clearRequest" }, fixed(0), 1000).request, null);
});

test("standings rank the contestants who have played", () => {
  let s = seated();
  for (let i = 0; i < 3; i += 1) s = answerCorrect(s);          // p1 banks 300
  s = Core.reduce(s, { type: "walkAway" }, fixed(0), 1);
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p2" }, { type: "seat", pid: "p2" }]);
  for (let i = 0; i < 6; i += 1) s = answerCorrect(s);          // p2 banks 2000
  s = Core.reduce(s, { type: "walkAway" }, fixed(0), 1);
  const table = Core.standings(s);
  assert.deepEqual(table.slice(0, 2).map((r) => [r.name, r.won]), [["Ben", 2000], ["Ada", 300]]);
  assert.deepEqual(table.slice(2).map((r) => r.out), [false, false]);
  s = Core.reduce(s, { type: "finish" }, fixed(0), 1);
  assert.equal(s.phase, "standings");
});

test("ending the night banks the contestant who is still playing", () => {
  let s = seated();
  for (let i = 0; i < 7; i += 1) s = answerCorrect(s);      // 7 banked = 4,000
  assert.equal(Core.winningsIfWalk(s), 4000);
  const ended = Core.reduce(s, { type: "finish" }, fixed(0), 1);
  assert.equal(ended.phase, "standings");
  const row = ended.contestants.find((c) => c.pid === "p1");
  assert.deepEqual([row.won, row.rung, row.out], [4000, 7, true],
    "banked at exactly the walk-away amount, not zero");
  assert.equal(ended.outcome.reason, "walk");

  // A revealed answer that already has an outcome is banked at THAT amount.
  const wrongIdx = [0, 1, 2, 3].find((i) => i !== s.question.answer);
  const revealed = run(s, [{ type: "select", idx: wrongIdx }, { type: "lock" }, { type: "reveal" }]);
  const stopped = Core.reduce(revealed, { type: "finish" }, fixed(0), 1);
  assert.equal(stopped.contestants.find((c) => c.pid === "p1").won, 1000, "the safe haven, not the walk-away");

  // Ending from the picking screen simply shows the standings.
  const picking = run(state0(), [{ type: "start" }]);
  const done = Core.reduce(picking, { type: "finish" }, fixed(0), 1);
  assert.equal(done.phase, "standings");
  assert.equal(done.contestants.every((c) => !c.out), true);
  // Undo puts the night back.
  assert.equal(Core.reduce(ended, { type: "undo" }, fixed(0), 1).phase, "hotseat");
});

test("the money tree view lights the current rung and marks safe havens", () => {
  let s = seated();
  s = answerCorrect(s);
  const rows = Core.moneyTreeView(s);
  assert.equal(rows.length, 15);
  assert.equal(rows[0].rung, 15, "the top rung is drawn first");
  assert.equal(rows[0].label, "$1,000,000");
  const current = rows.find((r) => r.current);
  assert.equal(current.rung, 2, "one banked, so question 2 is lit");
  assert.deepEqual(rows.filter((r) => r.safe).map((r) => r.rung), [10, 5]);
  assert.equal(rows.filter((r) => r.won).length, 1);
  assert.equal(Core.formatMoney(s, 32000), "$32,000");
});

test("createState rejects a roster it cannot play with", () => {
  assert.throws(() => Core.createState(buildGame(), [], {}), /at least one contestant/);
  assert.throws(() => Core.createState(buildGame(), null, {}), /contestant list/);
  const many = Array.from({ length: 17 }, (_, i) => ({ pid: `p${i}`, name: `P${i}` }));
  assert.throws(() => Core.createState(buildGame(), many, {}), /at most 16/);
  const messy = Core.createState(buildGame(), [
    { pid: "p1", name: "Ada" }, { pid: "p1", name: "Twin" }, { pid: "", name: "Nameless" },
    { pid: "p2", name: "" }, null, { pid: "p3", name: "  Cleo  " },
  ], {});
  assert.deepEqual(messy.contestants.map((c) => c.name), ["Ada", "Cleo"]);
});
