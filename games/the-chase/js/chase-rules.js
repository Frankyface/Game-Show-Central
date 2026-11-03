/* ============================================================
   The Chase — the reducer (PURE)
   Every rule of the format from spec 15 §1 lives here: the Cash
   Builder, the three offers, the seven-step board, the catch and
   the two halves of the Final Chase. Immutable: a handler returns
   a new state or the state it was given, and never mutates its
   inputs. Clocks are deadline timestamps with `now` injected, so
   the whole night is testable in Node.

   Loaded between chase-content.js and chase-core.js;
   chase-core.js re-exports all of this, so callers only ever
   touch ChaseCore.

   THE RULE THIS FILE ENFORCES: a locked answer is a secret. The
   reducer keeps both locks, but nothing outside it may read the
   other side's lock before that side is revealed — see
   chase-core.js `phoneView`, which is the only masked surface.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./chase-content.js") : root.ChaseContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.ChaseRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail,
    normalizeGame, drawOrder, itemAt, NAME_MAX, PID_MAX, MAX_CONTESTANTS, OPTION_COUNT,
  } = Content;

  /* ============ Constants ============ */

  const PHASES = Object.freeze([
    "setup", "cashBuilder", "offer", "headToHead", "finalTeam", "finalChaser", "result", "standings",
  ]);
  const MARKS = Object.freeze(["correct", "wrong", "pass"]);
  const SIDES = Object.freeze(["contestant", "chaser"]);
  const CHOICES = Object.freeze(["higher", "middle", "lower"]);
  const MAX_HISTORY = 40;

  /** Clock events describe the passage of time, not a decision: undo skips them. */
  const NO_HISTORY = new Set([
    "cbStart", "cbPause", "cbExpired",
    "finalTeamStart", "finalTeamPause", "finalTeamExpired",
    "finalChaserStart", "finalChaserPause", "finalChaserExpired",
    "undo",
  ]);

  /** @typedef {{running:boolean, deadline:number|null, remainingMs:number}} Clock */

  /* ============ Construction ============ */

  function freshClock(seconds) {
    return { running: false, deadline: null, remainingMs: Math.max(0, Math.round(seconds * 1000)) };
  }

  /** Up to four contestants, cleaned. Throws with a plain-English message. */
  function normalizeContestants(list) {
    if (!Array.isArray(list) || !list.length) fail("The Chase needs at least one contestant.");
    if (list.length > MAX_CONTESTANTS) fail(`The Chase seats at most ${MAX_CONTESTANTS} contestants.`);
    const seen = new Set();
    return list.map((raw, i) => {
      if (!isPlainObject(raw)) fail(`Contestant ${i + 1} is missing.`);
      const pid = cleanText(raw.pid, PID_MAX);
      const name = cleanText(raw.name, NAME_MAX);
      if (!pid || !name) fail(`Contestant ${i + 1} needs a name.`);
      if (seen.has(pid)) fail(`${name} cannot sit in two seats.`);
      seen.add(pid);
      return { pid, name };
    });
  }

  /** The Chaser: the host by default, or one named player on a phone. */
  function normalizeChaser(raw, settings, contestants) {
    const wanted = isPlainObject(raw) ? raw : {};
    const isHost = wanted.isHost === undefined ? settings.chaserIsHost !== false : wanted.isHost !== false;
    const pid = isHost ? null : cleanText(wanted.pid, PID_MAX);
    if (!isHost && !pid) fail("Pick the player who is the Chaser, or make the host the Chaser.");
    if (pid && contestants.some((c) => c.pid === pid)) {
      fail("The Chaser cannot also be a contestant.");
    }
    return { isHost, pid: pid || null, name: cleanText(wanted.name, NAME_MAX) || settings.chaserName };
  }

  /**
   * Build the state for one game.
   * @param {object} game the content file
   * @param {{contestants:object[], chaser?:object, shuffle?:boolean, rng?:() => number}} opts
   */
  function createState(game, opts) {
    const g = normalizeGame(game);
    const o = opts || {};
    const contestants = normalizeContestants(o.contestants);
    return {
      phase: "setup",
      game: g,
      contestants,
      chaser: normalizeChaser(o.chaser, g.settings, contestants),
      order: drawOrder(g, { shuffle: !!o.shuffle, rng: o.rng }),
      shuffled: !!o.shuffle,
      rapidCursor: 0,
      multiCursor: 0,
      repeating: false,
      seat: 0,
      results: contestants.map((c) => ({
        pid: c.pid, name: c.name, cash: 0, amount: 0, played: 0, choice: null, outcome: "pending",
      })),
      cb: null,
      offer: null,
      h2h: null,
      final: null,
      outcome: null,
      history: [],
    };
  }

  /* ============ Immutable patch helpers ============ */

  function patch(state, fields) {
    return Object.assign({}, state, fields);
  }

  function withCb(state, fields) {
    return patch(state, { cb: Object.assign({}, state.cb, fields) });
  }

  function withH2h(state, fields) {
    return patch(state, { h2h: Object.assign({}, state.h2h, fields) });
  }

  function withFinal(state, fields) {
    return patch(state, { final: Object.assign({}, state.final, fields) });
  }

  function withResult(state, seat, fields) {
    return patch(state, {
      results: state.results.map((r, i) => (i === seat ? Object.assign({}, r, fields) : r)),
    });
  }

  function startClock(clock, at) {
    return { running: true, deadline: at + clock.remainingMs, remainingMs: clock.remainingMs };
  }

  function pauseClock(clock, at) {
    return { running: false, deadline: null, remainingMs: Math.max(0, (clock.deadline || 0) - at) };
  }

  /** A clock that has run out. A fresh object every time: state is never shared. */
  function deadClock() {
    return { running: false, deadline: null, remainingMs: 0 };
  }

  /* ============ Drawing questions ============ */

  function nextRapid(state) {
    const drawn = itemAt(state.order.rapid, state.rapidCursor);
    return {
      item: drawn.item,
      rapidCursor: state.rapidCursor + 1,
      repeating: state.repeating || drawn.repeating,
    };
  }

  function nextMulti(state) {
    const drawn = itemAt(state.order.multi, state.multiCursor);
    return {
      item: drawn.item,
      multiCursor: state.multiCursor + 1,
      repeating: state.repeating || drawn.repeating,
    };
  }

  /* ============ Cash Builder ============ */

  function freshCb(state, seat) {
    const drawn = nextRapid(state);
    return patch(state, {
      phase: "cashBuilder",
      seat,
      rapidCursor: drawn.rapidCursor,
      repeating: drawn.repeating,
      offer: null,
      h2h: null,
      cb: {
        seat,
        clock: freshClock(state.game.settings.cashBuilderSeconds),
        correct: 0, wrong: 0, passed: 0,
        item: drawn.item,
        started: false, expired: false, finished: false,
        log: [],
      },
    });
  }

  function evStart(state) {
    if (state.phase !== "setup") return state;
    return freshCb(state, 0);
  }

  function evCbStart(state, ev, at) {
    const cb = state.cb;
    if (state.phase !== "cashBuilder" || !cb || cb.finished || cb.expired) return state;
    if (cb.clock.running || cb.clock.remainingMs <= 0) return state;
    return withCb(state, { started: true, clock: startClock(cb.clock, at) });
  }

  function evCbPause(state, ev, at) {
    const cb = state.cb;
    if (state.phase !== "cashBuilder" || !cb || !cb.clock.running) return state;
    return withCb(state, { clock: pauseClock(cb.clock, at) });
  }

  function evCbExpired(state) {
    const cb = state.cb;
    if (state.phase !== "cashBuilder" || !cb || !cb.clock.running) return state;
    return withCb(state, { expired: true, clock: deadClock() });
  }

  /**
   * The host judges the answer the contestant just said. A pause is the host
   * stopping play, so nothing is judged off the clock — except the question in
   * flight when the buzzer has gone, which the show always completes. That one
   * mark closes the Cash Builder.
   */
  function evCbMark(state, ev) {
    const cb = state.cb;
    if (state.phase !== "cashBuilder" || !cb || cb.finished) return state;
    if (!cb.clock.running && !cb.expired) return state;
    if (MARKS.indexOf(ev.result) < 0) return state;
    const counts = {
      correct: cb.correct + (ev.result === "correct" ? 1 : 0),
      wrong: cb.wrong + (ev.result === "wrong" ? 1 : 0),
      passed: cb.passed + (ev.result === "pass" ? 1 : 0),
    };
    const log = cb.log.concat([{ result: ev.result, q: cb.item ? cb.item.q : "" }]).slice(-60);
    if (cb.expired) {
      return bankCash(withCb(state, Object.assign({ finished: true, item: null, log }, counts)));
    }
    const drawn = nextRapid(state);
    return withCb(patch(state, { rapidCursor: drawn.rapidCursor, repeating: drawn.repeating }),
      Object.assign({ item: drawn.item, log }, counts));
  }

  /** Write the Cash Builder total onto this contestant's result row. */
  function bankCash(state) {
    return withResult(state, state.seat, { cash: state.cb.correct * state.game.settings.cashBuilderValue });
  }

  /* ============ The offers ============ */

  /**
   * The three amounts, and the step each one starts the contestant on. Higher
   * is one step closer to the Chaser, lower one step nearer home; both are
   * clamped to the board. A contestant who built nothing is still offered a
   * real high and low, the way the show does.
   */
  function offersFor(state) {
    const s = state.game.settings;
    const cash = state.results[state.seat].cash;
    const higher = cash > 0 ? cash * s.higherMultiplier : s.cashBuilderValue * s.higherMultiplier;
    const lower = cash > 0 ? Math.max(1, Math.round(cash / s.lowerDivisor)) : s.cashBuilderValue;
    return {
      higher: { amount: higher, step: Math.min(s.startStep + 1, s.steps - 1) },
      middle: { amount: cash, step: s.startStep },
      lower: { amount: lower, step: Math.max(s.startStep - 1, 1) },
    };
  }

  function evOfferPhase(state) {
    return patch(state, { phase: "offer", offer: offersFor(state) });
  }

  function evOffer(state, ev) {
    if (state.phase !== "offer" || !state.offer) return state;
    if (CHOICES.indexOf(ev.choice) < 0) return state;
    const picked = state.offer[ev.choice];
    const withChoice = withResult(state, state.seat, {
      choice: ev.choice, amount: picked.amount, played: picked.amount,
    });
    return dealH2h(patch(withChoice, {
      phase: "headToHead",
      h2h: {
        amount: picked.amount,
        choice: ev.choice,
        cPos: picked.step,
        hPos: state.game.settings.steps,
        startPos: picked.step,
        q: null,
        asked: 0,
        locks: { contestant: null, chaser: null },
        revealed: { contestant: false, chaser: false },
        moved: { contestant: false, chaser: false },
        outcome: null,
        log: [],
      },
    }));
  }

  /* ============ Head to head ============ */

  function dealH2h(state) {
    const drawn = nextMulti(state);
    return withH2h(patch(state, { multiCursor: drawn.multiCursor, repeating: drawn.repeating }), {
      q: drawn.item,
      asked: state.h2h.asked + 1,
      locks: { contestant: null, chaser: null },
      revealed: { contestant: false, chaser: false },
      moved: { contestant: false, chaser: false },
    });
  }

  /** A side commits to an option. Re-lockable until that side is revealed. */
  function evLock(state, ev) {
    const h = state.h2h;
    if (state.phase !== "headToHead" || !h || h.outcome || !h.q) return state;
    if (SIDES.indexOf(ev.side) < 0 || !isIntIn(ev.idx, 0, OPTION_COUNT - 1)) return state;
    if (h.revealed[ev.side]) return state;
    const locks = Object.assign({}, h.locks);
    locks[ev.side] = ev.idx;
    return withH2h(state, { locks });
  }

  function evRevealContestant(state) {
    const h = state.h2h;
    if (state.phase !== "headToHead" || !h || h.outcome || !h.q) return state;
    if (h.locks.contestant === null || h.revealed.contestant) return state;
    const right = h.locks.contestant === h.q.answer;
    const cPos = right ? h.cPos - 1 : h.cPos;
    const next = withH2h(state, {
      cPos,
      revealed: Object.assign({}, h.revealed, { contestant: true }),
      moved: Object.assign({}, h.moved, { contestant: right }),
      log: h.log.concat([{ side: "contestant", right }]).slice(-40),
    });
    return cPos <= 0 ? finishH2h(next, "home") : next;
  }

  function evRevealChaser(state) {
    const h = state.h2h;
    if (state.phase !== "headToHead" || !h || h.outcome || !h.q) return state;
    if (!h.revealed.contestant || h.locks.chaser === null || h.revealed.chaser) return state;
    const right = h.locks.chaser === h.q.answer;
    const hPos = right ? h.hPos - 1 : h.hPos;
    const next = withH2h(state, {
      hPos,
      revealed: Object.assign({}, h.revealed, { chaser: true }),
      moved: Object.assign({}, h.moved, { chaser: right }),
      log: h.log.concat([{ side: "chaser", right }]).slice(-40),
    });
    return hPos <= next.h2h.cPos ? finishH2h(next, "caught") : next;
  }

  /** Caught, or home with the money. Written onto the contestant's row at once. */
  function finishH2h(state, outcome) {
    const home = outcome === "home";
    return withResult(withH2h(state, { outcome }), state.seat, {
      outcome,
      amount: home ? state.h2h.amount : 0,
    });
  }

  /* ============ Moving on ============ */

  /** The generic "carry on": the same button all night. */
  function evNextQuestion(state) {
    if (state.phase === "cashBuilder") return cbNext(state);
    if (state.phase === "headToHead") return h2hNext(state);
    if (state.phase === "finalTeam") return finalTeamNext(state);
    if (state.phase === "result") return patch(state, { phase: "standings" });
    return state;
  }

  function cbNext(state) {
    const cb = state.cb;
    if (!cb) return state;
    if (cb.finished) return evOfferPhase(state);
    if (cb.expired) return bankCash(withCb(state, { finished: true, item: null }));
    return state;
  }

  function h2hNext(state) {
    const h = state.h2h;
    if (!h || h.outcome) return state;
    if (!h.revealed.contestant || !h.revealed.chaser) return state;
    return dealH2h(state);
  }

  /** After the interstitial: the next hot seat, or the Final Chase. */
  function evNextContestant(state) {
    if (state.phase !== "headToHead" || !state.h2h || !state.h2h.outcome) return state;
    const seat = state.seat + 1;
    if (seat < state.contestants.length) return freshCb(state, seat);
    return openFinal(state);
  }

  /* ============ The Final Chase ============ */

  /** Everyone who got home, in seat order. */
  function finalistsOf(state) {
    return state.results.filter((r) => r.outcome === "home").map((r) => ({ pid: r.pid, name: r.name }));
  }

  function headStartFor(state, finalists) {
    const s = state.game.settings;
    if (!finalists.length) return 0;
    return Math.max(s.minHeadStart, finalists.length * s.headStartPerMember);
  }

  /**
   * Nobody home means there is no Final Chase at all — the Chaser has taken the
   * lot and the result screen says so.
   */
  function openFinal(state) {
    const finalists = finalistsOf(state);
    if (!finalists.length) return settleFinal(patch(state, { final: null }), false);
    const s = state.game.settings;
    const drawn = nextRapid(state);
    return patch(state, {
      phase: "finalTeam",
      rapidCursor: drawn.rapidCursor,
      repeating: drawn.repeating,
      final: {
        finalists,
        headStart: headStartFor(state, finalists),
        teamSteps: headStartFor(state, finalists),
        chaserSteps: 0,
        teamClock: freshClock(s.finalSeconds),
        chaserClock: freshClock(s.finalSeconds),
        item: drawn.item,
        teamCorrect: 0, teamWrong: 0, teamPassed: 0,
        chaserCorrect: 0, chaserWrong: 0, chaserPassed: 0,
        pushbacks: 0,
        pushback: null,
        teamStarted: false, teamExpired: false, teamFinished: false,
        chaserStarted: false, chaserExpired: false, chaserFinished: false,
        caught: false,
        log: [],
      },
    });
  }

  function evFinalTeamStart(state, ev, at) {
    const f = state.final;
    if (state.phase !== "finalTeam" || !f || f.teamFinished || f.teamExpired) return state;
    if (f.teamClock.running || f.teamClock.remainingMs <= 0) return state;
    return withFinal(state, { teamStarted: true, teamClock: startClock(f.teamClock, at) });
  }

  function evFinalTeamPause(state, ev, at) {
    const f = state.final;
    if (state.phase !== "finalTeam" || !f || !f.teamClock.running) return state;
    return withFinal(state, { teamClock: pauseClock(f.teamClock, at) });
  }

  /** The buzzer ends the team's two minutes; the host then brings the Chaser on. */
  function evFinalTeamExpired(state) {
    const f = state.final;
    if (state.phase !== "finalTeam" || !f || !f.teamClock.running) return state;
    return withFinal(state, {
      teamExpired: true, teamFinished: true, item: null, teamClock: deadClock(),
    });
  }

  function evFinalTeamMark(state, ev) {
    const f = state.final;
    if (state.phase !== "finalTeam" || !f || f.teamFinished || !f.teamClock.running) return state;
    if (MARKS.indexOf(ev.result) < 0) return state;
    const right = ev.result === "correct";
    const drawn = nextRapid(state);
    return withFinal(patch(state, { rapidCursor: drawn.rapidCursor, repeating: drawn.repeating }), {
      teamSteps: f.teamSteps + (right ? 1 : 0),
      teamCorrect: f.teamCorrect + (right ? 1 : 0),
      teamWrong: f.teamWrong + (ev.result === "wrong" ? 1 : 0),
      teamPassed: f.teamPassed + (ev.result === "pass" ? 1 : 0),
      item: drawn.item,
      log: f.log.concat([{ who: "team", result: ev.result }]).slice(-80),
    });
  }

  function finalTeamNext(state) {
    const f = state.final;
    if (!f) return state;
    if (!f.teamFinished) {
      if (!f.teamStarted) return state;
      return withFinal(state, { teamFinished: true, item: null, teamClock: deadClock() });
    }
    const drawn = nextRapid(state);
    return withFinal(patch(state, {
      phase: "finalChaser", rapidCursor: drawn.rapidCursor, repeating: drawn.repeating,
    }), { item: drawn.item });
  }

  /* ---- the Chaser's two minutes ---- */

  function evFinalChaserStart(state, ev, at) {
    const f = state.final;
    if (state.phase !== "finalChaser" || !f || f.chaserFinished || f.chaserExpired) return state;
    if (f.chaserClock.running || f.chaserClock.remainingMs <= 0) return state;
    return withFinal(state, { chaserStarted: true, chaserClock: startClock(f.chaserClock, at) });
  }

  function evFinalChaserPause(state, ev, at) {
    const f = state.final;
    if (state.phase !== "finalChaser" || !f || !f.chaserClock.running) return state;
    return withFinal(state, { chaserClock: pauseClock(f.chaserClock, at) });
  }

  /** Time up with the Chaser short of the target: the team have won the lot. */
  function evFinalChaserExpired(state) {
    const f = state.final;
    if (state.phase !== "finalChaser" || !f || !f.chaserClock.running) return state;
    return settleFinal(withFinal(state, {
      chaserExpired: true, chaserFinished: true, pushback: null, item: null,
      chaserClock: deadClock(),
    }), true);
  }

  /**
   * The Chaser answers. A miss is not simply lost: it is offered to the team,
   * and the round waits for `pushback` before the next question.
   */
  function evFinalChaserMark(state, ev, at) {
    const f = state.final;
    if (state.phase !== "finalChaser" || !f || f.chaserFinished || f.pushback) return state;
    if (!f.chaserClock.running) return state;
    if (MARKS.indexOf(ev.result) < 0) return state;
    if (ev.result === "wrong") {
      return withFinal(state, {
        chaserWrong: f.chaserWrong + 1,
        pushback: { q: f.item ? f.item.q : "", a: f.item ? f.item.a : "" },
        log: f.log.concat([{ who: "chaser", result: "wrong" }]).slice(-80),
      });
    }
    const right = ev.result === "correct";
    const chaserSteps = f.chaserSteps + (right ? 1 : 0);
    const caught = chaserSteps >= f.teamSteps;
    const moved = withFinal(state, {
      chaserSteps,
      chaserCorrect: f.chaserCorrect + (right ? 1 : 0),
      chaserPassed: f.chaserPassed + (right ? 0 : 1),
      log: f.log.concat([{ who: "chaser", result: ev.result }]).slice(-80),
    });
    return caught ? catchTeam(moved, at) : advanceChaser(moved);
  }

  /** The catch stops the Chaser's clock where it stood: "with N seconds to spare". */
  function catchTeam(state, at) {
    return settleFinal(withFinal(state, {
      caught: true, chaserFinished: true, item: null, pushback: null,
      chaserClock: pauseClock(state.final.chaserClock, at),
    }), false);
  }

  function advanceChaser(state) {
    const drawn = nextRapid(state);
    return withFinal(patch(state, { rapidCursor: drawn.rapidCursor, repeating: drawn.repeating }),
      { item: drawn.item });
  }

  /** The team take the Chaser's miss. A correct answer pushes him back a step. */
  function evPushback(state, ev) {
    const f = state.final;
    if (state.phase !== "finalChaser" || !f || !f.pushback || f.chaserFinished) return state;
    if (typeof ev.correct !== "boolean") return state;
    const back = ev.correct && f.chaserSteps > 0;
    return advanceChaser(withFinal(state, {
      chaserSteps: back ? f.chaserSteps - 1 : f.chaserSteps,
      pushbacks: f.pushbacks + (ev.correct ? 1 : 0),
      pushback: null,
      log: f.log.concat([{ who: "pushback", result: ev.correct ? "correct" : "wrong" }]).slice(-80),
    }));
  }

  /* ============ Settling up ============ */

  /** The bank: every amount a contestant carried home. */
  function bankOf(state) {
    return state.results.reduce((sum, r) => sum + (r.outcome === "home" ? r.amount : 0), 0);
  }

  /**
   * An even split, to the last unit: the remainder goes one each to the
   * finalists in seat order rather than vanishing to rounding.
   */
  function splitBank(bank, finalists) {
    const n = finalists.length;
    if (!n) return [];
    const base = Math.floor(bank / n);
    const rem = bank - base * n;
    return finalists.map((f, i) => ({ pid: f.pid, name: f.name, amount: base + (i < rem ? 1 : 0) }));
  }

  function settleFinal(state, teamWon) {
    const f = state.final;
    const finalists = f ? f.finalists : [];
    const bank = bankOf(state);
    return patch(state, {
      phase: "result",
      outcome: {
        teamWon: !!teamWon && finalists.length > 0,
        bank,
        finalists,
        share: teamWon && finalists.length ? splitBank(bank, finalists)
          : finalists.map((x) => ({ pid: x.pid, name: x.name, amount: 0 })),
        teamSteps: f ? f.teamSteps : 0,
        chaserSteps: f ? f.chaserSteps : 0,
        headStart: f ? f.headStart : 0,
        pushbacks: f ? f.pushbacks : 0,
        played: !!f,
      },
    });
  }

  /** End the night from wherever we are. */
  function evFinish(state) {
    if (state.phase === "standings") return state;
    const settled = state.outcome ? state : settleFinal(state, false);
    return patch(settled, { phase: "standings" });
  }

  function evUndo(state) {
    if (!state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return patch(previous, { history: state.history.slice(0, -1) });
  }

  /* ============ The reducer ============ */

  const HANDLERS = {
    start: evStart,
    cbStart: evCbStart,
    cbPause: evCbPause,
    cbExpired: evCbExpired,
    cbMark: evCbMark,
    offer: evOffer,
    lock: evLock,
    revealContestant: evRevealContestant,
    revealChaser: evRevealChaser,
    nextQuestion: evNextQuestion,
    nextContestant: evNextContestant,
    finalTeamStart: evFinalTeamStart,
    finalTeamPause: evFinalTeamPause,
    finalTeamExpired: evFinalTeamExpired,
    finalTeamMark: evFinalTeamMark,
    finalChaserStart: evFinalChaserStart,
    finalChaserPause: evFinalChaserPause,
    finalChaserExpired: evFinalChaserExpired,
    finalChaserMark: evFinalChaserMark,
    pushback: evPushback,
    finish: evFinish,
    undo: evUndo,
  };

  /** A history entry never contains its own history. */
  function snapshot(state) {
    return patch(state, { history: [] });
  }

  /**
   * Apply `event` to `state`. Illegal or unknown events return `state`
   * unchanged (never throw), so a hostile phone frame can only be ignored.
   * `now` is injected; the core never calls Date.now.
   * @param {object} state @param {{type:string}} event @param {number} [now]
   */
  function reduce(state, event, now) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const at = Number.isFinite(event.now) ? event.now : (Number.isFinite(now) ? now : 0);
    const next = handler(state, event, at);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return patch(next, { history: state.history.concat([snapshot(state)]).slice(-MAX_HISTORY) });
  }

  /* ============ Export ============ */

  return {
    createState, reduce, freshClock, normalizeContestants, normalizeChaser,
    offersFor, bankOf, splitBank, headStartFor, finalistsOf,
    PHASES, MARKS, SIDES, CHOICES, MAX_HISTORY, NO_HISTORY,
  };
});
