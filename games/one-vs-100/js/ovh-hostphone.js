/* ============================================================
   1 vs 100 — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by ovh-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...OvhHostView.hostView(core)})
     — `seq` moves only when the view's CONTENT changes; no cache, no
     resend: the SDK and the hub de-duplicate and hold the view.
   • Answers-private mode (room.answersPrivate(): a property of the
     ROSTER, not of the connection — review F1). This game never draws
     the right option before the reveal anyway; what private mode adds:
       – "Answer is on your host phone" under the options, or, while no
         host phone is connected, "Host phone disconnected" and ONE
         "Show answer on this screen" button that reveals the current
         question only and clears on the next one;
       – Ask the Mob names its two members neutrally (ovh-view.js asks
         isPrivate()), instead of labelling one of them "right".
   • Seat reconciliation once, after the app has restored its save (§5.6).

   With no host phone assigned none of this touches the page.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  const NOTE_CONNECTED = "Answer is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";

  let room = null;
  let privateMode = false;
  let phones = [];
  let note = null;            // {box, text, btn, reveal}
  let revealedItem = null;    // the item the fallback button opened, or null
  let reconciled = false;
  let lastContent = null;     // JSON of the last view's content, for `seq`
  let seq = 0;

  const hv = () => window.OvhHostView;
  const core = () => window.OvhApp.core();

  /* ============ answers-private mode ============ */

  function buildNote() {
    if (note) return;
    const anchor = $id("ovh-options");
    if (!anchor || !anchor.parentNode) return;
    const box = document.createElement("div");
    box.className = "hp-note hidden";
    box.id = "ovh-hp-note";
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
    reveal.className = "hp-reveal hidden";
    box.appendChild(text);
    box.appendChild(btn);
    box.appendChild(reveal);
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    note = { box, text, btn, reveal };
  }

  function dropNote() {
    if (note) note.box.remove();
    note = null;
    revealedItem = null;
  }

  function paint() {
    if (!privateMode || !note) return;
    const c = core();
    const item = hv().itemKey(c);
    if (revealedItem !== null && revealedItem !== item) revealedItem = null;   // next item: clear
    const answer = c ? hv().currentAnswer(c) : "";
    const connected = phones.some((p) => p.connected);
    const open = !connected && !!answer && revealedItem === item;
    note.box.classList.toggle("hidden", !answer);
    note.text.textContent = connected ? NOTE_CONNECTED : NOTE_AWAY;
    note.btn.classList.toggle("hidden", connected || !answer || open);
    note.reveal.textContent = open ? `Answer: ${answer}` : "";
    note.reveal.classList.toggle("hidden", !open);
  }

  function applyMode() {
    const want = !!(room && room.answersPrivate && room.answersPrivate());
    if (want && !privateMode) { privateMode = true; buildNote(); window.OvhApp.render(); }
    else if (!want && privateMode) { privateMode = false; dropNote(); window.OvhApp.render(); }
    paint();
  }

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || !room.setHostView) return;
    const content = hv().hostView(c);
    const key = JSON.stringify(content);
    if (key !== lastContent) { lastContent = key; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: hv().itemKey(c), seq }, content));
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative. (Standalone the
   * room is closed at boot, so an empty roster would wrongly empty the list.)
   * Phone seats in the saved setup that are no longer in the room are dropped.
   * A running or parked game keeps such a seat and plays it phone-less (views
   * only ever go to room.players()), and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || !room.players) return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.OvhApp.state();
    const keep = app.setup.players.filter((p) => p.manual || live.has(p.pid));
    if (keep.length !== app.setup.players.length) {
      const contestant = keep.some((p) => p.pid === app.setup.contestant)
        ? app.setup.contestant : (keep[0] ? keep[0].pid : null);
      window.OvhApp.set({ setup: Object.assign({}, app.setup, { players: keep, contestant }) });
    }
    const manual = new Set(app.setup.players.filter((p) => p.manual).map((p) => p.pid));
    const seated = [].concat(app.core ? app.core.roster : [], app.stashed ? app.stashed.roster : []);
    const orphans = [...new Set(seated.filter((p) => !live.has(p.pid) && !manual.has(p.pid)).map((p) => p.name))];
    if (orphans.length) {
      window.OvhApp.error(`${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} no longer a player in this room`
        + " (now the host phone, or gone). The game keeps the seat: lock the contestant's answers from this screen,"
        + " and a Mob seat with no phone counts as not answering. Or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.OvhApp.state().game) reconcile();
    pushHostView(c);
    if (privateMode && !note) buildNote();
    paint();
  }

  function onHostPhones(list) {
    phones = Array.isArray(list) ? list : [];
    applyMode();
  }

  function attach(r) {
    room = r;
    phones = room.hostPhones ? room.hostPhones() : [];
    window.OvhApp.subscribe(onRender);
    applyMode();
    onRender(core());
  }

  window.OvhHostPhone = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();
