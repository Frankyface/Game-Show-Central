/* ============================================================
   L-U9 — the PeerJS shim over the bridge, driven with a fake
   postMessage bus (no DOM, no window). Host side and phone side.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

await import("../shared/virtual-peer.js");
const VP = globalThis.VirtualPeer;

const tick = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

/** A bus that records what the shim posts and lets a test push messages in. */
function fakeBus(mode) {
  const posted = [];
  let listener = null;
  return {
    mode,
    posted,
    post: (msg) => posted.push(msg),
    listen: (fn) => { listener = fn; },
    deliver: (msg) => { if (listener) listener(msg); },
  };
}

function player(pid, name, connected = true) {
  return { pid, name, color: "#e69f00", avatar: "🦊", connected, manual: false };
}

/* ============ Host side ============ */

test("L-U9 host: open fires, then one connection per existing player", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const opened = [];
  const conns = [];
  peer.on("open", (id) => opened.push(id));
  peer.on("connection", (c) => conns.push(c));

  await tick();
  assert.deepEqual(opened, ["gsc-ABCD"]);
  assert.equal(peer.open, true);
  assert.equal(peer.disconnected, false);
  assert.equal(peer.destroyed, false);
  assert.equal(conns.length, 0);

  bus.deliver({ gsc: 1, t: "init", mode: "embed-host", room: { code: "ABCD", players: [player("p1", "Alex"), player("p2", "Bo")] } });
  assert.equal(conns.length, 2);
  assert.deepEqual(conns.map((c) => c.peer), ["p1", "p2"]);
  assert.deepEqual(conns[0].metadata, { name: "Alex" });
  assert.equal(conns[0].open, true);

  const opens = [];
  conns[0].on("open", () => opens.push("p1"));
  await tick();
  assert.deepEqual(opens, ["p1"]);
});

test("L-U9 host: init before the peer exists is replayed on open", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [player("p1", "Alex")] } });
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  assert.deepEqual(conns.map((c) => c.peer), ["p1"]);
});

test("L-U9 host: a late joiner arrives as a new connection", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [player("p1", "Alex")] } });
  bus.deliver({ gsc: 1, t: "player-join", player: player("p2", "Bo") });
  assert.deepEqual(conns.map((c) => c.peer), ["p1", "p2"]);
  // a disconnected player in init is not announced
  const bus2 = fakeBus("embed-host");
  const hub2 = VP.createHub(bus2);
  const peer2 = new hub2.Peer("gsc-WXYZ");
  const c2 = [];
  peer2.on("connection", (c) => c2.push(c));
  await tick();
  bus2.deliver({ gsc: 1, t: "init", room: { code: "WXYZ", players: [player("p1", "Manual", false)] } });
  assert.equal(c2.length, 0);
});

test("L-U9 host: conn.send goes out as a bridge send with the pid; data comes back", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [player("p1", "Alex"), player("p2", "Bo")] } });

  conns[0].send({ v: 1, t: "buzzer", mode: "armed" });
  assert.deepEqual(bus.posted[bus.posted.length - 1],
                   { t: "send", pid: "p1", m: { v: 1, t: "buzzer", mode: "armed" } });

  const got = [];
  conns[1].on("data", (m) => got.push(m));
  bus.deliver({ gsc: 1, t: "msg", pid: "p2", m: { v: 1, t: "buzz" } });
  bus.deliver({ gsc: 1, t: "msg", pid: "p9", m: { v: 1, t: "buzz" } }); // unknown pid: ignored
  assert.deepEqual(got, [{ v: 1, t: "buzz" }]);
});

test("L-U9 host: conn.close posts a bridge close and emits close once", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [player("p1", "Alex")] } });

  const closes = [];
  conns[0].on("close", () => closes.push(1));
  conns[0].close();
  conns[0].close(); // idempotent
  assert.deepEqual(bus.posted.filter((m) => m.t === "close"), [{ t: "close", pid: "p1" }]);
  assert.deepEqual(closes, [1]);
  assert.equal(conns[0].open, false);
});

test("L-U9 host: player-leave closes that connection", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [player("p1", "Alex")] } });
  const closes = [];
  conns[0].on("close", () => closes.push(1));
  bus.deliver({ gsc: 1, t: "player-leave", pid: "p1" });
  assert.deepEqual(closes, [1]);
  assert.equal(hub._conns.size, 0);
});

/* ============ Phone side ============ */

test("L-U9 phone: connect opens, send goes out, data arrives", async () => {
  const bus = fakeBus("embed-player");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer();
  const opened = [];
  peer.on("open", (id) => opened.push(id));
  await tick();
  assert.equal(opened.length, 1);
  assert.ok(typeof opened[0] === "string" && opened[0].length > 0);

  const conn = peer.connect("ghj-ABCD", { serialization: "json", metadata: { name: "Alex" } });
  const opens = [];
  const got = [];
  conn.on("open", () => opens.push(1));
  conn.on("data", (m) => got.push(m));
  await tick();
  assert.deepEqual(opens, [1]);
  assert.deepEqual(conn.metadata, { name: "Alex" });

  conn.send({ v: 1, t: "buzz" });
  assert.deepEqual(bus.posted[bus.posted.length - 1], { t: "send", m: { v: 1, t: "buzz" } });

  bus.deliver({ gsc: 1, t: "msg", m: { v: 1, t: "buzzer", mode: "armed" } });
  assert.deepEqual(got, [{ v: 1, t: "buzzer", mode: "armed" }]);
});

test("L-U9 phone: conn-close closes the connection; status:false is the only error", async () => {
  const bus = fakeBus("embed-player");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer();
  const errors = [];
  peer.on("error", (e) => errors.push(e));
  await tick();
  const conn = peer.connect("ghj-ABCD");
  await tick();

  bus.deliver({ gsc: 1, t: "status", connected: true });
  assert.deepEqual(errors, [], "a healthy transport raises nothing");

  bus.deliver({ gsc: 1, t: "status", connected: false });
  assert.deepEqual(errors, [{ type: "network" }]);

  const closes = [];
  conn.on("close", () => closes.push(1));
  bus.deliver({ gsc: 1, t: "conn-close" });
  assert.deepEqual(closes, [1]);
  assert.equal(conn.open, false);
});

test("L-U9 peer lifecycle: reconnect re-emits open, destroy stops everything", async () => {
  const bus = fakeBus("embed-player");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer();
  const opens = [];
  peer.on("open", () => opens.push(1));
  await tick();
  assert.deepEqual(opens, [1]);

  peer.disconnect();
  assert.equal(peer.disconnected, true);
  peer.reconnect();
  await tick();
  assert.deepEqual(opens, [1, 1]);
  assert.equal(peer.disconnected, false);

  peer.destroy();
  assert.equal(peer.destroyed, true);
  assert.equal(peer.open, false);

  // A peer destroyed before its open tick never fires open.
  const late = new hub.Peer();
  const lateOpens = [];
  late.on("open", () => lateOpens.push(1));
  late.destroy();
  await tick();
  assert.deepEqual(lateOpens, []);
});

test("L-U9 install() is a no-op outside embedded mode", () => {
  assert.equal(VP.install({ mode: "standalone-host" }), null);
  assert.equal(VP.install({ mode: null }), null);
  const bus = fakeBus("embed-host");
  const hub = VP.install({ mode: "embed-host", bus });
  assert.ok(hub && typeof hub.Peer === "function");
  assert.equal(globalThis.peerjs.Peer, hub.Peer);
  delete globalThis.peerjs;
});
