/* ============================================================
   Press Your Luck — independent tester suite
   Written by the verifier (not the implementer) against spec 17
   and the implementation report's documented rule choices. Each
   test drives the pure core only; no DOM, no timers.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Core = require("../js/pyl-core.js");
const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ============ Fixtures ============ */

const cash = (n, extra) => Object.assign({ cash: n }, extra || {});
const W = { whammy: true };

/** Board 1: index 0 cash 100, 1 cash 200 + spin, 2 Whammy, 3 prize, 4..14 cash, 15..17 Whammy. */
function board1() {
  const b = [cash(100), cash(200, { spin: true }), W, { prize: "Hot tub", value: 2500 }];
  for (let i = 4; i < 15; i += 1) b.push(cash(i * 50));
  b.push(W, W, W);
  return b;
}
/** Board 2: a recognisably different, bigger board (Whammy at 0). */
function board2() {
  const b = [W, cash(5000, { spin: true }), cash(9999), { prize: "Car", value: 15000 }];
  for (let i = 4; i < 16; i += 1) b.push(cash(1000 + i));
  b.push(W, W);
  return b;
}
function qs(n) {
  return Array.from({ length: n }, (_, i) => ({ q: `Q${i}?`, options: [`a${i}`, `b${i}`, `c${i}`], answer: i % 3 }));
}
function game(settings, patch) {
  return Object.assign({
    title: "Tester",
    settings: Object.assign({ questionsPerRound: 2, buzzSpins: 3, pickSpins: 1, whammyLimit: 4, rounds: 2 }, settings || {}),
    boards: [board1(), board2()],
    questions: qs(24),
  }, patch || {});
}
const P3 = [{ name: "Ada", pid: "p1" }, { name: "Ben", pid: "p2" }, { name: "Cy", pid: "p3" }];
const land = (i) => () => (i + 0.5) / 18;
const R = (s, ev, rng) => Core.reduce(s, ev, rng);

function begin(settings, players) {
  return R(Core.createState(game(settings), players || P3, { order: [[0, 1], [2, 3]] }), { type: "start" });
}
/** One question: `buzzer` buzzes (or null), judged `correct`; picks = {seat: idx|true|false}. */
function question(s, buzzer, correct, picks) {
  s = R(s, { type: "arm", on: true });
  if (buzzer !== null) s = R(s, { type: "buzz", seat: buzzer });
  s = R(s, { type: "judgeBuzz", correct });
  const ans = Core.currentQuestion(s).answer;
  for (const [seat, v] of Object.entries(picks || {})) {
    const idx = v === true ? ans : v === false ? (ans + 1) % 3 : v;
    s = R(s, { type: "pick", seat: Number(seat), idx });
  }
  return R(s, { type: "revealPicks" });
}
/** Build a board state directly from a started state with a chosen spin split. */
function onBoard(spins, extra, settings) {
  let s = begin(settings);
  s = question(s, null, false, {});
  s = R(s, { type: "nextQuestion" });
  s = question(s, null, false, {});
  // Nobody earned spins via play; patch counts directly (plain data, no mutation of s).
  s = Object.assign({}, s, { spins: spins.slice() }, extra || {});
  return R(s, { type: "toBoard" }, land(0));
}
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* ============ Spin awards ============ */

test("T: buzz awards buzzSpins, every correct pick awards pickSpins, wrong picks nothing", () => {
  let s = begin({ buzzSpins: 5, pickSpins: 2 });
  s = question(s, 1, true, { 0: true, 2: false });
  assert.deepEqual(s.spins, [2, 5, 0]);
  s = R(s, { type: "nextQuestion" });
  s = question(s, 0, false, { 1: true, 2: true });
  assert.deepEqual(s.spins, [2, 7, 2]);
});

test("T: buzz before arm is rejected; buzz after first winner is ignored", () => {
  let s = begin();
  assert.equal(R(s, { type: "buzz", seat: 0 }), s, "buzz before arm changed state");
  assert.equal(R(s, { type: "buzz", pid: "p2" }), s);
  s = R(s, { type: "arm", on: true });
  s = R(s, { type: "buzz", pid: "p2" });
  assert.equal(s.q.buzzed, 1);
  assert.equal(R(s, { type: "buzz", pid: "p1" }), s);
  // re-arming after a buzz is refused too
  assert.equal(R(s, { type: "arm", on: true }), s);
});

test("T: the buzzer cannot pick, right or wrong; others can change their pick until reveal", () => {
  for (const correct of [true, false]) {
    let s = begin();
    s = R(s, { type: "arm" });
    s = R(s, { type: "buzz", seat: 2 });
    s = R(s, { type: "judgeBuzz", correct });
    assert.equal(R(s, { type: "pick", seat: 2, idx: 0 }), s);
    assert.equal(R(s, { type: "pick", pid: "p3", idx: 1 }), s);
    s = R(s, { type: "pick", seat: 0, idx: 0 });
    s = R(s, { type: "pick", seat: 0, idx: 2 });
    assert.equal(Core.pickOf(s, 0), 2);
    s = R(s, { type: "revealPicks" });
    assert.equal(R(s, { type: "pick", seat: 1, idx: 0 }), s, "pick after reveal accepted");
  }
});

test("T: judgeBuzz correct:true with nobody buzzed is refused", () => {
  const s = begin();
  assert.equal(R(s, { type: "judgeBuzz", correct: true }), s);
});

/* ============ Spin order ============ */

test("T: spin order — fewest spins first, ties by lower total, then seat", () => {
  const base = onBoard([3, 1, 2]);
  assert.deepEqual(Core.spinOrder(base), [1, 2, 0]);
  assert.equal(base.control, 1);
  const tie = Object.assign({}, base, { spins: [2, 2, 2], totals: [500, 100, 300] });
  assert.deepEqual(Core.spinOrder(tie), [1, 2, 0]);
  const tie2 = Object.assign({}, base, { spins: [2, 2, 1], totals: [0, 0, 999] });
  assert.deepEqual(Core.spinOrder(tie2), [2, 0, 1]);
  const none = Object.assign({}, base, { spins: [0, 4, 0] });
  assert.deepEqual(Core.spinOrder(none), [1]);
});

/* ============ STOP ============ */

test("T: STOP lands where rng says for every square, applying the right effect (board 1)", () => {
  const b = board1();
  for (let i = 0; i < 18; i += 1) {
    const s0 = onBoard([0, 5, 0], { totals: [0, 1000, 0] });
    const s = R(s0, { type: "stop", pid: "p2" }, land(i));
    assert.equal(s.landing.index, i);
    assert.deepEqual(s.landing.square, b[i]);
    const sq = b[i];
    if (sq.whammy) {
      assert.equal(s.totals[1], 0);
      assert.equal(s.whammies[1], 1);
      assert.equal(s.awaiting, "advance", "Whammy should end the turn");
      assert.equal(s.spins[1], 4, "Whammy keeps the remaining spins");
    } else {
      const v = sq.prize ? sq.value : sq.cash;
      assert.equal(s.totals[1], 1000 + v);
      assert.equal(s.spins[1], sq.spin ? 5 : 4);
      assert.equal(s.awaiting, null);
    }
  }
});

test("T: rng edge values (0, 0.99999, 1, NaN) never land off the board", () => {
  for (const v of [0, 0.999999, 1, NaN, -0.1]) {
    const s = R(onBoard([0, 2, 0]), { type: "stop" }, () => v);
    assert.ok(s.landing.index >= 0 && s.landing.index < 18, `rng ${v} -> ${s.landing.index}`);
  }
});

test("T: STOP from a non-controlling phone or unknown pid is a no-op", () => {
  const s = onBoard([0, 2, 0]);
  assert.equal(s.control, 1);
  assert.equal(R(s, { type: "stop", pid: "p1" }, land(0)), s);
  assert.equal(R(s, { type: "stop", pid: "ghost" }, land(0)), s);
  assert.equal(R(s, { type: "stop", seat: 0 }, land(0)), s);
  assert.notEqual(R(s, { type: "stop", pid: "p2" }, land(0)), s);
});

/* ============ Whammies ============ */

function whammyRun(limit) {
  let s = onBoard([0, 20, 0], { totals: [0, 0, 0] }, limit ? { whammyLimit: limit } : undefined);
  for (let k = 1; k <= (limit || 4); k += 1) {
    s = R(s, { type: "stop" }, land(5)); // cash first so the zeroing is visible
    assert.ok(s.totals[1] > 0);
    s = R(s, { type: "stop" }, land(2)); // Whammy
    assert.equal(s.totals[1], 0);
    assert.equal(s.whammies[1], k);
    if (k < (limit || 4)) {
      assert.equal(s.out[1], false);
      // control should come back to seat 1 (only spinner)
      s = R(s, { type: "nextSpinner" });
      assert.equal(s.control, 1);
    }
  }
  return s;
}

test("T: the 4th Whammy eliminates and voids spins", () => {
  const s = whammyRun(0);
  assert.equal(s.out[1], true);
  assert.equal(Core.spinsLeft(s, 1), 0);
  assert.equal(Core.canStop(s), false);
  const n = R(s, { type: "nextSpinner" });
  assert.equal(n.phase, "roundDone");
});

test("T: whammyLimit 2 eliminates on the 2nd Whammy", () => {
  const s = whammyRun(2);
  assert.equal(s.out[1], true);
  assert.equal(s.whammies[1], 2);
});

/* ============ Passing ============ */

test("T: pass moves all own spins, ends turn, receiver must use them first", () => {
  let s = onBoard([3, 2, 4]);
  assert.equal(s.control, 1);
  s = R(s, { type: "pass", to: 2 });
  assert.deepEqual(s.spins, [3, 0, 4]);
  assert.deepEqual(s.passed, [0, 0, 2]);
  assert.equal(s.awaiting, "advance");
  assert.equal(Core.canStop(s), false);
  s = R(s, { type: "nextSpinner" });
  assert.equal(s.control, 2, "receiver of passed spins comes up next");
  assert.deepEqual(Core.passTargets(s), [], "cannot pass while passed spins pending");
  assert.equal(R(s, { type: "pass", to: 0 }), s);
  s = R(s, { type: "stop" }, land(5));
  assert.equal(s.passed[2], 1, "passed spin used before own");
  assert.equal(s.spins[2], 4);
  s = R(s, { type: "stop" }, land(5));
  assert.equal(s.passed[2], 0);
  // now on own spins, may pass again (but not back... spec: passed spins can't be passed back; own ones may)
  assert.ok(Core.passTargets(s).length > 0);
});

test("T: passing to an eliminated player, to self, out of range or by name is refused", () => {
  let s = onBoard([3, 2, 4]);
  const outState = Object.assign({}, s, { out: [true, false, false], whammies: [4, 0, 0], spins: [0, 2, 4] });
  assert.equal(R(outState, { type: "pass", to: 0 }), outState, "pass to eliminated accepted");
  assert.equal(R(outState, { type: "pass", to: "p1" }), outState, "pass to eliminated by pid accepted");
  assert.equal(R(s, { type: "pass", to: 1 }), s, "pass to self accepted");
  assert.equal(R(s, { type: "pass", to: "p2" }), s);
  assert.equal(R(s, { type: "pass", to: 9 }), s);
  assert.equal(R(s, { type: "pass", to: -1 }), s);
  assert.equal(R(s, { type: "pass", to: 1.5 }), s);
  assert.equal(R(s, { type: "pass" }), s);
});

test("T: passed spins cannot be passed (no own spins + passed only)", () => {
  const s = onBoard([0, 0, 0], { passed: [0, 3, 0] });
  // board opened with seat1 holding only passed spins
  assert.equal(s.control, 1);
  assert.deepEqual(Core.passTargets(s), []);
  assert.equal(R(s, { type: "pass", to: 0 }), s);
});

test("T: a Whammy on a passed spin counts and ends the turn", () => {
  const s0 = onBoard([0, 2, 0], { passed: [0, 0, 2] });
  assert.equal(s0.control, 2);
  const s = R(s0, { type: "stop" }, land(2));
  assert.equal(s.whammies[2], 1);
  assert.equal(s.awaiting, "advance");
});

/* ============ Rounds, winner ============ */

test("T: round 2 plays boards[1] values", () => {
  let s = onBoard([0, 1, 0]);
  s = R(s, { type: "stop" }, land(4));
  assert.equal(s.totals[1], 200);
  s = R(s, { type: "nextSpinner" });
  assert.equal(s.phase, "roundDone");
  s = R(s, { type: "nextRound" }, land(0));
  assert.equal(s.round, 1);
  assert.equal(s.phase, "question");
  s = question(s, 0, true, {});
  s = R(s, { type: "nextQuestion" });
  s = question(s, null, false, {});
  s = R(s, { type: "toBoard" }, land(0));
  assert.equal(s.control, 0);
  const b2 = board2();
  const a = R(s, { type: "stop" }, land(2));
  assert.equal(a.totals[0], b2[2].cash);
  const w = R(s, { type: "stop" }, land(0));
  assert.equal(w.landing.whammy, true, "board 2 square 0 should be the Whammy");
  const tiles = Core.boardTiles(s);
  assert.equal(tiles[3].top, "Car");
});

test("T: winner is the highest total; ties share; all-zero has no winner", () => {
  const s = onBoard([0, 1, 0]);
  const a = Object.assign({}, s, { totals: [100, 900, 300] });
  const st = Core.standings(a);
  assert.equal(st[0].name, "Ben");
  assert.deepEqual(st.map((r) => r.winner), [true, false, false]);
  const t = Core.standings(Object.assign({}, s, { totals: [900, 900, 300] }));
  assert.equal(t.filter((r) => r.winner).length, 2);
  const z = Core.standings(Object.assign({}, s, { totals: [0, 0, 0] }));
  assert.equal(z.filter((r) => r.winner).length, 0);
});

/* ============ Validator fuzz ============ */

test("T: validator rejects 17/19 squares, 2/7 whammies, 23 questions, 4 options, junk", () => {
  const bad = [];
  const b17 = board1().slice(0, 17);
  const b19 = board1().concat([cash(1)]);
  const two = board1().map((sq, i) => (i >= 15 ? cash(10) : sq)); // whammies at 2 only + ... = 1
  const twoW = board1().map((sq, i) => (i === 15 || i === 16 ? cash(10) : sq)); // 2 whammies
  const sevenW = board1().map((sq, i) => (i >= 4 && i < 8 ? W : sq)); // 4 + 4 = 8? compute below
  const count = (b) => b.filter((x) => x.whammy).length;
  assert.equal(count(twoW), 2);
  const seven = board1().map((sq, i) => (i >= 4 && i < 7 ? W : sq));
  assert.equal(count(seven), 7);
  bad.push(["17", game(null, { boards: [b17, board2()] })]);
  bad.push(["19", game(null, { boards: [board1(), b19] })]);
  bad.push(["1 whammy", game(null, { boards: [two, board2()] })]);
  bad.push(["2 whammies", game(null, { boards: [twoW, board2()] })]);
  bad.push(["7 whammies", game(null, { boards: [seven, board2()] })]);
  bad.push(["8 whammies", game(null, { boards: [sevenW, board2()] })]);
  bad.push(["23 q", game(null, { questions: qs(23) })]);
  const four = qs(24); four[5] = { q: "x?", options: ["a", "b", "c", "d"], answer: 0 };
  bad.push(["4 options", game(null, { questions: four })]);
  const two2 = qs(24); two2[5] = { q: "x?", options: ["a", "b"], answer: 0 };
  bad.push(["2 options", game(null, { questions: two2 })]);
  const ans3 = qs(24); ans3[0] = Object.assign({}, ans3[0], { answer: 3 });
  bad.push(["answer 3", game(null, { questions: ans3 })]);
  bad.push(["one board, 2 rounds", game(null, { boards: [board1()] })]);
  bad.push(["neg cash", game(null, { boards: [board1().map((x, i) => (i === 0 ? cash(-5) : x)), board2()] })]);
  bad.push(["float cash", game(null, { boards: [board1().map((x, i) => (i === 0 ? cash(1.5) : x)), board2()] })]);
  bad.push(["whammy+cash", game(null, { boards: [board1().map((x, i) => (i === 2 ? { whammy: true, cash: 5 } : x)), board2()] })]);
  bad.push(["whammy string", game(null, { boards: [board1().map((x, i) => (i === 2 ? { whammy: "true" } : x)), board2()] })]);
  bad.push(["settings array", game(null, { settings: [] })]);
  bad.push(["rounds 7", game({ rounds: 7 })]);
  bad.push(["whammyLimit 0", game({ whammyLimit: 0 })]);
  bad.push(["needs 3x? 12/round", game({ questionsPerRound: 12, rounds: 2 }, { questions: qs(23) })]);
  bad.push(["24 q but 2x13", game({ questionsPerRound: 13 })]);
  [null, undefined, 5, "x", [], { boards: "x" }, { questions: [] }].forEach((j, i) => bad.push([`junk${i}`, j]));
  for (const [name, g] of bad) {
    assert.throws(() => Core.validateGame(g), Error, `accepted: ${name}`);
  }
  // 3 and 6 whammies and 24 questions are OK
  const three = board1().map((sq, i) => (i === 17 ? cash(10) : sq));
  assert.equal(count(three), 3);
  assert.equal(Core.validateGame(game(null, { boards: [three, board2()] })), true);
  const six = board1().map((sq, i) => (i >= 4 && i < 6 ? W : sq));
  assert.equal(count(six), 6);
  assert.equal(Core.validateGame(game(null, { boards: [six, board2()] })), true);
  // error messages are plain English, not stack noise
  try { Core.validateGame(game(null, { boards: [b17, board2()] })); } catch (e) { assert.match(e.message, /18/); }
});

test("T: shipped board.json, data.js and both library sets validate; data.js mirrors board.json", () => {
  const json = JSON.parse(readFileSync(join(GAME_DIR, "board.json"), "utf8"));
  assert.equal(Core.validateGame(json), true);
  assert.equal(json.boards.length, 2);
  assert.equal(json.questions.length, 40);
  const ctx = { window: {} }; ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(join(GAME_DIR, "js/data.js"), "utf8"), ctx);
  const found = Object.values(ctx.window).concat(Object.values(ctx)).find((v) => v && v.boards && v.questions);
  assert.ok(found, "data.js exposes no game");
  assert.deepEqual(JSON.parse(JSON.stringify(found)), json, "data.js differs from board.json");
  const manifest = JSON.parse(readFileSync(join(GAME_DIR, "sets/index.json"), "utf8"));
  assert.ok(manifest.length >= 2);
  for (const m of manifest) {
    assert.match(m.file, /^[\w.-]+\.json$/);
    const set = JSON.parse(readFileSync(join(GAME_DIR, "sets", m.file), "utf8"));
    assert.equal(Core.validateGame(set), true, m.file);
  }
  // round 2 board is higher value than round 1 in every shipped file
  for (const g of [json].concat(manifest.map((m) => JSON.parse(readFileSync(join(GAME_DIR, "sets", m.file), "utf8"))))) {
    const sum = (b) => b.reduce((a, sq) => a + Core.squareValue(sq), 0);
    assert.ok(sum(g.boards[1]) > sum(g.boards[0]), `${g.title}: round 2 board is not bigger`);
  }
});

/* ============ Phone messages / leaks ============ */

test("T: phone-message fuzz — junk never validates; pass to self via phone refused", () => {
  const junk = [{ t: "stop", x: 1 }, { t: "pick", idx: 3 }, { t: "pick", idx: -1 }, { t: "pick", idx: 0.5 },
    { t: "pass", to: 4 }, { t: "pass", to: "1" }, { t: "view" }, { t: "buzz ", }, { t: 1 }, "buzz", [{ t: "buzz" }]];
  const valid = junk.map(Core.validatePhoneMsg);
  assert.deepEqual(valid.map((v) => (v ? v.t : null)),
    ["stop", null, null, null, null, null, null, null, null, null, null]);
  const s = onBoard([0, 2, 3]);
  const msg = Core.validatePhoneMsg({ t: "pass", to: 1 });
  assert.equal(R(s, { type: "pass", to: msg.to }), s, "pass to self from phone accepted");
});

test("T: leak — no phone view names the upcoming square or other players' picks", () => {
  let s = begin();
  s = R(s, { type: "arm" });
  s = R(s, { type: "buzz", seat: 0 });
  s = R(s, { type: "judgeBuzz", correct: false });
  s = R(s, { type: "pick", seat: 1, idx: 2 });
  for (const pid of ["p1", "p2", "p3", "watcher"]) {
    const v = Core.phoneView(s, pid);
    const text = JSON.stringify(v);
    assert.equal(text.includes('"answer"'), false);
    assert.equal(text.includes('"picks"'), false, `${pid} sees the picks map`);
    if (pid === "p3") assert.equal(v.myPick, null, "p3 sees p2's pick as their own");
    if (pid === "p2") assert.equal(v.myPick, 2);
  }
  // board: two different rngs from the same pre-stop state give same phone views pre-stop
  const b = onBoard([0, 3, 0]);
  const before = JSON.stringify(["p1", "p2", "p3"].map((p) => Core.phoneView(b, p)));
  const tilesWords = Core.boardTiles(b).map((t) => t.top);
  const pv = JSON.parse(before);
  pv.forEach((v) => {
    assert.equal(v.last, "");
    Object.keys(v).forEach((k) => assert.ok(!["board", "squares", "faces", "landing", "tiles"].includes(k), k));
  });
  assert.ok(tilesWords.length === 18);
});

/* ============ Immutability / undo / prototype ============ */

test("T: every legal event works on a deep-frozen state (no hidden mutation)", () => {
  const rand = prng(42);
  let s = begin();
  for (let i = 0; i < 300 && s.phase !== "result"; i += 1) {
    if (Core.buzzOpen(s) && !s.q.armed) s = R(deepFreeze(s), { type: "arm" }, rand);
    const acts = Core.legalActions(s).filter((t) => !["undo", "finish"].includes(t));
    const type = acts[Math.floor(rand() * acts.length)];
    const ev = { type };
    if (type === "buzz") ev.seat = Core.alive(s)[0];
    if (type === "pick") { ev.seat = Core.eligiblePickers(s)[0]; ev.idx = Math.floor(rand() * 3); }
    if (type === "judgeBuzz") ev.correct = s.q.buzzed !== null;
    if (type === "pass") ev.to = Core.passTargets(s)[0];
    deepFreeze(s);
    s = R(s, ev, rand); // throws TypeError in strict mode if anything mutates
  }
  deepFreeze(s);
  assert.doesNotThrow(() => R(s, { type: "undo" }));
});

test("T: undo across phases (board -> question, roundDone -> board, round 2 -> round 1)", () => {
  let s = onBoard([0, 1, 0]);
  const preStop = s;
  s = R(s, { type: "stop" }, land(5));
  s = R(s, { type: "nextSpinner" });
  assert.equal(s.phase, "roundDone");
  const rd = s;
  s = R(s, { type: "nextRound" }, land(0));
  assert.equal(s.round, 1);
  let u = R(s, { type: "undo" });
  assert.equal(u.phase, "roundDone");
  assert.equal(u.round, 0);
  assert.deepEqual(u.totals, rd.totals);
  u = R(u, { type: "undo" });
  u = R(u, { type: "undo" });
  assert.equal(u.phase, "board");
  assert.deepEqual(u.totals, preStop.totals);
  assert.equal(u.landing, null);
  u = R(u, { type: "undo" }); // toBoard undone
  assert.equal(u.phase, "question");
});

test("T: prototype-shaped event types are no-ops", () => {
  const s = begin();
  for (const t of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "__defineGetter__"]) {
    assert.equal(R(s, { type: t }), s, t);
  }
  assert.equal(R(s, JSON.parse('{"type":"start","__proto__":{"phase":"board"}}')), s);
  assert.equal(R(s, null), s);
  assert.equal(R(s, { type: ["stop"] }), s);
});

/* ============ 200 seeded random games ============ */

test("T: 200 seeded random games (2–4 players, mixed settings) never deadlock", () => {
  let stops = 0, outs = 0, rounds2 = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = prng(seed * 104729);
    const n = 2 + (seed % 3);
    const players = P3.concat([{ name: "Dot", pid: "p4" }]).slice(0, n);
    const settings = { whammyLimit: 1 + (seed % 4), rounds: 1 + (seed % 2), buzzSpins: seed % 4, pickSpins: 1 + (seed % 2) };
    let s = R(Core.createState(game(settings), players, undefined, rand), { type: "start" }, rand);
    let steps = 0;
    while (s.phase !== "result" && steps < 5000) {
      if (Core.buzzOpen(s) && !s.q.armed) s = R(s, { type: "arm" }, rand);
      const acts = Core.legalActions(s).filter((t) => !["undo", "finish", "notice", "arm"].includes(t));
      assert.ok(acts.length, `seed ${seed}: deadlock in ${s.phase} awaiting=${s.awaiting}`);
      // bias: prefer stop over pass so games finish
      const type = acts.includes("stop") && rand() < 0.8 ? "stop" : acts[Math.floor(rand() * acts.length)];
      const ev = { type };
      if (type === "buzz") ev.seat = Core.alive(s)[Math.floor(rand() * Core.alive(s).length)];
      if (type === "pick") { const e = Core.eligiblePickers(s); ev.seat = e[Math.floor(rand() * e.length)]; ev.idx = Math.floor(rand() * 3); }
      if (type === "judgeBuzz") ev.correct = s.q.buzzed !== null && rand() < 0.6;
      if (type === "pass") { const t = Core.passTargets(s); ev.to = t[Math.floor(rand() * t.length)]; }
      const next = R(s, ev, rand);
      if (type !== "pick") assert.notEqual(next, s, `seed ${seed}: legal ${type} was a no-op`); // re-picking the same option is a legal no-op
      if (type === "stop") stops += 1;
      s = next;
      // invariants
      s.players.forEach((_, i) => {
        assert.ok(s.totals[i] >= 0 && s.spins[i] >= 0 && s.passed[i] >= 0);
        if (s.out[i]) assert.equal(Core.spinsLeft(s, i), 0);
      });
      steps += 1;
    }
    assert.equal(s.phase, "result", `seed ${seed} did not finish`);
    outs += s.out.filter(Boolean).length; if (s.round === 1) rounds2 += 1;
  }
  assert.ok(stops > 400 && outs > 5 && rounds2 > 50, `fuzz too shallow: ${stops} stops, ${outs} eliminations, ${rounds2} two-round games`);
});
