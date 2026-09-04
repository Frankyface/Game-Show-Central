/* ============================================================
   The Price Is Right — host room glue
   Sits on GSC.host (architecture 00 §7): turns the lobby roster
   into the line-up, validates every phone payload through the
   pure core before it touches state, and pushes each phone the
   ONE view it is allowed to see (TpirCore.phoneView — never a
   price, never anybody else's bid, never the Plinko path).

   The host stays authoritative. A phone can offer a bid, a price,
   a Plinko answer or slot and a spin; it can never reveal bids,
   advance a segment or decide anything. "Take over" on the host
   silences a phone for the rest of the segment.
   ============================================================ */

"use strict";

(function () {
  let room = null;
  let lastSent = {};      // pid -> serialised view, so we only send on change
  let embedded = false;

  const core = () => window.TpirCore;

  /* ============ Roster ============ */

  function onPlayerJoin(player) {
    if (!player || !player.pid) return;
    // A phone that (re)appears has a blank screen, so the de-duplication cache
    // must forget whatever we last sent this pid — an identical view would
    // otherwise be suppressed and the phone would sit on "Waiting…".
    delete lastSent[player.pid];
    const app = window.TpirApp.state();
    if (app.core) {
      const known = app.core.roster.some((r) => r.pid === player.pid);
      if (!known) window.TpirApp.error(`${player.name} joined — they can play from the next show.`);
    } else if (!app.setup.players.some((p) => p.pid === player.pid)) {
      window.TpirApp.addPlayer(player.name, player.pid, false);
    }
    countPhones();
    pushViews(window.TpirApp.core());
  }

  /** A phone that comes back up needs a fresh push for the same reason. */
  function onPlayerStatus(pid, connected) {
    delete lastSent[pid];
    countPhones();
    if (connected) pushViews(window.TpirApp.core());
  }

  function onPlayerLeave(pid) {
    delete lastSent[pid];
    if (!window.TpirApp.core()) window.TpirApp.removePlayer(pid);
    countPhones();
  }

  function countPhones() {
    if (!room || !room.players) return;
    window.TpirApp.setPhones(room.players()
      .filter((p) => !p.manual && p.connected !== false).map((p) => p.pid));
  }

  /* ============ Inbound: intents only ============ */

  /** A bid means the row seat or the showcase, depending on where we are. */
  function bidIntent(pid, msg, state) {
    if (state.phase === "row") return { type: "bid", pid, amount: msg.amount };
    if (state.phase === "showcase") return { type: "showcaseBid", pid, amount: msg.amount };
    return null;
  }

  function guessIntent(pid, msg, state) {
    const g = state.game;
    if (state.phase !== "game" || !g.kind || g.pid !== pid || g.done) return null;
    if (g.kind === "cliffhangers") return { type: "chGuess", amount: msg.value };
    if (g.kind === "luckyseven") return { type: "l7Guess", digit: msg.value };
    return null;
  }

  function plinkoIntent(pid, msg, state) {
    const g = state.game;
    if (state.phase !== "game" || g.kind !== "plinko" || g.pid !== pid || g.done) return null;
    if (msg.answer) return { type: "plinkoAnswer", i: g.index, answer: msg.answer };
    return { type: "plinkoDrop", slot: msg.slot };
  }

  function spinIntent(pid, msg, state) {
    if (state.phase !== "showdown") return null;
    return { type: "spin", pid };
  }

  const INTENTS = { bid: bidIntent, guess: guessIntent, plinko: plinkoIntent, spin: spinIntent };

  function onMessage(pid, raw) {
    const msg = core().validatePhoneMsg(raw);
    if (!msg) return;                       // junk frame: ignored, never thrown
    const state = window.TpirApp.core();
    if (!state) return;
    if (window.TpirApp.isTakenOver(pid)) return;   // the host has the controls
    const build = INTENTS[msg.t];
    if (!build) return;
    const event = build(pid, msg, state);
    // Every one of these is checked again inside the reducer; nothing a phone
    // sends can advance the show on its own.
    if (event) window.TpirApp.dispatch(event);
  }

  /* ============ Outbound: one masked view per phone ============ */

  const INTERACTIVE = ["bid", "guess", "plinko", "spin", "showcase-bid"];

  /**
   * What one phone is allowed to see. A phone the host has taken over is shown
   * a plain waiting card instead of controls that would be ignored anyway.
   */
  function viewFor(state, pid) {
    if (!state) return { t: "view", screen: "wait", headline: "Waiting for the host…", sub: "The show is being set up." };
    const base = core().phoneView(state, pid);
    const taken = window.TpirApp.isTakenOver(pid);
    if (!taken || INTERACTIVE.indexOf(base.screen) < 0) return Object.assign({ t: "view", taken }, base);
    return Object.assign({ t: "view" }, base, {
      screen: "wait", taken: true,
      sub: "The host has taken the controls for this one.",
    });
  }

  function pushViews(state) {
    if (!room || !room.players) return;
    room.players().forEach((p) => {
      if (p.manual) return;
      const view = viewFor(state, p.pid);
      const key = JSON.stringify(view);
      if (lastSent[p.pid] === key) return;
      lastSent[p.pid] = key;
      room.send(p.pid, view);
    });
  }

  function reportProgress(state) {
    if (!room || !state) return;
    if (room.setTitle) room.setTitle(window.TpirView.segmentLabel(state));
    if (room.reportScores && (state.phase === "standings" || state.phase === "showcase")) {
      room.reportScores(core().standings(state)
        .map((r) => ({ pid: r.pid, name: r.name, score: r.won })));
    }
  }

  /* ============ Standalone room controls ============ */

  function paintRoom() {
    if (!room) return;
    const status = room.status ? room.status() : { open: !!room.code, code: room.code };
    const code = room.code || status.code || null;
    const chip = $("tpir-room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return;                   // the shell owns the room controls
    setText("tpir-room-status", roomMessage(status, code));
    const btn = $("btn-open-room");
    if (btn) btn.textContent = status.open ? "Close room" : "Open room (phones)";
    const note = $("tpir-join-note");
    if (status.open && room.joinUrl && room.joinUrl()) {
      setText("tpir-join-url", room.joinUrl());
      show(note, true);
    } else show(note, false);
  }

  function roomMessage(status, code) {
    if (status.error) return `Room error: ${status.error}`;
    if (status.connecting) return "Opening a room…";
    if (status.open) return `Room ${code} is open — phones can join.`;
    return "Closed — the host can run every part of the show alone.";
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
        setText("tpir-room-status", `Could not open a room: ${err.message}`);
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
    setText("tpir-room-status",
      "Phone support needs shared/bridge.js, which isn’t loaded. The host can still run the whole show.");
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
      window.TpirApp.error(`Phones are unavailable: ${err.message}. The host can still run the show.`);
      return;
    }
    // Bind the (possibly resumed) show to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat.
    window.TpirApp.bindRoom(room.code);
    if (room.onStatus) {
      room.onStatus(() => { window.TpirApp.bindRoom(room.code); paintRoom(); });
    }
    window.TpirApp.subscribe((state) => { pushViews(state); reportProgress(state); paintRoom(); });
    wireRoomButton();
    (room.players ? room.players() : []).forEach(onPlayerJoin);
    paintRoom();
    const exit = $("btn-exit");
    if (exit && room.exit) {
      show(exit, embedded);
      exit.addEventListener("click", () => room.exit());
    }
    window.TpirRoom = {
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
