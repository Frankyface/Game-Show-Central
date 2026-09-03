/* ============================================================
   Family Feud — host-side room glue (spec 03 §5, 00 §7)
   Sits between the GSC SDK and the pure core: turns roster events
   into `setTeam` bookkeeping, validates every phone payload with
   FeudCore.validatePhoneMsg before it touches state, and pushes a
   fresh `phoneView` to each phone on every render. The host stays
   authoritative — phones only ever send intents.
   Everything here is optional: with no SDK (or no room open) the
   host screen plays the whole game on its own.
   ============================================================ */

"use strict";

const FeudRoom = (function () {
  const { $, el, show } = window.FeudApp.helpers;

  /** @type {object|null} the SDK room handle */
  let room = null;
  let embedded = false;
  /** Last payload sent per pid, so an unchanged view isn't re-sent. */
  const lastSent = new Map();
  let lastTitle = "";

  const core = () => window.FeudCore;

  /* ============ Set-up ============ */

  async function init() {
    const GSC = window.GSC;
    if (!GSC || typeof GSC.host !== "function") {
      showUnavailable();
      return;
    }
    embedded = GSC.mode === "embed-host";
    if (embedded) document.body.classList.add("gsc-embedded");
    try {
      room = await GSC.host({
        // Forget the cached view whenever a phone (re)appears: a refreshed or
        // relinked phone keeps its pid, so an unchanged view would otherwise
        // never be re-sent and it would sit on a blank screen.
        onPlayerJoin: (player) => { lastSent.delete(player && player.pid); syncPlayers(); },
        onPlayerLeave: (pid) => { lastSent.delete(pid); syncPlayers(); },
        onPlayerStatus: (pid) => { lastSent.delete(pid); syncPlayers(); },
        onMessage: handleMessage,
      });
    } catch (err) {
      console.warn("Could not start the room:", err);
      setRoomStatus(`Phones are unavailable: ${err.message}`);
      return;
    }
    // Bind the (possibly resumed) game to THIS room before any phone can join,
    // so a fresh p1 never inherits the previous room's seat. Embedded: the code
    // arrives with `init`. Standalone: it arrives when the room opens.
    window.FeudApp.bindRoom(room.code);
    if (typeof room.onStatus === "function") {
      room.onStatus(() => {
        window.FeudApp.bindRoom(room.code);
        paintRoom();
      });
    }
    wireRoomButtons();
    syncPlayers();
    paintRoom();
  }

  /** No SDK on the page: say so plainly instead of a dead button. */
  function showUnavailable() {
    const open = $("btn-open-room");
    if (open) {
      open.disabled = true;
      open.textContent = "Open room (phones) — unavailable";
    }
    setRoomStatus(
      "Phone support needs the shared room code (shared/bridge.js). It isn’t loaded, " +
      "so this page is running host-only — every part of the game still works."
    );
  }

  function wireRoomButtons() {
    const open = $("btn-open-room");
    const close = $("btn-close-room");
    if (open) {
      open.addEventListener("click", () => {
        setRoomStatus("Opening a room…");
        try {
          room.open();
        } catch (err) {
          console.warn("Could not open the room:", err);
          setRoomStatus(`Could not open a room: ${err.message}`);
        }
      });
    }
    if (close) close.addEventListener("click", () => room.close());
  }

  /* ============ Roster ============ */

  function syncPlayers() {
    if (!room) return;
    window.FeudApp.syncRoster(room.players());
  }

  /* ============ Inbound phone payloads ============ */

  function handleMessage(pid, payload) {
    const msg = core().validatePhoneMsg(payload);
    if (!msg) return; // junk: ignored, never thrown
    const state = window.FeudApp.getState();
    if (!state) return;
    if (msg.t === "team") {
      window.FeudApp.dispatch({ type: "setTeam", pid, team: msg.team });
      return;
    }
    if (msg.t === "buzz") {
      window.FeudApp.dispatch({ type: "buzz", pid });
      return;
    }
    if (msg.t === "fm-answer") {
      window.FeudApp.dispatch({ type: "fmAnswer", slot: msg.slot, q: msg.q, text: msg.text, pid });
    }
  }

  /* ============ Outbound phone views ============ */

  /** Called from FeudApp.render() — push each phone its own view. */
  function onRender() {
    if (!room) return;
    const state = window.FeudApp.getState();
    if (!state) return;
    broadcastViews(state);
    reportScores(state);
    setTitle(state);
    paintRoom();
  }

  function broadcastViews(state) {
    room.players().forEach((player) => {
      if (player.connected === false || player.manual) return;
      const view = core().phoneView(state, player.pid);
      const payload = { t: "view", ...view };
      const encoded = JSON.stringify(payload);
      if (lastSent.get(player.pid) === encoded) return;
      lastSent.set(player.pid, encoded);
      room.send(player.pid, payload);
    });
  }

  function reportScores(state) {
    if (typeof room.reportScores !== "function") return;
    const scores = [];
    state.teams.forEach((team, index) => {
      team.players.forEach((pid) => {
        const player = state.roster.find((p) => p.pid === pid);
        scores.push({ pid, name: player ? player.name : pid, score: team.score });
      });
      if (!team.players.length) scores.push({ pid: `team${index}`, name: team.name, score: team.score });
    });
    room.reportScores(scores);
  }

  function setTitle(state) {
    if (typeof room.setTitle !== "function") return;
    let title = "";
    if (state.phase === "fastmoney") title = "Fast Money";
    else if (state.phase === "final") title = "Final standings";
    else if (state.phase !== "setup") title = `Round ${state.roundIndex + 1} of ${state.roundsToPlay}`;
    if (title === lastTitle) return;
    lastTitle = title;
    room.setTitle(title);
  }

  /* ============ Room chrome ============ */

  function paintRoom() {
    if (!room) return;
    const status = typeof room.status === "function" ? room.status() : { open: !!room.code };
    const code = room.code || status.code || null;
    const chip = $("room-chip");
    if (chip) {
      chip.textContent = code ? `Room ${code}` : "";
      show(chip, !!code && !embedded);
    }
    if (embedded) return; // the shell owns the room controls
    show($("btn-open-room"), !status.open && !status.connecting);
    show($("btn-close-room"), !!status.open);
    if (status.error) setRoomStatus(`Room error: ${status.error}`);
    else if (status.connecting) setRoomStatus("Opening a room…");
    else if (status.open) setRoomStatus(`Room ${code} is open — phones can join.`);
    else setRoomStatus("");
    paintJoinLink(status.open ? code : null);
  }

  function paintJoinLink(code) {
    const node = $("room-join");
    if (!node) return;
    node.replaceChildren();
    if (!code || typeof room.joinUrl !== "function") return;
    const url = room.joinUrl();
    node.appendChild(document.createTextNode("Players open "));
    const link = el("a", null, url);
    link.href = url;
    link.rel = "noopener";
    node.appendChild(link);
    node.appendChild(document.createTextNode(` and enter ${code}.`));
  }

  function setRoomStatus(msg) {
    const node = $("room-status");
    if (node) node.textContent = msg || "";
  }

  return { init, onRender, isEmbedded: () => embedded };
})();

window.FeudRoom = FeudRoom;
