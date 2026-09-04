/* ============================================================
   Chain Reaction — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no network, no timers: the Speed
   Chain clock is stored as a deadline timestamp and `now` is
   injected, and every random choice takes an injected `rng`, so
   the whole format is testable in Node. Runs in the browser
   (globalThis.CrCore, after js/cr-content.js) and in Node
   (module.exports). Reducers never mutate their inputs.

   Content validation and the word helpers live in cr-content.js
   and are re-exported here, so every caller only needs CrCore.

   The masking rule that matters most (spec 14 §5): `phoneView`
   builds its column from the reveal mask, character by
   character, so an unrevealed letter is never in a phone's
   payload at all — not hidden by CSS, simply absent.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./cr-content.js") : root.CrContent;
  const select = node ? require("./cr-select.js") : root.CrSelect;
  const api = factory(content, select);
  if (node) module.exports = api;
  root.CrCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content, Select) {
  "use strict";

  const {
    isPlainObject, cleanText, fail,
    cleanWord, blankMask, revealNext, revealAll, allLettersShown, shownCount,
    isLetterAt, sameWord, validateGame, normalizeGame, warningsFor, wordProblem,
    CHAIN_LENGTH, MAX_WORD_CHARS, MIN_CHAINS, MIN_SPEED_CHAINS,
    NAME_MAX, GUESS_MAX, PID_MAX, DEFAULT_SETTINGS,
  } = Content;

  // Everything that only READS a state lives in cr-select.js; the reducer below
  // uses these and the export re-publishes them, so CrCore stays one API.
  const {
    TOP, BOTTOM, HIDDEN_COUNT, DIRECTIONS,
    chainComplete, frontier, eligibleWords,
    columnRows, maskedColumn, speedColumn,
    chainValue, chainsLeft, leader, speedCurrent,
    teamOf, formatMoney, secondsLeft, standings,
    validatePhoneMsg, phoneView,
  } = Select;
  void (eligibleWords && columnRows && maskedColumn && speedColumn && chainsLeft
    && speedCurrent && teamOf && formatMoney && secondsLeft && standings
    && validatePhoneMsg && phoneView && shownCount && isLetterAt && CHAIN_LENGTH
    && MAX_WORD_CHARS && MIN_CHAINS && MIN_SPEED_CHAINS);

  const MAX_HISTORY = 60;

  /** Phases the host UI switches on. */
  const PHASES = Object.freeze(["setup", "chain", "chainDone", "sudden", "speed", "result"]);

  /**
   * @typedef {{name:string, pids:string[]}} Team
   * @typedef {{words:string[], revealed:boolean[][], solved:boolean[], owner:(number|null)[]}} Chain
   */

  /* ============ Building a chain ============ */

  /** Top and bottom lit and given; the six between blank. */
  function buildChain(words) {
    return {
      words: words.slice(),
      revealed: words.map((w, i) => (i === TOP || i === BOTTOM ? revealAll(w) : blankMask(w))),
      solved: words.map((w, i) => i === TOP || i === BOTTOM),
      owner: words.map(() => null),
    };
  }

  /* ============ State construction ============ */

  function normalizeTeams(teams) {
    if (!Array.isArray(teams) || teams.length !== 2) fail("Chain Reaction is played by exactly two teams.");
    const out = teams.map((t, i) => {
      const raw = isPlainObject(t) ? t : { name: t };
      const name = cleanText(raw.name, NAME_MAX);
      if (!name) fail(`Team ${i + 1} needs a name.`);
      const pids = Array.isArray(raw.pids)
        ? raw.pids.map((p) => cleanText(p, PID_MAX)).filter(Boolean)
        : [];
      return { name, pids: Array.from(new Set(pids)) };
    });
    if (out[0].name.toLowerCase() === out[1].name.toLowerCase()) {
      fail("The two teams need different names.");
    }
    const shared = out[0].pids.filter((p) => out[1].pids.indexOf(p) >= 0);
    if (shared.length) fail(`${shared[0]} cannot play for both teams.`);
    return out;
  }

  /** Which file chain each round uses; `options.order` overrides for tests. */
  function chainOrderFor(game, rounds, options) {
    const wanted = options && Array.isArray(options.order) ? options.order : null;
    const order = [];
    for (let i = 0; i < rounds; i += 1) {
      const from = wanted ? wanted[i % wanted.length] : i;
      order.push(((from % game.chains.length) + game.chains.length) % game.chains.length);
    }
    return order;
  }

  /**
   * Build the opening state. @param {*} game @param {*} teams
   * @param {{order?:number[]}} [options]
   */
  function createState(game, teams, options) {
    const g = normalizeGame(game);
    const roster = normalizeTeams(teams);
    const rounds = g.settings.values.length;
    return {
      phase: "setup",
      game: g,
      teams: roster,
      scores: [0, 0],
      chainIndex: 0,
      chainOrder: chainOrderFor(g, rounds, options),
      chain: null,
      control: 0,
      direction: null,
      target: null,
      guessText: "",
      guessBy: null,
      notice: "",
      speed: null,
      sudden: null,
      outcome: null,
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

  /**
   * Stop a running Speed Chain clock and keep what is left of it. An absolute
   * deadline is meaningless once the page (or the undo stack) has been away
   * from the wall clock, so every path that STORES a clock stores it paused:
   * the history snapshot below, `undo`, and cr-app.js's save.
   * @param {object} speed @param {number} now
   */
  function pauseSpeed(speed, now) {
    if (!speed || !speed.started || speed.over || !Number.isFinite(speed.deadline)) return speed;
    return Object.assign({}, speed, {
      started: false,
      deadline: null,
      remainingMs: Math.max(0, speed.deadline - now),
    });
  }

  function withHistory(before, next, now) {
    // The snapshot is taken at the moment of the event, so `now` is exactly the
    // right clock reading: undo hands the round back with the time it had, and
    // a stale deadline can never re-expire the instant it is restored.
    const frozen = before.speed && before.speed.started && !before.speed.over
      ? Object.assign({}, before, { speed: pauseSpeed(before.speed, now) })
      : before;
    const history = before.history.concat([snapshot(frozen)]);
    return Object.assign({}, next, {
      history: history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history,
    });
  }

  /** Typing and clock bookkeeping are not worth an undo step of their own. */
  const NO_HISTORY = new Set(["guess", "speedStart", "undo", "notice"]);

  /* ============ Chain events ============ */

  function evStart(state) {
    if (state.phase !== "setup") return state;
    const words = state.game.chains[state.chainOrder[0]];
    return Object.assign({}, state, {
      phase: "chain",
      chain: buildChain(words),
      control: 0,
      direction: null,
      target: null,
      guessText: "",
      guessBy: null,
      notice: "",
    });
  }

  /** Put a word up in lights: solved, every letter shown, credited to `team`. */
  function solveWord(chain, index, team) {
    const revealed = chain.revealed.slice();
    const solved = chain.solved.slice();
    const owner = chain.owner.slice();
    revealed[index] = revealAll(chain.words[index]);
    solved[index] = true;
    owner[index] = team;
    return Object.assign({}, chain, { revealed, solved, owner });
  }

  /** After any change to the column: complete chains move to the interstitial. */
  function settle(state, patch) {
    const next = Object.assign({}, state, patch);
    if (next.phase === "chain" && chainComplete(next.chain)) {
      return Object.assign(next, { phase: "chainDone", target: null, direction: null });
    }
    return next;
  }

  /**
   * `reveal{direction}` — light the next letter of the word in play at that
   * end. A word whose last letter this lights is simply given: no points and
   * control does not move (spec 14 §1).
   */
  function evReveal(state, event) {
    if (state.phase === "sudden") return revealSudden(state);
    if (state.phase !== "chain" || state.target !== null) return state;
    const direction = DIRECTIONS.indexOf(event.direction) >= 0 ? event.direction : null;
    if (!direction) return state;
    const index = frontier(state)[direction];
    if (index === null) return state;
    const chain = state.chain;
    const word = chain.words[index];
    const mask = revealNext(word, chain.revealed[index]);
    if (allLettersShown(word, mask)) {
      const given = solveWord(chain, index, null);
      return settle(state, {
        chain: given, direction: null, target: null, guessText: "", guessBy: null,
        notice: `${word} was fully spelled out — given, no points.`,
      });
    }
    const revealed = chain.revealed.slice();
    revealed[index] = mask;
    return Object.assign({}, state, {
      chain: Object.assign({}, chain, { revealed }),
      direction,
      target: index,
      guessText: "",
      guessBy: null,
      notice: "",
    });
  }

  /** `guess{text}` — records what was said or typed. It never judges. */
  function evGuess(state, event) {
    if (state.phase !== "chain" && state.phase !== "sudden") return state;
    const text = cleanText(event.text, GUESS_MAX);
    const by = cleanText(event.pid, PID_MAX) || null;
    if (text === state.guessText && by === state.guessBy) return state;
    return Object.assign({}, state, { guessText: text, guessBy: by });
  }

  /** `judge{correct}` — the host, and only the host, decides. */
  function evJudge(state, event) {
    if (state.phase === "sudden") return judgeSudden(state, event);
    if (state.phase !== "chain" || state.target === null) return state;
    const value = chainValue(state);
    const index = state.target;
    const word = state.chain.words[index];
    if (event.correct === true) {
      const scores = state.scores.slice();
      scores[state.control] += value;
      return settle(state, {
        chain: solveWord(state.chain, index, state.control),
        scores,
        direction: null,
        target: null,
        guessText: "",
        guessBy: null,
        notice: `${state.teams[state.control].name} got ${word}.`,
      });
    }
    return wrongGuess(state, index, word);
  }

  /**
   * A wrong guess hands control over. With `settings.revealOnWrong` the
   * incoming team also gets the next letter of that same word for free — and
   * if that was its last letter the word is given, exactly as a normal reveal.
   */
  function wrongGuess(state, index, word) {
    const other = state.control === 0 ? 1 : 0;
    const base = {
      control: other, direction: null, target: null, guessText: "", guessBy: null,
      notice: `Wrong — over to ${state.teams[other].name}.`,
    };
    if (!state.game.settings.revealOnWrong) return settle(state, Object.assign({ chain: state.chain }, base));
    const mask = revealNext(word, state.chain.revealed[index]);
    if (allLettersShown(word, mask)) {
      return settle(state, Object.assign({}, base, {
        chain: solveWord(state.chain, index, null),
        notice: `Wrong — ${word} was fully spelled out, so it is given to ${state.teams[other].name}.`,
      }));
    }
    const revealed = state.chain.revealed.slice();
    revealed[index] = mask;
    return settle(state, Object.assign({}, base, {
      chain: Object.assign({}, state.chain, { revealed }),
      notice: `Wrong — another letter, and over to ${state.teams[other].name}.`,
    }));
  }

  /** `passControl` — the host hands the turn over by hand. */
  function evPassControl(state) {
    if (state.phase !== "chain" && state.phase !== "sudden") return state;
    const other = state.control === 0 ? 1 : 0;
    return Object.assign({}, state, {
      control: other, direction: null, target: null, guessText: "", guessBy: null,
      notice: `Over to ${state.teams[other].name}.`,
    });
  }

  /** `nextChain` — the interstitial's button. Teams alternate the opening turn. */
  function evNextChain(state) {
    if (state.phase !== "chainDone" || chainsLeft(state) < 1) return state;
    const chainIndex = state.chainIndex + 1;
    const words = state.game.chains[state.chainOrder[chainIndex]];
    return Object.assign({}, state, {
      phase: "chain",
      chainIndex,
      chain: buildChain(words),
      control: chainIndex % 2,
      direction: null,
      target: null,
      guessText: "",
      guessBy: null,
      notice: "",
    });
  }

  /* ============ Sudden death ============ */

  /** Every word that has been on the board this game. */
  function wordsSeen(state) {
    const seen = new Set();
    state.chainOrder.slice(0, state.chainIndex + 1).forEach((i) => {
      state.game.chains[i].forEach((word) => seen.add(word));
    });
    return seen;
  }

  function suddenFrom(chain, at) {
    return {
      before: chain[at - 1],
      word: chain[at],
      after: chain[at + 1],
      revealed: blankMask(chain[at]),
      winner: null,
    };
  }

  function rotate(list, by) {
    if (!list.length) return list;
    const at = ((by % list.length) + list.length) % list.length;
    return list.slice(at).concat(list.slice(0, at));
  }

  /**
   * A tiebreak word with its two neighbours as the clue. The teams must not
   * have seen it: a chain nobody played is searched first, then the played
   * ones, and only if EVERY candidate has already been on the board does it
   * fall back to the first word drawn - there still has to be a word.
   */
  function pickSudden(state, rng) {
    const played = new Set(state.chainOrder.slice(0, state.chainIndex + 1));
    const seen = wordsSeen(state);
    const fresh = [];
    const used = [];
    state.game.chains.forEach((chain, i) => (played.has(i) ? used : fresh).push(i));
    const from = Math.floor(rng() * Math.max(1, fresh.length || used.length));
    const first = Math.min(HIDDEN_COUNT - 1, Math.floor(rng() * HIDDEN_COUNT));
    const order = fresh.length ? rotate(fresh, from).concat(used) : rotate(used, from);
    let fallback = null;
    for (let c = 0; c < order.length; c += 1) {
      const chain = state.game.chains[order[c]];
      for (let w = 0; w < HIDDEN_COUNT; w += 1) {
        const found = suddenFrom(chain, 1 + ((first + w) % HIDDEN_COUNT));
        if (!fallback) fallback = found;
        if (!seen.has(found.word)) return found;
      }
    }
    return fallback;
  }

  /** `suddenDeath` — only when the chains are done and the scores are level. */
  function evSuddenDeath(state, event, rng) {
    if (state.phase !== "chainDone" || chainsLeft(state) > 0) return state;
    if (leader(state) !== null) return state;
    return Object.assign({}, state, {
      phase: "sudden",
      sudden: pickSudden(state, rng),
      target: null,
      direction: null,
      guessText: "",
      guessBy: null,
      notice: "Sudden death — first correct guess takes the lead.",
    });
  }

  function revealSudden(state) {
    const sd = state.sudden;
    if (!sd || sd.winner !== null) return state;
    const mask = revealNext(sd.word, sd.revealed);
    return Object.assign({}, state, { sudden: Object.assign({}, sd, { revealed: mask }) });
  }

  /**
   * The team in control is the one that spoke. A correct call ends the tie and
   * banks the last chain's value so the standings show a clear leader.
   */
  function judgeSudden(state, event) {
    const sd = state.sudden;
    if (!sd || sd.winner !== null) return state;
    if (event.correct !== true) {
      const other = state.control === 0 ? 1 : 0;
      return Object.assign({}, state, {
        control: other, guessText: "", guessBy: null,
        notice: `Wrong — ${state.teams[other].name} can call it.`,
      });
    }
    const scores = state.scores.slice();
    scores[state.control] += chainValue(state);
    return Object.assign({}, state, {
      phase: "chainDone",
      scores,
      sudden: Object.assign({}, sd, { revealed: revealAll(sd.word), winner: state.control }),
      guessText: "",
      guessBy: null,
      notice: `${state.teams[state.control].name} wins the tiebreak with ${sd.word}.`,
    });
  }

  /* ============ Speed Chain ============ */

  function buildSpeed(state, team) {
    const list = state.game.speedChains;
    const words = list[state.chainIndex % list.length];
    const queue = [];
    for (let i = 1; i <= HIDDEN_COUNT; i += 1) queue.push(i);
    return {
      team,
      words: words.slice(),
      // Spec 14 §1: the first letter of every hidden word is on the board.
      revealed: words.map((w, i) => (i === TOP || i === BOTTOM ? revealAll(w) : revealNext(w, blankMask(w)))),
      solved: words.map((w, i) => i === TOP || i === BOTTOM),
      marks: words.map(() => null),
      queue,
      seconds: state.game.settings.speedSeconds,
      // The clock lives as "how much is left" and only becomes an absolute
      // deadline while it is actually running - the same shape Weakest Link,
      // Pyramid and Password use, so a save or a reload never burns the round.
      remainingMs: state.game.settings.speedSeconds * 1000,
      deadline: null,
      started: false,
      over: false,
      got: 0,
      award: 0,
      allClear: false,
    };
  }

  /** `toSpeed{team}` — the bonus round, normally for the leading team. */
  function evToSpeed(state, event) {
    if (state.phase !== "chainDone" || chainsLeft(state) > 0) return state;
    // `Number(null)` is 0, so the team is matched strictly: anything that is
    // not literally 0 or 1 means "whoever is leading".
    const asked = event.team;
    const chosen = asked === 0 || asked === 1 ? asked : leader(state);
    if (chosen === null) return state;                 // still level: play sudden death first
    return Object.assign({}, state, {
      phase: "speed",
      speed: buildSpeed(state, chosen),
      guessText: "",
      guessBy: null,
      notice: "",
    });
  }

  /** `speedStart` - start, or resume a clock a save or an undo paused. */
  function evSpeedStart(state, event, rng, now) {
    if (state.phase !== "speed" || !state.speed || state.speed.started || state.speed.over) return state;
    const left = Number.isFinite(state.speed.remainingMs)
      ? state.speed.remainingMs : state.speed.seconds * 1000;
    return Object.assign({}, state, {
      speed: Object.assign({}, state.speed, {
        started: true,
        remainingMs: null,
        deadline: now + left,
      }),
    });
  }

  function finishSpeed(state, speed, reason) {
    const got = speed.marks.filter((m) => m === "got").length;
    const allClear = got === HIDDEN_COUNT;
    const s = state.game.settings;
    const award = allClear ? s.speedAllClear : got * s.speedPerWord;
    const scores = state.scores.slice();
    scores[speed.team] += award;
    return Object.assign({}, state, {
      scores,
      speed: Object.assign({}, speed, {
        over: true, deadline: null, remainingMs: 0, started: false, got, award, allClear,
        queue: [],
      }),
      notice: reason,
    });
  }

  /** `speedMark{result}` — ✓ banks the word, pass sends it to the back. */
  function evSpeedMark(state, event) {
    const sp = state.speed;
    if (state.phase !== "speed" || !sp || !sp.started || sp.over) return state;
    const index = speedCurrent(state);
    if (index === null) return state;
    const result = event.result === "got" || event.result === "pass" ? event.result : null;
    if (!result) return state;
    const marks = sp.marks.slice();
    const solved = sp.solved.slice();
    const revealed = sp.revealed.slice();
    let queue = sp.queue.slice(1);
    if (result === "got") {
      marks[index] = "got";
      solved[index] = true;
      revealed[index] = revealAll(sp.words[index]);
    } else {
      marks[index] = "pass";
      queue = queue.concat([index]);        // passed words come back
    }
    const next = Object.assign({}, sp, { marks, solved, revealed, queue });
    if (!queue.length) return finishSpeed(state, next, "All six — the full bonus!");
    return Object.assign({}, state, { speed: next });
  }

  function evSpeedExpired(state) {
    const sp = state.speed;
    if (state.phase !== "speed" || !sp || !sp.started || sp.over) return state;
    return finishSpeed(state, sp, "Time!");
  }

  /* ============ Ending ============ */

  function evFinish(state) {
    if (state.phase === "setup" || state.phase === "result") return state;
    return Object.assign({}, state, {
      phase: "result",
      target: null,
      direction: null,
      outcome: { winner: leader(state), scores: state.scores.slice() },
    });
  }

  function evUndo(state, event, rng, now) {
    if (!state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return Object.assign({}, previous, {
      game: state.game,
      // Snapshots are stored paused, but a save written by an older build (or
      // hand-edited) may still carry a running clock: pause that too, so undo
      // can never hand back a deadline that expires on the next paint.
      speed: pauseSpeed(previous.speed, now),
      history: state.history.slice(0, -1),
    });
  }

  function evNotice(state, event) {
    const text = cleanText(event.text, 120);
    if (text === state.notice) return state;
    return Object.assign({}, state, { notice: text });
  }

  /* ============ Reducer ============ */

  const HANDLERS = {
    start: evStart,
    reveal: evReveal,
    guess: evGuess,
    judge: evJudge,
    passControl: evPassControl,
    nextChain: evNextChain,
    suddenDeath: evSuddenDeath,
    toSpeed: evToSpeed,
    speedStart: evSpeedStart,
    speedMark: evSpeedMark,
    speedExpired: evSpeedExpired,
    finish: evFinish,
    notice: evNotice,
    undo: evUndo,
  };

  /**
   * Apply `event` to `state`; illegal or unknown events return `state`
   * unchanged. `rng` and `now` are injected — the core never calls Math.random
   * or Date.now itself.
   * @param {object} state @param {{type:string}} event
   * @param {function} [rng] @param {number} [now]
   */
  function reduce(state, event, rng, now) {
    if (!state || !isPlainObject(event) || typeof event.type !== "string") return state;
    // Own-property lookup: a prototype-shaped type ("toString", "__proto__") must never reach a handler.
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
    reveal: { direction: "top" },
    judge: { correct: true },
    guess: { text: "probe" },
    toSpeed: { team: null },
    speedMark: { result: "pass" },
  };

  /** Which events would do something right now (the host buttons read this). */
  function legalActions(state) {
    if (!state) return [];
    return Object.keys(HANDLERS).filter((type) => {
      if (type === "undo") return state.history.length > 0;
      const sample = SAMPLE_EVENTS[type] || {};
      const next = HANDLERS[type](state, Object.assign({ type }, sample), () => 0, 0);
      return !!next && next !== state;
    });
  }

  return {
    // content, re-exported so callers only need CrCore
    validateGame, normalizeGame, warningsFor, wordProblem, cleanText, cleanWord,
    sameWord, blankMask, revealAll, revealNext, allLettersShown, shownCount, isLetterAt,
    CHAIN_LENGTH, MAX_WORD_CHARS, MIN_CHAINS, MIN_SPEED_CHAINS, HIDDEN_COUNT,
    NAME_MAX, GUESS_MAX, PID_MAX, DEFAULT_SETTINGS,
    PHASES, DIRECTIONS, TOP, BOTTOM, MAX_HISTORY,
    // reducer
    createState, reduce, legalActions, pauseSpeed,
    // selectors
    frontier, eligibleWords, chainComplete, chainValue, chainsLeft, leader,
    speedCurrent, columnRows, maskedColumn, speedColumn, standings,
    teamOf, formatMoney, secondsLeft,
    validatePhoneMsg, phoneView,
  };
});
