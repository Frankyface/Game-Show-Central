/* ============================================================
   Millionaire — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into contestants, validates every phone payload through the
   pure core before it touches state, and pushes each phone the
   ONE view it is allowed to see (WwmCore.phoneView — never the
   answer, never anybody else's vote).

   The host stays authoritative. A phone can select a letter, ask
   for a lifeline, ask to walk away and vote in an audience; it
   can never lock an answer, spend a lifeline or advance a
   question. Lifeline and walk-away taps become a `request` the
   host confirms with a button.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.WwmCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.WwmApp.state();
    if (app.core) {
      const known = app.core.contestants.some((c) => c.pid === player.pid);
      if (!known) window.WwmApp.error(`${player.name} joined — they can play from the next game.`);
    } else if (!app.setup.players.some((p) => p.pid === player.pid)) {
      window.WwmApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.WwmApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.WwmApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.WwmApp.core()) window.WwmApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.WwmApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: intents only ============ */

  const INTENTS = {
    fff: (pid, msg) => ({ type: "fffSubmit", pid, order: msg.order, at: Date.now() }),
    answer: (pid, msg, state) => (state.current === pid ? { type: "select", idx: msg.idx } : null),
    vote: (pid, msg) => ({ type: "audienceVote", pid, idx: msg.idx }),
    walk: (pid) => ({ type: "request", pid, which: "walk" }),
    lifeline: (pid, msg) => ({ type: "request", pid, which: msg.which }),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.WwmApp.core();
    if (!state) return;
    const build = INTENTS[msg.t];
    if (!build) return;
    const event = build(pid, msg, state);
    // Every one of these is checked again inside the reducer; nothing a phone
    // sends can advance the game on its own.
    if (event) window.WwmApp.dispatch(event);
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
      room.reportScores(state.contestants.filter((c) => c.out)
        .map((c) => ({ pid: c.pid, name: c.name, score: c.won })));
    }
  }

  function titleFor(state) {
    if (state.phase === "fff" || state.phase === "pick") return "Choosing the hot seat";
    if (state.phase === "hotseat") return `Question ${core().playingRung(state)} of ${core().rungCount(state)}`;
    if (state.phase === "result" || state.phase === "standings") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("wwm-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("wwm-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("wwm-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("wwm-join-url", room.joinUrl());
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
        setText("wwm-room-status", `Could not open a room: ${err.message}`);
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
    setText("wwm-room-status",
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
      window.WwmApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.WwmApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.WwmApp.bindRoom(room.code); paintRoom(); });
    }
    window.WwmApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.WwmRoom = { room, pushViews, onMessage, phoneCount: () => (room.players ? room.players().length : 0) };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
