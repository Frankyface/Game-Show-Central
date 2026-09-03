/* ============================================================
   Weakest Link — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into game players, validates every phone payload through the
   pure core before it touches state, and pushes each phone the
   ONE view it is allowed to see.

   Secret voting is the whole point of phones here. A vote never
   travels anywhere except from the voter's phone to the host, and
   the host screen shows dots until the reveal — see
   WlCore.phoneView, which is the only thing sent outbound.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let roomOpen = false;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    const app = window.WlApp.state();
    if (app.core) {
      // A phone already in this game is just reconnecting (or the host
      // reloaded); only a genuinely new arrival gets the "next game" notice.
      const known = app.core.players.some((p) => p.pid === player.pid);
      if (!known) window.WlApp.error(`${player.name} joined — they can play from the next game.`);
      pushViews(app.core);
      return;
    }
    const already = app.setup.players.some((p) => p.pid === player.pid);
    if (!already) window.WlApp.addPlayer(player.name, player.pid, false);
  }

  function onPlayerLeave(pid) {
    const app = window.WlApp.state();
    if (!app.core) window.WlApp.removePlayer(pid);
    delete lastSent[pid];
  }

  /* ============ Inbound: the only two things a phone may say ============ */

  function onMessage(pid, raw) {
    const msg = window.WlCore.validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignore, never throw
    const core = window.WlApp.core();
    if (!core) return;
    if (msg.t === "vote") {
      // canVote is host-authoritative: phase, membership and self-votes.
      if (!window.WlCore.canVote(core, pid, msg.target)) return;
      window.WlApp.dispatch({ type: "vote", voter: pid, target: msg.target });
      return;
    }
    if (msg.t === "tiebreak") {
      if (core.phase !== "tiebreak" || core.tiebreakPid !== pid) return;
      window.WlApp.dispatch({ type: "breakTie", target: msg.target });
    }
  }

  /* ============ Outbound: one masked view per phone ============ */

  function pushViews(core) {
    if (!room) return;
    const players = room.players ? room.players() : [];
    players.forEach((p) => {
      const view = core
        ? Object.assign({ t: "view" }, window.WlCore.phoneView(core, p.pid))
        : { t: "view", screen: "wait", headline: "Waiting for the host…" };
      const key = JSON.stringify(view);
      if (lastSent[p.pid] === key) return;
      lastSent[p.pid] = key;
      room.send(p.pid, view);
    });
  }

  function reportProgress(core) {
    if (!room || !core) return;
    if (room.setTitle) {
      room.setTitle(core.phase === "result" ? "Winner" : `Round ${core.roundIndex + 1}`);
    }
    if (room.reportScores && core.phase === "result") {
      room.reportScores(core.players.map((p) => ({
        pid: p.pid,
        name: p.name,
        score: p.pid === core.winnerPid ? core.total : 0,
      })));
    }
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    const status = room && room.status ? room.status() : { open: false, code: null, error: null };
    const chip = document.getElementById("wl-room-chip");
    const note = document.getElementById("wl-join-note");
    if (status.code) {
      chip.textContent = status.code;
      show(chip, true);
    } else show(chip, false);
    setText("wl-room-status", status.error
      ? status.error
      : status.open ? "Open — phones can join and vote secretly."
        : status.connecting ? "Opening…"
          : "Closed — the host can enter every vote instead.");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("wl-join-url", room.joinUrl());
      show(note, true);
    } else show(note, false);
    const btn = document.getElementById("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    roomOpen = !!status.open;
  }

  function wireRoomButton() {
    const btn = document.getElementById("btn-open-room");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (!room) return;
      if (roomOpen && room.close) room.close();
      else if (room.open) room.open();
      paintRoom();
    });
  }

  /* ============ Boot ============ */

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || GSC.mode.endsWith("-player")) return;
    try {
      room = await GSC.host({ onPlayerJoin, onPlayerLeave, onPlayerStatus: () => {}, onMessage });
    } catch (err) {
      window.WlApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    if (room.onStatus) room.onStatus(paintRoom);
    window.WlApp.subscribe((core) => { pushViews(core); reportProgress(core); });
    wireRoomButton();
    // An embedded game already has its roster; seed it before the first render.
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = document.getElementById("btn-exit");
    if (exit && room.exit) exit.addEventListener("click", () => room.exit());
    window.WlRoom = { room, pushViews, onMessage };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
