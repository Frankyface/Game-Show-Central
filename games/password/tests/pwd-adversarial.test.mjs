/* ============================================================
   Password — adversarial suite (independent tester)
   Written against docs/13-password-spec.md, NOT against the
   implementation. This half attacks the RULES: exhaustive leak
   crawls over pid x phase x event sequence, the ladder, the
   illegal clue, the target, the swap, the Lightning Round, the
   word order, frozen-state immutability, undo across every phase
   boundary and prototype-shaped events. Validator and phone-wire
   fuzzing live in tests/pwd-fuzz.test.mjs (house 800-line cap).
   Run with:  cd games/password && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Core, Content, rngOf, words, game, TEAMS, boot, clueAnd, wrongTimes, scoreTo,
  PIDS, EVENTS, auditViews, lightningAt, deepFreeze,
} from "./pwd-fixtures.mjs";

/* ============================================================
   A1 — the leak crawl: every pid, every phase, every sequence
   ============================================================ */

test("A1 no password reaches an unentitled phone on any random walk of the event space", () => {
  const rng = rngOf(20260904);
  let seen = 0;
  const phases = new Set();
  for (let walk = 0; walk < 250; walk += 1) {
    let s = Core.createState(game({ count: 60, settings: { targetScore: 5 } }), TEAMS,
      { shuffle: walk % 2 === 0, rng: rngOf(walk + 1) });
    auditViews(s, `walk ${walk} step -1`);
    let clock = 1000;
    for (let step = 0; step < 40; step += 1) {
      const ev = EVENTS[Math.floor(rng() * EVENTS.length)];
      clock += 3000;
      s = Core.reduce(s, ev, clock);
      phases.add(s.phase);
      auditViews(s, `walk ${walk} step ${step} after ${ev.type}`);
      seen += 1;
    }
  }
  assert.ok(seen >= 10000, `only ${seen} states audited`);
  ["setup", "word", "gameOver", "lightning", "standings"].forEach((p) => {
    assert.ok(phases.has(p), `the crawl never reached phase "${p}"`);
  });
  // `result` needs a completed Lightning Round, which a random walk rarely
  // finishes, so it is driven there and audited on its own.
  let r = lightningAt();
  for (let i = 0; i < 5; i += 1) r = Core.reduce(r, { type: "lightningMark", result: "got" }, 2000);
  r = Core.reduce(r, { type: "nextWord" }, 0);
  assert.equal(r.phase, "result");
  auditViews(r, "result");
  auditViews(Core.reduce(r, { type: "nextWord" }, 0), "standings");
});

test("A1 an exhaustive 4-deep crawl from the first word leaks nothing", () => {
  const root = boot({ count: 60, settings: { targetScore: 5, lightningWords: 2 } });
  const short = EVENTS.filter((e) => e.type !== "start");
  let audited = 0;
  const walk = (state, depth) => {
    auditViews(state, `depth ${depth}`);
    audited += 1;
    if (depth === 0) return;
    short.forEach((ev) => {
      const next = Core.reduce(state, ev, 1000 + depth * 1000);
      if (next !== state) walk(next, depth - 1);
    });
  };
  walk(root, 4);
  assert.ok(audited > 800, `only ${audited} nodes walked`);
});

test("A1 the losing team's giver never sees a Lightning word, in any Lightning state", () => {
  let s = scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10);
  assert.equal(s.phase, "gameOver");
  s = Core.reduce(s, { type: "toLightning" }, 0);
  const losingSide = s.teams[1 - s.lightning.team].members.map((m) => m.pid);
  const winningReceiver = s.lightning.receiverPid;
  const marks = ["got", "pass", "got", "pass", "got"];
  s = Core.reduce(s, { type: "lightningStart" }, 1000);
  for (let i = 0; i <= marks.length; i += 1) {
    const secrets = s.lightning.words.map((w) => w.text);
    losingSide.concat([winningReceiver]).forEach((pid) => {
      const text = JSON.stringify(Core.phoneView(s, pid));
      secrets.forEach((w) => assert.equal(text.indexOf(w), -1, `${pid} saw “${w}” at mark ${i}`));
    });
    if (i < marks.length) s = Core.reduce(s, { type: "lightningMark", result: marks[i] }, 2000 + i);
  }
});

test("A1 a spectator, an empty pid and prototype-shaped pids all get the waiting screen", () => {
  const s = boot();
  ["px", "", "__proto__", "constructor", "toString"].forEach((pid) => {
    const view = Core.phoneView(s, pid);
    assert.equal(view.screen, "wait", `pid "${pid}"`);
    assert.equal(view.word, undefined);
    assert.equal(view.team, null);
    assert.equal(view.name, "");
  });
});

/* ============================================================
   A2 — the ladder, the dead word, the illegal clue
   ============================================================ */

test("A2 the ladder walks 10 down to 1 and the eleventh clue is refused", () => {
  let s = boot();
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    s = Core.reduce(s, { type: "clueGiven" }, 0);
    seen.push(Core.value(s));
    s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
  }
  assert.deepEqual(seen, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(s.round.dead, true);
  assert.equal(s.round.finished, true);
  assert.deepEqual(Core.scores(s), [0, 0]);
  ["clueGiven", "illegal", "skipWord"].forEach((type) => {
    assert.equal(Core.reduce(s, { type }, 0), s, `${type} on a dead word must be refused`);
  });
  assert.equal(Core.reduce(s, { type: "guess", result: "correct" }, 0), s);
});

test("A2 a correct guess on the tenth clue still pays one point", () => {
  let s = wrongTimes(boot(), 9);
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.value(s), 1);
  s = Core.reduce(s, { type: "guess", result: "correct" }, 0);
  assert.deepEqual(Core.scores(s), [0, 1], "the tenth clue was Team B's and it is worth 1");
  assert.equal(s.round.dead, false);
});

test("A2 an illegal clue passes control and drops the value, before or after the clue", () => {
  // Before "Clue given".
  let a = boot();
  a = Core.reduce(a, { type: "illegal" }, 0);
  assert.equal(Core.clueCount(a), 1);
  assert.equal(Core.turn(a), 1);
  assert.equal(a.round.awaitingGuess, false);
  // After "Clue given" — the same rung, never two.
  let b = Core.reduce(boot(), { type: "clueGiven" }, 0);
  b = Core.reduce(b, { type: "illegal" }, 0);
  assert.equal(Core.clueCount(b), 1);
  assert.equal(Core.turn(b), 1);
  // Ten illegal clues in a row kill the word on the tenth, not the ninth.
  let s = boot();
  for (let i = 0; i < 9; i += 1) s = Core.reduce(s, { type: "illegal" }, 0);
  assert.equal(s.round.dead, false, "nine forfeited clues leave the word alive");
  s = Core.reduce(s, { type: "illegal" }, 0);
  assert.equal(s.round.dead, true);
  assert.equal(Core.reduce(s, { type: "guess", result: "correct" }, 0), s,
    "and nothing can be scored on it");
});

test("A2 an illegal clue never lets the receiver guess", () => {
  const clued = Core.reduce(boot(), { type: "clueGiven" }, 0);
  const judged = Core.reduce(clued, { type: "illegal" }, 0);
  assert.equal(Core.reduce(judged, { type: "guess", result: "correct" }, 0), judged,
    "the forfeited clue may not be scored");
});

/* ============================================================
   A3 — the target score, mid-word
   ============================================================ */

test("A3 the target ends the game the instant it is reached and freezes the word", () => {
  let s = boot({ settings: { targetScore: 15 } });
  s = clueAnd(s, "wrong");                 // A clued, B on
  s = clueAnd(s, "correct");               // B take 9
  assert.deepEqual(Core.scores(s), [0, 9]);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  s = clueAnd(s, "wrong");                 // A open (they lost), B on
  s = clueAnd(s, "correct");               // B take 9 -> 18
  assert.deepEqual(Core.scores(s), [0, 18]);
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winner, 1);
  ["clueGiven", "illegal", "skipWord", "nextWord", "setFirst"].forEach((type) => {
    assert.equal(Core.reduce(s, { type, team: 0 }, 0), s, `${type} after game over`);
  });
  assert.equal(Core.phoneView(s, "p1").screen, "wait");
  auditViews(s, "gameOver");
});

test("A3 exactly hitting the target wins; one point short does not", () => {
  const short = scoreTo(boot({ settings: { targetScore: 30 } }), 0, 20);
  assert.equal(short.phase, "word", "20 of 30 is not a win");
  let s = boot({ settings: { targetScore: 10 } });
  s = clueAnd(s, "correct");
  assert.deepEqual(Core.scores(s), [10, 0]);
  assert.equal(s.phase, "gameOver", "exactly the target wins");
});

/* ============================================================
   A4 — who opens, and the host's override
   ============================================================ */

test("A4 the host's opener choice is honoured, then locked by the first clue", () => {
  let s = boot();
  assert.equal(Core.turn(s), 0);
  s = Core.reduce(s, { type: "setFirst", team: 1 }, 0);
  assert.equal(Core.turn(s), 1);
  assert.equal(s.round.firstTeam, 1);
  ["0", 1.5, -1, 2, null, undefined, true, NaN].forEach((team) => {
    assert.equal(Core.reduce(s, { type: "setFirst", team }, 0), s, `setFirst ${String(team)} ignored`);
  });
  const clued = Core.reduce(s, { type: "clueGiven" }, 0);
  assert.equal(Core.reduce(clued, { type: "setFirst", team: 0 }, 0), clued);
  const answered = Core.reduce(clued, { type: "guess", result: "wrong" }, 0);
  assert.equal(Core.reduce(answered, { type: "setFirst", team: 1 }, 0), answered);
});

test("A4 the loser of every word opens the next, across a run of words", () => {
  let s = boot({ settings: { targetScore: 100 } });
  const openers = [];
  const winners = [1, 1, 0, 1, 0];
  winners.forEach((w) => {
    openers.push(Core.turn(s));
    if (Core.turn(s) !== w) s = clueAnd(s, "wrong");
    s = clueAnd(s, "correct");
    assert.equal(s.round.won, w);
    s = Core.reduce(s, { type: "nextWord" }, 0);
  });
  assert.deepEqual(openers, [0, 0, 0, 1, 0]);
  assert.deepEqual(openers.slice(1), winners.slice(0, -1).map((w) => 1 - w));
});

test("A4 a skipped word alternates the opener rather than repeating it", () => {
  let s = boot({ firstTeam: 1 });
  s = Core.reduce(s, { type: "skipWord" }, 0);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(Core.turn(s), 0);
  s = Core.reduce(s, { type: "skipWord" }, 0);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(Core.turn(s), 1);
});

/* ============================================================
   A5 — role swapping
   ============================================================ */

test("A5 the swap is driven by words played, not by who won", () => {
  let s = boot({ settings: { targetScore: 100 } });
  const order = [];
  for (let i = 0; i < 6; i += 1) {
    order.push(Core.giverPids(s).join("+"));
    // Alternate the winner so the swap cannot be following who won.
    if (i % 2) s = clueAnd(s, "wrong");
    s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
    assert.equal(s.phase, "word");
  }
  assert.deepEqual(order, ["p1+p3", "p2+p4", "p1+p3", "p2+p4", "p1+p3", "p2+p4"]);
});

test("A5 swapRoles off pins the pair for a whole night, including the Lightning giver", () => {
  let s = boot({ settings: { swapRoles: false, targetScore: 10 } });
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(Core.giverPids(s), ["p1", "p3"], `word ${i}`);
    if (s.phase !== "word") break;
    s = Core.reduce(clueAnd(s, "wrong"), { type: "nextWord" }, 0);
  }
  let t = scoreTo(boot({ settings: { swapRoles: false, targetScore: 10 } }), 0, 10);
  t = Core.reduce(t, { type: "toLightning" }, 0);
  assert.equal(t.lightning.giverPid, "p1");
  assert.equal(t.lightning.receiverPid, "p2");
});

test("A5 a swap moves entitlement, so yesterday's giver is refused today", () => {
  let s = boot();
  assert.equal(Core.phoneCanClue(s, "p1"), true);
  s = Core.reduce(clueAnd(s, "correct"), { type: "nextWord" }, 0);
  assert.equal(Core.phoneCanClue(s, "p1"), false, "Ada receives now");
  assert.equal(Core.phoneView(s, "p1").word, undefined);
  assert.deepEqual(Core.giverPids(s), ["p2", "p4"], "both teams swapped");
  assert.equal(Core.turn(s), 1, "Team A won, so Team B opens");
  assert.equal(Core.phoneCanClue(s, "p4"), true, "Team B's new giver opens");
  assert.equal(Core.phoneCanClue(s, "p2"), false, "Team A's new giver waits their turn");
  assert.equal(Core.phoneView(s, "p2").word, s.round.word, "but still reads the password");
});

/* ============================================================
   A6 — the Lightning Round
   ============================================================ */

test("A6 passes cycle round and only close the round when nothing is left", () => {
  let s = lightningAt();
  const list = s.lightning.words.map((w) => w.text);
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 2000);
  assert.equal(s.lightning.finished, false, "five passes leave five words alive");
  assert.equal(s.lightning.words.every((w) => w.status === "passed"), true);
  assert.equal(s.lightning.words[s.lightning.cursor].text, list[0], "back to the top of the list");
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 3000);
  assert.equal(s.lightning.finished, false);
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 3000);
  assert.equal(s.lightning.finished, true, "the last word closes it");
  assert.equal(s.outcome.got, 5);
  assert.equal(s.outcome.money, 1000);
});

test("A6 a one-word round can be passed for ever and is still closed by the buzzer", () => {
  let s = lightningAt({ settings: { lightningWords: 1 } });
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 2000);
  assert.equal(s.lightning.finished, false);
  assert.equal(s.lightning.cursor, 0);
  s = Core.reduce(s, { type: "lightningExpired" }, 99000);
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 99001);
  assert.equal(s.lightning.finished, true);
  assert.equal(s.outcome.money, 200, "one of one, doubled");
});

test("A6 the buzzer does not cut off the word in flight, and closes the round after it", () => {
  let s = lightningAt();
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "lightningExpired" }, 61001);
  assert.equal(s.lightning.expired, true);
  assert.equal(s.lightning.finished, false, "the word in flight is still to be judged");
  assert.equal(Core.phoneCanMark(s, s.lightning.giverPid), true);
  assert.equal(Core.phoneView(s, s.lightning.giverPid).word, s.lightning.words[1].text);
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 61002);
  assert.equal(s.lightning.finished, true);
  assert.equal(s.outcome.got, 2);
  assert.equal(s.outcome.money, 200);
  assert.equal(Core.reduce(s, { type: "lightningMark", result: "got" }, 62000), s,
    "no marks after the round has closed");
  assert.equal(Core.phoneCanMark(s, s.lightning.giverPid), false);
});

test("A6 expiry before the clock starts, and a second expiry, are both refused", () => {
  let s = scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10);
  s = Core.reduce(s, { type: "toLightning" }, 0);
  assert.equal(Core.reduce(s, { type: "lightningExpired" }, 1000), s, "no clock, no buzzer");
  s = Core.reduce(s, { type: "lightningStart" }, 1000);
  s = Core.reduce(s, { type: "lightningExpired" }, 61001);
  assert.equal(Core.reduce(s, { type: "lightningExpired" }, 61002), s, "the buzzer fires once");
  assert.equal(Core.reduce(s, { type: "lightningStart" }, 61003), s, "and the clock cannot restart");
});

test("A6 pause stops play as well as the clock, and Resume hands the time back", () => {
  let s = lightningAt();
  assert.equal(s.lightning.clock.deadline, 61000);
  s = Core.reduce(s, { type: "lightningPause" }, 21000);
  assert.equal(s.lightning.clock.running, false);
  assert.equal(s.lightning.clock.deadline, null);
  assert.equal(s.lightning.clock.remainingMs, 40000);
  assert.equal(Core.reduce(s, { type: "lightningPause" }, 22000), s, "pausing twice is a no-op");
  // Defect PW-D1: a paused clock must silence Got it / Pass on the host screen,
  // the hotkeys and the phone alike — otherwise words are scored off the clock.
  assert.equal(Core.reduce(s, { type: "lightningMark", result: "got" }, 22000), s,
    "no word may be judged while play is stopped");
  assert.equal(Core.phoneCanMark(s, s.lightning.giverPid), false);
  s = Core.reduce(s, { type: "lightningStart" }, 500000);
  assert.equal(s.lightning.clock.deadline, 540000, "resume never loses or gains time");
  assert.equal(Core.secondsLeft(s.lightning.clock, 520000), 20);
  assert.notEqual(Core.reduce(s, { type: "lightningMark", result: "got" }, 500001), s,
    "and the giver can mark again");
});

test("A6 the all-five bonus is applied, or not, exactly as configured", () => {
  const run = (settings) => {
    let s = lightningAt({ settings });
    const n = s.lightning.words.length;
    for (let i = 0; i < n; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
    return s.outcome;
  };
  assert.equal(run({}).money, 1000);
  assert.equal(run({}).doubled, true);
  assert.equal(run({ allFiveBonus: false }).money, 500);
  assert.equal(run({ allFiveBonus: false }).doubled, false);
  assert.equal(run({ allFiveBonus: false }).allFive, true, "the fact is recorded either way");
  assert.equal(run({ lightningWords: 3, lightningValue: 1 }).money, 6);
});

test("A6 four of five never doubles, whichever word was dropped", () => {
  for (let miss = 0; miss < 5; miss += 1) {
    let s = lightningAt();
    for (let i = 0; i < 5; i += 1) {
      s = Core.reduce(s, { type: "lightningMark", result: i === miss ? "pass" : "got" }, 2000);
    }
    s = Core.reduce(s, { type: "lightningExpired" }, 61001);
    s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 61002);
    assert.equal(s.outcome.got, 4, `missing word ${miss}`);
    assert.equal(s.outcome.doubled, false);
    assert.equal(s.outcome.money, 400);
  }
});

test("A6 the Lightning money reaches both members and the hub standings", () => {
  let s = lightningAt();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  const rows = Core.standings(s);
  assert.equal(rows[0].winnings, 1000);
  assert.equal(rows[0].members.length, 2);
  assert.equal(rows[1].winnings, 0);
  assert.deepEqual(["p1", "p2"].map((pid) => Core.phoneView(s, pid).mine), ["$1,000", "$1,000"]);
  assert.deepEqual(["p3", "p4"].map((pid) => Core.phoneView(s, pid).mine), ["$0", "$0"]);
});

test("A6 a night of three games banks each Lightning Round exactly once", () => {
  let s = lightningAt();
  for (let g = 0; g < 3; g += 1) {
    const n = s.lightning.words.length;
    for (let i = 0; i < n; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
    s = Core.reduce(s, { type: "nextWord" }, 0);      // result
    s = Core.reduce(s, { type: "nextWord" }, 0);      // standings
    assert.equal(Core.standings(s)[0].winnings, 1000 * (g + 1), `after game ${g + 1}`);
    if (g === 2) break;
    s = Core.reduce(s, { type: "nextGame" }, 0);
    assert.deepEqual(Core.scores(s), [0, 0]);
    s = scoreTo(s, 0, 10);
    s = Core.reduce(s, { type: "toLightning" }, 0);
    s = Core.reduce(s, { type: "lightningStart" }, 0);
  }
  assert.equal(Core.standings(s)[0].gamesWon, 3);
  assert.equal(Core.standings(s)[0].winnings, 3000);
});

/* ============================================================
   A7 — the word order: shuffle, wrap, repeating
   ============================================================ */

test("A7 shuffle is a permutation, is repeatable, and survives a broken rng", () => {
  const a = boot({ count: 60, shuffle: true, rng: rngOf(99) });
  const b = boot({ count: 60, shuffle: true, rng: rngOf(99) });
  assert.deepEqual(a.order, b.order);
  assert.equal(new Set(a.order).size, 60, "no word lost or doubled");
  assert.deepEqual(a.order.slice().sort(), words(60).slice().sort());
  [() => 0, () => 0.9999999, () => NaN, () => -5, () => 12].forEach((rng, i) => {
    const s = boot({ count: 60, shuffle: true, rng });
    assert.equal(new Set(s.order).size, 60, `degenerate rng ${i} lost words`);
  });
});

test("A7 the wrap raises repeating once, and the flag survives the rest of the night", () => {
  const skip = (state) => Core.reduce(Core.reduce(state, { type: "skipWord" }, 0), { type: "nextWord" }, 0);
  let s = boot({ count: 60, settings: { targetScore: 100 } });
  for (let i = 0; i < 59; i += 1) s = skip(s);
  assert.equal(s.repeating, false);
  assert.equal(s.cursor, 60);
  s = skip(s);
  assert.equal(s.repeating, true);
  assert.equal(s.round.word, s.order[0]);
  s = skip(s);
  assert.equal(s.repeating, true, "the flag never goes back down");
  assert.equal(s.round.word, s.order[1]);
});

test("A7 a Lightning Round that straddles the end of the list wraps and flags it", () => {
  const skip = (state) => Core.reduce(Core.reduce(state, { type: "skipWord" }, 0), { type: "nextWord" }, 0);
  let s = boot({ count: 60, settings: { targetScore: 10 } });
  for (let i = 0; i < 56; i += 1) s = skip(s);
  assert.equal(s.cursor, 57);
  assert.equal(s.repeating, false);
  s = scoreTo(s, 0, 10);
  const cursor = s.cursor;
  s = Core.reduce(s, { type: "toLightning" }, 0);
  assert.equal(s.lightning.words.length, 5);
  assert.equal(s.repeating, true, "the round ran off the end of the file");
  const expected = [0, 1, 2, 3, 4].map((i) => s.order[(cursor + i) % 60]);
  assert.deepEqual(s.lightning.words.map((w) => w.text), expected);
});

test("A7 wordAt is total: any cursor, any list, never undefined", () => {
  const order = words(7);
  [-9, -1, 0, 6, 7, 13, 700].forEach((c) => {
    const got = Content.wordAt(order, c);
    assert.equal(typeof got.word, "string");
    assert.ok(order.indexOf(got.word) >= 0, `cursor ${c}`);
  });
  assert.deepEqual(Content.wordAt([], 3), { word: "", repeating: false });
  assert.deepEqual(Content.wordAt(null, 3), { word: "", repeating: false });
});

/* ============================================================
   A10 — immutability under a deep freeze
   ============================================================ */

test("A10 every event runs against a deeply frozen state without throwing or mutating", () => {
  const seeds = [
    boot(),
    Core.reduce(boot(), { type: "clueGiven" }, 0),
    wrongTimes(boot(), 10),
    scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10),
    lightningAt(),
    Core.reduce(lightningAt(), { type: "lightningMark", result: "pass" }, 2000),
  ];
  seeds.forEach((seed, i) => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(seed)));
    const before = JSON.stringify(frozen);
    EVENTS.forEach((ev) => {
      const next = Core.reduce(frozen, ev, 90000);
      assert.equal(JSON.stringify(frozen), before, `seed ${i}: ${ev.type} mutated the input`);
      Core.value(next); Core.turn(next); Core.scores(next); Core.clueCount(next);
      Core.lightningTotal(next); Core.standings(next);
      PIDS.forEach((pid) => Core.phoneView(next, pid));
    });
  });
});

test("A10 a forty-step frozen walk never mutates and never throws", () => {
  const rng = rngOf(4242);
  let s = deepFreeze(JSON.parse(JSON.stringify(boot({ settings: { targetScore: 5 } }))));
  for (let i = 0; i < 40; i += 1) {
    const before = JSON.stringify(s);
    const ev = EVENTS[Math.floor(rng() * EVENTS.length)];
    const next = deepFreeze(Core.reduce(s, ev, 1000 + i * 4000));
    assert.equal(JSON.stringify(s), before, `step ${i} (${ev.type}) mutated the previous state`);
    s = next;
  }
});

test("A10 selectors never mutate the state they read", () => {
  const s = lightningAt();
  const before = JSON.stringify(s);
  Core.standings(s);
  Core.bankGame(s);
  Core.scores(s).push(999);
  Core.giverPids(s);
  Core.phoneView(s, "p1");
  assert.equal(JSON.stringify(s), before);
  assert.equal(Core.bankGame(s).banked, true, "bankGame returns a banked COPY");
  assert.equal(s.banked, false, "and leaves the original alone");
});

/* ============================================================
   A11 — undo across every phase boundary
   ============================================================ */

test("A11 undo walks back out of the Lightning Round, the game over and the word", () => {
  let s = lightningAt();
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  assert.equal(Core.lightningTotal(s), 100);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(Core.lightningTotal(s), 0, "the mark is taken back");
  assert.equal(s.phase, "lightning");
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.phase, "gameOver", "and back out of the Lightning Round");
  assert.equal(s.lightning, null);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.phase, "word", "and back into the word that won it");
  assert.equal(s.winner, null);
  assert.equal(s.round.finished, false);
});

test("A11 undo restores the cursor, so an undone Lightning Round re-deals the same words", () => {
  let s = scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10);
  const cursor = s.cursor;
  s = Core.reduce(s, { type: "toLightning" }, 0);
  const dealt = s.lightning.words.map((w) => w.text);
  assert.equal(s.cursor, cursor + 5);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.cursor, cursor, "the words go back in the pack");
  s = Core.reduce(s, { type: "toLightning" }, 0);
  assert.deepEqual(s.lightning.words.map((w) => w.text), dealt);
});

test("A11 undo unwinds the banking of a game and the standings", () => {
  let s = lightningAt();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "nextWord" }, 0);            // result
  s = Core.reduce(s, { type: "nextWord" }, 0);            // standings, banked
  assert.equal(s.banked, true);
  assert.equal(s.night.length, 1);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.phase, "result");
  assert.equal(s.banked, false);
  assert.deepEqual(s.night, []);
  assert.equal(Core.standings(s)[0].winnings, 1000, "the money is still owed, just not banked");
});

test("A11 undo after a second game does not resurrect the first game's points", () => {
  let s = lightningAt();
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "nextWord" }, 0);
  s = Core.reduce(s, { type: "nextGame" }, 0);
  assert.equal(s.gameNo, 2);
  assert.deepEqual(Core.scores(s), [0, 0]);
  s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.gameNo, 1);
  assert.equal(s.phase, "result");
  assert.deepEqual(Core.scores(s), [10, 0]);
});

test("A11 undo can be pressed past the beginning without damage", () => {
  let s = boot();
  for (let i = 0; i < 30; i += 1) s = Core.reduce(s, { type: "undo" }, 0);
  assert.equal(s.phase, "setup");
  assert.deepEqual(s.history, []);
  assert.equal(Core.reduce(s, { type: "undo" }, 0), s);
  const restarted = Core.reduce(s, { type: "start" }, 0);
  assert.equal(restarted.phase, "word");
  assert.equal(restarted.round.word, s.order[0], "the pack was put back too");
});

test("A11 the history is capped and never nests", () => {
  let s = boot({ settings: { targetScore: 100 } });
  for (let i = 0; i < 200; i += 1) {
    s = Core.reduce(s, { type: "clueGiven" }, 0);
    s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
    if (s.round.finished) s = Core.reduce(s, { type: "nextWord" }, 0);
  }
  assert.ok(s.history.length <= Core.MAX_HISTORY);
  s.history.forEach((h) => assert.deepEqual(h.history, []));
});

/* ============================================================
   A12 — prototype-shaped events and hostile shapes
   ============================================================ */

test("A12 prototype-shaped event types are refused and never corrupt the reducer", () => {
  const seeds = [boot(), lightningAt(), Core.createState(game(), TEAMS, {})];
  const probes = ["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__",
    "__defineSetter__", "__lookupGetter__", "__lookupSetter__"];
  seeds.forEach((seed, i) => {
    probes.forEach((type) => {
      assert.equal(Core.reduce(seed, { type }, 0), seed, `seed ${i}: "${type}" changed the state`);
    });
  });
  assert.equal(({}).phase, undefined, "Object.prototype was not written to");
  assert.notEqual(Core.reduce(seeds[0], { type: "clueGiven" }, 0), seeds[0]);
});

test("A12 the reducer survives malformed events, states and clocks", () => {
  const s = boot();
  [null, undefined, 0, "clueGiven", [], [{ type: "clueGiven" }], true,
    { type: null }, { type: 7 }, { type: {} }, { type: ["clueGiven"] }, {},
    Object.create(null)].forEach((ev) => {
    assert.equal(Core.reduce(s, ev, 0), s, `event ${JSON.stringify(ev)} changed state`);
  });
  [null, undefined, 0, ""].forEach((state) => {
    assert.equal(Core.reduce(state, { type: "clueGiven" }, 0), state);
  });
  let l = scoreTo(boot({ settings: { targetScore: 10 } }), 0, 10);
  l = Core.reduce(l, { type: "toLightning" }, 0);
  [NaN, Infinity, -Infinity, "1000", null, {}].forEach((now) => {
    const started = Core.reduce(l, { type: "lightningStart", now }, 5000);
    assert.equal(Number.isFinite(started.lightning.clock.deadline), true, `now = ${String(now)}`);
  });
  const withNow = Core.reduce(l, { type: "lightningStart", now: 7000 }, 5000);
  assert.equal(withNow.lightning.clock.deadline, 67000, "an explicit event.now wins");
});

test("A12 a hostile team line-up is refused, not seated", () => {
  const bad = [
    [[], /exactly two teams/],
    [[TEAMS[0]], /exactly two teams/],
    [[TEAMS[0], TEAMS[1], TEAMS[0]], /exactly two teams/],
    [[null, TEAMS[1]], /Team A is missing/],
    [["a", TEAMS[1]], /Team A is missing/],
    [[{ name: "A", members: [] }, TEAMS[1]], /needs two players/],
    [[{ name: "A", members: TEAMS[0].members.concat(TEAMS[1].members) }, TEAMS[1]], /needs two players/],
    [[{ name: "A", members: [null, null] }, TEAMS[1]], /missing a player/],
    [[{ name: "A", members: [{ pid: "", name: "Ada" }, { pid: "p2", name: "Ben" }] }, TEAMS[1]],
      /both players need a name/],
  ];
  bad.forEach(([teams, re]) => assert.throws(() => Core.createState(game(), teams), re));
  const long = [{ name: "x".repeat(200), members: TEAMS[0].members }, TEAMS[1]];
  const s = Core.createState(game(), long);
  assert.ok(s.teams[0].name.length <= Core.NAME_MAX, "a huge team name is capped, not refused");
});

test("A12 control characters are scrubbed out of every name and id", () => {
  // Built from escapes so this file stays printable ASCII (house rule).
  const NUL = String.fromCharCode(0);
  const teams = [
    { name: `Reds${NUL}`, members: [{ pid: `p1${NUL}`, name: `A${NUL}da` }, { pid: "p2", name: "Ben" }] },
    TEAMS[1],
  ];
  const clean = Core.createState(game(), teams);
  assert.equal(clean.teams[0].name, "Reds");
  assert.equal(clean.teams[0].members[0].name, "A da", "a control char becomes a space, not a hole");
  assert.equal(clean.teams[0].members[0].pid, "p1");
  const CONTROLS = new RegExp("[\u0000-\u001F\u007F-\u009F]");
  assert.equal(CONTROLS.test(JSON.stringify(clean.teams)), false, "no control char survives");
  assert.equal(CONTROLS.test(JSON.stringify(Core.phoneView(
    Core.reduce(clean, { type: "start" }, 0), "p1"))), false, "nor reaches a phone view");
});

test("A12 a game that cannot be won still cannot be broken", () => {
  // startValue 3 and targetScore 100: every word dies, nobody ever wins.
  let s = boot({ count: 60, settings: { startValue: 3, targetScore: 100 } });
  for (let i = 0; i < 40; i += 1) {
    s = Core.reduce(s, { type: "clueGiven" }, 0);
    s = Core.reduce(s, { type: "guess", result: "wrong" }, 0);
    if (s.round.finished) s = Core.reduce(s, { type: "nextWord" }, 0);
    auditViews(s, `starve step ${i}`);
  }
  assert.equal(s.phase, "word");
  assert.deepEqual(Core.scores(s), [0, 0]);
  const done = Core.reduce(s, { type: "finish" }, 0);
  assert.equal(done.phase, "standings");
  assert.equal(Core.standings(done)[0].winnings, 0);
  assert.equal(Core.standings(done)[0].gamesWon, 0);
});
