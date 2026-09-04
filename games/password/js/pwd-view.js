/* ============================================================
   Password — host rendering
   Everything that paints the host screens, split out of
   pwd-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, dispatches nothing
   except through window.PwdApp. Every string reaches the page
   through textContent — never innerHTML.

   THE RULE THIS FILE ENFORCES: the password only ever enters the
   host DOM when the host has explicitly asked for it (`Show
   password to me` / study mode) or once the word is over. There
   is no hidden node holding it, because a hidden node still shows
   up in a DOM-text check — and, more to the point, in a screen
   share the moment a stylesheet fails to load.

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

const PwdView = (function () {
  const core = () => window.PwdCore;

  const SCREENS = ["setup", "word", "over", "lightning", "result", "editor"];

  /** Plain words next to every colour, so colour is never the only signal. */
  const LOG_WORDS = { clue: "clue", correct: "correct", wrong: "wrong", illegal: "illegal clue" };
  const LOG_GLYPH = { clue: "•", correct: "✓", wrong: "✗", illegal: "⊘" };
  const SLOT_WORDS = { pending: "to come", got: "got it", passed: "passed" };

  function screenFor(app) {
    if (app.editorOpen) return "editor";
    const state = app.core;
    if (!state) return "setup";
    if (state.phase === "word") return "word";
    if (state.phase === "gameOver") return "over";
    if (state.phase === "lightning") return "lightning";
    if (state.phase === "result" || state.phase === "standings") return "result";
    return "setup";
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    setText("pwd-source", app.source);
    setText("pwd-player-count", app.setup.players.length ? `${app.setup.players.length}` : "");
    setText("pwd-word-count", app.game
      ? `${app.game.words.length} passwords loaded${app.setup.shuffle ? ", shuffled" : ", in file order"}.`
      : "No passwords loaded yet.");
    renderPlayerList(app);
    renderSeats(app);
    $("pwd-team-a").value = app.setup.teamNames[0];
    $("pwd-team-b").value = app.setup.teamNames[1];
    $("pwd-mode-phone").checked = app.setup.mode === "phone";
    $("pwd-mode-host").checked = app.setup.mode === "host";
    const s = app.setup.settings;
    $("pwd-set-target").value = String(s.targetScore);
    $("pwd-set-lsecs").value = String(s.lightningSeconds);
    $("pwd-set-lwords").value = String(s.lightningWords);
    $("pwd-set-lvalue").value = String(s.lightningValue);
    $("pwd-set-first").value = String(s.firstTeam);
    $("pwd-set-bonus").checked = s.allFiveBonus !== false;
    $("pwd-set-swap").checked = s.swapRoles !== false;
    const shuffle = $("btn-shuffle");
    shuffle.setAttribute("aria-pressed", String(!!app.setup.shuffle));
    shuffle.textContent = app.setup.shuffle ? "Shuffled — use file order" : "Shuffle the list";
  }

  function renderPlayerList(app) {
    const list = $("pwd-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p) => {
      const li = el("li", "player-row");
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-kind", p.manual ? "typed in" : "on a phone"));
      const drop = el("button", "btn btn-ghost btn-small", "Remove");
      drop.type = "button";
      drop.addEventListener("click", () => window.PwdApp.removePlayer(p.pid));
      li.appendChild(drop);
      list.appendChild(li);
    });
    if (!app.setup.players.length) {
      list.appendChild(el("li", "hint", "Add four players, or open a room and let phones join."));
    }
  }

  const SEAT_IDS = [["pwd-a1", "pwd-a2"], ["pwd-b1", "pwd-b2"]];

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

  /* ============ A password in play ============ */

  function renderWord(app) {
    const state = app.core;
    const r = state.round;
    if (!r) return;
    setText("pwd-play-title", `Password ${state.wordsPlayed + 1}`);
    setText("pwd-play-sub", giversLine(state));
    setText("pwd-play-game", `Game ${state.gameNo} · first to ${state.game.settings.targetScore}`);
    setText("pwd-turn-name", state.teams[r.turn].name);
    const roles = core().rolesFor(state, r.turn);
    setText("pwd-turn-roles", `${roles.giver.name} gives · ${roles.receiver.name} guesses`);
    setText("pwd-clue-count", `${r.clues} / ${state.game.settings.startValue}`);
    setText("pwd-value", String(core().value(state)));
    setText("pwd-play-state", playState(state, r));
    setText("pwd-ladder-note", state.repeating ? "The list has come round again." : "10 down to 1");
    renderLadder(state, r);
    renderPodiums(state, r);
    renderClueLog(state, r);
    renderWordNotice(app, r);
    renderWordPanel(app, r);
    renderWordControls(app, r);
  }

  function giversLine(state) {
    return [0, 1].map((t) => `${core().rolesFor(state, t).giver.name} gives for ${state.teams[t].name}`)
      .join("  ·  ");
  }

  function playState(state, r) {
    if (r.finished) {
      if (r.won !== null) return `${state.teams[r.won].name} take it for ${r.points}. Press Next word.`;
      return r.dead ? "Ten clues and nobody had it — the word is dead. Press Next word."
        : "Word over. Press Next word.";
    }
    if (r.awaitingGuess) return "Clue is out — judge the guess: Correct, Wrong or Illegal clue.";
    if (r.clues === 0) return "Waiting for the first clue.";
    return "Waiting for the next clue.";
  }

  /** Ten rungs, the one in play lit. Numbers only — never a hint. */
  function renderLadder(state, r) {
    const box = $("pwd-ladder");
    box.replaceChildren();
    const start = state.game.settings.startValue;
    const value = core().value(state);
    for (let v = start; v >= 1; v -= 1) {
      const live = !r.finished && v === value;
      const spent = v > value || (r.finished && r.won === null);
      const rung = el("div", `ladder-rung${live ? " is-live" : ""}${spent ? " is-spent" : ""}`);
      rung.appendChild(el("span", "ladder-n", String(v)));
      if (live) rung.appendChild(el("span", "visually-hidden", "worth now"));
      box.appendChild(rung);
    }
  }

  function renderPodiums(state, r) {
    const box = $("pwd-podiums");
    box.replaceChildren();
    const points = core().scores(state);
    state.teams.forEach((team, i) => {
      const active = !r.finished && r.turn === i;
      const podium = el("div", `gsc-podium${active ? " is-active" : ""}`);
      podium.appendChild(el("span", "gsc-podium-name", team.name));
      podium.appendChild(el("span", "gsc-podium-score", String(points[i])));
      const roles = core().rolesFor(state, i);
      podium.appendChild(el("span", "gsc-podium-note",
        `${roles.giver.name} gives · ${roles.receiver.name} guesses${active ? " — their clue" : ""}`));
      box.appendChild(podium);
    });
  }

  /** Every clue and judgement on this word. Carries no words, only outcomes. */
  function renderClueLog(state, r) {
    const box = $("pwd-clue-log");
    box.replaceChildren();
    if (!r.log.length) {
      box.appendChild(el("p", "hint", "No clues yet."));
      return;
    }
    const list = el("ol", "log-list");
    r.log.forEach((entry) => {
      const li = el("li", `log-row is-${entry.kind}`);
      li.appendChild(el("span", "log-team", state.teams[entry.team].name));
      li.appendChild(el("span", "log-mark", LOG_GLYPH[entry.kind] || "·"));
      li.appendChild(el("span", "log-note", LOG_WORDS[entry.kind] || ""));
      li.appendChild(el("span", "log-value", entry.kind === "correct" ? `+${entry.value}` : ""));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  /** Is the password allowed on the host screen right now? */
  function revealActive(app) {
    if (app.reveal) return true;
    return Number.isFinite(app.studyUntil) && Date.now() < app.studyUntil;
  }

  function renderWordNotice(app, r) {
    const node = $("pwd-play-notice");
    node.classList.toggle("notice-warn", revealActive(app) && !r.finished);
    if (r.finished) {
      node.textContent = `The password was “${r.word}” — ${r.clues} `
        + `${r.clues === 1 ? "clue" : "clues"} given.`;
      return;
    }
    if (revealActive(app)) {
      node.textContent = "The password is on this screen — everyone watching the share can read it.";
      return;
    }
    node.textContent = app.setup.mode === "host"
      ? "Read the password to both givers privately, or press “Show password to me”."
      : "The password is on both givers’ phones. Nothing secret is on this screen.";
  }

  /**
   * The one place a live password reaches the host DOM. Built from scratch
   * every render and removed entirely the moment the reveal is switched off.
   */
  function renderWordPanel(app, r) {
    const panel = $("pwd-word-panel");
    panel.replaceChildren();
    panel.classList.toggle("is-open", false);
    if (r.finished || !revealActive(app)) return;
    panel.classList.add("is-open");
    panel.appendChild(el("p", "word-warn", "Shared screen — the receivers must not be looking."));
    panel.appendChild(el("p", "word-now", r.word));
    if (Number.isFinite(app.studyUntil) && Date.now() < app.studyUntil) {
      const left = Math.ceil((app.studyUntil - Date.now()) / 1000);
      panel.appendChild(el("p", "word-study", `Study mode — hiding in ${left}s.`));
    }
  }

  function renderWordControls(app, r) {
    const state = app.core;
    const live = !r.finished;
    $("btn-clue").disabled = !live || r.awaitingGuess;
    ["btn-correct", "btn-wrong"].forEach((id) => { $(id).disabled = !live || !r.awaitingGuess; });
    $("btn-illegal").disabled = !live;
    $("btn-skip").disabled = !live;
    $("btn-reveal").disabled = !live;
    $("btn-reveal").setAttribute("aria-pressed", String(!!app.reveal));
    $("btn-reveal").textContent = app.reveal ? "Hide the password" : "Show password to me";
    $("btn-study").disabled = !live;
    const first = $("btn-first");
    show(first, live && r.clues === 0);
    first.textContent = `${state.teams[1 - r.turn].name} open instead`;
    $("btn-undo").disabled = !state.history.length;
    show($("btn-next-word"), r.finished);
  }

  /* ============ Game over ============ */

  function renderOver(app) {
    const state = app.core;
    const points = core().scores(state);
    const winner = state.winner === null ? 0 : state.winner;
    setText("pwd-over-team", `${state.teams[winner].name} win game ${state.gameNo}`);
    setText("pwd-over-score", `${points[0]} — ${points[1]}`);
    setText("pwd-over-sub", `${state.game.settings.lightningWords} passwords, `
      + `${state.game.settings.lightningSeconds} seconds, `
      + `${core().formatMoney(state, state.game.settings.lightningValue)} each`
      + `${state.game.settings.allFiveBonus ? " — all of them doubles it." : "."}`);
    const select = $("pwd-lightning-giver");
    const chosen = select.value;
    select.replaceChildren();
    state.teams[winner].members.forEach((m, i) => {
      const option = el("option", null, `${m.name} gives`);
      option.value = String(i);
      select.appendChild(option);
    });
    const natural = state.teams[winner].members
      .findIndex((m) => m.pid === core().rolesFor(state, winner).giver.pid);
    select.value = chosen === "0" || chosen === "1" ? chosen : String(Math.max(0, natural));
    $("btn-over-undo").disabled = !state.history.length;
  }

  /* ============ The Lightning Round ============ */

  function renderLightning(app) {
    const state = app.core;
    const l = state.lightning;
    if (!l) return;
    setText("pwd-l-title", `${state.teams[l.team].name} — Lightning Round`);
    setText("pwd-l-roles", `${l.giverName} gives · ${l.receiverName} guesses`);
    setText("pwd-l-total", core().formatMoney(state, core().lightningTotal(state)));
    const got = l.words.filter((w) => w.status === "got").length;
    setText("pwd-l-count", `${got} / ${l.words.length}`);
    setText("pwd-l-state", lightningState(l));
    renderSlots(app, l);
    renderLightningNotice(app, l);
    renderLightningPanel(app, l);
    renderLightningControls(app, l);
  }

  function lightningState(l) {
    if (l.finished) return "The Lightning Round is over — press Show the result.";
    if (l.expired) return "Time! Judge the word in flight, then it closes.";
    if (l.clock.running) return "Running.";
    if (l.started) return "Paused.";
    return "Press Start when the giver is ready.";
  }

  function renderSlots(app, l) {
    const box = $("pwd-l-slots");
    box.replaceChildren();
    const value = app.core.game.settings.lightningValue;
    l.words.forEach((w, i) => {
      const current = !l.finished && i === l.cursor;
      const slot = el("div", `l-slot is-${w.status}${current ? " is-current" : ""}`);
      slot.appendChild(el("span", "l-slot-n", String(i + 1)));
      slot.appendChild(el("span", "l-slot-value", core().formatMoney(app.core, value)));
      // The word itself only lands here once the round is over, or when the
      // host has asked to see it: a slot is a scoreboard, not a prompt.
      if (l.finished || app.lightningReveal) slot.appendChild(el("span", "l-slot-word", w.text));
      slot.appendChild(el("span", "l-slot-note",
        current ? "on this one now" : (SLOT_WORDS[w.status] || "to come")));
      box.appendChild(slot);
    });
  }

  function renderLightningNotice(app, l) {
    const node = $("pwd-l-notice");
    node.classList.toggle("notice-warn", !!app.lightningReveal && !l.finished);
    if (l.finished) {
      const out = app.core.outcome;
      node.textContent = out && out.allFive
        ? `All ${out.total} inside the time${out.doubled ? " — and that doubles the money." : "."}`
        : "Time. The team keep everything they took.";
      return;
    }
    node.textContent = app.lightningReveal
      ? "The words are on this screen — the receiver must not be looking."
      : (app.setup.mode === "host"
        ? `Read the words to ${l.giverName} privately, or press “Show words to me”.`
        : `The word is on ${l.giverName}’s phone.`);
  }

  function renderLightningPanel(app, l) {
    const panel = $("pwd-l-panel");
    panel.replaceChildren();
    panel.classList.toggle("is-open", !!app.lightningReveal && !l.finished);
    if (!app.lightningReveal || l.finished) return;
    panel.appendChild(el("p", "word-warn", "Shared screen — the receiver must not be looking."));
    panel.appendChild(el("p", "word-now", core().lightningWord(app.core) || ""));
  }

  function renderLightningControls(app, l) {
    const live = !l.finished;
    const start = $("btn-l-start");
    start.textContent = l.clock.running ? "Pause" : (l.started ? "Resume" : "Start the clock");
    start.disabled = !live || l.expired;
    const judging = live && l.started && (l.clock.running || l.expired);
    ["btn-l-got", "btn-l-pass"].forEach((id) => { $(id).disabled = !judging; });
    $("btn-l-reveal").disabled = !live;
    $("btn-l-reveal").setAttribute("aria-pressed", String(!!app.lightningReveal));
    $("btn-l-reveal").textContent = app.lightningReveal ? "Hide the words" : "Show words to me";
    $("btn-l-undo").disabled = !app.core.history.length;
    show($("btn-l-next"), l.finished);
  }

  /* ============ Result and standings ============ */

  function renderResult(app) {
    const state = app.core;
    const out = state.outcome;
    const rows = core().standings(state);
    const showing = state.phase === "standings";
    setText("pwd-result-kicker", showing ? "How the night is going"
      : (out && out.allFive ? "Every word" : "The Lightning Round"));
    setText("pwd-result-team", out ? out.teamName : "No Lightning Round played");
    setText("pwd-result-amount", core().formatMoney(state, out ? out.money : 0));
    setText("pwd-result-sub", out
      ? `${out.got} of ${out.total} passwords${out.doubled ? ", doubled for taking the lot" : ""}. `
        + "The money goes to both of them."
      : "The game ended without a Lightning Round.");
    renderStandings(state, rows);
    show($("btn-result-next"), !showing);
    $("btn-result-undo").disabled = !state.history.length;
  }

  function renderStandings(state, rows) {
    const list = $("pwd-standings");
    list.replaceChildren();
    rows.forEach((row) => {
      const li = el("li", "standing-row");
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-members", row.members.map((m) => m.name).join(" & ")));
      li.appendChild(el("span", "standing-points",
        `${row.gamesWon} ${row.gamesWon === 1 ? "game" : "games"} won`));
      li.appendChild(el("span", "standing-money", core().formatMoney(state, row.winnings)));
      list.appendChild(li);
    });
  }

  /* ============ Whole-page render ============ */

  function render(app) {
    const which = screenFor(app);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === which));
    // A screen we are leaving is never repainted, so a revealed password would
    // sit in its (hidden) panel for the rest of the night. Empty them here.
    if (which !== "word" && $("pwd-word-panel")) $("pwd-word-panel").replaceChildren();
    if (which !== "lightning" && $("pwd-l-panel")) $("pwd-l-panel").replaceChildren();
    if (which === "setup") renderSetup(app);
    if (!app.core) return;
    if (which === "word") renderWord(app);
    if (which === "over") renderOver(app);
    if (which === "lightning") renderLightning(app);
    if (which === "result") renderResult(app);
  }

  return { render, screenFor, revealActive };
})();

window.PwdView = PwdView;
