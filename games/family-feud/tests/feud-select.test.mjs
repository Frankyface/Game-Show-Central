/* ============================================================
   Family Feud — host-phone selector tests (docs/22 §5.5, unit part)
   hostView carries the right answers in every phase, nothing in the
   phases with no secret, stays far under 16 KB, and never changes
   what a contestant phone is sent (phoneView).
   Run from games/family-feud:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import FC from "../js/feud-core.js";
import FS from "../js/feud-select.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));
const run = (s, ...events) => events.reduce((acc, e) => FC.reduce(acc, e), s);
const json = (v) => JSON.stringify(v);

function seated() {
  return run(FC.createState(SHIPPED, {}),
    { type: "setTeam", pid: "p1", team: "A" }, { type: "setTeam", pid: "p2", team: "B" });
}

const ROUND1 = SHIPPED.rounds[0].answers.map((a) => a.text); // already sorted by count

test("HV setup and final standings carry nothing secret", () => {
  const setup = FS.hostView(seated());
  assert.equal(setup.kind, "none");
  assert.equal(setup.item, "");
  assert.equal(setup.phaseText, "Setting up");
  ROUND1.forEach((t) => assert.ok(!json(setup).includes(t), `setup leaks ${t}`));
  const final = FS.hostView(run(seated(), { type: "start" }, { type: "giveControl", team: "A" },
    { type: "play" }, ...[0, 1, 2, 3, 4].map((index) => ({ type: "reveal", index })), { type: "finish" }));
  assert.equal(final.kind, "none");
  assert.equal(final.phase, "final");
});

test("HV face-off: the whole survey, numbered, with counts and nothing revealed yet", () => {
  const v = FS.hostView(run(seated(), { type: "start" }));
  assert.equal(v.kind, "survey");
  assert.equal(v.item, "Round 1 of 6");
  assert.equal(v.survey.question, SHIPPED.rounds[0].question);
  assert.deepEqual(v.survey.answers.map((a) => a.text), ROUND1);
  assert.deepEqual(v.survey.answers.map((a) => a.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(v.survey.answers[0], { n: 1, text: "Check their phone", count: 48, revealed: false });
  assert.equal(v.survey.strikes, 0);
  assert.equal(v.survey.strikeLimit, 3);
  assert.equal(v.survey.nextQuestion, null, "the next survey is not shown mid-round");
});

test("HV play: revealed ticks, strikes, bank, control and the steal team follow the game", () => {
  let s = run(seated(), { type: "start" }, { type: "buzz", team: "A", host: true },
    { type: "reveal", index: 2 }, { type: "reveal", index: 1 }, { type: "play" }, { type: "strike" });
  let v = FS.hostView(s);
  assert.deepEqual(v.survey.answers.map((a) => a.revealed), [false, true, true, false, false]);
  assert.equal(v.survey.strikes, 1);
  assert.equal(v.survey.bank, 29);
  assert.equal(v.survey.control, "Team Red");
  s = run(s, { type: "strike" }, { type: "strike" });
  v = FS.hostView(s);
  assert.equal(v.phase, "steal");
  assert.equal(v.survey.stealing, "Team Blue");
});

test("HV round over shows the next question but none of its answers; the item changes", () => {
  const s = run(seated(), { type: "start" }, { type: "giveControl", team: "A" }, { type: "play" },
    ...[0, 1, 2, 3, 4].map((index) => ({ type: "reveal", index })));
  const v = FS.hostView(s);
  assert.equal(v.phase, "roundover");
  assert.equal(v.survey.nextQuestion, SHIPPED.rounds[1].question);
  SHIPPED.rounds[1].answers.forEach((a) => assert.ok(!json(v).includes(`"${a.text}"`), `leaks ${a.text}`));
  const next = FS.hostView(FC.reduce(s, { type: "nextRound" }));
  assert.equal(next.item, "Round 2 of 6");
  assert.notEqual(next.item, v.item);
  assert.equal(next.survey.answers[0].text, SHIPPED.rounds[1].answers[0].text);
});

test("HV Fast Money: five questions with numbered answers, counts and both sheets' picks", () => {
  let s = run(seated(), { type: "start" }, { type: "giveControl", team: "A" }, { type: "play" },
    ...[0, 1, 2, 3, 4].map((index) => ({ type: "reveal", index })),
    { type: "beginFastMoney", players: ["p1", null] });
  let v = FS.hostView(s);
  assert.equal(v.kind, "fastmoney");
  assert.equal(v.item, "Fast Money · player 1");
  assert.equal(v.fastMoney.questions.length, 5);
  assert.deepEqual(v.fastMoney.questions[0].answers[0], { n: 1, text: "Apple", count: 52 });
  assert.equal(v.fastMoney.questions[0].picks[1].n, null);
  s = run(s, { type: "fmAdvance" }, { type: "fmReveal", slot: 1, q: 0, answerIndex: 1 });
  v = FS.hostView(s);
  assert.deepEqual(v.fastMoney.questions[0].picks[1], { n: 2, revealed: true, duplicate: false });
  assert.equal(v.fastMoney.total, 24);
  s = run(s, { type: "fmAdvance" }, { type: "fmAdvance" });
  v = FS.hostView(s);
  assert.equal(v.item, "Fast Money · player 2", "player 2 is a new item");
});

test("HV is deterministic, never mutates state and stays far under 16 KB", () => {
  const s = Object.freeze(run(seated(), { type: "start" }));
  assert.equal(json(FS.hostView(s)), json(FS.hostView(s)));
  // Worst case the validator allows: 8 answers of 40 chars, 200-char questions.
  const wide = JSON.parse(JSON.stringify(SHIPPED));
  const long = (n) => "x".repeat(40 - String(n).length) + n;
  wide.rounds[0] = { question: "q".repeat(200), answers: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ text: long(n), count: 9 })) };
  wide.fastMoney = wide.fastMoney.map((q, i) => ({
    question: "f".repeat(199) + i, answers: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ text: long(n), count: 9 })),
  }));
  let w = run(FC.createState(wide, {}), { type: "start" });
  assert.ok(Buffer.byteLength(json(FS.hostView(w))) < 16384);
  w = run(w, { type: "giveControl", team: "A" }, { type: "play" },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({ type: "reveal", index })),
    { type: "beginFastMoney", players: [null, null] });
  const bytes = Buffer.byteLength(json(FS.hostView(w)));
  assert.ok(bytes < 16384, `Fast Money host view is ${bytes} bytes`);
});

test("HV leaves phoneView alone: a contestant still never sees a board answer", () => {
  const s = run(seated(), { type: "start" }, { type: "arm", on: true });
  const before = json(FC.phoneView(s, "p1"));
  FS.hostView(s);
  assert.equal(json(FC.phoneView(s, "p1")), before);
  ROUND1.forEach((t) => assert.ok(!before.includes(t)));
});

test("F10 fmPickOptions hides answer text in private mode and shows it otherwise", () => {
  const q = SHIPPED.fastMoney[0];
  const hidden = FS.fmPickOptions(q, true);
  assert.deepEqual(hidden.map((o) => o.label),
    ["Pick the answer number…", "Answer 1", "Answer 2", "Answer 3", "Answer 4", "No match → 0"]);
  q.answers.forEach((a) => assert.ok(!json(hidden).includes(a.text)));
  assert.deepEqual(hidden.map((o) => o.value), ["", "0", "1", "2", "3", "none"]);
  const shown = FS.fmPickOptions(q, false);
  assert.equal(shown[1].label, "Apple — 52");
  assert.deepEqual(shown.map((o) => o.value), hidden.map((o) => o.value), "values never change");
});
