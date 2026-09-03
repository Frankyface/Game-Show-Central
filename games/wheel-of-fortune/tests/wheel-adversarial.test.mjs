/* ============================================================
   Wheel of Fortune — ADVERSARIAL unit tests (independent tester)
   Written against docs/04-wheel-of-fortune-spec.md §1 (normative
   rules) and §8 (W-U1 … W-U10). These do NOT duplicate
   wheel-core.test.mjs; they attack the edges that suite leaves
   open: layout fuzz, rules corners, validator fuzz, phone-payload
   fuzz, deep-frozen immutability and undo across phase changes.
   Zero deps: node:test + node:assert. Run from
   games/wheel-of-fortune:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import WC from "../js/wheel-core.js";
import DEFAULT_PUZZLES from "../js/data.js";

/* ---- helpers ------------------------------------------------ */

const clone = (v) => JSON.parse(JSON.stringify(v));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

const PLAYERS = [
  { pid: "p1", name: "Ana" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cid" },
];

/** 12 wedges: 0 = $500, 1 = BANKRUPT, 2 = LOSE A TURN, 6 = $900. */
const WEDGES = [500, "BANKRUPT", "LOSE A TURN", 600, 700, 800, 900, 650, 550, 500, 700, 600];

function regularGame(puzzle, settings = {}) {
  return {
    title: "Adversarial",
    settings: { vowelCost: 250, roundMinimum: 1000, wedges: WEDGES.slice(), ...settings },
    rounds: [{ type: "regular", category: "Place", puzzle }],
  };
}

const started = (game, players = PLAYERS) =>
  WC.reduce(WC.createState(game, players), { type: "start" }, () => 0.5);

/** Force the wheel onto wedge `index`. */
const spinTo = (state, index) =>
  WC.reduce(state, { type: "spin" }, () => (index + 0.5) / state.round.wedges.length);

/** Render a layout row as a string ("." = empty tile). */
const rowText = (row) => row.map((c) => (c ? c.ch : ".")).join("");

/** The words actually printed on the board, in order. */
function boardWords(rows) {
  return rows
    .map((row) => row.map((c) => (c ? c.ch : " ")).join("").trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

const accepts = (data) => {
  try { WC.validateGame(data); return true; } catch { return false; }
};

const rejection = (data) => {
  try { WC.validateGame(data); return null; } catch (err) { return err.message; }
};

/* ============================================================
   A1 — layoutPuzzle fuzz (W-U2)
   ============================================================ */

test("A1 layoutPuzzle: a 14-letter word fits, a 15-letter word never can", () => {
  const ok = WC.layoutPuzzle("ABCDEFGHIJKLMN");
  assert.notEqual(ok, null, "14 letters fits a 14-wide row");
  assert.deepEqual(ok.map((r) => r.length), WC.ROW_CAPS);
  const placed = ok.filter((r) => r.some(Boolean));
  assert.equal(placed.length, 1, "one word, one row");
  assert.equal(rowText(placed[0]), "ABCDEFGHIJKLMN", "the word is whole and fills the row");
  // Rows 0 and 3 are 12 wide, so a 14-letter word can only live on row 1 or 2.
  const rowIndex = ok.findIndex((r) => r.some(Boolean));
  assert.ok(rowIndex === 1 || rowIndex === 2, `14-letter word on a 12-wide row (${rowIndex})`);

  assert.equal(WC.layoutPuzzle("ABCDEFGHIJKLMNO"), null, "15 letters exceeds every row");
  assert.equal(WC.layoutPuzzle("HI ABCDEFGHIJKLMNO"), null, "…even beside a short word");
});

test("A1 layoutPuzzle: a 52-tile puzzle that exactly fills 12/14/14/12 fits", () => {
  const exact = "ABCDEFGHIJKL ABCDEFGHIJKLMN ABCDEFGHIJKLMN ABCDEFGHIJKL"; // 12+14+14+12
  const rows = WC.layoutPuzzle(exact);
  assert.notEqual(rows, null, "the board holds exactly 52 tiles");
  assert.deepEqual(rows.map((r) => r.filter(Boolean).length), [12, 14, 14, 12]);
  assert.deepEqual(rows.map(rowText), [
    "ABCDEFGHIJKL", "ABCDEFGHIJKLMN", "ABCDEFGHIJKLMN", "ABCDEFGHIJKL",
  ]);
  assert.ok(accepts({ rounds: [{ category: "Thing", puzzle: exact }] }), "and validateGame takes it");
  // One tile more anywhere and it must fail.
  const over = "ABCDEFGHIJKLM ABCDEFGHIJKLMN ABCDEFGHIJKLMN ABCDEFGHIJKL";
  assert.equal(WC.layoutPuzzle(over), null, "53 tiles cannot fit");
  assert.match(rejection({ rounds: [{ category: "Thing", puzzle: over }] }) || "",
    /does not fit the board/);
});

test("A1 layoutPuzzle: punctuation-only tokens own tiles and never vanish", () => {
  const rows = WC.layoutPuzzle("ROCK & ROLL");
  assert.deepEqual(boardWords(rows), ["ROCK", "&", "ROLL"], "the ampersand is its own tile");
  const dash = WC.layoutPuzzle("HELLO - WORLD");
  assert.deepEqual(boardWords(dash), ["HELLO", "-", "WORLD"]);
  // Every character of the normalised text (minus separators) is on the board.
  const text = "WAIT... WHAT?!";
  const cells = WC.layoutPuzzle(text).flat().filter(Boolean);
  assert.equal(cells.map((c) => c.ch).join(""), text.replace(/ /g, ""));
  for (const cell of cells) assert.equal(text[cell.i], cell.ch, "cell.i indexes the puzzle text");
  // A puzzle with no letters at all lays out but the validator refuses it.
  assert.notEqual(WC.layoutPuzzle("..."), null);
  assert.match(rejection({ rounds: [{ category: "C", puzzle: "..." }] }) || "",
    /needs at least one letter/);
});

test("A1 layoutPuzzle: double spaces collapse and apostrophes stay inside words", () => {
  const collapsed = WC.layoutPuzzle("HELLO   WORLD");
  assert.deepEqual(collapsed, WC.layoutPuzzle("HELLO WORLD"), "runs of spaces collapse to one");
  assert.deepEqual(boardWords(collapsed), ["HELLO", "WORLD"]);
  assert.deepEqual(WC.layoutPuzzle("  \t HI THERE \n "), WC.layoutPuzzle("HI THERE"),
    "leading/trailing whitespace is trimmed");

  const rows = WC.layoutPuzzle("IT'S A DOG'S LIFE");
  assert.deepEqual(boardWords(rows), ["IT'S", "A", "DOG'S", "LIFE"],
    "an apostrophe never splits its word");
  const apostrophes = rows.flat().filter((c) => c && c.ch === "'");
  assert.equal(apostrophes.length, 2, "both apostrophes own a tile");
  // Determinism: the same input always produces the identical structure.
  assert.deepEqual(WC.layoutPuzzle("IT'S A DOG'S LIFE"), rows);
});

test("A1 layoutPuzzle: every row is centred and no word is ever split", () => {
  const samples = [
    "GAME SHOW CENTRAL", "A", "HOT CHOCOLATE WITH MARSHMALLOWS",
    "THE WINNER'S CIRCLE", "ROCK & ROLL", "WAIT... WHAT?!",
    "ABCDEFGHIJKL ABCDEFGHIJKLMN ABCDEFGHIJKLMN ABCDEFGHIJKL",
    "A PENNY FOR YOUR THOUGHTS", "HOME SWEET HOME", "READY, SET, GO!",
  ];
  for (const puzzle of samples) {
    const rows = WC.layoutPuzzle(puzzle);
    assert.notEqual(rows, null, puzzle);
    assert.deepEqual(rows.map((r) => r.length), WC.ROW_CAPS, puzzle);
    // centred: left and right padding differ by at most 1
    for (const row of rows) {
      const first = row.findIndex(Boolean);
      if (first < 0) continue;
      let last = row.length - 1;
      while (!row[last]) last -= 1;
      assert.ok(Math.abs(first - (row.length - 1 - last)) <= 1, `not centred: ${puzzle}`);
      // no gaps inside a placed run other than the single-tile word gaps
      for (let i = first; i <= last; i += 1) {
        if (row[i]) continue;
        assert.ok(row[i - 1] && row[i + 1], `stray gap in "${puzzle}"`);
      }
    }
    assert.deepEqual(boardWords(rows), puzzle.split(" "), `word split in "${puzzle}"`);
  }
});

test("A1 layoutPuzzle is GREEDY: a short puzzle can still be refused (documented)", () => {
  // Characterisation, not an endorsement. Spec §3 says the packer is greedy,
  // so it never backtracks: this 39-letter / 48-tile puzzle would fit the 52
  // tiles under an optimal break, but greedy line-filling runs out of rows.
  // Content authors hit "does not fit" on puzzles that look short enough.
  // See docs/reports/wheel-of-fortune-verification.md (minor defect W-D4).
  const puzzle = "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN";
  assert.ok(puzzle.replace(/ /g, "").length < 52, "well under the 52 tiles the board has");
  assert.equal(WC.layoutPuzzle(puzzle), null, "greedy packing gives up");
  assert.match(rejection({ rounds: [{ category: "C", puzzle }] }) || "",
    /does not fit the board/, "and the validator says so in plain English");
  // Re-ordering the same words so greedy succeeds proves the packer, not the size.
  assert.notEqual(WC.layoutPuzzle("ONE TWO THREE FOUR FIVE SIX SEVEN NINE TEN"), null);
});

/* ============================================================
   A2 — rules edge cases (W-U3 … W-U8)
   ============================================================ */

test("A2 buying a vowel with exactly the cost leaves the player on $0", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  s = spinTo(s, 0); // $500
  s = WC.reduce(s, { type: "callLetter", letter: "T" }); // 1 T -> exactly $500
  assert.equal(s.players[0].round, 500);
  s = WC.reduce(s, { type: "buyVowel", }, () => 0);
  // vowelCost 250 leaves 250; now spend it down to exactly zero.
  s = WC.reduce(s, { type: "callLetter", letter: "E" });
  assert.equal(s.players[0].round, 250, "a vowel never pays");
  assert.equal(WC.legalActions(s).buyVowel, true, "exactly the cost is enough");
  s = WC.reduce(s, { type: "buyVowel" });
  assert.equal(s.players[0].round, 0, "spending the last $250 is allowed");
  assert.equal(s.pendingVowel, true);
  s = WC.reduce(s, { type: "callLetter", letter: "O" });
  assert.equal(s.players[0].round, 0, "and never goes negative");
  assert.equal(WC.legalActions(s).buyVowel, false, "$0 cannot buy another");
  assert.equal(WC.reduce(s, { type: "buyVowel" }), s, "the event itself is refused");
});

test("A2 BANKRUPT on a $0 round total still passes the turn and spares the bank", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, total: 7500 } : p)) };
  assert.equal(s.players[0].round, 0);
  const before = clone(s.players);
  s = spinTo(s, 1); // BANKRUPT
  assert.equal(s.wedge.value, WC.BANKRUPT);
  assert.equal(s.players[0].round, 0, "0 stays 0, never negative");
  assert.equal(s.players[0].total, 7500, "banked money is safe");
  assert.deepEqual(s.players.slice(1), before.slice(1), "nobody else is touched");
  assert.equal(s.turn, 1, "turn passes");
  assert.equal(s.pendingSpin, false, "no consonant is owed after BANKRUPT");
  assert.equal(WC.legalActions(s).letters.length, 0);
});

test("A2 a used letter is never offered and re-calling it changes nothing", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "R" });
  assert.ok(s.used.includes("R"));
  const turnAfter = s.turn;
  s = spinTo(s, 0);
  assert.ok(!WC.legalActions(s).letters.includes("R"), "R is off the keyboard");
  const again = WC.reduce(s, { type: "callLetter", letter: "R" });
  assert.equal(again, s, "the reducer returns the SAME object");
  assert.equal(s.turn, turnAfter, "…so the turn cannot be lost to a double-tap");
  // lower case / padded forms of a used letter are equally refused
  assert.equal(WC.reduce(s, { type: "callLetter", letter: " r " }), s);
  assert.equal(WC.reduce(s, { type: "callLetter", letter: "r" }), s);
});

test("A2 a vowel after a spin is illegal in every casing, and free vowels do not exist", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  s = spinTo(s, 6); // $900
  const actions = WC.legalActions(s);
  assert.ok(!actions.letters.some(WC.isVowel), "no vowel is offered after a spin");
  for (const letter of ["A", "a", " E ", "I", "o", "U"]) {
    assert.equal(WC.reduce(s, { type: "callLetter", letter }), s, `vowel ${letter} must be refused`);
  }
  assert.equal(s.players[0].round, 0, "no money moved");
  // The only way to a vowel is buying one, and that requires the money first.
  assert.equal(WC.legalActions(s).buyVowel, false, "cannot buy mid-spin");
});

test("A2 a full board still demands a solve, and only the solve is legal", () => {
  let s = started(regularGame("AT"));
  s = spinTo(s, 0);
  s = WC.reduce(s, { type: "callLetter", letter: "T" });
  s = WC.reduce(s, { type: "buyVowel" });
  s = WC.reduce(s, { type: "callLetter", letter: "A" });
  assert.ok(WC.allRevealed(s.round.puzzle, s.revealed), "every tile is up");
  assert.equal(s.roundDone, false, "the round is not over on its own");
  assert.deepEqual(WC.legalActions(s), { spin: false, buyVowel: false, solve: true, letters: [] });
  assert.equal(WC.reduce(s, { type: "spin" }, () => 0.5), s, "spin refused on a full board");
  assert.equal(WC.reduce(s, { type: "nextRound" }).phase, "final",
    "the host CAN still escape with Next round");
  // The proper close: attempt + judge.
  const solved = WC.reduce(WC.reduce(s, { type: "solveAttempt", text: "AT" }),
    { type: "solveJudged", correct: true });
  assert.equal(solved.roundDone, true);
});

test("A2 only vowels left: spin is dead, and buying an ABSENT vowel passes the turn", () => {
  let s = started(regularGame("A CAT"));
  s = spinTo(s, 6); // $900
  s = WC.reduce(s, { type: "callLetter", letter: "C" });
  s = spinTo(s, 6);
  s = WC.reduce(s, { type: "callLetter", letter: "T" });
  assert.equal(WC.onlyVowelsLeft(s.round.puzzle, s.revealed), true);
  assert.equal(WC.legalActions(s).spin, false, "spin is disabled (spec §1)");
  assert.equal(WC.reduce(s, { type: "spin" }, () => 0.1), s, "and the event is ignored");
  const bank = s.players[0].round;
  s = WC.reduce(s, { type: "buyVowel" });
  assert.equal(s.players[0].round, bank - 250, "the vowel is paid for up front");
  const miss = WC.reduce(s, { type: "callLetter", letter: "E" }); // no E in "A CAT"
  assert.equal(miss.turn, 1, "a missed vowel passes the turn (spec §1)");
  assert.equal(miss.players[0].round, bank - 250, "and the money is NOT refunded");
  assert.match(miss.banner, /No E/);
  assert.equal(WC.legalActions(miss).spin, false, "still only vowels for the next player too");
  assert.equal(WC.onlyVowelsLeft(miss.round.puzzle, miss.revealed), true);
  // The absent vowel is burned, so it is never offered again.
  const bought = WC.reduce({ ...miss, players: miss.players.map((p, i) =>
    (i === 1 ? { ...p, round: 1000 } : p)) }, { type: "buyVowel" });
  assert.ok(!WC.legalActions(bought).letters.includes("E"));
});

test("A2 toss-up: when every player is locked out the round closes with no points", () => {
  const game = { settings: { tossUpValues: [1000] },
    rounds: [{ type: "tossup", category: "Phrase", puzzle: "EASY DOES IT" }] };
  let s = WC.reduce(started(game), { type: "tossupStart" }, () => 0.4);
  for (const pid of ["p1", "p2", "p3"]) {
    s = WC.reduce(s, { type: "tossupRevealNext" });
    s = WC.reduce(s, { type: "tossupBuzz", pid });
    assert.equal(s.tossup.buzzed, pid, `${pid} may buzz`);
    s = WC.reduce(s, { type: "tossupJudged", correct: false });
    assert.ok(s.tossup.locked.includes(pid));
  }
  assert.deepEqual(s.tossup.locked, ["p1", "p2", "p3"]);
  assert.equal(s.tossup.running, false, "reveals stop once nobody can answer");
  assert.equal(s.tossup.done, true);
  assert.equal(s.roundDone, true);
  assert.deepEqual(s.players.map((p) => p.total), [0, 0, 0], "no points awarded");
  // Nothing can restart it, and no phone is armed.
  assert.equal(WC.reduce(s, { type: "tossupStart" }, () => 0.4), s);
  assert.equal(WC.reduce(s, { type: "tossupRevealNext" }), s);
  assert.equal(WC.reduce(s, { type: "tossupBuzz", pid: "p1" }), s);
  for (const pid of ["p1", "p2", "p3"]) {
    assert.equal(WC.phoneView(s, pid).armed, false, `${pid} buzzer is dead`);
  }
  assert.equal(WC.reduce(s, { type: "nextRound" }).phase, "final");
});

test("A2 bonus: a tie for the lead goes to the first player in turn order", () => {
  const game = { settings: { bonusPrize: "$25,000" }, rounds: [
    { type: "regular", category: "A", puzzle: "ONE TWO" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };
  const enter = (totals) => {
    let s = started(game);
    s = { ...s, players: s.players.map((p, i) => ({ ...p, total: totals[i] })) };
    return WC.reduce(s, { type: "nextRound" });
  };
  assert.equal(enter([4000, 4000, 4000]).bonus.leaderPid, "p1", "3-way tie -> first");
  assert.equal(enter([0, 0, 0]).bonus.leaderPid, "p1", "all-zero tie -> first");
  assert.equal(enter([4000, 4000, 100]).bonus.leaderPid, "p1", "tie at the top -> first");
  assert.equal(enter([100, 4000, 4000]).bonus.leaderPid, "p2", "first of the tied leaders");
  const tied = enter([4000, 4000, 4000]);
  assert.equal(tied.turn, 0);
  assert.equal(WC.phoneView(tied, "p1").screen, "bonus");
  assert.equal(WC.phoneView(tied, "p2").screen, "wait", "the other tied player does not play");
  // The host can break the tie by hand (spec §8 W-U8).
  const fixed = WC.reduce(tied, { type: "setTotal", pid: "p3", total: 4001 });
  assert.equal(fixed.bonus.leaderPid, "p3");
  assert.deepEqual(fixed.used, WC.BONUS_FREE, "RSTLNE are still the freebies");
});

test("A2 bonus picks: used letters, duplicates and shape violations are all refused", () => {
  const game = { settings: {}, rounds: [
    { type: "regular", category: "A", puzzle: "ONE TWO" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };
  let s = WC.reduce({ ...started(game),
    players: PLAYERS.map((p, i) => ({ ...p, round: 0, total: i === 0 ? 9 : 0 })) },
  { type: "nextRound" });
  assert.deepEqual(s.used, WC.BONUS_FREE);
  const refused = [
    ["R already free", ["R", "C", "D", "O"]],
    ["S already free", ["C", "S", "D", "O"]],
    ["E already free as the vowel", ["C", "D", "M", "E"]],
    ["duplicate consonant", ["C", "C", "D", "O"]],
    ["duplicate vowel-ish", ["C", "D", "O", "O"]],
    ["vowel among the consonants", ["C", "A", "D", "O"]],
    ["4th is a consonant", ["C", "D", "M", "P"]],
    ["only three", ["C", "D", "O"]],
    ["five", ["C", "D", "M", "B", "O"]],
    ["a digit", ["C", "D", "M", "4"]],
    ["a string not an array", "CDMO"],
    ["nested", [["C"], "D", "M", "O"]],
    ["empty", []],
    ["nulls", [null, null, null, null]],
  ];
  for (const [label, letters] of refused) {
    assert.equal(WC.validateBonusPicks(letters, s.used), null, `validateBonusPicks: ${label}`);
    assert.equal(WC.reduce(s, { type: "bonusPick", letters }), s, `reduce: ${label}`);
  }
  const good = WC.reduce(s, { type: "bonusPick", letters: ["c", " d ", "M", "o"] });
  assert.deepEqual(good.bonus.picks, ["C", "D", "M", "O"], "casing and padding are normalised");
  assert.deepEqual(good.used, [...WC.BONUS_FREE, "C", "D", "M", "O"]);
  // A second pick, even a legal one, is refused.
  assert.equal(WC.reduce(good, { type: "bonusPick", letters: ["B", "F", "G", "A"] }), good);
});

test("A2 roundMinimum is applied on every winning path and is configurable", () => {
  const solve = (roundMinimum, wedgeIndex) => {
    let s = started(regularGame("THE CORNER COFFEE SHOP", { roundMinimum }));
    s = spinTo(s, wedgeIndex);
    s = WC.reduce(s, { type: "callLetter", letter: "T" }); // exactly one T
    s = WC.reduce(s, { type: "solveAttempt", text: "x" });
    return WC.reduce(s, { type: "solveJudged", correct: true });
  };
  assert.equal(solve(1000, 0).players[0].total, 1000, "$500 is topped up to the $1,000 minimum");
  assert.equal(solve(1000, 6).players[0].total, 1000, "$900 is topped up too");
  assert.equal(solve(300, 6).players[0].total, 900, "a bigger pot banks in full");
  assert.equal(solve(5000, 0).players[0].total, 5000, "a custom minimum is honoured");
  // Winning with a $0 pot still pays the minimum.
  let zero = started(regularGame("THE CORNER COFFEE SHOP", { roundMinimum: 1000 }));
  zero = WC.reduce(zero, { type: "solveAttempt", text: "x" });
  zero = WC.reduce(zero, { type: "solveJudged", correct: true });
  assert.equal(zero.players[0].total, 1000, "a cold solve still banks the minimum");
  assert.deepEqual(zero.players.map((p) => p.round), [0, 0, 0], "everyone's pot resets");
  // A losing player keeps their bank but loses their pot.
  assert.deepEqual(zero.players.map((p) => p.total), [1000, 0, 0]);
});

/* ============================================================
   A3 — validator fuzz (W-U1)
   ============================================================ */

test("A3 validateGame: lowercase puzzles are accepted and normalised, digits never are", () => {
  const lower = { rounds: [{ category: "Thing", puzzle: "a penny for your thoughts" }] };
  assert.ok(accepts(lower), "a lowercase puzzle is legal input");
  const norm = WC.normalizeGame(clone(lower));
  assert.equal(norm.rounds[0].puzzle, "A PENNY FOR YOUR THOUGHTS", "…and comes back uppercase");
  assert.ok(accepts(norm), "the normalised form re-validates (reload-resume)");
  // mixed case with punctuation and messy spacing
  const messy = { rounds: [{ category: " Phrase ", puzzle: "  it's   a Dog's   life!  " }] };
  assert.ok(accepts(messy));
  assert.equal(WC.normalizeGame(clone(messy)).rounds[0].puzzle, "IT'S A DOG'S LIFE!");
  assert.equal(WC.normalizeGame(clone(messy)).rounds[0].category, "Phrase", "category is trimmed");
  for (const bad of ["level 42", "1 2 3", "ROOM 101", "50% OFF", "A+B", "CAFÉ", "你好"]) {
    assert.match(rejection({ rounds: [{ category: "C", puzzle: bad }] }) || "",
      /only use letters|needs at least one letter/, `must reject "${bad}"`);
  }
});

test("A3 validateGame: wedge lists are policed for type, size and content", () => {
  const withWedges = (wedges) => ({ settings: { wedges }, rounds: [{ category: "C", puzzle: "HI" }] });
  const dollars = (n) => new Array(n).fill(500);
  // Any string other than the two allowed sentinels is rejected.
  for (const junk of ["FREE PLAY", "WILD CARD", "MYSTERY", "bankrupt", "Lose A Turn",
    "LOSE  A  TURN", "BANKRUPT ", "$500", "500"]) {
    const list = dollars(11).concat([junk]);
    assert.match(rejection(withWedges(list)) || "",
      /must be a positive whole number, "BANKRUPT" or "LOSE A TURN"/, `wedge "${junk}"`);
  }
  assert.ok(accepts(withWedges(dollars(11).concat([WC.BANKRUPT]))), "exact BANKRUPT is fine");
  assert.ok(accepts(withWedges(dollars(11).concat([WC.LOSE_TURN]))), "exact LOSE A TURN is fine");
  // Sizes: 12 and 32 are in, 11 and 33 are out.
  assert.ok(accepts(withWedges(dollars(12))), "12 wedges is the floor");
  assert.ok(accepts(withWedges(dollars(32))), "32 wedges is the ceiling");
  assert.match(rejection(withWedges(dollars(33))) || "", /between 12 and 32 wedges \(found 33\)/);
  assert.match(rejection(withWedges(dollars(11))) || "", /between 12 and 32 wedges \(found 11\)/);
  assert.match(rejection(withWedges(dollars(40))) || "", /between 12 and 32 wedges \(found 40\)/);
  // Non-array and structurally odd wedge lists.
  for (const junk of ["BANKRUPT", 24, null, {}, { length: 24 }]) {
    assert.notEqual(rejection(withWedges(junk)), null, `wedges: ${JSON.stringify(junk)}`);
  }
  // Numeric content rules.
  assert.match(rejection(withWedges(dollars(11).concat([0]))) || "", /positive whole number/);
  assert.match(rejection(withWedges(dollars(11).concat([-100]))) || "", /positive whole number/);
  assert.match(rejection(withWedges(dollars(11).concat([500.5]))) || "", /positive whole number/);
  assert.match(rejection(withWedges(dollars(11).concat([NaN]))) || "", /positive whole number/);
  assert.match(rejection(withWedges(dollars(11).concat([Infinity]))) || "", /positive whole number/);
  assert.match(rejection(withWedges(dollars(11).concat([555]))) || "", /multiple of 50/);
  assert.match(rejection(withWedges(new Array(12).fill(WC.BANKRUPT))) || "",
    /at least one dollar wedge/);
  // Per-round overrides obey the same rules and name the round.
  assert.match(rejection({ rounds: [{ category: "C", puzzle: "HI", wedges: dollars(33) }] }) || "",
    /Round 1: "wedges" needs between 12 and 32/);
  assert.ok(accepts({ rounds: [{ category: "C", puzzle: "HI", wedges: dollars(12) }] }));
});

test("A3 validateGame: rounds, types and settings are policed", () => {
  const round = (over) => ({ rounds: [{ category: "C", puzzle: "HI", ...over }] });
  assert.match(rejection(round({ type: "TOSSUP" })) || "", /"type" must be/);
  assert.match(rejection(round({ type: "final" })) || "", /"type" must be/);
  assert.match(rejection(round({ type: null })) || "", /"type" must be/);
  assert.ok(accepts(round({})), "type defaults to regular");
  assert.match(rejection({ rounds: [{ type: "bonus", category: "C", puzzle: "HI" },
    { type: "bonus", category: "C", puzzle: "HO" }] }) || "",
  /bonus round must be the last round|Only one bonus/);
  assert.match(rejection({ rounds: [
    { type: "bonus", category: "C", puzzle: "HI" },
    { category: "C", puzzle: "HO" },
    { type: "bonus", category: "C", puzzle: "HE" }] }) || "", /Only one bonus|must be the last/);
  assert.match(rejection({ rounds: new Array(21).fill({ category: "C", puzzle: "HI" }) }) || "",
    /Too many rounds/);
  assert.ok(accepts({ rounds: new Array(20).fill({ category: "C", puzzle: "HI" }) }));
  // settings
  const set = (settings) => ({ settings, rounds: [{ category: "C", puzzle: "HI" }] });
  assert.match(rejection(set([])) || "", /"settings" must be an object/);
  assert.match(rejection(set({ vowelCost: -1 })) || "", /vowelCost/);
  assert.match(rejection(set({ vowelCost: 250.5 })) || "", /vowelCost/);
  assert.match(rejection(set({ roundMinimum: "1000" })) || "", /roundMinimum/);
  assert.match(rejection(set({ bonusSeconds: -1 })) || "", /bonusSeconds/);
  assert.match(rejection(set({ bonusSeconds: 61 })) || "", /bonusSeconds/);
  assert.ok(accepts(set({ bonusSeconds: 0 })), "0 = no timer is legal");
  assert.ok(accepts(set({ bonusSeconds: 60 })));
  assert.match(rejection(set({ bonusPrize: 25000 })) || "", /bonusPrize/);
  assert.match(rejection(set({ tossUpValues: [] })) || "", /tossUpValues/);
  assert.match(rejection(set({ tossUpValues: [1000, "2000"] })) || "", /tossUpValues/);
  assert.match(rejection(set({ tossUpValues: 1000 })) || "", /tossUpValues/);
  // top level
  assert.match(rejection({ title: 7, rounds: [{ category: "C", puzzle: "HI" }] }) || "", /"title"/);
  for (const junk of [null, undefined, [], "x", 7, true]) {
    assert.notEqual(rejection(junk), null, `top level ${JSON.stringify(junk)}`);
  }
  assert.match(rejection({ rounds: [null] }) || "", /Round 1 must be an object/);
  assert.match(rejection({ rounds: [[]] }) || "", /Round 1 must be an object/);
  assert.match(rejection({ rounds: [{ category: "C" }] }) || "", /"puzzle" is required/);
  assert.match(rejection({ rounds: [{ puzzle: "HI" }] }) || "", /"category" is required/);
});

test("A3 the shipped puzzles.json and js/data.js agree and both validate", async () => {
  const raw = await import("node:fs/promises")
    .then((fs) => fs.readFile(new URL("../puzzles.json", import.meta.url), "utf8"));
  const json = JSON.parse(raw);
  assert.ok(accepts(json), "puzzles.json validates");
  assert.deepEqual(WC.normalizeGame(clone(json)), WC.normalizeGame(clone(DEFAULT_PUZZLES)),
    "js/data.js must mirror puzzles.json (architecture §9.7)");
  const g = WC.normalizeGame(clone(json));
  assert.equal(g.rounds.length, 10);
  for (const round of g.rounds) {
    assert.notEqual(WC.layoutPuzzle(round.puzzle), null, `${round.puzzle} must fit`);
    assert.ok(round.category.length <= WC.CATEGORY_MAX);
  }
});

/* ============================================================
   A4 — phone message fuzz (W-U10) + host authority
   ============================================================ */

test("A4 validatePhoneMsg: an 81-character solve is capped at 80", () => {
  const long = "Y".repeat(81);
  const out = WC.validatePhoneMsg({ t: "solve", text: long });
  assert.equal(out.text.length, 80, "exactly the documented cap");
  assert.equal(WC.SOLVE_TEXT_MAX, 80);
  assert.equal(WC.validatePhoneMsg({ t: "solve", text: "Y".repeat(80) }).text.length, 80);
  assert.equal(WC.validatePhoneMsg({ t: "solve", text: "Y".repeat(10000) }).text.length, 80);
  // The cap survives into the state and the banner the host renders.
  const s = WC.reduce(started(regularGame("ONE TWO")),
    { type: "solveAttempt", text: "Y".repeat(10000) });
  assert.equal(s.solveText.length, 80);
  assert.ok(s.banner.length < 200, "the banner cannot be blown up by a phone");
  // Control characters and markup are inert text, never stripped into something new.
  const nasty = WC.validatePhoneMsg({ t: "solve", text: "<img src=x onerror=alert(1)>" });
  assert.equal(nasty.text, "<img src=x onerror=alert(1)>", "kept verbatim as TEXT (rendered by textContent)");
  assert.equal(WC.validatePhoneMsg({ t: "solve", text: " " }), null,
    "control-only text sanitises to empty and is refused");
});

test("A4 validatePhoneMsg: non-ASCII letters such as 'ß' are refused", () => {
  for (const letter of ["ß", "é", "А", "Ａ", "İ", "Å", "Ⅰ", " ", "", "AB", "1", "?"]) {
    assert.equal(WC.validatePhoneMsg({ t: "letter", letter }), null,
      `letter ${JSON.stringify(letter)} must be refused`);
  }
  // "ß".toUpperCase() is "SS" — it must not sneak in as a two-character letter.
  assert.equal("ß".toUpperCase(), "SS");
  assert.equal(WC.validatePhoneMsg({ t: "letter", letter: "ß" }), null);
  // bonus-pick is policed the same way.
  assert.equal(WC.validatePhoneMsg({ t: "bonus-pick", letters: ["ß", "C", "D", "O"] }), null);
  assert.equal(WC.validatePhoneMsg({ t: "bonus-pick", letters: ["C", "D", "M", null] }), null);
  assert.equal(WC.validatePhoneMsg({ t: "bonus-pick", letters: { 0: "C", length: 4 } }), null);
  // Every accepted payload is a fresh, minimal object — extra keys never survive.
  const extra = WC.validatePhoneMsg({ t: "spin", pid: "p9", cheat: true, __proto__: { x: 1 } });
  assert.deepEqual(Object.keys(extra), ["t"], "no attacker-controlled keys reach the reducer");
  assert.deepEqual(Object.keys(WC.validatePhoneMsg({ t: "letter", letter: "c", value: 99999 })),
    ["t", "letter"]);
  assert.equal(WC.validatePhoneMsg({ t: "letter", letter: "c" }).letter, "C");
  // Unknown / spoofed message types.
  for (const junk of [{ t: "setTotal", pid: "p1", total: 1e9 }, { t: "solveJudged", correct: true },
    { t: "undo" }, { t: "start" }, { t: "revealAll" }, { t: "view" }, { t: 1 }, { t: null }]) {
    assert.equal(WC.validatePhoneMsg(junk), null, `spoofed ${JSON.stringify(junk)}`);
  }
});

test("A4 a phone acting under the wrong pid cannot move the game", () => {
  // wheel-room.js gates on "is this the player on turn"; the core must agree.
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  assert.equal(s.turn, 0);
  const onTurn = (state, pid) => {
    const p = state.players[state.turn];
    return !!p && p.pid === pid && !state.roundDone;
  };
  assert.equal(onTurn(s, "p1"), true);
  for (const pid of ["p2", "p3", "p1 ", "P1", "", null, undefined, "__proto__"]) {
    assert.equal(onTurn(s, pid), false, `${JSON.stringify(pid)} is not on turn`);
  }
  // Only the active player's screen carries actions; everyone else gets nothing.
  s = spinTo(s, 0);
  assert.ok(WC.phoneView(s, "p1").actions.letters.length > 0);
  for (const pid of ["p2", "p3", "ghost"]) {
    const v = WC.phoneView(s, pid);
    assert.equal(v.screen, "wait");
    assert.deepEqual(v.actions, { spin: false, buyVowel: false, solve: false, letters: [] });
    assert.equal(v.wedge, null);
    assert.ok(!JSON.stringify(v).includes("COFFEE"), "the answer never leaves the host");
  }
  // A buzz from an unknown pid is a no-op even in a toss-up.
  const tg = { settings: {}, rounds: [{ type: "tossup", category: "P", puzzle: "EASY DOES IT" }] };
  const t = WC.reduce(started(tg), { type: "tossupStart" }, () => 0.3);
  assert.equal(WC.reduce(t, { type: "tossupBuzz", pid: "ghost" }), t);
  assert.equal(WC.reduce(t, { type: "tossupBuzz", pid: undefined }), t);
  // A bonus-pick from a non-leader is refused by the core's turn/leader checks.
  const bg = { settings: {}, rounds: [{ type: "regular", category: "A", puzzle: "ONE TWO" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };
  let b = started(bg);
  b = { ...b, players: b.players.map((p, i) => ({ ...p, total: i === 1 ? 9000 : 0 })) };
  b = WC.reduce(b, { type: "nextRound" });
  assert.equal(b.bonus.leaderPid, "p2");
  assert.equal(WC.phoneView(b, "p1").screen, "wait", "a non-leader never sees the bonus keypad");
  assert.equal(WC.phoneView(b, "p3").screen, "wait");
  assert.equal(WC.phoneView(b, "p2").screen, "bonus");
});

/* ============================================================
   A5 — immutability with deep-frozen state, and undo across phases
   ============================================================ */

test("A5 the reducer survives a DEEP-FROZEN state on every event, in every phase", () => {
  const events = [
    { type: "start" }, { type: "spin" }, { type: "callLetter", letter: "R" },
    { type: "callLetter", letter: "A" }, { type: "buyVowel" },
    { type: "solveAttempt", text: "guess" }, { type: "solveJudged", correct: true },
    { type: "solveJudged", correct: false }, { type: "nextPlayer" },
    { type: "tossupStart" }, { type: "tossupRevealNext" }, { type: "tossupBuzz", pid: "p2" },
    { type: "tossupJudged", correct: true }, { type: "tossupJudged", correct: false },
    { type: "bonusPick", letters: ["C", "D", "M", "O"] }, { type: "bonusJudged", correct: true },
    { type: "nextRound" }, { type: "revealAll" }, { type: "undo" },
    { type: "setTotal", pid: "p1", total: 4242 }, { type: "finish" },
    { type: "nope" }, {}, null, undefined, 42, "spin", [],
  ];
  const game = { settings: { tossUpValues: [1000, 2000] }, rounds: [
    { type: "tossup", category: "P", puzzle: "EASY DOES IT" },
    { type: "regular", category: "A", puzzle: "THE CORNER COFFEE SHOP" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };

  // Build one representative state per phase, including states that carry history.
  const idle = WC.createState(game, PLAYERS);
  const toss = WC.reduce(WC.reduce(idle, { type: "start" }, () => 0.5),
    { type: "tossupStart" }, () => 0.5);
  const buzzed = WC.reduce(toss, { type: "tossupBuzz", pid: "p2" });
  let round = WC.reduce(WC.reduce(buzzed, { type: "tossupJudged", correct: true }),
    { type: "nextRound" });
  round = WC.reduce(round, { type: "spin" }, () => 0.5);
  const called = WC.reduce(round, { type: "callLetter", letter: "R" });
  const solving = WC.reduce(called, { type: "solveAttempt", text: "guess" });
  const bonus = WC.reduce(WC.reduce(solving, { type: "solveJudged", correct: true }),
    { type: "nextRound" });
  const picked = WC.reduce(bonus, { type: "bonusPick", letters: ["C", "D", "M", "O"] });
  const final = WC.reduce(picked, { type: "finish" });

  const states = { idle, toss, buzzed, round, called, solving, bonus, picked, final };
  for (const [label, raw] of Object.entries(states)) {
    const frozen = deepFreeze(clone(raw));
    const before = JSON.stringify(frozen);
    for (const ev of events) {
      const event = ev && typeof ev === "object" ? deepFreeze(clone(ev)) : ev;
      assert.doesNotThrow(() => WC.reduce(frozen, event, () => 0.37),
        `${label} + ${JSON.stringify(ev)} threw on a frozen state`);
      assert.equal(JSON.stringify(frozen), before,
        `${label} was mutated by ${JSON.stringify(ev)}`);
      // Selectors must not mutate either.
      assert.doesNotThrow(() => {
        WC.boardView(frozen); WC.podiumView(frozen); WC.standingsView(frozen);
        WC.legalActions(frozen); WC.phoneView(frozen, "p1"); WC.phoneView(frozen, "zz");
      }, `${label} selectors threw`);
      assert.equal(JSON.stringify(frozen), before, `${label} mutated by a selector`);
    }
    // The frozen state's own arrays must never be handed out by reference.
    const next = WC.reduce(frozen, { type: "setTotal", pid: "p1", total: 1 }, () => 0.5);
    if (next !== frozen) {
      assert.notEqual(next.players, frozen.players, `${label}: players array reused`);
    }
  }
});

test("A5 undo walks back across phase changes exactly, one event at a time", () => {
  const game = { settings: { tossUpValues: [1000], roundMinimum: 1000, wedges: WEDGES.slice() },
    rounds: [
    { type: "tossup", category: "P", puzzle: "EASY DOES IT" },
    { type: "regular", category: "A", puzzle: "THE CORNER COFFEE SHOP" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };

  const bare = (s) => clone({ ...s, history: undefined });
  const trail = [];
  let s = WC.createState(game, PLAYERS);
  const step = (event, rng = () => 0.5) => {
    trail.push(bare(s));
    const next = WC.reduce(s, event, rng);
    assert.notEqual(next, s, `event should have applied: ${JSON.stringify(event)}`);
    s = next;
  };

  step({ type: "start" });                                   // idle  -> tossup
  step({ type: "tossupStart" });
  step({ type: "tossupRevealNext" });
  step({ type: "tossupBuzz", pid: "p2" });
  step({ type: "tossupJudged", correct: true });
  step({ type: "nextRound" });                               // tossup -> round
  step({ type: "spin" }, () => 0.05);
  step({ type: "callLetter", letter: "R" });
  step({ type: "solveAttempt", text: "the corner coffee shop" });
  step({ type: "solveJudged", correct: true });
  step({ type: "nextRound" });                               // round  -> bonus
  step({ type: "bonusPick", letters: ["C", "D", "M", "O"] });
  step({ type: "bonusJudged", correct: true });
  step({ type: "nextRound" });                               // bonus  -> final

  assert.equal(s.phase, "final");
  const phasesSeen = new Set(trail.map((t) => t.phase));
  assert.deepEqual([...phasesSeen].sort(), ["bonus", "idle", "round", "tossup"]);

  // Now undo all the way back; every step must land exactly on its snapshot.
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    const back = WC.reduce(s, { type: "undo" });
    assert.notEqual(back, s, `undo #${trail.length - i} did nothing`);
    assert.deepEqual(bare(back), trail[i],
      `undo did not restore step ${i} (${trail[i].phase} -> ${s.phase})`);
    s = back;
  }
  assert.equal(s.phase, "idle");
  assert.equal(s.history.length, 0);
  assert.equal(WC.reduce(s, { type: "undo" }), s, "undo past the start is a no-op");

  // Undo is not shadowed by the history cap for a normal-length game.
  assert.ok(trail.length < 60, "this walk is inside HISTORY_MAX");
});

test("A5 undo unwinds a solve and a revealAll without leaking state", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  s = spinTo(s, 6);
  s = WC.reduce(s, { type: "callLetter", letter: "R" }); // Ana $1,800
  const potted = clone({ ...s, history: undefined });

  // Reveal all is an escape hatch -- undo must put the hidden board back.
  const revealed = WC.reduce(s, { type: "revealAll" });
  assert.equal(revealed.roundDone, true);
  assert.deepEqual(clone({ ...WC.reduce(revealed, { type: "undo" }), history: undefined }), potted);

  // A judged solve is two events (attempt + judge) -- two undos, and the money
  // must come back off the bank.
  let solved = WC.reduce(s, { type: "solveAttempt", text: "THE CORNER COFFEE SHOP" });
  solved = WC.reduce(solved, { type: "solveJudged", correct: true });
  assert.equal(solved.players[0].total, 1800);
  const once = WC.reduce(solved, { type: "undo" });
  assert.equal(once.solving, true, "one undo lands on the un-judged attempt");
  assert.equal(once.players[0].total, 0, "the bank is rolled back immediately");
  assert.equal(once.players[0].round, 1800, "the pot is restored");
  const twice = WC.reduce(once, { type: "undo" });
  assert.deepEqual(clone({ ...twice, history: undefined }), potted, "two undos = exactly back");

  // Undo after entering a new round restores the finished board, not a blank one.
  const game = { settings: {}, rounds: [
    { type: "regular", category: "A", puzzle: "ONE TWO" },
    { type: "regular", category: "B", puzzle: "THREE FOUR" }] };
  let g = started(game);
  g = WC.reduce(g, { type: "solveAttempt", text: "ONE TWO" });
  g = WC.reduce(g, { type: "solveJudged", correct: true });
  const finished = clone({ ...g, history: undefined });
  const advanced = WC.reduce(g, { type: "nextRound" });
  assert.equal(advanced.roundIndex, 1);
  assert.deepEqual(clone({ ...WC.reduce(advanced, { type: "undo" }), history: undefined }), finished,
    "undoing Next round brings the solved board back");
});

test("A5 the history never grows without bound and never nests", () => {
  let s = started(regularGame("THE CORNER COFFEE SHOP"));
  for (let i = 0; i < 200; i += 1) {
    s = WC.reduce(s, { type: "nextPlayer" });
  }
  assert.ok(s.history.length <= 60, `history grew to ${s.history.length}`);
  for (const entry of s.history) {
    assert.equal(entry.history, undefined, "snapshots must not carry their own history");
  }
  // A long game still round-trips through JSON (localStorage) at a sane size.
  const json = JSON.stringify(s);
  assert.doesNotThrow(() => JSON.parse(json));
  assert.ok(json.length < 4 * 1024 * 1024, `state serialises to ${json.length} bytes`);
});

/* ============================================================
   A6 — state hygiene (architecture: one serialisable object)
   ============================================================ */

test("A6 no state a phone or reload could see holds a handle or a function", () => {
  const game = { settings: {}, rounds: [
    { type: "tossup", category: "P", puzzle: "EASY DOES IT" },
    { type: "regular", category: "A", puzzle: "THE CORNER COFFEE SHOP" },
    { type: "bonus", category: "B", puzzle: "THE WINNER'S CIRCLE" }] };
  let s = WC.reduce(WC.createState(game, PLAYERS), { type: "start" }, () => 0.5);
  s = WC.reduce(s, { type: "tossupStart" }, () => 0.5);
  s = WC.reduce(s, { type: "tossupBuzz", pid: "p1" });
  s = WC.reduce(s, { type: "tossupJudged", correct: true });
  s = WC.reduce(s, { type: "nextRound" });
  s = WC.reduce(s, { type: "spin" }, () => 0.05);

  const walk = (value, path) => {
    if (value === null || typeof value === "undefined") return;
    const t = typeof value;
    assert.ok(["string", "number", "boolean", "object"].includes(t), `${path} is a ${t}`);
    if (t !== "object") return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} is not a plain object`);
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`);
  };
  walk(s, "state");
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, "state is exactly its own JSON");
  // …and every phone view is too.
  for (const pid of ["p1", "p2", "ghost"]) {
    const view = WC.phoneView(s, pid);
    walk(view, `phoneView(${pid})`);
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  }
});
