/* ============================================================
   Pyramid — host phone, shared-screen side (docs/22 §5.2, §5.4, §5.6)

   attach(room) is called by pyr-room.js once GSC.host() resolves.
   From then on, on every state change:

   • room.setHostView({t:"host", item, seq, ...PyrHostView.hostView(core)}).
     No cache and no resend — the SDK and the hub de-duplicate and hold
     it. `seq` bumps only when the content changes, never on a repaint.

   • Answers-private mode (room.answersPrivate() — a property of the
     ROSTER, not the connection, review F1). Pyramid's secret is the
     giver's words, and the "Show words to me" / "Study" panel exists so
     a giver WITHOUT a phone can read them (review F6). So:
       – while the current giver has a connected phone, no word is built
         on the shared screen at all: pyr-view.js asks lockWords() before
         it creates the panel or a Winner's Circle subject, the remembered
         reveal switch is ignored (not cleared), and the reveal / study
         buttons are hidden. In their place: "Words are on your host
         phone", or — while no host phone is connected — "Host phone
         disconnected" and ONE "Show answer on this screen" button that
         reveals the current word (or subject) only and clears on the next;
       – while the current giver has NO connected phone, the panel stays
         exactly as it was: behind its click and its shared-screen warning.
     Public reveals — the word list after a round, the subjects after the
     circle — are part of the show and unchanged.

   • Seat reconciliation once, after the app has restored its save (§5.6).

   With no host phone assigned none of this touches the page.
   New code only; every node is built with createElement + textContent.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  const NOTE_WORDS = "Words are on your host phone";
  const NOTE_SUBJECT = "The subject is on your host phone";
  const NOTE_AWAY = "Host phone disconnected";
  const FALLBACK = "Show answer on this screen";

  let room = null;
  let privateMode = false;
  let phones = [];
  let revealedItem = null;   // the item the fallback button opened, or null
  let reconciled = false;
  let seq = 0;
  let lastContent = "";
  const notes = {};          // where -> {box, text, btn, reveal}

  const hv = () => window.PyrHostView;
  const core = () => (window.PyrApp ? window.PyrApp.core() : null);

  /* ============ who holds the secret right now ============ */

  /** The giver whose secret is on the table, or null when none is. */
  function giverPid(c) {
    if (!c) return null;
    if (c.phase === "play" && c.round && !c.round.finished) return c.round.giverPid;
    if (c.phase === "circle" && c.circle && !c.circle.finished) return c.circle.giverPid;
    return null;
  }

  /** Does the current giver have a phone in this room that is up right now? */
  function giverHasPhone(c) {
    const pid = giverPid(c);
    if (!pid || !room || typeof room.players !== "function") return false;
    return room.players().some((p) => p.pid === pid && !p.manual && p.connected !== false);
  }

  const hostLive = () => phones.some((p) => p.connected);

  /**
   * Asked by pyr-view.js before it builds any word or subject on the shared
   * screen. True only in answers-private mode while the giver can read their
   * own phone — the one case where nobody in the room needs the panel.
   */
  function lockWords() {
    return privateMode && giverHasPhone(core());
  }

  /* ============ the notes beside the play and circle columns ============ */

  function buildNote(where, parentId) {
    if (notes[where]) return;
    const parent = $id(parentId);
    if (!parent) return;
    const box = document.createElement("div");
    box.className = "hp-note hidden";
    box.id = `pyr-hp-${where}`;
    const text = document.createElement("p");
    text.className = "hp-note-text";
    text.setAttribute("role", "status");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `btn-hp-${where}-show`;
    btn.className = "btn btn-ghost hp-show";
    btn.textContent = FALLBACK;
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
    const anchor = $id(where === "play" ? "pyr-play-notice" : "pyr-circle-notice");
    parent.insertBefore(box, anchor && anchor.parentNode === parent ? anchor.nextSibling : parent.firstChild);
    notes[where] = { box, text, btn, reveal };
  }

  function dropNotes() {
    Object.keys(notes).forEach((k) => { notes[k].box.remove(); delete notes[k]; });
    revealedItem = null;
  }

  /** Hide or restore the controls that would put a word on the shared screen. */
  function setRevealControls(locked) {
    ["btn-reveal-words", "btn-study", "btn-circle-reveal"].forEach((id) => {
      const node = $id(id);
      if (node) node.classList.toggle("hidden", locked);
    });
  }

  function paintNote(where, c, locked, item) {
    const note = notes[where];
    if (!note) return;
    const here = c && c.phase === where && locked;
    note.box.classList.toggle("hidden", !here);
    if (!here) { note.reveal.textContent = ""; return; }
    const answer = hv().currentAnswer(c);
    const live = hostLive();
    const open = !live && revealedItem === item && !!answer;
    note.text.textContent = live ? (where === "play" ? NOTE_WORDS : NOTE_SUBJECT) : NOTE_AWAY;
    note.btn.classList.toggle("hidden", live || !answer || open);
    note.reveal.textContent = open ? answer : "";
    note.reveal.classList.toggle("hidden", !open);
    // The view's own line ("The word is on Ada's phone…") would sit beside
    // ours and say something else; the note carries the message instead.
    const line = $id(where === "play" ? "pyr-play-notice" : "pyr-circle-notice");
    if (line) { line.textContent = ""; line.classList.remove("notice-warn"); }
  }

  function paint() {
    if (!privateMode) return;
    const c = core();
    const item = hv().itemKey(c);
    if (revealedItem !== null && revealedItem !== item) revealedItem = null;   // next item: clear
    const locked = lockWords();
    setRevealControls(locked);
    paintNote("play", c, locked, item);
    paintNote("circle", c, locked, item);
  }

  function applyMode() {
    const want = !!(room && typeof room.answersPrivate === "function" && room.answersPrivate());
    if (want && !privateMode) {
      privateMode = true;
      buildNote("play", "pyr-play-word-col");
      buildNote("circle", "pyr-circle-board-col");
    } else if (!want && privateMode) {
      privateMode = false;
      dropNotes();
      setRevealControls(false);
    }
    refresh();
  }

  /* ============ the host view ============ */

  function pushHostView(c) {
    if (!room || typeof room.setHostView !== "function") return;
    const item = hv().itemKey(c);
    const view = hv().hostView(c);
    const content = JSON.stringify([item, view]);
    if (content !== lastContent) { lastContent = content; seq += 1; }
    room.setHostView(Object.assign({ t: "host", item, seq }, view));
  }

  /* ============ seat reconciliation (§5.6, review F11) ============ */

  /**
   * Embedded only: there the roster from init is authoritative (standalone,
   * the room is closed at boot and an empty roster would empty the list).
   * Phone seats in the saved setup that are no longer in the room are
   * dropped; a running or parked game keeps such a seat, plays it
   * phone-less (phoneView only ever goes to room.players(), and lockWords()
   * sees no phone, so the giver panel stays available) and says so once.
   */
  function reconcile() {
    reconciled = true;
    if (!window.GSC || window.GSC.mode !== "embed-host" || typeof room.players !== "function") return;
    const live = new Set(room.players().map((p) => p.pid));
    const app = window.PyrApp.state();
    const typed = new Set(app.setup.players.filter((p) => p.manual !== false).map((p) => p.pid));
    const players = app.setup.players.filter((p) => p.manual !== false || live.has(p.pid));
    if (players.length !== app.setup.players.length) {
      const gone = new Set(app.setup.players.filter((p) => players.indexOf(p) < 0).map((p) => p.pid));
      const seats = app.setup.seats.map((pair) => pair.map((pid) => (gone.has(pid) ? "" : pid)));
      window.PyrApp.set({ setup: Object.assign({}, app.setup, { players, seats }) });
    }
    const game = app.core || app.resumable;
    const seated = game ? game.teams.reduce((all, t) => all.concat(t.members), []) : [];
    const orphans = seated.filter((m) => !live.has(m.pid) && !typed.has(m.pid) && !/^y/.test(m.pid))
      .map((m) => m.name);
    if (orphans.length) {
      window.PyrApp.error(`${orphans.join(", ")} ${orphans.length === 1 ? "is" : "are"} no longer a player`
        + " in this room (now the host phone, or gone) — play their turns from this screen, or start a new game.");
    }
  }

  /* ============ wiring ============ */

  function onRender(c) {
    if (!reconciled && window.PyrApp.state().game) reconcile();
    pushHostView(c);
    paint();
  }

  /** A giver's phone came or went: the lock may have changed with no state change. */
  function refresh() {
    if (window.PyrApp && typeof window.PyrApp.render === "function") window.PyrApp.render();
  }

  function onHostPhones(list) {
    phones = Array.isArray(list) ? list : [];
    applyMode();
  }

  function attach(r) {
    room = r;
    phones = typeof room.hostPhones === "function" ? room.hostPhones() : [];
    window.PyrApp.subscribe(onRender);
    applyMode();
  }

  window.PyrHostPhone = {
    attach, onHostPhones, refresh, lockWords,
    isPrivate: () => privateMode,
    NOTE_WORDS, NOTE_SUBJECT, NOTE_AWAY, FALLBACK,
  };
})();
