/* ============================================================
   Deal or No Deal — the live ballot and the selector contract
   Added after verification: the fixes for N-D3 (audience advice
   was frozen off at Start) and N-D7a/b (a dead `notice` field and
   `adviceVote` missing from legalActions). Split out of
   tests/dond-core.test.mjs only to keep both files under the
   800-line house cap.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/dond-core.js");

const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
];

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

const fixed = (v) => () => v;

const fresh = (board = SMALL) => Core.createState(board, PLAYERS, {});

function play(state, events, rng = fixed(0.5)) {
  return events.reduce((s, e) => Core.reduce(s, e, rng), state);
}

function seated(board = SMALL, own = 1, rng = fixed(0.5)) {
  return play(fresh(board), [
    { type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: own },
  ], rng);
}

/** Open the whole round, then take the banker's call. */
function toOffer(state, rng = fixed(0.5)) {
  let s = state;
  while (s.toOpen > 0) {
    const next = s.cases.find((c) => !c.opened && c.n !== s.own);
    s = Core.reduce(s, { type: "openCase", n: next.n }, rng);
  }
  return Core.reduce(s, { type: "bankerOffer" }, rng);
}

/* ============================================================
   N-U7b — the ballot is live: the host may open it in play
   (fix for the tester's N-D3 / N-D7b)
   ============================================================ */

test("N-U7 the host can open the ballot by hand while an offer is on the table", () => {
  const quiet = { ...SMALL, settings: { ...SMALL.settings, audienceAdvice: false } };
  let s = toOffer(seated(quiet), fixed(0.5));
  assert.equal(s.advice.open, false, "the file said no, so the call did not open it");
  s = Core.reduce(s, { type: "adviceOpen" });
  assert.equal(s.advice.open, true);
  assert.equal(s.advice.round, s.round);
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" });
  assert.deepEqual(s.advice.votes, { p2: "deal" }, "a phone that only just arrived can vote");
  assert.equal(Core.reduce(s, { type: "adviceOpen" }), s, "opening twice is a no-op");
});

test("N-U7 closing and re-opening keeps the votes and unfreezes the split", () => {
  let s = toOffer(seated(), fixed(0.5));
  s = play(s, [
    { type: "adviceVote", pid: "p2", choice: "deal" },
    { type: "adviceClose" },
  ]);
  assert.deepEqual(s.advice.chart, [100, 0], "frozen on close");
  s = Core.reduce(s, { type: "adviceOpen" });
  assert.equal(s.advice.chart, null, "live again");
  assert.deepEqual(s.advice.votes, { p2: "deal" }, "the votes already cast survive");
  s = Core.reduce(s, { type: "adviceVote", pid: "p3", choice: "no" });
  assert.deepEqual(Core.adviceChart(s).pcts, [50, 50]);
});

test("N-U7 the ballot can only be opened while an offer is on the table", () => {
  const setup = fresh();
  const picking = play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }]);
  const round = seated();
  const dealt = Core.reduce(toOffer(seated(), fixed(0.5)), { type: "deal" });
  const done = Core.reduce(dealt, { type: "revealOwn" });
  [
    [setup, "setup"], [picking, "pick"], [round, "round"],
    [dealt, "reveal"], [done, "result"],
  ].forEach(([state, where]) => {
    assert.equal(Core.reduce(state, { type: "adviceOpen" }), state, `opened a ballot in ${where}`);
  });
});

test("N-U9 legalActions names adviceVote while the ballot is open", () => {
  const offered = toOffer(seated(), fixed(0.5));
  assert.ok(offered.advice.open);
  assert.ok(Core.legalActions(offered).includes("adviceVote"),
    Core.legalActions(offered).join(","));
  assert.ok(Core.legalActions(offered).includes("adviceClose"));
  assert.ok(!Core.legalActions(offered).includes("adviceOpen"), "already open");
  const closed = Core.reduce(offered, { type: "adviceClose" });
  assert.ok(!Core.legalActions(closed).includes("adviceVote"), "the vote is shut");
  assert.ok(Core.legalActions(closed).includes("adviceOpen"));
  // Everyone has voted: there is nothing left for adviceVote to do.
  const full = play(offered, [
    { type: "adviceVote", pid: "p2", choice: "deal" },
    { type: "adviceVote", pid: "p3", choice: "no" },
  ]);
  assert.ok(!Core.legalActions(full).includes("adviceVote"), Core.legalActions(full).join(","));
  // And every name it reports really does change the state.
  Core.legalActions(offered).forEach((type) => {
    const samples = {
      adviceVote: [{ type, pid: "p2", choice: "deal" }],
      request: [{ type, pid: offered.current, choice: "deal" }],
      swap: [{ type, yes: true }],
      seat: (offered.contestants || []).map((c) => ({ type, pid: c.pid })),
      pickCase: offered.cases.map((c) => ({ type, n: c.n })),
      openCase: offered.cases.map((c) => ({ type, n: c.n })),
    }[type] || [{ type }];
    if (type === "undo") { assert.ok(offered.history.length > 0); return; }
    assert.ok(samples.some((e) => Core.reduce(offered, e, fixed(0.5)) !== offered),
      `${type} was called legal but changes nothing`);
  });
});

test("N-U9 the state no longer carries the dead notice field", () => {
  const s = seated();
  assert.equal("notice" in s, false);
  assert.equal("notice" in fresh(), false);
  assert.equal("notice" in Core.reduce(s, { type: "openCase", n: Core.otherCases(s)[0].n }), false);
});
