/* ============================================================
   Krillion — host-phone view (PURE) · docs/22 §5.1, §6 (Krillion row)

   hostView(state) is what the host's private second screen shows:

   Deep Dive    the prompt; the rated answer list grouped by tier
                (the judge's remembered answers included); every
                answer submitted so far, as it arrives, with its
                matched tier or "pending"; and a preview of the
                judge's queue (off-list answers and their rulings).
   Puffer       the prompt, the rated list, the used answers, who
                holds the puffer and any answer waiting for a ruling.
   Otherwise    nothing secret (setup, depth board, result).

   The host never plays a role in Krillion, so nothing has to be
   withheld from the host; nothing here ever goes to a contestant
   (the room glue hands it to room.setHostView only). Long lists are
   cut to their first N with a count of the rest, so a view stays
   far under the 16 KB cap. No DOM, no timers; never mutates.
   ============================================================ */

"use strict";

(function (root, factory) {
  const core = (typeof module === "object" && module.exports) ? require("./kr-core.js") : root.KrCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KrHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (K) {
  "use strict";

  const WORDS_PER_TIER = 30;     // the shipped lists never exceed 25; the judge can add more
  const MAX_ROWS = 16;           // answers / queue / used rows shown before "and N more"
  const DIVE_PHASES = new Set(["intro", "prompt", "reveal"]);
  const PUFFER_PHASES = new Set(["pufferReady", "puffer", "popped"]);

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function tierName(state, id) {
    const t = id ? K.tierById(id, K.tiersOf(state)) : null;
    return t ? t.name : "";
  }

  /** First `n` of a list plus how many were left out. */
  function cut(list, n) {
    return { rows: list.slice(0, n), more: Math.max(0, list.length - n) };
  }

  /** The prompt's rated list (file + remembered answers), grouped shallow → deep. */
  function ratedList(state, index) {
    const prompt = K.promptOf(state, index);
    const all = (prompt ? prompt.answers : []).concat(K.learnedFor(state, index));
    return K.tiersOf(state).map((t) => {
      const words = all.filter((a) => a.tier === t.id).map((a) => a.text);
      const part = cut(words, WORDS_PER_TIER);
      return { tier: t.id, name: t.name, answers: part.rows, more: part.more };
    }).filter((row) => row.answers.length || row.more);
  }

  /** "Prawn", "Not valid" or "pending" for one off-list key. */
  function ruling(state, key) {
    const r = state.dive && has(state.dive.rulings, key) ? state.dive.rulings[key] : undefined;
    if (r === undefined) return "pending";
    return r === null ? "Not valid" : tierName(state, r);
  }

  /** Every answer submitted so far, in seat order, with what it matched. */
  function submitted(state) {
    const dive = state.dive;
    const rows = state.players.filter((p) => has(dive.answers, p.pid)).map((p) => {
      const text = dive.answers[p.pid];
      const m = K.matchFor(state, dive.index, text);
      return m
        ? { name: p.name, text, match: m.entry.text, tier: tierName(state, m.tier), onList: true }
        : { name: p.name, text, match: "", tier: ruling(state, K.normaliseAnswer(text)), onList: false };
    });
    return cut(rows, MAX_ROWS);
  }

  function queuePreview(state) {
    const rows = K.reviewQueue(state).map((g) => ({
      text: g.label, count: g.count,
      tier: g.tier === undefined ? "to rule" : (g.tier === null ? "Not valid" : tierName(state, g.tier)),
    }));
    return cut(rows, MAX_ROWS);
  }

  function diveView(state) {
    const dive = state.dive;
    const subs = submitted(state);
    const queue = queuePreview(state);
    return {
      prompt: { text: dive.text, category: dive.category },
      list: ratedList(state, dive.index),
      answers: subs.rows, answersMore: subs.more,
      answered: `${K.answeredCount(state).done} / ${state.players.length}`,
      queue: queue.rows, queueMore: queue.more,
      reviewing: state.phase === "reveal" && dive.revealed === 0,
    };
  }

  function pufferView(state) {
    const pf = state.puffer;
    const used = cut(pf.used.map((u) => ({ text: u.text, tier: tierName(state, u.tier) })), MAX_ROWS);
    return {
      prompt: { text: pf.text, category: pf.category },
      list: ratedList(state, pf.index),
      holder: K.nameOf(state, pf.holder),
      pending: pf.pending ? { text: pf.pending.text } : null,
      used: used.rows, usedMore: used.more,
    };
  }

  function phaseLabel(state) {
    if (state.mode === "puffer") return state.phase === "result" ? "Result" : `Puffer Party · round ${state.round}`;
    if (state.phase === "result") return "Result";
    if (state.phase === "depth") return "Depth board";
    return `Prompt ${state.round} of ${state.game.settings.promptsPerGame}`;
  }

  /**
   * A stable key for the item on the table: changes exactly when a new
   * prompt comes up (or the game ends), which is what the shared screen's
   * one-shot "Show answer on this screen" clears on.
   */
  function itemKey(state) {
    if (!state || !state.game || state.phase === "setup") return "setup";
    if (state.phase === "result") return "result";
    if (state.mode === "puffer" && state.puffer) return `puffer:${state.round}:${state.puffer.index}`;
    if (state.dive) return `dive:${state.round}:${state.dive.index}`;
    return state.phase;
  }

  /**
   * The host phone's view of `state` (docs/22 §6).
   * @param {object|null} state the core state, or null on the setup screen
   */
  function hostView(state) {
    if (!state || !state.game || !state.phase || state.phase === "setup") {
      return { phase: "setup", phaseLabel: "Setup", mode: "", secret: false };
    }
    const base = { phase: state.phase, phaseLabel: phaseLabel(state), mode: state.mode, secret: false };
    if (state.mode === "deepDive" && DIVE_PHASES.has(state.phase) && state.dive) {
      return Object.assign(base, { secret: true }, diveView(state));
    }
    if (state.mode === "puffer" && PUFFER_PHASES.has(state.phase) && state.puffer) {
      return Object.assign(base, { secret: true }, pufferView(state));
    }
    return base;
  }

  /** The rated list the shared screen must not show (flat), for the fallback and tests. */
  function currentList(state) {
    const v = hostView(state);
    return v.list ? v.list : [];
  }

  return { hostView, itemKey, currentList, WORDS_PER_TIER, MAX_ROWS };
});
