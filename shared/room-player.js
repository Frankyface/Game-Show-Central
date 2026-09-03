/* ============================================================
   Game Show Central — phone transport (RoomPlayer)
   Owns THE connection to a room: lazy CDN load, the whole-phase join
   deadline with three attempts, the 3-second reconnect loop, the
   ping/pong heartbeat plus the wake-from-sleep visibility probe, the
   screen wake lock and the in-app-browser hint. Every effect (peer
   factory, script loader, clock, timers) is injectable so node:test
   and the loopback harness drive it with fakes.

   Connection logic, timings and error texts are lifted from
   games/jeopardy/js/buzzer-player.js — field-tested; do not
   re-derive. Nothing here renders: it reports through `onStatus`.
   ============================================================ */

"use strict";

(function (root, factory) {
  const isNode = typeof module === "object" && !!module.exports;
  const proto = isNode ? require("./room-protocol.js") : root.RoomProtocol;
  const net = isNode ? require("./room-net.js") : root.RoomNet;
  const api = factory(proto, net);
  if (isNode) module.exports = api;
  root.RoomPlayer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (RP, NET) {
  "use strict";

  const PEERJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js";
  const PEERJS_SRI =
    "sha512-XEKeWX+mI3Ov+tg2evDlVQFzVOIp4T8J3cNcCEPaEUGpxJV3eZaN8rHuvnFPvQpGJBHPmrozJDMpm2xcDvtmyQ==";
  const RECONNECT_MS = 3000;
  const FAIL_TIP_THRESHOLD = 2; // consecutive failures before the tips appear

  const ERR_SERVER = "Can't reach the room server. Check your internet.";
  const ERR_DEADLINE = "Couldn't reach the room server. Tap Join to try again.";
  const ERR_NO_ROOM = "No room with that code — check with the host.";
  const ERR_BROWSER = "This browser can't join rooms.";
  const ERR_REACH = "Couldn't reach that room.";

  const TIPS = [
    "Join the same Wi-Fi as the host",
    "Switch between Wi-Fi and mobile data",
    "If you opened this from a chat app, open it in Safari or Chrome instead",
  ];

  const defaultTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  };

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

  function browserPeerFactory() {
    return NET && NET.PEER_OPTIONS
      ? new window.peerjs.Peer(undefined, NET.PEER_OPTIONS)
      : new window.peerjs.Peer();
  }

  /**
   * @param {{
   *   onMessage: (msg: object) => void,
   *   onStatus: (s: object) => void,
   *   onRejected?: (reason: string) => void,
   *   peerFactory?: () => any, loadPeerJs?: () => Promise<void>,
   *   now?: () => number, timers?: object, userAgent?: string,
   * }} deps
   * NOTE (house rule: functions < ~50 lines): this is a closure FACTORY, not a
   * long function -- its body is a set of small named functions sharing private
   * transport state. Same shape as Jeopardy's BuzzerHost IIFE; splitting it would
   * mean exporting that state, which is exactly what it exists to hide.
   */
  function createRoomPlayer(deps) {
    const onMessage = deps.onMessage || function () {};
    const onStatus = deps.onStatus || function () {};
    const onRejected = deps.onRejected || function () {};
    const makePeer = deps.peerFactory || browserPeerFactory;
    const loadPeerJs = deps.loadPeerJs || (deps.peerFactory ? () => Promise.resolve() : browserLoadPeerJs);
    const now = deps.now || Date.now;
    const T = deps.timers || defaultTimers;
    const ua = deps.userAgent !== undefined
      ? deps.userAgent
      : (typeof navigator !== "undefined" ? navigator.userAgent : "");

    let peer = null;
    let conn = null;
    let code = "";
    let name = "";
    let pid = null;
    let avatar = null;
    let phase = "idle"; // idle | connecting | connected | reconnecting | failed
    let message = "";
    let connLive = false;
    let wantConnected = false;
    let everConnected = false;
    let failCount = 0;
    let attempts = NET ? NET.createJoinAttempts() : { attempt: 0, startedAt: null };
    let joinDeadline = null;
    let reconnectTimer = null;
    let pingTimer = null;
    let livenessTimer = null;
    let probeTimer = null;
    let liveness = null;
    let wakeLock = null;

    function emit() {
      onStatus({
        phase, connected: connLive, message,
        attempt: attempts.attempt,
        maxAttempts: NET ? NET.JOIN_MAX_ATTEMPTS : 3,
        attemptLabel: NET ? NET.attemptLabel(attempts, NET.JOIN_MAX_ATTEMPTS) : "Connecting…",
        failCount,
        showTips: failCount >= FAIL_TIP_THRESHOLD,
        tips: TIPS,
        inAppBrowser: NET ? NET.detectInAppBrowser(ua) : null,
      });
    }

    /* ---- connecting ---- */

    function connect(roomCode, playerName, savedPid, savedAvatar) {
      code = RP.normalizeRoomCode(roomCode) || String(roomCode || "").toUpperCase();
      name = playerName;
      pid = RP.isPid(savedPid) ? savedPid : null;
      avatar = RP.sanitizeAvatar(savedAvatar);
      wantConnected = true;
      everConnected = false;
      attempts = NET ? NET.createJoinAttempts() : { attempt: 0, startedAt: null };
      attempt();
    }

    // ONE deadline covers the WHOLE attempt — script load, broker registration and
    // the data channel (buzzer-spec §9.7): a hung socket fires no event at all.
    function attempt() {
      attempts = NET ? NET.beginAttempt(attempts, now()) : { attempt: attempts.attempt + 1, startedAt: now() };
      phase = "connecting";
      message = "";
      armJoinDeadline();
      emit();
      loadPeerJs().then(openPeer).catch(() => attemptFailed(ERR_SERVER, false));
    }

    function armJoinDeadline() {
      T.clearTimeout(joinDeadline);
      joinDeadline = T.setTimeout(() => {
        joinDeadline = null;
        if (connLive) return;
        attemptFailed(ERR_DEADLINE, false);
      }, NET ? NET.JOIN_DEADLINE_MS : 12000);
    }

    /**
     * Single "this attempt failed" path. A wrong CODE is a hard stop (no tips, no
     * retry); a failure after we were once connected hands back to the reconnect
     * loop; otherwise auto-retry up to JOIN_MAX_ATTEMPTS then rest on the error.
     */
    function attemptFailed(text, hardStop) {
      T.clearTimeout(joinDeadline);
      joinDeadline = null;
      teardownPeer();
      if (hardStop) { failJoin(text); return; }
      if (everConnected) { dropped(); return; }
      failCount += 1;
      const canRetry = NET ? NET.canRetryJoin(attempts, NET.JOIN_MAX_ATTEMPTS) : attempts.attempt < 3;
      if (canRetry) attempt();
      else failJoin(text);
    }

    function failJoin(text) {
      connLive = false;
      phase = "failed";
      message = text;
      emit();
    }

    function openPeer() {
      teardownPeer();
      try {
        peer = makePeer();
      } catch (err) {
        console.warn("Room player peer error:", err);
        attemptFailed(ERR_BROWSER, true);
        return;
      }
      peer.on("open", openConnection);
      peer.on("error", handlePeerError);
      peer.on("disconnected", () => dropped());
    }

    function openConnection() {
      try {
        conn = peer.connect(RP.PEER_PREFIX + code, { serialization: "json", metadata: { name } });
      } catch (err) {
        console.warn("Room player connect error:", err);
        attemptFailed(ERR_REACH, false);
        return;
      }
      conn.on("open", onChannelOpen);
      conn.on("data", handleData);
      conn.on("close", () => dropped());
      conn.on("error", (err) => console.warn("Room player connection error:", err));
    }

    function onChannelOpen() {
      connLive = true;
      everConnected = true;
      failCount = 0;
      phase = "connected";
      message = "";
      T.clearTimeout(joinDeadline);
      joinDeadline = null;
      attempts = NET ? NET.createJoinAttempts() : { attempt: 0, startedAt: null };
      cancelReconnect();
      startHeartbeat();
      const join = { v: 2, t: "join", name };
      if (avatar) join.avatar = avatar;
      if (pid) join.pid = pid;
      safeSend(join);
      acquireWakeLock();
      emit();
    }

    function handleData(data) {
      if (NET) liveness = NET.markHeard(liveness, now());
      const msg = RP.validateEnvelope(data);
      if (!msg) return;
      if (msg.t === "pong") return;
      if (msg.t === "joined") { pid = msg.pid; name = msg.name; avatar = msg.avatar; }
      if (msg.t === "reject") {
        stopRetrying();
        message = msg.reason;
        phase = "failed";
        onRejected(msg.reason);
        emit();
        return;
      }
      if (msg.t === "room-closed" || msg.t === "kicked") {
        stopRetrying();
        phase = "idle";
        emit();
      }
      onMessage(msg);
    }

    function handlePeerError(err) {
      const type = err && err.type;
      if (type === "peer-unavailable") { attemptFailed(ERR_NO_ROOM, true); return; }
      if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
        attemptFailed(ERR_SERVER, false);
        return;
      }
      if (type === "browser-incompatible") { attemptFailed(ERR_BROWSER, true); return; }
      console.warn("Room player peer error:", err);
    }

    function dropped() {
      connLive = false;
      releaseWakeLock();
      if (wantConnected) {
        phase = "reconnecting";
        message = "";
        scheduleReconnect();
      }
      emit();
    }

    function scheduleReconnect() {
      if (reconnectTimer) return;
      reconnectTimer = T.setTimeout(() => {
        reconnectTimer = null;
        if (wantConnected && !connLive) attempt();
      }, RECONNECT_MS);
    }

    function cancelReconnect() {
      if (reconnectTimer) T.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    function stopRetrying() {
      wantConnected = false;
      connLive = false;
      cancelReconnect();
      releaseWakeLock();
      teardownPeer();
    }

    /* ---- heartbeat ---- */

    function startHeartbeat() {
      stopHeartbeat();
      if (!NET) return;
      liveness = NET.createLiveness(now());
      pingTimer = T.setInterval(() => safeSend({ v: 2, t: "ping" }), NET.PLAYER_PING_MS);
      livenessTimer = T.setInterval(checkLiveness, NET.HEARTBEAT_SWEEP_MS);
    }

    function stopHeartbeat() {
      if (pingTimer) T.clearInterval(pingTimer);
      if (livenessTimer) T.clearInterval(livenessTimer);
      if (probeTimer) T.clearTimeout(probeTimer);
      pingTimer = livenessTimer = probeTimer = null;
    }

    // 25 s of silence = a dead connection → tear down and reconnect.
    function checkLiveness() {
      if (connLive && NET.isStale(liveness, now(), NET.PLAYER_STALE_MS)) heartbeatLost();
    }

    // Wake-from-sleep probe: ping and demand a pong within 3 s.
    function probeConnection() {
      if (!connLive || !NET) return;
      safeSend({ v: 2, t: "ping" });
      const started = now();
      if (probeTimer) T.clearTimeout(probeTimer);
      probeTimer = T.setTimeout(() => {
        probeTimer = null;
        if (connLive && NET.probeFailed(started, liveness, now(), NET.VISIBILITY_PROBE_MS)) heartbeatLost();
      }, NET.VISIBILITY_PROBE_MS + 50);
    }

    function heartbeatLost() {
      teardownPeer();
      dropped();
    }

    /* ---- teardown / send ---- */

    // Does NOT clear joinDeadline: that is a join-attempt concern owned by
    // attempt()/attemptFailed(), and openPeer() tears down while it is armed.
    function teardownPeer() {
      stopHeartbeat();
      try { if (conn && typeof conn.close === "function") conn.close(); }
      catch (err) { console.warn("Room player close failed:", err); }
      try { if (peer && typeof peer.destroy === "function") peer.destroy(); }
      catch (err) { console.warn("Room player destroy failed:", err); }
      conn = null;
      peer = null;
    }

    function safeSend(msg) {
      try {
        if (conn && conn.open !== false) conn.send(msg);
      } catch (err) {
        console.warn("Room player send failed:", err);
      }
    }

    function leave() {
      stopRetrying();
      everConnected = false;
      T.clearTimeout(joinDeadline);
      joinDeadline = null;
      attempts = NET ? NET.createJoinAttempts() : { attempt: 0, startedAt: null };
      phase = "idle";
      message = "";
      emit();
    }

    /* ---- wake lock (best effort) ---- */

    function acquireWakeLock() {
      try {
        if (typeof navigator === "undefined" || !navigator.wakeLock || wakeLock) return;
        navigator.wakeLock.request("screen").then((lock) => {
          wakeLock = lock;
          lock.addEventListener("release", () => { wakeLock = null; });
        }).catch(() => { /* unsupported or denied */ });
      } catch (err) { /* iOS Safari < 16.4 etc. */ }
    }

    function releaseWakeLock() {
      try { if (wakeLock && typeof wakeLock.release === "function") wakeLock.release(); }
      catch (err) { /* ignore */ }
      wakeLock = null;
    }

    return {
      connect,
      send: safeSend,
      leave,
      probe: probeConnection,
      me: () => ({ pid, name, avatar, code }),
      status: () => ({ phase, connected: connLive, message, failCount }),
      isConnected: () => connLive,
      _checkLiveness: checkLiveness,
    };
  }

  return { createRoomPlayer, RECONNECT_MS, FAIL_TIP_THRESHOLD, TIPS, PEERJS_URL, PEERJS_SRI };
});
