/* ============================================================
   Password — validator and phone-wire fuzzing (independent tester)
   The second half of the adversarial suite (split only to keep
   every file under the 800-line house cap): what a hostile or
   simply broken JSON file may contain, and what a hostile phone
   may put on the wire. Nothing here may throw out of the game and
   nothing here may let a phone judge anything.
   Run with:  cd games/password && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Core, words, game, TEAMS, boot, clueAnd, scoreTo, PIDS,
} from "./pwd-fixtures.mjs";

/* ============================================================
   F1 — the validator
   ============================================================ */

test("F1 the size floor is exact: 59 is refused, 60 is played", () => {
  assert.throws(() => Core.validateGame(game({ count: 59 })), /at least 60 passwords; this file has 59/);
  assert.equal(Core.validateGame(game({ count: 60 })), true);
});

test("F1 a password may not carry a space, in any disguise", () => {
  const TAB = String.fromCharCode(9);
  const NBSP = String.fromCharCode(160);
  [`Ice Cream`, `Ice${TAB}Cream`, ` Two Words `, `Ice  Cream`, `Ice${NBSP}Cream`].forEach((w) => {
    const g = game();
    g.words[4] = w;
    assert.throws(() => Core.validateGame(g), /has a space in it|letters, apostrophes/,
      `“${w}” must be refused`);
  });
});

test("F1 duplicates are caught however they are cased or punctuated", () => {
  const pairs = [["Umbrella", "UMBRELLA"], ["Umbrella", "umbrella"], ["Umbrella", "uMbReLLa"],
    ["O'Clock", "o'clock"], ["O’Clock", "O'Clock"]];
  pairs.forEach(([a, b]) => {
    const g = game();
    g.words[0] = a;
    g.words[9] = b;
    assert.throws(() => Core.validateGame(g), /is in the list twice/, `${a} vs ${b}`);
  });
  const near = game();
  near.words[0] = "Umbrella";
  near.words[9] = "Umbrellas";
  assert.equal(Core.validateGame(near), true, "a different word is not a duplicate");
});

test("F1 the length cap is exact: 20 plays, 21 is refused", () => {
  const twenty = game();
  twenty.words[2] = "A".repeat(19) + "b";
  assert.equal(twenty.words[2].length, 20);
  assert.equal(Core.validateGame(twenty), true);
  const twentyOne = game();
  twentyOne.words[2] = "A".repeat(20) + "b";
  assert.throws(() => Core.validateGame(twentyOne), /longer than 20 characters/);
});

test("F1 only letters, apostrophes and hyphens make a password", () => {
  const ok = ["Umbrella", "Well-known", "O'Clock", "O’Clock", "Café", "Naïve", "Icy"];
  ok.forEach((w) => {
    const g = game();
    g.words[3] = w;
    assert.equal(Core.validateGame(g), true, `“${w}” should be legal`);
  });
  const no = ["Level9", "9Lives", "!Bang", "half.step", "under_score", "-Leading", "'Quote",
    "e-mail@home", "\u{1F600}", "<b>hi</b>", "a+b", "3"];
  no.forEach((w) => {
    const g = game();
    g.words[3] = w;
    assert.throws(() => Core.validateGame(g), /letters, apostrophes and hyphens|is empty/,
      `“${w}” should be refused`);
  });
});

test("F1 junk types anywhere in the file produce a plain-English refusal", () => {
  const cases = [
    [undefined, /not a Password game/], [null, /not a Password game/], [7, /not a Password game/],
    ["a string", /not a Password game/], [[], /not a Password game/],
    [{ words: null }, /must be a list of passwords/],
    [{ words: {} }, /must be a list of passwords/],
    [{ title: 5, words: words(60) }, /“title” must be text/],
    [{ title: "x".repeat(81), words: words(60) }, /at most 80 characters/],
    [{ words: words(60), settings: [] }, /must be an object/],
    [{ words: words(60), settings: "x" }, /must be an object/],
  ];
  cases.forEach(([input, re]) => assert.throws(() => Core.validateGame(input), re, JSON.stringify(input)));
  [null, 7, {}, [], true, undefined].forEach((junk) => {
    const g = game();
    g.words[11] = junk;
    assert.throws(() => Core.validateGame(g), /must be text|is empty/, `word = ${String(junk)}`);
  });
  const blank = game();
  blank.words[0] = "   ";
  assert.throws(() => Core.validateGame(blank), /Password 1 is empty/);
});

test("F1 numeric settings refuse anything that is not a whole number in range", () => {
  const bad = (settings) => () => Core.validateGame(game({ settings }));
  [["targetScore", [4, 101, 25.5, "25", NaN, Infinity, -25, null, true]],
    ["lightningSeconds", [14, 181, 60.5, "60", NaN, Infinity]],
    ["lightningWords", [0, 11, 2.5, "5", -1]],
    ["lightningValue", [0, -100, 1.5, "100", 1000001]],
    ["startValue", [2, 21, 10.5, "10"]]].forEach(([key, values]) => {
    values.forEach((v) => assert.throws(bad({ [key]: v }), new RegExp(key), `${key} = ${String(v)}`));
  });
  ["allFiveBonus", "swapRoles"].forEach((key) => {
    ["yes", 1, 0, null].forEach((v) => assert.throws(bad({ [key]: v }), /must be true or false/));
  });
  assert.throws(bad({ currency: "dollars" }), /at most 3 characters/);
  assert.throws(bad({ currency: 5 }), /must be text/);
  assert.equal(Core.validateGame(game({ settings: { targetScore: 5, startValue: 3, lightningSeconds: 15,
    lightningWords: 1, lightningValue: 1 } })), true, "the floor of every range plays");
  assert.equal(Core.validateGame(game({ settings: { targetScore: 100, startValue: 20,
    lightningSeconds: 180, lightningWords: 10, lightningValue: 1000000 } })), true, "and the ceiling");
});

test("F1 a prototype-shaped settings object cannot smuggle a value through", () => {
  const g = game();
  g.settings = JSON.parse('{"__proto__": {"targetScore": 3}, "targetScore": 25}');
  assert.equal(Core.validateGame(g), true);
  const norm = Core.normalizeGame(g);
  assert.equal(norm.settings.targetScore, 25);
  assert.equal(({}).targetScore, undefined, "Object.prototype was not polluted");
  assert.equal(Object.prototype.hasOwnProperty.call(norm.settings, "__proto__"), false);
});

test("F1 normalizeGame is a pure function of its input", () => {
  const raw = game({ count: 60 });
  raw.title = "  Padded   Title  ";
  raw.words[0] = "  Umbrella  ";
  const before = JSON.stringify(raw);
  const a = Core.normalizeGame(raw);
  const b = Core.normalizeGame(raw);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(a.title, "Padded Title");
  assert.equal(a.words[0], "Umbrella");
  assert.notEqual(a.words, raw.words);
  assert.equal(Core.normalizeGame({ words: words(60) }).title, "Password", "a missing title gets one");
});

test("F1 warningsFor never throws, and caps its notes", () => {
  [null, undefined, 7, {}, [], { words: [] }, game({ count: 60 }),
    game({ count: 60, words: words(60).map((w) => `${w}aaaaaaaaaaa`) })].forEach((g) => {
    const notes = Core.warningsFor(g);
    assert.ok(Array.isArray(notes));
    assert.ok(notes.length <= 6);
    notes.forEach((n) => assert.equal(typeof n, "string"));
  });
  assert.ok(Core.warningsFor(game({ count: 60 })).some((n) => /Only 60 passwords/.test(n)));
});

test("F1 a 200-word file with one bad entry names the entry, not the file", () => {
  const g = game({ count: 200 });
  g.words[137] = "Two Words";
  assert.throws(() => Core.validateGame(g), /Password 138/);
});

/* ============================================================
   F2 — the phone wire
   ============================================================ */

test("F2 validatePhoneMsg accepts four intents and nothing else", () => {
  ["ready", "clue", "got", "pass"].forEach((t) => assert.deepEqual(Core.validatePhoneMsg({ t }), { t }));
  const NUL = String.fromCharCode(0);
  const junk = [null, undefined, 0, 1, "", "clue", [], [{ t: "clue" }], true,
    { t: 1 }, { t: null }, { t: ["clue"] }, { t: { t: "clue" } },
    { t: "clue " }, { t: " clue" }, { t: "CLUE" }, { t: "Clue" },
    { t: `clue${NUL}` }, { t: `${NUL}clue` }, { t: "clue\n" }, { t: "cl ue" },
    { t: "guess" }, { t: "illegal" }, { t: "undo" }, { t: "correct" }, { t: "wrong" },
    { t: "toLightning" }, { t: "skipWord" }, { t: "setFirst" }, { t: "nextGame" },
    { t: "__proto__" }, { t: "constructor" }, { t: "toString" },
    { t: "x".repeat(5000) }, { type: "clue" }, {}];
  junk.forEach((m) => assert.equal(Core.validatePhoneMsg(m), null, `accepted ${JSON.stringify(m)}`));
});

test("F2 a validated message is a narrow copy that carries nothing else", () => {
  const hostile = { t: "clue", team: 1, result: "correct", now: 9e9, word: "Wordaa" };
  const clean = Core.validatePhoneMsg(hostile);
  assert.deepEqual(Object.keys(clean), ["t"]);
  const nullProto = Object.assign(Object.create(null), { t: "got", extra: 1 });
  assert.deepEqual(Core.validatePhoneMsg(nullProto), { t: "got" });
  assert.equal(Core.validatePhoneMsg({ t: "clue" }).result, undefined);
});

test("F2 only the current giver may clue — every other seat, every phase", () => {
  const s = boot();
  const canClue = (state) => PIDS.filter((pid) => Core.phoneCanClue(state, pid));
  assert.deepEqual(canClue(s), ["p1"]);
  const clued = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.deepEqual(canClue(clued), [], "nobody may clue while a guess is pending");
  const passed = Core.reduce(clued, { type: "guess", result: "wrong" }, 0);
  assert.deepEqual(canClue(passed), ["p3"]);
  assert.deepEqual(canClue(clueAnd(s, "correct")), [], "a finished word takes no clue");
  const over = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.deepEqual(canClue(over), ["p4"], "after the swap, and the other team opens");
  assert.deepEqual(canClue(Core.createState(game(), TEAMS, {})), [], "not during setup");
});

test("F2 only the Lightning giver may mark, and only while the clock allows it", () => {
  const canMark = (state) => PIDS.filter((pid) => Core.phoneCanMark(state, pid));
  let s = scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10);
  assert.deepEqual(canMark(s), []);
  s = Core.reduce(s, { type: "toLightning" }, 0);
  assert.deepEqual(canMark(s), [], "not before the clock starts");
  s = Core.reduce(s, { type: "lightningStart" }, 1000);
  assert.deepEqual(canMark(s), ["p1"]);
  assert.deepEqual(canMark(Core.reduce(s, { type: "lightningPause" }, 2000)), []);
  const buzzed = Core.reduce(s, { type: "lightningExpired" }, 61001);
  assert.deepEqual(canMark(buzzed), ["p1"], "the word in flight is still judged");
  const closed = Core.reduce(buzzed, { type: "lightningMark", result: "pass" }, 61002);
  assert.deepEqual(canMark(closed), []);
});

test("F2 a receiver's clue, a spectator's mark and an out-of-turn giver change nothing", () => {
  const s = boot();
  // Exactly what pwd-room.js / pwd-app.js do: an intent only becomes an event
  // if the core agrees that this pid may act right now.
  const intent = (state, pid, t) => {
    if (t === "clue") {
      return Core.phoneCanClue(state, pid)
        ? Core.reduce(state, { type: "clueGiven", team: state.round.turn }, 0) : state;
    }
    return Core.phoneCanMark(state, pid)
      ? Core.reduce(state, { type: "lightningMark", result: t }, 0) : state;
  };
  ["p2", "p3", "p4", "px", "", "__proto__"].forEach((pid) => {
    assert.equal(intent(s, pid, "clue"), s, `${pid} must not be able to clue`);
    assert.equal(intent(s, pid, "got"), s, `${pid} must not be able to mark`);
    assert.equal(intent(s, pid, "pass"), s);
  });
  assert.notEqual(intent(s, "p1", "clue"), s, "the real giver still works");
});

test("F2 no phone message can express a judgement, in any phase", () => {
  // The whole point: Correct / Wrong / Illegal clue have no wire representation.
  ["correct", "wrong", "illegal", "guess", "judge", "score", "award",
    "lightningMark", "lightningExpired", "finish"].forEach((t) => {
    assert.equal(Core.validatePhoneMsg({ t }), null, `“${t}” must not reach the reducer`);
    assert.equal(Core.validatePhoneMsg({ t, result: "correct" }), null);
  });
});
