/* ============================================================
   Millionaire — host rendering
   Everything that paints the host screens, split out of
   wwm-app.js so both files stay well under the 800-line house
   limit. Reads the app state, writes the DOM, and dispatches
   nothing except through window.WwmApp. Every string reaches the
   page through textContent — never innerHTML.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the editor, room and phone glue use the
   same four.
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

const WwmView = (function () {
  const core = () => window.WwmCore;

  /** Plain-English words so colour is never the only signal. */
  const OPTION_WORDS = {
    idle: "", selected: "selected", locked: "locked in",
    correct: "correct answer", wrong: "wrong answer", removed: "removed by 50:50",
  };

  const LIFELINE_LABELS = {
    fifty: { badge: "50:50", short: "Fifty", name: "50:50" },
    phone: { badge: "☎", short: "Phone", name: "Phone a Friend" },
    audience: { badge: "👥", short: "Audience", name: "Ask the Audience" },
    switch: { badge: "⇄", short: "Switch", name: "Switch the Question" },
  };

  /* ============ Screen switching ============ */

  const SCREENS = ["setup", "fff", "hotseat", "result"];

  function phaseScreen(state) {
    if (!state) return "setup";
    if (state.phase === "pick") return "fff";
    if (state.phase === "standings") return "result";
    return SCREENS.indexOf(state.phase) >= 0 ? state.phase : "setup";
  }

  function renderScreens(app) {
    const wanted = app.editorOpen ? "editor" : phaseScreen(app.core);
    SCREENS.forEach((name) => show($(`screen-${name}`), !app.editorOpen && name === wanted));
    show($("screen-editor"), app.editorOpen);
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    const list = $("wwm-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p, i) => {
      const li = el("li");
      li.appendChild(el("span", "player-seat", i + 1));
      li.appendChild(el("span", "player-name", p.name));
      li.appendChild(el("span", "player-tag", p.manual ? "host" : "phone"));
      const remove = el("button", "btn btn-ghost btn-small", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => window.WwmApp.removePlayer(p.pid));
      li.appendChild(remove);
      list.appendChild(li);
    });
    setText("wwm-player-count", `${app.setup.players.length}/16`);
    setText("wwm-source", app.source);
    renderSetupRules(app);
    renderResume(app);
    $("btn-start").disabled = app.setup.players.length < 1 || !app.game;
  }

  function renderSetupRules(app) {
    const questions = app.game && Array.isArray(app.game.questions) ? app.game.questions.length : 0;
    const warnings = app.game ? core().warningsFor(app.game) : [];
    setText("wwm-question-count", `${questions} questions loaded. ${warnings.join(" ")}`.trim());
    const fileFff = !!(app.game && Array.isArray(app.game.fastestFinger) && app.game.fastestFinger.length);
    const box = $("wwm-fff");
    box.disabled = !fileFff;
    box.checked = fileFff && window.WwmApp.wantsFastestFinger();
    setText("wwm-fff-note", fffNote(app, fileFff));
    core().LIFELINE_KEYS.forEach((key) => {
      const node = $(`wwm-ll-${key}`);
      if (node) node.checked = window.WwmApp.lifelineOn(key);
    });
  }

  /**
   * The game parked by "Keep this game" (docs/19 §1). Start is still there and
   * still starts fresh; Resume puts the parked game back exactly as it was.
   */
  function renderResume(app) {
    const parked = app.resumable;
    show($("btn-resume"), !!parked);
    show($("wwm-resume-note"), !!parked);
    if (!parked) return;
    const C = core();
    $("btn-resume").textContent = "Resume the game";
    setText("wwm-resume-note",
      `Paused: ${describeParked(parked, C)}. Start the game begins a fresh one instead.`);
  }

  function describeParked(parked, C) {
    if (parked.phase === "hotseat") {
      return `${C.nameOf(parked, parked.current)} on question ${C.playingRung(parked)}`
        + ` for ${C.formatMoney(parked, C.rungValue(parked, C.playingRung(parked)))}`;
    }
    if (parked.phase === "fff") return "the Fastest Finger round";
    if (parked.phase === "pick") return "choosing the next contestant";
    if (parked.phase === "result" || parked.phase === "standings") return "the standings";
    return "a game in progress";
  }

  function fffNote(app, fileFff) {
    if (!fileFff) return "This question file has no Fastest Finger questions.";
    if (!app.phoneCount) return "No phones are connected yet — without them the host picks the hot seat.";
    return `${app.phoneCount} phone${app.phoneCount === 1 ? "" : "s"} connected.`;
  }

  /* ============ Fastest Finger ============ */

  function renderFff(app) {
    const state = app.core;
    const fff = state.fff;
    const picking = state.phase === "pick";
    setText("wwm-fff-kicker", picking ? "Who is next in the hot seat?" : "Fastest Finger First");
    setText("wwm-fff-q", fffHeadline(state, picking));
    renderFffItems(fff, picking);
    renderArrivals(state);
    setText("wwm-fff-notice", state.notice);
    renderFffButtons(state, picking);
    renderPickList(state);
  }

  function fffHeadline(state, picking) {
    if (picking) return "Choose a contestant below.";
    if (!state.fff.question) return "Open the question when everyone is ready.";
    return state.fff.question.q;
  }

  function renderFffItems(fff, picking) {
    const list = $("wwm-fff-items");
    list.replaceChildren();
    if (picking || !fff.question) return;
    const answer = fff.revealed ? fff.question.order : null;
    const rows = answer
      ? answer.map((idx, place) => ({ idx, place: place + 1 }))
      : fff.question.options.map((_, idx) => ({ idx, place: null }));
    rows.forEach((row) => {
      const li = el("li", answer ? "fff-item fff-item-ordered" : "fff-item");
      li.appendChild(el("span", "fff-letter", answer ? String(row.place) : core().LETTERS[row.idx]));
      li.appendChild(el("span", "fff-text", fff.question.options[row.idx]));
      list.appendChild(li);
    });
  }

  function renderArrivals(state) {
    const list = $("wwm-fff-arrivals");
    list.replaceChildren();
    const rows = core().fffRows(state);
    rows.forEach((row) => {
      const li = el("li", row.winner ? "arrival arrival-winner" : "arrival");
      li.appendChild(el("span", "arrival-rank", row.rank));
      li.appendChild(el("span", "arrival-name", row.name));
      li.appendChild(el("span", "arrival-time", row.ms === null ? "" : `${(row.ms / 1000).toFixed(2)}s`));
      const mark = row.correct === null ? "" : (row.correct ? "✓ correct" : "✗ wrong");
      li.appendChild(el("span", "arrival-mark", mark));
      list.appendChild(li);
    });
    setText("wwm-fff-count", rows.length ? `${rows.length} in` : "");
    show($("wwm-fff-count"), rows.length > 0);
  }

  function renderFffButtons(state, picking) {
    const legal = core().legalActions(state);
    show($("btn-fff-open"), !picking && legal.indexOf("fffOpen") >= 0);
    show($("btn-fff-reveal"), !picking && !!state.fff.question && !state.fff.revealed);
    const seatable = !picking && state.fff.revealed && !!state.fff.winner;
    show($("btn-fff-seat"), seatable);
    if (seatable) $("btn-fff-seat").textContent = `${core().nameOf(state, state.fff.winner)} to the hot seat`;
    $("btn-fff-undo").disabled = state.history.length === 0;
  }

  function renderPickList(state) {
    const box = $("wwm-pick-list");
    box.replaceChildren();
    core().waitingContestants(state).forEach((c) => {
      const btn = el("button", "btn btn-ghost pick-btn", c.name);
      btn.type = "button";
      btn.addEventListener("click", () => window.WwmApp.seat(c.pid));
      box.appendChild(btn);
    });
    if (!core().waitingContestants(state).length) {
      box.appendChild(el("p", "hint", "Everybody has had a turn — finish the night from the result screen."));
    }
  }

  /* ============ Hot seat ============ */

  function renderHotseat(app) {
    const state = app.core;
    const C = core();
    setText("wwm-hot-name", C.nameOf(state, state.current));
    setText("wwm-hot-money",
      `Question ${C.playingRung(state)} of ${C.rungCount(state)}`
      + ` · playing for ${C.formatMoney(state, C.rungValue(state, C.playingRung(state)))}`
      + ` · banked ${C.formatMoney(state, C.bankedValue(state))}`);
    setText("wwm-q-cat", state.question ? state.question.category : "");
    setText("wwm-q-text", state.question ? state.question.q : "No question could be drawn.");
    setText("wwm-notice", state.notice);
    renderOptions(state);
    renderTree(state);
    renderLifelines(state);
    renderRequest(state);
    renderHotseatButtons(state);
  }

  function renderOptions(state) {
    const box = $("wwm-options");
    box.replaceChildren();
    core().optionRows(state).forEach((row) => {
      const btn = el("button", `option option-${row.state}`);
      btn.type = "button";
      btn.dataset.idx = String(row.idx);
      btn.dataset.state = row.state;
      btn.disabled = row.state === "removed" || state.locked || state.revealed;
      btn.appendChild(el("span", "option-letter", `${row.letter}:`));
      btn.appendChild(el("span", "option-text", row.state === "removed" ? "" : row.text));
      const word = OPTION_WORDS[row.state];
      if (word) btn.appendChild(el("span", "visually-hidden", ` (${word})`));
      btn.addEventListener("click", () => window.WwmApp.select(row.idx));
      box.appendChild(btn);
    });
  }

  function renderTree(state) {
    const rail = $("wwm-tree");
    rail.replaceChildren();
    core().moneyTreeView(state).forEach((row) => {
      const li = el("li", "tree-row");
      if (row.won) li.classList.add("won");
      if (row.current) li.classList.add("current");
      if (row.safe) li.classList.add("safe");
      li.appendChild(el("span", "tree-rung", row.rung));
      li.appendChild(el("span", "tree-value", row.label));
      if (row.safe) li.appendChild(el("span", "tree-safe", "⚑"));
      if (row.current) li.setAttribute("aria-current", "step");
      rail.appendChild(li);
    });
  }

  function renderLifelines(state) {
    const box = $("wwm-lifelines");
    box.replaceChildren();
    const legal = core().legalActions(state);
    core().LIFELINE_KEYS.forEach((key) => {
      if (!state.game.settings.lifelines[key]) return;
      const label = LIFELINE_LABELS[key];
      const used = !state.lifelines[key];
      const btn = el("button", used ? "lifeline lifeline-used" : "lifeline");
      btn.type = "button";
      const blocked = !used && legal.indexOf(lifelineEvent(key)) < 0;
      btn.disabled = used || blocked;
      btn.title = lifelineTitle(state, label, used, blocked);
      btn.setAttribute("aria-label", btn.title);
      btn.appendChild(el("span", "lifeline-badge", label.badge));
      btn.appendChild(el("span", "lifeline-name", label.short));
      btn.appendChild(el("span", "lifeline-cross", used ? "✗" : ""));
      btn.addEventListener("click", () => window.WwmApp.useLifeline(key));
      box.appendChild(btn);
    });
  }

  /** Say why a badge is dark: spent, or unusable on this question right now. */
  function lifelineTitle(state, label, used, blocked) {
    if (used) return `${label.name} — already used`;
    if (!blocked) return label.name;
    if (state.notice === core().SWITCH_UNAVAILABLE) return state.notice;
    return `${label.name} — not available on this question`;
  }

  function lifelineEvent(key) {
    return { fifty: "useFifty", phone: "usePhone", audience: "useAudience", switch: "useSwitch" }[key];
  }

  function renderRequest(state) {
    const banner = $("wwm-request");
    banner.replaceChildren();
    if (!state.request) { show(banner, false); return; }
    const which = state.request.which;
    const asking = which === "walk"
      ? "is asking to walk away"
      : `is asking for the ${LIFELINE_LABELS[which].name} lifeline`;
    banner.appendChild(document.createTextNode(
      `${core().nameOf(state, state.request.pid)} ${asking}. `));
    const yes = el("button", "btn btn-gold btn-small", which === "walk" ? "Confirm walk away" : "Give it to them");
    yes.type = "button";
    yes.addEventListener("click", () => window.WwmApp.confirmRequest());
    const no = el("button", "btn btn-ghost btn-small", "Dismiss");
    no.type = "button";
    no.addEventListener("click", () => window.WwmApp.dispatch({ type: "clearRequest" }));
    banner.appendChild(yes);
    banner.appendChild(no);
    show(banner, true);
  }

  function renderHotseatButtons(state) {
    const legal = core().legalActions(state);
    show($("btn-lock"), !state.locked && !state.revealed);
    $("btn-lock").disabled = legal.indexOf("lock") < 0;
    show($("btn-reveal"), state.locked && !state.revealed);
    show($("btn-next"), state.revealed);
    $("btn-next").textContent = state.outcome ? "See the result" : "Next question";
    $("btn-walk").disabled = legal.indexOf("walkAway") < 0;
    $("btn-undo").disabled = state.history.length === 0;
    // Ending the night banks whoever is playing, so the button says what it pays.
    const banked = core().formatMoney(state, core().winningsIfWalk(state));
    $("btn-give-up").textContent = `End the night (banks ${banked})`;
    $("btn-give-up").title =
      `${core().nameOf(state, state.current)} is banked at ${banked} — the walk-away amount — `
      + "and the standings are shown.";
  }

  /* ============ Result and standings ============ */

  const RESULT_KICKERS = {
    million: "We have a millionaire!",
    walk: "Walked away with",
    wrong: "The right answer was worth more",
  };

  function renderResult(app) {
    const state = app.core;
    const C = core();
    const ending = state.phase === "standings";
    const outcome = state.outcome;
    setText("wwm-result-kicker", ending ? "Tonight's standings" : (outcome ? RESULT_KICKERS[outcome.reason] : ""));
    setText("wwm-result-name", ending ? topName(state) : C.nameOf(state, outcome ? outcome.pid : state.current));
    setText("wwm-result-amount", ending ? "" : C.formatMoney(state, outcome ? outcome.won : 0));
    renderStandings(state);
    const waiting = C.waitingContestants(state).length;
    show($("btn-next-contestant"), !ending && waiting > 0);
    show($("btn-finish"), !ending);
    show($("btn-play-again"), ending);
    $("btn-result-undo").disabled = state.history.length === 0;
    show($("btn-result-undo"), !ending);
  }

  function topName(state) {
    const rows = core().standings(state).filter((r) => r.out);
    return rows.length ? rows[0].name : "Nobody played";
  }

  function renderStandings(state) {
    const list = $("wwm-standings");
    list.replaceChildren();
    core().standings(state).forEach((row) => {
      const li = el("li", row.out ? "standing" : "standing standing-waiting");
      li.appendChild(el("span", "standing-name", row.name));
      li.appendChild(el("span", "standing-money",
        row.out ? core().formatMoney(state, row.won) : "still to play"));
      list.appendChild(li);
    });
  }

  /* ============ Overlays ============ */

  function renderOverlays(app) {
    const state = app.core;
    const hot = state && state.phase === "hotseat";
    renderAudience(state, hot && state.audience.open);
    renderPhoneLifeline(state, hot && state.phone.open);
  }

  function renderAudience(state, open) {
    show($("wwm-audience"), open);
    window.WwmTimer.sync("audience", !!open, open ? state.audience.deadline : null,
      open ? state.audience.seconds : 0);
    if (!open) return;
    const data = core().chart(state);
    renderChart(state, data);
    setText("wwm-audience-count", data.source === "host"
      ? "Using the percentages the host typed."
      : `Votes in: ${data.total}`);
  }

  function renderChart(state, data) {
    const box = $("wwm-audience-chart");
    box.replaceChildren();
    core().LETTERS.forEach((letter, idx) => {
      const col = el("div", "chart-col");
      if (state.removed.indexOf(idx) >= 0) col.classList.add("chart-col-removed");
      const bar = el("div", "chart-bar");
      bar.style.height = `${data.pcts[idx]}%`;
      const wrap = el("div", "chart-bar-wrap");
      wrap.appendChild(bar);
      col.appendChild(el("p", "chart-pct", `${data.pcts[idx]}%`));
      col.appendChild(wrap);
      col.appendChild(el("p", "chart-letter", letter));
      box.appendChild(col);
    });
  }

  function renderPhoneLifeline(state, open) {
    show($("wwm-phone-overlay"), open);
    window.WwmTimer.sync("phone", !!open, open ? state.phone.deadline : null, open ? state.phone.seconds : 0);
    if (!open) return;
    const field = $("wwm-friend");
    if (field && document.activeElement !== field && field.value !== state.phone.friend) {
      field.value = state.phone.friend;
    }
  }

  /* ============ Entry point ============ */

  function render(app) {
    renderScreens(app);
    if (app.editorOpen) return;
    const screen = phaseScreen(app.core);
    if (screen === "setup") renderSetup(app);
    if (screen === "fff") renderFff(app);
    if (screen === "hotseat") renderHotseat(app);
    if (screen === "result") renderResult(app);
    renderOverlays(app);
  }

  return { render, phaseScreen, renderSetup, LIFELINE_LABELS };
})();

window.WwmView = WwmView;
