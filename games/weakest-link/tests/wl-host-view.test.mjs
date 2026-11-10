/* ============================================================
   Weakest Link — host-phone selector tests (docs/22 §5.1, §5.5)
   hostView holds the right answer at each phase, nothing in phases
   with no secret, never mutates, stays far under 16 KB, and the
   contestant phoneView is unchanged (it never carries an answer).
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WL = require("../js/wl-core.js");
const HV = require("../js/wl-host-view.js");

function makeGame(n, settings) {
  const questions = [];
  for (let i = 0; i < n; i += 1) questions.push({ q: `Question ${i}?`, a: `Answer ${i}`, category: `Cat ${i % 4}` });
  return { title: "Test", settings: settings || {}, questions };
}
const NAMES = ["Ada", "Ben", "Cleo", "Dev", "Eve"];
const players = (n) => NAMES.slice(0, n).map((name, i) => ({ pid: `p${i + 1}`, name }));
const play = (s, events) => events.reduce((acc, e) => WL.reduce(acc, typeof e === "string" ? { type: e } : e, 0), s);
const started = (n, settings, q) => WL.reduce(WL.createState(makeGame(q || 60, settings), players(n), {}), { type: "start" });

function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.getOwnPropertyNames(v).forEach((k) => deepFreeze(v[k]));
  }
  return v;
}

/** A 3-player game at the final intro (one full round, one vote). */
function toFinal() {
  let s = started(3);
  s = play(s, ["correct", "correct", "bank", "endRound"]);
  return play(s, [
    { type: "vote", voter: "p1", target: "p3" },
    { type: "vote", voter: "p2", target: "p3" },
    { type: "vote", voter: "p3", target: "p1" },
    "revealAll", "eliminate", "nextRound",
  ]);
}

test("HV setup (no game, or a game not yet started) has nothing secret", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setup", secret: false });
  const setup = WL.createState(makeGame(60), players(4), {});
  const v = HV.hostView(setup);
  assert.equal(v.secret, false);
  assert.equal(JSON.stringify(v).includes("Answer"), false);
  assert.equal(HV.itemKey(null), "setup");
});

test("HV round: the player on turn, their question AND answer, and the next two", () => {
  const s = started(4);
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.phaseLabel, "Round 1");
  assert.deepEqual(v.current, { player: "Ada", q: "Question 0?", a: "Answer 0", category: "Cat 0" });
  assert.deepEqual(v.next.map((r) => r.a), ["Answer 1", "Answer 2"]);
  assert.equal(v.expired, false);
  // The answer moves with the game.
  const after = HV.hostView(play(s, ["correct"]));
  assert.equal(after.current.player, "Ben");
  assert.equal(after.current.a, "Answer 1");
  assert.equal(HV.currentAnswer(play(s, ["correct"])), "Answer 1");
});

test("HV round: banking keeps the same question; an expired clock is flagged", () => {
  let s = play(started(4), ["correct", "correct"]);
  const before = HV.hostView(s).current.a;
  const key = HV.itemKey(s);
  s = WL.reduce(s, { type: "bank" });
  assert.equal(HV.hostView(s).current.a, before, "a bank is not a new question");
  assert.equal(HV.itemKey(s), key);
  s = WL.reduce(s, { type: "clockExpired" });
  assert.equal(HV.hostView(s).expired, true);
  assert.notEqual(HV.itemKey(WL.reduce(s, { type: "wrong" })), key, "the next item has a new key");
});

test("HV round: the next questions wrap with the pool", () => {
  let s = started(4, {}, 40);
  for (let i = 0; i < 39; i += 1) s = WL.reduce(s, { type: "wrong" });
  const v = HV.hostView(s);
  assert.equal(v.current.a, "Answer 39");
  assert.deepEqual(v.next.map((r) => r.a), ["Answer 0", "Answer 1"]);
});

test("HV voting, goodbye and result carry no question and no answer", () => {
  let s = WL.reduce(started(4), { type: "endRound" });
  const states = [s];
  s = play(s, [
    { type: "vote", voter: "p1", target: "p4" }, { type: "vote", voter: "p2", target: "p4" },
    { type: "vote", voter: "p3", target: "p4" }, { type: "vote", voter: "p4", target: "p1" },
    "revealAll",
  ]);
  states.push(s);
  s = WL.reduce(s, { type: "eliminate" });
  states.push(s);
  for (const st of states) {
    const v = HV.hostView(st);
    assert.equal(v.secret, false, st.phase);
    assert.equal(v.current, undefined);
    assert.equal(/Answer|Question/.test(JSON.stringify(v)), false, `${st.phase} leaks nothing`);
  }
  assert.equal(HV.hostView(states[0]).phaseLabel, "Voting");
});

test("HV final intro: the two questions that open the head-to-head", () => {
  const s = toFinal();
  assert.equal(s.phase, "finalIntro");
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.current, null);
  assert.deepEqual(v.next.map((r) => r.a), [HV.hostView(s).next[0].a, HV.hostView(s).next[1].a]);
  assert.equal(v.next.length, 2);
  assert.equal(v.next[0].q, WL.currentQuestion(s).q);
});

test("HV final and sudden death: both finalists' questions and answers", () => {
  let s = WL.reduce(toFinal(), { type: "finalFirst", pid: "p2" });
  const q0 = WL.currentQuestion(s);
  let v = HV.hostView(s);
  assert.equal(v.phaseLabel, "Head-to-head");
  assert.equal(v.current.player, "Ben");
  assert.equal(v.current.a, q0.a);
  assert.deepEqual(v.next.map((r) => r.player), ["Ada", "Ben"], "the other finalist, then back again");
  s = WL.reduce(s, { type: "finalAnswer", correct: true });
  v = HV.hostView(s);
  assert.equal(v.current.player, "Ada");
  // 5 each, all right -> sudden death.
  for (let i = 0; i < 9; i += 1) s = WL.reduce(s, { type: "finalAnswer", correct: true });
  assert.equal(s.phase, "suddenDeath");
  v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.phaseLabel, "Sudden death");
  assert.equal(v.current.a, WL.currentQuestion(s).a);
  s = play(s, [{ type: "finalAnswer", correct: true }, { type: "finalAnswer", correct: false }]);
  assert.equal(s.phase, "result");
  assert.equal(HV.hostView(s).secret, false);
});

test("HV is pure: a deep-frozen state is never mutated and the result is deterministic", () => {
  const s = deepFreeze(play(started(5), ["correct", "wrong"]));
  assert.doesNotThrow(() => HV.hostView(s));
  assert.deepEqual(HV.hostView(s), HV.hostView(s));
  const f = deepFreeze(WL.reduce(toFinal(), { type: "finalFirst", pid: "p1" }));
  assert.doesNotThrow(() => HV.hostView(f));
});

test("HV stays far under the 16 KB host-view limit, even with maximum-length text", () => {
  const game = makeGame(60);
  game.questions = game.questions.map((r) => ({ q: "Q".repeat(199) + "?", a: "A".repeat(80), category: "C".repeat(30) }));
  const s = WL.reduce(WL.createState(game, players(12).concat(
    ["Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lea"].map((name, i) => ({ pid: `x${i}`, name }))).slice(0, 12), {}), { type: "start" });
  const bytes = Buffer.byteLength(JSON.stringify({ t: "host", item: HV.itemKey(s), seq: 0, ...HV.hostView(s) }));
  assert.ok(bytes < 2000, `${bytes} bytes`);
});

test("HV contestant phoneView is unchanged: no phone ever carries the answer on the table", () => {
  let s = started(4);
  for (let step = 0; step < 6; step += 1) {
    const answer = HV.currentAnswer(s);
    for (const pid of ["p1", "p2", "p3", "p4", "px"]) {
      assert.equal(JSON.stringify(WL.phoneView(s, pid)).includes(answer), false, `${pid} at step ${step}`);
    }
    s = WL.reduce(s, { type: step % 2 ? "wrong" : "correct" });
  }
});
