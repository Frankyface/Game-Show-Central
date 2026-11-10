/* ============================================================
   Password — host-phone selector (docs/22 §5.1, §5.5, §6)
   hostView(state) holds the right secret at each phase, nothing
   in phases with no secret, stays small and pure, and leaves the
   contestant phoneView untouched.
   Run with:  cd games/password && node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Core, boot, clueAnd, scoreTo, assertNoLeak, words, game, TEAMS } from "./pwd-fixtures.mjs";

const require = createRequire(import.meta.url);
const { hostView, MAX_LIST } = require("../js/pwd-host-view.js");

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

/** Everything a view could carry as text, for "is X in it" checks. */
const json = (v) => JSON.stringify(v);

function toLightning(opts) {
  let s = scoreTo(boot(opts), 0, 25);
  s = Core.reduce(s, { type: "toLightning" }, 1000);
  return Core.reduce(s, { type: "lightningStart" }, 1000);
}

test("HP-U1 setup (no state) has nothing secret and still carries a string item", () => {
  const v = hostView(null);
  assert.equal(v.secret, false);
  assert.equal(v.item, "");
  assert.equal(v.answer, undefined);
  const setup = Core.createState(game(), TEAMS, {});
  assert.equal(hostView(setup).secret, false);
  assert.equal(hostView(setup).answer, undefined);
});

test("HP-U2 a live word: the password, the ladder position, whose clue, the next password", () => {
  let s = boot();
  let v = hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.stage, "live");
  assert.equal(v.answer, s.round.word);
  assert.equal(v.item, "Password 1");
  assert.equal(v.value, 10);
  assert.equal(v.clues, 0);
  assert.equal(v.maxClues, 10);
  assert.equal(v.turnName, "Reds");
  assert.deepEqual(v.givers, ["Ada", "Cleo"]);
  assert.equal(v.next, s.order[s.cursor], "the next password in the deal");
  assert.notEqual(v.next, v.answer);
  s = clueAnd(s, "wrong");
  s = Core.reduce(s, { type: "clueGiven" }, 0);
  v = hostView(s);
  assert.equal(v.clues, 2);
  assert.equal(v.value, 9, "the ladder follows the clues");
  assert.equal(v.turnName, "Blues");
});

test("HP-U3 a finished word: its password is public, only the next one is private", () => {
  const s = clueAnd(boot(), "correct");
  const v = hostView(s);
  assert.equal(v.stage, "between");
  assert.equal(v.answer, s.order[s.cursor], "the one about to be dealt");
  assert.notEqual(v.answer, s.round.word);
  assert.equal(json(v).indexOf(s.round.word), -1, "the spent password is not repeated");
  const dealt = Core.reduce(s, { type: "nextWord" }, 0);
  assert.equal(hostView(dealt).answer, dealt.round.word, "and it is exactly the word that gets dealt");
  assert.equal(hostView(dealt).item, "Password 2");
});

test("HP-U4 game over: the Lightning words, in the order they will be dealt", () => {
  const s = scoreTo(boot(), 0, 25);
  assert.equal(s.phase, "gameOver");
  const v = hostView(s);
  assert.equal(v.stage, "lightning-next");
  assert.equal(v.words.length, 5);
  const dealt = Core.reduce(s, { type: "toLightning" }, 0);
  assert.deepEqual(v.words.map((w) => w.text), dealt.lightning.words.map((w) => w.text));
  assert.equal(v.answer, v.words[0].text);
});

test("HP-U5 the Lightning Round: every word with its status, the current one marked", () => {
  let s = toLightning();
  let v = hostView(s);
  assert.equal(v.stage, "lightning");
  assert.equal(v.answer, s.lightning.words[0].text);
  assert.deepEqual(v.words.map((w) => w.status), ["pending", "pending", "pending", "pending", "pending"]);
  assert.equal(v.words[0].current, true);
  assert.equal(v.item, "Lightning Round · word 1 of 5");
  s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  s = Core.reduce(s, { type: "lightningMark", result: "pass" }, 2000);
  v = hostView(s);
  assert.deepEqual(v.words.map((w) => w.status).slice(0, 2), ["got", "passed"]);
  assert.equal(v.words[2].current, true);
  assert.equal(v.answer, s.lightning.words[2].text);
  assert.equal(v.money, "$100");
});

test("HP-U6 nothing secret once the Lightning Round is over, on the result and on the standings", () => {
  let s = toLightning();
  const all = s.lightning.words.map((w) => w.text);
  for (let i = 0; i < 5; i += 1) s = Core.reduce(s, { type: "lightningMark", result: "got" }, 2000);
  const phases = [s, Core.reduce(s, { type: "nextWord" }, 0)];
  phases.push(Core.reduce(phases[1], { type: "nextWord" }, 0));
  phases.forEach((st) => {
    const v = hostView(st);
    assert.equal(v.secret, false, `${st.phase} has nothing private`);
    assert.equal(v.answer, undefined);
    assert.equal(v.words, undefined);
    all.forEach((w) => assert.equal(json(v).indexOf(w), -1, `${st.phase} leaked ${w}`));
    assert.equal(typeof v.item, "string");
  });
});

test("HP-U7 pure, deterministic and never mutates its input", () => {
  const states = [boot(), clueAnd(boot(), "correct"), scoreTo(boot(), 0, 25), toLightning()];
  states.forEach((st) => {
    const before = json(st);
    deepFreeze(st);
    assert.doesNotThrow(() => hostView(st));
    assert.equal(json(hostView(st)), json(hostView(st)));
    assert.equal(json(st), before);
  });
});

test("HP-U8 small: well under the 16 KB host-view cap, lists never exceed ten", () => {
  const big = boot({ count: 200, settings: { lightningWords: 10, targetScore: 10 } });
  const over = scoreTo(big, 0, 10);
  const views = [hostView(big), hostView(over), hostView(Core.reduce(over, { type: "toLightning" }, 0))];
  views.forEach((v) => {
    assert.ok(Buffer.byteLength(JSON.stringify(v), "utf8") < 4096, `${v.stage} is ${JSON.stringify(v).length} bytes`);
    if (v.words) assert.ok(v.words.length <= MAX_LIST);
  });
});

test("HP-U9 the contestant phoneView is unchanged by the host view, and still never leaks", () => {
  const s = boot();
  const before = ["p1", "p2", "p3", "p4", "px"].map((pid) => json(Core.phoneView(s, pid)));
  hostView(s);
  const after = ["p1", "p2", "p3", "p4", "px"].map((pid) => json(Core.phoneView(s, pid)));
  assert.deepEqual(after, before);
  assertNoLeak(s, ["p1", "p3"]);
  const l = toLightning();
  hostView(l);
  assertNoLeak(l, [l.lightning.giverPid]);
});

test("HP-U10 the next password wraps round the list like the deal does", () => {
  let s = boot({ words: words(60) });
  const skip = (st) => Core.reduce(Core.reduce(st, { type: "skipWord" }, 0), { type: "nextWord" }, 0);
  for (let i = 0; i < 59; i += 1) s = skip(s);
  assert.equal(hostView(s).next, s.order[0], "after the last word of the file comes the first");
  assert.equal(hostView(s).repeating, false);
});
