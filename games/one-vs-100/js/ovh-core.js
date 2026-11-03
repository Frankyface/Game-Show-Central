/* ============================================================
   1 vs 100 — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no network, no timers: the Mob's
   answer window lives as "how much is left" and only becomes an
   absolute deadline while it is actually running, `now` is
   injected, and every random choice takes an injected `rng`, so
   the whole format is testable in Node. Runs in the browser
   (globalThis.OvhCore, after js/ovh-content.js) and in Node
   (module.exports). Reducers never mutate their inputs.

   Content validation and the question draw live in
   ovh-content.js and are re-exported here, so every caller only
   needs OvhCore.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./ovh-content.js") : root.OvhContent;
  const phoneView = node ? require("./ovh-phoneview.js") : root.OvhPhoneView;
  const api = factory(content, phoneView);
  if (node) module.exports = api;
  root.OvhCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, PhoneView) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail,
    validateGame, normalizeGame, warningsFor,
    drawQuestion, levelForQuestion, perMemberValue, spreadWrong,
    DEFAULT_LADDER, DEFAULT_HELPS, DEFAULT_SETTINGS,
    HELP_KEYS, OPTION_COUNT, LEVEL_MAX, MIN_QUESTIONS,
    NAME_MAX, MIN_MOB, MAX_MOB,
  } = Content;

  /* ============ Constants ============ */

  const PID_MAX = 24;
  const MAX_HISTORY = 60;
  const LETTERS = ["A", "B", "C"];
  const MAX_ROSTER = 17;        // 16 phones + one host-typed contestant

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze(["setup", "question", "decision", "result", "standings"]);

  /** Fewer real Mob phones than this and the host runs a simulated Mob
      instead (spec 16 §1). */
  const MIN_PHONE_MOB = 3;

  const NO_QUESTION = "No question left at that level — open the editor or load another set.";

  /**
   * @typedef {{pid:string, name:string}} Seat
   * @typedef {{pid:string, name:string, seat:number, alive:boolean,
   *            out:number|null}} Member
   */

  /* ============ State construction ============ */

  /** Normalise the roster; throws when it cannot make a playable line-up. */
  function normalizePlayers(players) {
    if (!Array.isArray(players)) fail("The player list is missing.");
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
    if (!out.length) fail("1 vs 100 needs at least a contestant.");
    if (out.length > MAX_ROSTER) fail(`1 vs 100 takes at most ${MAX_ROSTER} people in the room.`);
    return out;
  }

  /** Everything that belongs to one question and nothing else. */
  function blankSlate(seconds) {
    return {
      question: null,
      open: false,
      closed: false,
      deadline: null,
      remainingMs: Number.isFinite(seconds) ? seconds * 1000 : 0,
      seconds: Number.isFinite(seconds) ? seconds : 0,
      answers: {},
      simWrong: null,
      locked: null,
      revealed: false,
      correct: null,
      eliminated: [],
      earned: 0,
      poll: false,
      ask: null,
      trust: false,
    };
  }

  /**
   * Build the opening state. `options` may carry `{contestant, simulated,
   * mobSize}`; nothing random is stored, so the reducer takes its rng per
   * call. @param {Seat[]} players
   */
  function createState(game, players, options) {
    const g = normalizeGame(game);
    const roster = normalizePlayers(players);
    const o = isPlainObject(options) ? options : {};
    const contestant = roster.some((p) => p.pid === o.contestant) ? o.contestant : roster[0].pid;
    const others = roster.length - 1;
    return {
      phase: "setup",
      game: g,
      roster,
      contestant,
      plan: {
        simulated: typeof o.simulated === "boolean" ? o.simulated : others < MIN_PHONE_MOB,
        size: isIntIn(o.mobSize, MIN_MOB, MAX_MOB) ? o.mobSize : g.settings.mobSize,
      },
      mob: { simulated: true, members: [] },
      qNumber: 0,
      used: [],
      wrapped: false,
      bank: 0,
      q: blankSlate(g.settings.answerSeconds),
      helps: Object.assign({}, g.settings.helps),
      outcome: null,
      notice: "",
      history: [],
    };
  }

  /** The Mob the game will actually play against. */
  function buildMob(state) {
    if (state.plan.simulated) {
      const size = Math.min(Math.max(state.plan.size, MIN_MOB), MAX_MOB);
      const members = [];
      for (let i = 0; i < size; i += 1) {
        members.push({ pid: `sim${i + 1}`, name: `Mob ${i + 1}`, seat: i + 1, alive: true, out: null });
      }
      return { simulated: true, members };
    }
    const members = state.roster
      .filter((p) => p.pid !== state.contestant)
      .map((p, i) => ({ pid: p.pid, name: p.name, seat: i + 1, alive: true, out: null }));
    return { simulated: false, members };
  }

  /* ============ Reducer plumbing ============ */

  /**
   * Stop a running answer window and keep what is left of it. An absolute
   * deadline is meaningless once the page (or the undo stack) has been away
   * from the wall clock, so every path that STORES a window stores it paused:
   * the history snapshot, `undo`, and ovh-app.js's save.
   * @param {object} q @param {number} now
   */
  function pauseWindow(q, now) {
    if (!q || !q.open || !Number.isFinite(q.deadline)) return q;
    return Object.assign({}, q, {
      open: false,
      deadline: null,
      remainingMs: Math.max(0, q.deadline - now),
    });
  }

  /** A history entry drops the one constant (`game`) and its own history, so
      undo stays exact while the saved state still fits in localStorage. */
  function snapshot(state) {
    const copy = Object.assign({}, state);
    delete copy.game;
    delete copy.history;
    return copy;
  }

  function withHistory(before, next, now) {
    const frozen = before.q && before.q.open
      ? Object.assign({}, before, { q: pauseWindow(before.q, now) })
      : before;
    const history = before.history.concat([snapshot(frozen)]);
    return Object.assign({}, next, {
      history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
    });
  }

  /** Draw the question for `n` (1-based) and fold it into a fresh slate. */
  function questionFor(state, n, rng) {
    const draw = drawQuestion(state.game, levelForQuestion(n), state.used, rng);
    const slate = blankSlate(state.game.settings.answerSeconds);
    if (!draw.question) return { q: slate, used: state.used, wrapped: state.wrapped, notice: NO_QUESTION };
    return {
      q: Object.assign(slate, { question: draw.question }),
      used: state.used.concat([draw.question.id]),
      wrapped: state.wrapped || draw.wrapped,
      notice: draw.wrapped ? "The question pool has wrapped — this one has been asked before." : "",
    };
  }

  /* ============ Selectors: money and the Mob ============ */

  function settings(state) {
    return (state && state.game && state.game.settings) || DEFAULT_SETTINGS;
  }

  function bank(state) {
    return state && Number.isFinite(state.bank) ? state.bank : 0;
  }

  /** What one eliminated Mob member is worth on question `n` (1-based). */
  function perMember(state, n) {
    const at = Number.isInteger(n) && n > 0 ? n : Math.max(1, state.qNumber);
    return perMemberValue(settings(state).ladder, at);
  }

  function members(state) {
    return (state && state.mob && Array.isArray(state.mob.members)) ? state.mob.members : [];
  }

  /** How many Mob members are still in. */
  function mobAlive(state) {
    return members(state).filter((m) => m.alive).length;
  }

  /**
   * Everyone who faced THIS question: the survivors plus whoever the reveal
   * has just knocked out. The split and the tiles read this, so the numbers on
   * screen do not collapse to the correct option the moment the reveal lands.
   */
  function facing(state) {
    return members(state).filter((m) => m.alive || m.out === state.qNumber);
  }

  function mobSize(state) {
    return members(state).length;
  }

  function formatMoney(state, amount) {
    return settings(state).currency + Number(amount || 0).toLocaleString("en-US");
  }

  function nameOf(state, pid) {
    const seat = (state.roster || []).find((p) => p.pid === pid);
    if (seat) return seat.name;
    const m = members(state).find((x) => x.pid === pid);
    return m ? m.name : "";
  }

  function contestantName(state) {
    return nameOf(state, state.contestant);
  }

  /** One row per Mob tile. `answered` is a bare boolean while the window is
      open: which option a member picked is never on this surface. */
  function mobTiles(state) {
    const q = state.q || { answers: {}, eliminated: [] };
    const showAnswer = !!q.closed;
    const inPlay = new Set(facing(state).map((m) => m.pid));
    return members(state).map((m) => ({
      pid: m.pid,
      seat: m.seat,
      name: m.name,
      alive: m.alive,
      out: m.out,
      answered: Object.prototype.hasOwnProperty.call(q.answers, m.pid),
      answer: showAnswer && inPlay.has(m.pid) && Object.prototype.hasOwnProperty.call(q.answers, m.pid)
        ? q.answers[m.pid] : null,
      justOut: !!q.revealed && (q.eliminated || []).indexOf(m.pid) >= 0,
    }));
  }

  /**
   * How the Mob answered this question: one count per option plus the members
   * who never answered. `ready` is false until the window has closed, and the
   * counts are all zero until then — this is what Poll the Mob shows.
   */
  function split(state) {
    const q = state.q || {};
    const counts = new Array(OPTION_COUNT).fill(0);
    let answered = 0;
    const inPlay = facing(state);
    inPlay.forEach((m) => {
      if (!Object.prototype.hasOwnProperty.call(q.answers || {}, m.pid)) return;
      const idx = q.answers[m.pid];
      if (isIntIn(idx, 0, OPTION_COUNT - 1)) { counts[idx] += 1; answered += 1; }
    });
    const total = inPlay.length;
    return {
      counts, answered, noAnswer: Math.max(0, total - answered), total,
      ready: !!q.closed,
    };
  }

  /** The option the Mob picked most; ties go to the first option in order. */
  function majorityIndex(state) {
    const counts = split(state).counts;
    let best = 0;
    for (let i = 1; i < counts.length; i += 1) if (counts[i] > counts[best]) best = i;
    return best;
  }

  /** Is the Mob's favourite option shared with another? The host is told. */
  function majorityIsTied(state) {
    const counts = split(state).counts;
    const top = Math.max.apply(null, counts);
    return counts.filter((c) => c === top).length > 1;
  }

  /** Money left on the table for the Mob when the contestant slips. */
  function mobSplit(state) {
    const survivors = members(state).filter((m) => m.alive);
    const pot = bank(state);
    const each = survivors.length ? Math.floor(pot / survivors.length) : 0;
    return { survivors: survivors.map((m) => ({ pid: m.pid, name: m.name, seat: m.seat })), each, pot };
  }

  /** Seconds left on the answer window; 0 when it is not running. */
  function secondsLeft(state, now) {
    const q = state.q || {};
    if (q.open && Number.isFinite(q.deadline)) return Math.max(0, Math.ceil((q.deadline - now) / 1000));
    const left = Number.isFinite(q.remainingMs) ? q.remainingMs : (q.seconds || 0) * 1000;
    return Math.max(0, Math.ceil(left / 1000));
  }

  /** Has the running window run out? The host UI closes the Mob when it has. */
  function windowExpired(state, now) {
    const q = state.q || {};
    return !!(q.open && Number.isFinite(q.deadline) && now >= q.deadline);
  }

  /** The question with the answer stripped — everything a phone may see. */
  function publicQuestion(state) {
    const q = state.q && state.q.question;
    if (!q) return null;
    return { q: q.q, category: q.category, level: q.level, options: q.options.slice() };
  }

  /** Row per option for the host lozenges. */
  function optionRows(state) {
    const question = state.q && state.q.question;
    if (!question) return [];
    const s = split(state);
    return question.options.map((text, idx) => ({
      idx,
      letter: LETTERS[idx],
      text,
      state: optionState(state, idx),
      votes: state.q.poll || state.q.revealed ? s.counts[idx] : null,
    }));
  }

  function optionState(state, idx) {
    const q = state.q || {};
    if (q.revealed && q.question && idx === q.question.answer) return "correct";
    if (q.revealed && idx === q.locked) return "wrong";
    if (q.locked === idx) return "locked";
    return "idle";
  }

  /** The line-up for the standings screen: the contestant, then the Mob. */
  function standings(state) {
    const rows = [{
      kind: "contestant",
      pid: state.contestant,
      name: contestantName(state),
      won: state.outcome ? state.outcome.won : 0,
      note: state.outcome ? state.outcome.reason : "playing",
    }];
    const share = state.outcome && state.outcome.reason === "lose" ? state.outcome.each : 0;
    members(state).forEach((m) => {
      rows.push({
        kind: "mob",
        pid: m.pid,
        name: m.name,
        seat: m.seat,
        won: m.alive ? share : 0,
        survived: m.alive ? state.qNumber : (m.out || 0),
        alive: m.alive,
        note: m.alive ? "survived" : `out on Q${m.out || 0}`,
      });
    });
    return rows;
  }

  /* ============ Selectors: phones (js/ovh-phoneview.js) ============ */

  const PhoneViews = PhoneView.make({
    isPlainObject, isIntIn, OPTION_COUNT, members, nameOf, bank, formatMoney,
    mobAlive, mobSize, contestantName, publicQuestion, split, perMember,
  });
  const { validatePhoneMsg, phoneView, memberOf } = PhoneViews;

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    seat: evSeat,
    openQuestion: evOpenQuestion,
    mobAnswer: evMobAnswer,
    closeMob: evCloseMob,
    simulateMob: evSimulateMob,
    contestantLock: evContestantLock,
    usePoll: evUsePoll,
    useAsk: evUseAsk,
    useTrust: evUseTrust,
    reveal: evReveal,
    walk: evWalk,
    continue: evContinue,
    finish: evFinish,
    undo: evUndo,
  };

  /** Bookkeeping that is not worth an undo step of its own. */
  const NO_HISTORY = new Set(["undo", "mobAnswer", "openQuestion"]);

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` and `now` are injected — the core never calls
   * Math.random or Date.now itself.
   * @param {object} state @param {{type:string}} event
   * @param {function} [rng] @param {number} [now]
   */
  function reduce(state, event, rng, now) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    // Own-property lookup: a prototype-shaped type ("toString", "__proto__")
    // must never reach a handler.
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const at = Number.isFinite(now) ? now : 0;
    const next = handler(state, event, typeof rng === "function" ? rng : Math.random, at);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return withHistory(state, next, at);
  }

  // Representative payloads so legalActions can probe payload-carrying events.
  const SAMPLE_EVENTS = {
    seat: { pid: null },
    mobAnswer: { pid: null, idx: 0 },
    simulateMob: { wrong: 0 },
    contestantLock: { idx: 0 },
    useAsk: { pid: null },
  };

  /** Which events would do something right now (host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      const sample = SAMPLE_EVENTS[type] || {};
      const next = HANDLERS[type](state, Object.assign({ type }, sample), () => 0, 0);
      return !!next && next !== state;
    });
  }

  /* ============ Setting up ============ */

  function evSeat(state, ev) {
    if (state.phase !== "setup") return state;
    const pid = cleanText(ev.pid, PID_MAX);
    if (!pid || !state.roster.some((p) => p.pid === pid) || pid === state.contestant) return state;
    return Object.assign({}, state, { contestant: pid, notice: "" });
  }

  function evStart(state, ev, rng) {
    if (state.phase !== "setup") return state;
    const mob = buildMob(state);
    if (!mob.members.length) {
      const notice = "The Mob is empty — set a Mob size or connect more phones.";
      return state.notice === notice ? state : Object.assign({}, state, { notice });
    }
    const started = Object.assign({}, state, { phase: "question", mob, qNumber: 1, bank: 0, outcome: null });
    return Object.assign(started, questionFor(started, 1, rng));
  }

  /* ============ The Mob's answer window ============ */

  /** Open the window, or resume one a save or an undo paused. */
  function evOpenQuestion(state, ev, rng, now) {
    if (state.phase !== "question" || !state.q.question) return state;
    if (state.q.open || state.q.closed) return state;
    const at = Number.isFinite(ev.now) ? ev.now : now;
    const left = Number.isFinite(state.q.remainingMs) ? state.q.remainingMs : state.q.seconds * 1000;
    return Object.assign({}, state, {
      q: Object.assign({}, state.q, {
        open: true,
        remainingMs: null,
        deadline: state.q.seconds > 0 ? at + Math.max(0, left) : null,   // 0 s left still expires
      }),
      notice: "",
    });
  }

  function evMobAnswer(state, ev, rng, now) {
    const q = state.q;
    if (state.phase !== "question" || !q.open || !q.question) return state;
    if (!isIntIn(ev.idx, 0, OPTION_COUNT - 1)) return state;
    const pid = cleanText(ev.pid, PID_MAX);
    const me = pid ? memberOf(state, pid) : null;
    if (!me || !me.alive || pid === state.contestant) return state;
    // One phone, one answer: the first tap counts and later ones are ignored.
    if (Object.prototype.hasOwnProperty.call(q.answers, pid)) return state;
    if (Number.isFinite(q.deadline) && now > q.deadline) return state;
    const answers = Object.assign({}, q.answers);
    answers[pid] = ev.idx;
    return Object.assign({}, state, { q: Object.assign({}, q, { answers }) });
  }

  /**
   * `simulateMob{size,wrong}` — the host's stand-in for real phones (spec 16
   * §1). `size` re-sizes the Mob before the game starts; `wrong` records how
   * many of the surviving Mob got this question wrong.
   */
  function evSimulateMob(state, ev) {
    if (state.phase === "setup") {
      if (!isIntIn(ev.size, MIN_MOB, MAX_MOB) || ev.size === state.plan.size) return state;
      return Object.assign({}, state, {
        plan: Object.assign({}, state.plan, { simulated: true, size: ev.size }),
        notice: "",
      });
    }
    if (state.phase !== "question" || !state.mob.simulated) return state;
    if (state.q.closed || !state.q.question) return state;
    const alive = mobAlive(state);
    if (!isIntIn(ev.wrong, 0, alive) || ev.wrong === state.q.simWrong) return state;
    return Object.assign({}, state, { q: Object.assign({}, state.q, { simWrong: ev.wrong }), notice: "" });
  }

  /**
   * Close the window. A simulated Mob's answers are materialised here — the
   * wrong ones spread evenly over the two wrong options — so everything after
   * this point (the split, the helps, the reveal) is identical whether the
   * Mob is phones or the host's typed count.
   */
  function evCloseMob(state) {
    const q = state.q;
    if (state.phase !== "question" || q.closed || !q.question) return state;
    let answers = q.answers;
    if (state.mob.simulated) {
      const wrongIdx = spreadWrong(q.simWrong, q.question.answer);
      answers = {};
      members(state).filter((m) => m.alive).forEach((m, i) => {
        answers[m.pid] = i < wrongIdx.length ? wrongIdx[i] : q.question.answer;
      });
    }
    return Object.assign({}, state, {
      q: Object.assign({}, q, { open: false, closed: true, deadline: null, remainingMs: 0, answers }),
      notice: "",
    });
  }

  /* ============ The contestant ============ */

  function evContestantLock(state, ev) {
    const q = state.q;
    if (state.phase !== "question" || !q.closed || q.revealed || q.locked !== null) return state;
    if (!isIntIn(ev.idx, 0, OPTION_COUNT - 1)) return state;
    return Object.assign({}, state, { q: Object.assign({}, q, { locked: ev.idx }), notice: "" });
  }

  /** Can a help still be used? Once each, and only before the lock. */
  function helpUsable(state, key) {
    const q = state.q;
    return state.phase === "question" && !!state.helps[key]
      && !!q.closed && !q.revealed && q.locked === null && !!q.question;
  }

  function spendHelp(state, key, patch) {
    const helps = Object.assign({}, state.helps);
    helps[key] = false;
    return Object.assign({}, state, { helps, q: Object.assign({}, state.q, patch) });
  }

  function evUsePoll(state) {
    if (!helpUsable(state, "poll") || state.q.poll) return state;
    return spendHelp(state, "poll", { poll: true });
  }

  /**
   * `useAsk{pid?}` — one Mob member who got it right and one who got it wrong
   * are named, so the contestant can hear them out. The host may name the
   * member; otherwise the rng picks.
   */
  function evUseAsk(state, ev, rng) {
    if (!helpUsable(state, "ask") || state.q.ask) return state;
    const answer = state.q.question.answer;
    const right = pickMember(state, (idx) => idx === answer, ev.pid, rng);
    const wrong = pickMember(state, (idx) => idx !== answer, ev.pid, rng);
    if (!right && !wrong) return state;
    return spendHelp(state, "ask", { ask: { right, wrong } });
  }

  /** One alive member whose answer passes `test`; `preferred` wins if it does. */
  function pickMember(state, test, preferred, rng) {
    const q = state.q;
    const pool = members(state).filter((m) => m.alive
      && Object.prototype.hasOwnProperty.call(q.answers, m.pid)
      && test(q.answers[m.pid]));
    if (!pool.length) return null;
    const chosen = pool.find((m) => m.pid === preferred) || pool[Content.pickIndex(rng, pool.length)];
    return { pid: chosen.pid, name: chosen.name, seat: chosen.seat, idx: q.answers[chosen.pid] };
  }

  /** `useTrust` — the contestant takes the Mob's majority, ties to option A. */
  function evUseTrust(state) {
    if (!helpUsable(state, "trust")) return state;
    const idx = majorityIndex(state);
    const next = spendHelp(state, "trust", { trust: true, locked: idx });
    return majorityIsTied(state)
      ? Object.assign(next, { notice: `The Mob is tied, so Trust took ${LETTERS[idx]}, the first tied option.` }) : next;
  }

  /* ============ Reveal ============ */

  function evReveal(state) {
    const q = state.q;
    if (state.phase !== "question" || !q.closed || q.revealed || q.locked === null || !q.question) return state;
    const answer = q.question.answer;
    const correct = q.locked === answer;
    // Everyone who answered wrong — or did not answer at all — is out, whether
    // or not the contestant survived (spec 16 §1).
    const eliminated = members(state)
      .filter((m) => m.alive && q.answers[m.pid] !== answer)
      .map((m) => m.pid);
    const gone = new Set(eliminated);
    const mob = Object.assign({}, state.mob, {
      members: members(state).map((m) => (gone.has(m.pid)
        ? Object.assign({}, m, { alive: false, out: state.qNumber })
        : m)),
    });
    const earned = correct ? eliminated.length * perMember(state, state.qNumber) : 0;
    const next = Object.assign({}, state, {
      mob,
      bank: bank(state) + earned,
      q: Object.assign({}, q, { revealed: true, correct, eliminated, earned }),
    });
    return finishReveal(next, correct);
  }

  /** Where the reveal leaves us: lost, won outright, or a walk-or-continue. */
  function finishReveal(state, correct) {
    if (!correct) {
      const share = mobSplit(state);
      return Object.assign({}, state, {
        phase: "result",
        outcome: {
          reason: "lose", won: 0, bank: bank(state),
          survivors: share.survivors, each: share.each,
        },
        notice: share.survivors.length
          ? "Wrong — the surviving Mob splits the bank."
          : "Wrong — and the whole Mob went with them, so the bank is gone.",
      });
    }
    if (mobAlive(state) === 0) {
      const won = Math.round(bank(state) * settings(state).bonusMultiplier);
      return Object.assign({}, state, {
        phase: "result",
        outcome: { reason: "win", won, bank: bank(state), survivors: [], each: 0 },
        notice: "The whole Mob is out — the bank plus the bonus.",
      });
    }
    return Object.assign({}, state, { phase: "decision", notice: "" });
  }

  /* ============ Walk, continue, finish ============ */

  function evWalk(state) {
    if (state.phase !== "decision") return state;
    return Object.assign({}, state, {
      phase: "result",
      outcome: { reason: "walk", won: bank(state), bank: bank(state), survivors: [], each: 0 },
      notice: "",
    });
  }

  function evContinue(state, ev, rng) {
    if (state.phase !== "decision") return state;
    const n = state.qNumber + 1;
    const next = Object.assign({}, state, { phase: "question", qNumber: n, notice: "" });
    return Object.assign(next, questionFor(next, n, rng));
  }

  /**
   * End the night. A contestant caught mid-question is banked first, at
   * exactly what walking away would have paid, so nobody is silently recorded
   * as leaving with nothing.
   */
  function evFinish(state) {
    if (state.phase === "standings" || state.phase === "setup") return state;
    const outcome = state.outcome || {
      reason: "walk", won: bank(state), bank: bank(state), survivors: [], each: 0,
    };
    return Object.assign({}, state, { phase: "standings", outcome, notice: "" });
  }

  /* ============ Undo ============ */

  function evUndo(state, ev, rng, now) {
    if (!Array.isArray(state.history) || !state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return Object.assign({}, previous, {
      game: state.game,
      // Snapshots are stored paused, but a save written by an older build (or
      // hand-edited) may still carry a running window: pause that too, so undo
      // can never hand back a deadline that expires on the next paint.
      q: pauseWindow(previous.q, now),
      history: state.history.slice(0, -1),
    });
  }

  /* ============ Export ============ */

  return {
    // constants
    PHASES, LETTERS, PID_MAX, MAX_ROSTER, MIN_PHONE_MOB, MAX_HISTORY, NO_QUESTION,
    DEFAULT_LADDER, DEFAULT_HELPS, DEFAULT_SETTINGS, HELP_KEYS,
    OPTION_COUNT, LEVEL_MAX, MIN_QUESTIONS, NAME_MAX, MIN_MOB, MAX_MOB,
    // content
    validateGame, normalizeGame, warningsFor, drawQuestion, levelForQuestion,
    perMemberValue, spreadWrong, cleanText,
    // state
    createState, reduce, legalActions, buildMob, pauseWindow,
    // money and the Mob
    bank, perMember, mobAlive, mobSize, mobTiles, mobSplit, split, facing,
    majorityIndex, majorityIsTied, formatMoney, nameOf, contestantName,
    secondsLeft, windowExpired, standings,
    // questions
    publicQuestion, optionRows, optionState,
    // phones
    validatePhoneMsg, phoneView,
  };
});
