/* ============================================================
   1 vs 100 — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the contestant plus the Mob, validates every phone payload
   through the pure core before it touches state, and pushes each
   phone the ONE view it is allowed to see (OvhCore.phoneView —
   never the correct answer, never another Mob member's pick).

   The host stays authoritative. A Mob phone can tap one of three
   options while the window is open; the contestant's phone can
   lock one answer once the Mob has locked. Nothing a phone sends
   opens a window, closes one, reveals, spends a help or advances
   the game.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.OvhCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.OvhApp.state();
    if (app.core) {
      const known = app.core.roster.some((p) => p.pid === player.pid);
      if (!known) window.OvhApp.error(`${player.name} joined — they can play from the next game.`);
    } else seatWaitingPhones();
    countPhones();
    pushViews(window.OvhApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected && !window.OvhApp.core()) seatWaitingPhones();
    if (connected) pushViews(window.OvhApp.core());
  }

  /**
   * D4: whenever no game is in progress (first boot, Play again, Start over,
   * a phone reload), every connected phone the setup list is missing joins
   * it, so "you can play from the next game" is true. A name already taken
   * on the list is skipped rather than renamed.
   */
  let seating = false;
  function seatWaitingPhones() {
    if (seating || !room || !room.players || window.OvhApp.core()) return;
    seating = true;
    try {
      room.players().forEach((p) => {
        if (p.manual || p.connected === false || !p.pid || !p.name) return;
        const players = window.OvhApp.state().setup.players;
        if (players.some((x) => x.pid === p.pid)) return;
        if (players.some((x) => x.name.toLowerCase() === String(p.name).toLowerCase())) return;
        window.OvhApp.addPlayer(p.name, p.pid, false);
      });
    } finally {
      seating = false;
    }
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.OvhApp.core()) window.OvhApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.OvhApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: intents only ============ */

  const INTENTS = {
    mob: (pid, msg) => ({ type: "mobAnswer", pid, idx: msg.idx }),
    lock: (pid, msg, state) => (state.contestant === pid ? { type: "contestantLock", idx: msg.idx } : null),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.OvhApp.core();
    if (!state) return;
    const build = Object.prototype.hasOwnProperty.call(INTENTS, msg.t) ? INTENTS[msg.t] : null;
    if (!build) return;
    const event = build(pid, msg, state);
    // Every one of these is checked again inside the reducer; nothing a phone
    // sends can advance the game on its own.
    if (event) window.OvhApp.dispatch(event);
  }

  /* ============ Outbound: one masked view per phone ============ */

  function pushViews(state) {
    if (!room || !room.players) return;
    room.players().forEach((p) => {
      if (p.manual) return;
      const view = state
        ? Object.assign({ t: "view" }, core().phoneView(state, p.pid, Date.now()))
        : { t: "view", screen: "wait", sub: "The host is still setting up." };
      const key = JSON.stringify(view);
      if (lastSent[p.pid] === key) return;
      lastSent[p.pid] = key;
      room.send(p.pid, view);
    });
  }

  function reportProgress(state) {
    if (!room || !state) return;
    if (room.setTitle) room.setTitle(titleFor(state));
    if (room.reportScores && (state.phase === "result" || state.phase === "standings")) {
      room.reportScores(core().standings(state)
        .filter((row) => row.won > 0 || row.kind === "contestant"
          || (state.outcome && state.outcome.reason === "lose" && row.alive))
        .map((row) => ({ pid: row.pid, name: row.name, score: row.won })));
    }
  }

  function titleFor(state) {
    if (state.phase === "question" || state.phase === "decision") {
      return `Question ${state.qNumber} — ${core().mobAlive(state)} of ${core().mobSize(state)} left`;
    }
    if (state.phase === "result" || state.phase === "standings") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("ovh-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("ovh-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("ovh-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("ovh-join-url", room.joinUrl());
      show(note, true);
    } else show(note, false);
  }

  function roomMessage(status, code) {
    if (status.error) return `Room error: ${status.error}`;
    if (status.connecting) return "Opening a room…";
    if (status.open) return `Room ${code} is open — phones can join as the Mob.`;
    return "Closed — the host can run every part of the game alone with a simulated Mob.";
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
        setText("ovh-room-status", `Could not open a room: ${err.message}`);
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
    setText("ovh-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole game "
      + "with a simulated Mob.");
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
      window.OvhApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's Mob seat.
    window.OvhApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.OvhApp.bindRoom(room.code); paintRoom(); });
    }
    window.OvhApp.subscribe((state) => {
      if (!state) seatWaitingPhones();
      pushViews(state); reportProgress(state); paintRoom();
    });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.OvhRoom = {
      room, pushViews, onMessage,
      phoneCount: () => (room.players ? room.players().length : 0),
      sent: () => Object.assign({}, lastSent),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
