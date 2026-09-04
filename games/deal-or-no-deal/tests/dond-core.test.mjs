/* ============================================================
   Deal or No Deal — pure core unit tests (spec 12 §6, N-U1 … N-U10)
   Zero dependencies: node --test from games/deal-or-no-deal.
   The core takes its rng as an argument, so every scenario here is
   fully deterministic.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/dond-core.js");
const Content = require("../js/dond-content.js");
const DEFAULT_BOARD = require("../js/data.js");
const SHIPPED = JSON.parse(readFileSync(new URL("../board.json", import.meta.url), "utf8"));

/* ============ Fixtures ============ */

/** A deterministic rng that cycles through the values it is given. */
function seq(...values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

/** Always returns the same number. */
const fixed = (v) => () => v;

const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
];

/**
 * A ten-case board whose amounts are never multiples of 100, so no banker
 * offer (always a multiple of 100 at this size) can ever collide with a case
 * amount. That is what makes the N-U10 leak test airtight.
 */
const SMALL = {
  title: "Ten cases",
  settings: {
    currency: "$",
    amounts: [101, 203, 307, 401, 503, 601, 701, 809, 907, 1009],
    rounds: [4, 2, 1, 1],
    offerFactors: [0.2, 0.4, 0.7, 1.0],
    jitter: 0.05,
    allowSwap: true,
    audienceAdvice: true,
  },
};

function fresh(board = SMALL, players = PLAYERS) {
  return Core.createState(board, players, {});
}

/** Run a list of events through the reducer with one rng. */
function play(state, events, rng = fixed(0.5)) {
  return events.reduce((s, e) => Core.reduce(s, e, rng), state);
}

/** Seated on a shuffled board, holding case `own`. */
function seated(board = SMALL, own = 1, rng = fixed(0.5)) {
  return play(fresh(board), [
    { type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: own },
  ], rng);
}

/** Open `count` cases, lowest number first, skipping the contestant's own. */
function openSome(state, count, rng = fixed(0.5)) {
  let s = state;
  const queue = s.cases.filter((c) => !c.opened && c.n !== s.own).map((c) => c.n);
  for (let i = 0; i < count; i += 1) s = Core.reduce(s, { type: "openCase", n: queue[i] }, rng);
  return s;
}

/** Play whole rounds until the phase is `offer` for round `round`. */
function toOffer(state, rng = fixed(0.5)) {
  let s = state;
  while (s.toOpen > 0) s = openSome(s, s.toOpen, rng);
  return Core.reduce(s, { type: "bankerOffer" }, rng);
}

/** Deep-freeze so any accidental mutation throws in strict mode. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach((k) => deepFreeze(value[k]));
  }
  return value;
}

/** Every number and every string anywhere inside a value. */
function collect(value, numbers = [], strings = []) {
  if (typeof value === "number") numbers.push(value);
  else if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, numbers, strings));
  else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      strings.push(k);
      collect(value[k], numbers, strings);
    });
  }
  return { numbers, strings };
}

/* ============================================================
   N-U1 — the validator
   ============================================================ */

test("N-U1 the shipped board and its offline mirror both validate", () => {
  assert.equal(Core.validateBoard(SHIPPED), true);
  assert.equal(Core.validateBoard(DEFAULT_BOARD), true);
  assert.deepEqual(DEFAULT_BOARD, SHIPPED, "js/data.js must mirror board.json exactly");
  assert.equal(Core.normalizeBoard(SHIPPED).settings.amounts.length, 26);
});

test("N-U1 rounds may never open more than cases minus two", () => {
  const bad = { settings: { amounts: SMALL.settings.amounts, rounds: [4, 4, 1] } };
  assert.throws(() => Core.validateBoard(bad), /two must stay closed/);
  const edge = { settings: { amounts: SMALL.settings.amounts, rounds: [4, 3, 1] } };
  assert.equal(Core.validateBoard(edge), true, "exactly cases-2 is allowed");
  assert.throws(() => Core.validateBoard({ settings: { rounds: [] } }), /non-empty/);
  assert.throws(() => Core.validateBoard({ settings: { rounds: [3, 0] } }), /above zero/);
  assert.throws(() => Core.validateBoard({ settings: { rounds: [2.5] } }), /above zero/);
});

test("N-U1 amounts must be 10-30 distinct non-negative numbers", () => {
  assert.throws(() => Core.validateBoard({ settings: { amounts: [1, 2, 3] } }), /between 10 and 30/);
  assert.throws(() => Core.validateBoard({ settings: { amounts: new Array(31).fill(0).map((_, i) => i) } }),
    /between 10 and 30/);
  const dupes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 9];
  assert.throws(() => Core.validateBoard({ settings: { amounts: dupes } }), /appears twice/);
  const negative = [-1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.throws(() => Core.validateBoard({ settings: { amounts: negative } }), /non-negative/);
  const strings = ["1", 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.throws(() => Core.validateBoard({ settings: { amounts: strings } }), /non-negative/);
  // Zero is a legal amount; the US board's cheapest case is a cent. (A ten-case
  // board must name its own schedule: the 24-opening default does not fit it.)
  assert.equal(Core.validateBoard({ settings: { amounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rounds: [4, 2, 1, 1] } }), true);
});

test("N-U1 offer factors: one per round, each 0 to 1.5", () => {
  const base = { amounts: SMALL.settings.amounts, rounds: [4, 2, 1, 1] };
  assert.throws(() => Core.validateBoard({ settings: { ...base, offerFactors: [0.2, 0.4] } }),
    /one factor per round/);
  assert.throws(() => Core.validateBoard({ settings: { ...base, offerFactors: [0.2, 0.4, 0.7, 1.6] } }),
    /between 0 and 1.5/);
  assert.equal(Core.validateBoard({ settings: { ...base, offerFactors: [0, 0.4, 0.7, 1.5] } }), true);
});

test("N-U1 jitter, currency, swap and advice flags are checked", () => {
  assert.throws(() => Core.validateBoard({ settings: { jitter: 0.5 } }), /between 0 and 0.2/);
  assert.throws(() => Core.validateBoard({ settings: { jitter: "0.05" } }), /between 0 and 0.2/);
  assert.throws(() => Core.validateBoard({ settings: { currency: "dollars" } }), /at most 3 characters/);
  assert.throws(() => Core.validateBoard({ settings: { allowSwap: "yes" } }), /true or false/);
  assert.throws(() => Core.validateBoard({ settings: { audienceAdvice: 1 } }), /true or false/);
  assert.throws(() => Core.validateBoard("nope"), /expected a JSON object/);
  assert.throws(() => Core.validateBoard({ title: 7 }), /must be text/);
});

test("N-U1 normalizeBoard fills the defaults, sorts the amounts and copies", () => {
  const messy = { settings: { amounts: [5, 1, 3, 9, 7, 2, 8, 4, 6, 10], rounds: [4, 2, 1, 1] } };
  const g = Core.normalizeBoard(messy);
  assert.deepEqual(g.settings.amounts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(messy.settings.amounts, [5, 1, 3, 9, 7, 2, 8, 4, 6, 10], "input untouched");
  assert.deepEqual(Core.normalizeBoard({}).settings.rounds, Core.DEFAULT_ROUNDS.slice());
  assert.equal(g.settings.jitter, 0.05);
  assert.equal(g.settings.allowSwap, true);
  assert.equal(g.settings.currency, "$");
  assert.equal(Core.normalizeBoard({}).title, "Deal or No Deal");
  // A schedule with no factors of its own still gets a rising ramp.
  const ramp = Core.normalizeBoard({ settings: { amounts: SMALL.settings.amounts, rounds: [4, 2, 1, 1] } });
  assert.equal(ramp.settings.offerFactors.length, 4);
  assert.ok(ramp.settings.offerFactors.every((f, i, l) => i === 0 || f > l[i - 1]), "factors rise");
  assert.ok(Core.warningsFor({ settings: { amounts: SMALL.settings.amounts, rounds: [2] } })
    .some((w) => /stay closed/.test(w)));
});

/* ============================================================
   N-U2 — the shuffle
   ============================================================ */

test("N-U2 the shuffle is deterministic under an rng and always a permutation", () => {
  const amounts = Core.DEFAULT_AMOUNTS.slice();
  const a = Core.shuffle(amounts, seq(0.1, 0.7, 0.35, 0.9, 0.5, 0.05));
  const b = Core.shuffle(amounts, seq(0.1, 0.7, 0.35, 0.9, 0.5, 0.05));
  assert.deepEqual(a, b, "same rng, same board");
  assert.deepEqual(a.slice().sort((x, y) => x - y), amounts.slice().sort((x, y) => x - y));
  assert.deepEqual(amounts, Core.DEFAULT_AMOUNTS.slice(), "input untouched");
  const c = Core.shuffle(amounts, seq(0.99, 0.02, 0.55));
  assert.notDeepEqual(a, c, "a different rng gives a different board");
  // An rng that always returns 0 still yields a permutation, not a collapse.
  const zero = Core.shuffle(amounts, fixed(0));
  assert.equal(new Set(zero).size, amounts.length);
});

test("N-U2 seating deals one case per amount, all sealed, numbered 1..N", () => {
  const s = play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }], seq(0.3, 0.8, 0.1));
  assert.equal(s.phase, "pick");
  assert.equal(s.cases.length, 10);
  assert.deepEqual(s.cases.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(s.cases.every((c) => c.opened === false));
  assert.deepEqual(s.cases.map((c) => c.amount).sort((a, b) => a - b), SMALL.settings.amounts);
  // The same seed reproduces the same board exactly.
  const t = play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }], seq(0.3, 0.8, 0.1));
  assert.deepEqual(t.cases, s.cases);
});

/* ============================================================
   N-U3 — the round schedule and the toOpen counters
   ============================================================ */

test("N-U3 picking a case starts round 1 with the scheduled counter", () => {
  const s = seated();
  assert.equal(s.phase, "round");
  assert.equal(s.own, 1);
  assert.equal(s.round, 0);
  assert.equal(s.toOpen, 4);
  assert.equal(Core.caseByN(s, 1).opened, false, "the contestant's case stays sealed");
});

test("N-U3 each opened case decrements the counter and never re-opens", () => {
  let s = seated();
  s = Core.reduce(s, { type: "openCase", n: 2 });
  assert.equal(s.toOpen, 3);
  assert.equal(Core.caseByN(s, 2).opened, true);
  assert.equal(s.lastOpened, 2);
  assert.equal(Core.reduce(s, { type: "openCase", n: 2 }), s, "already open");
  assert.equal(Core.reduce(s, { type: "openCase", n: 1 }), s, "never the contestant's own case");
  assert.equal(Core.reduce(s, { type: "openCase", n: 99 }), s, "no such case");
  assert.equal(Core.reduce(s, { type: "openCase", n: "3" }), s, "not a number");
});

test("N-U3 the counter hits zero and no further case opens until the banker calls", () => {
  let s = openSome(seated(), 4);
  assert.equal(s.toOpen, 0);
  assert.equal(s.phase, "round");
  const free = s.cases.find((c) => !c.opened && c.n !== s.own);
  assert.equal(Core.reduce(s, { type: "openCase", n: free.n }), s, "the round is over");
  s = Core.reduce(s, { type: "bankerOffer" }, fixed(0.5));
  assert.equal(s.phase, "offer");
  s = Core.reduce(s, { type: "noDeal" });
  assert.equal(s.phase, "round");
  assert.equal(s.round, 1);
  assert.equal(s.toOpen, 2, "round 2 opens two");
});

test("N-U3 the whole schedule leaves exactly two cases sealed", () => {
  let s = seated();
  for (let r = 0; r < SMALL.settings.rounds.length; r += 1) {
    s = toOffer(s);
    assert.equal(s.phase, "offer", `round ${r + 1} ends with an offer`);
    if (r < SMALL.settings.rounds.length - 1) s = Core.reduce(s, { type: "noDeal" });
  }
  assert.equal(Core.unopenedCases(s).length, 2);
  assert.equal(Core.otherCases(s).length, 1);
  assert.equal(s.offers.length, 4, "one offer per round");
  assert.deepEqual(s.offers.map((o) => o.round), [0, 1, 2, 3]);
});

test("N-U3 boardColumns splits the amounts low-left / high-right and strikes opened ones", () => {
  const s = openSome(seated(), 2);
  const cols = Core.boardColumns(s);
  assert.equal(cols.left.length, 5);
  assert.equal(cols.right.length, 5);
  assert.deepEqual(cols.left.map((r) => r.amount), [101, 203, 307, 401, 503]);
  assert.deepEqual(cols.right.map((r) => r.amount), [601, 701, 809, 907, 1009]);
  const struck = [...cols.left, ...cols.right].filter((r) => r.opened).map((r) => r.amount);
  const opened = s.cases.filter((c) => c.opened).map((c) => c.amount).sort((a, b) => a - b);
  assert.deepEqual(struck.sort((a, b) => a - b), opened);
  const twentySix = Core.boardColumns(Core.createState(SHIPPED, PLAYERS, {}));
  assert.equal(twentySix.left.length, 13);
  assert.equal(twentySix.right.length, 13);
  assert.equal(twentySix.left[0].label, "$0.01");
  assert.equal(twentySix.right[12].label, "$1,000,000");
});

/* ============================================================
   N-U4 — EV, the offer formula, nice numbers and jitter bounds
   ============================================================ */

test("N-U4 EV is the mean of every sealed amount, the contestant's included", () => {
  const s = seated();
  const all = SMALL.settings.amounts.reduce((a, b) => a + b, 0) / 10;
  assert.equal(Core.ev(s), all);
  const opened = openSome(s, 4);
  const left = opened.cases.filter((c) => !c.opened).map((c) => c.amount);
  assert.equal(left.length, 6);
  assert.ok(left.includes(Core.caseByN(opened, opened.own).amount), "own case counts towards EV");
  assert.equal(Core.ev(opened), left.reduce((a, b) => a + b, 0) / left.length);
});

test("N-U4 nice-number rounding uses the three bands", () => {
  assert.equal(Content.niceOffer(5432), 5400);
  assert.equal(Content.niceOffer(9949), 9900);
  assert.equal(Content.niceOffer(15777), 16000);
  assert.equal(Content.niceOffer(99400), 99000);
  assert.equal(Content.niceOffer(234567), 235000);
  assert.equal(Content.niceOffer(1000000), 1000000);
  assert.equal(Content.niceOffer(0), 0);
  assert.equal(Content.niceOffer(-5), 0);
  // The guard: a board down to pennies still gets a real offer, to the cent.
  assert.equal(Content.niceOffer(0.505), 0.51);
  assert.equal(Content.niceOffer(3), 3);
});

test("N-U4 the offer is EV x factor x (1 + jitter), rounded", () => {
  const s = seated();
  const mean = Core.ev(s);
  assert.equal(Core.factorFor(s), 0.2);
  assert.equal(Core.offerFor(s, fixed(0.5)), Content.niceOffer(mean * 0.2), "rng 0.5 is no jitter");
  assert.equal(Core.offerFor(s, fixed(0)), Content.niceOffer(mean * 0.2 * 0.95));
  assert.equal(Core.offerFor(s, fixed(1)), Content.niceOffer(mean * 0.2 * 1.05));
  // The factor rises with the round.
  const later = Core.reduce(toOffer(s), { type: "noDeal" });
  assert.equal(Core.factorFor(later), 0.4);
});

test("N-U4 jitter never leaves the band the file allows", () => {
  const s = seated();
  const mean = Core.ev(s);
  const factor = Core.factorFor(s);
  const lo = mean * factor * 0.95;
  const hi = mean * factor * 1.05;
  for (let i = 0; i <= 20; i += 1) {
    const raw = mean * factor * Content.jitterFactor(0.05, fixed(i / 20));
    assert.ok(raw >= lo - 1e-9 && raw <= hi + 1e-9, `raw ${raw} outside [${lo}, ${hi}]`);
  }
  // Hostile rngs are clamped rather than trusted.
  assert.equal(Content.jitterFactor(0.05, fixed(9)), 1.05);
  assert.equal(Content.jitterFactor(0.05, fixed(-9)), 0.95);
  assert.equal(Content.jitterFactor(0.05, fixed(NaN)), 1);
  assert.equal(Content.jitterFactor(5, fixed(1)), 1.2, "jitter itself is capped at 0.2");
  const none = Core.createState({ settings: { ...SMALL.settings, jitter: 0 } }, PLAYERS, {});
  const board = play(none, [{ type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 }]);
  assert.equal(Core.offerFor(board, fixed(0)), Core.offerFor(board, fixed(1)), "jitter 0 is repeatable");
});

test("N-U4 the banker records the offer and the EV it came from", () => {
  const s = toOffer(seated(), fixed(0.5));
  assert.equal(s.phase, "offer");
  assert.equal(s.offers.length, 1);
  assert.equal(s.offers[0].offer, s.offer);
  assert.equal(s.offers[0].round, 0);
  assert.ok(s.offers[0].ev > 0);
  assert.equal(Core.reduce(s, { type: "bankerOffer" }, fixed(0.5)), s, "one call per round");
});

/* ============================================================
   N-U5 — Deal ends the game and records the offer
   ============================================================ */

test("N-U5 Deal freezes the offer, ends the board and pays exactly that", () => {
  const offered = toOffer(seated(), fixed(0.5));
  const amount = offered.offer;
  let s = Core.reduce(offered, { type: "deal" });
  assert.equal(s.phase, "reveal");
  assert.deepEqual(s.deal, { offer: amount, round: 0 });
  assert.equal(Core.reduce(s, { type: "openCase", n: 3 }), s, "no more rounds after a deal");
  assert.equal(Core.reduce(s, { type: "bankerOffer" }, fixed(0.5)), s);
  while (Core.revealOrder(s).length) s = Core.reduce(s, { type: "revealRest" });
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.won, amount);
  assert.equal(s.outcome.reason, "deal");
  assert.equal(s.outcome.wouldHaveWon, Core.caseByN(s, s.own).amount);
  const me = s.contestants.find((c) => c.pid === "p1");
  assert.equal(me.won, amount);
  assert.equal(me.out, true);
});

test("N-U5 No Deal to the end pays whatever is in the case", () => {
  let s = seated();
  for (let r = 0; r < SMALL.settings.rounds.length; r += 1) {
    s = toOffer(s);
    s = Core.reduce(s, { type: "noDeal" });
  }
  assert.equal(s.phase, "swap");
  s = Core.reduce(s, { type: "swap", yes: false });
  assert.equal(s.phase, "reveal");
  const inside = Core.caseByN(s, s.own).amount;
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.won, inside);
  assert.equal(s.outcome.reason, "case");
  assert.equal(s.deal, null);
  assert.ok(s.cases.every((c) => c.opened), "the last mystery case opens too");
});

test("N-U5 the night runs contestant by contestant and reaches standings", () => {
  let s = seated();
  s = Core.reduce(toOffer(s), { type: "deal" });
  while (Core.revealOrder(s).length) s = Core.reduce(s, { type: "revealRest" });
  s = Core.reduce(s, { type: "revealOwn" });
  const first = s.outcome.won;
  s = Core.reduce(s, { type: "nextContestant" });
  assert.equal(s.phase, "seat");
  assert.equal(s.current, null);
  assert.equal(s.cases.length, 0, "a fresh board for the next contestant");
  assert.deepEqual(Core.waitingContestants(s).map((c) => c.pid), ["p2", "p3"]);
  assert.equal(Core.reduce(s, { type: "seat", pid: "p1" }), s, "p1 has already played");
  s = Core.reduce(s, { type: "finish" });
  assert.equal(s.phase, "standings");
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, first);
  assert.equal(Core.standings(s)[0].pid, "p1", "the only player who banked leads");
});

test("N-U5 ending the night mid-board banks a struck deal and nothing else", () => {
  const mid = openSome(seated(), 2);
  const walked = Core.reduce(mid, { type: "finish" });
  assert.equal(walked.phase, "standings");
  assert.equal(walked.contestants.find((c) => c.pid === "p1").won, 0);
  assert.equal(walked.outcome.reason, "unfinished");
  const dealt = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  const banked = Core.reduce(dealt, { type: "finish" });
  assert.equal(banked.contestants.find((c) => c.pid === "p1").won, dealt.deal.offer);
  assert.equal(banked.outcome.reason, "deal");
});

/* ============================================================
   N-U6 — the swap
   ============================================================ */

test("N-U6 the swap is offered only with two cases left, and only when allowed", () => {
  let s = seated();
  assert.equal(Core.reduce(s, { type: "swap", yes: true }), s, "not during a round");
  s = toOffer(s);
  assert.equal(Core.reduce(s, { type: "swap", yes: true }), s, "not on an offer");
  s = Core.reduce(s, { type: "noDeal" });
  assert.equal(s.phase, "round", "three rounds still to play");

  const noSwap = { ...SMALL, settings: { ...SMALL.settings, allowSwap: false } };
  let t = seated(noSwap);
  for (let r = 0; r < noSwap.settings.rounds.length; r += 1) {
    t = Core.reduce(toOffer(t), { type: "noDeal" });
  }
  assert.equal(t.phase, "reveal", "with the swap off the reveal starts immediately");
  assert.equal(t.swapped, false);
});

test("N-U6 swapping changes which case the contestant is holding", () => {
  let s = seated();
  for (let r = 0; r < SMALL.settings.rounds.length; r += 1) {
    s = Core.reduce(toOffer(s), { type: "noDeal" });
  }
  assert.equal(s.phase, "swap");
  const before = s.own;
  const other = Core.otherCases(s)[0].n;
  const kept = Core.reduce(s, { type: "swap", yes: false });
  assert.equal(kept.own, before);
  assert.equal(kept.swapped, false);
  const swapped = Core.reduce(s, { type: "swap", yes: true });
  assert.equal(swapped.own, other);
  assert.equal(swapped.swapped, true);
  assert.equal(swapped.phase, "reveal");
  const won = Core.reduce(swapped, { type: "revealOwn" });
  assert.equal(won.outcome.won, Core.caseByN(s, other).amount, "the swapped case pays");
  assert.equal(won.outcome.swapped, true);
});

/* ============================================================
   N-U7 — audience advice
   ============================================================ */

test("N-U7 advice opens with the offer, excludes the contestant and takes one vote each", () => {
  let s = toOffer(seated(), fixed(0.5));
  assert.equal(s.advice.open, true);
  assert.equal(s.advice.round, 0);
  s = Core.reduce(s, { type: "adviceVote", pid: "p1", choice: "deal" });
  assert.deepEqual(s.advice.votes, {}, "the contestant never advises themselves");
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" });
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "no" });
  assert.deepEqual(s.advice.votes, { p2: "deal" }, "the first tap counts");
  s = Core.reduce(s, { type: "adviceVote", pid: "p3", choice: "no" });
  s = Core.reduce(s, { type: "adviceVote", pid: "px", choice: "maybe" });
  assert.deepEqual(s.advice.votes, { p2: "deal", p3: "no" });
  assert.deepEqual(Core.adviceCounts(s), [1, 1]);
  assert.deepEqual(Core.adviceChart(s).pcts, [50, 50]);
  assert.equal(Core.adviceChart(s).total, 2);
  assert.equal(s.history.every((h) => h.advice), true);
});

test("N-U7 closing the vote freezes the split and stops new votes", () => {
  let s = toOffer(seated(), fixed(0.5));
  s = play(s, [
    { type: "adviceVote", pid: "p2", choice: "deal" },
    { type: "adviceVote", pid: "p3", choice: "deal" },
    { type: "adviceClose" },
  ]);
  assert.equal(s.advice.open, false);
  assert.deepEqual(s.advice.chart, [100, 0]);
  assert.equal(Core.adviceChart(s).source, "closed");
  const after = Core.reduce(s, { type: "adviceVote", pid: "px", choice: "no" });
  assert.equal(after, s, "the vote is shut");
  assert.equal(Core.reduce(s, { type: "adviceClose" }), s, "closing twice is a no-op");
  // Deal / No Deal close the vote themselves.
  const live = toOffer(seated(), fixed(0.5));
  assert.equal(Core.reduce(live, { type: "deal" }).advice.open, false);
  assert.equal(Core.reduce(live, { type: "noDeal" }).advice.open, false);
});

test("N-U7 a board with audienceAdvice off never opens a vote", () => {
  const quiet = { ...SMALL, settings: { ...SMALL.settings, audienceAdvice: false } };
  const s = toOffer(seated(quiet), fixed(0.5));
  assert.equal(s.advice.open, false);
  assert.equal(Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" }), s);
});

/* ============================================================
   N-U8 — the would-have-won reveal
   ============================================================ */

test("N-U8 after a Deal the remaining cases open in order, the contestant's last", () => {
  let s = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  const expected = s.cases.filter((c) => !c.opened && c.n !== s.own).map((c) => c.n).sort((a, b) => a - b);
  assert.deepEqual(Core.revealOrder(s), expected);
  const seen = [];
  while (Core.revealOrder(s).length) {
    s = Core.reduce(s, { type: "revealRest" });
    seen.push(s.lastOpened);
  }
  assert.deepEqual(seen, expected, "lowest case number first");
  assert.equal(Core.caseByN(s, s.own).opened, false, "the contestant's case is still sealed");
  assert.equal(Core.reduce(s, { type: "revealRest" }), s, "nothing left to reveal");
  const inside = Core.caseByN(s, s.own).amount;
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.wouldHaveWon, inside);
  assert.notEqual(s.outcome.won, undefined);
  assert.ok(s.cases.every((c) => c.opened));
  assert.equal(Core.reduce(s, { type: "revealOwn" }), s, "only once");
});

test("N-U8 the whole board can be revealed straight after an early deal", () => {
  const s = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  assert.equal(Core.revealOrder(s).length, 5, "ten cases, four opened, own held back");
  const done = Core.reduce(s, { type: "revealOwn" });
  assert.equal(done.phase, "result");
  assert.equal(done.cases.filter((c) => !c.opened).length, 5,
    "the host may stop the ceremony early; the rest stay sealed");
});

/* ============================================================
   N-U9 — undo, illegal events, immutability
   ============================================================ */

test("N-U9 unknown and illegal events return the very same object", () => {
  const s = seated();
  assert.equal(Core.reduce(s, { type: "nope" }), s);
  assert.equal(Core.reduce(s, {}), s);
  assert.equal(Core.reduce(s, null), s);
  assert.equal(Core.reduce(s, "deal"), s);
  assert.equal(Core.reduce(null, { type: "deal" }), null);
  assert.equal(Core.reduce(s, { type: "deal" }), s, "no offer on the table");
  assert.equal(Core.reduce(s, { type: "noDeal" }), s);
  assert.equal(Core.reduce(s, { type: "revealOwn" }), s);
  assert.equal(Core.reduce(s, { type: "pickCase", n: 4 }), s, "the case is already picked");
  assert.equal(Core.reduce(s, { type: "start" }), s);
  assert.equal(Core.reduce(s, { type: "nextContestant" }), s);
  assert.equal(Core.reduce(s, { type: "seat", pid: "p2" }), s, "somebody is already playing");
});

test("N-U9 undo steps back exactly one move and keeps the board", () => {
  const before = openSome(seated(), 2);
  const after = Core.reduce(before, { type: "openCase", n: Core.otherCases(before)[0].n });
  const back = Core.reduce(after, { type: "undo" });
  assert.equal(back.toOpen, before.toOpen);
  assert.deepEqual(back.cases, before.cases);
  assert.equal(back.phase, before.phase);
  assert.ok(back.game, "undo restores the board settings, not just the play state");
  assert.deepEqual(back.game, before.game);
  // Undo unwinds a deal, an offer and a pick in turn.
  let s = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  s = Core.reduce(s, { type: "undo" });
  assert.equal(s.phase, "offer");
  assert.equal(s.deal, null);
  s = Core.reduce(s, { type: "undo" });
  assert.equal(s.phase, "round");
  assert.equal(s.offers.length, 0);
  const empty = fresh();
  assert.equal(Core.reduce(empty, { type: "undo" }), empty, "nothing to undo");
});

test("N-U9 votes are not undo steps, so undo never eats a move", () => {
  const s = toOffer(seated(), fixed(0.5));
  const depth = s.history.length;
  const voted = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" });
  assert.equal(voted.history.length, depth, "a vote adds no history");
  const back = Core.reduce(voted, { type: "undo" });
  assert.equal(back.phase, "round", "undo steps back past the banker's call");
});

test("N-U9 the reducer never mutates the state it is handed", () => {
  const s = deepFreeze(seated());
  const opened = Core.reduce(s, { type: "openCase", n: Core.otherCases(s)[0].n });
  assert.notEqual(opened, s);
  assert.equal(s.toOpen, 4, "the original counter is untouched");
  assert.ok(s.cases.every((c) => !c.opened));
  const offered = Core.reduce(deepFreeze(openSome(s, 4)), { type: "bankerOffer" }, fixed(0.5));
  assert.ok(offered.offer > 0);
  const board = deepFreeze(JSON.parse(JSON.stringify(SMALL)));
  const built = Core.createState(board, deepFreeze([{ pid: "p1", name: "Ada" }]), {});
  assert.equal(built.phase, "setup");
  assert.notEqual(built.game.settings.amounts, board.settings.amounts, "copies, not references");
});

test("N-U9 legalActions names exactly the buttons the host may press", () => {
  assert.deepEqual(Core.legalActions(fresh()), ["start"], "nothing to finish before the first case");
  const seat = Core.reduce(fresh(), { type: "start" });
  assert.ok(Core.legalActions(seat).includes("seat"));
  const round = seated();
  assert.ok(Core.legalActions(round).includes("openCase"));
  assert.ok(!Core.legalActions(round).includes("bankerOffer"));
  const ready = openSome(round, 4);
  assert.ok(Core.legalActions(ready).includes("bankerOffer"));
  const offer = Core.reduce(ready, { type: "bankerOffer" }, fixed(0.5));
  assert.deepEqual(Core.legalActions(offer).filter((a) => a === "deal" || a === "noDeal").sort(),
    ["deal", "noDeal"]);
  assert.ok(Core.legalActions(offer).includes("undo"));
});

/* ============================================================
   N-U10 — phone payloads: no unopened amount ever leaves the host
   ============================================================ */

test("N-U10 validatePhoneMsg accepts the three intents and nothing else", () => {
  assert.deepEqual(Core.validatePhoneMsg({ t: "pick", n: 7 }), { t: "pick", n: 7 });
  assert.deepEqual(Core.validatePhoneMsg({ t: "decision", choice: "deal" }), { t: "decision", choice: "deal" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "advice", choice: "no" }), { t: "advice", choice: "no" });
  [
    null, undefined, 7, "pick", [], { t: 1 }, { t: "pick" }, { t: "pick", n: 0 },
    { t: "pick", n: -1 }, { t: "pick", n: 1.5 }, { t: "pick", n: 999 }, { t: "pick", n: "3" },
    { t: "decision", choice: "DEAL" }, { t: "decision" }, { t: "advice", choice: 1 },
    { t: "vote", idx: 0 }, { t: "__proto__" },
  ].forEach((junk) => {
    assert.equal(Core.validatePhoneMsg(junk), null, `${JSON.stringify(junk)} must be rejected`);
  });
  // The extra fields on a valid frame are dropped, not copied through.
  assert.deepEqual(Core.validatePhoneMsg({ t: "pick", n: 2, evil: "x" }), { t: "pick", n: 2 });
});

test("N-U10 no phoneView ever carries the amount inside an unopened case", () => {
  const pids = ["p1", "p2", "p3", "px"];
  const scan = (state, label) => {
    const sealed = state.cases.filter((c) => !c.opened);
    pids.forEach((pid) => {
      const view = Core.phoneView(state, pid);
      const { numbers, strings } = collect(view);
      sealed.forEach((c) => {
        assert.ok(!numbers.includes(c.amount),
          `${label}: ${pid} was told the number ${c.amount} from sealed case ${c.n}`);
        const money = Core.formatMoney(state, c.amount);
        assert.ok(!strings.includes(money),
          `${label}: ${pid} was told ${money} from sealed case ${c.n}`);
      });
      assert.equal(JSON.stringify(view).indexOf("\"amount\""), -1, `${label}: raw amounts in ${pid}'s view`);
    });
  };

  let s = seated();
  scan(s, "round 1 opening");
  s = openSome(s, 4);
  scan(s, "round 1 complete");
  s = Core.reduce(s, { type: "bankerOffer" }, fixed(0.5));
  scan(s, "banker's offer");
  s = Core.reduce(s, { type: "noDeal" });
  for (let r = 1; r < SMALL.settings.rounds.length; r += 1) {
    s = toOffer(s);
    scan(s, `offer ${r + 1}`);
    s = Core.reduce(s, { type: "noDeal" });
  }
  scan(s, "the swap");
  s = Core.reduce(s, { type: "swap", yes: true });
  scan(s, "the reveal");
  s = Core.reduce(s, { type: "revealOwn" });
  scan(s, "the result");
});

test("N-U10 the phone views say exactly what each screen should", () => {
  let s = seated();
  assert.equal(Core.phoneView(s, "p1").screen, "pick");
  assert.equal(Core.phoneView(s, "p1").mode, "open");
  assert.equal(Core.phoneView(s, "p2").screen, "wait");
  assert.equal(Core.phoneView(s, "p2").spectator, false);
  assert.equal(Core.phoneView(s, "px").spectator, true);
  const picking = play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }]);
  assert.equal(Core.phoneView(picking, "p1").mode, "own");
  assert.equal(Core.phoneView(picking, "p1").cases.length, 10);
  assert.ok(Core.phoneView(picking, "p1").cases.every((c) => c.label === ""));

  s = toOffer(s, fixed(0.5));
  assert.equal(Core.phoneView(s, "p1").screen, "decision");
  assert.equal(Core.phoneView(s, "p1").offer, Core.formatMoney(s, s.offer));
  assert.equal(Core.phoneView(s, "p2").screen, "advice");
  assert.equal(Core.phoneView(s, "p2").myVote, null);
  const voted = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "no" });
  assert.equal(Core.phoneView(voted, "p2").myVote, "no");
  assert.equal(Core.phoneView(voted, "p3").myVote, null, "nobody sees another phone's vote");
  const closed = Core.reduce(s, { type: "adviceClose" });
  assert.equal(Core.phoneView(closed, "p2").screen, "wait");

  const opened = openSome(seated(), 2);
  const grid = Core.phoneView(opened, "p1").cases;
  assert.equal(grid.filter((c) => c.opened).length, 2);
  assert.ok(grid.filter((c) => c.opened).every((c) => c.label.startsWith("$")));
  assert.ok(grid.filter((c) => !c.opened).every((c) => c.label === ""));

  let done = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  done = Core.reduce(done, { type: "revealOwn" });
  const mine = Core.phoneView(done, "p1");
  assert.equal(mine.screen, "result");
  assert.equal(mine.yours, Core.formatMoney(done, done.outcome.won));
  assert.equal(Core.phoneView(done, "p2").yours, null);
  assert.equal(Core.phoneView(done, "p2").standings.length, 3);
});

/* ============================================================
   N-U5b — the contestant's phone asks; only the host acts
   ============================================================ */

test("N-U5 a phone decision is a request the host must confirm", () => {
  const offered = toOffer(seated(), fixed(0.5));
  assert.equal(offered.request, null);
  let s = Core.reduce(offered, { type: "request", pid: "p2", choice: "deal" });
  assert.equal(s, offered, "only the contestant may decide");
  s = Core.reduce(offered, { type: "request", pid: "p1", choice: "maybe" });
  assert.equal(s, offered, "only deal or no");
  s = Core.reduce(offered, { type: "request", pid: "p1", choice: "deal" });
  assert.deepEqual(s.request, { pid: "p1", choice: "deal" });
  assert.equal(s.phase, "offer", "asking changes nothing else");
  assert.equal(s.deal, null);
  assert.equal(s.history.length, offered.history.length, "a request is not an undo step");
  assert.equal(Core.reduce(s, { type: "request", pid: "p1", choice: "deal" }), s, "asking twice is a no-op");
  // The host presses the button; the request goes with the offer.
  assert.equal(Core.reduce(s, { type: "deal" }).request, null);
  assert.equal(Core.reduce(s, { type: "noDeal" }).request, null);
  assert.equal(Core.reduce(s, { type: "clearRequest" }).request, null);
  assert.equal(Core.reduce(offered, { type: "clearRequest" }), offered, "nothing to clear");
  // A request is never legal outside an offer.
  assert.equal(Core.reduce(seated(), { type: "request", pid: "p1", choice: "deal" }).request, null);
  // The contestant's own phone sees what it asked for; nobody else's does.
  assert.equal(Core.phoneView(s, "p1").asked, "deal");
  assert.equal(Core.phoneView(s, "p2").asked, undefined);
});
