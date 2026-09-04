/* ============================================================
   Chain Reaction — host rendering
   Everything that paints the host screens, split out of
   cr-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, and dispatches
   nothing except through window.CrApp. Every string reaches the
   page through textContent — never innerHTML.

   The board is deliberately built from the SAME masked rows the
   phones get (CrCore.columnRows): the host screen is the shared
   screen, so a hidden letter is not on it either. The one way to
   see a word early is the host's Peek button.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the app, editor, room and phone glue
   use the same four.
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

const CrView = (function () {
  const core = () => window.CrCore;

  const SCREENS = ["setup", "chain", "sudden", "speed", "result"];

  function phaseScreen(state) {
    if (!state) return "setup";
    if (state.phase === "chainDone") return "chain";   // the interstitial floats over the board
    return SCREENS.indexOf(state.phase) >= 0 ? state.phase : "setup";
  }

  /* ============ The column of letter tiles ============ */

  /** A row's plain-English label, so the board reads without colour or sight. */
  function rowLabel(row, word) {
    if (row.solved) return `${word || "Solved"} — solved`;
    const letters = row.cells.filter((c) => c.letter).length;
    return `${row.shown} of ${letters} letters showing`;
  }

  /**
   * One word as a run of letter tiles. `words` is only passed for rows the
   * board is allowed to name (solved ones, or the host's peek).
   */
  function buildRow(row, options) {
    const opts = options || {};
    const li = el("li", "row");
    li.dataset.index = String(row.index);
    const tiles = el("div", "row-tiles");
    tiles.style.setProperty("--len", String(row.len));
    row.cells.forEach((cell) => {
      const tile = el("span", "tile", cell.ch === null ? "" : cell.ch);
      if (cell.ch !== null) tile.classList.add("is-lit");
      if (!cell.letter) tile.classList.add("is-punct");
      tiles.appendChild(tile);
    });
    li.appendChild(tiles);
    if (row.solved) li.classList.add("is-solved");
    if (row.owner === 0 || row.owner === 1) li.classList.add(`owner-${row.owner}`);
    if (opts.eligible) li.classList.add("is-eligible");
    if (opts.target) li.classList.add("is-target");
    if (opts.mark) li.classList.add(`mark-${opts.mark}`);
    if (opts.current) li.classList.add("is-current");
    const tag = el("span", "row-tag", opts.tag || "");
    li.appendChild(tag);
    li.setAttribute("aria-label", rowLabel(row, opts.name));
    return li;
  }

  const DIR_TAG = { top: "from the top", bottom: "from the bottom" };

  function renderColumn(app) {
    const state = app.core;
    const list = $("cr-column");
    list.replaceChildren();
    const rows = core().maskedColumn(state);
    const ends = core().frontier(state);
    rows.forEach((row) => {
      const solved = row.solved;
      const tag = row.target ? (DIR_TAG[state.direction] || "guess it")
        : (row.index === ends.top && "next from the top")
        || (row.index === ends.bottom && "next from the bottom") || "";
      list.appendChild(buildRow(row, {
        eligible: row.eligible && state.target === null,
        target: row.target,
        tag,
        name: solved ? state.chain.words[row.index] : "",
      }));
    });
  }

  /* ============ Team podiums ============ */

  function buildPodium(app, index, options) {
    const state = app.core;
    const opts = options || {};
    const box = el("div", "gsc-podium podium");
    box.dataset.team = String(index);
    if (opts.active) box.classList.add("is-active");
    box.classList.add(`team-${index}`);
    box.appendChild(el("span", "gsc-podium-name", state.teams[index].name));
    box.appendChild(el("span", "gsc-podium-score", core().formatMoney(state, state.scores[index])));
    box.appendChild(el("span", "gsc-podium-note", opts.note || ""));
    return box;
  }

  function renderTeams(app, hostId) {
    const state = app.core;
    const box = $(hostId);
    box.replaceChildren();
    [0, 1].forEach((i) => {
      const active = state.control === i;
      box.appendChild(buildPodium(app, i, {
        active,
        note: active ? "▶ in control" : "waiting",
      }));
    });
  }

  /* ============ The chain screen ============ */

  function renderChain(app) {
    const state = app.core;
    setText("cr-chain-kicker", `Chain ${state.chainIndex + 1} of ${state.game.settings.values.length}`);
    setText("cr-chain-value", `${core().formatMoney(state, core().chainValue(state))} a word`);
    renderColumn(app);
    renderTeams(app, "cr-teams");
    setText("cr-notice", state.notice);
    renderGuess(app);
    renderChainButtons(app);
    renderPeek(app);
  }

  function renderGuess(app) {
    const state = app.core;
    const field = $("cr-guess");
    if (document.activeElement !== field) field.value = state.guessText || "";
    field.disabled = state.target === null;
    const from = state.guessBy ? nameOfPid(app, state.guessBy) : "";
    setText("cr-guess-from", from ? `Typed on ${from}'s phone` : "");
    setText("cr-guess-hint", state.target === null
      ? "Reveal a letter first."
      : "Nothing is judged automatically — you decide.");
  }

  function nameOfPid(app, pid) {
    const player = app.players.find((p) => p.pid === pid);
    return player ? player.name : "a phone";
  }

  function renderChainButtons(app) {
    const state = app.core;
    const ends = core().frontier(state);
    const picking = state.target === null && state.phase === "chain";
    $("btn-reveal-top").disabled = !picking || ends.top === null;
    $("btn-reveal-bottom").disabled = !picking || ends.bottom === null;
    $("btn-correct").disabled = state.target === null;
    $("btn-wrong").disabled = state.target === null;
    $("btn-pass").disabled = state.phase !== "chain";
    $("btn-undo").disabled = state.history.length === 0;
  }

  /** The host's private look at the word in play. It is on the shared screen,
      so it says so, it is off by default, and it clears on every judgement. */
  function renderPeek(app) {
    const state = app.core;
    const node = $("cr-peek-word");
    const btn = $("btn-peek");
    const word = state.target === null ? "" : state.chain.words[state.target];
    btn.disabled = !word;
    btn.setAttribute("aria-pressed", String(!!app.peek && !!word));
    node.textContent = app.peek && word ? `The word is ${word}` : "";
    node.classList.toggle("is-on", !!(app.peek && word));
  }

  /* ============ Sudden death ============ */

  function renderSudden(app) {
    const state = app.core;
    const sd = state.sudden;
    if (!sd) return;
    setText("cr-sudden-before", sd.before);
    setText("cr-sudden-after", sd.after);
    const list = $("cr-sudden-word");
    list.replaceChildren();
    const rows = core().columnRows({
      words: [sd.word], revealed: [sd.revealed], solved: [sd.winner !== null], owner: [sd.winner],
    });
    list.appendChild(buildRow(rows[0], { target: true, name: sd.winner !== null ? sd.word : "" }));
    renderTeams(app, "cr-sudden-teams");
    setText("cr-sudden-notice", state.notice);
    $("btn-sudden-reveal").disabled = sd.winner !== null;
    $("btn-sudden-correct").disabled = sd.winner !== null;
    $("btn-sudden-wrong").disabled = sd.winner !== null;
    $("btn-sudden-undo").disabled = state.history.length === 0;
  }

  /* ============ Speed Chain ============ */

  const SPEED_TAGS = { got: "✓ got it", pass: "passed — comes back" };

  function renderSpeed(app) {
    const state = app.core;
    const sp = state.speed;
    if (!sp) return;
    setText("cr-speed-kicker", `Speed Chain — ${sp.seconds} seconds`);
    setText("cr-speed-team", state.teams[sp.team].name);
    const list = $("cr-speed-column");
    list.replaceChildren();
    const rows = core().speedColumn(state);
    rows.forEach((row) => {
      list.appendChild(buildRow(row, {
        current: row.current,
        mark: row.mark,
        tag: row.current ? "call this one" : (SPEED_TAGS[row.mark] || ""),
        name: row.solved ? sp.words[row.index] : "",
      }));
    });
    renderSpeedStatus(app, sp);
    renderSpeedButtons(app, sp);
  }

  function renderSpeedStatus(app, sp) {
    const got = sp.marks.filter((m) => m === "got").length;
    setText("cr-speed-progress", sp.over
      ? `${sp.got} of ${core().HIDDEN_COUNT} in the bag`
      : `${got} of ${core().HIDDEN_COUNT} — ${sp.queue.length} to go`);
    setText("cr-speed-result", sp.over
      ? `${app.core.notice} ${app.core.teams[sp.team].name} bank ${core().formatMoney(app.core, sp.award)}.`
      : app.core.notice);
  }

  function renderSpeedButtons(app, sp) {
    const live = sp.started && !sp.over;
    const start = $("btn-speed-start");
    show(start, !sp.started && !sp.over);
    // A save or an undo pauses the clock rather than losing it, so the button
    // has to say which of the two it is doing (CR-2).
    const paused = Number.isFinite(sp.remainingMs) && sp.remainingMs < sp.seconds * 1000;
    start.replaceChildren();
    start.appendChild(document.createTextNode(paused
      ? `Resume the clock (${Math.ceil(sp.remainingMs / 1000)}s) `
      : "Start the clock "));
    start.appendChild(el("kbd", "gsc-kbd", "S"));
    $("btn-speed-got").disabled = !live;
    $("btn-speed-pass").disabled = !live;
    show($("btn-speed-done"), sp.over);
    $("btn-speed-undo").disabled = app.core.history.length === 0;
  }

  /* ============ Interstitial + result ============ */

  function renderInterstitial(app) {
    const state = app.core;
    const open = state && state.phase === "chainDone";
    show($("cr-interstitial"), open);
    if (!open) return;
    const last = core().chainsLeft(state) === 0;
    setText("cr-inter-kicker", last ? "That's the chains" : "Chain complete");
    setText("cr-inter-title", state.chain ? `${state.chain.words[0]} … ${state.chain.words[7]}` : "");
    const list = $("cr-inter-chain");
    list.replaceChildren();
    (state.chain ? state.chain.words : []).forEach((word, i) => {
      const li = el("li", "inter-word", word);
      const owner = state.chain.owner[i];
      if (owner === 0 || owner === 1) li.classList.add(`owner-${owner}`);
      list.appendChild(li);
    });
    renderStandings(app, "cr-inter-standings");
    setText("cr-inter-sub", interSub(state, last));
    renderInterButtons(state, last);
  }

  function interSub(state, last) {
    if (!last) {
      return `Next up: ${core().formatMoney(state, state.game.settings.values[state.chainIndex + 1])} a word.`;
    }
    if (core().leader(state) === null) return "Level — one sudden-death word decides who plays the Speed Chain.";
    return `${state.teams[core().leader(state)].name} lead, so they play the Speed Chain.`;
  }

  function renderInterButtons(state, last) {
    const tied = core().leader(state) === null;
    show($("btn-next-chain"), !last);
    show($("btn-sudden"), last && tied);
    show($("btn-to-speed"), last && !tied);
    $("btn-inter-undo").disabled = state.history.length === 0;
  }

  function renderStandings(app, hostId) {
    const list = $(hostId);
    if (!list) return;
    list.replaceChildren();
    core().standings(app.core).forEach((row) => {
      const li = el("li", row.winner ? "is-winner" : null);
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-score", row.money));
      li.appendChild(el("span", "standing-note", row.winner ? "◆ ahead" : ""));
      list.appendChild(li);
    });
  }

  function renderResult(app) {
    const state = app.core;
    const winner = state.outcome ? state.outcome.winner : core().leader(state);
    setText("cr-result-kicker", winner === null ? "It ends level" : "Winners");
    setText("cr-result-winner", winner === null
      ? `${state.teams[0].name} and ${state.teams[1].name} tie`
      : state.teams[winner].name);
    renderStandings(app, "cr-standings");
    $("btn-result-undo").disabled = state.history.length === 0;
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    setText("cr-source", app.source);
    $("cr-team-0").value = app.setup.teamNames[0];
    $("cr-team-1").value = app.setup.teamNames[1];
    renderRoster(app);
    renderSetupRules(app);
    $("btn-start").disabled = !app.game;
  }

  /**
   * "Keep this game" parks a game here; Resume puts it straight back. Painted
   * on every render, not only inside renderSetup, so the button disappears the
   * moment the parked game is resumed.
   */
  function renderResume(app) {
    const parked = app.resumable && !app.core ? app.resumable : null;
    show($("btn-resume"), !!parked);
    show($("cr-resume-note"), !!parked);
    $("btn-start").textContent = parked ? "Start a new game" : "Start the game";
    if (!parked) return;
    setText("cr-resume-note", `${resumeWhere(parked)} — Resume picks it up exactly where it was; `
      + "Start a new game throws it away.");
  }

  const RESUME_WHERE = {
    chain: (s) => `A game is parked on chain ${s.chainIndex + 1}`,
    chainDone: (s) => `A game is parked at the end of chain ${s.chainIndex + 1}`,
    sudden: () => "A game is parked at sudden death",
    speed: () => "A game is parked in the Speed Chain",
    result: () => "A finished game is parked",
  };

  function resumeWhere(state) {
    const build = Object.prototype.hasOwnProperty.call(RESUME_WHERE, state.phase)
      ? RESUME_WHERE[state.phase] : null;
    const where = build ? build(state) : "A game is parked";
    return `${where}, ${core().formatMoney(state, state.scores[0])} to `
      + `${state.teams[0].name} and ${core().formatMoney(state, state.scores[1])} to ${state.teams[1].name}`;
  }

  function teamButton(app, player, index) {
    const on = app.setup.assign[player.pid] === index;
    const btn = el("button", `btn btn-small gsc-btn gsc-btn-sm team-pick team-${index}`,
      app.setup.teamNames[index]);
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(on));
    if (on) btn.classList.add("is-on");
    btn.addEventListener("click", () => window.CrApp.assign(player.pid, on ? null : index));
    return btn;
  }

  function renderRoster(app) {
    const list = $("cr-roster");
    list.replaceChildren();
    app.players.forEach((player) => {
      const li = el("li", "roster-row");
      li.appendChild(el("span", "roster-name", player.name));
      const picks = el("div", "roster-picks");
      [0, 1].forEach((i) => picks.appendChild(teamButton(app, player, i)));
      li.appendChild(picks);
      list.appendChild(li);
    });
    if (!app.players.length) {
      list.appendChild(el("li", "roster-empty", "No phones connected — that is fine, the host runs it all."));
    }
    setText("cr-roster-count", app.players.length ? `${app.players.length}` : "");
  }

  function renderSetupRules(app) {
    const s = app.setup.settings;
    const values = $("cr-set-values");
    if (document.activeElement !== values) values.value = s.values.join(", ");
    setText("cr-set-values-note", `${s.values.length} chain${s.values.length === 1 ? "" : "s"} this game.`);
    setNumber("cr-set-seconds", s.speedSeconds);
    setNumber("cr-set-per-word", s.speedPerWord);
    setNumber("cr-set-all-clear", s.speedAllClear);
    $("cr-set-reveal-wrong").checked = !!s.revealOnWrong;
    const chains = app.game ? app.game.chains.length : 0;
    const speed = app.game ? app.game.speedChains.length : 0;
    const warnings = app.game ? core().warningsFor(app.game) : [];
    setText("cr-chain-count", `${chains} chains and ${speed} speed chains loaded. ${warnings.join(" ")}`.trim());
  }

  function setNumber(id, value) {
    const node = $(id);
    if (node && document.activeElement !== node) node.value = String(value);
  }

  /* ============ Whole-page render ============ */

  function render(app) {
    const wanted = app.editorOpen ? "editor" : phaseScreen(app.core);
    SCREENS.forEach((name) => show($(`screen-${name}`), !app.editorOpen && name === wanted));
    show($("screen-editor"), app.editorOpen);
    renderResume(app);
    if (app.editorOpen || !app.core) {
      show($("cr-interstitial"), false);
      if (!app.editorOpen) renderSetup(app);
      return;
    }
    if (wanted === "setup") renderSetup(app);
    if (wanted === "chain") renderChain(app);
    if (wanted === "sudden") renderSudden(app);
    if (wanted === "speed") renderSpeed(app);
    if (wanted === "result") renderResult(app);
    renderInterstitial(app);
  }

  return { render, buildRow, renderColumn, renderStandings, phaseScreen };
})();

window.CrView = CrView;
