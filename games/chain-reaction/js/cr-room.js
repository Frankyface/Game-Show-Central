/* ============================================================
   Chain Reaction — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into a list the host can split between two teams, validates
   every phone payload through the pure core before it touches
   state, and pushes each phone the ONE view it is allowed to see
   (CrCore.phoneView — never a hidden letter).

   The host stays authoritative. A phone on the team in control
   can pick which end to build from and type a guess; the guess is
   only ever SHOWN to the host, who presses Correct or Wrong. In
   the Speed Chain a phone may pass (that only sends the word to
   the back of the queue); "got it" is the host's call alone.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.CrCore;

  /* ============ Roster ============ */

  function syncPlayers() {
    if (!room || !room.players) return;
    window.CrApp.setPlayers(room.players()
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
    pushViews(window.CrApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    syncPlayers();
    if (connected) pushViews(window.CrApp.core());
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
    direction: (pid, msg, state) => (
      core().teamOf(state, pid) === state.control && state.phase === "chain"
        ? { type: "reveal", direction: msg.dir } : null),
    guess: (pid, msg, state) => (
      core().teamOf(state, pid) === state.control
        ? { type: "guess", text: msg.text, pid } : null),
    // Only a pass: marking a word "got" is the host's judgement (spec 14 §5).
    speed: (pid, msg, state) => {
      if (msg.result !== "pass" || state.phase !== "speed" || !state.speed) return null;
      return core().teamOf(state, pid) === state.speed.team ? { type: "speedMark", result: "pass" } : null;
    },
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.CrApp.core();
    if (!state) return;
    const build = Object.prototype.hasOwnProperty.call(INTENTS, msg.t) ? INTENTS[msg.t] : null;
    if (!build) return;
    const event = build(pid, msg, state);
    if (event) window.CrApp.dispatch(event);
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
    if (room.reportScores && (state.phase === "result" || state.phase === "chainDone")) {
      room.reportScores(nightScores(state));
    }
  }

  /**
   * One row per team MEMBER, each carrying the team's score — the convention
   * family-feud and pyramid use. Reporting only `pids[0]` made the hub's night
   * board show that one player's name instead of the team's and credited the
   * rest of the team nothing (CR-4). A team with no phones goes on the board
   * under its own name (`hub-night.js` keys a null pid off the name).
   */
  function nightScores(state) {
    const names = new Map((room.players ? room.players() : []).map((p) => [p.pid, p.name]));
    const rows = [];
    state.teams.forEach((team, i) => {
      if (!team.pids.length) {
        rows.push({ pid: null, name: team.name, score: state.scores[i] });
        return;
      }
      team.pids.forEach((pid) => {
        rows.push({ pid, name: names.get(pid) || team.name, score: state.scores[i] });
      });
    });
    return rows;
  }

  function titleFor(state) {
    if (state.phase === "chain" || state.phase === "chainDone") {
      return `Chain ${state.chainIndex + 1} of ${state.game.settings.values.length}`;
    }
    if (state.phase === "sudden") return "Sudden death";
    if (state.phase === "speed") return "Speed Chain";
    if (state.phase === "result") return "Standings";
    return "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("cr-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) {                         // the shell owns the room and the code
      setText("cr-room-status", "Phones join through the hub — the code is in the shell bar.");
      return;
    }
    setText("cr-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("cr-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("cr-join-url", room.joinUrl());
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
        setText("cr-room-status", `Could not open a room: ${err.message}`);
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
    setText("cr-room-status",
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
      window.CrApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's team.
    window.CrApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.CrApp.bindRoom(room.code); paintRoom(); });
    }
    window.CrApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    syncPlayers();
    pushViews(window.CrApp.core());
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.CrRoom = {
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
