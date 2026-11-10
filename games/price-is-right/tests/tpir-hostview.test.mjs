/* ============================================================
   The Price Is Right — host phone view unit tests (docs/22 §5.5)
   hostView holds the right price at every phase, nothing in the
   phases with no secret, never an image, never mutates; the laptop
   fallback is keyed per item; phoneView is unchanged.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  Core, fixed, PLAYERS, tiny, started, run, toGame, toShowdown, toShowcase, deepFreeze,
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const HV = require("../js/tpir-host-view.js");
const money = (n) => Core.money("$", n);

/** Every price string a state could leak, for "nothing secret" checks. */
function allPrices(state) {
  const c = state.content;
  return [].concat(
    c.oneBid.map((i) => i.price),
    c.cliffhangers.flatMap((s) => s.items.map((i) => i.price)),
    c.luckyseven.map((i) => i.price),
    c.showcases.map((s) => s.total),
  ).map(money);
}

test("HV-1 nothing secret before the show, in the showdown and in the standings", () => {
  assert.deepEqual(HV.hostView(null), { phase: "setup", phaseLabel: "Setting up", secret: false, item: "", note: "" });
  const setup = Core.createState(tiny(), PLAYERS);
  assert.equal(HV.hostView(setup).secret, false);
  const sd = toShowdown();
  assert.equal(sd.phase, "showdown");
  const v = HV.hostView(sd);
  assert.equal(v.secret, false);
  assert.equal(v.answer, undefined);
  assert.ok(allPrices(sd).every((p) => JSON.stringify(v).indexOf(p) < 0), JSON.stringify(v));
  const end = Core.reduce(sd, { type: "finish" }, fixed(0));
  assert.equal(HV.hostView(end).secret, false);
  assert.equal(HV.fallbackFor(end), null);
});

test("HV-2 Contestants' Row: the item's actual retail price, until it is revealed", () => {
  let s = started();
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.equal(v.item, s.row.item.name);
  assert.equal(v.answer, money(s.row.item.price));
  assert.deepEqual(HV.fallbackFor(s), { key: `row:${s.segmentIndex}`, text: `Actual retail price: ${money(s.row.item.price)}` });
  s = run(s, [{ type: "bid", pid: s.row.seats[0], amount: 1 }, { type: "revealBids" }]);
  assert.equal(HV.hostView(s).secret, false, "public once revealed");
  assert.equal(HV.fallbackFor(s), null);
});

test("HV-3 Cliff Hangers: the current small item's price, all three listed, and it steps", () => {
  let s = toGame("cliffhangers");
  const items = s.game.items;
  let v = HV.hostView(s);
  assert.equal(v.item, items[0].name);
  assert.equal(v.answer, money(items[0].price));
  assert.deepEqual(v.lines.map((l) => l.value), items.map((i) => money(i.price)));
  const key0 = HV.fallbackFor(s).key;
  s = Core.reduce(s, { type: "chGuess", amount: items[0].price }, fixed(0));
  v = HV.hostView(s);
  assert.equal(v.item, items[1].name);
  assert.equal(v.answer, money(items[1].price));
  assert.notEqual(HV.fallbackFor(s).key, key0, "the fallback clears on the next item");
  s = run(s, [{ type: "chGuess", amount: items[1].price }, { type: "chGuess", amount: items[2].price }]);
  assert.equal(s.game.done, true);
  assert.equal(HV.hostView(s).secret, false);
});

test("HV-4 Plinko: the actual small price and which way it is wrong; nothing once the chips drop", () => {
  let s = toGame("plinko");
  const p = s.game.prices[0];
  const v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.ok(v.item.indexOf(p.name) === 0 && v.item.indexOf(money(p.shown)) > 0);
  assert.ok(v.answer.indexOf(money(p.actual)) === 0, v.answer);
  assert.ok(/Higher|Lower|Correct as shown/.test(v.answer));
  s = run(s, s.game.prices.map((q) => ({ type: "plinkoAnswer", answer: Core.plinkoTruth(q) })));
  assert.equal(s.game.stage, "drops");
  assert.equal(HV.hostView(s).secret, false);
});

test("HV-5 Lucky Seven: the car's full price, one fallback key for the whole car", () => {
  let s = toGame("luckyseven");
  const v = HV.hostView(s);
  assert.equal(v.item, s.game.car);
  assert.equal(v.answer, money(s.game.price));
  assert.equal(v.lines.length, 5);
  const key = HV.fallbackFor(s).key;
  s = Core.reduce(s, { type: "l7Guess", digit: s.game.digits[1] }, fixed(0));
  assert.equal(HV.fallbackFor(s).key, key);
});

test("HV-6 The Showcase: both totals before the reveal, with owners once claimed; nothing after", () => {
  let s = toShowcase();
  const totals = s.showcase.pair.map((i) => money(s.content.showcases[i].total));
  let v = HV.hostView(s);
  assert.equal(v.secret, true);
  assert.deepEqual(v.lines.map((l) => l.value), totals);
  assert.equal(v.answer, totals.join(" · "));
  s = Core.reduce(s, { type: "showcasePass", pass: false }, fixed(0));
  v = HV.hostView(s);
  assert.ok(v.lines[0].label.indexOf(Core.nameOf(s, s.showcase.chooser)) > 0, v.lines[0].label);
  s = run(s, s.showcase.finalists.map((pid) => ({ type: "showcaseBid", pid, amount: 1 })).concat([{ type: "revealShowcase" }]));
  assert.equal(HV.hostView(s).secret, false);
});

test("HV-7 no image data, pure, small, and phoneView unchanged", () => {
  const g = tiny();
  g.oneBid.forEach((i) => { i.image = "img/espresso-machine.svg"; i.imageAlt = "photo"; });
  g.luckyseven[0].image = "img/car.png";
  g.cliffhangers[0].items[0].image = "img/a.png";
  const states = [started(g)];
  let s = started(g);
  s = run(s, [{ type: "bid", pid: s.row.seats[0], amount: 1 }, { type: "revealBids" }, { type: "nextSegment" },
    { type: "pickGame", kind: "luckyseven" }]);
  states.push(s, toGame("cliffhangers"), toShowcase());
  for (const st of states) {
    const frozen = deepFreeze(st);
    const before = JSON.stringify(frozen);
    const v = HV.hostView(frozen);
    assert.equal(JSON.stringify(frozen), before, "hostView never mutates");
    const text = JSON.stringify(v);
    assert.ok(!/image|imageAlt|\.svg|\.png/.test(text), text);
    assert.ok(Buffer.byteLength(text, "utf8") < 16384);
    for (const pid of ["p1", "p2", "p3", "p4"]) {
      const pv = Core.phoneView(frozen, pid);
      assert.equal(pv.answer, undefined, "a phone view never carries the host's answer");
      if (st.phase === "row" && !st.row.revealed) {
        assert.ok(JSON.stringify(pv).indexOf(money(st.row.item.price)) < 0, "nor the price");
      }
    }
  }
});
