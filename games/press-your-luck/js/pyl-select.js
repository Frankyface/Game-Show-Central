/* ============================================================
   Press Your Luck — selectors (PURE)
   Everything that only READS a state: whose spin it is, who is
   still in, what a phone is allowed to see, what the standings
   say. Split out of pyl-core.js so both files stay well under the
   800-line house limit; pyl-core.js re-exports every name here.

   The rule that matters most (spec 17 §6, leak state L-U10):
   `phoneView` NEVER carries the board, a square, a face index or
   a question's correct answer. The landing square does not exist
   anywhere in the state until the moment STOP is pressed, so
   there is nothing for a phone to peek at even in principle.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./pyl-content.js") : root.PylContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.PylSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, cleanText, formatMoney, isWhammy, squareValue,
    squareLabel, squareSentence, SQUARES, OPTIONS, MAX_PLAYERS, PID_MAX,
  } = Content;

  const LETTERS = ["A", "B", "C"];

  /* ============ Seats and players ============ */

  /** The seat a phone is sitting in, or null when it is only watching. */
  function seatOf(state, pid) {
    if (typeof pid !== "string" || !pid) return null;
    for (let i = 0; i < state.players.length; i += 1) {
      if (state.players[i].pid === pid) return i;
    }
    return null;
  }

  function nameOf(state, seat) {
    const p = state.players[seat];
    return p ? p.name : "";
  }

  /** Seats that have not used up the whammy limit. */
  function alive(state) {
    const out = [];
    state.players.forEach((p, i) => { if (!state.out[i]) out.push(i); });
    return out;
  }

  function spinsLeft(state, seat) {
    if (seat === null || seat === undefined || !state.players[seat]) return 0;
    return (state.spins[seat] || 0) + (state.passed[seat] || 0);
  }

  /**
   * Whose spin it is, in order (spec 17 §1): spins that were PASSED to you
   * must be used first of all, then the player with the fewest spins goes
   * first, ties broken by the lower total and then by seat.
   */
  function spinOrder(state) {
    return alive(state)
      .filter((seat) => spinsLeft(state, seat) > 0)
      .sort((a, b) => {
        const pa = state.passed[a] > 0 ? 0 : 1;
        const pb = state.passed[b] > 0 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const sa = spinsLeft(state, a);
        const sb = spinsLeft(state, b);
        if (sa !== sb) return sa - sb;
        if (state.totals[a] !== state.totals[b]) return state.totals[a] - state.totals[b];
        return a - b;
      });
  }

  /* ============ The board ============ */

  /** The face a square is showing this spin (0 = the square itself). */
  function faceOf(square, face) {
    if (!face || !Array.isArray(square.alternatives)) return square;
    return square.alternatives[face - 1] || square;
  }

  /** The 18 squares as they stand right now, rotation applied. */
  function boardOf(state) {
    const boards = state.game.boards;
    const board = boards[Math.min(state.round, boards.length - 1)];
    const faces = Array.isArray(state.faces) ? state.faces : [];
    return board.map((sq, i) => faceOf(sq, faces[i] || 0));
  }

  function whammyCountOf(state) {
    return boardOf(state).filter(isWhammy).length;
  }

  /* ============ The question round ============ */

  function questionIndex(state) {
    const round = state.order[state.round] || [];
    const index = round[state.qIndex];
    return Number.isInteger(index) ? index : null;
  }

  function currentQuestion(state) {
    const index = questionIndex(state);
    return index === null ? null : state.game.questions[index] || null;
  }

  /** Are the buzzers still live for this question? */
  function buzzOpen(state) {
    return state.phase === "question" && state.q.judged === null && state.q.buzzed === null;
  }

  /** Are the three options up for everyone else? */
  function picksOpen(state) {
    return state.phase === "question" && state.q.judged !== null && !state.q.revealed;
  }

  /**
   * Who may pick: everyone still in the game except the player who buzzed.
   * A wrong buzz-in is still a buzz-in — they had their shot (spec 17 §1).
   */
  function eligiblePickers(state) {
    return alive(state).filter((seat) => seat !== state.q.buzzed);
  }

  function pickOf(state, seat) {
    const picks = state.q.picks || {};
    return Object.prototype.hasOwnProperty.call(picks, String(seat)) ? picks[String(seat)] : null;
  }

  /* ============ Passing ============ */

  /**
   * A player may pass what is left of their OWN spins, once, to one opponent
   * — never spins that were passed to them (spec 17 §1).
   */
  function passTargets(state) {
    if (state.phase !== "board" || state.control === null || state.awaiting) return [];
    const seat = state.control;
    if (state.passed[seat] > 0 || state.spins[seat] <= 0) return [];
    return alive(state).filter((s) => s !== seat);
  }

  function canPass(state) {
    return passTargets(state).length > 0;
  }

  function canStop(state) {
    return state.phase === "board" && !state.awaiting && state.control !== null
      && !state.out[state.control] && spinsLeft(state, state.control) > 0;
  }

  /* ============ Standings ============ */

  /** Everyone, richest first; `winner` only when somebody actually has money. */
  function standings(state) {
    const currency = state.game.settings.currency;
    const rows = state.players.map((p, seat) => ({
      seat,
      name: p.name,
      pid: p.pid,
      total: state.totals[seat],
      money: formatMoney(state.totals[seat], currency),
      whammies: state.whammies[seat],
      out: state.out[seat],
      spins: spinsLeft(state, seat),
      winner: false,
    }));
    const top = rows.reduce((max, r) => Math.max(max, r.total), 0);
    if (top > 0) rows.forEach((r) => { r.winner = r.total === top; });
    return rows.sort((a, b) => (b.total - a.total) || (a.seat - b.seat));
  }

  function leader(state) {
    const rows = standings(state);
    return rows.length && rows[0].winner ? rows[0] : null;
  }

  /* ============ Phone messages ============ */

  /**
   * The only four shapes a phone may send (spec 17 §5). Anything else — junk,
   * oversized, prototype-shaped — comes back null and is dropped.
   * @param {*} raw @returns {object|null}
   */
  function validatePhoneMsg(raw) {
    if (!isPlainObject(raw) || typeof raw.t !== "string") return null;
    if (raw.t === "buzz") return { t: "buzz" };
    if (raw.t === "stop") return { t: "stop" };
    if (raw.t === "pick") {
      if (!Number.isInteger(raw.idx) || raw.idx < 0 || raw.idx >= OPTIONS) return null;
      return { t: "pick", idx: raw.idx };
    }
    if (raw.t === "pass") {
      if (!Number.isInteger(raw.to) || raw.to < 0 || raw.to >= MAX_PLAYERS) return null;
      return { t: "pass", to: raw.to };
    }
    return null;
  }

  /* ============ The phone view ============ */

  /** The header every screen carries: who I am and how I stand. */
  function phoneBase(state, seat) {
    const currency = state.game.settings.currency;
    return {
      screen: "wait",
      currency,
      round: state.round + 1,
      rounds: state.game.settings.rounds,
      seat,
      name: seat === null ? "" : nameOf(state, seat),
      total: seat === null ? 0 : formatMoney(state.totals[seat], currency),
      spins: seat === null ? 0 : spinsLeft(state, seat),
      whammies: seat === null ? 0 : state.whammies[seat],
      out: seat === null ? false : state.out[seat],
      sub: "",
    };
  }

  function phoneQuestion(state, seat, view) {
    const question = currentQuestion(state);
    const q = question ? question.q : "";
    const eligible = seat !== null && !state.out[seat];
    if (buzzOpen(state) && eligible) {
      return Object.assign(view, {
        screen: "buzz",
        q,
        armed: state.q.armed,
        sub: state.q.armed ? "First in wins the spins." : "Wait for the host to arm the buzzers.",
      });
    }
    if (picksOpen(state) && eligible && eligiblePickers(state).indexOf(seat) >= 0) {
      const question2 = currentQuestion(state);
      return Object.assign(view, {
        screen: "pick",
        q,
        // The options only — a phone is never sent `answer` (leak state L-U10).
        options: question2 ? question2.options.slice() : [],
        letters: LETTERS.slice(0, OPTIONS),
        myPick: pickOf(state, seat),
        sub: "Lock in an answer for one spin.",
      });
    }
    return Object.assign(view, {
      screen: "wait",
      q,
      sub: waitSub(state, seat),
    });
  }

  function waitSub(state, seat) {
    if (state.q.buzzed !== null && state.q.judged === null) {
      return `${nameOf(state, state.q.buzzed)} buzzed in.`;
    }
    if (state.q.revealed) return "Watch the big screen.";
    if (seat !== null && state.out[seat]) return `${state.game.settings.whammyLimit} Whammies — you're out of the game.`;
    if (state.q.buzzed !== null && seat === state.q.buzzed) return "You had the buzz-in.";
    return "Watch the big screen.";
  }

  function phoneBoard(state, seat, view) {
    const mine = seat !== null && seat === state.control;
    const targets = mine ? passTargets(state) : [];
    return Object.assign(view, {
      screen: "board",
      control: state.control === null ? "" : nameOf(state, state.control),
      mine,
      canStop: mine && canStop(state),
      canPass: mine && canPass(state),
      passTargets: targets.map((s) => ({ to: s, name: nameOf(state, s) })),
      // The result of the LAST spin only — the next one does not exist yet.
      last: state.landing ? landingLine(state, state.landing) : "",
      sub: boardSub(state, seat, mine),
    });
  }

  function boardSub(state, seat, mine) {
    if (seat !== null && state.out[seat]) return `${state.game.settings.whammyLimit} Whammies — you're out of the game.`;
    if (state.awaiting === "advance") return "The host is bringing the next player up.";
    if (mine) return "Big money, no Whammies!";
    return `${state.control === null ? "Nobody" : nameOf(state, state.control)} is on the board.`;
  }

  /** One sentence describing a spin that has already happened. */
  function landingLine(state, landing) {
    const currency = state.game.settings.currency;
    const who = nameOf(state, landing.seat);
    if (landing.whammy) {
      return landing.eliminated
        ? `${who} hit a Whammy — that is ${state.whammies[landing.seat]}, and they are out.`
        : `${who} hit a Whammy and lost it all.`;
    }
    const extra = landing.extraSpin ? " and one more spin" : "";
    return `${who} landed ${squareSentence(landing.square, currency).replace(/\.$/, "")}${extra}.`;
  }

  /**
   * The one payload a phone is allowed to see. Never carries the board, a
   * square, a face, or a question's answer.
   * @param {object} state @param {string} pid
   */
  function phoneView(state, pid) {
    const seat = seatOf(state, pid);
    const view = phoneBase(state, seat);
    if (state.phase === "setup") {
      return Object.assign(view, { sub: "The host is still setting up." });
    }
    if (state.phase === "question") return phoneQuestion(state, seat, view);
    if (state.phase === "board") return phoneBoard(state, seat, view);
    if (state.phase === "roundDone") {
      return Object.assign(view, {
        screen: "wait",
        sub: `Round ${state.round + 1} is over.`,
        standings: standingsLite(state),
      });
    }
    if (state.phase === "result") {
      return Object.assign(view, { screen: "result", standings: standingsLite(state) });
    }
    return view;
  }

  /** Names and money only — no seats' spin counts, no board. */
  function standingsLite(state) {
    return standings(state).map((r) => ({
      name: r.name, money: r.money, whammies: r.whammies, out: r.out, winner: r.winner,
    }));
  }

  /* ============ Host-side descriptions ============ */

  /** The 18 tiles the host screen paints, in perimeter order. */
  function boardTiles(state) {
    const currency = state.game.settings.currency;
    return boardOf(state).map((square, index) => {
      const label = squareLabel(square, currency);
      return {
        index,
        top: label.top,
        sub: label.sub,
        whammy: label.whammy,
        value: squareValue(square),
        sentence: squareSentence(square, currency),
      };
    });
  }

  function letterFor(index) {
    return LETTERS[index] || "?";
  }

  return {
    LETTERS, SQUARES,
    seatOf, nameOf, alive, spinsLeft, spinOrder,
    faceOf, boardOf, boardTiles, whammyCountOf,
    questionIndex, currentQuestion, buzzOpen, picksOpen, eligiblePickers, pickOf,
    passTargets, canPass, canStop,
    standings, standingsLite, leader, landingLine, letterFor,
    validatePhoneMsg, phoneView,
    cleanText, formatMoney, PID_MAX,
  };
});
