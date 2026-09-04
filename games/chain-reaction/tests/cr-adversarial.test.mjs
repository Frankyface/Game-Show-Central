/* ============================================================
   Chain Reaction — ADVERSARIAL suite, part 1: the RULES (A1-A9).
   Written by the independent tester against docs/14-chain-reaction-spec.md,
   not against the implementation: every test here tries to make the core
   break a documented rule. Part 2 (cr-adversarial-fuzz.test.mjs) covers
   masking, validator/phone fuzz, immutability, undo and prototype events.
   Split in two only to stay under the 800-line house limit.

   Run with:  cd games/chain-reaction && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/cr-core.js");
const SHIPPED = require("../chains.json");

const rng0 = () => 0;
const rng9 = () => 0.999999;
const TEAMS = [{ name: "Alpha", pids: ["p1", "p2"] }, { name: "Beta", pids: ["p3"] }];
const PIDS = ["p1", "p2", "p3", "stranger", "", null, undefined, "__proto__", "constructor"];

/* ============ Fixtures ============ */

const SIX_CHAINS = [
  ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"],
  ["FIRE", "WORKS", "SHOP", "FRONT", "DOOR", "BELL", "BOY", "BAND"],
  ["SUN", "FLOWER", "POT", "HOLE", "PUNCH", "LINE", "UP", "GRADE"],
  ["BUTTER", "FLY", "PAPER", "BACK", "PACK", "RAT", "RACE", "TRACK"],
  ["HORSE", "SHOE", "LACE", "CURTAIN", "CALL", "BACK", "FIRE", "PLACE"],
  ["MOON", "LIGHT", "HOUSE", "HOLD", "UP", "RIGHT", "HAND", "BAG"],
];
const SPEEDS = [
  ["CHAIN", "REACTION", "TIME", "OUT", "SIDE", "STEP", "FATHER", "LAND"],
  ["HIGH", "SCHOOL", "BUS", "STOP", "LIGHT", "WEIGHT", "ROOM", "MATE"],
];

function game(settings, chains) {
  return {
    title: "Adversarial",
    settings: Object.assign(
      { currency: "$", values: [100, 200], speedSeconds: 60, speedPerWord: 100, speedAllClear: 1000 },
      settings || {},
    ),
    chains: (chains || SIX_CHAINS).map((c) => c.slice()),
    speedChains: SPEEDS.map((c) => c.slice()),
  };
}

const start = (g, teams) => Core.reduce(Core.createState(g || game(), teams || TEAMS, {}), { type: "start" }, rng0, 0);

/** Reveal at `direction` until the word is the live target, then judge it. */
function play(state, direction, correct) {
  let s = Core.reduce(state, { type: "reveal", direction }, rng0, 0);
  if (s.target === null) return s;              // the reveal spelled it out — it was given
  return Core.reduce(s, { type: "judge", correct: correct !== false }, rng0, 0);
}

/** Sweep the live chain with correct answers; returns the chainDone state. */
function sweep(state) {
  let s = state;
  let guard = 0;
  while (s.phase === "chain" && guard < 500) {
    guard += 1;
    s = play(s, guard % 2 ? "top" : "bottom", true);
  }
  assert.notEqual(guard, 500, "the sweep never terminated");
  return s;
}

/** Every chain played out with clean sweeps. */
function toChainsDone(g) {
  const gg = g || game();
  let s = sweep(start(gg));
  while (Core.chainsLeft(s) > 0) s = sweep(Core.reduce(s, { type: "nextChain" }, rng0, 0));
  return s;
}

function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.getOwnPropertyNames(value).forEach((k) => deepFreeze(value[k], marks));
  return Object.freeze(value);
}

/* ============================================================
   A1 — eligibility: only the two frontier words can ever move
   ============================================================ */

test("A1 only the two frontier words ever gain a letter, over a whole chain", () => {
  let s = start();
  let guard = 0;
  while (s.phase === "chain" && guard < 400) {
    guard += 1;
    const ends = Core.frontier(s);
    const allowed = new Set([ends.top, ends.bottom].filter((i) => i !== null));
    const before = Core.columnRows(s.chain).map((r) => r.shown);
    s = Core.reduce(s, { type: "reveal", direction: guard % 3 ? "top" : "bottom" }, rng0, 0);
    const chain = s.chain || { solved: [] };
    Core.columnRows(chain).forEach((row, i) => {
      if (row.shown !== before[i]) {
        assert.ok(allowed.has(i), `word ${i} changed but the frontier was ${[...allowed]}`);
      }
    });
    if (s.target !== null) {
      assert.ok(allowed.has(s.target), "the target must be a frontier word");
      s = Core.reduce(s, { type: "judge", correct: guard % 2 === 0 }, rng0, 0);
    }
  }
  assert.equal(s.phase, "chainDone");
});

test("A1 a reveal aimed at an already-solved end is refused, not redirected", () => {
  let s = start();
  // Solve every word from the top until only word 6 is left unsolved.
  ["top", "top", "top", "top", "top"].forEach((d) => { s = play(s, d, true); });
  assert.deepEqual(Core.eligibleWords(s), [6], "one word left");
  const beforeTop = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(beforeTop.target, 6, "both directions resolve to the one remaining word");
  const done = sweep(s);
  assert.equal(done.phase, "chainDone");
  assert.deepEqual(Core.eligibleWords(done), [], "a complete chain has no eligible word");
  assert.equal(Core.reduce(done, { type: "reveal", direction: "top" }, rng0, 0), done);
  assert.equal(Core.reduce(done, { type: "reveal", direction: "bottom" }, rng0, 0), done);
});

test("A1 a second reveal before a judgement cannot switch ends or add a letter", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  const snapshot = JSON.stringify(s.chain);
  ["top", "bottom", "TOP", "", "middle", null, 7].forEach((direction) => {
    const again = Core.reduce(s, { type: "reveal", direction }, rng0, 0);
    assert.equal(again, s, `direction ${JSON.stringify(direction)} slipped through`);
  });
  assert.equal(JSON.stringify(s.chain), snapshot);
});

test("A1 a bogus direction never reveals anything", () => {
  const s = start();
  ["TOP", "Bottom", "left", " top", "top ", 0, 1, true, {}, [], null, undefined]
    .forEach((direction) => assert.equal(
      Core.reduce(s, { type: "reveal", direction }, rng0, 0), s,
      `direction ${JSON.stringify(direction)} was accepted`,
    ));
});

/* ============================================================
   A2 — letters light strictly left to right
   ============================================================ */

test("A2 letters light strictly left to right, including across a wrong guess", () => {
  let s = start();
  const word = s.chain.words[1];                 // SHIP
  const seen = [];
  for (let i = 0; i < word.length - 1; i += 1) {
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
    const cells = Core.columnRows(s.chain)[1].cells;
    seen.push(cells.map((c) => (c.ch === null ? "." : c.ch)).join(""));
    // Everything lit must be a prefix: no gaps, nothing lit past the frontier.
    const lit = cells.map((c) => c.ch !== null);
    const firstDark = lit.indexOf(false);
    if (firstDark >= 0) assert.ok(lit.slice(firstDark).every((v) => v === false), "a letter lit out of order");
    s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
    s = Core.reduce(s, { type: "passControl" }, rng0, 0);   // hand it straight back
  }
  assert.deepEqual(seen, ["S...", "SH..", "SHI."]);
});

test("A2 punctuation is free and never costs a turn", () => {
  const g = game({ values: [100] }, [
    ["MOTHER", "IN-LAW", "SUIT", "CASE", "STUDY", "HALL", "WAY", "OUT"],
  ].concat(SIX_CHAINS.slice(1)));
  let s = start(g);
  const row0 = Core.columnRows(s.chain)[1];
  assert.equal(row0.cells[2].lit, true, "the hyphen of IN-LAW starts lit");
  assert.equal(row0.cells[2].ch, "-");
  assert.equal(row0.shown, 0, "but it does not count as a shown letter");
  // IN-LAW has five letters, so the fifth reveal gives the word away.
  for (let i = 0; i < 4; i += 1) {
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
    assert.equal(s.target, 1, `reveal ${i + 1} should still be a guessable word`);
    s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
    s = Core.reduce(s, { type: "passControl" }, rng0, 0);
  }
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(s.chain.solved[1], true, "the fifth letter spells IN-LAW out");
  assert.equal(s.target, null);
});

/* ============================================================
   A3 — the all-letters-given rule
   ============================================================ */

test("A3 the last letter gives the word away: no points, control never moves", () => {
  const g = game({ values: [100] }, [
    ["ICE", "AX", "HANDLE", "BAR", "STOOL", "PIGEON", "HOLE", "PUNCH"],
  ].concat(SIX_CHAINS.slice(1)));
  let s = start(g);
  assert.equal(s.chain.words[1], "AX", "a two-letter word to make the rule bite fast");
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(s.target, 1);
  s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);   // control -> team 1
  const control = s.control;
  const scores = s.scores.slice();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(s.chain.solved[1], true, "the second letter completes AX, so it is given");
  assert.equal(s.chain.owner[1], null, "a given word belongs to nobody");
  assert.deepEqual(s.scores, scores, "a given word pays nothing");
  assert.equal(s.control, control, "control stays with whoever asked for the letter");
  assert.equal(s.target, null, "there is nothing left to judge");
  assert.match(s.notice, /fully spelled out/);
  // And judging now is a no-op, so the given word cannot be scored afterwards.
  assert.equal(Core.reduce(s, { type: "judge", correct: true }, rng0, 0), s);
});

test("A3 revealOnWrong that spells the word out also gives it for free", () => {
  const g = game({ values: [100], revealOnWrong: true }, [
    ["ICE", "AX", "HANDLE", "BAR", "STOOL", "PIGEON", "HOLE", "PUNCH"],
  ].concat(SIX_CHAINS.slice(1)));
  let s = start(g);
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);   // A
  s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);      // X comes free
  assert.equal(s.chain.solved[1], true);
  assert.deepEqual(s.scores, [0, 0], "still nobody scores for a given word");
  assert.equal(s.chain.owner[1], null);
  assert.equal(s.control, 1, "a wrong guess still hands control over");
});

/* ============================================================
   A4 / A5 — judging
   ============================================================ */

test("A4 correct pays exactly the current chain's value and keeps control", () => {
  const g = game({ values: [100, 250, 700] });
  let s = start(g);
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) s = Core.reduce(s, { type: "nextChain" }, rng0, 0);
    const value = Core.chainValue(s);
    assert.equal(value, [100, 250, 700][round]);
    const control = s.control;
    const before = s.scores.slice();
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
    s = Core.reduce(s, { type: "judge", correct: true }, rng0, 0);
    assert.equal(s.scores[control], before[control] + value, `round ${round + 1} paid the wrong amount`);
    assert.equal(s.scores[control === 0 ? 1 : 0], before[control === 0 ? 1 : 0], "the other team was touched");
    assert.equal(s.control, control, "correct keeps control");
    s = sweep(s);
  }
});

test("A4 a truthy-but-not-true `correct` is treated as wrong (host must be explicit)", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  const judged = Core.reduce(s, { type: "judge", correct: "yes" }, rng0, 0);
  assert.equal(judged.control, 1, "anything but literal true passes control");
  assert.deepEqual(judged.scores, [0, 0]);
  assert.equal(judged.chain.solved[1], false);
});

test("A5 a wrong guess passes control, keeps the letter, and opens both ends", () => {
  let s = start();
  s = Core.reduce(s, { type: "reveal", direction: "bottom" }, rng0, 0);
  const shownBefore = Core.columnRows(s.chain)[6].shown;
  s = Core.reduce(s, { type: "guess", text: "hallway", pid: "p1" }, rng0, 0);
  s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
  assert.equal(s.control, 1);
  assert.equal(s.target, null);
  assert.equal(s.guessText, "", "the guess is cleared for the incoming team");
  assert.equal(s.guessBy, null);
  assert.equal(Core.columnRows(s.chain)[6].shown, shownBefore, "the letter already given stays given");
  assert.deepEqual(s.scores, [0, 0]);
  const fromTop = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(fromTop.target, 1, "the incoming team may switch ends");
});

test("A5 control ping-pongs correctly over a long alternating run", () => {
  let s = start();
  let expected = 0;
  for (let i = 0; i < 12; i += 1) {
    const before = Core.columnRows(s.chain).map((r) => r.shown);
    s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
    if (s.target === null) {                     // the word was spelled out and given
      assert.equal(s.control, expected, "a given word never moves control");
      continue;
    }
    s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
    expected = expected === 0 ? 1 : 0;
    assert.equal(s.control, expected, `turn ${i} landed on the wrong team`);
    assert.deepEqual(s.scores, [0, 0], "nobody scores on a wrong guess");
    void before;
  }
});

/* ============================================================
   A6 — chain completion, advance, value change
   ============================================================ */

test("A6 completing a chain advances the round, the value and the opening team", () => {
  const g = game({ values: [100, 200, 300] });
  let s = sweep(start(g));
  assert.equal(s.phase, "chainDone");
  assert.equal(s.target, null);
  assert.equal(s.direction, null);
  const words0 = s.chain.words.join(",");
  s = Core.reduce(s, { type: "nextChain" }, rng0, 0);
  assert.equal(s.phase, "chain");
  assert.equal(s.chainIndex, 1);
  assert.equal(Core.chainValue(s), 200);
  assert.equal(s.control, 1, "teams alternate who opens");
  assert.notEqual(s.chain.words.join(","), words0, "a different chain");
  assert.deepEqual(Core.columnRows(s.chain).map((r) => r.shown).slice(1, 7), [0, 0, 0, 0, 0, 0]);
  s = sweep(s);
  s = Core.reduce(s, { type: "nextChain" }, rng0, 0);
  assert.equal(Core.chainValue(s), 300);
  assert.equal(s.control, 0);
  assert.equal(Core.chainsLeft(s), 0, "three values means three chains");
});

test("A6 the number of chains is the length of the values list, not the file", () => {
  const one = toChainsDone(game({ values: [500] }));
  assert.equal(one.chainIndex, 0);
  assert.equal(Core.chainsLeft(one), 0);
  assert.equal(Core.reduce(one, { type: "nextChain" }, rng0, 0), one, "there is no chain two");
  const six = game({ values: [1, 2, 3, 4, 5, 6] });
  assert.equal(Core.createState(six, TEAMS, {}).chainOrder.length, 6);
});

test("A6 nextChain outside the interstitial does nothing", () => {
  const live = start();
  assert.equal(Core.reduce(live, { type: "nextChain" }, rng0, 0), live);
  const done = toChainsDone();
  assert.equal(Core.reduce(done, { type: "nextChain" }, rng0, 0), done, "no chains left");
});

/* ============================================================
   A7 — the last chain hands the Speed Chain to the leader
   ============================================================ */

test("A7 the last chain completing sends the leading team to the Speed Chain", () => {
  // Values differ, so a clean sweep each leaves team B (who opens chain 2) ahead.
  let s = toChainsDone(game({ values: [100, 200] }));
  assert.equal(Core.chainsLeft(s), 0);
  const lead = Core.leader(s);
  assert.equal(lead, 1, "600 vs 1200");
  s = Core.reduce(s, { type: "toSpeed", team: null }, rng0, 0);
  assert.equal(s.phase, "speed");
  assert.equal(s.speed.team, lead, "the Speed Chain belongs to the leader");
  assert.equal(s.speed.started, false);
  assert.equal(s.speed.deadline, null);
  assert.deepEqual(s.speed.queue, [1, 2, 3, 4, 5, 6]);
});

test("A7 toSpeed refuses a tie, and a junk team falls back to the leader", () => {
  const tied = toChainsDone(game({ values: [100, 100] }));
  assert.equal(Core.leader(tied), null);
  [null, undefined, "0", 2, -1, "top", {}, [], true, NaN].forEach((team) => {
    assert.equal(Core.reduce(tied, { type: "toSpeed", team }, rng0, 0), tied,
      `team ${JSON.stringify(team)} started a Speed Chain on a tie`);
  });
  const clear = toChainsDone(game({ values: [100, 200] }));
  assert.equal(Core.reduce(clear, { type: "toSpeed", team: "1" }, rng0, 0).speed.team, Core.leader(clear));
  assert.equal(Core.reduce(clear, { type: "toSpeed", team: 0 }, rng0, 0).speed.team, 0,
    "an explicit 0 is still honoured (the host may override)");
});

test("A7 the Speed Chain cannot be reached before the chains are done", () => {
  const mid = sweep(start(game({ values: [100, 200] })));
  assert.equal(Core.chainsLeft(mid), 1);
  assert.equal(Core.reduce(mid, { type: "toSpeed", team: 0 }, rng0, 0), mid);
  const live = start();
  assert.equal(Core.reduce(live, { type: "toSpeed", team: 0 }, rng0, 0), live);
});

/* ============================================================
   A8 — a tie goes to sudden death, decided by the first correct call
   ============================================================ */

test("A8 a tie after the chains resolves on the first correct sudden-death call", () => {
  let s = toChainsDone(game({ values: [100, 100] }));
  assert.equal(Core.leader(s), null, "the fixture ties");
  s = Core.reduce(s, { type: "suddenDeath" }, rng0, 0);
  assert.equal(s.phase, "sudden");
  assert.ok(s.sudden.word && s.sudden.before && s.sudden.after);
  assert.equal(s.sudden.revealed.some(Boolean), false, "the word starts blank");

  const first = s.control;
  const second = first === 0 ? 1 : 0;
  s = Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0);
  assert.equal(s.sudden.revealed.filter(Boolean).length, 1, "one letter per reveal");
  s = Core.reduce(s, { type: "judge", correct: false }, rng0, 0);
  assert.equal(s.control, second, "a wrong call hands the buzzer over");
  assert.equal(s.sudden.winner, null, "still nobody has it");
  s = Core.reduce(s, { type: "judge", correct: true }, rng0, 0);
  assert.equal(s.sudden.winner, second);
  assert.equal(s.phase, "chainDone");
  assert.equal(Core.leader(s), second, "the tie is broken");
  // And it can only be won once.
  assert.equal(Core.reduce(s, { type: "judge", correct: true }, rng0, 0), s);
  assert.equal(Core.reduce(s, { type: "reveal", direction: "top" }, rng0, 0), s);
  // The winner can now take the Speed Chain.
  const speed = Core.reduce(s, { type: "toSpeed", team: null }, rng0, 0);
  assert.equal(speed.phase, "speed");
  assert.equal(speed.speed.team, second);
});

test("A8 sudden death is refused unless the chains are done AND the scores are level", () => {
  const live = start();
  assert.equal(Core.reduce(live, { type: "suddenDeath" }, rng0, 0), live, "mid-chain");
  const mid = sweep(start(game({ values: [100, 100] })));
  assert.equal(Core.chainsLeft(mid), 1);
  assert.equal(Core.reduce(mid, { type: "suddenDeath" }, rng0, 0), mid, "chains left");
  const clear = toChainsDone(game({ values: [100, 200] }));
  assert.notEqual(Core.leader(clear), null);
  assert.equal(Core.reduce(clear, { type: "suddenDeath" }, rng0, 0), clear, "somebody is already ahead");
});

test("A8 the sudden-death word is drawn from a chain nobody played (when one is spare)", () => {
  const g = game({ values: [100, 100] });
  const tied = toChainsDone(g);
  const played = new Set(tied.chainOrder.slice(0, tied.chainIndex + 1));
  [rng0, rng9, () => 0.5, () => 0.17, () => 0.83].forEach((rng) => {
    const s = Core.reduce(tied, { type: "suddenDeath" }, rng, 0);
    // Identify the SOURCE chain by the (before, word, after) triple, not by the
    // word alone — the same word can legitimately appear in two chains.
    const from = g.chains.findIndex((c) => {
      const at = c.indexOf(s.sudden.word);
      return at >= 1 && at <= 6 && c[at - 1] === s.sudden.before && c[at + 1] === s.sudden.after;
    });
    assert.ok(from >= 0, `${s.sudden.word} is not a word of any chain in the file`);
    assert.ok(!played.has(from), `the tiebreak came from chain ${from + 1}, which was played`);
    const chain = g.chains[from];
    const at = chain.indexOf(s.sudden.word);
    assert.ok(at >= 1 && at <= 6, "a hidden word, never the given top or bottom");
    assert.equal(s.sudden.revealed.length, s.sudden.word.length);
  });
});

test("A8 KNOWN GAP: the tiebreak word can be a word the teams already solved", () => {
  // pickSudden() picks an unplayed CHAIN, but not an unseen WORD: with this rng
  // the tiebreak is "UP", which chain 1 (SPACE SHIP SHAPE UP TOWN …) already put
  // on the board. Reported as a minor defect; pinned so a fix is visible.
  const g = game({ values: [100, 100] });
  const tied = toChainsDone(g);
  const s = Core.reduce(tied, { type: "suddenDeath" }, rng9, 0);
  const solvedAlready = tied.chainOrder.slice(0, tied.chainIndex + 1)
    .some((i) => g.chains[i].indexOf(s.sudden.word) >= 0);
  assert.equal(s.sudden.word, "UP");
  assert.equal(solvedAlready, true,
    "if this now fails, pickSudden() learned to avoid words already seen — update this test");
});

/* ============================================================
   A9 — Speed Chain: passes cycle, expiry, all-clear vs per-word
   ============================================================ */

function toSpeed(values) {
  const s = toChainsDone(game({ values: values || [100, 200] }));
  return Core.reduce(s, { type: "toSpeed", team: null }, rng0, 0);
}

test("A9 the Speed Chain board carries the first letter of every hidden word and nothing more", () => {
  const s = toSpeed();
  const rows = Core.speedColumn(s);
  rows.forEach((row, i) => {
    if (i === 0 || i === 7) {
      assert.equal(row.shown, s.speed.words[i].replace(/[^A-Z]/g, "").length, "the ends are given");
      return;
    }
    assert.equal(row.shown, 1, `word ${i} should show exactly one letter`);
    assert.equal(row.cells[0].ch, s.speed.words[i][0]);
    assert.equal(row.cells.filter((c) => c.ch !== null).length, 1);
  });
});

test("A9 passes cycle to the back of the queue, indefinitely, without scoring", () => {
  let s = Core.reduce(toSpeed(), { type: "speedStart" }, rng0, 1000);
  assert.deepEqual(s.speed.queue, [1, 2, 3, 4, 5, 6]);
  const order = [];
  for (let i = 0; i < 18; i += 1) {                  // three full laps of passes
    order.push(Core.speedCurrent(s));
    s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng0, 1000);
  }
  assert.deepEqual(order, [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6],
    "passed words come back in order, for ever");
  assert.equal(s.speed.over, false, "passing alone never ends the round");
  assert.equal(s.speed.marks.filter((m) => m === "got").length, 0);
  assert.deepEqual(s.speed.queue, [1, 2, 3, 4, 5, 6]);
  assert.equal(s.scores[s.speed.team], toSpeed().scores[toSpeed().speed.team], "nothing banked");
});

test("A9 a pass then a got leaves the passed word still in the queue", () => {
  let s = Core.reduce(toSpeed(), { type: "speedStart" }, rng0, 0);
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng0, 0);   // 1 -> back
  assert.deepEqual(s.speed.queue, [2, 3, 4, 5, 6, 1]);
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);    // 2 banked
  assert.deepEqual(s.speed.queue, [3, 4, 5, 6, 1]);
  assert.equal(s.speed.solved[2], true);
  assert.equal(s.speed.marks[1], "pass", "the passed word keeps its mark until it comes back");
  assert.equal(s.speed.solved[1], false);
  // and coming back it can still be banked
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  assert.equal(Core.speedCurrent(s), 1, "the passed word is last in line");
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  assert.equal(s.speed.allClear, true, "all six, even with a pass on the way");
});

test("A9 expiry with a word in flight pays per word for the banked ones only", () => {
  let s = Core.reduce(toSpeed(), { type: "speedStart" }, rng0, 0);
  const team = s.speed.team;
  const before = s.scores[team];
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  s = Core.reduce(s, { type: "speedMark", result: "pass" }, rng0, 0);
  const inFlight = Core.speedCurrent(s);
  assert.ok(inFlight !== null, "a word is still being asked for when time runs out");
  s = Core.reduce(s, { type: "speedExpired" }, rng0, 60000);
  assert.equal(s.speed.over, true);
  assert.equal(s.speed.got, 2);
  assert.equal(s.speed.allClear, false);
  assert.equal(s.speed.award, 200, "2 x speedPerWord");
  assert.equal(s.scores[team], before + 200);
  assert.equal(s.speed.deadline, null, "the clock is cleared");
  assert.deepEqual(s.speed.queue, [], "the in-flight word is dropped, not banked");
  assert.equal(s.speed.solved[inFlight], false, "and it is never marked as got");
  assert.equal(Core.speedCurrent(s), null);
  // Nothing can move after time.
  assert.equal(Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 61000), s);
  assert.equal(Core.reduce(s, { type: "speedMark", result: "pass" }, rng0, 61000), s);
  assert.equal(Core.reduce(s, { type: "speedExpired" }, rng0, 99000), s, "expiry pays once");
});

test("A9 all six pays the all-clear bonus INSTEAD of the per-word rate", () => {
  const custom = { values: [100, 200], speedPerWord: 100, speedAllClear: 1000 };
  let s = Core.reduce(toChainsDone(game(custom)), { type: "toSpeed", team: null }, rng0, 0);
  const team = s.speed.team;
  const before = s.scores[team];
  s = Core.reduce(s, { type: "speedStart" }, rng0, 0);
  for (let i = 0; i < 6; i += 1) s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  assert.equal(s.speed.allClear, true);
  assert.equal(s.speed.got, 6);
  assert.equal(s.speed.award, 1000, "the bonus, not 6 x 100");
  assert.notEqual(s.speed.award, 600);
  assert.equal(s.scores[team], before + 1000);
  assert.equal(s.speed.over, true);
});

test("A9 a zero per-word rate pays nothing on expiry, and the bonus is still whole", () => {
  const g = game({ values: [100, 200], speedPerWord: 0, speedAllClear: 5000 });
  let s = Core.reduce(Core.reduce(toChainsDone(g), { type: "toSpeed", team: null }, rng0, 0),
    { type: "speedStart" }, rng0, 0);
  const team = s.speed.team;
  const before = s.scores[team];
  s = Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0);
  s = Core.reduce(s, { type: "speedExpired" }, rng0, 60000);
  assert.equal(s.speed.award, 0);
  assert.equal(s.scores[team], before);
});

test("A9 marks before the clock starts, and a junk result, are refused", () => {
  const s = toSpeed();
  assert.equal(Core.reduce(s, { type: "speedMark", result: "got" }, rng0, 0), s, "not started");
  const live = Core.reduce(s, { type: "speedStart" }, rng0, 0);
  ["GOT", "Pass", "", "skip", 1, 0, true, null, undefined, {}, []].forEach((result) => {
    assert.equal(Core.reduce(live, { type: "speedMark", result }, rng0, 0), live,
      `result ${JSON.stringify(result)} was accepted`);
  });
  assert.equal(Core.reduce(live, { type: "speedStart" }, rng0, 5000), live, "starting twice is a no-op");
  assert.equal(live.speed.deadline, 0 + live.speed.seconds * 1000);
});

test("A9 secondsLeft never goes negative and survives a junk deadline", () => {
  assert.equal(Core.secondsLeft(60000, 0), 60);
  assert.equal(Core.secondsLeft(60000, 59500), 1);
  assert.equal(Core.secondsLeft(60000, 60000), 0);
  assert.equal(Core.secondsLeft(60000, 99999), 0);
  [null, undefined, "60000", NaN, Infinity, {}].forEach((d) =>
    assert.equal(Core.secondsLeft(d, 0), 0, `deadline ${JSON.stringify(d)}`));
});
