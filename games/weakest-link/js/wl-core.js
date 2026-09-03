/* ============================================================
   Weakest Link — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no timers, no network: the clock is
   stored as deadline timestamps and `now` is injected, so the
   whole format is testable in Node. Runs in the browser
   (globalThis.WlCore, after js/wl-content.js) and in Node
   (module.exports). Reducers are pure: they never mutate inputs.

   Content validation lives in wl-content.js and is re-exported
   here, so every caller only needs WlCore.
   ============================================================ */

"use strict";

(function (root, factory) {
  const content = (typeof module === "object" && module.exports)
    ? require("./wl-content.js")
    : root.WlContent;
  const api = factory(content);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WlCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isPosInt, cleanText, fail,
    validateGame, normalizeGame, warningsFor, buildOrder,
    DEFAULT_CHAIN, DEFAULT_ROUND_SECONDS, DEFAULT_SETTINGS,
    MIN_QUESTIONS, WARN_QUESTIONS,
  } = Content;
  void isPosInt;   // re-exported for the editor; unused inside this file

  /* ============ Constants ============ */

  const MAX_PLAYERS = 12;
  // 2 is allowed so a head-to-head can be built directly in tests; the host
  // setup screen enforces the format's real floor of 3.
  const MIN_PLAYERS = 2;
  const NAME_MAX = 24;
  const NAME_FIELD_MAX = 240;   // structural cap on raw phone-supplied names
  const PID_MAX = 24;           // structural cap on a pid coming off the wire
  const MAX_HISTORY = 60;       // undo depth

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze([
    "setup", "round", "voting", "voteResult", "tiebreak", "goodbye",
    "finalIntro", "final", "suddenDeath", "result",
  ]);

  /**
   * @typedef {{pid:string, name:string}} WlPlayer
   * @typedef {{correct:number, wrong:number, banked:number}} Stat
   * @typedef {{running:boolean, deadline:number|null, remainingMs:number}} Clock
   */

  /* ============ State construction ============ */

  function blankStat() {
    return { correct: 0, wrong: 0, banked: 0 };
  }

  function statsFor(pids) {
    const out = {};
    pids.forEach((pid) => { out[pid] = blankStat(); });
    return out;
  }

  /** Normalise the roster; throws when it cannot make a playable team. */
  function normalizePlayers(players) {
    if (!Array.isArray(players)) fail("The player list is missing.");
    const seen = new Set();
    const out = [];
    players.forEach((p, i) => {
      if (!isPlainObject(p)) return;
      const pid = cleanText(p.pid, PID_MAX);
      const name = cleanText(p.name, NAME_MAX);
      if (!pid || !name || seen.has(pid)) return;
      seen.add(pid);
      out.push({ pid, name, seat: i });
    });
    if (out.length < MIN_PLAYERS) fail(`Weakest Link needs at least ${MIN_PLAYERS} players — there are ${out.length}.`);
    if (out.length > MAX_PLAYERS) fail(`Weakest Link takes at most ${MAX_PLAYERS} players.`);
    return out.map((p) => ({ pid: p.pid, name: p.name }));
  }

  /**
   * @param {unknown} game
   * @param {WlPlayer[]} players
   * @param {{shuffle?:boolean, rng?:() => number}} [options]
   */
  function createState(game, players, options) {
    const g = normalizeGame(game);
    const roster = normalizePlayers(players);
    const opts = isPlainObject(options) ? options : {};
    const pids = roster.map((p) => p.pid);
    return {
      phase: "setup",
      game: g,
      players: roster,
      active: pids.slice(),
      eliminated: [],
      roundIndex: 0,
      turnPid: pids[0],
      chainIndex: 0,
      roundBank: 0,
      total: 0,
      lastRoundBank: 0,
      clock: { running: false, deadline: null, remainingMs: roundMs(g, 0) },
      expired: false,
      order: buildOrder(g.questions.length, !!opts.shuffle, opts.rng),
      qIndex: 0,
      repeating: false,
      shuffled: !!opts.shuffle,
      stats: statsFor(pids),
      roundStats: statsFor(pids),
      roundHistory: [],
      votes: {},
      revealed: [],
      tied: null,
      tiebreakPid: null,
      eliminatedPid: null,
      final: null,
      finalBonus: 0,
      winnerPid: null,
      notice: "",
      past: [],
    };
  }

  /** Round length in ms; the last entry of roundSeconds repeats forever. */
  function roundMs(game, roundIndex) {
    const list = game.settings.roundSeconds;
    const idx = Math.min(Math.max(roundIndex, 0), list.length - 1);
    return list[idx] * 1000;
  }

  /* ============ Selectors ============ */

  /** Money currently riding on the chain (lost on a wrong answer). */
  function chainValue(state) {
    if (!state || !state.game || state.chainIndex <= 0) return 0;
    return state.game.settings.chain[state.chainIndex - 1];
  }

  /** The top link's value = the per-round maximum. */
  function chainTop(state) {
    const chain = state.game.settings.chain;
    return chain[chain.length - 1];
  }

  /** The value the NEXT correct answer would move the chain to (null at the top). */
  function nextChainValue(state) {
    const chain = state.game.settings.chain;
    return state.chainIndex < chain.length ? chain[state.chainIndex] : null;
  }

  /** The question on the table right now, or null when the pool is empty. */
  function currentQuestion(state) {
    if (!state.game || state.order.length === 0) return null;
    const idx = state.order[state.qIndex % state.order.length];
    return state.game.questions[idx] || null;
  }

  function playerName(state, pid) {
    const p = state.players.find((x) => x.pid === pid);
    return p ? p.name : "";
  }

  /** Stats map for a round: `roundIndex` omitted (or current) = the live round. */
  function statsForRound(state, roundIndex) {
    if (roundIndex === undefined || roundIndex === null || roundIndex >= state.roundHistory.length) {
      return state.roundStats;
    }
    const entry = state.roundHistory[roundIndex];
    return entry && entry.stats ? entry.stats : state.roundStats;
  }

  /**
   * Rank players for a round. `dir` 1 = strongest (most correct, then most
   * banked, then fewest wrong), -1 = weakest (fewest correct, then least
   * banked, then most wrong). Seat order is the stable final tie-break.
   */
  function rankBy(state, roundIndex, pool, dir) {
    const stats = statsForRound(state, roundIndex);
    const seats = state.players.map((p) => p.pid);
    const list = (Array.isArray(pool) && pool.length ? pool : Object.keys(stats))
      .filter((pid) => stats[pid]);
    const sorted = list.slice().sort((a, b) => {
      const sa = stats[a];
      const sb = stats[b];
      if (sa.correct !== sb.correct) return (sb.correct - sa.correct) * dir;
      if (sa.banked !== sb.banked) return (sb.banked - sa.banked) * dir;
      if (sa.wrong !== sb.wrong) return (sa.wrong - sb.wrong) * dir;
      return seats.indexOf(a) - seats.indexOf(b);
    });
    return sorted;
  }

  /** @returns {string|null} pid of the round's strongest link. */
  function strongestLink(state, roundIndex, pool) {
    const ranked = rankBy(state, roundIndex, pool, 1);
    return ranked.length ? ranked[0] : null;
  }

  /** @returns {string|null} pid of the round's weakest link (statistically). */
  function weakestLink(state, roundIndex, pool) {
    const ranked = rankBy(state, roundIndex, pool, -1);
    return ranked.length ? ranked[0] : null;
  }

  /** Full tally of every vote cast so far: `{targetPid: count}`. */
  function voteTally(state) {
    const out = {};
    Object.keys(state.votes).forEach((voter) => {
      const target = state.votes[voter];
      out[target] = (out[target] || 0) + 1;
    });
    return out;
  }

  /** Tally restricted to the votes already revealed on stage. */
  function revealedTally(state) {
    const out = {};
    state.revealed.forEach((voter) => {
      const target = state.votes[voter];
      if (target) out[target] = (out[target] || 0) + 1;
    });
    return out;
  }

  /** Reveal order = seat order of the players still in the game. */
  function voteOrder(state) {
    return state.active.filter((pid) => state.votes[pid]);
  }

  /** Targets with the most votes (length > 1 means a tie). */
  function voteLeaders(state) {
    const tally = voteTally(state);
    let best = -1;
    Object.keys(tally).forEach((pid) => { if (tally[pid] > best) best = tally[pid]; });
    if (best <= 0) return [];
    return state.active.filter((pid) => tally[pid] === best);
  }

  function formatMoney(state, amount) {
    const cur = state && state.game ? state.game.settings.currency : "$";
    return cur + Number(amount || 0).toLocaleString("en-US");
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload. Returns a narrow copy or null for junk
   * (callers ignore null; they never throw on a hostile frame).
   * @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "vote" || obj.t === "tiebreak") {
      if (typeof obj.target !== "string" || obj.target.length > PID_MAX) return null;
      const target = cleanText(obj.target, PID_MAX);
      if (!target) return null;
      return { t: obj.t, target };
    }
    return null;
  }

  /**
   * Is this vote legal right now? Host-authoritative: phones never decide.
   * @returns {boolean}
   */
  function canVote(state, voter, target) {
    if (state.phase !== "voting") return false;
    if (voter === target) return false;
    return state.active.indexOf(voter) >= 0 && state.active.indexOf(target) >= 0;
  }

  /**
   * What phone `pid` should render. Deliberately contains NO other player's
   * vote and NO answer text — the phone screen is a public surface.
   */
  function phoneView(state, pid) {
    const base = {
      screen: "wait",
      name: playerName(state, pid),
      bank: state.roundBank,
      total: state.total,
      currency: state.game ? state.game.settings.currency : "$",
      round: state.roundIndex + 1,
    };
    if (state.phase === "result") {
      return Object.assign(base, {
        screen: "result",
        winner: playerName(state, state.winnerPid),
        won: state.winnerPid === pid,
      });
    }
    if (state.eliminated.indexOf(pid) >= 0) {
      if (state.phase === "goodbye" && state.eliminatedPid === pid) {
        return Object.assign(base, { screen: "goodbye" });
      }
      return Object.assign(base, { screen: "out", standings: standings(state) });
    }
    return Object.assign(base, livePhoneView(state, pid));
  }

  /** The screens only a player still in the game can see. */
  function livePhoneView(state, pid) {
    if (state.phase === "voting") {
      return {
        screen: "vote",
        choices: state.active.filter((x) => x !== pid).map((x) => ({ pid: x, name: playerName(state, x) })),
        myVote: state.votes[pid] || null,
        castCount: Object.keys(state.votes).length,
        voterCount: state.active.length,
      };
    }
    if (state.phase === "tiebreak") {
      const chooser = state.tiebreakPid || null;
      if (chooser === pid) {
        return {
          screen: "tiebreak",
          choices: (state.tied || []).map((x) => ({ pid: x, name: playerName(state, x) })),
        };
      }
      return { screen: "wait", turnName: "", waitingFor: playerName(state, chooser) };
    }
    if (state.phase === "final" || state.phase === "suddenDeath") {
      return {
        screen: "final",
        turnName: playerName(state, state.turnPid),
        myTurn: state.turnPid === pid,
        tally: finalTally(state),
      };
    }
    if (state.phase === "goodbye" && state.eliminatedPid === pid) return { screen: "goodbye" };
    return { screen: "wait", turnName: playerName(state, state.turnPid), myTurn: state.turnPid === pid };
  }

  /** Head-to-head scoreline, safe to show anyone. */
  function finalTally(state) {
    if (!state.final) return [];
    return state.final.pids.map((pid) => ({
      pid,
      name: playerName(state, pid),
      answers: (state.final.results[pid] || []).slice(),
      correct: (state.final.results[pid] || []).filter(Boolean).length,
      asked: state.final.questionsEach,
    }));
  }

  /** Everyone in finishing order: the winner, the other survivors, then the
      eliminated with the most recent departure first. */
  function standings(state) {
    const live = state.winnerPid
      ? [state.winnerPid].concat(state.active.filter((pid) => pid !== state.winnerPid))
      : state.active;
    const rows = live.map((pid) => ({ pid, name: playerName(state, pid), out: false }));
    for (let i = state.eliminated.length - 1; i >= 0; i -= 1) {
      const pid = state.eliminated[i];
      rows.push({ pid, name: playerName(state, pid), out: true });
    }
    return rows;
  }

  /* ============ Reducer plumbing ============ */

  /**
   * A history entry drops the two constants (`game`, `order`) and its own
   * `past`, so undo stays exact while the saved state stays small enough for
   * localStorage.
   */
  function snapshot(state) {
    const copy = Object.assign({}, state);
    delete copy.game;
    delete copy.order;
    copy.past = [];
    return copy;
  }

  function withPast(state, next) {
    const past = state.past.concat([snapshot(state)]);
    return Object.assign({}, next, { past: past.slice(-MAX_HISTORY) });
  }

  function bumpStat(state, pid, field, amount) {
    const inc = amount === undefined ? 1 : amount;
    const stats = Object.assign({}, state.stats);
    const round = Object.assign({}, state.roundStats);
    stats[pid] = Object.assign({}, stats[pid] || blankStat());
    round[pid] = Object.assign({}, round[pid] || blankStat());
    stats[pid][field] += inc;
    round[pid][field] += inc;
    return { stats, roundStats: round };
  }

  /** Next active player after `pid`, wrapping. */
  function nextTurn(state, pid) {
    const list = state.active;
    if (list.length === 0) return null;
    const i = list.indexOf(pid);
    return list[(i + 1) % list.length];
  }

  /** Advance the question pointer, flagging a wrap as "repeating". */
  function advanceQuestion(state) {
    const nextIdx = state.qIndex + 1;
    if (state.order.length && nextIdx >= state.order.length) {
      return { qIndex: 0, repeating: true, notice: "Questions are repeating — the pool has wrapped." };
    }
    return { qIndex: nextIdx };
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    clockStart: evClockStart,
    clockPause: evClockPause,
    clockExpired: evClockExpired,
    bank: evBank,
    correct: (s) => evJudge(s, true),
    wrong: (s) => evJudge(s, false),
    endRound: evEndRound,
    vote: evVote,
    revealVote: evRevealVote,
    revealAll: evRevealAll,
    breakTie: evBreakTie,
    eliminate: evEliminate,
    nextRound: evNextRound,
    finalFirst: evFinalFirst,
    finalAnswer: evFinalAnswer,
    finish: evFinish,
    undo: evUndo,
  };

  // Events that are pure clock bookkeeping are not worth an undo step.
  const NO_HISTORY = new Set(["clockStart", "clockPause", "undo"]);

  /**
   * Apply `event` to `state`. Illegal or unknown events return `state`
   * unchanged. `now` is injected (never Date.now inside the core).
   * @param {object} state
   * @param {{type:string}} event
   * @param {number} [now]
   */
  function reduce(state, event, now) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = HANDLERS[event.type];
    if (!handler) return state;
    const at = Number.isFinite(now) ? now : 0;
    const next = handler(state, event, at);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withPast(state, next);
  }

  function evStart(state) {
    if (state.phase !== "setup") return state;
    return Object.assign({}, state, {
      phase: "round",
      turnPid: state.active[0],
      clock: { running: false, deadline: null, remainingMs: roundMs(state.game, 0) },
      expired: false,
      notice: "",
    });
  }

  function evClockStart(state, ev, now) {
    if (state.phase !== "round" || state.clock.running || state.clock.remainingMs <= 0) return state;
    return Object.assign({}, state, {
      clock: { running: true, deadline: now + state.clock.remainingMs, remainingMs: state.clock.remainingMs },
    });
  }

  function evClockPause(state, ev, now) {
    if (!state.clock.running) return state;
    const left = Math.max(0, (state.clock.deadline || 0) - now);
    return Object.assign({}, state, { clock: { running: false, deadline: null, remainingMs: left } });
  }

  function evClockExpired(state) {
    if (state.phase !== "round" || state.expired) return state;
    return Object.assign({}, state, {
      clock: { running: false, deadline: null, remainingMs: 0 },
      expired: true,
      notice: "Time is up — judge this question, then the round ends.",
    });
  }

  function evBank(state) {
    if (state.phase !== "round") return state;
    const value = chainValue(state);
    if (value <= 0) return state;
    const banked = Math.min(state.roundBank + value, chainTop(state));
    const gained = banked - state.roundBank;
    const bumped = bumpStat(state, state.turnPid, "banked", gained);
    return Object.assign({}, state, bumped, { roundBank: banked, chainIndex: 0, notice: "" });
  }

  /** Correct/wrong share the pool pointer, the expiry rule and the round end. */
  function evJudge(state, isCorrect) {
    if (state.phase !== "round") return state;
    const pid = state.turnPid;
    const bumped = bumpStat(state, pid, isCorrect ? "correct" : "wrong");
    let next = Object.assign({}, state, bumped, { turnPid: nextTurn(state, pid) },
      advanceQuestion(state));
    let endNow = state.expired;
    if (isCorrect) {
      const climbed = applyCorrect(next, pid);
      next = climbed.state;
      endNow = endNow || climbed.endRound;
    } else {
      next = Object.assign({}, next, { chainIndex: 0 });
    }
    return endNow ? endRoundFrom(next) : next;
  }

  /**
   * Climb the chain for `pid`. Completing the top link banks it automatically
   * (credited to that player) and, when configured, ends the round.
   * @returns {{state:object, endRound:boolean}}
   */
  function applyCorrect(state, pid) {
    const chain = state.game.settings.chain;
    const climbed = state.chainIndex + 1;
    if (climbed < chain.length) {
      return { state: Object.assign({}, state, { chainIndex: climbed }), endRound: false };
    }
    const top = chain[chain.length - 1];
    const banked = Math.min(state.roundBank + top, top);
    const bumped = bumpStat(state, pid, "banked", banked - state.roundBank);
    return {
      state: Object.assign({}, state, bumped, {
        chainIndex: 0,
        roundBank: banked,
        notice: "Top of the chain — banked automatically.",
      }),
      endRound: !!state.game.settings.topOfChainEndsRound,
    };
  }

  function evEndRound(state) {
    if (state.phase !== "round") return state;
    return endRoundFrom(state);
  }

  /** Bank -> total, snapshot the round's stats, then vote or go to the final. */
  function endRoundFrom(state) {
    const history = state.roundHistory.concat([{ stats: state.roundStats, bank: state.roundBank }]);
    const base = Object.assign({}, state, {
      total: state.total + state.roundBank,
      lastRoundBank: state.roundBank,
      roundHistory: history,
      clock: { running: false, deadline: null, remainingMs: 0 },
      expired: false,
      chainIndex: 0,
    });
    if (state.active.length > state.game.settings.finalPlayers) {
      return Object.assign(base, {
        phase: "voting", votes: {}, revealed: [], tied: null, tiebreakPid: null, eliminatedPid: null,
        notice: "Vote for the weakest link.",
      });
    }
    return enterFinal(base);
  }

  /** Triple the last full round's bank and set up the head-to-head. */
  function enterFinal(state) {
    const mult = state.game.settings.finalMultiplier;
    const bonus = state.lastRoundBank * (mult - 1);
    const pids = state.active.slice();
    const strongest = strongestLink(state, state.roundHistory.length - 1, pids);
    return Object.assign({}, state, {
      phase: "finalIntro",
      total: state.total + bonus,
      finalBonus: bonus,
      tiebreakPid: strongest,
      final: {
        pids,
        firstPid: null,
        questionsEach: state.game.settings.finalQuestionsEach,
        asked: 0,
        results: { [pids[0]]: [], [pids[1]]: [] },
        sudden: [],
      },
      notice: mult > 1
        ? `The bank is multiplied by ${mult}.`
        : "Head to head.",
    });
  }

  /* ============ Voting ============ */

  function evVote(state, ev) {
    if (!canVote(state, ev.voter, ev.target)) return state;
    if (state.revealed.length > 0) return state; // locked once the reveal starts
    const votes = Object.assign({}, state.votes);
    votes[ev.voter] = ev.target;
    return Object.assign({}, state, { votes, notice: "" });
  }

  function evRevealVote(state) {
    if (state.phase !== "voting") return state;
    const order = voteOrder(state);
    if (order.length < state.active.length) return state; // every vote must be in
    const nextVoter = order[state.revealed.length];
    if (!nextVoter) return state;
    const revealed = state.revealed.concat([nextVoter]);
    const withReveal = Object.assign({}, state, { revealed });
    if (revealed.length < order.length) return withReveal;
    return resolveVotes(withReveal);
  }

  function evRevealAll(state) {
    if (state.phase !== "voting") return state;
    const order = voteOrder(state);
    if (order.length < state.active.length) return state;
    return resolveVotes(Object.assign({}, state, { revealed: order }));
  }

  /** Majority leaves; a tie hands the decision to the round's strongest link. */
  function resolveVotes(state) {
    const leaders = voteLeaders(state);
    if (leaders.length === 1) {
      return Object.assign({}, state, {
        phase: "voteResult", eliminatedPid: leaders[0], tied: null,
        notice: `${playerName(state, leaders[0])} has the most votes.`,
      });
    }
    const strongest = strongestLink(state, state.roundHistory.length - 1, state.active);
    return Object.assign({}, state, {
      phase: "tiebreak", tied: leaders, eliminatedPid: null, tiebreakPid: strongest,
      notice: `It is a tie. ${playerName(state, strongest)} was the strongest link and decides.`,
    });
  }

  function evBreakTie(state, ev) {
    if (state.phase !== "tiebreak") return state;
    if (!Array.isArray(state.tied) || state.tied.indexOf(ev.target) < 0) return state;
    return Object.assign({}, state, {
      phase: "voteResult", eliminatedPid: ev.target, tied: null,
      notice: `${playerName(state, ev.target)} is voted off.`,
    });
  }

  function evEliminate(state) {
    if (state.phase !== "voteResult" || !state.eliminatedPid) return state;
    const gone = state.eliminatedPid;
    return Object.assign({}, state, {
      phase: "goodbye",
      active: state.active.filter((pid) => pid !== gone),
      eliminated: state.eliminated.concat([gone]),
      notice: "You are the weakest link. Goodbye.",
    });
  }

  function evNextRound(state) {
    if (state.phase !== "goodbye") return state;
    const roundIndex = state.roundIndex + 1;
    // TV rule: the previous round's strongest link (still in the game) starts.
    const starter = strongestLink(state, state.roundHistory.length - 1, state.active) || state.active[0];
    return Object.assign({}, state, {
      phase: "round",
      roundIndex,
      turnPid: starter,
      chainIndex: 0,
      roundBank: 0,
      clock: { running: false, deadline: null, remainingMs: roundMs(state.game, roundIndex) },
      expired: false,
      roundStats: statsFor(state.active),
      votes: {}, revealed: [], tied: null, tiebreakPid: null, eliminatedPid: null,
      notice: "",
    });
  }

  /* ============ Head-to-head ============ */

  function evFinalFirst(state, ev) {
    if (state.phase !== "finalIntro" || !state.final) return state;
    if (state.final.pids.indexOf(ev.pid) < 0) return state;
    return Object.assign({}, state, {
      phase: "final",
      turnPid: ev.pid,
      final: Object.assign({}, state.final, { firstPid: ev.pid }),
      notice: "",
    });
  }

  function evFinalAnswer(state, ev) {
    if (state.phase !== "final" && state.phase !== "suddenDeath") return state;
    if (typeof ev.correct !== "boolean") return state;
    const stepped = Object.assign({}, state, bumpStat(state, state.turnPid, ev.correct ? "correct" : "wrong"),
      advanceQuestion(state));
    return state.phase === "final" ? stepFinal(stepped, ev.correct) : stepSudden(stepped, ev.correct);
  }

  /** Five each, alternating; then a winner or sudden death. */
  function stepFinal(state, correct) {
    const f = state.final;
    const pid = state.turnPid;
    const results = Object.assign({}, f.results);
    results[pid] = (results[pid] || []).concat([correct]);
    const asked = f.asked + 1;
    const other = f.pids[0] === pid ? f.pids[1] : f.pids[0];
    const next = Object.assign({}, state, {
      final: Object.assign({}, f, { results, asked }),
      turnPid: other,
    });
    if (asked < f.questionsEach * 2) return next;
    const a = results[f.pids[0]].filter(Boolean).length;
    const b = results[f.pids[1]].filter(Boolean).length;
    if (a === b) {
      return Object.assign({}, next, {
        phase: "suddenDeath", turnPid: f.firstPid,
        notice: `${a} each — sudden death.`,
      });
    }
    return declareWinner(next, a > b ? f.pids[0] : f.pids[1]);
  }

  /** Sudden-death pairs: decided only when the pair splits. */
  function stepSudden(state, correct) {
    const f = state.final;
    const sudden = f.sudden.slice();
    const open = sudden.length && sudden[sudden.length - 1].length === 1
      ? sudden.length - 1 : -1;
    if (open >= 0) sudden[open] = sudden[open].concat([correct]);
    else sudden.push([correct]);
    const other = f.pids[0] === state.turnPid ? f.pids[1] : f.pids[0];
    const next = Object.assign({}, state, { final: Object.assign({}, f, { sudden }), turnPid: other });
    const pair = sudden[sudden.length - 1];
    if (pair.length < 2) return next;
    if (pair[0] === pair[1]) {
      return Object.assign({}, next, { turnPid: f.firstPid, notice: "Still level — another pair." });
    }
    const firstWon = pair[0] === true;
    return declareWinner(next, firstWon ? f.firstPid : otherOf(f, f.firstPid));
  }

  function otherOf(final, pid) {
    return final.pids[0] === pid ? final.pids[1] : final.pids[0];
  }

  function declareWinner(state, pid) {
    return Object.assign({}, state, {
      phase: "result", winnerPid: pid,
      notice: `${playerName(state, pid)} wins ${formatMoney(state, state.total)}.`,
    });
  }

  function evFinish(state) {
    if (state.phase === "result") return state;
    const pid = state.winnerPid || state.active[0] || null;
    return Object.assign({}, state, { phase: "result", winnerPid: pid });
  }

  /* ============ Undo ============ */

  function evUndo(state) {
    if (!state.past.length) return state;
    const prev = state.past[state.past.length - 1];
    return Object.assign({}, prev, {
      game: state.game, order: state.order, past: state.past.slice(0, -1),
    });
  }

  /* ============ Export ============ */

  return {
    // constants
    DEFAULT_SETTINGS, DEFAULT_CHAIN, DEFAULT_ROUND_SECONDS, PHASES,
    MIN_QUESTIONS, WARN_QUESTIONS, MAX_PLAYERS, NAME_MAX, NAME_FIELD_MAX,
    // content
    validateGame, normalizeGame, warningsFor, buildOrder,
    // state
    createState, reduce, roundMs,
    // selectors
    chainValue, chainTop, nextChainValue, currentQuestion, playerName,
    strongestLink, weakestLink, rankBy, statsForRound,
    voteTally, revealedTally, voteOrder, voteLeaders,
    finalTally, standings, formatMoney,
    // phones
    validatePhoneMsg, canVote, phoneView,
    // internals worth testing
    cleanText,
  };
});
