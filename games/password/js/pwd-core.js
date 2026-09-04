/* ============================================================
   Password — pure game core
   The immutable reducer and the selectors the host UI and the
   phone screens read. No DOM, no network, no timers: the
   Lightning Round clock is a deadline timestamp with `now`
   injected and every draw takes an injected `rng`, so the whole
   format is testable in Node. Runs in the browser
   (globalThis.PwdCore, after js/pwd-content.js) and in Node
   (module.exports). Reducers never mutate their inputs.

   The one rule that shapes this file: the password is a SECRET
   from everyone except the two GIVERS. `phoneView` is the only
   masked surface, and the only views it returns that carry a
   word are the two givers' — and, in the Lightning Round, the
   winning giver's alone (spec 13 §4).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./pwd-content.js") : root.PwdContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.PwdCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const {
    isPlainObject, isIntIn, cleanText, fail, settingsOf,
    validateGame, normalizeGame, warningsFor, drawOrder, wordAt,
    NAME_MAX, PID_MAX, DEFAULT_SETTINGS,
  } = Content;
  void (settingsOf && warningsFor && DEFAULT_SETTINGS);

  /* ============ Constants ============ */

  const PHASES = Object.freeze(["setup", "word", "gameOver", "lightning", "result", "standings"]);
  const GUESSES = Object.freeze(["correct", "wrong"]);
  const LIGHTNING_MARKS = Object.freeze(["got", "pass"]);
  const MAX_HISTORY = 40;
  const TEAM_IDS = ["A", "B"];

  /** Clock events describe the passage of time, not a decision: undo skips them. */
  const NO_HISTORY = new Set(["lightningStart", "lightningPause", "lightningExpired", "undo"]);

  /**
   * @typedef {{running:boolean, deadline:number|null, remainingMs:number}} Clock
   * @typedef {{pid:string, name:string}} Member
   */

  /* ============ Construction ============ */

  function freshClock(seconds) {
    return { running: false, deadline: null, remainingMs: Math.max(0, Math.round(seconds * 1000)) };
  }

  /** Two teams of two, cleaned. Throws with a plain-English message. */
  function normalizeTeams(teams) {
    if (!Array.isArray(teams) || teams.length !== 2) fail("Password needs exactly two teams.");
    const seen = new Set();
    return teams.map((team, i) => {
      if (!isPlainObject(team)) fail(`Team ${TEAM_IDS[i]} is missing.`);
      return {
        id: TEAM_IDS[i],
        name: cleanText(team.name, NAME_MAX) || `Team ${TEAM_IDS[i]}`,
        members: normalizeMembers(team.members, i, seen),
        firstGiver: team.firstGiver === 1 ? 1 : 0,
      };
    });
  }

  function normalizeMembers(raw, i, seen) {
    if (!Array.isArray(raw) || raw.length !== 2) {
      fail(`Team ${TEAM_IDS[i]} needs two players — a giver and a receiver.`);
    }
    return raw.map((m) => {
      if (!isPlainObject(m)) fail(`Team ${TEAM_IDS[i]} is missing a player.`);
      const pid = cleanText(m.pid, PID_MAX);
      const name = cleanText(m.name, NAME_MAX);
      if (!pid || !name) fail(`Team ${TEAM_IDS[i]}: both players need a name.`);
      if (seen.has(pid)) fail(`${name} cannot play on both teams.`);
      seen.add(pid);
      return { pid, name };
    });
  }

  /**
   * Build the state for one game. `opts.rng` + `opts.shuffle` make the word
   * order deterministic; `opts.firstTeam` is the host's choice of who opens.
   * @param {object} game @param {object[]} teams
   * @param {{rng?:() => number, shuffle?:boolean, firstTeam?:number}} [opts]
   */
  function createState(game, teams, opts) {
    const g = normalizeGame(game);
    const o = opts || {};
    return {
      phase: "setup",
      game: g,
      teams: normalizeTeams(teams),
      order: drawOrder(g, { shuffle: !!o.shuffle, rng: o.rng }),
      shuffled: !!o.shuffle,
      cursor: 0,
      repeating: false,
      scores: [0, 0],
      gameNo: 1,
      wordsPlayed: 0,
      firstTeam: isIntIn(o.firstTeam, 0, 1) ? o.firstTeam : 0,
      round: null,
      lightning: null,
      winner: null,
      outcome: null,
      night: [],
      banked: false,
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

  function withLightning(state, fields) {
    return patch(state, { lightning: Object.assign({}, state.lightning, fields) });
  }

  /* ============ Roles ============ */

  /**
   * Who gives and who receives for `team` right now. The pair swap between
   * words unless the host turned that off (spec 13 §1).
   * @param {object} state @param {number} team
   */
  function rolesFor(state, team) {
    const t = state.teams[team];
    const swap = state.game.settings.swapRoles ? state.wordsPlayed % 2 : 0;
    const giverIdx = (t.firstGiver + swap) % 2;
    return { giver: t.members[giverIdx], receiver: t.members[(giverIdx + 1) % 2] };
  }

  /** The two pids that may see the password. */
  function giverPids(state) {
    return [0, 1].map((team) => rolesFor(state, team).giver.pid);
  }

  /* ============ Words ============ */

  /** Deal the next password to a fresh round. `first` gives the opening clue. */
  function dealWord(state, first) {
    const drawn = wordAt(state.order, state.cursor);
    return patch(state, {
      phase: "word",
      cursor: state.cursor + 1,
      repeating: state.repeating || drawn.repeating,
      firstTeam: first,
      round: {
        word: drawn.word,
        clues: 0,
        turn: first,
        firstTeam: first,
        awaitingGuess: false,
        won: null,
        dead: false,
        finished: false,
        log: [],
      },
    });
  }

  /** The points a correct guess is worth right now: 10, 9, 8 … 1, then 0. */
  function valueAfter(state, clues) {
    const start = state.game.settings.startValue;
    return Math.max(0, start - Math.max(0, clues - 1));
  }

  function logged(round, entry) {
    return round.log.concat([entry]).slice(-40);
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
    return dealWord(state, state.firstTeam);
  }

  /* ---- giving a clue ---- */

  function evClueGiven(state, ev) {
    const r = state.round;
    if (state.phase !== "word" || !r || r.finished || r.awaitingGuess) return state;
    if (ev.team !== undefined && ev.team !== null && ev.team !== r.turn) return state;
    const clues = r.clues + 1;
    return withRound(state, {
      clues,
      awaitingGuess: true,
      log: logged(r, { team: r.turn, kind: "clue", value: valueAfter(state, clues) }),
    });
  }

  function evGuess(state, ev) {
    const r = state.round;
    if (state.phase !== "word" || !r || r.finished || !r.awaitingGuess) return state;
    if (GUESSES.indexOf(ev.result) < 0) return state;
    return ev.result === "correct" ? guessCorrect(state, r) : guessWrong(state, r);
  }

  function guessCorrect(state, r) {
    const points = valueAfter(state, r.clues);
    const scores = state.scores.slice();
    scores[r.turn] += points;
    const won = scores[r.turn] >= state.game.settings.targetScore;
    // The Lightning Round follows straight on, so it keeps the roles of the
    // word that won it (the host can still hand the clues to the other partner).
    return patch(state, {
      scores,
      winner: won ? r.turn : state.winner,
      phase: won ? "gameOver" : "word",
      round: Object.assign({}, r, {
        awaitingGuess: false, won: r.turn, points, finished: true,
        log: logged(r, { team: r.turn, kind: "correct", value: points }),
      }),
    });
  }

  function guessWrong(state, r) {
    const dead = r.clues >= state.game.settings.startValue;
    return withRound(state, {
      awaitingGuess: false,
      turn: dead ? r.turn : 1 - r.turn,
      dead,
      finished: dead,
      log: logged(r, { team: r.turn, kind: "wrong", value: 0 }),
    });
  }

  /**
   * An illegal clue forfeits the clue: control passes to the other team and the
   * value drops as if a clue had been given (spec 13 §1). The host may press it
   * before OR after "Clue given", so the clue is only counted when it has not
   * been counted already — either way the ladder moves exactly one rung.
   */
  function evIllegal(state) {
    const r = state.round;
    if (state.phase !== "word" || !r || r.finished) return state;
    const clues = r.awaitingGuess ? r.clues : r.clues + 1;
    const dead = clues >= state.game.settings.startValue;
    return withRound(state, {
      clues,
      awaitingGuess: false,
      turn: dead ? r.turn : 1 - r.turn,
      dead,
      finished: dead,
      log: logged(r, { team: r.turn, kind: "illegal", value: valueAfter(state, clues) }),
    });
  }

  /** The host names who opens this word. Only before the first clue. */
  function evSetFirst(state, ev) {
    const r = state.round;
    if (state.phase !== "word" || !r || r.finished || r.clues > 0) return state;
    if (!isIntIn(ev.team, 0, 1) || ev.team === r.turn) return state;
    return patch(withRound(state, { turn: ev.team, firstTeam: ev.team }), { firstTeam: ev.team });
  }

  /** Throw the word out — a misprint, a word somebody already heard. */
  function evSkipWord(state) {
    const r = state.round;
    if (state.phase !== "word" || !r || r.finished) return state;
    return withRound(state, { awaitingGuess: false, dead: true, finished: true });
  }

  /** The generic "move on": next word, then the result, then the standings. */
  function evNextWord(state) {
    if (state.phase === "word" && state.round && state.round.finished) return afterWord(state);
    if (state.phase === "lightning" && state.lightning && state.lightning.finished) {
      return patch(state, { phase: "result" });
    }
    if (state.phase === "result") return patch(bankGame(state), { phase: "standings" });
    return state;
  }

  /** The team that did NOT win the last word opens the next one. */
  function afterWord(state) {
    const r = state.round;
    const first = r.won === null ? 1 - r.firstTeam : 1 - r.won;
    return dealWord(patch(state, { wordsPlayed: state.wordsPlayed + 1 }), first);
  }

  /* ---- the Lightning Round ---- */

  function evToLightning(state, ev) {
    if (state.phase !== "gameOver") return state;
    const team = isIntIn(ev.team, 0, 1) ? ev.team : state.winner;
    if (!isIntIn(team, 0, 1)) return state;
    const s = state.game.settings;
    const roles = isIntIn(ev.giver, 0, 1)
      ? { giver: state.teams[team].members[ev.giver], receiver: state.teams[team].members[1 - ev.giver] }
      : rolesFor(state, team);
    const drawn = [];
    for (let i = 0; i < s.lightningWords; i += 1) drawn.push(wordAt(state.order, state.cursor + i));
    return patch(state, {
      phase: "lightning",
      cursor: state.cursor + s.lightningWords,
      repeating: state.repeating || drawn.some((d) => d.repeating),
      lightning: {
        team,
        giverPid: roles.giver.pid, giverName: roles.giver.name,
        receiverPid: roles.receiver.pid, receiverName: roles.receiver.name,
        words: drawn.map((d) => ({ text: d.word, status: "pending" })),
        cursor: 0,
        clock: freshClock(s.lightningSeconds),
        started: false, expired: false, finished: false,
      },
    });
  }

  function evLightningStart(state, ev, at) {
    const l = state.lightning;
    if (state.phase !== "lightning" || !l || l.finished || l.clock.running || l.clock.remainingMs <= 0) return state;
    return withLightning(state, {
      started: true,
      clock: { running: true, deadline: at + l.clock.remainingMs, remainingMs: l.clock.remainingMs },
    });
  }

  function evLightningPause(state, ev, at) {
    const l = state.lightning;
    if (state.phase !== "lightning" || !l || !l.clock.running) return state;
    return withLightning(state, {
      clock: { running: false, deadline: null, remainingMs: Math.max(0, (l.clock.deadline || 0) - at) },
    });
  }

  function evLightningExpired(state) {
    const l = state.lightning;
    if (state.phase !== "lightning" || !l || !l.clock.running) return state;
    return withLightning(state, { expired: true, clock: { running: false, deadline: null, remainingMs: 0 } });
  }

  /**
   * The next word after `from`, wrapping. Words taken are gone; passed words
   * come round again once everything else has been tried — the show's rule.
   * -1 when nothing is left.
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

  function evLightningMark(state, ev) {
    const l = state.lightning;
    if (state.phase !== "lightning" || !l || l.finished || !l.started) return state;
    // A pause is the host stopping play: nothing is judged off the clock, from
    // the host's buttons, the hotkeys or a phone (the buzzer is the exception —
    // the word in flight is still judged). Same rule as phoneCanMark.
    if (!l.clock.running && !l.expired) return state;
    if (LIGHTNING_MARKS.indexOf(ev.result) < 0 || !l.words[l.cursor]) return state;
    const status = ev.result === "got" ? "got" : "passed";
    const words = l.words.map((w, i) => (i === l.cursor ? { text: w.text, status } : w));
    const next = nextIndex(words, l.cursor);
    // The buzzer does not cut off the word in flight: after the clock expires
    // the host still judges it, and THAT mark closes the round (PW-U9).
    const finished = l.expired || next < 0;
    const after = withLightning(state, {
      words,
      cursor: next < 0 ? l.cursor : next,
      finished,
      clock: finished ? { running: false, deadline: null, remainingMs: 0 } : l.clock,
    });
    return finished ? patch(after, { outcome: lightningOutcome(after) }) : after;
  }

  function lightningOutcome(state) {
    const l = state.lightning;
    const s = state.game.settings;
    const got = l.words.filter((w) => w.status === "got").length;
    const allFive = got === l.words.length && l.words.length > 0;
    return {
      team: l.team,
      teamName: state.teams[l.team].name,
      got,
      total: l.words.length,
      allFive,
      doubled: allFive && s.allFiveBonus,
      money: got * s.lightningValue * (allFive && s.allFiveBonus ? 2 : 1),
    };
  }

  /* ---- ending a game, ending the night ---- */

  /** Bank the game just played into the night's record. Idempotent. */
  function bankGame(state) {
    if (state.banked) return state;
    const money = [0, 0];
    if (state.outcome) money[state.outcome.team] = state.outcome.money;
    return patch(state, {
      banked: true,
      night: state.night.concat([{
        gameNo: state.gameNo,
        scores: state.scores.slice(),
        winner: state.winner,
        money,
        allFive: !!(state.outcome && state.outcome.allFive),
      }]),
    });
  }

  /** Another game with the same teams and the rest of the word list. */
  function evNextGame(state) {
    if (state.phase !== "result" && state.phase !== "standings" && state.phase !== "gameOver") return state;
    const banked = bankGame(state);
    return dealWord(patch(banked, {
      gameNo: banked.gameNo + 1,
      scores: [0, 0],
      wordsPlayed: 0,
      winner: null,
      lightning: null,
      outcome: null,
      banked: false,
    }), 0);
  }

  function evFinish(state) {
    if (state.phase === "standings") return state;
    return patch(bankGame(state), { phase: "standings" });
  }

  function evUndo(state) {
    if (!state.history.length) return state;
    const previous = state.history[state.history.length - 1];
    return patch(previous, { history: state.history.slice(0, -1) });
  }

  const HANDLERS = {
    start: evStart,
    clueGiven: evClueGiven,
    guess: evGuess,
    illegal: evIllegal,
    setFirst: evSetFirst,
    skipWord: evSkipWord,
    nextWord: evNextWord,
    toLightning: evToLightning,
    lightningStart: evLightningStart,
    lightningPause: evLightningPause,
    lightningExpired: evLightningExpired,
    lightningMark: evLightningMark,
    nextGame: evNextGame,
    finish: evFinish,
    undo: evUndo,
  };

  /* ============ Selectors ============ */

  /** What the word is worth to whoever guesses it next. */
  function value(state) {
    if (!state || !state.round) return 0;
    return valueAfter(state, state.round.clues);
  }

  /** Whose clue it is. */
  function turn(state) {
    if (!state) return 0;
    return state.round ? state.round.turn : state.firstTeam;
  }

  function scores(state) {
    return state.scores.slice();
  }

  /** How many clues have been given on this word. */
  function clueCount(state) {
    return state.round ? state.round.clues : 0;
  }

  /** The password in play. GIVERS ONLY — never call this from host rendering
      unless the host has explicitly asked to see it. */
  function currentWord(state) {
    return state.round && !state.round.finished ? state.round.word : null;
  }

  /** The Lightning Round word being clued. THE LIGHTNING GIVER ONLY. */
  function lightningWord(state) {
    const l = state.lightning;
    if (!l || l.finished) return null;
    const w = l.words[l.cursor];
    return w ? w.text : null;
  }

  /** What the Lightning Round is worth as it stands. */
  function lightningTotal(state) {
    const l = state.lightning;
    if (!l) return 0;
    if (state.outcome) return state.outcome.money;
    const s = state.game.settings;
    const got = l.words.filter((w) => w.status === "got").length;
    const allFive = got === l.words.length && l.words.length > 0;
    return got * s.lightningValue * (allFive && s.allFiveBonus ? 2 : 1);
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

  /** The night's line: points now, games won, and Lightning money for both. */
  function standings(state) {
    const banked = bankGame(state).night;
    return state.teams.map((team, i) => ({
      team: i,
      name: team.name,
      points: state.scores[i],
      gamesWon: banked.filter((g) => g.winner === i).length,
      winnings: banked.reduce((sum, g) => sum + g.money[i], 0),
      members: team.members.map((m) => ({ pid: m.pid, name: m.name })),
    }));
  }

  /* ============ Phone payloads ============ */

  /**
   * Validate a phone->host payload: a narrow copy, or null for junk — callers
   * ignore null and never throw on a hostile frame. Judging a guess and calling
   * a clue illegal are host-only, so no phone message can express either.
   * @param {unknown} obj
   */
  function validatePhoneMsg(obj) {
    if (!isPlainObject(obj) || typeof obj.t !== "string") return null;
    if (obj.t === "ready" || obj.t === "clue" || obj.t === "got" || obj.t === "pass") return { t: obj.t };
    return null;
  }

  /** May this pid tap "Clue given" right now? The current giver, mid-word. */
  function phoneCanClue(state, pid) {
    const r = state && state.round;
    if (!state || state.phase !== "word" || !r || r.finished || r.awaitingGuess) return false;
    return rolesFor(state, r.turn).giver.pid === pid;
  }

  /**
   * May this pid tap Got it / Pass in the Lightning Round? Only the giver, and
   * only once the host has the clock going (or at the buzzer, judging the word
   * in flight — a pause is the host stopping play, so the phone goes quiet).
   */
  function phoneCanMark(state, pid) {
    const l = state && state.lightning;
    if (!state || state.phase !== "lightning" || !l || l.finished || !l.started) return false;
    return l.giverPid === pid && (l.clock.running || l.expired);
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
   * What phone `pid` should render. Only the two givers' views carry `word`,
   * and in the Lightning Round only the winning giver's does: this is the
   * public surface the whole game rests on (success state PW-U10).
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
      target: state.game.settings.targetScore,
      sub: "",
    };
    if (state.phase === "word" && state.round) return Object.assign(base, wordPhoneView(state, pid, team));
    if (state.phase === "lightning" && state.lightning) return Object.assign(base, lightningPhoneView(state, pid));
    if (state.phase === "result" || state.phase === "standings") {
      return Object.assign(base, resultPhoneView(state, pid, team));
    }
    if (state.phase === "gameOver") {
      const champion = isIntIn(state.winner, 0, 1) ? state.teams[state.winner].name : "The winners";
      return Object.assign(base, { sub: `${champion} reach ${base.target} — stand by.` });
    }
    return base;
  }

  function wordPhoneView(state, pid, team) {
    const r = state.round;
    const shared = { value: value(state), clues: r.clues, turnTeam: r.turn,
      turnName: state.teams[r.turn].name, yourTurn: team === r.turn };
    if (r.finished) {
      return Object.assign(shared, { screen: "wait",
        sub: r.won === null ? "Nobody took that one — stand by." : `${state.teams[r.won].name} took it.` });
    }
    if (giverPids(state).indexOf(pid) >= 0) {
      return Object.assign(shared, {
        screen: "giver",
        word: r.word,
        canClue: phoneCanClue(state, pid),
        sub: giverSub(state, r, team),
      });
    }
    if (team === null) return Object.assign(shared, { screen: "wait", sub: `${state.teams[r.turn].name} to clue.` });
    return Object.assign(shared, {
      screen: "receiver",
      sub: team === r.turn
        ? `One guess, and it is worth ${value(state)}.`
        : `${state.teams[r.turn].name} are clueing — your turn next.`,
    });
  }

  function giverSub(state, r, team) {
    if (team !== r.turn) return `${state.teams[r.turn].name} are clueing — wait your turn.`;
    if (r.awaitingGuess) return "Clue given. The host is judging the guess.";
    return "One word. Never the password, never part of it.";
  }

  function lightningPhoneView(state, pid) {
    const l = state.lightning;
    const got = l.words.filter((w) => w.status === "got").length;
    const shared = {
      count: { done: got, total: l.words.length,
        left: l.words.filter((w) => w.status !== "got").length },
      clock: clockView(l.clock),
      started: l.started,
      money: lightningTotal(state),
      moneyText: formatMoney(state, lightningTotal(state)),
    };
    if (l.finished) {
      return Object.assign(shared, { screen: "wait", sub: "The Lightning Round is over — watch the host screen." });
    }
    if (pid === l.giverPid) {
      return Object.assign(shared, {
        screen: "lightning-giver",
        word: lightningWord(state),
        canMark: phoneCanMark(state, pid),
        sub: l.started ? "One word per clue. Pass and come back if you must."
          : "Wait for the host to start the clock.",
      });
    }
    if (pid === l.receiverPid) {
      return Object.assign(shared, { screen: "lightning-receiver", sub: "Shout the passwords — as fast as you can." });
    }
    return Object.assign(shared, { screen: "wait", sub: `${state.teams[l.team].name} are in the Lightning Round.` });
  }

  function resultPhoneView(state, pid, team) {
    const rows = standings(state);
    const mine = team === null ? null : formatMoney(state, rows[team].winnings);
    return {
      screen: "result",
      mine,
      won: !!(state.outcome && state.outcome.team === team),
      standings: rows.map((row) => ({ name: row.name, points: row.points,
        winnings: formatMoney(state, row.winnings) })),
      sub: mine && rows[team].winnings > 0 ? "That is yours — both of you." : "Thanks for playing.",
    };
  }

  /* ============ Export ============ */

  return {
    // content (re-exported so callers only need PwdCore)
    validateGame, normalizeGame, warningsFor, settingsOf, drawOrder, wordAt,
    cleanText, isPlainObject, isIntIn, NAME_MAX, PID_MAX, DEFAULT_SETTINGS,
    // construction + reducer
    createState, reduce, normalizeTeams, freshClock,
    PHASES, GUESSES, LIGHTNING_MARKS, MAX_HISTORY, TEAM_IDS,
    // selectors
    value, turn, scores, clueCount, currentWord, lightningWord, lightningTotal,
    formatMoney, secondsLeft, teamIndexOf, nameOf, standings, rolesFor, giverPids,
    nextIndex, lightningOutcome, bankGame,
    // phones
    validatePhoneMsg, phoneView, clockView, phoneCanClue, phoneCanMark,
  };
});
