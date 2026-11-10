/* ============================================================
   Millionaire — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by wwm-room.js once GSC.host() resolves.
   From then on, on every render:

   • room.setHostView({t:"host", item, seq, ...WwmHostView.hostView(core)})
     — no cache and no resend: the SDK and the hub de-duplicate and hold
     it. `seq` bumps only when the view's content changes.
   • Answers-private mode (room.answersPrivate(): a property of the ROSTER,
     not of the connection). The shared screen never marks the correct
     option before the paced reveal anyway; what this adds is the line
     under the options / the Fastest Finger items: "Answer is on your host
     phone", or — while no host phone is connected — "Host phone
     disconnected" and ONE "Show answer on this screen" button that reveals
     the current item's answer only and clears on the next item. The
     editor's question rows (which mark every answer) are emptied when the
     editor closes while a game runs.
   • Seat reconciliation once after boot, embedded only (§5.6, review F11).

   With no host phone assigned none of this touches the page.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);
  const NOTE_CONNECTED = "Answer is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";

  /** Where a note goes: the hot-seat stage and the Fastest Finger column. */
  const SLOTS = [
    { kind: "question", after: "wwm-options" },
    { kind: "fff", after: "wwm-fff-arrivals" },
  ];

  let room = null;
  let privateMode = false;
  let phones = [];
  let notes = [];             // [{kind, box, text, btn, reveal}]
  let revealedKey = null;     // the item the fallback button opened, or null
  let reconciled = false;
  let lastContent = "";
  let seq = 0;

  const hv = () => window.WwmHostView;
  const core = () => window.WwmApp.core();

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || typeof room.setHostView !== "function") return;
    const view = hv().hostView(c);
    const content = JSON.stringify(view);
    if (content !== lastContent) { lastContent = content; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: hv().item(c), seq }, view));
  }

  /* ============ answers-private mode ============ */

  function buildNote(slot) {
    const anchor = $id(slot.after);
    if (!anchor) return null;
    const box = document.createElement("div");
    box.className = "hp-note hidden";
    const text = document.createElement("p");
    text.className = "hp-note-text";
    text.setAttribute("role", "status");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-small hp-show";
    btn.textContent = "Show answer on this screen";
    btn.addEventListener("click", () => {
      revealedKey = hv().itemKey(core());
      paint();
      btn.blur();
    });
    const reveal = document.createElement("p");
    reveal.className = "hp-reveal hidden";
    box.appendChild(text);
    box.appendChild(btn);
    box.appendChild(reveal);
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return { kind: slot.kind, box, text, btn, reveal };
  }

  function paint() {
    if (!privateMode) return;
    const c = core();
    const key = hv().itemKey(c);
    if (revealedKey !== null && revealedKey !== key) revealedKey = null;   // next item: clear
    const kind = hv().kindOf(c);
    const answer = c ? hv().fallbackAnswer(c) : "";
    const connected = phones.some((p) => p.connected);
    const open = !connected && revealedKey === key && !!answer;
    notes.forEach((n) => {
      const live = n.kind === kind && !!answer;     // only while the item is still secret
      n.box.classList.toggle("hidden", !live);
      n.text.textContent = live ? (connected ? NOTE_CONNECTED : NOTE_AWAY) : "";
      n.btn.classList.toggle("hidden", !live || connected || open);
      n.reveal.textContent = live && open ? answer : "";
      n.reveal.classList.toggle("hidden", !(live && open));
    });
  }

  function applyMode() {
    const want = !!(room && typeof room.answersPrivate === "function" && room.answersPrivate());
    if (want && !privateMode) {
      privateMode = true;
      notes = SLOTS.map(buildNote).filter(Boolean);
    } else if (!want && privateMode) {
      privateMode = false;
      notes.forEach((n) => n.box.remove());
      notes = [];
      revealedKey = null;
    }
    paint();
  }

  /**
   * The editor's rows mark every question's answer (a checked radio) and every
   * Fastest Finger order (selected values). They are rebuilt each time the
   * editor opens, so empty them as soon as it closes while a game runs.
   */
  function clearClosedEditor() {
    const app = window.WwmApp.state();
    if (!privateMode || app.editorOpen || !app.core) return;
    ["wwm-ed-rows", "wwm-ed-fff"].forEach((id) => {
      const node = $id(id);
      if (node && node.childElementCount) node.replaceChildren();
    });
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative (standalone,
   * the room is closed at boot, so an empty roster would empty the list).
   * Phone seats in the saved setup that are no longer players are dropped; a
   * running or parked game keeps such a seat, plays it phone-less (phoneView
   * only ever goes to room.players()) and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || typeof room.players !== "function") return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.WwmApp.state();
    const keep = app.setup.players.filter((p) => p.manual !== false || live.has(p.pid));
    if (keep.length !== app.setup.players.length) {
      window.WwmApp.set({ setup: Object.assign({}, app.setup, { players: keep }) });
    }
    const manual = new Set(app.setup.players.filter((p) => p.manual !== false).map((p) => p.pid));
    const game = app.core || app.resumable;
    const seated = game && Array.isArray(game.contestants) ? game.contestants : [];
    const orphans = seated.filter((c) => !live.has(c.pid) && !manual.has(c.pid) && !/^m/.test(c.pid));
    if (orphans.length) {
      const names = orphans.map((c) => c.name).join(", ");
      window.WwmApp.error(`${names} ${orphans.length === 1 ? "is" : "are"} no longer a player in this room`
        + " (now the host phone, or gone) — play their turns from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.WwmApp.state().game) reconcile();
    pushHostView(c);
    paint();
    clearClosedEditor();
  }

  function onHostPhones(list) {
    phones = Array.isArray(list) ? list : [];
    applyMode();
  }

  function attach(r) {
    room = r;
    phones = typeof room.hostPhones === "function" ? room.hostPhones() : [];
    applyMode();
    window.WwmApp.subscribe(onRender);
    onRender(core());
  }

  window.WwmHostPhone = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    seq: () => seq,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();
