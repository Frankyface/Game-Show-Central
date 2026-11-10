/* ============================================================
   Millionaire — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows:
     • the hot seat: the question, the four options with the correct
       one marked, the money at stake, what a wrong answer pays (the
       last safe haven reached), what walking away pays, and — once
       50:50 has been used — the two options left;
     • Fastest Finger: the question and the correct order.
   Phases with nothing private (setup, choosing the hot seat, result,
   standings) say so instead. Millionaire has no head-to-head.

   The host never plays a role in this game, so nothing has to be
   withheld from the host. Nothing here ever reaches a contestant:
   the room glue hands it to room.setHostView only, and phoneView is
   untouched. No DOM, no timers; runs in Node and the browser and
   never mutates its argument.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./wwm-core.js")
    : root.WwmCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WwmHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const LETTERS = ["A", "B", "C", "D"];
  const TEXT_MAX = 240;   // every string is capped, so the view stays far below 16 KB

  const PHASE_LABEL = {
    setup: "Setup",
    fff: "Fastest Finger First",
    pick: "Choosing the hot seat",
    hotseat: "Hot seat",
    result: "Result",
    standings: "Standings",
  };

  const cap = (s) => String(s === undefined || s === null ? "" : s).slice(0, TEXT_MAX);
  const money = (state, n) => C.formatMoney(state, n);

  /** Which secret, if any, is on the table right now. */
  function kindOf(state) {
    if (!state || !state.game) return "none";
    if (state.phase === "hotseat" && state.question) return "question";
    if (state.phase === "fff" && state.fff && state.fff.question) return "fff";
    return "none";
  }

  /**
   * A stable key for "the current item": the shared screen's fallback reveal
   * clears when it changes. Not shown to anyone.
   */
  function itemKey(state) {
    const kind = kindOf(state);
    if (kind === "question") return `q:${state.current}:${state.rung}:${state.question.id}`;
    if (kind === "fff") return `fff:${state.fff.question.id}:${state.fff.openedAt}`;
    return `phase:${state ? state.phase : "none"}`;
  }

  /** The human-readable item the host phone shows beside the answer. */
  function item(state) {
    const kind = kindOf(state);
    if (kind === "question") return cap(state.question.q);
    if (kind === "fff") return cap(state.fff.question.q);
    return PHASE_LABEL[state && state.phase] || "Setup";
  }

  function questionPart(state) {
    const q = state.question;
    const playing = C.playingRung(state);
    const options = q.options.map((text, idx) => ({
      letter: LETTERS[idx],
      text: cap(text),
      correct: idx === q.answer,
      removed: state.removed.indexOf(idx) >= 0,
    }));
    return {
      kind: "question",
      contestant: cap(C.nameOf(state, state.current)),
      number: playing,
      of: C.rungCount(state),
      category: cap(q.category),
      q: cap(q.q),
      options,
      answer: q.answer,
      answerText: `${LETTERS[q.answer]} — ${cap(q.options[q.answer])}`,
      atStake: money(state, C.rungValue(state, playing)),
      ifWrong: money(state, C.winningsIfWrong(state)),
      ifWalk: money(state, C.winningsIfWalk(state)),
      remaining: state.removed.length
        ? options.filter((o) => !o.removed).map((o) => o.letter)
        : null,
      selected: Number.isInteger(state.selected) ? LETTERS[state.selected] : null,
      locked: !!state.locked,
      revealed: !!state.revealed,
    };
  }

  function fffPart(state) {
    const fq = state.fff.question;
    const order = fq.order.map((idx, i) => ({ place: i + 1, letter: LETTERS[idx], text: cap(fq.options[idx]) }));
    return {
      kind: "fff",
      q: cap(fq.q),
      items: fq.options.map((text, idx) => ({ letter: LETTERS[idx], text: cap(text) })),
      order,
      answerText: order.map((o) => o.letter).join(" "),
      arrivals: state.fff.submissions.length,
      revealed: !!state.fff.revealed,
    };
  }

  /**
   * The host's private view for this moment. Plain, JSON-safe, deterministic.
   * @returns {{secret:boolean, phaseLabel:string, kind:string, ...}}
   */
  function hostView(state) {
    const kind = kindOf(state);
    const base = { secret: kind !== "none", phaseLabel: PHASE_LABEL[state && state.phase] || "Setup" };
    if (kind === "question") return Object.assign(base, questionPart(state));
    if (kind === "fff") return Object.assign(base, fffPart(state));
    return Object.assign(base, { kind: "none" });
  }

  /**
   * The one line the shared screen's "Show answer on this screen" fallback
   * reveals: the current item's answer while it is still secret on the
   * shared screen, else "" (after the public reveal there is nothing to hide).
   */
  function fallbackAnswer(state) {
    const kind = kindOf(state);
    if (kind === "question" && !state.revealed) {
      const q = state.question;
      return `Correct answer: ${LETTERS[q.answer]} — ${q.options[q.answer]}`;
    }
    if (kind === "fff" && !state.fff.revealed) {
      const fq = state.fff.question;
      return `Correct order: ${fq.order.map((idx) => `${LETTERS[idx]} ${fq.options[idx]}`).join(", ")}`;
    }
    return "";
  }

  return { hostView, itemKey, item, fallbackAnswer, kindOf, PHASE_LABEL };
});
