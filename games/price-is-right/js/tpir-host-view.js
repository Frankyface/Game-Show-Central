/* ============================================================
   The Price Is Right — the host phone's view (PURE)
   docs/22 §5.1 and §6: the actual retail price of everything in
   play right now — the Contestants' Row item, the pricing-game
   items, both showcase totals — for the host's private second
   screen, plus the one "current item" the laptop may reveal with
   its per-item fallback button (§5.4).

   Pure and deterministic: reads a TpirCore state, never mutates
   it, never touches the DOM. No image data ever (docs/22: the host
   phone shows no images). Runs in Node (module.exports) and the
   browser (globalThis.TpirHostView, after tpir-core.js).
   ============================================================ */

"use strict";

(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const core = node ? require("./tpir-core.js") : root.TpirCore;
  const api = factory(core);
  if (node) module.exports = api;
  root.TpirHostView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  const PHASE_LABELS = Object.freeze({
    setup: "Setting up",
    row: "Contestants' Row",
    game: "Pricing game",
    showdown: "Showcase Showdown",
    showcase: "The Showcase",
    standings: "Final standings",
  });

  const TRUTH = Object.freeze({ higher: "Higher", lower: "Lower", correct: "Correct as shown" });

  const money = (state, n) => Core.formatMoney(state, n);

  /** Nothing private applies at this moment. */
  function quiet(state, note) {
    return { phase: state.phase, phaseLabel: phaseLabel(state), secret: false, item: "", note: note || "" };
  }

  function phaseLabel(state) {
    if (state.phase === "game" && state.game && state.game.kind) return Core.GAME_LABELS[state.game.kind];
    return PHASE_LABELS[state.phase] || "";
  }

  /* ============ One builder per phase ============ */

  function rowView(state) {
    const row = state.row;
    if (!row.item || row.revealed) return quiet(state, row.revealed ? "The price has been revealed." : "");
    return {
      phase: "row", phaseLabel: phaseLabel(state), secret: true,
      item: row.item.name, answer: money(state, row.item.price), note: row.item.note || "",
      lines: [],
    };
  }

  function cliffView(state, g) {
    const item = g.items[g.index];
    return {
      phase: "game", phaseLabel: phaseLabel(state), secret: true,
      item: item.name, answer: money(state, item.price),
      note: `${g.left} step${g.left === 1 ? "" : "s"} left before the fall.`,
      lines: g.items.map((it, i) => ({
        label: it.name, value: money(state, it.price),
        done: i < g.guesses.length, current: i === g.index,
      })),
    };
  }

  function plinkoView(state, g) {
    if (g.stage !== "answers") return quiet(state, "The chips decide the rest — nothing secret.");
    const p = g.prices[g.index];
    return {
      phase: "game", phaseLabel: phaseLabel(state), secret: true,
      item: `${p.name} — shown at ${money(state, p.shown)}`,
      answer: `${money(state, p.actual)} · ${TRUTH[Core.plinkoTruth(p)]}`,
      note: `${g.chips} chip${g.chips === 1 ? "" : "s"} so far.`,
      lines: g.prices.map((q, i) => ({
        label: q.name, value: `${money(state, q.actual)} (shown ${money(state, q.shown)})`,
        done: i < g.index, current: i === g.index,
      })),
    };
  }

  function l7View(state, g) {
    return {
      phase: "game", phaseLabel: phaseLabel(state), secret: true,
      item: g.car, answer: money(state, g.price),
      note: `${g.wallet} dollar${g.wallet === 1 ? "" : "s"} left in the wallet.`,
      lines: g.digits.map((d, i) => ({
        label: `Digit ${i + 1}`, value: String(d),
        done: i < g.revealedDigits.length, current: i === g.index,
      })),
    };
  }

  function gameView(state) {
    const g = state.game;
    if (!g || !g.kind || g.pending) return quiet(state, "Choosing a pricing game.");
    if (g.done) return quiet(state, "That game is over.");
    if (g.kind === "cliffhangers") return cliffView(state, g);
    if (g.kind === "plinko") return plinkoView(state, g);
    return l7View(state, g);
  }

  function showcaseView(state) {
    const sc = state.showcase;
    if (sc.revealed) return quiet(state, "Both showcases have been revealed.");
    const owners = {};
    Object.keys(sc.assignments || {}).forEach((pid) => { owners[sc.assignments[pid]] = Core.nameOf(state, pid); });
    const lines = sc.pair.map((idx, i) => {
      const show = state.content.showcases[idx];
      const who = owners[idx] ? ` — ${owners[idx]}` : "";
      return { label: `${i === 0 ? "First" : "Second"} showcase${who}`, value: money(state, show ? show.total : 0) };
    });
    return {
      phase: "showcase", phaseLabel: phaseLabel(state), secret: true,
      item: "Both showcase totals", answer: lines.map((l) => l.value).join(" · "),
      note: sc.chosen ? "" : `${Core.nameOf(state, sc.chooser)} is choosing.`,
      lines,
    };
  }

  /**
   * The host's private view for the current moment (docs/22 §5.1). Never
   * carries `image` / `imageAlt`; every list is at most nine short rows, so it
   * stays far below the 16 KB cap.
   * @param {object|null} state a TpirCore state, or null before a show starts
   */
  function hostView(state) {
    if (!state) return { phase: "setup", phaseLabel: PHASE_LABELS.setup, secret: false, item: "", note: "" };
    if (state.phase === "row") return rowView(state);
    if (state.phase === "game") return gameView(state);
    if (state.phase === "showcase") return showcaseView(state);
    return quiet(state);
  }

  /**
   * The laptop's per-item fallback (docs/22 §5.4): what "Show answer on this
   * screen" reveals, keyed so the reveal clears itself on the next item.
   * @returns {{key:string, text:string}|null} null when nothing is secret
   */
  function fallbackFor(state) {
    const v = hostView(state);
    if (!v.secret) return null;
    const seg = state.segmentIndex;
    if (state.phase === "row") return { key: `row:${seg}`, text: `Actual retail price: ${v.answer}` };
    if (state.phase === "showcase") return { key: `sc:${seg}`, text: `Showcase totals: ${v.answer}` };
    const g = state.game;
    // Lucky Seven is one item (the car) across its digits; the others step item by item.
    const at = g.kind === "luckyseven" ? 0 : g.index;
    return { key: `${g.kind}:${seg}:${at}`, text: `${v.item}: ${v.answer}` };
  }

  return { hostView, fallbackFor, PHASE_LABELS };
});
