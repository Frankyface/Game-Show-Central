/* ============================================================
   Krillion — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the player list, validates every phone payload through
   the pure core before it touches state, and pushes each phone
   the ONE view it is allowed to see (KrCore.phoneView).

   An answer arrives here and goes straight into the reducer; it
   never reaches another phone and never reaches the host screen
   until the prompt closes. Phones only express intent: there is
   no phone message that rates, reveals or advances anything.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.KrCore;
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen: forget what we last sent it.
    delete lastSent[player.pid];
    const c = window.KrApp.core();
    if (c) {
      if (!c.players.some((p) => p.pid === player.pid)) {
        window.KrApp.error(`${player.name} joined — they’ll be in the next game.`);
      }
    } else {
      window.KrApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.KrApp.core());
  }

  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.KrApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.KrApp.core()) window.KrApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.KrApp.setPhoneCount(room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: answers only, each re-checked ============ */

  const EVENTS = {
    answer: (pid, msg) => ({ type: "answer", pid, text: msg.text }),
    puffer: (pid, msg) => ({ type: "pufferAnswer", pid, text: msg.text }),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    if (msg.t === "ready") { delete lastSent[pid]; pushViews(window.KrApp.core()); return; }
    const state = window.KrApp.core();
    if (!state || !core().phoneMaySend(state, pid, msg.t) || !has(EVENTS, msg.t)) return;
    window.KrApp.dispatch(EVENTS[msg.t](pid, msg));
  }

  /* ============ Outbound: one masked view per phone ============ */

  function pushViews(state) {
    if (!room || !room.players) return;
    const now = Date.now();
    room.players().forEach((p) => {
      if (p.manual) return;
      const view = state
        ? Object.assign({ t: "view" }, core().phoneView(state, p.pid, now))
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
    if (room.reportScores && state.phase === "result") {
      const rows = core().standings(state).filter((r) => !/^m\d/.test(r.pid));
      const n = state.players.length;
      // Deep Dive reports depth in metres; Puffer Party reports places (last one floating scores most).
      const score = (r) => (state.mode === "puffer" ? (n - r.rank + 1) * 10 : r.depth);
      if (rows.length) room.reportScores(rows.map((r) => ({ pid: r.pid, name: r.name, score: score(r) })));
    }
  }

  function titleFor(state) {
    if (state.phase === "result") return "Result";
    if (state.mode === "puffer") return `Puffer Party — round ${state.round}`;
    return `Prompt ${state.round} of ${state.game.settings.promptsPerGame}`;
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("kr-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) { show($("kr-room-controls"), false); return; }
    setText("kr-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("kr-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("kr-join-url", room.joinUrl());
      show(note, true);
    } else show(note, false);
  }

  function roomMessage(status, code) {
    if (status.error) return `Room error: ${status.error}`;
    if (status.connecting) return "Opening a room…";
    if (status.open) return `Room ${code} is open — phones can join.`;
    return "Closed — you can type every player’s answer on this screen.";
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
        setText("kr-room-status", `Could not open a room: ${err.message}`);
      }
      paintRoom();
    });
  }

  function showUnavailable() {
    const btn = $("btn-open-room");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Open room (phones) — unavailable";
    }
    setText("kr-room-status", "Phone support needs shared/bridge.js, which isn’t loaded. "
      + "You can still run the whole game by typing answers on this screen.");
  }

  /* ============ Boot ============ */

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || typeof GSC.host !== "function") { showUnavailable(); return; }
    if (GSC.mode.endsWith("-player")) return;
    embedded = GSC.mode === "embed-host";
    if (embedded) document.body.classList.add("gsc-embedded");
    try {
      room = await GSC.host({ onPlayerJoin, onPlayerLeave, onPlayerStatus, onMessage,
        // docs/22: host phones are never players; kr-hostphone.js owns them.
        onHostPhones: (list) => { if (window.KrHostPhone) window.KrHostPhone.onHostPhones(list); },
      });
    } catch (err) {
      window.KrApp.error(`Phones are unavailable: ${err.message}. You can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone joins.
    window.KrApp.bindRoom(room.code);
    if (room.onStatus) room.onStatus(() => { window.KrApp.bindRoom(room.code); paintRoom(); });
    // Seat reconciliation and the host view, before any phone is (re)seated.
    if (window.KrHostPhone) window.KrHostPhone.attach(room);
    window.KrApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    // The hub shows its own title card on a game switch.
    if (!embedded) window.KrApp.showSplash("Krillion", "The rarest answer wins.");
    window.KrRoom = { room, pushViews, onMessage };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot().catch((err) => console.warn(err)); });
  } else {
    boot().catch((err) => console.warn(err));
  }
})();
