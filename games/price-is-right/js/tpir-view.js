/* ============================================================
   The Price Is Right — host rendering
   Everything that paints the host screens except the three
   pricing-game stages (tpir-games.js). Reads the app state,
   writes the DOM, and dispatches nothing except through
   window.TpirApp. Every string reaches the page through
   textContent — never innerHTML.

   The small DOM helpers ($, el, show, setText) live here because
   this file loads first; the games, editor, room and phone glue
   use the same four.
   ============================================================ */

"use strict";

/* ============ Tiny DOM helpers (shared with games/app/editor/room/phone) ============ */

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

/** A button that never keeps focus, so the host's next keypress reaches the page. */
function button(label, className, onClick) {
  const b = el("button", className || "btn btn-ghost", label);
  b.type = "button";
  if (onClick) b.addEventListener("click", (e) => { onClick(); if (e.currentTarget.blur) e.currentTarget.blur(); });
  return b;
}

const TpirView = (function () {
  const core = () => window.TpirCore;

  const SCREENS = ["setup", "row", "game", "showdown", "showcase", "standings"];

  /** Signatures so stable forms are not rebuilt (and typed digits not lost). */
  const built = { bids: "", showcase: "", drum: "" };
  let drumBusy = false;

  function phaseScreen(state) {
    if (!state) return "setup";
    return SCREENS.indexOf(state.phase) >= 0 ? state.phase : "setup";
  }

  function render(app) {
    const wanted = app.editorOpen ? "editor" : phaseScreen(app.core);
    SCREENS.forEach((name) => show($(`screen-${name}`), !app.editorOpen && name === wanted));
    show($("screen-editor"), app.editorOpen);
    renderChrome(app);
    if (app.editorOpen) return;
    const painters = {
      setup: renderSetup, row: renderRow, game: renderGame,
      showdown: renderShowdown, showcase: renderShowcase, standings: renderStandings,
    };
    if (painters[wanted]) painters[wanted](app);
  }

  /* ============ Chrome ============ */

  function renderChrome(app) {
    const state = app.core;
    const playing = !!state && state.phase !== "setup";
    show($("btn-undo"), playing && state.history.length > 0);
    show($("btn-finish"), playing && state.phase !== "standings");
    const chip = $("tpir-segment-chip");
    if (chip) {
      chip.textContent = segmentLabel(state);
      show(chip, !!chip.textContent);
    }
  }

  function segmentLabel(state) {
    if (!state || !state.plan) return "";
    const seg = core().currentSegment(state);
    if (!seg) return state.phase === "standings" ? "Standings" : "";
    const names = { row: "Row", game: "Pricing game", showdown: "Showdown", showcase: "Showcase" };
    const total = { row: state.plan.games, game: state.plan.games, showdown: state.plan.showdowns, showcase: 1 };
    return `${names[seg.t] || seg.t} ${seg.n} of ${total[seg.t]}`;
  }

  /* ============ Setup ============ */

  function renderSetup(app) {
    const list = $("tpir-player-list");
    list.replaceChildren();
    app.setup.players.forEach((p, i) => list.appendChild(playerRow(app, p, i)));
    setText("tpir-player-count", `${app.setup.players.length}/${core().MAX_PLAYERS}`);
    setText("tpir-source", app.source);
    renderSetupRules(app);
    $("btn-start").disabled = app.setup.players.length < 1 || !app.content;
  }

  function playerRow(app, p, i) {
    const li = el("li");
    li.appendChild(el("span", "player-seat", i + 1));
    li.appendChild(el("span", "player-name", p.name));
    li.appendChild(el("span", "player-tag", p.manual ? "host" : "phone"));
    const up = button("↑", "btn btn-ghost btn-small", () => window.TpirApp.movePlayer(p.pid, -1));
    up.disabled = i === 0;
    up.setAttribute("aria-label", `Move ${p.name} up`);
    const down = button("↓", "btn btn-ghost btn-small", () => window.TpirApp.movePlayer(p.pid, 1));
    down.disabled = i === app.setup.players.length - 1;
    down.setAttribute("aria-label", `Move ${p.name} down`);
    li.appendChild(up);
    li.appendChild(down);
    li.appendChild(button("Remove", "btn btn-ghost btn-small", () => window.TpirApp.removePlayer(p.pid)));
    return li;
  }

  function renderSetupRules(app) {
    const content = app.content;
    core().GAME_KINDS.forEach((kind) => {
      const box = $(`tpir-pg-${kind}`);
      if (!box) return;
      const have = content && Array.isArray(content[kind]) ? content[kind].length : 0;
      box.disabled = !have;
      box.checked = have > 0 && window.TpirApp.gameOn(kind);
    });
    setText("tpir-content-count", contentSummary(content));
    setText("tpir-plan-note", planNote(app));
  }

  function contentSummary(content) {
    if (!content) return "";
    const bits = [`${content.oneBid.length} One Bid items`];
    core().GAME_KINDS.forEach((kind) => {
      const n = Array.isArray(content[kind]) ? content[kind].length : 0;
      if (n) bits.push(`${n} ${core().GAME_LABELS[kind]} set${n === 1 ? "" : "s"}`);
    });
    bits.push(`${content.showcases.length} showcases`);
    const warnings = core().warningsFor(content);
    return `${bits.join(" · ")}${warnings.length ? ` — ${warnings.join(" ")}` : ""}`;
  }

  function planNote(app) {
    if (!app.content || !app.setup.players.length) return "Add at least one player to see the plan.";
    const p = core().plan(app.setup.players, window.TpirApp.effectiveSettings(),
      { oneBid: app.content.oneBid.length });
    return p.note;
  }

  /* ============ Contestants' Row ============ */

  function renderRow(app) {
    const state = app.core;
    const row = state.row;
    setText("tpir-row-kicker", `Contestants' Row — ${segmentLabel(state)}`);
    setText("tpir-row-sub", row.revealed
      ? (row.allOver ? "Everybody went over." : "The bids are in.")
      : "Bids stay hidden until the reveal.");
    setText("tpir-item-name", row.item ? row.item.name : "");
    setText("tpir-item-note", row.item ? row.item.note : "");
    const price = $("tpir-row-price");
    price.textContent = row.revealed && row.item ? `Actual retail price: ${core().formatMoney(state, row.item.price)}` : "";
    show(price, row.revealed);
    renderPodiums(app);
    renderBidForm(app);
    setText("tpir-row-notice", state.notice);
    show($("btn-reveal-bids"), !row.revealed);
    $("btn-reveal-bids").disabled = !row.order.length;
    show($("btn-rebid"), row.revealed && row.allOver);
    show($("btn-row-next"), row.revealed && !!row.result);
  }

  function renderPodiums(app) {
    const state = app.core;
    const box = $("tpir-podiums");
    box.replaceChildren();
    core().rowSeats(state).forEach((seat) => box.appendChild(podium(state, seat)));
  }

  function podium(state, seat) {
    const node = el("div", "gsc-podium tpir-podium");
    node.dataset.pid = seat.pid;
    if (seat.winner) node.classList.add("is-active", "is-winner");
    if (seat.over) node.classList.add("is-out");
    node.appendChild(el("span", "gsc-podium-name", seat.name));
    const value = el("span", "gsc-podium-score tpir-podium-bid");
    value.textContent = bidText(state, seat);
    node.appendChild(value);
    const note = el("span", "gsc-podium-note", podiumNote(state, seat));
    node.appendChild(note);
    return node;
  }

  function bidText(state, seat) {
    if (seat.bid !== null && seat.bid !== undefined) return core().formatMoney(state, seat.bid);
    if (seat.masked) return "•••";
    return "—";
  }

  function podiumNote(state, seat) {
    if (seat.winner) return "Comes on down!";
    if (seat.over) return "Over";
    if (seat.masked) return "Bid placed";
    if (state.row.revealed && seat.placed) return "Under";
    return seat.placed ? "" : "No bid yet";
  }

  /** One number field per seat. Rebuilt only when the seats change. */
  function renderBidForm(app) {
    const state = app.core;
    const form = $("tpir-bid-form");
    const seats = state.row.seats;
    const signature = `${state.segmentIndex}|${seats.join(",")}|${state.row.rebids}`;
    if (built.bids !== signature) {
      built.bids = signature;
      form.replaceChildren();
      seats.forEach((pid) => form.appendChild(bidField(state, pid, "bid")));
    }
    seats.forEach((pid) => paintBidField(app, form, pid, state.row.bids, state.row.revealed));
  }

  function bidField(state, pid, kind) {
    const wrap = el("label", "bid-field");
    wrap.dataset.pid = pid;
    wrap.appendChild(el("span", "bid-name", core().nameOf(state, pid)));
    const input = el("input", "bid-input");
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.dataset.pid = pid;
    input.dataset.kind = kind;
    input.placeholder = "$";
    wrap.appendChild(input);
    const send = button("Bid", "btn btn-gold btn-small bid-send", () => window.TpirApp.submitBid(pid, kind));
    send.dataset.pid = pid;
    wrap.appendChild(send);
    const take = button("Take over", "btn btn-ghost btn-small bid-take",
      () => window.TpirApp.takeOver(pid));
    take.dataset.pid = pid;
    wrap.appendChild(take);
    return wrap;
  }

  function paintBidField(app, form, pid, bids, revealed) {
    const wrap = form.querySelector(`.bid-field[data-pid="${pid}"]`);
    if (!wrap) return;
    const input = wrap.querySelector(".bid-input");
    const send = wrap.querySelector(".bid-send");
    const take = wrap.querySelector(".bid-take");
    const phone = window.TpirApp.hasPhone(pid) && !window.TpirApp.isTakenOver(pid);
    const placed = Object.prototype.hasOwnProperty.call(bids, pid);
    input.disabled = revealed || phone;
    send.disabled = revealed || phone;
    show(take, phone && !revealed);
    wrap.classList.toggle("is-placed", placed);
    wrap.classList.toggle("is-phone", phone);
    // A phone's bid is masked on the HOST screen too (the podium shows dots),
    // so the mirror field must stay blank until the reveal.
    if (placed && document.activeElement !== input) {
      input.value = phone && !revealed ? "" : String(bids[pid]);
    }
    if (!placed && !revealed && document.activeElement !== input && input.dataset.cleared !== "1") {
      input.value = "";
      input.dataset.cleared = "1";
    }
    if (placed) input.dataset.cleared = "0";
  }

  /* ============ Pricing game ============ */

  function renderGame(app) {
    const state = app.core;
    const g = state.game;
    const label = g.kind ? core().GAME_LABELS[g.kind] : "Pricing game";
    setText("tpir-game-title", label);
    setText("tpir-game-player", g.pid ? `${core().nameOf(state, g.pid)} is playing` : "");
    setText("tpir-game-score", g.pid ? core().formatMoney(state, core().winningsOf(state, g.pid)) : "");
    renderGamePick(app);
    window.TpirGames.render(app);
    setText("tpir-game-notice", state.notice);
    show($("btn-game-next"), !!g.done);
  }

  function renderGamePick(app) {
    const state = app.core;
    const box = $("tpir-game-pick");
    show(box, state.game.pending);
    if (!state.game.pending) { box.replaceChildren(); return; }
    box.replaceChildren();
    box.appendChild(el("p", "gsc-eyebrow", "Pick a pricing game"));
    state.content.settings.pricingGames.forEach((kind) => {
      const next = state.content.settings.pricingGames[state.rotation % state.content.settings.pricingGames.length];
      const name = core().GAME_LABELS[kind];
      const b = button(kind === next ? `${name} (next up)` : name,
        `btn ${kind === next ? "btn-gold" : "btn-ghost"} btn-big`,
        () => window.TpirApp.dispatch({ type: "pickGame", kind }));
      b.dataset.kind = kind;
      box.appendChild(b);
    });
  }

  /* ============ Showcase Showdown ============ */

  function renderShowdown(app) {
    const state = app.core;
    const sd = state.showdown;
    const wheel = state.content.settings.wheel;
    const svg = $("tpir-drum");
    const signature = wheel.join(",");
    if (built.drum !== signature) { built.drum = signature; window.TpirWheel.build(svg, wheel); }
    if (!drumBusy && sd.lastSpin) window.TpirWheel.showIndex(svg, sd.lastSpin.index, wheel.length);
    setText("tpir-sd-kicker", sd.spinoff ? `Spin-off — round ${sd.round}` : "Showcase Showdown");
    setText("tpir-sd-value", sd.lastSpin ? window.TpirWheel.label(sd.lastSpin.value) : "—");
    renderSpinners(app);
    renderShowdownControls(app);
    setText("tpir-sd-notice", state.notice);
  }

  function renderSpinners(app) {
    const state = app.core;
    const sd = state.showdown;
    const box = $("tpir-sd-spinners");
    box.replaceChildren();
    const active = core().activePid(state);
    sd.spinners.forEach((pid) => {
      const node = el("div", "gsc-podium tpir-spinner");
      node.dataset.pid = pid;
      const total = sd.totals[pid] || 0;
      if (pid === active) node.classList.add("is-active");
      if (total > core().WHEEL_TARGET) node.classList.add("is-out");
      if (sd.winner === pid) node.classList.add("is-winner");
      node.appendChild(el("span", "gsc-podium-name", core().nameOf(state, pid)));
      node.appendChild(el("span", "gsc-podium-score", window.TpirWheel.label(total)));
      node.appendChild(el("span", "gsc-podium-note", spinnerNote(sd, pid, total, active)));
      box.appendChild(node);
    });
    const current = active ? window.TpirWheel.label(sd.totals[active] || 0) : "—";
    setText("tpir-sd-total", current);
    setText("tpir-sd-sub", active
      ? `${core().nameOf(state, active)} is at the wheel.`
      : (sd.winner ? `${core().nameOf(state, sd.winner)} goes to the showcase.` : "Closest to a dollar without going over."));
  }

  function spinnerNote(sd, pid, total, active) {
    if (total > 100) return "Over a dollar";
    if (sd.winner === pid) return "To the showcase";
    const spins = (sd.spins[pid] || []).length;
    if (pid === active) return spins ? `Spin ${spins} taken` : "At the wheel";
    return spins ? `${spins} spin${spins === 1 ? "" : "s"}` : "Waiting";
  }

  function renderShowdownControls(app) {
    const sd = app.core.showdown;
    show($("btn-spin"), sd.awaiting === "spin");
    show($("btn-spin-again"), sd.awaiting === "decide");
    show($("btn-stay"), sd.awaiting === "decide");
    show($("btn-sd-next"), sd.awaiting === "done");
    $("btn-spin").disabled = !!app.busy;
  }

  /* ============ Showcase ============ */

  function renderShowcase(app) {
    const state = app.core;
    const sc = state.showcase;
    setText("tpir-sc-kicker", sc.revealed ? "The Showcase — the result" : "The Showcase");
    setText("tpir-sc-sub", showcaseSub(state, sc));
    renderShowcaseCards(app);
    renderShowcaseBids(app);
    setText("tpir-sc-notice", state.notice);
    show($("btn-sc-take"), !sc.chosen);
    show($("btn-sc-pass"), !sc.chosen);
    show($("btn-sc-reveal"), sc.chosen && !sc.revealed);
    $("btn-sc-reveal").disabled = !Object.keys(sc.bids).length;
    show($("btn-sc-next"), sc.revealed);
  }

  function showcaseSub(state, sc) {
    if (sc.revealed) return state.notice || "";
    if (!sc.chosen) return `${core().nameOf(state, sc.chooser)} decides: bid on the first showcase, or pass it over?`;
    return "One bid each. Closest without going over — and inside the margin wins both.";
  }

  function renderShowcaseCards(app) {
    const state = app.core;
    const sc = state.showcase;
    const box = $("tpir-sc-cards");
    box.replaceChildren();
    sc.pair.forEach((index, i) => {
      const showcase = state.content.showcases[index];
      if (!showcase) return;
      box.appendChild(showcaseCard(state, sc, showcase, i));
    });
  }

  function showcaseCard(state, sc, showcase, i) {
    const owner = Object.keys(sc.assignments).find((pid) => sc.assignments[pid] === sc.pair[i]);
    const card = el("article", "gsc-card sc-card");
    card.dataset.index = String(i);
    if (sc.result && sc.result.winner && owner === sc.result.winner) card.classList.add("is-winner");
    card.appendChild(el("p", "gsc-eyebrow", i === 0 ? "The first showcase" : "The second showcase"));
    card.appendChild(el("h3", "sc-owner", owner ? core().nameOf(state, owner) : "Not claimed yet"));
    const list = el("ul", "sc-prizes");
    showcase.prizes.forEach((p) => {
      const li = el("li");
      li.appendChild(el("span", "sc-prize-name", p.name));
      if (p.note) li.appendChild(el("span", "sc-prize-note", p.note));
      list.appendChild(li);
    });
    card.appendChild(list);
    const total = el("p", "sc-total");
    total.textContent = sc.revealed ? `Actual retail price: ${core().formatMoney(state, showcase.total)}` : "Total hidden";
    card.appendChild(total);
    return card;
  }

  function renderShowcaseBids(app) {
    const state = app.core;
    const sc = state.showcase;
    const form = $("tpir-sc-bids");
    const signature = `${sc.finalists.join(",")}|${sc.chosen}`;
    if (built.showcase !== signature) {
      built.showcase = signature;
      form.replaceChildren();
      if (sc.chosen) sc.finalists.forEach((pid) => form.appendChild(bidField(state, pid, "showcase")));
    }
    if (!sc.chosen) return;
    sc.finalists.forEach((pid) => paintBidField(app, form, pid, sc.bids, sc.revealed));
  }

  /* ============ Standings ============ */

  function renderStandings(app) {
    const state = app.core;
    const list = $("tpir-standings");
    list.replaceChildren();
    core().standings(state).forEach((row, i) => {
      const li = el("li", i === 0 && row.won > 0 ? "is-top" : null);
      li.appendChild(el("span", "stand-place", i + 1));
      li.appendChild(el("span", "stand-name", row.name));
      li.appendChild(el("span", "stand-won", core().formatMoney(state, row.won)));
      list.appendChild(li);
    });
    setText("tpir-standings-title", "Final standings");
  }

  /* ============ The wheel animation (the core has already decided) ============ */

  /** Claim the drum BEFORE the state lands, so the repaint does not snap it. */
  function beginSpin() { drumBusy = true; }

  function spinWheel(state, onDone) {
    const sd = state.showdown;
    const svg = $("tpir-drum");
    const wheel = state.content.settings.wheel;
    if (!sd.lastSpin || !svg) { drumBusy = false; onDone(); return; }
    window.TpirWheel.spin({
      svg, index: sd.lastSpin.index, count: wheel.length,
      onTick: () => window.TpirSound.play("tick"),
      onDone: () => { drumBusy = false; onDone(); },
    });
  }

  return { render, beginSpin, spinWheel, phaseScreen, segmentLabel, bidField, button, isDrumBusy: () => drumBusy };
})();

window.TpirView = TpirView;
