/* ============================================================
   Pyramid — host rendering
   Everything that paints the host screens, split out of
   pyr-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, dispatches nothing
   except through window.PyrApp. Every string reaches the page
   through textContent — never innerHTML.

   THE RULE THIS FILE ENFORCES: a word only ever enters the host
   DOM when the host has explicitly asked for it (`Show words to
   me` / study mode) or when the round is over. There is no
   hidden node holding the current word, because a hidden node
   still shows up in a DOM-text check — and, more to the point,
   in a screen share the moment a stylesheet fails to load.

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

const PyrView = (function () {
  const core = () => window.PyrCore;

  /** Plain words next to every colour, so colour is never the only signal. */
  const STATUS_WORDS = {
    pending: "", correct: "got it", passed: "passed", illegal: "illegal clue",
    won: "won", blocked: "blocked",
  };

  const SCREENS = ["setup", "board", "play", "circle", "result", "editor"];

  function screenFor(app) {
    if (app.editorOpen) return "editor";
    const state = app.core;
    if (!state) return "setup";
    if (state.phase === "board" || state.phase === "mainResult") return "board";
    if (state.phase === "play") return "play";
    if (state.phase === "circle") return "circle";
    if (state.phase === "result" || state.phase === "standings") return "result";
    return "setup";
  }

  /* ============ Setup ============ */

  /**
   * The Resume button and the toolbar's "Game lobby" control (docs/19 §1).
   * Resume appears on the setup screen only while a game is parked, and says
   * what it will put back so the host is never guessing.
   */
  function renderLobby(app) {
    const parked = app.resumable;
    show($("btn-resume"), !!parked);
    const note = $("pyr-resume-note");
    show(note, !!parked);
    if (parked && window.PyrApp.gameLabel) {
      note.textContent = `A game is waiting on ${window.PyrApp.gameLabel(parked)} — the clock is paused.`;
    }
    const back = $("btn-game-lobby");
    // Nothing to leave and nothing to resume: the host is already on setup.
    if (back) back.disabled = !app.core && !parked;
  }

  function renderSetup(app) {
    setText("pyr-source", app.source);
    setText("pyr-player-count", app.setup.players.length ? `${app.setup.players.length}` : "");
    setText("pyr-category-count", app.game
      ? `${app.game.categories.length} categories and ${app.game.circles.length} Winner’s Circle sets loaded.`
      : "No categories loaded yet.");
    renderPlayerList(app);
    renderSeats(app);
    $("pyr-team-a").value = app.setup.teamNames[0];
    $("pyr-team-b").value = app.setup.teamNames[1];
    $("pyr-mode-phone").checked = app.setup.mode === "phone";
    $("pyr-mode-host").checked = app.setup.mode === "host";
    $("pyr-set-catsecs").value = String(app.setup.settings.categorySeconds);
    $("pyr-set-circlesecs").value = String(app.setup.settings.circleSeconds);
    $("pyr-set-perteam").value = String(app.setup.settings.categoriesPerTeam);
    $("pyr-set-swap").checked = app.setup.settings.swapRoles !== false;
  }

  function renderPlayerList(app) {
    const list = $("pyr-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p) => {
      const li = el("li", "player-row");
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-kind", p.manual ? "typed in" : "on a phone"));
      const drop = el("button", "btn btn-ghost btn-small", "Remove");
      drop.type = "button";
      drop.addEventListener("click", () => window.PyrApp.removePlayer(p.pid));
      li.appendChild(drop);
      list.appendChild(li);
    });
    if (!app.setup.players.length) list.appendChild(el("li", "hint", "Add four players, or open a room and let phones join."));
  }

  const SEAT_IDS = [["pyr-a1", "pyr-a2"], ["pyr-b1", "pyr-b2"]];

  function renderSeats(app) {
    SEAT_IDS.forEach((ids, team) => ids.forEach((id, seat) => {
      const select = $(id);
      const chosen = app.setup.seats[team][seat];
      select.replaceChildren();
      const blank = el("option", null, "— nobody —");
      blank.value = "";
      select.appendChild(blank);
      app.setup.players.forEach((p) => {
        const option = el("option", null, p.name);
        option.value = p.pid;
        select.appendChild(option);
      });
      select.value = chosen && app.setup.players.some((p) => p.pid === chosen) ? chosen : "";
    }));
  }

  /* ============ The pyramid board ============ */

  const ROWS = [[0], [1, 2], [3, 4, 5]];

  function renderBoard(app) {
    const state = app.core;
    const box = $("pyr-board");
    box.replaceChildren();
    ROWS.forEach((row) => {
      const line = el("div", "pyramid-row");
      row.forEach((i) => { if (state.board[i]) line.appendChild(boardCard(state, i)); });
      box.appendChild(line);
    });
    renderPodiums(state);
    renderBoardBanner(app);
    renderMainResult(app);
    show($("btn-board-undo"), state.history.length > 0);
  }

  function boardCard(state, index) {
    const slot = state.board[index];
    const taken = slot.team !== null;
    const card = el("button", `pyr-card${taken ? " is-taken" : ""}`);
    card.type = "button";
    card.dataset.index = String(index);
    card.disabled = taken || state.phase !== "board";
    card.appendChild(el("span", "pyr-card-title", slot.title));
    if (taken) {
      card.appendChild(el("span", "pyr-card-score", `${slot.correct}`));
      card.appendChild(el("span", "pyr-card-team", state.teams[slot.team].name));
    } else {
      card.appendChild(el("span", "pyr-card-hint", "Pick this"));
    }
    card.addEventListener("click", () => window.PyrApp.pick(index));
    return card;
  }

  function renderPodiums(state) {
    const box = $("pyr-podiums");
    box.replaceChildren();
    const points = core().scores(state);
    state.teams.forEach((team, i) => {
      const active = state.phase === "board" && state.turn === i;
      const podium = el("div", `gsc-podium${active ? " is-active" : ""}`);
      podium.appendChild(el("span", "gsc-podium-name", team.name));
      podium.appendChild(el("span", "gsc-podium-score", String(points[i])));
      podium.appendChild(el("span", "gsc-podium-note",
        team.members.map((m) => m.name).join(" & ")));
      box.appendChild(podium);
    });
  }

  function renderBoardBanner(app) {
    const state = app.core;
    if (state.phase === "mainResult") {
      setText("pyr-board-title", "The main game is over");
      setText("pyr-board-sub", core().scores(state).map((p, i) => `${state.teams[i].name} ${p}`).join("  ·  "));
      return;
    }
    setText("pyr-board-title", `${state.teams[state.turn].name} — pick a category`);
    const left = state.board.filter((s) => s.team === null).length;
    setText("pyr-board-sub", `${left} ${left === 1 ? "category" : "categories"} left on the board`);
  }

  function renderMainResult(app) {
    const state = app.core;
    const panel = $("pyr-mainresult");
    show(panel, state.phase === "mainResult");
    if (state.phase !== "mainResult") return;
    const winner = core().leader(state);
    const level = winner === null;
    const canTiebreak = level && !state.tiebreakPlayed && !!state.tiebreakCat;
    setText("pyr-mainresult-text", level
      ? (canTiebreak
        ? "Level. One tiebreak category, one word each."
        : "Still level — pick the team that goes up.")
      : `${state.teams[winner].name} take it to the Winner’s Circle.`);
    show($("btn-tiebreak"), canTiebreak);
    [0, 1].forEach((i) => {
      const btn = $(i === 0 ? "btn-to-circle-a" : "btn-to-circle-b");
      btn.textContent = `${state.teams[i].name} to the Winner’s Circle`;
      show(btn, !canTiebreak && (level || winner === i));
    });
  }

  /* ============ Category play ============ */

  function renderPlay(app) {
    const state = app.core;
    const r = state.round;
    if (!r) return;
    setText("pyr-play-category", r.title);
    setText("pyr-play-roles", `${r.giverName} gives · ${r.guesserName} guesses`);
    setText("pyr-play-team", r.tiebreak ? "Tiebreak" : state.teams[r.team].name);
    const count = core().wordCount(state);
    setText("pyr-count", `${count.done} / ${count.total}`);
    setText("pyr-play-state", playState(r));
    renderPlayNotice(app, r);
    renderPips(app, r);
    renderWordPanel(app, r);
    renderResults(app, r);
    renderPlayControls(app, r);
  }

  function playState(r) {
    if (r.finished) return "Round over — press Next.";
    if (r.expired) return "Time! Judge the word in flight, then the round closes.";
    if (r.clock.running) return "Running.";
    if (r.started) return "Paused.";
    return "Press Start when the giver is ready.";
  }

  function renderPlayNotice(app, r) {
    const node = $("pyr-play-notice");
    if (r.finished) {
      node.textContent = `${core().wordCount(app.core).done} of ${r.words.length} taken.`;
      node.classList.remove("notice-warn");
      return;
    }
    if (revealActive(app)) {
      node.textContent = "The words are on this screen — everyone watching the share can read them.";
      node.classList.add("notice-warn");
      return;
    }
    node.classList.remove("notice-warn");
    node.textContent = app.setup.mode === "host"
      ? `Read the list to ${r.giverName} privately, or press “Show words to me”.`
      : `The word is on ${r.giverName}’s phone. Nothing secret is on this screen.`;
  }

  /**
   * One pip per word: its place in the list and how it ended. No text, so this
   * strip is safe on a shared screen while the round is still running.
   */
  function renderPips(app, r) {
    const box = $("pyr-pips");
    box.replaceChildren();
    r.words.forEach((w, i) => {
      const current = !r.finished && i === r.cursor;
      const pip = el("div", `word-pip is-${w.status}${current ? " is-current" : ""}`);
      pip.appendChild(el("span", "word-pip-n", String(i + 1)));
      pip.appendChild(el("span", "word-pip-mark", current ? "●" : (MARK_GLYPH[w.status] || "·")));
      pip.appendChild(el("span", "visually-hidden", STATUS_WORDS[w.status] || (current ? "in play now" : "still to come")));
      box.appendChild(pip);
    });
  }

  /** Is a word allowed on the host screen right now? */
  function revealActive(app) {
    if (app.reveal) return true;
    return Number.isFinite(app.studyUntil) && Date.now() < app.studyUntil;
  }

  /**
   * The one place a live word reaches the host DOM. Built from scratch every
   * render and removed entirely the moment the reveal is switched off.
   */
  function renderWordPanel(app, r) {
    const panel = $("pyr-word-panel");
    panel.replaceChildren();
    panel.classList.toggle("is-open", false);
    if (r.finished || !revealActive(app)) return;
    panel.classList.add("is-open");
    panel.appendChild(el("p", "word-warn", "Shared screen — the guesser must not be looking."));
    if (r.hint) panel.appendChild(el("p", "word-hint", r.hint));
    panel.appendChild(el("p", "word-now", core().currentWord(app.core) || ""));
    const list = el("ol", "word-queue");
    core().remainingWords(app.core).slice(1).forEach((w) => list.appendChild(el("li", null, w.text)));
    panel.appendChild(list);
    if (Number.isFinite(app.studyUntil) && Date.now() < app.studyUntil) {
      const left = Math.ceil((app.studyUntil - Date.now()) / 1000);
      panel.appendChild(el("p", "word-study", `Study mode — hiding in ${left}s.`));
    }
  }

  /** After the round the whole list is public: it is how the room checks the score. */
  function renderResults(app, r) {
    const box = $("pyr-results");
    box.replaceChildren();
    if (!r.finished) return;
    const list = el("ol", "results-list");
    r.words.forEach((w) => {
      const li = el("li", `result-row is-${w.status}`);
      li.appendChild(el("span", "result-mark", MARK_GLYPH[w.status] || "·"));
      li.appendChild(el("span", "result-word", w.text));
      li.appendChild(el("span", "result-note", STATUS_WORDS[w.status] || "not reached"));
      list.appendChild(li);
    });
    box.appendChild(list);
    if (r.tiebreak) {
      box.appendChild(el("p", "results-total",
        r.tbWinner === null
          ? "Still level — the host picks who goes up."
          : `${app.core.teams[r.tbWinner].name} take the tiebreak.`));
    }
  }

  const MARK_GLYPH = { correct: "✓", passed: "→", illegal: "✗", pending: "·" };

  function renderPlayControls(app, r) {
    const live = !r.finished;
    const canMark = live && r.started;
    $("btn-clock-start").textContent = r.clock.running ? "Pause" : (r.started ? "Resume" : "Start the clock");
    $("btn-clock-start").disabled = !live || r.expired;
    ["btn-correct", "btn-pass", "btn-illegal"].forEach((id) => { $(id).disabled = !canMark; });
    $("btn-reveal-words").disabled = !live;
    $("btn-reveal-words").setAttribute("aria-pressed", String(!!app.reveal));
    $("btn-reveal-words").textContent = app.reveal ? "Hide the words" : "Show words to me";
    $("btn-study").disabled = !live;
    $("btn-undo").disabled = !app.core.history.length;
    show($("btn-next"), r.finished);
  }

  /* ============ Winner's Circle ============ */

  const CIRCLE_ROWS = [[5], [3, 4], [0, 1, 2]];

  function renderCircle(app) {
    const state = app.core;
    const c = state.circle;
    if (!c) return;
    setText("pyr-circle-title", `${state.teams[c.team].name} in the Winner’s Circle`);
    setText("pyr-circle-roles", `${c.giverName} gives examples · ${c.guesserName} names the subject`);
    setText("pyr-circle-total", core().formatMoney(state, core().circleWinnings(state)));
    const won = c.boxes.filter((b) => b.status === "won").length;
    setText("pyr-circle-count", `${won} / ${c.boxes.length}`);
    setText("pyr-circle-state", circleState(c));
    renderCircleBoxes(app, c);
    renderCircleNotice(app, c);
    renderCirclePanel(app, c);
    renderCircleControls(app, c);
  }

  function circleState(c) {
    if (c.finished) return "The circle is over — press Next.";
    if (c.expired) return "Time! Judge the subject in flight, then it closes.";
    if (c.clock.running) return "Running.";
    if (c.started) return "Paused.";
    return "Press Start when the giver is ready.";
  }

  function renderCircleBoxes(app, c) {
    const box = $("pyr-circle-boxes");
    box.replaceChildren();
    CIRCLE_ROWS.forEach((row) => {
      const line = el("div", "circle-row");
      row.forEach((i) => line.appendChild(circleBox(app, c, i)));
      box.appendChild(line);
    });
  }

  function circleBox(app, c, i) {
    const data = c.boxes[i];
    const current = !c.finished && c.cursor === i;
    const node = el("div", `circle-box is-${data.status}${current ? " is-current" : ""}`);
    node.appendChild(el("span", "circle-box-value", core().formatMoney(app.core, data.value)));
    // The subject is the ANSWER. It reaches this screen only on request.
    if (app.circleReveal || c.finished) node.appendChild(el("span", "circle-box-cat", data.category));
    node.appendChild(el("span", "circle-box-note",
      current ? "on this one now" : (STATUS_WORDS[data.status] || "to come")));
    return node;
  }

  function renderCircleNotice(app, c) {
    const node = $("pyr-circle-notice");
    node.classList.toggle("notice-warn", !!app.circleReveal && !c.finished);
    if (c.finished) {
      node.textContent = c.boxes.every((b) => b.status === "won")
        ? "All six — the grand prize."
        : "Time. The team keep everything they won.";
      return;
    }
    node.textContent = app.circleReveal
      ? "The subjects are on this screen — the guesser must not be looking."
      : (app.setup.mode === "host"
        ? `Read the subject to ${c.giverName} privately, or press “Show subjects to me”.`
        : `The subject is on ${c.giverName}’s phone.`);
  }

  function renderCirclePanel(app, c) {
    const panel = $("pyr-circle-panel");
    panel.replaceChildren();
    panel.classList.toggle("is-open", !!app.circleReveal && !c.finished);
    if (!app.circleReveal || c.finished) return;
    const current = c.boxes[c.cursor];
    panel.appendChild(el("p", "word-warn", "Shared screen — the guesser must not be looking."));
    panel.appendChild(el("p", "word-now", current ? current.category : ""));
  }

  function renderCircleControls(app, c) {
    const live = !c.finished;
    $("btn-circle-start").textContent = c.clock.running ? "Pause" : (c.started ? "Resume" : "Start the clock");
    $("btn-circle-start").disabled = !live || c.expired;
    ["btn-circle-correct", "btn-circle-pass", "btn-circle-illegal"]
      .forEach((id) => { $(id).disabled = !(live && c.started); });
    $("btn-circle-reveal").disabled = !live;
    $("btn-circle-reveal").setAttribute("aria-pressed", String(!!app.circleReveal));
    $("btn-circle-reveal").textContent = app.circleReveal ? "Hide the subjects" : "Show subjects to me";
    $("btn-circle-undo").disabled = !app.core.history.length;
    show($("btn-circle-next"), c.finished);
  }

  /* ============ Result and standings ============ */

  function renderResult(app) {
    const state = app.core;
    const out = state.outcome;
    const standings = core().standings(state);
    const showing = state.phase === "standings";
    setText("pyr-result-kicker", showing ? "How the night went" : (out && out.cleared ? "All six" : "The Winner’s Circle"));
    setText("pyr-result-team", out ? out.teamName : "No Winner’s Circle played");
    setText("pyr-result-amount", out
      ? (out.cleared ? state.game.settings.grandPrizeLabel : core().formatMoney(state, out.winnings))
      : core().formatMoney(state, 0));
    setText("pyr-result-sub", out
      ? (out.cleared
        ? "Six subjects inside the minute — the grand prize, split between both of them."
        : `${out.boxesWon} of 6 subjects. The money goes to both of them.`)
      : "");
    const list = $("pyr-standings");
    list.replaceChildren();
    standings.forEach((row) => {
      const li = el("li", "standing-row");
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-members", row.members.map((m) => m.name).join(" & ")));
      li.appendChild(el("span", "standing-points", `${row.points} pts`));
      li.appendChild(el("span", "standing-money", core().formatMoney(state, row.winnings)));
      list.appendChild(li);
    });
    show($("btn-result-next"), !showing);
    show($("btn-play-again"), showing);
    $("btn-result-undo").disabled = !state.history.length;
  }

  /* ============ Whole-page render ============ */

  function render(app) {
    const which = screenFor(app);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === which));
    renderLobby(app);
    if (which === "setup") renderSetup(app);
    if (!app.core) return;
    if (which === "board") renderBoard(app);
    if (which === "play") renderPlay(app);
    if (which === "circle") renderCircle(app);
    if (which === "result") renderResult(app);
  }

  return { render, screenFor, revealActive, renderLobby, ROWS, CIRCLE_ROWS };
})();

window.PyrView = PyrView;
