/* ============================================================
   Family Feud — host-phone selectors (PURE, docs/22 §5.1 + §6)
   What the host's private second screen shows, and what the shared
   screen may show while answers are private. No DOM, no transport,
   no app globals — the only side effect is attaching the export.
   Runs in the browser (globalThis.FeudSelect) and in Node
   (module.exports) so node:test can exercise it.

   Family Feud's host plays no contestant role, so the host view
   carries the whole current survey: tile numbers, answers, counts
   and which are revealed; strikes, bank and control; and in Fast
   Money the five questions with numbered answers and counts plus
   what has been picked on each sheet.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./feud-core.js")
    : root.FeudCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FeudSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const BOARD_PHASES = ["faceoff", "playpass", "play", "steal", "roundover"];
  const PHASE_TEXT = {
    setup: "Setting up",
    faceoff: "Face-off",
    playpass: "Play or pass",
    play: "Board in play",
    steal: "Steal",
    roundover: "Round over",
    fastmoney: "Fast Money",
    final: "Final standings",
  };

  /**
   * The current "item": the unit a fallback reveal belongs to and the label
   * the host phone shows beside the answers. A new round or a new Fast Money
   * player is a new item.
   */
  function itemOf(state) {
    if (!state || !state.game) return "";
    if (BOARD_PHASES.indexOf(state.phase) !== -1) {
      return `Round ${state.roundIndex + 1} of ${state.roundsToPlay}`;
    }
    if (state.phase === "fastmoney") return `Fast Money · player ${state.fastMoney.slot}`;
    return "";
  }

  function surveyView(state) {
    const round = Core.currentRound(state);
    const next = state.roundIndex + 1 < state.roundsToPlay ? state.game.rounds[state.roundIndex + 1] : null;
    return {
      question: round.question,
      answers: Core.boardView(state).map((t) => ({
        n: t.number, text: t.text, count: t.count, revealed: t.revealed,
      })),
      strikes: state.strikes,
      strikeLimit: state.game.settings.strikes,
      bank: state.bank,
      multiplier: Core.multiplierFor(state),
      control: state.control === null ? null : state.teams[state.control].name,
      stealing: state.phase === "steal" && state.steal.team !== null
        ? state.teams[state.steal.team].name : null,
      // The next survey's question only: no answers until it is the item.
      nextQuestion: state.phase === "roundover" && next ? next.question : null,
    };
  }

  function fastMoneyView(state) {
    const fm = state.fastMoney;
    const pick = (row) => ({
      n: row.revealed && row.answerIndex !== null ? row.answerIndex + 1 : null,
      revealed: !!row.revealed,
      duplicate: !!row.duplicate,
    });
    return {
      slot: fm.slot,
      stage: fm.stage,
      total: Core.fmTotal(state),
      target: state.game.settings.fastMoney.target,
      questions: Core.fmQuestions(state).map((q, i) => ({
        n: i + 1,
        question: q.question,
        answers: q.answers.map((a, j) => ({ n: j + 1, text: a.text, count: a.count })),
        picks: { 1: pick(fm.rows[1][i]), 2: pick(fm.rows[2][i]) },
      })),
    };
  }

  /**
   * Everything the host phone shows for this moment. Pure and deterministic.
   * `kind` is "survey", "fastmoney" or "none" (setup and standings: nothing
   * secret). Content is capped by the validator (≤ 8 answers of ≤ 40 chars,
   * ≤ 200-char questions), so the view stays far below 16 KB.
   * @returns {object}
   */
  function hostView(state) {
    const base = {
      game: "Family Feud",
      phase: state.phase,
      phaseText: PHASE_TEXT[state.phase] || "",
      item: itemOf(state),
      scores: state.teams.map((t) => ({ name: t.name, score: t.score })),
    };
    if (BOARD_PHASES.indexOf(state.phase) !== -1) return { ...base, kind: "survey", survey: surveyView(state) };
    if (state.phase === "fastmoney") return { ...base, kind: "fastmoney", fastMoney: fastMoneyView(state) };
    return { ...base, kind: "none" };
  }

  /**
   * The Fast Money "which board answer did they give?" picker (review F10).
   * While answers are private and the fallback is not in force, the options
   * are numbers only — the host phone lists the same numbers with the text.
   * @param {{answers:Array<{text:string,count:number}>}} question
   * @param {boolean} hideText
   * @returns {Array<{value:string,label:string}>}
   */
  function fmPickOptions(question, hideText) {
    const out = [{ value: "", label: hideText ? "Pick the answer number…" : "Pick the board answer…" }];
    question.answers.forEach((a, i) => {
      out.push({ value: String(i), label: hideText ? `Answer ${i + 1}` : `${a.text} — ${a.count}` });
    });
    out.push({ value: "none", label: "No match → 0" });
    return out;
  }

  return { hostView, itemOf, fmPickOptions, BOARD_PHASES };
});
