/* ============================================================
   Pyramid — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows:
   in a category, its plain theme (the giver-only hint) and all the
   words with how each one went, the current one marked; in the
   Winner's Circle, the six subjects with their values and status,
   the current one marked. Every other phase — setup, the board,
   the end of the main game, a finished round (its words are now
   public on the shared screen), the result — says "nothing secret".

   The host never plays a role here that must not know the words:
   in host-as-giver mode the host IS the giver. Nothing in this view
   ever goes to a contestant: the room glue hands it to
   room.setHostView only, and phoneView is untouched.

   The shipped content has no example lists for Winner's Circle
   subjects, so a subject is shown with its value and status alone.

   No DOM, no timers; runs in Node and the browser. Never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./pyr-core.js")
    : root.PyrCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PyrHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const PHASE_LABEL = {
    setup: "Setup",
    board: "Pyramid board",
    play: "Category",
    mainResult: "End of the main game",
    circle: "Winner’s Circle",
    result: "Result",
    standings: "Standings",
  };

  /** A word is live when it can still come round: pending or passed. */
  const LIVE = new Set(["pending", "passed"]);

  function teamName(state, team) {
    const t = state.teams && state.teams[team];
    return t ? t.name : "";
  }

  /**
   * A short label for what the view answers, shown beside it on the phone.
   * It changes exactly when the shared screen's "current item" changes, so the
   * per-item fallback button clears on the next word or subject.
   */
  function itemKey(state) {
    if (!state) return "setup";
    if (state.phase === "play" && state.round && !state.round.finished) {
      const r = state.round;
      const settled = r.words.filter((w) => w.status !== "pending").length;
      const where = r.tiebreak ? `tiebreak ${r.team}` : r.title;
      return `${where} · word ${r.cursor + 1} of ${r.words.length} · ${settled}`;
    }
    if (state.phase === "circle" && state.circle && !state.circle.finished) {
      const c = state.circle;
      const settled = c.boxes.filter((b) => b.status !== "pending").length;
      return `Winner’s Circle · box ${c.cursor + 1} of ${c.boxes.length} · ${settled}`;
    }
    return PHASE_LABEL[state.phase] || "Pyramid";
  }

  /** The secret the shared screen's fallback button may reveal: one word or one subject. */
  function currentAnswer(state) {
    if (!state) return "";
    if (state.phase === "play" && state.round && !state.round.finished) {
      return Core.currentWord(state) || "";
    }
    if (state.phase === "circle" && state.circle && !state.circle.finished) {
      const box = state.circle.boxes[state.circle.cursor];
      return box ? box.category : "";
    }
    return "";
  }

  function roundView(state) {
    const r = state.round;
    return {
      title: r.title,
      hint: r.hint || "",
      tiebreak: !!r.tiebreak,
      team: teamName(state, r.team),
      giver: r.giverName,
      guesser: r.guesserName,
      current: Core.currentWord(state),
      words: r.words.map((w, i) => ({
        text: w.text,
        status: w.status,
        current: i === r.cursor,
      })),
      done: Core.wordCount(state).done,
      left: r.words.filter((w) => LIVE.has(w.status)).length,
      expired: !!r.expired,
    };
  }

  function circleView(state) {
    const c = state.circle;
    const box = c.boxes[c.cursor];
    return {
      team: teamName(state, c.team),
      giver: c.giverName,
      guesser: c.guesserName,
      current: box ? box.category : "",
      currentValue: box ? Core.formatMoney(state, box.value) : "",
      boxes: c.boxes.map((b, i) => ({
        category: b.category,
        value: Core.formatMoney(state, b.value),
        status: b.status,
        current: i === c.cursor,
      })),
      winnings: Core.formatMoney(state, Core.circleWinnings(state)),
      expired: !!c.expired,
    };
  }

  /**
   * The host's private view of `state`. Plain data, a few hundred bytes —
   * seven words or six subjects — so it never approaches the 16 KB cap.
   */
  function hostView(state) {
    if (!state || !state.phase) {
      return { secret: false, phase: "setup", phaseLabel: PHASE_LABEL.setup };
    }
    const base = { phase: state.phase, phaseLabel: PHASE_LABEL[state.phase] || "" };
    if (state.phase === "play" && state.round && !state.round.finished) {
      return Object.assign(base, { secret: true, kind: "round", round: roundView(state) });
    }
    if (state.phase === "circle" && state.circle && !state.circle.finished) {
      return Object.assign(base, { secret: true, kind: "circle", circle: circleView(state) });
    }
    return Object.assign(base, { secret: false });
  }

  return { hostView, itemKey, currentAnswer, PHASE_LABEL };
});
