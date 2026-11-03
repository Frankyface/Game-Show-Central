/* ============================================================
   Match Game — host rendering
   Everything that paints the setup screen, the prompt screen,
   the round scores and the standings. The Super Match screens
   live in mg-super.js so both files stay well under the
   800-line house limit. Reads the app state, writes the DOM,
   dispatches nothing except through window.MgApp. Every string
   reaches the page through textContent — never innerHTML.

   THE RULE THIS FILE ENFORCES: a panel card's answer only ever
   enters the DOM once MgCore.hostCards says that card has been
   flipped. `text` is null until then, so there is no hidden node
   holding a secret — and a hidden node is exactly what shows up
   in a screen share the moment a stylesheet fails to load.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the rest of the game uses the same four.
   ============================================================ */

"use strict";

/* ============ Tiny DOM helpers (shared with app/super/editor/room/phone) ============ */

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

const MgView = (function () {
  const core = () => window.MgCore;

  const SCREENS = ["setup", "prompt", "scores", "super", "standings", "editor"];
  const SUPER_PHASES = ["superChoice", "audience", "audienceBoard", "hthPick", "hthPrompt", "hthResult"];

  function screenFor(app) {
    if (app.editorOpen) return "editor";
    const state = app.core;
    if (!state) return "setup";
    if (state.phase === "prompt") return "prompt";
    if (state.phase === "roundScores") return "scores";
    if (SUPER_PHASES.indexOf(state.phase) >= 0) return "super";
    if (state.phase === "standings") return "standings";
    return "setup";
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    setText("mg-source", app.source);
    setText("mg-prompt-count", app.game
      ? `${app.game.prompts.length} prompts and ${app.game.audiencePrompts.length} audience prompts`
        + `${app.setup.shuffle ? ", shuffled" : ", in file order"}.`
      : "No prompts loaded yet.");
    setText("mg-panel-count", String(app.setup.settings.panelSize));
    setText("mg-player-count", app.setup.players.length ? String(app.setup.players.length) : "");
    renderPlayerList(app);
    renderContestantRows(app);
    renderPanelSeats(app);
    renderSetupSettings(app);
    const shuffle = $("btn-shuffle");
    shuffle.setAttribute("aria-pressed", String(!!app.setup.shuffle));
    shuffle.textContent = app.setup.shuffle ? "Shuffled — use file order" : "Shuffle the deck";
  }

  function renderSetupSettings(app) {
    const s = app.setup.settings;
    $("mg-set-panel").value = String(s.panelSize);
    $("mg-set-rounds").value = String(s.rounds);
    $("mg-set-points").value = String(s.pointsPerMatch);
    $("mg-set-v1").value = String(s.audienceValues[0]);
    $("mg-set-v2").value = String(s.audienceValues[1]);
    $("mg-set-v3").value = String(s.audienceValues[2]);
    if (document.activeElement !== $("mg-set-mult")) $("mg-set-mult").value = s.multipliers.join(", ");
    $("mg-set-rule").checked = !!s.secondRoundRule;
  }

  function renderPlayerList(app) {
    const list = $("mg-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p) => {
      const li = el("li", "player-row");
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-kind", p.manual ? "typed in" : "on a phone"));
      li.appendChild(el("span", "player-role", roleOf(app, p.pid)));
      list.appendChild(li);
    });
    if (!app.setup.players.length) {
      list.appendChild(el("li", "hint",
        "Nobody yet. Open a room and let phones join, or leave every seat on “host types”."));
    }
  }

  function roleOf(app, pid) {
    const c = app.setup.contestants.findIndex((x) => x.pid === pid);
    if (c >= 0) return `contestant ${c + 1}`;
    const seat = app.setup.panel.findIndex((x) => x.pid === pid);
    if (seat >= 0) return `panel seat ${seat + 1}`;
    return "audience";
  }

  /** Every phone that is free, plus whoever already holds this seat. */
  function fillPidSelect(select, app, mine) {
    const taken = new Set(app.setup.contestants.map((c) => c.pid)
      .concat(app.setup.panel.map((p) => p.pid)).filter(Boolean));
    select.replaceChildren();
    const blank = el("option", null, "host types");
    blank.value = "";
    select.appendChild(blank);
    app.setup.players.forEach((p) => {
      if (taken.has(p.pid) && p.pid !== mine) return;
      const option = el("option", null, p.name);
      option.value = p.pid;
      select.appendChild(option);
    });
    select.value = mine || "";
    if (select.value !== (mine || "")) select.value = "";
  }

  function renderContestantRows(app) {
    app.setup.contestants.forEach((c, i) => {
      const name = $(`mg-c${i + 1}-name`);
      if (document.activeElement !== name) name.value = c.name;
      fillPidSelect($(`mg-c${i + 1}-pid`), app, c.pid);
    });
  }

  function renderPanelSeats(app) {
    const box = $("mg-panel-seats");
    const size = app.setup.panel.length;
    if (box.dataset.size !== String(size)) {
      box.dataset.size = String(size);
      box.replaceChildren();
      for (let slot = 0; slot < size; slot += 1) box.appendChild(buildPanelSeat(slot));
    }
    app.setup.panel.forEach((seat, slot) => {
      const row = box.children[slot];
      const name = row.querySelector(".seat-name");
      if (document.activeElement !== name) name.value = seat.name;
      fillPidSelect(row.querySelector(".seat-pid"), app, seat.pid);
    });
  }

  function buildPanelSeat(slot) {
    const row = el("div", "seat-row");
    const nameLabel = el("label", "field-inline", `Seat ${slot + 1}`);
    const name = el("input", "seat-name");
    name.type = "text";
    name.maxLength = 24;
    name.autocomplete = "off";
    name.placeholder = `Panelist ${slot + 1}`;
    name.addEventListener("input", () => window.MgApp.setPanelName(slot, name.value));
    nameLabel.appendChild(name);
    const pidLabel = el("label", "field-inline", "Phone");
    const pid = el("select", "seat-pid");
    pid.addEventListener("change", () => window.MgApp.setPanelPid(slot, pid.value));
    pidLabel.appendChild(pid);
    row.appendChild(nameLabel);
    row.appendChild(pidLabel);
    return row;
  }

  /* ============ The panel cards ============ */

  /**
   * Build or update the six cards in place. Rebuilding on every render would
   * re-run the flip on cards that have not changed (the Deal or No Deal rule
   * from docs/19 §3), and would steal the caret from the host's typing.
   */
  function renderCards(box, cards, opts) {
    const o = opts || {};
    const sig = `${o.sig || ""}:${cards.length}`;
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.replaceChildren();
      cards.forEach((card) => box.appendChild(buildCard(card, o)));
    }
    cards.forEach((card, i) => paintCard(box.children[i], card, o));
  }

  function buildCard(card, o) {
    const node = el("div", "card-seat");
    node.dataset.slot = String(card.slot);
    node.appendChild(el("p", "card-name", card.name));
    const flip = el("div", "card-flip");
    const inner = el("div", "card-inner");
    inner.appendChild(el("div", "card-face card-front"));
    inner.appendChild(el("div", "card-face card-back"));
    flip.appendChild(inner);
    node.appendChild(flip);
    node.appendChild(el("p", "card-mark"));
    if (o.typeable) node.appendChild(buildCardForm(card.slot));
    if (o.pickable) node.appendChild(buildPickButton(card.slot));
    return node;
  }

  function buildCardForm(slot) {
    const form = el("form", "card-form");
    form.autocomplete = "off";
    const input = el("input", "card-input");
    input.type = "text";
    input.maxLength = 40;
    input.placeholder = "Type their answer";
    input.setAttribute("aria-label", `Answer for panel seat ${slot + 1}`);
    const send = el("button", "btn btn-ghost btn-small", "Save");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      window.MgApp.typePanelAnswer(slot, input.value);
      input.value = "";
    });
    return form;
  }

  function buildPickButton(slot) {
    const btn = el("button", "btn btn-gold btn-small card-pick", "Pick");
    btn.type = "button";
    btn.addEventListener("click", () => window.MgApp.pickPanelist(slot));
    return btn;
  }

  const MARKS = { true: "match", false: "no match" };

  function paintCard(node, card, o) {
    if (!node) return;
    node.className = `card-seat${card.answered ? " is-answered" : ""}`
      + `${card.revealed ? " is-revealed" : ""}${card.live ? " is-live" : ""}`
      + `${card.locked ? " is-locked" : ""}`
      + (card.judged === null ? "" : (card.judged ? " is-match" : " is-miss"));
    node.querySelector(".card-name").textContent = card.name;
    node.querySelector(".card-flip").classList.toggle("is-flipped", !!card.revealed);
    node.querySelector(".card-front").textContent = frontText(card, o);
    // The one place an answer reaches the DOM — and only when hostCards says so.
    node.querySelector(".card-back").textContent = card.revealed ? (card.text || "") : "";
    node.querySelector(".card-mark").textContent =
      card.judged === null ? "" : MARKS[String(card.judged)];
    const form = node.querySelector(".card-form");
    if (form) {
      const usable = o.typeable && !card.locked && !o.frozen;
      form.hidden = !usable;
      const input = form.querySelector(".card-input");
      input.type = o.hideTyping ? "password" : "text";
      input.disabled = !usable;
      form.querySelector("button").disabled = !usable;
    }
    const pick = node.querySelector(".card-pick");
    if (pick) pick.disabled = !!o.frozen;
  }

  function frontText(card, o) {
    if (card.locked) return "already matched";
    if (card.answered) return "answered";
    return o && o.frozen ? "no answer" : "waiting…";
  }

  /* ============ The prompt screen ============ */

  function renderPrompt(app) {
    const state = app.core;
    const cur = state.current;
    const who = state.contestants[cur.seat];
    setText("mg-play-title", `${who.name} to play`);
    setText("mg-play-sub", roundLabel(state));
    setText("mg-play-score", core().scoreLine(state));
    setText("mg-prompt-text", cur.text);
    setText("mg-prompt-hint", cur.hint ? `Hint: ${cur.hint}` : "");
    const count = core().answeredCount(state);
    setText("mg-answered", `${count.done} / ${count.total}`);

    renderCards($("mg-cards"), core().hostCards(state), {
      sig: `${state.round}-${state.tiebreak}-${cur.seat}-${cur.index}`,
      typeable: true,
      frozen: cur.revealed > 0,
      hideTyping: app.hideTyping,
    });

    show($("mg-guess-form"), !cur.guessLocked);
    setText("mg-guess-shown", cur.guessLocked ? `They said: “${cur.guess}”` : "");
    setText("mg-play-state", playState(state, cur, count));
    $("mg-hide-typing").checked = !!app.hideTyping;
    paintPromptControls(state, cur);
  }

  function roundLabel(state) {
    if (state.tiebreak > 0) return `Tiebreak ${state.tiebreak}`;
    return `Round ${state.round} of ${state.game.settings.rounds}`;
  }

  function playState(state, cur, count) {
    if (cur.order.length === 0) return "This contestant has already matched the whole panel.";
    if (!cur.guessLocked) {
      return count.done < count.total
        ? `Waiting for ${count.total - count.done} of the panel. Type the contestant's answer when they give it.`
        : "The panel is in. Type the contestant's answer and lock it in.";
    }
    if (cur.done) return `That's the turn — ${cur.points} ${cur.points === 1 ? "point" : "points"}.`;
    if (cur.revealed === cur.judged.length) return "Reveal the next card.";
    return "Same idea? Press Match. Otherwise No match.";
  }

  function paintPromptControls(state, cur) {
    const awaiting = cur.revealed === cur.judged.length + 1;
    const canReveal = cur.guessLocked && cur.revealed === cur.judged.length
      && cur.revealed < cur.order.length;
    $("btn-reveal").disabled = !canReveal;
    $("btn-match").disabled = !awaiting;
    $("btn-no-match").disabled = !awaiting;
    $("btn-next-prompt").disabled = cur.revealed > 0;
    $("btn-next-contestant").disabled = !cur.done;
    $("btn-undo").disabled = !state.history.length;
    $("btn-next-contestant").textContent = nextLabel(state);
  }

  function nextLabel(state) {
    if (state.turnInRound === 0) return "Next contestant";
    return state.round < state.game.settings.rounds ? "Round scores" : "Scores";
  }

  /* ============ Round scores ============ */

  function renderScores(app) {
    const state = app.core;
    const tied = core().isTied(state);
    const last = state.round >= state.game.settings.rounds;
    setText("mg-scores-kicker", roundLabel(state));
    setText("mg-scores-title", tied ? "Level" : `${state.contestants[core().leader(state)].name} leads`);
    renderPodiums($("mg-podiums"), state);
    setText("mg-scores-sub", scoresSub(state, tied, last));
    show($("btn-tiebreak"), tied && last);
    $("btn-tiebreak").disabled = !(tied && last);
    $("btn-next-round").disabled = tied && last;
    $("btn-next-round").textContent = last ? "On to the Super Match" : "Next round";
    $("btn-scores-undo").disabled = !state.history.length;
  }

  function scoresSub(state, tied, last) {
    if (tied && last) return "Level after every round — a tiebreak prompt settles it.";
    if (last) return "The winner plays the Super Match.";
    const left = state.game.settings.rounds - state.round;
    return left === 1 ? "One more round." : `${left} more rounds.`;
  }

  function renderPodiums(box, state) {
    box.replaceChildren();
    const lead = core().leader(state);
    state.contestants.forEach((c, i) => {
      const node = el("div", `gsc-podium podium${lead === i ? " is-active" : ""}`);
      node.appendChild(el("span", "gsc-podium-name", c.name));
      node.appendChild(el("span", "gsc-podium-score", String(c.points)));
      node.appendChild(el("span", "gsc-podium-note",
        c.money ? core().moneyText(state, c.money) : `${c.points === 1 ? "1 match" : `${c.points} matches`}`));
      box.appendChild(node);
    });
  }

  /* ============ Standings ============ */

  function renderStandings(app) {
    const state = app.core;
    const rows = core().standings(state);
    setText("mg-standings-title", rows[0].money || rows[0].points
      ? `${rows[0].name} takes the night` : "Standings");
    const list = $("mg-standings");
    list.replaceChildren();
    rows.forEach((row, i) => {
      const li = el("li", `standing-row${i === 0 ? " is-top" : ""}`);
      li.appendChild(el("span", "standing-rank", `${i + 1}`));
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-points",
        `${row.points} ${row.points === 1 ? "point" : "points"}`));
      li.appendChild(el("span", "standing-money", core().moneyText(state, row.money)));
      list.appendChild(li);
    });
    $("btn-standings-undo").disabled = !state.history.length;
  }

  /* ============ Topbar, errors and the whole render ============ */

  function renderTopbar(app) {
    setText("mg-title", app.game ? app.game.title : "Match Game");
    const sound = $("btn-sound");
    const on = window.MgSound.enabled();
    sound.textContent = on ? "Sound on" : "Sound off";
    sound.setAttribute("aria-pressed", String(on));
    $("btn-game-lobby").disabled = !app.core && !app.resumable;
    // Painted from the topbar, not from renderSetup: the flag changes on
    // screens where the setup renderer never runs.
    show($("btn-resume"), !!app.resumable);
    show($("mg-lobby-modal"), !!app.lobbyOpen);
  }

  function render(app) {
    const wanted = screenFor(app);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === wanted));
    renderTopbar(app);
    if (wanted === "setup") renderSetup(app);
    else if (wanted === "prompt") renderPrompt(app);
    else if (wanted === "scores") renderScores(app);
    else if (wanted === "super") window.MgSuper.render(app);
    else if (wanted === "standings") renderStandings(app);
  }

  return { render, screenFor, renderCards, renderPodiums, roundLabel, SCREENS };
})();

window.MgView = MgView;
