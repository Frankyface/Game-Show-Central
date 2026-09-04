/* ============================================================
   Pyramid — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the player pool, validates every phone payload through the
   pure core before it touches state, and pushes each phone the
   ONE view it is allowed to see (PyrCore.phoneView).

   This is the file that keeps the game honest. Only the giver's
   view ever carries a word, so a guesser who opens their phone's
   dev tools still learns nothing. The host stays authoritative:
   a phone may tap Got it or Pass, and even that is re-checked
   against the state before it becomes an event. An illegal clue
   is a judgement, so it is host-only and has no phone message.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.PyrCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.PyrApp.state();
    if (app.core) {
      const seated = app.core.teams.some((t) => t.members.some((m) => m.pid === player.pid));
      if (!seated) window.PyrApp.error(`${player.name} joined — they can play from the next game.`);
    } else if (!app.setup.players.some((p) => p.pid === player.pid)) {
      window.PyrApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.PyrApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.PyrApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.PyrApp.core()) window.PyrApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.PyrApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: one intent, re-checked ============ */

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    if (msg.t !== "mark") return;           // "ready" needs no action; the push is driven by state
    // PyrApp.phoneMark checks that this pid really is the current giver before
    // anything reaches the reducer, and the reducer checks the phase again.
    window.PyrApp.phoneMark(pid, msg.result);
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
      // The Winner's Circle money goes to BOTH members of the winning team
      // (spec 11 §1); main-game points are shown but never banked.
      const rows = [];
      core().standings(state).forEach((team) => {
        team.members.forEach((m) => rows.push({ pid: m.pid, name: m.name, score: team.winnings }));
      });
      room.reportScores(rows);
    }
  }

  function titleFor(state) {
    if (state.phase === "board") return `${state.teams[state.turn].name} picks`;
    if (state.phase === "play" && state.round) {
      return state.round.tiebreak ? "Tiebreak" : state.round.title;
    }
    if (state.phase === "circle") return "Winner’s Circle";
    if (state.phase === "result" || state.phase === "standings") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("pyr-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("pyr-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("pyr-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("pyr-join-url", room.joinUrl());
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
        setText("pyr-room-status", `Could not open a room: ${err.message}`);
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
    setText("pyr-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole game "
      + "with “Show words to me”.");
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
      window.PyrApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.PyrApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.PyrApp.bindRoom(room.code); paintRoom(); });
    }
    window.PyrApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.PyrRoom = { room, pushViews, onMessage, phoneCount: () => (room.players ? room.players().length : 0) };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
