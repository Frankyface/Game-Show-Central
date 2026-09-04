/* ============================================================
   Pyramid — ADVERSARIAL suite, part 2: hostile input (A7 … A11)
   The transport, the validator under fuzz, immutability against a
   deep-frozen state, undo across every phase, and the shipped
   content. Part 1 (tests/pyr-adversarial.test.mjs) covers the
   rules. Shared builders live in tests/pyr-fixtures.mjs.
   Run with:  cd games/pyramid && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  Core, Content, game, words, TEAMS, rngOf, boot, runCategory,
  playWholeBoard, toCircle, levelBoard, openCircle, deepFreeze, PIDS,
} from "./pyr-fixtures.mjs";

const require = createRequire(import.meta.url);
const DATA = require("../js/data.js");
const FILE = JSON.parse(readFileSync(new URL("../categories.json", import.meta.url), "utf8"));

/* ============================================================
   A7 — the phone protocol is an intent, not an instruction
   ============================================================ */

test("A7 an illegal clue can never arrive from a phone", () => {
  assert.equal(Core.validatePhoneMsg({ t: "mark", result: "illegal" }), null);
  assert.equal(Core.validatePhoneMsg({ t: "mark", result: "ILLEGAL" }), null);
  assert.equal(Core.validatePhoneMsg({ t: "mark", result: " illegal " }), null);
  assert.equal(Core.validatePhoneMsg({ t: "circleMark", result: "illegal" }), null);
});

test("A7 no hostile frame gets through validatePhoneMsg", () => {
  const junk = [
    null, undefined, 0, 1, "", "mark", [], [{ t: "mark" }], true, NaN,
    { t: "mark", result: "correct", extra: "drop me" },
    { t: "undo" }, { t: "finish" }, { t: "toCircle", team: 0 }, { t: "pickCategory", index: 0 },
    { t: "clockStart" }, { t: "start" }, { t: "__proto__" }, { t: "constructor" },
    { result: "correct" }, { t: 1, result: "correct" }, { t: "mark", result: null },
    { t: "mark", result: { toString: () => "correct" } },
    { t: "mark", result: ["correct"] },
    JSON.parse('{"t":"mark","result":"correct","__proto__":{"polluted":1}}'),
  ];
  junk.forEach((msg) => {
    const out = Core.validatePhoneMsg(msg);
    if (out === null) return;
    assert.notEqual(out, msg, "an accepted frame must be a fresh copy, never the caller's object");
    assert.deepEqual(Object.keys(out).sort(), ["result", "t"]);
    assert.equal(out.t, "mark");
    assert.ok(out.result === "correct" || out.result === "pass");
  });
  assert.equal({}.polluted, undefined, "validatePhoneMsg must not pollute Object.prototype");
  assert.equal(Core.validatePhoneMsg({ t: "ready", junk: 1 }).junk, undefined);
});

/**
 * The host-side gate lives in pyr-app.js `pyrPhoneMark`, which is DOM-bound.
 * This is that rule restated against the pure state, so the core keeps
 * carrying the two facts the gate needs.
 */
function hostWouldAccept(state, pid, result) {
  if (!state || (result !== "correct" && result !== "pass")) return false;
  if (state.phase === "play" && state.round && state.round.giverPid === pid) return true;
  return !!(state.phase === "circle" && state.circle && state.circle.giverPid === pid);
}

test("A7 only the current giver's phone may mark — the guesser and the bench cannot", () => {
  let s = boot();
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  assert.equal(hostWouldAccept(s, s.round.giverPid, "correct"), true);
  [s.round.guesserPid, "p3", "p4", "ghost", "", "__proto__"].forEach((pid) => {
    assert.equal(hostWouldAccept(s, pid, "correct"), false, `${pid} was allowed to mark`);
    assert.equal(hostWouldAccept(s, pid, "pass"), false);
  });
  assert.equal(hostWouldAccept(s, s.round.giverPid, "illegal"), false, "illegal is host-only");

  const c = openCircle(0);
  assert.equal(hostWouldAccept(c, c.circle.giverPid, "pass"), true);
  assert.equal(hostWouldAccept(c, c.circle.guesserPid, "correct"), false);
  // A category giver whose team is not in the circle cannot mark the circle.
  assert.equal(hostWouldAccept(c, "p3", "correct"), false);
});

test("A7 a mark that slipped past the gate still dies at the reducer", () => {
  let s = Core.reduce(boot(), { type: "pickCategory", index: 0 }, 1000);
  const msg = Core.validatePhoneMsg({ t: "mark", result: "correct" });
  assert.equal(Core.reduce(s, { type: "mark", result: msg.result }, 1100), s, "the clock is not running");
  const finished = runCategory(boot({ wordsPerCategory: 3 }), 0, ["correct", "correct", "correct"], 1000);
  assert.equal(Core.reduce(finished, { type: "mark", result: "correct" }, 2000), finished);
  const board = Core.reduce(finished, { type: "nextTurn" }, 2100);
  assert.equal(Core.reduce(board, { type: "mark", result: "correct" }, 2200), board, "no round is running");
  const circle = openCircle(0);
  assert.equal(Core.reduce(circle, { type: "mark", result: "correct" }, 2300), circle,
    "a category mark cannot touch the Winner's Circle");
});

/* ============================================================
   A8 — validator fuzz
   ============================================================ */

function mutate(fn) {
  const g = game();
  fn(g);
  return g;
}

test("A8 the validator rejects every broken shape with a plain-English message", () => {
  const cases = [
    ["6 words where 7 are asked for", mutate((g) => { g.settings.wordsPerCategory = 7; }), /exactly 7/],
    ["8 words in one category", mutate((g) => { g.categories[3].words.push("extra"); }), /exactly 4/],
    ["a duplicate word, case folded", mutate((g) => {
      g.categories[0].words[1] = g.categories[0].words[0].toUpperCase();
    }), /appears twice/],
    ["a duplicate word, space folded", mutate((g) => {
      g.categories[0].words[0] = "ice cream"; g.categories[0].words[1] = " Ice   Cream ";
    }), /appears twice/],
    ["11 categories", mutate((g) => { g.categories = g.categories.slice(0, 11); }), /at least 12 categories/],
    ["a circle of five boxes", mutate((g) => { g.circles[0].boxes.pop(); }), /exactly 6 boxes/],
    ["a circle of seven boxes", mutate((g) => { g.circles[1].boxes.push({ category: "x" }); }), /exactly 6 boxes/],
    ["one circle set", mutate((g) => { g.circles = [g.circles[0]]; }), /at least 2/],
    ["a repeated subject in one circle", mutate((g) => {
      g.circles[0].boxes[5].category = g.circles[0].boxes[0].category;
    }), /appears twice/],
    ["a blank subject", mutate((g) => { g.circles[0].boxes[2].category = "   "; }), /needs a category/],
    ["a 51-character subject", mutate((g) => { g.circles[0].boxes[2].category = "z".repeat(51); }), /at most 50/],
    ["a box that is a string", mutate((g) => { g.circles[0].boxes[1] = "nope"; }), /must be an object/],
    ["categories as a string", mutate((g) => { g.categories = "nope"; }), /must be a list/],
    ["circles as a number", mutate((g) => { g.circles = 5; }), /must be a list/],
    ["settings as an array", mutate((g) => { g.settings = []; }), /must be an object/],
    ["a category that is a string", mutate((g) => { g.categories[2] = "Cat"; }), /must be an object/],
    ["a category with no title", mutate((g) => { g.categories[2].title = "  "; }), /needs a title/],
    ["a numeric word", mutate((g) => { g.categories[0].words[0] = 42; }), /must be text/],
    ["a null word", mutate((g) => { g.categories[0].words[0] = null; }), /must be text/],
    ["an empty word", mutate((g) => { g.categories[0].words[0] = "   "; }), /is empty/],
    ["words as an object", mutate((g) => { g.categories[0].words = { 0: "a" }; }), /must be a list/],
    ["a boolean title", mutate((g) => { g.title = true; }), /must be text/],
    ["a numeric hint", mutate((g) => { g.categories[0].hint = 5; }), /must be text/],
    ["a fractional clock", mutate((g) => { g.settings.categorySeconds = 30.5; }), /whole number of seconds/],
    ["a clock of 301 seconds", mutate((g) => { g.settings.circleSeconds = 301; }), /between 5 and 300/],
    ["a four-second clock", mutate((g) => { g.settings.tiebreakSeconds = 4; }), /between 5 and 300/],
    ["a fractional box value", mutate((g) => { g.settings.circleValues[0] = 200.5; }), /whole number above zero/],
    ["a zero box value", mutate((g) => { g.settings.circleValues[3] = 0; }), /above zero/],
    ["three box values", mutate((g) => { g.settings.circleValues = [1, 2, 3]; }), /exactly 6 numbers/],
    ["13 words per category", mutate((g) => { g.settings.wordsPerCategory = 13; }), /between 3 and 12/],
    ["7 categories per team", mutate((g) => { g.settings.categoriesPerTeam = 7; }), /between 1 and 6/],
    ["a string grand prize", mutate((g) => { g.settings.grandPrize = "lots"; }), /grandPrize/],
    ["a string swapRoles", mutate((g) => { g.settings.swapRoles = "yes"; }), /true or false/],
    ["a 25-character prize label", mutate((g) => { g.settings.grandPrizeLabel = "x".repeat(25); }), /at most 24/],
    ["a four-character currency", mutate((g) => { g.settings.currency = "USD$"; }), /at most 3/],
    ["a duplicate category title", mutate((g) => { g.categories[7].title = g.categories[2].title; }), /used twice/],
    ["an 81-character game title", mutate((g) => { g.title = "t".repeat(81); }), /at most 80/],
    ["a 41-character category title", mutate((g) => { g.categories[0].title = "t".repeat(41); }), /at most 40/],
    ["a 61-character hint", mutate((g) => { g.categories[0].hint = "h".repeat(61); }), /at most 60/],
    ["a 31-character word", mutate((g) => { g.categories[0].words[0] = "w".repeat(31); }), /at most 30/],
    ["6 categories per team with only 12", mutate((g) => {
      g.settings.categoriesPerTeam = 6; g.categories = g.categories.slice(0, 12);
    }), /at least 13 categories/],
  ];
  cases.forEach(([label, g, pattern]) => {
    assert.throws(() => Core.validateGame(g), pattern, `${label} was accepted (or gave the wrong message)`);
  });
  [null, undefined, 0, "", [], "a string", true, 7].forEach((junk) => {
    assert.throws(() => Core.validateGame(junk), /not a Pyramid game|must be a list/, `${JSON.stringify(junk)} passed`);
  });
});

test("A8 every rejection is a sentence a host can act on", () => {
  const g = game();
  g.categories[0].words = ["a", "b"];
  try {
    Core.validateGame(g);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err.message.length > 20 && /\./.test(err.message), `unhelpful message: ${err.message}`);
    assert.equal(/undefined|NaN|\[object/.test(err.message), false, `leaky message: ${err.message}`);
  }
});

test("A8 the validator accepts every legal shape it should", () => {
  assert.equal(Core.validateGame(game({ wordsPerCategory: 3 })), true);
  assert.equal(Core.validateGame(game({ wordsPerCategory: 12, categories: 13 })), true);
  assert.equal(Core.validateGame(game({ categoriesPerTeam: 1, categories: 12 })), true);
  const noSettings = game();
  delete noSettings.settings;
  noSettings.categories.forEach((c) => { c.words = words(`${c.title}_`, 7); });
  assert.equal(Core.validateGame(noSettings), true, "a file with no settings must play on the defaults");
  const noHints = game();
  noHints.categories.forEach((c) => { delete c.hint; });
  assert.equal(Core.validateGame(noHints), true, "the hint is optional");
  assert.ok(Content.warningsFor(noHints).some((w) => /no hint/.test(w)));
  const noTitle = game();
  delete noTitle.title;
  assert.equal(Core.normalizeGame(noTitle).title, "Pyramid");
});

test("A8 a prototype-polluting file cannot poison the normalised game", () => {
  const raw = JSON.parse(JSON.stringify(game()));
  const poisoned = JSON.parse(`{"__proto__":{"pwned":1},"title":"x","settings":${JSON.stringify(raw.settings)},`
    + `"categories":${JSON.stringify(raw.categories)},"circles":${JSON.stringify(raw.circles)}}`);
  const norm = Core.normalizeGame(poisoned);
  assert.equal({}.pwned, undefined);
  assert.equal(norm.pwned, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(norm, "__proto__"), false);
});

test("A8 control characters and runaway whitespace are scrubbed, not passed through", () => {
  const ESC = String.fromCharCode(27);
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const NBSP_CTRL = String.fromCharCode(0x9b);   // a C1 control, easy to smuggle in
  const g = game();
  g.categories[0].words[0] = `bad${NUL}word${ESC}[31m`;
  g.categories[0].title = `Ti${BEL}tle`;
  g.circles[0].boxes[0].category = `sub${NBSP_CTRL}ject`;
  const norm = Core.normalizeGame(g);
  const text = JSON.stringify(norm);
  assert.equal(new RegExp("[\u0000-\u001F\u007F-\u009F]").test(text), false,
    "a control character survived normalisation");
  assert.equal(norm.categories[0].words[0], "bad word [31m");
  assert.equal(norm.categories[0].title, "Ti tle");
  assert.equal(norm.circles[0].boxes[0].category, "sub ject");
});

/* ============================================================
   A9 — immutability against a DEEP-FROZEN state
   ============================================================ */

const EVERY_EVENT = [
  { type: "start" }, { type: "pickCategory", index: 0 }, { type: "pickCategory", index: 3 },
  { type: "clockStart" }, { type: "clockPause" }, { type: "clockExpired" },
  { type: "mark", result: "correct" }, { type: "mark", result: "pass" }, { type: "mark", result: "illegal" },
  { type: "nextTurn" }, { type: "tiebreak" }, { type: "toCircle" }, { type: "toCircle", team: 1 },
  { type: "circleStart" }, { type: "circlePause" }, { type: "circleExpired" },
  { type: "circleMark", result: "correct" }, { type: "circleMark", result: "pass" },
  { type: "circleMark", result: "illegal" }, { type: "undo" }, { type: "finish" },
];

test("A9 every event applied to a deep-frozen state in every phase, in strict mode", () => {
  const seeds = [
    ["board", boot()],
    ["play", runCategory(boot(), 0, ["correct"], 1000)],
    ["expired", Core.reduce(runCategory(boot(), 0, ["correct"], 1000), { type: "clockExpired" }, 40000)],
    ["round over", runCategory(boot({ wordsPerCategory: 3 }), 0, ["correct", "correct", "correct"], 1000)],
    ["mainResult", playWholeBoard(boot({ wordsPerCategory: 3, categoriesPerTeam: 1 }), ["correct", "correct", "correct"])],
    ["level mainResult", levelBoard(4)],
    ["tiebreak", Core.reduce(levelBoard(4), { type: "tiebreak" }, 100000)],
    ["circle", openCircle(0)],
    ["standings", Core.reduce(openCircle(0), { type: "finish" }, 999999)],
  ];
  seeds.forEach(([label, seed]) => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(seed)));
    const before = JSON.stringify(frozen);
    EVERY_EVENT.forEach((event) => {
      assert.doesNotThrow(() => Core.reduce(frozen, event, 1234567),
        `${label}: ${event.type} threw against a frozen state`);
      assert.equal(JSON.stringify(frozen), before, `${label}: ${event.type} MUTATED the state it was given`);
    });
    [Core.scores, Core.leader, Core.currentWord, Core.remainingWords, Core.wordCount,
      Core.circleWinnings, Core.standings].forEach((fn) => {
      assert.doesNotThrow(() => fn(frozen), `${label}: a selector threw on frozen state`);
    });
    PIDS.forEach((pid) => assert.doesNotThrow(() => Core.phoneView(frozen, pid)));
    assert.equal(JSON.stringify(frozen), before, `${label}: a selector mutated the state`);
  });
});

test("A9 a long frozen game replayed end to end never mutates and never throws", () => {
  let s = deepFreeze(boot({ wordsPerCategory: 4 }));
  const script = [];
  for (let i = 0; i < 6; i += 1) {
    script.push({ type: "pickCategory", index: i }, { type: "clockStart" },
      { type: "mark", result: "correct" }, { type: "mark", result: "pass" },
      { type: "mark", result: "illegal" }, { type: "clockExpired" },
      { type: "mark", result: "correct" }, { type: "nextTurn" });
  }
  // Both teams score alike, so the board is level and the host names the team.
  script.push({ type: "toCircle", team: 0 }, { type: "circleStart" });
  for (let i = 0; i < 6; i += 1) script.push({ type: "circleMark", result: "correct" });
  script.push({ type: "nextTurn" }, { type: "nextTurn" });
  script.forEach((event, i) => {
    const before = JSON.stringify(s);
    const next = deepFreeze(Core.reduce(s, event, 1000 + i * 1000));
    assert.equal(JSON.stringify(s), before, `${event.type} mutated the previous state`);
    s = next;
  });
  assert.equal(s.phase, "standings");
  assert.equal(s.outcome.cleared, true);
  assert.equal(s.outcome.winnings, 10000);
});

test("A9 unknown, inherited and malformed event types return the SAME object", () => {
  const s = boot();
  [
    { type: "__proto__" }, { type: "constructor" }, { type: "toString" }, { type: "hasOwnProperty" },
    { type: "valueOf" }, { type: "nope" }, { type: "" }, { type: 7 }, { type: null },
    {}, null, undefined, [], "start", 42, true,
    { type: "pickCategory", index: -1 }, { type: "pickCategory", index: 99 },
    { type: "pickCategory", index: "0" }, { type: "pickCategory", index: 1.5 },
    { type: "pickCategory", index: NaN }, { type: "pickCategory" },
    { type: "mark", result: "Correct" }, { type: "mark", result: 1 }, { type: "mark" },
    { type: "circleMark", result: "won" },
  ].forEach((event) => {
    assert.equal(Core.reduce(s, event, 1000), s, `${JSON.stringify(event)} changed the state`);
  });
  assert.equal(Core.reduce(s, { type: "nope" }, 1000).history.length, s.history.length,
    "a refused event must not grow the history");
  assert.equal(Core.reduce(null, { type: "start" }, 0), null, "a missing state is survived");
});

test("A9 a non-finite `now` never reaches a deadline", () => {
  const s = Core.reduce(boot(), { type: "pickCategory", index: 0 }, 1000);
  [NaN, Infinity, -Infinity, "soon", null, undefined].forEach((now) => {
    const started = Core.reduce(s, { type: "clockStart" }, now);
    assert.equal(Number.isFinite(started.round.clock.deadline), true,
      `now=${String(now)} produced deadline ${started.round.clock.deadline}`);
  });
  assert.equal(Core.reduce(s, { type: "clockStart", now: 5000 }, 1000).round.clock.deadline, 35000,
    "event.now wins over the injected now");
});

/* ============================================================
   A10 — undo, everywhere
   ============================================================ */

test("A10 undo walks back across marks, phases and the Winner's Circle", () => {
  let s = boot({ wordsPerCategory: 3, categoriesPerTeam: 1 });
  const atBoard = s;
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  assert.equal(s.phase, "play");
  s = Core.reduce(s, { type: "undo" }, 1100);
  assert.equal(s.phase, "board", "undo steps back out of a category");
  assert.deepEqual(s.board.map((b) => b.team), atBoard.board.map((b) => b.team));

  s = runCategory(s, 0, ["correct", "correct"], 2000);
  assert.equal(Core.scores(s)[0], 2);
  s = Core.reduce(s, { type: "undo" }, 2100);
  assert.equal(Core.scores(s)[0], 1, "undo takes the point back off the board too");
  assert.equal(s.round.words.filter((w) => w.status === "correct").length, 1);
  s = Core.reduce(s, { type: "mark", result: "illegal" }, 2200);
  s = Core.reduce(s, { type: "mark", result: "illegal" }, 2300);
  assert.equal(s.round.finished, true);
  s = Core.reduce(s, { type: "nextTurn" }, 2400);
  assert.equal(s.phase, "board");
  s = Core.reduce(s, { type: "undo" }, 2500);
  assert.equal(s.phase, "play", "undo steps back into the finished round");
  assert.equal(s.round.finished, true);

  s = Core.reduce(s, { type: "nextTurn" }, 2600);
  s = runCategory(s, 1, ["correct"], 3000);
  s = Core.reduce(s, { type: "clockExpired" }, 40000);
  s = Core.reduce(s, { type: "mark", result: "pass" }, 40100);
  s = Core.reduce(s, { type: "nextTurn" }, 40200);
  assert.equal(s.phase, "mainResult");
  const beforeCircle = s;
  s = toCircle(s, 0);
  assert.equal(s.phase, "circle");
  s = Core.reduce(s, { type: "undo" }, 900500);
  assert.equal(s.phase, "mainResult", "undo comes back out of the Winner's Circle");
  assert.equal(s.circle, beforeCircle.circle);

  s = Core.reduce(toCircle(s, 0), { type: "circleStart" }, 901000);
  s = Core.reduce(s, { type: "circleMark", result: "correct" }, 901100);
  s = Core.reduce(s, { type: "circleMark", result: "illegal" }, 901200);
  assert.equal(Core.circleWinnings(s), 200);
  s = Core.reduce(s, { type: "undo" }, 901300);
  assert.equal(s.circle.boxes[1].status, "pending", "undo un-blocks a box");
  assert.equal(s.circle.cursor, 1);
  s = Core.reduce(s, { type: "undo" }, 901400);
  assert.equal(Core.circleWinnings(s), 0, "and un-banks the money");
});

test("A10 undo unwinds the tiebreak too", () => {
  let s = Core.reduce(levelBoard(4), { type: "tiebreak" }, 100000);
  s = Core.reduce(s, { type: "clockStart" }, 100000);
  s = Core.reduce(s, { type: "mark", result: "correct" }, 100001);
  assert.deepEqual(s.round.tbScores, [1, 0]);
  s = Core.reduce(s, { type: "undo" }, 100002);
  assert.deepEqual(s.round.tbScores, [0, 0]);
  assert.equal(s.round.team, 0);
  s = Core.reduce(s, { type: "undo" }, 100003);
  assert.equal(s.phase, "mainResult", "and back out of the tiebreak entirely");
  assert.equal(s.round, null);
});

test("A10 undo past the end of the history is a no-op and lands back on Setup", () => {
  const fresh = Core.createState(game(), TEAMS, { rng: rngOf(11) });
  assert.equal(fresh.history.length, 0);
  assert.equal(Core.reduce(fresh, { type: "undo" }, 100), fresh, "undo on a fresh state does nothing");
  let walked = runCategory(boot(), 0, ["correct", "pass"], 1000);
  for (let i = 0; i < 20; i += 1) walked = Core.reduce(walked, { type: "undo" }, 2000 + i);
  assert.equal(walked.history.length, 0);
  // `start` is itself an undoable decision, so the last undo unwinds it.
  assert.equal(walked.phase, "setup");
  assert.equal(Core.reduce(walked, { type: "undo" }, 3000), walked);
  assert.equal(Core.reduce(walked, { type: "start" }, 3100).phase, "board", "and Start picks it up again");
});

test("A10 the history is capped and never contains its own history", () => {
  let s = boot({ wordsPerCategory: 12, categoriesPerTeam: 3 });
  s = Core.reduce(s, { type: "pickCategory", index: 0 }, 1000);
  s = Core.reduce(s, { type: "clockStart" }, 1000);
  for (let i = 0; i < 60; i += 1) s = Core.reduce(s, { type: "mark", result: "pass" }, 2000 + i);
  assert.equal(s.history.length, Core.MAX_HISTORY);
  s.history.forEach((entry) => assert.deepEqual(entry.history, []));
  assert.ok(JSON.stringify(s).length < 3000000, "the history must not blow up the saved state");
});

test("A10 finish from any phase keeps the money and cannot be repeated", () => {
  let c = openCircle(0);
  c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900200);
  c = Core.reduce(c, { type: "circleMark", result: "correct" }, 900300);
  const done = Core.reduce(c, { type: "finish" }, 900400);
  assert.equal(done.phase, "standings");
  assert.equal(done.outcome.winnings, 500);
  assert.equal(Core.reduce(done, { type: "finish" }, 900500), done);
  assert.equal(Core.standings(done)[0].winnings, 500);
  const early = Core.reduce(boot(), { type: "finish" }, 100);
  assert.equal(early.phase, "standings");
  assert.equal(early.outcome, null);
  assert.deepEqual(Core.standings(early).map((r) => r.winnings), [0, 0]);
});

/* ============================================================
   A11 — setup, the nightly draw and the shipped content
   ============================================================ */

test("A11 createState refuses a roster that is not two teams of two", () => {
  const g = game();
  [
    [[], /exactly two teams/],
    [[TEAMS[0]], /exactly two teams/],
    [[TEAMS[0], TEAMS[1], TEAMS[0]], /exactly two teams/],
    [[{ name: "A", members: [{ pid: "p1", name: "Ada" }] }, TEAMS[1]], /needs two players/],
    [[{ name: "A", members: [{ pid: "p1", name: "Ada" }, { pid: "p1", name: "Ada" }] }, TEAMS[1]],
      /cannot play on both teams/],
    [[{ name: "A", members: [{ pid: "p1", name: "" }, { pid: "p2", name: "Ben" }] }, TEAMS[1]],
      /both players need a name/],
    [[TEAMS[0], { name: "B", members: [{ pid: "p1", name: "Ada" }, { pid: "p4", name: "Dev" }] }],
      /cannot play on both teams/],
    [[TEAMS[0], { name: "B", members: [null, { pid: "p4", name: "Dev" }] }], /missing a player/],
    [null, /exactly two teams/],
  ].forEach(([teams, pattern]) => {
    assert.throws(() => Core.createState(g, teams, { rng: rngOf(2) }), pattern);
  });
});

test("A11 the nightly draw avoids categories already used and always finds a tiebreak", () => {
  const g = Core.normalizeGame(FILE);
  const first = Content.drawNight(g, 6, [], rngOf(5));
  assert.equal(first.board.length, 6);
  assert.ok(first.tiebreak);
  assert.equal(new Set(first.board.map((c) => c.id)).size, 6, "no category appears twice on one board");
  assert.equal(first.board.some((c) => c.id === first.tiebreak.id), false);
  const used = first.board.map((c) => c.id).concat([first.tiebreak.id, first.circle.id]);
  const second = Content.drawNight(g, 6, used, rngOf(9));
  assert.equal(second.board.some((c) => used.includes(c.id)), false, "the second game must not repeat a category");
  assert.notEqual(second.circle.id, first.circle.id);
  const all = g.categories.map((c) => c.id).concat(g.circles.map((c) => c.id));
  const third = Content.drawNight(g, 6, all, rngOf(13));
  assert.equal(third.board.length, 6, "an exhausted pool wraps rather than stalling");
  assert.ok(third.circle);
});

test("A11 the shipped 24 categories run three whole games with no repeat, then wrap cleanly", () => {
  const g = Core.normalizeGame(FILE);
  let used = [];
  const seen = new Set();
  // Each game burns 7 categories (six on the board plus a tiebreak), so 24
  // covers three games; a fourth reuses some — a documented known limit.
  for (let night = 0; night < 3; night += 1) {
    const draw = Content.drawNight(g, 6, used, rngOf(night + 1));
    draw.board.concat([draw.tiebreak]).forEach((c) => {
      assert.equal(seen.has(c.id), false, `game ${night + 1} repeated ${c.title}`);
      seen.add(c.id);
    });
    used = used.concat(draw.board.map((c) => c.id), [draw.tiebreak.id]);
  }
  assert.equal(seen.size, 21);
  const fourth = Content.drawNight(g, 6, used, rngOf(9));
  assert.equal(fourth.board.length, 6, "a fourth game still deals a full board rather than stalling");
  assert.ok(fourth.tiebreak);
});

test("A11 categories.json and js/data.js carry identical content", () => {
  const json = readFileSync(new URL("../categories.json", import.meta.url), "utf8");
  const mirror = readFileSync(new URL("../js/data.js", import.meta.url), "utf8");
  assert.deepEqual(DATA, FILE);
  const embedded = JSON.parse(mirror.slice(mirror.indexOf("{"), mirror.lastIndexOf("}") + 1));
  assert.deepEqual(embedded, JSON.parse(json), "js/data.js must mirror categories.json exactly");
});

test("A11 every shipped category is clean, unique and does not print its own theme", () => {
  FILE.categories.forEach((cat) => {
    assert.notEqual(cat.title.toLowerCase(), (cat.hint || "").toLowerCase(),
      `"${cat.title}" is just its own hint — the board would give the theme away`);
    cat.words.forEach((w) => {
      assert.equal(w.trim(), w, `"${w}" has stray whitespace`);
      assert.equal(new RegExp("[\u0000-\u001F\u007F-\u009F]").test(w), false, `"${w}" holds a control character`);
      assert.equal(w.length <= 30 && w.length > 0, true);
    });
  });
  const titles = FILE.categories.map((c) => c.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, "two categories share a title");
  const subjects = FILE.circles.flatMap((s) => s.boxes.map((b) => b.category.toLowerCase()));
  assert.equal(new Set(subjects).size, subjects.length, "a Winner's Circle subject is repeated across the sets");
  assert.equal(Core.validateGame(FILE), true);
});

test("A11 the board a full game deals is always big enough for the rules chosen", () => {
  const s = Core.reduce(Core.createState(FILE, TEAMS, { rng: rngOf(7) }), { type: "start" }, 0);
  assert.equal(s.board.length, 6, "the shipped file plays 3 categories a team");
  assert.ok(s.tiebreakCat);
  assert.ok(s.circleSet);
  assert.equal(s.circleSet.boxes.length, 6);
  assert.deepEqual(s.circleSet.boxes.map((b) => b.value), [200, 300, 400, 500, 800, 1000]);
  const small = Core.reduce(Core.createState(game({ categoriesPerTeam: 2, wordsPerCategory: 3 }), TEAMS,
    { rng: rngOf(6) }), { type: "start" }, 0);
  assert.equal(small.board.length, 4);
});
