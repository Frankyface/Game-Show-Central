/* ============================================================
   Press Your Luck — host-phone view (docs/22 §5.1, §5.5)
   hostView carries the right answer in every question phase,
   nothing secret on setup / the board / between rounds / at the
   end, never a board square, and leaves phoneView unchanged.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/pyl-core.js");
const HV = require("../js/pyl-host-view.js");

const WHAMMY = { whammy: true };
function board(big) {
  const out = [];
  for (let i = 0; i < 18; i += 1) out.push([2, 9, 16].indexOf(i) >= 0 ? WHAMMY : { cash: (big ? 1000 : 100) * (i + 1) });
  return out;
}
function questions(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ q: `Question ${i + 1}?`, options: [`OPT-a${i}`, `OPT-b${i}`, `OPT-c${i}`], answer: i % 3 });
  }
  return out;
}
const GAME = {
  title: "HV",
  settings: { currency: "$", questionsPerRound: 2, buzzSpins: 3, pickSpins: 1, whammyLimit: 4, rounds: 2 },
  boards: [board(false), board(true)],
  questions: questions(24),
};
const PLAYERS = [{ name: "Ada", pid: "p1" }, { name: "Ben", pid: "p2" }, { name: "Cleo", pid: "p3" }];
const ORDER = [[4, 7], [10, 13]];

function started() {
  return Core.reduce(Core.createState(GAME, PLAYERS, { order: ORDER }), { type: "start" });
}
function answerOf(index) { const q = GAME.questions[index]; return q.options[q.answer]; }

/** Play a whole question: a correct buzz from seat 0, reveal. */
function playQuestion(s) {
  let x = Core.reduce(s, { type: "arm", on: true });
  x = Core.reduce(x, { type: "buzz", seat: 0 });
  x = Core.reduce(x, { type: "judgeBuzz", correct: true });
  return Core.reduce(x, { type: "revealPicks" });
}

test("HV-1 setup (no state, or phase setup) has nothing secret", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setup", secret: false, item: "" });
  const fresh = Core.createState(GAME, PLAYERS, { order: ORDER });
  assert.equal(HV.hostView(fresh).secret, false);
  assert.equal(HV.itemKey(fresh), "setup");
});

test("HV-2 every question phase carries the question, the right option and the next question", () => {
  let s = started();
  const check = (label) => {
    const v = HV.hostView(s);
    const here = ORDER[s.round][s.qIndex];
    assert.equal(v.secret, true, label);
    assert.equal(v.item, GAME.questions[here].q, label);
    assert.equal(v.answer, answerOf(here), label);
    assert.equal(v.correct, GAME.questions[here].answer, label);
    assert.equal(v.letter, ["A", "B", "C"][GAME.questions[here].answer], label);
    assert.deepEqual(v.options, GAME.questions[here].options, label);
  };
  check("before the buzzers are armed");
  s = Core.reduce(s, { type: "arm", on: true }); check("armed");
  s = Core.reduce(s, { type: "buzz", seat: 1 });
  check("buzzed");
  assert.equal(HV.hostView(s).who, "Ben buzzed in");
  s = Core.reduce(s, { type: "judgeBuzz", correct: false }); check("picks open");
  s = Core.reduce(s, { type: "revealPicks" }); check("revealed");
  assert.equal(HV.hostView(s).revealed, true);
  assert.equal(HV.hostView(s).next.q, GAME.questions[ORDER[0][1]].q, "next = the round's next question");
  assert.equal(HV.hostView(s).next.answer, answerOf(ORDER[0][1]));
  s = Core.reduce(s, { type: "nextQuestion" });
  assert.equal(HV.hostView(s).next.q, GAME.questions[ORDER[1][0]].q, "last of the round: next = round two's first");
});

test("HV-3 the item key changes per question and per phase, never within one question", () => {
  let s = started();
  const k0 = HV.itemKey(s);
  s = Core.reduce(s, { type: "arm", on: true });
  s = Core.reduce(s, { type: "buzz", seat: 0 });
  s = Core.reduce(s, { type: "judgeBuzz", correct: true });
  assert.equal(HV.itemKey(s), k0, "buzz and judge stay on the same item");
  s = Core.reduce(s, { type: "revealPicks" });
  s = Core.reduce(s, { type: "nextQuestion" });
  assert.notEqual(HV.itemKey(s), k0);
});

test("HV-4 the Big Board holds whose turn and the spins — nothing else, never a square", () => {
  let s = playQuestion(started());
  s = Core.reduce(s, { type: "nextQuestion" });
  s = playQuestion(s);
  s = Core.reduce(s, { type: "toBoard" }, () => 0);
  assert.equal(s.phase, "board");
  const v = HV.hostView(s);
  assert.equal(v.secret, false);
  assert.equal(v.who, "Ada");
  assert.equal(v.spins, Core.spinsLeft(s, s.control));
  assert.deepEqual(Object.keys(v).sort(), ["item", "passed", "phase", "phaseLabel", "secret", "spins", "who"].sort());
  const text = JSON.stringify(v);
  ["board", "squares", "faces", "landing", "answer", "next"].forEach((key) => {
    assert.equal(text.indexOf(`"${key}":`), -1, `${key} must not be a key of the board view`);
  });
  Core.boardTiles(s).forEach((tile) => { if (!tile.whammy) assert.equal(text.indexOf(tile.top), -1); });
  assert.equal(text.indexOf("OPT-"), -1, "no question material on the board");
});

test("HV-5 between rounds and at the end there is nothing secret", () => {
  const s = started();
  const done = Object.assign({}, s, { phase: "roundDone" });
  const result = Object.assign({}, s, { phase: "result" });
  [done, result].forEach((x) => {
    const v = HV.hostView(x);
    assert.equal(v.secret, false);
    assert.equal(JSON.stringify(v).indexOf("OPT-"), -1);
  });
});

test("HV-6 currentAnswer is what the shared screen must hide, and only until the reveal", () => {
  let s = started();
  const here = ORDER[0][0];
  assert.equal(HV.currentAnswer(s), `${["A", "B", "C"][GAME.questions[here].answer]} — ${answerOf(here)}`);
  s = playQuestion(s);
  assert.equal(HV.currentAnswer(s), "", "after the public reveal there is nothing to hide");
  assert.equal(HV.currentAnswer(null), "");
});

test("HV-7 the view is pure: same state, same view; the state is never mutated", () => {
  const s = started();
  const before = JSON.stringify(s);
  assert.deepEqual(HV.hostView(s), HV.hostView(s));
  assert.equal(JSON.stringify(s), before);
  HV.hostView(s).options.push("tamper");
  assert.equal(HV.hostView(s).options.length, 3);
});

test("HV-8 the view stays far under the 16 KB host-view cap even with long content", () => {
  const long = (n) => "x".repeat(n);
  const big = Object.assign({}, GAME, {
    questions: GAME.questions.map((q) => ({ q: long(200), options: [long(60), long(59) + "b", long(59) + "c"], answer: 1 })),
  });
  const s = Core.reduce(Core.createState(big, PLAYERS, { order: ORDER }), { type: "start" });
  assert.ok(JSON.stringify(HV.hostView(s)).length < 2000);
});

test("HV-9 contestant phoneView is unchanged: still no answer for anyone", () => {
  let s = started();
  s = Core.reduce(s, { type: "arm", on: true });
  s = Core.reduce(s, { type: "buzz", seat: 0 });
  s = Core.reduce(s, { type: "judgeBuzz", correct: true });
  ["p1", "p2", "p3"].forEach((pid) => {
    const text = JSON.stringify(Core.phoneView(s, pid));
    assert.equal(text.indexOf('"answer"'), -1);
    assert.equal(text.indexOf('"correct"'), -1);
  });
});
