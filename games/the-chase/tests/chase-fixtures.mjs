/* Shared fixtures for the Chase suites: a tiny playable game, a seeded rng,
   and helpers that drive the reducer the way the host UI does. */

"use strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const Core = require("../js/chase-core.js");
export const DEFAULT_GAME = require("../js/data.js");

/** A deterministic rng: the same night every run. */
export function seeded(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The smallest file the validator accepts, with predictable questions. */
export function tinyGame(overrides) {
  const rapid = [];
  for (let i = 0; i < 90; i += 1) rapid.push({ q: `Rapid ${i + 1}?`, a: `Answer ${i + 1}` });
  const multi = [];
  for (let i = 0; i < 45; i += 1) {
    multi.push({
      q: `Multi ${i + 1}?`,
      options: [`M${i + 1}A`, `M${i + 1}B`, `M${i + 1}C`],
      answer: i % 3,
    });
  }
  return {
    title: "Tiny Chase",
    settings: Object.assign({
      currency: "$", steps: 7, startStep: 3, cashBuilderValue: 1000, cashBuilderSeconds: 60,
      higherMultiplier: 5, lowerDivisor: 2, finalSeconds: 120, chaserIsHost: true,
      headStartPerMember: 1, minHeadStart: 1, chaserName: "The Chaser",
    }, overrides || {}),
    rapid,
    multi,
  };
}

export const TEAM = [
  { pid: "p1", name: "Ada" },
  { pid: "p2", name: "Ben" },
  { pid: "p3", name: "Cleo" },
];

/** A started game: contestants seated, phase `cashBuilder`, clock not running. */
export function started(opts) {
  const o = opts || {};
  const state = Core.createState(o.game || tinyGame(o.settings), {
    contestants: o.contestants || TEAM,
    chaser: o.chaser,
    shuffle: !!o.shuffle,
    rng: o.rng,
  });
  return Core.reduce(state, { type: "start" }, 1000);
}

/** Apply a list of events in order, threading `now`. */
export function play(state, events, now) {
  let at = Number.isFinite(now) ? now : 1000;
  return events.reduce((s, ev) => {
    at += 10;
    return Core.reduce(s, ev, at);
  }, state);
}

/** Run the Cash Builder for the hot seat and stop on the offers screen. */
export function buildCash(state, correct, now) {
  const at = Number.isFinite(now) ? now : 1000;
  let s = Core.reduce(state, { type: "cbStart" }, at);
  for (let i = 0; i < correct; i += 1) {
    s = Core.reduce(s, { type: "cbMark", result: "correct" }, at + i + 1);
  }
  s = Core.reduce(s, { type: "cbExpired" }, at + 1000);
  s = Core.reduce(s, { type: "nextQuestion" }, at + 1001);   // skip the question in flight
  return Core.reduce(s, { type: "nextQuestion" }, at + 1002); // on to the offers
}

/** The index of the right option for the question on the table. */
export function rightIdx(state) {
  return state.h2h.q.answer;
}

export function wrongIdx(state) {
  return (state.h2h.q.answer + 1) % 3;
}

/**
 * One head-to-head question: both sides lock, both are revealed in show order.
 * `c` / `h` are booleans — did that side get it right?
 */
export function playH2h(state, c, h, now) {
  const at = Number.isFinite(now) ? now : 2000;
  return play(state, [
    { type: "lock", side: "contestant", idx: c ? rightIdx(state) : wrongIdx(state) },
    { type: "lock", side: "chaser", idx: h ? rightIdx(state) : wrongIdx(state) },
    { type: "revealContestant" },
    { type: "revealChaser" },
  ], at);
}
