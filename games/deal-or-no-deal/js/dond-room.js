/* ============================================================
   Deal or No Deal — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into contestants, validates every phone payload through the
   pure core before it touches state, and pushes each phone the
   ONE view it is allowed to see (DondCore.phoneView — never the
   amount inside a sealed case, never anybody else's advice).

   The host stays authoritative. The contestant's phone can pick a
   case and SAY Deal or No Deal; it can never take the money. The
   decision becomes a `request` the host confirms with a button.
   Everybody else can only vote advice, and only while the vote is
   open.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.DondCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.DondApp.state();
    if (app.core) {
      const known = app.core.contestants.some((c) => c.pid === player.pid);
      if (!known) window.DondApp.error(`${player.name} joined — they can advise now and play from the next board.`);
    } else if (!app.setup.players.some((p) => p.pid === player.pid)) {
      window.DondApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.DondApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.DondApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.DondApp.core()) window.DondApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.DondApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: intents only ============ */

  /**
   * A phone tap becomes at most one reducer event. `pick` means two different
   * things by phase — keep this case, or open this case — and neither is
   * accepted from anybody but the contestant.
   */
  const INTENTS = {
    pick: (pid, msg, state) => {
      if (state.current !== pid) return null;
      if (state.phase === "pick") return { type: "pickCase", n: msg.n };
      if (state.phase === "round") return { type: "openCase", n: msg.n };
      return null;
    },
    decision: (pid, msg) => ({ type: "request", pid, choice: msg.choice }),
    advice: (pid, msg) => ({ type: "adviceVote", pid, choice: msg.choice }),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.DondApp.core();
    if (!state) return;
    const build = INTENTS[msg.t];
    if (!build) return;
    const event = build(pid, msg, state);
    // Every one of these is checked again inside the reducer; nothing a phone
    // sends can open a case out of turn or take the banker's money.
    if (event) window.DondApp.dispatch(event);
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
    const rounds = state.game.settings.rounds.length;
    if (state.phase === "seat") return "Choosing a contestant";
    if (state.phase === "pick") return "Picking a case";
    if (state.phase === "round") return `Round ${Math.min(state.round + 1, rounds)} of ${rounds}`;
    if (state.phase === "offer") return "The banker is calling";
    if (state.phase === "swap") return "Swap?";
    if (state.phase === "reveal") return "The reveal";
    if (state.phase === "result" || state.phase === "standings") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("dond-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("dond-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("dond-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("dond-join-url", room.joinUrl());
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
        setText("dond-room-status", `Could not open a room: ${err.message}`);
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
    setText("dond-room-status",
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
      window.DondApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.DondApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.DondApp.bindRoom(room.code); paintRoom(); });
    }
    window.DondApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.DondRoom = {
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
