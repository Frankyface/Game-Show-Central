/* ============================================================
   Millionaire — host-phone view unit tests (docs/22 §5.1, §5.5)
   hostView holds the right answer at each phase, nothing in phases
   with no secret, never mutates, stays small; phoneView unchanged.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/wwm-core.js");
const HV = require("../js/wwm-host-view.js");

const fixed = (v) => () => v;
const PLAYERS = [{ pid: "p1", name: "Ada" }, { pid: "p2", name: "Ben" }, { pid: "p3", name: "Cleo" }];

function buildGame() {
  const questions = [];
  for (let level = 1; level <= 15; level += 1) {
    for (let n = 0; n < 2; n += 1) {
      questions.push({ level, category: "Test", q: `Level ${level} question ${n + 1}?`,
        options: [`L${level}-${n}-A`, `L${level}-${n}-B`, `L${level}-${n}-C`, `L${level}-${n}-D`],
        answer: (level + n) % 4 });
    }
  }
  return {
    title: "Host view test",
    settings: { moneyTree: Core.DEFAULT_MONEY_TREE.slice(), safeHavens: [5, 10], fastestFinger: true,
      lifelines: { fifty: true, phone: true, audience: true, switch: true } },
    questions,
    fastestFinger: [{ q: "Order these.", options: ["W", "X", "Y", "Z"], order: [1, 0, 3, 2] }],
  };
}

const run = (s, events, now = 1000) => events.reduce((st, ev) => Core.reduce(st, ev, fixed(0), now), s);
const fresh = () => Core.createState(buildGame(), PLAYERS, {});
const seated = () => run(fresh(), [{ type: "start" }, { type: "fffPick", pid: "p1" }, { type: "seat", pid: "p1" }]);
const answerRight = (s) => run(s, [{ type: "select", idx: s.question.answer }, { type: "lock" },
  { type: "reveal" }, { type: "nextQuestion" }]);

test("HV-1 nothing secret in setup, picking, result and standings", () => {
  const setup = fresh();
  assert.deepEqual(HV.hostView(setup), { secret: false, phaseLabel: "Setup", kind: "none" });
  const g = buildGame();
  g.settings.fastestFinger = false;
  const pick = run(Core.createState(g, PLAYERS, {}), [{ type: "start" }]);
  assert.equal(pick.phase, "pick");
  assert.equal(HV.hostView(pick).secret, false);
  const fffWaiting = run(fresh(), [{ type: "start" }]);
  assert.equal(HV.hostView(fffWaiting).secret, false, "Fastest Finger before the question opens");
  const result = run(seated(), [{ type: "walkAway" }]);
  assert.equal(HV.hostView(result).secret, false);
  assert.equal(HV.hostView(run(result, [{ type: "finish" }])).secret, false);
  assert.equal(HV.hostView(null).secret, false);
  assert.match(HV.item(result), /Result/);
});

test("HV-2 the hot seat: the question, four options with exactly the right one marked", () => {
  const s = seated();
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.kind, "question");
  assert.equal(v.q, s.question.q);
  assert.equal(v.contestant, "Ada");
  assert.equal(v.number, 1);
  assert.equal(v.options.length, 4);
  assert.deepEqual(v.options.filter((o) => o.correct).map((o) => o.text), [s.question.options[s.question.answer]]);
  assert.equal(v.answer, s.question.answer);
  assert.equal(v.answerText, `${"ABCD"[s.question.answer]} — ${s.question.options[s.question.answer]}`);
  assert.equal(HV.item(s), s.question.q);
});

test("HV-3 money at stake and the safe-haven payout follow the TV rule", () => {
  let s = seated();
  const v1 = HV.hostView(s);
  assert.deepEqual([v1.atStake, v1.ifWrong, v1.ifWalk], ["$100", "$0", "$0"]);
  for (let i = 0; i < 4; i += 1) s = answerRight(s);
  const v5 = HV.hostView(s);
  assert.deepEqual([v5.number, v5.atStake, v5.ifWrong, v5.ifWalk], [5, "$1,000", "$0", "$500"],
    "four right: question 5 is not protected yet");
  s = answerRight(s);
  const v6 = HV.hostView(s);
  assert.deepEqual([v6.number, v6.atStake, v6.ifWrong, v6.ifWalk], [6, "$2,000", "$1,000", "$1,000"]);
  for (let i = 0; i < 5; i += 1) s = answerRight(s);
  assert.equal(HV.hostView(s).ifWrong, "$32,000");
});

test("HV-4 after 50:50 the host sees the two options left, the right one among them", () => {
  const s = seated();
  assert.equal(HV.hostView(s).remaining, null);
  const after = Core.reduce(s, { type: "useFifty" }, fixed(0), 1);
  const v = HV.hostView(after);
  assert.equal(v.remaining.length, 2);
  assert.ok(v.remaining.indexOf("ABCD"[s.question.answer]) >= 0);
  assert.equal(v.options.filter((o) => o.removed).length, 2);
  assert.ok(!v.options.find((o) => o.correct).removed);
});

test("HV-5 Fastest Finger: the correct order", () => {
  const s = Core.reduce(run(fresh(), [{ type: "start" }]), { type: "fffOpen" }, fixed(0), 5000);
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.kind, "fff");
  assert.deepEqual(v.order.map((o) => o.text), ["X", "W", "Z", "Y"]);
  assert.equal(v.answerText, "B A D C");
  assert.match(HV.fallbackAnswer(s), /^Correct order: B X, A W, D Z, C Y$/);
  const revealed = Core.reduce(s, { type: "fffReveal" }, fixed(0), 6000);
  assert.equal(HV.fallbackAnswer(revealed), "", "after the public reveal there is nothing to hide");
});

test("HV-6 the item key moves with the item, and the fallback line tracks the reveal", () => {
  const s = seated();
  const k1 = HV.itemKey(s);
  assert.match(HV.fallbackAnswer(s), /^Correct answer: [ABCD] — /);
  const revealed = run(s, [{ type: "select", idx: s.question.answer }, { type: "lock" }, { type: "reveal" }]);
  assert.equal(HV.itemKey(revealed), k1, "same item until the next question");
  assert.equal(HV.fallbackAnswer(revealed), "");
  assert.notEqual(HV.itemKey(Core.reduce(revealed, { type: "nextQuestion" }, fixed(0), 1)), k1);
  assert.notEqual(HV.itemKey(Core.reduce(s, { type: "useSwitch" }, fixed(0.9), 1)), k1, "a switched question is a new item");
});

test("HV-7 pure: never mutates, deterministic, far below 16 KB", () => {
  const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const s = deepFreeze(Core.reduce(seated(), { type: "useFifty" }, fixed(0), 1));
  const a = HV.hostView(s);
  assert.deepEqual(HV.hostView(s), a);
  assert.ok(Buffer.byteLength(JSON.stringify(a), "utf8") < 4096);
});

test("HV-8 phoneView is unchanged and carries no correct-marking", () => {
  const s = seated();
  const before = JSON.stringify(Core.phoneView(s, "p1"));
  HV.hostView(s);
  assert.equal(JSON.stringify(Core.phoneView(s, "p1")), before);
  ["p1", "p2", "p3"].forEach((pid) => {
    const v = JSON.stringify(Core.phoneView(s, pid));
    assert.equal(/"answer"|"correct"/.test(v), false, pid);
  });
});
