/* ============================================================
   Jeopardy — Game Show Central embed adapter (docs/02 §2)
   The ONE new script that makes the vendored Jeopardy page run inside
   the hub. Loaded FIRST (before data.js), after shared/bridge.js and
   shared/virtual-peer.js, so it can install the PeerJS shim before any
   Jeopardy script asks for one.

   Standalone (`games/jeopardy/index.html` opened directly) is a hard
   no-op: GSC.mode is "standalone-host" / "standalone-player", every
   branch below returns immediately, and not one byte of Jeopardy
   behaviour changes. Nothing here ever runs unless ?embed=host or
   ?embed=player is on the URL.

   What it does when embedded:
     1. window.peerjs = {Peer: VirtualPeer}  → loadPeerJs() resolves at
        once and every `new window.peerjs.Peer(...)` talks postMessage
        to the shell instead of a broker.
     2. <body class="gsc-embedded">           → css/gsc-embed.css hides
        the standalone room controls, the join note and the phone's
        join card / code chip / "Leave room".
     3. Host: strips ?room= from the frame URL (history.replaceState)
        so Jeopardy's own "am I a phone?" test (`?room=` present) still
        means exactly what it means standalone — the hub's host frame
        carries ?embed=host&room=CODE and must NOT become a phone. Then
        boots BuzzerHost onto the shell's code and mirrors the lobby
        roster (including manual, phone-less players) onto the
        scoreboard, and reports scores back on every state change.
     4. Phone: buzzer-player.js auto-joins with ?name= (its one // GSC:
        edit); this file only relabels the transient join card.

   No innerHTML anywhere: every node is createElement + textContent.
   ============================================================ */

"use strict";

const GscEmbed = (function () {
  "use strict";

  /* ============ Mode detection ============ */

  const SDK = typeof window !== "undefined" ? window.GSC : null;
  const MODE = SDK ? SDK.mode : "standalone-host";
  const IS_HOST = MODE === "embed-host";
  const IS_PLAYER = MODE === "embed-player";
  const EMBEDDED = IS_HOST || IS_PLAYER;
  /** Shell room code, captured before the URL is rewritten. */
  const ROOM_CODE = SDK && SDK.params ? SDK.params.room || null : null;
  /** Prefix for the scoreboard ids of manual (phone-less) lobby players. */
  const MANUAL_ID_PREFIX = "gsc-";
  /**
   * How long the phone waits for the auto-join before it gives the player the
   * ordinary Jeopardy join card back (D5). Comfortably longer than the shell's
   * own join deadline, so a slow-but-working connection is never interrupted.
   */
  const AUTOJOIN_GRACE_MS = 12000;
  /** buzzer-player.js NAME_MAX / the #player-name maxlength. */
  const NAME_MAX = 24;

  /* ============ Module state (never serialised) ============ */

  let room = null; // the GSC host handle, once GSC.host() resolves
  let lastReport = ""; // JSON of the last scores we reported (dedupe)
  let bootedHost = false;
  /**
   * D4 — pid memo. A phone that drops and returns keeps its shell pid, but its
   * virtual connection is closed and re-announced, so for a moment
   * BuzzerHost._roomState() knows nothing about it and a live-only lookup would
   * report `pid:null` into the night standings. These two maps are written
   * whenever a live connection is seen and are NEVER cleared on close, so the
   * pid survives the gap. A later, genuinely different connection for the same
   * player simply overwrites the entry.
   */
  const pidByPlayerId = new Map(); // Jeopardy scoreboard id → shell pid
  const pidByName = new Map(); // lower-cased joined name → shell pid

  /* ============ App-global bridges (defensive) ============ */
  // app.js declares `state` / `setState` with let/function at top level, so they
  // are global-lexical, not window properties — reach them by bare name at CALL
  // time (this file runs before app.js) and tolerate their absence entirely.

  function appState() {
    return typeof state !== "undefined" ? state : null;
  }
  function appSetState(patch) {
    if (typeof setState === "function") setState(patch);
  }
  function buzzerHost() {
    return typeof window !== "undefined" ? window.BuzzerHost || null : null;
  }

  /* ============ 1–2. Install the shim + mark the body ============ */

  function install() {
    if (!EMBEDDED) return false;
    if (window.VirtualPeer && typeof window.VirtualPeer.install === "function") {
      window.VirtualPeer.install();
    } else {
      console.warn("GSC: shared/virtual-peer.js is missing — buzzers will not work embedded.");
    }
    markBody();
    return true;
  }

  /**
   * `gsc-embedded` gates every rule in css/gsc-embed.css. On a phone we also add
   * `gsc-autojoin`, which is what actually hides the join card's fields — the
   * watchdog drops it if the auto-join never lands, handing the player a working
   * form back instead of a dead "Connecting…" card (D5).
   */
  function markBody() {
    const apply = () => {
      if (!document.body) return;
      document.body.classList.add("gsc-embedded");
      if (IS_PLAYER) document.body.classList.add("gsc-autojoin");
    };
    if (document.body) apply();
    else document.addEventListener("DOMContentLoaded", apply);
  }

  /**
   * The hub's host frame URL is `?embed=host&room=CODE`. Jeopardy decides it is
   * a phone from the bare presence of `?room=` (app.js init, buzzer-player
   * isPlayerMode), so leaving it there would turn the host screen into a
   * buzzer. Rewriting the frame's own URL — same document, no reload — makes
   * every downstream `location.search` read see exactly what it sees
   * standalone. `?game=` and any other param are preserved.
   */
  function stripRoomParam() {
    if (!IS_HOST || typeof history === "undefined" || !history.replaceState) return;
    const sp = new URLSearchParams(location.search);
    if (!sp.has("room")) return;
    sp.delete("room");
    const qs = sp.toString();
    try {
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
    } catch (err) {
      console.warn("GSC: could not tidy the frame URL", err);
    }
  }

  /* ============ 3. Host side ============ */

  function bootHost() {
    SDK.host({
      onPlayerJoin: () => syncManualPlayers(),
      onPlayerLeave: () => reportScores(),
      onPlayerStatus: () => reportScores(),
      // Phone payloads reach Jeopardy through the virtual peer, not here.
      onMessage: () => {},
    })
      .then((r) => {
        room = r;
        whenReady(startBuzzerRoom);
      })
      .catch((err) => console.warn("GSC: host handshake failed", err));
  }

  /**
   * Open Jeopardy's own buzzer room on the shell's code. `openRoom` is already
   * public upstream; the shim makes it instant and broker-free. boot() skips
   * its saved-code auto-open when embedded (its one // GSC: edit), so this is
   * the only opener and the code is always the shell's.
   */
  function startBuzzerRoom() {
    if (bootedHost) return;
    const h = buzzerHost();
    if (!h || typeof h.openRoom !== "function") {
      console.warn("GSC: BuzzerHost is missing — phones cannot buzz in this round.");
      return;
    }
    bootedHost = true;
    h.openRoom(ROOM_CODE || undefined);
    syncManualPlayers();
    renderManagedNote();
    reportScores();
  }

  /**
   * Lobby players with no phone (`manual`) never open a virtual connection, so
   * the shim never announces them. Add them to the scoreboard by hand with a
   * stable, pid-derived id so the host can score them, and so coming back from
   * the lobby (⌂) re-uses the same rows instead of duplicating them.
   */
  function syncManualPlayers() {
    if (!room) return;
    const s = appState();
    if (!s || !Array.isArray(s.players)) return;
    const max = typeof MAX_PLAYERS !== "undefined" ? MAX_PLAYERS : 8;
    const have = new Set(s.players.map((p) => p.id));
    const additions = [];
    for (const p of room.players()) {
      if (!p.manual) continue;
      const id = MANUAL_ID_PREFIX + p.pid;
      if (have.has(id)) continue;
      if (s.players.length + additions.length >= max) break;
      additions.push({ id, name: p.name, score: 0 });
    }
    if (additions.length > 0) appSetState({ players: [...s.players, ...additions] });
    else reportScores();
  }

  /**
   * Learn pids from every virtual connection BuzzerHost currently holds. The
   * connection's peer id IS the shell pid. Called before each report; entries
   * are only ever added or overwritten, never removed (D4).
   */
  function refreshPidMap() {
    const h = buzzerHost();
    const players = h && typeof h._roomState === "function" ? h._roomState().players : {};
    for (const peerId of Object.keys(players)) {
      const p = players[peerId] || {};
      if (p.playerId) pidByPlayerId.set(p.playerId, peerId);
      if (p.name) pidByName.set(String(p.name).toLowerCase(), peerId);
    }
  }

  /**
   * pid for a Jeopardy scoreboard player, most reliable source first: the pid
   * remembered for this scoreboard id, then the one remembered for this name
   * (covers a rejoin that has not relinked yet), then the pid a manual row
   * carries in its own id. Anything else — a player the host typed into
   * Jeopardy's own setup list — reports with pid:null and its name.
   */
  function pidFor(playerId, name) {
    const byId = pidByPlayerId.get(playerId);
    if (byId) return byId;
    if (name) {
      const byName = pidByName.get(String(name).toLowerCase());
      if (byName) return byName;
    }
    if (playerId.indexOf(MANUAL_ID_PREFIX) === 0) return playerId.slice(MANUAL_ID_PREFIX.length);
    return null;
  }

  /** Push the scoreboard to the hub's night standings (docs/02 §2.5). */
  function reportScores() {
    if (!room || typeof room.reportScores !== "function") return;
    const s = appState();
    if (!s || !Array.isArray(s.players)) return;
    refreshPidMap();
    const scores = s.players.map((p) => ({ pid: pidFor(p.id, p.name), name: p.name, score: p.score }));
    const key = JSON.stringify(scores);
    if (key === lastReport) return; // every setState lands here; only real changes go out
    lastReport = key;
    room.reportScores(scores);
  }

  /**
   * Replace the standalone "Open buzzer room" panel with a plain statement of
   * fact. The note is a SIBLING of #buzzer-setup, because renderSetupPanel()
   * calls replaceChildren() on that element every render — this way the panel
   * itself needs no upstream edit (css/gsc-embed.css hides its controls).
   */
  function renderManagedNote() {
    const panel = document.getElementById("buzzer-setup");
    if (!panel || !panel.parentNode || document.getElementById("gsc-room-note")) return;
    const note = document.createElement("p");
    note.id = "gsc-room-note";
    note.className = "gsc-room-note";
    note.textContent = ROOM_CODE
      ? `Room ${ROOM_CODE} — managed by Game Show Central. Everyone in the lobby is already here.`
      : "Buzzers are managed by Game Show Central.";
    panel.parentNode.insertBefore(note, panel.nextSibling);
  }

  /* ============ 4. Phone side ============ */

  function bootPlayer() {
    SDK.player({
      // Jeopardy's own buzzer protocol rides the virtual connection, so the SDK
      // handlers stay empty; the shim turns a shell drop into the one synthetic
      // network error that starts Jeopardy's "Reconnecting…".
      onMessage: () => {},
      onStatus: () => {},
    }).catch((err) => console.warn("GSC: player handshake failed", err));
    whenReady(() => {
      // The fields and Join button are hidden by `body.gsc-autojoin` while the
      // automatic join is still expected to work, so the heading is all the
      // player sees — normally for a fraction of a frame.
      relabelJoinCard("Connecting…");
      prefillPlayerName();
      buildStuckMessage();
      setTimeout(revealJoinCardIfStuck, AUTOJOIN_GRACE_MS);
    });
  }

  function relabelJoinCard(text) {
    const title = document.querySelector("#player-join .player-join-title");
    if (title) title.textContent = text;
  }

  /**
   * Fill the (hidden) name field from the lobby. buzzer-player.js's own
   * gscAutoJoin() does this too, but it bails when there is no ?name=; doing it
   * here as well means the revealed card is always ready to submit.
   */
  function prefillPlayerName() {
    const field = document.getElementById("player-name");
    const name = SDK && SDK.params && SDK.params.name ? String(SDK.params.name).trim() : "";
    if (field && name && !field.value) field.value = name.slice(0, NAME_MAX);
  }

  /**
   * Our own line of copy inside the join card. buzzer-player.js rewrites
   * #player-error on every render, so a message parked there would be wiped;
   * this node is ours alone and is revealed by `body.gsc-join-stuck`.
   */
  function buildStuckMessage() {
    const card = document.getElementById("player-join");
    if (!card || document.getElementById("gsc-join-stuck-msg")) return;
    const note = document.createElement("p");
    note.id = "gsc-join-stuck-msg";
    note.className = "gsc-join-stuck-msg";
    note.setAttribute("role", "status");
    note.textContent =
      "Couldn't reach the host's buzzer room. Your name and the room code are " +
      "already filled in — tap Join to try again.";
    const err = document.getElementById("player-error");
    if (err && err.parentNode === card) card.insertBefore(note, err);
    else card.appendChild(note);
  }

  /** buzzer-player.js's render() hides #player-join the moment it is joined. */
  function stillOnJoinScreen() {
    const card = document.getElementById("player-join");
    return !!card && !card.classList.contains("hidden");
  }

  /**
   * D5 — the auto-join never landed. Hand the player the ordinary Jeopardy join
   * card, prefilled, plus a plain-English reason: a dead "Connecting…" card with
   * no fields and no button is otherwise a trap that only a page reload escapes.
   * We never re-arm `gsc-autojoin`; from here on the form stays available.
   */
  function revealJoinCardIfStuck() {
    if (!stillOnJoinScreen() || !document.body) return;
    document.body.classList.remove("gsc-autojoin");
    document.body.classList.add("gsc-join-stuck");
    relabelJoinCard("Buzz In");
  }

  /* ============ Hooks called from the upstream files ============ */

  /** app.js setState() → keep the hub's night scoreboard in step. */
  function onStateChanged() {
    if (!IS_HOST) return;
    reportScores();
  }

  /* ============ Boot ============ */

  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function boot() {
    if (!install()) return;
    stripRoomParam();
    if (IS_HOST) bootHost();
    else bootPlayer();
  }

  boot();

  return {
    mode: MODE,
    isEmbedded: () => EMBEDDED,
    onStateChanged,
    // Test seams for tests/gsc-embed-harness.html.
    _room: () => room,
    _pidFor: (playerId, name) => { refreshPidMap(); return pidFor(playerId, name); },
    _syncManualPlayers: syncManualPlayers,
    _revealJoinCardIfStuck: revealJoinCardIfStuck,
  };
})();

window.GscEmbed = GscEmbed;
