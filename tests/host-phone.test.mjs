/* ============================================================
   docs/22 §4.1 / §4.5 — the host phone in the pure lobby reducer,
   the hub's key/view helpers, the standalone SDK no-ops, and the
   proof that shared/virtual-peer.js never announces a host phone.
   node:test + node:assert only.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";
import HP from "../js/hub-hostphone.js";

/* ---- helpers ------------------------------------------------ */

const KEY = "k".repeat(24);
const KEY2 = "Z9_-".repeat(6);

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

const join = (peerId, name, extra) => ({ type: "join", peerId, name, avatar: "🦊", ...extra });
const frames = (effects) => effects.filter((e) => e.frame).map((e) => e.frame);
const sends = (effects) => effects.filter((e) => e.send).map((e) => e.send);

/** Alex (p1, peerA) and Bo (p2, peerB) joined; nothing else. */
function twoPhones() {
  let s = RP.createLobbyState();
  s = RP.lobbyReduce(s, join("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, join("peerB", "Bo")).state;
  return s;
}

/** twoPhones with Bo made the host phone using KEY. */
function withHost() {
  return RP.lobbyReduce(twoPhones(), { type: "setRole", pid: "p2", role: "host", key: KEY }).state;
}

/* ============ setRole: grant / revoke / refusals ============ */

test("HP-U1 grant stores the key, tells only that phone, broadcasts the lobby", () => {
  const out = RP.lobbyReduce(deepFreeze(twoPhones()), { type: "setRole", pid: "p2", role: "host", key: KEY });
  assert.equal(out.state.players.p2.role, "host");
  assert.equal(out.state.players.p2.hostKey, KEY);
  assert.deepEqual(sends(out.effects), [{ to: "peerB", msg: { v: 2, t: "role", role: "host", hk: KEY } }]);
  assert.ok(out.effects.some((e) => e.broadcastLobby));
  assert.deepEqual(frames(out.effects), [], "no game is running, so nothing goes to a frame");
});

test("HP-U1 revoke clears the key and tells the phone it is a player again", () => {
  const out = RP.lobbyReduce(deepFreeze(withHost()), { type: "setRole", pid: "p2", role: "player" });
  assert.equal(out.state.players.p2.role, "player");
  assert.equal(out.state.players.p2.hostKey, null);
  assert.deepEqual(sends(out.effects), [{ to: "peerB", msg: { v: 2, t: "role", role: "player" } }]);
  assert.ok(out.effects.some((e) => e.broadcastLobby));
});

test("HP-U2 setRole is refused in-game, for manual or unknown pids, without a key, and for a third host", () => {
  const s = twoPhones();
  const same = (state, ev, why) => {
    const out = RP.lobbyReduce(state, ev);
    assert.equal(out.state, state, why);
    assert.deepEqual(out.effects, [], why);
  };
  const inGame = RP.lobbyReduce(s, { type: "setGame", gameId: "jeopardy" }).state;
  same(inGame, { type: "setRole", pid: "p2", role: "host", key: KEY }, "refused while a game runs");
  same(RP.lobbyReduce(withHost(), { type: "setGame", gameId: "jeopardy" }).state,
    { type: "setRole", pid: "p2", role: "player" }, "revoking is refused in-game too");
  const manual = RP.lobbyReduce(s, { type: "addManual", name: "Cy" }).state;
  same(manual, { type: "setRole", pid: "p3", role: "host", key: KEY }, "a manual entry cannot hold the role");
  same(s, { type: "setRole", pid: "p9", role: "host", key: KEY }, "unknown pid");
  same(s, { type: "setRole", pid: "__proto__", role: "host", key: KEY }, "prototype-shaped pid");
  same(s, { type: "setRole", pid: "constructor", role: "host", key: KEY }, "prototype-shaped pid");
  same(s, { type: "setRole", pid: "p2", role: "host" }, "a grant needs a key");
  same(s, { type: "setRole", pid: "p2", role: "host", key: "short" }, "a malformed key");
  same(s, { type: "setRole", pid: "p2", role: "boss", key: KEY }, "junk role");
  same(s, { type: "setRole", pid: "p2", role: "player" }, "already a player");
  const away = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  same(away, { type: "setRole", pid: "p2", role: "host", key: KEY }, "a disconnected phone cannot be granted the role");
  const stale = RP.lobbyReduce(s, { type: "status", peerId: "peerB", connected: false }).state;
  same(stale, { type: "setRole", pid: "p2", role: "host", key: KEY }, "nor a stale one");

  let three = RP.lobbyReduce(s, join("peerC", "Cy")).state;
  three = RP.lobbyReduce(three, { type: "setRole", pid: "p1", role: "host", key: KEY }).state;
  three = RP.lobbyReduce(three, { type: "setRole", pid: "p2", role: "host", key: KEY2 }).state;
  assert.equal(RP.hostPhoneList(three).length, 2);
  same(three, { type: "setRole", pid: "p3", role: "host", key: KEY }, "at most two host phones");
});

test("HP-U2 junk events never throw", () => {
  const s = deepFreeze(withHost());
  for (const ev of [{ type: "setRole" }, { type: "setRole", pid: null }, { type: "setRole", pid: 5, role: {} },
    { type: "setRole", pid: "p1", role: "host", key: 12 }]) {
    assert.doesNotThrow(() => RP.lobbyReduce(s, ev));
  }
});

/* ============ device-bound relink ============ */

test("HP-U3 the host phone rejoining with its key keeps the role (and emits host-phones)", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  const out = RP.lobbyReduce(s, join("peerB2", "Bo", { pid: "p2", hk: KEY }));
  assert.equal(out.state.players.p2.role, "host");
  assert.equal(out.state.players.p2.hostKey, KEY);
  assert.deepEqual(frames(out.effects), [{ t: "host-phones" }]);
  assert.ok(!out.effects.some((e) => e.notice));
});

test("HP-U3 relink by pid WITHOUT the key demotes, clears the key, and tells the laptop", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  const out = RP.lobbyReduce(s, join("intruder", "Bo", { pid: "p2" }));
  assert.equal(out.state.players.p2.role, "player");
  assert.equal(out.state.players.p2.hostKey, null);
  assert.ok(out.effects.some((e) => e.notice === "host-demoted" && e.pid === "p2"));
  const f = frames(out.effects);
  assert.ok(f.some((x) => x.t === "host-phones"), "the game learns the host phone is gone");
  assert.ok(f.some((x) => x.t === "player-join" && x.player.pid === "p2"), "and gets a new contestant");
  assert.ok(!("role" in f.find((x) => x.t === "player-join").player), "players given to games carry no role");
});

test("HP-U3 relink with a WRONG key demotes too", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  const out = RP.lobbyReduce(s, join("intruder", "Bo", { pid: "p2", hk: KEY2 }));
  assert.equal(out.state.players.p2.role, "player");
});

test("HP-U3 relink by NAME without the key demotes", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  const out = RP.lobbyReduce(s, join("intruder", "bo"));
  assert.equal(out.state.peers.intruder, "p2", "the name relinked onto the host entry");
  assert.equal(out.state.players.p2.role, "player");
  assert.equal(out.state.players.p2.hostKey, null);
  assert.ok(out.effects.some((e) => e.notice === "host-demoted"));
});

test("HP-U3 stale-then-takeover: a stale host phone taken over by another device is demoted", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "status", peerId: "peerB", connected: false }).state; // 30 s silence
  const out = RP.lobbyReduce(s, join("intruder", "Bo"));
  assert.equal(out.state.peers.intruder, "p2");
  assert.equal(out.state.peers.peerB, undefined, "the old device is unbound");
  assert.equal(out.state.players.p2.role, "player");
  assert.ok(out.effects.some((e) => e.notice === "host-demoted"));
});

test("HP-U3 a locked lobby still relinks the host phone with its key", () => {
  let s = withHost();
  s = RP.lobbyReduce(s, { type: "lock", locked: true }).state;
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" }).state;
  const out = RP.lobbyReduce(s, join("peerB2", "Bo", { pid: "p2", hk: KEY }));
  assert.equal(out.state.players.p2.role, "host");
  assert.equal(out.state.players.p2.connected, true);
});

/* ============ what leaves the reducer ============ */

test("HP-U4 the host key never appears in a lobby snapshot; role does, for host rows only", () => {
  const s = withHost();
  const snap = RP.lobbySnapshot(s);
  assert.ok(!JSON.stringify(snap).includes(KEY), "the key is not on the wire");
  assert.equal(snap.players.find((p) => p.pid === "p2").role, "host");
  assert.equal("role" in snap.players.find((p) => p.pid === "p1"), false, "players carry no role field");
  const v = RP.validateEnvelope(snap);
  assert.equal(v.players[1].role, "host");
  assert.ok(!JSON.stringify(v).includes(KEY));
});

test("HP-U4 with no host phone, snapshot / playerList / serialize are exactly what they were", () => {
  const s = twoPhones();
  assert.deepEqual(RP.lobbySnapshot(s).players[0],
    { pid: "p1", name: "Alex", color: s.players.p1.color, avatar: "🦊", connected: true, manual: false });
  assert.deepEqual(RP.playerList(s)[0],
    { pid: "p1", name: "Alex", color: s.players.p1.color, avatar: "🦊", connected: true, manual: false });
  assert.deepEqual(RP.serializeLobby(s).players[0],
    { pid: "p1", name: "Alex", color: s.players.p1.color, avatar: "🦊", connected: false, manual: false });
});

test("HP-U5 playerList excludes host phones and carries no role; hostPhoneList lists them", () => {
  const s = withHost();
  assert.deepEqual(RP.playerList(s).map((p) => p.pid), ["p1"]);
  for (const p of RP.playerList(s)) assert.equal("role" in p, false);
  assert.deepEqual(RP.hostPhoneList(s), [{ pid: "p2", name: "Bo", connected: true }]);
  assert.equal("role" in RP.playerCopy(s.players.p2), false, "playerCopy never leaks a role");
});

test("HP-U6 host-pid roster events emit host-phones and never player-*", () => {
  const s = withHost();
  const check = (out, label) => {
    const f = frames(out.effects);
    assert.ok(f.length > 0, label);
    for (const x of f) assert.equal(x.t, "host-phones", `${label}: ${JSON.stringify(x)}`);
  };
  check(RP.lobbyReduce(s, { type: "status", peerId: "peerB", connected: false }), "status");
  const left = RP.lobbyReduce(s, { type: "leave", peerId: "peerB" });
  check(left, "leave");
  check(RP.lobbyReduce(left.state, join("peerB2", "Bo", { pid: "p2", hk: KEY })), "rejoin with key");
  const kicked = RP.lobbyReduce(s, { type: "kick", pid: "p2" });
  check(kicked, "kick");
  assert.equal(kicked.state.players.p2, undefined, "kicking a host phone is allowed");
  // In-game, too: kick stays available.
  const inGame = RP.lobbyReduce(s, { type: "setGame", gameId: "jeopardy" }).state;
  check(RP.lobbyReduce(inGame, { type: "kick", pid: "p2" }), "kick in-game");
  // ...while a contestant still produces player-* frames.
  assert.deepEqual(frames(RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).effects),
    [{ t: "player-status", pid: "p1", connected: false }]);
});

/* ============ envelopes ============ */

test("HP-U7 join accepts hk; junk hk is dropped, not fatal; role and h:1 validate", () => {
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "join", name: "Bo", pid: "p2", hk: KEY }),
    { v: 2, t: "join", name: "Bo", pid: "p2", hk: KEY });
  for (const hk of ["", "short", "x".repeat(65), "has space here!", 42, {}, null]) {
    assert.deepEqual(RP.validateEnvelope({ v: 2, t: "join", name: "Bo", hk }), { v: 2, t: "join", name: "Bo" });
  }
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "role", role: "host", hk: KEY }), { v: 2, t: "role", role: "host", hk: KEY });
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "role", role: "player", hk: KEY }), { v: 2, t: "role", role: "player" });
  assert.equal(RP.validateEnvelope({ v: 2, t: "role", role: "host" }), null, "a grant without a key is junk");
  assert.equal(RP.validateEnvelope({ v: 2, t: "role", role: "admin" }), null);
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "game", g: "x", m: 1, h: 1 }), { v: 2, t: "game", g: "x", m: 1, h: 1 });
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "game", g: "x", m: 1, h: "1" }), { v: 2, t: "game", g: "x", m: 1 });
});

test("HP-U7 junk roles in a lobby row are players; a manual row cannot be a host", () => {
  const row = (role, manual) => RP.validateEnvelope({
    v: 2, t: "lobby", game: null,
    players: [{ pid: "p1", name: "Al", color: "#000", avatar: "🦊", connected: true, manual, role }],
  }).players[0];
  for (const junk of ["admin", "HOST", 1, null, {}, undefined]) assert.equal("role" in row(junk, false), false);
  assert.equal(row("host", false).role, "host");
  assert.equal("role" in row("host", true), false);
});

/* ============ persistence ============ */

test("HP-U8 serialize/restore keeps the role and the key (the hub save)", () => {
  const saved = JSON.parse(JSON.stringify(RP.serializeLobby(withHost())));
  const r = RP.restoreLobby(saved);
  assert.equal(r.players.p2.role, "host");
  assert.equal(r.players.p2.hostKey, KEY);
  assert.equal(r.players.p2.connected, false);
  assert.equal(r.players.p1.role, "player");
  // The phone comes back with its key after a hub reload: still the host phone.
  const back = RP.lobbyReduce(r, join("peerB9", "Bo", { pid: "p2", hk: KEY }));
  assert.equal(back.state.players.p2.role, "host");
});

test("HP-U8 restore refuses junk roles, keyless hosts, manual hosts and a third host", () => {
  const p = (pid, extra) => ({ pid, name: "N" + pid, color: "#000", avatar: "🦊", connected: false, manual: false, ...extra });
  const r = RP.restoreLobby({
    players: [
      p("p1", { role: "host", hostKey: KEY }),
      p("p2", { role: "host" }),                       // no key
      p("p3", { role: "host", hostKey: KEY, manual: true }),
      p("p4", { role: "admin", hostKey: KEY }),
      p("p5", { role: "host", hostKey: KEY2 }),
      p("p6", { role: "host", hostKey: KEY }),         // would be the third
    ],
    nextId: 7,
  });
  assert.deepEqual(RP.hostPhoneList(r).map((x) => x.pid), ["p1", "p5"]);
  for (const pid of ["p2", "p3", "p4", "p6"]) {
    assert.equal(r.players[pid].role, "player", pid);
    assert.equal(r.players[pid].hostKey, null, pid);
  }
  const proto = RP.restoreLobby({ players: [p("__proto__", { role: "host", hostKey: KEY })] });
  assert.deepEqual(proto.order, [], "prototype-shaped pids never restore");
});

/* ============ the hub's helpers ============ */

test("HP-U9 newKey is a valid host key and differs each call; the view holder de-duplicates", () => {
  const a = HP.newKey();
  const b = HP.newKey();
  assert.ok(RP.isHostKey(a), a);
  assert.notEqual(a, b);
  assert.equal(a.length, 24);
  const h = HP.createViewHolder();
  assert.equal(h.get(), null);
  assert.equal(h.set({ t: "host", item: "Q1", a: "Paris" }), true);
  assert.equal(h.set({ t: "host", item: "Q1", a: "Paris" }), false, "same view: not re-sent");
  assert.equal(h.set({ t: "host", item: "Q2", a: "Rome" }), true);
  assert.deepEqual(h.get(), { t: "host", item: "Q2", a: "Rome" });
  h.clear();
  assert.equal(h.get(), null);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(h.set(cyclic), false, "an unserialisable view is ignored, not thrown");
});

/* ============ virtual-peer never announces a host phone ============ */

test("HP-U10 virtual-peer (Jeopardy's PeerJS shim) holds no connection for a host pid", async () => {
  await import("../shared/virtual-peer.js");
  const VP = globalThis.VirtualPeer;
  const posted = [];
  let listener = null;
  const bus = { mode: "embed-host", post: (m) => posted.push(m), listen: (fn) => { listener = fn; } };
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c.peer));
  for (let i = 0; i < 4; i += 1) await Promise.resolve();

  // Exactly what hub-host.js sends a frame: init from playerList/hostPhoneList,
  // then every frame effect the reducer emits for the host pid's life.
  let s = withHost();
  const hostPhones = RP.hostPhoneList(s);
  listener({ gsc: 1, t: "init", room: { code: "ABCD", players: RP.playerList(s), hostPhones, answersPrivate: true } });
  const forward = (effects) => {
    for (const f of frames(effects)) {
      if (f.t === "host-phones") listener({ gsc: 1, t: "host-phones", list: RP.hostPhoneList(s) });
      else listener({ gsc: 1, ...f });
    }
  };
  for (const ev of [
    { type: "status", peerId: "peerB", connected: false },
    { type: "status", peerId: "peerB", connected: true },
    { type: "leave", peerId: "peerB" },
    join("peerB2", "Bo", { pid: "p2", hk: KEY }),
    { type: "kick", pid: "p2" },
  ]) {
    const out = RP.lobbyReduce(s, ev);
    s = out.state;
    forward(out.effects);
  }
  listener({ gsc: 1, t: "host-view", m: { t: "host", item: "Q1", a: "secret" } });
  assert.deepEqual(conns, ["p1"], "only the contestant ever became a connection");
  assert.ok(!JSON.stringify(posted).includes("p2"), "nothing was ever sent for the host pid");
});

/* ============ standalone SDK: the additions exist and do nothing ============ */

test("HP-U11 standalone room objects carry hostPhones / answersPrivate / setHostView as no-ops", async () => {
  globalThis.location = { origin: "https://x.test", search: "", pathname: "/", href: "https://x.test/" };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.window.parent = globalThis.window;
  globalThis.RoomProtocol = RP;
  await import("../shared/bridge.js");
  const room = await globalThis.GSC.host({});
  assert.equal(globalThis.GSC.mode, "standalone-host");
  assert.deepEqual(room.hostPhones(), []);
  assert.equal(room.answersPrivate(), false);
  assert.doesNotThrow(() => room.setHostView({ t: "host", item: "x" }));
});
