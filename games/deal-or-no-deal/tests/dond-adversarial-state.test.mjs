/* ============================================================
   Deal or No Deal — ADVERSARIAL unit suite, part 2 (independent tester)
   Written against docs/12-deal-or-no-deal-spec.md, not against the
   implementation. Everything here tries to break the core: hostile
   rngs, hostile boards, hostile phone frames, events fired in the
   wrong phase, and a structural leak probe that works on ANY board.
   Split from dond-adversarial.test.mjs only to stay under the 800-line
   house limit; this half is phone frames, immutability, undo and leaks.
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
   A10 — phone message fuzz
   ============================================================ */

test("A10 validatePhoneMsg accepts three shapes and narrows them", () => {
  assert.deepEqual(Core.validatePhoneMsg({ t: "pick", n: 1 }), { t: "pick", n: 1 });
  assert.deepEqual(Core.validatePhoneMsg({ t: "pick", n: 30 }), { t: "pick", n: 30 });
  assert.deepEqual(Core.validatePhoneMsg({ t: "decision", choice: "deal" }), { t: "decision", choice: "deal" });
  assert.deepEqual(Core.validatePhoneMsg({ t: "advice", choice: "no" }), { t: "advice", choice: "no" });
  // Extra fields never survive: the host only ever sees the narrow copy.
  const narrowed = Core.validatePhoneMsg({ t: "pick", n: 3, pid: "p9", admin: true, cases: [1, 2] });
  assert.deepEqual(Object.keys(narrowed).sort(), ["n", "t"]);
  const d = Core.validatePhoneMsg({ t: "decision", choice: "deal", pid: "p9", offer: 1e9 });
  assert.deepEqual(Object.keys(d).sort(), ["choice", "t"]);
});

test("A10 validatePhoneMsg returns null for every hostile frame, and never throws", () => {
  const junk = [
    null, undefined, 0, 1, "", "pick", true, [], [1, 2], () => {}, NaN,
    {}, { t: 1 }, { t: "pick" }, { t: "PICK", n: 1 }, { t: " pick", n: 1 },
    { t: "pick", n: 0 }, { t: "pick", n: -1 }, { t: "pick", n: 31 }, { t: "pick", n: 1.5 },
    { t: "pick", n: "1" }, { t: "pick", n: null }, { t: "pick", n: NaN }, { t: "pick", n: Infinity },
    { t: "pick", n: 1e9 }, { t: "pick", n: [1] }, { t: "pick", n: { valueOf: () => 1 } },
    { t: "decision" }, { t: "decision", choice: "" }, { t: "decision", choice: "DEAL" },
    { t: "decision", choice: "maybe" }, { t: "decision", choice: null }, { t: "decision", choice: ["deal"] },
    { t: "advice", choice: "yes" }, { t: "advice", choice: 0 }, { t: "advice", choice: "deal " },
    { t: "view", screen: "pick" }, { t: "state" }, { t: "__proto__" },
    { t: "adviceVote", pid: "p1", choice: "deal" }, { type: "deal" },
    JSON.parse('{"t":"pick","n":1,"__proto__":{"polluted":true}}'),
  ];
  junk.forEach((raw) => {
    let out;
    assert.doesNotThrow(() => { out = Core.validatePhoneMsg(raw); }, `threw on ${JSON.stringify(raw)}`);
    if (raw && typeof raw === "object" && raw.t === "pick" && raw.n === 1) return; // the last, legal one
    assert.equal(out, null, `accepted ${JSON.stringify(raw)}`);
  });
  assert.equal({}.polluted, undefined, "no prototype pollution");
});

test("A10 a legal-looking pick for a case the board does not have is still refused", () => {
  const s = seated(BOARD, 1);           // ten cases
  const msg = Core.validatePhoneMsg({ t: "pick", n: 26 });
  assert.deepEqual(msg, { t: "pick", n: 26 }, "shape-valid: the cap is the global 30");
  assert.equal(Core.reduce(s, { type: "openCase", n: msg.n }), s, "but the reducer has the last word");
});

/* ============================================================
   A11 — immutability against a deep-frozen state
   ============================================================ */

test("A11 no event mutates a deep-frozen state, in any phase", () => {
  const phases = [];
  let s = fresh();
  phases.push(s);
  s = Core.reduce(s, { type: "start" }); phases.push(s);
  s = Core.reduce(s, { type: "seat", pid: "p1" }, fixed(0.5)); phases.push(s);
  s = Core.reduce(s, { type: "pickCase", n: 1 }); phases.push(s);
  s = finishRound(s); phases.push(s);
  s = Core.reduce(s, { type: "bankerOffer" }, fixed(0.5)); phases.push(s);
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" }); phases.push(s);
  let noDeal = s;
  for (let r = 0; r < 3; r += 1) noDeal = Core.reduce(toOffer(noDeal), { type: "noDeal" });
  phases.push(noDeal);                                   // swap
  phases.push(Core.reduce(noDeal, { type: "swap", yes: true }));   // reveal
  const dealt = Core.reduce(s, { type: "deal" });
  phases.push(dealt);
  const done = Core.reduce(dealt, { type: "revealOwn" });
  phases.push(done);                                     // result
  phases.push(Core.reduce(done, { type: "finish" }));    // standings

  const EVENTS = [
    { type: "start" }, { type: "seat", pid: "p2" }, { type: "pickCase", n: 2 },
    { type: "openCase", n: 3 }, { type: "bankerOffer" }, { type: "deal" }, { type: "noDeal" },
    { type: "adviceVote", pid: "p3", choice: "no" }, { type: "adviceClose" },
    { type: "request", pid: "p1", choice: "no" }, { type: "clearRequest" },
    { type: "swap", yes: true }, { type: "swap", yes: false },
    { type: "revealRest" }, { type: "revealOwn" }, { type: "nextContestant" },
    { type: "finish" }, { type: "undo" },
    { type: "nope" }, { type: "" }, {}, null, undefined, [], "deal", 7,
  ];
  phases.forEach((phase) => {
    const before = JSON.stringify(phase);
    deepFreeze(phase);
    EVENTS.forEach((event) => {
      assert.doesNotThrow(
        () => Core.reduce(phase, event, fixed(0.5)),
        `${event && event.type} threw in phase ${phase.phase}`,
      );
    });
    assert.equal(JSON.stringify(phase), before, `phase ${phase.phase} was mutated`);
  });
});

test("A11 an event named after an Object.prototype member is just unknown", () => {
  // DEFECT N-D2 (fixed by the tester in dond-core.js): `HANDLERS[event.type]`
  // was a bare lookup, so {type:"toString"} CALLED Object.prototype.toString and
  // the reducer returned a corrupted state ({0:"[",1:"o",…, phase:undefined}),
  // while {type:"valueOf"} threw a TypeError straight out of the pure core.
  const states = [fresh(), seated(), toOffer(seated())];
  const POISON = [
    "toString", "valueOf", "constructor", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__",
    "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
  ];
  states.forEach((s) => {
    POISON.forEach((type) => {
      let out;
      assert.doesNotThrow(() => { out = Core.reduce(s, { type }, fixed(0.5)); },
        `reduce({type:"${type}"}) threw in phase ${s.phase}`);
      assert.equal(out, s, `reduce({type:"${type}"}) did not return the same object`);
    });
    // legalActions must never name one of them either.
    Core.legalActions(s).forEach((t) => assert.ok(POISON.indexOf(t) < 0, `legalActions named ${t}`));
  });
});

test("A11 every selector is read-only against a frozen state", () => {
  const s = deepFreeze(toOffer(seated()));
  const selectors = [
    () => Core.ev(s), () => Core.offerFor(s, fixed(0.5)), () => Core.factorFor(s),
    () => Core.boardColumns(s), () => Core.casesView(s), () => Core.revealOrder(s),
    () => Core.ownAmount(s), () => Core.standings(s), () => Core.waitingContestants(s),
    () => Core.adviceCounts(s), () => Core.adviceChart(s), () => Core.legalActions(s),
    () => Core.unopenedCases(s), () => Core.otherCases(s), () => Core.remainingAmounts(s),
    () => Core.phoneView(s, "p1"), () => Core.phoneView(s, "p2"), () => Core.phoneView(s, "zz"),
    () => Core.formatMoney(s, 1234.5), () => Core.nameOf(s, "p1"),
  ];
  const before = JSON.stringify(s);
  selectors.forEach((fn, i) => assert.doesNotThrow(fn, `selector ${i}`));
  assert.equal(JSON.stringify(s), before);
  assert.equal(Core.formatMoney(s, 1234.5), "$1,234.50");
  assert.equal(Core.formatMoney(s, 1000000), "$1,000,000");
});

/* ============================================================
   A12 — undo, in every phase
   ============================================================ */

test("A12 undo steps back exactly one move through a whole game", () => {
  const rng = lcg(3);
  const script = [
    { type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 },
  ];
  let s = fresh();
  const trail = [];
  const push = (state, event) => {
    const next = Core.reduce(state, event, rng);
    if (next !== state) trail.push({ before: state, after: next, event });
    return next;
  };
  script.forEach((e) => { s = push(s, e); });
  for (let r = 0; r < BOARD.settings.rounds.length; r += 1) {
    const queue = s.cases.filter((c) => !c.opened && c.n !== s.own).map((c) => c.n);
    for (let i = 0; s.toOpen > 0; i += 1) s = push(s, { type: "openCase", n: queue[i] });
    s = push(s, { type: "bankerOffer" });
    s = push(s, { type: "adviceVote", pid: "p2", choice: "deal" });   // not an undo step
    s = push(s, { type: "noDeal" });
  }
  s = push(s, { type: "swap", yes: true });
  s = push(s, { type: "revealOwn" });
  s = push(s, { type: "nextContestant" });
  assert.equal(s.phase, "seat");
  const phasesSeen = new Set(trail.map((t) => t.after.phase));
  ["seat", "pick", "round", "offer", "swap", "reveal"].forEach((p) => {
    assert.ok(phasesSeen.has(p), `the script visited ${p}`);
  });

  // Now walk the whole thing backwards and land on the very first state.
  const undoable = trail.filter((t) => !["adviceVote", "request", "clearRequest"].includes(t.event.type));
  for (let i = undoable.length - 1; i >= 0; i -= 1) {
    const back = Core.reduce(s, { type: "undo" });
    assert.notEqual(back, s, `undo #${i} did nothing (phase ${s.phase})`);
    const want = Object.assign({}, undoable[i].before, { history: back.history });
    assert.deepEqual(
      JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(want)),
      `undo #${i} (${undoable[i].event.type}) did not restore the previous state`,
    );
    assert.equal(back.game, s.game, "the board constant survives every undo");
    s = back;
  }
  assert.equal(s.phase, "setup");
  assert.deepEqual(s.history, []);
  assert.equal(Core.reduce(s, { type: "undo" }), s, "undo at the start is a no-op");
});

test("A12 undo brings a banked contestant back into play", () => {
  let s = Core.reduce(toOffer(seated()), { type: "deal" });
  s = Core.reduce(s, { type: "revealOwn" });
  assert.equal(s.phase, "result");
  assert.equal(s.contestants.find((c) => c.pid === "p1").out, true);
  s = Core.reduce(s, { type: "undo" });
  assert.equal(s.phase, "reveal");
  assert.equal(s.contestants.find((c) => c.pid === "p1").out, false);
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, 0);
  assert.equal(s.outcome, null);
  assert.equal(Core.caseByN(s, s.own).opened, false, "their case is sealed again");
});

test("A12 undo after finish reopens the night, and history is capped", () => {
  let s = Core.reduce(toOffer(seated()), { type: "finish" });
  assert.equal(s.phase, "standings");
  assert.equal(s.contestants.find((c) => c.pid === "p1").reason, "unfinished");
  assert.equal(s.contestants.find((c) => c.pid === "p1").won, 0);
  s = Core.reduce(s, { type: "undo" });
  assert.equal(s.phase, "offer", "back on the banker's call");
  assert.equal(s.current, "p1");
  assert.ok(s.history.length <= Core.MAX_HISTORY);
  // Finishing after a deal banks the offer instead of nothing.
  const dealt = Core.reduce(toOffer(seated()), { type: "deal" });
  const stopped = Core.reduce(dealt, { type: "finish" });
  assert.equal(stopped.contestants.find((c) => c.pid === "p1").won, dealt.deal.offer);
  assert.equal(stopped.contestants.find((c) => c.pid === "p1").reason, "deal");
});

test("A12 the history never grows past MAX_HISTORY and stays serialisable", () => {
  let s = fresh();
  for (let i = 0; i < Core.MAX_HISTORY + 40; i += 1) {
    s = Core.reduce(s, { type: "start" });
    s = Core.reduce(s, { type: "undo" });
    s = Core.reduce(s, { type: "start" });
  }
  assert.ok(s.history.length <= Core.MAX_HISTORY, `history is ${s.history.length}`);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)), "state stays serialisable");
  assert.ok(s.history.every((h) => h.game === undefined), "the board is not copied into every snapshot");
});

/* ============================================================
   A13 — the leak rule: phoneView never carries a sealed amount
   ============================================================ */

/**
 * The airtight version of the leak test: every SEALED amount is replaced with
 * a unique sentinel before phoneView runs. Opened cases and already-computed
 * offers keep their real values, so a sentinel appearing anywhere in the view
 * can only have come from a sealed case. This works on ANY board, including
 * the shipped one whose round amounts can collide with a banker's offer.
 */
function tamper(state) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.cases = copy.cases.map((c, i) => (c.opened ? c : Object.assign({}, c, { amount: 7654321 + i })));
  return copy;
}

function assertNoLeak(state, pid, where) {
  const view = Core.phoneView(tamper(state), pid);
  const { numbers, strings } = collect(view);
  numbers.forEach((n) => {
    assert.ok(n < 7654321 || n > 7654321 + 40, `${where}: sealed amount ${n} reached ${pid}`);
  });
  strings.forEach((str) => {
    assert.ok(str.indexOf("7,654,3") < 0 && str.indexOf("7654321") < 0,
      `${where}: sealed amount leaked to ${pid} in "${str}"`);
  });
  return view;
}

test("A13 no phone view carries a sealed amount, in any phase, for any pid", () => {
  const PIDS = ["p1", "p2", "p3", "zz", "", null, undefined, "__proto__"];
  const rng = lcg(21);
  const seen = new Set();
  const check = (s, label) => {
    seen.add(s.phase);
    PIDS.forEach((pid) => assertNoLeak(s, pid, label));
  };
  let s = fresh();
  check(s, "setup");
  s = Core.reduce(s, { type: "start" }); check(s, "seat");
  s = Core.reduce(s, { type: "seat", pid: "p1" }, rng); check(s, "pick");
  s = Core.reduce(s, { type: "pickCase", n: 4 }); check(s, "round-start");
  const queue = s.cases.filter((c) => c.n !== s.own).map((c) => c.n);
  for (let i = 0; s.toOpen > 0; i += 1) {
    s = Core.reduce(s, { type: "openCase", n: queue[i] });
    check(s, `round-open-${i}`);
  }
  s = Core.reduce(s, { type: "bankerOffer" }, rng); check(s, "offer");
  s = Core.reduce(s, { type: "adviceVote", pid: "p2", choice: "deal" }); check(s, "offer-voted");
  s = Core.reduce(s, { type: "request", pid: "p1", choice: "no" }); check(s, "offer-requested");
  let deep = s;
  for (let guard = 0; deep.phase !== "swap" && guard < 20; guard += 1) {
    deep = Core.reduce(toOffer(deep, rng), { type: "noDeal" });
    check(deep, `deep-${guard}`);
  }
  assert.equal(deep.phase, "swap");
  check(deep, "swap");
  deep = Core.reduce(deep, { type: "swap", yes: true }); check(deep, "reveal");
  let dealt = Core.reduce(s, { type: "deal" }); check(dealt, "reveal-after-deal");
  while (Core.revealOrder(dealt).length) {
    dealt = Core.reduce(dealt, { type: "revealRest" });
    check(dealt, "revealing");
  }
  dealt = Core.reduce(dealt, { type: "revealOwn" }); check(dealt, "result");
  dealt = Core.reduce(dealt, { type: "finish" }); check(dealt, "standings");
  ["setup", "seat", "pick", "round", "offer", "swap", "reveal", "result", "standings"]
    .forEach((p) => assert.ok(seen.has(p), `phase ${p} was checked`));
});

test("A13 the same leak probe holds on the shipped 26-case board", () => {
  const rng = lcg(5);
  let s = run(Core.createState({}, PLAYERS, {}), [
    { type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 13 },
  ], rng);
  for (let r = 0; r < Content.DEFAULT_ROUNDS.length; r += 1) {
    s = finishRound(s, rng);
    s = Core.reduce(s, { type: "bankerOffer" }, rng);
    ["p1", "p2", "p3", "zz"].forEach((pid) => assertNoLeak(s, pid, `shipped round ${r}`));
    // The offer itself is a formatted string on every phone, never a number.
    const mine = Core.phoneView(s, "p1");
    assert.equal(typeof mine.offer, "string");
    assert.equal(mine.screen, "decision");
    const theirs = Core.phoneView(s, "p2");
    assert.equal(typeof theirs.offer, "string");
    assert.equal(theirs.screen, "advice");
    s = Core.reduce(s, { type: "noDeal" });
  }
  assert.equal(s.phase, "swap");
});

test("A13 the contestant's phone gets no advice ballot, and the others get no case grid", () => {
  const s = toOffer(seated());
  const mine = Core.phoneView(s, "p1");
  assert.equal(mine.screen, "decision");
  assert.equal(mine.myVote, undefined, "no ballot for the contestant");
  assert.equal(mine.mine, true);
  const theirs = Core.phoneView(s, "p2");
  assert.equal(theirs.screen, "advice");
  assert.equal(theirs.asked, undefined);
  assert.equal(theirs.cases, undefined, "spectators get no case grid");
  const spectator = Core.phoneView(s, "zz");
  assert.equal(spectator.screen, "advice");
  assert.equal(spectator.spectator, true);
  // During a round only the contestant is handed a grid, and every sealed
  // case in it is unlabelled.
  const round = finishRound(seated());
  const grid = Core.phoneView(round, "p1");
  assert.equal(grid.screen, "pick");
  assert.ok(grid.cases.every((c) => c.opened || c.label === ""));
  assert.equal(Core.phoneView(round, "p2").screen, "wait");
  assert.equal(Core.phoneView(round, "p2").cases, undefined);
});

/* ============================================================
   A14 — a few things that only bite in a long night
   ============================================================ */

test("A14 boardColumns strikes out exactly the amounts that are gone", () => {
  const before = seated();
  const cols = Core.boardColumns(before);
  assert.equal(cols.left.length + cols.right.length, 10);
  assert.ok([...cols.left, ...cols.right].every((r) => !r.opened), "nothing is gone at the start");
  const after = finishRound(before);
  const gone = after.cases.filter((c) => c.opened).map((c) => c.amount).sort((a, b) => a - b);
  const struck = [...Core.boardColumns(after).left, ...Core.boardColumns(after).right]
    .filter((r) => r.opened).map((r) => r.amount).sort((a, b) => a - b);
  assert.deepEqual(struck, gone);
  assert.ok(!struck.includes(Core.caseByN(after, after.own).amount), "their own amount is still live");
  // Before a board is dealt nothing may read as opened.
  assert.ok(Core.boardColumns(fresh()).left.every((r) => !r.opened));
});

test("A14 finish is refused at setup and at standings, and standings are ordered", () => {
  const setup = fresh();
  assert.equal(Core.reduce(setup, { type: "finish" }), setup);
  const done = Core.reduce(Core.reduce(toOffer(seated()), { type: "deal" }), { type: "finish" });
  assert.equal(done.phase, "standings");
  assert.equal(Core.reduce(done, { type: "finish" }), done, "finishing twice is a no-op");
  assert.equal(Core.reduce(done, { type: "nextContestant" }), done);
  assert.equal(Core.reduce(done, { type: "seat", pid: "p2" }, fixed(0.5)), done, "the night is over");
  const rows = Core.standings(done);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].pid, "p1", "the banked contestant sorts first");
  assert.ok(rows.slice(1).every((r) => !r.out));
});

test("A14 legalActions only ever names events that really change the state", () => {
  const states = [
    fresh(), Core.reduce(fresh(), { type: "start" }), seated(), finishRound(seated()),
    toOffer(seated()), Core.reduce(toOffer(seated()), { type: "deal" }),
    Core.reduce(Core.reduce(toOffer(seated()), { type: "deal" }), { type: "revealOwn" }),
  ];
  states.forEach((s) => {
    const legal = Core.legalActions(s);
    legal.forEach((type) => {
      if (type === "undo") { assert.ok(s.history.length > 0); return; }
      const samples = {
        seat: Core.waitingContestants(s).map((c) => ({ type, pid: c.pid })),
        pickCase: (s.cases || []).map((c) => ({ type, n: c.n })),
        openCase: (s.cases || []).map((c) => ({ type, n: c.n })),
        adviceVote: [{ type, pid: "p2", choice: "deal" }],
        request: [{ type, pid: s.current, choice: "deal" }],
        swap: [{ type, yes: true }, { type, yes: false }],
      }[type] || [{ type }];
      assert.ok(
        samples.some((e) => Core.reduce(s, e, fixed(0.5)) !== s),
        `${type} was called legal in phase ${s.phase} but changes nothing`,
      );
    });
  });
});
