/* ============================================================
   Family Feud — pure game core (spec 03 §4)
   The immutable game reducer, selectors and phone-payload
   validation. Content validation/normalisation lives next door in
   `feud-content.js` and is re-exported here, so `FeudCore` is the
   single API game code and tests call. No DOM, no transport, no
   timers — the only side effect is attaching the export. Runs in
   the browser (globalThis.FeudCore) and in Node (module.exports).
   Reducers never mutate their inputs; an event that is illegal for
   the current phase returns the SAME state object (never throws).
   ============================================================ */

"use strict";

(function (root, factory) {
  const content = typeof module === "object" && module.exports
    ? require("./feud-content.js")
    : root.FeudContent;
  const api = factory(content);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FeudCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const FM_QUESTIONS = Content.FM_QUESTIONS;
  const FM_TEXT_MAX = 60; // display cap for a typed Fast Money answer
  const FM_TEXT_FIELD_MAX = 600; // structural cap (~10×) at the validation boundary
  const HISTORY_MAX = 30; // spec §3 asks for ≥ 20 undo steps
  const TEAM_LABELS = ["A", "B"];
  const DEFAULT_TEAM_NAMES = ["Team Blue", "Team Red"];

  const sanitizeText = Content.sanitizeText;
  const other = (team) => (team === 0 ? 1 : 0);

  /** Replace one array slot without mutating the array. */
  function setAt(list, index, value) {
    const out = list.slice();
    out[index] = value;
    return out;
  }

  /** Normalise a team reference ("A"/"B"/0/1) to 0, 1 or null. */
  function normTeam(value) {
    if (value === 0 || value === 1) return value;
    if (value === "A" || value === "a") return 0;
    if (value === "B" || value === "b") return 1;
    return null;
  }

  /* ============ State ============ */

  const freshTeam = (name) => ({ name, score: 0, players: [] });
  const freshFaceoff = () => ({ armed: false, buzzed: null, attempts: [], podium: [null, null] });
  const freshTimer = () => ({ running: false, startedAt: null, seconds: 0, slot: null });

  function freshFmRows() {
    const rows = [];
    for (let i = 0; i < FM_QUESTIONS; i += 1) {
      rows.push({ text: "", answerIndex: null, points: 0, revealed: false, duplicate: false });
    }
    return rows;
  }

  function freshFastMoney() {
    return {
      started: false,
      stage: "idle", // idle | play | reveal | cover | done
      slot: 1,
      team: null,
      players: [null, null],
      rows: { 1: freshFmRows(), 2: freshFmRows() },
      timer: freshTimer(),
      winner: null,
    };
  }

  /** Board / bank / strike slice for the round at `index`. */
  function roundReset(game, index) {
    const answers = game.rounds[index] ? game.rounds[index].answers : [];
    return {
      roundIndex: index,
      revealed: answers.map(() => false),
      strikes: 0,
      bank: 0,
      awarded: null,
      control: null,
      faceoff: freshFaceoff(),
      steal: { active: false, team: null, result: null },
    };
  }

  /**
   * Build the initial (setup-phase) state for `game`.
   * @param {object} game raw or normalised content
   * @param {{teamNames?:string[], roundsToPlay?:number, fastMoney?:boolean}} [options]
   */
  function createState(game, options) {
    const g = Content.normalizeGame(game);
    const opts = options && typeof options === "object" ? options : {};
    const names = Array.isArray(opts.teamNames) ? opts.teamNames : [];
    let roundsToPlay = g.rounds.length;
    if (Number.isInteger(opts.roundsToPlay)) {
      roundsToPlay = Math.min(Math.max(opts.roundsToPlay, 1), g.rounds.length);
    }
    const fmPossible = g.settings.fastMoney.enabled && g.fastMoney.length >= FM_QUESTIONS;
    return {
      v: 1,
      phase: "setup",
      game: g,
      roundsToPlay,
      fastMoneyEnabled: typeof opts.fastMoney === "boolean" ? opts.fastMoney && fmPossible : fmPossible,
      teams: [
        freshTeam(sanitizeText(names[0], Content.TEAM_NAME_MAX) || DEFAULT_TEAM_NAMES[0]),
        freshTeam(sanitizeText(names[1], Content.TEAM_NAME_MAX) || DEFAULT_TEAM_NAMES[1]),
      ],
      ...roundReset(g, 0),
      fastMoney: freshFastMoney(),
      message: "",
      history: [],
    };
  }

  /* ============ Reducer plumbing ============ */

  /** Undo point: everything but the history stack and the immutable content. */
  function snapshot(state) {
    const copy = { ...state };
    delete copy.history;
    delete copy.game; // re-attached on undo; the content never changes mid-game
    return copy;
  }

  function pushHistory(state) {
    const next = state.history.concat([snapshot(state)]);
    return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
  }

  /**
   * Apply one event. Returns a NEW state, or the SAME object when the event is
   * illegal for the current phase / malformed. Never throws.
   */
  function reduce(state, event) {
    if (!state || typeof state !== "object") return state;
    if (!event || typeof event !== "object" || typeof event.type !== "string") return state;
    // Own-property lookup: a prototype-shaped type ("toString", "__proto__") must never reach a handler.
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type) ? HANDLERS[event.type] : null;
    if (typeof handler !== "function") return state;
    const next = handler(state, event);
    if (!next || next === state) return state;
    if (event.type === "undo") return next;
    return { ...next, history: pushHistory(state) };
  }

  /* ============ Selectors used by the handlers ============ */

  const currentRound = (s) => s.game.rounds[s.roundIndex] || { question: "", answers: [] };
  const answersOf = (s) => currentRound(s).answers;
  const strikeLimit = (s) => s.game.settings.strikes;

  function multiplierFor(state) {
    const list = state.game.settings.multipliers;
    if (!list.length) return 1;
    return list[Math.min(state.roundIndex, list.length - 1)];
  }

  const roundPoints = (state) => state.bank;
  const awardFor = (state) => state.bank * multiplierFor(state);

  function award(state, team, reason) {
    const points = state.bank * multiplierFor(state);
    return {
      ...state,
      teams: state.teams.map((t, i) => (i === team ? { ...t, score: t.score + points } : t)),
      awarded: { team, points, reason },
      phase: "roundover",
      steal: { ...state.steal, active: false },
      faceoff: { ...state.faceoff, armed: false, buzzed: null },
      message: `${state.teams[team].name} scores ${points}.`,
    };
  }

  /* ============ Face-off ============ */

  function takeControl(state, team, why) {
    return {
      ...state,
      control: team,
      phase: "playpass",
      faceoff: { ...state.faceoff, armed: false, buzzed: null },
      message: `${state.teams[team].name} ${why}. Play or pass?`,
    };
  }

  /** Decide what happens after a face-off attempt is recorded. */
  function resolveFaceoff(state) {
    const attempts = state.faceoff.attempts;
    if (attempts.length === 1) {
      const first = attempts[0];
      if (first.index === 0) return takeControl(state, first.team, "found the top answer");
      const next = other(first.team);
      return {
        ...state,
        faceoff: { ...state.faceoff, buzzed: next, armed: false },
        message: `${state.teams[next].name} — your turn at the podium.`,
      };
    }
    const rank = (a) => (a.index === null ? Number.POSITIVE_INFINITY : a.index);
    const a0 = attempts[0];
    const a1 = attempts[1];
    if (rank(a0) === Number.POSITIVE_INFINITY && rank(a1) === Number.POSITIVE_INFINITY) {
      return {
        ...state,
        faceoff: { ...state.faceoff, buzzed: null, armed: false },
        message: "Neither answer was on the board — face off again.",
      };
    }
    return takeControl(state, rank(a0) <= rank(a1) ? a0.team : a1.team, "wins the face-off");
  }

  function faceoffAttempt(state, team, index) {
    const attempts = state.faceoff.attempts.concat([{ team, index }]);
    return resolveFaceoff({
      ...state,
      faceoff: { ...state.faceoff, attempts, buzzed: null, armed: false },
    });
  }

  /* ============ Event handlers ============ */

  const HANDLERS = {
    start(s) {
      if (s.phase !== "setup") return s;
      return { ...s, ...roundReset(s.game, 0), phase: "faceoff", message: "Face-off!" };
    },

    setTeamName(s, e) {
      if (s.phase !== "setup") return s;
      const team = normTeam(e.team);
      const name = sanitizeText(e.name, Content.TEAM_NAME_MAX);
      if (team === null || !name || s.teams[team].name === name) return s;
      return { ...s, teams: s.teams.map((t, i) => (i === team ? { ...t, name } : t)) };
    },

    setRoundsToPlay(s, e) {
      if (s.phase !== "setup" || !Number.isInteger(e.count)) return s;
      const n = Math.min(Math.max(e.count, 1), s.game.rounds.length);
      if (n === s.roundsToPlay) return s;
      return { ...s, roundsToPlay: n };
    },

    setFastMoney(s, e) {
      if (s.phase !== "setup" || typeof e.on !== "boolean") return s;
      const possible = s.game.settings.fastMoney.enabled && s.game.fastMoney.length >= FM_QUESTIONS;
      const on = e.on && possible;
      if (on === s.fastMoneyEnabled) return s;
      return { ...s, fastMoneyEnabled: on };
    },

    setTeam(s, e) {
      if (s.phase !== "setup") return s;
      if (typeof e.pid !== "string" || !e.pid) return s;
      const team = normTeam(e.team); // null = unassigned
      if (teamOfPid(s, e.pid) === team) return s;
      const teams = s.teams.map((t, i) => {
        const without = t.players.filter((p) => p !== e.pid);
        return i === team ? { ...t, players: without.concat([e.pid]) } : { ...t, players: without };
      });
      return { ...s, teams };
    },

    setPodium(s, e) {
      if (s.phase !== "faceoff") return s;
      const team = normTeam(e.team);
      if (team === null) return s;
      const pid = typeof e.pid === "string" && e.pid ? e.pid : null;
      if (s.faceoff.podium[team] === pid) return s;
      return { ...s, faceoff: { ...s.faceoff, podium: setAt(s.faceoff.podium, team, pid) } };
    },

    arm(s, e) {
      if (s.phase !== "faceoff") return s;
      const on = e.on !== false;
      if (s.faceoff.armed === on) return s;
      return { ...s, faceoff: { ...s.faceoff, armed: on } };
    },

    buzz(s, e) {
      if (s.phase !== "faceoff") return s;
      if (s.faceoff.buzzed !== null || s.faceoff.attempts.length > 0) return s;
      let team = normTeam(e.team);
      if (team === null && typeof e.pid === "string") team = teamOfPid(s, e.pid);
      if (team === null) return s;
      if (!e.host && !s.faceoff.armed) return s; // phones only count once armed
      return {
        ...s,
        faceoff: { ...s.faceoff, buzzed: team, armed: false },
        message: `${s.teams[team].name} buzzed in!`,
      };
    },

    reveal(s, e) {
      const index = e.index;
      if (!Number.isInteger(index) || index < 0 || index >= answersOf(s).length) return s;
      if (s.revealed[index]) return s;
      const bank = s.bank + answersOf(s)[index].count;
      const revealed = setAt(s.revealed, index, true);
      if (s.phase === "faceoff") {
        if (s.faceoff.buzzed === null) return s;
        return faceoffAttempt({ ...s, revealed, bank }, s.faceoff.buzzed, index);
      }
      if (s.phase !== "play" || s.control === null) return s;
      const next = { ...s, revealed, bank };
      if (revealed.every(Boolean)) return award(next, s.control, "cleared");
      return next;
    },

    notOnBoard(s) {
      if (s.phase !== "faceoff" || s.faceoff.buzzed === null) return s;
      return faceoffAttempt(s, s.faceoff.buzzed, null);
    },

    giveControl(s, e) {
      if (s.phase !== "faceoff") return s;
      const team = normTeam(e.team);
      if (team === null) return s;
      return takeControl(s, team, "takes control");
    },

    faceoffAgain(s) {
      if (s.phase !== "faceoff") return s;
      return {
        ...s,
        faceoff: { ...freshFaceoff(), podium: s.faceoff.podium },
        message: "Face off again!",
      };
    },

    play(s) {
      if (s.phase !== "playpass" || s.control === null) return s;
      return { ...s, phase: "play", message: `${s.teams[s.control].name} is playing the board.` };
    },

    pass(s) {
      if (s.phase !== "playpass" || s.control === null) return s;
      const team = other(s.control);
      return { ...s, phase: "play", control: team, message: `Passed — ${s.teams[team].name} is playing.` };
    },

    strike(s) {
      if (s.phase !== "play" || s.control === null) return s;
      const strikes = s.strikes + 1;
      if (strikes < strikeLimit(s)) return { ...s, strikes };
      const stealTeam = other(s.control);
      return {
        ...s,
        strikes,
        phase: "steal",
        steal: { active: true, team: stealTeam, result: null },
        message: `Strike out — ${s.teams[stealTeam].name} can steal.`,
      };
    },

    steal(s, e) {
      if (s.phase !== "steal" || !s.steal.active || s.steal.team === null) return s;
      const stealTeam = s.steal.team;
      const index = e.index;
      if (index === null || index === undefined) {
        return award({ ...s, steal: { ...s.steal, result: "fail" } }, other(stealTeam), "nosteal");
      }
      if (!Number.isInteger(index) || index < 0 || index >= answersOf(s).length) return s;
      if (s.revealed[index]) return s;
      const next = {
        ...s,
        revealed: setAt(s.revealed, index, true),
        bank: s.bank + answersOf(s)[index].count,
        steal: { ...s.steal, result: "success" },
      };
      return award(next, stealTeam, "steal");
    },

    revealRest(s) {
      if (s.phase !== "roundover" || s.revealed.every(Boolean)) return s;
      return { ...s, revealed: s.revealed.map(() => true) };
    },

    nextRound(s) {
      if (s.phase !== "roundover") return s;
      const next = s.roundIndex + 1;
      if (next >= s.roundsToPlay || next >= s.game.rounds.length) return s;
      return { ...s, ...roundReset(s.game, next), phase: "faceoff", message: "Face-off!" };
    },

    beginFastMoney(s, e) {
      if (s.phase !== "roundover" || !s.fastMoneyEnabled) return s;
      const raw = Array.isArray(e.players) ? e.players : [];
      const players = [0, 1].map((i) => (typeof raw[i] === "string" && raw[i] ? raw[i] : null));
      let team = normTeam(e.team);
      if (team === null) team = s.teams[1].score > s.teams[0].score ? 1 : 0;
      return {
        ...s,
        phase: "fastmoney",
        fastMoney: { ...freshFastMoney(), started: true, stage: "play", slot: 1, team, players },
        message: "Fast Money!",
      };
    },

    fmAnswer(s, e) {
      if (s.phase !== "fastmoney") return s;
      const slot = e.slot === 1 || e.slot === 2 ? e.slot : null;
      if (slot === null || !Number.isInteger(e.q) || e.q < 0 || e.q >= FM_QUESTIONS) return s;
      const owner = s.fastMoney.players[slot - 1];
      if (typeof e.pid === "string" && owner && owner !== e.pid) return s;
      const rows = s.fastMoney.rows[slot];
      if (rows[e.q].revealed) return s;
      const text = sanitizeText(e.text, FM_TEXT_MAX);
      if (rows[e.q].text === text) return s;
      const nextRows = setAt(rows, e.q, { ...rows[e.q], text });
      return { ...s, fastMoney: { ...s.fastMoney, rows: { ...s.fastMoney.rows, [slot]: nextRows } } };
    },

    fmReveal(s, e) {
      if (s.phase !== "fastmoney") return s;
      const slot = e.slot === 1 || e.slot === 2 ? e.slot : null;
      if (slot === null || !Number.isInteger(e.q) || e.q < 0 || e.q >= FM_QUESTIONS) return s;
      // Only the player who is up may be revealed: duplicate detection reads
      // slot 1, so an out-of-order slot-2 reveal would silently skip it.
      if (slot !== s.fastMoney.slot) return s;
      const question = fmQuestions(s)[e.q];
      if (!question) return s;
      let answerIndex = null;
      if (e.answerIndex !== null && e.answerIndex !== undefined) {
        if (!Number.isInteger(e.answerIndex) || e.answerIndex < 0 ||
            e.answerIndex >= question.answers.length) return s;
        answerIndex = e.answerIndex;
      }
      const first = s.fastMoney.rows[1][e.q];
      const duplicate = slot === 2 && answerIndex !== null &&
        first.revealed && first.answerIndex === answerIndex;
      const points = answerIndex === null || duplicate ? 0 : question.answers[answerIndex].count;
      const rows = s.fastMoney.rows[slot];
      const row = { ...rows[e.q], answerIndex, points, revealed: true, duplicate };
      const nextRows = setAt(rows, e.q, row);
      return { ...s, fastMoney: { ...s.fastMoney, rows: { ...s.fastMoney.rows, [slot]: nextRows } } };
    },

    fmAdvance(s) {
      if (s.phase !== "fastmoney") return s;
      const fm = s.fastMoney;
      if (fm.stage === "play") {
        return { ...s, fastMoney: { ...fm, stage: "reveal", timer: freshTimer() } };
      }
      if (fm.stage === "cover") return { ...s, fastMoney: { ...fm, stage: "play" } };
      if (fm.stage !== "reveal") return s;
      if (fm.slot === 1) {
        return { ...s, fastMoney: { ...fm, stage: "cover", slot: 2 }, message: "Player 2 — cover your ears!" };
      }
      const total = fmTotal(s);
      const won = total >= s.game.settings.fastMoney.target;
      return {
        ...s,
        fastMoney: { ...fm, stage: "done", winner: won },
        message: won ? "Fast Money winner!" : "So close!",
      };
    },

    fmTimer(s, e) {
      if (s.phase !== "fastmoney") return s;
      if (e.action === "stop" || e.action === "reset") {
        if (!s.fastMoney.timer.running && s.fastMoney.timer.startedAt === null) return s;
        return { ...s, fastMoney: { ...s.fastMoney, timer: freshTimer() } };
      }
      if (e.action !== "start") return s;
      const fallback = s.fastMoney.slot === 1
        ? s.game.settings.fastMoney.timer1 : s.game.settings.fastMoney.timer2;
      const seconds = Number.isInteger(e.seconds) && e.seconds > 0 &&
        e.seconds <= Content.MAX_TIMER_SECONDS ? e.seconds : fallback;
      if (!seconds) return s;
      return {
        ...s,
        fastMoney: {
          ...s.fastMoney,
          timer: {
            running: true,
            startedAt: Number.isFinite(e.now) ? e.now : 0,
            seconds,
            slot: s.fastMoney.slot,
          },
        },
      };
    },

    finish(s) {
      if (s.phase !== "roundover" && s.phase !== "fastmoney") return s;
      return { ...s, phase: "final", message: "" };
    },

    setScore(s, e) {
      const team = normTeam(e.team);
      if (team === null || !Number.isInteger(e.score)) return s;
      if (s.teams[team].score === e.score) return s;
      return { ...s, teams: s.teams.map((t, i) => (i === team ? { ...t, score: e.score } : t)) };
    },

    undo(s) {
      if (!Array.isArray(s.history) || s.history.length === 0) return s;
      const previous = s.history[s.history.length - 1];
      return { ...previous, game: s.game, history: s.history.slice(0, -1) };
    },
  };

  /* ============ Public selectors ============ */

  /** Which team (0/1) a phone player is on, or null. */
  function teamOfPid(state, pid) {
    if (typeof pid !== "string") return null;
    for (let i = 0; i < state.teams.length; i += 1) {
      if (state.teams[i].players.indexOf(pid) !== -1) return i;
    }
    return null;
  }

  /** The five Fast Money questions actually in play. */
  const fmQuestions = (state) => state.game.fastMoney.slice(0, FM_QUESTIONS);

  function fmTotal(state) {
    let total = 0;
    [1, 2].forEach((slot) => {
      state.fastMoney.rows[slot].forEach((row) => { total += row.revealed ? row.points : 0; });
    });
    return total;
  }

  /** Board tiles for the current round (host + phone rendering). */
  function boardView(state) {
    return answersOf(state).map((answer, index) => ({
      index,
      number: index + 1,
      text: answer.text,
      count: answer.count,
      revealed: !!state.revealed[index],
    }));
  }

  /** The two players at the podium this round (host override, else rotation). */
  function podiumFor(state) {
    return [0, 1].map((team) => {
      const chosen = state.faceoff.podium[team];
      if (chosen && state.teams[team].players.indexOf(chosen) !== -1) return chosen;
      const roster = state.teams[team].players;
      return roster.length ? roster[state.roundIndex % roster.length] : null;
    });
  }

  const PHASE_TEXT = {
    setup: "Waiting for the host to start",
    faceoff: "Face-off",
    playpass: "Play or pass?",
    play: "Board in play",
    steal: "Steal!",
    roundover: "Round over",
    fastmoney: "Fast Money",
    final: "Final standings",
  };

  /**
   * Everything one phone should render (spec §5). Thin client: the phone shows
   * what arrives and nothing else. Never includes the OTHER Fast Money
   * player's typed answers.
   */
  function phoneView(state, pid) {
    const team = teamOfPid(state, pid);
    const base = {
      screen: "wait",
      team,
      teamLabel: team === null ? null : TEAM_LABELS[team],
      teamName: team === null ? null : state.teams[team].name,
      phase: state.phase,
      phaseText: PHASE_TEXT[state.phase] || "",
      message: state.message || "",
      scores: state.teams.map((t) => ({ name: t.name, score: t.score })),
      question: null,
      armed: false,
      buzzed: null,
      atPodium: false,
      fm: null,
    };
    if (state.phase === "setup") return { ...base, screen: "team-pick" };
    if (state.phase === "final" || state.phase === "roundover") return { ...base, screen: "result" };
    if (state.phase === "faceoff") return faceoffPhoneView(state, pid, base);
    if (state.phase === "fastmoney") return fastMoneyPhoneView(state, pid, base);
    return base;
  }

  function faceoffPhoneView(state, pid, base) {
    const buzzed = state.faceoff.buzzed;
    if (podiumFor(state).indexOf(pid) === -1) {
      return { ...base, phaseText: "Face-off at the podium", buzzed };
    }
    return {
      ...base,
      screen: "faceoff",
      atPodium: true,
      armed: state.faceoff.armed && buzzed === null && state.faceoff.attempts.length === 0,
      buzzed,
      question: currentRound(state).question,
    };
  }

  function fastMoneyPhoneView(state, pid, base) {
    const fm = state.fastMoney;
    const slot = fm.players.indexOf(pid) + 1; // 0 → not a Fast Money player
    if (slot !== 1 && slot !== 2) return { ...base, phaseText: "Fast Money" };
    if (slot === 2 && (fm.slot === 1 || fm.stage === "cover")) {
      return { ...base, screen: "fm-wait", phaseText: "Cover your ears!" };
    }
    if (fm.slot !== slot || fm.stage !== "play") return { ...base, phaseText: "Fast Money" };
    return {
      ...base,
      screen: "fm-answer",
      fm: {
        slot,
        questions: fmQuestions(state).map((q) => q.question),
        rows: fm.rows[slot].map((row) => ({ text: row.text })), // own answers only
        timer: { ...fm.timer },
      },
    };
  }

  /* ============ Phone payload validation (spec §5) ============ */

  /**
   * Validate a decoded phone→host payload. Returns a typed message with only
   * known fields, or null for junk (callers ignore it — never throw).
   */
  function validatePhoneMsg(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    if (typeof obj.t !== "string") return null;
    switch (obj.t) {
      case "team":
        if (obj.team !== "A" && obj.team !== "B") return null;
        return { t: "team", team: obj.team };
      case "buzz":
        return { t: "buzz" };
      case "fm-answer": {
        if (obj.slot !== 1 && obj.slot !== 2) return null;
        if (!Number.isInteger(obj.q) || obj.q < 0 || obj.q >= FM_QUESTIONS) return null;
        if (typeof obj.text !== "string" || obj.text.length > FM_TEXT_FIELD_MAX) return null;
        return { t: "fm-answer", slot: obj.slot, q: obj.q, text: sanitizeText(obj.text, FM_TEXT_MAX) };
      }
      default:
        return null; // unknown `t` → ignorable, forward-compatible
    }
  }

  return {
    // content API, re-exported so FeudCore is the one entry point
    MAX_ROUNDS: Content.MAX_ROUNDS,
    MIN_ANSWERS: Content.MIN_ANSWERS,
    MAX_ANSWERS: Content.MAX_ANSWERS,
    QUESTION_MAX: Content.QUESTION_MAX,
    ANSWER_TEXT_MAX: Content.ANSWER_TEXT_MAX,
    MAX_STRIKES: Content.MAX_STRIKES,
    MAX_TIMER_SECONDS: Content.MAX_TIMER_SECONDS,
    TEAM_NAME_MAX: Content.TEAM_NAME_MAX,
    DEFAULT_STRIKES: Content.DEFAULT_STRIKES,
    DEFAULT_MULTIPLIERS: Content.DEFAULT_MULTIPLIERS,
    DEFAULT_FM: Content.DEFAULT_FM,
    validateGame: Content.validateGame,
    normalizeGame: Content.normalizeGame,
    warningsFor: Content.warningsFor,
    sanitizeText,
    // state + reducer
    FM_QUESTIONS, FM_TEXT_MAX, HISTORY_MAX, TEAM_LABELS, DEFAULT_TEAM_NAMES,
    createState, reduce,
    // selectors
    boardView, roundPoints, awardFor, multiplierFor, currentRound, fmQuestions,
    fmTotal, teamOfPid, podiumFor, phoneView, other,
    // phones
    validatePhoneMsg,
  };
});
