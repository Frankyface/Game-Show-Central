/* ============================================================
   Weakest Link — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by wl-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...WlHostView.hostView(core)})
     — no cache, no resend: the SDK and the hub de-duplicate and hold it.
   • Answers-private mode (room.answersPrivate(), a property of the ROSTER,
     not of the connection — review F1): the host-only answer lines and the
     "Show answer" peek buttons are taken out of the document, and the
     remembered "Keep answers on screen" switch is hidden and ignored
     (F5: ignored, not cleared). In their place: "Answer is on your host
     phone", or — while no host phone is connected — "Host phone
     disconnected" and ONE "Show answer on this screen" button that reveals
     the current item only and clears when the item changes.
   • Seat reconciliation once, after the app has restored its save (§5.6).

   With no host phone assigned none of this touches the page: the answer
   line, the peek and keepAnswers behave exactly as before.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  /** Host-only nodes that may carry answer text, and the peeks that show them. */
  const ANSWER_NODES = ["wl-answer", "wl-final-answer", "btn-show-answer", "btn-final-show-answer"];
  const NOTE_CONNECTED = "Answer is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";

  let room = null;
  let privateMode = false;
  let phones = [];
  let parked = [];            // [{node, parent, next}] — detached while private
  let notes = [];             // one note block per answer row
  let revealedItem = null;    // the item the fallback button opened, or null
  let reconciled = false;

  const hv = () => window.WlHostView;
  const core = () => window.WlApp.core();

  /* ============ answers-private mode ============ */

  /** Take every answer-bearing node out of the document (kept for later). */
  function park() {
    ANSWER_NODES.forEach((id) => {
      const node = $id(id);
      if (!node || !node.isConnected) return;
      parked.push({ node, parent: node.parentNode, next: node.nextSibling });
      node.remove();
    });
    const keep = $id("wl-keep-answers");
    if (keep) {
      keep.disabled = true;
      const label = keep.closest("label");
      if (label) label.classList.add("hidden");
    }
  }

  /** Put them back (the last host phone was removed from the roster). */
  function unpark() {
    parked.slice().reverse().forEach(({ node, parent, next }) => {
      parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    });
    parked = [];
    const keep = $id("wl-keep-answers");
    if (keep) {
      keep.disabled = false;
      const label = keep.closest("label");
      if (label) label.classList.remove("hidden");
    }
    notes.forEach((n) => n.box.remove());
    notes = [];
    revealedItem = null;
  }

  /** One note block per answer row: the line, the fallback button, the reveal. */
  function buildNotes() {
    if (notes.length) return;
    document.querySelectorAll(".answer-row").forEach((row) => {
      const box = document.createElement("div");
      box.className = "hp-note";
      const text = document.createElement("p");
      text.className = "hp-note-text";
      text.setAttribute("role", "status");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-small hp-show";
      btn.textContent = "Show answer on this screen";
      btn.addEventListener("click", () => {
        revealedItem = hv().itemKey(core());
        paint();
        btn.blur();
      });
      const reveal = document.createElement("p");
      reveal.className = "answer hp-reveal hidden";
      box.appendChild(text);
      box.appendChild(btn);
      box.appendChild(reveal);
      row.appendChild(box);
      notes.push({ box, text, btn, reveal });
    });
  }

  function paint() {
    if (!privateMode) return;
    const c = core();
    const item = hv().itemKey(c);
    if (revealedItem !== null && revealedItem !== item) revealedItem = null; // next item: clear
    const answer = c ? hv().currentAnswer(c) : "";
    const connected = phones.some((p) => p.connected);
    const open = !connected && revealedItem === item && !!answer;
    notes.forEach(({ text, btn, reveal }) => {
      text.textContent = connected ? NOTE_CONNECTED : NOTE_AWAY;
      btn.classList.toggle("hidden", connected || !answer || open);
      reveal.textContent = open ? answer : "";
      reveal.classList.toggle("hidden", !open);
    });
  }

  function applyMode() {
    const want = !!(room && room.answersPrivate && room.answersPrivate());
    if (want && !privateMode) { privateMode = true; park(); buildNotes(); }
    else if (!want && privateMode) { privateMode = false; unpark(); window.WlApp.render(); }
    paint();
  }

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || !room.setHostView) return;
    room.setHostView(Object.assign(
      { t: "host", item: hv().itemKey(c), seq: c && Array.isArray(c.past) ? c.past.length : 0 },
      hv().hostView(c)
    ));
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative. (Standalone, the
   * room is closed at boot, so an empty roster would wrongly empty the list.)
   * Phone seats in the saved setup that are no longer in the room are dropped; a
   * running or parked game keeps such a seat, plays it phone-less (phoneView only
   * ever goes to room.players()) and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || !room.players) return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.WlApp.state();
    const keep = app.setup.players.filter((p) => p.manual !== false || live.has(p.pid));
    if (keep.length !== app.setup.players.length) {
      window.WlApp.set({ setup: Object.assign({}, app.setup, { players: keep }) });
    }
    const seated = (app.core && app.core.players) || (app.resumable && app.resumable.players) || [];
    const orphans = seated.filter((p) => !live.has(p.pid) && !/^m/.test(p.pid)).map((p) => p.name);
    if (orphans.length) {
      window.WlApp.error(`${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} no longer a player in this room`
        + " (now the host phone, or gone) — play their turns from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.WlApp.state().game) reconcile();
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
    window.WlApp.subscribe(onRender);
    onRender(core());
  }

  window.WlHostPhone = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();
