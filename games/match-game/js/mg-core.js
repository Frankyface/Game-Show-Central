/* ============================================================
   Match Game — pure game core
   The immutable reducer: setup → two rounds of six face-down
   panel cards → tiebreak → the Super Match (Audience Match, then
   Head-to-Head with the multiplier spinner) → standings.

   No DOM, no network, no timers, no randomness of its own: the
   spinner takes an injected roll, so the whole format replays
   exactly in Node. Runs in the browser (globalThis.MgCore, after
   js/mg-content.js and js/mg-select.js) and in Node
   (module.exports). Reducers never mutate their inputs; an
   illegal or unknown event returns the state unchanged rather
   than throwing, so a hostile phone frame can only be ignored.

   `MgCore` re-exports mg-content.js and mg-select.js, so callers
   only ever touch one global (spec 18 §4).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./mg-content.js") : root.MgContent;
  const select = node ? require("./mg-select.js") : root.MgSelect;
  const api = factory(content, select);
  if (node) module.exports = api;
  root.MgCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Select) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, normaliseAnswer, fail,
    normalizeGame, drawOrder, promptAt,
    NAME_MAX, PID_MAX, ANSWER_MAX, MIN_PANEL, MAX_PANEL,
  } = Content;
  const { leader, isTied, topThree, headToHeadBase, resolveKey } = Select;

  /* ============ Constants ============ */

  const PHASES = Object.freeze([
    "setup", "prompt", "roundScores", "superChoice",
    "audience", "audienceBoard", "hthPick", "hthPrompt", "hthResult", "standings",
  ]);
  const MAX_HISTORY = 40;
  const MAX_SUBMISSIONS = 200;   // a room cannot hold more; a cap, never a rule
  const MAX_GUESSES = 3;         // the show's three Audience Match slots

  /** Events that are bookkeeping rather than a decision: undo skips them. */
  const NO_HISTORY = new Set(["undo"]);

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /* ============ Construction ============ */

  function normalizeSeat(raw, where, seen) {
    if (!isPlainObject(raw)) fail(`${where} is missing.`);
    const pid = cleanText(raw.pid, PID_MAX);
    const name = cleanText(raw.name, NAME_MAX);
    if (!name) fail(`${where} needs a name.`);
    if (pid && seen.has(pid)) fail(`${name} cannot sit in two seats.`);
    if (pid) seen.add(pid);
    return { pid, name };
  }

  function normalizeContestants(raw, seen) {
    if (!Array.isArray(raw) || raw.length !== 2) fail("Match Game needs exactly two contestants.");
    return raw.map((c, i) => {
      const seat = normalizeSeat(c, `Contestant ${i + 1}`, seen);
      return { pid: seat.pid, name: seat.name, points: 0, money: 0 };
    });
  }

  function normalizePanel(raw, size, seen) {
    if (!isIntIn(size, MIN_PANEL, MAX_PANEL)) fail(`A panel is ${MIN_PANEL} to ${MAX_PANEL} people.`);
    if (!Array.isArray(raw) || raw.length !== size) {
      fail(`The panel needs ${size} seats — there ${Array.isArray(raw) ? `are ${raw.length}` : "is nothing"}.`);
    }
    return raw.map((p, slot) => {
      const seat = normalizeSeat(p, `Panel seat ${slot + 1}`, seen);
      return { slot, pid: seat.pid, name: seat.name };
    });
  }

  /**
   * Build the state for one night.
   * @param {object} game the content file (validated here)
   * @param {{contestants:object[], panel:object[], shuffle?:boolean,
   *          rng?:() => number}} opts
   */
  function createState(game, opts) {
    const g = normalizeGame(game);
    const o = opts || {};
    const seen = new Set();
    return {
      phase: "setup",
      game: g,
      contestants: normalizeContestants(o.contestants, seen),
      panel: normalizePanel(o.panel, g.settings.panelSize, seen),
      order: drawOrder(g, { shuffle: !!o.shuffle, rng: o.rng }),
      shuffled: !!o.shuffle,
      repeating: false,
      cursor: 0,
      audCursor: 0,
      round: 1,
      tiebreak: 0,
      turnInRound: 0,
      matched: [[], []],
      current: null,
      audience: null,
      hth: null,
      winner: null,
      history: [],
    };
  }

  /* ============ Immutable patch helpers ============ */

  const patch = (state, fields) => Object.assign({}, state, fields);
  const withCurrent = (s, f) => patch(s, { current: Object.assign({}, s.current, f) });
  const withAudience = (s, f) => patch(s, { audience: Object.assign({}, s.audience, f) });
  const withHth = (s, f) => patch(s, { hth: Object.assign({}, s.hth, f) });

  function withContestant(state, index, fields) {
    return patch(state, {
      contestants: state.contestants.map((c, i) => (i === index ? Object.assign({}, c, fields) : c)),
    });
  }

  /* ============ Turn order ============ */

  /** Which contestant plays turn `n` of `round`. They alternate, round by round. */
  function seatFor(round, turnInRound) {
    return (round - 1 + turnInRound) % 2;
  }

  function currentSeat(state) {
    return seatFor(state.round, state.turnInRound);
  }

  /**
   * The slots this contestant may still score on. With `secondRoundRule` on,
   * a contestant may only match panelists they have NOT matched before — the
   * show's round-two rule (spec 18 §1). A tiebreak always uses the whole panel.
   */
  function playableSlots(state, seat) {
    const all = state.panel.map((p) => p.slot);
    if (!state.game.settings.secondRoundRule || state.round <= 1 || state.tiebreak > 0) return all;
    const done = new Set(state.matched[seat] || []);
    return all.filter((slot) => done.has(slot) === false);
  }

  /** Deal the next prompt to the contestant whose turn it is. */
  function dealPrompt(state, fields) {
    const next = patch(state, fields || {});
    const drawn = promptAt(next.game.prompts, next.order.prompts, next.cursor);
    const seat = currentSeat(next);
    const playable = playableSlots(next, seat);
    const locked = next.panel.map((p) => p.slot).filter((slot) => playable.indexOf(slot) < 0);
    return patch(next, {
      phase: "prompt",
      cursor: next.cursor + 1,
      repeating: next.repeating || drawn.repeating,
      current: {
        index: drawn.index, text: drawn.text, hint: drawn.hint, seat,
        answers: {}, order: playable, locked,
        revealed: 0, judged: [], guess: "", guessLocked: false,
        points: 0, done: playable.length === 0,
      },
    });
  }

  /* ============ The main game ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    return dealPrompt(state, { round: 1, turnInRound: 0 });
  }

  /** Swap this prompt for the next one — only before anything has been shown. */
  function evNextPrompt(state) {
    if (state.phase !== "prompt" || !state.current || state.current.revealed > 0) return state;
    return dealPrompt(state, {});
  }

  function slotOf(state, event) {
    if (isIntIn(event.slot, 0, state.panel.length - 1)) return event.slot;
    if (typeof event.pid === "string" && event.pid) {
      const seat = state.panel.find((p) => p.pid === event.pid);
      if (seat) return seat.slot;
    }
    return null;
  }

  /**
   * A panelist's answer. `slot` (the host typing) or `pid` (a phone) picks the
   * seat. Answers may be rewritten until the first card is flipped.
   */
  function evPanelAnswer(state, event) {
    if (state.phase !== "prompt" || !state.current || state.current.revealed > 0) return state;
    const slot = slotOf(state, event);
    if (slot === null || state.current.order.indexOf(slot) < 0) return state;
    const text = cleanText(event.text, ANSWER_MAX);
    if (!text) return state;
    return withCurrent(state, { answers: Object.assign({}, state.current.answers, { [slot]: text }) });
  }

  /** The contestant's answer, typed by the host and locked before any reveal. */
  function evContestantAnswer(state, event) {
    if (state.phase !== "prompt" || !state.current || state.current.revealed > 0) return state;
    const text = cleanText(event.text, ANSWER_MAX);
    if (!text) return state;
    return withCurrent(state, { guess: text, guessLocked: true });
  }

  /** Flip the next card. One at a time, and never before the contestant answers. */
  function evRevealNext(state) {
    if (state.phase === "hthPrompt") return revealHth(state);
    if (state.phase !== "prompt" || !state.current) return state;
    const cur = state.current;
    if (!cur.guessLocked) return state;
    if (cur.revealed !== cur.judged.length || cur.revealed >= cur.order.length) return state;
    return withCurrent(state, { revealed: cur.revealed + 1 });
  }

  /** Match or no match on the card that is face up. The host is the judge. */
  function evJudge(state, event) {
    if (state.phase !== "prompt" || !state.current) return state;
    const cur = state.current;
    if (cur.revealed !== cur.judged.length + 1) return state;
    const match = event.match === true;
    const slot = cur.order[cur.judged.length];
    const judged = cur.judged.concat([match]);
    const gain = match ? state.game.settings.pointsPerMatch : 0;
    const next = withCurrent(state, {
      judged, points: cur.points + gain, done: judged.length === cur.order.length,
    });
    const scored = gain
      ? withContestant(next, cur.seat, { points: next.contestants[cur.seat].points + gain })
      : next;
    if (!match) return scored;
    return patch(scored, {
      matched: scored.matched.map((list, i) => (i === cur.seat ? list.concat([slot]) : list)),
    });
  }

  /** This turn is over: the other contestant, the next round, or the scores. */
  function evNextContestant(state) {
    if (state.phase === "roundScores") return afterRound(state);
    if (state.phase !== "prompt" || !state.current || !state.current.done) return state;
    if (state.turnInRound === 0) return dealPrompt(state, { turnInRound: 1 });
    return patch(state, { phase: "roundScores" });
  }

  function afterRound(state) {
    if (state.round < state.game.settings.rounds) {
      return dealPrompt(state, { round: state.round + 1, turnInRound: 0 });
    }
    if (isTied(state)) return state;              // the host presses Tiebreak
    return patch(state, { phase: "superChoice", winner: leader(state) });
  }

  /** A tiebreak prompt: an extra round, and the round-two rule does not apply. */
  function evTiebreak(state) {
    if (state.phase !== "roundScores" || !isTied(state)) return state;
    return dealPrompt(state, {
      round: state.round + 1, tiebreak: state.tiebreak + 1, turnInRound: 0,
    });
  }

  /* ============ Super Match: the Audience Match ============ */

  function evAudienceOpen(state) {
    if (state.phase !== "superChoice") return state;
    const drawn = promptAt(state.game.audiencePrompts, state.order.audience, state.audCursor);
    return patch(state, {
      phase: "audience",
      audCursor: state.audCursor + 1,
      audience: {
        index: drawn.index, text: drawn.text, open: true,
        submissions: [], merges: {}, guesses: [], won: 0,
      },
    });
  }

  /** One answer per person; a re-send replaces it while the board is open. */
  function evAudienceAnswer(state, event) {
    if (state.phase !== "audience" || !state.audience || !state.audience.open) return state;
    const pid = cleanText(event.pid, PID_MAX);
    const text = cleanText(event.text, ANSWER_MAX);
    const key = normaliseAnswer(text);
    if (!pid || !text || !key) return state;
    if (state.panel.some((p) => p.pid === pid)) return state;          // the panel never votes
    if (state.contestants.some((c) => c.pid && c.pid === pid)) return state;
    const list = state.audience.submissions;
    const at = list.findIndex((s) => s.pid === pid);
    if (at < 0 && list.length >= MAX_SUBMISSIONS) return state;
    const entry = { pid, text, key };
    return withAudience(state, {
      submissions: at < 0 ? list.concat([entry]) : list.map((s, i) => (i === at ? entry : s)),
    });
  }

  function evAudienceClose(state) {
    if (state.phase !== "audience" || !state.audience) return state;
    return patch(state, {
      phase: "audienceBoard",
      audience: Object.assign({}, state.audience, { open: false }),
    });
  }

  /** Fold one answer into another: the host's judgement on synonyms. */
  function evMergeAnswers(state, event) {
    if (!state.audience) return state;
    if (state.phase !== "audience" && state.phase !== "audienceBoard") return state;
    const from = normaliseAnswer(event.from);
    const into = normaliseAnswer(event.into);
    if (!from || !into || from === into) return state;
    const merges = Object.assign({}, state.audience.merges);
    if (resolveKey(merges, into) === from) return state;                // never a loop
    merges[from] = into;
    return withAudience(state, { merges });
  }

  /**
   * The contestant's guess against the board. `idx` 0–2 is the row it matched;
   * anything else is a miss. The first hit, or a third miss, ends it.
   */
  function evAudiencePick(state, event) {
    if (state.phase !== "audienceBoard" || !state.audience) return state;
    const aud = state.audience;
    if (aud.guesses.length >= MAX_GUESSES) return state;
    const board = topThree(state);
    const hit = isIntIn(event.idx, 0, board.length - 1) ? event.idx : -1;
    const row = hit >= 0 ? board[hit] : null;
    const value = row ? row.value : 0;
    const guesses = aud.guesses.concat([{
      text: cleanText(event.text, ANSWER_MAX), hit, value, answer: row ? row.text : "",
    }]);
    const next = withAudience(state, { guesses, won: aud.won + value });
    if (hit < 0 && guesses.length < MAX_GUESSES) return next;
    const paid = value
      ? withContestant(next, next.winner, { money: next.contestants[next.winner].money + value })
      : next;
    return patch(paid, { phase: "hthPick" });
  }

  /* ============ Super Match: Head-to-Head ============ */

  /** No phones in the room, or no time: play the Head-to-Head for the minimum. */
  function evToHeadToHead(state) {
    if (state.phase !== "superChoice" && state.phase !== "audienceBoard") return state;
    return patch(state, { phase: "hthPick" });
  }

  function evPickPanelist(state, event) {
    if (state.phase !== "hthPick") return state;
    const slot = slotOf(state, event);
    if (slot === null) return state;
    const drawn = promptAt(state.game.prompts, state.order.prompts, state.cursor);
    const multipliers = state.game.settings.multipliers;
    return patch(state, {
      phase: "hthPrompt",
      cursor: state.cursor + 1,
      repeating: state.repeating || drawn.repeating,
      hth: {
        slot, index: drawn.index, text: drawn.text, hint: drawn.hint,
        panelText: "", contestantText: "", revealed: false,
        multiplier: multipliers[0] === undefined ? 10 : multipliers[0],
        spun: false, match: null, base: headToHeadBase(state), won: 0,
      },
    });
  }

  /** The panelist writes from their phone; the host types the contestant's. */
  function evHthAnswer(state, event) {
    if (state.phase !== "hthPrompt" || !state.hth || state.hth.revealed) return state;
    const text = cleanText(event.text, ANSWER_MAX);
    if (!text) return state;
    const who = event.who === "contestant" ? "contestantText" : "panelText";
    return withHth(state, { [who]: text });
  }

  function revealHth(state) {
    if (!state.hth || state.hth.revealed) return state;
    if (!state.hth.panelText || !state.hth.contestantText) return state;
    return withHth(state, { revealed: true });
  }

  /**
   * The multiplier wheel. `roll` (0–1) keeps the event serialisable, so undo
   * and a reload replay the same number; `rng` is accepted for a caller that
   * would rather hand over a function.
   */
  function evSpin(state, event) {
    if (state.phase !== "hthPrompt" || !state.hth || state.hth.match !== null) return state;
    const list = state.game.settings.multipliers;
    if (!list.length) return state;
    const raw = Number.isFinite(event.roll) ? event.roll
      : (typeof event.rng === "function" ? Number(event.rng()) : 0);
    const safe = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
    return withHth(state, { multiplier: list[Math.floor(safe * list.length)], spun: true });
  }

  function evHthJudge(state, event) {
    if (state.phase !== "hthPrompt" || !state.hth || !state.hth.revealed) return state;
    const match = event.match === true;
    const won = match ? state.hth.base * state.hth.multiplier : 0;
    const next = withHth(state, { match, won });
    const paid = won
      ? withContestant(next, next.winner, { money: next.contestants[next.winner].money + won })
      : next;
    return patch(paid, { phase: "hthResult" });
  }

  function evFinish(state) {
    if (state.phase === "standings") return state;
    return patch(state, {
      phase: "standings",
      winner: state.winner === null ? leader(state) : state.winner,
    });
  }

  function evUndo(state) {
    if (!state.history.length) return state;
    return patch(state.history[state.history.length - 1], { history: state.history.slice(0, -1) });
  }

  const HANDLERS = {
    start: evStart,
    nextPrompt: evNextPrompt,
    panelAnswer: evPanelAnswer,
    contestantAnswer: evContestantAnswer,
    revealNext: evRevealNext,
    judge: evJudge,
    nextContestant: evNextContestant,
    tiebreak: evTiebreak,
    audienceOpen: evAudienceOpen,
    audienceAnswer: evAudienceAnswer,
    audienceClose: evAudienceClose,
    mergeAnswers: evMergeAnswers,
    audiencePick: evAudiencePick,
    toHeadToHead: evToHeadToHead,
    pickPanelist: evPickPanelist,
    hthAnswer: evHthAnswer,
    spin: evSpin,
    hthJudge: evHthJudge,
    finish: evFinish,
    undo: evUndo,
  };

  /* ============ Reducer ============ */

  function snapshot(state) {
    return patch(state, { history: [] });
  }

  /**
   * Apply `event` to `state`. Illegal or unknown events return `state`
   * unchanged (never throw). The handler lookup is guarded, so a
   * prototype-shaped type (`toString`, `__proto__`) finds nothing.
   * @param {object} state @param {{type:string}} event
   */
  function reduce(state, event) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    const handler = has(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const next = handler(state, event);
    if (!next || next === state) return state;
    if (NO_HISTORY.has(event.type)) return next;
    return patch(next, { history: state.history.concat([snapshot(state)]).slice(-MAX_HISTORY) });
  }

  return Object.assign({}, Content, Select, {
    createState, reduce, snapshot,
    seatFor, currentSeat, playableSlots, slotOf,
    PHASES, MAX_HISTORY, MAX_GUESSES, MAX_SUBMISSIONS,
  });
});
