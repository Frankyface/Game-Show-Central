/* ============================================================
   Pyramid — host-phone view (docs/22 §5.1, §5.5 unit half)
   hostView holds the right secret at each phase, nothing in phases
   with no secret, stays small, never mutates, and phoneView is
   unchanged by its existence.
   Run with:  cd games/pyramid && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  Core, boot, runCategory, playWholeBoard, toCircle, openCircle, levelBoard, deepFreeze, PIDS,
} from "./pyr-fixtures.mjs";

const require = createRequire(import.meta.url);
const HV = require("../js/pyr-host-view.js");

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

test("HV-1 setup, the board and the end of the main game have nothing secret", () => {
  const board = boot({ wordsPerCategory: 4, categoriesPerTeam: 1 });
  assert.deepEqual(HV.hostView(null), { secret: false, phase: "setup", phaseLabel: "Setup" });
  const v = HV.hostView(board);
  assert.equal(v.secret, false);
  assert.equal(v.phase, "board");
  assert.equal(JSON.stringify(v).indexOf("w1_"), -1, "no word of any card on the board view");
  const end = playWholeBoard(board, ["correct", "correct", "correct", "correct"]);
  assert.equal(end.phase, "mainResult");
  assert.equal(HV.hostView(end).secret, false);
  assert.equal(HV.currentAnswer(board), "");
});

test("HV-2 in a category the host sees the theme, all seven words with status, and the current one", () => {
  let s = runCategory(boot({ wordsPerCategory: 4, categoriesPerTeam: 1 }), 0, ["correct", "pass"], 1000);
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.kind, "round");
  assert.equal(v.round.title, s.round.title);
  assert.equal(v.round.hint, s.round.hint);
  assert.deepEqual(v.round.words.map((w) => w.text), s.round.words.map((w) => w.text));
  assert.deepEqual(v.round.words.map((w) => w.status), ["correct", "passed", "pending", "pending"]);
  assert.equal(v.round.current, Core.currentWord(s));
  assert.equal(v.round.words.filter((w) => w.current).length, 1);
  assert.equal(v.round.words.find((w) => w.current).text, Core.currentWord(s));
  assert.equal(v.round.giver, "Ada");
  assert.equal(v.round.done, 1);
  assert.equal(HV.currentAnswer(s), Core.currentWord(s));

  s = Core.reduce(s, { type: "mark", result: "illegal" }, 2000);
  assert.equal(HV.hostView(s).round.words[2].status, "illegal");
  assert.equal(HV.hostView(s).round.current, Core.currentWord(s));
});

test("HV-3 the item key moves with the word, so the shared-screen fallback clears on the next item", () => {
  let s = runCategory(boot({ wordsPerCategory: 4, categoriesPerTeam: 1 }), 0, [], 1000);
  const first = HV.itemKey(s);
  assert.equal(HV.itemKey(s), first, "stable while nothing changes");
  s = Core.reduce(s, { type: "clockPause" }, 2000);
  assert.equal(HV.itemKey(s), first, "a pause is not a new item");
  s = Core.reduce(s, { type: "mark", result: "correct" }, 2100);
  assert.notEqual(HV.itemKey(s), first);
  assert.equal(HV.itemKey(s).indexOf(Core.currentWord(s)), -1, "the item label never carries the word");
});

test("HV-4 a finished round is public on the shared screen, so the phone stops treating it as secret", () => {
  const s = runCategory(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), 0, ["correct", "correct", "correct"], 1000);
  assert.equal(s.round.finished, true);
  assert.equal(HV.hostView(s).secret, false);
  assert.equal(HV.currentAnswer(s), "");
});

test("HV-5 the Winner's Circle: six subjects with values and status, the current one marked", () => {
  let s = openCircle(0);
  let v = HV.hostView(s);
  assert.equal(v.kind, "circle");
  assert.deepEqual(v.circle.boxes.map((b) => b.category), s.circle.boxes.map((b) => b.category));
  assert.equal(v.circle.current, s.circle.boxes[0].category);
  assert.equal(v.circle.currentValue, "$200");
  s = Core.reduce(s, { type: "circleMark", result: "correct" }, 900200);
  s = Core.reduce(s, { type: "circleMark", result: "illegal" }, 900300);
  v = HV.hostView(s);
  assert.deepEqual(v.circle.boxes.slice(0, 2).map((b) => b.status), ["won", "blocked"]);
  assert.equal(v.circle.current, s.circle.boxes[2].category);
  assert.equal(v.circle.winnings, "$200");
  assert.equal(HV.currentAnswer(s), s.circle.boxes[2].category);
  // Before the clock starts the subjects are already the host's to read.
  const before = toCircle(playWholeBoard(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), ["correct"]), 0);
  assert.equal(HV.hostView(before).secret, true);
});

test("HV-6 the tiebreak is a round like any other: its words are on the host phone", () => {
  let s = levelBoard(3);
  s = Core.reduce(s, { type: "tiebreak" }, 300000);
  const v = HV.hostView(s);
  assert.equal(v.kind, "round");
  assert.equal(v.round.tiebreak, true);
  assert.equal(v.round.current, Core.currentWord(s));
});

test("HV-7 result and standings say nothing secret", () => {
  let s = openCircle(0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "circleMark", result: "correct" }, 900200 + i);
  s = Core.reduce(s, { type: "nextTurn" }, 900300);
  assert.equal(s.phase, "result");
  assert.equal(HV.hostView(s).secret, false);
  s = Core.reduce(s, { type: "nextTurn" }, 900400);
  assert.equal(HV.hostView(s).secret, false);
});

test("HV-8 pure: a deep-frozen state is never mutated, and the view stays far under 16 KB", () => {
  const s = deepFreeze(runCategory(boot({ wordsPerCategory: 12, categoriesPerTeam: 1 }), 0, ["pass"], 1000));
  const v = HV.hostView(s);
  assert.ok(bytes(v) < 2048, `${bytes(v)} bytes`);
  assert.deepEqual(HV.hostView(s), v, "deterministic");
  const c = deepFreeze(openCircle(0));
  assert.ok(bytes(HV.hostView(c)) < 2048);
});

test("HV-9 phoneView is unchanged: no host-view fields reach any contestant", () => {
  const s = runCategory(boot({ wordsPerCategory: 4, categoriesPerTeam: 1 }), 0, ["pass"], 1000);
  const words = s.round.words.map((w) => w.text);
  PIDS.forEach((pid) => {
    const view = Core.phoneView(s, pid);
    ["secret", "kind", "round", "words"].forEach((k) => assert.equal(k in view, false, `${pid} has ${k}`));
    if (pid !== s.round.giverPid) {
      const text = JSON.stringify(view);
      words.forEach((w) => assert.equal(text.indexOf(w), -1, `${pid} saw ${w}`));
    }
  });
});
