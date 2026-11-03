/* ============================================================
   The Chase — selectors, phone views and the public core (PURE)
   The last of the three pure files: chase-content.js holds the
   JSON contract, chase-rules.js holds the reducer, and this file
   holds everything a screen reads plus the ONE masked surface a
   phone is ever sent. It re-exports the other two, so callers
   only ever touch `ChaseCore` (spec 15 §4).

   THE RULE THIS FILE ENFORCES: a locked answer is a secret until
   its side is revealed. `phoneView` never carries the other
   side's lock, never carries the correct answer before the
   reveal, and never carries a rapid-fire answer at all — the
   Cash Builder and the Final Chase are read aloud by the host,
   so those answers exist only on the host's screen (success
   state CH-U10).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./chase-content.js") : root.ChaseContent;
  const rules = node ? require("./chase-rules.js") : root.ChaseRules;
  const api = factory(content, rules);
  if (node) module.exports = api;
  root.ChaseCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Rules) {
  "use strict";

  const { isPlainObject, isIntIn, OPTION_COUNT } = Content;

  const LETTERS = Object.freeze(["A", "B", "C"]);

  /* ============ Money and clocks ============ */

  function currencyOf(state) {
    return state && state.game ? state.game.settings.currency : "$";
  }

  function formatMoney(state, amount) {
    return `${currencyOf(state)}${Number(amount || 0).toLocaleString("en-US")}`;
  }

  /** Whole seconds left on a deadline; 0 when there is no clock. */
  function secondsLeft(clock, now) {
    if (!clock) return 0;
    if (!clock.running || clock.deadline === null) return Math.ceil(Math.max(0, clock.remainingMs) / 1000);
    return Math.max(0, Math.ceil((clock.deadline - now) / 1000));
  }

  /** The clock fields a phone screen may see. Never a question, never an answer. */
  function clockView(clock) {
    return {
      running: !!(clock && clock.running),
      deadline: clock && clock.running ? clock.deadline : null,
      remainingMs: clock ? clock.remainingMs : 0,
    };
  }

  /* ============ The board ============ */

  /**
   * The seven-step board as the host screen draws it: one row per step from
   * the Chaser's top step down to home, with the two markers placed. Positions
   * are distances from home, so 0 is home and `steps` is where the Chaser
   * starts.
   * @param {object} state
   */
  function board(state) {
    const s = state.game.settings;
    const h = state.h2h;
    const cPos = h ? h.cPos : s.startStep;
    const hPos = h ? h.hPos : s.steps;
    const rows = [];
    for (let pos = s.steps; pos >= 0; pos -= 1) {
      rows.push({
        pos,
        home: pos === 0,
        contestant: pos === cPos,
        chaser: pos === hPos,
        label: pos === 0 ? "HOME" : String(pos),
      });
    }
    return {
      steps: s.steps,
      contestant: cPos,
      chaser: hPos,
      gap: hPos - cPos,
      toHome: cPos,
      rows,
      amount: h ? h.amount : 0,
      outcome: h ? h.outcome : null,
      name: state.contestants[state.seat] ? state.contestants[state.seat].name : "",
      chaserName: state.chaser.name,
    };
  }

  /** The three amounts on the table, with the step each one starts on. */
  function offers(state) {
    const raw = state.offer || Rules.offersFor(state);
    return {
      higher: Object.assign({ key: "higher" }, raw.higher),
      middle: Object.assign({ key: "middle" }, raw.middle),
      lower: Object.assign({ key: "lower" }, raw.lower),
    };
  }

  /** Everything the contestants have carried home so far. */
  function bank(state) {
    return Rules.bankOf(state);
  }

  /* ============ Question surfaces (host only) ============ */

  /** The rapid-fire question on the table, with its answer. HOST SCREEN ONLY. */
  function rapidQuestion(state) {
    if (state.phase === "cashBuilder" && state.cb) return state.cb.item;
    if ((state.phase === "finalTeam" || state.phase === "finalChaser") && state.final) return state.final.item;
    return null;
  }

  /** The Cash Builder total as it stands. */
  function cashTotal(state) {
    if (!state.cb) return 0;
    return state.cb.correct * state.game.settings.cashBuilderValue;
  }

  /** The head-to-head question with its three options. The answer index is
      included, so this is a HOST-ONLY selector — phones get `phoneView`. */
  function question(state) {
    return state.h2h ? state.h2h.q : null;
  }

  /** Has this side committed? A "locked" lamp, never the letter. */
  function isLocked(state, side) {
    const h = state.h2h;
    return !!(h && h.locks && h.locks[side] !== null && h.locks[side] !== undefined);
  }

  /** The letter a side chose — only once that side has been revealed. */
  function revealedLetter(state, side) {
    const h = state.h2h;
    if (!h || !h.revealed[side]) return null;
    const idx = h.locks[side];
    return isIntIn(idx, 0, OPTION_COUNT - 1) ? LETTERS[idx] : null;
  }

  /** Both sides are in and shown: the host may deal the next question. */
  function bothRevealed(state) {
    const h = state.h2h;
    return !!(h && h.revealed.contestant && h.revealed.chaser);
  }

  /* ============ Names and standings ============ */

  function nameOf(state, pid) {
    if (state.chaser.pid === pid) return state.chaser.name;
    const found = state.contestants.find((c) => c.pid === pid);
    return found ? found.name : "";
  }

  function seatOf(state, pid) {
    return state.contestants.findIndex((c) => c.pid === pid);
  }

  /** The contestant in the hot seat, or null before the game starts. */
  function hotSeat(state) {
    return state.contestants[state.seat] || null;
  }

  /**
   * The night's line: what each contestant built, how their chase ended and
   * what they are taking home. The Chaser is not a scoring row.
   */
  function standings(state) {
    const share = state.outcome ? state.outcome.share : [];
    return state.results.map((r, i) => {
      const won = share.find((x) => x.pid === r.pid);
      return {
        seat: i,
        pid: r.pid,
        name: r.name,
        cash: r.cash,
        choice: r.choice,
        played: r.played || r.amount,
        outcome: r.outcome,
        winnings: won ? won.amount : 0,
      };
    });
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame. Judging is host-only, so
   * no phone message can express a mark, a reveal or a step.
   * @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "ready") return { t: "ready" };
    if (obj.t === "lock" && isIntIn(obj.idx, 0, OPTION_COUNT - 1)) return { t: "lock", idx: obj.idx };
    return null;
  }

  /** Which side, if any, this pid may lock an answer for right now. */
  function lockSideFor(state, pid) {
    const h = state && state.h2h;
    if (!state || state.phase !== "headToHead" || !h || h.outcome || !h.q) return null;
    if (!state.chaser.isHost && state.chaser.pid === pid && !h.revealed.chaser) return "chaser";
    const seat = hotSeat(state);
    if (seat && seat.pid === pid && !h.revealed.contestant) return "contestant";
    return null;
  }

  /** May this pid lock right now? */
  function phoneCanLock(state, pid) {
    return lockSideFor(state, pid) !== null;
  }

  /* ---- the masked view ---- */

  function baseView(state, pid) {
    const seat = seatOf(state, pid);
    return {
      screen: "wait",
      name: nameOf(state, pid),
      seat: seat < 0 ? null : seat,
      isChaser: !state.chaser.isHost && state.chaser.pid === pid,
      chaserName: state.chaser.name,
      hotSeatName: hotSeat(state) ? hotSeat(state).name : "",
      bankText: formatMoney(state, bank(state)),
      sub: "",
    };
  }

  /**
   * What phone `pid` should render. The only screen that carries the question
   * is the head-to-head one, and even there the view carries THIS side's lock
   * only: the other side's choice appears the moment the host reveals it and
   * not a moment before (success state CH-U10).
   */
  function phoneView(state, pid) {
    const base = baseView(state, pid);
    if (state.phase === "cashBuilder") return Object.assign(base, cashBuilderView(state, pid));
    if (state.phase === "offer") return Object.assign(base, offerView(state, pid));
    if (state.phase === "headToHead") return Object.assign(base, h2hView(state, pid, base));
    if (state.phase === "finalTeam" || state.phase === "finalChaser") {
      return Object.assign(base, finalView(state, pid));
    }
    if (state.phase === "result" || state.phase === "standings") return Object.assign(base, resultView(state, pid));
    return Object.assign(base, { sub: "The host is setting up." });
  }

  /** Rapid-fire is spoken: the phone gets the clock and the total, never a word
      of the question and never the answer. */
  function cashBuilderView(state, pid) {
    const cb = state.cb;
    const mine = hotSeat(state) && hotSeat(state).pid === pid;
    return {
      screen: "wait",
      clock: clockView(cb.clock),
      totalText: formatMoney(state, cashTotal(state)),
      correct: cb.correct,
      sub: mine
        ? "Cash Builder — answer out loud, as fast as you can."
        : `${hotSeat(state) ? hotSeat(state).name : "The contestant"} is on the Cash Builder.`,
    };
  }

  function offerView(state, pid) {
    const mine = hotSeat(state) && hotSeat(state).pid === pid;
    const o = offers(state);
    return {
      screen: "wait",
      amounts: {
        higher: formatMoney(state, o.higher.amount),
        middle: formatMoney(state, o.middle.amount),
        lower: formatMoney(state, o.lower.amount),
      },
      sub: mine ? "Three offers on the table — say which one you want." : "The offers are on the table.",
    };
  }

  function h2hView(state, pid, base) {
    const h = state.h2h;
    const side = lockSideFor(state, pid);
    const isChaserSide = base.isChaser;
    const shared = {
      q: h.q ? h.q.q : "",
      options: h.q ? h.q.options.slice() : [],
      amountText: formatMoney(state, h.amount),
      contestantLocked: h.locks.contestant !== null,
      chaserLocked: h.locks.chaser !== null,
      revealed: { contestant: h.revealed.contestant, chaser: h.revealed.chaser },
      board: { contestant: h.cPos, chaser: h.hPos, steps: state.game.settings.steps },
      outcome: h.outcome,
    };
    // The correct answer only exists in the payload once both sides are shown.
    if (bothRevealed(state) || h.outcome) shared.answer = h.q ? h.q.answer : null;
    if (side === "chaser" || (isChaserSide && h.revealed.chaser)) return chaserLockView(state, h, shared, side);
    if (side === "contestant" || (!isChaserSide && hotSeatIs(state, pid))) {
      return contestantLockView(state, h, shared, side);
    }
    // A spectator watches the big screen: no question, no options, no locks.
    return {
      screen: "wait", sub: h2hWaitSub(state, h), amountText: shared.amountText,
      board: shared.board, outcome: h.outcome,
    };
  }

  function hotSeatIs(state, pid) {
    const seat = hotSeat(state);
    return !!seat && seat.pid === pid;
  }

  function contestantLockView(state, h, shared, side) {
    // Their OWN lock, and only theirs: they may see what they chose, and the
    // Chaser's choice reaches them only through `revealed`/`answer` above.
    const own = side === "contestant" || h.revealed.contestant;
    return Object.assign(shared, {
      screen: "answer",
      myLock: own ? h.locks.contestant : null,
      canLock: side === "contestant",
      sub: lockSub(h, "contestant", state.chaser.name),
    });
  }

  function chaserLockView(state, h, shared, side) {
    return Object.assign(shared, {
      screen: "chaser",
      myLock: h.locks.chaser,
      canLock: side === "chaser",
      sub: lockSub(h, "chaser", state.chaser.name),
    });
  }

  function lockSub(h, side, chaserName) {
    if (h.outcome === "caught") return "Caught. That is the end of your chase.";
    if (h.outcome === "home") return "Home — and the money is safe.";
    if (h.revealed[side]) return "Locked in and shown.";
    if (h.locks[side] !== null) return "Locked. Nobody else can see it.";
    return side === "chaser" ? `Lock an answer, ${chaserName}.` : "Lock an answer — three to choose from.";
  }

  function h2hWaitSub(state, h) {
    if (h.outcome === "caught") return `${hotSeat(state).name} has been caught.`;
    if (h.outcome === "home") return `${hotSeat(state).name} is home.`;
    return `${hotSeat(state).name} is playing the Chaser. Watch the board.`;
  }

  function finalView(state, pid) {
    const f = state.final;
    const teamHalf = state.phase === "finalTeam";
    const mine = f.finalists.some((x) => x.pid === pid);
    return {
      screen: "final",
      clock: clockView(teamHalf ? f.teamClock : f.chaserClock),
      half: teamHalf ? "team" : "chaser",
      teamSteps: f.teamSteps,
      chaserSteps: f.chaserSteps,
      headStart: f.headStart,
      pushbackPending: !!f.pushback,
      sub: finalSub(state, f, teamHalf, mine),
    };
  }

  function finalSub(state, f, teamHalf, mine) {
    if (teamHalf) {
      return mine ? "Final Chase — shout the answers." : "The finalists are building their target.";
    }
    if (f.pushback) return mine ? "He missed it — this one is yours." : "The team have a pushback.";
    return `${state.chaser.name} needs ${Math.max(0, f.teamSteps - f.chaserSteps)} more.`;
  }

  function resultView(state, pid) {
    const out = state.outcome;
    const mine = out ? out.share.find((x) => x.pid === pid) : null;
    return {
      screen: "result",
      won: !!(out && out.teamWon),
      mine: mine ? formatMoney(state, mine.amount) : null,
      standings: standings(state).map((row) => ({
        name: row.name, outcome: row.outcome, winnings: formatMoney(state, row.winnings),
      })),
      sub: resultSub(state, out, mine),
    };
  }

  function resultSub(state, out, mine) {
    if (!out) return "Thanks for playing.";
    if (!out.played) return `Nobody got home — ${state.chaser.name} takes the lot.`;
    if (!out.teamWon) return `${state.chaser.name} caught the team with ${
      Math.max(0, out.teamSteps - out.chaserSteps)} to spare.`;
    return mine && mine.amount > 0 ? "That is yours." : "The team held on.";
  }

  /* ============ Export ============ */

  return Object.assign({}, Content, Rules, {
    LETTERS,
    // money + clocks
    currencyOf, formatMoney, secondsLeft, clockView,
    // board + offers
    board, offers, bank, cashTotal,
    // questions (host only)
    rapidQuestion, question, isLocked, revealedLetter, bothRevealed,
    // people
    nameOf, seatOf, hotSeat, standings,
    // phones
    validatePhoneMsg, phoneView, phoneCanLock, lockSideFor,
  });
});
