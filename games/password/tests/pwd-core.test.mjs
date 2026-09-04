/* ============================================================
   Password — unit suite (success states PW-U1 … PW-U10, spec 13 §6)
   Pure core only: no DOM, no network, no timers. The Lightning
   Round clock is driven by an injected `now` and every draw by an
   injected `rng`, so every run is deterministic.
   Run with:  cd games/password && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  Core, Content, rngOf, words, game, TEAMS, boot, clueAnd, wrongTimes, scoreTo, assertNoLeak,
} from "./pwd-fixtures.mjs";

const require = createRequire(import.meta.url);
const DATA = require("../js/data.js");
const FILE = JSON.parse(readFileSync(new URL("../words.json", import.meta.url), "utf8"));

/* ============================================================
   PW-U1 — the validator
   ============================================================ */

test("PW-U1 the shipped file and its offline mirror are playable and identical", () => {
  assert.equal(Core.validateGame(FILE), true);
  assert.equal(FILE.words.length, 200, "spec 13 §2 ships 200 passwords");
  assert.deepEqual(DATA, FILE, "js/data.js must mirror words.json exactly");
  assert.equal(globalThis.PWD_DEFAULT_GAME, DATA, "data.js must also reach globalThis");
  const folded = FILE.words.map((w) => w.toLowerCase());
  assert.equal(new Set(folded).size, FILE.words.length, "every password is unique");
  assert.ok(FILE.words.every((w) => Content.WORD_SHAPE.test(w) && w.length <= Content.WORD_MAX));
  assert.ok(FILE.words.some((w) => w.length <= 5) && FILE.words.some((w) => w.length >= 9),
    "the list mixes short and long");
});

test("PW-U1 a file without enough passwords is refused in plain English", () => {
  assert.throws(() => Core.validateGame(game({ count: 59 })), /at least 60 passwords; this file has 59/);
  assert.throws(() => Core.validateGame({ words: "nope" }), /must be a list of passwords/);
  assert.throws(() => Core.validateGame(null), /not a Password game/);
});

test("PW-U1 a password must be one word of letters, apostrophes and hyphens", () => {
  const withSpace = game();
  withSpace.words[3] = "Ice Cream";
  assert.throws(() => Core.validateGame(withSpace), /has a space in it/);

  const withDigit = game();
  withDigit.words[7] = "Level9";
  assert.throws(() => Core.validateGame(withDigit), /letters, apostrophes and hyphens/);

  const empty = game();
  empty.words[0] = "   ";
  assert.throws(() => Core.validateGame(empty), /Password 1 is empty/);

  const tooLong = game();
  tooLong.words[1] = "Antidisestablishmentarianism";
  assert.throws(() => Core.validateGame(tooLong), /longer than 20 characters/);

  const ok = game();
  ok.words[0] = "Well-known";
  ok.words[1] = "O'Clock";
  assert.equal(Core.validateGame(ok), true, "hyphens and apostrophes are legal");
});

test("PW-U1 duplicates are caught case-insensitively", () => {
  const dupe = game();
  dupe.words[5] = dupe.words[0].toUpperCase();
  assert.throws(() => Core.validateGame(dupe), /is in the list twice/);
});

test("PW-U1 settings are bounded and typed", () => {
  const bad = (settings) => () => Core.validateGame(game({ settings }));
  assert.throws(bad({ targetScore: 4 }), /targetScore/);
  assert.throws(bad({ targetScore: 101 }), /targetScore/);
  assert.throws(bad({ lightningSeconds: 14 }), /lightningSeconds/);
  assert.throws(bad({ lightningSeconds: 181 }), /lightningSeconds/);
  assert.throws(bad({ lightningWords: 0 }), /lightningWords/);
  assert.throws(bad({ lightningWords: 11 }), /lightningWords/);
  assert.throws(bad({ startValue: 2 }), /startValue/);
  assert.throws(bad({ allFiveBonus: "yes" }), /must be true or false/);
  assert.throws(bad({ swapRoles: 1 }), /must be true or false/);
  assert.throws(bad({ currency: "dollars" }), /at most 3 characters/);
  assert.throws(() => Core.validateGame({ words: words(60), settings: 7 }), /must be an object/);
  assert.equal(Core.validateGame(game({ settings: { targetScore: 5, lightningWords: 1 } })), true);
});

test("PW-U1 normalizeGame cleans text, fills the settings and never mutates", () => {
  const raw = { title: "  My   Night  ", words: words(60).concat(["  Spaced  "]) };
  const before = JSON.stringify(raw);
  const norm = Core.normalizeGame(raw);
  assert.equal(norm.title, "My Night");
  assert.equal(norm.words[60], "Spaced");
  assert.equal(norm.settings.targetScore, 25);
  assert.equal(norm.settings.startValue, 10);
  assert.equal(norm.settings.currency, "$");
  assert.equal(JSON.stringify(raw), before, "the caller's object is untouched");
});

test("PW-U1 the editor warns below 120 passwords without refusing them", () => {
  const small = game({ count: 60 });
  assert.equal(Core.validateGame(small), true);
  const notes = Core.warningsFor(small);
  assert.ok(notes.some((n) => /Only 60 passwords/.test(n)), notes.join(" | "));
  assert.equal(Core.warningsFor(FILE).length, 0, "the shipped 200 raise nothing");
  assert.deepEqual(Core.warningsFor({ words: [] }).length, 1, "a broken file reports its error");
});

/* ============================================================
   PW-U2 — the value ladder and the dead word
   ============================================================ */

test("PW-U2 the ladder runs 10, 9, 8 … 1 and a correct guess scores it", () => {
  let s = boot();
  assert.equal(Core.value(s), 10, "the first clue is worth 10 before it is even given");
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.value(s), 10);
  assert.equal(Core.clueCount(s), 1);
  s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.value(s), 9, "the second clue is worth 9");
  for (let i = 0; i < 5; i += 1) {
    s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
    s = Core.reduce(s, { type: "clueGiven" }, 0);
  }
  assert.equal(Core.clueCount(s), 7);
  assert.equal(Core.value(s), 4);
  assert.equal(Core.turn(s), 0, "an odd number of clues brings it back to Team A");
  const scored = Core.reduce(s, { type: "guess", result: "correct" }, 0);
  assert.deepEqual(Core.scores(scored), [4, 0], "the seventh clue pays 4 to the team that guessed");
  assert.equal(scored.round.finished, true);
  assert.equal(scored.round.won, 0);
});

test("PW-U2 ten clues with no correct guess kills the word", () => {
  let s = wrongTimes(boot(), 9);
  assert.equal(Core.clueCount(s), 9);
  assert.equal(s.round.finished, false);
  assert.equal(Core.value(s), 2);
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.value(s), 1, "the tenth clue is worth one point");
  s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
  assert.equal(s.round.dead, true);
  assert.equal(s.round.finished, true);
  assert.deepEqual(Core.scores(s), [0, 0]);
  assert.equal(Core.reduce(s, { type: "clueGiven" }, 0), s, "an eleventh clue is refused");
});

test("PW-U2 the ladder follows a changed startValue", () => {
  let s = boot({ settings: { startValue: 5 } });
  assert.equal(Core.value(s), 5);
  s = wrongTimes(s, 4);
  assert.equal(Core.value(s), 2);
  s = clueAnd(s, "wrong");
  assert.equal(s.round.dead, true, "five clues and the word is dead");
});

test("PW-U2 a guess needs a clue first, and only one guess per clue", () => {
  const s = boot();
  assert.equal(Core.reduce(s, { type: "guess", result: "correct" }, 0), s, "no clue, no guess");
  const clued = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.reduce(clued, { type: "clueGiven" }, 0), clued, "no second clue before the guess");
  const answered = Core.reduce(clued, { type: "guess", result: "wrong" }, 0);
  assert.equal(Core.reduce(answered, { type: "guess", result: "correct" }, 0), answered,
    "no second guess on the same clue");
  assert.equal(Core.reduce(clued, { type: "guess", result: "maybe" }, 0), clued, "junk results are ignored");
});

/* ============================================================
   PW-U3 — alternation and who gives the first clue
   ============================================================ */

test("PW-U3 clues alternate after every wrong guess", () => {
  let s = boot();
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    seen.push(Core.turn(s));
    s = clueAnd(s, "wrong");
  }
  assert.deepEqual(seen, [0, 1, 0, 1, 0, 1]);
});

test("PW-U3 the team that did not win the word opens the next one", () => {
  let s = boot();
  s = clueAnd(s, "wrong");           // A clued, B now on
  s = clueAnd(s, "correct");         // B take it
  assert.equal(s.round.won, 1);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(Core.turn(s), 0, "the losers of the last word open the next");
  s = clueAnd(s, "correct");         // A take it
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(Core.turn(s), 1);
});

test("PW-U3 a dead word simply alternates the opener", () => {
  let s = boot({ firstTeam: 1 });
  assert.equal(Core.turn(s), 1, "the host chose Team B to open the game");
  s = wrongTimes(s, 10);
  assert.equal(s.round.dead, true);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(Core.turn(s), 0, "nobody won it, so the other team opens");
});

test("PW-U3 the host can override who opens, but only before the first clue", () => {
  let s = boot();
  assert.equal(Core.turn(s), 0);
  s = Core.reduce(s, { type: "setFirst", team: 1 }, 0);
  assert.equal(Core.turn(s), 1);
  assert.equal(s.firstTeam, 1);
  const clued = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.reduce(clued, { type: "setFirst", team: 0 }, 0), clued,
    "once a clue is out the opener is settled");
  assert.equal(Core.reduce(s, { type: "setFirst", team: 5 }, 0), s, "a nonsense team is ignored");
});

test("PW-U3 a clue attributed to the wrong team is ignored", () => {
  const s = boot();
  assert.equal(Core.turn(s), 0);
  assert.equal(Core.reduce(s, { type: "clueGiven", team: 1 }, 0), s, "Team B cannot clue out of turn");
  const ok = Core.reduce(s, { type: "clueGiven", team: 0 }, 0);
  assert.equal(Core.clueCount(ok), 1);
});

test("PW-U3 skipWord throws the password out and scores nothing", () => {
  let s = clueAnd(boot(), "wrong");
  s = Core.reduce(s, { type: "skipWord" }, 0);
  assert.equal(s.round.finished, true);
  assert.equal(s.round.dead, true);
  assert.deepEqual(Core.scores(s), [0, 0]);
  const nextWord = Core.reduce(s, { type: "nextWord" }, 0);
  assert.notEqual(nextWord.round.word, s.round.word, "a fresh password is dealt");
});

/* ============================================================
   PW-U4 — the illegal clue
   ============================================================ */

test("PW-U4 an illegal clue passes control and drops the value", () => {
  let s = boot();
  assert.equal(Core.turn(s), 0);
  assert.equal(Core.value(s), 10);
  s = Core.reduce(s, { type: "illegal" }, 0);
  assert.equal(Core.turn(s), 1, "control passes to the other team");
  assert.equal(Core.clueCount(s), 1, "the value drops as if a clue had been given");
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.value(s), 9);
  const won = Core.reduce(s, { type: "guess", result: "correct" }, 0);
  assert.deepEqual(Core.scores(won), [0, 9]);
});

test("PW-U4 illegal works after Clue given too, and never double-counts", () => {
  let s = Core.reduce(boot(), { type: "clueGiven" }, 0);
  assert.equal(Core.clueCount(s), 1);
  s = Core.reduce(s, { type: "illegal" }, 0);
  assert.equal(Core.clueCount(s), 1, "the clue was already on the counter");
  assert.equal(Core.turn(s), 1);
  assert.equal(s.round.awaitingGuess, false, "the receiver gets no guess on an illegal clue");
});

test("PW-U4 an illegal tenth clue kills the word", () => {
  let s = wrongTimes(boot(), 9);
  assert.equal(Core.clueCount(s), 9);
  s = Core.reduce(s, { type: "illegal" }, 0);
  assert.equal(Core.clueCount(s), 10);
  assert.equal(s.round.dead, true);
  assert.equal(s.round.finished, true);
  assert.equal(Core.reduce(s, { type: "illegal" }, 0), s, "a finished word takes no more judgements");
});

/* ============================================================
   PW-U5 — reaching the target score
   ============================================================ */

test("PW-U5 the target ends the game the moment it is reached, mid-word", () => {
  let s = boot({ settings: { targetScore: 20 } });
  s = clueAnd(s, "correct");                       // A: 10
  s = Core.reduce(s, { type: "nextWord" }, 0);
  s = Core.reduce(s, { type: "setFirst", team: 0 }, 0);
  assert.equal(s.phase, "word");
  s = clueAnd(s, "correct");                       // A: 20
  assert.deepEqual(Core.scores(s), [20, 0]);
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winner, 0);
  assert.equal(Core.reduce(s, { type: "clueGiven" }, 0), s, "no more clues once the game is over");
  assert.equal(Core.reduce(s, { type: "nextWord" }, 0), s, "and no more words");
});

test("PW-U5 25 is the default target and overshooting still wins", () => {
  let s = scoreTo(boot(), 0, 20);
  assert.deepEqual(Core.scores(s), [20, 0]);
  assert.equal(s.phase, "word");
  s = Core.reduce(s, { type: "setFirst", team: 0 }, 0);
  s = clueAnd(s, "correct");
  assert.equal(Core.scores(s)[0], 30);
  assert.equal(s.phase, "gameOver", "30 clears 25");
  assert.equal(s.winner, 0);
});

/* ============================================================
   PW-U6 — role swapping
   ============================================================ */

test("PW-U6 giver and receiver swap between words when swapRoles is on", () => {
  let s = boot();
  assert.equal(Core.rolesFor(s, 0).giver.pid, "p1");
  assert.equal(Core.rolesFor(s, 0).receiver.pid, "p2");
  assert.deepEqual(Core.giverPids(s), ["p1", "p3"]);
  s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.equal(Core.rolesFor(s, 0).giver.pid, "p2", "the pair have swapped");
  assert.deepEqual(Core.giverPids(s), ["p2", "p4"]);
  s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.deepEqual(Core.giverPids(s), ["p1", "p3"], "and swapped back");
});

test("PW-U6 swapRoles off keeps the pair on the roles they started with", () => {
  let s = boot({ settings: { swapRoles: false } });
  assert.deepEqual(Core.giverPids(s), ["p1", "p3"]);
  for (let i = 0; i < 3; i += 1) s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.deepEqual(Core.giverPids(s), ["p1", "p3"], "nothing swapped");
});

test("PW-U6 a team may nominate its second seat as the first giver", () => {
  const teams = [
    { name: "Reds", members: TEAMS[0].members, firstGiver: 1 },
    { name: "Blues", members: TEAMS[1].members },
  ];
  const s = boot({ teams });
  assert.deepEqual(Core.giverPids(s), ["p2", "p3"]);
});

/* ============================================================
   PW-U7 — the Lightning Round
   ============================================================ */

function toLightning(opts) {
  let s = scoreTo(boot(opts), 0, 25);
  assert.equal(s.phase, "gameOver");
  s = Core.reduce(s, { type: "toLightning" }, 1000);
  return Core.reduce(s, { type: "lightningStart" }, 1000);
}

test("PW-U7 five words in sixty seconds, one hundred dollars each", () => {
  let s = toLightning();
  assert.equal(s.phase, "lightning");
  assert.equal(s.lightning.words.length, 5);
  assert.equal(s.lightning.team, 0);
  assert.equal(s.lightning.clock.deadline, 1000 + 60000);
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(Core.lightningTotal(s), 400);
  assert.equal(s.lightning.finished, false);
  s = Core.reduce(s, { type: "lightningExpired" }, 61001);
  assert.equal(s.lightning.expired, true);
  s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 61002);
  assert.equal(s.lightning.finished, true, "the word in flight is judged, then it closes");
  assert.equal(s.outcome.got, 4);
  assert.equal(s.outcome.allFive, false);
  assert.equal(s.outcome.money, 400);
});

test("PW-U7 all five doubles the money", () => {
  let s = toLightning();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(s.lightning.finished, true);
  assert.equal(s.outcome.allFive, true);
  assert.equal(s.outcome.doubled, true);
  assert.equal(s.outcome.money, 1000, "5 x $100, doubled");
  assert.equal(Core.lightningTotal(s), 1000);
});

test("PW-U7 the all-five bonus can be turned off", () => {
  let s = toLightning({ settings: { allFiveBonus: false } });
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(s.outcome.allFive, true);
  assert.equal(s.outcome.doubled, false);
  assert.equal(s.outcome.money, 500);
});

test("PW-U7 passed words come back round while time remains", () => {
  let s = toLightning();
  const list = s.lightning.words.map((w) => w.text);
  s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 2000);
  assert.equal(s.lightning.cursor, 1, "a pass moves straight on");
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(s.lightning.finished, false, "the passed word is still live");
  assert.equal(s.lightning.words[s.lightning.cursor].text, list[0], "it has come back round");
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(s.lightning.finished, true);
  assert.equal(s.outcome.money, 1000);
});

test("PW-U7 the clock is a deadline, pauses, and refuses marks before it starts", () => {
  let s = scoreTo(boot(), 0, 25);
  s = Core.reduce(s, { type: "toLightning" }, 1000);
  assert.equal(Core.reduce(s, { type: "lightningMark", result: "got" }, 1000), s,
    "no marks before the host starts the clock");
  s = Core.reduce(s, { type: "lightningStart" }, 1000);
  assert.equal(Core.secondsLeft(s.lightning.clock, 31000), 30);
  s = Core.reduce(s, { type: "lightningPause" }, 31000);
  assert.equal(s.lightning.clock.running, false);
  assert.equal(s.lightning.clock.remainingMs, 30000);
  s = Core.reduce(s, { type: "lightningStart" }, 50000);
  assert.equal(s.lightning.clock.deadline, 80000, "it resumes with the time that was left");
});

test("PW-U7 a shorter, cheaper Lightning Round is configurable", () => {
  let s = toLightning({ settings: { lightningSeconds: 30, lightningWords: 3, lightningValue: 250 } });
  assert.equal(s.lightning.words.length, 3);
  assert.equal(s.lightning.clock.deadline, 1000 + 30000);
  for (let i = 0; i < 3; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(s.outcome.money, 1500, "3 x $250, doubled");
});

test("PW-U7 the host may hand the Lightning clues to the other partner", () => {
  let s = scoreTo(boot(), 0, 25);
  const natural = Core.rolesFor(s, 0).giver.pid;
  s = Core.reduce(s, { type: "toLightning", team: 0, giver: 1 }, 1000);
  assert.equal(s.lightning.giverPid, "p2");
  assert.equal(s.lightning.receiverPid, "p1");
  assert.equal(natural, "p1", "the natural giver was the other one");
});

test("PW-U7 the money reaches the standings for both members of the team", () => {
  let s = toLightning();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(s.phase, "result");
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(s.phase, "standings");
  const rows = Core.standings(s);
  assert.equal(rows[0].winnings, 1000);
  assert.equal(rows[1].winnings, 0);
  assert.equal(rows[0].gamesWon, 1);
  assert.deepEqual(rows[0].members.map((m) => m.pid), ["p1", "p2"]);
  assert.equal(Core.formatMoney(s, 1000), "$1,000");
});

test("PW-U7 a second game keeps the money and resets the points", () => {
  let s = toLightning();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  s = Core.reduce(s, { type: "nextGame" }, 0);
  assert.equal(s.phase, "word");
  assert.equal(s.gameNo, 2);
  assert.deepEqual(Core.scores(s), [0, 0]);
  assert.equal(s.lightning, null);
  assert.equal(Core.standings(s)[0].winnings, 1000, "game one's money is still banked");
  const finished = Core.reduce(s, { type: "finish" }, 0);
  assert.equal(finished.phase, "standings");
  assert.equal(Core.standings(finished)[0].winnings, 1000, "banking twice does not double the money");
});

/* ============================================================
   PW-U8 — the word order: file order, shuffle and the wrap flag
   ============================================================ */

test("PW-U8 words are drawn in file order until the host shuffles", () => {
  const s = boot();
  assert.equal(s.shuffled, false);
  assert.deepEqual(s.order.slice(0, 3), words(80).slice(0, 3));
  assert.equal(s.round.word, s.order[0]);
  const next = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.equal(next.round.word, s.order[1]);
});

test("PW-U8 Shuffle deals the same list in a different, repeatable order", () => {
  const a = boot({ shuffle: true, rng: rngOf(7) });
  const b = boot({ shuffle: true, rng: rngOf(7) });
  const plain = boot();
  assert.equal(a.shuffled, true);
  assert.deepEqual(a.order, b.order, "the same seed deals the same night");
  assert.notDeepEqual(a.order, plain.order, "and it is not file order");
  assert.deepEqual(a.order.slice().sort(), plain.order.slice().sort(), "no word is lost or duplicated");
});

test("PW-U8 running past the end of the list wraps and raises the repeating flag", () => {
  // Words are thrown out rather than won, so 60 of them fit inside one game.
  const skip = (state) => Core.reduce(Core.reduce(state, { type: "skipWord" }, 0), { type: "nextWord" }, 0);
  let s = boot({ count: 60 });
  assert.equal(s.repeating, false);
  for (let i = 0; i < 59; i += 1) s = skip(s);
  assert.equal(s.cursor, 60);
  assert.equal(s.repeating, false, "the last word of the file is not a repeat");
  s = skip(s);
  assert.equal(s.repeating, true);
  assert.equal(s.round.word, s.order[0], "it comes round to the top of the list");
});

test("PW-U8 the Lightning Round takes the next words and can wrap too", () => {
  const small = { count: 60, settings: { targetScore: 5 } };
  let s = scoreTo(boot(small), 0, 5);
  const cursor = s.cursor;
  s = Core.reduce(s, { type: "toLightning" }, 0);
  assert.deepEqual(s.lightning.words.map((w) => w.text), s.order.slice(cursor, cursor + 5));
  assert.equal(s.cursor, cursor + 5);
});

/* ============================================================
   PW-U9 — undo, illegal events, immutability
   ============================================================ */

test("PW-U9 undo steps back through every decision", () => {
  const start = boot();
  let s = Core.reduce(start, { type: "clueGiven" }, 0);
  s = Core.reduce(s, { type: "guess", result: "correct" }, 0);
  assert.deepEqual(Core.scores(s), [10, 0]);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.deepEqual(Core.scores(s), [0, 0]);
  assert.equal(Core.clueCount(s), 1, "back to the clue that was given");
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(Core.clueCount(s), 0);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.phase, "setup", "and back past Start");
  assert.equal(Core.reduce(s, { type: "undo" }, 0).history.length, 0, "undo stops at the beginning");
});

test("PW-U9 undo reverses an illegal clue and a dead word", () => {
  let s = wrongTimes(boot(), 10);
  assert.equal(s.round.dead, true);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.round.dead, false);
  assert.equal(s.round.finished, false);
  assert.equal(Core.clueCount(s), 10, "the tenth clue is still on the counter");
});

test("PW-U9 the clock is not a decision, so undo skips it", () => {
  let s = scoreTo(boot(), 0, 25);
  s = Core.reduce(s, { type: "toLightning" }, 1000);
  const before = s.history.length;
  s = Core.reduce(s, { type: "lightningStart" }, 1000);
  s = Core.reduce(s, { type: "lightningPause" }, 2000);
  assert.equal(s.history.length, before, "clock events leave no undo step");
});

test("PW-U9 unknown, prototype-shaped and malformed events return the same object", () => {
  const s = boot();
  const junk = ["nonsense", "toString", "valueOf", "__proto__", "hasOwnProperty", "constructor",
    "__defineGetter__", "isPrototypeOf"];
  junk.forEach((type) => {
    assert.equal(Core.reduce(s, { type }, 0), s, `event type "${type}" changed state`);
  });
  assert.equal(Core.reduce(s, null, 0), s);
  assert.equal(Core.reduce(s, { type: 7 }, 0), s);
  assert.equal(Core.reduce(s, "clueGiven", 0), s);
  assert.equal(typeof s.phase, "string", "the probes did not corrupt the state");
});

test("PW-U9 the reducer never mutates the state it is given", () => {
  const s = boot();
  const before = JSON.stringify(s);
  const events = [{ type: "clueGiven" }, { type: "guess", result: "wrong" }, { type: "illegal" },
    { type: "setFirst", team: 1 }, { type: "skipWord" }, { type: "nextWord" }, { type: "finish" }];
  events.forEach((ev) => Core.reduce(s, ev, 0));
  assert.equal(JSON.stringify(s), before);
  const played = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.notEqual(played.round, s.round, "a new round object, not a patched one");
  assert.notEqual(played, s);
});

test("PW-U9 the history is capped so a long night cannot grow without bound", () => {
  let s = boot();
  for (let i = 0; i < 60; i += 1) s = Core.reduce(s, { type: "illegal" }, 0);
  assert.ok(s.history.length <= Core.MAX_HISTORY, `history grew to ${s.history.length}`);
  assert.equal(s.history[0].history.length, 0, "a snapshot never carries its own history");
});

test("PW-U9 createState refuses a bad line-up in plain English", () => {
  assert.throws(() => Core.createState(game(), [TEAMS[0]]), /exactly two teams/);
  assert.throws(() => Core.createState(game(), [{ name: "A", members: [{ pid: "p1", name: "Ada" }] }, TEAMS[1]]),
    /needs two players/);
  const clash = [TEAMS[0], { name: "Blues", members: [{ pid: "p1", name: "Ada" }, { pid: "p4", name: "Dev" }] }];
  assert.throws(() => Core.createState(game(), clash), /cannot play on both teams/);
  assert.throws(() => Core.createState(game(),
    [{ name: "A", members: [{ pid: "p1", name: "" }, { pid: "p2", name: "Ben" }] }, TEAMS[1]]),
  /both players need a name/);
});

/* ============================================================
   PW-U10 — the leak test: who may see a password
   ============================================================ */

test("PW-U10 both givers see the password; receivers and spectators never do", () => {
  const s = boot();
  const word = s.round.word;
  assert.deepEqual(Core.giverPids(s), ["p1", "p3"]);
  assert.equal(Core.phoneView(s, "p1").word, word, "the clueing team's giver");
  assert.equal(Core.phoneView(s, "p3").word, word, "and the other team's giver");
  assert.equal(Core.phoneView(s, "p2").screen, "receiver");
  assert.equal(Core.phoneView(s, "p2").word, undefined);
  assert.equal(Core.phoneView(s, "p4").word, undefined);
  assert.equal(Core.phoneView(s, "px").screen, "wait", "a spectator gets the waiting screen");
  assertNoLeak(s, ["p1", "p3"]);
});

test("PW-U10 the receiver's view carries the value and whose clue it is", () => {
  const s = Core.reduce(boot(), { type: "clueGiven" }, 0);
  const view = Core.phoneView(s, "p2");
  assert.equal(view.value, 10);
  assert.equal(view.turnTeam, 0);
  assert.equal(view.turnName, "Reds");
  assert.equal(view.yourTurn, true);
  assert.equal(Core.phoneView(s, "p4").yourTurn, false);
  assertNoLeak(s, ["p1", "p3"]);
});

test("PW-U10 the swap moves the password to the other phone on the next word", () => {
  let s = boot();
  assert.equal(Core.phoneView(s, "p1").word, s.round.word);
  assert.equal(Core.phoneView(s, "p2").word, undefined);
  s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.equal(Core.phoneView(s, "p2").word, s.round.word, "Ben gives now");
  assert.equal(Core.phoneView(s, "p1").word, undefined, "and Ada may not see it");
  assertNoLeak(s, ["p2", "p4"]);
});

test("PW-U10 a finished word tells everybody the same thing and no more", () => {
  const s = clueAnd(boot(), "correct");
  assert.equal(Core.phoneView(s, "p1").screen, "wait");
  assertNoLeak(s, []);
});

test("PW-U10 in the Lightning Round only the winning giver sees a word", () => {
  const s = toLightning();
  const giver = s.lightning.giverPid;
  assert.equal(Core.phoneView(s, giver).screen, "lightning-giver");
  assert.equal(Core.phoneView(s, giver).word, s.lightning.words[0].text);
  assert.equal(Core.phoneView(s, s.lightning.receiverPid).screen, "lightning-receiver");
  assert.equal(Core.phoneView(s, s.lightning.receiverPid).word, undefined);
  assert.equal(Core.phoneView(s, "p3").screen, "wait");
  assertNoLeak(s, [giver]);
  const marked = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assertNoLeak(marked, [giver]);
});

test("PW-U10 every phone gets the host's deadline, never a timer of its own", () => {
  const s = toLightning();
  [s.lightning.giverPid, s.lightning.receiverPid, "p3"].forEach((pid) => {
    assert.equal(Core.phoneView(s, pid).clock.deadline, 61000);
  });
});

test("PW-U10 a phone may only express an intent, never a judgement", () => {
  assert.deepEqual(Core.validatePhoneMsg({ t: "clue" }), { t: "clue" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "got" }), { t: "got" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "pass" }), { t: "pass" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "ready" }), { t: "ready" });
  ["guess", "illegal", "correct", "wrong", "undo", ""].forEach((t) => {
    assert.equal(Core.validatePhoneMsg({ t }), null, `"${t}" must not be a phone message`);
  });
  assert.equal(Core.validatePhoneMsg(null), null);
  assert.equal(Core.validatePhoneMsg("clue"), null);
  assert.equal(Core.validatePhoneMsg({ t: "clue", extra: "x" }).extra, undefined, "a narrow copy only");
});

test("PW-U10 only the current giver may tap Clue given", () => {
  const s = boot();
  assert.equal(Core.phoneCanClue(s, "p1"), true);
  assert.equal(Core.phoneCanClue(s, "p3"), false, "the other team's giver waits their turn");
  assert.equal(Core.phoneCanClue(s, "p2"), false);
  const clued = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.phoneCanClue(clued, "p1"), false, "one clue, then the host judges");
  const after = Core.reduce(clued, { type: "guess", result: "wrong" }, 0);
  assert.equal(Core.phoneCanClue(after, "p3"), true, "now the other giver");
});

test("PW-U10 a paused Lightning clock silences the giver's phone", () => {
  let s = toLightning();
  const giver = s.lightning.giverPid;
  assert.equal(Core.phoneCanMark(s, giver), true);
  assert.equal(Core.phoneCanMark(s, s.lightning.receiverPid), false);
  s = Core.reduce(s, { type: "lightningPause" }, 2000);
  assert.equal(Core.phoneCanMark(s, giver), false);
  assert.equal(Core.phoneView(s, giver).canMark, false);
  s = Core.reduce(s, { type: "lightningStart" }, 3000);
  assert.equal(Core.phoneCanMark(s, giver), true);
  s = Core.reduce(s, { type: "lightningExpired" }, 999999);
  assert.equal(Core.phoneCanMark(s, giver), true, "the word in flight is still judged");
});
