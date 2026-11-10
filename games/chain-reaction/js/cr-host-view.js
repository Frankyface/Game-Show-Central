/* ============================================================
   Chain Reaction — host-phone view (PURE) · docs/22 §5.1, §6

   hostView(state) is what the host's private second screen shows:
   the WHOLE chain, top to bottom, every word spelled out with which
   letters the room can already see, the two frontier words marked
   and the word being guessed called out; in the Speed Chain, all
   eight words with what has been banked or passed; in sudden death,
   the tiebreak word. Phases with nothing private (setup, the chain-
   complete interstitial, the result) say so instead.

   The host never plays a role in this game, so nothing here has to
   be withheld from the host — and nothing here is ever sent to a
   contestant: the room glue hands it to room.setHostView only.
   Contestant phoneView (cr-select.js) is untouched.

   No DOM, no timers; runs in Node and the browser. Never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./cr-core.js")
    : root.CrCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CrHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CR) {
  "use strict";

  const SECRET_PHASES = new Set(["chain", "sudden", "speed"]);
  const PHASE_LABEL = {
    setup: "Setup",
    chain: "Chain",
    chainDone: "Chain complete",
    sudden: "Sudden death",
    speed: "Speed Chain",
    result: "Result",
  };

  function phaseLabel(state) {
    const label = Object.prototype.hasOwnProperty.call(PHASE_LABEL, state.phase) ? PHASE_LABEL[state.phase] : "Game";
    if (state.phase === "chain" || state.phase === "chainDone") {
      return `${label} ${state.chainIndex + 1} of ${state.game.settings.values.length}`;
    }
    return label;
  }

  /** One word as the host sees it: every letter, and which ones the room sees. */
  function wordRow(word, mask) {
    const lit = [];
    let letters = 0;
    for (let i = 0; i < word.length; i += 1) {
      lit.push(mask[i] === true);
      if (CR.isLetterAt(word, i)) letters += 1;
    }
    return { word, lit, shown: CR.shownCount(word, mask), letters };
  }

  /** The chain round: all eight words, frontier marked, the word in play called out. */
  function chainView(state) {
    const chain = state.chain;
    const ends = CR.frontier(state);
    const words = chain.words.map((word, index) => Object.assign(wordRow(word, chain.revealed[index]), {
      index,
      status: index === CR.TOP || index === CR.BOTTOM ? "given"
        : chain.solved[index] ? (chain.owner[index] === null ? "spelled" : "solved") : "hidden",
      owner: chain.owner[index],
      frontier: index === ends.top && index === ends.bottom ? "both"
        : index === ends.top ? "top" : index === ends.bottom ? "bottom" : null,
      target: index === state.target,
    }));
    const current = state.target === null ? null : {
      word: chain.words[state.target],
      index: state.target,
      from: state.direction,
      shown: words[state.target].shown,
    };
    return {
      value: CR.formatMoney(state, CR.chainValue(state)),
      control: state.teams[state.control] ? state.teams[state.control].name : "",
      current,
      words,
    };
  }

  /** The Speed Chain: every word, what is banked, what was passed, what to call now. */
  function speedView(state) {
    const sp = state.speed;
    const now = CR.speedCurrent(state);
    return {
      team: state.teams[sp.team] ? state.teams[sp.team].name : "",
      over: !!sp.over,
      current: now === null ? null : { word: sp.words[now], index: now, shown: CR.shownCount(sp.words[now], sp.revealed[now]) },
      words: sp.words.map((word, index) => Object.assign(wordRow(word, sp.revealed[index]), {
        index,
        status: index === CR.TOP || index === CR.BOTTOM ? "given" : (sp.marks[index] || "open"),
        target: index === now,
      })),
    };
  }

  /** Sudden death: the word and its two neighbours. */
  function suddenView(state) {
    const sd = state.sudden;
    return {
      before: sd.before,
      after: sd.after,
      current: sd.winner === null ? Object.assign({ index: 0 }, wordRow(sd.word, sd.revealed)) : null,
    };
  }

  /**
   * The host phone's view of `state` (docs/22 §6, Chain Reaction row).
   * @param {object|null} state the core state, or null on the setup screen
   */
  function hostView(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") {
      return { phase: "setup", phaseLabel: "Setup", secret: false };
    }
    const base = { phase: state.phase, phaseLabel: phaseLabel(state), secret: false };
    if (state.phase === "chain" && state.chain) return Object.assign(base, { secret: true }, chainView(state));
    if (state.phase === "speed" && state.speed && !state.speed.over) {
      return Object.assign(base, { secret: true }, speedView(state));
    }
    if (state.phase === "sudden" && state.sudden && state.sudden.winner === null) {
      return Object.assign(base, { secret: true }, suddenView(state));
    }
    return base;
  }

  /**
   * A stable key for "the thing on the table right now": the word being
   * guessed, the Speed Chain word being called, the tiebreak word. It changes
   * exactly when that word changes (or there is none), which is what the shared
   * screen's one-shot "Show answer on this screen" clears on.
   */
  function itemKey(state) {
    if (!state || !state.game || !state.phase) return "setup";
    if (state.phase === "chain" && state.chain) {
      return `chain:${state.chainIndex}:${state.target === null ? "-" : state.target}`;
    }
    if (state.phase === "speed" && state.speed) return `speed:${CR.speedCurrent(state)}`;
    if (state.phase === "sudden" && state.sudden) return `sudden:${state.sudden.winner === null ? "open" : "won"}`;
    return state.phase;
  }

  /** The word the shared screen must not show yet, or "" when there is none. */
  function currentAnswer(state) {
    const view = hostView(state);
    return view.secret && view.current && view.current.word ? view.current.word : "";
  }

  /** Every word the room has NOT seen in full yet — what the shared screen must never hold. */
  function hiddenWords(state) {
    const view = hostView(state);
    if (!view.secret) return [];
    if (view.phase === "sudden") return view.current ? [view.current.word] : [];
    return view.words.filter((w) => w.shown < w.letters).map((w) => w.word);
  }

  return { hostView, itemKey, currentAnswer, hiddenWords, SECRET_PHASES };
});
