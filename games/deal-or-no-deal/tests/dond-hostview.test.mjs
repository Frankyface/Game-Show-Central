/* ============================================================
   Deal or No Deal — the host phone's view (docs/22 §5.1, §5.5, §6)
   hostView holds the banker's next offer and how it is computed at
   every phase that has one, nothing in phases with no secret, never
   the contents of a sealed case, and leaves phoneView untouched.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/dond-core.js");
const Content = require("../js/dond-content.js");
const { hostView } = require("../js/dond-host-view.js");

const PLAYERS = [{ pid: "p1", name: "Ada" }, { pid: "p2", name: "Ben" }];
// Amounts that are never multiples of 100, so no offer can collide with one.
const SMALL = {
  title: "Ten cases",
  settings: {
    currency: "$",
    amounts: [101, 203, 307, 401, 503, 601, 701, 809, 907, 1009],
    rounds: [4, 2, 1, 1],
    offerFactors: [0.2, 0.4, 0.7, 1.0],
    jitter: 0.05, allowSwap: true, audienceAdvice: true,
  },
};
const fixed = (v) => () => v;
const play = (s, events, rng = fixed(0.5)) => events.reduce((x, e) => Core.reduce(x, e, rng), s);
const fresh = () => Core.createState(SMALL, PLAYERS, {});
const seated = () => play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }, { type: "pickCase", n: 1 }]);
function openAll(s) {
  let x = s;
  while (x.toOpen > 0) x = Core.reduce(x, { type: "openCase", n: Core.otherCases(x)[0].n });
  return x;
}

/** Every number and string in a value (keys included). */
function collect(value, out = { numbers: [], strings: [] }) {
  if (typeof value === "number") out.numbers.push(value);
  else if (typeof value === "string") out.strings.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") Object.keys(value).forEach((k) => { out.strings.push(k); collect(value[k], out); });
  return out;
}

test("host view: nothing secret before a board is dealt, after it is decided, and at the end", () => {
  const states = {
    setup: fresh(),
    seat: play(fresh(), [{ type: "start" }]),
  };
  let s = Core.reduce(openAll(seated()), { type: "bankerOffer" }, fixed(0.5));
  states.reveal = Core.reduce(s, { type: "deal" });
  states.result = Core.reduce(states.reveal, { type: "revealOwn" });
  states.standings = Core.reduce(states.result, { type: "finish" });
  Object.entries(states).forEach(([name, st]) => {
    const v = hostView(st);
    assert.equal(v.secret, false, `${name} has no secret`);
    assert.equal(v.offer, undefined, `${name} carries no offer`);
    assert.equal(v.phase, st.phase);
  });
  assert.equal(hostView(null).secret, false, "no game at all is not an error");
});

test("host view: during a round it projects the offer the banker would make now", () => {
  const s = Core.reduce(seated(), { type: "openCase", n: 2 });
  const v = hostView(s);
  const ev = Core.ev(s);
  assert.equal(v.secret, true);
  assert.equal(v.item, "If the banker called now");
  assert.equal(v.offer, Core.formatMoney(s, Content.niceOffer(ev * 0.2)), "jitter-free midpoint");
  const low = Content.niceOffer(ev * 0.2 * 0.95);
  const high = Content.niceOffer(ev * 0.2 * 1.05);
  // A narrow band can round to one number; then there is no range to show.
  assert.equal(v.range, low === high ? "" : `${Core.formatMoney(s, low)} – ${Core.formatMoney(s, high)}`);
  assert.equal(v.factor, 0.2);
  assert.equal(v.round, 1);
  assert.match(v.rule, /Round 1 of 4 · factor 0\.20 · jitter ±5%/);
  assert.equal(v.announced, false);
  assert.equal(v.left.count, 9, "nine amounts still sealed, own case included");
  assert.match(v.note, /3 more cases/);
});

test("host view: once the round is over it is the offer the banker is about to make", () => {
  const ready = openAll(seated());
  const v = hostView(ready);
  assert.equal(v.item, "The banker's next offer");
  // The announced offer always lands inside the band the host phone shows.
  [0, 0.25, 0.5, 0.75, 1].forEach((r) => {
    const offered = Core.reduce(ready, { type: "bankerOffer" }, fixed(r)).offer;
    const low = Content.niceOffer(Core.ev(ready) * 0.2 * 0.95);
    const high = Content.niceOffer(Core.ev(ready) * 0.2 * 1.05);
    assert.ok(offered >= low && offered <= high, `offer ${offered} outside ${low}-${high}`);
  });
  assert.equal(Core.reduce(ready, { type: "bankerOffer" }, fixed(0.5)).offer,
    Content.niceOffer(Core.ev(ready) * 0.2), "with no jitter the projection IS the offer");
});

test("host view: on the table it shows the actual offer against the board average", () => {
  const s = Core.reduce(openAll(seated()), { type: "bankerOffer" }, fixed(1));
  const v = hostView(s);
  assert.equal(v.item, "The banker's offer");
  assert.equal(v.offer, Core.formatMoney(s, s.offer));
  assert.equal(v.announced, true);
  assert.equal(v.range, undefined);
  assert.match(v.note, /% of the board average/);
});

test("host view: never reveals which amount is in which case — not even the contestant's", () => {
  let s = seated();
  const views = [hostView(play(fresh(), [{ type: "start" }, { type: "seat", pid: "p1" }]))];
  for (let r = 0; r < SMALL.settings.rounds.length; r += 1) {
    s = Core.reduce(s, { type: "openCase", n: Core.otherCases(s)[0].n });
    views.push(hostView(s));
    s = openAll(s);
    views.push(hostView(s));
    s = Core.reduce(s, { type: "bankerOffer" }, fixed(0.5));
    views.push(hostView(s));
    s = Core.reduce(s, { type: "noDeal" });
  }
  views.forEach((v, i) => {
    const json = JSON.stringify(v);
    assert.equal(json.indexOf("\"amount\""), -1, `view ${i} has a raw amount field`);
    assert.equal(json.indexOf("\"own\""), -1, `view ${i} names the own case`);
    assert.equal(json.indexOf("\"cases\""), -1, `view ${i} carries the case grid`);
    const { numbers } = collect(v);
    SMALL.settings.amounts.forEach((a) => assert.ok(!numbers.includes(a), `view ${i} carries the number ${a}`));
    assert.ok(json.length < 16384, "well under the 16 KB cap");
  });
});

test("host view: the amounts still in play are the public board, sorted and truncated", () => {
  const v = hostView(Core.reduce(seated(), { type: "openCase", n: 2 }));
  const sealed = Core.remainingAmounts(Core.reduce(seated(), { type: "openCase", n: 2 })).slice().sort((a, b) => a - b);
  assert.deepEqual(v.left.amounts, sealed.map((a) => `$${a}`));
  assert.equal(v.left.more, 0);
  const big = Core.createState({ title: "Thirty", settings: { amounts: Array.from({ length: 30 }, (_, i) => (i + 1) * 7), rounds: [6] } }, PLAYERS, {});
  const s = play(big, [{ type: "start" }, { type: "seat", pid: "p1" }]);
  assert.equal(hostView(s).left.amounts.length, 30);
  assert.equal(hostView(s).left.more, 0);
});

test("host view is pure, and phoneView is unchanged by it", () => {
  const s = Core.reduce(seated(), { type: "openCase", n: 2 });
  const before = JSON.stringify(s);
  const phones = ["p1", "p2"].map((pid) => JSON.stringify(Core.phoneView(s, pid)));
  assert.deepEqual(hostView(s), hostView(s), "deterministic");
  hostView(s);
  assert.equal(JSON.stringify(s), before, "the state is not touched");
  assert.deepEqual(["p1", "p2"].map((pid) => JSON.stringify(Core.phoneView(s, pid))), phones);
  assert.equal(Core.phoneView(s, "p1").screen, "pick");
  assert.equal(JSON.stringify(Core.phoneView(s, "p2")).indexOf("factor"), -1, "no banker maths on a contestant phone");
});
