/* ============================================================
   Match Game — the host phone's private view (PURE)
   docs/22 §5.1 and the Match Game row of §6: the prompt with its
   hint, the panel's answers as they arrive (so the host can get
   the match calls ready before each card is flipped), the
   contestant's answer once it is locked in, the Super Match
   top-three board before it is revealed, and both Head-to-Head
   cards before they are turned over.

   The host plays no role in this game that must not know these
   (the host types for phone-less panelists anyway), so nothing is
   withheld. Phases with nothing secret say so. Small by design:
   at most six panel rows and three board rows, each text capped
   at 40 characters by the core, so the view stays far under the
   16 KB limit. No DOM, no clock, never mutates its input.

   Runs in the browser (globalThis.MgHostView, after
   js/mg-select.js) and in Node; MgCore re-exports `hostView`.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const select = node ? require("./mg-select.js") : root.MgSelect;
  const api = factory(select);
  if (node) module.exports = api;
  root.MgHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Select) {
  "use strict";

  const { topThree, moneyText, headToHeadBase } = Select;
  const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  const PHASE_LABELS = Object.freeze({
    setup: "Setting up",
    prompt: "The panel is writing",
    roundScores: "Round scores",
    superChoice: "Super Match",
    audience: "Audience Match — the room is answering",
    audienceBoard: "Audience Match — the board",
    hthPick: "Head-to-Head — picking a panelist",
    hthPrompt: "Head-to-Head",
    hthResult: "Super Match result",
    standings: "Standings",
  });

  function quiet(phase) {
    return {
      phase: phase || "setup",
      phaseLabel: has(PHASE_LABELS, phase) ? PHASE_LABELS[phase] : "",
      secret: false,
      item: "",
    };
  }

  /** A main-game prompt: the hint, every panel answer in, the contestant's answer. */
  function promptView(state) {
    const cur = state.current;
    const panel = state.panel.map((seat) => {
      const place = cur.order.indexOf(seat.slot);
      return {
        seat: seat.slot + 1,
        name: seat.name,
        answer: has(cur.answers, seat.slot) ? cur.answers[seat.slot] : null,
        revealed: place >= 0 && place < cur.revealed,
        judged: place >= 0 && place < cur.judged.length ? cur.judged[place] : null,
        out: place < 0,
      };
    });
    const label = state.tiebreak > 0 ? `Tiebreak ${state.tiebreak}`
      : `Round ${state.round} of ${state.game.settings.rounds}`;
    return {
      phase: "prompt",
      phaseLabel: label,
      secret: true,
      item: cur.text,
      hint: cur.hint || "",
      who: state.contestants[cur.seat].name,
      contestant: cur.guessLocked ? cur.guess : "",
      panel,
      answered: panel.filter((p) => p.answer !== null && !p.out).length,
      playing: cur.order.length,
    };
  }

  /** The Audience Match: the top three as they stand, which ones are revealed. */
  function boardView(state) {
    const aud = state.audience;
    const hits = new Set(aud.guesses.filter((g) => g.hit >= 0).map((g) => g.hit));
    const rows = topThree(state).map((row) => ({
      rank: row.rank + 1,
      text: row.text,
      count: row.count,
      value: moneyText(state, row.value),
      revealed: hits.has(row.rank),
    }));
    return {
      phase: state.phase,
      phaseLabel: PHASE_LABELS[state.phase],
      secret: rows.length > 0,
      item: aud.text,
      who: state.winner === null ? "" : state.contestants[state.winner].name,
      board: rows,
      answers: aud.submissions.length,
      guessesLeft: Math.max(0, 3 - aud.guesses.length),
      note: state.phase === "audience" ? "The board can still change until you close it." : "",
    };
  }

  /** Head-to-Head: both cards before they are turned over. */
  function hthView(state) {
    const hth = state.hth;
    return {
      phase: "hthPrompt",
      phaseLabel: PHASE_LABELS.hthPrompt,
      secret: true,
      item: hth.text,
      hint: hth.hint || "",
      who: state.winner === null ? "" : state.contestants[state.winner].name,
      panelist: state.panel[hth.slot] ? state.panel[hth.slot].name : "",
      panelText: hth.panelText || "",
      contestantText: hth.contestantText || "",
      revealed: !!hth.revealed,
      stake: `${moneyText(state, hth.base === undefined ? headToHeadBase(state) : hth.base)} × ${hth.multiplier}`,
    };
  }

  /**
   * What the host's private phone shows right now. Pure and deterministic.
   * @param {object|null} state
   */
  function hostView(state) {
    if (!state || !state.game || !Array.isArray(state.panel)) return quiet("setup");
    if (state.phase === "prompt" && state.current) return promptView(state);
    if ((state.phase === "audience" || state.phase === "audienceBoard") && state.audience) {
      return boardView(state);
    }
    if (state.phase === "hthPrompt" && state.hth) return hthView(state);
    return quiet(state.phase);
  }

  return { hostView, PHASE_LABELS };
});
