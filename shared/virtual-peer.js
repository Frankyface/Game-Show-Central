/* ============================================================
   Game Show Central — the virtual peer (docs/00 §8)
   A PeerJS-API-compatible shim over the shell bridge, so a game that
   already speaks PeerJS (Jeopardy) runs unchanged inside the hub.
   The adapter installs `window.peerjs = { Peer: VirtualPeer }` BEFORE
   any of the game's own scripts run; every `new Peer()` then talks
   postMessage to the shell instead of a broker.

   Only the subset Jeopardy uses is implemented (00 §8). The bus —
   how messages leave and arrive — is injected, so node:test drives
   this with a fake postMessage pair and no DOM at all.
   ============================================================ */

"use strict";

(function (root) {
  "use strict";

  const ORIGIN = typeof location !== "undefined" ? location.origin : "*";

  /** Tiny event emitter shared by the peer and connection shims. */
  function emitter() {
    const handlers = new Map();
    return {
      on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(fn); },
      off(ev, fn) {
        const list = handlers.get(ev);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
      },
      emit(ev, arg) {
        const list = handlers.get(ev);
        if (!list) return;
        for (const fn of list.slice()) {
          try { fn(arg); } catch (err) { console.warn("VirtualPeer handler threw:", err); }
        }
      },
    };
  }

  const nextTick = (fn) => {
    if (typeof queueMicrotask === "function") queueMicrotask(fn);
    else setTimeout(fn, 0);
  };

  /* ============ The hub: one per bus ============ */

  /**
   * @param {{mode:string, post:(msg:object)=>void, listen:(fn:(msg:object)=>void)=>void}} bus
   */
  // Closure factory, not a long function: the body is the VirtualPeer class plus
  // small helpers, all sharing one private roster/connection map per bus.
  function isPid(pid) { return typeof pid === "string" && /^p[0-9]{1,6}$/.test(pid); }

  function createHub(bus) {
    const isHost = bus.mode === "embed-host";
    const roster = new Map(); // pid → {name}
    const conns = new Map(); // pid → VirtualConnection (host side)
    let hostPeer = null;
    let playerPeer = null;
    let playerConn = null;
    let initSeen = false;
    let roomCode = null;
    // D2: phone messages that arrive before the game has opened its room (no
    // hostPeer yet) or before this pid was announced are held here, per pid, and
    // replayed on that pid's connection right after its `open` fires.
    const PENDING_PER_PID = 20;
    const pendingByPid = new Map();

    function announce(pid) {
      if (!hostPeer || conns.has(pid)) return;
      const info = roster.get(pid) || {};
      const conn = makeConnection(pid, { name: info.name });
      conns.set(pid, conn);
      hostPeer.ev.emit("connection", conn);
      nextTick(() => { conn.ev.emit("open"); drainPending(pid, conn); });
    }

    function drainPending(pid, conn) {
      const queued = pendingByPid.get(pid);
      pendingByPid.delete(pid);
      if (!queued) return;
      for (const m of queued) if (conn.open) conn.ev.emit("data", m);
    }

    function queuePending(pid, m) {
      const q = pendingByPid.get(pid) || [];
      q.push(m);
      if (q.length > PENDING_PER_PID) q.shift();
      pendingByPid.set(pid, q);
    }

    /** Close + forget a host-side connection so a rejoin gets a fresh one (D1). */
    function dropConn(pid) {
      const conn = conns.get(pid);
      conns.delete(pid);
      if (conn && conn.open) { conn.open = false; conn.ev.emit("close"); }
    }

    function announceAll() { for (const pid of roster.keys()) announce(pid); }

    function makeConnection(pid, metadata) {
      const ev = emitter();
      const conn = {
        peer: pid,
        metadata: metadata || {},
        open: true,
        reliable: true,
        ev,
        on: ev.on, off: ev.off,
        send(m) {
          if (!conn.open) return; // TESTER FIX: a closed connection never reaches the bridge
          if (isHost) bus.post({ t: "send", pid, m });
          else bus.post({ t: "send", m });
        },
        close() {
          if (!conn.open) return;
          conn.open = false;
          if (isHost) { bus.post({ t: "close", pid }); if (conns.get(pid) === conn) conns.delete(pid); }
          ev.emit("close");
        },
      };
      return conn;
    }

    bus.listen((d) => {
      if (d.t === "init") {
        initSeen = true;
        roomCode = d.room && d.room.code ? d.room.code : null;
        if (isHost) {
          const list = (d.room && Array.isArray(d.room.players)) ? d.room.players : [];
          for (const p of list) if (p.connected !== false) roster.set(p.pid, { name: p.name });
          announceAll();
        }
        return;
      }
      if (d.t === "player-join" && d.player) {
        roster.set(d.player.pid, { name: d.player.name });
        announce(d.player.pid);
        return;
      }
      if (d.t === "player-leave") {
        roster.delete(d.pid);
        pendingByPid.delete(d.pid);
        dropConn(d.pid);
        return;
      }
      if (d.t === "player-status") {
        // D1: a phone that dropped gets its host-side connection CLOSED so the
        // game frees that player (Jeopardy: handleClose → relink-by-name on the
        // rejoin). When it is back, a fresh connection is announced and the
        // phone's game frame re-joins on it; a stale-sweep false alarm self-heals
        // through the game's own heartbeat/reconnect within ~30 s.
        if (!isHost || !isPid(d.pid)) return;
        if (d.connected === false) dropConn(d.pid);
        else if (roster.has(d.pid)) announce(d.pid);
        return;
      }
      if (d.t === "msg") {
        if (isHost) {
          if (!isPid(d.pid)) return;
          const conn = conns.get(d.pid);
          if (conn && conn.open) { conn.ev.emit("data", d.m); return; }
          queuePending(d.pid, d.m); // D2: replayed after the connection opens
          if (roster.has(d.pid)) announce(d.pid); // no-op until the game has a peer
        } else if (playerConn) {
          playerConn.ev.emit("data", d.m);
        }
        return;
      }
      if (d.t === "conn-close") {
        // TESTER FIX: a repeated conn-close must not emit a second `close`.
        if (playerConn && playerConn.open) { playerConn.open = false; playerConn.ev.emit("close"); }
        return;
      }
      if (d.t === "status" && d.connected === false) {
        // The only error the shim ever raises (00 §8): the game's own reconnect
        // loop then resolves instantly once status:true arrives.
        if (playerPeer) playerPeer.ev.emit("error", { type: "network" });
      }
    });

    /** The PeerJS-compatible constructor. */
    function VirtualPeer(id, opts) {
      if (!(this instanceof VirtualPeer)) return new VirtualPeer(id, opts);
      const ev = emitter();
      this.ev = ev;
      this.id = typeof id === "string" && id ? id : `gsc-virtual-${Math.random().toString(36).slice(2, 8)}`;
      this.open = false;
      this.disconnected = false;
      this.destroyed = false;
      this.options = opts || {};
      const self = this;
      if (isHost) hostPeer = this; else playerPeer = this;
      nextTick(() => {
        if (self.destroyed) return;
        self.open = true;
        ev.emit("open", self.id);
        if (isHost && initSeen) announceAll();
      });
    }

    VirtualPeer.prototype.on = function (ev, fn) { this.ev.on(ev, fn); return this; };
    VirtualPeer.prototype.off = function (ev, fn) { this.ev.off(ev, fn); return this; };
    VirtualPeer.prototype.reconnect = function () {
      if (this.destroyed) return;
      this.disconnected = false;
      const self = this;
      nextTick(() => { self.open = true; self.ev.emit("open", self.id); });
    };
    VirtualPeer.prototype.destroy = function () {
      if (this.destroyed) return; // TESTER FIX: PeerJS emits `close` once per peer
      this.destroyed = true;
      this.open = false;
      if (hostPeer === this) { hostPeer = null; conns.clear(); }
      if (playerPeer === this) playerPeer = null;
      this.ev.emit("close");
    };
    VirtualPeer.prototype.disconnect = function () { this.disconnected = true; };
    VirtualPeer.prototype.connect = function (remoteId, opts) {
      const conn = makeConnection(remoteId, (opts && opts.metadata) || {});
      playerConn = conn;
      nextTick(() => { if (conn.open) conn.ev.emit("open"); });
      return conn;
    };

    return {
      Peer: VirtualPeer,
      /** Test seam: the connections the host shim currently holds. */
      _conns: conns,
      _roster: roster,
      _code: () => roomCode,
    };
  }

  /* ============ Default browser bus ============ */

  function defaultBus(mode) {
    return {
      mode,
      post(msg) {
        if (typeof window === "undefined" || !window.parent || window.parent === window) return;
        window.parent.postMessage({ gsc: 1, ...msg }, ORIGIN);
      },
      listen(fn) {
        if (typeof window === "undefined") return;
        window.addEventListener("message", (event) => {
          if (event.origin !== ORIGIN) return;
          if (event.source !== window.parent) return;
          const d = event.data;
          if (!d || typeof d !== "object" || d.gsc !== 1 || typeof d.t !== "string") return;
          fn(d);
        });
      },
    };
  }

  /**
   * Install the shim as `window.peerjs`. Call BEFORE the game's own scripts run.
   * @param {{mode?:string, bus?:object}} [opts]
   * @returns {{Peer:Function}|null} null when the page is not embedded.
   */
  function install(opts) {
    const o = opts || {};
    const mode = o.mode || (root.GSC ? root.GSC.mode : null);
    if (mode !== "embed-host" && mode !== "embed-player") return null;
    const hub = createHub(o.bus || defaultBus(mode));
    root.peerjs = { Peer: hub.Peer };
    return hub;
  }

  root.VirtualPeer = { createHub, defaultBus, install };
})(typeof globalThis !== "undefined" ? globalThis : this);
