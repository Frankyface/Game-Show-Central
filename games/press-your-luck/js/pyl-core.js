/* ============================================================
   Press Your Luck — pure game core
   The immutable reducer the host UI and the phone screens read.
   No DOM, no network, no timers: every random choice takes an
   injected `rng`, so the whole format is testable in Node. Runs
   in the browser (globalThis.PylCore, after pyl-content.js and
   pyl-select.js) and in Node (module.exports). Reducers never
   mutate their inputs.

   The Big Board rule (spec 17 §1, and the "core decides, the
   animation visualises" rule from wheel-draw.js): the landing
   square is chosen HERE, from `rng`, at the moment `stop` is
   dispatched. Nothing in the state points at a future square, so
   the travelling light on the host screen — and every phone —
   learns the result at the same instant the players do.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./pyl-content.js") : root.PylContent;
  const select = node ? require("./pyl-select.js") : root.PylSelect;
  const api = factory(content, select);
  if (node) module.exports = api;
  root.PylCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Select) {
  "use strict";

  const {
    isPlainObject, cleanText, fail, formatMoney, isWhammy, squareValue,
    squareLabel, squareSentence, validateGame, normalizeGame, warningsFor,
    squareProblem, validateSquare, validateBoard, validateQuestion,
    SQUARES, OPTIONS, MIN_PLAYERS, MAX_PLAYERS, MIN_QUESTIONS,
    MIN_WHAMMIES, MAX_WHAMMIES, NAME_MAX, PID_MAX, MAX_MONEY, DEFAULT_SETTINGS,
  } = Content;

  const {
    seatOf, nameOf, alive, spinsLeft, spinOrder, faceOf, boardOf, boardTiles,
    whammyCountOf, questionIndex, currentQuestion, buzzOpen, picksOpen,
    eligiblePickers, pickOf, passTargets, canPass, canStop, standings,
    standingsLite, leader, landingLine, letterFor, validatePhoneMsg, phoneView,
    LETTERS,
  } = Select;
  void (faceOf && boardTiles && whammyCountOf && questionIndex && pickOf
    && canPass && standingsLite && leader && landingLine && letterFor
    && validatePhoneMsg && phoneView && LETTERS && squareLabel && formatMoney
    && warningsFor && squareProblem && validateSquare && validateBoard
    && validateQuestion && MIN_WHAMMIES && MAX_WHAMMIES && MIN_QUESTIONS
    && MAX_MONEY);

  const MAX_HISTORY = 60;

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze(["setup", "question", "board", "roundDone", "result"]);

  /* ============ Building a state ============ */

  function normalizePlayers(players) {
    if (!Array.isArray(players)) fail("Press Your Luck needs a list of players.");
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      fail(`Press Your Luck is played by ${MIN_PLAYERS} to ${MAX_PLAYERS} players — this game has ${players.length}.`);
    }
    const out = players.map((raw, i) => {
      const p = isPlainObject(raw) ? raw : { name: raw };
      const name = cleanText(p.name, NAME_MAX);
      if (!name) fail(`Player ${i + 1} needs a name.`);
      const pid = typeof p.pid === "string" ? cleanText(p.pid, PID_MAX) : "";
      return { name, pid: pid || null };
    });
    const names = out.map((p) => p.name.toLowerCase());
    if (new Set(names).size !== names.length) fail("Every player needs a different name.");
    const pids = out.map((p) => p.pid).filter(Boolean);
    if (new Set(pids).size !== pids.length) fail("One phone cannot sit in two seats.");
    return out;
  }

  /** A fresh, unasked question. */
  function freshQuestion() {
    return { armed: false, buzzed: null, judged: null, picks: {}, revealed: false };
  }

  /**
   * Which file question each slot uses. `options.order` (a list of lists)
   * overrides for tests; otherwise the questions are shuffled once, at the
   * start, and dealt out round by round so nothing repeats.
   */
  function questionOrderFor(game, rng, options) {
    const wanted = options && Array.isArray(options.order) ? options.order : null;
    if (wanted) return wanted.map((round) => round.slice());
    const per = game.settings.questionsPerRound;
    const pool = game.questions.map((q, i) => i);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1)) % (i + 1);
      const swap = pool[i]; pool[i] = pool[j]; pool[j] = swap;
    }
    const rounds = [];
    for (let r = 0; r < game.settings.rounds; r += 1) {
      rounds.push(pool.slice(r * per, r * per + per));
    }
    return rounds;
  }

  /** All zeroes unless the file asks for rotation and a square has faces. */
  function rollFaces(game, round, rng) {
    const board = game.boards[Math.min(round, game.boards.length - 1)];
    return board.map((sq) => {
      if (!game.settings.rotate || !Array.isArray(sq.alternatives) || !sq.alternatives.length) return 0;
      const faces = sq.alternatives.length + 1;
      return Math.floor(rng() * faces) % faces;
    });
  }

  /**
   * Build the opening state.
   * @param {*} game @param {*} players
   * @param {{order?:number[][]}} [options] @param {function} [rng]
   */
  function createState(game, players, options, rng) {
    const g = normalizeGame(game);
    const roster = normalizePlayers(players);
    const random = typeof rng === "function" ? rng : Math.random;
    const zeros = roster.map(() => 0);
    return {
      phase: "setup",
      game: g,
      players: roster,
      round: 0,
      qIndex: 0,
      order: questionOrderFor(g, random, options),
      q: freshQuestion(),
      spins: zeros.slice(),
      passed: zeros.slice(),
      totals: zeros.slice(),
      whammies: zeros.slice(),
      out: roster.map(() => false),
      control: null,
      faces: rollFaces(g, 0, random),
      landing: null,
      awaiting: null,
      spun: 0,
      notice: "",
      history: [],
    };
  }

  /* ============ Reducer plumbing ============ */

  /** A history entry drops the one constant (`game`) and its own history, so
      undo stays exact while the saved state still fits in localStorage. */
  function snapshot(state) {
    const copy = Object.assign({}, state);
    delete copy.game;
    delete copy.history;
    return copy;
  }

  function withHistory(before, next) {
    const history = before.history.concat([snapshot(before)]);
    return Object.assign({}, next, {
      history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
    });
  }

  /** Arming the buzzers and the notice line are not worth an undo step. */
  const NO_HISTORY = new Set(["arm", "notice", "undo"]);

  /** Resolve `event.seat` or `event.pid` to a seat this state actually has. */
  function seatFrom(state, event) {
    if (Number.isInteger(event.seat)) {
      return event.seat >= 0 && event.seat < state.players.length ? event.seat : null;
    }
    return seatOf(state, event.pid);
  }

  /* ============ The question round ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    return Object.assign({}, state, {
      phase: "question",
      round: 0,
      qIndex: 0,
      q: freshQuestion(),
      notice: "",
    });
  }

  /** `arm{on}` — the host opens (or closes) the buzzers, Jeopardy style. */
  function evArm(state, event) {
    if (!buzzOpen(state)) return state;
    const on = event.on === undefined ? true : !!event.on;
    if (state.q.armed === on) return state;
    return Object.assign({}, state, {
      q: Object.assign({}, state.q, { armed: on }),
      notice: on ? "Buzzers are live." : "Buzzers are closed.",
    });
  }

  /** `buzz{pid|seat}` — first in wins; every later buzz is ignored. */
  function evBuzz(state, event) {
    if (!buzzOpen(state) || !state.q.armed) return state;
    const seat = seatFrom(state, event);
    if (seat === null || state.out[seat]) return state;
    return Object.assign({}, state, {
      q: Object.assign({}, state.q, { buzzed: seat, armed: false }),
      notice: `${nameOf(state, seat)} buzzed in.`,
    });
  }

  /**
   * `judgeBuzz{correct}` — the host's call on what was said out loud. A
   * correct buzz-in banks `buzzSpins`; either way the three options then go
   * up for everyone else. With nobody on the buzzer only `correct:false` is
   * legal: it means "nobody had it", and then everybody picks.
   */
  function evJudgeBuzz(state, event) {
    if (state.phase !== "question" || state.q.judged !== null) return state;
    const correct = !!event.correct;
    const seat = state.q.buzzed;
    if (seat === null && correct) return state;
    const spins = state.spins.slice();
    let notice = "Nobody buzzed in — everyone plays the options.";
    if (seat !== null && correct) {
      spins[seat] += state.game.settings.buzzSpins;
      notice = `${nameOf(state, seat)} is right — ${state.game.settings.buzzSpins} spins.`;
    } else if (seat !== null) {
      notice = `${nameOf(state, seat)} missed it. Everyone else, take a look.`;
    }
    return Object.assign({}, state, {
      spins,
      q: Object.assign({}, state.q, { judged: correct, armed: false }),
      notice,
    });
  }

  /** `pick{pid|seat, idx}` — one locked-in answer, changeable until the reveal. */
  function evPick(state, event) {
    if (!picksOpen(state)) return state;
    const seat = seatFrom(state, event);
    if (seat === null || eligiblePickers(state).indexOf(seat) < 0) return state;
    const idx = Number.isInteger(event.idx) ? event.idx : -1;
    if (idx < 0 || idx >= OPTIONS) return state;
    if (pickOf(state, seat) === idx) return state;
    const picks = Object.assign({}, state.q.picks);
    picks[String(seat)] = idx;
    return Object.assign({}, state, { q: Object.assign({}, state.q, { picks }) });
  }

  /** `revealPicks` — show the answer and pay a spin for every correct pick. */
  function evRevealPicks(state) {
    if (!picksOpen(state)) return state;
    const question = currentQuestion(state);
    if (!question) return state;
    const spins = state.spins.slice();
    const right = [];
    eligiblePickers(state).forEach((seat) => {
      if (pickOf(state, seat) === question.answer) {
        spins[seat] += state.game.settings.pickSpins;
        right.push(nameOf(state, seat));
      }
    });
    return Object.assign({}, state, {
      spins,
      q: Object.assign({}, state.q, { revealed: true }),
      notice: right.length
        ? `${right.join(", ")} had it — ${state.game.settings.pickSpins} spin each.`
        : "Nobody picked it.",
    });
  }

  function lastQuestion(state) {
    return state.qIndex >= state.game.settings.questionsPerRound - 1;
  }

  function evNextQuestion(state) {
    if (state.phase !== "question" || !state.q.revealed || lastQuestion(state)) return state;
    return Object.assign({}, state, {
      qIndex: state.qIndex + 1,
      q: freshQuestion(),
      notice: "",
    });
  }

  /* ============ The Big Board ============ */

  /** `toBoard` — the questions are done; the board opens on the first spinner. */
  function evToBoard(state, event, rng) {
    if (state.phase !== "question" || !state.q.revealed || !lastQuestion(state)) return state;
    const order = spinOrder(state);
    if (!order.length) {
      return Object.assign({}, state, {
        phase: "roundDone",
        control: null,
        landing: null,
        awaiting: null,
        notice: "Nobody earned a spin, so the board stays dark this round.",
      });
    }
    return Object.assign({}, state, {
      phase: "board",
      control: order[0],
      landing: null,
      awaiting: null,
      faces: rollFaces(state.game, state.round, rng),
      notice: `${nameOf(state, order[0])} is up — ${spinsLeft(state, order[0])} spin(s).`,
    });
  }

  /** Take one spin off the seat: spins that were PASSED to them go first. */
  function consumeSpin(spins, passed, seat) {
    if (passed[seat] > 0) passed[seat] -= 1;
    else spins[seat] -= 1;
  }

  /**
   * `stop{pid?}` — the light stops. `rng` picks the square HERE, not before,
   * so nothing in the state (and nothing on a phone) could have known it.
   * Cash and prizes add to the total, "+ one spin" hands a spin back, and a
   * Whammy zeroes the total, counts, and ends the turn.
   * Longer than 50 lines because one spin resolves five outcomes at once;
   * splitting it would hide the single immutable patch.
   */
  function evStop(state, event, rng) {
    if (!canStop(state)) return state;
    const seat = state.control;
    if (event.pid !== undefined && event.pid !== null && seatOf(state, event.pid) !== seat) return state;
    if (Number.isInteger(event.seat) && event.seat !== seat) return state;

    const board = boardOf(state);
    const raw = Math.floor(rng() * SQUARES);
    const index = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), SQUARES - 1);
    const square = board[index];

    const spins = state.spins.slice();
    const passed = state.passed.slice();
    const totals = state.totals.slice();
    const whammies = state.whammies.slice();
    const out = state.out.slice();
    consumeSpin(spins, passed, seat);

    const landing = { index, seat, square, whammy: false, gained: 0, extraSpin: false, eliminated: false };
    let turnOver = false;
    if (isWhammy(square)) {
      totals[seat] = 0;
      whammies[seat] += 1;
      landing.whammy = true;
      turnOver = true;
      if (whammies[seat] >= state.game.settings.whammyLimit) {
        out[seat] = true;
        spins[seat] = 0;
        passed[seat] = 0;
        landing.eliminated = true;
      }
    } else {
      landing.gained = squareValue(square);
      totals[seat] += landing.gained;
      if (square.spin === true) { spins[seat] += 1; landing.extraSpin = true; }
    }
    landing.total = totals[seat];
    if (spins[seat] + passed[seat] <= 0) turnOver = true;

    const next = Object.assign({}, state, {
      spins, passed, totals, whammies, out, landing,
      awaiting: turnOver ? "advance" : null,
      spun: state.spun + 1,
      faces: rollFaces(state.game, state.round, rng),
    });
    return Object.assign(next, { notice: landingLine(next, landing) });
  }

  /**
   * `pass{to}` — hand the rest of your OWN spins to an opponent. They have to
   * use them, and they cannot pass them on (spec 17 §1).
   */
  function evPass(state, event) {
    const targets = passTargets(state);
    const to = Number.isInteger(event.to) ? event.to : seatOf(state, event.to);
    if (to === null || targets.indexOf(to) < 0) return state;
    const seat = state.control;
    const moved = state.spins[seat];
    const spins = state.spins.slice();
    const passed = state.passed.slice();
    spins[seat] = 0;
    passed[to] += moved;
    return Object.assign({}, state, {
      spins, passed,
      awaiting: "advance",
      notice: `${nameOf(state, seat)} passes ${moved} spin(s) to ${nameOf(state, to)} — who has to use them.`,
    });
  }

  /**
   * `nextSpinner` — only once the turn is over (a Whammy, a pass, or the last
   * spin). The player who just finished steps aside if anyone else can spin.
   */
  function evNextSpinner(state) {
    if (state.phase !== "board" || state.awaiting !== "advance") return state;
    const order = spinOrder(state);
    const others = order.filter((seat) => seat !== state.control);
    const next = others.length ? others[0] : (order.indexOf(state.control) >= 0 ? state.control : null);
    if (next === null) {
      return Object.assign({}, state, {
        phase: "roundDone",
        control: null,
        awaiting: null,
        notice: `Round ${state.round + 1} is over.`,
      });
    }
    return Object.assign({}, state, {
      control: next,
      awaiting: null,
      landing: null,
      notice: `${nameOf(state, next)} is up — ${spinsLeft(state, next)} spin(s).`,
    });
  }

  /* ============ Rounds and the end ============ */

  function evNextRound(state, event, rng) {
    if (state.phase !== "roundDone") return state;
    const more = state.round + 1 < state.game.settings.rounds;
    if (!more || alive(state).length === 0) {
      return Object.assign({}, state, { phase: "result", control: null, awaiting: null, notice: "" });
    }
    const round = state.round + 1;
    return Object.assign({}, state, {
      phase: "question",
      round,
      qIndex: 0,
      q: freshQuestion(),
      control: null,
      landing: null,
      awaiting: null,
      faces: rollFaces(state.game, round, rng),
      notice: `Round ${round + 1} — a bigger board.`,
    });
  }

  function evFinish(state) {
    if (state.phase === "result") return state;
    return Object.assign({}, state, {
      phase: "result", control: null, awaiting: null, notice: "",
    });
  }

  function evNotice(state, event) {
    const text = cleanText(event.text, 140);
    if (text === state.notice) return state;
    return Object.assign({}, state, { notice: text });
  }

  function evUndo(state) {
    if (!state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return Object.assign({}, previous, {
      game: state.game,
      history: state.history.slice(0, -1),
    });
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    arm: evArm,
    buzz: evBuzz,
    judgeBuzz: evJudgeBuzz,
    pick: evPick,
    revealPicks: evRevealPicks,
    nextQuestion: evNextQuestion,
    toBoard: evToBoard,
    stop: evStop,
    pass: evPass,
    nextSpinner: evNextSpinner,
    nextRound: evNextRound,
    finish: evFinish,
    notice: evNotice,
    undo: evUndo,
  };

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` is injected — the core never calls Math.random itself.
   * @param {object} state @param {{type:string}} event @param {function} [rng]
   */
  function reduce(state, event, rng) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    // Own-property lookup: a prototype-shaped type ("toString", "__proto__") must never reach a handler.
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const next = handler(state, event, typeof rng === "function" ? rng : Math.random);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withHistory(state, next);
  }

  /** Representative payloads so legalActions can probe payload-carrying events. */
  function sampleFor(type, state) {
    if (type === "arm") return { on: !state.q.armed };
    if (type === "buzz") { const a = alive(state); return { seat: a.length ? a[0] : 0 }; }
    if (type === "judgeBuzz") return { correct: state.q.buzzed !== null };
    if (type === "pick") { const e = eligiblePickers(state); return { seat: e.length ? e[0] : 0, idx: 0 }; }
    if (type === "pass") { const t = passTargets(state); return { to: t.length ? t[0] : -1 }; }
    if (type === "notice") return { text: "probe" };
    return {};
  }

  /** Which events would do something right now (the host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      if (type === "notice") return false;
      const event = Object.assign({ type }, sampleFor(type, state));
      const next = HANDLERS[type](state, event, () => 0);
      return !!next && next !== state;
    });
  }

  return {
    // content, re-exported so callers only need PylCore
    validateGame, normalizeGame, warningsFor, squareProblem, validateSquare,
    validateBoard, validateQuestion, cleanText, formatMoney,
    isWhammy, squareValue, squareLabel, squareSentence,
    SQUARES, OPTIONS, MIN_PLAYERS, MAX_PLAYERS, MIN_QUESTIONS,
    MIN_WHAMMIES, MAX_WHAMMIES, NAME_MAX, PID_MAX, MAX_MONEY, DEFAULT_SETTINGS,
    PHASES, MAX_HISTORY, LETTERS,
    // reducer
    createState, reduce, legalActions, rollFaces,
    // selectors
    seatOf, nameOf, alive, spinsLeft, spinOrder, faceOf, boardOf, boardTiles,
    whammyCountOf, questionIndex, currentQuestion, buzzOpen, picksOpen,
    eligiblePickers, pickOf, passTargets, canPass, canStop, standings,
    standingsLite, leader, landingLine, letterFor, validatePhoneMsg, phoneView,
  };
});
