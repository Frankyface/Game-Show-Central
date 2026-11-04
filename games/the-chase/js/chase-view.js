/* ============================================================
   The Chase — host rendering
   Everything that paints the host screens, split out of
   chase-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, dispatches nothing
   except through window.ChaseApp. Every string reaches the page
   through textContent — never innerHTML.

   THE RULE THIS FILE ENFORCES: a locked answer is a lamp, not a
   letter. Until the host reveals a side, the only thing on the
   shared screen is "Locked in" — the chosen option never enters
   the DOM, not even in a hidden node, because a hidden node
   still shows up in a DOM-text check and in a screen share the
   moment a stylesheet fails to load.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the app, board, editor, room and phone
   glue use the same four.
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

const ChaseView = (function () {
  const core = () => window.ChaseCore;
  const SCREENS = ["setup", "cash", "offer", "board", "final", "result", "editor"];
  const LETTERS = ["A", "B", "C"];

  function screenFor(app) {
    if (app.editorOpen) return "editor";
    const state = app.core;
    if (!state) return "setup";
    if (state.phase === "cashBuilder") return "cash";
    if (state.phase === "offer") return "offer";
    if (state.phase === "headToHead") return "board";
    if (state.phase === "finalTeam" || state.phase === "finalChaser") return "final";
    if (state.phase === "result" || state.phase === "standings") return "result";
    return "setup";
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    const s = app.setup;
    setText("chase-source", app.source);
    setText("chase-player-count", s.players.length ? `${s.players.length}` : "");
    setText("chase-question-count", app.game
      ? `${app.game.rapid.length} rapid-fire and ${app.game.multi.length} head-to-head questions`
        + `${s.shuffle ? ", shuffled" : ", in file order"}.`
      : "No questions loaded yet.");
    renderPlayerList(app);
    renderChaserPicker(app);
    $("chase-mode-host").checked = s.chaserMode !== "player";
    $("chase-mode-player").checked = s.chaserMode === "player";
    $("chase-chaser-name").value = s.chaserName;
    $("chase-chaser-pid").disabled = s.chaserMode !== "player";
    renderRuleFields(s.settings);
    const shuffle = $("btn-shuffle");
    shuffle.setAttribute("aria-pressed", String(!!s.shuffle));
    shuffle.textContent = s.shuffle ? "Shuffled — use file order" : "Shuffle the questions";
    show($("btn-resume"), !!app.resumable);
  }

  const RULE_FIELDS = [
    ["chase-set-steps", "steps"], ["chase-set-start", "startStep"],
    ["chase-set-cbsecs", "cashBuilderSeconds"], ["chase-set-cbvalue", "cashBuilderValue"],
    ["chase-set-higher", "higherMultiplier"], ["chase-set-lower", "lowerDivisor"],
    ["chase-set-final", "finalSeconds"], ["chase-set-headstart", "headStartPerMember"],
  ];

  function renderRuleFields(settings) {
    RULE_FIELDS.forEach(([id, key]) => { $(id).value = String(settings[key]); });
  }

  function renderPlayerList(app) {
    const list = $("chase-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p, i) => {
      const li = el("li", "player-row");
      li.appendChild(el("span", "player-seat", `${i + 1}`));
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-kind", p.manual ? "typed in" : "on a phone"));
      li.appendChild(moveButton("Up", i, -1, i === 0));
      li.appendChild(moveButton("Down", i, 1, i === app.setup.players.length - 1));
      const drop = el("button", "btn btn-ghost btn-small", "Remove");
      drop.type = "button";
      drop.addEventListener("click", () => window.ChaseApp.removePlayer(p.pid));
      li.appendChild(drop);
      list.appendChild(li);
    });
    if (!app.setup.players.length) {
      list.appendChild(el("li", "hint", "Add up to four contestants, or open a room and let phones join."));
    }
  }

  function moveButton(label, index, delta, disabled) {
    const btn = el("button", "btn btn-ghost btn-small", label);
    btn.type = "button";
    btn.disabled = !!disabled;
    btn.addEventListener("click", () => window.ChaseApp.movePlayer(index, delta));
    return btn;
  }

  function renderChaserPicker(app) {
    const select = $("chase-chaser-pid");
    const chosen = app.setup.chaserPid;
    select.replaceChildren();
    const blank = el("option", null, "— pick a player —");
    blank.value = "";
    select.appendChild(blank);
    app.setup.players.forEach((p) => {
      const option = el("option", null, p.name);
      option.value = p.pid;
      select.appendChild(option);
    });
    select.value = chosen && app.setup.players.some((p) => p.pid === chosen) ? chosen : "";
  }

  /* ============ Cash Builder ============ */

  function renderCash(app) {
    const state = app.core;
    const cb = state.cb;
    if (!cb) return;
    const who = core().hotSeat(state);
    setText("chase-cash-title", `Cash Builder — ${who ? who.name : ""}`);
    setText("chase-cash-sub", cashSub(state, cb));
    setText("chase-cash-seat", `Contestant ${state.seat + 1} of ${state.contestants.length}`);
    setText("chase-cash-total", core().formatMoney(state, core().cashTotal(state)));
    setText("chase-cash-right", cb.correct);
    setText("chase-cash-wrong", cb.wrong);
    setText("chase-cash-passed", cb.passed);
    setText("chase-cash-q", cb.item ? cb.item.q : (cb.finished ? "That is the Cash Builder." : ""));
    setText("chase-cash-a", cb.item ? cb.item.a : "");
    setText("chase-cash-state", cashState(state, cb));
    setText("chase-cash-notice", state.repeating
      ? "The question list has come all the way round — these have been asked already." : "");
    renderCashControls(state, cb);
  }

  function cashSub(state, cb) {
    const value = core().formatMoney(state, state.game.settings.cashBuilderValue);
    return cb.finished
      ? "Cash Builder over — take the offers."
      : `${value} a time. The host reads, the contestant answers out loud.`;
  }

  function cashState(state, cb) {
    if (cb.finished) return "Banked. Press “On to the offers”.";
    if (cb.expired) return "Buzzer — judge the question in flight, or wave it away.";
    if (cb.clock.running) return "Running.";
    return cb.started ? "Paused." : "Press Start when the contestant is ready.";
  }

  function renderCashControls(state, cb) {
    const judging = !cb.finished && (cb.clock.running || cb.expired);
    ["btn-cash-right", "btn-cash-wrong", "btn-cash-pass"].forEach((id) => { $(id).disabled = !judging; });
    const clock = $("btn-cash-clock");
    clock.disabled = cb.finished || cb.expired;
    clock.textContent = cb.clock.running ? "Pause the clock" : (cb.started ? "Resume the clock" : "Start the clock");
    clock.appendChild(kbd("Enter"));
    $("btn-cash-undo").disabled = !state.history.length;
    show($("btn-cash-next"), cb.finished || cb.expired);
    $("btn-cash-next").textContent = cb.finished ? "On to the offers" : "End the Cash Builder";
    $("btn-cash-next").appendChild(kbd("N"));
  }

  function kbd(key) {
    return el("kbd", "gsc-kbd", key);
  }

  /* ============ The offers ============ */

  function renderOffer(app) {
    const state = app.core;
    const who = core().hotSeat(state);
    const o = core().offers(state);
    setText("chase-offer-title", `${who ? who.name : ""} — pick an offer`);
    setText("chase-offer-sub", `${state.chaser.name} sets the terms. Higher means starting closer to him.`);
    setText("chase-offer-built", `Built ${core().formatMoney(state, state.results[state.seat].cash)}`);
    [["higher", o.higher], ["middle", o.middle], ["lower", o.lower]].forEach(([key, offer]) => {
      setText(`chase-offer-${key}-amount`, core().formatMoney(state, offer.amount));
      setText(`chase-offer-${key}-step`, `${offer.step} ${offer.step === 1 ? "step" : "steps"} from home`);
    });
    setText("chase-offer-notice",
      state.results[state.seat].cash === 0
        ? "Nothing built, so the offers are worked out from one Cash Builder answer." : "");
    $("btn-offer-undo").disabled = !state.history.length;
  }

  /* ============ Head to head ============ */

  function renderBoard(app) {
    const state = app.core;
    const h = state.h2h;
    if (!h) return;
    const who = core().hotSeat(state);
    setText("chase-board-title", `${who ? who.name : ""} v ${state.chaser.name}`);
    setText("chase-board-sub", boardSub(state, h));
    setText("chase-board-amount", core().formatMoney(state, h.amount));
    window.ChaseBoard.render($("chase-board"), core().board(state));
    setText("chase-board-gap", window.ChaseBoard.describe(core().board(state)));
    setText("chase-q", h.q ? h.q.q : "");
    renderOptions(state, h);
    renderLocks(app, state, h);
    renderSeatStrip(state);
    renderInterstitial(state, h);
    setText("chase-board-notice", state.repeating
      ? "The head-to-head list has come round again — these have been asked already." : "");
    renderBoardControls(state, h);
  }

  function boardSub(state, h) {
    if (h.outcome === "caught") return "Caught.";
    if (h.outcome === "home") return "Home — and the money is banked.";
    if (h.revealed.contestant && h.revealed.chaser) return "Both shown — on to the next question.";
    if (h.revealed.contestant && !h.revealed.chaser) return `Now ${state.chaser.name}.`;
    if (h.locks.contestant !== null && h.locks.chaser !== null) return "Both locked. Reveal the contestant.";
    return "Both sides lock in secret. Nothing shows until the reveal.";
  }

  function renderOptions(state, h) {
    const list = $("chase-options");
    list.replaceChildren();
    if (!h.q) return;
    const shown = core().bothRevealed(state) || !!h.outcome;
    h.q.options.forEach((text, i) => {
      const li = el("li", "option");
      li.appendChild(el("span", "option-letter", LETTERS[i]));
      li.appendChild(el("span", "option-text", text));
      if (shown) decorateOption(li, state, h, i);
      list.appendChild(li);
    });
  }

  /** Only ever called once both sides are shown: nothing here is a secret. */
  function decorateOption(li, state, h, i) {
    const tags = el("span", "option-tags");
    if (i === h.q.answer) {
      li.classList.add("is-right");
      tags.appendChild(el("span", "tag tag-right", "Right answer"));
    }
    if (h.locks.contestant === i) tags.appendChild(el("span", "tag tag-c", core().hotSeat(state).name));
    if (h.locks.chaser === i) tags.appendChild(el("span", "tag tag-h", state.chaser.name));
    li.appendChild(tags);
  }

  function renderLocks(app, state, h) {
    setText("chase-chaser-label", state.chaser.name);
    setText("chase-lock-contestant", lockText(state, h, "contestant"));
    setText("chase-lock-chaser", lockText(state, h, "chaser"));
    lockButtons($("chase-lock-c-buttons"), state, h, "contestant", true);
    lockButtons($("chase-lock-h-buttons"), state, h, "chaser", state.chaser.isHost);
    $("chase-lock-contestant").className = `lock-state${h.locks.contestant !== null ? " is-locked" : ""}`;
    $("chase-lock-chaser").className = `lock-state${h.locks.chaser !== null ? " is-locked" : ""}`;
    void app;
  }

  function lockText(state, h, side) {
    if (h.revealed[side]) {
      const letter = core().revealedLetter(state, side);
      const right = h.locks[side] === h.q.answer;
      return `${letter} — ${right ? "correct" : "wrong"}`;
    }
    if (h.locks[side] !== null) return "Locked in";
    if (side === "chaser" && !state.chaser.isHost) return `Waiting for ${state.chaser.name}…`;
    return "Not locked";
  }

  /**
   * The host's A / B / C for one side. They vanish the moment that side has
   * locked, so the shared screen never shows which one was pressed; Undo is how
   * the host takes a mis-press back.
   */
  function lockButtons(box, state, h, side, allowed) {
    box.replaceChildren();
    if (!allowed || !h.q || h.outcome || h.revealed[side] || h.locks[side] !== null) return;
    LETTERS.forEach((letter, i) => {
      const btn = el("button", "btn btn-lock", letter);
      btn.type = "button";
      btn.setAttribute("aria-label", `Lock ${letter} for the ${side === "chaser" ? "Chaser" : "contestant"}`);
      btn.addEventListener("click", () => window.ChaseApp.lock(side, i));
      box.appendChild(btn);
    });
  }

  function renderSeatStrip(state) {
    const box = $("chase-seats");
    box.replaceChildren();
    state.results.forEach((row, i) => {
      const chip = el("div", `seat-chip is-${row.outcome}${i === state.seat ? " is-current" : ""}`);
      chip.appendChild(el("span", "seat-name", row.name));
      chip.appendChild(el("span", "seat-note", seatNote(state, row, i)));
      box.appendChild(chip);
    });
  }

  function seatNote(state, row, i) {
    if (row.outcome === "home") return `home · ${core().formatMoney(state, row.amount)}`;
    if (row.outcome === "caught") return "caught";
    return i === state.seat ? "in the hot seat" : "to come";
  }

  function renderInterstitial(state, h) {
    const box = $("chase-interstitial");
    show(box, !!h.outcome);
    if (!h.outcome) return;
    const who = core().hotSeat(state);
    const home = h.outcome === "home";
    box.className = `interstitial is-${h.outcome}`;
    setText("chase-inter-kicker", home ? "Home" : "Caught");
    setText("chase-inter-name", who ? who.name : "");
    setText("chase-inter-sub", home
      ? `${core().formatMoney(state, h.amount)} into the bank, and a place in the Final Chase.`
      : `${state.chaser.name} caught them on step ${h.cPos}. Nothing banked.`);
  }

  function renderBoardControls(state, h) {
    const live = !h.outcome && !!h.q;
    const revealC = $("btn-reveal-contestant");
    const revealH = $("btn-reveal-chaser");
    show(revealC, live && !h.revealed.contestant);
    show(revealH, live && h.revealed.contestant && !h.revealed.chaser);
    revealC.disabled = h.locks.contestant === null;
    revealH.disabled = h.locks.chaser === null;
    show($("btn-board-next"), live && core().bothRevealed(state));
    show($("btn-next-contestant"), !!h.outcome);
    $("btn-next-contestant").textContent = state.seat + 1 < state.contestants.length
      ? "Next contestant" : "On to the Final Chase";
    $("btn-next-contestant").appendChild(kbd("N"));
    $("btn-board-undo").disabled = !state.history.length;
  }

  /* ============ The Final Chase ============ */

  function renderFinal(app) {
    const state = app.core;
    const f = state.final;
    if (!f) return;
    const team = state.phase === "finalTeam";
    setText("chase-final-title", team ? "Final Chase — the team" : `Final Chase — ${state.chaser.name}`);
    setText("chase-final-sub", finalSub(state, f, team));
    setText("chase-final-bank", `Bank ${core().formatMoney(state, core().bank(state))}`);
    setText("chase-final-state", finalState(state, f, team));
    setText("chase-final-chaser-label", state.chaser.name);
    setText("chase-team-steps", f.teamSteps);
    setText("chase-chaser-steps", f.chaserSteps);
    const span = Math.max(f.teamSteps, f.chaserSteps, 1);
    window.ChaseBoard.pips($("chase-team-track"), f.teamSteps, span, "pip-team");
    window.ChaseBoard.pips($("chase-chaser-track"), f.chaserSteps, span, "pip-chaser");
    renderFinalQuestion(state, f, team);
    renderFinalControls(state, f, team);
  }

  function finalSub(state, f, team) {
    if (team) {
      const names = f.finalists.map((x) => x.name).join(" & ");
      return `${names} — head start of ${f.headStart}. One step per correct answer.`;
    }
    return `${state.chaser.name} needs ${Math.max(0, f.teamSteps - f.chaserSteps)} to catch them. `
      + "Every miss goes to the team.";
  }

  function finalState(state, f, team) {
    const clock = team ? f.teamClock : f.chaserClock;
    const started = team ? f.teamStarted : f.chaserStarted;
    if (team && f.teamFinished) return "Time. Bring on the Chaser.";
    if (!team && f.pushback && f.chaserSteps === 0) {
      return "Pushback — clock stopped. He is still on the start line, so a right answer cannot move him back.";
    }
    if (!team && f.pushback) return "Pushback — clock stopped. A right answer moves him back a step.";
    if (clock.running) return "Running.";
    return started ? "Paused." : "Press Start when everyone is ready.";
  }

  function renderFinalQuestion(state, f, team) {
    const asking = team ? (!f.teamFinished && f.teamStarted) : !f.chaserFinished;
    setText("chase-final-q", asking && f.item ? f.item.q : "");
    setText("chase-final-a", asking && f.item ? f.item.a : "");
    setText("chase-final-notice", state.repeating
      ? "The rapid-fire list has come round again — these have been asked already." : "");
    show($("chase-pushback"), !team && !!f.pushback);
  }

  function renderFinalControls(state, f, team) {
    const clock = team ? f.teamClock : f.chaserClock;
    const started = team ? f.teamStarted : f.chaserStarted;
    const finished = team ? f.teamFinished : f.chaserFinished;
    const judging = !finished && clock.running && !(!team && f.pushback);
    ["btn-final-right", "btn-final-wrong", "btn-final-pass"].forEach((id) => { $(id).disabled = !judging; });
    $("btn-final-wrong").textContent = team ? "Wrong" : "Wrong — offer it to the team";
    $("btn-final-wrong").appendChild(kbd("W"));
    const btn = $("btn-final-clock");
    btn.disabled = finished;
    btn.textContent = clock.running ? "Pause the clock" : (started ? "Resume the clock" : "Start the clock");
    btn.appendChild(kbd("Enter"));
    show($("btn-final-next"), team && (f.teamFinished || f.teamStarted));
    $("btn-final-next").textContent = f.teamFinished ? "Bring on the Chaser" : "End the team's round";
    $("btn-final-next").appendChild(kbd("N"));
    $("btn-final-undo").disabled = !state.history.length;
  }

  /* ============ Result and standings ============ */

  function renderResult(app) {
    const state = app.core;
    const out = state.outcome;
    const showing = state.phase === "standings";
    setText("chase-result-kicker", showing ? "How the night went" : resultKicker(state, out));
    setText("chase-result-headline", resultHeadline(state, out));
    setText("chase-result-amount", core().formatMoney(state, out && out.teamWon ? out.bank : 0));
    setText("chase-result-sub", resultSub(state, out));
    renderStandings(state);
    show($("btn-result-next"), !showing);
    $("btn-result-undo").disabled = !state.history.length;
  }

  function resultKicker(state, out) {
    if (!out || !out.played) return "No Final Chase";
    return out.teamWon ? "They held on" : "Caught";
  }

  function resultHeadline(state, out) {
    if (!out) return "";
    if (!out.played) return `${state.chaser.name} takes the lot`;
    return out.teamWon ? "The team win the bank" : `${state.chaser.name} wins`;
  }

  function resultSub(state, out) {
    if (!out) return "";
    if (!out.played) return "Nobody got home, so there was no Final Chase.";
    if (out.teamWon) {
      return `${out.teamSteps} steps built, ${state.chaser.name} reached ${out.chaserSteps}`
        + `${out.pushbacks ? `, pushed back ${out.pushbacks} ${out.pushbacks === 1 ? "time" : "times"}` : ""}`
        + ". Split between the finalists.";
    }
    return `${state.chaser.name} caught the team with ${
      core().secondsLeft(state.final ? state.final.chaserClock : null, Date.now())} seconds to spare.`;
  }

  function renderStandings(state) {
    const list = $("chase-standings");
    list.replaceChildren();
    core().standings(state).forEach((row) => {
      const li = el("li", `standing-row is-${row.outcome}`);
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-built", `built ${core().formatMoney(state, row.cash)}`));
      li.appendChild(el("span", "standing-note", standingNote(state, row)));
      li.appendChild(el("span", "standing-money", core().formatMoney(state, row.winnings)));
      list.appendChild(li);
    });
  }

  function standingNote(state, row) {
    if (row.outcome === "home") return `played for ${core().formatMoney(state, row.played)} — home`;
    if (row.outcome === "caught") return `played for ${core().formatMoney(state, row.played)} — caught`;
    return "did not play";
  }

  /* ============ The game-lobby confirm (docs 19 §1) ============ */

  function renderLobbyModal(app) {
    show($("chase-lobby-backdrop"), !!app.lobbyOpen);
    if (!app.lobbyOpen) return;
    setText("chase-lobby-body", app.core
      ? "Keep this game and you can pick it up exactly where it is. Start over clears the game in "
        + "progress; the team, the questions and the rules all stay."
      : "There is no game in progress — this just takes you back to the setup screen.");
  }

  /* ============ The splash ============ */

  const SPLASH_MS = 600;   // docs/21 rule 8: a plain 600 ms card
  let splashTimer = null;

  /**
   * The 1.2 s title card the hub shows on a game switch, mirrored here so a
   * standalone page carries it too. Decorative only: `.gsc-splash` is
   * `pointer-events: none`, and the whole card is skipped under reduced motion
   * and when embedded (the hub shows its own).
   */
  function showSplash() {
    const node = $("gsc-splash");
    if (!node) return;
    if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (document.body.classList.contains("gsc-embedded")) return;
    setText("gsc-splash-title", "The Chase");
    setText("gsc-splash-sub", "");
    node.dataset.gscGame = "the-chase";
    node.classList.remove("hidden");
    if (splashTimer) clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
      splashTimer = null;
      node.classList.add("hidden");
    }, SPLASH_MS);
  }

  /* ============ Whole-page render ============ */

  function render(app) {
    const which = screenFor(app);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === which));
    renderLobbyModal(app);
    // Game lobby is always in the bar; with no game in progress there is
    // nothing to park, so it is disabled, not hidden (docs 19 §1, UI-12).
    $("btn-game-lobby").disabled = !app.core;
    // A screen we are leaving is never repainted, so a question would sit in
    // its (hidden) panel for the rest of the night. Empty them here.
    if (which !== "cash") { setText("chase-cash-q", ""); setText("chase-cash-a", ""); }
    if (which !== "final") { setText("chase-final-q", ""); setText("chase-final-a", ""); }
    if (which !== "board") $("chase-options").replaceChildren();
    if (which === "setup") renderSetup(app);
    if (!app.core) return;
    if (which === "cash") renderCash(app);
    if (which === "offer") renderOffer(app);
    if (which === "board") renderBoard(app);
    if (which === "final") renderFinal(app);
    if (which === "result") renderResult(app);
  }

  return { render, screenFor, showSplash, LETTERS };
})();

window.ChaseView = ChaseView;
