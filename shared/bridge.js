/* ============================================================
   Game Show Central — the GSC SDK + the shell-side bridge
   Two exports:
     window.GSC        what a GAME codes against (docs/00 §7).
     window.GSCBridge  what the SHELL uses to talk to a game iframe.
   Four modes, detected at load from the URL: embed-host, embed-player,
   standalone-host, standalone-player. Embedded modes relay through
   postMessage; standalone modes drive RoomHost / RoomPlayer with the
   same v2 envelope and the same lobbyReduce roster rules, so join /
   reject / relink behave identically inside and outside the hub.

   API DEVIATIONS from docs/00-architecture.md §7 — none that break a
   documented call. Additions only, all optional:
     · room.onPlayerRename / handlers.onPlayerRename is NOT provided;
       a rename arrives as a fresh `lobby` snapshot only (the bridge
       protocol has no rename message). Games that show names should
       read room.players() when they render.
     · room.joinUrl() returns null in embedded mode (the shell owns
       the join URL); room.kick() and room.open()/close() are no-ops
       in embedded mode, exactly as the spec says.
     · room.gameId and me.gameId expose <body data-gsc-game>.
     · GSC.ready is a promise that resolves once mode detection is done
       (it already is at load; kept for symmetry).
   No HTML strings anywhere: every node is createElement + textContent.
   ============================================================ */

"use strict";

(function (root) {
  "use strict";

  const RP = root.RoomProtocol;
  const HAS_DOC = typeof document !== "undefined";

  /* ============ Mode + params ============ */

  function parseParams() {
    const out = {};
    if (typeof location === "undefined") return out;
    const sp = new URLSearchParams(location.search);
    for (const [k, v] of sp.entries()) out[k] = v;
    return out;
  }

  const params = parseParams();

  function detectMode(p) {
    if (p.embed === "host") return "embed-host";
    if (p.embed === "player") return "embed-player";
    if (typeof p.room === "string" && p.room) return "standalone-player";
    return "standalone-host";
  }

  const mode = detectMode(params);

  function gameId() {
    if (!HAS_DOC || !document.body) return params.game || "game";
    return document.body.dataset.gscGame || params.game || "game";
  }

  /* ============ postMessage plumbing (iframe side) ============ */

  const ORIGIN = typeof location !== "undefined" ? location.origin : "*";

  function postUp(msg) {
    if (typeof window === "undefined" || !window.parent || window.parent === window) return;
    window.parent.postMessage({ gsc: 1, ...msg }, ORIGIN);
  }

  /**
   * Listen for shell messages. Only same-origin messages from our own parent
   * carrying the `gsc:1` marker are accepted; everything else is ignored.
   */
  function listenDown(handler) {
    if (typeof window === "undefined") return function () {};
    const fn = (event) => {
      if (event.origin !== ORIGIN) return;
      if (event.source !== window.parent) return;
      const d = event.data;
      if (!d || typeof d !== "object" || d.gsc !== 1 || typeof d.t !== "string") return;
      handler(d);
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }

  /* ============ Shared helpers ============ */

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function copyPlayer(p) {
    return {
      pid: p.pid, name: p.name, color: p.color, avatar: p.avatar,
      connected: p.connected !== false, manual: p.manual === true,
    };
  }

  function noop() {}

  function callSafe(fn, a, b) {
    if (typeof fn !== "function") return;
    try { fn(a, b); } catch (err) { console.warn("GSC handler threw:", err); }
  }

  /* ============ Embedded host ============ */

  function embeddedHost(handlers) {
    const roster = new Map(); // pid → Player
    let code = null;
    let resolved = false;
    const room = makeRoomShell();

    Object.defineProperty(room, "code", { get: () => code, enumerable: true });
    room.players = () => Array.from(roster.values()).map(copyPlayer);
    room.send = (pid, m) => postUp({ t: "send", pid, m });
    room.broadcast = (m) => postUp({ t: "send", pid: "*", m });
    room.exit = () => postUp({ t: "exit" });
    room.reportScores = (scores) => postUp({ t: "scores", scores });
    room.setTitle = (text) => postUp({ t: "title", text: String(text == null ? "" : text) });
    room.status = () => ({ open: true, connecting: false, error: null, code });
    room.gameId = gameId();

    return new Promise((resolve) => {
      listenDown((d) => {
        if (d.t === "init") {
          code = d.room && d.room.code ? d.room.code : null;
          roster.clear();
          const list = (d.room && Array.isArray(d.room.players)) ? d.room.players : [];
          for (const p of list) roster.set(p.pid, copyPlayer(p));
          if (!resolved) { resolved = true; resolve(room); }
          return;
        }
        if (d.t === "player-join" && d.player) {
          roster.set(d.player.pid, copyPlayer(d.player));
          callSafe(handlers.onPlayerJoin, copyPlayer(d.player));
          return;
        }
        if (d.t === "player-leave") {
          roster.delete(d.pid);
          callSafe(handlers.onPlayerLeave, d.pid);
          return;
        }
        if (d.t === "player-status") {
          const p = roster.get(d.pid);
          if (p) roster.set(d.pid, { ...p, connected: d.connected === true });
          callSafe(handlers.onPlayerStatus, d.pid, d.connected === true);
          return;
        }
        if (d.t === "msg") callSafe(handlers.onMessage, d.pid, d.m);
      });
      postUp({ t: "ready" });
    });
  }

  /** The no-op surface every room object shares, so games never feature-detect. */
  function makeRoomShell() {
    return {
      open: noop, close: noop, kick: noop,
      joinUrl: () => null,
      onStatus: noop,
      reportScores: noop, setTitle: noop,
    };
  }

  /* ============ Embedded player ============ */

  function embeddedPlayer(handlers) {
    let resolved = false;
    const me = {
      pid: null, name: "", color: null, avatar: null, code: null,
      gameId: gameId(),
      send: (m) => postUp({ t: "send", m }),
      leave: noop, // the shell owns leaving in embedded mode
      connected: true,
    };
    return new Promise((resolve) => {
      listenDown((d) => {
        if (d.t === "init") {
          const info = d.me || {};
          me.pid = info.pid || null;
          me.name = info.name || "";
          me.color = info.color || null;
          me.avatar = info.avatar || null;
          me.code = d.room && d.room.code ? d.room.code : null;
          if (!resolved) { resolved = true; resolve(me); }
          return;
        }
        if (d.t === "msg") { callSafe(handlers.onMessage, d.m); return; }
        if (d.t === "status") {
          me.connected = d.connected === true;
          callSafe(handlers.onStatus, me.connected);
          return;
        }
        if (d.t === "conn-close") {
          me.connected = false;
          callSafe(handlers.onConnClose);
          callSafe(handlers.onStatus, false);
        }
      });
      postUp({ t: "ready" });
    });
  }

  /* ============ Standalone host ============ */

  // Closure factory, not a long function (see the house rule): the body assembles
  // one `room` object out of small helpers over private lobby + transport state.
  function standaloneHost(handlers) {
    const id = gameId();
    let lobby = RP.createLobbyState();
    let host = null;
    let last = { status: "closed", code: null, error: null, broker: "ok" };
    const statusListeners = [];
    const room = makeRoomShell();

    function notify() { for (const fn of statusListeners) callSafe(fn, { ...last }); }

    function applyEffects(effects) {
      for (const eff of effects) {
        // TESTER FIX: `host` is null until room.open(); a standalone game may build
        // its roster (addManual/kick/lock) with the room still closed.
        if (eff.send) { if (host) host.send(eff.send.to, eff.send.msg); }
        // A kicked peer is off `lobby.peers`, so it never receives the snapshot
        // that follows its `kicked` message.
        else if (eff.broadcastLobby) { if (host) host.broadcast(RP.lobbySnapshot(lobby), (peerId) => !!lobby.peers[peerId]); }
        else if (eff.close) { if (host) host.dropConnection(eff.close, true); }
        else if (eff.frame) dispatchFrame(eff.frame);
      }
    }

    function dispatchFrame(frame) {
      if (frame.t === "player-join") callSafe(handlers.onPlayerJoin, copyPlayer(frame.player));
      else if (frame.t === "player-leave") callSafe(handlers.onPlayerLeave, frame.pid);
      else if (frame.t === "player-status") callSafe(handlers.onPlayerStatus, frame.pid, frame.connected);
    }

    function reduce(event) {
      const out = RP.lobbyReduce(lobby, event);
      lobby = out.state;
      applyEffects(out.effects);
    }

    function onEvent(ev) {
      if (ev.type === "close") { reduce({ type: "leave", peerId: ev.peerId }); return; }
      if (ev.type === "stale") { reduce({ type: "status", peerId: ev.peerId, connected: !ev.stale }); return; }
      if (ev.type !== "data") return;
      const msg = ev.msg;
      if (msg.t === "join") {
        reduce({ type: "join", peerId: ev.peerId, name: msg.name, avatar: msg.avatar, pid: msg.pid });
        return;
      }
      if (msg.t === "avatar") return; // standalone games do not offer avatar changes
      if (msg.t !== "game") return;
      if (msg.g !== id) { console.warn("GSC: dropped a payload for another game:", msg.g); return; }
      const pid = lobby.peers[ev.peerId];
      if (!pid) return;
      callSafe(handlers.onMessage, pid, msg.m);
    }

    function ensureHost() {
      if (host) return host;
      host = root.RoomHost.createRoomHost({
        onEvent,
        onStatus: (s) => { last = s; notify(); },
      });
      return host;
    }

    function peerFor(pid) {
      for (const peerId of Object.keys(lobby.peers)) if (lobby.peers[peerId] === pid) return peerId;
      return null;
    }

    Object.defineProperty(room, "code", { get: () => last.code, enumerable: true });
    room.gameId = id;
    room.players = () => RP.playerList(lobby);
    room.send = (pid, m) => {
      if (pid === "*") return room.broadcast(m);
      const peerId = peerFor(pid);
      if (peerId && host) host.send(peerId, RP.gameMsg(id, m));
      return undefined;
    };
    room.broadcast = (m) => { if (host) host.broadcast(RP.gameMsg(id, m)); };
    room.open = (code) => { ensureHost().open(RP.normalizeRoomCode(code) || undefined); };
    room.close = () => {
      if (!host) return;
      host.close();
      lobby = RP.createLobbyState();
    };
    room.kick = (pid) => reduce({ type: "kick", pid });
    room.addManual = (name) => reduce({ type: "addManual", name });
    room.lock = (locked) => reduce({ type: "lock", locked });
    room.status = () => ({
      open: last.status === "open", connecting: last.status === "connecting",
      error: last.error, code: last.code,
    });
    room.onStatus = (fn) => { if (typeof fn === "function") { statusListeners.push(fn); fn({ ...last }); } };
    room.joinUrl = () => {
      if (typeof location === "undefined" || !last.code) return null;
      return `${location.origin}${location.pathname}?room=${last.code}`;
    };
    room.exit = () => {
      room.close();
      if (typeof location !== "undefined") location.reload();
    };
    room.reportScores = noop; // no shell to report to
    room.setTitle = noop;

    return Promise.resolve(room);
  }

  /* ============ Standalone player ============ */

  const PLAYER_STORE = "gsc-standalone-player-v1";

  function readStore() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(PLAYER_STORE);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) { return {}; }
  }

  function writeStore(data) {
    try { root.localStorage.setItem(PLAYER_STORE, JSON.stringify(data)); }
    catch (err) { console.warn("GSC: could not save player details", err); }
  }

  // Closure factory (see standaloneHost): small helpers over one private `me`.
  function standalonePlayer(handlers) {
    const id = gameId();
    const code = RP.normalizeRoomCode(params.room);
    const saved = readStore();
    const me = {
      pid: null, name: "", color: null, avatar: null, code, gameId: id,
      connected: false,
      send: noop, leave: noop,
    };
    let transport = null;
    let resolveMe = null;
    const done = new Promise((res) => { resolveMe = res; });

    function onMessage(msg) {
      if (msg.t === "joined") {
        me.pid = msg.pid; me.name = msg.name; me.color = msg.color; me.avatar = msg.avatar;
        me.connected = true;
        writeStore({ code, pid: msg.pid, name: msg.name, avatar: msg.avatar });
        hideJoinCard();
        if (resolveMe) { resolveMe(me); resolveMe = null; }
        return;
      }
      if (msg.t === "game") {
        if (msg.g !== id) return;
        callSafe(handlers.onMessage, msg.m);
        return;
      }
      if (msg.t === "room-closed" || msg.t === "kicked") {
        me.connected = false;
        callSafe(handlers.onStatus, false);
        showJoinCard(msg.t === "kicked"
          ? "The host removed you from the room."
          : "The host closed the room.");
      }
    }

    function onStatus(s) {
      me.connected = s.connected;
      callSafe(handlers.onStatus, s.connected);
      renderJoinStatus(s);
    }

    function start(name, avatar) {
      transport = root.RoomPlayer.createRoomPlayer({
        onMessage,
        onStatus,
        onRejected: (reason) => showJoinCard(rejectText(reason)),
      });
      me.send = (m) => transport.send(RP.gameMsg(id, m));
      me.leave = () => { transport.leave(); showJoinCard(""); };
      const usePid = saved.code === code ? saved.pid : null;
      transport.connect(code, name, usePid, avatar || saved.avatar);
    }

    const preName = RP.sanitizeName(params.name) || (saved.code === code ? RP.sanitizeName(saved.name) : null);
    if (preName) start(preName, saved.avatar);
    else buildJoinCard(start, code);

    return done;
  }

  function rejectText(reason) {
    if (reason === "name-taken") return "That name is taken — add an initial.";
    if (reason === "room-full") return "Room is full.";
    if (reason === "locked") return "The host locked the lobby.";
    if (reason === "bad-name") return "Enter your name.";
    return "The host turned down that join.";
  }

  /* ---- the minimal standalone join card (rendered into #gsc-join) ---- */

  let joinNodes = null;

  function joinHost() {
    return HAS_DOC ? document.getElementById("gsc-join") : null;
  }

  function buildJoinCard(start, code) {
    const host = joinHost();
    if (!host) { console.warn("GSC: no #gsc-join container for the join card"); return; }
    host.replaceChildren();
    const card = el("div", "gsc-join-card");
    card.appendChild(el("h2", "gsc-join-title", "Join the room"));

    const codeLabel = el("label", "field");
    codeLabel.appendChild(el("span", "field-label", "Room code"));
    const codeInput = el("input", "field-input");
    codeInput.type = "text";
    codeInput.value = code || "";
    codeInput.maxLength = 4;
    codeInput.autocapitalize = "characters";
    codeInput.readOnly = !!code;
    codeLabel.appendChild(codeInput);
    card.appendChild(codeLabel);

    const nameLabel = el("label", "field");
    nameLabel.appendChild(el("span", "field-label", "Your name"));
    const nameInput = el("input", "field-input");
    nameInput.type = "text";
    nameInput.maxLength = RP.NAME_MAX;
    nameLabel.appendChild(nameInput);
    card.appendChild(nameLabel);

    const err = el("p", "error-msg");
    const status = el("p", "hint-msg");
    const btn = el("button", "btn btn-gold btn-tap", "Join");
    btn.type = "button";
    btn.addEventListener("click", () => {
      const name = RP.sanitizeName(nameInput.value);
      if (!name) { err.textContent = "Enter your name."; return; }
      err.textContent = "";
      start(name, null);
    });
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    card.appendChild(btn);
    card.appendChild(err);
    card.appendChild(status);
    host.appendChild(card);
    host.classList.remove("hidden");
    joinNodes = { host, err, status, btn };
  }

  function showJoinCard(message) {
    if (!joinNodes) return;
    joinNodes.host.classList.remove("hidden");
    joinNodes.err.textContent = message || "";
    joinNodes.btn.disabled = false;
    joinNodes.btn.textContent = "Join";
  }

  function hideJoinCard() {
    if (joinNodes) joinNodes.host.classList.add("hidden");
  }

  function renderJoinStatus(s) {
    if (!joinNodes) return;
    joinNodes.btn.disabled = s.phase === "connecting";
    joinNodes.btn.textContent = s.phase === "connecting" ? s.attemptLabel : "Join";
    joinNodes.status.textContent = s.phase === "reconnecting" ? "Reconnecting…" : "";
    if (s.phase === "failed" && s.message) joinNodes.err.textContent = s.message;
  }

  /* ============ Public SDK ============ */

  const GSC = {
    mode,
    params,
    get gameId() { return gameId(); },
    ready: Promise.resolve(mode),
    host(handlers) {
      const h = handlers || {};
      if (mode === "embed-host") return embeddedHost(h);
      if (mode === "standalone-host") return standaloneHost(h);
      return Promise.reject(new Error(`GSC.host() called in ${mode} mode`));
    },
    player(handlers) {
      const h = handlers || {};
      if (mode === "embed-player") return embeddedPlayer(h);
      if (mode === "standalone-player") return standalonePlayer(h);
      return Promise.reject(new Error(`GSC.player() called in ${mode} mode`));
    },
    isEmbedded: () => mode.indexOf("embed-") === 0,
    isPlayer: () => mode.slice(-7) === "-player",
    rejectText,
    _detectMode: detectMode,
  };

  /* ============ Shell side: talking to a game iframe ============ */

  /**
   * Accept only same-origin messages carrying `gsc:1` from THIS iframe's window.
   * Anything else (another frame, another origin, a bare object) is ignored —
   * the guard L-U10 pins down.
   */
  function attachFrame(iframe, onMessage) {
    const fn = (event) => {
      if (event.origin !== ORIGIN) return;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const d = event.data;
      if (!d || typeof d !== "object" || d.gsc !== 1 || typeof d.t !== "string") return;
      onMessage(d);
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }

  function postTo(iframe, msg) {
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ gsc: 1, ...msg }, ORIGIN);
  }

  function attachHostFrame(iframe, api) {
    const a = api || {};
    const detach = attachFrame(iframe, (d) => {
      if (d.t === "ready") callSafe(a.onReady);
      else if (d.t === "send") callSafe(a.onSend, d.pid, d.m);
      else if (d.t === "close") callSafe(a.onClose, d.pid);
      else if (d.t === "exit") callSafe(a.onExit);
      else if (d.t === "scores") callSafe(a.onScores, d.scores);
      else if (d.t === "title") callSafe(a.onTitle, d.text);
    });
    return {
      postInit: (room) => postTo(iframe, { t: "init", mode: "embed-host", room }),
      postPlayerJoin: (player) => postTo(iframe, { t: "player-join", player }),
      postPlayerLeave: (pid) => postTo(iframe, { t: "player-leave", pid }),
      postPlayerStatus: (pid, connected) => postTo(iframe, { t: "player-status", pid, connected }),
      postMsg: (pid, m) => postTo(iframe, { t: "msg", pid, m }),
      detach,
    };
  }

  function attachPlayerFrame(iframe, api) {
    const a = api || {};
    const detach = attachFrame(iframe, (d) => {
      if (d.t === "ready") callSafe(a.onReady);
      else if (d.t === "send") callSafe(a.onSend, d.m);
      else if (d.t === "exit") callSafe(a.onExit);
    });
    return {
      postInit: (me, room) => postTo(iframe, { t: "init", mode: "embed-player", me, room }),
      postMsg: (m) => postTo(iframe, { t: "msg", m }),
      postStatus: (connected) => postTo(iframe, { t: "status", connected }),
      postConnClose: () => postTo(iframe, { t: "conn-close" }),
      detach,
    };
  }

  root.GSC = GSC;
  root.GSCBridge = { attachHostFrame, attachPlayerFrame, attachFrame, postTo, ORIGIN };
})(typeof globalThis !== "undefined" ? globalThis : this);
