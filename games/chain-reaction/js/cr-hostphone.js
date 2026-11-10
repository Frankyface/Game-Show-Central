/* ============================================================
   Chain Reaction — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by cr-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...CrHostView.hostView(core)}).
     `seq` bumps only when the view's content changes. No cache and no
     resend: the SDK and the hub de-duplicate and hold it.
   • Answers-private mode (room.answersPrivate(), a property of the ROSTER,
     not of the connection): the board already never draws a hidden letter,
     so the one host-only answer line is Peek — it is hidden and held off.
     In its place: "Answer is on your host phone", or, while no host phone is
     connected, "Host phone disconnected" and ONE "Show answer on this
     screen" button that shows the word in play only and clears when that
     word changes (a judgement, the other end, the next Speed Chain word).
   • Seat reconciliation once, after the app has restored its save (§5.6).

   With no host phone assigned none of this touches the page: Peek behaves
   exactly as before.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  const NOTE_CONNECTED = "Answer is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";
  /** Where a note goes on each screen that can hold a secret. */
  const NOTE_HOMES = ["cr-peek-word", "cr-speed-result", "cr-sudden-notice"];

  let room = null;
  let privateMode = false;
  let phones = [];
  let notes = [];             // [{box, text, btn, reveal}]
  let revealedItem = null;    // the item the fallback button opened, or null
  let reconciled = false;
  let lastJson = "";
  let seq = 0;

  const hv = () => window.CrHostView;
  const core = () => window.CrApp.core();

  /* ============ answers-private mode ============ */

  /** Peek is the shared screen's only way to show a hidden word: take it away. */
  function holdPeek(on) {
    ["btn-peek", "cr-peek-word"].forEach((id) => {
      const node = $id(id);
      if (node) node.classList.toggle("hidden", on);
    });
    if (on && window.CrApp.state().peek) window.CrApp.set({ peek: false });
  }

  function buildNote(home) {
    const box = document.createElement("div");
    box.className = "hp-note";
    const text = document.createElement("p");
    text.className = "hp-note-text";
    text.setAttribute("role", "status");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm hp-show";
    btn.textContent = "Show answer on this screen";
    btn.addEventListener("click", () => {
      revealedItem = hv().itemKey(core());
      paint();
      btn.blur();
    });
    const reveal = document.createElement("p");
    reveal.className = "hp-reveal hidden";
    box.appendChild(text);
    box.appendChild(btn);
    box.appendChild(reveal);
    home.parentNode.insertBefore(box, home.nextSibling);
    return { box, text, btn, reveal };
  }

  function buildNotes() {
    if (notes.length) return;
    NOTE_HOMES.forEach((id) => { const home = $id(id); if (home) notes.push(buildNote(home)); });
  }

  function dropNotes() {
    notes.forEach((n) => n.box.remove());
    notes = [];
    revealedItem = null;
  }

  function paint() {
    if (!privateMode) return;
    const c = core();
    const item = hv().itemKey(c);
    if (revealedItem !== null && revealedItem !== item) revealedItem = null; // next item: clear
    const answer = c ? hv().currentAnswer(c) : "";
    const connected = phones.some((p) => p.connected);
    const open = !connected && revealedItem === item && !!answer;
    notes.forEach(({ box, text, btn, reveal }) => {
      box.classList.toggle("hidden", !answer && !hv().hostView(c).secret);
      text.textContent = connected ? NOTE_CONNECTED : NOTE_AWAY;
      btn.classList.toggle("hidden", connected || !answer || open);
      reveal.textContent = open ? `The word is ${answer}` : "";
      reveal.classList.toggle("hidden", !open);
    });
  }

  function applyMode() {
    const want = !!(room && room.answersPrivate && room.answersPrivate());
    if (want && !privateMode) { privateMode = true; holdPeek(true); buildNotes(); }
    else if (!want && privateMode) { privateMode = false; holdPeek(false); dropNotes(); window.CrApp.render(); }
    paint();
  }

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || !room.setHostView) return;
    const view = hv().hostView(c);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }   // seq moves only on a content change
    room.setHostView(Object.assign({ t: "host", item: hv().itemKey(c), seq }, view));
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative (standalone,
   * the room is closed at boot and an empty roster would wrongly empty the
   * teams). A phone the setup put on a team that is no longer a player in this
   * room is taken off the team; a running or parked game keeps the seat — its
   * team simply plays from the shared screen, since phoneView only ever goes to
   * room.players() — and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || !room.players) return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.CrApp.state();
    const assign = {};
    Object.keys(app.setup.assign || {}).forEach((pid) => { if (live.has(pid)) assign[pid] = app.setup.assign[pid]; });
    if (Object.keys(assign).length !== Object.keys(app.setup.assign || {}).length) {
      window.CrApp.set({ setup: Object.assign({}, app.setup, { assign }) });
    }
    const game = app.core || app.resumable;
    if (!game || !Array.isArray(game.teams)) return;
    const teams = game.teams.filter((t) => t.pids.some((pid) => !live.has(pid))).map((t) => t.name);
    if (teams.length) {
      window.CrApp.error(`A phone on ${teams.join(" and ")} is no longer a player in this room `
        + "(now the host phone, or gone) — that team plays from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.CrApp.state().game) reconcile();
    if (privateMode && window.CrApp.state().peek) window.CrApp.set({ peek: false });
    pushHostView(c);
    paint();
  }

  function onHostPhones(list) {
    phones = Array.isArray(list) ? list : [];
    applyMode();
  }

  function attach(r) {
    room = r;
    phones = room.hostPhones ? room.hostPhones() : [];
    applyMode();
    window.CrApp.subscribe(onRender);
    onRender(core());
  }

  window.CrHostPhone = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();
