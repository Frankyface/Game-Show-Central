/* ============================================================
   The Price Is Right — pure core unit tests, part 2
   The Showcase Showdown, the Showcase, the episode plan, undo /
   immutability and everything a phone may see (spec 10 §6,
   P-U6 … P-U10). Fixtures live in tests/helpers.mjs.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import {
  Core, fixed, PLAYERS, tiny, started, run, toGame, toShowdown, toShowcase, deepFreeze,
} from "./helpers.mjs";

/* ============================================================
   P-U6 — the Showcase Showdown
   ============================================================ */

test("P-U6 the closest total to a dollar without going over wins", () => {
  assert.equal(Core.showdownWinner({ a: 95, b: 100, c: 40 }).pid, "b");
  assert.equal(Core.showdownWinner({ a: 95, b: 105, c: 40 }).pid, "a", "over a dollar is out");
  assert.deepEqual(Core.showdownWinner({ a: 70, b: 70 }).tie, ["a", "b"]);
  assert.equal(Core.showdownWinner({ a: 110, b: 120 }).allBust, true);
  assert.equal(Core.showdownWinner({}).pid, null);
});

test("P-U6 the wheel spins lowest winnings first, offers a second spin and busts over a dollar", () => {
  let s = toShowdown();
  assert.equal(s.phase, "showdown");
  assert.equal(s.showdown.spinners.length, 2);
  const first = s.showdown.spinners[0];
  assert.ok(Core.winningsOf(s, first) <= Core.winningsOf(s, s.showdown.spinners[1]));
  // wheel[0] is 100 in the default order, so rng 0 lands on a dollar.
  s = Core.reduce(s, { type: "spin" }, fixed(0));
  assert.equal(s.showdown.totals[first], 100);
  assert.equal(s.winnings[first] >= 1000, true, "an exact dollar pays the bonus");
  assert.equal(s.showdown.current, 1, "a dollar ends the turn");
});

test("P-U6 a second spin can bust, and staying keeps the total", () => {
  const g = tiny();
  g.settings.gamesPerShowdown = 2;
  g.settings.wheel = [60, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 65, 70, 75, 80, 85, 90, 95, 100];
  let s = toShowdown();
  s = Object.assign({}, s, { content: Object.assign({}, s.content, { settings: Object.assign({}, s.content.settings, { wheel: g.settings.wheel }) }) });
  const first = s.showdown.spinners[0];
  s = Core.reduce(s, { type: "spin" }, fixed(0));
  assert.equal(s.showdown.totals[first], 60);
  assert.equal(s.showdown.awaiting, "decide");
  const stayed = Core.reduce(s, { type: "stay" }, fixed(0));
  assert.equal(stayed.showdown.current, 1);
  assert.equal(stayed.showdown.totals[first], 60);
  const again = Core.reduce(Core.reduce(s, { type: "spinAgain" }, fixed(0)), { type: "spin" }, fixed(0));
  assert.equal(again.showdown.totals[first], 120);
  assert.equal(again.showdown.current, 1, "busting ends the turn");
});

test("P-U6 a tie triggers a one-spin-each spin-off", () => {
  let s = toShowdown();
  const wheel = new Array(20).fill(50);
  s = Object.assign({}, s, {
    content: Object.assign({}, s.content, {
      settings: Object.assign({}, s.content.settings, { wheel }),
    }),
  });
  s = run(s, [{ type: "spin" }, { type: "stay" }, { type: "spin" }, { type: "stay" }], fixed(0));
  assert.equal(s.showdown.spinoff, true);
  assert.equal(s.showdown.round, 2);
  assert.equal(s.showdown.spinners.length, 2);
  assert.deepEqual(Object.values(s.showdown.totals), [0, 0], "the spin-off starts from zero");
  // In a spin-off there is no second spin: one each, then the higher total wins.
  const mixed = [45, 55].concat(new Array(18).fill(5));
  s = Object.assign({}, s, {
    content: Object.assign({}, s.content, {
      settings: Object.assign({}, s.content.settings, { wheel: mixed }),
    }),
  });
  s = Core.reduce(s, { type: "spin" }, fixed(0));
  assert.equal(s.showdown.awaiting, "spin", "no second spin is offered in a spin-off");
  s = Core.reduce(s, { type: "spin" }, fixed(0.05));
  assert.equal(s.showdown.awaiting, "done");
  assert.equal(s.showdown.winner, s.showdown.spinners[1]);
  assert.deepEqual(s.showdownWinners, [s.showdown.spinners[1]]);
});

/* ============================================================
   P-U7 — the Showcase
   ============================================================ */

test("P-U7 closest without going over wins; inside the margin wins both", () => {
  const actuals = { a: 8000, b: 6000 };
  const tied = Core.showcaseResult({ a: 7000, b: 5000 }, actuals, 250, ["a", "b"]);
  assert.equal(tied.winner, "a", "both are 1000 out, so the first finalist keeps it");
  assert.equal(tied.rows[0].diff, 1000);
  assert.equal(tied.both, false, "1000 out is well outside the margin");
  const closer = Core.showcaseResult({ a: 7000, b: 5900 }, actuals, 250, ["a", "b"]);
  assert.equal(closer.winner, "b", "100 out beats 1000 out");
  assert.equal(closer.diff, 100);
  assert.equal(closer.both, true, "inside the margin wins both");
  const outside = Core.showcaseResult({ a: 7000, b: 5000 }, actuals, 50, ["a", "b"]);
  assert.equal(outside.both, false);
  const over = Core.showcaseResult({ a: 9000, b: 7000 }, actuals, 250, ["a", "b"]);
  assert.equal(over.doubleOver, true);
  assert.equal(over.winner, null);
  const one = Core.showcaseResult({ a: 9000, b: 5900 }, actuals, 250, ["a", "b"]);
  assert.equal(one.winner, "b");
  assert.equal(one.both, true, "100 out is inside the 250 margin");
});

test("P-U7 the top winner chooses, the pass swaps the showcases, and the payout follows", () => {
  let s = toShowcase();
  assert.equal(s.phase, "showcase");
  assert.equal(s.showcase.finalists.length, 2);
  const chooser = s.showcase.chooser;
  const other = s.showcase.finalists.find((pid) => pid !== chooser);
  assert.equal(Core.reduce(s, { type: "revealShowcase" }, fixed(0)), s, "no reveal before a showcase is claimed");
  const passed = Core.reduce(s, { type: "showcasePass", pass: true }, fixed(0));
  assert.equal(passed.showcase.assignments[chooser], s.showcase.pair[1]);
  assert.equal(passed.showcase.assignments[other], s.showcase.pair[0]);
  const took = Core.reduce(s, { type: "showcasePass", pass: false }, fixed(0));
  assert.equal(took.showcase.assignments[chooser], s.showcase.pair[0]);
  assert.equal(Core.reduce(took, { type: "showcasePass", pass: true }, fixed(0)), took, "one choice only");

  let play = took;
  const mine = play.content.showcases[play.showcase.assignments[chooser]].total;
  const theirs = play.content.showcases[play.showcase.assignments[other]].total;
  const before = Core.winningsOf(play, chooser);
  play = run(play, [
    { type: "showcaseBid", pid: chooser, amount: mine - 100 },
    { type: "showcaseBid", pid: other, amount: theirs + 5000 },
    { type: "revealShowcase" },
  ]);
  assert.equal(play.showcase.result.winner, chooser);
  assert.equal(play.showcase.result.both, true, "100 under is inside the default 250 margin");
  assert.equal(Core.winningsOf(play, chooser), before + mine + theirs);
  const done = Core.reduce(play, { type: "nextSegment" }, fixed(0));
  assert.equal(done.phase, "standings");
});

test("P-U7 one player winning both showdowns still yields two different finalists", () => {
  // The same contestant can come on down twice and take both showdowns; the
  // second chair then goes to the next biggest winner, never to them again.
  const s = toShowcase();
  const doubled = Object.assign({}, s, { showdownWinners: [s.showcase.finalists[0], s.showcase.finalists[0]] });
  const again = Core.reduce(Object.assign({}, doubled, {
    phase: "showdown",
    showdown: Object.assign({}, s.showdown, { awaiting: "done" }),
    segmentIndex: s.segmentIndex - 1,
  }), { type: "nextSegment" }, fixed(0));
  assert.equal(again.phase, "showcase");
  assert.equal(again.showcase.finalists.length, 2);
  assert.notEqual(again.showcase.finalists[0], again.showcase.finalists[1]);
  assert.equal(again.showcase.finalists[0], s.showcase.finalists[0]);
  assert.equal(new Set(Object.values(again.showcase.assignments)).size,
    Object.keys(again.showcase.assignments).length);
});

test("P-U7 both finalists over means nobody wins the showcase", () => {
  let s = Core.reduce(toShowcase(), { type: "showcasePass", pass: false }, fixed(0));
  const [a, b] = s.showcase.finalists;
  const before = { a: Core.winningsOf(s, a), b: Core.winningsOf(s, b) };
  s = run(s, [{ type: "showcaseBid", pid: a, amount: 999999 },
    { type: "showcaseBid", pid: b, amount: 999999 }, { type: "revealShowcase" }]);
  assert.equal(s.showcase.result.doubleOver, true);
  assert.equal(Core.winningsOf(s, a), before.a);
  assert.equal(Core.winningsOf(s, b), before.b);
  assert.equal(Core.reduce(s, { type: "showcaseBid", pid: a, amount: 10 }, fixed(0)), s, "bidding is closed");
});

/* ============================================================
   P-U8 — the episode plan for 1 to 12 players
   ============================================================ */

test("P-U8 every roster from 1 to 12 players yields a complete, playable plan", () => {
  for (let n = 1; n <= 12; n += 1) {
    const roster = [];
    for (let i = 0; i < n; i += 1) roster.push({ pid: `p${i + 1}`, name: `P${i + 1}` });
    const p = Core.plan(roster, { gamesPerShowdown: 3 }, { oneBid: 12 });
    assert.equal(p.players, n);
    assert.equal(p.seats, Math.min(4, n), `${n} players`);
    assert.equal(p.games, 6);
    assert.equal(p.showdowns, 2);
    const kinds = p.segments.map((s) => s.t).join(",");
    assert.equal(kinds, "row,game,row,game,row,game,showdown,row,game,row,game,row,game,showdown,showcase", `${n} players`);
    assert.ok(p.note.includes(`${n} player`), p.note);
    const s = Core.createState(tiny(), roster);
    assert.equal(Core.reduce(s, { type: "start" }, fixed(0)).phase, "row");
  }
});

test("P-U8 a thin file and other showdown sizes still produce a complete plan", () => {
  const four = Core.plan(PLAYERS, { gamesPerShowdown: 3 }, { oneBid: 4 });
  assert.equal(four.games, 4);
  assert.equal(four.showdowns, 2);
  assert.equal(four.segments.filter((s) => s.t === "showdown").length, 2);
  assert.equal(four.segments[four.segments.length - 1].t, "showcase");

  const one = Core.plan(PLAYERS, { gamesPerShowdown: 3 }, { oneBid: 1 });
  assert.equal(one.games, 1);
  assert.equal(one.showdowns, 1);
  assert.deepEqual(one.segments.map((s) => s.t), ["row", "game", "showdown", "showcase"]);

  const perOne = Core.plan(PLAYERS, { gamesPerShowdown: 1 }, { oneBid: 12 });
  assert.equal(perOne.games, 2);
  assert.equal(perOne.showdowns, 2);
  assert.deepEqual(perOne.segments.map((s) => s.t),
    ["row", "game", "showdown", "row", "game", "showdown", "showcase"]);

  const big = Core.plan(PLAYERS, { gamesPerShowdown: 4 }, { oneBid: 20 });
  assert.equal(big.games, 8);
  assert.equal(big.showdowns, 2);
});

test("P-U8 a single player can run the whole episode alone", () => {
  const solo = [{ pid: "p1", name: "Solo" }];
  let s = started(tiny(), solo);
  let guard = 0;
  while (s.phase !== "standings" && guard++ < 200) {
    if (s.phase === "row" && !s.row.revealed) s = run(s, [{ type: "bid", pid: "p1", amount: 1 }, { type: "revealBids" }]);
    else if (s.phase === "game" && s.game.pending) s = Core.reduce(s, { type: "pickGame", kind: "cliffhangers" }, fixed(0));
    else if (s.phase === "game" && !s.game.done) s = Core.reduce(s, { type: "chGuess", amount: 10 }, fixed(0));
    else if (s.phase === "showdown" && s.showdown.awaiting === "spin") s = Core.reduce(s, { type: "spin" }, fixed(0.5));
    else if (s.phase === "showdown" && s.showdown.awaiting === "decide") s = Core.reduce(s, { type: "stay" }, fixed(0));
    else if (s.phase === "showcase" && !s.showcase.chosen) s = Core.reduce(s, { type: "showcasePass", pass: false }, fixed(0));
    else if (s.phase === "showcase" && !s.showcase.revealed) {
      s = run(s, [{ type: "showcaseBid", pid: "p1", amount: 100 }, { type: "revealShowcase" }]);
    } else s = Core.reduce(s, { type: "nextSegment" }, fixed(0));
  }
  assert.equal(s.phase, "standings", `stuck after ${guard} steps in ${s.phase}`);
  assert.ok(Core.winningsOf(s, "p1") > 0);
});

/* ============================================================
   P-U9 — undo, illegal events and immutability
   ============================================================ */

test("P-U9 an unknown or illegal event returns the very same object", () => {
  const s = started();
  assert.equal(Core.reduce(s, { type: "nope" }, fixed(0)), s);
  assert.equal(Core.reduce(s, {}, fixed(0)), s);
  assert.equal(Core.reduce(s, null, fixed(0)), s);
  assert.equal(Core.reduce(s, { type: "chGuess", amount: 5 }, fixed(0)), s, "wrong phase");
  assert.equal(Core.reduce(s, { type: "spin" }, fixed(0)), s, "wrong phase");
  assert.equal(Core.reduce(s, { type: "revealShowcase" }, fixed(0)), s, "wrong phase");
  assert.equal(Core.reduce(s, { type: "rebid" }, fixed(0)), s, "nothing to rebid");
  assert.equal(Core.reduce(s, { type: "start" }, fixed(0)), s, "already started");
  assert.equal(Core.reduce(s, { type: "undo" }, fixed(0)).history.length, 0);
});

test("P-U9 undo walks back one step at a time and restores the exact state", () => {
  const s = started();
  const one = Core.reduce(s, { type: "bid", pid: "p1", amount: 300 }, fixed(0));
  const two = Core.reduce(one, { type: "bid", pid: "p2", amount: 200 }, fixed(0));
  const back = Core.reduce(two, { type: "undo" }, fixed(0));
  assert.deepEqual(back.row.bids, one.row.bids);
  assert.deepEqual(back.row.order, one.row.order);
  assert.equal(back.history.length, one.history.length);
  assert.equal(back.content, s.content, "undo keeps the content object");
  const start = Core.reduce(back, { type: "undo" }, fixed(0));
  assert.deepEqual(start.row.bids, {});
});

test("P-U9 the reducer never mutates the state it is handed", () => {
  const events = [
    { type: "bid", pid: "p1", amount: 300 },
    { type: "revealBids" },
    { type: "nextSegment" },
    { type: "pickGame", kind: "plinko" },
    { type: "plinkoAnswer", answer: "higher" },
  ];
  let s = deepFreeze(started());
  for (const ev of events) {
    const before = JSON.stringify(s);
    const next = Core.reduce(s, ev, fixed(0.3));
    assert.equal(JSON.stringify(s), before, `mutated on ${ev.type}`);
    assert.notEqual(next, s, `${ev.type} should have done something`);
    s = deepFreeze(next);
  }
});

test("P-U9 legalActions reports exactly what the host can do next", () => {
  const setup = Core.createState(tiny(), PLAYERS);
  assert.deepEqual(Core.legalActions(setup), ["start"]);
  const row = started();
  const rowActions = Core.legalActions(row);
  assert.ok(rowActions.includes("bid"));
  assert.ok(!rowActions.includes("revealBids"), "nothing to reveal yet");
  assert.ok(!rowActions.includes("spin"));
  const bid = Core.reduce(row, { type: "bid", pid: "p1", amount: 300 }, fixed(0));
  assert.ok(Core.legalActions(bid).includes("revealBids"));
  assert.ok(Core.legalActions(bid).includes("undo"));
  const game = toGame("cliffhangers");
  const gameActions = Core.legalActions(game);
  assert.ok(gameActions.includes("chGuess"));
  assert.ok(!gameActions.includes("plinkoDrop"));
  assert.ok(!gameActions.includes("nextSegment"), "the game is not finished");
  assert.equal(Core.segmentDone(game), false);
});

test("P-U9 finish jumps to the standings from anywhere and stops there", () => {
  const s = Core.reduce(toGame("plinko"), { type: "finish" }, fixed(0));
  assert.equal(s.phase, "standings");
  assert.equal(Core.reduce(s, { type: "finish" }, fixed(0)), s);
  assert.equal(Core.reduce(s, { type: "nextSegment" }, fixed(0)), s);
  assert.equal(Core.standings(s).length, 4);
});

/* ============================================================
   P-U10 — phone messages and what a phone may see
   ============================================================ */

const PHONE_MSGS = [
  [{ t: "bid", amount: 300 }, { t: "bid", amount: 300 }],
  [{ t: "bid", amount: 0 }, null],
  [{ t: "bid", amount: -1 }, null],
  [{ t: "bid", amount: 1.5 }, null],
  [{ t: "bid", amount: "300" }, null],
  [{ t: "bid", amount: 1e12 }, null],
  [{ t: "guess", value: 42 }, { t: "guess", value: 42 }],
  [{ t: "guess", value: 0 }, { t: "guess", value: 0 }],
  [{ t: "guess", value: -1 }, null],
  [{ t: "guess" }, null],
  [{ t: "spin" }, { t: "spin" }],
  [{ t: "plinko", answer: "higher" }, { t: "plinko", answer: "higher" }],
  [{ t: "plinko", answer: "sideways" }, null],
  [{ t: "plinko", slot: 0 }, { t: "plinko", slot: 0 }],
  [{ t: "plinko", slot: 8 }, { t: "plinko", slot: 8 }],
  [{ t: "plinko", slot: 9 }, null],
  [{ t: "plinko" }, null],
  [{ t: "kick" }, null],
  [{ t: 7 }, null],
  ["bid", null],
  [null, null],
  [[], null],
];

test("P-U10 validatePhoneMsg accepts only the four documented intents", () => {
  for (const [input, expected] of PHONE_MSGS) {
    assert.deepEqual(Core.validatePhoneMsg(input), expected, JSON.stringify(input));
  }
  const extra = Core.validatePhoneMsg({ t: "bid", amount: 300, sneak: "x", __proto__: { evil: 1 } });
  assert.deepEqual(Object.keys(extra), ["t", "amount"], "the copy is narrow");
});

test("P-U10 a bidding phone never sees another player's bid", () => {
  let s = started();
  s = run(s, [{ type: "bid", pid: "p1", amount: 300 }, { type: "bid", pid: "p2", amount: 410 }]);
  const view = Core.phoneView(s, "p1");
  assert.equal(view.screen, "bid");
  assert.equal(view.myBid, 300);
  const text = JSON.stringify(view);
  assert.ok(!text.includes("410"), text);
  assert.deepEqual(view.placed.map((p) => p.placed), [true, true, false, false]);
  const other = Core.phoneView(s, "p2");
  assert.equal(other.myBid, 410);
  assert.ok(!JSON.stringify(other).includes("300"), JSON.stringify(other));
  // …and never the price of the item.
  assert.ok(!text.includes(String(s.row.item.price)), `price ${s.row.item.price} leaked: ${text}`);
});

test("P-U10 a pricing-game phone never sees the answer, and only the player gets the controls", () => {
  const cliff = toGame("cliffhangers");
  const pid = cliff.game.pid;
  const mine = Core.phoneView(cliff, pid);
  assert.equal(mine.screen, "guess");
  assert.ok(!JSON.stringify(mine).includes(String(cliff.game.items[0].price)));
  const others = cliff.roster.map((p) => p.pid).filter((x) => x !== pid);
  for (const x of others) assert.equal(Core.phoneView(cliff, x).screen, "wait", x);

  const l7 = toGame("luckyseven");
  const l7view = Core.phoneView(l7, l7.game.pid);
  assert.equal(l7view.screen, "guess");
  assert.deepEqual(l7view.known, [2], "only the digit already given away");
  assert.ok(!JSON.stringify(l7view).includes("24680"));

  let plinko = toGame("plinko");
  const pv = Core.phoneView(plinko, plinko.game.pid);
  assert.equal(pv.stage, "answer");
  assert.ok(!JSON.stringify(pv).includes("\"actual\""));
  plinko = run(plinko, [{ type: "plinkoAnswer", answer: "higher" }, { type: "plinkoAnswer", answer: "correct" },
    { type: "plinkoAnswer", answer: "lower" }, { type: "plinkoAnswer", answer: "correct" }]);
  const drop = Core.phoneView(plinko, plinko.game.pid);
  assert.equal(drop.stage, "slot");
  assert.ok(!JSON.stringify(drop).includes("path"), "the bounce path never reaches a phone");
});

test("P-U10 the wheel, the showcase and the spectator views", () => {
  const sd = toShowdown();
  const spinner = sd.showdown.spinners[0];
  assert.equal(Core.phoneView(sd, spinner).screen, "spin");
  assert.equal(Core.phoneView(sd, sd.showdown.spinners[1]).screen, "wait");
  const spun = Core.reduce(sd, { type: "spin" }, fixed(0.5));
  assert.equal(Core.phoneView(spun, spinner).screen, "wait");

  const sc = Core.reduce(toShowcase(), { type: "showcasePass", pass: false }, fixed(0));
  const finalist = sc.showcase.finalists[0];
  const scv = Core.phoneView(sc, finalist);
  assert.equal(scv.screen, "showcase-bid");
  assert.ok(scv.prizes.length >= 2);
  assert.ok(!JSON.stringify(scv).includes("price"), "no prize prices reach the finalist");
  const outsider = sc.roster.map((p) => p.pid).find((pid) => sc.showcase.finalists.indexOf(pid) < 0);
  assert.equal(Core.phoneView(sc, outsider).screen, "wait");

  const ghost = Core.phoneView(sc, "not-a-player");
  assert.equal(ghost.spectator, true);
  const end = Core.reduce(sc, { type: "finish" }, fixed(0));
  const done = Core.phoneView(end, finalist);
  assert.equal(done.screen, "result");
  assert.equal(done.standings.length, 4);
  assert.equal(Core.phoneView(Core.createState(tiny(), PLAYERS), "p1").screen, "wait");
});
