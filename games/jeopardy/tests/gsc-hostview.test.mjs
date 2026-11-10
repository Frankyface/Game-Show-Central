/* ============================================================
   Unit tests for the pure host-phone view (js/gsc-hostview.js,
   docs/22 §5.5): the right answer at each phase, nothing in phases
   with no secret, no mutation, and always under the 16 KB rule.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import HV from "../js/gsc-hostview.js";

const GAME = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url), "utf8"));
const PLAYERS = [
  { id: "a", name: "Ann", score: 600 },
  { id: "b", name: "Bo", score: -200 },
];
const base = (patch) => ({
  phase: "board", game: GAME, players: PLAYERS, used: {}, active: null,
  final: null, finalPlayed: false, buzzer: { roomCode: null }, settings: {},
  ...patch,
});
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };
const open = (cat, row, extra) => ({ cat, row, revealed: false, missed: {}, isDailyDouble: false,
  wagerLocked: false, wager: 0, wagerPlayerId: null, ...extra });

test("HV-1 setup and an idle board carry nothing secret", () => {
  for (const s of [base({ phase: "setup" }), base({ phase: "board" }), null, undefined]) {
    const v = HV.build(s);
    assert.equal(v.t, "host");
    assert.equal(v.secret, false);
    assert.equal(v.kind, "quiet");
    assert.ok(!("answer" in v) && !("clue" in v));
  }
  assert.equal(HV.build(base({ phase: "board" })).phase, "Board");
});

test("HV-2 an open clue carries category, value, clue and the correct response", () => {
  const clue = GAME.categories[0].clues[0];
  const v = HV.build(base({ active: open(0, 0) }));
  assert.equal(v.kind, "clue");
  assert.equal(v.secret, true);
  assert.equal(v.category, GAME.categories[0].name);
  assert.equal(v.value, "$200");
  assert.equal(v.clue, clue.clue);
  assert.equal(v.answer, clue.answer);
  assert.equal(v.item, `${GAME.categories[0].name} · $200`);
  assert.equal(v.dailyDouble, null);
  assert.equal(v.hasImage, false);
  assert.equal(v.hasAnswerImage, false);
});

test("HV-3 Daily Double: context before and after the wager locks", () => {
  const before = HV.build(base({ active: open(1, 3, { isDailyDouble: true }) }));
  assert.match(before.item, /^Daily Double · /);
  assert.deepEqual(before.dailyDouble, { wagerLocked: false, wager: "", player: "" });
  assert.equal(before.answer, GAME.categories[1].clues[3].answer);
  const after = HV.build(base({ active: open(1, 3, { isDailyDouble: true, wagerLocked: true, wager: 1500, wagerPlayerId: "a" }) }));
  assert.deepEqual(after.dailyDouble, { wagerLocked: true, wager: "$1,500", player: "Ann" });
});

test("HV-4 Final Jeopardy carries clue + response at every stage but standings", () => {
  const fj = GAME.finalJeopardy;
  for (const stage of ["wager", "clue", "judge"]) {
    const v = HV.build(base({ final: { stage, wagers: {}, answers: {}, judged: {} } }));
    assert.equal(v.kind, "final");
    assert.equal(v.stage, stage);
    assert.equal(v.clue, fj.clue);
    assert.equal(v.answer, fj.answer);
  }
  const s = HV.build(base({ final: { stage: "standings", wagers: {}, answers: {}, judged: {} } }));
  assert.equal(s.secret, false);
  assert.ok(!("answer" in s));
});

test("HV-5 image flags, never the image itself", () => {
  const img = "https://example.test/x.png";
  const game = { ...GAME, categories: [{ name: "Pics", clues: [{ value: 100, clue: "c", answer: "a", image: img, answerImage: "data:image/png;base64,AAAA" }] }] };
  const v = HV.build(base({ game, active: open(0, 0) }));
  assert.equal(v.hasImage, true);
  assert.equal(v.hasAnswerImage, true);
  assert.ok(!JSON.stringify(v).includes(img) && !JSON.stringify(v).includes("base64"));
});

test("HV-6 pure: frozen input, identical output, under 16 KB with huge text", () => {
  const s = deepFreeze(base({ active: open(2, 4) }));
  assert.deepEqual(HV.build(s), HV.build(s));
  const huge = "x".repeat(50000);
  const game = { ...GAME, categories: [{ name: huge, clues: [{ value: 1, clue: huge, answer: huge }] }] };
  const v = HV.build(base({ game, active: open(0, 0) }));
  assert.ok(Buffer.byteLength(JSON.stringify(v), "utf8") < 16384);
  assert.ok(v.clue.length <= HV.TEXT_MAX && v.answer.length <= HV.TEXT_MAX);
});

test("HV-7 a dangling active pointer degrades to a quiet board, never throws", () => {
  const v = HV.build(base({ active: open(9, 9) }));
  assert.equal(v.secret, false);
});
