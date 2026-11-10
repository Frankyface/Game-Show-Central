// Krillion — host-phone view (docs/22 §5.1, §5.5). Run from games/krillion: node --test

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const K = require("../js/kr-core.js");
const HV = require("../js/kr-host-view.js");
const here = path.dirname(fileURLToPath(import.meta.url));

const T0 = 1000000;
const PLAYERS = [{ pid: "p1", name: "Ann" }, { pid: "p2", name: "Bo" }, { pid: "p3", name: "Cy" }];

function game(extra) {
  const prompts = [{ text: "Name a fruit", category: "Food", answers: [
    { text: "Apple", tier: "prawn" }, { text: "Banana", tier: "prawn" }, { text: "Mango", tier: "schooler" },
    { text: "Kiwi", tier: "rare", aliases: ["Kiwifruit"] }, { text: "Lychee", tier: "deepcut" },
    { text: "Rambutan", tier: "krillion" }].concat(extra || []) }];
  for (let i = 1; i < 40; i += 1) {
    prompts.push({ text: `Thing ${i}`, category: "Misc", answers: [
      { text: `Alpha${i}`, tier: "prawn" }, { text: `Bravo${i}`, tier: "prawn" }, { text: `Delta${i}`, tier: "rare" },
      { text: `Echo${i}`, tier: "deepcut" }, { text: `Zulu${i}`, tier: "krillion" }] });
  }
  return { title: "HV", settings: { promptsPerGame: 2 }, prompts };
}

const play = (s, events) => events.reduce((acc, e) => K.reduce(acc, e), s);
const dive = (g) => K.reduce(K.createState(g || game(), { players: PLAYERS }), { type: "start" });

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

test("HV-1 nothing secret on setup, the depth board and the result", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setup", mode: "", secret: false });
  let s = play(dive(), [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p1", text: "Apple" },
    { type: "closePrompt" }]);
  while (s.phase === "reveal") s = K.reduce(s, { type: "revealNext" });
  const depth = HV.hostView(s);
  assert.equal(depth.secret, false);
  assert.equal(depth.phaseLabel, "Depth board");
  assert.equal(depth.list, undefined);
  const result = HV.hostView(K.reduce(s, { type: "finish" }));
  assert.equal(result.secret, false);
  assert.equal(JSON.stringify(result).includes("Rambutan"), false);
});

test("HV-2 intro and open prompt: the prompt and its rated list grouped by tier, no answers yet", () => {
  const s = dive();
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.phaseLabel, "Prompt 1 of 2");
  assert.deepEqual(v.prompt, { text: "Name a fruit", category: "Food" });
  assert.deepEqual(v.list.map((r) => [r.name, r.answers.join("|")]), [
    ["Prawn", "Apple|Banana"], ["Schooler", "Mango"], ["Rare", "Kiwi"], ["Deep Cut", "Lychee"],
    ["One in a Krillion", "Rambutan"]]);
  assert.deepEqual(v.answers, []);
  assert.equal(v.answered, "0 / 3");
});

test("HV-3 answers appear as they arrive with their matched tier, or pending", () => {
  let s = play(dive(), [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p2", text: "kiwifruit" }]);
  let v = HV.hostView(s);
  assert.deepEqual(v.answers, [{ name: "Bo", text: "kiwifruit", match: "Kiwi", tier: "Rare", onList: true }]);
  s = K.reduce(s, { type: "answer", pid: "p1", text: "Durian" });
  v = HV.hostView(s);
  assert.deepEqual(v.answers.map((a) => `${a.name}:${a.tier}`), ["Ann:pending", "Bo:Rare"]);
  assert.equal(v.answered, "2 / 3");
});

test("HV-4 the judge's queue preview follows the rulings; remembered answers join the list", () => {
  let s = play(dive(), [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p1", text: "Durian" },
    { type: "answer", pid: "p2", text: "durian!" }, { type: "answer", pid: "p3", text: "Zzz" }]);
  let v = HV.hostView(s);
  assert.equal(v.reviewing, true);
  assert.deepEqual(v.queue.map((q) => `${q.text}:${q.count}:${q.tier}`), ["Durian:2:to rule", "Zzz:1:to rule"]);
  s = play(s, [{ type: "review", group: "durian", tier: "deepcut" }, { type: "review", group: "zzz", tier: null },
    { type: "remember", group: "durian" }]);
  v = HV.hostView(s);
  assert.deepEqual(v.queue.map((q) => q.tier), ["Deep Cut", "Not valid"]);
  assert.ok(v.list.find((r) => r.tier === "deepcut").answers.includes("Durian"));
  assert.equal(v.answers.find((a) => a.name === "Cy").tier, "Not valid");
  s = K.reduce(s, { type: "revealNext" });
  assert.equal(HV.hostView(s).reviewing, false);
});

test("HV-5 Puffer Party: prompt, rated list, holder, used answers and a pending ruling", () => {
  let s = K.createState(Object.assign(game(), { settings: { mode: "puffer" } }), { players: PLAYERS });
  s = play(s, [{ type: "start" }, { type: "pufferStart", now: T0 },
    { type: "pufferAnswer", pid: "p1", text: "Apple", now: T0 },
    { type: "pufferAnswer", pid: "p2", text: "Durian", now: T0 }]);
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.phaseLabel, "Puffer Party · round 1");
  assert.equal(v.holder, "Bo");
  assert.deepEqual(v.used, [{ text: "Apple", tier: "Prawn" }]);
  assert.deepEqual(v.pending, { text: "Durian" });
  assert.equal(v.list.length, 5);
});

test("HV-6 long lists are cut with a count, and the biggest shipped prompt stays far under 16 KB", () => {
  const extra = Array.from({ length: 50 }, (_, i) => ({ text: `Extra fruit ${i}`, tier: "rare" }));
  const v = HV.hostView(dive(game(extra)));
  const rare = v.list.find((r) => r.tier === "rare");
  assert.equal(rare.answers.length, HV.WORDS_PER_TIER);
  assert.equal(rare.more, 51 - HV.WORDS_PER_TIER);
  const shipped = JSON.parse(readFileSync(path.join(here, "..", "prompts.json"), "utf8"));
  const sixteen = Array.from({ length: 16 }, (_, i) => ({ pid: `q${i}`, name: `Player number ${i}` }));
  let worst = 0;
  shipped.prompts.forEach((_, i) => {
    // Play prompt i first: a fresh state whose draw order starts at i.
    const fresh = Object.assign({}, K.createState(shipped, { players: sixteen }), { order: [i] });
    let s = play(fresh, [{ type: "start" }, { type: "openPrompt", now: T0 }]);
    sixteen.slice(0, 15).forEach((p, j) => { s = K.reduce(s, { type: "answer", pid: p.pid, text: `An off list answer ${j} xx` }); });
    worst = Math.max(worst, new TextEncoder().encode(JSON.stringify(Object.assign({ t: "host", item: "x", seq: 1 }, HV.hostView(s)))).length);
  });
  assert.ok(worst < 8192, `largest view ${worst} bytes`);
});

test("HV-7 itemKey changes on a new prompt only; hostView is pure", () => {
  let s = play(dive(), [{ type: "openPrompt", now: T0 }]);
  const k1 = HV.itemKey(s);
  s = play(s, [{ type: "answer", pid: "p1", text: "Apple" }, { type: "closePrompt" }]);
  assert.equal(HV.itemKey(s), k1, "closing and judging is the same item");
  while (s.phase === "reveal") s = K.reduce(s, { type: "revealNext" });
  s = K.reduce(s, { type: "nextPrompt" });
  assert.notEqual(HV.itemKey(s), k1);
  assert.equal(HV.itemKey(null), "setup");
  const frozen = deepFreeze(play(dive(), [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p1", text: "Durian" }]));
  const before = JSON.stringify(frozen);
  HV.hostView(frozen);
  HV.itemKey(frozen);
  assert.equal(JSON.stringify(frozen), before);
});

test("HV-8 phoneView is unchanged: no contestant view carries the rated list or another player's answer", () => {
  const s = play(dive(), [{ type: "openPrompt", now: T0 }, { type: "answer", pid: "p1", text: "Durian" }]);
  ["p1", "p2", "p3"].forEach((pid) => {
    const json = JSON.stringify(K.phoneView(s, pid, T0));
    ["Banana", "Mango", "Rambutan", "Lychee"].forEach((w) => assert.equal(json.includes(w), false, `${pid} sees ${w}`));
    if (pid !== "p1") assert.equal(json.includes("Durian"), false);
  });
  assert.equal(K.phoneView(s, "p2", T0).screen, "answer");
});
