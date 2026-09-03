/* ============================================================
   Virtual peer — rejoin + early-message behaviour (Jeopardy embed
   verification defects D1/D2). Fake postMessage bus, no DOM.
   D1: a phone that drops has its host-side connection closed, so the
       game frees the player; when it is back a fresh connection is
       announced and its re-sent `join` lands on that new connection.
   D2: phone messages that arrive before the game opened its room (no
       Peer yet) or before the pid was announced are queued per pid and
       replayed right after that connection opens.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";

await import("../shared/virtual-peer.js");
const VP = globalThis.VirtualPeer;

const tick = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

function fakeBus(mode) {
  const posted = [];
  let listener = null;
  return {
    mode, posted,
    post: (msg) => posted.push(msg),
    listen: (fn) => { listener = fn; },
    deliver: (msg) => { if (listener) listener(msg); },
  };
}

function player(pid, name, connected = true) {
  return { pid, name, color: "#e69f00", avatar: "🦊", connected, manual: false };
}

function hostWithRoom(players) {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  bus.deliver({ gsc: 1, t: "init", mode: "embed-host", room: { code: "ABCD", players } });
  return { bus, hub, peer, conns };
}

test("D1 host: player-status false closes that pid's connection; status true announces a fresh one", async () => {
  const { bus, conns } = hostWithRoom([player("p1", "Alex"), player("p2", "Bo")]);
  await tick();
  assert.equal(conns.length, 2);
  const closes = [];
  conns[1].on("close", () => closes.push("p2"));

  bus.deliver({ gsc: 1, t: "player-status", pid: "p2", connected: false });
  assert.deepEqual(closes, ["p2"]);
  assert.equal(conns[1].open, false);
  assert.equal(conns.length, 2, "no new connection while the phone is away");

  bus.deliver({ gsc: 1, t: "player-status", pid: "p2", connected: true });
  assert.equal(conns.length, 3, "the returning phone gets a fresh connection");
  assert.equal(conns[2].peer, "p2");
  assert.equal(conns[2].open, true);

  // The phone's re-sent join lands on the NEW connection, not the closed one.
  const data = [];
  conns[2].on("data", (m) => data.push(m));
  const stale = [];
  conns[1].on("data", (m) => stale.push(m));
  await tick();
  bus.deliver({ gsc: 1, t: "msg", pid: "p2", m: { v: 1, t: "join", name: "Bo" } });
  assert.deepEqual(data, [{ v: 1, t: "join", name: "Bo" }]);
  assert.deepEqual(stale, []);

  // A repeated status:false is harmless; a status for an unknown pid is ignored.
  bus.deliver({ gsc: 1, t: "player-status", pid: "p2", connected: false });
  bus.deliver({ gsc: 1, t: "player-status", pid: "p2", connected: false });
  bus.deliver({ gsc: 1, t: "player-status", pid: "__proto__", connected: true });
  assert.equal(conns.length, 3);
});

test("D3 host: a player offline at init is announced when the shell reports them back (hub refresh mid-game)", async () => {
  // After a hub refresh the host frame's init lists phones that have not yet
  // reconnected as connected:false; manual players never get a connection.
  const { bus, conns } = hostWithRoom([
    player("p1", "Rita", false),
    { pid: "p2", name: "Mo", color: "#000", avatar: "🦊", connected: false, manual: true },
  ]);
  await tick();
  assert.equal(conns.length, 0, "nobody is announced while offline");

  bus.deliver({ gsc: 1, t: "player-status", pid: "p1", connected: true });
  assert.deepEqual(conns.map((c) => c.peer), ["p1"]);
  assert.deepEqual(conns[0].metadata, { name: "Rita" }, "the name from init is kept");

  bus.deliver({ gsc: 1, t: "player-status", pid: "p2", connected: true });
  assert.equal(conns.length, 1, "a manual player is never announced");

  // A message from a phone the shell has not (yet) reported back is queued and
  // delivered once its status flips, not dropped.
  bus.deliver({ gsc: 1, t: "player-status", pid: "p1", connected: false });
  bus.deliver({ gsc: 1, t: "msg", pid: "p1", m: { v: 1, t: "join", name: "Rita" } });
  assert.equal(conns.length, 1);
  bus.deliver({ gsc: 1, t: "player-status", pid: "p1", connected: true });
  assert.equal(conns.length, 2);
  const data = [];
  conns[1].on("data", (m) => data.push(m.t));
  await tick();
  assert.deepEqual(data, ["join"]);
});

test("D1 host: a connection the game closed is forgotten, so the next message from that pid announces a new one", async () => {
  const { bus, conns } = hostWithRoom([player("p1", "Alex")]);
  await tick();
  conns[0].close(); // e.g. Jeopardy rejected / kicked the phone
  assert.deepEqual(bus.posted.filter((p) => p.t === "close"), [{ t: "close", pid: "p1" }]);

  bus.deliver({ gsc: 1, t: "msg", pid: "p1", m: { v: 1, t: "join", name: "Alex" } });
  assert.equal(conns.length, 2, "a fresh connection was announced for the returning phone");
  const data = [];
  conns[1].on("data", (m) => data.push(m));
  await tick();
  assert.deepEqual(data, [{ v: 1, t: "join", name: "Alex" }], "the message that triggered it is replayed after open");
});

test("D2 host: messages that beat the game's Peer are queued per pid and replayed after open, in order", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  // init + phone traffic arrive while the game has not yet opened its room.
  bus.deliver({ gsc: 1, t: "init", mode: "embed-host", room: { code: "ABCD", players: [player("p1", "Alex"), player("p2", "Bo")] } });
  bus.deliver({ gsc: 1, t: "msg", pid: "p1", m: { v: 1, t: "join", name: "Alex" } });
  bus.deliver({ gsc: 1, t: "msg", pid: "p1", m: { v: 1, t: "ping" } });
  bus.deliver({ gsc: 1, t: "msg", pid: "p2", m: { v: 1, t: "join", name: "Bo" } });
  bus.deliver({ gsc: 1, t: "msg", pid: "px", m: { v: 1, t: "join", name: "Junk" } }); // not a pid → ignored

  const peer = new hub.Peer("gsc-ABCD");
  const got = {};
  peer.on("connection", (c) => { got[c.peer] = []; c.on("data", (m) => got[c.peer].push(m.t)); });
  await tick();
  assert.deepEqual(got, { p1: ["join", "ping"], p2: ["join"] });

  // Nothing is replayed twice.
  await tick();
  assert.deepEqual(got.p1, ["join", "ping"]);
});

test("D2 host: the per-pid queue is capped and dropped when the player leaves", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  bus.deliver({ gsc: 1, t: "init", mode: "embed-host", room: { code: "ABCD", players: [player("p1", "Alex"), player("p2", "Bo")] } });
  for (let i = 0; i < 30; i += 1) bus.deliver({ gsc: 1, t: "msg", pid: "p1", m: { v: 1, t: "n" + i } });
  bus.deliver({ gsc: 1, t: "msg", pid: "p2", m: { v: 1, t: "join", name: "Bo" } });
  bus.deliver({ gsc: 1, t: "player-leave", pid: "p2" });

  const peer = new hub.Peer("gsc-ABCD");
  const got = {};
  peer.on("connection", (c) => { got[c.peer] = []; c.on("data", (m) => got[c.peer].push(m.t)); });
  await tick();
  assert.equal(Object.keys(got).length, 1, "the player that left is never announced");
  assert.equal(got.p1.length, 20, "queue keeps only the newest 20");
  assert.equal(got.p1[0], "n10");
  assert.equal(got.p1[19], "n29");
});
