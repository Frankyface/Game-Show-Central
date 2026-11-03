/* ============================================================
   The Chase — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the contestant pool, validates every phone payload
   through the pure core before it touches state, and pushes each
   phone the ONE view it is allowed to see (ChaseCore.phoneView).

   This is the file that keeps the game honest. A phone can only
   ever say "I lock option N", and even that is re-checked
   against the state: the sender must be the contestant in the
   hot seat, or the Chaser when a player is playing him, and the
   question must still be open. Judging, revealing and moving a
   marker are host-only and have no phone message at all — and
   the view a phone receives never carries the other side's lock
   before the reveal.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.ChaseCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.ChaseApp.state();
    if (app.core) {
      const seated = app.core.contestants.some((c) => c.pid === player.pid)
        || app.core.chaser.pid === player.pid;
      if (!seated) window.ChaseApp.error(`${player.name} joined — they can play in the next game.`);
    } else if (!app.setup.players.some((p) => p.pid === player.pid)) {
      window.ChaseApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.ChaseApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.ChaseApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.ChaseApp.core()) window.ChaseApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.ChaseApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: intents only, each re-checked ============ */

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    if (msg.t === "ready") return;          // the push is driven by state, not by asking
    // ChaseApp.phoneIntent re-checks that this pid really may lock right now
    // before anything reaches the reducer, and the reducer checks again.
    window.ChaseApp.phoneIntent(pid, msg);
  }

  /* ============ Outbound: one masked view per phone ============ */

  function pushViews(state) {
    if (!room || !room.players) return;
    room.players().forEach((p) => {
      if (p.manual) return;
      const view = state
        ? Object.assign({ t: "view" }, core().phoneView(state, p.pid))
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
        .map((row) => ({ pid: row.pid, name: row.name, score: row.winnings })));
    }
  }

  function titleFor(state) {
    const who = core().hotSeat(state);
    if (state.phase === "cashBuilder") return `Cash Builder — ${who ? who.name : ""}`;
    if (state.phase === "offer") return "The offers";
    if (state.phase === "headToHead") return `${who ? who.name : ""} v ${state.chaser.name}`;
    if (state.phase === "finalTeam") return "Final Chase — the team";
    if (state.phase === "finalChaser") return `Final Chase — ${state.chaser.name}`;
    if (state.phase === "result" || state.phase === "standings") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("chase-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("chase-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("chase-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("chase-join-url", room.joinUrl());
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
        setText("chase-room-status", `Could not open a room: ${err.message}`);
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
    setText("chase-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole game "
      + "alone: type the contestant’s spoken letter and lock the Chaser’s answer on this screen.");
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
      window.ChaseApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.ChaseApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.ChaseApp.bindRoom(room.code); paintRoom(); });
    }
    window.ChaseApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.ChaseRoom = { room, pushViews, onMessage,
      phoneCount: () => (room.players ? room.players().length : 0) };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
