// Krillion — adversarial tests written by the independent tester.
// Run from games/krillion:  node --test

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const K = require("../js/kr-core.js");

/* ============ Fixtures ============ */

function fruit() {
  return { text: "Name a fruit", category: "Food", answers: [
    { text: "Apple", tier: "prawn" }, { text: "Banana", tier: "prawn" },
    { text: "Mango", tier: "schooler" }, { text: "Kiwi", tier: "rare", aliases: ["Kiwifruit", "Chinese gooseberry"] },
    { text: "Lychee", tier: "deepcut", aliases: ["Litchi"] }, { text: "Rambutan", tier: "krillion" },
    { text: "The Durian", tier: "rare" } ] };
}
function filler(i) {
  return { text: `Name thing ${i}`, answers: [{ text: `Alpha${i}`, tier: "prawn" }, { text: `Bravo${i}`, tier: "prawn" },
    { text: `Delta${i}`, tier: "rare" }, { text: `Echo${i}`, tier: "rare" }, { text: `Zulu${i}`, tier: "krillion" }] };
}
function game(settings, first) {
  const prompts = [first || fruit()];
  for (let i = 1; i < 40; i += 1) prompts.push(filler(i));
  return { title: "Adv", settings: settings || {}, prompts };
}
const P = (n) => Array.from({ length: n }, (_, i) => ({ pid: `p${i + 1}`, name: `N${i + 1}` }));
const play = (s, evs) => evs.reduce((st, e) => K.reduce(st, e), s);
const T0 = 5000000;
function dive(n, settings) {
  return play(K.createState(game(settings), { players: P(n || 5) }), [{ type: "start" }, { type: "openPrompt", now: T0 }]);
}
function answerAll(s, map) {
  return Object.keys(map).reduce((st, pid) => K.reduce(st, { type: "answer", pid, text: map[pid], now: T0 + 1000 }), s);
}
function revealAll(s) {
  for (let i = 0; i < 20 && s.phase === "reveal"; i += 1) s = K.reduce(s, { type: "revealNext", now: T0 + 2000 });
  return s;
}
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
function puffer(n, puff) {
  return play(K.createState(game({ mode: "puffer", puffer: puff || {} }), { players: P(n || 3) }),
    [{ type: "start" }, { type: "pufferStart", now: T0 }]);
}
const pAns = (s, text, now) => K.reduce(s, { type: "pufferAnswer", pid: s.puffer.holder, text, now: now || T0 + 500 });

/* ============ Normalisation and matching ============ */

test("ADV normalisation: case, spaces, articles, trailing punctuation, accents", () => {
  const pr = K.normalizeGame(game()).prompts[0];
  const tierOf = (t) => { const m = K.matchAnswer(pr, t); return m ? m.tier : null; };
  ["apple", " APPLE ", "an apple", "The   Apple!!", "apple.", "Apple?", "ÀPPLE", "\tapple\u0007"].forEach((t) =>
    assert.equal(tierOf(t), "prawn", t));
  assert.equal(tierOf("durian"), "rare", "listed with an article, typed without");
  assert.equal(tierOf("a durian"), "rare");
  assert.equal(tierOf("Litchi"), "deepcut", "alias");
  assert.equal(tierOf("chinese  gooseberry."), "rare", "multi-word alias");
  assert.equal(tierOf("kiwis"), "rare", "simple plural");
  assert.equal(tierOf("lychees"), "deepcut");
  assert.equal(tierOf("pineapple"), null, "substring is not a match");
  assert.equal(tierOf("app"), null);
  assert.equal(tierOf("!!!"), null);
  assert.equal(K.normaliseAnswer("The"), "the", "a lone article survives");
});

test("ADV validator: alias collisions across answers are refused, case/article-insensitively", () => {
  const bad = (answers) => { const f = fruit(); f.answers = f.answers.concat(answers); return game({}, f); };
  assert.throws(() => K.validateGame(bad([{ text: "Litchi", tier: "rare" }])), /both answer to/);
  assert.throws(() => K.validateGame(bad([{ text: "Fig", tier: "rare", aliases: ["the APPLE"] }])), /both answer to/);
  assert.throws(() => K.validateGame(bad([{ text: "Durian", tier: "rare" }])), /both answer to/);
  const f = fruit(); f.answers[0].aliases = ["apple", "The Apple"];
  assert.doesNotThrow(() => K.validateGame(game({}, f)), "an alias duplicating its own entry is harmless");
});

/* ============ Judge's review ============ */

test("ADV off-list answers stay pending until reviewed; reveal is blocked meanwhile", () => {
  let s = answerAll(dive(3), { p1: "Apple", p2: "Durian fruit", p3: "durian  FRUIT!" });
  assert.equal(s.phase, "reveal", "everyone answered -> closed");
  const q = K.reviewQueue(s);
  assert.equal(q.length, 1, "same off-list text groups once");
  assert.equal(q[0].count, 2);
  assert.equal(q[0].ruled, false);
  assert.equal(K.reduce(s, { type: "revealNext" }), s, "reveal refused while pending");
  assert.equal(K.reduce(s, { type: "review", group: q[0].id, tier: "mythic" }), s, "unknown tier id");
  assert.equal(K.reduce(s, { type: "review", group: "#0", tier: "krillion" }), s, "an on-list group can't be re-rated");
  assert.equal(K.reduce(s, { type: "review", group: "nope", tier: "rare" }), s);
  assert.equal(K.reduce(s, { type: "review", group: q[0].id }), s, "missing tier is not a ruling");
  s = K.reduce(s, { type: "review", group: q[0].id, tier: null });
  assert.equal(K.pendingReviews(s), 0);
  s = revealAll(s);
  assert.equal(s.phase, "depth");
  const by = Object.fromEntries(s.players.map((p) => [p.pid, p.score]));
  assert.deepEqual(by, { p1: 10, p2: 0, p3: 0 });
});

test("ADV review assigns a tier; review is locked once the reveal walk starts", () => {
  let s = answerAll(dive(2), { p1: "Dragonfruit", p2: "Apple" });
  const id = K.reviewQueue(s)[0].id;
  s = K.reduce(s, { type: "review", group: id, tier: "deepcut" });
  s = K.reduce(s, { type: "revealNext" });
  assert.equal(K.reduce(s, { type: "review", group: id, tier: "krillion" }), s);
  s = revealAll(s);
  assert.equal(s.players[0].score, 85);
  assert.equal(K.depth(s, "p1"), 850, "1 point = 10 m");
});

test("ADV remember adds the judged answer; it then matches, survives applyLearned + revalidation", () => {
  let s = answerAll(dive(2), { p1: "Dragon fruit", p2: "Apple" });
  const id = K.reviewQueue(s)[0].id;
  assert.equal(K.reduce(s, { type: "remember", group: id }), s, "unruled can't be remembered");
  const nv = K.reduce(s, { type: "review", group: id, tier: null });
  assert.equal(K.reduce(nv, { type: "remember", group: id }), nv, "not-valid can't be remembered");
  s = K.reduce(s, { type: "review", group: id, tier: "deepcut" });
  s = K.reduce(s, { type: "remember", group: id });
  assert.equal(s.learned.length, 1);
  assert.equal(K.reduce(s, { type: "remember", group: id }), s, "remembered twice is a no-op");
  assert.equal(K.matchFor(s, s.dive.index, "dragonfruit").tier, "deepcut", "matches next time (loose)");
  const g2 = K.applyLearned(game(), s.learned);
  K.validateGame(g2);
  const pr = K.normalizeGame(g2).prompts[0];
  assert.equal(K.matchAnswer(pr, "DRAGON FRUIT").tier, "deepcut", "survives as content (the saved game file)");
  assert.equal(JSON.parse(JSON.stringify(g2)).prompts[0].answers.length, 8);
});

/* ============ Points, depth, ties, reveal order ============ */

test("ADV per-tier points, depth totals, ties stay ties, reveal order Prawn -> One in a Krillion", () => {
  let s = answerAll(dive(6), { p1: "Rambutan", p2: "Apple", p3: "Lychee", p4: "Kiwi", p5: "Mango", p6: "Banana" });
  assert.deepEqual(K.revealOrder(s).map((g) => g.tier), ["prawn", "prawn", "schooler", "rare", "deepcut", "krillion"]);
  s = revealAll(s);
  assert.deepEqual(s.players.map((p) => p.score), [100, 10, 85, 60, 30, 10]);
  const board = K.depthBoard(s);
  assert.equal(board[0].depth, 1000);
  const ranks = Object.fromEntries(board.map((r) => [r.pid, r.rank]));
  assert.equal(ranks.p2, ranks.p6, "Apple/Banana tie");
  let m = answerAll(dive(3), { p1: "Rambutan", p2: "zzz" });
  m = K.reduce(m, { type: "closePrompt" });
  m = K.reduce(m, { type: "review", group: K.reviewQueue(m)[0].id, tier: null });
  const o2 = K.revealOrder(m);
  assert.equal(o2[o2.length - 1].tier, "krillion");
  assert.ok(o2.slice(0, 2).every((g) => !g.tier), "misses reveal first");
  let t = K.reduce(K.createState(game({ promptsPerGame: 1 }), { players: P(2) }), { type: "start" });
  t = K.reduce(t, { type: "openPrompt", now: T0 });
  t = answerAll(t, { p1: "Kiwi", p2: "kiwifruit" });
  assert.equal(K.revealOrder(t).length, 1, "alias groups with its entry");
  t = K.reduce(revealAll(t), { type: "nextPrompt" });
  assert.equal(t.phase, "result");
  assert.deepEqual([...t.winners].sort(), ["p1", "p2"], "same answer (alias) = same tier, joint winners");
});

/* ============ Puffer Party ============ */

test("ADV puffer: used-list refusal incl. an alias of a used answer", () => {
  let s = puffer(3);
  s = pAns(s, "Kiwi");
  assert.equal(s.puffer.used.length, 1);
  const h = s.puffer.holder;
  const r = pAns(s, "Chinese gooseberry");
  assert.equal(r.puffer.used.length, 1);
  assert.equal(r.puffer.holder, h, "puffer stays");
  assert.equal(r.puffer.notice.kind, "used");
  assert.equal(pAns(s, "kiwis").puffer.notice.kind, "used", "plural of a used answer");
  let o = pAns(s, "Guava");
  o = K.reduce(o, { type: "pufferJudge", tier: "schooler", now: T0 + 900 });
  assert.equal(o.puffer.used.length, 2);
  assert.equal(pAns(o, "the guava").puffer.notice.kind, "used", "judged off-list answer is used too");
});

test("ADV puffer: clock shrinks to the floor, never below", () => {
  let s = puffer(2, { startSeconds: 6, floorSeconds: 3, stepSeconds: 1 });
  assert.equal(s.clock.seconds, 6);
  const secs = [];
  ["Apple", "Banana", "Mango", "Kiwi", "Lychee", "Rambutan", "Durian"].forEach((w) => { s = pAns(s, w); secs.push(s.clock.seconds); });
  assert.deepEqual(secs, [5, 4, 3, 3, 3, 3, 3]);
});

test("ADV puffer: pop costs a heart, meter -> heart up to max, elimination, last one floating", () => {
  let s = puffer(3, { hearts: 1, maxHearts: 2, meterForHeart: 4 });
  const first = s.puffer.holder;
  s = pAns(s, "Rambutan");
  const p = s.players.find((x) => x.pid === first);
  assert.equal(p.hearts, 2);
  assert.equal(p.meter, 0);
  assert.equal(s.puffer.notice.kind, "heart");
  s = pAns(s, "Apple"); s = pAns(s, "Banana");
  assert.equal(s.puffer.holder, first);
  s = K.reduce(pAns(s, "Starfruit"), { type: "pufferJudge", valid: true, niche: true, now: T0 + 700 });
  assert.equal(s.players.find((x) => x.pid === first).hearts, 2, "capped at maxHearts");
  const victim = s.puffer.holder;
  s = K.reduce(s, { type: "pufferPop", now: T0 + 9000 });
  const v = s.players.find((x) => x.pid === victim);
  assert.equal(v.hearts, 0); assert.equal(v.out, true);
  assert.equal(s.phase, "popped");
  s = K.reduce(s, { type: "nextRound" });
  assert.notEqual(s.puffer.holder, victim, "out players are skipped");
  s = K.reduce(s, { type: "pufferStart", now: T0 + 10000 });
  for (let i = 0; i < 10 && s.phase !== "result"; i += 1) {
    s = K.reduce(s, { type: "pufferPop", now: T0 + 11000 + i });
    if (s.phase === "popped") s = K.reduce(K.reduce(s, { type: "nextRound" }), { type: "pufferStart", now: T0 + 12000 + i });
  }
  assert.equal(s.phase, "result");
  assert.equal(K.alive(s).length, 1);
  assert.deepEqual(s.winners, [K.alive(s)[0].pid]);
});

test("ADV puffer: both pufferJudge shapes", () => {
  const base = pAns(puffer(3), "Jackfruit");
  assert.ok(base.puffer.pending);
  const t = (e) => K.reduce(base, Object.assign({ type: "pufferJudge", now: T0 + 800 }, e));
  assert.equal(t({ tier: "rare" }).puffer.used[0].tier, "rare");
  assert.equal(t({ valid: true }).puffer.used[0].tier, "prawn");
  assert.equal(t({ valid: true, niche: true }).puffer.used[0].tier, "krillion");
  [t({ tier: null }), t({ valid: false })].forEach((n) => {
    assert.equal(n.puffer.used.length, 0); assert.equal(n.puffer.holder, base.puffer.holder);
    assert.equal(n.puffer.notice.kind, "invalid"); assert.equal(n.clock.deadline, base.clock.deadline, "clock keeps running");
  });
  assert.equal(t({ tier: "bogus" }), base);
  assert.equal(t({}), base);
  assert.equal(t({ valid: "yes" }), base);
  assert.equal(K.reduce(puffer(3), { type: "pufferJudge", valid: true, now: 1 }).puffer.used.length, 0, "nothing pending");
});

/* ============ Phone input: closed prompts, non-holders, fuzz ============ */

test("ADV a phone answer after close is rejected; a non-holder puffer answer is rejected", () => {
  let s = answerAll(dive(3), { p1: "Apple" });
  s = K.reduce(s, { type: "closePrompt" });
  assert.equal(K.phoneMaySend(s, "p2", "answer"), false);
  assert.equal(K.reduce(s, { type: "answer", pid: "p2", text: "Mango" }), s);
  assert.equal(K.reduce(dive(3), { type: "answer", pid: "ghost", text: "Mango" }).dive.answers.ghost, undefined);
  const pf = puffer(3);
  const other = pf.players.find((p) => p.pid !== pf.puffer.holder).pid;
  assert.equal(K.phoneMaySend(pf, other, "puffer"), false);
  assert.equal(K.reduce(pf, { type: "pufferAnswer", pid: other, text: "Apple", now: T0 }), pf);
  assert.equal(K.phoneMaySend(pf, pf.puffer.holder, "answer"), false, "no Deep Dive answers in Puffer");
});

test("ADV last answer: prompt auto-closes when everyone has answered (implementer note 4)", () => {
  let s = answerAll(dive(2), { p1: "Apple" });
  s = K.reduce(s, { type: "answer", pid: "p1", text: "Mango" });
  assert.equal(s.dive.answers.p1, "Mango", "resubmit before close replaces");
  s = K.reduce(s, { type: "answer", pid: "p2", text: "Kiwi" });
  assert.equal(s.phase, "reveal");
  assert.equal(K.reduce(s, { type: "answer", pid: "p1", text: "Rambutan" }), s);
});

test("ADV validatePhoneMsg fuzz", () => {
  const junk = [null, undefined, 1, "answer", [], { t: "answer" }, { t: "answer", text: 5 }, { t: "answer", text: "" },
    { t: "answer", text: "   " }, { t: "answer", text: "\u0000\u0001" }, { t: "answer", text: "!!!" },
    { t: "review", text: "x" }, { t: "hostAnswer", text: "x" }, { t: "__proto__", text: "x" }, { t: "toString", text: "x" },
    { t: "answer", text: "x".repeat(4001) }];
  junk.forEach((j, i) => assert.equal(K.validatePhoneMsg(j), null, `junk ${i}`));
  assert.equal(K.validatePhoneMsg({ t: "answer", text: "y".repeat(500) }).text.length, 40);
  assert.equal(K.validatePhoneMsg({ t: "answer", text: "a\u0007b" }).text.indexOf("\u0007"), -1);
  assert.deepEqual(K.validatePhoneMsg({ t: "puffer", text: " Mango ", extra: { evil: 1 } }), { t: "puffer", text: "Mango" });
  for (let i = 0; i < 300; i += 1) {
    const r = { t: ["answer", "puffer", "x", 7][i % 4],
      text: String.fromCharCode(...Array.from({ length: i % 60 }, (_, k) => (k * 7919 + i) % 0xffff)) };
    assert.doesNotThrow(() => K.validatePhoneMsg(r));
    const v = K.validatePhoneMsg(r);
    if (v) assert.ok(v.text.length <= 40);
  }
});

/* ============ Validator fuzz ============ */

test("ADV validator fuzz: 39 prompts, 4 answers, unknown tier, 41 chars, junk types", () => {
  const g39 = game(); g39.prompts.pop();
  assert.throws(() => K.validateGame(g39), /at least 40/);
  const g4 = game(); g4.prompts[3].answers = g4.prompts[3].answers.slice(0, 4);
  assert.throws(() => K.validateGame(g4), /at least 5/);
  const gt = game(); gt.prompts[0].answers[0].tier = "shrimp";
  assert.throws(() => K.validateGame(gt), /needs a tier/);
  const g41 = game(); g41.prompts[0].answers[0].text = "x".repeat(41);
  assert.throws(() => K.validateGame(g41), /longer than 40/);
  const g40 = game(); g40.prompts[0].answers[0].text = "x".repeat(40);
  assert.doesNotThrow(() => K.validateGame(g40));
  const gtiers = game(); gtiers.prompts[1].answers.forEach((a) => { a.tier = "prawn"; });
  assert.throws(() => K.validateGame(gtiers), /3 different tiers/);
  ["__proto__", "toString", "constructor"].forEach((bad) => {
    const g = game(); g.prompts[0].answers[0].tier = bad;
    assert.throws(() => K.validateGame(g), Error, bad);
  });
  [null, 1, "x", [], { prompts: "x" }, { prompts: [null] }, { prompts: Array(40).fill(1) },
    game({ tiers: [{ id: "a", name: "A", points: 5 }] }),
    game({ tiers: [{ id: "a", name: "A", points: 5 }, { id: "b", name: "B", points: 5 }] }),
    game({ tiers: [{ id: "a", name: "A", points: 5 }, { id: "a", name: "B", points: 6 }] }),
    game({ promptSeconds: "abc" }), game({ promptSeconds: 2.5 }), game({ mode: "trivia" }),
    game({ puffer: { hearts: 5, maxHearts: 4 } }), game({ puffer: { floorSeconds: 20, startSeconds: 12 } }),
    (() => { const g = game(); g.prompts[0].answers[0].aliases = "Fe"; return g; })(),
    (() => { const g = game(); g.prompts[0].answers[0].aliases = Array(9).fill(0).map((_, i) => `al${i}`); return g; })(),
    (() => { const g = game(); g.prompts[0].text = "q".repeat(121); return g; })(),
    (() => { const g = game(); g.prompts[0].answers[1] = "Banana"; return g; })(),
  ].forEach((g, i) => assert.throws(() => K.validateGame(g), Error, `fuzz ${i}`));
});

/* ============ Leak test ============ */

test("ADV leak: no phone sees others' answers before reveal, nor examples/rated list", () => {
  let s = answerAll(dive(3), { p1: "Rambutan", p2: "Secretfruitxyz" });
  const listed = ["Apple", "Banana", "Mango", "Kiwi", "Lychee", "Litchi", "Durian", "gooseberry"];
  const check = (st, pid, forbidden) => {
    const v = JSON.stringify(K.phoneView(st, pid, T0 + 2000)).toLowerCase();
    forbidden.forEach((f) => assert.equal(v.indexOf(f.toLowerCase()), -1, `${pid} saw ${f} in ${st.phase}: ${v}`));
  };
  ["p1", "p2", "p3"].forEach((pid) => check(s, pid, listed));
  check(s, "p1", ["Secretfruitxyz"]); check(s, "p3", ["Rambutan", "Secretfruitxyz"]); check(s, "p2", ["Rambutan"]);
  s = K.reduce(s, { type: "closePrompt" });
  check(s, "p3", ["Rambutan", "Secretfruitxyz"]);
  s = K.reduce(s, { type: "review", group: K.reviewQueue(s)[0].id, tier: "rare" });
  s = K.reduce(s, { type: "revealNext" });
  check(s, "p3", ["Rambutan", "Secretfruitxyz"]);
  check(s, "p2", ["Rambutan"]);
  const pf = pAns(puffer(3), "Sapodilla");
  const watcher = pf.players.find((p) => p.pid !== pf.puffer.holder).pid;
  check(pf, watcher, listed.concat(["Rambutan", "Sapodilla"]));
});

/* ============ Immutability, undo, prototype guard ============ */

test("ADV deep-frozen states survive every event type without mutation", () => {
  const seq = [{ type: "answer", pid: "p1", text: "Durian fruit" }, { type: "answer", pid: "p2", text: "Apple" },
    { type: "closePrompt" }, { type: "review", group: "durian fruit", tier: "rare" }, { type: "remember", group: "durian fruit" },
    { type: "revealNext" }, { type: "revealNext" }, { type: "revealNext" }, { type: "revealNext" }, { type: "nextPrompt" },
    { type: "undo" }, { type: "finish" }];
  let s = deepFreeze(dive(3));
  seq.forEach((e) => { s = deepFreeze(K.reduce(s, Object.assign({ now: T0 + 100 }, e))); });
  assert.equal(s.phase, "result");
  let p = deepFreeze(puffer(3, { meterForHeart: 1 }));
  [{ type: "pufferAnswer", text: "Apple" }, { type: "pufferAnswer", text: "Ugli" }, { type: "pufferJudge", tier: "rare" },
    { type: "pufferPop" }, { type: "nextRound" }, { type: "pufferStart" }, { type: "undo" }].forEach((e) => {
    p = deepFreeze(K.reduce(p, Object.assign({ now: T0 + 200, pid: p.puffer && p.puffer.holder }, e)));
  });
  assert.equal(p.phase, "pufferReady");
});

test("ADV undo across phases restores exact clock seconds, rulings and learned answers", () => {
  let s = answerAll(dive(2), { p1: "Fig" });
  s = K.reduce(s, { type: "answer", pid: "p2", text: "Apple", now: T0 + 12000 });
  assert.equal(s.phase, "reveal");
  const back = K.reduce(s, { type: "undo", now: T0 + 99000 });
  assert.equal(back.phase, "prompt");
  assert.equal(back.clock.deadline - (T0 + 99000), 18000, "exact remaining time");
  assert.equal(back.dive.answers.p2, undefined);
  s = K.reduce(s, { type: "review", group: "fig", tier: "krillion" });
  s = revealAll(s);
  assert.equal(s.phase, "depth");
  let u = s;
  for (let i = 0; i < 10 && u.phase !== "prompt"; i += 1) u = K.reduce(u, { type: "undo", now: T0 + 50000 });
  assert.equal(u.phase, "prompt");
  assert.deepEqual(u.players.map((p) => p.score), [0, 0]);
  const r = K.reduce(K.reduce(answerAll(dive(2), { p1: "Fig", p2: "Apple" }), { type: "review", group: "fig", tier: "rare" }),
    { type: "remember", group: "fig" });
  assert.equal(K.reduce(r, { type: "undo", now: 1 }).learned.length, 0);
  const fresh = K.createState(game(), { players: P(2) });
  assert.equal(K.reduce(fresh, { type: "undo" }), fresh, "nothing to undo");
});

test("ADV prototype-shaped event types, pids and answers are inert", () => {
  const s = dive(3);
  ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "__defineGetter__", "isPrototypeOf", ""].forEach((type) => {
    assert.equal(K.reduce(s, { type }), s, type);
  });
  assert.equal(K.reduce(s, null), s);
  assert.equal(K.reduce(s, { type: 5 }), s);
  assert.equal(K.reduce(s, JSON.parse('{"type":"__proto__","__proto__":{"x":1}}')), s);
  assert.equal(K.reduce(s, { type: "answer", pid: "__proto__", text: "Apple" }), s);
  assert.equal({}.x, undefined);
  let r = answerAll(s, { p1: "toString", p2: "constructor", p3: "__proto__" });
  assert.equal(r.phase, "reveal");
  assert.equal(K.reviewQueue(r).length, 3);
  K.reviewQueue(r).forEach((g) => { r = K.reduce(r, { type: "review", group: g.id, tier: "rare" }); });
  assert.equal(K.pendingReviews(r), 0, "rulings keyed by toString/constructor/proto still land");
  r = revealAll(r);
  assert.deepEqual(r.players.map((p) => p.score), [60, 60, 60]);
});
