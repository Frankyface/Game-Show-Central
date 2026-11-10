/* ============================================================
   Password — what the host phone shows (docs/22 §5.1, §6)
   PURE: one selector, hostView(state), over the core's state. It
   returns the host's private information for this moment as a
   plain object; the room glue wraps it as {t:"host", item, seq, …}
   and hands it to the hub (pwd-hostphone.js). No DOM, no time, no
   randomness; never mutates its input.

   What is private, phase by phase:
   - word in play: the password, the ladder position (worth now,
     clues given of the most), whose clue it is, and the NEXT
     password in the deal;
   - word over: the password is public now (the shared screen
     prints it), so only the next password stays private;
   - game over: the Lightning Round words about to be dealt;
   - Lightning Round: every word with its status, the current one
     marked;
   - setup, a finished Lightning Round, result, standings: nothing.

   The host never plays a role in Password that must not know the
   password (in host-as-giver mode the host IS the giver), so there
   is nothing to withhold from a host-played role.
   Runs in Node and the browser (UMD, globalThis.PwdHostView); in
   the browser it also attaches PwdCore.hostView.
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const core = node ? require("./pwd-core.js") : root.PwdCore;
  const api = factory(core);
  if (node) module.exports = api;
  root.PwdHostView = api;
  if (root.PwdCore && !root.PwdCore.hostView) root.PwdCore.hostView = api.hostView;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const MAX_LIST = 10;   // a Lightning Round is 1-10 words; never exceed it

  const NOTHING = Object.freeze({ secret: false });

  /** The word `offset` places after the deal's cursor (the cursor already points past the live one). */
  function upcoming(state, offset) {
    const drawn = Core.wordAt(state.order, state.cursor + offset);
    return drawn.word || "";
  }

  function teamNames(state) {
    return state.teams.map((t) => t.name);
  }

  function base(state, phaseLabel) {
    return { phase: state.phase, phaseLabel, gameNo: state.gameNo, scores: Core.scores(state), teamNames: teamNames(state) };
  }

  function wordView(state) {
    const r = state.round;
    const n = state.wordsPlayed + 1;
    const out = base(state, `Game ${state.gameNo} · password ${n}`);
    if (r.finished) {
      // The shared screen prints the finished password, so it is not private
      // any more; what the host can use now is the one about to be dealt.
      return Object.assign(out, {
        secret: true, stage: "between", item: `Up next: password ${n + 1}`,
        answer: upcoming(state, 0), note: "Press Next word to deal it.",
      });
    }
    const givers = [0, 1].map((t) => Core.rolesFor(state, t).giver.name);
    return Object.assign(out, {
      secret: true, stage: "live", item: `Password ${n}`,
      answer: r.word,
      value: Core.value(state),
      clues: r.clues,
      maxClues: state.game.settings.startValue,
      turnName: state.teams[r.turn].name,
      givers,
      next: upcoming(state, 0),
      repeating: !!state.repeating,
    });
  }

  function overView(state) {
    const s = state.game.settings;
    const winner = state.winner === null ? 0 : state.winner;
    const count = Math.min(s.lightningWords, MAX_LIST);
    const words = [];
    for (let i = 0; i < count; i += 1) words.push({ text: upcoming(state, i), status: "pending", current: i === 0 });
    return Object.assign(base(state, `${state.teams[winner].name} win game ${state.gameNo}`), {
      secret: true, stage: "lightning-next", item: "Lightning Round words", answer: words[0] ? words[0].text : "",
      words, note: "Dealt in this order when the Lightning Round starts.",
    });
  }

  function lightningView(state) {
    const l = state.lightning;
    if (l.finished) return Object.assign(base(state, "Lightning Round over"), NOTHING);
    const words = l.words.slice(0, MAX_LIST).map((w, i) => ({ text: w.text, status: w.status, current: i === l.cursor }));
    return Object.assign(base(state, `Lightning Round · ${state.teams[l.team].name}`), {
      secret: true, stage: "lightning", item: `Lightning Round · word ${l.cursor + 1} of ${l.words.length}`,
      answer: Core.lightningWord(state) || "",
      words,
      giverName: l.giverName,
      money: Core.formatMoney(state, Core.lightningTotal(state)),
    });
  }

  /**
   * The host's private view of `state`, or {secret:false, …} when nothing is
   * private right now. Always carries a string `item` (the hub shows it).
   * @param {object|null} state the core state (null on setup)
   */
  function hostView(state) {
    if (!state || typeof state !== "object" || !state.game) {
      return { secret: false, phase: "setup", phaseLabel: "Setting up", item: "" };
    }
    let out;
    if (state.phase === "word" && state.round) out = wordView(state);
    else if (state.phase === "gameOver") out = overView(state);
    else if (state.phase === "lightning" && state.lightning) out = lightningView(state);
    else {
      const label = state.phase === "setup" ? "Setting up" : "The standings";
      out = Object.assign(base(state, label), NOTHING);
    }
    if (typeof out.item !== "string") out.item = "";
    return out;
  }

  return { hostView, MAX_LIST };
});
