/* ============================================================
   Press Your Luck — host rendering
   Everything that paints the host screens, split out of
   pyl-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, and dispatches
   nothing except through window.PylApp. Every string reaches the
   page through textContent — never innerHTML.

   While a spin is in the air the screens are painted from the
   state as it stood BEFORE the press (`app.spin.frozen`): the
   core has already resolved the square, but the board, the
   totals and the Whammy card must not give it away until the
   travelling light actually arrives.

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

const PylView = (function () {
  const core = () => window.PylCore;

  /** The 18 squares sit around a 7 x 4 rectangle: 2*7 + 2*4 - 4 = 18. */
  const COLS = 7;
  const ROWS = 4;

  let boardSignature = "";      // rebuild the tiles only when the board changes
  let centreNode = null;        // held directly: once inside the grid, a rebuild detaches it

  /* ============ Which screen ============ */

  const SCREENS = ["setup", "question", "board", "result"];

  function phaseScreen(state) {
    if (!state) return "setup";
    if (state.phase === "roundDone") return "board";   // the interstitial floats over it
    return SCREENS.indexOf(state.phase) >= 0 ? state.phase : "setup";
  }

  /** The state the screens paint: frozen mid-spin, live otherwise. */
  function viewState(app) {
    return app.spin ? app.spin.frozen : app.core;
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    setText("pyl-source", app.source);
    const game = app.game;
    setText("pyl-content-note", game
      ? `${game.boards.length} board(s) of 18 squares, ${game.questions.length} questions.`
      : "No board loaded yet — open the editor or load a file.");

    const count = app.setup.count;
    [0, 1, 2, 3].forEach((seat) => {
      const field = document.querySelector(`.seat-field[data-seat="${seat}"]`);
      show(field, seat < count);
      const input = $(`pyl-seat-${seat}`);
      if (input && input.value !== app.setup.names[seat]) input.value = app.setup.names[seat];
    });
    const picker = $("pyl-seat-count");
    if (picker && picker.value !== String(count)) picker.value = String(count);

    renderRoster(app);
    renderSettings(app);
    show($("btn-resume"), !!app.resumable);
    const start = $("btn-start");
    if (start) start.textContent = app.resumable ? "Start a new game" : "Start the game";
  }

  function renderSettings(app) {
    const s = app.setup.settings;
    const set = (id, value) => {
      const node = $(id);
      if (node && node.value !== String(value)) node.value = String(value);
    };
    set("pyl-set-qpr", s.questionsPerRound);
    set("pyl-set-rounds", s.rounds);
    set("pyl-set-buzz", s.buzzSpins);
    set("pyl-set-pick", s.pickSpins);
    set("pyl-set-limit", s.whammyLimit);
    const rotate = $("pyl-set-rotate");
    if (rotate) rotate.checked = !!s.rotate;
  }

  /** One row per connected phone, with a seat button each. */
  function renderRoster(app) {
    const list = $("pyl-roster");
    if (!list) return;
    list.replaceChildren();
    setText("pyl-roster-count", app.players.length ? String(app.players.length) : "");
    if (!app.players.length) {
      list.appendChild(el("li", "roster-empty", "No phones connected — the host plays every seat."));
      return;
    }
    app.players.forEach((player) => {
      const li = el("li", "roster-row");
      const name = el("span", "roster-name", player.name);
      if (!player.connected) name.classList.add("is-away");
      li.appendChild(name);
      const seats = el("span", "roster-seats");
      for (let seat = 0; seat < app.setup.count; seat += 1) {
        const btn = el("button", `seat-pick seat-${seat}`, String(seat + 1));
        btn.type = "button";
        btn.dataset.seat = String(seat);
        btn.dataset.pid = player.pid;
        const mine = app.setup.assign[player.pid] === seat;
        btn.classList.toggle("is-on", mine);
        btn.setAttribute("aria-pressed", String(mine));
        btn.setAttribute("aria-label", `Put ${player.name} in seat ${seat + 1}`);
        seats.appendChild(btn);
      }
      const clear = el("button", "seat-pick seat-none", "—");
      clear.type = "button";
      clear.dataset.seat = "none";
      clear.dataset.pid = player.pid;
      clear.setAttribute("aria-label", `Take ${player.name} out of the seats`);
      seats.appendChild(clear);
      li.appendChild(seats);
      list.appendChild(li);
    });
  }

  /* ============ Question round ============ */

  function renderQuestion(app) {
    const state = app.core;
    const question = core().currentQuestion(state);
    const settings = state.game.settings;
    setText("pyl-q-kicker",
      `Round ${state.round + 1} of ${settings.rounds} · Question ${state.qIndex + 1} of ${settings.questionsPerRound}`);
    setText("pyl-q-badge", `${settings.buzzSpins} spins to buzz in · ${settings.pickSpins} for a pick`);
    setText("pyl-q-text", question ? question.q : "");
    setText("pyl-q-notice", state.notice || " ");
    renderBuzzbar(state);
    renderOptions(state, question);
    renderPicks(state, question);
    renderQuestionButtons(state);
  }

  function renderBuzzbar(state) {
    const bar = $("pyl-buzzbar");
    if (!bar) return;
    bar.replaceChildren();
    state.players.forEach((player, seat) => {
      const li = el("li", "buzz-lamp");
      const btn = el("button", "buzz-btn");
      btn.type = "button";
      btn.dataset.seat = String(seat);
      btn.appendChild(el("span", "buzz-name", player.name));
      const held = state.spins[seat] + state.passed[seat];
      btn.appendChild(el("span", "buzz-spins", `${held} spin${held === 1 ? "" : "s"}`));
      if (state.out[seat]) {
        li.classList.add("is-out");
        btn.appendChild(el("span", "buzz-tag", "OUT"));
      } else if (state.q.buzzed === seat) {
        li.classList.add("is-buzzed");
        btn.appendChild(el("span", "buzz-tag", "IN FIRST"));
      } else if (state.q.armed) {
        li.classList.add("is-armed");
        btn.appendChild(el("span", "buzz-tag", "ready"));
      } else {
        btn.appendChild(el("span", "buzz-tag", " "));
      }
      btn.disabled = state.out[seat] || !core().buzzOpen(state) || !state.q.armed;
      li.appendChild(btn);
      bar.appendChild(li);
    });
  }

  function renderOptions(state, question) {
    const list = $("pyl-options");
    if (!list) return;
    list.replaceChildren();
    if (!question) return;
    const open = state.q.judged !== null;
    question.options.forEach((text, idx) => {
      const li = el("li", "option");
      li.appendChild(el("span", "option-letter", core().letterFor(idx)));
      li.appendChild(el("span", "option-text", open ? text : "· · ·"));
      if (state.q.revealed && idx === question.answer) {
        li.classList.add("is-answer");
        li.appendChild(el("span", "option-tag", "correct"));
      }
      if (!open) li.classList.add("is-covered");
      list.appendChild(li);
    });
  }

  /** One row per player who may pick, with the three buttons the host can use. */
  function renderPicks(state, question) {
    const list = $("pyl-picks");
    if (!list) return;
    list.replaceChildren();
    if (state.q.judged === null || !question) return;
    core().eligiblePickers(state).forEach((seat) => {
      const li = el("li", "pick-row");
      li.appendChild(el("span", "pick-name", state.players[seat].name));
      const picked = core().pickOf(state, seat);
      const group = el("span", "pick-group");
      for (let idx = 0; idx < core().OPTIONS; idx += 1) {
        const btn = el("button", "pick-btn", core().letterFor(idx));
        btn.type = "button";
        btn.dataset.seat = String(seat);
        btn.dataset.idx = String(idx);
        btn.disabled = state.q.revealed;
        btn.setAttribute("aria-pressed", String(picked === idx));
        if (picked === idx) {
          btn.classList.add("is-on");
          if (state.q.revealed) btn.classList.add(idx === question.answer ? "is-right" : "is-wrong");
        }
        btn.setAttribute("aria-label", `${state.players[seat].name} picks ${core().letterFor(idx)}`);
        group.appendChild(btn);
      }
      li.appendChild(group);
      li.appendChild(el("span", "pick-state", pickState(state, seat, picked, question)));
      list.appendChild(li);
    });
  }

  function pickState(state, seat, picked, question) {
    if (!state.q.revealed) return picked === null ? "not locked in" : "locked in";
    if (picked === null) return "no pick";
    return picked === question.answer ? "right — one spin" : "wrong";
  }

  function renderQuestionButtons(state) {
    const legal = core().legalActions(state);
    const can = (type) => legal.indexOf(type) >= 0;
    const arm = $("btn-arm");
    if (arm) {
      arm.textContent = state.q.armed ? "Close the buzzers" : "Arm the buzzers";
      arm.appendChild(kbd("A"));
      arm.disabled = !core().buzzOpen(state);
    }
    enable("btn-buzz-right", can("judgeBuzz") && state.q.buzzed !== null, "Correct", "Y");
    enable("btn-buzz-wrong", can("judgeBuzz"), state.q.buzzed === null ? "Nobody had it" : "Wrong", "N");
    enable("btn-reveal", can("revealPicks"), "Reveal the picks", "R");
    show($("btn-next-question"), can("nextQuestion"));
    show($("btn-to-board"), can("toBoard"));
    const undo = $("btn-q-undo");
    if (undo) undo.disabled = !can("undo");
  }

  function kbd(letter) {
    const node = el("kbd", "gsc-kbd", letter);
    return node;
  }

  function enable(id, on, label, key) {
    const node = $(id);
    if (!node) return;
    node.textContent = label;
    if (key) node.appendChild(kbd(key));
    node.disabled = !on;
  }

  /* ============ The Big Board ============ */

  /** Where square `index` sits on the 7 x 4 rectangle, clockwise from top-left. */
  function tilePosition(index) {
    if (index < COLS) return { row: 1, col: index + 1 };
    if (index < COLS + ROWS - 1) return { row: index - COLS + 2, col: COLS };
    if (index < COLS * 2 + ROWS - 2) return { row: ROWS, col: COLS - 1 - (index - (COLS + ROWS - 1)) };
    return { row: ROWS - 1 - (index - (COLS * 2 + ROWS - 2)), col: 1 };
  }

  function buildTiles(state) {
    const board = $("pyl-board");
    if (!board) return [];
    // Look the centre panel up BEFORE replaceChildren() detaches it — a detached
    // node is invisible to getElementById, and STOP would vanish for good.
    if (!centreNode) centreNode = $("pyl-board-center");
    board.replaceChildren();
    const nodes = core().boardTiles(state).map((tile) => {
      const node = el("div", "tile");
      const pos = tilePosition(tile.index);
      node.style.gridRow = String(pos.row);
      node.style.gridColumn = String(pos.col);
      node.dataset.index = String(tile.index);
      if (tile.whammy) node.classList.add("is-whammy");
      node.appendChild(el("span", "tile-top", tile.top));
      node.appendChild(el("span", "tile-sub", tile.sub || " "));
      node.setAttribute("aria-label", tile.sentence);
      board.appendChild(node);
      return node;
    });
    // The centre panel lives INSIDE the grid, in the hole the 18 squares leave
    // (rows 2-3, columns 2-6). It is the same node every time, so its buttons
    // keep their listeners across rebuilds.
    const centre = centreNode;
    if (centre) {
      centre.style.gridRow = `2 / ${ROWS}`;
      centre.style.gridColumn = `2 / ${COLS}`;
      board.appendChild(centre);
    }
    return nodes;
  }

  function renderBoard(app) {
    const state = viewState(app);
    const signature = `${state.round}|${state.faces.join(",")}|${state.players.length}`;
    if (signature !== boardSignature) {
      boardSignature = signature;
      // A rebuilt board after a landing (a reload, a rotation) puts the light
      // back on the square it stopped on.
      const landed = !app.spin && app.core.landing ? app.core.landing.index : undefined;
      window.PylBoard.attach(buildTiles(state), landed);
    }
    markLanding(app);
    renderCentre(app, state);
    renderTotals(state);
    setText("pyl-board-notice", state.notice || " ");
    const undo = $("btn-board-undo");
    if (undo) undo.disabled = !app.core.history.length || !!app.spin;
  }

  /** The value card and the Whammy card, only once the light has landed. */
  function markLanding(app) {
    const board = $("pyl-board");
    if (board) {
      Array.prototype.forEach.call(board.children, (node) => {
        node.classList.remove("is-hit", "is-hit-whammy");
      });
    }
    const landing = app.spin ? null : app.core.landing;
    const whammyCard = $("pyl-whammy");
    const hitCard = $("pyl-hit");
    if (!landing || app.core.phase !== "board") {
      show(whammyCard, false);
      show(hitCard, false);
      return;
    }
    const tile = board && board.querySelector(`.tile[data-index="${landing.index}"]`);
    if (tile) tile.classList.add(landing.whammy ? "is-hit-whammy" : "is-hit");
    show(whammyCard, landing.whammy);
    show(hitCard, !landing.whammy);
    if (landing.whammy) {
      setText("pyl-whammy-sub", landing.eliminated
        ? `${core().nameOf(app.core, landing.seat)} is out — ${app.core.game.settings.whammyLimit} Whammies.`
        : `${core().nameOf(app.core, landing.seat)} is back to nothing.`);
    } else {
      const currency = app.core.game.settings.currency;
      const square = landing.square;
      setText("pyl-hit-top", square.prize
        ? square.prize
        : core().formatMoney(landing.gained, currency));
      setText("pyl-hit-sub", square.prize
        ? `worth ${core().formatMoney(landing.gained, currency)}${landing.extraSpin ? " + one spin" : ""}`
        : (landing.extraSpin ? "+ ONE SPIN" : `${core().nameOf(app.core, landing.seat)} — ${core().formatMoney(landing.total, currency)}`));
    }
  }

  function renderCentre(app, state) {
    const live = app.core;
    const seat = state.control;
    setText("pyl-control-name", seat === null ? "Nobody on the board" : state.players[seat].name);
    setText("pyl-spins-left", seat === null ? " " : spinsLine(state, seat));
    const stop = $("btn-stop");
    const spinning = !!app.spin;
    const waiting = live.awaiting === "advance" && !spinning;
    if (stop) {
      stop.disabled = spinning || !core().canStop(live);
      show(stop, !waiting);
    }
    show($("btn-next-spinner"), waiting && live.phase === "board");
    setText("pyl-passed-note", seat !== null && state.passed[seat] > 0
      ? `${state.passed[seat]} of those were passed to them — they have to be used.`
      : " ");
    renderPassRow(app, live, spinning);
  }

  function spinsLine(state, seat) {
    const left = state.spins[seat] + state.passed[seat];
    return `${left} spin${left === 1 ? "" : "s"} left`;
  }

  function renderPassRow(app, live, spinning) {
    const row = $("pyl-pass");
    if (!row) return;
    row.replaceChildren();
    if (spinning) return;
    const targets = core().passTargets(live);
    if (!targets.length) return;
    row.appendChild(el("span", "pass-label", `Pass ${live.spins[live.control]} spin(s) to`));
    targets.forEach((seat) => {
      const btn = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm pass-btn",
        live.players[seat].name);
      btn.type = "button";
      btn.dataset.to = String(seat);
      row.appendChild(btn);
    });
  }

  /** Name, money, spins and one dot per Whammy — the dots read without colour. */
  function renderTotals(state) {
    const list = $("pyl-totals");
    if (!list) return;
    list.replaceChildren();
    const currency = state.game.settings.currency;
    const limit = state.game.settings.whammyLimit;
    state.players.forEach((player, seat) => {
      const li = el("li", "total-row gsc-podium");
      if (seat === state.control) li.classList.add("is-active");
      if (state.out[seat]) li.classList.add("is-out");
      li.appendChild(el("span", "total-name gsc-podium-name", player.name));
      li.appendChild(el("span", "total-money gsc-podium-score",
        core().formatMoney(state.totals[seat], currency)));
      const dots = el("span", "whammy-dots");
      dots.setAttribute("aria-label", `${state.whammies[seat]} of ${limit} Whammies`);
      for (let i = 0; i < limit; i += 1) {
        dots.appendChild(el("i", `whammy-dot${i < state.whammies[seat] ? " is-on" : ""}`));
      }
      li.appendChild(dots);
      const left = state.spins[seat] + state.passed[seat];
      li.appendChild(el("span", "total-note gsc-podium-note", state.out[seat]
        ? `out — ${state.game.settings.whammyLimit} Whammies`
        : `${left} spin${left === 1 ? "" : "s"}`));
      list.appendChild(li);
    });
  }

  /* ============ Round interstitial and the result ============ */

  function renderRoundOver(app) {
    const state = app.core;
    const open = state.phase === "roundDone";
    show($("pyl-round-over"), open);
    if (!open) return;
    const more = state.round + 1 < state.game.settings.rounds && core().alive(state).length > 0;
    setText("pyl-round-kicker", `Round ${state.round + 1} of ${state.game.settings.rounds}`);
    setText("pyl-round-title", more ? "That's the round" : "That's the game");
    setText("pyl-round-sub", more
      ? `Round ${state.round + 2} plays a bigger board — the money and the Whammies carry over.`
      : "Nothing left to play for.");
    const next = $("btn-next-round");
    if (next) next.textContent = more ? `Round ${state.round + 2}` : "Final standings";
    fillStandings($("pyl-round-standings"), state, true);
  }

  function renderResult(app) {
    const state = app.core;
    const winner = core().leader(state);
    const winners = core().standings(state).filter((row) => row.winner);
    setText("pyl-result-kicker", state.game.title);
    setText("pyl-result-winner", winners.length === 0
      ? "Everybody got Whammied"
      : (winners.length === 1
        ? `${winner.name} wins with ${winner.money}`
        : `${winners.map((w) => w.name).join(" and ")} tie on ${winner.money}`));
    fillStandings($("pyl-standings"), state, false);
    const undo = $("btn-result-undo");
    if (undo) undo.disabled = !state.history.length;
  }

  function fillStandings(list, state, small) {
    if (!list) return;
    list.replaceChildren();
    core().standings(state).forEach((row) => {
      const li = el("li", "standing-row");
      if (row.winner) li.classList.add("is-winner");
      if (row.out) li.classList.add("is-out");
      li.appendChild(el("span", "standing-name", row.winner ? `◆ ${row.name}` : row.name));
      li.appendChild(el("span", "standing-money", row.money));
      if (!small) {
        li.appendChild(el("span", "standing-note",
          row.out ? `out — ${state.game.settings.whammyLimit} Whammies` : `${row.whammies} ${row.whammies === 1 ? "Whammy" : "Whammies"}`));
      }
      list.appendChild(li);
    });
  }

  /* ============ The whole page ============ */

  function render(app) {
    const state = app.core;
    const screen = phaseScreen(state);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === screen && !app.editorOpen));
    show($("screen-editor"), app.editorOpen);
    show($("pyl-lobby-modal"), app.lobbyOpen);
    show($("btn-resume"), !!app.resumable && !state);
    // Nothing to park on setup, and mid-spin a park would skip the landing card (D5).
    const lobby = $("btn-game-lobby");
    if (lobby) lobby.disabled = !state || !!app.spin;

    if (!state || screen === "setup") {
      renderSetup(app);
      show($("pyl-round-over"), false);
      boardSignature = "";
      return;
    }
    if (screen === "question") renderQuestion(app);
    if (screen === "board") renderBoard(app);
    if (screen === "result") renderResult(app);
    renderRoundOver(app);
    if (screen !== "board") boardSignature = "";
  }

  return { render, tilePosition, viewState, buildTiles, COLS, ROWS };
})();

window.PylView = PylView;
