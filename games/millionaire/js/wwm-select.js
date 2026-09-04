/* ============================================================
   Millionaire — selectors (PURE)
   Everything that READS a state object: the money maths (what a
   rung is worth, what walking away pays, what a slip pays), the
   money-tree column, the roster and standings, the option rows,
   the audience chart, the Fastest Finger arrival list, and the
   masked per-phone views. Split out of wwm-core.js so both files
   stay well under the 800-line house limit; wwm-core.js
   re-exports everything here, so callers only ever touch WwmCore.
   Nothing in this file mutates its argument or reaches for the
   DOM, a timer or a clock — `now` is always passed in.
   ============================================================ */

"use strict";

(function (root, factory) {
  const content = (typeof module === "object" && module.exports)
    ? require("./wwm-content.js")
    : root.WwmContent;
  const api = factory(content);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WwmSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, largestRemainder,
    DEFAULT_MONEY_TREE, LIFELINE_KEYS,
  } = Content;
  void isPlainObject;

  /* ============ Constants ============ */

  const PID_MAX = 24;           // structural cap on a pid coming off the wire
  const LETTERS = ["A", "B", "C", "D"];

  /* ============ Money selectors ============ */

  function tree(state) {
    return (state && state.game && state.game.settings.moneyTree) || DEFAULT_MONEY_TREE;
  }

  function havens(state) {
    return (state && state.game && state.game.settings.safeHavens) || [];
  }

  function rungCount(state) {
    return tree(state).length;
  }

  /** The money on rung `rung` (1-based). Rung 0 — nothing banked — is 0. */
  function rungValue(state, rung) {
    const list = tree(state);
    const n = Number.isInteger(rung) ? rung : state.rung;
    return n >= 1 && n <= list.length ? list[n - 1] : 0;
  }

  /** The question on screen: one past the last one answered correctly. */
  function playingRung(state) {
    return Math.min(state.rung + 1, rungCount(state));
  }

  /** Money already banked: the value of the last question answered correctly. */
  function bankedValue(state) {
    return state.rung > 0 ? rungValue(state, state.rung) : 0;
  }

  /** Walking away before locking keeps everything banked so far (spec 08 §1). */
  function winningsIfWalk(state) {
    return bankedValue(state);
  }

  /**
   * A wrong answer drops to the last safe haven REACHED, and a haven is only
   * reached once its own question has been ANSWERED CORRECTLY — the highest
   * haven rung at or below `state.rung` (spec 08 §1, the TV rule). Four right
   * then a slip on question 5 pays nothing; five right then a slip on question
   * 6 pays 1,000; ten right then a slip on question 11 pays 32,000.
   */
  function winningsIfWrong(state) {
    let best = 0;
    havens(state).forEach((h) => {
      if (h <= state.rung) best = Math.max(best, rungValue(state, h));
    });
    return best;
  }

  function isSafeHaven(state, rung) {
    return havens(state).indexOf(rung) >= 0;
  }

  function formatMoney(state, amount) {
    const cur = state && state.game ? state.game.settings.currency : "$";
    return cur + Number(amount || 0).toLocaleString("en-US");
  }

  /** The right-hand money column, top rung first. */
  function moneyTreeView(state) {
    const list = tree(state);
    const rows = [];
    for (let rung = list.length; rung >= 1; rung -= 1) {
      rows.push({
        rung,
        value: list[rung - 1],
        label: formatMoney(state, list[rung - 1]),
        safe: isSafeHaven(state, rung),
        won: state.phase === "hotseat" && rung <= state.rung,
        current: state.phase === "hotseat" && rung === playingRung(state),
      });
    }
    return rows;
  }

  /* ============ Roster selectors ============ */

  function nameOf(state, pid) {
    const found = (state.contestants || []).find((c) => c.pid === pid);
    if (found) return found.name;
    const seat = (state.roster || []).find((p) => p.pid === pid);
    return seat ? seat.name : "";
  }

  /** Somebody who has not yet had their turn in the hot seat. */
  function isEligible(state, pid) {
    return (state.contestants || []).some((c) => c.pid === pid && !c.out);
  }

  function waitingContestants(state) {
    return (state.contestants || []).filter((c) => !c.out);
  }

  /** Highest winnings first; people who have not played yet keep file order. */
  function standings(state) {
    return (state.contestants || [])
      .map((c, i) => ({ ...c, seat: i }))
      .sort((a, b) => (b.out - a.out) || (b.won - a.won) || (a.seat - b.seat))
      .map(({ seat, ...row }) => { void seat; return row; });
  }

  /* ============ Question selectors ============ */

  /** The question with the answer stripped — everything a phone may see. */
  function publicQuestion(state) {
    const q = state.question;
    if (!q) return null;
    return { q: q.q, category: q.category, level: q.level, options: q.options.slice() };
  }

  function optionState(state, idx) {
    if (state.removed.indexOf(idx) >= 0) return "removed";
    if (state.revealed && state.question && idx === state.question.answer) return "correct";
    if (state.revealed && idx === state.selected) return "wrong";
    if (state.locked && idx === state.selected) return "locked";
    if (idx === state.selected) return "selected";
    return "idle";
  }

  /** Row per option for the host lozenges. */
  function optionRows(state) {
    if (!state.question) return [];
    return state.question.options.map((text, idx) => ({
      idx, letter: LETTERS[idx], text, state: optionState(state, idx),
    }));
  }

  /* ============ Ask the Audience ============ */

  function voteCounts(state) {
    const counts = [0, 0, 0, 0];
    Object.keys(state.audience.votes || {}).forEach((pid) => {
      const idx = state.audience.votes[pid];
      if (isIntIn(idx, 0, 3)) counts[idx] += 1;
    });
    return counts;
  }

  /**
   * The bar chart: whole percentages that always sum to 100 (largest-remainder
   * rounding). A frozen chart (host-typed, or the one kept when the window
   * closed) wins over the live count. @returns {{pcts:number[], counts:number[],
   * total:number, source:string|null}}
   */
  function chart(state) {
    const counts = voteCounts(state);
    const total = counts.reduce((a, b) => a + b, 0);
    if (Array.isArray(state.audience.chart)) {
      return { pcts: state.audience.chart.slice(), counts, total, source: state.audience.source };
    }
    return { pcts: largestRemainder(counts), counts, total, source: total ? "votes" : null };
  }

  /** Seconds left on a window, for the host overlay. 0 when there is no timer. */
  function secondsLeft(deadline, now) {
    if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  /* ============ Fastest Finger ============ */

  function orderIsCorrect(question, order) {
    if (!question || !Array.isArray(order)) return false;
    return question.order.every((v, i) => order[i] === v);
  }

  /** Arrival list for the host screen: order of arrival, times, ticks on reveal. */
  function fffRows(state) {
    const opened = state.fff.openedAt;
    return state.fff.submissions.map((sub, i) => ({
      rank: i + 1,
      pid: sub.pid,
      name: nameOf(state, sub.pid),
      at: sub.at,
      ms: Number.isFinite(opened) && Number.isFinite(sub.at) ? Math.max(0, sub.at - opened) : null,
      correct: state.fff.revealed ? sub.correct : null,
      winner: state.fff.revealed && state.fff.winner === sub.pid,
    }));
  }

  /** Names in the correct order, for the reveal. */
  function fffAnswer(state) {
    const q = state.fff.question;
    if (!q) return [];
    return q.order.map((idx, i) => ({ place: i + 1, idx, text: q.options[idx] }));
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame. @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "fff") {
      return Content.isPermutation(obj.order) ? { t: "fff", order: obj.order.slice() } : null;
    }
    if (obj.t === "answer") return isIntIn(obj.idx, 0, 3) ? { t: "answer", idx: obj.idx } : null;
    if (obj.t === "vote") return isIntIn(obj.idx, 0, 3) ? { t: "vote", idx: obj.idx } : null;
    if (obj.t === "walk") return { t: "walk" };
    if (obj.t === "lifeline") {
      return LIFELINE_KEYS.indexOf(obj.which) >= 0 ? { t: "lifeline", which: obj.which } : null;
    }
    return null;
  }

  /**
   * What phone `pid` should render. It never contains the correct answer and
   * never contains another phone's vote: this is a public surface (M-U10).
   */
  function phoneView(state, pid) {
    const base = {
      screen: "wait",
      name: nameOf(state, pid),
      currency: state.game ? state.game.settings.currency : "$",
      hotName: nameOf(state, state.current),
      hotMoney: formatMoney(state, bankedValue(state)),
      rung: playingRung(state),
      banked: state.rung,
      rungs: rungCount(state),
      spectator: !isEligible(state, pid) && !(state.contestants || []).some((c) => c.pid === pid),
    };
    if (state.phase === "result" || state.phase === "standings") {
      return Object.assign(base, {
        screen: "result",
        standings: standings(state).map((c) => ({ name: c.name, won: formatMoney(state, c.won), out: c.out })),
        mine: state.outcome && state.outcome.pid === pid ? formatMoney(state, state.outcome.won) : null,
      });
    }
    if (state.phase === "fff") return Object.assign(base, fffPhoneView(state, pid));
    if (state.phase === "hotseat") return Object.assign(base, hotseatPhoneView(state, pid));
    return base;
  }

  function fffPhoneView(state, pid) {
    if (!state.fff.question || !state.fff.open || !isEligible(state, pid)) {
      return { screen: "wait", sub: "Fastest Finger is coming up." };
    }
    const mine = state.fff.submissions.find((s) => s.pid === pid);
    if (mine) return { screen: "wait", sub: "Order sent — watch the host screen." };
    return {
      screen: "fff",
      q: state.fff.question.q,
      options: state.fff.question.options.slice(),
    };
  }

  function hotseatPhoneView(state, pid) {
    const q = publicQuestion(state);
    if (state.audience.open && pid !== state.current) {
      return {
        screen: "vote",
        q: q ? q.q : "",
        options: q ? q.options : [],
        removed: state.removed.slice(),
        deadline: state.audience.deadline,
        seconds: state.audience.seconds,
        myVote: Object.prototype.hasOwnProperty.call(state.audience.votes, pid) ? state.audience.votes[pid] : null,
      };
    }
    if (pid !== state.current) return { screen: "wait" };
    if (state.locked || state.revealed) return { screen: "locked", selected: state.selected };
    return {
      screen: "hotseat",
      q: q ? q.q : "",
      category: q ? q.category : "",
      options: q ? q.options : [],
      removed: state.removed.slice(),
      selected: state.selected,
      lifelines: Object.assign({}, state.lifelines),
      playingFor: formatMoney(state, rungValue(state, playingRung(state))),
      request: state.request && state.request.pid === pid ? state.request.which : null,
    };
  }

  /* ============ Export ============ */

  return {
    PID_MAX, LETTERS,
    // money
    tree, havens, rungCount, rungValue, playingRung, bankedValue,
    winningsIfWalk, winningsIfWrong, isSafeHaven, formatMoney, moneyTreeView,
    // roster
    nameOf, isEligible, waitingContestants, standings,
    // questions
    publicQuestion, optionState, optionRows,
    // audience
    voteCounts, chart, secondsLeft,
    // fastest finger
    orderIsCorrect, fffRows, fffAnswer,
    // phones
    validatePhoneMsg, phoneView,
  };
});
