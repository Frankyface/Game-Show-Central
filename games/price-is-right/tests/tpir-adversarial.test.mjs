/* ============================================================
   The Price Is Right - ADVERSARIAL suite, part 1 (A1-A6)
   Written by the independent tester against
   docs/10-price-is-right-spec.md, not against the implementation:
   boundary values on every rule (a tie on the earliest bid, 25 vs
   26 steps, the first chip free, $0 vs $1 left, $1.00 exactly, a
   $250 vs $251 margin). Part 2 (A7-A10) is in
   tpir-adversarial-show.test.mjs.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { Core, fixed, seq, PLAYERS, mk, tiny, started, run, deepFreeze } from "./helpers.mjs";
import {
  wheelAt, roster, toShowdownWith, toShowcaseState,
  cliffGame, plinkoGame, l7Game, claimedShowcase,
} from "./adversarial-helpers.mjs";

/* ============================================================
   A1 — Contestants' Row boundaries
   ============================================================ */

test("A1 a tie goes to the EARLIEST bid, whichever seat it is", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const price = s.row.item.price;                       // 400 with fixed(0)
  // p3 bids first, p1 second, same amount.
  const a = run(s, [
    { type: "bid", pid: "p3", amount: 300 },
    { type: "bid", pid: "p1", amount: 300 },
    { type: "revealBids" },
  ]);
  assert.equal(a.row.result.pid, "p3");
  assert.equal(a.winnings.p3, price);
  assert.equal(a.winnings.p1, undefined);

  // Reverse the arrival order: the other one wins.
  const b = run(s, [
    { type: "bid", pid: "p1", amount: 300 },
    { type: "bid", pid: "p3", amount: 300 },
    { type: "revealBids" },
  ]);
  assert.equal(b.row.result.pid, "p1");
});

test("A1 correcting a bid keeps the original place in the tie order", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const a = run(s, [
    { type: "bid", pid: "p2", amount: 100 },
    { type: "bid", pid: "p4", amount: 300 },
    { type: "bid", pid: "p2", amount: 300 },      // p2 corrects up to the same number
    { type: "revealBids" },
  ]);
  assert.deepEqual(a.row.order, ["p2", "p4"]);
  assert.equal(a.row.result.pid, "p2", "the earlier bidder keeps the tie even after a correction");
});

test("A1 an exact bid pays the item plus the bonus, and only the bonus once", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const price = s.row.item.price;
  const a = run(s, [
    { type: "bid", pid: "p1", amount: price - 1 },
    { type: "bid", pid: "p2", amount: price },
    { type: "revealBids" },
  ]);
  assert.equal(a.row.result.exact, true);
  assert.equal(a.row.result.bonus, 500);
  assert.equal(a.winnings.p2, price + 500);
  // A second reveal is a no-op: the money cannot be paid twice.
  assert.equal(Core.reduce(a, { type: "revealBids" }, fixed(0)), a);
});

test("A1 everybody over rebids, clears the bids and keeps the same item", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const price = s.row.item.price;
  const over = run(s, s.row.seats.map((pid, i) => ({ type: "bid", pid, amount: price + 1 + i }))
    .concat([{ type: "revealBids" }]));
  assert.equal(over.row.allOver, true);
  assert.equal(over.row.result, null);
  assert.deepEqual(over.winnings, {}, "nobody is paid when everybody is over");
  assert.equal(Core.segmentDone(over), false);
  assert.equal(Core.reduce(over, { type: "nextSegment" }, fixed(0)), over, "cannot move on without a winner");

  const again = Core.reduce(over, { type: "rebid" }, fixed(0));
  assert.deepEqual(again.row.bids, {});
  assert.deepEqual(again.row.order, []);
  assert.equal(again.row.revealed, false);
  assert.equal(again.row.rebids, 1);
  assert.equal(again.row.item.price, price, "the same item is up for bid again");
  assert.equal(again.row.itemIndex, over.row.itemIndex);
});

test("A1 a seat left empty is skipped: the winner is picked from the bids placed", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const price = s.row.item.price;
  const a = run(s, [
    { type: "bid", pid: "p2", amount: price - 10 },
    { type: "bid", pid: "p4", amount: price - 50 },
    { type: "revealBids" },
  ]);
  assert.equal(a.row.result.pid, "p2");
  const seats = Core.rowSeats(a);
  const silent = seats.filter((x) => !x.placed).map((x) => x.pid);
  assert.deepEqual(silent, ["p1", "p3"]);
  silent.forEach((pid) => assert.equal(a.row.bids[pid], undefined));
});

test("A1 a row where nobody bids cannot be revealed", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  assert.equal(Core.reduce(s, { type: "revealBids" }, fixed(0)), s);
  assert.equal(Core.legalActions(s).includes("revealBids"), false);
});

test("A1 a fifth player takes the winner's seat and the winner joins the queue", () => {
  const five = roster(5);
  const s = started(tiny(), five, fixed(0));
  assert.deepEqual(s.row.seats, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(s.row.queue, ["p5"]);
  const next = run(s, [
    { type: "bid", pid: "p2", amount: 1 },
    { type: "revealBids" }, { type: "nextSegment" },
    { type: "pickGame", kind: "cliffhangers" },
    { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
    { type: "nextSegment" },
  ], fixed(0));
  assert.equal(next.phase, "row");
  assert.deepEqual(next.row.seats, ["p1", "p5", "p3", "p4"]);
  assert.deepEqual(next.row.queue, ["p2"]);
});

test("A1 bids from a player who is not in a seat are ignored", () => {
  const s = started(tiny(), roster(5), fixed(0));
  assert.equal(Core.reduce(s, { type: "bid", pid: "p5", amount: 100 }, fixed(0)), s);
  assert.equal(Core.reduce(s, { type: "bid", pid: "nobody", amount: 100 }, fixed(0)), s);
});

/* ============================================================
   A2 — Cliff Hangers boundaries
   ============================================================ */

test("A2 exactly 25 steps stays on the mountain; 26 falls off", () => {
  // tiny() prices are 10, 20, 30.
  const stay = run(cliffGame(), [
    { type: "chGuess", amount: 35 },   // 25 steps
    { type: "chGuess", amount: 20 },   // 0
    { type: "chGuess", amount: 30 },   // 0
  ]);
  assert.equal(stay.game.steps, 25);
  assert.equal(stay.game.done, true);
  assert.equal(stay.game.won, true, "25 steps is still on the mountain");
  assert.equal(stay.winnings.p1 > 0, true);

  const fall = run(cliffGame(), [
    { type: "chGuess", amount: 36 },   // 26 steps
  ]);
  assert.equal(fall.game.steps, 26);
  assert.equal(fall.game.done, true);
  assert.equal(fall.game.won, false);
  assert.equal(fall.winnings.p1, fall.winnings.p1 === undefined ? undefined : 400,
    "only the One Bid money, never the Cliff Hangers prize");
});

test("A2 a fall ends the game: later guesses are ignored", () => {
  const fall = run(cliffGame(), [{ type: "chGuess", amount: 99 }]);
  assert.equal(fall.game.done, true);
  assert.equal(Core.reduce(fall, { type: "chGuess", amount: 20 }, fixed(0)), fall);
  assert.equal(fall.game.guesses.length, 1);
});

test("A2 three zero-error guesses climb nothing and win the prize", () => {
  const win = run(cliffGame(), [
    { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
  ]);
  assert.equal(win.game.steps, 0);
  assert.equal(win.game.left, 25);
  assert.equal(win.game.won, true);
  assert.equal(win.game.award, 5000);
  assert.equal(win.winnings.p1, 400 + 5000);
});

test("A2 guesses outside 1..99 never move the climber", () => {
  const g = cliffGame();
  [0, -1, 100, 1000, 12.5, "40", null, undefined, NaN, Infinity].forEach((amount) => {
    assert.equal(Core.reduce(g, { type: "chGuess", amount }, fixed(0)), g, `chGuess ${String(amount)}`);
  });
});

test("A2 the climb is the sum of the errors, in order", () => {
  const items = [{ price: 10 }, { price: 20 }, { price: 30 }];
  assert.deepEqual(Core.cliffClimb([12, 20, 30], items), { steps: 2, fell: false, left: 23 });
  assert.deepEqual(Core.cliffClimb([1, 1, 1], items), { steps: 9 + 19 + 29, fell: true, left: 0 });
  assert.deepEqual(Core.cliffClimb([], items), { steps: 0, fell: false, left: 25 });
});

/* ============================================================
   A3 — Plinko
   ============================================================ */

test("A3 the first chip is free and every one of the four answers can earn one", () => {
  const g = plinkoGame();
  assert.equal(g.game.chips, 1, "the first chip is free");
  assert.equal(g.game.stage, "answers");
  // tiny(): 3/4 higher, 5/5 correct, 8/6 lower, 2/2 correct
  const truths = ["higher", "correct", "lower", "correct"];
  let s = g;
  truths.forEach((answer, i) => {
    assert.equal(Core.plinkoTruth(s.game.prices[i]), answer);
    s = Core.reduce(s, { type: "plinkoAnswer", answer }, fixed(0));
    assert.equal(s.game.chips, i + 2, `chip ${i + 2} after answer ${i + 1}`);
    assert.equal(s.game.answers[i].right, true);
  });
  assert.equal(s.game.chips, 5);
  assert.equal(s.game.stage, "drops");
});

test("A3 each wrong answer earns nothing, and the cap is never passed", () => {
  let s = plinkoGame();
  ["lower", "higher", "higher", "lower"].forEach((answer) => {
    s = Core.reduce(s, { type: "plinkoAnswer", answer }, fixed(0));
  });
  assert.equal(s.game.chips, 1, "four wrong answers leave the free chip alone");
  assert.equal(s.game.answers.every((a) => a.right === false), true);

  const g2 = tiny();
  g2.settings.plinko = { slots: [1, 2, 3, 4, 5, 6, 7, 8, 9], maxChips: 2 };
  let capped = Core.reduce(
    run(Core.createState(g2, PLAYERS), [{ type: "start" }, { type: "bid", pid: "p1", amount: 1 },
      { type: "revealBids" }, { type: "nextSegment" }], fixed(0)),
    { type: "pickGame", kind: "plinko" }, fixed(0));
  ["higher", "correct", "lower", "correct"].forEach((answer) => {
    capped = Core.reduce(capped, { type: "plinkoAnswer", answer }, fixed(0));
  });
  assert.equal(capped.game.chips, 2, "maxChips caps the pile");
});

test("A3 junk answers and out-of-turn answers are ignored", () => {
  const g = plinkoGame();
  ["", "HIGHER", "yes", null, 3, {}].forEach((answer) => {
    assert.equal(Core.reduce(g, { type: "plinkoAnswer", answer }, fixed(0)), g, `answer ${String(answer)}`);
  });
  assert.equal(Core.reduce(g, { type: "plinkoAnswer", i: 2, answer: "higher" }, fixed(0)), g,
    "an answer aimed at another small price is dropped");
});

test("A3 the rng decides the landing slot and the path never leaves the board", () => {
  for (let slot = 0; slot < 9; slot += 1) {
    const left = Core.plinkoPath(slot, fixed(0), 9);
    const right = Core.plinkoPath(slot, fixed(0.999), 9);
    [left, right].forEach((p) => {
      assert.equal(p.path.length, 13, "12 peg rows plus the start");
      assert.equal(p.path[0], slot);
      p.path.forEach((pos) => {
        assert.equal(pos >= 0 && pos <= 8, true, `position ${pos} is on the board`);
        assert.equal(Number.isInteger(pos * 2), true, "half-step parity is kept");
      });
      assert.equal(Number.isInteger(p.landing), true);
      assert.equal(p.landing >= 0 && p.landing <= 8, true);
    });
    assert.equal(left.landing <= slot, true, "always-left never drifts right");
    assert.equal(right.landing >= slot, true, "always-right never drifts left");
  }
  // A zig-zag returns to the start.
  assert.equal(Core.plinkoPath(4, seq(0.1, 0.9), 9).landing, 4);
});

test("A3 a drop pays the slot the core chose, and stops at the last chip", () => {
  let s = plinkoGame();
  s = Core.reduce(s, { type: "plinkoAnswer", answer: "higher" }, fixed(0));   // 2 chips
  ["lower", "higher", "lower"].forEach((a) => { s = Core.reduce(s, { type: "plinkoAnswer", answer: a }, fixed(0)); });
  assert.equal(s.game.chips, 2);
  assert.equal(s.game.stage, "drops");
  const slots = s.content.settings.plinko.slots;

  const one = Core.reduce(s, { type: "plinkoDrop", slot: 0 }, fixed(0));
  assert.equal(one.game.lastDrop.landing, 0);
  assert.equal(one.game.lastDrop.value, slots[0]);
  assert.equal(one.winnings.p1, 400 + slots[0]);
  assert.equal(one.game.done, false);

  const two = Core.reduce(one, { type: "plinkoDrop", slot: 8 }, fixed(0.999));
  assert.equal(two.game.lastDrop.landing, 8);
  assert.equal(two.game.dropped, 2);
  assert.equal(two.game.done, true);
  assert.equal(two.game.total, slots[0] + slots[8]);
  assert.equal(two.winnings.p1, 400 + slots[0] + slots[8]);

  // Every chip is spent: a third drop is refused.
  assert.equal(Core.reduce(two, { type: "plinkoDrop", slot: 4 }, fixed(0)), two,
    "dropping with no chips left changes nothing");
});

test("A3 a drop before the answers are done, or from an impossible slot, is refused", () => {
  const g = plinkoGame();
  assert.equal(Core.reduce(g, { type: "plinkoDrop", slot: 4 }, fixed(0)), g, "still answering small prices");
  let s = g;
  ["higher", "correct", "lower", "correct"].forEach((a) => { s = Core.reduce(s, { type: "plinkoAnswer", answer: a }, fixed(0)); });
  [-1, 9, 100, 1.5, "4", null, undefined, NaN].forEach((slot) => {
    assert.equal(Core.reduce(s, { type: "plinkoDrop", slot }, fixed(0)), s, `slot ${String(slot)}`);
  });
});

/* ============================================================
   A4 — Lucky Seven
   ============================================================ */

test("A4 the first digit is given and never guessed", () => {
  const g = l7Game();
  assert.deepEqual(g.game.digits, [2, 4, 6, 8, 0]);       // tiny() car is 24680
  assert.deepEqual(g.game.revealedDigits, [2]);
  assert.equal(g.game.index, 1);
  assert.equal(g.game.wallet, 7);
  assert.equal(g.game.guesses.length, 0);
});

test("A4 exactly one dollar left wins the car; nothing left loses it", () => {
  // digits after the first: 4, 6, 8, 0. Spend 6 -> $1 left.
  const win = run(l7Game(), [
    { type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 6 },   // |6-0| = 6
  ]);
  assert.equal(win.game.wallet, 1);
  assert.equal(win.game.done, true);
  assert.equal(win.game.won, true, "a dollar left is still a win");
  assert.equal(win.winnings.p1, 400 + 24680);

  // Spend 7 -> $0 left.
  const lose = run(l7Game(), [
    { type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 7 },   // |7-0| = 7
  ]);
  assert.equal(lose.game.wallet, 0);
  assert.equal(lose.game.done, true);
  assert.equal(lose.game.won, false, "$0 left loses");
  assert.equal(lose.winnings.p1, 400, "no car money");
});

test("A4 going broke early stops the game before the remaining digits", () => {
  const broke = run(l7Game(), [
    { type: "l7Guess", digit: 9 },   // |9-4| = 5, wallet 2
    { type: "l7Guess", digit: 9 },   // |9-6| = 3, wallet 0
    { type: "l7Guess", digit: 8 },
  ]);
  assert.equal(broke.game.guesses.length, 2, "the third guess never happened");
  assert.equal(broke.game.wallet, 0);
  assert.equal(broke.game.done, true);
  assert.equal(broke.game.won, false);
});

test("A4 perfect digits keep all seven dollars", () => {
  const win = run(l7Game(), [
    { type: "l7Guess", digit: 4 }, { type: "l7Guess", digit: 6 },
    { type: "l7Guess", digit: 8 }, { type: "l7Guess", digit: 0 },
  ]);
  assert.equal(win.game.wallet, 7);
  assert.equal(win.game.won, true);
  assert.deepEqual(win.game.revealedDigits, [2, 4, 6, 8, 0]);
});

test("A4 digits outside 0..9 are ignored", () => {
  const g = l7Game();
  [-1, 10, 1.5, "4", null, undefined, NaN, Infinity].forEach((digit) => {
    assert.equal(Core.reduce(g, { type: "l7Guess", digit }, fixed(0)), g, `digit ${String(digit)}`);
  });
  assert.equal(Core.l7Cost(3, 7), 4);
  assert.equal(Core.l7Cost(0, 0), 0);
  assert.deepEqual(Core.l7Digits(10000), [1, 0, 0, 0, 0]);
  assert.deepEqual(Core.l7Digits(99999), [9, 9, 9, 9, 9]);
});

/* ============================================================
   A5 — Showcase Showdown (the big wheel)
   ============================================================ */

test("A5 exactly one dollar pays the bonus and ends the turn", () => {
  const s = toShowdownWith({ per: 3 });
  const first = s.showdown.spinners[0];
  const before = s.winnings[first] || 0;
  const hit = Core.reduce(s, { type: "spin" }, wheelAt(0));      // DEFAULT_WHEEL[0] === 100
  assert.equal(hit.showdown.totals[first], 100);
  assert.equal(hit.winnings[first], before + 1000, "the $1.00 bonus");
  assert.notEqual(hit.showdown.awaiting, "decide", "no second spin is offered on a dollar");
});

test("A5 a second spin over a dollar busts, and the total is kept", () => {
  const s = toShowdownWith({ per: 3 });
  const first = s.showdown.spinners[0];
  const one = Core.reduce(s, { type: "spin" }, wheelAt(2));      // 80
  assert.equal(one.showdown.totals[first], 80);
  assert.equal(one.showdown.awaiting, "decide", "a first spin offers a second");
  const again = Core.reduce(one, { type: "spinAgain" }, fixed(0));
  assert.equal(again.showdown.awaiting, "spin");
  const bust = Core.reduce(again, { type: "spin" }, wheelAt(3));  // 35 -> 115
  assert.equal(bust.showdown.totals[first], 115);
  assert.equal(bust.showdown.current, 1, "a bust hands the wheel on");
  assert.equal(bust.winnings[first], one.winnings[first], "a bust never pays");
});

test("A5 staying keeps the total and hands the wheel on; a third spin is impossible", () => {
  const s = toShowdownWith({ per: 3 });
  const first = s.showdown.spinners[0];
  const one = Core.reduce(s, { type: "spin" }, wheelAt(1));      // 15
  const stayed = Core.reduce(one, { type: "stay" }, fixed(0));
  assert.equal(stayed.showdown.totals[first], 15);
  assert.equal(stayed.showdown.current, 1);
  // Two spins in a row for the second spinner: no "decide" the second time.
  const second = stayed.showdown.spinners[1];
  const a = Core.reduce(stayed, { type: "spin" }, wheelAt(1));
  const b = Core.reduce(Core.reduce(a, { type: "spinAgain" }, fixed(0)), { type: "spin" }, wheelAt(1));
  assert.equal(b.showdown.totals[second], 30);
  assert.notEqual(b.showdown.awaiting, "decide", "only two spins each");
});

test("A5 spinning out of turn, or for someone else, does nothing", () => {
  const s = toShowdownWith({ per: 3 });
  const notUp = s.showdown.spinners[1];
  assert.equal(Core.reduce(s, { type: "spin", pid: notUp }, wheelAt(0)), s);
  assert.equal(Core.reduce(s, { type: "spin", pid: "nobody" }, wheelAt(0)), s);
  assert.equal(Core.reduce(s, { type: "spinAgain" }, fixed(0)), s, "nothing to decide before a spin");
  assert.equal(Core.reduce(s, { type: "stay" }, fixed(0)), s);
});

test("A5 the closest total under a dollar takes the showdown", () => {
  let s = toShowdownWith({ per: 3 });
  assert.equal(s.showdown.spinners.length, 3);
  const [a, b, c] = s.showdown.spinners;
  s = Core.reduce(Core.reduce(s, { type: "spin" }, wheelAt(1)), { type: "stay" }, fixed(0));   // a: 15
  s = Core.reduce(Core.reduce(s, { type: "spin" }, wheelAt(4)), { type: "stay" }, fixed(0));   // b: 60
  s = Core.reduce(Core.reduce(s, { type: "spin" }, wheelAt(2)), { type: "stay" }, fixed(0));   // c: 80
  assert.deepEqual([s.showdown.totals[a], s.showdown.totals[b], s.showdown.totals[c]], [15, 60, 80]);
  assert.equal(s.showdown.awaiting, "done");
  assert.equal(s.showdown.winner, c);
  assert.deepEqual(s.showdownWinners, [c]);
});

test("A5 a three-way tie starts a one-spin-each spin-off from zero", () => {
  const flat = new Array(20).fill(50);
  let s = toShowdownWith({ per: 3, wheel: flat });
  assert.equal(s.showdown.spinners.length, 3);
  const before = s.showdown.spinners.slice();
  for (let i = 0; i < 3; i += 1) {
    s = Core.reduce(Core.reduce(s, { type: "spin" }, fixed(0)), { type: "stay" }, fixed(0));
  }
  assert.equal(s.showdown.spinoff, true, "everyone on 50c is a three-way tie");
  assert.equal(s.showdown.round, 2);
  assert.deepEqual(s.showdown.spinners.slice().sort(), before.slice().sort());
  assert.deepEqual(Object.values(s.showdown.totals), [0, 0, 0], "the spin-off restarts from zero");
  assert.equal(s.showdown.current, 0);
  assert.equal(s.showdown.awaiting, "spin");
  // One spin each, no second-spin offer.
  const one = Core.reduce(s, { type: "spin" }, fixed(0));
  assert.notEqual(one.showdown.awaiting, "decide", "a spin-off is one spin each");
});

test("A5 showdownWinner: over a dollar is out, a draw returns the tie, all bust is flagged", () => {
  assert.deepEqual(Core.showdownWinner({ a: 105, b: 60 }, ["a", "b"]),
    { pid: "b", tie: [], best: 60, allBust: false });
  const draw = Core.showdownWinner({ a: 65, b: 65, c: 20 }, ["a", "b", "c"]);
  assert.equal(draw.pid, null);
  assert.deepEqual(draw.tie, ["a", "b"]);
  const bust = Core.showdownWinner({ a: 105, b: 110 }, ["a", "b"]);
  assert.equal(bust.allBust, true);
  assert.equal(bust.pid, null);
  assert.deepEqual(Core.showdownWinner({}, []), { pid: null, tie: [], best: 0, allBust: false });
  const exact = Core.showdownWinner({ a: 100, b: 95 }, ["a", "b"]);
  assert.equal(exact.pid, "a", "$1.00 exactly is not over");
});

/* ============================================================
   A6 — the Showcase
   ============================================================ */

test("A6 the same player winning both showdowns still yields two DIFFERENT finalists", () => {
  const g = tiny();
  g.settings.gamesPerShowdown = 1;
  let s = started(g, PLAYERS, fixed(0));
  for (let i = 0; i < 2; i += 1) {
    s = run(s, [
      { type: "bid", pid: "p1", amount: 1 },       // p1 wins every row
      { type: "revealBids" }, { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" }, { type: "spin" }, { type: "stay" }, { type: "nextSegment" },
    ], wheelAt(3));
  }
  assert.deepEqual(s.showdownWinners, ["p1", "p1"], "the same contestant won both showdowns");
  assert.equal(s.phase, "showcase");
  assert.equal(s.showcase.finalists.length, 2);
  assert.notEqual(s.showcase.finalists[0], s.showcase.finalists[1]);
  assert.equal(s.showcase.finalists[0], "p1");
  assert.equal(s.showcase.pair[0] !== s.showcase.pair[1], true, "two different showcases");
});

test("A6 pass swaps the showcases, take keeps them, and the choice is made once", () => {
  const s = toShowcaseState();
  const chooser = s.showcase.chooser;
  const other = s.showcase.finalists.find((p) => p !== chooser);
  const passed = Core.reduce(s, { type: "showcasePass", pass: true }, fixed(0));
  assert.equal(passed.showcase.assignments[chooser], s.showcase.pair[1]);
  assert.equal(passed.showcase.assignments[other], s.showcase.pair[0]);
  assert.equal(Core.reduce(passed, { type: "showcasePass", pass: false }, fixed(0)), passed,
    "the choice cannot be made twice");

  const taken = Core.reduce(s, { type: "showcasePass", pass: false }, fixed(0));
  assert.equal(taken.showcase.assignments[chooser], s.showcase.pair[0]);
  assert.equal(taken.showcase.assignments[other], s.showcase.pair[1]);
});

test("A6 no bidding before the showcases are claimed, and no reveal without a bid", () => {
  const s = toShowcaseState();
  const finalist = s.showcase.finalists[0];
  assert.equal(Core.reduce(s, { type: "showcaseBid", pid: finalist, amount: 100 }, fixed(0)), s);
  const chosen = Core.reduce(s, { type: "showcasePass", pass: true }, fixed(0));
  assert.equal(Core.reduce(chosen, { type: "revealShowcase" }, fixed(0)), chosen);
  assert.equal(Core.reduce(chosen, { type: "showcaseBid", pid: "nobody", amount: 100 }, fixed(0)), chosen);
  [0, -1, 2.5, "100", null].forEach((amount) => {
    assert.equal(Core.reduce(chosen, { type: "showcaseBid", pid: finalist, amount }, fixed(0)), chosen,
      `showcase bid ${String(amount)}`);
  });
});

test("A6 a margin of exactly $250 wins both showcases; $251 wins only one", () => {
  const { s, chooser, other, actual } = claimedShowcase();
  const both = run(s, [
    { type: "showcaseBid", pid: chooser, amount: actual(chooser) - 250 },
    { type: "showcaseBid", pid: other, amount: actual(other) + 1000 },   // over
    { type: "revealShowcase" },
  ]);
  assert.equal(both.showcase.result.winner, chooser);
  assert.equal(both.showcase.result.diff, 250);
  assert.equal(both.showcase.result.both, true, "$250 exactly is inside the margin");
  assert.equal(both.winnings[chooser], (s.winnings[chooser] || 0) + actual(chooser) + actual(other));

  const one = run(s, [
    { type: "showcaseBid", pid: chooser, amount: actual(chooser) - 251 },
    { type: "showcaseBid", pid: other, amount: actual(other) + 1000 },
    { type: "revealShowcase" },
  ]);
  assert.equal(one.showcase.result.both, false, "$251 is outside the margin");
  assert.equal(one.winnings[chooser], (s.winnings[chooser] || 0) + actual(chooser));
  assert.equal(one.winnings[other], s.winnings[other]);
});

test("A6 closest without going over wins; both over means nobody wins and no money moves", () => {
  const { s, chooser, other, actual } = claimedShowcase();
  const near = run(s, [
    { type: "showcaseBid", pid: chooser, amount: actual(chooser) - 3000 },
    { type: "showcaseBid", pid: other, amount: actual(other) - 400 },
    { type: "revealShowcase" },
  ]);
  assert.equal(near.showcase.result.winner, other);
  assert.equal(near.showcase.result.both, false);

  const over = run(s, [
    { type: "showcaseBid", pid: chooser, amount: actual(chooser) + 1 },
    { type: "showcaseBid", pid: other, amount: actual(other) + 1 },
    { type: "revealShowcase" },
  ]);
  assert.equal(over.showcase.result.doubleOver, true);
  assert.equal(over.showcase.result.winner, null);
  assert.deepEqual(over.winnings, s.winnings, "nobody is paid when both are over");
  assert.equal(Core.segmentDone(over), true);
  assert.equal(Core.reduce(over, { type: "nextSegment" }, fixed(0)).phase, "standings");
});

test("A6 showcaseResult on its own: margin edges and a non-bidder", () => {
  const r1 = Core.showcaseResult({ a: 750, b: 400 }, { a: 1000, b: 1000 }, 250, ["a", "b"]);
  assert.equal(r1.winner, "a");
  assert.equal(r1.both, true);
  const r2 = Core.showcaseResult({ a: 749, b: 400 }, { a: 1000, b: 1000 }, 250, ["a", "b"]);
  assert.equal(r2.both, false);
  const r3 = Core.showcaseResult({ b: 900 }, { a: 1000, b: 1000 }, 250, ["a", "b"]);
  assert.equal(r3.winner, "b", "a finalist who never bid is treated as over");
  assert.equal(r3.rows.find((x) => x.pid === "a").over, true);
});
