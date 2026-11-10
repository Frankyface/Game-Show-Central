/* ============================================================
   Chain Reaction — host-phone view (docs/22 §5.1, §5.5 unit tier)

   hostView holds the right words at each phase, says "nothing
   secret" where there is none, stays deterministic and small, and
   adding it changed nothing a contestant phone receives.
   Run with:  cd games/chain-reaction && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/cr-core.js");
const HV = require("../js/cr-host-view.js");
const SHIPPED = require("../chains.json");

const rng = () => 0;
const TEAMS = [{ name: "Red", pids: ["p1"] }, { name: "Blue", pids: ["p2"] }];
const go = (s, ...events) => events.reduce((acc, e) => Core.reduce(acc, e, rng, e.now || 0), s);

function game(values) {
  const g = JSON.parse(JSON.stringify(SHIPPED));
  g.settings.values = values || [100, 100];
  return g;
}

function started(values) {
  return go(Core.createState(game(values), TEAMS, {}), { type: "start" });
}

/** Sweep the chain in play so the next phase can be reached. */
function sweep(s) {
  let guard = 0;
  while (s.phase === "chain" && guard < 200) {
    guard += 1;
    s = go(s, { type: "reveal", direction: guard % 2 ? "top" : "bottom" });
    if (s.target !== null) s = go(s, { type: "judge", correct: true }, { type: "passControl" });
  }
  return s;
}

test("HV setup and a missing state: nothing secret", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setup", secret: false });
  const fresh = Core.createState(game(), TEAMS, {});
  assert.equal(HV.hostView(fresh).secret, false);
  assert.equal(HV.currentAnswer(fresh), "");
  assert.deepEqual(HV.hiddenWords(fresh), []);
});

test("HV the chain: every word, top to bottom, with what the room can see", () => {
  const s = started();
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.phaseLabel, "Chain 1 of 2");
  assert.deepEqual(v.words.map((w) => w.word), s.chain.words, "the whole chain in order");
  assert.deepEqual(v.words.map((w) => w.status),
    ["given", "hidden", "hidden", "hidden", "hidden", "hidden", "hidden", "given"]);
  assert.deepEqual(v.words.map((w) => w.shown), [5, 0, 0, 0, 0, 0, 0, 3]);
  assert.equal(v.current, null, "nothing being guessed yet");
  assert.equal(v.value, "$100");
  assert.equal(v.control, "Red");
});

test("HV the frontier words are marked, and move inwards", () => {
  let s = started();
  assert.deepEqual(HV.hostView(s).words.map((w) => w.frontier),
    [null, "top", null, null, null, null, "bottom", null]);
  s = go(s, { type: "reveal", direction: "top" }, { type: "judge", correct: true });
  const v = HV.hostView(s);
  assert.equal(v.words[1].status, "solved");
  assert.equal(v.words[1].owner, 0);
  assert.equal(v.words[2].frontier, "top");
});

test("HV the word being guessed is the current item, with the letters lit", () => {
  const s = go(started(), { type: "reveal", direction: "bottom" });
  const v = HV.hostView(s);
  assert.deepEqual(v.current, { word: "WAY", index: 6, from: "bottom", shown: 1 });
  assert.equal(v.words[6].target, true);
  assert.deepEqual(v.words[6].lit, [true, false, false]);
  assert.equal(HV.currentAnswer(s), "WAY");
});

test("HV the item key changes exactly when the word in play changes", () => {
  const a = started();
  const b = go(a, { type: "reveal", direction: "top" });
  const c = go(b, { type: "guess", text: "ship" });
  const d = go(c, { type: "judge", correct: false });
  const e = go(d, { type: "reveal", direction: "top" });
  assert.equal(HV.itemKey(a), "chain:0:-");
  assert.equal(HV.itemKey(b), "chain:0:1");
  assert.equal(HV.itemKey(c), HV.itemKey(b), "typing a guess is not a new item");
  assert.equal(HV.itemKey(d), "chain:0:-", "a judgement ends the item");
  assert.equal(HV.itemKey(e), "chain:0:1");
});

test("HV hiddenWords lists exactly the words the room has not seen whole", () => {
  let s = started();
  assert.deepEqual(HV.hiddenWords(s), s.chain.words.slice(1, 7));
  s = go(s, { type: "reveal", direction: "top" }, { type: "judge", correct: true });
  assert.deepEqual(HV.hiddenWords(s), s.chain.words.slice(2, 7), "a solved word is public now");
});

test("HV the chain-complete interstitial and the result: nothing secret", () => {
  const done = sweep(started());
  assert.equal(done.phase, "chainDone");
  assert.equal(HV.hostView(done).secret, false);
  assert.equal(HV.hostView(done).phaseLabel, "Chain complete 1 of 2");
  const result = go(done, { type: "finish" });
  assert.deepEqual(HV.hostView(result), { phase: "result", phaseLabel: "Result", secret: false });
});

test("HV sudden death: the tiebreak word and its clue, until it is won", () => {
  let s = sweep(started());
  s = sweep(go(s, { type: "nextChain" }));
  assert.equal(Core.leader(s), null, "the alternating sweep ties");
  s = go(s, { type: "suddenDeath" });
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.current.word, s.sudden.word);
  assert.equal(v.before, s.sudden.before);
  assert.equal(v.after, s.sudden.after);
  assert.equal(HV.currentAnswer(s), s.sudden.word);
  const won = go(s, { type: "judge", correct: true });
  assert.equal(HV.hostView(won).secret, false, "once won it is public");
});

test("HV the Speed Chain: all eight words, the one to call, banked and passed", () => {
  let s = sweep(started([100, 200]));
  s = sweep(go(s, { type: "nextChain" }));
  s = go(s, { type: "toSpeed", team: 0 }, { type: "speedStart" });
  assert.equal(s.phase, "speed");
  let v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.deepEqual(v.words.map((w) => w.word), s.speed.words);
  assert.equal(v.current.word, s.speed.words[1]);
  assert.equal(v.words[1].shown, 1, "the first letter is on the board");
  s = go(s, { type: "speedMark", result: "got" }, { type: "speedMark", result: "pass" });
  v = HV.hostView(s);
  assert.equal(v.words[1].status, "got");
  assert.equal(v.words[2].status, "pass");
  assert.equal(v.current.word, s.speed.words[3]);
  for (let i = 0; i < 6; i += 1) s = go(s, { type: "speedMark", result: "got" });
  assert.equal(s.speed.over, true);
  assert.equal(HV.hostView(s).secret, false, "over: nothing left to hide");
});

test("HV is pure, deterministic and small even with 12-letter words", () => {
  const g = game();
  g.chains[0] = ["THANKSGIVING", "CHRISTMASSES", "QUARTERBACKS", "SWITCHBOARDS",
    "PLAYGROUNDER", "SKATEBOARDER", "HEADQUARTERS", "BACKGROUNDED"];
  const s = go(Core.createState(g, TEAMS, {}), { type: "start" }, { type: "reveal", direction: "top" });
  const before = JSON.stringify(s);
  const a = HV.hostView(s);
  assert.deepEqual(HV.hostView(s), a);
  assert.equal(JSON.stringify(s), before, "the state is untouched");
  assert.ok(Buffer.byteLength(JSON.stringify(a)) < 16384, `${Buffer.byteLength(JSON.stringify(a))} bytes`);
});

test("HV contestant phoneView is unchanged and still never holds a hidden word", () => {
  const s = go(started(), { type: "reveal", direction: "top" });
  const views = ["p1", "p2", "stranger"].map((pid) => JSON.stringify(Core.phoneView(s, pid)));
  HV.hostView(s);
  assert.deepEqual(["p1", "p2", "stranger"].map((pid) => JSON.stringify(Core.phoneView(s, pid))), views);
  HV.hiddenWords(s).forEach((word) => views.forEach((v) => assert.ok(v.indexOf(`"${word}"`) < 0, word)));
  assert.ok(!views.some((v) => v.indexOf('"t":"host"') >= 0));
});
