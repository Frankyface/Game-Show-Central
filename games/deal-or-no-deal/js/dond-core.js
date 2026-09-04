/* ============================================================
   Deal or No Deal — pure game core
   The immutable reducer and every selector the host UI and the
   phone screens read. No DOM, no network, no timers, no clock:
   every random choice takes an injected `rng`, so the whole
   format is testable in Node. Runs in the browser
   (globalThis.DondCore, after js/dond-content.js) and in Node
   (module.exports). Reducers never mutate their inputs.

   Content validation, the shuffle and the banker's arithmetic
   live in dond-content.js and are re-exported here, so every
   caller only needs DondCore.

   The one rule that governs this file: the amounts inside
   unopened cases exist ONLY in `state.cases`. `phoneView` never
   carries them, and every money value a phone receives is a
   pre-formatted string, never a raw number (spec 12 §5, N-U10).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./dond-content.js") : root.DondContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.DondCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail, largestRemainder,
    validateBoard, normalizeBoard, warningsFor, shuffle, offerFrom, niceOffer,
    DEFAULT_AMOUNTS, DEFAULT_ROUNDS, DEFAULT_FACTORS, DEFAULT_SETTINGS,
    NAME_MAX, PID_MAX, MAX_CASES,
  } = Content;

  /* ============ Constants ============ */

  const MAX_CONTESTANTS = 16;
  const MAX_HISTORY = 60;               // undo depth
  const ADVICE_CHOICES = Object.freeze(["deal", "no"]);

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze([
    "setup",     // building the line-up
    "seat",      // choosing who plays next
    "pick",      // the contestant picks the case they keep
    "round",     // opening cases; `toOpen` counts down, 0 = the banker calls
    "offer",     // an offer is on the table; Deal or No Deal
    "swap",      // two cases left and the file allows the swap
    "reveal",    // opening cases for the win / the would-have-won
    "result",    // this contestant is done
    "standings", // the night is over
  ]);

  /**
   * @typedef {{pid:string, name:string}} Seat
   * @typedef {{n:number, amount:number, opened:boolean}} Case
   * @typedef {{pid:string, name:string, won:number, out:boolean,
   *            reason:string|null}} Contestant
   */

  /* ============ State construction ============ */

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
    if (!out.length) fail("Deal or No Deal needs at least one contestant.");
    if (out.length > MAX_CONTESTANTS) fail(`Deal or No Deal takes at most ${MAX_CONTESTANTS} contestants.`);
    return out;
  }

  function blankAdvice() {
    return { open: false, votes: {}, chart: null, round: null };
  }

  /** Everything that belongs to one contestant's board and nothing else. */
  function blankBoard() {
    return {
      cases: [], own: null, round: 0, toOpen: 0, offer: null, offers: [],
      deal: null, swapped: false, lastOpened: null, advice: blankAdvice(),
      // What the contestant's phone has ASKED for. It is never acted on: the
      // host presses the button (spec 12 §5, "intent only; host confirms").
      request: null,
      outcome: null,
    };
  }

  /**
   * Build the opening state. `options` is accepted for symmetry with the other
   * games; the reducer takes its rng per call, so nothing random is stored.
   * @param {unknown} board @param {Seat[]} players @param {object} [options]
   */
  function createState(board, players, options) {
    const g = normalizeBoard(board);
    const roster = normalizePlayers(players);
    void (isPlainObject(options) ? options : {});
    return Object.assign({
      phase: "setup",
      game: g,
      roster,
      contestants: roster.map((p) => ({ pid: p.pid, name: p.name, won: 0, out: false, reason: null })),
      current: null,
      notice: "",
      history: [],
    }, blankBoard());
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

  function settingsOf(state) {
    return (state && state.game && state.game.settings) || DEFAULT_SETTINGS;
  }

  function caseByN(state, n) {
    return (state.cases || []).find((c) => c.n === n) || null;
  }

  /** A new `cases` array with case `n` opened; the input is never touched. */
  function openOne(cases, n) {
    return cases.map((c) => (c.n === n ? Object.assign({}, c, { opened: true }) : c));
  }

  /** Write a finished contestant's result into the line-up and show it. */
  function commitResult(state, outcome) {
    const contestants = state.contestants.map((c) => (c.pid === outcome.pid
      ? Object.assign({}, c, { won: outcome.won, out: true, reason: outcome.reason })
      : c));
    return Object.assign({}, state, { phase: "result", contestants, outcome });
  }

  /* ============ Selectors — the board ============ */

  function unopenedCases(state) {
    return (state.cases || []).filter((c) => !c.opened);
  }

  /** Unopened cases other than the one the contestant is holding. */
  function otherCases(state) {
    return unopenedCases(state).filter((c) => c.n !== state.own);
  }

  function remainingAmounts(state) {
    return unopenedCases(state).map((c) => c.amount);
  }

  /**
   * The expected value on the board: the mean of every amount still sealed,
   * INCLUDING the contestant's own case. 0 when nothing is left.
   */
  function ev(state) {
    const left = remainingAmounts(state);
    if (!left.length) return 0;
    return left.reduce((a, b) => a + b, 0) / left.length;
  }

  /** The factor for the round being offered on; the last one keeps applying. */
  function factorFor(state) {
    const factors = settingsOf(state).offerFactors;
    if (!factors || !factors.length) return 1;
    return factors[Math.min(Math.max(state.round, 0), factors.length - 1)];
  }

  /** `offer = niceOffer(EV x factor x (1 + jitter))` — spec 12 §1.3. */
  function offerFor(state, rng) {
    return offerFrom(ev(state), factorFor(state), settingsOf(state).jitter, rng);
  }

  function formatMoney(state, amount) {
    const cur = settingsOf(state).currency || "$";
    const n = Number(amount) || 0;
    const frac = Math.abs(n % 1) > 0 ? 2 : 0;
    return cur + n.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: 2 });
  }

  /**
   * The two-column amount board: the low half on the left, the high half on
   * the right, each row flagged `opened` so the UI can strike it through.
   * Before a board is dealt every row reads as still in play.
   * @returns {{left:object[], right:object[]}}
   */
  function boardColumns(state) {
    const amounts = settingsOf(state).amounts || [];
    const dealt = (state.cases || []).length > 0;
    const live = new Set(remainingAmounts(state));
    const rows = amounts.map((amount) => ({
      amount,
      label: formatMoney(state, amount),
      opened: dealt ? !live.has(amount) : false,
    }));
    const half = Math.ceil(rows.length / 2);
    return { left: rows.slice(0, half), right: rows.slice(half) };
  }

  /** One row per case for the host grid. */
  function casesView(state) {
    return (state.cases || []).map((c) => ({
      n: c.n,
      opened: c.opened,
      own: c.n === state.own,
      last: c.n === state.lastOpened,
      label: c.opened ? formatMoney(state, c.amount) : "",
    }));
  }

  /** Cases still to be opened for the reveal, lowest number first (N-U8). */
  function revealOrder(state) {
    return otherCases(state).map((c) => c.n).sort((a, b) => a - b);
  }

  /** What is inside the case the contestant is holding; null while sealed. */
  function ownAmount(state) {
    const own = caseByN(state, state.own);
    return own ? own.amount : null;
  }

  /* ============ Selectors — roster ============ */

  function nameOf(state, pid) {
    const found = (state.contestants || []).find((c) => c.pid === pid);
    if (found) return found.name;
    const seat = (state.roster || []).find((p) => p.pid === pid);
    return seat ? seat.name : "";
  }

  /** Somebody who has not yet had their turn with the cases. */
  function isEligible(state, pid) {
    return (state.contestants || []).some((c) => c.pid === pid && !c.out);
  }

  function waitingContestants(state) {
    return (state.contestants || []).filter((c) => !c.out);
  }

  /** Highest winnings first; people who have not played keep their seat order. */
  function standings(state) {
    return (state.contestants || [])
      .map((c, i) => Object.assign({}, c, { seat: i }))
      .sort((a, b) => (b.out - a.out) || (b.won - a.won) || (a.seat - b.seat))
      .map((row) => {
        const copy = Object.assign({}, row);
        delete copy.seat;
        return copy;
      });
  }

  /* ============ Selectors — audience advice ============ */

  function adviceCounts(state) {
    const votes = (state.advice && state.advice.votes) || {};
    const counts = [0, 0];
    Object.keys(votes).forEach((pid) => {
      const at = ADVICE_CHOICES.indexOf(votes[pid]);
      if (at >= 0) counts[at] += 1;
    });
    return counts;
  }

  /**
   * The Deal / No Deal split. A frozen chart (kept when the vote closed) wins
   * over the live count. @returns {{counts:number[], pcts:number[],
   * total:number, source:string|null}}
   */
  function adviceChart(state) {
    const counts = adviceCounts(state);
    const total = counts[0] + counts[1];
    const frozen = state.advice && Array.isArray(state.advice.chart);
    return {
      counts,
      pcts: frozen ? state.advice.chart.slice() : largestRemainder(counts),
      total,
      source: frozen ? "closed" : (total ? "votes" : null),
    };
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    seat: evSeat,
    pickCase: evPickCase,
    openCase: evOpenCase,
    bankerOffer: evBankerOffer,
    deal: evDeal,
    noDeal: evNoDeal,
    adviceVote: evAdviceVote,
    adviceClose: evAdviceClose,
    request: evRequest,
    clearRequest: evClearRequest,
    swap: evSwap,
    revealRest: evRevealRest,
    revealOwn: evRevealOwn,
    nextContestant: evNextContestant,
    finish: evFinish,
    undo: evUndo,
  };

  // Bookkeeping that is not worth an undo step.
  const NO_HISTORY = new Set(["undo", "adviceVote", "request", "clearRequest"]);

  // Representative payloads so legalActions can probe payload-carrying events.
  const SAMPLE_EVENTS = {
    seat: { pid: null },
    pickCase: { n: 0 },
    openCase: { n: 0 },
    adviceVote: { pid: null, choice: "deal" },
    request: { pid: null, choice: "deal" },
    swap: { yes: false },
  };

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` is injected — the core never calls Math.random itself.
   * @param {object} state @param {{type:string}} event @param {function} [rng]
   */
  function reduce(state, event, rng) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = HANDLERS[event.type];
    if (!handler) return state;
    const next = handler(state, event, typeof rng === "function" ? rng : Math.random);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withHistory(state, next);
  }

  /** Which events would do something right now (host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      const sample = SAMPLE_EVENTS[type] || {};
      const probe = Object.assign({ type }, sample);
      // A sample payload can only prove an event legal, never illegal, so the
      // case-carrying events are probed against every case on the board.
      if (type === "pickCase" || type === "openCase") {
        return (state.cases || []).some((c) => HANDLERS[type](state, { type, n: c.n }, () => 0) !== state);
      }
      if (type === "seat") {
        return waitingContestants(state).some((c) => evSeat(state, { type, pid: c.pid }, () => 0) !== state);
      }
      const next = HANDLERS[type](state, probe, () => 0);
      return !!next && next !== state;
    });
  }

  /* ============ Setting up and seating a contestant ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    if (!waitingContestants(state).length) return state;
    return Object.assign({}, state, { phase: "seat", notice: "" });
  }

  /** Seat a contestant and deal a fresh, shuffled board of cases. */
  function evSeat(state, event, rng) {
    if (state.phase !== "seat") return state;
    const pid = cleanText(event.pid, PID_MAX);
    if (!pid || !isEligible(state, pid)) return state;
    const amounts = shuffle(settingsOf(state).amounts, rng);
    const cases = amounts.map((amount, i) => ({ n: i + 1, amount, opened: false }));
    return Object.assign({}, state, blankBoard(), {
      phase: "pick", current: pid, cases, notice: "",
    });
  }

  /* ============ Picking and opening cases ============ */

  function evPickCase(state, event) {
    if (state.phase !== "pick") return state;
    const target = caseByN(state, event.n);
    if (!target || target.opened) return state;
    const rounds = settingsOf(state).rounds;
    return Object.assign({}, state, {
      phase: "round", own: target.n, round: 0, toOpen: rounds[0] || 0,
      lastOpened: null, notice: "",
    });
  }

  function evOpenCase(state, event) {
    if (state.phase !== "round" || state.toOpen <= 0) return state;
    const target = caseByN(state, event.n);
    if (!target || target.opened || target.n === state.own) return state;
    return Object.assign({}, state, {
      cases: openOne(state.cases, target.n),
      toOpen: state.toOpen - 1,
      lastOpened: target.n,
      notice: "",
    });
  }

  /* ============ The banker ============ */

  function evBankerOffer(state, event, rng) {
    if (state.phase !== "round" || state.toOpen !== 0) return state;
    if (!otherCases(state).length) return state;
    const offer = offerFor(state, rng);
    return Object.assign({}, state, {
      phase: "offer",
      offer,
      offers: state.offers.concat([{ round: state.round, offer, ev: ev(state) }]),
      advice: {
        open: !!settingsOf(state).audienceAdvice, votes: {}, chart: null, round: state.round,
      },
      notice: "",
    });
  }

  /** Freeze whatever the room voted, so the split survives on screen. */
  function closedAdvice(state) {
    const a = state.advice || blankAdvice();
    const frozen = Array.isArray(a.chart) ? a.chart.slice() : largestRemainder(adviceCounts(state));
    return Object.assign({}, a, { open: false, chart: frozen });
  }

  function evDeal(state) {
    if (state.phase !== "offer" || !Number.isFinite(state.offer)) return state;
    return Object.assign({}, state, {
      phase: "reveal",
      deal: { offer: state.offer, round: state.round },
      advice: closedAdvice(state),
      request: null,
      notice: "",
    });
  }

  function evNoDeal(state) {
    if (state.phase !== "offer") return state;
    const rounds = settingsOf(state).rounds;
    const advice = closedAdvice(state);
    const more = state.round + 1 < rounds.length;
    if (more) {
      return Object.assign({}, state, {
        phase: "round", round: state.round + 1, toOpen: rounds[state.round + 1],
        offer: null, advice, request: null, notice: "",
      });
    }
    const swappable = settingsOf(state).allowSwap && otherCases(state).length === 1;
    return Object.assign({}, state, {
      phase: swappable ? "swap" : "reveal", offer: null, advice, request: null, notice: "",
    });
  }

  /* ============ Audience advice ============ */

  function evAdviceVote(state, event) {
    const a = state.advice;
    if (!a || !a.open) return state;
    if (ADVICE_CHOICES.indexOf(event.choice) < 0) return state;
    const pid = cleanText(event.pid, PID_MAX);
    // The contestant never advises themselves, and one phone is one vote: the
    // first tap counts and later ones are ignored.
    if (!pid || pid === state.current) return state;
    if (Object.prototype.hasOwnProperty.call(a.votes, pid)) return state;
    const votes = Object.assign({}, a.votes);
    votes[pid] = event.choice;
    return Object.assign({}, state, { advice: Object.assign({}, a, { votes }) });
  }

  function evAdviceClose(state) {
    if (!state.advice || !state.advice.open) return state;
    return Object.assign({}, state, { advice: closedAdvice(state) });
  }

  /* ============ The contestant's intent, awaiting the host ============ */

  /**
   * The contestant's phone says Deal or No Deal. Nothing happens: the host
   * sees a banner and presses the button. Only the contestant may ask, and
   * only while an offer is actually on the table.
   */
  function evRequest(state, event) {
    if (state.phase !== "offer") return state;
    if (ADVICE_CHOICES.indexOf(event.choice) < 0) return state;
    const pid = cleanText(event.pid, PID_MAX);
    if (!pid || pid !== state.current) return state;
    if (state.request && state.request.choice === event.choice) return state;
    return Object.assign({}, state, { request: { pid, choice: event.choice } });
  }

  function evClearRequest(state) {
    if (!state.request) return state;
    return Object.assign({}, state, { request: null });
  }

  /* ============ The swap and the reveal ============ */

  function evSwap(state, event) {
    if (state.phase !== "swap") return state;
    const others = otherCases(state);
    if (others.length !== 1) return state;
    if (event.yes !== true) {
      return Object.assign({}, state, { phase: "reveal", swapped: false, notice: "" });
    }
    return Object.assign({}, state, { phase: "reveal", own: others[0].n, swapped: true, notice: "" });
  }

  function evRevealRest(state) {
    if (state.phase !== "reveal") return state;
    const next = revealOrder(state)[0];
    if (next === undefined) return state;
    return Object.assign({}, state, {
      cases: openOne(state.cases, next), lastOpened: next, notice: "",
    });
  }

  /**
   * Open the contestant's own case: the win on a No Deal, the would-have-won
   * after a Deal. A board can never end with one lone mystery, so a single
   * remaining case is opened with it.
   */
  function evRevealOwn(state) {
    if (state.phase !== "reveal" || !state.current) return state;
    const own = caseByN(state, state.own);
    if (!own || own.opened) return state;
    let cases = openOne(state.cases, own.n);
    const leftover = cases.filter((c) => !c.opened);
    if (leftover.length === 1) cases = openOne(cases, leftover[0].n);
    const won = state.deal ? state.deal.offer : own.amount;
    const next = Object.assign({}, state, { cases, lastOpened: own.n });
    return commitResult(next, {
      pid: state.current,
      won,
      wouldHaveWon: own.amount,
      reason: state.deal ? "deal" : "case",
      swapped: state.swapped,
    });
  }

  /* ============ Between contestants ============ */

  function evNextContestant(state) {
    if (state.phase !== "result") return state;
    const waiting = waitingContestants(state);
    if (!waiting.length) {
      return Object.assign({}, state, blankBoard(), { phase: "standings", current: null, notice: "" });
    }
    return Object.assign({}, state, blankBoard(), { phase: "seat", current: null, notice: "" });
  }

  /**
   * End the night. A contestant caught mid-board is banked first — at the
   * offer they accepted if they had already dealt, otherwise at nothing, which
   * is exactly what walking out on a sealed case is worth.
   */
  function evFinish(state) {
    if (state.phase === "setup" || state.phase === "standings") return state;
    let next = state;
    if (state.current && isEligible(state, state.current)) {
      next = commitResult(state, {
        pid: state.current,
        won: state.deal ? state.deal.offer : 0,
        wouldHaveWon: ownAmount(state),
        reason: state.deal ? "deal" : "unfinished",
        swapped: state.swapped,
      });
    }
    return Object.assign({}, next, { phase: "standings", current: null, notice: "" });
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

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame. @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "pick") return isIntIn(obj.n, 1, MAX_CASES) ? { t: "pick", n: obj.n } : null;
    if (obj.t === "decision" || obj.t === "advice") {
      return ADVICE_CHOICES.indexOf(obj.choice) >= 0 ? { t: obj.t, choice: obj.choice } : null;
    }
    return null;
  }

  /** The case grid a phone may see: a number, whether it is open, and — only
      once it IS open — what was inside. */
  function phoneCases(state) {
    return (state.cases || []).map((c) => ({
      n: c.n,
      opened: c.opened,
      own: c.n === state.own,
      label: c.opened ? formatMoney(state, c.amount) : "",
    }));
  }

  /**
   * What phone `pid` should render. Never contains the amount inside an
   * unopened case, and every money value is a formatted string (N-U10).
   */
  function phoneView(state, pid) {
    const base = {
      screen: "wait",
      name: nameOf(state, pid),
      hotName: nameOf(state, state.current),
      mine: state.current === pid,
      spectator: !(state.contestants || []).some((c) => c.pid === pid),
      round: Math.min(state.round + 1, settingsOf(state).rounds.length),
      rounds: settingsOf(state).rounds.length,
      sub: "",
    };
    if (state.phase === "result" || state.phase === "standings") return resultPhoneView(state, pid, base);
    if (state.phase === "pick" || state.phase === "round") return pickPhoneView(state, pid, base);
    if (state.phase === "offer") return offerPhoneView(state, pid, base);
    if (state.phase === "swap") {
      return Object.assign(base, {
        sub: base.mine ? "Keep your case or swap it? Tell the host." : `${base.hotName} is deciding whether to swap.`,
      });
    }
    if (state.phase === "reveal") {
      return Object.assign(base, { sub: base.mine ? "Here it comes." : "Opening the last cases." });
    }
    return Object.assign(base, { sub: "The host is still setting up." });
  }

  function resultPhoneView(state, pid, base) {
    const mine = state.outcome && state.outcome.pid === pid;
    return Object.assign(base, {
      screen: "result",
      standings: standings(state).map((c) => ({
        name: c.name, won: formatMoney(state, c.won), out: c.out,
      })),
      yours: mine ? formatMoney(state, state.outcome.won) : null,
    });
  }

  function pickPhoneView(state, pid, base) {
    if (!base.mine) {
      return Object.assign(base, {
        sub: state.phase === "pick"
          ? `${base.hotName} is choosing a case to keep.`
          : `${base.hotName} is opening cases.`,
      });
    }
    return Object.assign(base, {
      screen: "pick",
      mode: state.phase === "pick" ? "own" : "open",
      cases: phoneCases(state),
      own: state.own,
      toOpen: state.toOpen,
      sub: pickSub(state),
    });
  }

  /** What the contestant's own phone is being asked for right now. */
  function pickSub(state) {
    if (state.phase === "pick") return "Pick the case you want to keep.";
    if (state.toOpen === 0) return "That is the round — the banker is about to call.";
    return `Open ${state.toOpen} more ${state.toOpen === 1 ? "case" : "cases"}.`;
  }

  function offerPhoneView(state, pid, base) {
    const offer = formatMoney(state, state.offer);
    if (base.mine) {
      const asked = state.request && state.request.pid === pid ? state.request.choice : null;
      return Object.assign(base, {
        screen: "decision", offer, asked,
        sub: asked
          ? "Told the host — wait for them to confirm it."
          : "The banker is offering this. Deal or no deal? The host confirms it.",
      });
    }
    if (state.advice && state.advice.open) {
      const voted = Object.prototype.hasOwnProperty.call(state.advice.votes, pid);
      return Object.assign(base, {
        screen: "advice", offer,
        myVote: voted ? state.advice.votes[pid] : null,
        sub: voted ? "Thanks — your advice is in." : `What should ${base.hotName} do?`,
      });
    }
    return Object.assign(base, { sub: `The banker offered ${offer}.` });
  }

  /* ============ Export ============ */

  return {
    // constants
    PHASES, ADVICE_CHOICES, MAX_CONTESTANTS, MAX_HISTORY, NAME_MAX, PID_MAX,
    DEFAULT_AMOUNTS, DEFAULT_ROUNDS, DEFAULT_FACTORS, DEFAULT_SETTINGS,
    // content (re-exported so callers only ever need DondCore)
    validateBoard, validateGame: validateBoard, normalizeBoard, warningsFor,
    shuffle, niceOffer, cleanText,
    // state
    createState, reduce, legalActions,
    // board
    unopenedCases, otherCases, remainingAmounts, ev, factorFor, offerFor,
    boardColumns, casesView, revealOrder, ownAmount, caseByN, formatMoney,
    // roster
    nameOf, isEligible, waitingContestants, standings,
    // advice
    adviceCounts, adviceChart,
    // phones
    validatePhoneMsg, phoneView, phoneCases,
  };
});
