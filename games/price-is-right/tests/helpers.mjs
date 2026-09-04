/* ============================================================
   The Price Is Right — shared test fixtures
   Imported by tests/tpir-core.test.mjs (P-U1 … P-U5) and
   tests/tpir-show.test.mjs (P-U6 … P-U10). The two suites are
   split only to keep every file under the 800-line house limit.
   ============================================================ */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const Core = require("../js/tpir-core.js");
export const DEFAULT_GAME = require("../js/data.js");
export const SHIPPED = JSON.parse(readFileSync(new URL("../prizes.json", import.meta.url), "utf8"));

/* ============ Fixtures ============ */

/** A deterministic rng: cycles through the values it is given. */
export function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

export const fixed = (v) => () => v;

export const PLAYERS = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
  { pid: "p4", name: "Dev" },
];

/** A fresh, mutable copy of the shipped prize file. */
export const mk = () => JSON.parse(JSON.stringify(SHIPPED));

/** A tiny hand-built file with predictable prices. */
export function tiny(overrides) {
  const game = {
    title: "Tiny",
    settings: { exactBidBonus: 500, showcaseMargin: 250, gamesPerShowdown: 3, wheelDollarBonus: 1000 },
    oneBid: [
      { name: "Item A", price: 400 }, { name: "Item B", price: 250 },
      { name: "Item C", price: 900 }, { name: "Item D", price: 120 },
      { name: "Item E", price: 60 }, { name: "Item F", price: 777 },
    ],
    cliffhangers: [{
      items: [{ name: "One", price: 10 }, { name: "Two", price: 20 }, { name: "Three", price: 30 }],
      prize: { name: "Trip", price: 5000 },
    }],
    plinko: [{
      smallPrices: [
        { name: "P1", shown: 3, actual: 4 }, { name: "P2", shown: 5, actual: 5 },
        { name: "P3", shown: 8, actual: 6 }, { name: "P4", shown: 2, actual: 2 },
      ],
    }],
    luckyseven: [{ car: "Car", price: 24680 }],
    showcases: [
      { prizes: [{ name: "S1a", price: 3000 }, { name: "S1b", price: 5000 }] },
      { prizes: [{ name: "S2a", price: 2000 }, { name: "S2b", price: 4000 }] },
    ],
  };
  return Object.assign(game, overrides || {});
}

/** Start a state and run `start`, so `phase` is already "row". */
export function started(game, players, rng) {
  const s = Core.createState(game || tiny(), players || PLAYERS);
  return Core.reduce(s, { type: "start" }, rng || fixed(0));
}

/** Apply a list of events in order. */
export function run(state, events, rng) {
  return events.reduce((s, e) => Core.reduce(s, e, rng || fixed(0)), state);
}

/** Bid, reveal, and step into the pricing game with `kind`. */
export function toGame(kind, rng) {
  const s = started(tiny(), PLAYERS, rng || fixed(0));
  const bid = s.row.seats.map((pid, i) => ({ type: "bid", pid, amount: 100 + i * 50 }));
  const after = run(s, bid.concat([{ type: "revealBids" }, { type: "nextSegment" }]), rng || fixed(0));
  return Core.reduce(after, { type: "pickGame", kind }, rng || fixed(0));
}

export function deepFreeze(value, seen) {
  const marks = seen || new Set();
  if (!value || typeof value !== "object" || marks.has(value)) return value;
  marks.add(value);
  Object.freeze(value);
  Object.keys(value).forEach((k) => deepFreeze(value[k], marks));
  return value;
}
/** Play a whole episode's worth of rows and games so the showdown has spinners. */
export function toShowdown(rng) {
  const g = tiny();
  g.settings.gamesPerShowdown = 2;
  let s = started(g, PLAYERS, rng || fixed(0));
  for (let i = 0; i < 2; i += 1) {
    const pid = s.row.seats[i];
    s = run(s, [{ type: "bid", pid, amount: 1 }, { type: "revealBids" }, { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" }], rng || fixed(0));
  }
  return s;
}


/** Push a state straight to the showcase segment. */
export function toShowcase(rng) {
  const g = tiny();
  g.settings.gamesPerShowdown = 1;
  let s = started(g, PLAYERS, rng || fixed(0));
  for (let i = 0; i < 2; i += 1) {
    const pid = s.row.seats[i];
    s = run(s, [{ type: "bid", pid, amount: 1 }, { type: "revealBids" }, { type: "nextSegment" },
      { type: "pickGame", kind: "cliffhangers" },
      { type: "chGuess", amount: 10 }, { type: "chGuess", amount: 20 }, { type: "chGuess", amount: 30 },
      { type: "nextSegment" }, { type: "spin" }, { type: "stay" }, { type: "nextSegment" }], rng || fixed(0));
  }
  return s;
}


