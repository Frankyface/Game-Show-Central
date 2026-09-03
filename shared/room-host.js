/* ============================================================
   Game Show Central — host transport (RoomHost)
   Owns THE PeerJS peer for a room: lazy CDN load, `gsc-<CODE>` id,
   code-collision retry, the whole-phase open deadline with one auto
   retry, per-phone rate limiting, heartbeat sweep, broker reconnect,
   and the `room-closed` flush on close. Every effect (peer factory,
   script loader, clock, timers) is injectable so the loopback harness
   and node:test can drive it with fakes.

   Room lifecycle, timings and error texts are lifted from
   games/jeopardy/js/buzzer-host.js — field-tested; do not re-derive.
   Nothing here knows about the lobby roster or the DOM: it hands
   validated envelopes to `onEvent` and status changes to `onStatus`.
   ============================================================ */

"use strict";

(function (root, factory) {
  const isNode = typeof module === "object" && !!module.exports;
  const proto = isNode ? require("./room-protocol.js") : root.RoomProtocol;
  const net = isNode ? require("./room-net.js") : root.RoomNet;
  const api = factory(proto, net);
  if (isNode) module.exports = api;
  root.RoomHost = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RP, NET) {
  "use strict";

  /* ============ Constants (from buzzer-host.js) ============ */

  const PEERJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js";
  const PEERJS_SRI =
    "sha512-XEKeWX+mI3Ov+tg2evDlVQFzVOIp4T8J3cNcCEPaEUGpxJV3eZaN8rHuvnFPvQpGJBHPmrozJDMpm2xcDvtmyQ==";
  const MAX_MSGS_PER_SEC = 20;
  const MAX_OPEN_RETRIES = 5; // code collisions before we give up
  const CLOSE_FLUSH_MS = 400; // let a final message flush before closing a conn

  const ERR_LIBRARY = "Couldn't load the room library — check your internet.";
  const ERR_BROKER = "Couldn't reach the room server — check your internet and try again.";
  const ERR_START = "Couldn't start the room.";
  const ERR_CODES = "Couldn't grab a free room code — please try again.";
  const ERR_LOST = "Lost the connection to the room server.";

  /* ============ Default injectable effects ============ */

  const defaultTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  };

  /** Lazy, SRI-pinned PeerJS load — the single runtime CDN dependency. */
  function browserLoadPeerJs() {
    if (typeof window === "undefined") return Promise.reject(new Error("No window"));
    if (window.peerjs && window.peerjs.Peer) return Promise.resolve();
    if (browserLoadPeerJs._p) return browserLoadPeerJs._p;
    browserLoadPeerJs._p = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PEERJS_URL;
      script.integrity = PEERJS_SRI;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onload = () =>
        window.peerjs && window.peerjs.Peer
          ? resolve()
          : reject(new Error("PeerJS loaded but global missing"));
      script.onerror = () => reject(new Error("Failed to load PeerJS from CDN"));
      document.head.appendChild(script);
    });
    return browserLoadPeerJs._p;
  }

  function browserPeerFactory(id) {
    return NET && NET.PEER_OPTIONS
      ? new window.peerjs.Peer(id, NET.PEER_OPTIONS)
      : new window.peerjs.Peer(id);
  }

  /* ============ Factory ============ */

  /**
   * @param {{
   *   onEvent: (ev: {type:"open"|"data"|"close"|"stale", peerId:string, msg?:object, stale?:boolean}) => void,
   *   onStatus: (s: {status:string, code:string|null, error:string|null, broker:string}) => void,
   *   peerFactory?: (id:string) => any,
   *   loadPeerJs?: () => Promise<void>,
   *   now?: () => number,
   *   timers?: object,
   *   rng?: () => number,
   * }} deps
   * NOTE (house rule: functions < ~50 lines): this is a closure FACTORY, not a
   * long function -- its body is a set of small named functions sharing private
   * transport state. Same shape as Jeopardy's BuzzerHost IIFE; splitting it would
   * mean exporting that state, which is exactly what it exists to hide.
   */
  function createRoomHost(deps) {
    const onEvent = deps.onEvent || function () {};
    const onStatus = deps.onStatus || function () {};
    const makePeer = deps.peerFactory || browserPeerFactory;
    const loadPeerJs = deps.loadPeerJs || (deps.peerFactory ? () => Promise.resolve() : browserLoadPeerJs);
    const now = deps.now || Date.now;
    const T = deps.timers || defaultTimers;
    const rng = deps.rng;

    let peer = null;
    let roomCode = null;
    let roomStatus = "closed"; // closed | connecting | open | error
    let roomError = null;
    const connections = new Map(); // peerId → DataConnection
    const msgTimes = new Map(); // peerId → recent timestamps (rate limit)
    const lastHeard = new Map(); // peerId → ms of last inbound message
    const stalePeers = new Set();
    let heartbeatTimer = null;
    let openDeadline = null;
    let openTries = 0; // whole-phase attempts (§9.7)
    let codeRetries = 0; // unavailable-id regenerations

    const broker = NET && NET.createBrokerController
      ? NET.createBrokerController({
          getPeer: () => peer,
          isRoomOpen: () => roomStatus === "open",
          onStatusChange: () => emitStatus(),
          setTimer: T.setTimeout, clearTimer: T.clearTimeout,
        })
      : null;

    function brokerStatus() { return broker ? broker.status() : "ok"; }

    function emitStatus() {
      onStatus({ status: roomStatus, code: roomCode, error: roomError, broker: brokerStatus() });
    }

    /* ---- lifecycle ---- */

    function open(code, isRetry) {
      if (!isRetry && (roomStatus === "connecting" || roomStatus === "open")) return;
      openTries = isRetry ? openTries + 1 : 1;
      codeRetries = 0;
      roomStatus = "connecting";
      roomError = null;
      armOpenDeadline(code);
      emitStatus();
      loadPeerJs()
        .then(() => startPeer(RP.isRoomCode(code) ? code : RP.generateRoomCode(rng)))
        .catch((err) => fail(ERR_LIBRARY, err));
    }

    // ONE whole-phase deadline covers library load + broker registration: a hung
    // 101/pending socket fires neither "open" nor "error" (buzzer-spec §9.7).
    function armOpenDeadline(code) {
      T.clearTimeout(openDeadline);
      openDeadline = T.setTimeout(() => {
        openDeadline = null;
        if (roomStatus !== "connecting") return;
        destroyPeer();
        if (openTries < (NET ? NET.HOST_OPEN_ATTEMPTS : 2)) open(code, true);
        else fail(ERR_BROKER);
      }, NET ? NET.JOIN_DEADLINE_MS : 12000);
    }

    function startPeer(code) {
      let instance;
      try {
        instance = makePeer(RP.PEER_PREFIX + code);
      } catch (err) {
        fail(ERR_START, err);
        return;
      }
      peer = instance;
      peer.on("open", () => {
        T.clearTimeout(openDeadline);
        openDeadline = null;
        roomCode = code;
        roomStatus = "open";
        roomError = null;
        if (broker) broker.recovered();
        if (!heartbeatTimer) {
          heartbeatTimer = T.setInterval(sweepLiveness, NET ? NET.HEARTBEAT_SWEEP_MS : 5000);
        }
        emitStatus();
      });
      peer.on("connection", handleConnection);
      peer.on("error", handlePeerError);
      if (typeof peer.on === "function") peer.on("disconnected", () => { if (broker) broker.onDisconnected(); });
    }

    function handlePeerError(err) {
      const type = err && err.type;
      if (type === "unavailable-id") {
        if (codeRetries < MAX_OPEN_RETRIES) {
          codeRetries += 1;
          destroyPeerKeepDeadline();
          startPeer(RP.generateRoomCode(rng));
          return;
        }
        fail(ERR_CODES, err);
        return;
      }
      if (type === "peer-unavailable") return; // a phone chased a stale id
      if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
        // A blip AFTER the room opened must not tear it down — P2P keeps working.
        if (roomStatus === "open") { if (broker) broker.onDisconnected(); }
        else fail(ERR_LOST, err);
        return;
      }
      console.warn("Room host peer error:", err);
    }

    function fail(message, err) {
      if (err) console.warn("Room host:", message, err);
      roomStatus = "error";
      roomError = message;
      emitStatus();
    }

    function close() {
      for (const conn of connections.values()) trySend(conn, { v: 2, t: "room-closed" });
      const dying = Array.from(connections.values());
      T.setTimeout(() => {
        for (const conn of dying) tryClose(conn);
        destroyPeer();
      }, CLOSE_FLUSH_MS);
      connections.clear();
      msgTimes.clear();
      lastHeard.clear();
      stalePeers.clear();
      roomStatus = "closed";
      roomCode = null;
      roomError = null;
      emitStatus();
    }

    function destroyPeer() {
      destroyPeerKeepDeadline();
      T.clearTimeout(openDeadline);
      openDeadline = null;
    }

    // openPeer-style teardown that leaves the whole-phase deadline armed (§9.7).
    function destroyPeerKeepDeadline() {
      try {
        if (peer && typeof peer.destroy === "function") peer.destroy();
      } catch (err) {
        console.warn("Room host: destroy failed", err);
      }
      peer = null;
      if (heartbeatTimer) T.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (broker) broker.reset();
    }

    /* ---- connections ---- */

    function handleConnection(conn) {
      if (!conn || !conn.peer) return;
      connections.set(conn.peer, conn);
      msgTimes.set(conn.peer, []);
      markHeard(conn.peer);
      conn.on("data", (data) => handleData(conn, data));
      conn.on("close", () => handleClose(conn.peer));
      conn.on("error", (err) => console.warn("Room connection error:", err));
      onEvent({ type: "open", peerId: conn.peer });
    }

    function handleData(conn, data) {
      markHeard(conn.peer);
      const msg = RP.validateEnvelope(data);
      const isHeartbeat = !!msg && (msg.t === "ping" || msg.t === "pong");
      if (!isHeartbeat && isFlooding(conn.peer)) {
        dropConnection(conn.peer, false);
        return;
      }
      if (!msg) return;
      if (msg.t === "ping") { trySend(conn, { v: 2, t: "pong" }); return; }
      if (msg.t === "pong") return;
      onEvent({ type: "data", peerId: conn.peer, msg });
    }

    function isFlooding(peerId) {
      const t = now();
      const recent = (msgTimes.get(peerId) || []).filter((x) => t - x < 1000);
      recent.push(t);
      msgTimes.set(peerId, recent);
      return recent.length > MAX_MSGS_PER_SEC;
    }

    function handleClose(peerId) {
      connections.delete(peerId);
      msgTimes.delete(peerId);
      lastHeard.delete(peerId);
      stalePeers.delete(peerId);
      onEvent({ type: "close", peerId });
    }

    /* ---- heartbeat ---- */

    function markHeard(peerId) {
      lastHeard.set(peerId, now());
      if (stalePeers.delete(peerId)) onEvent({ type: "stale", peerId, stale: false });
    }

    // Flag phones silent past HOST_STALE_MS; status only, never a removal.
    function sweepLiveness() {
      if (!NET) return;
      const t = now();
      for (const peerId of connections.keys()) {
        const stale = NET.isStaleAt(lastHeard.get(peerId), t, NET.HOST_STALE_MS);
        if (stale === stalePeers.has(peerId)) continue;
        if (stale) stalePeers.add(peerId); else stalePeers.delete(peerId);
        onEvent({ type: "stale", peerId, stale });
      }
    }

    /* ---- sending ---- */

    function trySend(conn, msg) {
      try {
        if (conn && conn.open !== false) conn.send(msg);
      } catch (err) {
        console.warn("Room send failed:", err);
      }
    }

    function tryClose(conn) {
      try {
        if (conn && typeof conn.close === "function") conn.close();
      } catch (err) {
        console.warn("Room close failed:", err);
      }
    }

    function send(peerId, msg) {
      const conn = connections.get(peerId);
      if (conn) trySend(conn, msg);
    }

    function broadcast(msg, filter) {
      for (const [peerId, conn] of connections.entries()) {
        if (typeof filter === "function" && !filter(peerId)) continue;
        trySend(conn, msg);
      }
    }

    function dropConnection(peerId, deferred) {
      const conn = connections.get(peerId);
      if (!conn) return;
      if (deferred) T.setTimeout(() => tryClose(conn), CLOSE_FLUSH_MS);
      else tryClose(conn);
    }

    /** Tell a phone it was removed, then close after the flush window. */
    function kick(peerId) {
      send(peerId, { v: 2, t: "kicked" });
      dropConnection(peerId, true);
      handleClose(peerId);
    }

    return {
      open: (code) => open(code, false),
      close,
      send,
      broadcast,
      kick,
      dropConnection,
      code: () => roomCode,
      status: () => ({ status: roomStatus, code: roomCode, error: roomError, broker: brokerStatus() }),
      peerIds: () => Array.from(connections.keys()),
      isStale: (peerId) => stalePeers.has(peerId),
      /** Test seam: run the liveness sweep without waiting for the interval. */
      _sweep: sweepLiveness,
    };
  }

  return { createRoomHost, PEERJS_URL, PEERJS_SRI, MAX_MSGS_PER_SEC, MAX_OPEN_RETRIES, CLOSE_FLUSH_MS };
});
