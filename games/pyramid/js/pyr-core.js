/* ============================================================
   Pyramid — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no network, no timers: both clocks
   are stored as deadline timestamps with `now` injected, and
   every draw takes an injected `rng`, so the whole format is
   testable in Node. Runs in the browser (globalThis.PyrCore,
   after js/pyr-content.js) and in Node (module.exports).
   Reducers never mutate their inputs.

   The one rule that shapes this file: the current word is a
   SECRET from everyone except the giver. `phoneView` is the only
   masked surface, and no view it returns other than the giver's
   ever carries a word or a Winner's Circle category (spec 11 §4).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./pyr-content.js") : root.PyrContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.PyrCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail, settingsOf,
    validateGame, normalizeGame, warningsFor, drawNight,
    NAME_MAX, PID_MAX, CIRCLE_BOXES, DEFAULT_SETTINGS,
  } = Content;
  void (settingsOf && warningsFor && DEFAULT_SETTINGS);

  /* ============ Constants ============ */

  const PHASES = Object.freeze(["setup", "board", "play", "mainResult", "circle", "result", "standings"]);
  const MARKS = Object.freeze(["correct", "pass", "illegal"]);
  const MAX_HISTORY = 40;
  const TEAM_IDS = ["A", "B"];

  /** Clock events describe the passage of time, not a decision: undo skips them. */
  const NO_HISTORY = new Set(["clockStart", "clockPause", "clockExpired", "circleStart", "circleExpired", "undo"]);

  /**
   * @typedef {{running:boolean, deadline:number|null, remainingMs:number}} Clock
   * @typedef {{text:string, status:"pending"|"correct"|"passed"|"illegal"}} Word
   * @typedef {{pid:string, name:string}} Member
   */

  /* ============ Construction ============ */

  function freshClock(seconds) {
    return { running: false, deadline: null, remainingMs: Math.max(0, Math.round(seconds * 1000)) };
  }

  /** Two teams of two, cleaned. Throws with a plain-English message. */
  function normalizeTeams(teams) {
    if (!Array.isArray(teams) || teams.length !== 2) fail("Pyramid needs exactly two teams.");
    const seen = new Set();
    return teams.map((team, i) => {
      if (!isPlainObject(team)) fail(`Team ${TEAM_IDS[i]} is missing.`);
      const members = normalizeMembers(team.members, i, seen);
      return {
        id: TEAM_IDS[i],
        name: cleanText(team.name, NAME_MAX) || `Team ${TEAM_IDS[i]}`,
        members,
        firstGiver: team.firstGiver === 1 ? 1 : 0,
      };
    });
  }

  function normalizeMembers(raw, i, seen) {
    if (!Array.isArray(raw) || raw.length !== 2) {
      fail(`Team ${TEAM_IDS[i]} needs two players — a giver and a guesser.`);
    }
    return raw.map((m, j) => {
      if (!isPlainObject(m)) fail(`Team ${TEAM_IDS[i]} is missing a player.`);
      const pid = cleanText(m.pid, PID_MAX);
      const name = cleanText(m.name, NAME_MAX);
      if (!pid || !name) fail(`Team ${TEAM_IDS[i]}: both players need a name.`);
      if (seen.has(pid)) fail(`${name} cannot play on both teams.`);
      seen.add(pid);
      void j;
      return { pid, name };
    });
  }

  /**
   * Build the state for one night. `opts.rng` makes the draw deterministic and
   * `opts.usedIds` keeps a second game away from categories already played.
   * @param {object} game @param {object[]} teams
   * @param {{rng?:() => number, usedIds?:string[]}} [opts]
   */
  function createState(game, teams, opts) {
    const g = normalizeGame(game);
    const s = g.settings;
    const o = opts || {};
    const rng = typeof o.rng === "function" ? o.rng : Math.random;
    const draw = drawNight(g, s.categoriesPerTeam * 2, o.usedIds || [], rng);
    if (draw.board.length < s.categoriesPerTeam * 2) fail("There are not enough categories for a full board.");
    return {
      phase: "setup",
      game: g,
      teams: normalizeTeams(teams),
      board: draw.board.map((cat) => ({
        catId: cat.id, title: cat.title, hint: cat.hint, words: cat.words.slice(),
        team: null, correct: 0,
      })),
      tiebreakCat: draw.tiebreak
        ? { catId: draw.tiebreak.id, title: draw.tiebreak.title, hint: draw.tiebreak.hint,
          words: draw.tiebreak.words.slice() }
        : null,
      circleSet: draw.circle
        ? { setId: draw.circle.id, boxes: draw.circle.boxes.map((b, i) => ({
          category: b.category, value: s.circleValues[i],
        })) }
        : null,
      turn: 0,
      tiebreakPlayed: false,
      round: null,
      circle: null,
      tieWinner: null,
      outcome: null,
      history: [],
    };
  }

  /* ============ Immutable patch helpers ============ */

  function patch(state, fields) {
    return Object.assign({}, state, fields);
  }

  function withRound(state, fields) {
    return patch(state, { round: Object.assign({}, state.round, fields) });
  }

  function withCircle(state, fields) {
    return patch(state, { circle: Object.assign({}, state.circle, fields) });
  }

  /** Replace one board slot without touching the others. */
  function withSlot(state, index, fields) {
    return patch(state, {
      board: state.board.map((slot, i) => (i === index ? Object.assign({}, slot, fields) : slot)),
    });
  }

  /* ============ Roles ============ */

  /** Categories this team has already been given on the board. */
  function playedBy(state, team) {
    return state.board.filter((slot) => slot.team === team).length;
  }

  /**
   * Who gives and who guesses for team `team` in its `n`-th category (0-based).
   * With `swapRoles` off the pair keeps the roles they started with.
   */
  function rolesFor(state, team, n) {
    const t = state.teams[team];
    const swap = state.game.settings.swapRoles ? n % 2 : 0;
    const giverIdx = (t.firstGiver + swap) % 2;
    return { giver: t.members[giverIdx], guesser: t.members[(giverIdx + 1) % 2] };
  }

  /* ============ Rounds ============ */

  function makeWords(list) {
    return list.map((text) => ({ text, status: "pending" }));
  }

  function makeRound(state, slotIndex) {
    const slot = state.board[slotIndex];
    const team = state.turn;
    const roles = rolesFor(state, team, playedBy(state, team));
    return {
      slot: slotIndex, tiebreak: false, team,
      giverPid: roles.giver.pid, giverName: roles.giver.name,
      guesserPid: roles.guesser.pid, guesserName: roles.guesser.name,
      title: slot.title, hint: slot.hint,
      words: makeWords(slot.words),
      cursor: 0,
      clock: freshClock(state.game.settings.categorySeconds),
      started: false, expired: false, finished: false,
    };
  }

  function makeTiebreak(state) {
    const cat = state.tiebreakCat;
    const roles = rolesFor(state, 0, playedBy(state, 0));
    return {
      slot: -1, tiebreak: true, team: 0,
      giverPid: roles.giver.pid, giverName: roles.giver.name,
      guesserPid: roles.guesser.pid, guesserName: roles.guesser.name,
      title: cat.title, hint: cat.hint,
      words: makeWords(cat.words),
      cursor: 0,
      clock: freshClock(state.game.settings.tiebreakSeconds),
      started: false, expired: false, finished: false,
      tbScores: [0, 0], tbTurns: 0, tbWinner: null,
    };
  }

  /**
   * The next word index after `from`, wrapping. Correct and illegal words are
   * gone for good; passed ones come back round once everything else has been
   * tried, which is exactly the show's rule. -1 when nothing is left.
   */
  function nextIndex(words, from) {
    for (let step = 1; step <= words.length; step += 1) {
      const i = (from + step) % words.length;
      const st = words[i].status;
      if (st === "pending" || st === "passed") return i;
    }
    const st = words[from] && words[from].status;
    return st === "pending" || st === "passed" ? from : -1;
  }

  function markWords(words, cursor, result) {
    const status = result === "correct" ? "correct" : (result === "pass" ? "passed" : "illegal");
    return words.map((w, i) => (i === cursor ? { text: w.text, status } : w));
  }

  function correctCount(words) {
    return words.filter((w) => w.status === "correct").length;
  }

  /* ============ Reducer ============ */

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

  /** A history entry never contains its own history. */
  function snapshot(state) {
    return patch(state, { history: [] });
  }

  function evStart(state) {
    if (state.phase !== "setup") return state;
    return patch(state, { phase: "board" });
  }

  function evPickCategory(state, ev) {
    if (state.phase !== "board") return state;
    if (!isIntIn(ev.index, 0, state.board.length - 1)) return state;
    if (state.board[ev.index].team !== null) return state;
    // Roles are counted BEFORE the slot is claimed, or the swap would skip a turn.
    const round = makeRound(state, ev.index);
    const claimed = withSlot(state, ev.index, { team: state.turn, correct: 0 });
    return patch(claimed, { phase: "play", round });
  }

  /* ---- the category clock ---- */

  function evClockStart(state, ev, at) {
    const r = state.round;
    if (state.phase !== "play" || !r || r.finished || r.clock.running || r.clock.remainingMs <= 0) return state;
    return withRound(state, {
      started: true,
      clock: { running: true, deadline: at + r.clock.remainingMs, remainingMs: r.clock.remainingMs },
    });
  }

  function evClockPause(state, ev, at) {
    const r = state.round;
    if (state.phase !== "play" || !r || !r.clock.running) return state;
    const left = Math.max(0, (r.clock.deadline || 0) - at);
    return withRound(state, { clock: { running: false, deadline: null, remainingMs: left } });
  }

  function evClockExpired(state) {
    const r = state.round;
    if (state.phase !== "play" || !r || !r.clock.running) return state;
    return withRound(state, {
      expired: true,
      clock: { running: false, deadline: null, remainingMs: 0 },
    });
  }

  /* ---- marking a word ---- */

  function evMark(state, ev) {
    const r = state.round;
    if (state.phase !== "play" || !r || r.finished || !r.started) return state;
    if (MARKS.indexOf(ev.result) < 0) return state;
    if (!r.words[r.cursor]) return state;
    return r.tiebreak ? markTiebreak(state, ev) : markCategory(state, ev);
  }

  function markCategory(state, ev) {
    const r = state.round;
    const words = markWords(r.words, r.cursor, ev.result);
    const next = nextIndex(words, r.cursor);
    // The buzzer does not cut off a word already being described: after the
    // clock expires the host still judges the word in flight, and THAT mark
    // closes the round (spec 11 §1, success state Y-U4).
    const finished = r.expired || next < 0;
    const scored = withSlot(state, r.slot, { correct: correctCount(words) });
    return patch(scored, {
      round: Object.assign({}, r, {
        words,
        cursor: next < 0 ? r.cursor : next,
        finished,
        clock: finished ? { running: false, deadline: null, remainingMs: 0 } : r.clock,
      }),
    });
  }

  /**
   * The tiebreak is one word each, alternating, on its own short clock. After
   * both teams have had a word the higher score goes to the Winner's Circle;
   * still level and the next pair is dealt.
   */
  function markTiebreak(state, ev) {
    const r = state.round;
    const words = markWords(r.words, r.cursor, ev.result);
    const scores = r.tbScores.slice();
    if (ev.result === "correct") scores[r.team] += 1;
    const turns = r.tbTurns + 1;
    const next = nextIndex(words, r.cursor);
    const pairDone = turns % 2 === 0;
    const decided = pairDone && scores[0] !== scores[1];
    const outOfWords = next < 0;
    const finished = decided || outOfWords;
    // Only COMPLETE pairs decide it: spec 11 §1 is "one word each", so if the
    // words run out mid-pair the unmatched word cannot win it — the host picks.
    const settled = pairDone ? scores : r.tbScores;
    const team = finished ? r.team : (pairDone ? 0 : 1 - r.team);
    // The roles follow the team, so the next word is given by the right player.
    const roles = rolesFor(state, team, playedBy(state, team));
    return withRound(state, {
      words,
      tbScores: scores,
      tbTurns: turns,
      tbWinner: settled[0] === settled[1] ? null : (settled[0] > settled[1] ? 0 : 1),
      cursor: outOfWords ? r.cursor : next,
      finished,
      team,
      giverPid: roles.giver.pid, giverName: roles.giver.name,
      guesserPid: roles.guesser.pid, guesserName: roles.guesser.name,
      started: false,
      expired: false,
      clock: finished
        ? { running: false, deadline: null, remainingMs: 0 }
        : freshClock(state.game.settings.tiebreakSeconds),
    });
  }

  /* ---- moving on ---- */

  function evNextTurn(state) {
    if (state.phase === "play" && state.round && state.round.finished) return afterRound(state);
    if (state.phase === "circle" && state.circle && state.circle.finished) return patch(state, { phase: "result" });
    if (state.phase === "result") return patch(state, { phase: "standings" });
    return state;
  }

  function afterRound(state) {
    const r = state.round;
    if (r.tiebreak) {
      return patch(state, { round: null, phase: "mainResult", tieWinner: r.tbWinner, tiebreakPlayed: true });
    }
    const unplayed = state.board.some((slot) => slot.team === null);
    if (!unplayed) return patch(state, { round: null, phase: "mainResult" });
    return patch(state, { round: null, phase: "board", turn: 1 - r.team });
  }

  function evTiebreak(state) {
    if (state.phase !== "mainResult" || !state.tiebreakCat || state.tiebreakPlayed) return state;
    const points = scores(state);
    if (points[0] !== points[1] || state.tieWinner !== null) return state;
    return patch(state, { phase: "play", round: makeTiebreak(state) });
  }

  /* ---- the Winner's Circle ---- */

  function evToCircle(state, ev) {
    if (state.phase !== "mainResult" || !state.circleSet) return state;
    const team = isIntIn(ev.team, 0, 1) ? ev.team : leader(state);
    if (team === null) return state;
    const roles = isIntIn(ev.giver, 0, 1)
      ? { giver: state.teams[team].members[ev.giver], guesser: state.teams[team].members[1 - ev.giver] }
      : rolesFor(state, team, playedBy(state, team));
    return patch(state, {
      phase: "circle",
      circle: {
        team, setId: state.circleSet.setId,
        giverPid: roles.giver.pid, giverName: roles.giver.name,
        guesserPid: roles.guesser.pid, guesserName: roles.guesser.name,
        boxes: state.circleSet.boxes.map((b) => ({ category: b.category, value: b.value, status: "pending" })),
        cursor: 0,
        clock: freshClock(state.game.settings.circleSeconds),
        started: false, expired: false, finished: false,
      },
    });
  }

  function evCircleStart(state, ev, at) {
    const c = state.circle;
    if (state.phase !== "circle" || !c || c.finished || c.clock.running || c.clock.remainingMs <= 0) return state;
    return withCircle(state, {
      started: true,
      clock: { running: true, deadline: at + c.clock.remainingMs, remainingMs: c.clock.remainingMs },
    });
  }

  function evCirclePause(state, ev, at) {
    const c = state.circle;
    if (state.phase !== "circle" || !c || !c.clock.running) return state;
    return withCircle(state, {
      clock: { running: false, deadline: null, remainingMs: Math.max(0, (c.clock.deadline || 0) - at) },
    });
  }

  function evCircleExpired(state) {
    const c = state.circle;
    if (state.phase !== "circle" || !c || !c.clock.running) return state;
    return withCircle(state, { expired: true, clock: { running: false, deadline: null, remainingMs: 0 } });
  }

  /** Which box the circle is on; skips boxes already won or blocked. */
  function nextBox(boxes, from) {
    for (let step = 1; step <= boxes.length; step += 1) {
      const i = (from + step) % boxes.length;
      if (boxes[i].status === "pending" || boxes[i].status === "passed") return i;
    }
    const st = boxes[from] && boxes[from].status;
    return st === "pending" || st === "passed" ? from : -1;
  }

  function evCircleMark(state, ev) {
    const c = state.circle;
    if (state.phase !== "circle" || !c || c.finished || !c.started) return state;
    if (MARKS.indexOf(ev.result) < 0 || !c.boxes[c.cursor]) return state;
    const status = ev.result === "correct" ? "won" : (ev.result === "pass" ? "passed" : "blocked");
    const boxes = c.boxes.map((b, i) => (i === c.cursor ? Object.assign({}, b, { status }) : b));
    const next = nextBox(boxes, c.cursor);
    const finished = c.expired || next < 0;
    const after = withCircle(state, {
      boxes,
      cursor: next < 0 ? c.cursor : next,
      finished,
      clock: finished ? { running: false, deadline: null, remainingMs: 0 } : c.clock,
    });
    return finished ? patch(after, { outcome: circleOutcome(after) }) : after;
  }

  function circleOutcome(state) {
    const c = state.circle;
    const won = c.boxes.filter((b) => b.status === "won");
    const cleared = won.length === CIRCLE_BOXES;
    return {
      team: c.team,
      teamName: state.teams[c.team].name,
      cleared,
      boxesWon: won.length,
      winnings: cleared ? state.game.settings.grandPrize : won.reduce((a, b) => a + b.value, 0),
    };
  }

  function evFinish(state) {
    if (state.phase === "standings") return state;
    const outcome = state.outcome || (state.circle ? circleOutcome(state) : null);
    return patch(state, { phase: "standings", outcome });
  }

  function evUndo(state) {
    if (!state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return patch(previous, { history: state.history.slice(0, -1) });
  }

  const HANDLERS = {
    start: evStart,
    pickCategory: evPickCategory,
    clockStart: evClockStart,
    clockPause: evClockPause,
    clockExpired: evClockExpired,
    mark: evMark,
    nextTurn: evNextTurn,
    tiebreak: evTiebreak,
    toCircle: evToCircle,
    circleStart: evCircleStart,
    circlePause: evCirclePause,
    circleExpired: evCircleExpired,
    circleMark: evCircleMark,
    finish: evFinish,
    undo: evUndo,
  };

  /* ============ Selectors ============ */

  /** Main-game points, one per team: one point per word taken. */
  function scores(state) {
    return [0, 1].map((team) => state.board
      .filter((slot) => slot.team === team)
      .reduce((sum, slot) => sum + slot.correct, 0));
  }

  /** The team on top after the main game, or null while it is level. */
  function leader(state) {
    if (state.tieWinner !== null && state.tieWinner !== undefined) return state.tieWinner;
    const points = scores(state);
    if (points[0] === points[1]) return null;
    return points[0] > points[1] ? 0 : 1;
  }

  /** The word the giver is describing right now, or null. GIVER-ONLY. */
  function currentWord(state) {
    const r = state.round;
    if (!r || r.finished) return null;
    const word = r.words[r.cursor];
    return word ? word.text : null;
  }

  /** Everything still in play, in the order it will come round. GIVER-ONLY. */
  function remainingWords(state) {
    const r = state.round;
    if (!r || r.finished) return [];
    const out = [];
    for (let step = 0; step < r.words.length; step += 1) {
      const w = r.words[(r.cursor + step) % r.words.length];
      if (w.status === "pending" || w.status === "passed") out.push(w);
    }
    return out;
  }

  /** `3 / 7` for the host screen and both phones. */
  function wordCount(state) {
    const r = state.round;
    if (!r) return { done: 0, total: 0, left: 0 };
    return {
      done: correctCount(r.words),
      total: r.words.length,
      left: r.words.filter((w) => w.status === "pending" || w.status === "passed").length,
    };
  }

  /** What the Winner's Circle is worth as it stands. */
  function circleWinnings(state) {
    const c = state.circle;
    if (!c) return 0;
    const won = c.boxes.filter((b) => b.status === "won");
    if (won.length === CIRCLE_BOXES) return state.game.settings.grandPrize;
    return won.reduce((a, b) => a + b.value, 0);
  }

  function formatMoney(state, amount) {
    const currency = state.game ? state.game.settings.currency : "$";
    return `${currency}${Number(amount || 0).toLocaleString("en-US")}`;
  }

  /** Whole seconds left on a deadline; 0 when there is no clock. */
  function secondsLeft(clock, now) {
    if (!clock) return 0;
    if (!clock.running || clock.deadline === null) return Math.ceil(Math.max(0, clock.remainingMs) / 1000);
    return Math.max(0, Math.ceil((clock.deadline - now) / 1000));
  }

  function teamIndexOf(state, pid) {
    for (let i = 0; i < state.teams.length; i += 1) {
      if (state.teams[i].members.some((m) => m.pid === pid)) return i;
    }
    return null;
  }

  function nameOf(state, pid) {
    for (const team of state.teams) {
      const found = team.members.find((m) => m.pid === pid);
      if (found) return found.name;
    }
    return "";
  }

  /** The night's line: money for both members of the winning team. */
  function standings(state) {
    const money = state.outcome ? state.outcome.winnings : 0;
    const winner = state.outcome ? state.outcome.team : null;
    const points = scores(state);
    return state.teams.map((team, i) => ({
      team: i,
      name: team.name,
      points: points[i],
      winnings: i === winner ? money : 0,
      members: team.members.map((m) => ({ pid: m.pid, name: m.name })),
    }));
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame. An illegal clue is a
   * host-only judgement, so a phone may only send correct or pass.
   * @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "ready") return { t: "ready" };
    if (obj.t === "mark") {
      return obj.result === "correct" || obj.result === "pass" ? { t: "mark", result: obj.result } : null;
    }
    return null;
  }

  /**
   * May the giver TAP a mark right now? A pause is the host stopping play, so
   * the phone goes quiet with the clock; the buzzer does not, because the word
   * in flight still has to be judged (defect Y-5). The host’s own buttons are
   * deliberately wider than this — the host is the judge and may mark whenever.
   * @param {object} state @param {string} pid
   */
  function phoneCanMark(state, pid) {
    if (!state) return false;
    if (state.phase === "play" && state.round) {
      const r = state.round;
      return r.giverPid === pid && !r.finished && r.started && (r.clock.running || r.expired);
    }
    if (state.phase === "circle" && state.circle) {
      const c = state.circle;
      return c.giverPid === pid && !c.finished && c.started && (c.clock.running || c.expired);
    }
    return false;
  }

  /** The clock fields every phone screen may see. Never a word. */
  function clockView(clock) {
    return {
      running: !!(clock && clock.running),
      deadline: clock && clock.running ? clock.deadline : null,
      remainingMs: clock ? clock.remainingMs : 0,
    };
  }

  /**
   * What phone `pid` should render. Only the giver's view carries `word`, and
   * only the circle giver's carries `circleCategory`: this is the public
   * surface the whole game rests on (success state Y-U10).
   */
  function phoneView(state, pid) {
    const team = teamIndexOf(state, pid);
    const base = {
      screen: "wait",
      name: nameOf(state, pid),
      team,
      teamName: team === null ? "" : state.teams[team].name,
      points: scores(state),
      teamNames: state.teams.map((t) => t.name),
      sub: "",
    };
    if (state.phase === "play" && state.round) return Object.assign(base, playPhoneView(state, pid));
    if (state.phase === "circle" && state.circle) return Object.assign(base, circlePhoneView(state, pid));
    if (state.phase === "result" || state.phase === "standings") {
      return Object.assign(base, resultPhoneView(state, pid));
    }
    if (state.phase === "mainResult") return Object.assign(base, { sub: "The main game is over — stand by." });
    if (state.phase === "board") return Object.assign(base, { sub: "Picking a category…" });
    return base;
  }

  /** What the giver’s phone says under the word, in the three clock states. */
  function markSub(round, canMark, playing) {
    if (canMark) return playing;
    if (round.started) return "The host has paused the clock.";
    return "Wait for the host to start the clock.";
  }

  function playPhoneView(state, pid) {
    const r = state.round;
    const count = wordCount(state);
    const clock = clockView(r.clock);
    if (r.finished) {
      return { screen: "wait", count, sub: `${r.title} is over — watch the host screen.` };
    }
    if (pid === r.giverPid) {
      return {
        screen: "giver", word: currentWord(state), category: r.title, hint: r.hint,
        count, clock, started: r.started, expired: r.expired,
        canMark: phoneCanMark(state, pid),
        sub: markSub(r, phoneCanMark(state, pid), "Describe it — never say the word."),
      };
    }
    if (pid === r.guesserPid) {
      return { screen: "guesser", category: r.title, count, clock, sub: "Shout out your answers." };
    }
    return {
      screen: "wait", count, clock,
      sub: `${state.teams[r.team].name} is playing “${r.title}”.`,
    };
  }

  function circlePhoneView(state, pid) {
    const c = state.circle;
    const won = c.boxes.filter((b) => b.status === "won").length;
    const clock = clockView(c.clock);
    const count = { done: won, total: c.boxes.length, left: c.boxes.filter((b) => b.status !== "won"
      && b.status !== "blocked").length };
    if (c.finished) return { screen: "wait", count, sub: "The Winner’s Circle is over — watch the host screen." };
    if (pid === c.giverPid) {
      const box = c.boxes[c.cursor];
      return {
        screen: "circle-giver", circleCategory: box ? box.category : "", boxValue: box ? box.value : 0,
        count, clock, started: c.started,
        canMark: phoneCanMark(state, pid),
        sub: markSub(c, phoneCanMark(state, pid), "Give examples — never describe the subject."),
      };
    }
    if (pid === c.guesserPid) {
      return { screen: "circle-guesser", count, clock, sub: "Name the subject from the examples." };
    }
    return { screen: "wait", count, clock, sub: `${state.teams[c.team].name} is in the Winner’s Circle.` };
  }

  function resultPhoneView(state, pid) {
    const rows = standings(state);
    const team = teamIndexOf(state, pid);
    const mine = team !== null && state.outcome && state.outcome.team === team
      ? formatMoney(state, state.outcome.winnings) : null;
    return {
      screen: "result",
      mine,
      cleared: !!(state.outcome && state.outcome.cleared),
      standings: rows.map((row) => ({ name: row.name, points: row.points,
        winnings: formatMoney(state, row.winnings) })),
      sub: mine ? "That is yours — both of you." : "Thanks for playing.",
    };
  }

  /* ============ Export ============ */

  return {
    // content (re-exported so callers only need PyrCore)
    validateGame, normalizeGame, warningsFor, settingsOf, drawNight,
    cleanText, isPlainObject, isIntIn, NAME_MAX, PID_MAX, CIRCLE_BOXES, DEFAULT_SETTINGS,
    // construction + reducer
    createState, reduce, normalizeTeams,
    PHASES, MARKS, MAX_HISTORY, TEAM_IDS,
    // selectors
    scores, leader, currentWord, remainingWords, wordCount, circleWinnings,
    formatMoney, secondsLeft, teamIndexOf, nameOf, standings, rolesFor, playedBy,
    correctCount, nextIndex, nextBox, circleOutcome,
    // phones
    validatePhoneMsg, phoneView, clockView, phoneCanMark,
  };
});
