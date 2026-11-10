/* ============================================================
   1 vs 100 — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows:
   the question with its three options and the CORRECT ONE MARKED,
   the Mob's split as answers come in, how many of the Mob would
   fall (and what they would bank) if the contestant gets it right,
   and the next question with its answer. Phases with nothing
   private (setup, a revealed question, the result) say so.

   The host never plays a role in this game (the contestant and the
   Mob are all players), so nothing here must be withheld from the
   host. It is never sent to a contestant: the room glue hands it to
   room.setHostView only. Contestant phoneView is untouched.

   No DOM, no timers; runs in Node and the browser. Never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./ovh-core.js")
    : root.OvhCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OvhHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const LETTERS = ["A", "B", "C"];

  /** Plain-English phase names for the host phone's header line. */
  function phaseLabel(state) {
    if (!state || state.phase === "setup") return "Setup";
    if (state.phase === "question") return `Question ${state.qNumber}`;
    if (state.phase === "decision") return `After question ${state.qNumber}`;
    if (state.phase === "result") return "Result";
    return "Standings";
  }

  /**
   * A stable key for "the thing on the table". It changes exactly when a new
   * question comes up, which is what the shared screen's one-shot "Show answer
   * on this screen" clears on.
   * @returns {string}
   */
  function itemKey(state) {
    if (!state || !state.game || state.phase === "setup") return "setup";
    const q = state.q && state.q.question;
    return `${state.qNumber}:${q ? q.id : "none"}`;
  }

  /** A question as the host phone draws it: the options with the right one marked. */
  function questionRow(question) {
    return {
      q: question.q,
      category: question.category || "",
      level: question.level,
      answer: question.answer,
      answerLetter: LETTERS[question.answer],
      answerText: question.options[question.answer],
      options: question.options.map((text, idx) => ({ letter: LETTERS[idx], text, correct: idx === question.answer })),
    };
  }

  /**
   * The Mob so far: the live split, and how many would fall on a correct
   * contestant answer. Before the window closes, a phone Mob member who has
   * not answered counts as falling (that is the rule, O-U3); a simulated Mob
   * uses the host's typed count, or none yet.
   */
  function mobRow(state) {
    const q = state.q;
    const answer = q.question.answer;
    const sp = C.split(state);
    let fall;
    if (q.closed || !state.mob.simulated) {
      fall = C.facing(state).filter((m) => q.answers[m.pid] !== answer).length;
    } else {
      fall = Number.isInteger(q.simWrong) ? q.simWrong : 0;
    }
    const per = C.perMember(state, state.qNumber);
    return {
      counts: sp.counts.slice(),
      answered: sp.answered,
      noAnswer: sp.noAnswer,
      total: sp.total,
      simulated: !!state.mob.simulated,
      open: !!q.open,
      closed: !!q.closed,
      wouldFall: fall,
      wouldStay: Math.max(0, sp.total - fall),
      wouldEarn: fall * per,
      wouldEarnText: C.formatMoney(state, fall * per),
      wipeOut: fall > 0 && fall === sp.total,
    };
  }

  function nextRow(state) {
    const up = state.upcoming;
    if (!up || !up.question) return null;
    return Object.assign({ qNumber: up.n }, questionRow(up.question));
  }

  /**
   * The host phone's view of `state` (docs/22 §6, 1 vs 100 row).
   * @param {object|null} state the core state, or null on the setup screen
   * @returns {object} ≤ 16 KB: three options, two questions, a few counts
   */
  function hostView(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") {
      return { phase: "setup", phaseLabel: "Setup", secret: false };
    }
    const base = {
      phase: state.phase,
      phaseLabel: phaseLabel(state),
      qNumber: state.qNumber,
      bank: C.formatMoney(state, C.bank(state)),
      perMember: C.formatMoney(state, C.perMember(state, state.qNumber)),
      secret: false,
    };
    const q = state.q;
    if (state.phase === "question" && q && q.question && !q.revealed) {
      return Object.assign(base, {
        secret: true,
        current: questionRow(q.question),
        mob: mobRow(state),
        locked: q.locked === null ? null : LETTERS[q.locked],
        next: nextRow(state),
      });
    }
    if (state.phase === "decision") {
      // The question just played is public now; the one that comes next is not.
      const next = nextRow(state);
      return Object.assign(base, { secret: !!next, current: null, next, note: "Walk away, or play on." });
    }
    return base;
  }

  /** The answer the shared screen must not mark, as "B — Eight", or "". */
  function currentAnswer(state) {
    const v = hostView(state);
    return v.secret && v.current ? `${v.current.answerLetter} — ${v.current.answerText}` : "";
  }

  return { hostView, itemKey, currentAnswer, phaseLabel };
});
