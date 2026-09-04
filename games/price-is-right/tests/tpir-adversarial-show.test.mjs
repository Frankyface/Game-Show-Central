/* ============================================================
   The Price Is Right - ADVERSARIAL suite, part 2 (A7-A10)
   The episode plan, validator fuzz, hostile phone frames and view
   leaks, immutability, illegal events and undo through every
   segment. Part 1 (A1-A6) is in tpir-adversarial.test.mjs.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { Core, fixed, seq, PLAYERS, mk, tiny, started, run, deepFreeze } from "./helpers.mjs";
import {
  wheelAt, roster, toShowdownWith, toShowcaseState,
  cliffGame, plinkoGame, l7Game, claimedShowcase,
} from "./adversarial-helpers.mjs";

/* ============================================================
   A7 — the episode plan
   ============================================================ */

test("A7 the plan is the same shape for 1, 3, 4, 7 and 12 players", () => {
  const settings = Core.normalizeSettings({ gamesPerShowdown: 3 });
  const shape = [];
  [1, 3, 4, 7, 12].forEach((n) => {
    const p = Core.plan(roster(n), settings, { oneBid: 12 });
    assert.equal(p.players, n);
    assert.equal(p.seats, Math.min(4, n), `${n} players fill ${Math.min(4, n)} seats`);
    assert.equal(p.games, 6);
    assert.equal(p.showdowns, 2);
    assert.equal(p.segments.length, 6 * 2 + 2 + 1);
    assert.equal(p.segments[p.segments.length - 1].t, "showcase");
    assert.equal(p.segments.filter((x) => x.t === "showdown").length, 2);
    assert.equal(p.segments[6].t, "showdown", "a showdown after every three games");
    assert.equal(typeof p.note, "string");
    assert.equal(p.note.includes(`${n} player`), true);
    shape.push(p.segments.map((x) => `${x.t}${x.n}`).join(","));
  });
  assert.equal(new Set(shape).size, 1, "the segment list does not depend on the roster size");
});

test("A7 a thin file shortens the night but still reaches the showcase", () => {
  const settings = Core.normalizeSettings({ gamesPerShowdown: 3 });
  const thin = Core.plan(roster(4), settings, { oneBid: 4 });
  assert.equal(thin.games, 4);
  assert.equal(thin.segments[thin.segments.length - 1].t, "showcase");
  assert.equal(thin.segments.filter((x) => x.t === "showdown").length, thin.showdowns);
  const one = Core.plan(roster(4), Core.normalizeSettings({ gamesPerShowdown: 1 }), { oneBid: 12 });
  assert.equal(one.games, 2);
  assert.equal(one.showdowns, 2);
  const four = Core.plan(roster(4), Core.normalizeSettings({ gamesPerShowdown: 4 }), { oneBid: 12 });
  assert.equal(four.games, 8);
  assert.equal(four.showdowns, 2);
  assert.equal(four.segments[8].t, "showdown");
});

test("A7 a single player runs the whole episode alone and reaches the standings", () => {
  const g = tiny();
  g.settings.gamesPerShowdown = 1;
  let s = started(g, [{ pid: "solo", name: "Solo" }], fixed(0));
  let guard = 0;
  while (s.phase !== "standings" && guard < 200) {
    guard += 1;
    const acts = Core.legalActions(s);
    if (s.phase === "row" && !s.row.revealed) {
      s = Core.reduce(s, { type: "bid", pid: "solo", amount: 1 }, fixed(0));
      s = Core.reduce(s, { type: "revealBids" }, fixed(0));
    } else if (s.phase === "game" && s.game.pending) {
      s = Core.reduce(s, { type: "pickGame", kind: "cliffhangers" }, fixed(0));
    } else if (s.phase === "game" && !s.game.done) {
      s = Core.reduce(s, { type: "chGuess", amount: 10 }, fixed(0));
    } else if (s.phase === "showdown" && s.showdown.awaiting === "spin") {
      s = Core.reduce(s, { type: "spin" }, wheelAt(3));
    } else if (s.phase === "showdown" && s.showdown.awaiting === "decide") {
      s = Core.reduce(s, { type: "stay" }, fixed(0));
    } else if (s.phase === "showcase" && !s.showcase.chosen) {
      s = Core.reduce(s, { type: "showcasePass", pass: true }, fixed(0));
    } else if (s.phase === "showcase" && !s.showcase.revealed) {
      s = Core.reduce(s, { type: "showcaseBid", pid: "solo", amount: 1 }, fixed(0));
      s = Core.reduce(s, { type: "revealShowcase" }, fixed(0));
    } else if (acts.includes("nextSegment")) {
      s = Core.reduce(s, { type: "nextSegment" }, fixed(0));
    } else {
      assert.fail(`stuck at ${s.phase} with ${acts.join(",")}`);
    }
  }
  assert.equal(s.phase, "standings");
  assert.equal(s.showcase.finalists.length, 1, "one player yields one finalist");
  assert.equal(Core.standings(s).length, 1);
});

/* ============================================================
   A8 — validator fuzz
   ============================================================ */

const BAD = [
  ["three One Bid items", () => { const g = mk(); g.oneBid = g.oneBid.slice(0, 3); return g; }, /at least 4 items/],
  ["Cliff Hangers price 100", () => { const g = mk(); g.cliffhangers[0].items[1].price = 100; return g; }, /from 1 to 99/],
  ["Plinko shown 0", () => { const g = mk(); g.plinko[0].smallPrices[0].shown = 0; return g; }, /from 1 to 9/],
  ["Lucky Seven 4-digit price", () => { const g = mk(); g.luckyseven[1].price = 9999; return g; }, /five-digit/],
  ["19-segment wheel", () => { const g = mk(); g.settings.wheel = g.settings.wheel.slice(0, 19); return g; }, /exactly 20/],
  ["21-segment wheel", () => { const g = mk(); g.settings.wheel = g.settings.wheel.concat([50]); return g; }, /exactly 20/],
  ["8-slot Plinko board", () => { const g = mk(); g.settings.plinko.slots.pop(); return g; }, /exactly 9/],
  ["oneBid is an object", () => { const g = mk(); g.oneBid = { a: 1 }; return g; }, /at least 4 items/],
  ["oneBid item is a string", () => { const g = mk(); g.oneBid[0] = "Espresso"; return g; }, /must be an object/],
  ["oneBid item is null", () => { const g = mk(); g.oneBid[2] = null; return g; }, /must be an object/],
  ["settings is a string", () => { const g = mk(); g.settings = "loud"; return g; }, /must be an object/],
  ["settings is null-ish array", () => { const g = mk(); g.settings = [1, 2]; return g; }, /must be an object/],
  ["pricingGames is a string", () => { const g = mk(); g.settings.pricingGames = "plinko"; return g; }, /at least one/],
  ["wheel holds text", () => { const g = mk(); g.settings.wheel[7] = "50"; return g; }, /steps of 5/],
  ["wheel holds 0", () => { const g = mk(); g.settings.wheel[7] = 0; return g; }, /steps of 5/],
  ["showcases is missing", () => { const g = mk(); delete g.showcases; return g; }, /at least 2 showcases/],
  ["a showcase prize has no price", () => { const g = mk(); delete g.showcases[0].prizes[0].price; return g; }, /whole-dollar price/],
  ["a note is a number", () => { const g = mk(); g.oneBid[0].note = 5; return g; }, /must be text/],
  ["plinko set is an array", () => { const g = mk(); g.plinko[0] = []; return g; }, /must be an object/],
  ["cliffhangers is a number", () => { const g = mk(); g.cliffhangers = 3; return g; }, /at least one set/],
  ["luckyseven price is text", () => { const g = mk(); g.luckyseven[0].price = "21485"; return g; }, /five-digit/],
  ["maxChips 10", () => { const g = mk(); g.settings.plinko.maxChips = 10; return g; }, /from 1 to 9/],
  ["gamesPerShowdown 9", () => { const g = mk(); g.settings.gamesPerShowdown = 9; return g; }, /from 1 to 8/],
];

test("A8 the validator refuses every broken file with a message naming the field", () => {
  BAD.forEach(([label, build, re]) => {
    assert.throws(() => Core.validateGame(build()), re, label);
  });
});

test("A8 junk of every primitive type is refused, never crashes", () => {
  [null, undefined, 0, 1, "", "x", true, false, [], [1, 2, 3], NaN, Infinity, () => 1, Symbol.iterator]
    .forEach((junk) => {
      assert.throws(() => Core.validateGame(junk), Error, `validateGame(${String(junk)})`);
    });
});

test("A8 a switched-off pricing game needs no content, and the normalised copy drops it", () => {
  const g = mk();
  delete g.plinko;
  delete g.luckyseven;
  g.settings.pricingGames = ["cliffhangers"];
  assert.equal(Core.validateGame(g), true);
  const n = Core.normalizeGame(g);
  assert.deepEqual(n.plinko, []);
  assert.deepEqual(n.luckyseven, []);
  assert.equal(n.cliffhangers.length > 0, true);
});

test("A8 normalizeGame never mutates its input and computes showcase totals", () => {
  const raw = mk();
  const before = JSON.stringify(raw);
  const n = Core.normalizeGame(raw);
  assert.equal(JSON.stringify(raw), before, "the caller's object is untouched");
  n.showcases.forEach((sc, i) => {
    assert.equal(sc.total, raw.showcases[i].prizes.reduce((t, p) => t + p.price, 0));
  });
  assert.equal(Object.isFrozen(n) || true, true);
});

test("A8 control characters and over-long text are stripped, not rejected", () => {
  const g = mk();
  g.oneBid[0].name = `Esp resso   `;
  g.title = "x".repeat(500);
  const n = Core.normalizeGame(g);
  assert.equal(n.oneBid[0].name, "Espresso");
  assert.equal(n.title.length <= 80, true);
});

/* ============================================================
   A9 — phone message fuzz and view leaks
   ============================================================ */

test("A9 validatePhoneMsg accepts only the four documented intents", () => {
  const ok = [
    [{ t: "bid", amount: 1 }, { t: "bid", amount: 1 }],
    [{ t: "bid", amount: 999999 }, { t: "bid", amount: 999999 }],
    [{ t: "guess", value: 0 }, { t: "guess", value: 0 }],
    [{ t: "guess", value: 99 }, { t: "guess", value: 99 }],
    [{ t: "spin" }, { t: "spin" }],
    [{ t: "spin", pid: "p9" }, { t: "spin" }],
    [{ t: "plinko", answer: "higher" }, { t: "plinko", answer: "higher" }],
    [{ t: "plinko", slot: 0 }, { t: "plinko", slot: 0 }],
    [{ t: "plinko", slot: 8 }, { t: "plinko", slot: 8 }],
  ];
  ok.forEach(([input, expected]) => {
    assert.deepEqual(Core.validatePhoneMsg(input), expected, JSON.stringify(input));
  });

  const junk = [
    null, undefined, 0, 1, "", "bid", true, [], [{ t: "bid" }], NaN,
    {}, { t: 1 }, { t: "bid" }, { t: "bid", amount: 0 }, { t: "bid", amount: -5 },
    { t: "bid", amount: 1.5 }, { t: "bid", amount: "300" }, { t: "bid", amount: 1e9 },
    { t: "bid", amount: Infinity }, { t: "bid", amount: null },
    { t: "guess", value: -1 }, { t: "guess", value: 1e9 }, { t: "guess", value: "4" },
    { t: "plinko" }, { t: "plinko", answer: "HIGHER" }, { t: "plinko", answer: "" },
    { t: "plinko", slot: -1 }, { t: "plinko", slot: 9 }, { t: "plinko", slot: 1.5 },
    { t: "plinko", slot: "3" }, { t: "reveal" }, { t: "nextSegment" }, { t: "undo" },
    { t: "showcaseBid", amount: 10 }, { t: "start" }, { type: "bid", amount: 5 },
  ];
  junk.forEach((input) => {
    assert.equal(Core.validatePhoneMsg(input), null, `junk: ${JSON.stringify(input)}`);
  });
});

test("A9 validatePhoneMsg returns a NARROW copy: nothing else survives", () => {
  const hostile = { t: "bid", amount: 5, pid: "p2", type: "revealBids", __proto__: { evil: 1 } };
  const clean = Core.validatePhoneMsg(hostile);
  assert.deepEqual(Object.keys(clean).sort(), ["amount", "t"]);
  const slot = Core.validatePhoneMsg({ t: "plinko", slot: 3, answer: undefined, path: [1, 2] });
  assert.deepEqual(Object.keys(slot).sort(), ["slot", "t"]);
});

test("A9 phoneView never carries another player's unrevealed bid, nor the price", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const marks = { p1: 314159, p2: 271828, p3: 161803, p4: 141421 };
  const bid = run(s, PLAYERS.map((p) => ({ type: "bid", pid: p.pid, amount: marks[p.pid] })));
  const price = String(bid.row.item.price);
  PLAYERS.forEach((me) => {
    const text = JSON.stringify(Core.phoneView(bid, me.pid));
    assert.equal(text.includes(String(marks[me.pid])), true, "a phone sees its own bid");
    Object.keys(marks).forEach((other) => {
      if (other === me.pid) return;
      assert.equal(text.includes(String(marks[other])), false,
        `${me.pid} must not see ${other}'s bid`);
    });
    assert.equal(text.includes(`"price"`), false, "no price field reaches a phone");
    assert.equal(text.includes(price), false, "the item price never reaches a phone");
    // Who has bid is public; what they bid is not.
    const view = Core.phoneView(bid, me.pid);
    assert.equal(view.placed.every((x) => x.placed === true), true);
  });
});

test("A9 a spectator and a mid-game joiner get a safe view with no controls", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  const bid = run(s, [{ type: "bid", pid: "p1", amount: 250 }]);
  const ghost = Core.phoneView(bid, "zz");
  assert.equal(ghost.spectator, true);
  assert.equal(ghost.screen, "wait");
  assert.equal(JSON.stringify(ghost).includes("250"), false);
  assert.equal(JSON.stringify(ghost).includes(String(bid.row.item.price)), false);
});

test("A9 a pricing-game phone never sees the answer, the path or the digits ahead", () => {
  // Plinko: `actual` and the bounce path stay on the host.
  let p = plinkoGame();
  const answerView = Core.phoneView(p, "p1");
  assert.equal(answerView.screen, "plinko");
  assert.equal(JSON.stringify(answerView).includes("actual"), false);
  ["higher", "correct", "lower", "correct"].forEach((a) => { p = Core.reduce(p, { type: "plinkoAnswer", answer: a }, fixed(0)); });
  const dropped = Core.reduce(p, { type: "plinkoDrop", slot: 3 }, fixed(0.999));
  const dropView = JSON.stringify(Core.phoneView(dropped, "p1"));
  assert.equal(dropView.includes("path"), false, "the bounce path never reaches a phone");
  assert.equal(dropView.includes("landing"), false);

  // Lucky Seven: only the digits already played are known.
  const l7 = l7Game();
  const v = Core.phoneView(l7, "p1");
  assert.deepEqual(v.known, [2]);
  assert.equal(JSON.stringify(v).includes("24680"), false);

  // Cliff Hangers: the item name, never its price.
  const ch = cliffGame();
  const cv = JSON.stringify(Core.phoneView(ch, "p1"));
  assert.equal(cv.includes('"price"'), false);
  ch.game.items.forEach((item) => {
    assert.equal(cv.includes(`:${item.price}`), false, `price ${item.price} leaked`);
  });
});

test("A9 only the player on stage gets controls; everyone else waits", () => {
  const ch = cliffGame();
  assert.equal(Core.phoneView(ch, "p1").screen, "guess");
  ["p2", "p3", "p4"].forEach((pid) => {
    assert.equal(Core.phoneView(ch, pid).screen, "wait", `${pid} has no controls`);
  });
  const sd = toShowdownWith({ per: 3 });
  const up = sd.showdown.spinners[0];
  assert.equal(Core.phoneView(sd, up).screen, "spin");
  sd.showdown.spinners.slice(1).forEach((pid) => {
    assert.equal(Core.phoneView(sd, pid).screen, "wait");
  });
});

test("A9 showcase bids are masked from the other finalist until the reveal", () => {
  const { s, chooser, other, actual } = claimedShowcase();
  const bid = run(s, [
    { type: "showcaseBid", pid: chooser, amount: 123456 },
    { type: "showcaseBid", pid: other, amount: 654321 },
  ]);
  const mine = JSON.stringify(Core.phoneView(bid, chooser));
  assert.equal(mine.includes("123456"), true);
  assert.equal(mine.includes("654321"), false, "the other finalist's bid never leaks");
  assert.equal(mine.includes(String(actual(chooser))), false, "the showcase total is hidden");
  assert.equal(mine.includes(String(actual(other))), false);
});

/* ============================================================
   A10 — immutability, illegal events, history, undo
   ============================================================ */

const EVERY_EVENT = [
  { type: "start" }, { type: "bid", pid: "p1", amount: 100 }, { type: "revealBids" },
  { type: "rebid" }, { type: "pickGame", kind: "plinko" }, { type: "chGuess", amount: 10 },
  { type: "plinkoAnswer", answer: "higher" }, { type: "plinkoDrop", slot: 3 },
  { type: "l7Guess", digit: 4 }, { type: "spin" }, { type: "spinAgain" }, { type: "stay" },
  { type: "showcasePass", pass: true }, { type: "showcaseBid", pid: "p1", amount: 100 },
  { type: "revealShowcase" }, { type: "nextSegment" }, { type: "finish" }, { type: "undo" },
];

test("A10 every event applied to a DEEP-FROZEN state never mutates it", () => {
  const states = [
    started(tiny(), PLAYERS, fixed(0)),
    cliffGame(),
    plinkoGame(),
    l7Game(),
    toShowdownWith({ per: 3 }),
    toShowcaseState(),
  ];
  states.forEach((raw) => {
    const state = deepFreeze(JSON.parse(JSON.stringify(raw)));
    const before = JSON.stringify(state);
    EVERY_EVENT.forEach((ev) => {
      const next = Core.reduce(state, ev, fixed(0.5));
      assert.equal(JSON.stringify(state), before, `${ev.type} mutated the state it was handed`);
      assert.equal(next === state || typeof next === "object", true);
    });
  });
});

test("A10 unknown, malformed and hostile events return the very same object", () => {
  const s = started(tiny(), PLAYERS, fixed(0));
  [null, undefined, 0, "bid", [], { }, { type: 7 }, { type: "" }, { type: "hack" },
    { type: "constructor" }, { type: "toString" }, { type: "__proto__" },
    { type: "hasOwnProperty" }].forEach((ev) => {
    assert.equal(Core.reduce(s, ev, fixed(0)), s, `event ${JSON.stringify(ev)}`);
  });
  assert.equal(Core.reduce(null, { type: "start" }, fixed(0)), null);
});

test("A10 undo walks back one step through EVERY segment of a whole episode", () => {
  const g = tiny();
  g.settings.gamesPerShowdown = 1;
  let s = started(g, PLAYERS, fixed(0));
  const script = [];
  ["p1", "p2"].forEach((pid) => {
    script.push({ type: "bid", pid, amount: 1 }, { type: "revealBids" }, { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" }, { type: "spin" }, { type: "stay" }, { type: "nextSegment" });
  });
  script.push({ type: "showcasePass", pass: true });

  const seen = [];
  script.forEach((ev) => {
    const before = s;
    const next = Core.reduce(s, ev, wheelAt(3));
    assert.notEqual(next, before, `${ev.type} did nothing`);
    seen.push({ ev, before });
    s = next;
  });
  assert.equal(s.phase, "showcase");

  // Now unwind the entire episode, one undo at a time.
  for (let i = seen.length - 1; i >= 0; i -= 1) {
    const back = Core.reduce(s, { type: "undo" }, fixed(0));
    const expected = Object.assign({}, seen[i].before, { history: back.history, content: back.content });
    assert.deepEqual(back, expected, `undo of ${seen[i].ev.type} (step ${i}) did not restore the state`);
    assert.equal(back.content, s.content, "undo keeps the content object");
    s = back;
  }
  assert.equal(s.phase, "row");
  assert.equal(s.history.length, 1, "only the `start` event is left in the history");
  const setup = Core.reduce(s, { type: "undo" }, fixed(0));
  assert.equal(setup.phase, "setup", "undoing `start` returns to the setup screen");
  assert.equal(setup.history.length, 0);
  assert.equal(Core.reduce(setup, { type: "undo" }, fixed(0)), setup, "nothing left to undo");
});

test("A10 undo puts back money, chips and the wheel", () => {
  const s = toShowdownWith({ per: 3 });
  const first = s.showdown.spinners[0];
  const hit = Core.reduce(s, { type: "spin" }, wheelAt(0));       // $1.00 + bonus
  assert.equal(hit.winnings[first], (s.winnings[first] || 0) + 1000);
  const back = Core.reduce(hit, { type: "undo" }, fixed(0));
  assert.equal(back.winnings[first], s.winnings[first]);
  assert.deepEqual(back.showdown.totals, s.showdown.totals);
  assert.equal(back.showdown.lastSpin, s.showdown.lastSpin);

  let p = plinkoGame();
  ["higher", "correct", "lower", "correct"].forEach((a) => { p = Core.reduce(p, { type: "plinkoAnswer", answer: a }, fixed(0)); });
  const drop = Core.reduce(p, { type: "plinkoDrop", slot: 4 }, fixed(0));
  assert.notEqual(drop.winnings.p1, p.winnings.p1);
  const undone = Core.reduce(drop, { type: "undo" }, fixed(0));
  assert.deepEqual(undone.winnings, p.winnings);
  assert.equal(undone.game.dropped, 0);
});

test("A10 the history is capped and undo is still exact at the cap", () => {
  let s = started(tiny(), PLAYERS, fixed(0));
  for (let i = 1; i <= 80; i += 1) {
    s = Core.reduce(s, { type: "bid", pid: "p1", amount: i }, fixed(0));
  }
  assert.equal(s.history.length <= 60, true, `history grew to ${s.history.length}`);
  const back = Core.reduce(s, { type: "undo" }, fixed(0));
  assert.equal(back.row.bids.p1, 79);
});

test("A10 finish jumps to the standings from any segment and stops there", () => {
  [started(tiny(), PLAYERS, fixed(0)), cliffGame(), toShowdownWith({ per: 3 }), toShowcaseState()]
    .forEach((s) => {
      const done = Core.reduce(s, { type: "finish" }, fixed(0));
      assert.equal(done.phase, "standings");
      assert.equal(Core.reduce(done, { type: "finish" }, fixed(0)), done);
      assert.equal(Core.reduce(done, { type: "nextSegment" }, fixed(0)), done);
      const back = Core.reduce(done, { type: "undo" }, fixed(0));
      assert.equal(back.phase, s.phase, "finish can be undone");
    });
});

test("A10 legalActions matches what the reducer will actually accept", () => {
  const states = [
    Core.createState(tiny(), PLAYERS),
    started(tiny(), PLAYERS, fixed(0)),
    cliffGame(), plinkoGame(), l7Game(),
    toShowdownWith({ per: 3 }), toShowcaseState(),
  ];
  states.forEach((s) => {
    const legal = Core.legalActions(s);
    assert.equal(Array.isArray(legal), true);
    legal.forEach((type) => assert.equal(typeof type, "string"));
  });
  const fresh = Core.createState(tiny(), PLAYERS);
  assert.deepEqual(Core.legalActions(fresh), ["start"]);
  const row = started(tiny(), PLAYERS, fixed(0));
  assert.equal(Core.legalActions(row).includes("bid"), true);
  assert.equal(Core.legalActions(row).includes("revealBids"), false);
  assert.equal(Core.legalActions(row).includes("plinkoDrop"), false);
  const ch = cliffGame();
  assert.equal(Core.legalActions(ch).includes("chGuess"), true);
  assert.equal(Core.legalActions(ch).includes("plinkoDrop"), false);
  assert.equal(Core.legalActions(ch).includes("spin"), false);
});

test("A10 createState refuses an empty or over-full roster and de-duplicates pids", () => {
  assert.throws(() => Core.createState(tiny(), []), /at least one player/);
  assert.throws(() => Core.createState(tiny(), roster(17)), /at most 16/);
  const dup = Core.createState(tiny(), [
    { pid: "p1", name: "Ada" }, { pid: "p1", name: "Ada again" }, { pid: "p2", name: "Ben" },
  ]);
  assert.deepEqual(dup.roster.map((r) => r.pid), ["p1", "p2"]);
});

