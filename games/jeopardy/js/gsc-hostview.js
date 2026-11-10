/* ============================================================
   Jeopardy — the host-phone view (docs/22 §5.1, §6 Jeopardy row)

   PURE: `build(state)` turns Jeopardy's app state into the plain object
   the host's phone shows. No DOM, no globals, no clock, no mutation;
   same input → same output. Runs in Node (unit tests) and the browser
   (js/gsc-embed.js calls it from GscEmbed.onStateChanged and hands the
   result to room.setHostView with a `seq`).

   What it contains, phase by phase:
     · a clue is open   → category, value, clue, the correct response,
                          image flags, and Daily Double context;
     · Final Jeopardy   → category, clue, the correct response, the stage;
     · board / setup / standings → nothing secret, just the phase.
   Images never ride the view (a phone payload is capped); the phone gets
   `hasImage` / `hasAnswerImage` flags instead (review F8.4).
   Every string is capped so the view stays far under the 16 KB rule.

   UMD like js/timer-core.js: window.JeopardyHostView in the browser,
   module.exports in Node.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JeopardyHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TEXT_MAX = 1200; // a clue or response longer than this is truncated
  const NAME_MAX = 80;

  const PHASE_LABEL = {
    setup: "Start screen",
    board: "Board",
    final: "Final Jeopardy",
    standings: "Final standings",
  };

  function text(value, max) {
    if (typeof value !== "string") return "";
    const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
  }

  /** "$1,200" / "-$50" — the board's own money format. */
  function money(n) {
    const v = Number.isFinite(n) ? n : 0;
    const abs = Math.abs(v).toLocaleString("en-US");
    return v < 0 ? `-$${abs}` : `$${abs}`;
  }

  function quiet(phase) {
    return {
      t: "host",
      kind: "quiet",
      item: PHASE_LABEL[phase] || "Jeopardy",
      phase: PHASE_LABEL[phase] || "Jeopardy",
      secret: false,
    };
  }

  function playerName(state, id) {
    const list = Array.isArray(state.players) ? state.players : [];
    const p = list.find((x) => x && x.id === id);
    return p ? text(p.name, NAME_MAX) : "";
  }

  function clueView(state) {
    const a = state.active;
    const cats = state.game && Array.isArray(state.game.categories) ? state.game.categories : [];
    const cat = cats[a.cat];
    const clue = cat && Array.isArray(cat.clues) ? cat.clues[a.row] : null;
    if (!cat || !clue) return quiet("board");
    const category = text(cat.name, NAME_MAX);
    const view = {
      t: "host",
      kind: "clue",
      item: `${category} · ${money(clue.value)}`,
      secret: true,
      category,
      value: money(clue.value),
      clue: text(clue.clue, TEXT_MAX),
      answer: text(clue.answer, TEXT_MAX),
      hasImage: typeof clue.image === "string" && clue.image.length > 0,
      hasAnswerImage: typeof clue.answerImage === "string" && clue.answerImage.length > 0,
      revealed: a.revealed === true,
      dailyDouble: null,
    };
    if (a.isDailyDouble) {
      view.item = `Daily Double · ${category}`;
      view.dailyDouble = {
        wagerLocked: a.wagerLocked === true,
        wager: a.wagerLocked ? money(a.wager) : "",
        player: a.wagerLocked ? playerName(state, a.wagerPlayerId) : "",
      };
    }
    return view;
  }

  function finalView(state) {
    const fj = state.game && state.game.finalJeopardy;
    const stage = state.final && state.final.stage;
    if (!fj || stage === "standings") return quiet(stage === "standings" ? "standings" : "final");
    return {
      t: "host",
      kind: "final",
      item: "Final Jeopardy",
      secret: true,
      stage: typeof stage === "string" ? stage : "",
      category: text(fj.category, NAME_MAX),
      clue: text(fj.clue, TEXT_MAX),
      answer: text(fj.answer, TEXT_MAX),
      hasImage: typeof fj.image === "string" && fj.image.length > 0,
    };
  }

  /**
   * @param {object} state Jeopardy's app state (app.js `state`).
   * @returns {object} the host view, without `seq` (the caller numbers it).
   */
  function build(state) {
    if (!state || typeof state !== "object") return quiet("setup");
    if (state.final) return finalView(state);
    if (state.active) return clueView(state);
    return quiet(state.phase === "board" ? "board" : "setup");
  }

  return { build, money, TEXT_MAX };
});
