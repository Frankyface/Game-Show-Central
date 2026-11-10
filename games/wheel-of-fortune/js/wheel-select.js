/* ============================================================
   Wheel of Fortune — host-phone selector (docs/22 §5.1, §6)
   PURE. hostView(state) is the host's private view of the
   current moment: the category and the FULL solution of the
   round in play (regular, toss-up or bonus), the puzzle laid
   out like the board with each tile marked shown / still
   hidden, the letters still hidden, whose turn it is, and the
   next round so the host can get ready. It goes only to a host
   phone (room.setHostView); contestant phoneView is untouched.

   The host is never a Wheel contestant, so nothing here is
   withheld from a role the host plays. Size: a puzzle is at
   most 52 tiles, so the view stays far under the 16 KB cap.

   Browser: globalThis.WheelSelect (load AFTER wheel-core.js).
   Node: module.exports.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./wheel-core.js")
    : root.WheelCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WheelSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const TYPE_LABEL = { regular: "Round", tossup: "Toss-up", bonus: "Bonus round" };
  const PHASE_LABEL = {
    idle: "Setup", round: "Regular round", tossup: "Toss-up",
    bonus: "Bonus round", final: "Final standings",
  };

  const isLetter = (ch) => ch >= "A" && ch <= "Z";

  /** The board rows with every letter present, each tile flagged shown/hidden. */
  function solvedRows(puzzle, revealed) {
    const rows = C.layoutPuzzle(puzzle) || [];
    const flags = Array.isArray(revealed) ? revealed : [];
    return rows.map((row) => row.map((cell) => (cell
      ? { ch: cell.ch, shown: !!flags[cell.i] || !isLetter(cell.ch) }
      : null)));
  }

  /** Distinct letters still face-down on the board, A-Z order. */
  function hiddenLetters(puzzle, revealed) {
    const out = new Set();
    const flags = Array.isArray(revealed) ? revealed : [];
    for (let i = 0; i < puzzle.length; i += 1) {
      if (isLetter(puzzle[i]) && !flags[i]) out.add(puzzle[i]);
    }
    return [...out].sort();
  }

  /** The round after the current one, solution included (host prep). */
  function nextRound(state) {
    const rounds = state.game && Array.isArray(state.game.rounds) ? state.game.rounds : [];
    const index = state.roundIndex + 1;
    const round = rounds[index];
    if (!round) return null;
    return {
      number: index + 1,
      type: round.type,
      label: TYPE_LABEL[round.type] || "Round",
      category: round.category,
      solution: round.puzzle,
    };
  }

  /** A stable id for the item in play: changes exactly when the puzzle does. */
  function hostItem(state) {
    if (!state || !state.round) return state && state.phase ? state.phase : "idle";
    return `round-${state.roundIndex + 1}`;
  }

  /**
   * The host phone's view. `secret` is true while the current solution is
   * not yet public (no confirmed solve, no Reveal all, no judged bonus).
   */
  function hostView(state) {
    const phase = state && state.phase ? state.phase : "idle";
    const base = {
      game: "wheel-of-fortune",
      item: hostItem(state),
      phase,
      phaseLabel: PHASE_LABEL[phase] || "Setup",
      secret: false,
    };
    if (!state || !state.round || phase === "idle" || phase === "final") return base;

    const round = state.round;
    const roundCount = state.game.rounds.length;
    const playing = state.players[state.turn];
    const head = {
      ...base,
      roundNumber: state.roundIndex + 1,
      roundCount,
      roundType: round.type,
      roundLabel: TYPE_LABEL[round.type] || "Round",
      category: round.category,
      next: nextRound(state),
    };
    if (state.roundDone) return { ...head, phaseLabel: "Round solved" };

    const view = {
      ...head,
      secret: true,
      solution: round.puzzle,
      rows: solvedRows(round.puzzle, state.revealed),
      hidden: hiddenLetters(round.puzzle, state.revealed),
      used: state.used.slice(),
      turn: playing ? playing.name : "",
    };
    if (phase === "round") {
      view.wedge = state.pendingSpin && state.wedge ? state.wedge.value : null;
      view.solving = state.solving ? (state.solveText || "") : null;
    } else if (phase === "tossup" && state.tossup) {
      const by = state.players.find((p) => p.pid === state.tossup.buzzed);
      view.value = round.value;
      view.buzzed = by ? by.name : null;
    } else if (phase === "bonus" && state.bonus) {
      const leader = state.players.find((p) => p.pid === state.bonus.leaderPid);
      view.turn = leader ? leader.name : view.turn;
      view.picks = state.bonus.picks.slice();
      view.prize = state.game.settings.bonusPrize;
    }
    return view;
  }

  return { hostView, hostItem, TYPE_LABEL, PHASE_LABEL };
});
