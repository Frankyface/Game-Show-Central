/* Shared fixtures for the Match Game suites. Pure data + tiny helpers; no
   assertions live here so both suites can build the same night. */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const Core = require("../js/mg-core.js");
export const Content = require("../js/mg-content.js");
export const Select = require("../js/mg-select.js");

/** A minimal file that passes the validator: 30 prompts, 10 audience prompts. */
export function makeGame(overrides) {
  const prompts = [];
  for (let i = 1; i <= 30; i += 1) {
    prompts.push({ text: `Prompt number ${i} ends in a ___.`, hint: `hint ${i}` });
  }
  const audiencePrompts = [];
  for (let i = 1; i <= 10; i += 1) audiencePrompts.push({ text: `Audience prompt ${i}`, hint: "" });
  return Object.assign({
    title: "Test night",
    settings: {
      currency: "$", panelSize: 3, rounds: 2, pointsPerMatch: 1,
      audienceValues: [500, 250, 100], multipliers: [10, 20, 30], secondRoundRule: false,
    },
    prompts,
    audiencePrompts,
  }, overrides || {});
}

export const CONTESTANTS = [{ pid: "c1", name: "Ada" }, { pid: "c2", name: "Ben" }];

export function panelOf(n) {
  const names = ["Cleo", "Dev", "Eve", "Finn", "Gus", "Hana"];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ pid: `p${i + 1}`, name: names[i] });
  return out;
}

/** A started game with `n` panel seats. */
export function started(n, gameOverrides, opts) {
  const size = n || 3;
  const game = makeGame(gameOverrides);
  game.settings = Object.assign({}, game.settings, { panelSize: size },
    (gameOverrides || {}).settings || {});
  const state = Core.createState(game, Object.assign({
    contestants: CONTESTANTS, panel: panelOf(size),
  }, opts || {}));
  return Core.reduce(state, { type: "start" });
}

/** Apply a list of events in order. */
export function run(state, events) {
  return events.reduce((s, e) => Core.reduce(s, e), state);
}

/** Every panel seat answers, the contestant answers, then reveal + judge. */
export function playTurn(state, judgements, answers) {
  const size = state.panel.length;
  let s = state;
  for (let slot = 0; slot < size; slot += 1) {
    const text = (answers && answers[slot]) || `answer ${slot}`;
    s = Core.reduce(s, { type: "panelAnswer", slot, text });
  }
  s = Core.reduce(s, { type: "contestantAnswer", text: "guess" });
  for (let i = 0; i < s.current.order.length; i += 1) {
    s = Core.reduce(s, { type: "revealNext" });
    s = Core.reduce(s, { type: "judge", match: !!(judgements && judgements[i]) });
  }
  return s;
}
