/* ============================================================
   Match Game — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the player pool, validates every phone payload through
   the pure core before it touches state, and pushes each phone
   the ONE view it is allowed to see (MgCore.phoneView).

   This is the file that keeps the game honest. A panelist's
   answer arrives here and goes straight into the reducer; it
   never reaches another phone, and it never reaches the host's
   screen until the host flips that card. The host stays the
   judge: there is no phone message that scores anything.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;
  let booting = true;       // the initial roster replay at boot

  const core = () => window.MgCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.MgApp.state();
    if (app.core) {
      const seated = app.core.panel.some((p) => p.pid === player.pid)
        || app.core.contestants.some((c) => c.pid === player.pid);
      if (!seated) {
        // Not during the boot roll-call: those players were already here, and the
        // seat-reconciliation notice must not be overwritten (docs/22 §5.6).
        if (!booting) window.MgApp.error(`${player.name} joined — they can play the Audience Match.`);
      }
    } else {
      window.MgApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.MgApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.MgApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.MgApp.core()) window.MgApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.MgApp.setPhoneCount(
      room.players().filter((p) => !p.manual && p.connected !== false).length);
  }

  /* ============ Inbound: answers only, each re-checked ============ */

  const EVENTS = {
    panel: (pid, msg) => ({ type: "panelAnswer", pid, text: msg.text, fromPhone: true }),
    audience: (pid, msg) => ({ type: "audienceAnswer", pid, text: msg.text, fromPhone: true }),
    hth: (pid, msg) => ({ type: "hthAnswer", text: msg.text, who: "panel", fromPhone: true }),
  };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    if (msg.t === "ready") { delete lastSent[pid]; pushViews(window.MgApp.core()); return; }
    const state = window.MgApp.core();
    if (!state) return;
    // Belt and braces: the selector says whether this phone is even on that
    // screen right now, and the reducer checks the phase again after that.
    if (!core().phoneMaySend(state, pid, msg.t)) return;
    if (!Object.prototype.hasOwnProperty.call(EVENTS, msg.t)) return;
    window.MgApp.dispatch(EVENTS[msg.t](pid, msg));
  }

  /* ============ The host phone (docs/22 §5.2) ============ */

  let hostSeq = 0;
  let lastHostJson = "";

  /**
   * Hand the hub the host's private view on every change. `seq` moves only
   * when the content changes; the SDK and the hub de-duplicate and resend, so
   * there is no cache or resend logic here, and never a room.send.
   */
  function pushHostView(state) {
    if (!room || typeof room.setHostView !== "function") return;
    const view = core().hostView(state);
    const json = JSON.stringify(view);
    if (json !== lastHostJson) { lastHostJson = json; hostSeq += 1; }
    room.setHostView(Object.assign({ t: "host", item: view.item || "", seq: hostSeq }, view));
  }

  function onHostPhones(list) {
    window.MgHostScreen.setHostPhones(list, room && room.answersPrivate ? room.answersPrivate() : false);
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
    if (room.reportScores && state.phase === "standings") {
      // Tester fix (MG-D7): host-typed contestants have no pid; the hub keys those rows by name.
      const rows = core().standings(state)
        .map((row) => ({ pid: row.pid || null, name: row.name, score: row.money }));
      if (rows.length) room.reportScores(rows);
    }
  }

  const TITLES = {
    roundScores: "Scores",
    superChoice: "Super Match",
    audience: "Audience Match",
    audienceBoard: "Audience Match",
    hthPick: "Head-to-Head",
    hthPrompt: "Head-to-Head",
    hthResult: "Super Match",
    standings: "Standings",
  };

  function titleFor(state) {
    if (state.phase === "prompt" && state.current) {
      return `${window.MgView.roundLabel(state)} — ${state.contestants[state.current.seat].name}`;
    }
    return Object.prototype.hasOwnProperty.call(TITLES, state.phase) ? TITLES[state.phase] : "";
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("mg-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("mg-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("mg-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("mg-join-url", room.joinUrl());
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
        setText("mg-room-status", `Could not open a room: ${err.message}`);
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
    setText("mg-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole "
      + "game by typing the panel on this screen.");
  }

  /* ============ Boot ============ */

  async function boot() {
    const GSC = window.GSC;
    if (!GSC || typeof GSC.host !== "function") { showUnavailable(); return; }
    if (GSC.mode.endsWith("-player")) return;
    embedded = GSC.mode === "embed-host";
    if (embedded) document.body.classList.add("gsc-embedded");
    try {
      room = await GSC.host({ onPlayerJoin, onPlayerLeave, onPlayerStatus, onMessage, onHostPhones });
    } catch (err) {
      window.MgApp.error(`Phones are unavailable: ${err.message}. The host can still run the game.`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.MgApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.MgApp.bindRoom(room.code); paintRoom(); });
    }
    // docs/22 §5.6 then §5.2: seats reconciled against this room (embedded only —
    // a standalone room has no roster at boot), then the private view on every change.
    if (embedded) window.MgHostScreen.reconcileSeats((room.players ? room.players() : []).map((p) => p.pid));
    if (room.hostPhones) {
      window.MgHostScreen.setHostPhones(room.hostPhones(), room.answersPrivate ? room.answersPrivate() : false);
    }
    window.MgApp.subscribe((state) => {
      pushViews(state); pushHostView(state); reportProgress(state); paintRoom();
    });
    pushHostView(window.MgApp.core());
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    booting = false;
    paintRoom();
    // The hub shows its own title card on a game switch, so the game only
    // shows one when it is standing alone (docs/09, the double-splash fix).
    if (!embedded) window.MgApp.showSplash("Match Game");
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.MgRoom = {
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
