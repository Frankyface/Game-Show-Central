/* ============================================================
   The Chase — adversarial suite (independent tester)
   Tries to break the pure core against spec 15 and the rule
   choices in docs/reports/the-chase-implementation.md. Pure
   core only: `now` injected, no DOM.
   ============================================================ */

"use strict";

import test from "node:test";
import assert from "node:assert/strict";

import {
  Core, tinyGame, TEAM, started, play, buildCash, playH2h, rightIdx, wrongIdx, seeded,
} from "./chase-fixtures.mjs";

const PLAYER_CHASER = { isHost: false, pid: "cx", name: "The Beast" };
const ALL_PIDS = ["p1", "p2", "p3", "cx", "ghost"];

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

/** Reach the head-to-head for the hot seat with `cash` correct and offer `choice`. */
function toBoard(state, cash, choice) {
  const s = buildCash(state, cash);
  return Core.reduce(s, { type: "offer", choice: choice || "middle" }, 3000);
}

/** Play contestants to an outcome each: true = home, false = caught. */
function playSeat(s, home) {
  s = toBoard(s, 2);
  let guard = 0;
  while (!s.h2h.outcome && guard < 40) {
    s = home ? playH2h(s, true, false) : playH2h(s, false, true);
    if (!s.h2h.outcome) s = Core.reduce(s, { type: "nextQuestion" }, 5000);
    guard += 1;
  }
  return s;
}

function toFinal(homes, opts) {
  const o = Object.assign({}, opts);
  if (!o.contestants) o.contestants = TEAM.concat([{ pid: "p4", name: "Dot" }]).slice(0, homes.length);
  let s = started(o);
  homes.forEach((home, i) => {
    s = playSeat(s, home);
    if (i < homes.length - 1) s = Core.reduce(s, { type: "nextContestant" }, 6000);
  });
  return Core.reduce(s, { type: "nextContestant" }, 7000);
}

/* ============ Cash Builder ============ */

test("ADV-CB the question in flight at the buzzer: correct pays, wrong does not, wave-away does not", () => {
  const base = (() => {
    let s = Core.reduce(started(), { type: "cbStart" }, 1000);
    s = play(s, [1, 2, 3].map(() => ({ type: "cbMark", result: "correct" })), 1000);
    return Core.reduce(s, { type: "cbExpired" }, 61000);
  })();
  assert.equal(base.cb.expired, true);
  assert.equal(Core.cashTotal(base), 3000);
  const right = Core.reduce(base, { type: "cbMark", result: "correct" }, 61100);
  assert.equal(right.cb.finished, true);
  assert.equal(right.results[0].cash, 4000, "the in-flight correct answer counts");
  assert.equal(Core.reduce(right, { type: "cbMark", result: "correct" }, 61200), right, "only ONE in-flight mark");
  const wrong = Core.reduce(base, { type: "cbMark", result: "wrong" }, 61100);
  assert.equal(wrong.results[0].cash, 3000);
  const waved = Core.reduce(base, { type: "nextQuestion" }, 61100);
  assert.equal(waved.cb.finished, true);
  assert.equal(waved.results[0].cash, 3000);
  assert.equal(Core.reduce(waved, { type: "cbMark", result: "correct" }, 61200), waved);
  // expiry is idempotent and refused while paused
  assert.equal(Core.reduce(base, { type: "cbExpired" }, 62000), base);
  let p = Core.reduce(started(), { type: "cbStart" }, 1000);
  p = Core.reduce(p, { type: "cbPause" }, 5000);
  assert.equal(p.cb.clock.remainingMs, 56000);
  assert.equal(Core.reduce(p, { type: "cbExpired" }, 9e9), p, "a paused clock cannot expire");
  assert.equal(Core.reduce(p, { type: "cbMark", result: "correct" }, 6000), p, "no marks off the clock");
});

test("ADV-CB a clock frozen at 0 ms (restore after the deadline) — reducer has no way forward", () => {
  // Documents why chasePauseRestored must not freeze an already-dead clock:
  // a paused clock with 0 ms left accepts no start, no expiry, no mark, no next.
  let s = Core.reduce(started(), { type: "cbStart" }, 1000);
  const frozen = Core.reduce(s, { type: "cbPause" }, 999999);
  assert.equal(frozen.cb.clock.remainingMs, 0);
  for (const ev of [{ type: "cbStart" }, { type: "cbExpired" }, { type: "cbMark", result: "correct" },
    { type: "nextQuestion" }]) {
    assert.equal(Core.reduce(frozen, ev, 1e7), frozen, `${ev.type} is refused on a dead paused clock`);
  }
});

/* ============ Offers ============ */

test("ADV-OFFER maths: rounding, $0 builder, clamps", () => {
  let s = buildCash(started(), 0);
  let o = Core.offers(s);
  // D5 (fixed by the implementer): with $0 built the offers are worked out as if
  // one Cash Builder answer had landed, so they run high > middle > low.
  assert.deepEqual([o.higher.amount, o.middle.amount, o.lower.amount], [5000, 1000, 500]);
  assert.deepEqual([o.higher.step, o.middle.step, o.lower.step], [4, 3, 2]);
  assert.ok(o.higher.amount > o.middle.amount && o.middle.amount > o.lower.amount);
  s = buildCash(started({ settings: { cashBuilderValue: 333 } }), 1);
  o = Core.offers(s);
  assert.equal(o.lower.amount, 167, "333 / 2 rounds half up");
  assert.equal(o.higher.amount, 1665);
  s = buildCash(started({ settings: { cashBuilderValue: 1, lowerDivisor: 10 } }), 1);
  assert.equal(Core.offers(s).lower.amount, 1, "never rounds down to zero");
  s = buildCash(started({ settings: { steps: 12, startStep: 10 } }), 2);
  o = Core.offers(s);
  assert.deepEqual([o.higher.step, o.middle.step, o.lower.step], [11, 10, 9]);
  for (const choice of ["__proto__", "constructor", "toString", "", null, 1]) {
    assert.equal(Core.reduce(s, { type: "offer", choice }, 1), s);
  }
});

/* ============ Head to head: a model check ============ */

function modelChase(startPos, steps, rng) {
  let s = toBoard(started({ settings: { steps } }), 2,
    startPos === "higher" ? "higher" : startPos === "lower" ? "lower" : "middle");
  let c = s.h2h.cPos;
  let h = s.h2h.hPos;
  for (let q = 0; q < 60 && !s.h2h.outcome; q += 1) {
    const cr = rng() < 0.6;
    const hr = rng() < 0.75;
    // the Chaser cannot be revealed first
    const early = Core.reduce(Core.reduce(Core.reduce(s, { type: "lock", side: "contestant", idx: 0 }, 1),
      { type: "lock", side: "chaser", idx: 0 }, 2), { type: "revealChaser" }, 3);
    assert.equal(early.h2h.revealed.chaser, false, "Chaser before contestant is refused");
    s = playH2h(s, cr, hr);
    if (cr) c -= 1;
    if (c === 0) {
      assert.equal(s.h2h.outcome, "home");
      assert.equal(s.h2h.revealed.chaser, false, "home banks before the Chaser is shown");
      break;
    }
    if (hr) h -= 1;
    assert.equal(s.h2h.cPos, c);
    assert.equal(s.h2h.hPos, h);
    if (h <= c) { assert.equal(s.h2h.outcome, "caught"); break; }
    assert.equal(s.h2h.outcome, null);
    s = Core.reduce(s, { type: "nextQuestion" }, 9000);
  }
  return s;
}

test("ADV-H2H movement matches a hand model at every step (500 seeded chases, every offer, 3 board sizes)", () => {
  const rng = seeded(42);
  let homes = 0;
  let caughts = 0;
  for (let i = 0; i < 500; i += 1) {
    const choice = ["higher", "middle", "lower"][i % 3];
    const s = modelChase(choice, [7, 9, 12][i % 3], rng);
    if (s.h2h.outcome === "home") homes += 1;
    if (s.h2h.outcome === "caught") caughts += 1;
  }
  assert.ok(homes > 20 && caughts > 20, `both endings exercised (${homes}/${caughts})`);
});

test("ADV-H2H contestant reaches home on the same question the Chaser would catch: home wins", () => {
  // contestant 1 from home, Chaser 2 away: both right on the same question.
  let s = toBoard(started(), 2, "middle");
  s = playH2h(s, true, false);  // c 2, h 7
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, false, true);  // c 2, h 6
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, false, true);  // c 2, h 5
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, true, true);   // c 1, h 4
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, false, true);  // c 1, h 3
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, false, true);  // c 1, h 2
  assert.deepEqual([s.h2h.cPos, s.h2h.hPos, s.h2h.outcome], [1, 2, null]);
  s = Core.reduce(s, { type: "nextQuestion" }, 1);
  s = playH2h(s, true, true);
  assert.equal(s.h2h.outcome, "home");
  assert.equal(s.results[0].outcome, "home");
  assert.equal(s.results[0].amount, 2000);
});

test("ADV-H2H locks: illegal idx, wrong side, after outcome", () => {
  const s = toBoard(started(), 1);
  for (const idx of [-1, 3, 1.5, "1", null, NaN, Infinity]) {
    assert.equal(Core.reduce(s, { type: "lock", side: "contestant", idx }, 1), s);
  }
  for (const side of ["host", "__proto__", "", null]) {
    assert.equal(Core.reduce(s, { type: "lock", side, idx: 0 }, 1), s);
  }
  const done = playSeat(started(), true);
  assert.equal(Core.reduce(done, { type: "lock", side: "chaser", idx: 0 }, 1), done);
});

/* ============ Head start ============ */

test("ADV-FINAL head start for 0/1/2/3 home", () => {
  const four = TEAM.concat([{ pid: "p4", name: "Dot" }]);
  const cases = [[[false, false, false], 0], [[true, false, false], 1], [[true, true, false], 2],
    [[true, true, true], 3], [[true, true, true, true], 4]];
  for (const [homes, want] of cases) {
    const s = toFinal(homes, { contestants: four.slice(0, homes.length) });
    if (want === 0) {
      assert.equal(s.phase, "result");
      assert.equal(s.outcome.played, false);
      continue;
    }
    assert.equal(s.final.headStart, want, `${want} home`);
    assert.equal(s.final.teamSteps, want);
  }
  const lone = toFinal([true, false], { settings: { headStartPerMember: 1, minHeadStart: 2 } });
  assert.equal(lone.final.headStart, 2, "minHeadStart lifts a lone finalist");
});

/* ============ Final Chase ============ */

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

test("ADV-FINAL pushbacks: every miss is offered, the clock stops, at zero it is a no-op", () => {
  let s = chaserHalf(5);
  // D3: a Pass is a miss too, and is offered to the team.
  const passed = Core.reduce(s, { type: "finalChaserMark", result: "pass" }, 200100);
  assert.ok(passed.final.pushback, "a Pass is offered to the team");
  assert.equal(passed.final.pushback.miss, "pass");
  s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 200100);
  // D4: the Chaser's clock stops while the team answer, and cannot be restarted under it.
  assert.equal(s.final.chaserClock.running, false);
  assert.equal(s.final.chaserClock.remainingMs, 119900);
  assert.equal(Core.reduce(s, { type: "finalChaserStart" }, 200150), s);
  assert.equal(Core.reduce(s, { type: "finalChaserExpired" }, 999999), s, "no expiry mid-pushback");
  const at0 = Core.reduce(s, { type: "pushback", correct: true }, 200200);
  assert.equal(at0.final.chaserSteps, 0, "a pushback at 0 changes nothing (no extra team step)");
  assert.equal(at0.final.teamSteps, 5);
  assert.equal(at0.final.pushbacks, 0, "only a pushback that moved him counts");
  assert.equal(at0.final.chaserClock.running, true, "the clock restarts after the pushback");
  assert.equal(at0.final.chaserClock.deadline, 200200 + 119900);
  for (const correct of ["yes", 1, null, undefined]) {
    assert.equal(Core.reduce(s, { type: "pushback", correct }, 1), s);
  }
});

test("ADV-FINAL both endings and the split per member", () => {
  // ending one: caught exactly on the target, Chaser clock stops where it stood
  let s = chaserHalf(3);
  s = play(s, [1, 2, 3].map(() => ({ type: "finalChaserMark", result: "correct" })), 200000);
  assert.equal(s.outcome.teamWon, false);
  assert.ok(s.outcome.share.every((x) => x.amount === 0));
  const caughtView = Core.phoneView(s, "p1");
  assert.equal(caughtView.screen, "result");
  // ending two: the time runs out
  let t = chaserHalf(6, [true, true, true]);
  t = Core.reduce(t, { type: "finalChaserExpired" }, 999999);
  assert.equal(t.outcome.teamWon, true);
  const bank = Core.bank(t);
  const total = t.outcome.share.reduce((n, x) => n + x.amount, 0);
  assert.equal(total, bank, "the split adds up to the bank exactly");
  assert.deepEqual(t.outcome.share.map((x) => x.pid), ["p1", "p2", "p3"]);
  const st = Core.standings(t);
  st.forEach((row) => {
    assert.equal(row.winnings, t.outcome.share.find((x) => x.pid === row.pid).amount);
  });
  assert.deepEqual(Core.splitBank(10001, [{ pid: "a" }, { pid: "b" }, { pid: "c" }]).map((x) => x.amount),
    [3334, 3334, 3333]);
  // a caught contestant takes nothing even when the team wins
  let u = chaserHalf(6, [true, false, true]);
  u = Core.reduce(u, { type: "finalChaserExpired" }, 999999);
  const st2 = Core.standings(u);
  assert.equal(st2[1].winnings, 0);
  assert.ok(st2[0].winnings > 0 && st2[2].winnings > 0);
});

test("ADV-FINAL the phone result line after a catch does not say '0 to spare'", () => {
  let s = chaserHalf(3);
  s = play(s, [1, 2, 3].map(() => ({ type: "finalChaserMark", result: "correct" })), 200000);
  const sub = Core.phoneView(s, "p1").sub;
  assert.doesNotMatch(sub, /with 0 to spare/, `phone result line: ${sub}`);
  assert.match(sub, /seconds to spare/);
});

/* ============ Leaks: differential, every pid x every state ============ */

/**
 * Two games that differ ONLY in one side's lock. Before that side is revealed,
 * every OTHER pid's phone view must be identical in both games.
 */
function leakWalk(lockingSide) {
  const runs = [0, 1, 2].map((secret) => {
    const views = [];
    let s = toBoard(started({ chaser: PLAYER_CHASER }), 2);
    for (let q = 0; q < 6 && !s.h2h.outcome; q += 1) {
      const ans = rightIdx(s);
      const other = lockingSide === "chaser" ? "contestant" : "chaser";
      s = Core.reduce(s, { type: "lock", side: lockingSide, idx: secret }, 1);
      views.push(ALL_PIDS.map((pid) => JSON.stringify(Core.phoneView(s, pid))));
      s = Core.reduce(s, { type: "lock", side: other, idx: (ans + 1) % 3 }, 2);
      views.push(ALL_PIDS.map((pid) => JSON.stringify(Core.phoneView(s, pid))));
      if (lockingSide === "chaser") {
        s = Core.reduce(s, { type: "revealContestant" }, 3);
        if (!s.h2h.outcome) views.push(ALL_PIDS.map((pid) => JSON.stringify(Core.phoneView(s, pid))));
      }
      // stop at this side's reveal; then force a consistent continuation
      s = Core.reduce(s, { type: "lock", side: lockingSide, idx: (ans + 1) % 3 }, 4);
      s = play(s, [{ type: "revealContestant" }, { type: "revealChaser" }], 5);
      if (!s.h2h.outcome) s = Core.reduce(s, { type: "nextQuestion" }, 6);
    }
    return views;
  });
  const lockerPid = lockingSide === "chaser" ? "cx" : "p1";
  ALL_PIDS.forEach((pid, k) => {
    if (pid === lockerPid) return;
    runs[0].forEach((row, step) => {
      assert.equal(runs[1][step][k], row[k], `${pid} sees the ${lockingSide}'s lock at step ${step}`);
      assert.equal(runs[2][step][k], row[k], `${pid} sees the ${lockingSide}'s lock at step ${step}`);
    });
  });
  // and the answer index never travels before both sides are shown
  runs[0].forEach((row) => row.forEach((json) => {
    const v = JSON.parse(json);
    if (!v.outcome && !(v.revealed && v.revealed.contestant && v.revealed.chaser)) {
      assert.equal("answer" in v, false, "answer travelled before both reveals");
    }
  }));
}

test("ADV-LEAK the Chaser's lock is invisible to every other phone before the reveal", () => leakWalk("chaser"));
test("ADV-LEAK the contestant's lock is invisible to every other phone before the reveal", () => leakWalk("contestant"));

test("ADV-LEAK no rapid-fire question or answer reaches any phone, all night, in every phase", () => {
  const rng = seeded(7);
  let s = started({ chaser: PLAYER_CHASER });
  const check = (st) => ALL_PIDS.forEach((pid) => {
    const json = JSON.stringify(Core.phoneView(st, pid));
    assert.doesNotMatch(json, /Rapid \d|Answer \d/, `${st.phase} → ${pid}`);
  });
  check(s);
  for (let seat = 0; seat < 3; seat += 1) {
    s = Core.reduce(s, { type: "cbStart" }, 1000);
    check(s);
    for (let i = 0; i < 4; i += 1) { s = Core.reduce(s, { type: "cbMark", result: "correct" }, 1001 + i); check(s); }
    s = Core.reduce(s, { type: "cbExpired" }, 70000); check(s);
    s = Core.reduce(s, { type: "nextQuestion" }, 70001); check(s);
    s = Core.reduce(s, { type: "nextQuestion" }, 70002); check(s);
    s = Core.reduce(s, { type: "offer", choice: "middle" }, 70003); check(s);
    while (!s.h2h.outcome) {
      s = playH2h(s, rng() < 0.8, rng() < 0.5); check(s);
      if (!s.h2h.outcome) s = Core.reduce(s, { type: "nextQuestion" }, 70004);
    }
    s = Core.reduce(s, { type: "nextContestant" }, 70005); check(s);
  }
  if (s.phase === "finalTeam") {
    s = Core.reduce(s, { type: "finalTeamStart" }, 80000); check(s);
    s = Core.reduce(s, { type: "finalTeamMark", result: "correct" }, 80001); check(s);
    s = Core.reduce(s, { type: "finalTeamExpired" }, 999999); check(s);
    s = Core.reduce(s, { type: "nextQuestion" }, 1e6); check(s);
    s = Core.reduce(s, { type: "finalChaserStart" }, 1e6); check(s);
    s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 1e6 + 1); check(s);
    assert.ok(s.final.pushback);
    s = Core.reduce(s, { type: "finalChaserExpired" }, 9e9); check(s);
  }
  s = Core.reduce(s, { type: "nextQuestion" }, 9e9); check(s);
});

/* ============ Chaser as a player ============ */

test("ADV-CHASER the lock path for a player Chaser", () => {
  let s = toBoard(started({ chaser: PLAYER_CHASER }), 2);
  assert.equal(Core.lockSideFor(s, "cx"), "chaser");
  assert.equal(Core.lockSideFor(s, "p1"), "contestant");
  assert.equal(Core.lockSideFor(s, "p2"), null);
  assert.equal(Core.lockSideFor(s, "ghost"), null);
  assert.equal(Core.phoneView(s, "cx").screen, "chaser");
  assert.equal(Core.phoneView(s, "p2").screen, "wait");
  assert.equal("q" in Core.phoneView(s, "p2"), false, "spectators get no question");
  s = play(s, [{ type: "lock", side: "contestant", idx: 0 }, { type: "lock", side: "chaser", idx: 1 },
    { type: "revealContestant" }]);
  if (!s.h2h.outcome) {
    assert.equal(Core.lockSideFor(s, "p1"), null, "revealed contestant cannot re-lock");
    assert.equal(Core.lockSideFor(s, "cx"), "chaser", "Chaser may still change before his reveal");
    s = Core.reduce(s, { type: "revealChaser" }, 9);
    assert.equal(Core.lockSideFor(s, "cx"), null);
  }
  const hosted = toBoard(started(), 2);
  ALL_PIDS.forEach((pid) => assert.notEqual(Core.lockSideFor(hosted, pid), "chaser"));
  assert.throws(() => started({ chaser: { isHost: false, pid: "p1", name: "X" } }), /cannot also be a contestant/);
  assert.throws(() => started({ chaser: { isHost: false, pid: "", name: "X" } }), /Pick the player/);
});

/* ============ Validator fuzz ============ */

test("ADV-VALID boundary files", () => {
  const g = () => tinyGame();
  const bad = [
    (x) => { x.rapid = x.rapid.slice(0, 79); },
    (x) => { x.multi = x.multi.slice(0, 39); },
    (x) => { x.multi[0].options = ["a", "b"]; },
    (x) => { x.multi[0].options = ["a", "b", "c", "d"]; },
    (x) => { x.multi[0].answer = 3; },
    (x) => { x.multi[0].answer = "1"; },
    (x) => { x.multi[0].answer = 1.5; },
    (x) => { x.multi[0].options = ["Red", "red ", "Blue"]; },
    (x) => { x.settings.steps = 2; },
    (x) => { x.settings.startStep = 1; },
    (x) => { x.settings.startStep = 6; },
    (x) => { x.settings.steps = 7.5; },
    (x) => { x.settings.chaserIsHost = "yes"; },
    (x) => { x.settings.currency = "EURO"; },
    (x) => { x.rapid[3] = null; },
    (x) => { x.rapid[3] = { q: "   ", a: "x" }; },
    (x) => { x.rapid[3] = { q: "\u0000\u0007", a: "x" }; },
    (x) => { x.rapid[4] = { q: x.rapid[5].q.toUpperCase(), a: "x" }; },
    (x) => { x.rapid[3].a = 5; },
    (x) => { x.multi[2] = []; },
    (x) => { x.multi[2].options = [1, 2, 3]; },
    (x) => { x.title = 7; },
    (x) => { x.settings = []; },
    (x) => { x.rapid = {}; },
  ];
  bad.forEach((mutate, i) => {
    const x = g();
    mutate(x);
    assert.throws(() => Core.validateGame(x), (err) => err instanceof Error && !(err instanceof TypeError)
      && err.message.length > 10, `case ${i}`);
  });
  const ok = g();
  ok.rapid = ok.rapid.slice(0, 80);
  ok.multi = ok.multi.slice(0, 40);
  assert.equal(Core.validateGame(ok), true);
  for (const junk of [undefined, null, 0, "x", [], true, () => 1]) {
    assert.throws(() => Core.validateGame(junk), /not a Chase game/);
  }
});

test("ADV-VALID random junk never produces a TypeError and never pollutes prototypes", () => {
  const rng = seeded(99);
  const junk = () => {
    const pick = Math.floor(rng() * 10);
    return [null, undefined, 0, -1, 1e9, "", "x".repeat(300), [], {}, [null]][pick];
  };
  for (let i = 0; i < 2000; i += 1) {
    const x = tinyGame();
    const where = Math.floor(rng() * 6);
    if (where === 0) x.rapid[Math.floor(rng() * 90)] = junk();
    if (where === 1) x.multi[Math.floor(rng() * 45)] = junk();
    if (where === 2) x.multi[Math.floor(rng() * 45)].options = junk();
    if (where === 3) x.multi[Math.floor(rng() * 45)].answer = junk();
    if (where === 4) x.settings[Object.keys(x.settings)[Math.floor(rng() * 12)]] = junk();
    if (where === 5) x.rapid[Math.floor(rng() * 90)].q = junk();
    try { Core.validateGame(x); } catch (err) {
      assert.ok(!(err instanceof TypeError), `TypeError: ${err.message}`);
    }
  }
  const evil = JSON.parse('{"settings":{"__proto__":{"polluted":1,"steps":99}},"rapid":[],"multi":[]}');
  const x = tinyGame();
  x.settings = evil.settings;
  Core.validateGame(x);
  const norm = Core.normalizeGame(x);
  assert.equal(norm.settings.steps, 7);
  assert.equal(({}).polluted, undefined, "Object.prototype untouched");
});

/* ============ Phone message fuzz ============ */

test("ADV-PHONE only {t:ready} and {t:lock, idx 0-2} survive, as narrow copies", () => {
  const rng = seeded(5);
  const vals = [null, undefined, 0, 1, 2, 3, -1, 1.5, "1", NaN, Infinity, [], {}, "lock", "ready", true];
  for (let i = 0; i < 3000; i += 1) {
    const msg = { t: ["lock", "ready", "mark", "reveal", "__proto__", "toString", ""][Math.floor(rng() * 7)] };
    if (rng() < 0.8) msg.idx = vals[Math.floor(rng() * vals.length)];
    if (rng() < 0.3) msg.side = "chaser";
    if (rng() < 0.3) msg.result = "correct";
    const out = Core.validatePhoneMsg(msg);
    if (out === null) continue;
    if (out.t === "ready") assert.deepEqual(out, { t: "ready" });
    else {
      assert.deepEqual(Object.keys(out).sort(), ["idx", "t"]);
      assert.ok([0, 1, 2].includes(out.idx));
    }
  }
  for (const raw of [null, "lock", 3, [], ["lock"], { t: 1 }, Object.create(null)]) {
    assert.equal(Core.validatePhoneMsg(raw), null);
  }
});

/* ============ Immutability, undo, prototype names ============ */

test("ADV-IMMUTABLE a whole night runs on deep-frozen states", () => {
  const rng = seeded(3);
  let s = deepFreeze(started({ chaser: PLAYER_CHASER }));
  const step = (ev, at) => { s = deepFreeze(Core.reduce(s, ev, at)); };
  for (let seat = 0; seat < 3; seat += 1) {
    step({ type: "cbStart" }, 1000);
    step({ type: "cbMark", result: "correct" }, 1001);
    step({ type: "cbPause" }, 1002);
    step({ type: "cbStart" }, 1003);
    step({ type: "cbExpired" }, 70000);
    step({ type: "cbMark", result: "wrong" }, 70001);
    step({ type: "undo" }, 70002);
    step({ type: "nextQuestion" }, 70003);
    step({ type: "nextQuestion" }, 70004);
    step({ type: "offer", choice: ["higher", "middle", "lower"][seat] }, 70005);
    while (!s.h2h.outcome) {
      step({ type: "lock", side: "contestant", idx: rng() < 0.8 ? s.h2h.q.answer : (s.h2h.q.answer + 1) % 3 }, 1);
      step({ type: "lock", side: "chaser", idx: Math.floor(rng() * 3) }, 2);
      step({ type: "revealContestant" }, 3);
      step({ type: "revealChaser" }, 4);
      if (!s.h2h.outcome) step({ type: "nextQuestion" }, 5);
    }
    step({ type: "nextContestant" }, 6);
  }
  if (s.phase === "finalTeam") {
    step({ type: "finalTeamStart" }, 10);
    step({ type: "finalTeamMark", result: "correct" }, 11);
    step({ type: "finalTeamPause" }, 12);
    step({ type: "finalTeamStart" }, 13);
    step({ type: "finalTeamExpired" }, 1e6);
    step({ type: "nextQuestion" }, 1e6);
    step({ type: "finalChaserStart" }, 1e6);
    step({ type: "finalChaserMark", result: "wrong" }, 1e6 + 1);
    step({ type: "pushback", correct: true }, 1e6 + 2);
    step({ type: "finalChaserMark", result: "correct" }, 1e6 + 3);
    step({ type: "finalChaserExpired" }, 9e9);
  }
  step({ type: "nextQuestion" }, 9e9);
  step({ type: "finish" }, 9e9);
  assert.equal(s.phase, "standings");
  ALL_PIDS.forEach((pid) => Core.phoneView(s, pid));
  Core.board(s); Core.standings(s); Core.offers(s);
});

test("ADV-UNDO walks back across every phase boundary", () => {
  const s0 = started();
  const s1 = buildCash(s0, 2);                                  // offer
  const s2 = Core.reduce(s1, { type: "offer", choice: "higher" }, 1);
  assert.equal(s2.phase, "headToHead");
  const back = Core.reduce(s2, { type: "undo" }, 2);
  assert.equal(back.phase, "offer");
  assert.equal(back.results[0].choice, null);
  // offer -> cashBuilder (finished)
  const back2 = Core.reduce(back, { type: "undo" }, 3);
  assert.equal(back2.phase, "cashBuilder");
  // h2h outcome -> undo -> no outcome, row reset
  const home = playSeat(started(), true);
  const undone = Core.reduce(home, { type: "undo" }, 4);
  assert.equal(undone.h2h.outcome, null);
  assert.equal(undone.results[0].outcome, "pending");
  // the Final Chase result -> undo -> the Chaser's half again
  let f = chaserHalf(3);
  f = play(f, [1, 2, 3].map(() => ({ type: "finalChaserMark", result: "correct" })), 200000);
  assert.equal(f.phase, "result");
  const u = Core.reduce(f, { type: "undo" }, 200100);
  assert.equal(u.phase, "finalChaser");
  assert.equal(u.final.chaserSteps, 2);
  assert.equal(u.outcome, null);
  // standings -> result
  const st = Core.reduce(f, { type: "nextQuestion" }, 1);
  assert.equal(Core.reduce(st, { type: "undo" }, 2).phase, "result");
  // nextContestant -> back to the interstitial
  const next = Core.reduce(home, { type: "nextContestant" }, 5);
  assert.equal(next.phase, "cashBuilder");
  assert.equal(Core.reduce(next, { type: "undo" }, 6).h2h.outcome, "home");
  // history never nests
  assert.ok(u.history.every((h) => h.history.length === 0));
});

test("ADV-PROTO prototype-shaped event types are ignored without throwing", () => {
  const s = toBoard(started(), 2);
  for (const type of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "__defineGetter__", "propertyIsEnumerable"]) {
    assert.equal(Core.reduce(s, { type }, 1), s, type);
  }
  for (const ev of [null, undefined, "start", 1, [], { type: 5 }, { type: { toString: () => "start" } }]) {
    assert.equal(Core.reduce(s, ev, 1), s);
  }
  const evil = JSON.parse('{"type":"lock","side":"contestant","idx":0,"__proto__":{"side":"chaser"}}');
  const out = Core.reduce(s, evil, 1);
  assert.equal(out.h2h.locks.contestant, 0);
  assert.equal(out.h2h.locks.chaser, null);
});
