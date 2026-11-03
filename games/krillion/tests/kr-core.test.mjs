// Krillion — unit tests for the pure core (success states KR-U1 … KR-U10).
// Run from games/krillion:  node --test

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const K = require("../js/kr-core.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(path.join(here, "..", rel), "utf8"));

/* ============ Fixtures ============ */

/** A 40-prompt file; prompt 0 is the one every Deep Dive test plays. */
function fixtureGame(settings) {
  const prompts = [{
    text: "Name a fruit", category: "Food",
    answers: [
      { text: "Apple", tier: "prawn" }, { text: "Banana", tier: "prawn" },
      { text: "Mango", tier: "schooler" }, { text: "Kiwi", tier: "rare", aliases: ["Kiwifruit"] },
      { text: "Lychee", tier: "deepcut", aliases: ["Litchi"] }, { text: "Rambutan", tier: "krillion" },
    ],
  }];
  for (let i = 1; i < 40; i += 1) {
    prompts.push({ text: `Name thing ${i}`, category: "Misc",
      answers: [{ text: `Alpha${i}`, tier: "prawn" }, { text: `Bravo${i}`, tier: "prawn" },
        { text: `Delta${i}`, tier: "rare" }, { text: `Echo${i}`, tier: "rare" }, { text: `Zulu${i}`, tier: "krillion" }] });
  }
  return { title: "Fixture", settings: Object.assign({}, settings || {}), prompts };
}

const PLAYERS = [
  { pid: "p1", name: "Ann" }, { pid: "p2", name: "Bo" }, { pid: "p3", name: "Cy" },
  { pid: "p4", name: "Di" }, { pid: "p5", name: "Ed" },
];

function deepDive(players, settings) {
  return K.reduce(K.createState(fixtureGame(settings), { players: players || PLAYERS }), { type: "start" });
}

function play(state, events) {
  return events.reduce((s, e) => K.reduce(s, e), state);
}

const T0 = 1000000;

function openWith(answers, players) {
  let s = play(deepDive(players), [{ type: "openPrompt", now: T0 }]);
  Object.keys(answers).forEach((pid) => { s = K.reduce(s, { type: "answer", pid, text: answers[pid] }); });
  return s;
}

/* ============ KR-U1 validator ============ */

test("KR-U1 the shipped prompts.json, data.js mirror and both sets validate", () => {
  const main = readJson("prompts.json");
  K.validateGame(main);
  assert.equal(main.prompts.length, 100);
  const cats = new Set(main.prompts.map((p) => p.category));
  assert.ok(cats.size >= 10, `${cats.size} categories`);
  main.prompts.forEach((p) => {
    assert.ok(p.answers.length >= 10 && p.answers.length <= 25, `${p.text}: ${p.answers.length}`);
    assert.deepEqual(K.missingTiers(p), [], `${p.text} covers every tier`);
  });
  const sandbox = vm.createContext({});
  vm.runInContext(readFileSync(path.join(here, "..", "js", "data.js"), "utf8"), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.KR_DEFAULT_GAME)), main, "data.js mirrors prompts.json");
  const manifest = readJson("sets/index.json");
  assert.equal(manifest.length, 2);
  manifest.forEach((m) => {
    const set = readJson(`sets/${m.file}`);
    K.validateGame(set);
    assert.equal(set.prompts.length, m.counts.prompts);
    set.prompts.forEach((p) => assert.deepEqual(K.missingTiers(p), [], `${m.file}: ${p.text}`));
  });
});

test("KR-U1 the validator refuses broken files in plain English", () => {
  const bad = (mut, re) => {
    const g = fixtureGame();
    mut(g);
    assert.throws(() => K.validateGame(g), re);
  };
  bad((g) => { g.prompts = g.prompts.slice(0, 39); }, /at least 40/);
  bad((g) => { g.prompts[0].text = "x".repeat(121); }, /longer than 120/);
  bad((g) => { g.prompts[0].answers[0].tier = "obvious"; }, /needs a tier/);
  bad((g) => { g.prompts[0].answers.push({ text: "apple!", tier: "rare" }); }, /both answer to/);
  bad((g) => { g.prompts[0].answers[3].aliases = "Kiwifruit"; }, /aliases must be a list/);
  bad((g) => { g.prompts[1].answers = g.prompts[1].answers.slice(0, 4); }, /at least 5 rated answers/);
  bad((g) => { g.prompts[1].answers.forEach((a) => { a.tier = "prawn"; }); }, /at least 3 different tiers/);
  bad((g) => { delete g.prompts[1].answers; }, /needs a list of rated answers/);
  bad((g) => { g.prompts[0].answers[0].text = "x".repeat(41); }, /longer than 40/);
  bad((g) => { g.settings = { tiers: [{ id: "a", name: "A", points: 50 }, { id: "b", name: "B", points: 30 }] }; },
    /worth more than/);
  bad((g) => { g.settings = { tiers: [{ id: "a", name: "A", points: 1 }, { id: "a", name: "B", points: 3 }] }; },
    /share the id/);
  bad((g) => { g.settings = { tiers: [{ id: "a", name: "A", points: 1 }] }; }, /2 to 6 tiers/);
  bad((g) => { g.settings = { tiers: [{ id: "a", name: "x".repeat(25), points: 1 }, { id: "b", name: "B", points: 3 }] }; },
    /24 characters/);
  bad((g) => { g.settings = { tiers: [{ id: "low", name: "Low", points: 1 }, { id: "high", name: "High", points: 3 }] }; },
    /needs a tier: one of low, high/);
  bad((g) => { g.settings = { mode: "noillirk" }; }, /Mode/);
  bad((g) => { g.settings = { puffer: { hearts: 6, maxHearts: 4 } }; }, /Starting hearts/);
  assert.throws(() => K.validateGame([]), /JSON object/);
  assert.doesNotThrow(() => K.validateGame(fixtureGame()));
});

/* ============ KR-U2 normalisation and matching ============ */

test("KR-U2 normalisation: case, spaces, accents, articles, punctuation", () => {
  assert.equal(K.normaliseAnswer("  The   Nile. "), "nile");
  assert.equal(K.normaliseAnswer("an Apple!"), "apple");
  assert.equal(K.normaliseAnswer("Crème Brûlée"), "creme brulee");
  assert.equal(K.normaliseAnswer("R&B"), "r and b");
  assert.equal(K.normaliseAnswer("Kipp's"), "kipps");
  assert.equal(K.normaliseAnswer("A"), "a", "a lone article is still an answer");
  assert.equal(K.normaliseAnswer("\u0000\u0007"), "");
});

test("KR-U2 matching: aliases, plurals, squashed spaces and off-list", () => {
  const prompt = fixtureGame().prompts[0];
  assert.equal(K.matchAnswer(prompt, "APPLES").entry.text, "Apple");
  assert.equal(K.matchAnswer(prompt, "litchi").entry.text, "Lychee");
  assert.equal(K.matchAnswer(prompt, "kiwi fruit").entry.text, "Kiwi");
  assert.equal(K.matchAnswer(prompt, "the rambutan").tier, "krillion");
  assert.equal(K.matchAnswer(prompt, "Durian"), null);
  assert.equal(K.matchAnswer(prompt, "Durian", [{ text: "Durian", tier: "deepcut" }]).tier, "deepcut");
});

test("KR-U2 groups: same rated entry = one group; off-list grouped by key", () => {
  const s = K.reduce(openWith({ p1: "Apple", p2: "apples", p3: "Litchi", p4: "durian", p5: "Durian!" }),
    { type: "closePrompt" });
  const g = K.groups(s);
  const apple = g.find((x) => x.label === "Apple");
  assert.deepEqual(apple.pids, ["p1", "p2"]);
  assert.equal(apple.tier, "prawn");
  assert.equal(g.find((x) => x.label === "Lychee").tier, "deepcut");
  const queue = K.reviewQueue(s);
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].pids, ["p4", "p5"]);
  assert.equal(queue[0].ruled, false);
});

/* ============ KR-U3 tier points at every boundary ============ */

test("KR-U3 every tier scores its listed points; points are configurable", () => {
  const cases = [["Apple", "prawn", 10], ["Mango", "schooler", 30], ["Kiwi", "rare", 60],
    ["Lychee", "deepcut", 85], ["Rambutan", "krillion", 100]];
  cases.forEach(([text, tier, pts]) => {
    let s = K.reduce(openWith({ p1: text }), { type: "closePrompt" });
    const mine = K.groups(s).find((g) => g.pids.indexOf("p1") >= 0);
    assert.equal(mine.tier, tier);
    assert.equal(mine.points, pts);
    while (s.phase === "reveal") s = K.reduce(s, { type: "revealNext" });
    assert.equal(s.players[0].score, pts, `${tier} banks ${pts}`);
  });
  const tiers = K.TIERS.map((t, i) => ({ id: t.id, name: t.name, points: i + 1 }));
  const custom = K.createState(fixtureGame({ tiers }), { players: PLAYERS });
  assert.equal(K.pointsFor(custom, "deepcut"), 4);
  assert.equal(K.pointsFor(custom, null), 0);
  assert.equal(K.normalizeSettings({}).puffer.meterForHeart, 100, "spec default: 100 meter points = +1 heart");
});

test("KR-U3 the host's per-prompt tally counts players in each tier", () => {
  let s = K.reduce(openWith({ p1: "Apple", p2: "apples", p3: "Kiwi", p4: "Zzz" }), { type: "closePrompt" });
  s = K.reduce(s, { type: "review", group: "zzz", tier: null });
  const all = K.tierTally(s, false);
  assert.deepEqual(all.tiers.map((t) => t.count), [2, 0, 1, 0, 0]);
  assert.equal(all.misses, 2, "one not valid + one no answer");
  assert.equal(K.tierTally(s, true).tiers[0].count, 0, "nothing revealed yet");
});

test("KR-U3 rarity does not depend on how many players share an answer (N = 2 … 16)", () => {
  for (let n = 2; n <= 16; n += 1) {
    const players = Array.from({ length: n }, (_, i) => ({ pid: `q${i}`, name: `P${i}` }));
    const answers = {};
    players.forEach((p) => { answers[p.pid] = "Rambutan"; });
    const s = openWith(answers, players);
    assert.equal(s.phase, "reveal", "everyone answered → closes");
    const g = K.groups(s);
    assert.equal(g.length, 1);
    assert.equal(g[0].count, n);
    assert.equal(g[0].points, 100, `n=${n}: a listed One in a Krillion stays 100`);
  }
});

/* ============ KR-U4 not valid → 0 and the miss marker ============ */

test("KR-U4 a judged-invalid answer and no answer both score 0 and reveal as misses", () => {
  let s = K.reduce(openWith({ p1: "Apple", p2: "Durian", p3: "Zzzfruit" }), { type: "closePrompt" });
  assert.equal(K.reduce(s, { type: "revealNext" }), s, "the queue blocks the reveal");
  s = play(s, [{ type: "review", group: "durian", tier: "deepcut" }, { type: "review", group: "zzzfruit", tier: null }]);
  assert.equal(K.pendingReviews(s), 0);
  const order = K.revealOrder(s);
  assert.equal(order[0].label, "Zzzfruit");
  assert.equal(order[0].tier, null);
  assert.equal(order[1].noAnswer, true);
  assert.deepEqual(order[1].pids, ["p4", "p5"]);
  while (s.phase === "reveal") s = K.reduce(s, { type: "revealNext" });
  assert.deepEqual(s.players.map((p) => p.score), [10, 85, 0, 0, 0]);
  const v = K.phoneView(s, "p3", T0);
  assert.equal(v.screen, "reveal");
  assert.equal(v.miss, true);
  assert.equal(v.tier, "Not valid");
  assert.equal(K.phoneView(s, "p4", T0).tier, "No answer");
});

test("KR-U4 review rejects unknown groups and bad tiers; remember adds to the session", () => {
  let s = K.reduce(openWith({ p1: "Durian" }), { type: "closePrompt" });
  assert.equal(K.reduce(s, { type: "review", group: "apple", tier: "rare" }), s);
  assert.equal(K.reduce(s, { type: "review", group: "durian", tier: "obvious" }), s);
  assert.equal(K.reduce(s, { type: "remember", group: "durian" }), s, "nothing to remember before a ruling");
  s = play(s, [{ type: "review", group: "durian", tier: "rare" }, { type: "remember", group: "durian" }]);
  assert.deepEqual(s.learned, [{ index: s.dive.index, prompt: "Name a fruit", text: "Durian", tier: "rare" }]);
  assert.equal(K.matchFor(s, s.dive.index, "durians").tier, "rare");
  assert.equal(K.reduce(s, { type: "remember", group: "durian" }), s, "never twice");
  const file = K.applyLearned(fixtureGame(), s.learned);
  assert.equal(file.prompts[0].answers.at(-1).text, "Durian");
  K.validateGame(file);
});

/* ============ KR-U5 depth totals and ties ============ */

test("KR-U5 depth is 10 m a point; equal depths share a place", () => {
  let s = K.reduce(openWith({ p1: "Rambutan", p2: "Rambutan", p3: "Apple", p4: "Mango", p5: "Kiwi" }),
    { type: "closePrompt" });
  assert.equal(s.phase, "reveal");
  while (s.phase === "reveal") s = K.reduce(s, { type: "revealNext" });
  assert.equal(s.phase, "depth");
  assert.equal(K.depth(s, "p1"), 1000);
  const board = K.depthBoard(s);
  assert.deepEqual(board.map((r) => [r.pid, r.rank]), [["p1", 1], ["p2", 1], ["p5", 3], ["p4", 4], ["p3", 5]]);
  s = K.reduce(s, { type: "finish" });
  assert.equal(s.phase, "result");
  assert.deepEqual(s.winners, ["p1", "p2"], "ties stay ties");
});

test("KR-U5 a full game is promptsPerGame prompts, then the result", () => {
  let s = deepDive(PLAYERS, { promptsPerGame: 3 });
  for (let r = 1; r <= 3; r += 1) {
    assert.equal(s.round, r);
    s = play(s, [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p1", text: "Alpha1" }, { type: "closePrompt" }]);
    while (s.phase === "reveal") {
      K.reviewQueue(s).forEach((g) => { s = K.reduce(s, { type: "review", group: g.id, tier: "rare" }); });
      s = K.reduce(s, { type: "revealNext" });
    }
    s = K.reduce(s, { type: "nextPrompt" });
  }
  assert.equal(s.phase, "result");
});

/* ============ KR-U6 reveal order ============ */

test("KR-U6 reveal order: misses, then Prawn → One in a Krillion; depth markers move as groups land", () => {
  let s = K.reduce(openWith({ p1: "Rambutan", p2: "Apple", p3: "apple", p4: "Lychee", p5: "Mango" }),
    { type: "closePrompt" });
  assert.deepEqual(K.revealOrder(s).map((g) => g.label), ["Apple", "Mango", "Lychee", "Rambutan"]);
  s = K.reduce(s, { type: "revealNext" });
  assert.equal(K.depth(s, "p2"), 100, "Apple landed: 10 points = 100 m");
  assert.equal(K.depth(s, "p1"), 0, "Rambutan not yet");
  assert.equal(K.phoneView(s, "p1", T0).screen, "wait");
  s = play(s, [{ type: "revealNext" }, { type: "revealNext" }, { type: "revealNext" }]);
  assert.equal(K.depth(s, "p1"), 1000);
  assert.equal(K.phoneView(s, "p1", T0).tier, "One in a Krillion");
});

test("KR-U6 resubmitting before close replaces the answer; the clock is a deadline", () => {
  let s = openWith({ p1: "Apple" });
  assert.deepEqual(s.clock, { deadline: T0 + 30000, remainingMs: null, seconds: 30 });
  s = K.reduce(s, { type: "answer", pid: "p1", text: "Rambutan" });
  assert.equal(s.dive.answers.p1, "Rambutan");
  assert.equal(K.answeredCount(s).done, 1);
  s = K.reduce(s, { type: "closePrompt" });
  assert.equal(K.reduce(s, { type: "answer", pid: "p2", text: "Apple" }), s, "closed means closed");
  assert.equal(s.clock, null);
});

/* ============ KR-U7 Puffer Party ============ */

function puffer(settings, players) {
  const s = K.createState(fixtureGame(Object.assign({ mode: "puffer" }, settings || {})),
    { players: players || PLAYERS.slice(0, 3) });
  return play(s, [{ type: "start" }, { type: "pufferStart", now: T0 }]);
}

test("KR-U7 an on-list answer passes at once; a used answer is refused; off-list waits for the judge", () => {
  let s = puffer();
  assert.equal(s.puffer.holder, "p1");
  assert.equal(s.clock.seconds, 12);
  assert.equal(K.reduce(s, { type: "pufferAnswer", pid: "p2", text: "Apple", now: T0 }), s, "only the holder");
  s = K.reduce(s, { type: "pufferAnswer", pid: "p1", text: "Apple", now: T0 + 1000 });
  assert.equal(s.puffer.holder, "p2");
  assert.equal(s.clock.seconds, 11);
  assert.deepEqual(K.usedList(s), ["Apple"]);
  s = K.reduce(s, { type: "pufferAnswer", pid: "p2", text: "apples", now: T0 + 2000 });
  assert.equal(s.puffer.holder, "p2", "a used answer keeps the puffer");
  assert.equal(s.puffer.notice.kind, "used");
  s = K.reduce(s, { type: "pufferAnswer", pid: "p2", text: "Durian", now: T0 + 2500 });
  assert.equal(s.puffer.pending.text, "Durian");
  s = K.reduce(s, { type: "pufferJudge", tier: null, now: T0 + 3000 });
  assert.equal(s.puffer.holder, "p2");
  assert.equal(s.clock.deadline, T0 + 1000 + 11000, "not valid: the clock keeps running");
  s = play(s, [{ type: "pufferAnswer", pid: "p2", text: "Durian", now: T0 + 3500 },
    { type: "pufferJudge", tier: "krillion", now: T0 + 4000 }]);
  assert.equal(s.puffer.holder, "p3");
  assert.equal(s.players[1].meter, 4);
  s = K.reduce(s, { type: "remember", group: "durian" });
  assert.equal(s.learned.length, 1);
  s = K.reduce(s, { type: "pufferAnswer", pid: "p3", text: "Durian", now: T0 + 4500 });
  assert.equal(s.puffer.notice.kind, "used", "a remembered answer is still used this round");
});

test("KR-U7 pufferJudge also takes the {valid, niche} shape", () => {
  const pending = play(puffer(), [{ type: "pufferAnswer", pid: "p1", text: "Durian", now: T0 }]);
  const plain = K.reduce(pending, { type: "pufferJudge", valid: true, now: T0 });
  assert.equal(plain.puffer.used[0].tier, "prawn");
  const niche = K.reduce(pending, { type: "pufferJudge", valid: true, niche: true, now: T0 });
  assert.equal(niche.puffer.used[0].tier, "krillion");
  assert.equal(niche.players[0].meter, 4);
  const no = K.reduce(pending, { type: "pufferJudge", valid: false, now: T0 });
  assert.equal(no.puffer.holder, "p1");
  assert.equal(K.reduce(pending, { type: "pufferJudge", tier: "obvious", now: T0 }), pending);
});

test("KR-U7 the clock shrinks one step per pass down to the floor", () => {
  let s = puffer({ puffer: { startSeconds: 6, floorSeconds: 3, stepSeconds: 1 } });
  const seen = [s.clock.seconds];
  const answers = ["Apple", "Banana", "Mango", "Kiwi", "Lychee", "Rambutan"];
  answers.forEach((text, i) => {
    s = K.reduce(s, { type: "pufferAnswer", pid: s.puffer.holder, text, now: T0 + i });
    seen.push(s.clock.seconds);
  });
  assert.deepEqual(seen, [6, 5, 4, 3, 3, 3, 3]);
});

test("KR-U7 pop costs a heart; 0 hearts is out; last one floating wins", () => {
  let s = puffer({ puffer: { hearts: 1, maxHearts: 4 } });
  s = K.reduce(s, { type: "pufferPop", now: T0 + 12000 });
  assert.equal(s.players[0].hearts, 0);
  assert.equal(s.players[0].out, true);
  assert.equal(s.phase, "popped");
  assert.equal(K.phoneView(s, "p1", T0).screen, "out");
  s = K.reduce(s, { type: "nextRound" });
  assert.equal(s.puffer.holder, "p2", "the next player after the popped one starts");
  assert.notEqual(s.puffer.index, 0, "a new prompt");
  s = play(s, [{ type: "pufferStart", now: T0 }, { type: "pufferAnswer", pid: "p2", text: "Alpha1", now: T0 }]);
  assert.equal(s.puffer.holder, "p3", "the out player is skipped");
  s = K.reduce(s, { type: "pufferPop", now: T0 });
  assert.equal(s.phase, "result");
  assert.deepEqual(s.winners, ["p2"]);
  assert.deepEqual(K.pufferStandings(s).map((r) => [r.pid, r.rank]), [["p2", 1], ["p3", 2], ["p1", 3]],
    "the eliminated place by how long they lasted");
});

test("KR-U7 meter points buy a heart up to the maximum", () => {
  let s = puffer({ puffer: { hearts: 3, maxHearts: 4, meterForHeart: 4 } }, PLAYERS.slice(0, 2));
  const turn = (pid, text) => { s = K.reduce(s, { type: "pufferAnswer", pid, text, now: T0 }); };
  turn("p1", "Rambutan");                       // +4 meter → heart 4
  assert.equal(s.players[0].hearts, 4);
  assert.equal(s.players[0].meter, 0);
  assert.equal(s.puffer.notice.kind, "heart");
  turn("p2", "Apple");
  turn("p1", "Lychee");                         // +3
  turn("p2", "Banana");
  turn("p1", "Kiwi");                           // +2 → 5, but already at max
  assert.equal(s.players[0].hearts, 4);
  assert.equal(s.players[0].meter, 5);
});

test("KR-U7 an optional round cap ends the game on hearts", () => {
  let s = puffer({ puffer: { roundCap: 1 } });
  s = K.reduce(s, { type: "pufferPop", now: T0 });
  assert.equal(s.phase, "result");
  assert.deepEqual(s.winners, ["p2", "p3"]);
});

/* ============ KR-U8 undo, illegal events, immutability, prototype guard ============ */

test("KR-U8 undo steps back, keeping the clock's remaining time", () => {
  let s = openWith({});
  s = K.reduce(s, { type: "answer", pid: "p1", text: "Apple", now: T0 + 5000 });
  const back = K.reduce(s, { type: "undo", now: T0 + 60000 });
  assert.equal(back.dive.answers.p1, undefined);
  assert.equal(back.clock.deadline, T0 + 60000 + 25000, "25 s were left when the answer came in");
  assert.equal(back.game, s.game, "the content is not stored in history");
  assert.equal(s.history[0].game, null);
});

test("KR-U8 freeze and thaw turn a deadline into remaining time and back", () => {
  const s = openWith({});
  const frozen = K.freeze(s, T0 + 10000);
  assert.deepEqual(frozen.clock, { deadline: null, remainingMs: 20000, seconds: 30 });
  assert.equal(K.thaw(frozen, T0 + 99000).clock.deadline, T0 + 99000 + 20000);
  const paused = K.reduce(s, { type: "pauseClock", now: T0 + 1000 });
  assert.equal(paused.clock.remainingMs, 29000);
  assert.equal(paused.history.length, s.history.length, "a pause is not an undo step");
});

test("KR-U8 illegal and unknown events return the same state; inputs are never mutated", () => {
  const s = openWith({ p1: "Apple" });
  const before = JSON.stringify(s);
  for (const e of [{ type: "revealNext" }, { type: "nextPrompt" }, { type: "pufferPop" },
    { type: "answer", pid: "nobody", text: "Apple" }, { type: "answer", pid: "p2", text: "  " },
    { type: "review", group: "apple", tier: "rare" }, { type: "openPrompt", now: T0 },
    { type: "toString" }, { type: "__proto__" }, { type: "constructor" }, { type: "hasOwnProperty" },
    null, 7, "start", { type: 4 }]) {
    assert.equal(K.reduce(s, e), s, JSON.stringify(e));
  }
  K.reduce(s, { type: "answer", pid: "p2", text: "Mango" });
  K.reduce(s, { type: "closePrompt" });
  assert.equal(JSON.stringify(s), before);
  assert.equal(Object.prototype.polluted, undefined);
});

test("KR-U8 createState refuses bad line-ups", () => {
  assert.throws(() => K.createState(fixtureGame(), { players: [{ pid: "a", name: "A" }] }), /at least 2/);
  assert.throws(() => K.createState(fixtureGame(), { players: [{ pid: "a", name: "A" }, { pid: "a", name: "B" }] }),
    /twice/);
  const many = Array.from({ length: 17 }, (_, i) => ({ pid: `x${i}`, name: `X${i}` }));
  assert.throws(() => K.createState(fixtureGame(), { players: many }), /16/);
});

/* ============ KR-U9 phone messages ============ */

test("KR-U9 validatePhoneMsg caps, strips and refuses junk", () => {
  assert.deepEqual(K.validatePhoneMsg({ t: "answer", text: "  Apple\u0007 " }), { t: "answer", text: "Apple" });
  assert.equal(K.validatePhoneMsg({ t: "answer", text: "x".repeat(60) }).text.length, 40);
  assert.equal(K.validatePhoneMsg({ t: "answer", text: "x".repeat(5000) }), null);
  assert.equal(K.validatePhoneMsg({ t: "answer", text: "!!!" }), null);
  assert.equal(K.validatePhoneMsg({ t: "review", text: "Apple" }), null);
  assert.equal(K.validatePhoneMsg({ t: "answer" }), null);
  assert.equal(K.validatePhoneMsg("answer"), null);
  assert.deepEqual(K.validatePhoneMsg({ t: "ready" }), { t: "ready" });
  const s = openWith({});
  assert.equal(K.phoneMaySend(s, "p1", "answer"), true);
  assert.equal(K.phoneMaySend(s, "zz", "answer"), false);
  assert.equal(K.phoneMaySend(s, "p1", "puffer"), false);
});

/* ============ KR-U10 the leak test ============ */

test("KR-U10 no phone ever sees another player's answer before its reveal, nor the rated list", () => {
  const secrets = { p1: "Rambutan", p2: "Zqsecret", p3: "Apple", p4: "Kiwi" };
  let s = openWith(secrets);
  const listWords = s.game.prompts[s.dive.index].answers.flatMap((a) => [a.text].concat(a.aliases || []));
  const check = (state, label) => {
    PLAYERS.forEach((p) => {
      const json = JSON.stringify(K.phoneView(state, p.pid, T0)).toLowerCase();
      Object.keys(secrets).forEach((other) => {
        if (other === p.pid) return;
        const g = K.revealOrder(state).find((x) => x.pids.indexOf(other) >= 0);
        const shown = state.dive && (state.dive.banked
          || K.revealOrder(state).indexOf(g) < state.dive.revealed);
        const mineToo = K.groups(state).some((x) => x.pids.indexOf(p.pid) >= 0 && x.pids.indexOf(other) >= 0);
        if (!shown && !mineToo) {
          assert.ok(json.indexOf(secrets[other].toLowerCase()) < 0, `${label}: ${p.pid} sees ${other}`);
        }
      });
      listWords.forEach((w) => {
        const own = Object.values(secrets).some((x) => K.normaliseAnswer(x) === K.normaliseAnswer(w));
        if (!own) assert.ok(json.indexOf(`"${w.toLowerCase()}"`) < 0, `${label}: ${p.pid} sees list word ${w}`);
      });
    });
  };
  check(s, "open prompt");
  s = K.reduce(s, { type: "closePrompt" });
  check(s, "closed, under review");
  s = K.reduce(s, { type: "review", group: "zqsecret", tier: "rare" });
  for (let i = 0; i < 4; i += 1) { s = K.reduce(s, { type: "revealNext" }); check(s, `reveal ${i + 1}`); }
  const ps = puffer();
  PLAYERS.slice(0, 3).forEach((p) => {
    const json = JSON.stringify(K.phoneView(ps, p.pid, T0));
    listWords.forEach((w) => assert.ok(json.indexOf(`"${w}"`) < 0, `puffer view leaks ${w}`));
  });
});
