/* ============================================================
   Krillion — host rendering (setup + Deep Dive + result)
   Reads the app state, writes the DOM. Dispatches nothing
   itself: every button calls back into window.KrApp. Every
   string reaches the page through textContent — never as markup.
   Puffer Party's screen lives in kr-party.js.

   THE RULE THIS FILE ENFORCES: while a prompt is open the host
   DOM holds no answer text at all — the chips say "answered" or
   "waiting", nothing more. Answers enter the DOM only once the
   prompt has closed (the judge's queue) or a group is revealed.
   The rated list is built only while the host has it switched on.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first among the page scripts.
   ============================================================ */

"use strict";

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

const KrView = (function () {
  const core = () => window.KrCore;
  const app = () => window.KrApp;

  const SCREENS = ["setup", "intro", "prompt", "reveal", "depth", "puffer", "result", "editor"];
  const PHASE_SCREEN = {
    intro: "intro", prompt: "prompt", reveal: "reveal", depth: "depth", result: "result",
    pufferReady: "puffer", puffer: "puffer", popped: "puffer",
  };

  function screenFor(state) {
    if (state.editorOpen) return "editor";
    const c = state.core;
    if (!c) return "setup";
    return Object.prototype.hasOwnProperty.call(PHASE_SCREEN, c.phase) ? PHASE_SCREEN[c.phase] : "setup";
  }

  function tierName(c, id) {
    const t = core().tierById(id, core().tiersOf(c));
    return t ? t.name : "";
  }

  /** "Prawn 2 · Schooler 0 · … · Missed 1" — the host's per-prompt tally. */
  function tallyText(c, revealedOnly) {
    const t = core().tierTally(c, revealedOnly);
    const parts = t.tiers.map((row) => `${row.name} ${row.count}`);
    parts.push(`Missed ${t.misses}`);
    return parts.join(" · ");
  }

  function numberText(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  /* ============ Shared pieces ============ */

  /** One button per tier plus Not valid; `current` gets aria-pressed. */
  function tierButtons(box, tiers, current, onPick) {
    box.replaceChildren();
    tiers.forEach((t) => {
      const b = el("button", "kr-btn kr-btn-tier kr-btn-sm", t.name);
      b.type = "button";
      b.dataset.tier = t.id;
      b.setAttribute("aria-pressed", String(current === t.id));
      b.addEventListener("click", () => onPick(t.id));
      box.appendChild(b);
    });
    const no = el("button", "kr-btn kr-btn-danger kr-btn-sm", "Not valid");
    no.type = "button";
    no.dataset.tier = "invalid";
    no.setAttribute("aria-pressed", String(current === null));
    no.addEventListener("click", () => onPick(null));
    box.appendChild(no);
  }

  /**
   * The reef: one lane per player in seat order, a line dropping from the
   * surface to their depth with a marker at the bottom. Seats never reorder,
   * so a reveal reads as markers sinking, not names shuffling.
   */
  function renderReef(box, rows) {
    const seated = rows.slice().sort((a, b) => a.seat - b.seat);
    const deepest = rows.reduce((m, r) => Math.max(m, r.depth), 0);
    const scale = Math.max(500, Math.ceil(deepest / 250) * 250);
    const sig = seated.map((r) => `${r.pid}:${r.name}`).join("|");
    if (box.dataset.sig !== sig) {
      // A new line-up: build the lanes once; later renders move them in place,
      // which is what lets the markers glide down instead of jumping.
      box.replaceChildren();
      box.appendChild(el("div", "kr-reef-axis"));
      const lanes = el("div", "kr-reef-lanes");
      seated.forEach((r) => {
        const lane = el("div", "kr-lane");
        lane.dataset.pid = r.pid;
        lane.appendChild(el("span", "kr-lane-name", r.name));
        const water = el("div", "kr-lane-water");
        const line = el("div", "kr-lane-line");
        line.appendChild(el("span", "kr-lane-marker"));
        water.appendChild(line);
        lane.appendChild(water);
        lanes.appendChild(lane);
      });
      box.appendChild(lanes);
      box.dataset.sig = sig;
    }
    const axis = box.querySelector(".kr-reef-axis");
    axis.replaceChildren();
    [0, scale / 2, scale].forEach((m) => axis.appendChild(el("span", null, `${numberText(m)} m`)));
    seated.forEach((r) => {
      const lane = box.querySelector(`.kr-lane[data-pid="${CSS.escape(r.pid)}"]`);
      if (!lane) return;
      lane.classList.toggle("is-lead", r.rank === 1 && r.depth > 0);
      lane.querySelector(".kr-lane-line").style.setProperty("--d", String(Math.round((r.depth / scale) * 1000) / 10));
      lane.querySelector(".kr-lane-marker").textContent = `${numberText(r.depth)} m`;
    });
  }

  /* ============ Setup ============ */

  function renderPlayers(state) {
    const list = $("kr-player-list");
    list.replaceChildren();
    state.setup.players.forEach((p) => {
      const li = el("li", "kr-player");
      li.appendChild(el("span", "kr-player-name", p.name));
      li.appendChild(el("span", "kr-player-kind", p.manual ? "host types" : "phone"));
      const rm = el("button", "kr-btn kr-btn-quiet kr-btn-sm", "Remove");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${p.name}`);
      rm.addEventListener("click", () => app().removePlayer(p.pid));
      li.appendChild(rm);
      list.appendChild(li);
    });
    if (!state.setup.players.length) {
      list.appendChild(el("li", "kr-hint", "Nobody yet. Open a room for phones, or add players by name."));
    }
    setText("kr-player-count", state.setup.players.length ? String(state.setup.players.length) : "");
  }

  const SETTING_FIELDS = [
    ["kr-set-seconds", (s) => s.promptSeconds], ["kr-set-prompts", (s) => s.promptsPerGame],
    ["kr-set-hearts", (s) => s.puffer.hearts], ["kr-set-max", (s) => s.puffer.maxHearts],
    ["kr-set-start", (s) => s.puffer.startSeconds], ["kr-set-floor", (s) => s.puffer.floorSeconds],
    ["kr-set-meter", (s) => s.puffer.meterForHeart], ["kr-set-cap", (s) => s.puffer.roundCap],
  ];

  function renderSettings(state) {
    const s = state.setup.settings;
    SETTING_FIELDS.forEach(([id, get]) => {
      const node = $(id);
      if (node && document.activeElement !== node) node.value = String(get(s));
    });
    const puffer = state.setup.mode === "puffer";
    $("kr-mode-deep").checked = !puffer;
    $("kr-mode-puffer").checked = puffer;
    show($("kr-rules-deep"), !puffer);
    show($("kr-rules-puffer"), puffer);
    show($("kr-set-points"), !puffer);
    renderPointInputs(s.tiers);
    $("kr-set-shuffle").checked = !!state.setup.shuffle;
  }

  /** One points field per tier of the loaded file (built once per tier list). */
  function renderPointInputs(tiers) {
    const box = $("kr-set-points");
    const sig = tiers.map((t) => `${t.id}:${t.name}`).join("|");
    if (box.dataset.sig !== sig) {
      box.replaceChildren();
      tiers.forEach((t) => {
        const label = el("label", "kr-num", `${t.name} `);
        const input = el("input", "kr-field");
        input.type = "number";
        input.min = "0";
        input.max = "10000";
        input.inputMode = "numeric";
        input.id = `kr-set-pt-${t.id}`;
        input.dataset.tier = t.id;
        label.appendChild(input);
        box.appendChild(label);
      });
      box.dataset.sig = sig;
    }
    tiers.forEach((t) => {
      const input = $(`kr-set-pt-${t.id}`);
      if (input && document.activeElement !== input) input.value = String(t.points);
    });
  }

  function setupWarning(state) {
    const n = state.setup.players.length;
    if (!state.game) return "Load some prompts before you start.";
    if (n < 2) return "Add at least two players to start.";
    if (n === 2) return "Two players works; three or more makes a better dive.";
    if (n > core().MAX_PLAYERS) return `${core().MAX_PLAYERS} players is the most Krillion can seat.`;
    return "";
  }

  function renderSetup(state) {
    setText("kr-source", state.source);
    setText("kr-prompt-count", state.game
      ? `${state.game.prompts.length} prompts with rated answers.` : "No prompts loaded yet.");
    renderPlayers(state);
    renderSettings(state);
    const warn = setupWarning(state);
    setText("kr-setup-warn", warn);
    const n = state.setup.players.length;
    $("btn-start").disabled = !state.game || n < 2 || n > core().MAX_PLAYERS;
    show($("btn-resume"), !!state.resumable);
  }

  /* ============ Intro and prompt ============ */

  function roundLine(c) {
    const cat = c.dive && c.dive.category ? ` · ${c.dive.category}` : "";
    return `Prompt ${c.round} of ${c.game.settings.promptsPerGame}${cat}`;
  }

  function renderIntro(state) {
    const c = state.core;
    setText("kr-intro-round", roundLine(c));
    setText("kr-intro-text", c.dive.text);
    $("btn-intro-undo").disabled = !c.history.length;
  }

  function renderTypeSelect(c) {
    const select = $("kr-type-who");
    const keep = select.value;
    const signature = c.players.map((p) => `${p.pid}:${p.name}`).join("|");
    if (select.dataset.sig !== signature) {
      select.replaceChildren();
      c.players.forEach((p) => {
        const o = el("option", null, p.manual ? p.name : `${p.name} (phone)`);
        o.value = p.pid;
        select.appendChild(o);
      });
      select.dataset.sig = signature;
    }
    const still = c.players.some((p) => p.pid === keep);
    const firstOpen = c.players.find((p) => p.manual && !Object.prototype.hasOwnProperty.call(c.dive.answers, p.pid));
    select.value = still && keep ? keep : (firstOpen ? firstOpen.pid : (c.players[0] || {}).pid || "");
  }

  function renderPrompt(state) {
    const c = state.core;
    setText("kr-prompt-round", roundLine(c));
    setText("kr-prompt-text", c.dive.text);
    const count = core().answeredCount(c);
    setText("kr-answered", `${count.done} / ${count.total} answered`);
    const chips = $("kr-chips");
    chips.replaceChildren();
    c.players.forEach((p) => {
      const done = Object.prototype.hasOwnProperty.call(c.dive.answers, p.pid);
      const li = el("li", `kr-chip-player${done ? " is-done" : ""}`);
      li.appendChild(el("span", "kr-chip-name", p.name));
      li.appendChild(el("span", "kr-chip-state", done ? "answered" : "waiting"));
      chips.appendChild(li);
    });
    renderTypeSelect(c);
    renderList(state, c, "kr-plist-box", "kr-plist", "btn-plist");
    $("kr-type-text").classList.toggle("kr-secret", !!state.hideTyping);
    $("kr-hide-typing").checked = !!state.hideTyping;
    const paused = c.clock && !Number.isFinite(c.clock.deadline);
    $("btn-pause").textContent = paused ? "Resume the clock" : "Pause the clock";
  }

  /* ============ Reveal ============ */

  /**
   * The judge's review. One row per off-list answer — the answer and each
   * player's exact text, the tier buttons, Not valid, Add to this question —
   * in a bounded list that scrolls inside itself, so judging never scrolls
   * the shared screen (K-2). Returns whether the queue is showing.
   */
  function renderQueue(state, c) {
    const queue = core().reviewQueue(c);
    const open = queue.length > 0 && c.dive.revealed === 0;
    show($("kr-queue-box"), open);
    const list = $("kr-queue");
    list.replaceChildren();
    if (!open) return false;
    const pending = queue.filter((g) => !g.ruled).length;
    setText("kr-queue-count", pending ? `${pending} to rule` : "all ruled");
    queue.forEach((g) => list.appendChild(queueRow(c, g)));
    return true;
  }

  function queueRow(c, g) {
    const li = el("li", `kr-queue-item${g.ruled ? " is-ruled" : ""}${g.remembered ? " is-remembered" : ""}`);
    li.dataset.group = g.id;
    const text = el("div", "kr-queue-text");
    text.appendChild(el("span", "kr-queue-answer", g.label));
    // Each player's exact text, so the judge rules on what was actually typed.
    text.appendChild(el("span", "kr-queue-who",
      g.pids.map((pid, i) => `${g.names[i]}: “${c.dive.answers[pid]}”`).join(" · ")));
    li.appendChild(text);
    const buttons = el("div", "kr-tier-buttons");
    tierButtons(buttons, core().tiersOf(c), g.tier,
      (tier) => app().dispatch({ type: "review", group: g.id, tier }));
    // A remembered answer is part of the question now: shown, no longer re-rulable.
    if (g.remembered) [...buttons.children].forEach((b) => { b.disabled = true; });
    li.appendChild(buttons);
    if (g.tier) li.appendChild(rememberButton(c, g.id, g.label));
    else li.appendChild(el("span", "kr-queue-spacer"));
    return li;
  }

  function rememberButton(c, group, label) {
    const known = !!core().matchFor(c, c.dive ? c.dive.index : c.puffer.index, label);
    const b = el("button", "kr-btn kr-btn-quiet kr-btn-sm kr-remember", known ? "On this question now" : "Add to this question");
    b.type = "button";
    b.disabled = known;
    b.addEventListener("click", () => app().dispatch({ type: "remember", group }));
    return b;
  }

  function groupCard(c, g, shown, place) {
    const li = el("li", `kr-group${shown ? " is-shown" : ""}${shown && g.tier === "krillion" ? " is-krillion" : ""}`
      + `${shown && !g.tier ? " is-miss" : ""}`);
    li.dataset.place = String(place);
    if (!shown) {
      li.appendChild(el("span", "kr-group-hidden", `${g.count} ${g.count === 1 ? "player" : "players"}`));
      return li;
    }
    li.appendChild(el("span", "kr-group-answer", g.label));
    li.appendChild(el("span", "kr-group-names", g.names.join(", ")));
    const foot = el("span", "kr-group-foot");
    foot.appendChild(el("span", `kr-badge${g.tier ? "" : " kr-badge-miss"}`,
      g.tier ? tierName(c, g.tier) : (g.noAnswer ? "No answer" : "Not valid")));
    foot.appendChild(el("span", "kr-group-points", g.tier ? `+${g.points}` : "0"));
    li.appendChild(foot);
    return li;
  }

  /** The host-only rated list, built only while it is switched on. */
  function renderList(state, c, boxId, listId, btnId) {
    const box = $(boxId || "kr-list-box");
    const btn = $(btnId || "btn-list");
    // In answers-private mode (kr-hostphone.js) the panel and its toggle are
    // not in the document at all, and the remembered switch is ignored.
    if (!box || !btn) return;
    const on = !!state.showList;
    show(box, on);
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Hide the rated list" : "Show the rated list";
    const list = $(listId || "kr-list");
    list.replaceChildren();
    if (!on) return;
    const index = c.dive ? c.dive.index : c.puffer.index;
    const answers = c.game.prompts[index].answers.concat(core().learnedFor(c, index));
    core().tiersOf(c).forEach((t) => {
      const words = answers.filter((a) => a.tier === t.id).map((a) => a.text);
      if (!words.length) return;
      const li = el("li", "kr-list-row");
      li.appendChild(el("span", "kr-list-tier", t.name));
      li.appendChild(el("span", "kr-list-words", words.join(", ")));
      list.appendChild(li);
    });
  }

  function revealState(c, pending, total) {
    if (pending) return `Rule ${pending} ${pending === 1 ? "answer" : "answers"} that ${pending === 1 ? "isn’t" : "aren’t"} on the list, then reveal.`;
    if (c.dive.revealed < total) return `${c.dive.revealed} of ${total} revealed — misses first, then surface to abyss.`;
    return "Everything is revealed.";
  }

  let lastRevealKey = "";

  function renderReveal(state) {
    const c = state.core;
    setText("kr-reveal-text", `${roundLine(c)} — ${c.dive.text}`);
    const order = core().revealOrder(c);
    const pending = core().pendingReviews(c);
    setText("kr-reveal-state", revealState(c, pending, order.length));
    // While the judge is ruling, the queue takes the whole stage: the answer
    // cards and the reef come back once the reveal walk starts.
    const judging = renderQueue(state, c);
    $("screen-reveal").classList.toggle("is-judging", judging);
    const groups = $("kr-groups");
    groups.replaceChildren();
    // Only the card that has just come up animates, and only on the render that revealed it.
    const revealKey = `${c.round}|${c.dive.index}|${c.dive.revealed}`;
    const fresh = revealKey !== lastRevealKey;
    lastRevealKey = revealKey;
    order.forEach((g, i) => {
      const card = groupCard(c, g, i < c.dive.revealed, i);
      if (fresh && i === c.dive.revealed - 1) card.classList.add("is-new");
      groups.appendChild(card);
    });
    groups.classList.toggle("is-tight", order.length > 8);
    setText("kr-tally", c.dive.revealed ? tallyText(c, true) : "");
    renderList(state, c);
    renderReef($("kr-reef"), core().depthBoard(c));
    const btn = $("btn-reveal");
    btn.disabled = pending > 0;
    btn.textContent = pending > 0 ? "Rule every answer first"
      : (c.dive.revealed < order.length ? "Reveal the next answer" : "Show the depth board");
  }

  /* ============ Depth board and result ============ */

  function renderDepth(state) {
    const c = state.core;
    const board = core().depthBoard(c);
    const lead = board.filter((r) => r.rank === 1);
    const last = c.round >= c.game.settings.promptsPerGame;
    setText("kr-depth-sub", `After prompt ${c.round} of ${c.game.settings.promptsPerGame} · `
      + `${lead.map((r) => r.name).join(" & ")} ${lead.length > 1 ? "share the lead" : "leads"} at ${numberText(lead[0].depth)} m`);
    setText("kr-depth-tally", `This prompt: ${tallyText(c, false)}`);
    renderReef($("kr-depth-reef"), board);
    $("btn-next-prompt").textContent = last ? "Final result" : "Next prompt";
  }

  function renderResult(state) {
    const c = state.core;
    const puffer = c.mode === "puffer";
    const rows = core().standings(c);
    const winners = rows.filter((r) => c.winners.indexOf(r.pid) >= 0);
    setText("kr-result-kicker", puffer ? "Puffer Party — last one floating" : "Deep Dive — deepest diver");
    setText("kr-winner", winners.map((r) => r.name).join(" & ") || "No winner");
    const top = winners[0];
    setText("kr-winner-sub", !top ? "" : (puffer
      ? `${top.hearts} ${top.hearts === 1 ? "heart" : "hearts"} left${winners.length > 1 ? " each" : ""}.`
      : `${numberText(top.depth)} m down${winners.length > 1 ? " — a shared win" : ""}.`));
    const list = $("kr-standings");
    list.replaceChildren();
    rows.forEach((r) => {
      const li = el("li", "kr-standing");
      li.appendChild(el("span", "kr-standing-rank", String(r.rank)));
      li.appendChild(el("span", "kr-standing-name", r.name));
      li.appendChild(el("span", "kr-standing-value", puffer
        ? (r.out ? "out" : `${r.hearts} ${r.hearts === 1 ? "heart" : "hearts"}`) : `${numberText(r.depth)} m`));
      list.appendChild(li);
    });
    $("btn-result-undo").disabled = !c.history.length;
  }

  /* ============ Whole page ============ */

  const RENDERERS = {
    setup: renderSetup, intro: renderIntro, prompt: renderPrompt, reveal: renderReveal,
    depth: renderDepth, result: renderResult,
    puffer: (s) => window.KrParty.render(s),
    editor: () => {},
  };

  // The bar carries the game name only (one bar in every game); where we are
  // in the game is on each screen's own round line (#kr-prompt-round, #kr-pround).
  function render(state) {
    const screen = screenFor(state);
    SCREENS.forEach((name) => show($(`screen-${name}`), name === screen));
    const sound = $("btn-sound");
    const on = window.KrSound.enabled();
    sound.textContent = on ? "Sound" : "Sound off";
    // The label rewrite wipes the icon, so it goes back on every render (docs/21 rule 9).
    if (window.GSCIcons) window.GSCIcons.prepend(sound, on ? "sound" : "sound-off");
    sound.setAttribute("aria-pressed", String(on));
    show($("kr-lobby-modal"), !!state.lobbyOpen);
    $("btn-game-lobby").disabled = !state.core && !state.resumable;
    if (screen === "setup" && state.core === null) renderSetup(state);
    else RENDERERS[screen](state);
  }

  return { render, screenFor, renderReef, tierButtons, rememberButton, renderList, tierName, numberText };
})();

window.KrView = KrView;
