/* ============================================================
   Deal or No Deal — host rendering
   Everything that paints the host screens, split out of
   dond-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, and dispatches
   nothing except through window.DondApp. Every string reaches the
   page through textContent — never innerHTML.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the app, editor, room and phone glue use
   the same four.
   ============================================================ */

"use strict";

/* ============ Tiny DOM helpers (shared with app/editor/room/phone) ============ */

function $(id) { return document.getElementById(id); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function show(node, on) {
  if (node) node.classList.toggle("hidden", !on);
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text === undefined || text === null ? "" : String(text);
}

const DondView = (function () {
  const core = () => window.DondCore;

  /* ============ Screen switching ============ */

  const SCREENS = ["setup", "seat", "play", "result"];

  function phaseScreen(state) {
    if (!state) return "setup";
    if (state.phase === "standings") return "result";
    if (["pick", "round", "offer", "swap", "reveal"].indexOf(state.phase) >= 0) return "play";
    return SCREENS.indexOf(state.phase) >= 0 ? state.phase : "setup";
  }

  function renderScreens(app) {
    const wanted = app.editorOpen ? "editor" : phaseScreen(app.core);
    SCREENS.forEach((name) => show($(`screen-${name}`), !app.editorOpen && name === wanted));
    show($("screen-editor"), app.editorOpen);
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    const list = $("dond-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p, i) => {
      const li = el("li");
      li.appendChild(el("span", "player-seat", i + 1));
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-tag", p.manual ? "host" : "phone"));
      const remove = el("button", "btn btn-ghost btn-small", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => window.DondApp.removePlayer(p.pid));
      li.appendChild(remove);
      list.appendChild(li);
    });
    setText("dond-player-count", app.setup.players.length || "");
    setText("dond-source", app.source);
    $("dond-swap").checked = window.DondApp.settingOn("allowSwap");
    $("dond-advice").checked = window.DondApp.settingOn("audienceAdvice");
    setText("dond-rules-note", app.phoneCount
      ? `${app.phoneCount} phone${app.phoneCount === 1 ? "" : "s"} connected.`
      : "No phones yet — the host can open every case themselves.");
    setText("dond-board-summary", boardSummary(app.game));
    $("btn-start").disabled = !app.game || !app.setup.players.length;
  }

  function boardSummary(game) {
    if (!game) return "";
    let g;
    try { g = core().normalizeBoard(game); } catch (err) { return err.message; }
    const s = g.settings;
    const top = core().formatMoney({ game: g }, s.amounts[s.amounts.length - 1]);
    return `${s.amounts.length} cases, top prize ${top}, ${s.rounds.length} rounds (${s.rounds.join(", ")}).`;
  }

  /* ============ Who is playing ============ */

  function renderSeat(app) {
    const state = app.core;
    const row = $("dond-seat-list");
    row.replaceChildren();
    if (!state) return;
    core().waitingContestants(state).forEach((c) => {
      const btn = el("button", "btn btn-gold btn-big seat-btn", c.name);
      btn.type = "button";
      btn.dataset.pid = c.pid;
      btn.addEventListener("click", () => window.DondApp.dispatch({ type: "seat", pid: c.pid }));
      row.appendChild(btn);
    });
    renderStandings("dond-seat-standings", state, true);
  }

  /* ============ The cases ============ */

  const PHASE_TEXT = {
    pick: ["Pick the case you keep", "Whatever is inside it is yours unless you deal."],
    round: ["Open the cases", ""],
    offer: ["The banker is on the phone", "Deal or no deal?"],
    swap: ["Two cases left", "Keep the case, or swap it for the last one?"],
    reveal: ["The reveal", ""],
  };

  function renderPlay(app) {
    const state = app.core;
    if (!state) return;
    const words = PHASE_TEXT[state.phase] || ["", ""];
    setText("dond-phase", words[0]);
    setText("dond-phase-sub", phaseSub(state, words[1]));
    setText("dond-toopen", counterText(state));
    show($("dond-own-chip"), state.own !== null);
    setText("dond-own-number", state.own === null ? "—" : state.own);
    setText("dond-notice", state.notice || " ");
    renderCases(state);
    renderBoard(state);
    renderPlayControls(state);
  }

  function phaseSub(state, fallback) {
    const who = core().nameOf(state, state.current) || "The contestant";
    if (state.phase === "round") {
      if (state.toOpen === 0) return `That is the round. The banker wants a word with ${who}.`;
      return `${who} opens ${state.toOpen} more ${state.toOpen === 1 ? "case" : "cases"}.`;
    }
    if (state.phase === "reveal") {
      return state.deal
        ? `${who} dealt for ${core().formatMoney(state, state.deal.offer)} — this is what was on the board.`
        : `${who} kept case ${state.own}. Open it.`;
    }
    if (state.phase === "pick") return `${who}, choose a case.`;
    return fallback;
  }

  function counterText(state) {
    const rounds = state.game.settings.rounds.length;
    if (state.phase === "pick") return "Choose a case";
    if (state.phase === "reveal") return state.deal ? "Would have won" : "The last case";
    if (state.phase === "swap") return "Swap?";
    return `Round ${Math.min(state.round + 1, rounds)} of ${rounds}`;
  }

  /** One gold case per number; opened ones show what was inside. */
  function renderCases(state) {
    const box = $("dond-cases");
    box.replaceChildren();
    const clickable = state.phase === "pick" || (state.phase === "round" && state.toOpen > 0);
    core().casesView(state).forEach((c) => {
      const btn = el("button", "case");
      btn.type = "button";
      btn.dataset.n = String(c.n);
      btn.classList.toggle("is-open", c.opened);
      btn.classList.toggle("is-own", c.own);
      btn.classList.toggle("is-last", c.last && c.opened);
      const inner = el("span", "case-inner");
      inner.appendChild(el("span", "case-face case-front", c.n));
      inner.appendChild(el("span", "case-face case-back", c.label));
      btn.appendChild(inner);
      btn.disabled = !clickable || c.opened || (c.own && state.phase === "round");
      btn.setAttribute("aria-label", caseLabel(c, state));
      if (!btn.disabled) btn.addEventListener("click", () => window.DondApp.chooseCase(c.n));
      box.appendChild(btn);
    });
  }

  function caseLabel(c, state) {
    if (c.opened) return `Case ${c.n}, opened, ${c.label}`;
    if (c.own) return `Case ${c.n}, ${core().nameOf(state, state.current)}'s own case`;
    return `Case ${c.n}, still sealed`;
  }

  /** The two-column amount board; opened amounts are struck through. */
  function renderBoard(state) {
    const cols = core().boardColumns(state);
    fillColumn($("dond-col-left"), cols.left);
    fillColumn($("dond-col-right"), cols.right);
  }

  function fillColumn(node, rows) {
    if (!node) return;
    node.replaceChildren();
    rows.forEach((row) => {
      const li = el("li", `amount-row${row.opened ? " is-open" : ""}`);
      li.appendChild(el("span", "amount-label", row.label));
      if (row.opened) li.appendChild(el("span", "amount-gone", "gone"));
      node.appendChild(li);
    });
  }

  function renderPlayControls(state) {
    const legal = core().legalActions(state);
    show($("btn-banker"), state.phase === "round" && state.toOpen === 0);
    show($("btn-swap-yes"), state.phase === "swap");
    show($("btn-swap-no"), state.phase === "swap");
    show($("btn-reveal-rest"), state.phase === "reveal" && core().revealOrder(state).length > 0);
    show($("btn-reveal-own"), state.phase === "reveal");
    $("btn-undo").disabled = legal.indexOf("undo") < 0;
    const own = core().caseByN(state, state.own);
    $("btn-reveal-own").textContent = own && own.opened ? "Case opened" : `Open case ${state.own}`;
    $("btn-reveal-own").disabled = !!(own && own.opened);
  }

  /* ============ The banker's call ============ */

  function renderBanker(app) {
    const state = app.core;
    const on = !!state && state.phase === "offer";
    show($("dond-banker"), on);
    if (!on) return;
    setText("dond-offer", core().formatMoney(state, state.offer));
    setText("dond-offer-sub", offerSub(state));
    renderRequest(state);
    renderEv(app, state);
    renderAdvice(state);
  }

  /**
   * The contestant's phone said Deal or No Deal. It is a request and nothing
   * more: the banner names it, the host still presses the button.
   */
  function renderRequest(state) {
    const node = $("dond-request");
    const asked = state.request;
    show(node, !!asked);
    if (!asked) return;
    const word = asked.choice === "deal" ? "DEAL" : "NO DEAL";
    node.textContent = `${core().nameOf(state, asked.pid)} says ${word} — press the button to confirm.`;
  }

  function offerSub(state) {
    const left = core().unopenedCases(state).length;
    const round = state.round + 1;
    return `After round ${round}, with ${left} cases still sealed.`;
  }

  /** The odds are the HOST's business only — hidden behind a toggle. */
  function renderEv(app, state) {
    const btn = $("btn-ev");
    const value = $("dond-ev");
    btn.setAttribute("aria-pressed", String(!!app.evShown));
    btn.textContent = app.evShown ? "Hide the odds" : "Show the odds (host only)";
    show(value, !!app.evShown);
    if (!app.evShown) return;
    const ev = core().ev(state);
    const pct = ev > 0 ? Math.round((state.offer / ev) * 100) : 0;
    value.textContent = `Board average ${core().formatMoney(state, Math.round(ev))} — the offer is ${pct}% of it.`;
  }

  function renderAdvice(state) {
    const box = $("dond-advice-box");
    const wanted = !!state.game.settings.audienceAdvice;
    show(box, wanted);
    if (!wanted) return;
    const chart = core().adviceChart(state);
    setBar("dond-advice-deal", chart.pcts[0]);
    setBar("dond-advice-no", chart.pcts[1]);
    setText("dond-advice-deal-label", `Deal ${chart.pcts[0]}%`);
    setText("dond-advice-no-label", `No deal ${chart.pcts[1]}%`);
    setText("dond-advice-count", adviceCountText(state, chart));
    show($("btn-advice-close"), state.advice.open);
  }

  function setBar(id, pct) {
    const node = $(id);
    if (node) node.style.width = `${Math.max(pct, pct > 0 ? 8 : 0)}%`;
  }

  function adviceCountText(state, chart) {
    if (!chart.total) {
      return state.advice.open ? "Waiting for the room to vote…" : "Nobody voted.";
    }
    const votes = `${chart.total} vote${chart.total === 1 ? "" : "s"}`;
    const split = `${chart.counts[0]} deal / ${chart.counts[1]} no deal`;
    return state.advice.open ? `${votes} so far — ${split}.` : `Vote closed: ${votes} — ${split}.`;
  }

  /* ============ Result and standings ============ */

  const REASON_WORDS = {
    deal: "took the banker's money",
    case: "went all the way",
    unfinished: "did not finish",
  };

  function renderResult(app) {
    const state = app.core;
    if (!state) return;
    const done = state.phase === "standings";
    const outcome = state.outcome;
    setText("dond-result-kicker", done ? "How the night went" : "The result");
    setText("dond-result-name", done ? "Standings" : (outcome ? core().nameOf(state, outcome.pid) : ""));
    setText("dond-result-amount", !done && outcome ? core().formatMoney(state, outcome.won) : "");
    setText("dond-result-detail", done ? "" : resultDetail(state, outcome));
    renderStandings("dond-standings", state, false);
    show($("btn-next-contestant"), !done && core().waitingContestants(state).length > 0);
    show($("btn-finish"), !done);
    show($("btn-play-again"), done);
    $("btn-result-undo").disabled = !state.history.length;
  }

  /**
   * The line that makes a Deal land: what the case actually held, and whether
   * the banker won the exchange.
   */
  function resultDetail(state, outcome) {
    if (!outcome) return "";
    const held = Number.isFinite(outcome.wouldHaveWon)
      ? core().formatMoney(state, outcome.wouldHaveWon) : null;
    if (outcome.reason === "deal" && held) {
      return outcome.wouldHaveWon > outcome.won
        ? `Case ${state.own} held ${held} — the banker won this one.`
        : `Case ${state.own} held ${held} — dealing was the right call.`;
    }
    if (outcome.reason === "case") {
      return outcome.swapped
        ? `Swapped into case ${state.own} at the last moment — and it held ${held}.`
        : `Case ${state.own} held it all along.`;
    }
    return `${core().nameOf(state, outcome.pid)} ${REASON_WORDS[outcome.reason] || "finished"}.`;
  }

  function renderStandings(id, state, compact) {
    const list = $(id);
    if (!list) return;
    list.replaceChildren();
    core().standings(state).forEach((c) => {
      const li = el("li", `gsc-podium${c.out ? " is-banked" : " is-active"}`);
      li.appendChild(el("span", "gsc-podium-name", c.name));
      li.appendChild(el("span", "gsc-podium-score", c.out ? core().formatMoney(state, c.won) : "to play"));
      if (!compact) {
        li.appendChild(el("span", "gsc-podium-note", c.out ? (REASON_WORDS[c.reason] || "") : "still waiting"));
      }
      list.appendChild(li);
    });
  }

  /* ============ Chrome ============ */

  function renderChrome(app) {
    const state = app.core;
    setText("dond-title", (app.game && app.game.title) || "Deal or No Deal");
    document.body.classList.toggle("is-playing", !!state && phaseScreen(state) === "play");
    show($("btn-editor"), !state || state.phase === "setup" || app.editorOpen);
  }

  /* ============ Entry point ============ */

  function render(app) {
    renderScreens(app);
    renderChrome(app);
    if (app.editorOpen) { show($("dond-banker"), false); return; }
    const screen = phaseScreen(app.core);
    if (screen === "setup") renderSetup(app);
    if (screen === "seat") renderSeat(app);
    if (screen === "play") renderPlay(app);
    if (screen === "result") renderResult(app);
    renderBanker(app);
  }

  return { render, phaseScreen, renderStandings, boardSummary };
})();

if (typeof window !== "undefined") window.DondView = DondView;
