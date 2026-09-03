/* ============================================================
   Family Feud — unit tests for the pure core (spec 03 §8, F-U1…F-U10).
   Zero npm deps: node:test + node:assert only.
   Run from games/family-feud:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import FC from "../js/feud-core.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));

/* ---- fixtures ----------------------------------------------- */

const q = (question, ...counts) => ({
  question,
  answers: counts.map((c, i) => ({ text: `Answer ${i + 1}`, count: c })),
});

/** A tiny but legal game: 5 rounds of 3 answers, 5 Fast Money questions. */
function tinyGame(extra) {
  return {
    title: "Tiny",
    rounds: [
      q("R1", 50, 30, 10),
      q("R2", 40, 25, 15),
      q("R3", 44, 22, 11),
      q("R4", 33, 21, 12),
      q("R5", 30, 20, 10),
    ],
    fastMoney: [q("F1", 60, 25, 10), q("F2", 50, 30, 5), q("F3", 40, 30, 20),
      q("F4", 35, 30, 25), q("F5", 45, 25, 15)],
    ...extra,
  };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k]));
  return value;
}

const run = (state, ...events) => events.reduce((s, e) => FC.reduce(s, e), state);

/** State in `phase`, built only from legal events. */
function atPhase(phase, game = tinyGame()) {
  let s = FC.createState(game, {});
  if (phase === "setup") return s;
  s = run(s, { type: "setTeam", pid: "p1", team: "A" }, { type: "setTeam", pid: "p2", team: "B" },
    { type: "start" });
  if (phase === "faceoff") return s;
  s = run(s, { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 });
  if (phase === "playpass") return s;
  s = run(s, { type: "play" });
  if (phase === "play") return s;
  if (phase === "steal") return run(s, { type: "strike" }, { type: "strike" }, { type: "strike" });
  s = run(s, { type: "strike" }, { type: "strike" }, { type: "strike" }, { type: "steal", index: null });
  if (phase === "roundover") return s;
  if (phase === "fastmoney") return run(s, { type: "beginFastMoney", players: ["p1", "p2"] });
  return run(s, { type: "finish" }); // final
}

/* ============ F-U1 — validateGame ============ */

test("F-U1 validateGame accepts the shipped questions.json and fixtures", () => {
  assert.doesNotThrow(() => FC.validateGame(SHIPPED));
  assert.doesNotThrow(() => FC.validateGame(tinyGame()));
  // Rounds only, no Fast Money: legal, because `enabled` defaults off without questions.
  assert.doesNotThrow(() => FC.validateGame({ rounds: [q("Only", 50, 30, 10)] }));
  // 8 answers and 12 rounds are the documented maxima.
  assert.doesNotThrow(() => FC.validateGame({ rounds: [q("Wide", 20, 18, 15, 12, 10, 9, 8, 7)] }));
});

test("F-U1 validateGame rejects malformed content with a readable message", () => {
  const bad = (mutate, match) => {
    const data = mutate(tinyGame());
    assert.throws(() => FC.validateGame(data), match, `expected a throw for ${match}`);
  };
  assert.throws(() => FC.validateGame(null), /must be a JSON object/);
  assert.throws(() => FC.validateGame([]), /must be a JSON object/);
  bad((g) => { g.rounds = []; return g; }, /non-empty array/);
  bad((g) => { delete g.rounds; return g; }, /non-empty array/);
  bad((g) => { g.rounds[0].answers = g.rounds[0].answers.slice(0, 2); return g; }, /between 3 and 8 answers/);
  bad((g) => { g.rounds[0] = q("Nine", 9, 8, 7, 6, 5, 4, 3, 2, 1); return g; }, /between 3 and 8 answers/);
  bad((g) => { g.rounds[0].answers[0].count = 0; return g; }, /count" from 1 to 100/);
  bad((g) => { g.rounds[0].answers[0].count = 101; return g; }, /count" from 1 to 100/);
  bad((g) => { g.rounds[0].answers[0].count = 12.5; return g; }, /count" from 1 to 100/);
  bad((g) => { g.rounds[0].answers[1].text = " answer 1 "; return g; }, /duplicates an earlier answer/);
  bad((g) => { g.rounds[0].question = "   "; return g; }, /non-empty "question"/);
  bad((g) => { g.rounds[0].question = "x".repeat(201); return g; }, /too long/);
  bad((g) => { g.rounds[0].answers[0].text = "y".repeat(41); return g; }, /too long/);
  bad((g) => { g.fastMoney = g.fastMoney.slice(0, 4); return g; }, /at least 5 questions/);
  bad((g) => { g.settings = { strikes: 0 }; return g; }, /strikes" must be a whole number/);
  bad((g) => { g.settings = { strikes: 6 }; return g; }, /strikes" must be a whole number/);
  bad((g) => { g.settings = { multipliers: [] }; return g; }, /multipliers/);
  bad((g) => { g.settings = { multipliers: [1, 0] }; return g; }, /positive number/);
  bad((g) => { g.settings = { fastMoney: { timer1: 500 } }; return g; }, /timer1/);
  bad((g) => { g.title = 7; return g; }, /"title" must be a string/);
});

test("F-U1 fastMoney with 4 questions is rejected only while Fast Money is enabled", () => {
  const g = tinyGame();
  g.fastMoney = g.fastMoney.slice(0, 4);
  assert.throws(() => FC.validateGame(g), /at least 5 questions/);
  g.settings = { fastMoney: { enabled: false } };
  assert.doesNotThrow(() => FC.validateGame(g));
});

/* ============ F-U2 — normalizeGame + warningsFor ============ */

test("F-U2 normalizeGame sorts answers by count desc and applies defaults", () => {
  const g = tinyGame();
  g.rounds[0].answers = [
    { text: "low", count: 5 }, { text: "high", count: 60 }, { text: "mid", count: 30 },
  ];
  const n = FC.normalizeGame(g);
  assert.deepEqual(n.rounds[0].answers.map((a) => a.text), ["high", "mid", "low"]);
  assert.equal(n.settings.strikes, 3);
  assert.deepEqual(n.settings.multipliers, [1, 1, 2, 3]);
  assert.deepEqual(n.settings.fastMoney, { enabled: true, target: 200, timer1: 20, timer2: 25 });
  assert.equal(n.title, "Tiny");
  // Input untouched (pure).
  assert.equal(g.rounds[0].answers[0].text, "low");
  // Idempotent.
  assert.deepEqual(FC.normalizeGame(n), n);
});

test("F-U2 warningsFor flags counts summing over 100, and nothing else", () => {
  assert.deepEqual(FC.warningsFor(SHIPPED), []);
  assert.deepEqual(FC.warningsFor(tinyGame()), []);
  const g = tinyGame();
  g.rounds[1].answers[0].count = 90; // 90 + 25 + 15 = 130
  g.fastMoney[0].answers[0].count = 90; // 90 + 25 + 10 = 125
  const warnings = FC.warningsFor(g);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Round 2: the counts add up to 130/);
  assert.match(warnings[1], /Fast Money question 1: the counts add up to 125/);
});

/* ============ F-U3 — face-off ============ */

test("F-U3 buzz A then the #1 answer takes control immediately", () => {
  const s = run(atPhase("faceoff"), { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 });
  assert.equal(s.phase, "playpass");
  assert.equal(s.control, 0);
  assert.equal(s.bank, 50);
  assert.equal(s.revealed[0], true);
});

test("F-U3 a lower answer passes the podium over; the better rank wins control", () => {
  let s = run(atPhase("faceoff"), { type: "buzz", team: "A", host: true }, { type: "reveal", index: 2 });
  assert.equal(s.phase, "faceoff");
  assert.equal(s.faceoff.buzzed, 1, "team B is now at the podium");
  s = FC.reduce(s, { type: "reveal", index: 1 });
  assert.equal(s.phase, "playpass");
  assert.equal(s.control, 1, "B's #2 beats A's #3");
  assert.equal(s.bank, 10 + 30);
});

test("F-U3 both answers off the board allows faceoffAgain; giveControl overrides", () => {
  let s = run(atPhase("faceoff"), { type: "buzz", team: "B", host: true },
    { type: "notOnBoard" }, { type: "notOnBoard" });
  assert.equal(s.phase, "faceoff");
  assert.equal(s.faceoff.attempts.length, 2);
  assert.match(s.message, /face off again/i);
  const again = FC.reduce(s, { type: "faceoffAgain" });
  assert.equal(again.faceoff.attempts.length, 0);
  assert.equal(again.faceoff.buzzed, null);
  const given = FC.reduce(s, { type: "giveControl", team: "A" });
  assert.equal(given.phase, "playpass");
  assert.equal(given.control, 0);
});

test("F-U3 phone buzzes only count once armed, and only the first one lands", () => {
  const armed = FC.reduce(atPhase("faceoff"), { type: "arm", on: true });
  const early = FC.reduce(atPhase("faceoff"), { type: "buzz", pid: "p1" });
  assert.equal(early.faceoff.buzzed, null, "unarmed phone buzz is ignored");
  const first = FC.reduce(armed, { type: "buzz", pid: "p2" });
  assert.equal(first.faceoff.buzzed, 1);
  const second = FC.reduce(first, { type: "buzz", pid: "p1" });
  assert.equal(second, first, "second buzz changes nothing");
});

/* ============ F-U4 — play / pass / strikes ============ */

test("F-U4 play keeps control, pass hands the board over", () => {
  const won = run(atPhase("faceoff"), { type: "buzz", team: "A", host: true }, { type: "reveal", index: 0 });
  assert.equal(FC.reduce(won, { type: "play" }).control, 0);
  const passed = FC.reduce(won, { type: "pass" });
  assert.equal(passed.control, 1);
  assert.equal(passed.phase, "play");
});

test("F-U4 strikes accumulate and the third opens the steal for the other team", () => {
  let s = atPhase("play");
  assert.equal(s.control, 0);
  s = FC.reduce(s, { type: "strike" });
  assert.equal(s.strikes, 1);
  assert.equal(s.phase, "play");
  s = FC.reduce(s, { type: "strike" });
  assert.equal(s.strikes, 2);
  assert.equal(s.phase, "play");
  s = FC.reduce(s, { type: "strike" });
  assert.equal(s.strikes, 3);
  assert.equal(s.phase, "steal");
  assert.deepEqual(s.steal, { active: true, team: 1, result: null });
});

test("F-U4 a custom strike limit is honoured", () => {
  const g = tinyGame({ settings: { strikes: 1 } });
  const s = FC.reduce(atPhase("play", g), { type: "strike" });
  assert.equal(s.phase, "steal");
});

/* ============ F-U5 — steal and clearing the board ============ */

test("F-U5 a successful steal hands the whole bank to the stealing team", () => {
  const s = atPhase("steal");
  const bankBefore = s.bank; // 50 from the face-off reveal
  const stolen = FC.reduce(s, { type: "steal", index: 1 });
  assert.equal(stolen.phase, "roundover");
  assert.equal(stolen.awarded.team, 1);
  assert.equal(stolen.awarded.points, bankBefore + 30);
  assert.equal(stolen.teams[1].score, bankBefore + 30);
  assert.equal(stolen.teams[0].score, 0);
  assert.equal(stolen.steal.result, "success");
});

test("F-U5 a failed steal leaves the bank with the controlling team", () => {
  const s = atPhase("steal");
  const missed = FC.reduce(s, { type: "steal", index: null });
  assert.equal(missed.phase, "roundover");
  assert.equal(missed.awarded.team, 0);
  assert.equal(missed.teams[0].score, s.bank);
  assert.equal(missed.steal.result, "fail");
  // Stealing an already-revealed tile is not a legal steal.
  assert.equal(FC.reduce(s, { type: "steal", index: 0 }), s);
});

test("F-U5 clearing every answer ends the round without a steal", () => {
  let s = atPhase("play");
  s = run(s, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
  assert.equal(s.phase, "roundover");
  assert.equal(s.awarded.reason, "cleared");
  assert.equal(s.awarded.team, 0);
  assert.equal(s.teams[0].score, 90);
  assert.equal(s.steal.active, false);
});

test("F-U5 revealRest fills the board without changing the score", () => {
  const s = atPhase("roundover");
  const rest = FC.reduce(s, { type: "revealRest" });
  assert.ok(rest.revealed.every(Boolean));
  assert.deepEqual(rest.teams.map((t) => t.score), s.teams.map((t) => t.score));
  assert.equal(FC.reduce(rest, { type: "revealRest" }), rest, "already full — no-op");
});

/* ============ F-U6 — multipliers ============ */

test("F-U6 multipliers apply by round index and the last value repeats", () => {
  const s = atPhase("setup");
  const at = (i) => FC.multiplierFor({ ...s, roundIndex: i });
  assert.equal(at(0), 1);
  assert.equal(at(1), 1);
  assert.equal(at(2), 2);
  assert.equal(at(3), 3);
  assert.equal(at(4), 3, "the last multiplier repeats for extra rounds");
  assert.equal(at(11), 3);
});

/** From `roundover`, play the next round out to `roundover` again. */
function playNextRound(state, team) {
  return run(state, { type: "nextRound" }, { type: "giveControl", team }, { type: "play" },
    { type: "reveal", index: 0 }, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
}

test("F-U6 the round multiplier scales the award", () => {
  let s = atPhase("roundover"); // round 1, ×1
  assert.equal(s.teams[0].score, 50);
  s = playNextRound(s, "A"); // round 2, ×1
  assert.equal(s.roundIndex, 1);
  assert.equal(s.awarded.points, 80, "40 + 25 + 15 at ×1");
  s = FC.reduce(s, { type: "nextRound" }); // round 3 → ×2
  assert.equal(s.roundIndex, 2);
  assert.equal(FC.multiplierFor(s), 2);
  s = run(s, { type: "buzz", team: "B", host: true }, { type: "reveal", index: 0 },
    { type: "play" }, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
  assert.equal(s.phase, "roundover");
  assert.equal(FC.roundPoints(s), 77);
  assert.equal(s.awarded.points, 154, "77 × 2");
  assert.equal(s.teams[1].score, 154);
});

test("F-U6 nextRound stops at roundsToPlay", () => {
  let s = FC.createState(tinyGame(), { roundsToPlay: 2 });
  assert.equal(s.roundsToPlay, 2);
  s = run(s, { type: "start" }, { type: "giveControl", team: "A" }, { type: "play" },
    { type: "reveal", index: 0 }, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
  s = FC.reduce(s, { type: "nextRound" });
  assert.equal(s.roundIndex, 1);
  s = run(s, { type: "giveControl", team: "A" }, { type: "play" },
    { type: "reveal", index: 0 }, { type: "reveal", index: 1 }, { type: "reveal", index: 2 });
  assert.equal(FC.reduce(s, { type: "nextRound" }), s, "no round 3 to play");
});

/* ============ F-U7 — undo ============ */

test("F-U7 undo restores the previous state exactly", () => {
  const before = atPhase("play");
  const after = FC.reduce(before, { type: "strike" });
  const undone = FC.reduce(after, { type: "undo" });
  assert.deepEqual(clone(undone), clone(before));
  assert.equal(undone.game, before.game, "content is shared, not re-cloned");
});

test("F-U7 undo unwinds a multi-step sequence one step at a time", () => {
  const start = atPhase("faceoff");
  const steps = [
    { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 0 },
    { type: "play" },
    { type: "reveal", index: 1 },
    { type: "strike" },
  ];
  const trail = [start];
  steps.forEach((e) => trail.push(FC.reduce(trail[trail.length - 1], e)));
  let s = trail[trail.length - 1];
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    s = FC.reduce(s, { type: "undo" });
    assert.deepEqual(clone(s), clone(trail[i]), `undo back to step ${i}`);
  }
});

test("F-U7 undo is a no-op with empty history and the stack is capped", () => {
  const s = atPhase("setup");
  assert.equal(s.history.length, 0);
  assert.equal(FC.reduce(s, { type: "undo" }), s);
  let deep = atPhase("play");
  for (let i = 0; i < FC.HISTORY_MAX + 15; i += 1) {
    deep = FC.reduce(deep, { type: "setScore", team: "A", score: i + 1 });
  }
  assert.equal(deep.history.length, FC.HISTORY_MAX);
  assert.ok(FC.HISTORY_MAX >= 20, "spec asks for at least 20 undo steps");
  // History entries never carry the content or a nested history (no growth blow-up).
  deep.history.forEach((h) => {
    assert.equal(h.game, undefined);
    assert.equal(h.history, undefined);
  });
});

/* ============ F-U8 — Fast Money ============ */

/** Fast Money state with both players seated. */
function fmState() {
  return atPhase("fastmoney");
}

test("F-U8 Fast Money totals the revealed points across both players", () => {
  let s = fmState();
  assert.equal(s.fastMoney.stage, "play");
  assert.equal(s.fastMoney.slot, 1);
  s = run(s,
    { type: "fmAnswer", slot: 1, q: 0, text: "top" },
    { type: "fmAdvance" }, // play → reveal
    { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 }, // 60
    { type: "fmReveal", slot: 1, q: 1, answerIndex: 2 }, // 5
    { type: "fmReveal", slot: 1, q: 2, answerIndex: null }); // 0
  assert.equal(FC.fmTotal(s), 65);
  assert.equal(s.fastMoney.rows[1][0].points, 60);
  assert.equal(s.fastMoney.rows[1][2].points, 0);
  assert.equal(s.fastMoney.rows[1][2].revealed, true);
});

test("F-U8 a duplicate board answer scores 0 and is flagged", () => {
  let s = fmState();
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 },
    { type: "fmAdvance" }, // reveal → cover (player 2 up)
    { type: "fmAdvance" }); // cover → play
  assert.equal(s.fastMoney.slot, 2);
  assert.equal(s.fastMoney.stage, "play");
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 2, q: 0, answerIndex: 0 });
  assert.equal(s.fastMoney.rows[2][0].duplicate, true);
  assert.equal(s.fastMoney.rows[2][0].points, 0);
  assert.equal(FC.fmTotal(s), 60, "only player 1's 60 counts");
  // A different answer to the same question is not a duplicate.
  const different = FC.reduce(s, { type: "fmReveal", slot: 2, q: 1, answerIndex: 0 });
  assert.equal(different.fastMoney.rows[2][1].duplicate, false);
  assert.equal(different.fastMoney.rows[2][1].points, 50);
});

test("F-U8 reaching the target sets the winner flag", () => {
  const reveals = (slot) => [0, 1, 2, 3, 4].map((q2) => ({ type: "fmReveal", slot, q: q2, answerIndex: 0 }));
  let s = fmState();
  s = run(s, { type: "fmAdvance" }, ...reveals(1), { type: "fmAdvance" }, { type: "fmAdvance" });
  s = run(s, { type: "fmAdvance" }, ...reveals(2).map((e) => ({ ...e, answerIndex: 1 })));
  const total = FC.fmTotal(s);
  assert.equal(total, 230 + 140);
  s = FC.reduce(s, { type: "fmAdvance" });
  assert.equal(s.fastMoney.stage, "done");
  assert.equal(s.fastMoney.winner, true);
  assert.match(s.message, /winner/i);
});

test("F-U8 falling short of the target sets winner false", () => {
  let s = fmState();
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 2 },
    { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmReveal", slot: 2, q: 0, answerIndex: 1 }, { type: "fmAdvance" });
  assert.equal(s.fastMoney.stage, "done");
  assert.equal(s.fastMoney.winner, false);
  assert.match(s.message, /so close/i);
});

test("F-U8 the Fast Money timer is a cue: it never changes the stage", () => {
  let s = fmState();
  s = FC.reduce(s, { type: "fmTimer", action: "start", now: 1000 });
  assert.deepEqual(s.fastMoney.timer, { running: true, startedAt: 1000, seconds: 20, slot: 1 });
  assert.equal(s.fastMoney.stage, "play", "starting the clock does not advance anything");
  const stopped = FC.reduce(s, { type: "fmTimer", action: "stop" });
  assert.equal(stopped.fastMoney.timer.running, false);
  assert.equal(stopped.fastMoney.stage, "play");
  // Answers stay editable after the clock stops (host can still accept one).
  const late = FC.reduce(stopped, { type: "fmAnswer", slot: 1, q: 4, text: "late" });
  assert.equal(late.fastMoney.rows[1][4].text, "late");
});

test("F-U8 fmAnswer refuses another player's slot and revealed rows", () => {
  let s = fmState();
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "x", pid: "p2" }), s);
  s = FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "  keep me  ", pid: "p1" });
  assert.equal(s.fastMoney.rows[1][0].text, "keep me");
  const revealed = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 1 });
  assert.equal(FC.reduce(revealed, { type: "fmAnswer", slot: 1, q: 0, text: "nope" }), revealed);
  // Junk slots / question indexes are ignored.
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 3, q: 0, text: "x" }), s);
  assert.equal(FC.reduce(s, { type: "fmAnswer", slot: 1, q: 9, text: "x" }), s);
  assert.equal(FC.reduce(s, { type: "fmReveal", slot: 1, q: 0, answerIndex: 99 }), s);
});

/* ============ F-U9 — illegal events, frozen inputs ============ */

const ALL_EVENTS = [
  { type: "start" },
  { type: "buzz", team: "A", host: true },
  { type: "reveal", index: 0 },
  { type: "notOnBoard" },
  { type: "giveControl", team: "A" },
  { type: "faceoffAgain" },
  { type: "arm", on: true },
  { type: "setPodium", team: "A", pid: "p1" },
  { type: "play" },
  { type: "pass" },
  { type: "strike" },
  { type: "steal", index: 1 },
  { type: "steal", index: null },
  { type: "revealRest" },
  { type: "nextRound" },
  { type: "beginFastMoney", players: ["p1", "p2"] },
  { type: "fmAnswer", slot: 1, q: 0, text: "x" },
  { type: "fmReveal", slot: 1, q: 0, answerIndex: 0 },
  { type: "fmAdvance" },
  { type: "fmTimer", action: "start" },
  { type: "finish" },
  { type: "setScore", team: "A", score: 100 },
  { type: "setTeam", pid: "p9", team: "A" },
  { type: "setTeamName", team: "A", name: "Renamed" },
  { type: "setRoundsToPlay", count: 2 },
  { type: "setFastMoney", on: false },
];

/** Event types that may legally change state in each phase. */
const LEGAL = {
  setup: ["start", "setTeam", "setTeamName", "setRoundsToPlay", "setFastMoney", "setScore"],
  faceoff: ["buzz", "giveControl", "faceoffAgain", "arm", "setPodium", "setScore"],
  playpass: ["play", "pass", "setScore"],
  play: ["reveal", "strike", "setScore"],
  steal: ["steal", "setScore"],
  roundover: ["revealRest", "nextRound", "beginFastMoney", "finish", "setScore"],
  fastmoney: ["fmAnswer", "fmReveal", "fmAdvance", "fmTimer", "finish", "setScore"],
  final: ["setScore"],
};

test("F-U9 every event that is illegal for a phase leaves state untouched", () => {
  Object.keys(LEGAL).forEach((phase) => {
    const state = deepFreeze(atPhase(phase));
    assert.equal(state.phase, phase);
    ALL_EVENTS.forEach((event) => {
      const next = FC.reduce(state, event);
      if (LEGAL[phase].indexOf(event.type) === -1) {
        assert.equal(next, state, `${event.type} must be a no-op in phase ${phase}`);
      }
    });
  });
});

test("F-U9 the reducer never mutates a deep-frozen state and never throws on junk", () => {
  Object.keys(LEGAL).forEach((phase) => {
    const state = deepFreeze(atPhase(phase));
    const before = clone(state);
    ALL_EVENTS.concat([
      { type: "undo" }, { type: "nope" }, { type: 7 }, {}, null, undefined, "buzz", [],
      { type: "reveal", index: -1 }, { type: "reveal", index: 99 }, { type: "reveal" },
      { type: "setScore", team: "C", score: 1 }, { type: "setScore", team: "A", score: 1.5 },
      { type: "buzz", team: "Z" }, { type: "giveControl", team: null },
    ]).forEach((event) => {
      assert.doesNotThrow(() => FC.reduce(state, event), `${JSON.stringify(event)} in ${phase}`);
    });
    assert.deepEqual(clone(state), before, `state unchanged in phase ${phase}`);
  });
});

/* ============ F-U10 — phone payloads and phoneView ============ */

test("F-U10 validatePhoneMsg accepts the documented payloads", () => {
  assert.deepEqual(FC.validatePhoneMsg({ t: "team", team: "A" }), { t: "team", team: "A" });
  assert.deepEqual(FC.validatePhoneMsg({ t: "team", team: "B" }), { t: "team", team: "B" });
  assert.deepEqual(FC.validatePhoneMsg({ t: "buzz" }), { t: "buzz" });
  assert.deepEqual(FC.validatePhoneMsg({ t: "fm-answer", slot: 2, q: 4, text: "Cherry" }),
    { t: "fm-answer", slot: 2, q: 4, text: "Cherry" });
  // Extra fields are dropped, not trusted.
  assert.deepEqual(FC.validatePhoneMsg({ t: "buzz", pid: "p1", admin: true }), { t: "buzz" });
});

test("F-U10 validatePhoneMsg strips control characters and caps the text", () => {
  const dirty = `  Ap${String.fromCharCode(0)}ple${String.fromCharCode(27)}  `;
  assert.equal(FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: dirty }).text, "Apple");
  const long = "z".repeat(200);
  assert.equal(FC.validatePhoneMsg({ t: "fm-answer", slot: 1, q: 0, text: long }).text.length, 60);
});

test("F-U10 validatePhoneMsg rejects junk", () => {
  [null, undefined, 7, "buzz", [], {}, { t: 1 }, { t: "nope" },
    { t: "team" }, { t: "team", team: "C" }, { t: "team", team: 0 },
    { t: "fm-answer", slot: 0, q: 0, text: "x" },
    { t: "fm-answer", slot: 1, q: 5, text: "x" },
    { t: "fm-answer", slot: 1, q: -1, text: "x" },
    { t: "fm-answer", slot: 1, q: 1.5, text: "x" },
    { t: "fm-answer", slot: 1, q: 0, text: 7 },
    { t: "fm-answer", slot: 1, q: 0, text: "x".repeat(601) },
  ].forEach((junk) => assert.equal(FC.validatePhoneMsg(junk), null, JSON.stringify(junk)));
});

test("F-U10 phoneView shows the right screen per phase", () => {
  assert.equal(FC.phoneView(atPhase("setup"), "p1").screen, "team-pick");
  const faceoff = FC.reduce(atPhase("faceoff"), { type: "arm", on: true });
  const podium = FC.phoneView(faceoff, "p1");
  assert.equal(podium.screen, "faceoff");
  assert.equal(podium.armed, true);
  assert.equal(podium.atPodium, true);
  assert.equal(podium.question, "R1");
  const bystander = FC.phoneView(faceoff, "p7");
  assert.equal(bystander.screen, "wait");
  assert.equal(bystander.armed, false);
  assert.equal(FC.phoneView(atPhase("play"), "p1").screen, "wait");
  assert.equal(FC.phoneView(atPhase("roundover"), "p1").screen, "result");
  assert.equal(FC.phoneView(atPhase("final"), "p1").screen, "result");
  const fm = fmState();
  assert.equal(FC.phoneView(fm, "p1").screen, "fm-answer");
  assert.equal(FC.phoneView(fm, "p2").screen, "fm-wait");
  assert.equal(FC.phoneView(fm, "p9").screen, "wait");
});

test("F-U10 phoneView never leaks the other Fast Money player's answers", () => {
  let s = fmState();
  s = FC.reduce(s, { type: "fmAnswer", slot: 1, q: 0, text: "SECRET-ONE" });
  const two = FC.phoneView(s, "p2");
  assert.equal(two.screen, "fm-wait");
  assert.ok(!JSON.stringify(two).includes("SECRET-ONE"));
  // Player 2's turn: their own view carries only their own rows.
  s = run(s, { type: "fmAdvance" }, { type: "fmAdvance" }, { type: "fmAdvance" },
    { type: "fmAnswer", slot: 2, q: 0, text: "MINE" });
  const own = FC.phoneView(s, "p2");
  assert.equal(own.screen, "fm-answer");
  assert.equal(own.fm.slot, 2);
  assert.equal(own.fm.rows[0].text, "MINE");
  assert.ok(!JSON.stringify(own).includes("SECRET-ONE"));
  assert.deepEqual(own.fm.questions, ["F1", "F2", "F3", "F4", "F5"]);
  // The board answers/counts are never sent to a phone either.
  assert.ok(!JSON.stringify(own).includes("Answer 1"));
});

test("F-U10 teamOfPid and podiumFor follow the roster", () => {
  const s = atPhase("faceoff");
  assert.equal(FC.teamOfPid(s, "p1"), 0);
  assert.equal(FC.teamOfPid(s, "p2"), 1);
  assert.equal(FC.teamOfPid(s, "p9"), null);
  assert.deepEqual(FC.podiumFor(s), ["p1", "p2"]);
  const overridden = FC.reduce(s, { type: "setPodium", team: "A", pid: "nobody" });
  assert.deepEqual(FC.podiumFor(overridden), ["p1", "p2"], "an off-roster pid falls back");
});

/* ============ Extra: state shape guarantees ============ */

test("createState honours options and reports the board through boardView", () => {
  const s = FC.createState(SHIPPED, { teamNames: ["Reds", "  "], roundsToPlay: 2, fastMoney: false });
  assert.deepEqual(s.teams.map((t) => t.name), ["Reds", "Team Red"]);
  assert.equal(s.roundsToPlay, 2);
  assert.equal(s.fastMoneyEnabled, false);
  const started = FC.reduce(s, { type: "start" });
  const board = FC.boardView(started);
  assert.equal(board.length, 5);
  assert.deepEqual(board[0], { index: 0, number: 1, text: "Check their phone", count: 48, revealed: false });
});

test("beginFastMoney defaults to the leading team and needs Fast Money on", () => {
  const off = FC.createState(tinyGame(), { fastMoney: false });
  const roundover = atPhase("roundover", tinyGame());
  assert.equal(FC.reduce({ ...roundover, fastMoneyEnabled: off.fastMoneyEnabled },
    { type: "beginFastMoney", players: ["p1", "p2"] }).phase, "roundover");
  const started = FC.reduce(roundover, { type: "beginFastMoney", players: ["p1", "p2"] });
  assert.equal(started.phase, "fastmoney");
  assert.equal(started.fastMoney.team, 0, "team A led 50–0");
  const overridden = FC.reduce(roundover, { type: "beginFastMoney", players: ["p1", "p2"], team: "B" });
  assert.equal(overridden.fastMoney.team, 1);
});
