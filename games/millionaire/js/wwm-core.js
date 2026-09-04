/* ============================================================
   Who Wants to Be a Millionaire — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no network, no timers: the phone
   and audience windows are stored as deadline timestamps and
   `now` is injected, and every random choice takes an injected
   `rng`, so the whole format is testable in Node. Runs in the
   browser (globalThis.WwmCore, after js/wwm-content.js) and in
   Node (module.exports). Reducers never mutate their inputs.

   Content validation and the question draw live in
   wwm-content.js and are re-exported here, so every caller only
   needs WwmCore.
   ============================================================ */

"use strict";

(function (root, factory) {
  const content = (typeof module === "object" && module.exports)
    ? require("./wwm-content.js")
    : root.WwmContent;
  const api = factory(content);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WwmCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail,
    validateGame, normalizeGame, warningsFor,
    drawQuestion, drawFff, fiftyFiftyPair, largestRemainder,
    DEFAULT_MONEY_TREE, DEFAULT_SAFE_HAVENS, DEFAULT_SETTINGS, DEFAULT_LIFELINES,
    LIFELINE_KEYS, NAME_MAX, MIN_QUESTIONS,
  } = Content;

  /* ============ Constants ============ */

  const MAX_CONTESTANTS = 16;
  const PID_MAX = 24;           // structural cap on a pid coming off the wire
  const MAX_HISTORY = 60;       // undo depth
  const LETTERS = ["A", "B", "C", "D"];

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze(["setup", "fff", "pick", "hotseat", "result", "standings"]);

  /**
   * @typedef {{pid:string, name:string}} Seat
   * @typedef {{pid:string, name:string, won:number, rung:number, out:boolean}} Contestant
   */

  /* ============ State construction ============ */

  /** Normalise the roster; throws when it cannot make a playable line-up. */
  function normalizePlayers(players) {
    if (!Array.isArray(players)) fail("The contestant list is missing.");
    const seen = new Set();
    const out = [];
    players.forEach((p) => {
      if (!isPlainObject(p)) return;
      const pid = cleanText(p.pid, PID_MAX);
      const name = cleanText(p.name, NAME_MAX);
      if (!pid || !name || seen.has(pid)) return;
      seen.add(pid);
      out.push({ pid, name });
    });
    if (!out.length) fail("Millionaire needs at least one contestant.");
    if (out.length > MAX_CONTESTANTS) fail(`Millionaire takes at most ${MAX_CONTESTANTS} contestants.`);
    return out;
  }

  function blankAudience() {
    return { open: false, votes: {}, deadline: null, chart: null, seconds: 0, source: null };
  }

  function blankPhone() {
    return { open: false, friend: "", deadline: null, seconds: 0 };
  }

  function blankFff() {
    return { question: null, open: false, openedAt: null, submissions: [], revealed: false, winner: null, used: [] };
  }

  /** Everything that belongs to one question and nothing else. */
  function blankQuestionSlate() {
    return {
      question: null, selected: null, locked: false, revealed: false,
      correct: null, removed: [], audience: blankAudience(), phone: blankPhone(),
    };
  }

  /**
   * Build the opening state. `options` may carry `{rng}` for symmetry with the
   * other games; the reducer takes its rng per call, so nothing random is
   * stored. @param {Seat[]} players
   */
  function createState(game, players, options) {
    const g = normalizeGame(game);
    const roster = normalizePlayers(players);
    void (isPlainObject(options) ? options : {});
    return Object.assign({
      phase: "setup",
      game: g,
      roster,
      contestants: roster.map((p) => ({ pid: p.pid, name: p.name, won: 0, rung: 0, out: false })),
      current: null,
      rung: 1,
      used: [],
      lifelines: Object.assign({}, g.settings.lifelines),
      fff: blankFff(),
      request: null,
      outcome: null,
      notice: "",
      wrapped: false,
      history: [],
    }, blankQuestionSlate());
  }

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

  /** What the contestant is playing for right now. */
  function rungValue(state, rung) {
    const list = tree(state);
    const n = Number.isInteger(rung) ? rung : state.rung;
    return n >= 1 && n <= list.length ? list[n - 1] : 0;
  }

  /** Money already banked: the value of the last question answered correctly. */
  function bankedValue(state) {
    return state.rung > 1 ? rungValue(state, state.rung - 1) : 0;
  }

  /** Walking away before locking keeps everything banked so far (spec 08 §1). */
  function winningsIfWalk(state) {
    return bankedValue(state);
  }

  /**
   * A wrong answer drops to the last safe haven REACHED — the highest safe
   * haven rung at or below the rung being played, so a slip on rung 5 still
   * leaves 1,000 and a slip on rung 10 leaves 32,000 (spec 08 §8, M-U3).
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
        won: state.phase === "hotseat" && rung < state.rung,
        current: state.phase === "hotseat" && rung === state.rung,
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
      rung: state.rung,
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
      playingFor: formatMoney(state, rungValue(state, state.rung)),
      request: state.request && state.request.pid === pid ? state.request.which : null,
    };
  }

  /* ============ Reducer plumbing ============ */

  /** A history entry drops the one constant (`game`) and its own history, so
      undo stays exact while the saved state still fits in localStorage. */
  function snapshot(state) {
    const copy = Object.assign({}, state);
    delete copy.game;
    copy.history = [];
    return copy;
  }

  function withHistory(state, next) {
    const history = state.history.concat([snapshot(state)]);
    return Object.assign({}, next, { history: history.slice(-MAX_HISTORY) });
  }

  /** Draw the question for `rung` and fold it into a fresh per-question slate. */
  function questionFor(state, rung, rng) {
    const draw = drawQuestion(state.game, rung, state.used, rng);
    if (!draw.question) return { question: null, used: state.used, wrapped: state.wrapped, notice: "No question for that level." };
    return {
      question: draw.question,
      used: state.used.concat([draw.question.id]),
      wrapped: state.wrapped || draw.wrapped,
      notice: draw.wrapped ? "The question pool has wrapped — this one has been seen before." : "",
    };
  }

  /** Write a finished contestant's result into the line-up and show it. */
  function commitResult(state, outcome) {
    const contestants = state.contestants.map((c) => (c.pid === outcome.pid
      ? Object.assign({}, c, { won: outcome.won, rung: state.rung, out: true })
      : c));
    return Object.assign({}, state, { phase: "result", contestants, outcome, request: null });
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    fffOpen: evFffOpen,
    fffSubmit: evFffSubmit,
    fffReveal: evFffReveal,
    fffPick: evFffPick,
    seat: evSeat,
    select: evSelect,
    lock: evLock,
    reveal: evReveal,
    walkAway: evWalkAway,
    useFifty: evUseFifty,
    usePhone: evUsePhone,
    phoneFriend: evPhoneFriend,
    phoneDone: evPhoneDone,
    useAudience: evUseAudience,
    audienceVote: evAudienceVote,
    audienceHostChart: evAudienceHostChart,
    audienceClose: evAudienceClose,
    useSwitch: evUseSwitch,
    nextQuestion: evNextQuestion,
    nextContestant: evNextContestant,
    request: evRequest,
    clearRequest: evClearRequest,
    finish: evFinish,
    undo: evUndo,
  };

  // Bookkeeping that is not worth an undo step.
  const NO_HISTORY = new Set(["undo", "request", "clearRequest", "phoneFriend", "audienceVote"]);

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` and `now` are injected — the core never calls Math.random
   * or Date.now itself.
   * @param {object} state @param {{type:string}} event
   * @param {function} [rng] @param {number} [now]
   */
  function reduce(state, event, rng, now) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = HANDLERS[event.type];
    if (!handler) return state;
    const at = Number.isFinite(now) ? now : 0;
    const next = handler(state, event, typeof rng === "function" ? rng : Math.random, at);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withHistory(state, next);
  }

  /** Which events would do something right now (host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    const probe = { history: [] };
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      const sample = SAMPLE_EVENTS[type] || { type };
      const next = HANDLERS[type](state, Object.assign({ type }, sample), () => 0, 0);
      void probe;
      return !!next && next !== state;
    });
  }

  // Representative payloads so legalActions can probe payload-carrying events.
  const SAMPLE_EVENTS = {
    select: { idx: 0 },
    seat: { pid: null },
    fffPick: { pid: null },
    fffSubmit: { pid: null, order: [0, 1, 2, 3], at: 0 },
    audienceVote: { pid: null, idx: 0 },
    audienceHostChart: { pcts: [25, 25, 25, 25] },
    phoneFriend: { name: "" },
    request: { pid: null, which: "fifty" },
  };

  /* ============ Setting up and picking a contestant ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    const withFff = state.game.settings.fastestFinger && state.game.fastestFinger.length > 0;
    return Object.assign({}, state, {
      phase: withFff ? "fff" : "pick",
      fff: blankFff(),
      notice: "",
    });
  }

  function evFffOpen(state, ev, rng, now) {
    if (state.phase !== "fff" || state.fff.open) return state;
    const draw = drawFff(state.game, state.fff.used, rng);
    if (!draw.question) return state;
    return Object.assign({}, state, {
      fff: {
        question: draw.question, open: true, openedAt: now, submissions: [],
        revealed: false, winner: null, used: state.fff.used.concat([draw.question.id]),
      },
      notice: draw.wrapped ? "Fastest Finger questions have wrapped." : "",
    });
  }

  function evFffSubmit(state, ev) {
    const { fff } = state;
    if (state.phase !== "fff" || !fff.open || fff.revealed || !fff.question) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || !isEligible(state, pid)) return state;
    if (!Content.isPermutation(ev.order)) return state;
    if (fff.submissions.some((s) => s.pid === pid)) return state;   // one go each
    const at = Number.isFinite(ev.at) ? ev.at : 0;
    const row = { pid, order: ev.order.slice(), at, correct: orderIsCorrect(fff.question, ev.order) };
    // Arrival order is authoritative and ties are impossible: a later `at`
    // never jumps ahead of one already logged.
    const submissions = fff.submissions.concat([row]).sort((a, b) => a.at - b.at);
    return Object.assign({}, state, { fff: Object.assign({}, fff, { submissions }) });
  }

  function evFffReveal(state) {
    const { fff } = state;
    if (state.phase !== "fff" || !fff.question || fff.revealed) return state;
    const won = fff.submissions.find((s) => s.correct);
    return Object.assign({}, state, {
      fff: Object.assign({}, fff, { open: false, revealed: true, winner: won ? won.pid : null }),
      notice: won ? "" : "Nobody got it right — the host picks the hot seat.",
    });
  }

  function evFffPick(state, ev) {
    if (state.phase !== "fff") return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || !isEligible(state, pid)) return state;
    return Object.assign({}, state, {
      fff: Object.assign({}, state.fff, { open: false, revealed: true, winner: pid }),
      notice: "",
    });
  }

  function evSeat(state, ev, rng) {
    if (state.phase !== "fff" && state.phase !== "pick") return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || !isEligible(state, pid)) return state;
    const seated = Object.assign({}, state, blankQuestionSlate(), {
      phase: "hotseat",
      current: pid,
      rung: 1,
      lifelines: Object.assign({}, state.game.settings.lifelines),
      outcome: null,
      request: null,
    });
    return Object.assign(seated, questionFor(seated, 1, rng));
  }

  /* ============ Playing a question ============ */

  function evSelect(state, ev) {
    if (state.phase !== "hotseat" || state.locked || state.revealed || !state.question) return state;
    if (!isIntIn(ev.idx, 0, 3) || state.removed.indexOf(ev.idx) >= 0) return state;
    if (state.selected === ev.idx) return state;
    return Object.assign({}, state, { selected: ev.idx });
  }

  function evLock(state) {
    if (state.phase !== "hotseat" || state.locked || state.revealed) return state;
    if (!isIntIn(state.selected, 0, 3)) return state;
    return Object.assign({}, state, {
      locked: true, request: null,
      audience: Object.assign({}, state.audience, { open: false }),
      phone: Object.assign({}, state.phone, { open: false }),
    });
  }

  function evReveal(state) {
    if (state.phase !== "hotseat" || !state.locked || state.revealed || !state.question) return state;
    const correct = state.selected === state.question.answer;
    const last = state.rung >= rungCount(state);
    let outcome = null;
    if (!correct) outcome = { pid: state.current, won: winningsIfWrong(state), reason: "wrong" };
    else if (last) outcome = { pid: state.current, won: rungValue(state, state.rung), reason: "million" };
    return Object.assign({}, state, { revealed: true, correct, outcome, notice: "" });
  }

  function evWalkAway(state) {
    if (state.phase !== "hotseat" || state.locked || state.revealed || !state.current) return state;
    return commitResult(state, { pid: state.current, won: winningsIfWalk(state), reason: "walk" });
  }

  function evNextQuestion(state, ev, rng) {
    if (state.phase !== "hotseat" || !state.revealed) return state;
    if (state.outcome) return commitResult(state, state.outcome);
    const rung = state.rung + 1;
    const next = Object.assign({}, state, blankQuestionSlate(), { rung, request: null });
    return Object.assign(next, questionFor(next, rung, rng));
  }

  function evNextContestant(state) {
    if (state.phase !== "result") return state;
    const waiting = waitingContestants(state);
    if (!waiting.length) return Object.assign({}, state, { phase: "standings", current: null, request: null });
    const withFff = state.game.settings.fastestFinger && state.game.fastestFinger.length > 0;
    return Object.assign({}, state, blankQuestionSlate(), {
      phase: withFff ? "fff" : "pick",
      current: null, rung: 1, outcome: null, request: null, notice: "",
      fff: Object.assign(blankFff(), { used: state.fff.used.slice() }),
    });
  }

  function evFinish(state) {
    if (state.phase === "standings" || state.phase === "setup") return state;
    return Object.assign({}, state, { phase: "standings", request: null });
  }

  /* ============ Lifelines ============ */

  function evUseFifty(state, ev, rng) {
    if (state.phase !== "hotseat" || !state.lifelines.fifty) return state;
    if (state.locked || state.revealed || !state.question) return state;
    const removed = fiftyFiftyPair(state.question, rng);
    return Object.assign({}, state, {
      removed,
      selected: removed.indexOf(state.selected) >= 0 ? null : state.selected,
      lifelines: Object.assign({}, state.lifelines, { fifty: false }),
      request: null,
    });
  }

  function evUsePhone(state, ev, rng, now) {
    if (state.phase !== "hotseat" || !state.lifelines.phone) return state;
    if (state.locked || state.revealed) return state;
    const seconds = state.game.settings.phoneSeconds;
    return Object.assign({}, state, {
      phone: { open: true, friend: "", deadline: seconds > 0 ? now + seconds * 1000 : null, seconds },
      lifelines: Object.assign({}, state.lifelines, { phone: false }),
      request: null,
    });
  }

  function evPhoneFriend(state, ev) {
    if (!state.phone.open) return state;
    const friend = cleanText(ev.name, NAME_MAX);
    if (friend === state.phone.friend) return state;
    return Object.assign({}, state, { phone: Object.assign({}, state.phone, { friend }) });
  }

  function evPhoneDone(state) {
    if (!state.phone.open) return state;
    return Object.assign({}, state, { phone: Object.assign({}, state.phone, { open: false, deadline: null }) });
  }

  function evUseAudience(state, ev, rng, now) {
    if (state.phase !== "hotseat" || !state.lifelines.audience) return state;
    if (state.locked || state.revealed) return state;
    const seconds = state.game.settings.audienceSeconds;
    return Object.assign({}, state, {
      audience: {
        open: true, votes: {}, chart: null, source: null, seconds,
        deadline: seconds > 0 ? now + seconds * 1000 : null,
      },
      lifelines: Object.assign({}, state.lifelines, { audience: false }),
      request: null,
    });
  }

  function evAudienceVote(state, ev, rng, now) {
    const a = state.audience;
    if (!a.open || !isIntIn(ev.idx, 0, 3)) return state;
    if (state.removed.indexOf(ev.idx) >= 0) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    // The contestant never votes in their own audience, and one phone is one
    // vote: the first tap counts and later ones are ignored.
    if (!pid || pid === state.current) return state;
    if (Object.prototype.hasOwnProperty.call(a.votes, pid)) return state;
    if (Number.isFinite(a.deadline) && now > a.deadline) return state;
    const votes = Object.assign({}, a.votes);
    votes[pid] = ev.idx;
    return Object.assign({}, state, { audience: Object.assign({}, a, { votes }) });
  }

  function evAudienceHostChart(state, ev) {
    if (!state.audience.open || !Array.isArray(ev.pcts)) return state;
    return Object.assign({}, state, {
      audience: Object.assign({}, state.audience, {
        chart: largestRemainder(ev.pcts), source: "host",
      }),
    });
  }

  function evAudienceClose(state) {
    const a = state.audience;
    if (!a.open) return state;
    const frozen = Array.isArray(a.chart) ? a.chart.slice() : largestRemainder(voteCounts(state));
    return Object.assign({}, state, {
      audience: Object.assign({}, a, {
        open: false, deadline: null, chart: frozen, source: a.source || "votes",
      }),
    });
  }

  function evUseSwitch(state, ev, rng) {
    if (state.phase !== "hotseat" || !state.lifelines.switch) return state;
    if (state.locked || state.revealed || !state.question) return state;
    const draw = drawQuestion(state.game, state.question.level, state.used, rng);
    if (!draw.question || draw.question.id === state.question.id) return state;
    return Object.assign({}, state, blankQuestionSlate(), {
      question: draw.question,
      used: state.used.concat([draw.question.id]),
      wrapped: state.wrapped || draw.wrapped,
      lifelines: Object.assign({}, state.lifelines, { switch: false }),
      request: null,
      notice: "Question switched.",
    });
  }

  /* ============ Phone intents awaiting the host ============ */

  function evRequest(state, ev, rng, now) {
    if (state.phase !== "hotseat" || state.revealed) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || pid !== state.current) return state;
    const which = ev.which;
    if (which !== "walk" && LIFELINE_KEYS.indexOf(which) < 0) return state;
    if (which !== "walk" && !state.lifelines[which]) return state;
    if (state.request && state.request.which === which && state.request.pid === pid) return state;
    return Object.assign({}, state, { request: { pid, which, at: now } });
  }

  function evClearRequest(state) {
    if (!state.request) return state;
    return Object.assign({}, state, { request: null });
  }

  /* ============ Undo ============ */

  function evUndo(state) {
    if (!Array.isArray(state.history) || !state.history.length) return state;
    const prev = state.history[state.history.length - 1];
    return Object.assign({}, prev, {
      game: state.game,
      history: state.history.slice(0, -1),
    });
  }

  /* ============ Export ============ */

  return {
    // constants
    PHASES, LETTERS, MAX_CONTESTANTS, MIN_QUESTIONS, LIFELINE_KEYS, NAME_MAX,
    DEFAULT_MONEY_TREE, DEFAULT_SAFE_HAVENS, DEFAULT_SETTINGS, DEFAULT_LIFELINES,
    // content
    validateGame, normalizeGame, warningsFor, drawQuestion, drawFff,
    fiftyFiftyPair, largestRemainder, cleanText,
    // state
    createState, reduce, legalActions,
    // money
    rungValue, bankedValue, winningsIfWalk, winningsIfWrong, isSafeHaven,
    moneyTreeView, formatMoney, rungCount,
    // roster
    nameOf, isEligible, waitingContestants, standings,
    // questions
    publicQuestion, optionRows, optionState,
    // audience
    chart, voteCounts, secondsLeft,
    // fastest finger
    fffRows, fffAnswer, orderIsCorrect,
    // phones
    validatePhoneMsg, phoneView,
  };
});
