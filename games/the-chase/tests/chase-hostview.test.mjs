/* ============================================================
   The Chase — host phone selector (docs/22 §5.1, §5.5, §6; review F4)
   hostView holds the right answer at each phase, nothing in phases
   with no secret, and never the head-to-head answer while the host
   is playing the Chaser and has not locked. phoneView is unchanged
   by any of it.
   ============================================================ */

"use strict";

import test from "node:test";
import assert from "node:assert/strict";

import { Core, started, buildCash, play, rightIdx, tinyGame } from "./chase-fixtures.mjs";

const PLAYER_CHASER = { isHost: false, pid: "cx", name: "The Beast" };

function h2h(chaser) {
  return Core.reduce(buildCash(started({ chaser }), 3), { type: "offer", choice: "middle" }, 3000);
}

test("HV-1 setup, offers, result and standings: nothing secret", () => {
  assert.deepEqual(Core.hostView(null).secret, false);
  assert.equal(Core.hostView(null).note, "Nothing secret right now");
  const fresh = Core.createState(tinyGame(), { contestants: [{ pid: "p1", name: "Ada" }] });
  assert.equal(Core.hostView(fresh).secret, false);
  const offer = buildCash(started(), 2);
  assert.equal(offer.phase, "offer");
  const v = Core.hostView(offer);
  assert.equal(v.secret, false);
  assert.equal(v.phaseLabel, "The offers");
  assert.equal(JSON.stringify(v).includes("Answer"), false);
  const done = Core.reduce(offer, { type: "finish" }, 4000);
  assert.equal(Core.hostView(done).secret, false);
  assert.equal(Core.hostView(done).phase, "standings");
});

test("HV-2 Cash Builder: the question on the table, its answer and the next one", () => {
  let s = Core.reduce(started(), { type: "cbStart" }, 1000);
  let v = Core.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.item, "Rapid 1?");
  assert.equal(v.answer, "Answer 1");
  assert.deepEqual(v.next, { q: "Rapid 2?", a: "Answer 2" });
  assert.equal(v.who, "Ada");
  s = Core.reduce(s, { type: "cbMark", result: "correct" }, 1100);
  v = Core.hostView(s);
  assert.equal(v.item, "Rapid 2?");
  assert.equal(v.answer, "Answer 2");
  assert.equal(v.next.q, "Rapid 3?");
  // After the buzzer and the last judgement, nothing is on the table.
  s = Core.reduce(Core.reduce(s, { type: "cbExpired" }, 61000), { type: "nextQuestion" }, 61100);
  assert.equal(Core.hostView(s).secret, false);
});

test("HV-3 F4: with the host as the Chaser the right option is WITHHELD until he locks", () => {
  let s = h2h();
  assert.equal(s.chaser.isHost, true);
  let v = Core.hostView(s);
  assert.equal(v.withheld, true);
  assert.equal(v.correct, null);
  assert.equal(v.secret, false);
  assert.deepEqual(v.options, s.h2h.q.options);
  assert.equal("answer" in v, false);
  // Locking the CONTESTANT does not release it — only the Chaser's own lock does.
  s = Core.reduce(s, { type: "lock", side: "contestant", idx: 0 }, 4000);
  assert.equal(Core.hostView(s).correct, null);
  s = Core.reduce(s, { type: "lock", side: "chaser", idx: 2 }, 4100);
  v = Core.hostView(s);
  assert.equal(v.withheld, false);
  assert.equal(v.correct, s.h2h.q.answer);
  // Undo of the Chaser's lock withholds it again.
  s = Core.reduce(s, { type: "undo" }, 4200);
  assert.equal(Core.hostView(s).correct, null);
});

test("HV-4 with a player as the Chaser the right option shows at once", () => {
  const s = h2h(PLAYER_CHASER);
  const v = Core.hostView(s);
  assert.equal(v.withheld, false);
  assert.equal(v.correct, s.h2h.q.answer);
  assert.equal(v.hostIsChaser, false);
  assert.equal(v.who, "Ada");
});

test("HV-5 Final Chase: question, answer and the next one; a pushback keeps the missed question", () => {
  let s = h2h(PLAYER_CHASER);
  for (let i = 0; i < 4 && !s.h2h.outcome; i += 1) {
    s = play(s, [
      { type: "lock", side: "contestant", idx: rightIdx(s) },
      { type: "lock", side: "chaser", idx: (rightIdx(s) + 1) % 3 },
      { type: "revealContestant" }, { type: "revealChaser" },
    ], 5000 + i * 100);
    if (!s.h2h.outcome) s = Core.reduce(s, { type: "nextQuestion" }, 5050 + i * 100);
  }
  for (let seat = 1; seat < 3; seat += 1) {
    s = Core.reduce(s, { type: "nextContestant" }, 9000 + seat);
    s = Core.reduce(buildCash(s, 0, 10000 * seat), { type: "offer", choice: "lower" }, 10500 * seat);
    while (!s.h2h.outcome) {
      s = play(s, [
        { type: "lock", side: "contestant", idx: (rightIdx(s) + 1) % 3 },
        { type: "lock", side: "chaser", idx: rightIdx(s) },
        { type: "revealContestant" }, { type: "revealChaser" },
      ], 11000 * seat);
      if (!s.h2h.outcome) s = Core.reduce(s, { type: "nextQuestion" }, 11500 * seat);
    }
  }
  s = Core.reduce(s, { type: "nextContestant" }, 90000);
  assert.equal(s.phase, "finalTeam");
  let v = Core.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.item, s.final.item.q);
  assert.equal(v.answer, s.final.item.a);
  assert.ok(v.next && v.next.q);
  s = Core.reduce(s, { type: "finalTeamStart" }, 100000);
  s = Core.reduce(s, { type: "finalTeamExpired" }, 220000);
  assert.equal(Core.hostView(s).secret, false, "between the halves nothing is on the table");
  s = Core.reduce(s, { type: "nextQuestion" }, 221000);
  s = Core.reduce(s, { type: "finalChaserStart" }, 222000);
  const missed = s.final.item;
  s = Core.reduce(s, { type: "finalChaserMark", result: "wrong" }, 223000);
  v = Core.hostView(s);
  assert.equal(v.pushback, true);
  assert.equal(v.item, missed.q);
  assert.equal(v.answer, missed.a);
  assert.equal(v.hostIsChaser, false);
});

test("HV-6 a host view is small, serialisable and never mutates the state", () => {
  const s = Core.reduce(started(), { type: "cbStart" }, 1000);
  const before = JSON.stringify(s);
  const json = JSON.stringify(Core.hostView(s));
  assert.equal(JSON.stringify(s), before);
  assert.ok(json.length < 16384);
  assert.deepEqual(JSON.parse(json), Core.hostView(s), "deterministic");
});

test("HV-7 phoneView is unchanged by the host phone: no answer reaches a contestant", () => {
  const s = Core.reduce(started(), { type: "cbStart" }, 1000);
  for (const pid of ["p1", "p2", "p3"]) {
    const text = JSON.stringify(Core.phoneView(s, pid));
    assert.equal(text.includes("Answer 1"), false);
    assert.equal(text.includes("Rapid 1?"), false);
  }
  const b = h2h();
  assert.equal(Core.phoneView(b, "p1").answer, undefined);
});
