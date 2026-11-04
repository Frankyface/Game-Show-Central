/* ============================================================
   1 vs 100 — host rendering
   Everything that paints the host screens, split out of
   ovh-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, and dispatches
   nothing except through window.OvhApp. Every string reaches the
   page through textContent — never as an HTML string.

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

const OvhView = (function () {
  "use strict";

  const core = () => window.OvhCore;

  const TIMER_BLOCKS = 10;

  /** Plain-English words so colour is never the only signal. */
  const OPTION_WORDS = {
    idle: "", locked: "locked in", correct: "correct answer", wrong: "wrong answer",
  };

  const HELP_LABELS = {
    poll: { name: "Poll the Mob" },
    ask: { name: "Ask the Mob" },
    trust: { name: "Trust the Mob" },
  };

  /* ============ Screen switching ============ */

  const SCREENS = ["setup", "play", "result", "editor", "phone"];

  function screenFor(app) {
    if (app.editorOpen) return "editor";
    if (!app.core) return "setup";
    if (app.core.phase === "result" || app.core.phase === "standings") return "result";
    if (app.core.phase === "setup") return "setup";
    return "play";
  }

  function paintScreens(app) {
    const wanted = screenFor(app);
    SCREENS.forEach((name) => {
      if (name === "phone") return;                 // ovh-phone.js owns that one
      show($(`screen-${name}`), name === wanted);
    });
    return wanted;
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    setText("ovh-source", app.source);
    const count = app.game ? app.game.questions.length : 0;
    setText("ovh-question-count", count
      ? `${count} questions loaded. Difficulty rises with the question number.`
      : "No questions loaded yet — open the editor or load a file.");
    renderPlayers(app);
    renderMobChoice(app);
    renderRules(app);
    show($("btn-resume"), !!app.stashed);
    const start = $("btn-start");
    if (start) {
      start.textContent = app.stashed ? "Start a new game" : "Start the game";
      // One primary at a time: with a parked game, Resume is the primary.
      start.classList.toggle("btn-gold", !app.stashed);
      start.classList.toggle("btn-ghost", !!app.stashed);
    }
  }

  function renderPlayers(app) {
    const list = $("ovh-player-list");
    if (!list) return;
    list.replaceChildren();
    if (!app.setup.players.length) {
      list.appendChild(el("li", "player-empty",
        "Nobody yet. Add a name, or open a room and let phones join."));
      return;
    }
    app.setup.players.forEach((p) => {
      const li = el("li", "player-row");
      const label = el("label", "player-pick");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "ovh-contestant";
      radio.value = p.pid;
      radio.checked = app.setup.contestant === p.pid;
      radio.addEventListener("change", () => window.OvhApp.setContestant(p.pid));
      label.appendChild(radio);
      label.appendChild(el("span", "player-name", p.name));
      li.appendChild(label);
      li.appendChild(el("span", "player-tag", p.manual ? "typed in" : "phone"));
      const drop = el("button", "btn btn-ghost btn-small", "Remove");
      drop.type = "button";
      drop.addEventListener("click", () => window.OvhApp.removePlayer(p.pid));
      li.appendChild(drop);
      list.appendChild(li);
    });
  }

  function renderMobChoice(app) {
    const phones = app.setup.players.filter((p) => !p.manual && p.pid !== app.setup.contestant).length;
    setText("ovh-phone-note", phones ? `${phones} connected` : "none connected yet");
    const sim = app.setup.mobSource === "sim";
    if ($("ovh-mob-phones")) $("ovh-mob-phones").checked = !sim;
    if ($("ovh-mob-sim")) $("ovh-mob-sim").checked = sim;
    const size = $("ovh-mob-size");
    if (size && document.activeElement !== size) size.value = String(app.setup.mobSize);
    if (size) size.disabled = !sim;
    setText("ovh-mob-note", sim
      ? `The host enters how many of the ${app.setup.mobSize} got each question wrong.`
      : (phones >= core().MIN_PHONE_MOB
        ? `${phones} phones will play as the Mob.`
        : `Only ${phones} phone${phones === 1 ? "" : "s"} — a Mob wants at least ${core().MIN_PHONE_MOB}. `
          + "Switch to a simulated Mob, or let more phones in."));
  }

  function renderRules(app) {
    const secs = $("ovh-secs");
    if (secs && document.activeElement !== secs) secs.value = String(app.setup.secs);
    const bonus = $("ovh-bonus");
    if (bonus && document.activeElement !== bonus) bonus.value = String(app.setup.bonus);
    core().HELP_KEYS.forEach((key) => {
      const box = $(`ovh-help-${key}`);
      if (box) box.checked = !!app.setup.helps[key];
    });
  }

  /* ============ Play ============ */

  function renderPlay(app) {
    const state = app.core;
    const C = core();
    setText("ovh-contestant", C.contestantName(state));
    setText("ovh-bank", C.formatMoney(state, C.bank(state)));
    setText("ovh-per-member", `${C.formatMoney(state, C.perMember(state, state.qNumber))} each`);
    setText("ovh-qnum", `${state.qNumber}`);
    setText("ovh-notice", state.notice || " ");
    renderHelps(state);
    renderMob(app);
    renderQuestion(app);
    renderAsk(state);
    renderSimForm(app);
    renderControls(app);
  }

  function renderHelps(state) {
    const box = $("ovh-helps");
    if (!box) return;
    box.replaceChildren();
    core().HELP_KEYS.forEach((key) => {
      const label = HELP_LABELS[key];
      const on = !!state.helps[key];
      const chip = el("span", `gsc-chip help-chip ${on ? "is-on" : "is-spent"}`);
      chip.appendChild(el("span", "help-name", label.name));
      chip.appendChild(el("span", "help-state", on ? "ready" : "used"));
      box.appendChild(chip);
    });
  }

  function renderMob(app) {
    const state = app.core;
    const C = core();
    const alive = C.mobAlive(state);
    const size = C.mobSize(state);
    setText("ovh-mob-count", `${alive} of ${size} still in`);
    const sp = C.split(state);
    setText("ovh-mob-answered", state.q.closed
      ? `Mob locked — ${sp.answered} answered, ${sp.noAnswer} did not`
      : `Answered ${sp.answered}/${sp.total}`);
    const grid = $("ovh-mob-grid");
    if (!grid) return;
    grid.replaceChildren();
    grid.classList.toggle("is-big", size > 28);   // 29+ normal tiles overflow the 1280x628 hub frame
    C.mobTiles(state).forEach((tile) => {
      const node = el("li", "mob-tile");
      node.classList.toggle("is-out", !tile.alive);
      node.classList.toggle("is-answered", tile.alive && tile.answered && !state.q.closed);
      node.classList.toggle("is-just-out", !!tile.justOut);
      node.appendChild(el("span", "mob-seat", tile.seat));
      const mark = el("span", "mob-mark", tile.alive ? (tile.answered ? "•" : "") : "out");
      node.appendChild(mark);
      node.title = tile.alive
        ? `${tile.name}${tile.answered ? " — answered" : ""}`
        : `${tile.name} — out on question ${tile.out}`;
      node.setAttribute("aria-label", node.title);
      grid.appendChild(node);
    });
  }

  function renderQuestion(app) {
    const state = app.core;
    const C = core();
    const q = state.q.question;
    setText("ovh-q-cat", q ? (q.category || `Level ${q.level}`) : " ");
    setText("ovh-q-text", q ? q.q : C.NO_QUESTION);
    const box = $("ovh-options");
    if (!box) return;
    box.replaceChildren();
    C.optionRows(state).forEach((row) => {
      const btn = el("button", `option is-${row.state}`);
      btn.type = "button";
      btn.dataset.idx = String(row.idx);
      if (app.pick === row.idx && state.q.locked === null) btn.classList.add("is-picked");
      btn.appendChild(el("span", "option-letter", row.letter));
      btn.appendChild(el("span", "option-text", row.text));
      if (row.votes !== null) btn.appendChild(el("span", "option-votes", `${row.votes}`));
      const word = OPTION_WORDS[row.state];
      if (word) btn.appendChild(el("span", "visually-hidden", ` — ${word}`));
      btn.disabled = !(state.q.closed && !state.q.revealed && state.q.locked === null);
      btn.addEventListener("click", () => window.OvhApp.pickOption(row.idx));
      box.appendChild(btn);
    });
  }

  function renderAsk(state) {
    const box = $("ovh-ask");
    if (!box) return;
    box.replaceChildren();
    const ask = state.q.ask;
    show(box, !!ask);
    if (!ask) return;
    box.appendChild(el("p", "ask-title", "Ask the Mob"));
    [["Says it is right", ask.right], ["Says otherwise", ask.wrong]].forEach(([label, who]) => {
      const row = el("p", "ask-row");
      row.appendChild(el("span", "ask-k", label));
      row.appendChild(el("span", "ask-v", who
        ? `${who.name} — chose ${core().LETTERS[who.idx]}`
        : "nobody on that side"));
      box.appendChild(row);
    });
  }

  function renderSimForm(app) {
    const state = app.core;
    const form = $("ovh-sim-form");
    if (!form) return;
    const wanted = state.mob.simulated && state.phase === "question" && !state.q.closed && !!state.q.question;
    show(form, wanted);
    if (!wanted) return;
    const input = $("ovh-sim-wrong");
    const alive = core().mobAlive(state);
    if (input) {
      input.max = String(alive);
      if (document.activeElement !== input) {
        input.value = state.q.simWrong === null ? "" : String(state.q.simWrong);
      }
    }
    setText("ovh-sim-note", state.q.simWrong === null
      ? `0 to ${alive}. Leave it empty and the whole Mob is right.`
      : `${state.q.simWrong} of ${alive} wrong.`);
  }

  /** Show a button only when its event would actually do something. */
  function renderControls(app) {
    const state = app.core;
    const legal = new Set(core().legalActions(state));
    const openBtn = $("btn-open-window");
    if (openBtn) {
      const paused = state.q.remainingMs !== null && state.q.remainingMs < state.q.seconds * 1000;
      openBtn.textContent = paused ? "Resume the Mob window" : "Open the Mob window";
      show(openBtn, legal.has("openQuestion"));
    }
    show($("btn-close-mob"), legal.has("closeMob"));
    core().HELP_KEYS.forEach((key) => {
      const id = `btn-help-${key}`;
      const type = key === "poll" ? "usePoll" : (key === "ask" ? "useAsk" : "useTrust");
      show($(id), legal.has(type));
    });
    const lock = $("btn-lock");
    if (lock) {
      show(lock, state.q.closed && !state.q.revealed && state.q.locked === null);
      lock.disabled = app.pick === null;
      lock.textContent = app.pick === null ? "Pick an answer first" : `Lock in ${core().LETTERS[app.pick]}`;
    }
    show($("btn-reveal"), legal.has("reveal"));
    show($("btn-continue"), legal.has("continue"));
    show($("btn-walk"), legal.has("walk"));
    show($("btn-undo"), legal.has("undo"));
    show($("btn-finish"), legal.has("finish"));
  }

  /* ============ Result and standings ============ */

  const RESULT_COPY = {
    win: { kicker: "The Mob is wiped out", sub: "" },   // sub built from the bonus (D10)
    walk: { kicker: "Walked away", sub: "Took the money and left the Mob standing." },
    lose: { kicker: "Wrong answer", sub: "The game ends there — and the survivors take the bank." },
  };

  /** D10: the wipe-out line names the bonus this game actually pays. */
  function winLine(state) {
    const n = state.game.settings.bonusMultiplier;
    if (n === 1) return "Every tile dark. The contestant takes the bank.";
    if (n === 2) return "Every tile dark. The bank is doubled.";
    return `Every tile dark. The bank is multiplied by ${n}.`;
  }

  function renderResult(app) {
    const state = app.core;
    const C = core();
    const out = state.outcome || { reason: "walk", won: 0, survivors: [], each: 0 };
    const copy = RESULT_COPY[out.reason] || RESULT_COPY.walk;
    const standings = state.phase === "standings";
    setText("ovh-result-kicker", standings ? "Standings" : copy.kicker);
    setText("ovh-result-name", C.contestantName(state));
    setText("ovh-result-amount", C.formatMoney(state, out.won));
    setText("ovh-result-sub", standings
      ? `${state.qNumber} question${state.qNumber === 1 ? "" : "s"} played.`
      : (out.reason === "win" ? winLine(state) : copy.sub));
    renderResultMob(app, out);
    renderMoneyLines(app, out);
    show($("btn-standings"), !standings);
    show($("btn-play-again"), standings);
    show($("btn-result-undo"), state.history.length > 0);
  }

  function renderResultMob(app, out) {
    const state = app.core;
    const list = $("ovh-result-mob");
    if (!list) return;
    list.replaceChildren();
    const share = out.reason === "lose" ? out.each : 0;
    core().standings(state).filter((r) => r.kind === "mob").forEach((row) => {
      const li = el("li", `standing-row ${row.alive ? "is-alive" : "is-out"}`);
      li.appendChild(el("span", "standing-seat", row.seat));
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-note", row.note));
      li.appendChild(el("span", "standing-won",
        row.alive && share ? core().formatMoney(state, share) : "—"));
      list.appendChild(li);
    });
  }

  function renderMoneyLines(app, out) {
    const state = app.core;
    const C = core();
    const box = $("ovh-money-lines");
    if (!box) return;
    box.replaceChildren();
    const lines = [[`Bank after ${state.qNumber} question${state.qNumber === 1 ? "" : "s"}`,
      C.formatMoney(state, out.bank === undefined ? C.bank(state) : out.bank)]];
    if (out.reason === "win") {
      lines.push([`Wipe-out bonus (×${state.game.settings.bonusMultiplier} the bank)`,
        C.formatMoney(state, out.won - (out.bank || 0))]);
    }
    if (out.reason === "lose") {
      lines.push([`Mob survivors (${out.survivors.length})`,
        out.survivors.length ? `${C.formatMoney(state, out.each)} each` : "nobody left"]);
    }
    lines.push(["The contestant leaves with", C.formatMoney(state, out.won)]);
    lines.forEach(([k, v]) => {
      const li = el("li", "money-line");
      li.appendChild(el("span", "money-k", k));
      li.appendChild(el("span", "money-v", v));
      box.appendChild(li);
    });
  }

  /* ============ The answer-window clock ============ */

  /** Build the block strip once; the tick only toggles `is-lit`. */
  function ensureTimer() {
    const strip = $("ovh-timer");
    if (!strip || strip.childElementCount) return strip;
    for (let i = 0; i < TIMER_BLOCKS; i += 1) strip.appendChild(el("i", "gsc-timer-block"));
    return strip;
  }

  /**
   * Paint the strip and the seconds line. Nothing here decides anything: the
   * host (ovh-app.js) closes the Mob when the window runs out.
   */
  function paintClock(app, now) {
    const strip = ensureTimer();
    const state = app.core;
    if (!strip || !state || !state.q) return;
    const C = core();
    const total = state.q.seconds || 0;
    const left = C.secondsLeft(state, now);
    const running = state.q.open;
    const lit = total > 0 ? Math.ceil((left / total) * TIMER_BLOCKS) : 0;
    [].forEach.call(strip.children, (block, i) => block.classList.toggle("is-lit", running && i < lit));
    strip.classList.toggle("is-urgent", running && left > 0 && left <= 5);
    setText("ovh-seconds", clockLabel(state, left, total));
  }

  function clockLabel(state, left, total) {
    if (state.q.closed) return "The Mob has locked.";
    if (state.q.open) return total > 0 ? `${left}s left` : "No clock — close when the room is ready.";
    if (!state.q.question) return " ";
    if (Number.isFinite(state.q.remainingMs) && total > 0 && state.q.remainingMs < total * 1000) {
      return `Paused with ${Math.ceil(state.q.remainingMs / 1000)}s left.`;
    }
    return total > 0 ? `${total}s once it opens.` : "No clock on this set.";
  }

  /* ============ Entry point ============ */

  function render(app) {
    const wanted = paintScreens(app);
    // Game lobby is always in the bar; with no game in progress there is
    // nothing to park, so it is disabled, not hidden (docs 19 §1, UI-12).
    $("btn-game-lobby").disabled = !app.core;
    if (wanted === "setup") renderSetup(app);
    if (wanted === "play") renderPlay(app);
    if (wanted === "result") renderResult(app);
    const chip = $("ovh-room-chip");
    if (chip && !app.roomCode) show(chip, false);
  }

  return { render, paintClock, screenFor, TIMER_BLOCKS };
})();

window.OvhView = OvhView;
