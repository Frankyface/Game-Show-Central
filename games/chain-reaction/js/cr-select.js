/* ============================================================
   Chain Reaction — selectors (PURE, read-only)
   Everything that READS a state: where the frontier is, what a
   word is worth, how the column renders, what one phone is
   allowed to see. Nothing here writes, and nothing here depends
   on the reducer — cr-core.js requires this file and re-exports
   it, so every caller only ever touches CrCore. Split out to keep
   all three files well under the 800-line house limit.

   The masking rule that matters most (spec 14 §5): `columnRows`
   builds each row character by character from the reveal mask,
   so an unrevealed letter is never in a phone's payload at all —
   not hidden by CSS, simply absent.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const content = node ? require("./cr-content.js") : root.CrContent;
  const api = factory(content);
  if (node) module.exports = api;
  root.CrSelect = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Content) {
  "use strict";

  const { isPlainObject, cleanText, isLetterAt, shownCount, CHAIN_LENGTH, GUESS_MAX } = Content;

  const TOP = 0;
  const BOTTOM = CHAIN_LENGTH - 1;
  const HIDDEN_COUNT = CHAIN_LENGTH - 2;      // six words in play per chain
  const DIRECTIONS = Object.freeze(["top", "bottom"]);

  /* ============ The column ============ */

  function chainComplete(chain) {
    return !!chain && chain.solved.every(Boolean);
  }

  /** The two words in play: the first unsolved from the top and from the bottom. */
  function frontier(state) {
    const chain = state && state.chain;
    if (!chain || chainComplete(chain)) return { top: null, bottom: null };
    let top = null;
    let bottom = null;
    for (let i = 0; i < chain.solved.length; i += 1) {
      if (!chain.solved[i]) { top = i; break; }
    }
    for (let i = chain.solved.length - 1; i >= 0; i -= 1) {
      if (!chain.solved[i]) { bottom = i; break; }
    }
    return { top, bottom };
  }

  /** Spec 14 §1: only words adjacent to revealed ones can be built on. */
  function eligibleWords(state) {
    const ends = frontier(state);
    const out = [];
    if (ends.top !== null) out.push(ends.top);
    if (ends.bottom !== null && ends.bottom !== ends.top) out.push(ends.bottom);
    return out;
  }

  /**
   * The column as tiles, character by character. `cells[i].ch` is null unless
   * that character is showing — this is what keeps hidden letters out of every
   * payload that leaves the host.
   * @param {{words:string[], revealed:boolean[][], solved:boolean[]}} chain
   * @param {{reveal?:boolean}} [options] the host's peek only
   */
  function columnRows(chain, options) {
    if (!chain) return [];
    const showAll = !!(options && options.reveal);
    return chain.words.map((word, index) => {
      const mask = chain.revealed[index];
      const cells = [];
      for (let i = 0; i < word.length; i += 1) {
        const lit = mask[i] === true;
        cells.push({ ch: lit || showAll ? word[i] : null, lit, letter: isLetterAt(word, i) });
      }
      return {
        index,
        cells,
        len: word.length,
        solved: chain.solved[index] === true,
        owner: chain.owner ? chain.owner[index] : null,
        shown: shownCount(word, mask),
      };
    });
  }

  /** The same rows, plus what the board needs to colour them. */
  function maskedColumn(state) {
    const rows = columnRows(state.chain);
    const ends = frontier(state);
    return rows.map((row) => Object.assign({}, row, {
      eligible: row.index === ends.top || row.index === ends.bottom,
      target: row.index === state.target,
    }));
  }

  function speedColumn(state) {
    const sp = state.speed;
    if (!sp) return [];
    const current = speedCurrent(state);
    return columnRows(sp).map((row) => Object.assign({}, row, {
      mark: sp.marks[row.index],
      current: row.index === current,
    }));
  }

  /* ============ Money and turns ============ */

  function chainValue(state) {
    const values = state.game.settings.values;
    if (!values.length) return 0;
    return values[Math.min(state.chainIndex, values.length - 1)];
  }

  function chainsLeft(state) {
    return Math.max(0, state.game.settings.values.length - state.chainIndex - 1);
  }

  function leader(state) {
    if (state.scores[0] === state.scores[1]) return null;
    return state.scores[0] > state.scores[1] ? 0 : 1;
  }

  /** The Speed Chain word the team is being asked for right now. */
  function speedCurrent(state) {
    const sp = state && state.speed;
    if (!sp || sp.over || !sp.queue.length) return null;
    return sp.queue[0];
  }

  function teamOf(state, pid) {
    if (!state || !pid) return null;
    for (let i = 0; i < state.teams.length; i += 1) {
      if (state.teams[i].pids.indexOf(pid) >= 0) return i;
    }
    return null;
  }

  function formatMoney(state, amount) {
    const currency = state && state.game ? state.game.settings.currency : "$";
    return `${currency}${Number(amount || 0).toLocaleString("en-US")}`;
  }

  function secondsLeft(deadline, now) {
    if (!Number.isFinite(deadline)) return 0;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  function standings(state) {
    return state.teams.map((team, i) => ({
      name: team.name,
      score: state.scores[i],
      money: formatMoney(state, state.scores[i]),
      winner: state.outcome ? state.outcome.winner === i : leader(state) === i,
    }));
  }

  /* ============ Phones ============ */

  /**
   * Every phone payload is validated here before it can touch state.
   * @param {*} raw @returns {object|null} null for anything malformed
   */
  function validatePhoneMsg(raw) {
    if (!isPlainObject(raw) || typeof raw.t !== "string") return null;
    if (raw.t === "direction") {
      return DIRECTIONS.indexOf(raw.dir) >= 0 ? { t: "direction", dir: raw.dir } : null;
    }
    if (raw.t === "guess") {
      const text = cleanText(raw.text, GUESS_MAX);
      return text ? { t: "guess", text } : null;
    }
    if (raw.t === "speed") {
      return raw.result === "got" || raw.result === "pass" ? { t: "speed", result: raw.result } : null;
    }
    return null;
  }

  function phoneHeader(state, team) {
    return {
      teams: state.teams.map((t) => t.name),
      scores: state.scores.slice(),
      control: state.control,
      team,
      mine: team !== null && team === state.control,
      chainNo: state.chainIndex + 1,
      chainCount: state.game.settings.values.length,
      value: formatMoney(state, chainValue(state)),
      currency: state.game.settings.currency,
    };
  }

  const PHONE_SCREENS = {
    setup(state, team, head) {
      return Object.assign({ screen: "wait", sub: "The host is still setting up." }, head);
    },
    chain(state, team, head) {
      const column = maskedColumn(state);
      const ends = frontier(state);
      if (!head.mine) {
        return Object.assign({
          screen: "watch", column,
          sub: `${state.teams[state.control].name} have control.`,
        }, head);
      }
      return Object.assign({
        screen: "control", column,
        canPick: state.target === null,
        dirs: { top: ends.top !== null, bottom: ends.bottom !== null },
        direction: state.direction,
        guess: state.guessText,
        sub: state.target === null
          ? "Build from the top or from the bottom."
          : "Type your guess — the host decides.",
      }, head);
    },
    chainDone(state, team, head) {
      return Object.assign({
        screen: "wait", column: maskedColumn(state),
        sub: "Chain complete — wait for the host.",
      }, head);
    },
    sudden(state, team, head) {
      const sd = state.sudden;
      const rows = sd
        ? columnRows({ words: [sd.word], revealed: [sd.revealed], solved: [sd.winner !== null], owner: [sd.winner] })
        : [];
      return Object.assign({
        screen: head.mine ? "control" : "watch",
        column: rows,
        sudden: sd ? { before: sd.before, after: sd.after } : null,
        canPick: false,
        dirs: { top: false, bottom: false },
        guess: head.mine ? state.guessText : "",
        sub: "Sudden death — the first correct answer wins it.",
      }, head);
    },
    speed(state, team, head) {
      const sp = state.speed;
      const mine = team !== null && !!sp && team === sp.team;
      return Object.assign({
        screen: "speed",
        column: speedColumn(state),
        deadline: sp ? sp.deadline : null,
        seconds: sp ? sp.seconds : 0,
        over: !!(sp && sp.over),
        award: sp && sp.over ? formatMoney(state, sp.award) : "",
        mine,
        canPass: !!(mine && sp && sp.started && !sp.over),
        sub: mine ? "Call them out in order. Tap Pass to come back to one." : "Watch the host screen.",
      }, head);
    },
    result(state, team, head) {
      return Object.assign({ screen: "result", standings: standings(state), sub: "" }, head);
    },
  };

  /**
   * The ONE view this phone is allowed to see. Hidden letters are absent, not
   * hidden: `columnRows` only ever copies a character whose mask flag is true.
   * @param {object} state @param {string} pid
   */
  function phoneView(state, pid) {
    if (!state) return { screen: "wait", sub: "The host is still setting up." };
    const team = teamOf(state, pid);
    const head = phoneHeader(state, team);
    const build = Object.prototype.hasOwnProperty.call(PHONE_SCREENS, state.phase)
      ? PHONE_SCREENS[state.phase] : PHONE_SCREENS.setup;
    return build(state, team, head);
  }

  return {
    TOP, BOTTOM, HIDDEN_COUNT, DIRECTIONS,
    chainComplete, frontier, eligibleWords,
    columnRows, maskedColumn, speedColumn,
    chainValue, chainsLeft, leader, speedCurrent,
    teamOf, formatMoney, secondsLeft, standings,
    validatePhoneMsg, phoneView,
  };
});
