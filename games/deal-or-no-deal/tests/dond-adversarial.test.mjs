/* ============================================================
   Deal or No Deal — ADVERSARIAL unit suite (independent tester)
   Written against docs/12-deal-or-no-deal-spec.md, not against the
   implementation. Everything here tries to break the core: hostile
   rngs, hostile boards, hostile phone frames, events fired in the
   wrong phase, and a structural leak probe that works on ANY board.
   Zero dependencies: node --test from games/deal-or-no-deal.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/dond-core.js");
const Content = require("../js/dond-content.js");

/* ============ Fixtures and helpers ============ */

const fixed = (v) => () => v;

/** Cycles through the values it is given, so a whole game is scripted. */
function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** A cheap deterministic PRNG so two "seeds" really differ. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
];

/** Ten cases, four rounds, whole-dollar amounts big enough for every band. */
const BOARD = Object.freeze({
  title: "Adversarial ten",
  settings: {
    currency: "$",
    amounts: [1, 7, 53, 411, 3017, 9973, 40009, 150011, 640007, 990013],
    rounds: [4, 2, 1, 1],
    offerFactors: [0.12, 0.4, 0.7, 1.0],
    jitter: 0.05,
    allowSwap: true,
    audienceAdvice: true,
  },
});

/** Every amount under $50 — this is where the spec's bands round to zero. */
const PENNY_BOARD = Object.freeze({
  title: "Pennies",
  settings: {
    currency: "$",
    amounts: [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    rounds: [4, 2, 1, 1],
    offerFactors: [0.12, 0.4, 0.7, 1.0],
    jitter: 0.05,
    allowSwap: true,
    audienceAdvice: true,
  },
});

function fresh(board = BOARD, players = PLAYERS) {
  return Core.createState(board, players, {});
}

function run(state, events, rng = fixed(0.5)) {
  return events.reduce((s, e) => Core.reduce(s, e, rng), state);
}

/** Seated on a shuffled board, holding case `own`. */
function seated(board = BOARD, own = 1, rng = fixed(0.5), pid = "p1") {
  return run(fresh(board), [
    { type: "start" }, { type: "seat", pid }, { type: "pickCase", n: own },
  ], rng);
}

/** Open exactly `toOpen` cases, lowest number first, skipping the own case. */
function finishRound(state, rng = fixed(0.5)) {
  let s = state;
  const queue = s.cases.filter((c) => !c.opened && c.n !== s.own).map((c) => c.n);
  let i = 0;
  while (s.toOpen > 0) {
    s = Core.reduce(s, { type: "openCase", n: queue[i] }, rng);
    i += 1;
  }
  return s;
}

function toOffer(state, rng = fixed(0.5)) {
  return Core.reduce(finishRound(state, rng), { type: "bankerOffer" }, rng);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach((k) => deepFreeze(value[k]));
  }
  return value;
}

/** Every number and every string anywhere inside a value (keys included). */
function collect(value, numbers = [], strings = []) {
  if (typeof value === "number") numbers.push(value);
  else if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, numbers, strings));
  else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => { strings.push(k); collect(value[k], numbers, strings); });
  }
  return { numbers, strings };
}

/* ============================================================
   A1 — the offer formula, every round, at both jitter extremes
   ============================================================ */

test("A1 the offer is niceOffer(EV x factor x (1 + jitter)) at every round", () => {
  const factors = BOARD.settings.offerFactors;
  [0, 0.5, 1].forEach((r) => {
    let s = seated(BOARD, 1, fixed(0.5));
    for (let round = 0; round < factors.length; round += 1) {
      s = finishRound(s);
      assert.equal(s.round, round, `round counter at ${round}`);
      assert.equal(Core.factorFor(s), factors[round], `factor for round ${round}`);
      // The selector, the reducer and hand arithmetic must all agree.
      const mean = Core.ev(s);
      const mult = 1 + (r * 2 - 1) * BOARD.settings.jitter;
      const expected = Content.niceOffer(mean * factors[round] * mult);
      assert.equal(Core.offerFor(s, fixed(r)), expected, `offerFor r=${r} round=${round}`);
      const offered = Core.reduce(s, { type: "bankerOffer" }, fixed(r));
      assert.equal(offered.offer, expected, `reducer offer r=${r} round=${round}`);
      assert.equal(offered.offers[offered.offers.length - 1].ev, mean);
      assert.equal(offered.offers[offered.offers.length - 1].round, round);
      s = Core.reduce(offered, { type: "noDeal" });
    }
    assert.equal(s.phase, "swap", "four rounds then the swap");
  });
});

test("A1 the offer never leaves the +/- jitter band, whatever the rng returns", () => {
  const s = finishRound(seated());
  const mean = Core.ev(s);
  const factor = Core.factorFor(s);
  const lo = mean * factor * 0.95;
  const hi = mean * factor * 1.05;
  // A nice-number offer can round outside the raw band by at most half a band
  // step, so the raw product is what must stay inside it.
  [-99, 0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, 99, NaN, Infinity, -Infinity].forEach((v) => {
    const raw = mean * factor * Content.jitterFactor(0.05, fixed(v));
    assert.ok(raw >= lo - 1e-9 && raw <= hi + 1e-9, `rng ${v} produced ${raw}`);
    assert.ok(Number.isFinite(Core.offerFor(s, fixed(v))), `rng ${v} gave a finite offer`);
  });
  // A non-function rng must not throw and must not leave the band either.
  [null, undefined, 0.5, "0.5", {}].forEach((bad) => {
    const offer = Core.offerFor(s, bad);
    assert.ok(Number.isFinite(offer) && offer >= 0, `rng ${String(bad)} gave ${offer}`);
  });
});

test("A1 nice-number bands, including both edges of each band", () => {
  const cases = [
    [49.99, 0], [50, 100], [51, 100], [149, 100], [150, 200],
    [9949, 9900], [9950, 10000], [9999, 10000],
    [10000, 10000], [10499, 10000], [10500, 11000], [99499, 99000], [99500, 100000],
    [100000, 100000], [102499, 100000], [102500, 105000], [1000000, 1000000],
    [999999, 1000000],
  ];
  cases.forEach(([raw, want]) => {
    // The band the spec names, applied by hand.
    let expected;
    if (raw < 10000) expected = Math.round(raw / 100) * 100;
    else if (raw < 100000) expected = Math.round(raw / 1000) * 1000;
    else expected = Math.round(raw / 5000) * 5000;
    assert.equal(expected, want, `my own band maths for ${raw}`);
    if (want > 0) assert.equal(Content.niceOffer(raw), want, `niceOffer(${raw})`);
  });
});

test("A1 DEVIATION: offers the spec would round to zero go to the nearest dollar", () => {
  // Spec 12 §1.3 says "nearest 100 under 10k" full stop, so anything under $50
  // is $0. The implementation rounds to the nearest WHOLE DOLLAR instead, with
  // a floor of one cent (revised after this tester's note that cent precision
  // was not a "nice" number in any sense the spec would recognise). This test
  // PINS the shipped behaviour; the deviation is reported in the verification.
  assert.equal(Content.niceOffer(49.99), 50, "spec says 0, code says 50");
  assert.equal(Content.niceOffer(49.4), 49);
  assert.equal(Content.niceOffer(0.005), 0.01, "the cent floor");
  assert.equal(Content.niceOffer(0.49), 0.01);
  assert.equal(Content.niceOffer(3.146), 3);
  assert.equal(Content.niceOffer(0), 0);
  assert.equal(Content.niceOffer(-1), 0);
  assert.equal(Content.niceOffer(NaN), 0);
  // Below $50 every offer is now a whole number of dollars (or the one-cent
  // floor), so the banker never reads out a value like $3.15.
  for (let raw = 0.5; raw < 50; raw += 0.37) {
    const v = Content.niceOffer(raw);
    assert.ok(Number.isInteger(v) || v === 0.01, `niceOffer(${raw}) = ${v} is not a whole dollar`);
  }
  const s = finishRound(seated(PENNY_BOARD, 1, fixed(0.5)));
  const offer = Core.offerFor(s, fixed(0.5));
  assert.ok(offer > 0, "a penny board still gets a real offer");
  assert.equal(offer, Math.max(0.01, Math.round(Core.ev(s) * 0.12)));
  assert.ok(offer < 50, "and it is under $50, where the guard applies");
});

test("A1 jitter 0 makes the banker repeatable, and jitter is capped at 0.2", () => {
  const flat = Core.createState(
    { settings: Object.assign({}, BOARD.settings, { jitter: 0 }) }, PLAYERS, {},
  );
  const s = finishRound(run(flat, [
    { type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 },
  ]));
  assert.equal(Core.offerFor(s, fixed(0)), Core.offerFor(s, fixed(1)));
  assert.equal(Content.jitterFactor(0.2, fixed(1)), 1.2);
  assert.equal(Content.jitterFactor(999, fixed(1)), 1.2, "capped");
  assert.equal(Content.jitterFactor(-1, fixed(0)), 1, "negative jitter is no jitter");
});

/* ============================================================
   A2 — EV after every single opening
   ============================================================ */

test("A2 EV is the mean of every sealed amount after each opening, own included", () => {
  let s = seated();
  const total = BOARD.settings.amounts.reduce((a, b) => a + b, 0);
  assert.equal(Core.ev(s), total / 10);
  let sum = total;
  let left = 10;
  const queue = s.cases.filter((c) => c.n !== s.own).map((c) => c.n);
  for (let i = 0; i < queue.length; i += 1) {
    const amount = Core.caseByN(s, queue[i]).amount;
    const before = s;
    s = Core.reduce(s, { type: "openCase", n: queue[i] });
    if (s === before) {                       // the round ran out: start the next
      s = Core.reduce(Core.reduce(s, { type: "bankerOffer" }), { type: "noDeal" });
      s = Core.reduce(s, { type: "openCase", n: queue[i] });
    }
    sum -= amount;
    left -= 1;
    assert.equal(Core.ev(s), sum / left, `EV after opening case ${queue[i]}`);
    assert.equal(Core.remainingAmounts(s).length, left);
    if (left === 2) break;
  }
  assert.equal(Core.ev({ cases: [] }), 0, "an empty board has no average");
});

/* ============================================================
   A3 — Deal at the first offer and at the last
   ============================================================ */

test("A3 Deal at round 1 pays the offer and the case is only a might-have-been", () => {
  const offered = toOffer(seated(), fixed(0.5));
  const amount = offered.offer;
  let s = Core.reduce(offered, { type: "deal" });
  assert.equal(s.phase, "reveal");
  assert.deepEqual(s.deal, { offer: amount, round: 0 });
  // Nothing about the board may move again except the reveal.
  ["openCase", "bankerOffer", "noDeal", "pickCase"].forEach((type) => {
    assert.equal(Core.reduce(s, { type, n: 2 }, fixed(0.5)), s, `${type} after a deal`);
  });
  assert.equal(Core.reduce(s, { type: "swap", yes: true }), s, "no swap after a deal");
  while (Core.revealOrder(s).length) s = Core.reduce(s, { type: "revealRest" });
  const held = Core.caseByN(s, s.own).amount;
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.phase, "result");
  assert.equal(s.outcome.won, amount);
  assert.equal(s.outcome.wouldHaveWon, held);
  assert.equal(s.outcome.reason, "deal");
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, amount);
  assert.ok(s.cases.every((c) => c.opened), "the whole board is open at the end");
});

test("A3 Deal at the LAST offer still ends the board on the offer", () => {
  let s = seated();
  const rounds = BOARD.settings.rounds.length;
  for (let r = 0; r < rounds - 1; r += 1) s = Core.reduce(toOffer(s), { type: "noDeal" });
  s = toOffer(s);
  assert.equal(s.round, rounds - 1, "the final round");
  assert.equal(Core.otherCases(s).length, 1, "one case left besides their own");
  const amount = s.offer;
  s = Core.reduce(s, { type: "deal" });
  assert.equal(s.phase, "reveal", "a deal skips the swap entirely");
  assert.equal(s.swapped, false);
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.won, amount);
  assert.ok(s.cases.every((c) => c.opened), "the lone survivor opens with their case");
});

/* ============================================================
   A4 — No Deal to the end, with and without the swap
   ============================================================ */

test("A4 No Deal all the way, keeping the case, pays what is inside it", () => {
  let s = seated();
  for (let r = 0; r < BOARD.settings.rounds.length; r += 1) {
    s = Core.reduce(toOffer(s), { type: "noDeal" });
  }
  assert.equal(s.phase, "swap");
  const mine = s.own;
  const held = Core.caseByN(s, mine).amount;
  s = Core.reduce(s, { type: "swap", yes: false });
  assert.equal(s.own, mine, "declining the swap keeps the same case");
  assert.equal(s.swapped, false);
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.won, held);
  assert.equal(s.outcome.reason, "case");
  assert.equal(s.outcome.swapped, false);
  assert.equal(s.deal, null);
});

test("A4 No Deal all the way, swapping, pays what is in the OTHER case", () => {
  let s = seated();
  for (let r = 0; r < BOARD.settings.rounds.length; r += 1) {
    s = Core.reduce(toOffer(s), { type: "noDeal" });
  }
  const mine = s.own;
  const other = Core.otherCases(s)[0];
  const theirs = other.amount;
  s = Core.reduce(s, { type: "swap", yes: true });
  assert.equal(s.own, other.n);
  assert.notEqual(s.own, mine);
  assert.equal(s.swapped, true);
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.won, theirs, "they win what they swapped into");
  assert.equal(s.outcome.swapped, true);
  assert.ok(s.cases.every((c) => c.opened), "the case they gave up opens too");
});

test("A4 the swap is refused everywhere except the swap phase", () => {
  const board = seated();
  [board, finishRound(board), toOffer(board)].forEach((s) => {
    assert.equal(Core.reduce(s, { type: "swap", yes: true }), s, `swap in ${s.phase}`);
  });
  let mid = Core.reduce(toOffer(board), { type: "noDeal" });   // back to round 2
  assert.equal(mid.phase, "round");
  assert.equal(Core.reduce(mid, { type: "swap", yes: true }), mid);
});

test("A4 allowSwap:false goes straight to the reveal with two cases left", () => {
  const noSwap = { title: "No swap", settings: Object.assign({}, BOARD.settings, { allowSwap: false }) };
  let s = seated(noSwap);
  for (let r = 0; r < noSwap.settings.rounds.length; r += 1) {
    s = Core.reduce(toOffer(s), { type: "noDeal" });
  }
  assert.equal(s.phase, "reveal", "no swap offered");
  assert.equal(Core.reduce(s, { type: "swap", yes: true }), s, "and the event is dead");
  assert.equal(Core.otherCases(s).length, 1);
  const held = Core.caseByN(s, s.own).amount;
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.outcome.won, held);
  assert.equal(s.outcome.swapped, false);
});

test("A4 a schedule that leaves more than two cases skips the swap", () => {
  // rounds sum to 6 of the 8 openable cases, so four survive the last round.
  const short = {
    title: "Short", settings: Object.assign({}, BOARD.settings, {
      rounds: [4, 2], offerFactors: [0.3, 0.8],
    }),
  };
  assert.ok(Content.warningsFor(short).some((w) => /stay closed/.test(w)), "the editor warns");
  let s = seated(short);
  s = Core.reduce(toOffer(s), { type: "noDeal" });
  s = Core.reduce(toOffer(s), { type: "noDeal" });
  assert.equal(s.phase, "reveal");
  assert.equal(Core.otherCases(s).length, 3, "three others still sealed");
  assert.equal(Core.reduce(s, { type: "swap", yes: true }), s);
});

/* ============================================================
   A5 — audience advice
   ============================================================ */

test("A5 the contestant may never advise themselves, before or after the close", () => {
  const s = toOffer(seated());
  assert.equal(s.advice.open, true);
  assert.equal(Core.reduce(s, { type: "adviceVote", pid: "p1", choice: "deal" }), s,
    "the contestant's own vote is refused");
  const voted = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" });
  assert.deepEqual(voted.advice.votes, { p2: "deal" });
  // One phone, one vote — a change of mind is ignored.
  const again = Core.reduce(voted, { type: "adviceVote", pid: "p2", choice: "no" });
  assert.equal(again, voted);
  // A spectator who is not even on the roster may still advise.
  const spec = Core.reduce(voted, { type: "adviceVote", pid: "zz", choice: "no" });
  assert.deepEqual(spec.advice.votes, { p2: "deal", zz: "no" });
  assert.deepEqual(Core.adviceCounts(spec), [1, 1]);
  assert.deepEqual(Core.adviceChart(spec).pcts, [50, 50]);
});

test("A5 a closed vote takes no more votes and keeps its frozen split", () => {
  let s = toOffer(seated());
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" });
  s = Core.reduce(s, { type: "adviceVote", pid: "p3", choice: "deal" });
  const before = Core.adviceChart(s);
  assert.deepEqual(before.pcts, [100, 0]);
  s = Core.reduce(s, { type: "adviceClose" });
  assert.equal(s.advice.open, false);
  assert.deepEqual(s.advice.chart, [100, 0]);
  const after = Core.reduce(s, { type: "adviceVote", pid: "zz", choice: "no" });
  assert.equal(after, s, "a vote after the close changes nothing at all");
  assert.equal(Core.reduce(s, { type: "adviceClose" }), s, "closing twice is a no-op");
  assert.deepEqual(Core.adviceChart(s).pcts, [100, 0], "the split survives");
  assert.equal(Core.adviceChart(s).source, "closed");
});

test("A5 rubbish votes and votes outside an offer are refused", () => {
  const round = finishRound(seated());
  assert.equal(round.advice.open, false, "no vote is open during a round");
  assert.equal(Core.reduce(round, { type: "adviceVote", pid: "p2", choice: "deal" }), round);
  const s = toOffer(seated());
  [undefined, null, "", "DEAL", "yes", 1, {}, [], "no ", "__proto__"].forEach((choice) => {
    assert.equal(Core.reduce(s, { type: "adviceVote", pid: "p2", choice }), s, `choice ${String(choice)}`);
  });
  [undefined, null, "", "   ", 7, {}].forEach((pid) => {
    assert.equal(Core.reduce(s, { type: "adviceVote", pid, choice: "deal" }), s, `pid ${String(pid)}`);
  });
  assert.deepEqual(Core.adviceChart(s).pcts, [0, 0], "an empty vote is not a fake 50/50");
  assert.equal(Core.adviceChart(s).source, null);
});

test("A5 audienceAdvice:false never opens a vote at all", () => {
  const quiet = { title: "Quiet", settings: Object.assign({}, BOARD.settings, { audienceAdvice: false }) };
  const s = toOffer(seated(quiet));
  assert.equal(s.advice.open, false);
  assert.equal(Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" }), s);
  assert.equal(Core.phoneView(s, "p2").screen, "wait", "no ballot on anybody's phone");
});

test("A5 a phone decision is intent only, and only from the contestant", () => {
  const s = toOffer(seated());
  ["p2", "p3", "zz", "", null].forEach((pid) => {
    assert.equal(Core.reduce(s, { type: "request", pid, choice: "deal" }), s, `request from ${String(pid)}`);
  });
  const asked = Core.reduce(s, { type: "request", pid: "p1", choice: "deal" });
  assert.deepEqual(asked.request, { pid: "p1", choice: "deal" });
  assert.equal(asked.phase, "offer", "the request does NOT deal");
  assert.equal(asked.deal, null);
  assert.equal(asked.offer, s.offer);
  // Only the host's button moves the game on, and it clears the request.
  const done = Core.reduce(asked, { type: "deal" });
  assert.equal(done.phase, "reveal");
  assert.equal(done.request, null);
  // A request outside an offer is refused, in every phase that is not `offer`.
  const mid = finishRound(seated());
  assert.equal(Core.reduce(mid, { type: "request", pid: "p1", choice: "deal" }), mid);
  assert.equal(Core.reduce(done, { type: "request", pid: "p1", choice: "deal" }), done);
  // Junk choices are refused even from the contestant.
  ["", "DEAL", "maybe", null, 1, {}].forEach((choice) => {
    assert.equal(Core.reduce(s, { type: "request", pid: "p1", choice }), s, `request choice ${String(choice)}`);
  });
});

/* ============================================================
   A6 — opening cases: the own case, and past the counter
   ============================================================ */

test("A6 the contestant's own case can never be opened during a round", () => {
  const s = seated(BOARD, 4);
  assert.equal(s.own, 4);
  const tried = Core.reduce(s, { type: "openCase", n: 4 });
  assert.equal(tried, s, "the identical object comes back");
  assert.equal(Core.caseByN(s, 4).opened, false);
  // Not at any later point in the round either.
  const later = Core.reduce(s, { type: "openCase", n: 1 });
  assert.equal(Core.reduce(later, { type: "openCase", n: 4 }), later);
  // And the host grid agrees: casesView flags it and never labels it.
  const own = Core.casesView(s).find((c) => c.own);
  assert.equal(own.n, 4);
  assert.equal(own.label, "");
});

test("A6 opening more cases than toOpen is refused, and re-opening one is too", () => {
  let s = seated();
  const queue = s.cases.filter((c) => c.n !== s.own).map((c) => c.n);
  assert.equal(s.toOpen, 4);
  for (let i = 0; i < 4; i += 1) s = Core.reduce(s, { type: "openCase", n: queue[i] });
  assert.equal(s.toOpen, 0);
  const stuck = Core.reduce(s, { type: "openCase", n: queue[4] });
  assert.equal(stuck, s, "the fifth case of a four-case round is refused");
  assert.equal(Core.reduce(s, { type: "openCase", n: queue[0] }), s, "already open");
  assert.equal(Core.unopenedCases(s).length, 6);
  // Nonsense case numbers do nothing, whatever the phase.
  const picking = run(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }], fixed(0.5));
  [0, -1, 11, 999, 1.5, "1", null, undefined, NaN, {}].forEach((n) => {
    assert.equal(Core.reduce(s, { type: "openCase", n }), s, `openCase ${String(n)}`);
    assert.equal(Core.reduce(picking, { type: "pickCase", n }), picking, `pickCase ${String(n)}`);
  });
  assert.equal(picking.phase, "pick");
  // The banker is the only way forward now.
  const offered = Core.reduce(s, { type: "bankerOffer" }, fixed(0.5));
  assert.equal(offered.phase, "offer");
  assert.equal(Core.reduce(offered, { type: "bankerOffer" }, fixed(0.9)), offered, "one call per round");
});

test("A6 pickCase only happens once, and openCase only inside a round", () => {
  const picked = seated(BOARD, 2);
  assert.equal(Core.reduce(picked, { type: "pickCase", n: 3 }), picked, "no second own case");
  assert.equal(picked.own, 2);
  const setup = fresh();
  assert.equal(Core.reduce(setup, { type: "pickCase", n: 1 }), setup, "not before start");
  assert.equal(Core.reduce(setup, { type: "openCase", n: 1 }), setup);
  assert.equal(Core.reduce(setup, { type: "bankerOffer" }, fixed(0.5)), setup);
  assert.equal(Core.reduce(setup, { type: "deal" }), setup);
  const seat = Core.reduce(setup, { type: "start" });
  assert.equal(seat.phase, "seat");
  assert.equal(Core.reduce(seat, { type: "pickCase", n: 1 }), seat, "nobody is seated yet");
  assert.equal(Core.reduce(seat, { type: "seat", pid: "nobody" }, fixed(0.5)), seat, "unknown pid");
});

/* ============================================================
   A7 — the reveal order
   ============================================================ */

test("A7 the would-have-won reveal opens the others in case order, then theirs", () => {
  let s = Core.reduce(toOffer(seated(BOARD, 5)), { type: "deal" });
  const expected = s.cases.filter((c) => !c.opened && c.n !== s.own).map((c) => c.n).sort((a, b) => a - b);
  assert.deepEqual(Core.revealOrder(s), expected);
  const seen = [];
  while (Core.revealOrder(s).length) {
    const before = Core.revealOrder(s)[0];
    s = Core.reduce(s, { type: "revealRest" });
    seen.push(s.lastOpened);
    assert.equal(s.lastOpened, before, "revealRest opens the case revealOrder promised");
    assert.equal(s.phase, "reveal", "the ceremony does not end early");
  }
  assert.deepEqual(seen, expected);
  assert.equal(Core.caseByN(s, s.own).opened, false, "their own case is still shut");
  assert.equal(Core.reduce(s, { type: "revealRest" }), s, "nothing left to reveal");
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.phase, "result");
  assert.equal(Core.reduce(s, { type: "revealOwn" }), s, "and it cannot be opened twice");
});

test("A7 revealOwn on its own opens a lone survivor with it", () => {
  let s = seated();
  for (let r = 0; r < BOARD.settings.rounds.length; r += 1) s = Core.reduce(toOffer(s), { type: "noDeal" });
  s = Core.reduce(s, { type: "swap", yes: false });
  assert.equal(Core.revealOrder(s).length, 1);
  s = Core.reduce(s, { type: "revealOwn" });
  assert.ok(s.cases.every((c) => c.opened), "no board ends on a single mystery");
});

/* ============================================================
   A8 — a second contestant gets a genuinely fresh shuffle
   ============================================================ */

test("A8 the same rng deals the same board; a different seed deals a different one", () => {
  const mapOf = (s) => s.cases.map((c) => `${c.n}:${c.amount}`).join("|");
  const a = seated(BOARD, 1, lcg(11));
  const b = seated(BOARD, 1, lcg(11));
  assert.equal(mapOf(a), mapOf(b), "deterministic under the same rng");
  const c = seated(BOARD, 1, lcg(999));
  assert.notEqual(mapOf(a), mapOf(c), "a new seed is a new board");
  // Always a permutation, never a lost or invented amount.
  [a, c].forEach((s) => {
    assert.deepEqual(
      s.cases.map((x) => x.amount).slice().sort((x, y) => x - y),
      BOARD.settings.amounts.slice().sort((x, y) => x - y),
    );
    assert.deepEqual(s.cases.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

test("A8 the second contestant is reshuffled and inherits nothing", () => {
  const rng = lcg(7);
  let s = run(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 }], rng);
  const first = s.cases.map((c) => c.amount).join(",");
  s = Core.reduce(toOffer(s, rng), { type: "deal" });
  while (Core.revealOrder(s).length) s = Core.reduce(s, { type: "revealRest" });
  s = Core.reduce(s, { type: "revealOwn" });
  const banked = s.contestants.find((c) => c.pid === "p1").won;
  assert.ok(banked > 0);
  s = Core.reduce(s, { type: "nextContestant" });
  assert.equal(s.phase, "seat");
  assert.equal(s.current, null);
  assert.deepEqual(s.cases, [], "the old board is gone");
  assert.equal(s.own, null);
  assert.equal(s.offer, null);
  assert.deepEqual(s.offers, []);
  assert.equal(s.deal, null);
  assert.equal(s.swapped, false);
  assert.deepEqual(s.advice.votes, {});
  assert.equal(Core.reduce(s, { type: "seat", pid: "p1" }, rng), s, "p1 has had their turn");
  s = Core.reduce(s, { type: "seat", pid: "p2" }, rng);
  assert.notEqual(s.cases.map((c) => c.amount).join(","), first, "a fresh shuffle");
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, banked, "the first result survives");
  // And the night closes out with everybody banked.
  s = Core.reduce(s, { type: "pickCase", n: 1 });
  s = Core.reduce(Core.reduce(toOffer(s, rng), { type: "deal" }), { type: "revealOwn" });
  s = Core.reduce(s, { type: "nextContestant" });
  s = Core.reduce(s, { type: "seat", pid: "p3" }, rng);
  s = Core.reduce(s, { type: "pickCase", n: 2 });
  s = Core.reduce(Core.reduce(toOffer(s, rng), { type: "deal" }), { type: "revealOwn" });
  s = Core.reduce(s, { type: "nextContestant" });
  assert.equal(s.phase, "standings");
  assert.equal(Core.waitingContestants(s).length, 0);
  assert.ok(Core.standings(s).every((c) => c.out && c.won > 0));
});

/* ============================================================
   A9 — validator fuzz
   ============================================================ */

function refuses(board, why) {
  assert.throws(() => Core.validateBoard(board), Error, why);
  let message = "";
  try { Core.validateBoard(board); } catch (err) { message = err.message; }
  assert.ok(message.length > 10 && /[a-z]/.test(message), `plain English, got: ${message}`);
  assert.ok(!/undefined|\[object/.test(message), `no debug leak in: ${message}`);
}

test("A9 the validator refuses boards the spec forbids", () => {
  const ok = (patch) => ({ title: "x", settings: Object.assign({}, BOARD.settings, patch) });
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9] }), "9 amounts is under the minimum of 10");
  refuses(ok({ amounts: Array.from({ length: 31 }, (_, i) => i + 1) }), "31 amounts is over 30");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 9] }), "a duplicate amount");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, -1] }), "a negative amount");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, NaN] }), "NaN");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, Infinity] }), "Infinity");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, "10"] }), "a string amount");
  refuses(ok({ amounts: [1, 2, 3, 4, 5, 6, 7, 8, 9, null] }), "a null amount");
  refuses(ok({ amounts: "1,2,3" }), "amounts is not a list");
  refuses(ok({ rounds: [4, 2, 1, 1, 1] }), "9 openings on a 10-case board is cases - 1");
  refuses(ok({ rounds: [8, 1] }), "9 openings again");
  refuses(ok({ rounds: [] }), "an empty schedule");
  refuses(ok({ rounds: [0, 1] }), "a zero round");
  refuses(ok({ rounds: [1.5, 1] }), "a fractional round");
  refuses(ok({ rounds: [-2, 1] }), "a negative round");
  refuses(ok({ rounds: ["4", 2] }), "a string round");
  refuses(ok({ offerFactors: [2, 0.4, 0.7, 1] }), "a factor above 1.5");
  refuses(ok({ offerFactors: [-0.1, 0.4, 0.7, 1] }), "a negative factor");
  refuses(ok({ offerFactors: [0.2, 0.4] }), "fewer factors than rounds");
  refuses(ok({ offerFactors: [0.2, 0.4, 0.5, 0.6, 0.7] }), "more factors than rounds");
  refuses(ok({ offerFactors: [0.2, 0.4, 0.7, "1"] }), "a string factor");
  refuses(ok({ jitter: 0.5 }), "jitter above 0.2");
  refuses(ok({ jitter: -0.01 }), "negative jitter");
  refuses(ok({ jitter: "0.05" }), "a string jitter");
  refuses(ok({ currency: "USD$" }), "a four-character currency");
  refuses(ok({ allowSwap: "yes" }), "a string flag");
  refuses(ok({ audienceAdvice: 1 }), "a numeric flag");
  refuses({ title: 5, settings: BOARD.settings }, "a numeric title");
  refuses({ settings: [] }, "settings as an array");
  refuses({ settings: "x" }, "settings as text");
  [null, undefined, 5, "{}", [], true].forEach((junk) => refuses(junk, `board ${String(junk)}`));
});

test("A9 exactly cases - 2 openings is allowed, and cases - 1 is not", () => {
  const at = { title: "at", settings: Object.assign({}, BOARD.settings, { rounds: [4, 2, 1, 1] }) };
  assert.equal(Core.validateBoard(at), true, "4+2+1+1 = 8 = 10 - 2");
  const over = { title: "over", settings: Object.assign({}, BOARD.settings, { rounds: [4, 2, 1, 1, 1] }) };
  assert.throws(() => Core.validateBoard(over), /two must stay closed/);
  // The shipped 26-case schedule is exactly at the limit too.
  assert.equal(Content.DEFAULT_ROUNDS.reduce((a, b) => a + b, 0), Content.DEFAULT_AMOUNTS.length - 2);
});

test("A9 a board that is only defaults still validates and normalises", () => {
  assert.equal(Core.validateBoard({}), true);
  const g = Core.normalizeBoard({});
  assert.equal(g.title, "Deal or No Deal");
  assert.equal(g.settings.amounts.length, 26);
  assert.deepEqual(g.settings.rounds, Content.DEFAULT_ROUNDS.slice());
  assert.deepEqual(g.settings.offerFactors, Content.DEFAULT_FACTORS.slice());
  assert.equal(g.settings.jitter, 0.05);
  assert.equal(g.settings.allowSwap, true);
  // DEFECT N-D1 (fixed by the tester in dond-content.js): a 10-amount board
  // with no `rounds` key used to validate and then DEADLOCK mid-play, because
  // the default 6+5+4+3+2+1+1+1+1 = 24 schedule was never checked against this
  // board's ten cases. It must be refused, in plain English, naming the numbers.
  let msg = "";
  try { Core.validateBoard({ settings: { amounts: BOARD.settings.amounts } }); } catch (e) { msg = e.message; }
  assert.match(msg, /24 cases but only 8/, "the default schedule is validated against the real case count");
  // And the deadlock it used to cause is now unreachable: for every board the
  // validator accepts, each round can always open as many cases as it asks for.
  [[10, undefined], [10, [8]], [10, [4, 2, 1, 1]], [12, [5, 3, 2]], [26, undefined]]
    .forEach(([count, rounds]) => {
      const amounts = Array.from({ length: count }, (_, i) => (i + 1) * 11);
      const board = { settings: { amounts, rounds } };
      let good = true;
      try { Core.validateBoard(board); } catch (e) { good = false; }
      if (!good) return;
      let s2 = run(Core.createState(board, [{ pid: "p1", name: "Ada" }], {}),
        [{ type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 }], fixed(0.5));
      for (let guard = 0; guard < 200; guard += 1) {
        if (s2.phase === "swap" || s2.phase === "reveal") break;
        const legal = Core.legalActions(s2);
        assert.ok(!(legal.length === 2 && legal.includes("finish") && legal.includes("undo")),
          `${count} cases / ${JSON.stringify(rounds)} deadlocked in phase ${s2.phase}`);
        if (s2.phase === "round" && s2.toOpen > 0) {
          const next = s2.cases.find((c) => !c.opened && c.n !== s2.own);
          s2 = Core.reduce(s2, { type: "openCase", n: next.n });
        } else if (s2.phase === "round") s2 = Core.reduce(s2, { type: "bankerOffer" }, fixed(0.5));
        else if (s2.phase === "offer") s2 = Core.reduce(s2, { type: "noDeal" });
      }
      assert.ok(["swap", "reveal"].includes(s2.phase), `${count} cases reached ${s2.phase}`);
    });
});

test("A9 normalizeBoard never mutates or aliases the caller's board", () => {
  const source = deepFreeze(JSON.parse(JSON.stringify(BOARD)));
  const g = Core.normalizeBoard(source);
  assert.notEqual(g.settings.amounts, source.settings.amounts);
  assert.notEqual(g.settings.rounds, source.settings.rounds);
  assert.notEqual(g.settings.offerFactors, source.settings.offerFactors);
  g.settings.amounts.push(1);                 // must not reach the frozen source
  assert.equal(source.settings.amounts.length, 10);
  // Unsorted input comes back sorted, and the title is cleaned.
  const messy = { title: "  Tab\there  ", settings: { amounts: [9, 1, 5, 3, 7, 2, 8, 4, 6, 10], rounds: [8] } };
  const n = Core.normalizeBoard(messy);
  assert.deepEqual(n.settings.amounts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(n.title.indexOf("\t"), -1, "control characters are stripped");
  assert.ok(n.title.length <= Content.TITLE_MAX);
  assert.equal(Core.normalizeBoard({ title: "\u0000\u0007" }).title, "Deal or No Deal", "a blank title falls back");
});

test("A9 createState refuses a roster it cannot play", () => {
  assert.throws(() => Core.createState(BOARD, []), /at least one contestant/);
  assert.throws(() => Core.createState(BOARD, null), /contestant list/);
  assert.throws(() => Core.createState(BOARD, [{ pid: "", name: "x" }]), /at least one/);
  assert.throws(() => Core.createState(BOARD, [{ pid: "p1", name: "" }]), /at least one/);
  const many = Array.from({ length: 17 }, (_, i) => ({ pid: `p${i}`, name: `N${i}` }));
  assert.throws(() => Core.createState(BOARD, many), /at most 16/);
  // Duplicates and junk rows are dropped, not fatal.
  const s = Core.createState(BOARD, [
    { pid: "p1", name: "Ada" }, { pid: "p1", name: "Ada again" }, null, "x",
    { pid: "p2", name: "Ben\u0007" },
  ]);
  assert.deepEqual(s.roster.map((p) => p.pid), ["p1", "p2"]);
  assert.equal(s.roster[1].name, "Ben", "control characters stripped from names");
  assert.equal(s.phase, "setup");
  assert.deepEqual(s.history, []);
});
