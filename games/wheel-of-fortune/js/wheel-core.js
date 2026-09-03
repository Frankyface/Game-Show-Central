/* ============================================================
   Wheel of Fortune — pure game core (spec 04 §4)
   The immutable state + reducer + selectors that the host UI,
   the editor and the phones all read. No DOM, no transport, no
   timers, no app globals — the only side effect is attaching the
   export. Runs in the browser (globalThis.WheelCore, load AFTER
   js/wheel-content.js) and in Node (module.exports) so the
   node:test suite exercises it directly. Reducers are pure and
   immutable: they never mutate their inputs.

   Everything from wheel-content.js (validators, layoutPuzzle,
   sanitisers, constants) is re-exported here, so WheelCore is
   the single API surface described in spec §4; the split exists
   only to keep both files under the 800-line house limit.
   ============================================================ */

"use strict";

(function (root, factory) {
  const content = (typeof module === "object" && module.exports)
    ? require("./wheel-content.js")
    : root.WheelContent;
  const api = factory(content);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WheelCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const {
    VOWELS, ALPHABET, BONUS_FREE, BANKRUPT, LOSE_TURN, MAX_PLAYERS,
    isLetter, isPositiveInt, isVowel, letterCount, onlyVowelsLeft, allRevealed,
    layoutPuzzle, sanitizeName, sanitizeSolve, formatMoney, normalizeGame,
  } = C;

  const HISTORY_MAX = 60;

  /* ============ State ============ */

  /**
   * @typedef {{pid:string,name:string,round:number,total:number}} WheelPlayer
   * @typedef {{type:string,category:string,puzzle:string,wedges:Array,value:number|null}} WheelRound
   */

  /**
   * Build the initial, serialisable game state. Never holds DOM, timer or
   * connection handles — everything here survives a JSON round-trip.
   */
  function createState(game, players, options) {
    const normalized = normalizeGame(game);
    const opts = options && typeof options === "object" ? options : {};
    const list = Array.isArray(players) ? players.slice(0, MAX_PLAYERS) : [];
    return {
      phase: "idle",
      game: normalized,
      roundIndex: 0,
      round: null,
      players: list.map((p, i) => ({
        pid: p && typeof p.pid === "string" && p.pid ? p.pid : `p${i + 1}`,
        name: sanitizeName(p && p.name) || `Player ${i + 1}`,
        round: 0,
        total: 0,
      })),
      turn: 0,
      used: [],
      revealed: [],
      wedge: null,
      pendingSpin: false,
      pendingVowel: false,
      solving: false,
      solveText: "",
      roundDone: false,
      nextStarter: null,
      tossup: null,
      bonus: null,
      banner: "Add players, then press Start game.",
      history: [],
      sound: opts.sound !== false,
      over: false,
    };
  }

  const nextTurn = (s) => (s.players.length ? (s.turn + 1) % s.players.length : 0);
  const turnName = (s, index) => (s.players[index] ? s.players[index].name : "Nobody");
  const playerIndex = (s, pid) => s.players.findIndex((p) => p.pid === pid);

  /** Nth toss-up value: the list index is the toss-up ordinal; the last repeats. */
  function tossUpValueFor(game, roundIndex) {
    const round = game.rounds[roundIndex];
    if (round && isPositiveInt(round.value)) return round.value;
    let ordinal = 0;
    for (let i = 0; i <= roundIndex; i += 1) {
      if (game.rounds[i].type === "tossup") ordinal += 1;
    }
    const values = game.settings.tossUpValues;
    return values[Math.min(Math.max(ordinal - 1, 0), values.length - 1)];
  }

  /** Punctuation and spaces are on the board from the start (spec §3). */
  function freshRevealed(puzzle) {
    const flags = new Array(puzzle.length);
    for (let i = 0; i < puzzle.length; i += 1) flags[i] = !isLetter(puzzle[i]);
    return flags;
  }

  const revealEvery = (puzzle) => new Array(puzzle.length).fill(true);

  function revealLetter(puzzle, revealed, letter) {
    const out = revealed.slice();
    for (let i = 0; i < puzzle.length; i += 1) if (puzzle[i] === letter) out[i] = true;
    return out;
  }

  /** Highest grand total; ties go to the first player in turn order (spec §8). */
  function leaderPid(players) {
    if (!players.length) return null;
    let best = players[0];
    for (const p of players) if (p.total > best.total) best = p;
    return best.pid;
  }

  /**
   * Move into round `index` (or the final standings when we run past the end).
   * Rebuilds every per-round slice so no stale spin/vowel/toss-up state leaks.
   * Over 50 lines because the three round types share one long reset and differ
   * only in their tail; splitting them would duplicate that reset three times.
   */
  function enterRound(state, index) {
    const game = state.game;
    if (index >= game.rounds.length) return finishGame(state);
    const round = game.rounds[index];
    const wedges = round.wedges && round.wedges.length ? round.wedges : game.settings.wedges;
    const starter = state.nextStarter ? playerIndex(state, state.nextStarter) : -1;
    const base = {
      ...state,
      roundIndex: index,
      round: {
        type: round.type,
        category: round.category,
        puzzle: round.puzzle,
        wedges: wedges.slice(),
        value: round.type === "tossup" ? tossUpValueFor(game, index) : null,
      },
      players: state.players.map((p) => ({ ...p, round: 0 })),
      turn: starter >= 0 ? starter : 0,
      used: [],
      revealed: freshRevealed(round.puzzle),
      wedge: null,
      pendingSpin: false,
      pendingVowel: false,
      solving: false,
      solveText: "",
      roundDone: false,
      nextStarter: null,
      tossup: null,
      bonus: null,
      over: false,
    };
    if (round.type === "tossup") {
      return {
        ...base,
        phase: "tossup",
        tossup: { revealOrder: [], next: 0, locked: [], buzzed: null, running: false, done: false },
        banner: `Toss-up for ${formatMoney(base.round.value)} — press Start reveal.`,
      };
    }
    if (round.type === "bonus") return enterBonus(base);
    return {
      ...base,
      phase: "round",
      banner: `${turnName(base, base.turn)}: spin, buy a vowel, or solve.`,
    };
  }

  function enterBonus(base) {
    const pid = leaderPid(base.players);
    const index = Math.max(playerIndex(base, pid), 0);
    let revealed = base.revealed;
    for (const letter of BONUS_FREE) revealed = revealLetter(base.round.puzzle, revealed, letter);
    return {
      ...base,
      phase: "bonus",
      turn: index,
      used: BONUS_FREE.slice(),
      revealed,
      bonus: { leaderPid: pid, picks: [], picked: false, timerRunning: false, result: null },
      banner: `Bonus round — ${turnName(base, index)} picks 3 consonants and a vowel.`,
    };
  }

  function finishGame(state) {
    return {
      ...state,
      phase: "final",
      round: null,
      over: true,
      pendingSpin: false,
      pendingVowel: false,
      solving: false,
      banner: "Final standings.",
    };
  }

  /* ============ Legal actions (shared by host buttons and phones) ============ */

  /**
   * What the player on turn may do right now. The host buttons and the phone
   * keyboard both render straight from this, so they can never disagree.
   * @returns {{spin:boolean, buyVowel:boolean, solve:boolean, letters:string[]}}
   */
  function legalActions(state) {
    const none = { spin: false, buyVowel: false, solve: false, letters: [] };
    if (!state || state.phase !== "round" || !state.round || state.roundDone) return none;
    if (!state.players.length) return none;
    const used = new Set(state.used);
    if (state.pendingSpin) {
      return { ...none, letters: ALPHABET.split("").filter((L) => !isVowel(L) && !used.has(L)) };
    }
    if (state.pendingVowel) {
      return { ...none, letters: VOWELS.split("").filter((L) => !used.has(L)) };
    }
    if (state.solving) return none;
    const puzzle = state.round.puzzle;
    const done = allRevealed(puzzle, state.revealed);
    const vowelsOnly = onlyVowelsLeft(puzzle, state.revealed);
    const player = state.players[state.turn];
    const vowelsLeft = VOWELS.split("").some((L) => !used.has(L));
    return {
      spin: !done && !vowelsOnly,
      buyVowel: !done && vowelsLeft && !!player && player.round >= state.game.settings.vowelCost,
      solve: true,
      letters: [],
    };
  }

  /* ============ Reducer ============ */

  const RECORDED = new Set([
    "start", "spin", "callLetter", "buyVowel", "solveAttempt", "solveJudged",
    "nextPlayer", "tossupStart", "tossupRevealNext", "tossupBuzz", "tossupJudged",
    "bonusPick", "bonusJudged", "nextRound", "revealAll", "setTotal", "finish",
  ]);

  function snapshot(state) {
    const copy = { ...state };
    delete copy.history;
    return copy;
  }

  function undo(state) {
    if (!Array.isArray(state.history) || state.history.length === 0) return state;
    const prev = state.history[state.history.length - 1];
    return { ...prev, history: state.history.slice(0, -1) };
  }

  /**
   * Apply one event. Illegal events return the SAME object (===) so callers can
   * cheaply tell "nothing happened". `rng` is injected: the spin result and the
   * toss-up reveal order are the only random decisions and both are made here,
   * BEFORE any animation runs (spec §3) — the wheel only visualises them.
   */
  function reduce(state, event, rng) {
    if (!state || typeof state !== "object") return state;
    if (!event || typeof event !== "object" || typeof event.type !== "string") return state;
    if (event.type === "undo") return undo(state);
    const rand = typeof rng === "function" ? rng : Math.random;
    const next = apply(state, event, rand);
    if (next === state) return state;
    if (!RECORDED.has(event.type)) return next;
    return { ...next, history: [...state.history, snapshot(state)].slice(-HISTORY_MAX) };
  }

  function apply(state, event, rng) {
    switch (event.type) {
      case "start": return doStart(state);
      case "spin": return doSpin(state, rng);
      case "callLetter": return doCallLetter(state, event.letter);
      case "buyVowel": return doBuyVowel(state);
      case "solveAttempt": return doSolveAttempt(state, event.text);
      case "solveJudged": return doSolveJudged(state, event.correct === true);
      case "nextPlayer": return doNextPlayer(state);
      case "tossupStart": return doTossupStart(state, rng);
      case "tossupRevealNext": return doTossupRevealNext(state);
      case "tossupBuzz": return doTossupBuzz(state, event.pid);
      case "tossupJudged": return doTossupJudged(state, event.correct === true);
      case "bonusPick": return doBonusPick(state, event.letters);
      case "bonusJudged": return doBonusJudged(state, event.correct === true);
      case "nextRound": return doNextRound(state);
      case "revealAll": return doRevealAll(state);
      case "setTotal": return doSetTotal(state, event.pid, event.total);
      case "finish": return state.phase === "final" ? state : finishGame(state);
      default: return state;
    }
  }

  function doStart(state) {
    if (state.phase !== "idle" || state.players.length === 0) return state;
    return enterRound(state, 0);
  }

  function doSpin(state, rng) {
    if (!legalActions(state).spin) return state;
    const wedges = state.round.wedges;
    const raw = rng();
    const draw = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    const index = Math.min(Math.max(Math.floor(draw * wedges.length), 0), wedges.length - 1);
    const value = wedges[index];
    const wedge = { index, value };
    const name = turnName(state, state.turn);
    const upNext = turnName(state, nextTurn(state));
    if (value === BANKRUPT) {
      return {
        ...state, wedge, pendingSpin: false,
        players: state.players.map((p, i) => (i === state.turn ? { ...p, round: 0 } : p)),
        turn: nextTurn(state),
        banner: `BANKRUPT! ${name} loses this round's total. ${upNext} is up.`,
      };
    }
    if (value === LOSE_TURN) {
      return {
        ...state, wedge, pendingSpin: false, turn: nextTurn(state),
        banner: `LOSE A TURN — ${upNext} is up.`,
      };
    }
    return {
      ...state, wedge, pendingSpin: true,
      banner: `${formatMoney(value)} — ${name}, call a consonant.`,
    };
  }

  function doCallLetter(state, letter) {
    const L = typeof letter === "string" ? letter.trim().toUpperCase() : "";
    if (L.length !== 1 || !legalActions(state).letters.includes(L)) return state;
    const puzzle = state.round.puzzle;
    const count = letterCount(puzzle, L);
    const buying = state.pendingVowel;
    const cleared = {
      ...state, used: [...state.used, L],
      pendingSpin: false, pendingVowel: false, wedge: buying ? state.wedge : null,
    };
    if (count === 0) {
      const upNext = turnName(state, nextTurn(state));
      return { ...cleared, turn: nextTurn(state), banner: `No ${L}. ${upNext} is up.` };
    }
    const revealed = revealLetter(puzzle, state.revealed, L);
    const gain = buying ? 0 : count * state.wedge.value;
    const players = gain
      ? state.players.map((p, i) => (i === state.turn ? { ...p, round: p.round + gain } : p))
      : state.players;
    const name = turnName(state, state.turn);
    const tail = allRevealed(puzzle, revealed) ? ` The board is full — ${name} must solve it.` : "";
    const money = gain ? ` — ${formatMoney(gain)} for ${name}` : "";
    return {
      ...cleared, revealed, players,
      banner: `${count} ${L}${count > 1 ? "'s" : ""}${money}.${tail}`,
    };
  }

  function doBuyVowel(state) {
    if (!legalActions(state).buyVowel) return state;
    const cost = state.game.settings.vowelCost;
    const name = turnName(state, state.turn);
    return {
      ...state,
      players: state.players.map((p, i) => (i === state.turn ? { ...p, round: p.round - cost } : p)),
      pendingVowel: true,
      wedge: null,
      banner: `${name} buys a vowel (${formatMoney(-cost)}). Pick A, E, I, O or U.`,
    };
  }

  function doSolveAttempt(state, text) {
    if (!legalActions(state).solve) return state;
    const name = turnName(state, state.turn);
    const said = sanitizeSolve(text);
    return {
      ...state, solving: true, solveText: said,
      banner: said ? `${name} says: "${said}" — host, judge it.` : `${name} is solving — host, judge it.`,
    };
  }

  function doSolveJudged(state, correct) {
    if (state.phase !== "round" || !state.solving) return state;
    const name = turnName(state, state.turn);
    if (!correct) {
      return {
        ...state, solving: false, solveText: "", turn: nextTurn(state), wedge: null,
        banner: `Not it. ${turnName(state, nextTurn(state))} is up.`,
      };
    }
    const player = state.players[state.turn];
    const bank = Math.max(player.round, state.game.settings.roundMinimum);
    return {
      ...state,
      solving: false, solveText: "", wedge: null, roundDone: true,
      revealed: revealEvery(state.round.puzzle),
      nextStarter: player.pid,
      players: state.players.map((p, i) =>
        (i === state.turn ? { ...p, round: 0, total: p.total + bank } : { ...p, round: 0 })),
      banner: `${name} solves it and banks ${formatMoney(bank)}!`,
    };
  }

  function doNextPlayer(state) {
    if (state.phase !== "round" || state.roundDone || state.players.length < 2) return state;
    return {
      ...state, turn: nextTurn(state), pendingSpin: false, pendingVowel: false,
      solving: false, solveText: "", wedge: null,
      banner: `${turnName(state, nextTurn(state))}: spin, buy a vowel, or solve.`,
    };
  }

  /* ============ Toss-up ============ */

  function doTossupStart(state, rng) {
    if (state.phase !== "tossup" || !state.tossup || state.tossup.done) return state;
    if (state.tossup.running || state.tossup.buzzed) return state;
    if (state.tossup.next > 0) {
      return { ...state, tossup: { ...state.tossup, running: true }, banner: "Reveals resume — buzz in!" };
    }
    const positions = [];
    for (let i = 0; i < state.round.puzzle.length; i += 1) {
      if (isLetter(state.round.puzzle[i]) && !state.revealed[i]) positions.push(i);
    }
    // Fisher-Yates with the injected rng so the order is reproducible in tests.
    for (let i = positions.length - 1; i > 0; i -= 1) {
      const draw = rng();
      const j = Math.min(Math.floor((Number.isFinite(draw) ? draw : 0) * (i + 1)), i);
      const tmp = positions[i];
      positions[i] = positions[j];
      positions[j] = tmp;
    }
    return {
      ...state,
      tossup: { ...state.tossup, revealOrder: positions, next: 0, running: true, buzzed: null },
      banner: "Toss-up — buzz in as soon as you know it!",
    };
  }

  function doTossupRevealNext(state) {
    const t = state.tossup;
    if (state.phase !== "tossup" || !t || !t.running) return state;
    if (t.next >= t.revealOrder.length) return state;
    const revealed = state.revealed.slice();
    revealed[t.revealOrder[t.next]] = true;
    const next = t.next + 1;
    const exhausted = next >= t.revealOrder.length;
    return {
      ...state, revealed,
      tossup: { ...t, next, running: !exhausted, done: exhausted },
      roundDone: exhausted ? true : state.roundDone,
      banner: exhausted ? "Nobody solved the toss-up — no points." : state.banner,
    };
  }

  function doTossupBuzz(state, pid) {
    const t = state.tossup;
    if (state.phase !== "tossup" || !t || !t.running || t.buzzed) return state;
    const index = playerIndex(state, pid);
    if (index < 0 || t.locked.includes(pid)) return state;
    return {
      ...state, turn: index,
      tossup: { ...t, buzzed: pid, running: false },
      banner: `${state.players[index].name} buzzed in — what is it?`,
    };
  }

  function doTossupJudged(state, correct) {
    const t = state.tossup;
    if (state.phase !== "tossup" || !t || !t.buzzed) return state;
    const pid = t.buzzed;
    const index = playerIndex(state, pid);
    const name = index >= 0 ? state.players[index].name : "Player";
    if (correct) {
      const value = state.round.value;
      return {
        ...state,
        revealed: revealEvery(state.round.puzzle),
        players: state.players.map((p) => (p.pid === pid ? { ...p, total: p.total + value } : p)),
        tossup: { ...t, buzzed: null, running: false, done: true },
        roundDone: true, nextStarter: pid,
        banner: `${name} takes the toss-up — ${formatMoney(value)}!`,
      };
    }
    const locked = [...t.locked, pid];
    const stop = locked.length >= state.players.length || t.next >= t.revealOrder.length;
    return {
      ...state,
      tossup: { ...t, locked, buzzed: null, running: !stop, done: stop },
      roundDone: stop ? true : state.roundDone,
      banner: stop ? "Toss-up over — no points." : `Not it — ${name} is locked out. Reveals resume.`,
    };
  }

  /* ============ Bonus ============ */

  /** 3 distinct unused consonants + 1 unused vowel, or null (spec §1). */
  function validateBonusPicks(letters, used) {
    if (!Array.isArray(letters) || letters.length !== 4) return null;
    const clean = letters.map((L) => (typeof L === "string" ? L.trim().toUpperCase() : ""));
    if (clean.some((L) => L.length !== 1 || !ALPHABET.includes(L))) return null;
    if (new Set(clean).size !== 4) return null;
    const taken = new Set(Array.isArray(used) ? used : []);
    if (clean.some((L) => taken.has(L))) return null;
    if (clean.slice(0, 3).some(isVowel)) return null;
    if (!isVowel(clean[3])) return null;
    return clean;
  }

  function doBonusPick(state, letters) {
    if (state.phase !== "bonus" || !state.bonus || state.bonus.picked) return state;
    const picks = validateBonusPicks(letters, state.used);
    if (!picks) return state;
    let revealed = state.revealed;
    for (const L of picks) revealed = revealLetter(state.round.puzzle, revealed, L);
    return {
      ...state, revealed,
      used: [...state.used, ...picks],
      bonus: {
        ...state.bonus, picks, picked: true,
        timerRunning: state.game.settings.bonusSeconds > 0,
      },
      banner: `${picks.join(" ")} — solve it out loud!`,
    };
  }

  function doBonusJudged(state, correct) {
    const b = state.bonus;
    if (state.phase !== "bonus" || !b || !b.picked || b.result) return state;
    const name = turnName(state, state.turn);
    return {
      ...state,
      revealed: revealEvery(state.round.puzzle),
      roundDone: true,
      bonus: { ...b, timerRunning: false, result: correct ? "win" : "lose" },
      banner: correct
        ? `${name} wins ${state.game.settings.bonusPrize}!`
        : `Out of time — the answer was "${state.round.puzzle}".`,
    };
  }

  /* ============ Round flow and host escape hatches ============ */

  function doNextRound(state) {
    if (state.phase === "final" || !state.round) return state;
    return enterRound(state, state.roundIndex + 1);
  }

  function doRevealAll(state) {
    if (!state.round || state.roundDone) return state;
    return {
      ...state,
      revealed: revealEvery(state.round.puzzle),
      pendingSpin: false, pendingVowel: false, solving: false, solveText: "", wedge: null,
      roundDone: true,
      tossup: state.tossup ? { ...state.tossup, running: false, done: true, buzzed: null } : null,
      banner: `The answer was "${state.round.puzzle}".`,
    };
  }

  function doSetTotal(state, pid, total) {
    const index = playerIndex(state, pid);
    if (index < 0) return state;
    if (typeof total !== "number" || !Number.isFinite(total)) return state;
    const players = state.players.map((p, i) =>
      (i === index ? { ...p, total: Math.round(total) } : p));
    const next = { ...state, players };
    // A corrected total can change who plays the bonus round — re-pick the
    // leader until the contestant has locked their letters in (spec §8 W-U8).
    if (state.phase === "bonus" && state.bonus && !state.bonus.picked) {
      return enterBonus({ ...next, revealed: freshRevealed(state.round.puzzle), used: [] });
    }
    return next;
  }

  /* ============ Selectors ============ */

  /** Board rows with hidden letters masked out — safe to send to a phone. */
  function boardView(state) {
    if (!state || !state.round) return { category: "", rows: [], solved: false };
    const rows = layoutPuzzle(state.round.puzzle) || [];
    const flags = state.revealed;
    return {
      category: state.round.category,
      solved: allRevealed(state.round.puzzle, flags),
      rows: rows.map((row) => row.map((cell) => {
        if (!cell) return null;
        const shown = !!flags[cell.i];
        return { revealed: shown, ch: shown ? cell.ch : "", letter: isLetter(cell.ch) };
      })),
    };
  }

  function podiumView(state) {
    if (!state) return [];
    const lead = leaderPid(state.players);
    return state.players.map((p, i) => ({
      pid: p.pid, name: p.name, round: p.round, total: p.total,
      active: i === state.turn && !state.roundDone && state.phase !== "final",
      leader: p.pid === lead && p.total > 0,
      locked: !!(state.tossup && state.tossup.locked.includes(p.pid)),
      buzzed: !!(state.tossup && state.tossup.buzzed === p.pid),
    }));
  }

  function standingsView(state) {
    if (!state) return [];
    return state.players
      .map((p) => ({ pid: p.pid, name: p.name, total: p.total }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * What phone `pid` should render. The `turn` / `solve` / `bonus` screens are
   * only ever emitted for the player they belong to (spec §5, W-U10).
   */
  function phoneView(state, pid) {
    const base = {
      screen: "wait", name: "", round: 0, total: 0, vowelCost: 0,
      category: state && state.round ? state.round.category : "",
      banner: state ? state.banner : "",
      board: boardView(state),
      actions: { spin: false, buyVowel: false, solve: false, letters: [] },
      wedge: null, standings: standingsView(state),
    };
    if (!state) return base;
    const index = playerIndex(state, pid);
    const me = index >= 0 ? state.players[index] : null;
    const view = {
      ...base,
      name: me ? me.name : "",
      round: me ? me.round : 0,
      total: me ? me.total : 0,
      vowelCost: state.game ? state.game.settings.vowelCost : 0,
      turnName: state.players[state.turn] ? state.players[state.turn].name : "",
    };
    if (state.phase === "final") return { ...view, screen: "result" };
    if (state.phase === "tossup") return tossupPhoneView(state, view, pid);
    if (state.phase === "bonus") return bonusPhoneView(state, view, pid);
    if (state.phase !== "round" || !me || index !== state.turn || state.roundDone) return view;
    if (state.solving) return { ...view, screen: "solve", submitted: true };
    return {
      ...view, screen: "turn",
      actions: legalActions(state),
      wedge: state.pendingSpin && state.wedge ? state.wedge : null,
    };
  }

  function tossupPhoneView(state, view, pid) {
    const t = state.tossup;
    return {
      ...view, screen: "tossup",
      armed: !!(t && t.running && !t.buzzed && !t.locked.includes(pid)),
      locked: !!(t && t.locked.includes(pid)),
      mine: !!(t && t.buzzed === pid),
    };
  }

  function bonusPhoneView(state, view, pid) {
    const b = state.bonus;
    if (!b || b.leaderPid !== pid) return { ...view, screen: "wait" };
    const used = new Set(state.used);
    return {
      ...view, screen: "bonus",
      picked: b.picked, picks: b.picks.slice(), result: b.result,
      seconds: state.game.settings.bonusSeconds,
      consonants: ALPHABET.split("").filter((L) => !isVowel(L) && !used.has(L)),
      vowels: VOWELS.split("").filter((L) => !used.has(L)),
    };
  }

  /** Validate/sanitise a phone->host payload. Returns a clean copy or null. */
  function validatePhoneMsg(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
    switch (msg.t) {
      case "spin":
      case "buy-vowel":
      case "buzz":
        return { t: msg.t };
      case "letter": {
        const L = typeof msg.letter === "string" ? msg.letter.trim().toUpperCase() : "";
        if (L.length !== 1 || !ALPHABET.includes(L)) return null;
        return { t: "letter", letter: L };
      }
      case "solve": {
        const text = sanitizeSolve(msg.text);
        if (!text) return null;
        return { t: "solve", text };
      }
      case "bonus-pick": {
        if (!Array.isArray(msg.letters) || msg.letters.length !== 4) return null;
        const out = msg.letters.map((L) => (typeof L === "string" ? L.trim().toUpperCase() : ""));
        if (out.some((L) => L.length !== 1 || !ALPHABET.includes(L))) return null;
        return { t: "bonus-pick", letters: out };
      }
      default:
        return null;
    }
  }

  return {
    ...C, // validators, layoutPuzzle, sanitisers and constants (spec §4 API)
    createState, reduce, legalActions, leaderPid, tossUpValueFor,
    validateBonusPicks, boardView, podiumView, phoneView, standingsView,
    validatePhoneMsg,
  };
});
