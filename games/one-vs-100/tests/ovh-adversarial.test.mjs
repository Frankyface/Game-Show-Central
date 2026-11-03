/* ============================================================
   1 vs 100 — adversarial suite (independent tester)
   Tries to break the pure core against spec 16: ladder and bank
   maths over the whole ladder, the lose split, the wipe-out bonus,
   helps, the simulated Mob, the answer window, late joiners,
   validator / phone-message fuzz, leak tests, deep-frozen
   immutability, undo across phases, prototype-shaped events.
   Run with:  cd games/one-vs-100 && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = require("../js/ovh-core.js");
const SHIPPED = JSON.parse(fs.readFileSync(path.join(HERE, "..", "questions.json"), "utf8"));

const ZERO = () => 0;
const T0 = 1000000;

/** 40 questions whose answers rotate 0,1,2 so wrong-option maths cannot
    accidentally pass because everything is "A". */
function game(settings, ansFn) {
  const questions = [];
  for (let i = 0; i < 40; i += 1) {
    const level = Math.floor(i / 4) + 1;
    questions.push({ level, q: `Q${i}?`, options: [`o${i}a`, `o${i}b`, `o${i}c`], answer: ansFn ? ansFn(i) : i % 3 });
  }
  return { title: "Adv", settings: Object.assign({ answerSeconds: 20 }, settings || {}), questions };
}

function roster(n) {
  const out = [{ pid: "c1", name: "Cass" }];
  for (let i = 1; i <= n; i += 1) out.push({ pid: `p${i}`, name: `M${i}` });
  return out;
}

const R = (s, ev, now) => C.reduce(s, ev, ZERO, Number.isFinite(now) ? now : T0);
const run = (s, evs, now) => evs.reduce((acc, ev) => R(acc, ev, now), s);

function sim(size, settings, ansFn) {
  const s = C.createState(game(settings, ansFn), [{ pid: "c1", name: "Cass" }], { contestant: "c1", simulated: true, mobSize: size });
  return R(s, { type: "start" });
}
function phones(n, settings, ansFn) {
  const s = C.createState(game(settings, ansFn), roster(n), { contestant: "c1", simulated: false });
  return R(s, { type: "start" });
}
const ans = (s) => s.q.question.answer;
const wrongIdx = (s) => (ans(s) + 1) % 3;

/** One simulated question: `wrong` wrong, contestant right unless told. */
function simRound(s, wrong, contestantRight) {
  let x = run(s, [{ type: "simulateMob", wrong }, { type: "closeMob" }]);
  x = R(x, { type: "contestantLock", idx: contestantRight === false ? wrongIdx(x) : ans(x) });
  return R(x, { type: "reveal" });
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

/* ============ Ladder and bank ============ */

test("ADV ladder: whole default ladder, then the last value repeats (Q11, Q12)", () => {
  let s = sim(100, {});
  let expected = 0;
  for (let n = 1; n <= 12; n += 1) {
    assert.equal(s.qNumber, n);
    const per = C.DEFAULT_LADDER[Math.min(n, 10) - 1];
    assert.equal(C.perMember(s, n), per);
    s = simRound(s, 3);
    expected += 3 * per;
    assert.equal(s.bank, expected, `bank after Q${n}`);
    assert.equal(s.q.earned, 3 * per);
    assert.equal(C.mobAlive(s), 100 - 3 * n);
    assert.equal(s.phase, "decision");
    s = R(s, { type: "continue" });
  }
  assert.equal(C.perMember(s, 13), 10000);
  assert.equal(C.perMemberValue([5], 99), 5);
  assert.equal(C.perMemberValue([], 1), 100, "empty ladder falls back to default");
});

test("ADV ladder: a custom single-value ladder repeats from Q1", () => {
  let s = sim(10, { ladder: [250] });
  s = simRound(s, 2);
  s = simRound(R(s, { type: "continue" }), 1);
  assert.equal(s.bank, 750);
});

test("ADV zero wrong earns nothing but still continues", () => {
  const s = simRound(sim(10, {}), 0);
  assert.equal(s.bank, 0);
  assert.equal(s.phase, "decision");
  assert.equal(C.mobAlive(s), 10);
});

/* ============ Non-answer, window ============ */

test("ADV phone Mob: a member who never answers is eliminated, money counts them", () => {
  let s = phones(5);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  const a = ans(s);
  s = R(s, { type: "mobAnswer", pid: "p1", idx: a }, T0 + 10);
  s = R(s, { type: "mobAnswer", pid: "p2", idx: (a + 1) % 3 }, T0 + 10);
  s = run(s, [{ type: "closeMob" }, { type: "contestantLock", idx: a }, { type: "reveal" }]);
  assert.deepEqual(s.q.eliminated.slice().sort(), ["p2", "p3", "p4", "p5"]);
  assert.equal(s.bank, 4 * 100);
  assert.equal(C.mobAlive(s), 1);
});

test("ADV a Mob answer after the window closes, or after the deadline, is rejected", () => {
  let s = phones(4);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  const late = R(s, { type: "mobAnswer", pid: "p1", idx: 0 }, T0 + 20001);
  assert.equal(late, s, "after the deadline");
  const atEdge = R(s, { type: "mobAnswer", pid: "p1", idx: 0 }, T0 + 20000);
  assert.notEqual(atEdge, s, "exactly at the deadline still counts (documented)");
  const closed = R(s, { type: "closeMob" });
  assert.equal(R(closed, { type: "mobAnswer", pid: "p2", idx: 0 }, T0 + 1), closed);
  assert.equal(C.windowExpired(s, T0 + 20000), true);
});

test("ADV the contestant cannot lock while the Mob window is open (or before it opens)", () => {
  let s = phones(4);
  assert.equal(R(s, { type: "contestantLock", idx: 0 }), s);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(R(s, { type: "contestantLock", idx: 0 }), s);
  assert.equal(R(s, { type: "mobAnswer", pid: "c1", idx: 0 }, T0), s, "contestant cannot answer as Mob");
});

test("ADV a paused window with 0 ms left must not come back as an untimed window", () => {
  let s = phones(3);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  // Save written right at the deadline, before the 250 ms tick closed it.
  const saved = Object.assign({}, s, { q: C.pauseWindow(s.q, T0 + 20000) });
  assert.equal(saved.q.remainingMs, 0);
  const resumed = R(saved, { type: "openQuestion", now: T0 + 99000 }, T0 + 99000);
  assert.ok(Number.isFinite(resumed.q.deadline), "resumed window must still have a deadline");
  assert.equal(C.windowExpired(resumed, T0 + 99000), true);
});

test("ADV answerSeconds 0 is an untimed window the host closes", () => {
  let s = phones(3, { answerSeconds: 0 });
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(s.q.deadline, null);
  assert.equal(C.windowExpired(s, T0 + 1e9), false);
  assert.notEqual(R(s, { type: "mobAnswer", pid: "p1", idx: 0 }, T0 + 1e9), s);
});

/* ============ Eliminated / late joiner ============ */

test("ADV an eliminated phone cannot answer and sees mob-eliminated", () => {
  let s = phones(4);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  const a = ans(s);
  ["p1", "p2", "p3"].forEach((p) => { s = R(s, { type: "mobAnswer", pid: p, idx: a }, T0); });
  s = R(s, { type: "mobAnswer", pid: "p4", idx: (a + 1) % 3 }, T0);
  s = run(s, [{ type: "closeMob" }, { type: "contestantLock", idx: a }, { type: "reveal" }, { type: "continue" }]);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(R(s, { type: "mobAnswer", pid: "p4", idx: 0 }, T0), s);
  const v = C.phoneView(s, "p4");
  assert.equal(v.screen, "mob-eliminated");
  assert.equal(v.options, undefined);
  assert.equal(v.q, undefined);
});

test("ADV a late joiner never becomes a Mob member mid-game", () => {
  let s = phones(3);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(R(s, { type: "mobAnswer", pid: "p99", idx: 0 }, T0), s);
  const v = C.phoneView(s, "p99");
  assert.equal(v.screen, "wait");
  assert.equal(v.options, undefined);
  assert.equal(C.mobSize(s), 3);
  assert.equal(R(s, { type: "seat", pid: "p2" }), s, "re-seating mid-game refused");
});

/* ============ Lose, split, walk, wipe-out ============ */

test("ADV contestant wrong: wins 0, survivors split floor(bank/survivors)", () => {
  let s = sim(10, {});
  s = simRound(s, 3);                                  // bank 300, 7 left
  s = simRound(R(s, { type: "continue" }), 1, false);  // wrong Mob member stays out, 6 left
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.reason, "lose");
  assert.equal(s.outcome.won, 0);
  assert.equal(s.bank, 300, "no money earned on a wrong answer");
  assert.equal(s.outcome.survivors.length, 6);
  assert.equal(s.outcome.each, 50);
  let t = simRound(sim(10, {}), 3);
  t = simRound(R(t, { type: "continue" }), 0, false);
  assert.equal(t.outcome.each, Math.floor(300 / 7));
});

test("ADV contestant wrong and the whole Mob also wrong: bank lost, nobody paid", () => {
  let s = simRound(sim(5, {}), 2);                     // 3 left, bank 200
  s = simRound(R(s, { type: "continue" }), 3, false);
  assert.equal(s.outcome.reason, "lose");
  assert.equal(s.outcome.survivors.length, 0);
  assert.equal(s.outcome.each, 0);
  assert.match(s.notice, /bank is gone/);
});

test("ADV wrong on Q1: bank 0 split is 0 each", () => {
  const s = simRound(sim(5, {}), 1, false);
  assert.equal(s.outcome.each, 0);
  assert.equal(s.outcome.won, 0);
});

test("ADV walk only after a correct answer", () => {
  let s = sim(5, {});
  assert.equal(R(s, { type: "walk" }), s, "no walk before Q1 is answered");
  s = run(s, [{ type: "simulateMob", wrong: 1 }, { type: "closeMob" }]);
  assert.equal(R(s, { type: "walk" }), s, "no walk mid-question");
  s = R(s, { type: "contestantLock", idx: ans(s) });
  assert.equal(R(s, { type: "walk" }), s, "no walk after lock before reveal");
  s = R(s, { type: "reveal" });
  const w = R(s, { type: "walk" });
  assert.equal(w.outcome.reason, "walk");
  assert.equal(w.outcome.won, 100);
  assert.equal(R(w, { type: "walk" }), w);
  assert.equal(R(w, { type: "continue" }), w);
});

test("ADV wipe-out: bank incl. the last question, times the bonus (and rounding)", () => {
  let s = simRound(sim(4, {}), 1);                     // 100
  s = simRound(R(s, { type: "continue" }), 3);         // +600 = 700, Mob gone
  assert.equal(s.outcome.reason, "win");
  assert.equal(s.outcome.bank, 700);
  assert.equal(s.outcome.won, 1400);
  const t = simRound(sim(3, { bonusMultiplier: 1.5, ladder: [101] }), 3);
  assert.equal(t.outcome.won, Math.round(303 * 1.5));
  const u = simRound(sim(3, { bonusMultiplier: 1 }), 3);
  assert.equal(u.outcome.won, 300);
});

/* ============ Helps ============ */

function closedPhones(picks, settings) {
  let s = phones(picks.length, settings, () => 1);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  picks.forEach((idx, i) => { if (idx !== null) s = R(s, { type: "mobAnswer", pid: `p${i + 1}`, idx }, T0); });
  return R(s, { type: "closeMob" });
}

test("ADV helps once each across the whole game", () => {
  let s = closedPhones([1, 1, 1, 0, 2, 1]);
  s = R(s, { type: "usePoll" });
  assert.equal(s.helps.poll, false);
  assert.equal(R(s, { type: "usePoll" }), s);
  s = R(s, { type: "useAsk" });
  assert.equal(s.helps.ask, false);
  assert.equal(R(s, { type: "useAsk" }), s);
  s = R(s, { type: "useTrust" });
  assert.equal(s.q.locked, 1);
  s = run(s, [{ type: "reveal" }, { type: "continue" }, { type: "openQuestion", now: T0 }]);
  s = run(s, [{ type: "mobAnswer", pid: "p1", idx: 1 }, { type: "closeMob" }]);
  assert.equal(R(s, { type: "usePoll" }), s);
  assert.equal(R(s, { type: "useAsk" }), s);
  assert.equal(R(s, { type: "useTrust" }), s);
});

test("ADV helps are refused before the Mob locks and after the contestant locks", () => {
  let s = phones(3, {}, () => 1);
  assert.equal(R(s, { type: "usePoll" }), s);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(R(s, { type: "usePoll" }), s);
  assert.equal(R(s, { type: "useTrust" }), s);
  s = run(s, [{ type: "closeMob" }, { type: "contestantLock", idx: 0 }]);
  assert.equal(R(s, { type: "usePoll" }), s);
  assert.equal(R(s, { type: "useTrust" }), s, "Trust cannot overwrite a lock");
});

test("ADV disabled helps in settings are never usable", () => {
  const s = closedPhones([1, 1, 0], { helps: { poll: false, ask: false, trust: false } });
  assert.equal(R(s, { type: "usePoll" }), s);
  assert.equal(R(s, { type: "useAsk" }), s);
  assert.equal(R(s, { type: "useTrust" }), s);
});

test("ADV Trust takes the majority (C) and locks it", () => {
  const s = R(closedPhones([2, 2, 0, 1, 2]), { type: "useTrust" });
  assert.equal(s.q.locked, 2);
  assert.equal(s.q.trust, true);
  assert.equal(C.majorityIsTied(s), false);
});

test("ADV Trust on a tie takes the first tied option and the host is told", () => {
  const s0 = closedPhones([2, 1, 2, 1, 0]);            // B and C tie on 2
  assert.equal(C.majorityIsTied(s0), true);
  const s = R(s0, { type: "useTrust" });
  assert.equal(s.q.locked, 1, "first tied option in order is B");
  assert.match(s.notice || "", /tie/i, "the tie must be flagged for the host (spec 16 §6 O-U7)");
});

test("ADV Trust when nobody answered: option A, flagged as a tie", () => {
  const s0 = closedPhones([null, null, null]);
  const s = R(s0, { type: "useTrust" });
  assert.equal(s.q.locked, 0);
  assert.equal(C.majorityIsTied(s0), true);
});

test("ADV Poll view: contestant phone gets counts only after Poll; Ask names one right and one wrong", () => {
  let s = closedPhones([1, 1, 0, 2, null]);
  const before = C.phoneView(s, "c1");
  assert.equal(before.screen, "contestant");
  assert.equal(before.poll, null);
  s = R(s, { type: "usePoll" });
  assert.deepEqual(C.phoneView(s, "c1").poll, [1, 2, 1]);
  assert.deepEqual(C.optionRows(s).map((r) => r.votes), [1, 2, 1]);
  s = R(s, { type: "useAsk" });
  assert.equal(s.q.ask.right.idx, 1);
  assert.notEqual(s.q.ask.wrong.idx, 1);
  assert.ok(["p1", "p2"].includes(s.q.ask.right.pid));
  const t = R(closedPhones([1, 1, 0, 2]), { type: "useAsk", pid: "p2" });
  assert.equal(t.q.ask.right.pid, "p2", "a host-named member wins on its side");
});

test("ADV Ask with every survivor right names the right one and nobody on the wrong side", () => {
  const s = R(closedPhones([1, 1, 1]), { type: "useAsk" });
  assert.ok(s.q.ask.right);
  assert.equal(s.q.ask.wrong, null);
});

test("ADV host option votes are hidden before Poll (contestant watching the screen)", () => {
  const s = closedPhones([1, 1, 0]);
  assert.deepEqual(C.optionRows(s).map((r) => r.votes), [null, null, null]);
});

/* ============ Simulated Mob edge values ============ */

test("ADV simulated Mob: size and wrong edge values", () => {
  const setup = C.createState(game({}), [{ pid: "c1", name: "Cass" }], { simulated: true, mobSize: 5 });
  [0, 101, -1, 1.5, "7", null, NaN, Infinity].forEach((size) => {
    assert.equal(R(setup, { type: "simulateMob", size }), setup, `size ${String(size)}`);
  });
  assert.equal(R(setup, { type: "simulateMob", size: 100 }).plan.size, 100);
  assert.equal(R(setup, { type: "simulateMob", size: 1 }).plan.size, 1);
  let s = sim(5, {});
  [6, -1, 2.5, "3", null, NaN].forEach((wrong) => {
    assert.equal(R(s, { type: "simulateMob", wrong }), s, `wrong ${String(wrong)}`);
  });
  assert.equal(R(s, { type: "simulateMob", wrong: 5 }).q.simWrong, 5);
  s = simRound(s, 2);
  s = R(s, { type: "continue" });
  assert.equal(R(s, { type: "simulateMob", wrong: 4 }), s, "wrong > survivors refused");
  assert.equal(R(s, { type: "simulateMob", wrong: 3 }).q.simWrong, 3);
  assert.equal(R(s, { type: "simulateMob", size: 50 }), s, "size change mid-game ignored");
});

test("ADV simulated Mob: wrong answers spread over both wrong options, Poll sums to survivors", () => {
  let s = sim(9, {});
  s = run(s, [{ type: "simulateMob", wrong: 5 }, { type: "closeMob" }, { type: "usePoll" }]);
  const sp = C.split(s);
  assert.equal(sp.counts[ans(s)], 4);
  assert.equal(sp.counts.reduce((a, b) => a + b, 0), 9);
  const others = [0, 1, 2].filter((i) => i !== ans(s)).map((i) => sp.counts[i]).sort();
  assert.deepEqual(others, [2, 3]);
});

test("ADV simulated Mob: phones in the room cannot answer for a simulated Mob", () => {
  const st = C.createState(game({}), roster(5), { contestant: "c1", simulated: true, mobSize: 10 });
  let s = R(st, { type: "start" });
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  assert.equal(R(s, { type: "mobAnswer", pid: "p1", idx: 0 }, T0), s);
  assert.equal(C.phoneView(s, "p1").screen, "wait");
});

test("ADV simulateMob is refused for a phone Mob", () => {
  const s = phones(4);
  assert.equal(R(s, { type: "simulateMob", wrong: 1 }), s);
});

/* ============ Validator fuzz ============ */

function base(n) {
  const qs = [];
  for (let i = 0; i < n; i += 1) qs.push({ q: `Q${i}`, options: ["a", "b", "c"], answer: 0 });
  return { questions: qs };
}

test("ADV validator: 29 questions, 4 options, answer 3, level 11, junk", () => {
  assert.throws(() => C.validateGame(base(29)), /at least 30/);
  assert.equal(C.validateGame(base(30)), true);
  const mut = (fn) => { const g = base(30); fn(g); return g; };
  const bad = [
    mut((g) => { g.questions[3].options = ["a", "b", "c", "d"]; }),
    mut((g) => { g.questions[3].options = ["a", "b"]; }),
    mut((g) => { g.questions[3].answer = 3; }),
    mut((g) => { g.questions[3].answer = -1; }),
    mut((g) => { g.questions[3].answer = "0"; }),
    mut((g) => { g.questions[3].answer = 0.5; }),
    mut((g) => { g.questions[3].level = 11; }),
    mut((g) => { g.questions[3].level = 0; }),
    mut((g) => { g.questions[3].level = "3"; }),
    mut((g) => { g.questions[3].q = "   "; }),
    mut((g) => { g.questions[3].q = "x".repeat(201); }),
    mut((g) => { g.questions[3].options = ["a", "A ", "c"]; }),
    mut((g) => { g.questions[3].options = ["a", "", "c"]; }),
    mut((g) => { g.questions[3].options = ["a", 7, "c"]; }),
    mut((g) => { g.questions[3] = null; }),
    mut((g) => { g.questions[3] = ["Q", ["a", "b", "c"], 0]; }),
    mut((g) => { g.settings = { ladder: [] }; }),
    mut((g) => { g.settings = { ladder: [100, 50] }; }),
    mut((g) => { g.settings = { ladder: [0] }; }),
    mut((g) => { g.settings = { ladder: [1.5] }; }),
    mut((g) => { g.settings = { ladder: new Array(21).fill(1) }; }),
    mut((g) => { g.settings = { answerSeconds: 121 }; }),
    mut((g) => { g.settings = { bonusMultiplier: 0.5 }; }),
    mut((g) => { g.settings = { bonusMultiplier: 11 }; }),
    mut((g) => { g.settings = { mobSize: 0 }; }),
    mut((g) => { g.settings = { helps: { lifeline: true } }; }),
    mut((g) => { g.settings = { helps: { poll: "yes" } }; }),
    mut((g) => { g.settings = { currency: "EURO" }; }),
    mut((g) => { g.settings = []; }),
    mut((g) => { g.title = 5; }),
    null, undefined, 42, "x", [], { questions: "lots" }, { questions: {} },
  ];
  bad.forEach((g, i) => {
    assert.throws(() => C.validateGame(g), Error, `bad #${i}`);
    assert.throws(() => C.normalizeGame(g), Error, `normalize bad #${i}`);
  });
});

test("ADV validator: prototype-shaped keys and control chars are harmless", () => {
  const g = base(30);
  g.questions[0] = JSON.parse('{"q":"Hi\\u0000\\u001b there","options":["a\\u0007","b","c"],"answer":1,"__proto__":{"polluted":true}}');
  g.settings = JSON.parse('{"helps":{"poll":true},"__proto__":{"x":1}}');
  const n = C.normalizeGame(g);
  assert.ok(n.questions.some((q) => q.q === "Hi there"));
  assert.equal({}.polluted, undefined);
  assert.throws(() => C.validateGame(JSON.parse('{"questions":[],"settings":{"helps":{"__proto__":true}}}')));
});

test("ADV validator: shipped file, data.js mirror and both library sets validate", () => {
  assert.equal(C.validateGame(SHIPPED), true);
  assert.equal(SHIPPED.questions.length, 60);
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, "..", "js", "data.js"), "utf8"), sandbox);
  const mirror = sandbox.window.OVH_DEFAULT_GAME || sandbox.OVH_DEFAULT_GAME;
  assert.deepEqual(JSON.parse(JSON.stringify(mirror)), SHIPPED, "data.js mirrors questions.json");
  const idx = JSON.parse(fs.readFileSync(path.join(HERE, "..", "sets", "index.json"), "utf8"));
  assert.ok(idx.length >= 2);
  idx.forEach((e) => {
    assert.match(e.file, /^[A-Za-z0-9._-]+\.json$/);
    const set = JSON.parse(fs.readFileSync(path.join(HERE, "..", "sets", e.file), "utf8"));
    assert.equal(C.validateGame(set), true, e.file);
  });
});

/* ============ Phone-message fuzz ============ */

test("ADV validatePhoneMsg fuzz", () => {
  const junk = [null, undefined, 1, "mob", [], {}, { t: 1 }, { t: "mob" }, { t: "mob", idx: 3 },
    { t: "mob", idx: -1 }, { t: "mob", idx: "1" }, { t: "mob", idx: 1.5 }, { t: "mob", idx: NaN },
    { t: "lock", idx: Infinity }, { t: "LOCK", idx: 0 }, { t: "reveal" }, { t: "walk" },
    { t: "__proto__", idx: 0 }, { t: "toString", idx: 0 }, { t: "constructor" },
    JSON.parse('{"t":"mob","__proto__":{"idx":1}}')];
  junk.forEach((m, i) => assert.equal(C.validatePhoneMsg(m), null, `junk #${i}`));
  assert.deepEqual(C.validatePhoneMsg({ t: "mob", idx: 2, extra: "x".repeat(100000), pid: "p9" }), { t: "mob", idx: 2 });
  const ts = ["mob", "lock", "x", ""];
  const idxs = [0, 1, 2, 3, -1, "1", null, 1.1];
  for (let i = 0; i < 2000; i += 1) {
    const v = C.validatePhoneMsg({ t: ts[i % 4], idx: idxs[(i * 7) % 8] });
    if (v) assert.ok(["mob", "lock"].includes(v.t) && [0, 1, 2].includes(v.idx));
  }
});

/* ============ Leak tests ============ */

const MOB_VIEW_KEYS = new Set(["screen", "name", "bank", "qNumber", "alive", "mobSize", "sub", "seat", "mine",
  "q", "category", "options", "deadline", "seconds", "out", "reason", "contestant", "won"]);

test("ADV leak: no Mob view carries the answer or anybody else's pick before reveal", () => {
  let s = phones(5, {}, () => 2);
  const check = (st, label) => {
    for (let i = 1; i <= 5; i += 1) {
      const pid = `p${i}`;
      const v = C.phoneView(st, pid);
      const json = JSON.stringify(v);
      Object.keys(v).forEach((k) => assert.ok(MOB_VIEW_KEYS.has(k), `${label}: unexpected key ${k}`));
      assert.ok(!/"answer"|"answers"|"correct"|"poll"|"counts"|"eliminated"|"ask"/.test(json), `${label} ${pid}: ${json}`);
      for (let j = 1; j <= 5; j += 1) if (j !== i) assert.ok(!json.includes(`"p${j}"`), `${label}: other pid`);
      if (v.mine !== undefined && v.mine !== null) assert.equal(v.mine, st.q.answers[pid], `${label}: own pick only`);
    }
  };
  check(s, "before open");
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  check(s, "open");
  [0, 1, 2, 2].forEach((idx, i) => { s = R(s, { type: "mobAnswer", pid: `p${i + 1}`, idx }, T0); check(s, `after ${i}`); });
  s = R(s, { type: "closeMob" });
  check(s, "closed");
  s = R(s, { type: "usePoll" });
  check(s, "after poll");
  s = R(s, { type: "useAsk" });
  check(s, "after ask");
  s = R(s, { type: "contestantLock", idx: 2 });
  check(s, "locked");
});

test("ADV leak: the contestant never sees the answer, and the split only after Poll", () => {
  let s = phones(4, {}, () => 1);
  const view = (label) => {
    const v = C.phoneView(s, "c1");
    assert.ok(!/"answer"|"answers"|"correct"|"mine"|"counts"/.test(JSON.stringify(v)), `${label}`);
    return v;
  };
  view("start");
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  s = run(s, [{ type: "mobAnswer", pid: "p1", idx: 1 }, { type: "mobAnswer", pid: "p2", idx: 0 }], T0);
  assert.equal(view("open").options, undefined, "contestant does not see options while the Mob answers");
  s = R(s, { type: "closeMob" });
  assert.equal(view("closed").poll, null);
  s = run(s, [{ type: "useAsk" }, { type: "useTrust" }]);
  assert.ok(!view("after ask+trust").poll);
});

/* ============ Immutability ============ */

test("ADV deep-frozen state survives every event in every phase", () => {
  const events = [
    { type: "openQuestion", now: T0 }, { type: "mobAnswer", pid: "p1", idx: 0 }, { type: "mobAnswer", pid: "p2", idx: 1 },
    { type: "closeMob" }, { type: "usePoll" }, { type: "useAsk" }, { type: "contestantLock", idx: 0 },
    { type: "reveal" }, { type: "continue" }, { type: "openQuestion", now: T0 }, { type: "closeMob" },
    { type: "useTrust" }, { type: "reveal" }, { type: "undo" }, { type: "undo" }, { type: "walk" }, { type: "finish" },
    { type: "simulateMob", wrong: 1 }, { type: "seat", pid: "p1" }, { type: "start" },
  ];
  let s = deepFreeze(phones(4, {}, () => 0));
  for (const ev of events) {
    for (const probe of events) R(s, probe, T0);
    C.legalActions(s); C.phoneView(s, "p1"); C.phoneView(s, "c1"); C.mobTiles(s); C.standings(s); C.split(s);
    s = deepFreeze(R(s, ev, T0));
  }
  let t = deepFreeze(sim(6, {}));
  for (let i = 0; i < 4 && t.phase !== "result"; i += 1) {
    t = deepFreeze(R(t, { type: "simulateMob", wrong: 1 }));
    t = deepFreeze(R(t, { type: "closeMob" }));
    t = deepFreeze(R(t, { type: "contestantLock", idx: ans(t) }));
    t = deepFreeze(R(t, { type: "reveal" }));
    t = deepFreeze(R(t, { type: "continue" }));
  }
  const setup = deepFreeze(C.createState(game({}), roster(3), {}));
  R(setup, { type: "seat", pid: "p2" });
  R(setup, { type: "simulateMob", size: 9 });
  const g = deepFreeze(game({}));
  C.normalizeGame(g);
});

/* ============ Undo ============ */

test("ADV undo across phases returns exactly to every earlier step", () => {
  let s = sim(6, {});
  const trail = [s];
  const steps = [
    { type: "simulateMob", wrong: 2 }, { type: "closeMob" }, { type: "usePoll" }, { type: "contestantLock" },
    { type: "reveal" }, { type: "continue" }, { type: "simulateMob", wrong: 1 }, { type: "closeMob" },
  ];
  steps.forEach((ev) => {
    const ev2 = ev.type === "contestantLock" ? { type: "contestantLock", idx: ans(s) } : ev;
    s = R(s, ev2);
    trail.push(s);
  });
  s = run(s, [{ type: "contestantLock", idx: wrongIdx(s) }, { type: "reveal" }]);
  assert.equal(s.phase, "result");
  s = R(s, { type: "undo" });
  assert.equal(s.phase, "question");
  assert.equal(s.q.locked, wrongIdx(s));
  s = R(s, { type: "undo" });
  const strip = (x) => { const c = Object.assign({}, x); delete c.history; return c; };
  for (let i = trail.length - 1; i >= 1; i -= 1) {
    assert.deepEqual(strip(s), strip(trail[i]), `undo back to step ${i}`);
    s = R(s, { type: "undo" });
  }
  assert.deepEqual(strip(s), strip(trail[0]));
  s = R(s, { type: "undo" });
  assert.equal(s.phase, "setup");
  assert.equal(R(s, { type: "undo" }), s, "nothing left to undo");
});

test("ADV undo of a running window returns it paused with its time and answers", () => {
  let s = phones(3);
  s = R(s, { type: "openQuestion", now: T0 }, T0);
  s = R(s, { type: "mobAnswer", pid: "p1", idx: 0 }, T0 + 5000);
  s = R(s, { type: "closeMob" }, T0 + 8000);
  const u = R(s, { type: "undo" }, T0 + 60000);
  assert.equal(u.q.open, false);
  assert.equal(u.q.closed, false);
  assert.equal(u.q.remainingMs, 12000);
  assert.deepEqual(u.q.answers, { p1: 0 });
});

test("ADV undo from standings / walk returns to the decision", () => {
  let s = simRound(sim(5, {}), 1);
  s = run(s, [{ type: "walk" }, { type: "finish" }]);
  assert.equal(s.phase, "standings");
  s = R(s, { type: "undo" });
  assert.equal(s.phase, "result");
  s = R(s, { type: "undo" });
  assert.equal(s.phase, "decision");
  assert.equal(s.outcome, null);
});

/* ============ Prototype-shaped events ============ */

test("ADV prototype-shaped event types and junk events leave state untouched", () => {
  const s = phones(3);
  ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf", "isPrototypeOf", "__defineGetter__", "", "UNDO", "Start"]
    .forEach((type) => assert.equal(R(s, { type }), s, type));
  [null, undefined, 5, "start", [], { type: 5 }, { type: null }].forEach((ev) => assert.equal(C.reduce(s, ev), s));
  assert.equal(C.reduce(null, { type: "start" }), null);
  assert.equal(({}).polluted, undefined);
  assert.equal(R(s, JSON.parse('{"type":"mobAnswer","pid":"__proto__","idx":0}'), T0), s);
});

/* ============ Roster and finish ============ */

test("ADV roster: duplicates, junk and oversize lists", () => {
  const g = game({});
  assert.throws(() => C.createState(g, [], {}));
  assert.throws(() => C.createState(g, "x", {}));
  assert.throws(() => C.createState(g, roster(17), {}), /at most/);
  const s = C.createState(g, [{ pid: "a", name: "A" }, { pid: "a", name: "B" }, null, { pid: "", name: "x" }, { pid: "b", name: "\u0000" }], {});
  assert.equal(s.roster.length, 1);
  assert.equal(C.createState(g, roster(2), {}).plan.simulated, true, "fewer than 3 Mob phones -> simulated");
  assert.equal(C.createState(g, roster(3), {}).plan.simulated, false);
});

test("ADV a phone Mob with zero phones cannot start", () => {
  const s = C.createState(game({}), [{ pid: "c1", name: "C" }], { simulated: false });
  const t = R(s, { type: "start" });
  assert.equal(t.phase, "setup");
  assert.match(t.notice, /Mob is empty/);
});

test("ADV finish mid-question banks what a walk would pay; finish from setup is refused", () => {
  let s = simRound(sim(5, {}), 2);
  s = R(s, { type: "continue" });
  const f = R(s, { type: "finish" });
  assert.equal(f.phase, "standings");
  assert.equal(f.outcome.won, 200);
  const setup = C.createState(game({}), roster(3), {});
  assert.equal(R(setup, { type: "finish" }), setup);
});

test("ADV standings: survivors carry their share after a loss", () => {
  let s = simRound(sim(4, {}), 1);                     // bank 100, 3 left
  s = simRound(R(s, { type: "continue" }), 0, false);
  const rows = C.standings(s);
  assert.equal(rows[0].won, 0);
  assert.deepEqual(rows.filter((r) => r.kind === "mob" && r.alive).map((r) => r.won), [33, 33, 33]);
});
