/* Family Feud - ADVERSARIAL tests (independent tester, spec 03).
   Written against docs/03-family-feud-spec.md S1 (normative rules), S2 (content
   schema), S4 (core API) and S5 (phone payloads) by someone who did NOT write
   the implementation. Goal: break it. node:test + node:assert only.
   Run from games/family-feud:  node --test */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import FC from "../js/feud-core.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));

/* ---------------- helpers ---------------- */

const clone = (v) => JSON.parse(JSON.stringify(v));
const run = (state, ...events) => events.reduce((s, e) => FC.reduce(s, e), state);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k]));
  return value;
}

/** `n` answers with descending counts starting at `top`. */
const answers = (...counts) =>
  counts.map((c, i) => ({ text: `A${i + 1}`, count: c }));

const q = (question, ...counts) => ({ question, answers: answers(...counts) });

/** A legal 6-round game (exercises the multiplier ladder past its 4 entries). */
function sixRoundGame(extra) {
  return {
    title: "Six",
    rounds: [
      q("R1", 50, 30, 10),
      q("R2", 40, 25, 15),
      q("R3", 44, 22, 11),
      q("R4", 33, 21, 12),
      q("R5", 30, 20, 10),
      q("R6", 28, 18, 9),
    ],
    fastMoney: [
      q("F1", 60, 25, 10), q("F2", 50, 30, 5), q("F3", 40, 30, 20),
      q("F4", 35, 30, 25), q("F5", 45, 25, 15), q("F6", 20, 15, 10),
    ],
    ...extra,
  };
}

/** Start of round 1, two phone players seated, face-off live. */
function atFaceoff(game = sixRoundGame()) {
  return run(FC.createState(game, {}),
    { type: "setTeam", pid: "p1", team: "A" },
    { type: "setTeam", pid: "p2", team: "B" },
    { type: "start" });
}
/* ===== 1. §1 rules — face-off ===== */

test("ADV face-off: two board answers of the same COUNT are ranked by board index", () => {
  // Both #2 and #3 are worth 20; the higher-ranked (lower index) tile must win.
  const game = { rounds: [q("Tie", 40, 20, 20, 5)] };
  let s = atFaceoff(game);
  s = run(s, { type: "buzz", team: "B", host: true }, { type: "reveal", index: 2 });
  assert.equal(s.phase, "faceoff", "B's #3 is not the top answer — A gets a turn");
  assert.equal(s.faceoff.buzzed, 0);
  s = FC.reduce(s, { type: "reveal", index: 1 });
  assert.equal(s.phase, "playpass");
  assert.equal(s.control, 0, "index 1 outranks index 2 even though the counts are equal");
  assert.equal(s.bank, 40, "both face-off answers stay in the bank");
});

test("ADV face-off: the second podium cannot re-reveal the first podium's tile", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 1 });
  const before = s;
  const same = FC.reduce(s, { type: "reveal", index: 1 });
  assert.equal(same, before, "an already-revealed tile is a no-op, so ranks can never tie");
  assert.equal(s.faceoff.attempts.length, 1);
});

test("ADV face-off: clicking a tile before anyone buzzed changes nothing", () => {
  const s = deepFreeze(atFaceoff());
  [0, 1, 2].forEach((index) => {
    assert.equal(FC.reduce(s, { type: "reveal", index }), s,
      `reveal #${index} with buzzed=null must be ignored`);
  });
  assert.equal(FC.reduce(s, { type: "notOnBoard" }), s);
  assert.equal(FC.reduce(s, { type: "strike" }), s, "no strikes during a face-off");
});

test("ADV face-off: an unarmed phone buzz is ignored, and only the first armed one lands", () => {
  let s = atFaceoff();
  assert.equal(FC.reduce(s, { type: "buzz", pid: "p1" }), s, "no lockout, but no buzz either");
  s = FC.reduce(s, { type: "arm", on: true });
  const first = FC.reduce(s, { type: "buzz", pid: "p2" });
  assert.equal(first.faceoff.buzzed, 1);
  assert.equal(first.faceoff.armed, false, "the buzz disarms");
  assert.equal(FC.reduce(first, { type: "buzz", pid: "p1" }), first, "second buzz ignored");
});

test("ADV face-off: a buzz from a pid on no team is ignored", () => {
  const s = FC.reduce(atFaceoff(), { type: "arm", on: true });
  assert.equal(FC.reduce(s, { type: "buzz", pid: "ghost" }), s);
  assert.equal(FC.reduce(s, { type: "buzz", pid: "" }), s);
  assert.equal(FC.reduce(s, { type: "buzz" }), s);
});

test("ADV face-off: 'Face-off again' after a revealed answer keeps board + bank (show rule)", () => {
  // The host may press it mid-face-off. Revealed answers stay revealed and the
  // bank keeps their counts — nothing is corrupted or double-counted.
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 1 });
  assert.equal(s.bank, 30);
  s = FC.reduce(s, { type: "faceoffAgain" });
  assert.equal(s.phase, "faceoff");
  assert.deepEqual(s.faceoff.attempts, []);
  assert.equal(s.faceoff.buzzed, null);
  assert.equal(s.bank, 30, "bank is not rewound (use Undo for that)");
  assert.equal(s.revealed[1], true);
  // And the re-run face-off cannot re-bank the same tile.
  s = run(s, { type: "buzz", team: "B", host: true });
  assert.equal(FC.reduce(s, { type: "reveal", index: 1 }), s);
});
/* ===== 2. §1 rules — play, strikes, steal ===== */

test("ADV play-or-pass: strike / reveal / steal are all inert until Play or Pass", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 });
  assert.equal(s.phase, "playpass");
  const frozen = deepFreeze(s);
  ["strike", "revealRest", "nextRound", "finish", "faceoffAgain", "notOnBoard", "arm"]
    .forEach((type) => assert.equal(FC.reduce(frozen, { type }), frozen,
      `${type} must be inert during play-or-pass`));
  assert.equal(FC.reduce(frozen, { type: "reveal", index: 1 }), frozen);
  assert.equal(FC.reduce(frozen, { type: "steal", index: 1 }), frozen);
});

test("ADV strike at 2 then undo rewinds the third strike exactly", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "strike" }, { type: "strike" });
  assert.equal(s.strikes, 2);
  assert.equal(s.phase, "play");
  const atTwo = clone(s);
  const third = FC.reduce(s, { type: "strike" });
  assert.equal(third.strikes, 3);
  assert.equal(third.phase, "steal");
  assert.deepEqual(third.steal, { active: true, team: 1, result: null });
  const undone = FC.reduce(third, { type: "undo" });
  assert.deepEqual(clone({ ...undone, history: null }), clone({ ...atTwo, history: null }));
  assert.equal(undone.phase, "play");
  assert.equal(undone.strikes, 2);
  assert.equal(undone.steal.active, false);
  // Undo again → one strike; and repeated undo walks all the way back to setup.
  let back = undone;
  for (let i = 0; i < 40; i += 1) back = FC.reduce(back, { type: "undo" });
  assert.equal(back.history.length, 0);
  assert.equal(FC.reduce(back, { type: "undo" }), back, "undo on an empty stack is a no-op");
});

test("ADV steal: revealing the LAST remaining answer during a steal awards the stealers", () => {
  // 3-answer board: face-off banks #1, controlling team reveals #2, strikes out.
  const game = { rounds: [q("Three", 50, 30, 20)] };
  let s = atFaceoff(game);
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "reveal", index: 1 },
    { type: "strike" }, { type: "strike" }, { type: "strike" });
  assert.equal(s.phase, "steal");
  assert.equal(s.bank, 80);
  s = FC.reduce(s, { type: "steal", index: 2 });
  assert.equal(s.phase, "roundover");
  assert.deepEqual(s.awarded, { team: 1, points: 100, reason: "steal" });
  assert.equal(s.teams[1].score, 100, "the whole bank incl. the stolen answer goes to B");
  assert.equal(s.teams[0].score, 0);
  assert.equal(s.revealed.every(Boolean), true, "the board is now complete");
  assert.equal(FC.reduce(s, { type: "revealRest" }), s, "nothing left to reveal");
});

test("ADV steal: a failed steal keeps the bank with the controlling team", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "strike" }, { type: "strike" }, { type: "strike" },
    { type: "steal", index: null });
  assert.equal(s.awarded.team, 0);
  assert.equal(s.awarded.reason, "nosteal");
  assert.equal(s.steal.result, "fail");
  assert.equal(s.teams[0].score, 50);
});

test("ADV steal: stealing an already-revealed tile is a no-op, not a free win", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "strike" }, { type: "strike" }, { type: "strike" });
  const before = deepFreeze(s);
  assert.equal(FC.reduce(before, { type: "steal", index: 0 }), before);
  assert.equal(FC.reduce(before, { type: "steal", index: 99 }), before);
  assert.equal(FC.reduce(before, { type: "steal", index: -1 }), before);
  assert.equal(FC.reduce(before, { type: "steal", index: 1.5 }), before);
  assert.equal(FC.reduce(before, { type: "steal", index: "1" }), before);
});

test("ADV pass: the passed-to team plays and banks the face-off answers already up", () => {
  let s = atFaceoff();
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 1 });
  assert.equal(s.faceoff.buzzed, 1, "podium passes to B");
  s = run(s, { type: "notOnBoard" });
  assert.equal(s.control, 0, "A's #2 beats B's miss");
  s = run(s, { type: "pass" });
  assert.equal(s.control, 1);
  assert.equal(s.phase, "play");
  s = run(s, { type: "reveal", index: 0 }, { type: "reveal", index: 2 });
  assert.equal(s.phase, "roundover");
  assert.equal(s.awarded.reason, "cleared");
  assert.equal(s.teams[1].score, 90, "B keeps the whole bank including A's face-off answer");
});
/* ===== 3. §1 rules — multipliers over a 6-round file ===== */

test("ADV multipliers: a 6-round file with the default ladder repeats the last value", () => {
  const game = sixRoundGame();
  const state = FC.createState(game, {});
  const seen = [0, 1, 2, 3, 4, 5].map((i) => FC.multiplierFor({ ...state, roundIndex: i }));
  assert.deepEqual(seen, [1, 1, 2, 3, 3, 3]);
});

test("ADV multipliers: a full 6-round run-through awards bank × the right multiplier", () => {
  const game = sixRoundGame();
  let s = atFaceoff(game);
  const expected = [1, 1, 2, 3, 3, 3];
  const sums = game.rounds.map((r) => r.answers.reduce((t, a) => t + a.count, 0));
  for (let i = 0; i < 6; i += 1) {
    assert.equal(s.roundIndex, i);
    s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
      { type: "play" }, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
    assert.equal(s.phase, "roundover", `round ${i + 1} should clear`);
    assert.equal(s.awarded.points, sums[i] * expected[i],
      `round ${i + 1}: ${sums[i]} × ${expected[i]}`);
    if (i < 5) s = FC.reduce(s, { type: "nextRound" });
  }
  assert.equal(FC.reduce(s, { type: "nextRound" }), s, "no round 7 in a 6-round file");
  assert.equal(s.teams[0].score, sums.reduce((t, v, i) => t + v * expected[i], 0));
});

test("ADV multipliers: a single-entry ladder repeats forever; fractional values are legal", () => {
  const game = sixRoundGame({ settings: { multipliers: [2.5] } });
  const state = FC.createState(game, {});
  assert.deepEqual([0, 3, 11].map((i) => FC.multiplierFor({ ...state, roundIndex: i })),
    [2.5, 2.5, 2.5]);
});
/* ===== 4. §1 rules — Fast Money ===== */

/** Fast Money, player 1 in play, on the given game. */
function fmState(game = sixRoundGame()) {
  let s = atFaceoff(game);
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "strike" }, { type: "strike" }, { type: "strike" },
    { type: "steal", index: null });
  assert.equal(s.phase, "roundover");
  return run(s, { type: "beginFastMoney", team: "A", players: ["p1", "p2"] });
}

test("ADV Fast Money: player 2 repeating player 1's BOARD ANSWER is a duplicate, worth 0", () => {
  let s = fmState();
  // p1 answers q0 with board answer #1 (60), p2 with a different word that the
  // host maps to the SAME board answer index → duplicate.
  s = run(s,
    { type: "fmAnswer", slot: 1, q: 0, text: "Strawberry", pid: "p1" },
    { type: "fmAdvance" },
    { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 });
  assert.equal(s.fastMoney.rows[1][0].points, 60);
  s = run(s, { type: "fmAdvance" }, { type: "fmAdvance" }, // reveal → cover → play
    { type: "fmAnswer", slot: 2, q: 0, text: "A strawberry", pid: "p2" },
    { type: "fmAdvance" },
    { type: "fmReveal", slot: 2, q: 0, answerIndex: 0 });
  const row = s.fastMoney.rows[2][0];
  assert.equal(row.duplicate, true);
  assert.equal(row.points, 0);
  assert.equal(FC.fmTotal(s), 60, "the duplicate adds nothing");
});

test("ADV Fast Money: 'no match' on both sheets is NOT flagged as a duplicate", () => {
  let s = fmState();
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: null });
  assert.equal(s.fastMoney.rows[1][0].duplicate, false);
  assert.equal(s.fastMoney.rows[1][0].points, 0);
  s = run(s, ...[1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 1, q: n, answerIndex: null })),
    { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmReveal", slot: 2, q: 0, answerIndex: null });
  assert.equal(s.fastMoney.rows[2][0].duplicate, false,
    "two misses are two misses, not a duplicate");
  assert.equal(s.fastMoney.rows[2][0].points, 0);
});

test("ADV Fast Money: a duplicate on a DIFFERENT question index is not a duplicate", () => {
  let s = fmState();
  s = run(s, { type: "fmAdvance" },
    ...[0, 1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 1, q: n, answerIndex: 0 })),
    { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmReveal", slot: 2, q: 1, answerIndex: 1 });
  assert.equal(s.fastMoney.rows[2][1].duplicate, false);
  assert.equal(s.fastMoney.rows[2][1].points, 30);
});

test("ADV Fast Money: total exactly equal to the target wins", () => {
  // target 60 → player 1's single 60-point answer hits it on the nose.
  const game = sixRoundGame({ settings: { fastMoney: { enabled: true, target: 60 } } });
  let s = fmState(game);
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 },
    ...[1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 1, q: n, answerIndex: null })),
    { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmAdvance" },
    ...[0, 1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 2, q: n, answerIndex: null })),
    { type: "fmAdvance" });
  assert.equal(FC.fmTotal(s), 60);
  assert.equal(s.fastMoney.stage, "done");
  assert.equal(s.fastMoney.winner, true, "`>= target` — exactly on target must win");
});

test("ADV Fast Money: one point short of the target loses", () => {
  const game = sixRoundGame({ settings: { fastMoney: { enabled: true, target: 61 } } });
  let s = fmState(game);
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 },
    ...[1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 1, q: n, answerIndex: null })),
    { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    ...[0, 1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 2, q: n, answerIndex: null })),
    { type: "fmAdvance" });
  assert.equal(FC.fmTotal(s), 60);
  assert.equal(s.fastMoney.winner, false);
});

test("ADV Fast Money: a target of 0 is reachable with an empty sheet", () => {
  const miss = (slot) => [0, 1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot, q: n, answerIndex: null }));
  let s = fmState(sixRoundGame({ settings: { fastMoney: { enabled: true, target: 0 } } }));
  s = run(s, { type: "fmAdvance" }, ...miss(1), { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmAdvance" }, ...miss(2), { type: "fmAdvance" });
  assert.equal(s.fastMoney.winner, true);
});

test("ADV Fast Money timers: 0-second timers are legal content but the clock cue cannot start", () => {
  // Spec §2 says timers may be 0–120. `fmTimer start` falls back to the
  // configured value and bails on 0, so a 0-second game simply has no clock.
  const game = sixRoundGame({
    settings: { fastMoney: { enabled: true, target: 200, timer1: 0, timer2: 0 } },
  });
  assert.doesNotThrow(() => FC.validateGame(game));
  const s = fmState(game);
  assert.equal(s.game.settings.fastMoney.timer1, 0);
  assert.equal(FC.reduce(s, { type: "fmTimer", action: "start", now: 5 }), s,
    "no clock to start — documented as a known limitation, not a crash");
  // An explicit seconds override still works.
  const started = FC.reduce(s, { type: "fmTimer", action: "start", seconds: 30, now: 5 });
  assert.deepEqual(started.fastMoney.timer, { running: true, startedAt: 5, seconds: 30, slot: 1 });
});

test("ADV Fast Money timers: junk seconds/now fall back safely and never transition the stage", () => {
  const s = fmState();
  const cases = [{ seconds: 0 }, { seconds: -5 }, { seconds: 121 }, { seconds: 2.5 },
    { seconds: "20" }, { seconds: NaN }, { seconds: Infinity }];
  cases.forEach((extra) => {
    const next = FC.reduce(s, { type: "fmTimer", action: "start", now: 1, ...extra });
    assert.equal(next.fastMoney.timer.seconds, 20, JSON.stringify(extra));
    assert.equal(next.fastMoney.stage, "play");
  });
  const noNow = FC.reduce(s, { type: "fmTimer", action: "start" });
  assert.equal(noNow.fastMoney.timer.startedAt, 0);
  assert.equal(FC.reduce(s, { type: "fmTimer", action: "wibble" }), s);
  assert.equal(FC.reduce(s, { type: "fmTimer" }), s);
});

test("ADV Fast Money: the stage machine only walks forwards and `finish` always escapes", () => {
  let s = fmState();
  const stages = [];
  for (let i = 0; i < 8; i += 1) {
    stages.push(s.fastMoney.stage);
    s = FC.reduce(s, { type: "fmAdvance" });
  }
  assert.deepEqual(stages, ["play", "reveal", "cover", "play", "reveal", "done", "done", "done"]);
  assert.equal(FC.reduce(s, { type: "fmAdvance" }).fastMoney.stage, "done");
  assert.equal(FC.reduce(s, { type: "finish" }).phase, "final");
});

test("ADV Fast Money: beginFastMoney is refused when Fast Money is off or the phase is wrong", () => {
  const game = sixRoundGame({ settings: { fastMoney: { enabled: false } } });
  let s = FC.createState(game, {});
  assert.equal(s.fastMoneyEnabled, false);
  s = run(s, { type: "start" }, { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 0 }, { type: "play" },
    { type: "strike" }, { type: "strike" }, { type: "strike" }, { type: "steal", index: null });
  assert.equal(s.phase, "roundover");
  assert.equal(FC.reduce(s, { type: "beginFastMoney", players: ["p1", "p2"] }), s);
  const mid = deepFreeze(atFaceoff());
  assert.equal(FC.reduce(mid, { type: "beginFastMoney", players: ["p1", "p2"] }), mid);
});
/* ===== 5. Validator fuzz (§2) ===== */

test("ADV validator: junk types anywhere in the tree throw a readable Error, never a TypeError", () => {
  const ans3 = (a) => [a, { text: "b", count: 1 }, { text: "c", count: 1 }];
  const set = (settings) => ({ rounds: [q("Q", 1, 2, 3)], settings });
  const junk = [
    undefined, null, 0, 1, "", "{}", true, [], [{ rounds: [] }], () => {}, Symbol("x"),
    { rounds: {} }, { rounds: [null] }, { rounds: ["a question"] }, { rounds: [[]] },
    { rounds: [{ question: "Q" }] }, { rounds: [{ question: "Q", answers: "abc" }] },
    { rounds: [{ question: "Q", answers: {} }] },
    { rounds: [{ question: 5, answers: answers(1, 2, 3) }] },
    { rounds: [{ question: "Q", answers: [null, null, null] }] },
    { rounds: [{ question: "Q", answers: ans3({ text: 5, count: 1 }) }] },
    { rounds: [{ question: "Q", answers: ans3({ text: "a" }) }] },
    { rounds: [{ question: "Q", answers: ans3({ text: "a", count: "50" }) }] },
    { rounds: [{ question: "Q", answers: ans3({ text: "a", count: NaN }) }] },
    set([]), set("strict"), set({ fastMoney: [] }), set({ multipliers: [Infinity] }),
    set({ multipliers: [NaN] }), set({ multipliers: "1,2" }), set({ strikes: 2.5 }),
    set({ fastMoney: { enabled: "yes" } }), set({ fastMoney: { target: -1 } }),
    set({ fastMoney: { timer2: -1 } }),
    { rounds: [q("Q", 1, 2, 3)], fastMoney: "none" },
    { rounds: [q("Q", 1, 2, 3)], fastMoney: [null] },
    { rounds: new Array(13).fill(0).map((_, i) => q(`Q${i}`, 1, 2, 3)) },
  ];
  junk.forEach((data, i) => {
    let thrown = null;
    try { FC.validateGame(data); } catch (err) { thrown = err; }
    assert.ok(thrown instanceof Error, `case ${i} must throw an Error`);
    assert.ok(!(thrown instanceof TypeError), `case ${i} threw a raw TypeError: ${thrown.message}`);
    assert.ok(typeof thrown.message === "string" && thrown.message.length > 5,
      `case ${i} needs a plain-English message, got: ${thrown.message}`);
  });
});

test("ADV validator: a 40-char answer passes and a 41-char answer fails", () => {
  const at = (n) => ({
    rounds: [{
      question: "Q",
      answers: [{ text: "y".repeat(n), count: 10 }, { text: "b", count: 5 }, { text: "c", count: 4 }],
    }],
  });
  assert.doesNotThrow(() => FC.validateGame(at(40)));
  assert.throws(() => FC.validateGame(at(41)), /too long \(max 40 characters\)/);
  // ...and the question boundary, 200 vs 201.
  const qAt = (n) => ({ rounds: [{ question: "q".repeat(n), answers: answers(3, 2, 1) }] });
  assert.doesNotThrow(() => FC.validateGame(qAt(200)));
  assert.throws(() => FC.validateGame(qAt(201)), /too long/);
});

test("ADV validator: count 100 twice is legal content but warningsFor flags the sum", () => {
  const data = {
    rounds: [{
      question: "Two hundred people?",
      answers: [{ text: "a", count: 100 }, { text: "b", count: 100 }, { text: "c", count: 1 }],
    }],
  };
  assert.doesNotThrow(() => FC.validateGame(data), "sum > 100 is a WARNING, not a load failure");
  const warnings = FC.warningsFor(data);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Round 1/);
  assert.match(warnings[0], /201/);
  // The game still normalises and plays.
  const n = FC.normalizeGame(data);
  assert.deepEqual(n.rounds[0].answers.map((a) => a.count), [100, 100, 1]);
});

test("ADV validator: warningsFor never throws on the junk validateGame rejects", () => {
  [null, undefined, 7, "x", [], {}, { rounds: [null] }, { rounds: [{ answers: [{}] }] },
    { fastMoney: [{ answers: [{ count: "x" }] }] }].forEach((data) => {
    assert.doesNotThrow(() => FC.warningsFor(data));
    assert.ok(Array.isArray(FC.warningsFor(data)));
  });
});

test("ADV validator: unicode answers — emoji, combining marks, RTL and NBSP", () => {
  // combining acute, Hebrew (RTL) and a non-breaking space all survive intact
  const ok = { title: "Ünïcødé 🎪", rounds: [{
    question: "Nombra algo que la gente hace en la ducha — ¿café? 🚿",
    answers: [{ text: "Cantar 🎤", count: 45 }, { text: "éclair", count: 22 },, { text: "שלום", count: 14 },, { text: "café latte", count: 11 },],
  }] };
  assert.doesNotThrow(() => FC.validateGame(ok));
  const n = FC.normalizeGame(ok);
  assert.equal(n.rounds[0].answers[0].text, "Cantar 🎤");
  assert.equal(n.title, "Ünïcødé 🎪");
  // 20 astral emoji = 40 UTF-16 units → legal; 21 = 42 units → rejected.
  const emoji = (n2) => ({ rounds: [{ question: "Q",
    answers: [{ text: "🍎".repeat(n2), count: 5 }, { text: "b", count: 4 }, { text: "c", count: 3 }] }] });
  assert.doesNotThrow(() => FC.validateGame(emoji(20)));
  assert.throws(() => FC.validateGame(emoji(21)), /too long/);
});

test("ADV validator: duplicate detection is case- and whitespace-insensitive, unicode-aware", () => {
  const dup = (a, b) => ({ rounds: [{ question: "Q",
    answers: [{ text: a, count: 5 }, { text: b, count: 4 }, { text: "c", count: 3 }] }] });
  assert.throws(() => FC.validateGame(dup("Sing", "  sing ")), /duplicates/);
  assert.throws(() => FC.validateGame(dup("CAFÉ", "café")), /duplicates/);
  // Different code points that merely look alike are (correctly) not duplicates.
  assert.doesNotThrow(() => FC.validateGame(dup("café", "café")));
});

test("ADV validator: a __proto__ key in the JSON cannot pollute Object.prototype", () => {
  const raw = '{"rounds":[{"question":"Q","__proto__":{"polluted":true},' +
    '"answers":[{"text":"a","count":5},{"text":"b","count":4},{"text":"c","count":3}]}]}';
  const data = JSON.parse(raw);
  assert.doesNotThrow(() => FC.validateGame(data));
  const n = FC.normalizeGame(data);
  assert.equal({}.polluted, undefined, "Object.prototype must be clean");
  assert.equal(n.rounds[0].polluted, undefined);
  assert.deepEqual(Object.keys(n.rounds[0]), ["question", "answers"], "unknown keys are dropped");
});

test("ADV validator: normalizeGame never mutates its input and is idempotent", () => {
  const data = sixRoundGame();
  data.rounds[0].answers = [
    { text: "low", count: 5 }, { text: "high", count: 60 }, { text: "mid", count: 30 },
  ];
  const before = clone(data);
  const once = FC.normalizeGame(data);
  assert.deepEqual(data, before, "input untouched");
  assert.deepEqual(FC.normalizeGame(once), once, "idempotent");
  assert.deepEqual(once.rounds[0].answers.map((a) => a.text), ["high", "mid", "low"]);
  // A frozen input is fine too.
  assert.doesNotThrow(() => FC.normalizeGame(deepFreeze(clone(before))));
});

test("ADV validator: the shipped questions.json is legal, warning-free and 6+8", () => {
  assert.doesNotThrow(() => FC.validateGame(SHIPPED));
  assert.deepEqual(FC.warningsFor(SHIPPED), []);
  assert.equal(SHIPPED.rounds.length, 6, "spec §2 asks for 6 rounds");
  assert.ok(SHIPPED.fastMoney.length >= 8, "spec §2 asks for 8 Fast Money questions");
  const n = FC.normalizeGame(SHIPPED);
  n.rounds.concat(n.fastMoney).forEach((question) => {
    const counts = question.answers.map((a) => a.count);
    assert.deepEqual(counts, counts.slice().sort((x, y) => y - x),
      `"${question.question}" must be sorted desc`);
  });
});
/* ===== 6. Phone-message fuzz (§5) ===== */

test("ADV phone msg: control characters are stripped from a Fast Money answer", () => {
  // Every C0/C1 control byte and DEL must be stripped before the text is kept.
  const dirty = "\u0000\u0007  Ap\u001Bp\u007Fl\u0085e\n\u000D";
  const msg = FC.validatePhoneMsg({ t: "fm-answer", slot: 2, q: 4, text: dirty });
  assert.deepEqual(msg, { t: "fm-answer", slot: 2, q: 4, text: "Apple" });
  // A payload made only of control characters collapses to "" (still accepted;
  // the reducer treats it as clearing the row).
  assert.deepEqual(FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: "\u0000\u0001" }),
    { t: "fm-answer", slot: 1, q: 0, text: "" });
});

test("ADV phone msg: a 61-char answer is capped at 60 and 600+ is rejected outright", () => {
  const sixtyOne = "z".repeat(61);
  const msg = FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: sixtyOne });
  assert.equal(msg.text.length, 60, "spec §5 caps typed answers at 60 chars");
  assert.equal(FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: "z".repeat(601) }), null,
    "an oversized field is dropped at the boundary, not silently truncated");
  assert.equal(FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: "z".repeat(600) }).text.length,
    60);
});

test("ADV phone msg: junk shapes all return null and never throw", () => {
  const fm = (o) => ({ t: "fm-answer", slot: 1, q: 0, text: "x", ...o });
  const junk = [
    null, undefined, 0, 1, "", "buzz", true, [], [{ t: "buzz" }], () => {}, new Date(),
    {}, { t: 5 }, { t: "" }, { t: "BUZZ" }, { t: "Buzz" }, { t: "nope" },
    { t: "team" }, { t: "team", team: "C" }, { t: "team", team: 0 }, { t: "team", team: null },
    { t: "team", team: ["A"] }, { t: "team", team: "a" }, { t: "fm-answer" },
    fm({ slot: 0 }), fm({ slot: 3 }), fm({ slot: "1" }), fm({ q: -1 }), fm({ q: 5 }),
    fm({ q: 1.5 }), fm({ q: "0" }), fm({ text: 5 }), fm({ text: null }),
    fm({ text: { toString: () => "x" } }), { t: "fm-answer", slot: 1, q: 0 },
    // host→phone shapes and reducer event names must never be accepted inbound
    { t: "view", screen: "team-pick" }, { t: "setScore", team: "A", score: 99999 },
    { t: "start" }, { t: "steal", index: 0 }, { t: "strike" }, { t: "undo" },
  ];
  junk.forEach((payload, i) => {
    let out;
    assert.doesNotThrow(() => { out = FC.validatePhoneMsg(payload); }, `case ${i}`);
    assert.equal(out, null, `case ${i} (${JSON.stringify(payload)}) must be rejected`);
  });
});

test("ADV phone msg: extra/hostile fields are dropped, not forwarded", () => {
  assert.deepEqual(
    FC.validatePhoneMsg({ t: "buzz", team: "B", host: true, pid: "p9", admin: 1 }),
    { t: "buzz" }, "a phone can never smuggle host:true or a team through a buzz");
  assert.deepEqual(
    FC.validatePhoneMsg({ t: "team", team: "A", pid: "p9", score: 999 }),
    { t: "team", team: "A" });
  assert.deepEqual(
    FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: "ok", pid: "p9", points: 100 }),
    { t: "fm-answer", slot: 1, q: 0, text: "ok" });
  const proto = JSON.parse('{"t":"buzz","__proto__":{"pwned":true}}');
  assert.deepEqual(FC.validatePhoneMsg(proto), { t: "buzz" });
  assert.equal({}.pwned, undefined);
});

test("ADV phone msg: a validated payload is inert in the wrong phase", () => {
  // The host glue routes {t:"team"} → setTeam, {t:"buzz"} → buzz,
  // {t:"fm-answer"} → fmAnswer. Each must be a no-op outside its phase.
  const asEvent = { team: (m, pid) => ({ type: "setTeam", pid, team: m.team }),
    buzz: (m, pid) => ({ type: "buzz", pid }),
    "fm-answer": (m, pid) => ({ type: "fmAnswer", slot: m.slot, q: m.q, text: m.text, pid }) };
  const payloads = [{ t: "team", team: "B" }, { t: "buzz" },
    { t: "fm-answer", slot: 1, q: 0, text: "cheat" }];
  const setup = deepFreeze(FC.createState(sixRoundGame(), {}));
  const faceoff = deepFreeze(atFaceoff());
  const play = deepFreeze(run(atFaceoff(), { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 0 }, { type: "play" }));
  // In setup only the team pick may land; in an unarmed face-off and mid-board, nothing may.
  payloads.forEach((p) => {
    const next = FC.reduce(setup, asEvent[p.t](p, "p1"));
    if (p.t === "team") assert.notEqual(next, setup);
    else assert.equal(next, setup, `${p.t} must be inert in setup`);
  });
  payloads.forEach((p) => {
    assert.equal(FC.reduce(faceoff, asEvent[p.t](p, "p1")), faceoff,
      `${p.t} must be inert in an unarmed face-off`);
  });
  payloads.forEach((p) => {
    assert.equal(FC.reduce(play, asEvent[p.t](p, "p1")), play,
      `${p.t} must be inert while the board is in play`);
  });
});

test("ADV phone msg: a phone cannot type into the other Fast Money player's sheet", () => {
  const s = fmState();
  assert.equal(s.fastMoney.players[0], "p1");
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 2, q: 0, text: "spy", pid: "p1" }), s);
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "spy", pid: "p2" }), s);
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "spy", pid: "ghost" }), s);
  const own = FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "mine", pid: "p1" });
  assert.equal(own.fastMoney.rows[1][0].text, "mine");
});
/* ===== 7. phoneView must not leak (§5, F-U10) ===== */

test("ADV phoneView: nobody sees another player's Fast Money answers before the reveal", () => {
  const SECRET = "PLAYER-ONE-SECRET";
  let s = fmState();
  s = FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: SECRET, pid: "p1" });
  ["p1", "p2", "ghost", null, undefined, ""].forEach((pid) => {
    const view = FC.phoneView(s, pid);
    const json = JSON.stringify(view);
    if (pid === "p1") {
      assert.ok(json.includes(SECRET), "player 1 sees their own sheet");
    } else {
      assert.ok(!json.includes(SECRET), `phoneView(${String(pid)}) leaked player 1's answer`);
    }
  });
  // Player 2 is on the cover-your-ears screen, with no fm payload at all.
  const p2 = FC.phoneView(s, "p2");
  assert.equal(p2.screen, "fm-wait");
  assert.equal(p2.fm, null);
});

test("ADV phoneView: no board answer TEXT or COUNT ever reaches a phone, in any phase", () => {
  const game = {
    rounds: [{ question: "Board question", answers: [{ text: "SECRET-BOARD-ONE", count: 51 },
      { text: "SECRET-BOARD-TWO", count: 32 }, { text: "SECRET-BOARD-THREE", count: 17 }] }],
    fastMoney: [0, 1, 2, 3, 4].map((i) => ({ question: `FM ${i}`,
      answers: [{ text: `SECRET-FM-${i}-A`, count: 40 }, { text: `SECRET-FM-${i}-B`, count: 30 },
        { text: `SECRET-FM-${i}-C`, count: 20 }] })),
  };
  let s = atFaceoff(game);
  const seen = [];
  const capture = () => ["p1", "p2", "ghost"].forEach((pid) => seen.push(JSON.stringify(FC.phoneView(s, pid))));
  capture();
  s = run(s, { type: "arm", on: true }, { type: "buzz", pid: "p1" }); capture();
  s = FC.reduce(s, { type: "reveal", index: 0 }); capture();          // playpass
  s = FC.reduce(s, { type: "play" }); capture();                       // play
  s = FC.reduce(s, { type: "reveal", index: 1 }); capture();
  s = run(s, { type: "strike" }, { type: "strike" }, { type: "strike" }); capture(); // steal
  s = FC.reduce(s, { type: "steal", index: null }); capture();         // roundover
  s = FC.reduce(s, { type: "beginFastMoney", team: "A", players: ["p1", "p2"] }); capture();
  s = run(s, { type: "fmAdvance" },
    ...[0, 1, 2, 3, 4].map((n) => ({ type: "fmReveal", slot: 1, q: n, answerIndex: 0 })),
    { type: "fmAdvance" }, { type: "fmAdvance" }); capture();          // player 2 up
  s = FC.reduce(s, { type: "finish" }); capture();                     // final
  const blob = seen.join("|");
  assert.ok(!blob.includes("SECRET-BOARD"), "a board answer reached a phone");
  assert.ok(!blob.includes("SECRET-FM"), "a Fast Money board answer reached a phone");
  assert.ok(!/\b51\b/.test(blob.replace(/"score":\d+/g, "")), "a board count reached a phone");
  assert.ok(blob.includes("Board question"), "the question itself is meant to reach the podium");
});

test("ADV phoneView: every screen value is one the spec §5 table documents", () => {
  const allowed = new Set(["team-pick", "wait", "faceoff", "fm-answer", "fm-wait", "result"]);
  const states = [];
  let s = FC.createState(sixRoundGame(), {}); states.push(s);
  s = run(s, { type: "setTeam", pid: "p1", team: "A" }, { type: "setTeam", pid: "p2", team: "B" },
    { type: "start" }); states.push(s);
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 }); states.push(s);
  s = FC.reduce(s, { type: "play" }); states.push(s);
  s = run(s, { type: "strike" }, { type: "strike" }, { type: "strike" }); states.push(s);
  s = FC.reduce(s, { type: "steal", index: null }); states.push(s);
  s = FC.reduce(s, { type: "beginFastMoney", team: "A", players: ["p1", "p2"] }); states.push(s);
  s = FC.reduce(s, { type: "fmAdvance" }); states.push(s);
  s = FC.reduce(s, { type: "finish" }); states.push(s);
  states.forEach((state) => {
    ["p1", "p2", "nobody"].forEach((pid) => {
      const view = FC.phoneView(state, pid);
      assert.ok(allowed.has(view.screen), `${state.phase}/${pid} → "${view.screen}"`);
      assert.ok(typeof view.phaseText === "string");
      assert.ok(Array.isArray(view.scores));
    });
  });
});
/* ===== 8. Immutability with deep-frozen state ===== */

test("ADV immutability: a whole game can be played with every state deep-frozen", () => {
  const events = [
    { type: "setTeam", pid: "p1", team: "A" }, { type: "setTeam", pid: "p2", team: "B" },
    { type: "setTeamName", team: "A", name: "Frozen" }, { type: "setRoundsToPlay", count: 2 },
    { type: "start" }, { type: "arm", on: true }, { type: "buzz", pid: "p1" },
    { type: "reveal", index: 1 }, { type: "notOnBoard" }, { type: "play" },
    { type: "reveal", index: 0 }, { type: "strike" }, { type: "strike" }, { type: "strike" },
    { type: "steal", index: 2 }, { type: "revealRest" }, { type: "nextRound" },
    { type: "giveControl", team: "B" }, { type: "pass" }, { type: "reveal", index: 0 },
    { type: "reveal", index: 1 }, { type: "reveal", index: 2 },
    { type: "beginFastMoney", team: "A", players: ["p1", "p2"] },
    { type: "fmAnswer", slot: 1, q: 0, text: "x", pid: "p1" }, { type: "fmTimer", action: "start", now: 1 },
    { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 },
    { type: "undo" }, { type: "setScore", team: "B", score: -25 }, { type: "finish" },
  ];
  let s = deepFreeze(FC.createState(sixRoundGame(), {}));
  events.forEach((event) => {
    const snapshotBefore = clone(s);
    const next = FC.reduce(s, event);
    assert.deepEqual(clone(s), snapshotBefore, `${event.type} mutated the input state`);
    s = deepFreeze(next);
  });
  assert.equal(s.phase, "final");
  assert.equal(s.teams[1].score, -25, "setScore accepts a negative correction");
});

test("ADV immutability: the content object is shared, never copied, and never edited", () => {
  const s0 = FC.createState(sixRoundGame(), {});
  const game = s0.game;
  const s1 = run(s0, { type: "start" }, { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 0 }, { type: "play" }, { type: "reveal", index: 1 });
  assert.equal(s1.game, game, "the same content object is threaded through");
  const undone = FC.reduce(s1, { type: "undo" });
  assert.equal(undone.game, game, "undo re-attaches the same content object");
  assert.deepEqual(clone(game), clone(FC.normalizeGame(sixRoundGame())));
});

test("ADV immutability: history entries never carry `game` or a nested `history`", () => {
  let s = FC.createState(sixRoundGame(), {});
  for (let i = 0; i < 45; i += 1) {
    s = FC.reduce(s, { type: "setScore", team: "A", score: i + 1 });
  }
  assert.equal(s.history.length, FC.HISTORY_MAX);
  assert.ok(FC.HISTORY_MAX >= 20, "spec §3 asks for a history of at least 20");
  s.history.forEach((entry, i) => {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "game"), false, `entry ${i}`);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "history"), false, `entry ${i}`);
  });
  // The serialised state stays a sane size even after a long game.
  assert.ok(JSON.stringify(s).length < 400000, "state must stay comfortably serialisable");
});

test("ADV immutability: an illegal event returns the IDENTICAL object (cheap render guard)", () => {
  const phases = [
    FC.createState(sixRoundGame(), {}),
    atFaceoff(),
    run(atFaceoff(), { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 }),
    run(atFaceoff(), { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 },
      { type: "play" }),
  ];
  phases.forEach((state) => {
    const frozen = deepFreeze(state);
    // Re-applying a no-change event must be reference-identical, not a copy.
    assert.equal(FC.reduce(frozen, { type: "nope" }), frozen);
    assert.equal(FC.reduce(frozen, { type: "setScore", team: "A", score: frozen.teams[0].score }),
      frozen, "setting the same score must not churn history");
    assert.equal(FC.reduce(frozen, { type: "arm", on: frozen.faceoff.armed }), frozen);
  });
});
/* ===== 9. Reducer looseness worth knowing about (documented, not fatal) ===== */

test("ADV D7 regression: fmReveal ignores a slot that is not the active one", () => {
  // Was documented looseness: an out-of-band slot-2 reveal while player 1 was
  // up skipped duplicate detection (which reads slot 1) and double-counted.
  let s = fmState();
  assert.equal(FC.reduce(s, { type: "fmReveal", slot: 2, q: 0, answerIndex: 0 }), s,
    "a slot-2 reveal while player 1 is up is a no-op");
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 });
  assert.equal(s.fastMoney.rows[1][0].points, 60);
  s = run(s, { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmReveal", slot: 2, q: 0, answerIndex: 0 });
  assert.equal(s.fastMoney.rows[2][0].duplicate, true, "the legitimate order still flags it");
  assert.equal(FC.fmTotal(s), 60, "no double-count is reachable any more");
  // A stale slot-1 reveal once player 2 is up is ignored the same way.
  assert.equal(FC.reduce(s, { type: "fmReveal", slot: 1, q: 1, answerIndex: 0 }), s);
});

test("ADV known looseness: setScore is legal in every phase, including mid-steal", () => {
  const steal = run(atFaceoff(), { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 0 }, { type: "play" },
    { type: "strike" }, { type: "strike" }, { type: "strike" });
  const fixed = FC.reduce(steal, { type: "setScore", team: "B", score: 1000 });
  assert.equal(fixed.teams[1].score, 1000);
  assert.equal(fixed.phase, "steal", "editing a score never changes the phase");
  assert.equal(FC.reduce(fixed, { type: "undo" }).teams[1].score, 0, "and it is undoable");
});
