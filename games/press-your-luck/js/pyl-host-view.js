/* ============================================================
   Press Your Luck — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows.
   Question round: the question, its three options with the right
   one marked, who buzzed, and the next question with its answer.
   Big Board: nothing secret — whose turn it is and the spins, and
   never a square (the landing square does not exist until STOP is
   pressed, so there is nothing to show even in principle).

   The host never plays a role in Press Your Luck, so nothing here
   has to be withheld from the host — and nothing here is ever sent
   to a contestant: the room glue hands it to room.setHostView only.
   Contestant phoneView is untouched.

   No DOM, no timers; runs in Node and the browser. Never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./pyl-core.js")
    : root.PylCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PylHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Pyl) {
  "use strict";

  const LETTERS = ["A", "B", "C"];

  /** One question as the host phone shows it: text, options, the answer. */
  function questionCard(question) {
    if (!question) return null;
    const answer = Number.isInteger(question.answer) ? question.answer : null;
    return {
      q: question.q,
      options: question.options.slice(),
      correct: answer,
      letter: answer === null ? "" : LETTERS[answer],
      answer: answer === null ? "" : question.options[answer],
    };
  }

  /** The question after the one on the table: later in this round, else round two's first. */
  function nextQuestion(state) {
    const order = Array.isArray(state.order) ? state.order : [];
    const here = order[state.round] || [];
    let index = null;
    if (state.qIndex + 1 < Math.min(here.length, state.game.settings.questionsPerRound)) {
      index = here[state.qIndex + 1];
    } else if (state.round + 1 < state.game.settings.rounds && (order[state.round + 1] || []).length) {
      index = order[state.round + 1][0];
    }
    return Number.isInteger(index) ? questionCard(state.game.questions[index]) : null;
  }

  /**
   * A stable key for "the thing on the table right now". It changes exactly
   * when a new question is asked or the phase moves on — what the shared
   * screen's one-shot "Show answer on this screen" clears on.
   * @returns {string}
   */
  function itemKey(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") return "setup";
    if (state.phase === "question") return `q:${state.round}:${state.qIndex}`;
    return `${state.phase}:${state.round}`;
  }

  function phaseLabel(state) {
    const s = state.game.settings;
    if (state.phase === "question") {
      return `Round ${state.round + 1} · Question ${state.qIndex + 1} of ${s.questionsPerRound}`;
    }
    if (state.phase === "board") return `Round ${state.round + 1} · the Big Board`;
    if (state.phase === "roundDone") return `Round ${state.round + 1} is over`;
    if (state.phase === "result") return "Final standings";
    return "Game";
  }

  function questionView(state) {
    const card = questionCard(Pyl.currentQuestion(state));
    const buzzed = state.q && state.q.buzzed !== null ? Pyl.nameOf(state, state.q.buzzed) : "";
    return {
      item: card ? card.q : "",
      options: card ? card.options : [],
      correct: card ? card.correct : null,
      letter: card ? card.letter : "",
      answer: card ? card.answer : "",
      who: buzzed ? `${buzzed} buzzed in` : "",
      revealed: !!(state.q && state.q.revealed),
      next: nextQuestion(state),
    };
  }

  /** The Big Board: whose turn and the spins. Deliberately no squares. */
  function boardView(state) {
    const seat = state.control;
    const turn = seat === null || seat === undefined ? "" : Pyl.nameOf(state, seat);
    return {
      item: turn ? `${turn} is on the board` : "",
      who: turn,
      spins: turn ? Pyl.spinsLeft(state, seat) : 0,
      passed: turn ? state.passed[seat] || 0 : 0,
    };
  }

  /**
   * The host phone's view of `state` (docs/22 §6, Press Your Luck row).
   * @param {object|null} state the core state, or null on the setup screen
   */
  function hostView(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") {
      return { phase: "setup", phaseLabel: "Setup", secret: false, item: "" };
    }
    const base = { phase: state.phase, phaseLabel: phaseLabel(state) };
    if (state.phase === "question") return Object.assign(base, { secret: true }, questionView(state));
    if (state.phase === "board") return Object.assign(base, { secret: false }, boardView(state));
    return Object.assign(base, { secret: false, item: "" });
  }

  /** The answer the shared screen must not show before its reveal, or "". */
  function currentAnswer(state) {
    if (!state || state.phase !== "question" || !state.q || state.q.revealed) return "";
    const card = questionCard(Pyl.currentQuestion(state));
    return card ? `${card.letter} — ${card.answer}` : "";
  }

  return { hostView, itemKey, currentAnswer, LETTERS };
});
