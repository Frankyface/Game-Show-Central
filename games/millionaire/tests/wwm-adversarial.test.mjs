/* ============================================================
   Millionaire — ADVERSARIAL suite (independent tester)
   Written against docs/08-millionaire-spec.md by someone who did
   not write games/millionaire/js/**. Everything here tries to
   break the pure core: odd money trees, every safe-haven
   boundary, lifelines used twice or out of order, hostile phone
   payloads, exhausted question pools, and deep-frozen state.
   Zero dependencies: `node --test` from games/millionaire.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/wwm-core.js");
const SHIPPED = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));

/* ============ Fixtures ============ */

const fixed = (v) => () => v;
const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
  { pid: "p4", name: "Dev" },
];

/**
 * A game with `perLevel` questions on each rung of `tree`, and the given
 * safe havens. Every option string is unique across the whole file so a
 * repeat is easy to spot.
 */
function makeGame(opts = {}) {
  const tree = opts.moneyTree || Core.DEFAULT_MONEY_TREE.slice();
  const perLevel = opts.perLevel === undefined ? 3 : opts.perLevel;
  const questions = [];
  for (let level = 1; level <= tree.length; level += 1) {
    for (let n = 0; n < perLevel; n += 1) {
      questions.push({
        level,
        category: "Test",
        q: `Rung ${level} question ${n + 1}?`,
        options: [`r${level}n${n}A`, `r${level}n${n}B`, `r${level}n${n}C`, `r${level}n${n}D`],
        answer: n % 4,
      });
    }
  }
  // A 15-question minimum applies whatever the tree length is.
  while (questions.length < 15) {
    const n = questions.length;
    questions.push({
      level: tree.length,
      category: "Filler",
      q: `Filler ${n}?`,
      options: [`f${n}A`, `f${n}B`, `f${n}C`, `f${n}D`],
      answer: 0,
    });
  }
  return {
    title: "Adversarial",
    settings: {
      currency: opts.currency || "$",
      moneyTree: tree,
      safeHavens: opts.safeHavens === undefined ? [5, 10] : opts.safeHavens,
      lifelines: opts.lifelines || { fifty: true, phone: true, audience: true, switch: true },
      phoneSeconds: opts.phoneSeconds === undefined ? 30 : opts.phoneSeconds,
      audienceSeconds: opts.audienceSeconds === undefined ? 20 : opts.audienceSeconds,
      fastestFinger: opts.fastestFinger !== false,
    },
    questions,
    fastestFinger: opts.fff || [
      { q: "Order these.", options: ["W", "X", "Y", "Z"], order: [1, 0, 3, 2] },
      { q: "And these.", options: ["Aa", "Bb", "Cc", "Dd"], order: [3, 2, 1, 0] },
    ],
  };
}

function run(state, events, rng = fixed(0), now = 1000) {
  return events.reduce((s, ev) => Core.reduce(s, ev, rng, now), state);
}

/** p1 in the hot seat facing question 1. */
function seated(game = makeGame(), pid = "p1") {
  return run(Core.createState(game, PLAYERS, {}), [
    { type: "start" }, { type: "fffPick", pid }, { type: "seat", pid },
  ]);
}

function answerCorrect(state, rng = fixed(0)) {
  return run(state, [
    { type: "select", idx: state.question.answer },
    { type: "lock" }, { type: "reveal" }, { type: "nextQuestion" },
  ], rng);
}

function answerWrong(state) {
  const idx = [0, 1, 2, 3].find((i) => i !== state.question.answer);
  return run(state, [{ type: "select", idx }, { type: "lock" }, { type: "reveal" }]);
}

/* ============================================================
   A1 — safe havens at EVERY rung boundary, on custom trees
   ============================================================ */

test("A1 every rung boundary pays the last haven whose question was answered", () => {
  // A 15-rung tree with havens at 5 and 10 (the shipped shape): walk through
  // all fifteen boundaries rather than the six the implementer sampled.
  const game = makeGame();
  const expected = [0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 32000, 32000, 32000, 32000, 32000];
  let s = seated(game);
  for (let correct = 0; correct < 15; correct += 1) {
    assert.equal(s.rung, correct);
    assert.equal(Core.playingRung(s), correct + 1);
    assert.equal(Core.winningsIfWrong(s), expected[correct],
      `${correct} right, then wrong on question ${correct + 1}`);
    const slipped = answerWrong(s);
    assert.equal(slipped.outcome.won, expected[correct]);
    assert.equal(slipped.outcome.reason, "wrong");
    s = answerCorrect(s);
  }
});

test("A1 a custom tree with a haven on rung 1 protects from the very first answer", () => {
  const game = makeGame({ moneyTree: [5, 10, 20, 40, 80], safeHavens: [1, 3, 5], perLevel: 3 });
  let s = seated(game);
  assert.equal(Core.rungCount(s), 5);
  const expect = [0, 5, 5, 20, 20];       // wrong on q1..q5 after 0..4 right
  for (let correct = 0; correct < 5; correct += 1) {
    assert.equal(Core.winningsIfWrong(s), expect[correct], `wrong on question ${correct + 1}`);
    assert.equal(Core.winningsIfWalk(s), correct === 0 ? 0 : game.settings.moneyTree[correct - 1]);
    s = answerCorrect(s);
  }
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.reason, "million", "a five-rung tree still has a top prize");
  assert.equal(s.outcome.won, 80);
});

test("A1 a tree with no safe havens at all always pays nothing for a slip", () => {
  const game = makeGame({ moneyTree: [1, 2, 3, 4, 5, 6], safeHavens: [], perLevel: 3 });
  let s = seated(game);
  for (let correct = 0; correct < 6; correct += 1) {
    assert.equal(Core.winningsIfWrong(s), 0, `no haven, ${correct} right`);
    if (correct < 5) s = answerCorrect(s);
  }
});

test("A1 a haven on the TOP rung is unreachable by a wrong answer", () => {
  // Reaching rung 15 ends the game, so a haven there can never pay out for a
  // slip — it may only ever be the walk-away amount. Documents the maths.
  const game = makeGame({ safeHavens: [15] });
  let s = seated(game);
  for (let i = 0; i < 14; i += 1) {
    assert.equal(Core.winningsIfWrong(s), 0);
    s = answerCorrect(s);
  }
  assert.equal(Core.winningsIfWrong(s), 0, "fourteen right, question 15 — still nothing banked by a haven");
});

/* ============================================================
   A2 — walking away
   ============================================================ */

test("A2 walking away is refused after the lock and after the reveal", () => {
  let s = seated();
  s = answerCorrect(s);
  s = answerCorrect(s);
  assert.equal(Core.winningsIfWalk(s), 200);
  const picked = Core.reduce(s, { type: "select", idx: 0 }, fixed(0), 1);
  const locked = Core.reduce(picked, { type: "lock" }, fixed(0), 1);
  assert.equal(Core.reduce(locked, { type: "walkAway" }, fixed(0), 1), locked, "no walk after lock");
  assert.ok(!Core.legalActions(locked).includes("walkAway"));

  const revealed = Core.reduce(locked, { type: "reveal" }, fixed(0), 1);
  assert.equal(Core.reduce(revealed, { type: "walkAway" }, fixed(0), 1), revealed, "no walk after reveal");

  // …and a phone's walk REQUEST after the lock can never be honoured either:
  // the request may be recorded, but confirming it is still a no-op.
  const asked = Core.reduce(locked, { type: "request", pid: "p1", which: "walk" }, fixed(0), 1);
  assert.equal(Core.reduce(asked, { type: "walkAway" }, fixed(0), 1), asked);
  assert.equal(asked.phase, "hotseat");
});

test("A2 walking away from the very first question banks nothing but still ends the turn", () => {
  const s = Core.reduce(seated(), { type: "walkAway" }, fixed(0), 1);
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.won, 0);
  assert.equal(s.contestants.find((c) => c.pid === "p1").out, true);
});

/* ============================================================
   A3 — 50:50 and the other lifelines
   ============================================================ */

test("A3 50:50 twice is a no-op and never restores an option", () => {
  const s = seated();
  const once = Core.reduce(s, { type: "useFifty" }, fixed(0.4), 1);
  const twice = Core.reduce(once, { type: "useFifty" }, fixed(0.9), 2);
  assert.equal(twice, once, "the second 50:50 changes nothing at all");
  assert.deepEqual(twice.removed, once.removed);
  assert.equal(twice.lifelines.fifty, false);
  assert.ok(!Core.legalActions(once).includes("useFifty"));
});

test("A3 after 50:50 only the two survivors can be answered, and one is right", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const s = seated();
    const answer = s.question.answer;
    const cut = Core.reduce(s, { type: "useFifty" }, fixed(r), 1);
    assert.equal(cut.removed.length, 2, `rng ${r}`);
    assert.ok(!cut.removed.includes(answer), `rng ${r} keeps the right answer`);
    const left = [0, 1, 2, 3].filter((i) => !cut.removed.includes(i));
    assert.equal(left.length, 2);
    assert.ok(left.includes(answer));
    // Answering a survivor works; answering a removed one does not.
    const other = left.find((i) => i !== answer);
    const good = run(cut, [{ type: "select", idx: answer }, { type: "lock" }, { type: "reveal" }]);
    assert.equal(good.correct, true);
    const bad = run(cut, [{ type: "select", idx: other }, { type: "lock" }, { type: "reveal" }]);
    assert.equal(bad.correct, false);
    assert.equal(Core.reduce(cut, { type: "select", idx: cut.removed[0] }, fixed(0), 1), cut);
    assert.equal(Core.reduce(cut, { type: "select", idx: cut.removed[1] }, fixed(0), 1), cut);
  }
});

test("A3 every lifeline is refused once the answer is locked", () => {
  const locked = run(seated(), [{ type: "select", idx: 0 }, { type: "lock" }]);
  ["useFifty", "usePhone", "useAudience", "useSwitch"].forEach((type) => {
    assert.equal(Core.reduce(locked, { type }, fixed(0), 1), locked, type);
  });
});

test("A3 Switch the Question says so when the rung has nothing else", () => {
  const game = makeGame({ perLevel: 1 });
  const s = seated(game);
  const said = Core.reduce(s, { type: "useSwitch" }, fixed(0), 1);
  // D3: a silent no-op looked like a broken button, so the host is now told.
  assert.equal(said.notice, Core.SWITCH_UNAVAILABLE, "the host is told why");
  assert.match(said.notice, /lifeline is still yours/);
  assert.equal(said.lifelines.switch, true, "and the lifeline is NOT burned");
  assert.equal(said.question, s.question, "the question itself is untouched");
  assert.deepEqual(said.used, s.used, "and nothing is marked as seen");
  assert.ok(Core.legalActions(s).includes("useSwitch"), "the badge is live so the host can be told");
  // Saying it twice is not a second undo step, and then the badge goes dark.
  assert.equal(Core.reduce(said, { type: "useSwitch" }, fixed(0), 1), said);
  assert.ok(!Core.legalActions(said).includes("useSwitch"));
});

test("A3 Switch the Question keeps the level and burns the lifeline once", () => {
  const s = seated();
  const first = s.question;
  const sw = Core.reduce(s, { type: "useSwitch" }, fixed(0.9), 1);
  assert.notEqual(sw.question.id, first.id);
  assert.equal(sw.question.level, first.level);
  assert.deepEqual(sw.removed, [], "a switch clears a 50:50 from the old question");
  assert.equal(sw.selected, null);
  assert.equal(Core.reduce(sw, { type: "useSwitch" }, fixed(0.9), 1), sw);
  // Both questions are burned, so nobody sees the old one again.
  assert.ok(sw.used.includes(first.id) && sw.used.includes(sw.question.id));
});

test("A3 Phone a Friend's clock expiring changes nothing — it is a cue", () => {
  const s = Core.reduce(seated(), { type: "usePhone" }, fixed(0), 10000);
  assert.equal(s.phone.deadline, 40000);
  assert.equal(Core.secondsLeft(s.phone.deadline, 10000), 30);
  assert.equal(Core.secondsLeft(s.phone.deadline, 40001), 0);
  assert.equal(Core.secondsLeft(s.phone.deadline, 9e15), 0, "never goes negative");
  // Long past the deadline the contestant can still answer and still win.
  const late = run(s, [
    { type: "select", idx: s.question.answer }, { type: "lock" }, { type: "reveal" },
  ], fixed(0), 9e12);
  assert.equal(late.correct, true);
  assert.equal(late.phone.open, false, "locking closes the overlay");
  // A second Phone a Friend, before or after Done, is refused.
  assert.equal(Core.reduce(s, { type: "usePhone" }, fixed(0), 50000), s);
});

test("A3 undo unwinds a lifeline exactly, including across two of them", () => {
  const base = seated();
  const withFifty = Core.reduce(base, { type: "useFifty" }, fixed(0.3), 1);
  const withAudience = Core.reduce(withFifty, { type: "useAudience" }, fixed(0), 2000);
  const voted = Core.reduce(withAudience, { type: "audienceVote", pid: "p2", idx: 0 }, fixed(0), 2100);
  const closed = Core.reduce(voted, { type: "audienceClose" }, fixed(0), 2200);
  assert.deepEqual(closed.lifelines, { fifty: false, phone: true, audience: false, switch: true });

  let back = Core.reduce(closed, { type: "undo" }, fixed(0), 3);      // undo the close
  assert.equal(back.audience.open, true);
  assert.deepEqual(back.audience.votes, { p2: 0 }, "votes take no undo step of their own");
  back = Core.reduce(back, { type: "undo" }, fixed(0), 3);            // undo Ask the Audience
  assert.equal(back.lifelines.audience, true);
  assert.equal(back.audience.open, false);
  assert.deepEqual(back.removed, withFifty.removed, "the 50:50 is still spent");
  back = Core.reduce(back, { type: "undo" }, fixed(0), 3);            // undo the 50:50
  assert.equal(back.lifelines.fifty, true);
  assert.deepEqual(back.removed, []);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(base)),
    "three undos land exactly on the seated state");
});

/* ============================================================
   A4 — Ask the Audience
   ============================================================ */

test("A4 the contestant can never vote in their own audience, by any route", () => {
  const s = Core.reduce(seated(), { type: "useAudience" }, fixed(0), 1000);
  const tried = Core.reduce(s, { type: "audienceVote", pid: "p1", idx: 2 }, fixed(0), 1100);
  assert.equal(tried, s, "the reducer drops it");
  assert.deepEqual(Core.chart(s).counts, [0, 0, 0, 0]);
  // Even with padding/whitespace around the pid — cleanText must not open a hole.
  assert.equal(Core.reduce(s, { type: "audienceVote", pid: "  p1  ", idx: 2 }, fixed(0), 1100), s);
  // …and the contestant's phone is never even offered a ballot.
  assert.equal(Core.phoneView(s, "p1").screen, "hotseat");
  assert.equal(Core.phoneView(s, "p2").screen, "vote");
});

test("A4 votes after the close, after the deadline and on removed options are dropped", () => {
  let s = Core.reduce(seated(), { type: "useAudience" }, fixed(0), 1000);
  s = Core.reduce(s, { type: "useFifty" }, fixed(0), 1000);
  const gone = s.removed[0];
  assert.equal(Core.reduce(s, { type: "audienceVote", pid: "p2", idx: gone }, fixed(0), 1100), s,
    "nobody may vote for an option 50:50 took away");
  s = Core.reduce(s, { type: "audienceVote", pid: "p2", idx: s.question.answer }, fixed(0), 1100);
  assert.equal(Core.chart(s).total, 1);
  assert.equal(Core.reduce(s, { type: "audienceVote", pid: "p3", idx: 0 }, fixed(0), 21001), s,
    "one millisecond past the deadline is too late");

  const closed = Core.reduce(s, { type: "audienceClose" }, fixed(0), 5000);
  const frozen = Core.chart(closed).pcts.slice();
  assert.equal(Core.reduce(closed, { type: "audienceVote", pid: "p3", idx: 1 }, fixed(0), 5001), closed);
  assert.equal(Core.reduce(closed, { type: "audienceHostChart", pcts: [25, 25, 25, 25] }, fixed(0), 5001),
    closed, "the host cannot retype a closed chart either");
  assert.deepEqual(Core.chart(closed).pcts, frozen);
  assert.equal(Core.reduce(closed, { type: "audienceClose" }, fixed(0), 5002), closed);
});

test("A4 an even three-way split still sums to exactly 100", () => {
  let s = Core.reduce(seated(), { type: "useAudience" }, fixed(0), 1000);
  ["p2", "p3", "p4"].forEach((pid, i) => {
    s = Core.reduce(s, { type: "audienceVote", pid, idx: i }, fixed(0), 1100 + i);
  });
  const data = Core.chart(s);
  assert.deepEqual(data.counts, [1, 1, 1, 0]);
  assert.deepEqual(data.pcts, [34, 33, 33, 0], "largest remainder, ties to the earlier option");
  assert.equal(data.pcts.reduce((a, b) => a + b, 0), 100);
  // The host typing 33/33/33 gets the same treatment.
  const typed = Core.reduce(s, { type: "audienceHostChart", pcts: [33, 33, 33, 0] }, fixed(0), 1200);
  assert.equal(Core.chart(typed).pcts.reduce((a, b) => a + b, 0), 100);
  // Junk in the host's boxes cannot produce a chart that does not add up.
  [[-5, 10, 10, 10], [NaN, 1, 1, 1], ["7", 1, 1, 1], [1e9, 1, 1, 1], []].forEach((pcts) => {
    const out = Core.reduce(s, { type: "audienceHostChart", pcts }, fixed(0), 1200);
    const sum = Core.chart(out).pcts.reduce((a, b) => a + b, 0);
    assert.ok(sum === 100 || sum === 0, `pcts ${JSON.stringify(pcts)} summed to ${sum}`);
    assert.equal(Core.chart(out).pcts.length, 4);
  });
});

/* ============================================================
   A5 — Fastest Finger First
   ============================================================ */

test("A5 identical arrival times keep the order they were logged in", () => {
  let s = Core.reduce(run(Core.createState(makeGame(), PLAYERS, {}), [{ type: "start" }]),
    { type: "fffOpen" }, fixed(0), 1000);
  const right = s.fff.question.order.slice();
  const wrong = [right[1], right[0], right[2], right[3]];
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: wrong, at: 2000 }, fixed(0), 2000);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p3", order: right, at: 2000 }, fixed(0), 2000);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p4", order: right, at: 2000 }, fixed(0), 2000);
  assert.deepEqual(s.fff.submissions.map((x) => x.pid), ["p2", "p3", "p4"], "stable on a tie");
  s = Core.reduce(s, { type: "fffReveal" }, fixed(0), 3000);
  assert.equal(s.fff.winner, "p3", "the first CORRECT arrival wins a tie");
  assert.deepEqual(Core.fffRows(s).map((r) => r.ms), [1000, 1000, 1000]);
});

test("A5 a submission from somebody who is not a contestant is dropped", () => {
  let s = Core.reduce(run(Core.createState(makeGame(), PLAYERS, {}), [{ type: "start" }]),
    { type: "fffOpen" }, fixed(0), 1000);
  const right = s.fff.question.order.slice();
  const strangers = ["p9", "spectator", "", "   ", "P1", "p1x", "p 1"];
  strangers.forEach((pid) => {
    assert.equal(Core.reduce(s, { type: "fffSubmit", pid, order: right, at: 1100 }, fixed(0), 1100), s,
      `"${pid}" is not on the roster`);
  });
  // A padded pid is trimmed (pids come from the room, not the phone), but the
  // trimmed pid must then still be a real contestant, and it must only count
  // once however it was spelled.
  const trimmed = Core.reduce(s, { type: "fffSubmit", pid: " p1 ", order: right, at: 1100 }, fixed(0), 1100);
  assert.equal(trimmed.fff.submissions.length, 1);
  assert.equal(trimmed.fff.submissions[0].pid, "p1");
  assert.equal(Core.reduce(trimmed, { type: "fffSubmit", pid: "p1", order: right, at: 1200 }, fixed(0), 1200),
    trimmed, "one submission per contestant, however the pid is spelled");
  // A contestant who has already played gets no second Fastest Finger.
  const played = run(seated(), [{ type: "walkAway" }, { type: "nextContestant" }, { type: "fffOpen" }]);
  assert.equal(Core.reduce(played, { type: "fffSubmit", pid: "p1", order: [0, 1, 2, 3], at: 1 }, fixed(0), 1),
    played);
});

test("A5 submissions are refused once the order has been revealed", () => {
  let s = Core.reduce(run(Core.createState(makeGame(), PLAYERS, {}), [{ type: "start" }]),
    { type: "fffOpen" }, fixed(0), 1000);
  const right = s.fff.question.order.slice();
  s = Core.reduce(s, { type: "fffReveal" }, fixed(0), 2000);
  assert.equal(Core.reduce(s, { type: "fffSubmit", pid: "p2", order: right, at: 2100 }, fixed(0), 2100), s);
  assert.equal(s.fff.winner, null);
  assert.equal(Core.reduce(s, { type: "fffReveal" }, fixed(0), 2200), s, "revealing twice does nothing");
});

/* ============================================================
   A6 — the question pool across contestants
   ============================================================ */

test("A6 a second contestant never sees the first contestant's questions", () => {
  const game = makeGame({ perLevel: 2 });
  let s = seated(game);
  const first = [];
  for (let i = 0; i < 15; i += 1) { first.push(s.question.id); s = answerCorrect(s, fixed(0.7)); }
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p2" }, { type: "seat", pid: "p2" }],
    fixed(0.7));
  const second = [];
  for (let i = 0; i < 15; i += 1) {
    second.push(s.question.id);
    assert.ok(!first.includes(s.question.id), `question ${s.question.id} repeated for contestant 2`);
    assert.equal(s.wrapped, false, "a 2-per-rung pool covers two contestants without wrapping");
    s = answerCorrect(s, fixed(0.7));
  }
  assert.equal(new Set(first.concat(second)).size, 30);

  // The third contestant must wrap, and must SAY SO.
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p3" }, { type: "seat", pid: "p3" }]);
  assert.equal(s.wrapped, true);
  assert.match(s.notice, /wrapped/i, "the host is told the pool has wrapped");
  // Once set, the flag stays set for the rest of the night.
  s = answerCorrect(s);
  assert.equal(s.wrapped, true);
});

test("A6 lifelines and the money reset for each new contestant", () => {
  let s = seated();
  s = run(s, [{ type: "useFifty" }, { type: "usePhone" }, { type: "phoneDone" }]);
  s = answerCorrect(s);
  s = Core.reduce(s, { type: "walkAway" }, fixed(0), 1);
  assert.equal(s.outcome.won, 100);
  s = run(s, [{ type: "nextContestant" }, { type: "fffPick", pid: "p2" }, { type: "seat", pid: "p2" }]);
  assert.equal(s.rung, 0);
  assert.equal(Core.bankedValue(s), 0);
  assert.deepEqual(s.lifelines, { fifty: true, phone: true, audience: true, switch: true });
  assert.deepEqual(s.removed, []);
  assert.equal(s.audience.open, false);
  assert.equal(s.phone.open, false);
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, 100, "the first result survives");
});

/* ============================================================
   A7 — End the night
   ============================================================ */

test("A7 End the night banks the player in the seat and never double-banks", () => {
  let s = seated();
  for (let i = 0; i < 4; i += 1) s = answerCorrect(s);
  assert.equal(Core.winningsIfWalk(s), 500);
  const ended = Core.reduce(s, { type: "finish" }, fixed(0), 1);
  assert.equal(ended.phase, "standings");
  const row = ended.contestants.find((c) => c.pid === "p1");
  assert.deepEqual([row.won, row.rung, row.out], [500, 4, true]);
  assert.equal(ended.contestants.filter((c) => c.out).length, 1, "nobody else is banked");
  assert.equal(Core.reduce(ended, { type: "finish" }, fixed(0), 2), ended, "finishing twice is a no-op");
  // Ending after a wrong reveal pays the haven, not the walk-away amount.
  const slipped = answerWrong(s);
  const stopped = Core.reduce(slipped, { type: "finish" }, fixed(0), 1);
  assert.equal(stopped.contestants.find((c) => c.pid === "p1").won, 0,
    "four right then wrong on question 5 is zero, even when the night ends there");
});

/* ============================================================
   A8 — validator fuzz
   ============================================================ */

test("A8 the validator rejects every malformed file with a readable message", () => {
  const cases = [
    ["14 questions", (g) => { g.questions = g.questions.slice(0, 14); }, /at least 15/],
    ["5 options", (g) => { g.questions[0].options.push("Extra"); }, /exactly 4 options/],
    ["3 options", (g) => { g.questions[0].options.pop(); }, /exactly 4 options/],
    ["duplicate options", (g) => { g.questions[2].options[3] = g.questions[2].options[1]; }, /repeats the option/],
    ["duplicate ignoring case", (g) => { g.questions[2].options[3] = g.questions[2].options[1].toUpperCase(); },
      /repeats the option/],
    ["answer 4", (g) => { g.questions[0].answer = 4; }, /answer/],
    ["answer -1", (g) => { g.questions[0].answer = -1; }, /answer/],
    ["answer 1.5", (g) => { g.questions[0].answer = 1.5; }, /answer/],
    ["answer as text", (g) => { g.questions[0].answer = "2"; }, /answer/],
    ["no answer", (g) => { delete g.questions[0].answer; }, /answer/],
    ["tree of 4", (g) => { g.settings.moneyTree = [1, 2, 3, 4]; }, /5 to 20/],
    ["tree of 21", (g) => { g.settings.moneyTree = Array.from({ length: 21 }, (_, i) => i + 1); }, /5 to 20/],
    ["tree not rising", (g) => { g.settings.moneyTree = [10, 20, 20, 30, 40]; }, /increase at every rung/],
    ["tree with zero", (g) => { g.settings.moneyTree = [0, 20, 30, 40, 50]; }, /above zero/],
    ["tree with a fraction", (g) => { g.settings.moneyTree = [1.5, 20, 30, 40, 50]; }, /above zero/],
    ["haven 16 on a 15-rung tree", (g) => { g.settings.safeHavens = [5, 16]; }, /outside the money tree/],
    ["haven 0", (g) => { g.settings.safeHavens = [0, 5]; }, /outside the money tree/],
    ["havens out of order", (g) => { g.settings.safeHavens = [10, 5]; }, /rising order/],
    ["repeated haven", (g) => { g.settings.safeHavens = [5, 5]; }, /rising order/],
    ["FFF order [0,0,1,2]", (g) => { g.fastestFinger[0].order = [0, 0, 1, 2]; }, /exactly once/],
    ["FFF order too short", (g) => { g.fastestFinger[0].order = [0, 1, 2]; }, /exactly once/],
    ["FFF order out of range", (g) => { g.fastestFinger[0].order = [0, 1, 2, 4]; }, /exactly once/],
    ["FFF order as text", (g) => { g.fastestFinger[0].order = "0123"; }, /exactly once/],
    ["FFF duplicate options", (g) => { g.fastestFinger[0].options[2] = g.fastestFinger[0].options[0]; },
      /repeats the option/],
    ["FFF on with no items", (g) => { g.fastestFinger = []; g.settings.fastestFinger = true; }, /Fastest Finger/],
    ["201-character question", (g) => { g.questions[0].q = "Q".repeat(201); }, /200 characters/],
    ["61-character option", (g) => { g.questions[0].options[0] = "o".repeat(61); }, /60 characters/],
    ["empty question", (g) => { g.questions[0].q = "   "; }, /no question text/],
    ["empty option", (g) => { g.questions[0].options[1] = ""; }, /empty/],
    ["questions is a string", (g) => { g.questions = "lots"; }, /must be a list/],
    ["a question is a string", (g) => { g.questions[3] = "hello"; }, /not an object/],
    ["a question is null", (g) => { g.questions[3] = null; }, /not an object/],
    ["settings is an array", (g) => { g.settings = []; }, /must be an object/],
    ["settings is a string", (g) => { g.settings = "default"; }, /must be an object/],
    ["title is a number", (g) => { g.title = 7; }, /must be text/],
    ["currency too long", (g) => { g.settings.currency = "AUD$"; }, /at most 3/],
    ["unknown lifeline", (g) => { g.settings.lifelines = { fifty: true, joker: true }; }, /not a lifeline/],
    ["lifeline as a string", (g) => { g.settings.lifelines = { fifty: "yes" }; }, /true or false/],
    ["lifelines is an array", (g) => { g.settings.lifelines = []; }, /must be an object/],
    ["audienceSeconds 121", (g) => { g.settings.audienceSeconds = 121; }, /0 to 120/],
    ["phoneSeconds negative", (g) => { g.settings.phoneSeconds = -1; }, /0 to 120/],
    ["phoneSeconds fractional", (g) => { g.settings.phoneSeconds = 12.5; }, /0 to 120/],
    ["fastestFinger as a string", (g) => { g.settings.fastestFinger = "yes"; }, /true or false/],
    ["fastestFinger list is an object", (g) => { g.fastestFinger = { q: "x" }; }, /must be a list/],
    ["level above the tree", (g) => { g.questions[0].level = 16; }, /rungs/],
    ["level zero", (g) => { g.questions[0].level = 0; }, /rungs/],
    ["category is a number", (g) => { g.questions[0].category = 5; }, /must be text/],
    ["safeHavens is a number", (g) => { g.settings.safeHavens = 5; }, /list of rung numbers/],
  ];
  cases.forEach(([label, mutate, needle]) => {
    const game = JSON.parse(JSON.stringify(SHIPPED));
    mutate(game);
    assert.throws(() => Core.validateGame(game), (err) => {
      assert.ok(err instanceof Error, label);
      assert.ok(err.message.length > 10, `${label}: message too terse — "${err.message}"`);
      assert.match(err.message, needle, label);
      return true;
    }, label);
  });
});

test("A8 the validator rejects junk at the top level without throwing something ugly", () => {
  [null, undefined, 0, 42, "", "a game", true, [], [1, 2, 3], NaN].forEach((junk) => {
    assert.throws(() => Core.validateGame(junk), /JSON object/, JSON.stringify(junk));
  });
});

test("A8 a game with no settings at all is playable on the defaults", () => {
  const bare = { questions: JSON.parse(JSON.stringify(SHIPPED.questions)) };
  assert.equal(Core.validateGame(bare), true);
  const norm = Core.normalizeGame(bare);
  assert.deepEqual(norm.settings.moneyTree, Core.DEFAULT_MONEY_TREE);
  assert.deepEqual(norm.settings.safeHavens, [5, 10]);
  assert.equal(norm.settings.fastestFinger, false, "no Fastest Finger items means no round");
  assert.equal(norm.title, "Millionaire");
  // A non-default tree with no havens listed gets none, not [5,10].
  const unlevelled = bare.questions.map((q) => { const c = { ...q }; delete c.level; return c; });
  const shortTree = { settings: { moneyTree: [1, 2, 3, 4, 5] }, questions: unlevelled };
  assert.deepEqual(Core.normalizeGame(shortTree).settings.safeHavens, []);
  // …and an explicit level above the shorter tree is a hard error, not a silent clamp.
  assert.throws(() => Core.normalizeGame({ settings: { moneyTree: [1, 2, 3, 4, 5] }, questions: bare.questions }),
    /only has 5 rungs/);
});

test("A8 normalizeGame never mutates the file it was handed", () => {
  const before = JSON.stringify(SHIPPED);
  Core.normalizeGame(SHIPPED);
  Core.warningsFor(SHIPPED);
  Core.validateGame(SHIPPED);
  assert.equal(JSON.stringify(SHIPPED), before, "the loaded JSON is untouched");
});

test("A8 control characters and over-long text are stripped, not stored", () => {
  const game = JSON.parse(JSON.stringify(SHIPPED));
  game.title = "Quiz Night";
  game.questions[0].q = `A B${" ".repeat(3)}`;
  game.questions[0].category = "Funky";
  game.questions[0].options[0] = " Lemon	 ";
  const norm = Core.normalizeGame(game);
  const q = norm.questions.find((row) => row.q.startsWith("AB"));
  assert.equal(q.q, "AB");
  assert.equal(q.category, "Funky");
  assert.equal(norm.title, "Quiz Night");
  assert.ok(!/[ --]/.test(JSON.stringify(norm)), "no control characters survive");
});

/* ============================================================
   A9 — phone message fuzz and the phone view
   ============================================================ */

test("A9 validatePhoneMsg survives a hostile frame and returns a narrow copy", () => {
  const junk = [
    null, undefined, 0, 1, "", "vote", true, false, [], [1], {}, { t: null }, { t: 7 }, { t: {} },
    { t: "answer" }, { t: "answer", idx: null }, { t: "answer", idx: "2" }, { t: "answer", idx: 1.5 },
    { t: "answer", idx: 4 }, { t: "answer", idx: -1 }, { t: "answer", idx: NaN },
    { t: "vote", idx: 4 }, { t: "vote", idx: "1" }, { t: "vote" },
    { t: "fff" }, { t: "fff", order: null }, { t: "fff", order: [0, 1, 2] },
    { t: "fff", order: [0, 1, 2, 3, 0] }, { t: "fff", order: ["0", "1", "2", "3"] },
    { t: "fff", order: [0, 0, 1, 2] }, { t: "fff", order: [1, 2, 3, 4] },
    { t: "lifeline" }, { t: "lifeline", which: "walk" }, { t: "lifeline", which: "FIFTY" },
    { t: "lifeline", which: 0 }, { t: "lifeline", which: ["fifty"] },
    { t: "walkaway" }, { t: "view" }, { t: "__proto__" },
    { type: "reveal" }, { t: "reveal" }, { t: "lock" }, { t: "nextQuestion" }, { t: "finish" },
  ];
  junk.forEach((msg) => {
    assert.equal(Core.validatePhoneMsg(msg), null, JSON.stringify(msg));
  });
  // The five legal shapes, and nothing else, come back — with nothing riding along.
  assert.deepEqual(Core.validatePhoneMsg({ t: "walk", pid: "p9", evil: 1 }), { t: "walk" });
  assert.deepEqual(Object.keys(Core.validatePhoneMsg({ t: "answer", idx: 0, pid: "p9" })), ["t", "idx"]);
  assert.deepEqual(Object.keys(Core.validatePhoneMsg({ t: "fff", order: [0, 1, 2, 3], at: 0 })), ["t", "order"]);
  assert.deepEqual(Object.keys(Core.validatePhoneMsg({ t: "lifeline", which: "phone", pid: "x" })),
    ["t", "which"]);
  // The returned order is a copy: mutating it must not reach back into the frame.
  const frame = { t: "fff", order: [0, 1, 2, 3] };
  const clean = Core.validatePhoneMsg(frame);
  clean.order[0] = 3;
  assert.deepEqual(frame.order, [0, 1, 2, 3]);
});

test("A9 no phone view on any screen ever carries the correct answer", () => {
  const game = makeGame();
  const shots = [];
  let s = run(Core.createState(game, PLAYERS, {}), [{ type: "start" }]);
  shots.push(s);
  s = Core.reduce(s, { type: "fffOpen" }, fixed(0), 1000);
  shots.push(s);
  s = Core.reduce(s, { type: "fffSubmit", pid: "p2", order: [0, 1, 2, 3], at: 1100 }, fixed(0), 1100);
  shots.push(s);
  s = Core.reduce(s, { type: "fffReveal" }, fixed(0), 1200);
  shots.push(s);
  s = Core.reduce(s, { type: "fffPick", pid: "p1" }, fixed(0), 1300);
  s = Core.reduce(s, { type: "seat", pid: "p1" }, fixed(0), 1400);
  shots.push(s);
  s = Core.reduce(s, { type: "useFifty" }, fixed(0), 1500);
  shots.push(s);
  s = Core.reduce(s, { type: "useAudience" }, fixed(0), 1600);
  shots.push(s);
  s = Core.reduce(s, { type: "audienceVote", pid: "p2", idx: 0 }, fixed(0), 1700);
  s = Core.reduce(s, { type: "audienceClose" }, fixed(0), 1800);
  shots.push(s);
  s = run(s, [{ type: "select", idx: s.question.answer }, { type: "lock" }], fixed(0), 1900);
  shots.push(s);
  s = Core.reduce(s, { type: "reveal" }, fixed(0), 2000);
  shots.push(s);
  s = Core.reduce(s, { type: "nextQuestion" }, fixed(0), 2100);
  const walked = Core.reduce(s, { type: "walkAway" }, fixed(0), 2200);
  shots.push(walked);
  shots.push(Core.reduce(walked, { type: "finish" }, fixed(0), 2300));

  shots.forEach((snap, i) => {
    ["p1", "p2", "p3", "p4", "stranger", ""].forEach((pid) => {
      const view = Core.phoneView(snap, pid);
      const json = JSON.stringify(view);
      assert.ok(!json.includes("\"answer\""), `shot ${i} / ${pid} leaks an answer key`);
      assert.ok(!json.includes("\"order\""), `shot ${i} / ${pid} leaks the Fastest Finger order`);
      assert.ok(!json.includes("\"correct\""), `shot ${i} / ${pid} leaks correctness`);
      // The right option text must never be flagged in any way a phone can read.
      if (snap.question && view.options) {
        assert.equal(view.options.length, 4);
        assert.ok(Array.isArray(view.options));
      }
    });
  });
});

test("A9 only the contestant gets the hot seat, and only non-contestants get a ballot", () => {
  const before = seated();
  assert.equal(Core.phoneView(before, "ghost").screen, "wait", "a late joiner waits");
  assert.equal(Core.phoneView(before, "ghost").spectator, true, "…and is flagged a spectator");
  assert.equal(Core.phoneView(before, "p2").spectator, false);

  const s = Core.reduce(before, { type: "useAudience" }, fixed(0), 1000);
  const screens = {};
  ["p1", "p2", "p3", "p4", "ghost"].forEach((pid) => { screens[pid] = Core.phoneView(s, pid).screen; });
  // Spec 08 §1: the audience is EVERY connected phone except the contestant, so
  // a late joiner does get a ballot — but never the hot seat and never a
  // Fastest Finger chip.
  assert.deepEqual(screens, { p1: "hotseat", p2: "vote", p3: "vote", p4: "vote", ghost: "vote" });
  const fffOpen = Core.reduce(run(Core.createState(makeGame(), PLAYERS, {}), [{ type: "start" }]),
    { type: "fffOpen" }, fixed(0), 1000);
  assert.equal(Core.phoneView(fffOpen, "ghost").screen, "wait", "a late joiner cannot race for the seat");
  assert.equal(Core.reduce(fffOpen, { type: "fffSubmit", pid: "ghost", order: [0, 1, 2, 3], at: 1 },
    fixed(0), 1), fffOpen);
  // A phone only ever learns its own vote.
  const voted = Core.reduce(s, { type: "audienceVote", pid: "p3", idx: 2 }, fixed(0), 1100);
  assert.equal(Core.phoneView(voted, "p3").myVote, 2);
  assert.equal(Core.phoneView(voted, "p2").myVote, null);
  assert.ok(!JSON.stringify(Core.phoneView(voted, "p2")).includes("p3"));
});

/* ============================================================
   A10 — immutability under a deep freeze
   ============================================================ */

test("A10 a deeply frozen state survives a full night of events", () => {
  const deepFreeze = (obj, seen = new Set()) => {
    if (!obj || typeof obj !== "object" || seen.has(obj)) return obj;
    seen.add(obj);
    Object.values(obj).forEach((v) => deepFreeze(v, seen));
    return Object.freeze(obj);
  };
  const script = [
    { type: "start" }, { type: "fffOpen" },
    { type: "fffSubmit", pid: "p2", order: [0, 1, 2, 3], at: 10 },
    { type: "fffSubmit", pid: "p3", order: [3, 2, 1, 0], at: 20 },
    { type: "fffReveal" }, { type: "fffPick", pid: "p1" }, { type: "seat", pid: "p1" },
    { type: "request", pid: "p1", which: "fifty" }, { type: "useFifty" },
    { type: "select", idx: 0 }, { type: "useAudience" },
    { type: "audienceVote", pid: "p2", idx: 1 }, { type: "audienceVote", pid: "p3", idx: 1 },
    { type: "audienceHostChart", pcts: [10, 60, 20, 10] }, { type: "audienceClose" },
    { type: "usePhone" }, { type: "phoneFriend", name: "Sam" }, { type: "phoneDone" },
    { type: "useSwitch" }, { type: "select", idx: 1 }, { type: "lock" }, { type: "reveal" },
    { type: "nextQuestion" }, { type: "undo" }, { type: "undo" },
    { type: "walkAway" }, { type: "nextContestant" }, { type: "seat", pid: "p2" },
    { type: "finish" },
  ];
  // A frozen game object too: normalizeGame's output must not be written to.
  let s = deepFreeze(Core.createState(makeGame(), PLAYERS, {}));
  const gameJson = JSON.stringify(s.game);
  script.forEach((ev, i) => {
    const next = Core.reduce(s, ev, fixed(0.5), 3000 + i * 100);
    assert.ok(next && typeof next === "object", `event ${i} (${ev.type}) returned junk`);
    s = deepFreeze(next);
  });
  assert.equal(JSON.stringify(s.game), gameJson, "the game object is never rewritten");
  assert.equal(s.phase, "standings");
});

test("A10 the arrays inside a returned state are never the arrays from the old one", () => {
  const s = seated();
  const cut = Core.reduce(s, { type: "useFifty" }, fixed(0.2), 1);
  assert.notEqual(cut.removed, s.removed);
  assert.notEqual(cut.lifelines, s.lifelines);
  const next = answerCorrect(s);
  assert.notEqual(next.used, s.used);
  assert.deepEqual(s.used.length + 1, next.used.length);
  assert.deepEqual(s.removed, [], "the original state is exactly as it was");
  assert.equal(s.lifelines.fifty, true);
});

/* ============================================================
   A11 — the shipped file
   ============================================================ */

test("A11 the shipped file is playable end to end for four contestants", () => {
  // 3 per rung: three contestants must never repeat, the fourth must wrap.
  let s = run(Core.createState(SHIPPED, PLAYERS, {}), [{ type: "start" }]);
  const seenIds = new Set();
  ["p1", "p2", "p3"].forEach((pid) => {
    s = run(s, [{ type: "fffPick", pid }, { type: "seat", pid }], fixed(0.34));
    for (let i = 0; i < 15; i += 1) {
      assert.ok(!seenIds.has(s.question.id), `${pid} saw ${s.question.id} twice in the night`);
      seenIds.add(s.question.id);
      s = answerCorrect(s, fixed(0.34));
    }
    assert.equal(s.outcome.reason, "million");
    assert.equal(s.outcome.won, 1000000);
    s = Core.reduce(s, { type: "nextContestant" }, fixed(0.34), 1);
  });
  assert.equal(seenIds.size, 45, "all 45 shipped questions used exactly once");
  assert.equal(s.wrapped, false);
  s = run(s, [{ type: "fffPick", pid: "p4" }, { type: "seat", pid: "p4" }], fixed(0.34));
  assert.equal(s.wrapped, true, "the fourth contestant wraps and the host is told");
});

test("A11 the shipped Fastest Finger answers are real permutations of four", () => {
  assert.ok(SHIPPED.fastestFinger.length >= 1);
  SHIPPED.fastestFinger.forEach((row, i) => {
    assert.equal(row.options.length, 4, `FFF ${i + 1}`);
    assert.deepEqual(row.order.slice().sort((a, b) => a - b), [0, 1, 2, 3], `FFF ${i + 1}`);
    assert.equal(new Set(row.options.map((o) => o.toLowerCase())).size, 4, `FFF ${i + 1} options differ`);
  });
});
