/* ============================================================
   Weakest Link — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows:
   the player on turn, their question AND its answer, and the next
   two questions with answers; in the head-to-head, both players'
   upcoming questions. Phases with nothing private (setup, voting,
   result) say so instead.

   The host never plays a role in this game, so nothing here has to
   be withheld from the host — but nothing here is ever sent to a
   contestant either: the room glue hands it to room.setHostView
   only. Contestant phoneView is untouched.

   No DOM, no timers; runs in Node and the browser. Never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./wl-core.js")
    : root.WlCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WlHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (WL) {
  "use strict";

  const NEXT_COUNT = 2;          // "the next two questions" (§6)
  const SECRET_PHASES = new Set(["round", "finalIntro", "final", "suddenDeath"]);

  const PHASE_LABEL = {
    setup: "Setup",
    round: "Round",
    voting: "Voting",
    voteResult: "Voting",
    tiebreak: "Tie-break",
    goodbye: "Voting",
    finalIntro: "Head-to-head",
    final: "Head-to-head",
    suddenDeath: "Sudden death",
    result: "Result",
  };

  /** The question `offset` places after the one on the table (the pool wraps). */
  function questionAt(state, offset) {
    if (!state.game || !Array.isArray(state.order) || state.order.length === 0) return null;
    const idx = state.order[(state.qIndex + offset) % state.order.length];
    const row = state.game.questions[idx];
    if (!row) return null;
    return { q: row.q, a: row.a, category: row.category || "" };
  }

  /** The other finalist. */
  function otherFinalist(state, pid) {
    const pids = state.final && Array.isArray(state.final.pids) ? state.final.pids : [];
    return pids[0] === pid ? pids[1] : pids[0];
  }

  /**
   * A stable key for "the thing on the table right now". It changes exactly
   * when a new question is asked or the phase moves on, which is what the
   * shared screen's one-shot "Show answer on this screen" clears on.
   * @returns {string}
   */
  function itemKey(state) {
    if (!state || !state.game) return "setup";
    return [state.phase, state.roundIndex, state.qIndex, state.repeating ? 1 : 0].join(":");
  }

  function phaseLabel(state) {
    const label = PHASE_LABEL[state.phase] || "Game";
    return state.phase === "round" ? `${label} ${state.roundIndex + 1}` : label;
  }

  /** Round play: the player on turn, their question, the next two. */
  function roundView(state) {
    const next = [];
    for (let i = 1; i <= NEXT_COUNT; i += 1) {
      const q = questionAt(state, i);
      if (q) next.push(q);
    }
    return {
      current: Object.assign({ player: WL.playerName(state, state.turnPid) }, questionAt(state, 0)),
      next,
      expired: !!state.expired,
    };
  }

  /** Head-to-head: on turn now, then the other finalist, then back again. */
  function finalView(state) {
    const now = state.turnPid;
    const other = otherFinalist(state, now);
    return {
      current: Object.assign({ player: WL.playerName(state, now) }, questionAt(state, 0)),
      next: [
        Object.assign({ player: WL.playerName(state, other) }, questionAt(state, 1)),
        Object.assign({ player: WL.playerName(state, now) }, questionAt(state, 2)),
      ].filter((row) => row.q),
    };
  }

  /** Before the first-player choice: the two questions that open the final. */
  function finalIntroView(state) {
    const next = [questionAt(state, 0), questionAt(state, 1)].filter(Boolean);
    return { current: null, next, note: "The first two head-to-head questions." };
  }

  /**
   * The host phone's view of `state` (docs/22 §6, Weakest Link row).
   * @param {object|null} state the core state, or null on the setup screen
   * @returns {{phase:string, phaseLabel:string, secret:boolean,
   *            current?:object|null, next?:object[], expired?:boolean, note?:string}}
   */
  function hostView(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") {
      return { phase: "setup", phaseLabel: "Setup", secret: false };
    }
    const base = { phase: state.phase, phaseLabel: phaseLabel(state), secret: SECRET_PHASES.has(state.phase) };
    if (!base.secret) return base;
    if (state.phase === "round") return Object.assign(base, roundView(state));
    if (state.phase === "finalIntro") return Object.assign(base, finalIntroView(state));
    return Object.assign(base, finalView(state));
  }

  /** The answer the shared screen must not show, or "" when there is none. */
  function currentAnswer(state) {
    const view = hostView(state);
    return view.current && view.current.a ? view.current.a : "";
  }

  return { hostView, itemKey, currentAnswer, NEXT_COUNT };
});
