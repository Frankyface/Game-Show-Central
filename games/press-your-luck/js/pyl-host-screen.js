/* ============================================================
   Press Your Luck — host phone, shared-screen side
   (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by pyl-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...PylHostView.hostView(core)})
     — `seq` bumps only when the view's content changes; no cache, no
     resend: the SDK and the hub de-duplicate and hold it.
   • Answers-private mode (room.answersPrivate(), a property of the
     ROSTER, not of the connection — review F1). The shared screen never
     draws the right option before "Reveal the picks" anyway (the options
     stay covered until the buzz-in is judged, and nothing marks the
     correct one until the reveal), and this game has no host peek to
     remove. What private mode adds, while a question is unrevealed:
     "Answer is on your host phone", or — while no host phone is
     connected — "Host phone disconnected" and ONE "Show answer on this
     screen" button that reveals the current question's answer only and
     clears on the next question.
   • Seat reconciliation once, after the app has restored its save
     (§5.6, review F11), embedded only.

   With no host phone assigned none of this touches the page.
   ============================================================ */

"use strict";

(function () {
  const NOTE_CONNECTED = "Answer is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";

  let room = null;
  let privateMode = false;
  let phones = [];
  let note = null;            // {box, text, btn, reveal} — exists only in private mode
  let revealedItem = null;    // the item the fallback button opened, or null
  let reconciled = false;
  let seq = 0;
  let lastJson = "";

  const hv = () => window.PylHostView;
  const core = () => window.PylApp.core();

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || typeof room.setHostView !== "function") return;
    const view = hv().hostView(c);
    const json = JSON.stringify(view);
    if (json !== lastJson) { lastJson = json; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item: hv().itemKey(c), seq }, view));
  }

  /* ============ answers-private mode ============ */

  function buildNote() {
    if (note) return;
    const box = el("div", "hp-note hidden");
    box.id = "pyl-hp-note";
    const text = el("p", "hp-note-text");
    text.setAttribute("role", "status");
    const btn = el("button", "btn btn-ghost btn-small gsc-btn gsc-btn-ghost gsc-btn-sm hp-show", "Show answer on this screen");
    btn.type = "button";
    btn.id = "btn-hp-show-answer";
    btn.addEventListener("click", () => {
      revealedItem = hv().itemKey(core());
      paint();
      btn.blur();
    });
    const reveal = el("p", "hp-reveal hidden");
    reveal.id = "pyl-hp-reveal";
    box.appendChild(text);
    box.appendChild(btn);
    box.appendChild(reveal);
    const anchor = $("pyl-q-notice");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
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
    if (revealedItem !== null && revealedItem !== item) revealedItem = null; // the next question: clear
    const answer = hv().currentAnswer(c);
    const connected = phones.some((p) => p.connected);
    const open = !connected && revealedItem === item && !!answer;
    show(note.box, !!answer);                  // only while a question is unrevealed
    note.text.textContent = connected ? NOTE_CONNECTED : NOTE_AWAY;
    show(note.btn, !connected && !!answer && !open);
    // The answer text exists in the document ONLY while the fallback has opened it.
    note.reveal.textContent = open ? `Answer: ${answer}` : "";
    show(note.reveal, open);
  }

  function applyMode() {
    const want = !!(room && room.answersPrivate && room.answersPrivate());
    if (want && !privateMode) { privateMode = true; buildNote(); }
    else if (!want && privateMode) { privateMode = false; dropNote(); }
    paint();
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative (standalone,
   * the room is closed at boot, so an empty roster would wrongly empty the
   * seats). Phone seats in the saved setup whose pid is no longer a player in
   * the room are dropped; a running or parked game keeps such a seat, plays it
   * phone-less (phone views only ever go to room.players(), and the hub drops
   * anything a host phone sends) and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || !room || !room.players) return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.PylApp.state();
    const assign = {};
    Object.keys(app.setup.assign).forEach((pid) => { if (live.has(pid)) assign[pid] = app.setup.assign[pid]; });
    if (Object.keys(assign).length !== Object.keys(app.setup.assign).length) {
      window.PylApp.set({ setup: Object.assign({}, app.setup, { assign }) });
    }
    const seated = (app.core && app.core.players) || (app.resumable && app.resumable.players) || [];
    const orphans = seated.filter((p) => p.pid && !live.has(p.pid)).map((p) => p.name);
    if (orphans.length) {
      window.PylApp.error(`${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} no longer a player in this room`
        + " (now the host phone, or gone) — play their turns from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.PylApp.state().game) reconcile();
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
    window.PylApp.subscribe(onRender);
    onRender(core());
  }

  window.PylHostScreen = {
    attach, onHostPhones,
    isPrivate: () => privateMode,
    seq: () => seq,
    NOTE_CONNECTED, NOTE_AWAY,
  };
})();
