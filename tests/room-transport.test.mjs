/* ============================================================
   L-U7 / L-U8 — RoomHost and RoomPlayer driven with fake peers,
   a fake clock and fake timers. No real network, no real timeouts.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";
import NET from "../shared/room-net.js";
import RoomHostMod from "../shared/room-host.js";
import RoomPlayerMod from "../shared/room-player.js";

const { createRoomHost } = RoomHostMod;
const { createRoomPlayer } = RoomPlayerMod;

/* ---- fake clock + timers ------------------------------------ */

function fakeClock() {
  let t = 1000;
  let nextId = 1;
  const timers = new Map();
  function schedule(fn, ms, repeat) {
    const h = nextId++;
    timers.set(h, { fn, at: t + (ms || 0), repeat });
    return h;
  }
  return {
    now: () => t,
    pending: () => timers.size,
    timers: {
      setTimeout: (fn, ms) => schedule(fn, ms, 0),
      clearTimeout: (h) => { timers.delete(h); },
      setInterval: (fn, ms) => schedule(fn, ms, ms),
      clearInterval: (h) => { timers.delete(h); },
    },
    advance(ms) {
      const end = t + ms;
      for (let guard = 0; guard < 20000; guard += 1) {
        let pick = null;
        for (const [h, timer] of timers) {
          if (timer.at > end) continue;
          if (!pick || timer.at < pick.timer.at) pick = { h, timer };
        }
        if (!pick) break;
        t = pick.timer.at;
        if (pick.timer.repeat) pick.timer.at = t + pick.timer.repeat;
        else timers.delete(pick.h);
        pick.timer.fn();
      }
      t = end;
    },
  };
}

/** Let queued microtasks (the loadPeerJs promise chain) run. */
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

/* ---- fake PeerJS ------------------------------------------- */

function makeEmitter(target) {
  const handlers = new Map();
  target.on = (ev, fn) => { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(fn); };
  target.emit = (ev, arg) => { for (const fn of (handlers.get(ev) || []).slice()) fn(arg); };
  return target;
}

function fakeConn(peerId) {
  const conn = makeEmitter({ peer: peerId, open: true, sent: [], closed: false });
  conn.send = (m) => conn.sent.push(m);
  conn.close = () => { conn.closed = true; conn.open = false; conn.emit("close"); };
  return conn;
}

function fakePeerFactory() {
  const made = [];
  const factory = (id) => {
    const peer = makeEmitter({ id, destroyed: false, open: false });
    peer.destroy = () => { peer.destroyed = true; };
    peer.reconnect = () => {};
    peer.connect = (remote, opts) => {
      const conn = fakeConn(remote);
      conn.metadata = opts && opts.metadata;
      peer.lastConn = conn;
      return conn;
    };
    made.push(peer);
    return peer;
  };
  factory.made = made;
  return factory;
}

/* ============ L-U7 — RoomHost ============ */

test("L-U7 a code collision regenerates the code (up to 5 times)", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const statuses = [];
  const host = createRoomHost({
    onEvent: () => {}, onStatus: (s) => statuses.push(s),
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers, rng: (() => { let i = 0; const seq = [0.1, 0.2, 0.3, 0.4]; return () => seq[i++ % seq.length]; })(),
  });
  host.open("ABCD");
  await flush();
  assert.equal(factory.made.length, 1);
  assert.equal(factory.made[0].id, "gsc-ABCD");

  factory.made[0].emit("error", { type: "unavailable-id" });
  assert.equal(factory.made.length, 2, "a fresh peer with a new code");
  assert.ok(factory.made[0].destroyed);
  assert.notEqual(factory.made[1].id, "gsc-ABCD");
  assert.ok(/^gsc-[A-Z2-9]{4}$/.test(factory.made[1].id));

  factory.made[1].emit("open");
  assert.equal(host.status().status, "open");
  assert.equal(host.code(), factory.made[1].id.slice(4));
});

test("L-U7 five collisions in a row end in a plain-English error", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const host = createRoomHost({
    onEvent: () => {}, onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open();
  await flush();
  for (let i = 0; i < 6; i += 1) factory.made[factory.made.length - 1].emit("error", { type: "unavailable-id" });
  assert.equal(factory.made.length, 6, "initial + 5 retries");
  assert.equal(host.status().status, "error");
  assert.match(host.status().error, /free room code/i);
});

test("L-U7 the whole-phase open deadline retries once then errors", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const statuses = [];
  const host = createRoomHost({
    onEvent: () => {}, onStatus: (s) => statuses.push(s),
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("WXYZ");
  await flush();
  assert.equal(factory.made.length, 1);
  assert.equal(host.status().status, "connecting");

  clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  assert.equal(factory.made.length, 2, "one auto-retry with a fresh Peer");
  assert.ok(factory.made[0].destroyed);
  assert.equal(host.status().status, "connecting");

  clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  assert.equal(factory.made.length, 2, "no third attempt");
  assert.equal(host.status().status, "error");
  assert.match(host.status().error, /Couldn't reach the room server/);
  assert.ok(statuses.some((s) => s.status === "connecting"));
});

test("L-U7 a peer that opens in time cancels the deadline", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const host = createRoomHost({
    onEvent: () => {}, onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("WXYZ");
  await flush();
  factory.made[0].emit("open");
  clock.advance(NET.JOIN_DEADLINE_MS * 3);
  await flush();
  assert.equal(factory.made.length, 1);
  assert.equal(host.status().status, "open");
  assert.equal(host.code(), "WXYZ");
});

test("L-U7 a failed library load says so in plain English", async () => {
  const clock = fakeClock();
  const host = createRoomHost({
    onEvent: () => {}, onStatus: () => {},
    peerFactory: fakePeerFactory(), loadPeerJs: () => Promise.reject(new Error("offline")),
    now: clock.now, timers: clock.timers,
  });
  host.open();
  await flush();
  assert.equal(host.status().status, "error");
  assert.match(host.status().error, /check your internet/i);
});

test("L-U7 the rate limit drops the 21st message in a second but never pings", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const events = [];
  const host = createRoomHost({
    onEvent: (ev) => events.push(ev), onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("ABCD");
  await flush();
  factory.made[0].emit("open");

  const conn = fakeConn("phone1");
  factory.made[0].emit("connection", conn);
  assert.deepEqual(events.shift(), { type: "open", peerId: "phone1" });

  for (let i = 0; i < 20; i += 1) conn.emit("data", { v: 2, t: "game", g: "jeopardy", m: { i } });
  assert.equal(events.filter((e) => e.type === "data").length, 20);

  conn.emit("data", { v: 2, t: "game", g: "jeopardy", m: { i: 20 } });
  assert.equal(events.filter((e) => e.type === "data").length, 20, "the 21st is dropped");
  assert.ok(conn.closed, "a flooding phone is disconnected (Jeopardy behaviour)");

  // Pings are exempt: 60 of them on a fresh connection never trip the limiter.
  const conn2 = fakeConn("phone2");
  factory.made[0].emit("connection", conn2);
  for (let i = 0; i < 60; i += 1) conn2.emit("data", { v: 2, t: "ping" });
  assert.equal(conn2.closed, false);
  assert.equal(conn2.sent.filter((m) => m.t === "pong").length, 60, "every ping is ponged");
  assert.equal(events.filter((e) => e.type === "data" && e.peerId === "phone2").length, 0,
               "heartbeats never reach the game");
});

test("L-U7 junk never reaches onEvent and never throws", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const events = [];
  const host = createRoomHost({
    onEvent: (ev) => events.push(ev), onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("ABCD");
  await flush();
  factory.made[0].emit("open");
  const conn = fakeConn("phone1");
  factory.made[0].emit("connection", conn);
  events.length = 0;
  for (const junk of [null, "x", 5, [], {}, { v: 1, t: "join" }, { v: 2, t: "nope" },
                      { v: 2, t: "game", g: "j", m: "x".repeat(40000) }]) {
    conn.emit("data", junk);
  }
  assert.equal(events.filter((e) => e.type === "data").length, 0);
});

test("L-U7 close sends room-closed and closes the connections after the flush", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const host = createRoomHost({
    onEvent: () => {}, onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("ABCD");
  await flush();
  factory.made[0].emit("open");
  const conn = fakeConn("phone1");
  factory.made[0].emit("connection", conn);

  host.close();
  assert.deepEqual(conn.sent[conn.sent.length - 1], { v: 2, t: "room-closed" });
  assert.equal(conn.closed, false, "not closed until the flush window passes");
  assert.equal(host.status().status, "closed");
  assert.equal(host.code(), null);

  clock.advance(RoomHostMod.CLOSE_FLUSH_MS);
  assert.ok(conn.closed);
  assert.ok(factory.made[0].destroyed);
});

test("L-U7 kick tells the phone, then closes it, and the sweep flags silent phones", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const events = [];
  const host = createRoomHost({
    onEvent: (ev) => events.push(ev), onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("ABCD");
  await flush();
  factory.made[0].emit("open");
  const conn = fakeConn("phone1");
  factory.made[0].emit("connection", conn);

  // Silent past HOST_STALE_MS → a stale event; a message clears it.
  clock.advance(NET.HOST_STALE_MS + NET.HEARTBEAT_SWEEP_MS);
  assert.ok(events.some((e) => e.type === "stale" && e.stale === true));
  assert.ok(host.isStale("phone1"));
  conn.emit("data", { v: 2, t: "ping" });
  assert.ok(events.some((e) => e.type === "stale" && e.stale === false));
  assert.equal(host.isStale("phone1"), false);

  host.kick("phone1");
  assert.deepEqual(conn.sent.filter((m) => m.t === "kicked"), [{ v: 2, t: "kicked" }]);
  assert.ok(events.some((e) => e.type === "close" && e.peerId === "phone1"));
  clock.advance(RoomHostMod.CLOSE_FLUSH_MS);
  assert.ok(conn.closed);
});

test("L-U7 a broker blip after open never tears the room down", async () => {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const host = createRoomHost({
    onEvent: () => {}, onStatus: () => {},
    peerFactory: factory, loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers,
  });
  host.open("ABCD");
  await flush();
  factory.made[0].emit("open");
  factory.made[0].emit("error", { type: "network" });
  assert.equal(host.status().status, "open", "P2P keeps working");
  assert.equal(host.status().broker, "reconnecting");
  assert.match(NET.brokerLabel("reconnecting"), /room server/);
  factory.made[0].emit("open");
  assert.equal(host.status().broker, "ok");
});

/* ============ L-U8 — RoomPlayer ============ */

function playerRig(extra = {}) {
  const clock = fakeClock();
  const factory = fakePeerFactory();
  const messages = [];
  const statuses = [];
  const rejects = [];
  const player = createRoomPlayer({
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onRejected: (r) => rejects.push(r),
    peerFactory: () => factory(undefined),
    loadPeerJs: () => Promise.resolve(),
    now: clock.now, timers: clock.timers, userAgent: "", ...extra,
  });
  return { clock, factory, player, messages, statuses, rejects };
}

/** Bring a rig to a live channel. Returns the fake DataConnection. */
async function connectPlayer(rig, name = "Alex") {
  rig.player.connect("ABCD", name);
  await flush();
  const peer = rig.factory.made[rig.factory.made.length - 1];
  peer.emit("open");
  const conn = peer.lastConn;
  conn.emit("open");
  return conn;
}

test("L-U8 three attempts against a dead broker, then a failure message", async () => {
  const rig = playerRig();
  rig.player.connect("ABCD", "Alex");
  await flush();
  assert.equal(rig.factory.made.length, 1);
  assert.equal(rig.statuses[rig.statuses.length - 1].attemptLabel, "Connecting… attempt 1 of 3");

  rig.clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  assert.equal(rig.factory.made.length, 2);
  rig.clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  assert.equal(rig.factory.made.length, 3);
  assert.equal(rig.statuses[rig.statuses.length - 1].attemptLabel, "Connecting… attempt 3 of 3");

  rig.clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  assert.equal(rig.factory.made.length, 3, "no fourth attempt");
  const last = rig.statuses[rig.statuses.length - 1];
  assert.equal(last.phase, "failed");
  assert.match(last.message, /Couldn't reach the room server/);
  assert.equal(last.showTips, true, "the connection tips appear after two failures");
  assert.equal(last.tips.length, 3);
});

test("L-U8 a wrong code is a hard stop with no retry", async () => {
  const rig = playerRig();
  rig.player.connect("ZZZZ", "Alex");
  await flush();
  rig.factory.made[0].emit("error", { type: "peer-unavailable" });
  const last = rig.statuses[rig.statuses.length - 1];
  assert.equal(last.phase, "failed");
  assert.match(last.message, /No room with that code/);
  rig.clock.advance(NET.JOIN_DEADLINE_MS * 4);
  await flush();
  assert.equal(rig.factory.made.length, 1, "a wrong code never auto-retries");
});

test("L-U8 a successful join sends the v2 join envelope with pid and avatar", async () => {
  const rig = playerRig();
  rig.player.connect("ABCD", "Alex", "p4", "🦊");
  await flush();
  const peer = rig.factory.made[0];
  peer.emit("open");
  assert.equal(peer.lastConn.peer, "gsc-ABCD");
  assert.deepEqual(peer.lastConn.metadata, { name: "Alex" });
  peer.lastConn.emit("open");
  assert.deepEqual(peer.lastConn.sent[0], { v: 2, t: "join", name: "Alex", avatar: "🦊", pid: "p4" });
  assert.equal(rig.player.isConnected(), true);
});

test("L-U8 a drop schedules the 3-second reconnect loop", async () => {
  const rig = playerRig();
  const conn = await connectPlayer(rig);
  conn.emit("close");
  assert.equal(rig.statuses[rig.statuses.length - 1].phase, "reconnecting");
  assert.equal(rig.factory.made.length, 1);
  rig.clock.advance(3000);
  await flush();
  assert.equal(rig.factory.made.length, 2, "a fresh attempt after 3 s");
  // and it keeps trying
  rig.clock.advance(NET.JOIN_DEADLINE_MS);
  await flush();
  rig.clock.advance(3000);
  await flush();
  assert.ok(rig.factory.made.length >= 3);
});

test("L-U8 a stale heartbeat tears the connection down and reconnects", async () => {
  const rig = playerRig();
  const conn = await connectPlayer(rig);
  assert.ok(conn.sent.some((m) => m.t === "join"));

  // Pings go out every 10 s.
  rig.clock.advance(NET.PLAYER_PING_MS + 1);
  assert.ok(conn.sent.some((m) => m.t === "ping"));

  // 25 s of total silence → dead, then the loop picks it back up.
  rig.clock.advance(NET.PLAYER_STALE_MS);
  assert.equal(rig.player.isConnected(), false);
  assert.ok(rig.statuses.some((s) => s.phase === "reconnecting"), "the phone reports reconnecting");
  await flush();
  rig.clock.advance(3000);
  await flush();
  assert.ok(rig.factory.made.length >= 2, "a fresh peer is built for the retry");
});

test("L-U8 host traffic keeps the connection alive", async () => {
  const rig = playerRig();
  const conn = await connectPlayer(rig);
  for (let i = 0; i < 6; i += 1) {
    rig.clock.advance(NET.PLAYER_STALE_MS - 1000);
    conn.emit("data", { v: 2, t: "pong" });
  }
  assert.equal(rig.player.isConnected(), true);
});

test("L-U8 reject surfaces the reason and stops the retry loop", async () => {
  const rig = playerRig();
  const conn = await connectPlayer(rig);
  conn.emit("data", { v: 2, t: "reject", reason: "name-taken" });
  assert.deepEqual(rig.rejects, ["name-taken"]);
  assert.equal(rig.statuses[rig.statuses.length - 1].phase, "failed");
  rig.clock.advance(60000);
  await flush();
  assert.equal(rig.factory.made.length, 1, "a rejected phone never retries");
});

test("L-U8 joined / lobby / game messages reach onMessage; room-closed stops the loop", async () => {
  const rig = playerRig();
  const conn = await connectPlayer(rig);
  conn.emit("data", { v: 2, t: "joined", pid: "p2", name: "Alex", color: "#56b4e9", avatar: "🐼" });
  assert.deepEqual(rig.player.me(), { pid: "p2", name: "Alex", avatar: "🐼", code: "ABCD" });
  conn.emit("data", { v: 2, t: "game", g: "jeopardy", m: { mode: "armed" } });
  conn.emit("data", { v: 2, t: "pong" }); // never forwarded
  conn.emit("data", "junk");
  assert.deepEqual(rig.messages.map((m) => m.t), ["joined", "game"]);

  conn.emit("data", { v: 2, t: "room-closed" });
  rig.clock.advance(60000);
  await flush();
  assert.equal(rig.factory.made.length, 1);
  assert.equal(rig.player.isConnected(), false);
});

test("L-U8 leave stops everything and reports idle", async () => {
  const rig = playerRig();
  await connectPlayer(rig);
  rig.player.leave();
  assert.equal(rig.statuses[rig.statuses.length - 1].phase, "idle");
  rig.clock.advance(60000);
  await flush();
  assert.equal(rig.factory.made.length, 1);
});

test("L-U8 the in-app-browser hint rides on every status report", async () => {
  const rig = playerRig({ userAgent: "Mozilla/5.0 (iPhone) Instagram 300.0" });
  rig.player.connect("ABCD", "Alex");
  await flush();
  assert.equal(rig.statuses[0].inAppBrowser, "Instagram");
});
