/* ============================================================
   1 vs 100 — host-phone view (docs/22 §5.1, §5.5)
   hostView holds the right answer at each phase, says "nothing
   secret" where there is none, stays well under 16 KB, and leaves
   the contestant phoneView exactly as it was.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/ovh-core.js");
const HV = require("../js/ovh-hostview.js");

const ZERO = () => 0;

function game() {
  const questions = [];
  for (let level = 1; level <= 10; level += 1) {
    for (let k = 0; k < 3; k += 1) {
      questions.push({ level, q: `L${level} Q${k}?`, options: [`wrong ${level}.${k}`, `right ${level}.${k}`, `other ${level}.${k}`], answer: 1 });
    }
  }
  return { settings: { ladder: [100, 200, 300], answerSeconds: 20 }, questions };
}

function phoneGame(n) {
  const roster = [{ pid: "c1", name: "Cass" }];
  for (let i = 1; i <= n; i += 1) roster.push({ pid: `p${i}`, name: `M${i}` });
  return Core.reduce(Core.createState(game(), roster, { contestant: "c1", simulated: false }), { type: "start" }, ZERO, 1000);
}

const run = (s, events) => events.reduce((st, ev) => Core.reduce(st, ev, ZERO, 1000), s);

test("HV nothing secret before the game, and the shape says so", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setup", secret: false });
  const setup = Core.createState(game(), [{ pid: "c1", name: "Cass" }], {});
  assert.equal(HV.hostView(setup).secret, false);
  assert.equal(HV.itemKey(setup), "setup");
  assert.equal(HV.currentAnswer(setup), "");
});

test("HV a question carries the correct option marked, before and after the Mob closes", () => {
  let s = phoneGame(4);
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.current.q, s.q.question.q);
  assert.deepEqual(v.current.options.map((o) => o.correct), [false, true, false]);
  assert.equal(v.current.answerText, s.q.question.options[1]);
  assert.equal(v.current.answerLetter, "B");
  assert.equal(HV.currentAnswer(s), `B — ${s.q.question.options[1]}`);
  s = run(s, [{ type: "openQuestion" }, { type: "mobAnswer", pid: "p1", idx: 1 }, { type: "closeMob" }]);
  assert.equal(HV.hostView(s).current.answer, 1);
});

test("HV the Mob split and the would-fall count follow the answers as they come in", () => {
  let s = run(phoneGame(4), [{ type: "openQuestion" }]);
  let m = HV.hostView(s).mob;
  assert.equal(m.answered, 0);
  assert.equal(m.wouldFall, 4, "nobody has answered yet: all four would fall");
  s = run(s, [{ type: "mobAnswer", pid: "p1", idx: 1 }, { type: "mobAnswer", pid: "p2", idx: 0 }]);
  m = HV.hostView(s).mob;
  assert.deepEqual(m.counts, [1, 1, 0]);
  assert.equal(m.wouldFall, 3, "one right, one wrong, two silent");
  assert.equal(m.wouldEarn, 300);
  assert.equal(m.wouldEarnText, "$300");
  s = run(s, [{ type: "mobAnswer", pid: "p3", idx: 1 }, { type: "mobAnswer", pid: "p4", idx: 2 }, { type: "closeMob" }]);
  m = HV.hostView(s).mob;
  assert.equal(m.closed, true);
  assert.equal(m.wouldFall, 2);
  assert.equal(m.wouldStay, 2);
  assert.equal(m.wipeOut, false);
});

test("HV a simulated Mob uses the host's typed wrong count, and flags a wipe-out", () => {
  const base = Core.createState(game(), [{ pid: "c1", name: "Cass" }], { simulated: true, mobSize: 6 });
  let s = run(base, [{ type: "start" }, { type: "openQuestion" }]);
  assert.equal(HV.hostView(s).mob.wouldFall, 0);
  s = run(s, [{ type: "simulateMob", wrong: 6 }]);
  assert.equal(HV.hostView(s).mob.wouldFall, 6);
  assert.equal(HV.hostView(s).mob.wipeOut, true);
});

test("HV the next question is the one that is actually asked next", () => {
  let s = phoneGame(3);
  const next = HV.hostView(s).next;
  assert.ok(next && next.q, "a next question is previewed");
  assert.equal(next.qNumber, 2);
  assert.equal(next.answerText, next.options.find((o) => o.correct).text);
  s = run(s, [{ type: "openQuestion" }, { type: "mobAnswer", pid: "p1", idx: 0 }, { type: "mobAnswer", pid: "p2", idx: 1 }, { type: "closeMob" },
    { type: "contestantLock", idx: 1 }, { type: "reveal" }]);
  assert.equal(s.phase, "decision");
  const d = HV.hostView(s);
  assert.equal(d.secret, true, "after a reveal only the NEXT question is private");
  assert.equal(d.current, null);
  assert.equal(d.next.q, next.q);
  s = Core.reduce(s, { type: "continue" }, () => 0.99, 2000);
  assert.equal(s.q.question.q, next.q, "continue asks exactly the previewed question, whatever the rng says");
});

test("HV the item key changes with each new question and not within one", () => {
  let s = phoneGame(3);
  const k1 = HV.itemKey(s);
  s = run(s, [{ type: "openQuestion" }, { type: "mobAnswer", pid: "p1", idx: 1 }, { type: "closeMob" }]);
  assert.equal(HV.itemKey(s), k1);
  s = run(s, [{ type: "contestantLock", idx: 1 }, { type: "reveal" }, { type: "continue" }]);
  assert.notEqual(HV.itemKey(s), k1);
});

test("HV a revealed question, the result and the standings hold nothing secret", () => {
  let s = run(phoneGame(2), [{ type: "openQuestion" }, { type: "mobAnswer", pid: "p1", idx: 1 },
    { type: "mobAnswer", pid: "p2", idx: 1 }, { type: "closeMob" }, { type: "contestantLock", idx: 0 }, { type: "reveal" }]);
  assert.equal(s.phase, "result");
  assert.equal(HV.hostView(s).secret, false);
  assert.equal(HV.hostView(s).current, undefined);
  s = Core.reduce(s, { type: "finish" }, ZERO, 1000);
  assert.equal(HV.hostView(s).secret, false);
  assert.equal(HV.currentAnswer(s), "");
});

test("HV the view is small, pure and never mutates the state", () => {
  const s = run(phoneGame(15), [{ type: "openQuestion" }]);
  const before = JSON.stringify(s);
  const v = HV.hostView(s);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(HV.hostView(s), v, "deterministic");
  assert.ok(Buffer.byteLength(JSON.stringify(v), "utf8") < 4096, "well under the 16 KB cap");
});

test("HV contestant phoneView is unchanged by the host phone: no upcoming question, no answer", () => {
  const s = run(phoneGame(3), [{ type: "openQuestion" }]);
  const next = s.upcoming.question;
  ["c1", "p1", "p2", "p3"].forEach((pid) => {
    const json = JSON.stringify(Core.phoneView(s, pid, 1000));
    assert.ok(json.indexOf(next.q) < 0, `${pid} sees the upcoming question`);
    assert.ok(!/"answer"|"correct"|"upcoming"/.test(json), `${pid}: ${json}`);
  });
});
