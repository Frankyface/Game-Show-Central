/* ============================================================
   Wheel of Fortune — host-side room glue (00 §7, spec 04 §5)
   Turns the GSC roster into game players and phone intents into
   reducer events. THE HOST IS AUTHORITATIVE: every payload goes
   through WheelCore.validatePhoneMsg, and an intent is dropped
   unless it comes from the player whose turn it actually is.
   Phones never score and never advance anything; the host can
   always take over with the on-screen buttons instead.
   Nothing here touches PeerJS — the SDK owns the transport.
   ============================================================ */

"use strict";

(function () {
  const $ = (id) => document.getElementById(id);
  const show = (node, visible) => { if (node) node.classList.toggle("hidden", !visible); };
  const core = () => window.WheelCore;
  const app = () => window.WheelApp;

  let room = null;
  const known = new Map(); // pid -> name, as reported by the shell

  function status(message) {
    const node = $("room-status");
    if (node) node.textContent = message;
  }

  /* ============ Roster ============ */

  function syncPids() {
    if (app()) app().setPhonePids([...known.keys()]);
  }

  let syncing = false;

  /**
   * Make the game's player list match the shell roster. Runs on every roster
   * event and after every state change, so a phone that arrives before the
   * puzzles finish loading still lands on the board.
   */
  function syncRoster() {
    const state = app().getState();
    if (!state || syncing) return;
    const missing = [...known.entries()].filter(([pid]) => !state.players.some((p) => p.pid === pid));
    if (!missing.length) return;
    syncing = true;
    try {
      // Mid-game arrivals start at zero and play from the next turn.
      app().setState({
        ...state,
        players: [...state.players, ...missing.map(([pid, name]) => ({
          pid, name: core().sanitizeName(name) || "Player", round: 0, total: 0,
        }))].slice(0, core().MAX_PLAYERS),
      });
    } finally {
      syncing = false;
    }
  }

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    known.set(player.pid, player.name);
    syncPids();
    syncRoster();
    const state = app().getState();
    if (state && state.players.some((p) => p.pid === player.pid)) {
      app().renamePlayer(player.pid, player.name);
    }
    pushViews();
  }

  function onPlayerLeave(pid) {
    known.delete(pid);
    // The player stays on the board with their money — a refresh re-links them.
    syncPids();
  }

  function onPlayerStatus(pid, connected) {
    if (!connected) return;
    syncPids();
    pushViews();
  }

  /* ============ Phone intents ============ */

  /** Is `pid` the player whose turn it is right now? */
  function onTurn(state, pid) {
    const player = state.players[state.turn];
    return !!player && player.pid === pid && !state.roundDone;
  }

  function onMessage(pid, raw) {
    const state = app().getState();
    if (!state) return;
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return; // junk is dropped silently, never thrown on
    if (msg.t === "buzz") {
      app().dispatch({ type: "tossupBuzz", pid });
      return;
    }
    if (msg.t === "bonus-pick") {
      if (state.phase === "bonus" && state.bonus && state.bonus.leaderPid === pid) {
        app().dispatch({ type: "bonusPick", letters: msg.letters });
      }
      return;
    }
    if (state.phase !== "round" || !onTurn(state, pid)) return;
    if (msg.t === "spin") app().doSpin();
    else if (msg.t === "letter") app().dispatch({ type: "callLetter", letter: msg.letter });
    else if (msg.t === "buy-vowel") app().dispatch({ type: "buyVowel" });
    else if (msg.t === "solve") app().dispatch({ type: "solveAttempt", text: msg.text });
  }

  /* ============ Outbound ============ */

  function pushViews() {
    const state = app().getState();
    if (!room || !state) return;
    for (const pid of known.keys()) {
      try {
        room.send(pid, { t: "view", ...core().phoneView(state, pid) });
      } catch (err) {
        console.warn(`Could not send to ${pid}:`, err);
      }
    }
    try {
      room.reportScores(state.players.map((p) => ({ pid: p.pid, name: p.name, score: p.total })));
      room.setTitle(roundTitle(state));
    } catch (err) {
      console.warn("Could not report scores:", err);
    }
  }

  function roundTitle(state) {
    if (state.phase === "idle") return "Setup";
    if (state.phase === "final") return "Final standings";
    const type = state.round ? state.round.type : "regular";
    const label = type === "tossup" ? "Toss-up" : type === "bonus" ? "Bonus round" : "Round";
    return `${label} ${state.roundIndex + 1}`;
  }

  /* ============ Standalone room controls ============ */

  function wireStandalone() {
    const button = $("btn-open-room");
    show(button, true);
    if (room.unavailable) {
      button.disabled = true;
      status(room.unavailable);
      return;
    }
    button.addEventListener("click", () => {
      status("Opening a room…");
      room.open();
    });
    room.onStatus(() => renderRoomStatus());
    renderRoomStatus();
  }

  function renderRoomStatus() {
    const info = room.status ? room.status() : { open: false };
    const chip = $("room-chip");
    if (info.error) {
      status(`The room could not open: ${info.error}`);
    } else if (info.open && room.code) {
      status(`Room ${room.code} is open — players join on their phones.`);
      const url = room.joinUrl ? room.joinUrl() : null;
      $("room-join").textContent = url ? `Join link: ${url}` : "";
      chip.textContent = room.code;
      show(chip, true);
      show($("btn-open-room"), false);
    } else if (info.connecting) {
      status("Opening a room…");
    } else {
      status("Phones are optional. Open a room to let people play along.");
    }
  }

  /* ============ Boot ============ */

  async function boot() {
    if (!window.GSC) {
      status("Phone rooms are unavailable (shared/bridge.js is missing). Host-only play works fine.");
      return;
    }
    if (window.GSC.mode.endsWith("-player")) return; // wheel-phone.js drives that side
    try {
      room = await window.GSC.host({ onPlayerJoin, onPlayerLeave, onPlayerStatus, onMessage });
    } catch (err) {
      console.warn("The room could not be opened:", err);
      status(`Phones are unavailable: ${err.message}`);
      return;
    }
    if (window.GSC.mode === "embed-host") {
      show($("btn-exit"), true);
      $("btn-exit").addEventListener("click", () => room.exit());
      status("Players from the lobby are on this game.");
      for (const player of room.players()) onPlayerJoin(player);
    } else {
      wireStandalone();
    }
    app().subscribe(() => { syncRoster(); pushViews(); });
    syncRoster();
    pushViews();
    window.WheelRoom = { room, pushViews, known, onMessage };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
