/* ============================================================
   Press Your Luck — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into a list the host can seat, validates every phone payload
   through the pure core before it touches state, and pushes each
   phone the ONE view it is allowed to see (PylCore.phoneView).

   The host stays authoritative. A phone can buzz, lock in a pick,
   press STOP when it is their turn, and pass their spins — four
   intents, each of them re-checked inside the reducer. Judging a
   buzz-in and revealing the picks are the host's alone.

   While the travelling light is in the air the phones are sent
   the view from BEFORE the press, so a phone can never read the
   result a second before the board shows it.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;
  let lastTitle = null;   // the shell only hears about a change
  let lastScores = null;

  const core = () => window.PylCore;

  /* ============ Roster ============ */

  function syncPlayers() {
    if (!room || !room.players) return;
    window.PylApp.setPlayers(room.players()
      .filter((p) => !p.manual)
      .map((p) => ({ pid: p.pid, name: p.name, connected: p.connected !== false })));
  }

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    syncPlayers();
    pushViews(window.PylApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    syncPlayers();
    if (connected) pushViews(window.PylApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    syncPlayers();
  }

  /* ============ Inbound: intents only ============ */

  /**
   * Each entry turns one validated phone message into at most one reducer
   * event — and returns null when this phone is not allowed to ask for it.
   * Every one of these is checked AGAIN inside the reducer.
   */
  const INTENTS = {
    buzz: (pid, msg, state) => (core().buzzOpen(state) && state.q.armed ? { type: "buzz", pid } : null),
    pick: (pid, msg, state) => (core().picksOpen(state) ? { type: "pick", pid, idx: msg.idx } : null),
    stop: (pid, msg, state) => (
      core().canStop(state) && core().seatOf(state, pid) === state.control ? { type: "stop", pid } : null),
    pass: (pid, msg, state) => (
      core().seatOf(state, pid) === state.control ? { type: "pass", to: msg.to } : null),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.PylApp.core();
    if (!state) return;
    if (window.PylApp.spin()) return;       // the light is still travelling
    const build = Object.prototype.hasOwnProperty.call(INTENTS, msg.t) ? INTENTS[msg.t] : null;
    if (!build) return;
    const event = build(pid, msg, state);
    if (!event) return;
    // STOP runs the same choreography as the host's own button.
    if (event.type === "stop") window.PylApp.press();
    else window.PylApp.dispatch(event);
  }

  /* ============ Outbound: one view per phone ============ */

  function pushViews(state) {
    if (!room || !room.players) return;
    // Mid-spin the phones see the board as it stood before the press.
    const spin = window.PylApp.spin();
    const shown = spin ? spin.frozen : state;
    room.players().forEach((p) => {
      if (p.manual) return;
      const view = shown
        ? Object.assign({ t: "view" }, core().phoneView(shown, p.pid))
        : { t: "view", screen: "wait", sub: "The host is still setting up." };
      const key = JSON.stringify(view);
      if (lastSent[p.pid] === key) return;
      lastSent[p.pid] = key;
      room.send(p.pid, view);
    });
  }

  function reportProgress(state) {
    if (!room || !state) return;
    const title = titleFor(state);
    if (room.setTitle && title !== lastTitle) {
      lastTitle = title;
      room.setTitle(title);
    }
    if (!room.reportScores || state.phase === "setup" || state.phase === "question") return;
    const scores = nightScores(state);
    const key = JSON.stringify(scores);
    if (key === lastScores) return;
    lastScores = key;
    room.reportScores(scores);
  }

  /** One row per seat; a host-run seat goes on the board under its own name
      (hub-night.js keys a null pid off the name). */
  function nightScores(state) {
    return state.players.map((player, seat) => ({
      pid: player.pid,
      name: player.name,
      score: state.totals[seat],
    }));
  }

  function titleFor(state) {
    if (state.phase === "question") {
      return `Round ${state.round + 1} · Question ${state.qIndex + 1}`;
    }
    if (state.phase === "board") return `Round ${state.round + 1} · the Big Board`;
    if (state.phase === "roundDone") return `Round ${state.round + 1} over`;
    if (state.phase === "result") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("pyl-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) {                         // the shell owns the room and the code
      setText("pyl-room-status", "Phones join through the hub — the code is in the shell bar.");
      return;
    }
    setText("pyl-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("pyl-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("pyl-join-url", room.joinUrl());
      show(note, true);
    } else show(note, false);
  }

  function roomMessage(status, code) {
    if (status.error) return `Room error: ${status.error}`;
    if (status.connecting) return "Opening a room…";
    if (status.open) return `Room ${code} is open — phones can join.`;
    return "Closed — the host can run every part of the game alone.";
  }

  function wireRoomButton() {
    const btn = $("btn-open-room");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (!room) return;
      const status = room.status ? room.status() : { open: false };
      try {
        if (status.open && room.close) room.close();
        else if (room.open) room.open();
      } catch (err) {
        console.warn("Could not change the room:", err);
        setText("pyl-room-status", `Could not open a room: ${err.message}`);
      }
      paintRoom();
    });
  }

  /** No SDK on the page: say so plainly instead of leaving a dead button. */
  function showUnavailable() {
    const btn = $("btn-open-room");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Open room (phones) — unavailable";
    }
    setText("pyl-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole game.");
  }

  /* ============ Boot ============ */

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || typeof GSC.host !== "function") { showUnavailable(); return; }
    if (GSC.mode.endsWith("-player")) return;
    embedded = GSC.mode === "embed-host";
    try {
      room = await GSC.host({ onPlayerJoin, onPlayerLeave, onPlayerStatus, onMessage });
    } catch (err) {
      window.PylApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.PylApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.PylApp.bindRoom(room.code); paintRoom(); });
    }
    window.PylApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    syncPlayers();
    pushViews(window.PylApp.core());
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.PylRoom = {
      room, pushViews, onMessage,
      phoneCount: () => (room.players ? room.players().length : 0),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
