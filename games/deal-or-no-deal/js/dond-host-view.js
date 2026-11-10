/* ============================================================
   Deal or No Deal — the host phone's view (PURE, docs/22 §5.1, §6)
   What the host's private second screen shows: the banker's next
   offer before it is announced and exactly how it is computed —
   the amounts still in play, their average (the expected value),
   the round's banker factor and the jitter band — and, once the
   offer is on the table, the offer itself measured against that
   average.

   What it deliberately does NOT carry: which amount is in which
   case, the contestant's own case included. Nobody in the studio
   knows that — not the contestant, not the host — and the host
   phone keeps it that way. The amounts still in play are public:
   they are the un-struck rows of the board on the shared screen.

   No DOM, no clock, no rng: the projection is the jitter-free
   midpoint plus the band the jitter can move it within, so the
   same state always gives the same view. Runs in Node and the
   browser (globalThis.DondHostView, after js/dond-core.js).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const core = node ? require("./dond-core.js") : root.DondCore;
  const api = factory(core);
  if (node) module.exports = api;
  root.DondHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const MAX_LIST = 30;       // the amounts list is truncated well under 16 KB

  const PHASE_LABEL = {
    setup: "Setting up", seat: "Choosing a contestant", pick: "Picking a case",
    round: "Opening cases", offer: "The banker's offer", swap: "The swap",
    reveal: "The reveal", result: "Result", standings: "Standings",
  };

  /** The jitter-free offer and the band the jitter can move it within. */
  function projection(state) {
    const s = state.game.settings;
    const ev = Core.ev(state);
    const factor = Core.factorFor(state);
    const jitter = Number.isFinite(s.jitter) ? s.jitter : 0;
    const mid = Core.niceOffer(ev * factor);
    return {
      mid, low: Core.niceOffer(ev * factor * (1 - jitter)), high: Core.niceOffer(ev * factor * (1 + jitter)),
      ev, factor, jitter,
    };
  }

  /** The amounts still sealed, low to high, as the public board shows them. */
  function stillInPlay(state) {
    const sorted = Core.remainingAmounts(state).slice().sort((a, b) => a - b);
    return {
      amounts: sorted.slice(0, MAX_LIST).map((a) => Core.formatMoney(state, a)),
      more: Math.max(0, sorted.length - MAX_LIST),
      count: sorted.length,
    };
  }

  /** "Factor 0.30 · jitter ±5 %" — the banker's rule in one line. */
  function ruleLine(p, round, rounds) {
    const pct = Math.round(p.jitter * 100);
    return `Round ${round} of ${rounds} · factor ${p.factor.toFixed(2)}`
      + (pct ? ` · jitter ±${pct}%` : " · no jitter");
  }

  function noteFor(state, ready) {
    if (ready) return "The round is over. This is what the banker is about to offer, before the jitter.";
    if (state.phase === "pick") return "No case is open yet — this is the whole board's average at round 1's factor.";
    return `${state.toOpen} more ${state.toOpen === 1 ? "case" : "cases"} to open this round — it will move.`;
  }

  function nothingSecret(state, base) {
    return Object.assign(base, { secret: false, item: "", note: "Nothing secret right now." });
  }

  /**
   * The host's private view for the current moment. Never contains a case
   * number paired with an amount; every money value is a formatted string.
   * @param {object} state a DondCore state (or null)
   */
  function hostView(state) {
    if (!state || !state.game) return { phase: "setup", phaseLabel: PHASE_LABEL.setup, secret: false, item: "" };
    const base = {
      phase: state.phase,
      phaseLabel: PHASE_LABEL[state.phase] || state.phase,
      who: Core.nameOf(state, state.current) || "",
    };
    const playing = state.phase === "pick" || state.phase === "round" || state.phase === "offer";
    if (!playing || !(state.cases || []).length || !Core.otherCases(state).length) return nothingSecret(state, base);

    const rounds = state.game.settings.rounds.length;
    const round = Math.min(state.round + 1, rounds);
    const p = projection(state);
    const money = (n) => Core.formatMoney(state, n);
    const view = Object.assign(base, {
      secret: true,
      round, rounds,
      ev: money(Math.round(p.ev * 100) / 100),
      factor: p.factor,
      rule: ruleLine(p, round, rounds),
      left: stillInPlay(state),
    });

    if (state.phase === "offer" && Number.isFinite(state.offer)) {
      const pct = p.ev > 0 ? Math.round((state.offer / p.ev) * 100) : 0;
      return Object.assign(view, {
        item: "The banker's offer",
        offer: money(state.offer),
        announced: true,
        note: `${pct}% of the board average. The jitter-free offer was ${money(p.mid)}.`,
      });
    }
    const ready = state.phase === "round" && state.toOpen === 0;
    return Object.assign(view, {
      item: ready ? "The banker's next offer" : "If the banker called now",
      offer: money(p.mid),
      range: p.low === p.high ? "" : `${money(p.low)} – ${money(p.high)}`,
      announced: false,
      note: noteFor(state, ready),
    });
  }

  return { hostView, PHASE_LABEL, MAX_LIST };
});
