/* ============================================================
   The Price Is Right — pure core unit tests, part 1
   Content validation, Contestants' Row and the three pricing
   games (spec 10 §6, P-U1 … P-U5). `node --test` from
   games/price-is-right runs this and tpir-show.test.mjs.
   Every random choice in the core takes an injected rng, so each
   scenario here is fully deterministic.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Core, DEFAULT_GAME, SHIPPED, fixed, seq, PLAYERS, mk, tiny, started, run, toGame, deepFreeze,
} from "./helpers.mjs";

/* ============================================================
   P-U1 — the validator table
   ============================================================ */

const BAD_FILES = [
  ["not an object", () => 42, "not a Price Is Right game"],
  ["title is not text", () => { const g = mk(); g.title = 7; return g; }, "must be text"],
  ["settings is not an object", () => { const g = mk(); g.settings = []; return g; }, "must be an object"],
  ["currency too long", () => { const g = mk(); g.settings.currency = "DOLLARS"; return g; }, "at most 3"],
  ["gamesPerShowdown 0", () => { const g = mk(); g.settings.gamesPerShowdown = 0; return g; }, "from 1 to 8"],
  ["exactBidBonus fractional", () => { const g = mk(); g.settings.exactBidBonus = 1.5; return g; }, "exactBidBonus"],
  ["wheel wrong length", () => { const g = mk(); g.settings.wheel = [5, 10]; return g; }, "exactly 20"],
  ["wheel off the nickel", () => { const g = mk(); g.settings.wheel[3] = 33; return g; }, "steps of 5"],
  ["wheel over a dollar", () => { const g = mk(); g.settings.wheel[0] = 105; return g; }, "steps of 5"],
  ["plinko slots wrong length", () => { const g = mk(); g.settings.plinko.slots = [1, 2]; return g; }, "exactly 9"],
  ["plinko slot negative", () => { const g = mk(); g.settings.plinko.slots[0] = -5; return g; }, "0 or more"],
  ["maxChips out of range", () => { const g = mk(); g.settings.plinko.maxChips = 0; return g; }, "from 1 to 9"],
  ["unknown pricing game", () => { const g = mk(); g.settings.pricingGames = ["hole-in-one"]; return g; }, "is not a pricing game"],
  ["empty pricingGames", () => { const g = mk(); g.settings.pricingGames = []; return g; }, "at least one pricing game"],
  ["too few One Bid items", () => { const g = mk(); g.oneBid = g.oneBid.slice(0, 3); return g; }, "at least 4 items"],
  ["One Bid item has no name", () => { const g = mk(); g.oneBid[0].name = "   "; return g; }, "needs a name"],
  ["One Bid price is zero", () => { const g = mk(); g.oneBid[1].price = 0; return g; }, "whole-dollar price"],
  ["One Bid price is fractional", () => { const g = mk(); g.oneBid[1].price = 12.5; return g; }, "whole-dollar price"],
  ["Cliff Hangers missing", () => { const g = mk(); delete g.cliffhangers; return g; }, "at least one set"],
  ["Cliff Hangers wrong item count", () => { const g = mk(); g.cliffhangers[0].items.pop(); return g; }, "exactly 3 small items"],
  ["Cliff Hangers item over 99", () => { const g = mk(); g.cliffhangers[0].items[0].price = 100; return g; }, "from 1 to 99"],
  ["Cliff Hangers prize missing", () => { const g = mk(); delete g.cliffhangers[1].prize; return g; }, "the prize"],
  ["Plinko wrong price count", () => { const g = mk(); g.plinko[0].smallPrices.pop(); return g; }, "exactly 4 small prices"],
  ["Plinko shown out of range", () => { const g = mk(); g.plinko[0].smallPrices[0].shown = 0; return g; }, "from 1 to 9"],
  ["Plinko actual out of range", () => { const g = mk(); g.plinko[1].smallPrices[2].actual = 10; return g; }, "from 1 to 9"],
  ["Lucky Seven price too short", () => { const g = mk(); g.luckyseven[0].price = 9999; return g; }, "five-digit price"],
  ["Lucky Seven price too long", () => { const g = mk(); g.luckyseven[0].price = 100000; return g; }, "five-digit price"],
  ["Lucky Seven has no name", () => { const g = mk(); g.luckyseven[2].car = ""; return g; }, "needs a name"],
  ["one showcase only", () => { const g = mk(); g.showcases = g.showcases.slice(0, 1); return g; }, "at least 2 showcases"],
  ["showcase with one prize", () => { const g = mk(); g.showcases[0].prizes.pop(); return g; }, "2 to 4 prizes"],
  ["showcase with five prizes", () => {
    const g = mk();
    g.showcases[1].prizes.push({ name: "Extra", price: 10 }, { name: "More", price: 20 });
    return g;
  }, "2 to 4 prizes"],
];

test("P-U1 the validator rejects every broken file with a plain-English reason", () => {
  for (const [label, build, needle] of BAD_FILES) {
    assert.throws(() => Core.validateGame(build()), (err) => {
      assert.ok(err instanceof Error, `${label}: threw a non-Error`);
      assert.ok(err.message.includes(needle), `${label}: "${err.message}" should mention "${needle}"`);
      return true;
    }, label);
  }
});

test("P-U1 a disabled pricing game does not need content", () => {
  const g = mk();
  g.settings.pricingGames = ["plinko"];
  delete g.cliffhangers;
  delete g.luckyseven;
  assert.equal(Core.validateGame(g), true);
  const norm = Core.normalizeGame(g);
  assert.deepEqual(norm.cliffhangers, []);
  assert.deepEqual(norm.luckyseven, []);
});

test("P-U1 the shipped prizes.json validates and js/data.js mirrors it exactly", () => {
  assert.equal(Core.validateGame(SHIPPED), true);
  assert.deepEqual(DEFAULT_GAME, SHIPPED);
  assert.equal(SHIPPED.oneBid.length, 12);
  assert.equal(SHIPPED.cliffhangers.length, 3);
  assert.equal(SHIPPED.plinko.length, 3);
  assert.equal(SHIPPED.luckyseven.length, 3);
  assert.equal(SHIPPED.showcases.length, 4);
});

test("P-U1 normalizeGame fills defaults, totals the showcases and never mutates the input", () => {
  const raw = deepFreeze(mk());
  const norm = Core.normalizeGame(raw);
  assert.equal(norm.showcases[0].total, 8600);
  assert.equal(norm.settings.plinko.slots.length, 9);
  assert.equal(norm.oneBid[0].id, "ob0");
  const bare = Core.normalizeGame(Object.assign(tiny(), { settings: undefined }));
  assert.equal(bare.settings.currency, "$");
  assert.equal(bare.settings.wheel.length, 20);
  assert.equal(bare.settings.gamesPerShowdown, 3);
  assert.deepEqual(bare.settings.pricingGames, ["cliffhangers", "plinko", "luckyseven"]);
});

test("P-U1 warningsFor flags a thin file without rejecting it", () => {
  const thin = tiny();
  thin.oneBid = thin.oneBid.slice(0, 4);
  const warnings = Core.warningsFor(thin);
  assert.ok(warnings.some((w) => w.includes("One Bid")), warnings.join(" | "));
  assert.ok(warnings.some((w) => w.includes("Cliff Hangers")), warnings.join(" | "));
  assert.deepEqual(Core.warningsFor(SHIPPED), []);
});

/* ============================================================
   P-U2 — Contestants' Row (One Bid)
   ============================================================ */

test("P-U2 closest without going over wins", () => {
  const bids = { p1: 300, p2: 410, p3: 395, p4: 100 };
  const r = Core.rowWinner(bids, 400, 500, ["p1", "p2", "p3", "p4"]);
  assert.equal(r.pid, "p3");
  assert.equal(r.diff, 5);
  assert.equal(r.exact, false);
  assert.equal(r.bonus, 0);
});

test("P-U2 an exact bid wins the bonus", () => {
  const r = Core.rowWinner({ p1: 400, p2: 399 }, 400, 500, ["p1", "p2"]);
  assert.equal(r.pid, "p1");
  assert.equal(r.exact, true);
  assert.equal(r.bonus, 500);
  assert.equal(r.diff, 0);
});

test("P-U2 everybody over means nobody wins and the row rebids", () => {
  const r = Core.rowWinner({ p1: 500, p2: 900 }, 400, 500, ["p1", "p2"]);
  assert.equal(r.allOver, true);
  assert.equal(r.pid, null);
  assert.deepEqual(Core.rowWinner({}, 400, 500, []), {
    pid: null, amount: null, exact: false, bonus: 0, allOver: false, diff: null,
  });
});

test("P-U2 a tied bid goes to whoever bid first", () => {
  const first = Core.rowWinner({ p1: 350, p2: 350 }, 400, 500, ["p1", "p2"]);
  assert.equal(first.pid, "p1");
  const second = Core.rowWinner({ p1: 350, p2: 350 }, 400, 500, ["p2", "p1"]);
  assert.equal(second.pid, "p2");
});

test("P-U2 the reducer masks bids, banks the price plus the bonus and rotates the row", () => {
  let s = started();
  assert.equal(s.phase, "row");
  assert.deepEqual(s.row.seats, ["p1", "p2", "p3", "p4"]);
  const price = s.row.item.price;
  s = run(s, [
    { type: "bid", pid: "p1", amount: 100 },
    { type: "bid", pid: "p2", amount: price },
    { type: "bid", pid: "nobody", amount: 300 },
    { type: "bid", pid: "p3", amount: price + 1 },
  ]);
  assert.equal(s.row.revealed, false);
  assert.equal(Object.keys(s.row.bids).length, 3, "the stranger's bid was dropped");
  s = Core.reduce(s, { type: "revealBids" }, fixed(0));
  assert.equal(s.row.result.pid, "p2");
  assert.equal(s.winnings.p2, price + 500);
  assert.deepEqual(s.comeOnDown, ["p2"]);
  const seats = Core.reduce(run(s, [{ type: "nextSegment" }, { type: "pickGame", kind: "cliffhangers" }]),
    { type: "finish" }, fixed(0));
  assert.equal(seats.phase, "standings");
});

test("P-U2 an all-over row can be rebid and nothing advances until somebody wins", () => {
  let s = started();
  const price = s.row.item.price;
  s = run(s, [
    { type: "bid", pid: "p1", amount: price + 10 },
    { type: "bid", pid: "p2", amount: price + 20 },
    { type: "revealBids" },
  ]);
  assert.equal(s.row.allOver, true);
  const stuck = Core.reduce(s, { type: "nextSegment" }, fixed(0));
  assert.equal(stuck, s, "nextSegment is a no-op while the row has no winner");
  s = Core.reduce(s, { type: "rebid" }, fixed(0));
  assert.deepEqual(s.row.bids, {});
  assert.equal(s.row.revealed, false);
  assert.equal(s.row.rebids, 1);
  s = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }]);
  assert.equal(s.row.result.pid, "p1");
});

test("P-U2 illegal bids are ignored", () => {
  const s = started();
  const cases = [
    { type: "bid", pid: "p1", amount: 0 },
    { type: "bid", pid: "p1", amount: -5 },
    { type: "bid", pid: "p1", amount: 12.5 },
    { type: "bid", pid: "p1", amount: "300" },
    { type: "bid", pid: "p1", amount: 1e9 },
    { type: "bid", pid: "", amount: 300 },
  ];
  for (const ev of cases) assert.equal(Core.reduce(s, ev, fixed(0)), s, JSON.stringify(ev));
  assert.equal(Core.reduce(s, { type: "revealBids" }, fixed(0)), s, "no bids, nothing to reveal");
});

test("P-U2 the row refills from the queue when there are more than four players", () => {
  const six = PLAYERS.concat([{ pid: "p5", name: "Eve" }, { pid: "p6", name: "Fay" }]);
  let s = started(tiny(), six);
  assert.deepEqual(s.row.seats, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(s.row.queue, ["p5", "p6"]);
  s = run(s, [{ type: "bid", pid: "p2", amount: 1 }, { type: "revealBids" },
    { type: "nextSegment" }, { type: "pickGame", kind: "cliffhangers" },
    { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
    { type: "nextSegment" }]);
  assert.equal(s.phase, "row");
  assert.deepEqual(s.row.seats, ["p1", "p5", "p3", "p4"], "the winner's seat went to the next in line");
  assert.deepEqual(s.row.queue, ["p6", "p2"]);
});

/* ============================================================
   P-U3 — Cliff Hangers
   ============================================================ */

test("P-U3 one dollar of error is one step, and 25 steps is still safe", () => {
  const items = [{ price: 10 }, { price: 20 }, { price: 30 }];
  assert.deepEqual(Core.cliffClimb([10, 20, 30], items), { steps: 0, fell: false, left: 25 });
  assert.deepEqual(Core.cliffClimb([15, 20, 30], items), { steps: 5, fell: false, left: 20 });
  assert.deepEqual(Core.cliffClimb([1, 20, 30], items), { steps: 9, fell: false, left: 16 });
  assert.equal(Core.cliffClimb([35, 20, 30], items).steps, 25);
  assert.equal(Core.cliffClimb([35, 20, 30], items).fell, false, "exactly 25 stays on the mountain");
  assert.equal(Core.cliffClimb([36, 20, 30], items).fell, true, "26 falls");
  assert.equal(Core.cliffError(4, 9), 5);
  assert.equal(Core.cliffError(9, 4), 5);
});

test("P-U3 three good guesses win the prize", () => {
  let s = toGame("cliffhangers");
  assert.equal(s.game.kind, "cliffhangers");
  const pid = s.game.pid;
  s = run(s, [{ type: "chGuess", amount: 12 }, { type: "chGuess", amount: 22 }]);
  assert.equal(s.game.steps, 4);
  assert.equal(s.game.left, 21);
  assert.equal(s.game.done, false);
  s = Core.reduce(s, { type: "chGuess", amount: 30 }, fixed(0));
  assert.equal(s.game.done, true);
  assert.equal(s.game.won, true);
  assert.equal(s.game.award, 5000);
  assert.equal(s.winnings[pid] >= 5000, true);
});

test("P-U3 too much error sends the climber over the edge and ends the game", () => {
  let s = toGame("cliffhangers");
  s = run(s, [{ type: "chGuess", amount: 99 }]);
  assert.equal(s.game.steps, 89);
  assert.equal(s.game.done, true);
  assert.equal(s.game.won, false);
  assert.equal(s.game.award, 0);
  assert.equal(Core.reduce(s, { type: "chGuess", amount: 20 }, fixed(0)), s, "no guessing after the fall");
});

test("P-U3 out-of-range Cliff Hangers guesses are ignored", () => {
  const s = toGame("cliffhangers");
  for (const amount of [0, 100, -3, 12.5, "20"]) {
    assert.equal(Core.reduce(s, { type: "chGuess", amount }, fixed(0)), s, String(amount));
  }
});

/* ============================================================
   P-U4 — Plinko
   ============================================================ */

test("P-U4 the truth about a small price is higher / lower / correct", () => {
  assert.equal(Core.plinkoTruth({ shown: 3, actual: 4 }), "higher");
  assert.equal(Core.plinkoTruth({ shown: 8, actual: 6 }), "lower");
  assert.equal(Core.plinkoTruth({ shown: 5, actual: 5 }), "correct");
});

test("P-U4 the first chip is free and each right answer earns one more, capped", () => {
  let s = toGame("plinko");
  assert.equal(s.game.chips, 1);
  assert.equal(s.game.stage, "answers");
  s = Core.reduce(s, { type: "plinkoAnswer", i: 0, answer: "higher" }, fixed(0));   // right
  assert.equal(s.game.chips, 2);
  s = Core.reduce(s, { type: "plinkoAnswer", i: 1, answer: "higher" }, fixed(0));   // wrong
  assert.equal(s.game.chips, 2);
  s = run(s, [{ type: "plinkoAnswer", answer: "lower" }, { type: "plinkoAnswer", answer: "correct" }]);
  assert.equal(s.game.chips, 4);
  assert.equal(s.game.stage, "drops");
  assert.equal(s.game.answers.map((a) => (a.right ? "1" : "0")).join(""), "1011");
});

test("P-U4 the chip cap and out-of-order answers hold", () => {
  const g = tiny();
  g.settings.plinko = { maxChips: 2, slots: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  let s = started(g);
  s = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }, { type: "nextSegment" },
    { type: "pickGame", kind: "plinko" }]);
  assert.equal(Core.reduce(s, { type: "plinkoAnswer", i: 3, answer: "higher" }, fixed(0)), s, "wrong index");
  assert.equal(Core.reduce(s, { type: "plinkoAnswer", answer: "maybe" }, fixed(0)), s, "junk answer");
  s = run(s, [{ type: "plinkoAnswer", answer: "higher" }, { type: "plinkoAnswer", answer: "correct" },
    { type: "plinkoAnswer", answer: "lower" }, { type: "plinkoAnswer", answer: "correct" }]);
  assert.equal(s.game.chips, 2, "capped at maxChips even with four right answers");
});

test("P-U4 the bounce path is decided by the rng, lands on the board and keeps its parity", () => {
  const left = Core.plinkoPath(4, fixed(0), 9);
  assert.equal(left.path.length, 13);
  assert.equal(left.path[0], 4);
  assert.equal(left.landing, 0, "always-left from the middle reaches the left wall");
  assert.ok(left.path.every((p) => p >= 0 && p <= 8));
  const right = Core.plinkoPath(4, fixed(0.99), 9);
  assert.equal(right.landing, 8);
  const zigzag = Core.plinkoPath(4, seq(0.1, 0.9), 9);
  assert.equal(zigzag.landing, 4, "a perfect zig-zag comes straight down");
  const edge = Core.plinkoPath(0, fixed(0), 9);
  assert.ok(edge.path.every((p) => p >= 0), "the left wall bounces the chip back");
  assert.equal(Number.isInteger(edge.landing), true);
});

test("P-U4 a drop pays the slot the core chose and the game ends when the chips run out", () => {
  let s = toGame("plinko");
  const pid = s.game.pid;
  s = run(s, [{ type: "plinkoAnswer", answer: "higher" }, { type: "plinkoAnswer", answer: "correct" },
    { type: "plinkoAnswer", answer: "lower" }, { type: "plinkoAnswer", answer: "correct" }]);
  assert.equal(s.game.chips, 5);
  const before = s.winnings[pid] || 0;
  s = Core.reduce(s, { type: "plinkoDrop", slot: 4 }, fixed(0.99));
  assert.equal(s.game.lastDrop.landing, 8);
  assert.equal(s.game.lastDrop.value, 100);
  assert.equal(s.winnings[pid], before + 100);
  assert.equal(s.game.done, false);
  assert.equal(Core.reduce(s, { type: "plinkoDrop", slot: 9 }, fixed(0)), s, "slot 9 is off the board");
  s = run(s, [{ type: "plinkoDrop", slot: 4 }, { type: "plinkoDrop", slot: 4 },
    { type: "plinkoDrop", slot: 4 }, { type: "plinkoDrop", slot: 4 }], fixed(0.99));
  assert.equal(s.game.dropped, 5);
  assert.equal(s.game.done, true);
  assert.equal(s.game.total, 500);
  assert.equal(Core.reduce(s, { type: "plinkoDrop", slot: 0 }, fixed(0)), s, "no sixth chip");
});

/* ============================================================
   P-U5 — Lucky Seven
   ============================================================ */

test("P-U5 the digits and the cost of a guess", () => {
  assert.deepEqual(Core.l7Digits(24680), [2, 4, 6, 8, 0]);
  assert.deepEqual(Core.l7Digits(10000), [1, 0, 0, 0, 0]);
  assert.equal(Core.l7Cost(4, 4), 0);
  assert.equal(Core.l7Cost(9, 4), 5);
  assert.equal(Core.l7Cost(0, 8), 8);
});

test("P-U5 perfect digits keep all seven dollars and win the car", () => {
  let s = toGame("luckyseven");
  const pid = s.game.pid;
  assert.equal(s.game.wallet, 7);
  assert.deepEqual(s.game.revealedDigits, [2]);
  s = run(s, [{ type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 0 }]);
  assert.equal(s.game.wallet, 7);
  assert.equal(s.game.won, true);
  assert.equal(s.game.done, true);
  assert.equal(s.winnings[pid] >= 24680, true);
  assert.deepEqual(s.game.revealedDigits, [2, 4, 6, 8, 0]);
});

test("P-U5 a dollar left at the end still wins; nothing left loses", () => {
  let win = toGame("luckyseven");
  // 24680: guessing 4, 6, 8 and then 6 costs 0+0+0+6 = 6, leaving exactly $1.
  win = run(win, [{ type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 6 }]);
  assert.equal(win.game.wallet, 1);
  assert.equal(win.game.won, true);

  let lose = toGame("luckyseven");
  lose = run(lose, [{ type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 7 }]);
  assert.equal(lose.game.wallet, 0);
  assert.equal(lose.game.won, false);
  assert.equal(lose.game.award, 0);
});

test("P-U5 running out of money stops the game at once", () => {
  let s = toGame("luckyseven");
  const pid = s.game.pid;
  s = Core.reduce(s, { type: "l7Guess", digit: 9 }, fixed(0));     // |9-4| = 5, $2 left
  assert.equal(s.game.wallet, 2);
  assert.equal(s.game.done, false);
  s = Core.reduce(s, { type: "l7Guess", digit: 0 }, fixed(0));     // |0-6| = 6, broke
  assert.equal(s.game.wallet, 0);
  assert.equal(s.game.done, true);
  assert.equal(s.game.won, false);
  assert.equal(s.game.index, 3, "the game stopped with two digits still unguessed");
  assert.equal(s.winnings[pid] === undefined || s.winnings[pid] < 24680, true);
  assert.equal(Core.reduce(s, { type: "l7Guess", digit: 8 }, fixed(0)), s);
  for (const digit of [-1, 10, 4.5, "4"]) {
    assert.equal(Core.reduce(toGame("luckyseven"), { type: "l7Guess", digit }, fixed(0)).game.index, 1, String(digit));
  }
});
