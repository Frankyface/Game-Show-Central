/* ============================================================
   Shell — ADVERSARIAL unit tests (written by the independent tester,
   not the implementer). These go after the seams that the L-U suite
   does not press: junk/hostile envelopes, exact size boundaries,
   unicode and control characters in names, the 17th player, rejoin
   races, kick-then-rejoin, deep-frozen reducer inputs, VirtualPeer
   lifecycle edges and the standalone SDK before a room exists.

   Tests marked `{ todo: ... }` are KNOWN DEFECTS recorded in
   docs/reports/shell-verification.md — they run, they currently fail,
   and node:test reports them as todo rather than failing the suite so
   the gate stays honest about what is broken without going red on the
   orchestrator. Remove the `todo` flag when the defect is fixed.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";

/* ---- helpers ------------------------------------------------ */

const joinEv = (peerId, name, extra = {}) => ({ type: "join", peerId, name, ...extra });
const sent = (effects) => effects.filter((e) => e.send).map((e) => e.send);
const names = (s) => s.order.map((pid) => s.players[pid].name);
// Control characters are built from escapes so this file stays printable ASCII.
const CTRL = (n) => String.fromCharCode(n);

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

function lobbyPlayer(i) {
  return { pid: `p${i}`, name: `P${i}`, color: "#e69f00", avatar: "🦊", connected: true, manual: false };
}

/* ============================================================
   A — hostile envelopes and exact caps
   ============================================================ */

test("ADV-A1 hostile envelope shapes never throw and never pass through", () => {
  const hostile = [
    Object.create(null),
    Object.assign(Object.create(null), { v: 2, t: "ping" }),
    { v: 2, t: "join", name: "Al", __proto__: { polluted: true } },
    JSON.parse('{"v":2,"t":"join","name":"Al","__proto__":{"polluted":true}}'),
    { v: 2, t: "join", name: "Al", constructor: { prototype: {} } },
    new Map(),
    new Set(),
    () => {},
    Symbol.iterator,
    NaN,
    true,
    { v: 2, t: "join", get name() { throw new Error("boom"); } },
    { v: 2, get t() { throw new Error("boom"); } },
  ];
  for (const obj of hostile) {
    let out;
    try {
      out = RP.validateEnvelope(obj);
    } catch (err) {
      // A throwing getter is the only case we allow to surface; the transport
      // layer never hands one over (JSON off the wire has no getters).
      assert.ok(/boom/.test(err.message), `unexpected throw: ${err.message}`);
      continue;
    }
    if (out) {
      // Only two of the fixtures are legal envelopes (a null-prototype object is
      // still a valid decoded message); everything they carry must be stripped
      // back to the documented fields.
      assert.ok(out.t === "join" || out.t === "ping", `unexpected pass-through: ${JSON.stringify(out)}`);
      const keys = Object.keys(out).sort();
      assert.deepEqual(keys, out.t === "ping" ? ["t", "v"] : ["name", "t", "v"]);
    }
  }
  assert.equal({}.polluted, undefined, "Object.prototype was polluted");
  assert.equal(RP.createLobbyState().polluted, undefined);
});

test("ADV-A2 the 32 KB payload cap is exact at the byte, not the character", () => {
  // JSON.stringify of a plain string adds two quotes, so N-2 x's == N bytes.
  const at = "x".repeat(RP.PAYLOAD_MAX_BYTES - 2);
  const over = "x".repeat(RP.PAYLOAD_MAX_BYTES - 1);
  assert.equal(RP.utf8Bytes(JSON.stringify(at)), RP.PAYLOAD_MAX_BYTES);
  assert.equal(RP.payloadTooBig(at), false, "exactly 32768 bytes is allowed");
  assert.equal(RP.payloadTooBig(over), true, "32769 bytes is refused");

  // 33 KB in every shape the spec cares about.
  const kb33 = "y".repeat(33 * 1024);
  assert.equal(RP.payloadTooBig(kb33), true);
  assert.equal(RP.validateEnvelope({ v: 2, t: "game", g: "jeopardy", m: kb33 }), null);
  assert.equal(RP.validateEnvelope({ v: 2, t: "game", g: "jeopardy", m: { a: kb33 } }), null);
  assert.equal(RP.validateEnvelope({ v: 2, t: "game", g: "jeopardy", m: [kb33] }), null);
  // Multi-byte: 9000 four-byte emoji is 36 KB even though .length is 18000.
  assert.equal(RP.validateEnvelope({ v: 2, t: "game", g: "j", m: "🦊".repeat(9000) }), null);
});

test("ADV-A3 an unserialisable or absurdly deep payload is refused, not thrown on", () => {
  let deep = [];
  let cur = deep;
  for (let i = 0; i < 40000; i += 1) { const next = []; cur.push(next); cur = next; }
  assert.equal(RP.payloadTooBig(deep), true, "a stack-blowing payload must be refused");
  assert.equal(RP.validateEnvelope({ v: 2, t: "game", g: "j", m: deep }), null);

  const throwing = { toJSON() { throw new Error("nope"); } };
  assert.equal(RP.payloadTooBig(throwing), true);
  assert.equal(RP.payloadTooBig(BigInt(1)), true, "BigInt cannot be serialised");
  // undefined is normalised to null (a legal payload), not refused.
  assert.equal(RP.payloadTooBig(undefined), false);
});

test("ADV-A4 a 17-player lobby snapshot is refused even when every player is valid", () => {
  const sixteen = Array.from({ length: 16 }, (_, i) => lobbyPlayer(i + 1));
  const seventeen = Array.from({ length: 17 }, (_, i) => lobbyPlayer(i + 1));
  assert.ok(RP.validateEnvelope({ v: 2, t: "lobby", game: null, players: sixteen }));
  assert.equal(RP.validateEnvelope({ v: 2, t: "lobby", game: null, players: seventeen }), null);
  // One bad member poisons the whole snapshot rather than being silently dropped.
  const withBad = sixteen.slice(0, 15).concat([{ ...lobbyPlayer(16), avatar: "💣" }]);
  assert.equal(RP.validateEnvelope({ v: 2, t: "lobby", game: null, players: withBad }), null);
});

test("ADV-A5 pid, game id and colour fields have hard structural limits", () => {
  assert.equal(RP.isPid("p1234567"), false, "7 digits is over the pid cap");
  assert.equal(RP.isPid("p"), false);
  assert.equal(RP.isPid("P1"), false);
  assert.equal(RP.isPid("p01"), true);
  assert.equal(RP.isPid("__proto__"), false);
  assert.equal(RP.validateEnvelope({ v: 2, t: "join", name: "Al", pid: "__proto__" }), null);
  assert.equal(RP.validateEnvelope({ v: 2, t: "conn-close", g: "x".repeat(41) }), null);
  assert.ok(RP.validateEnvelope({ v: 2, t: "conn-close", g: "jeopardy" }));
  assert.equal(
    RP.validateEnvelope({ v: 2, t: "joined", pid: "p1", name: "Al", color: "x".repeat(25), avatar: "🦊" }),
    null,
  );
});

/* ============================================================
   B — unicode and control characters in names
   ============================================================ */

test("ADV-B1 names survive unicode and shed every control character", () => {
  // C1 controls (U+0080–U+009F) as well as C0.
  assert.equal(RP.sanitizeName("Alex"), "Alex");
  // A name made only of controls is nothing.
  assert.equal(RP.sanitizeName(CTRL(0) + CTRL(7) + CTRL(127) + CTRL(0x9c)), null);
  // Newlines and tabs cannot survive into a roster row.
  assert.equal(RP.sanitizeName("Alex\nBo\tCy"), "AlexBoCy");
  // Non-control unicode is kept verbatim.
  assert.equal(RP.sanitizeName("Ünïcödé"), "Ünïcödé");
  assert.equal(RP.sanitizeName("日本語の名前"), "日本語の名前");
  assert.equal(RP.sanitizeName("  🦊 Fox  "), "🦊 Fox");
  // Combining marks are not controls and must not be stripped.
  assert.equal(RP.sanitizeName("é"), "é");
  // The structural cap on the wire is enforced before sanitising.
  assert.equal(RP.validateEnvelope({ v: 2, t: "join", name: "x".repeat(240) }).name.length, 240);
  assert.equal(RP.validateEnvelope({ v: 2, t: "join", name: "x".repeat(241) }), null);
});

test("ADV-B2 a name is never longer than NAME_MAX code units after sanitising", () => {
  for (const raw of ["x".repeat(200), "🦊".repeat(40), "日".repeat(40), "á".repeat(40)]) {
    const out = RP.sanitizeName(raw);
    assert.ok(out.length <= RP.NAME_MAX, `${JSON.stringify(out)} is ${out.length} units`);
  }
});

test("ADV-B3 truncation must not leave a broken surrogate pair", () => {
  // "a"*23 + a 4-byte emoji: the 24-unit cut lands inside the surrogate pair and
  // leaves a lone high surrogate, which renders as U+FFFD and is not valid UTF-8.
  const out = RP.sanitizeName("a".repeat(23) + "🦊");
  const last = out.charCodeAt(out.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), `lone high surrogate at the end of ${JSON.stringify(out)}`);
});

/* ============================================================
   C — lobby reducer under pressure
   ============================================================ */

test("ADV-C1 the 17th player is refused at the hard cap, not just the default", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), { type: "setMax", n: 99 }).state;
  assert.equal(s.maxPlayers, RP.MAX_PLAYERS_CAP, "setMax clamps to 16");
  for (let i = 1; i <= 16; i += 1) {
    const out = RP.lobbyReduce(s, joinEv("peer" + i, "P" + i));
    s = out.state;
    assert.equal(sent(out.effects)[0].msg.t, "joined", `player ${i} should be in`);
  }
  assert.equal(s.order.length, 16);
  const seventeenth = RP.lobbyReduce(s, joinEv("peer17", "P17"));
  assert.equal(sent(seventeenth.effects)[0].msg.reason, "room-full");
  assert.deepEqual(seventeenth.state, s, "a refused join changes nothing");
  // The snapshot of a full lobby still validates on the wire.
  assert.ok(RP.validateEnvelope(RP.lobbySnapshot(s)), "a 16-player snapshot is a legal envelope");
  // Manual players count against the cap too.
  assert.deepEqual(RP.lobbyReduce(s, { type: "addManual", name: "Extra" }).effects, []);
});

test("ADV-C2 two phones racing for the same disconnected pid leave exactly one binding", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).state;

  // Racer 1 wins the empty seat; racer 2 arrives a tick later with the same
  // remembered pid AND the same name and must be turned away, not merged in.
  const first = RP.lobbyReduce(s, joinEv("racer1", "Alex", { pid: "p1" }));
  const second = RP.lobbyReduce(first.state, joinEv("racer2", "Alex", { pid: "p1" }));
  assert.equal(sent(second.effects)[0].msg.reason, "name-taken", "the loser of the race is rejected");
  assert.ok(second.effects.some((e) => e.close === "racer2"), "and its connection is closed");
  const peers = second.state.peers;
  const bound = Object.keys(peers).filter((id) => peers[id] === "p1");
  assert.deepEqual(bound, ["racer1"], "the seated phone keeps the pid, alone");
  assert.equal(second.state.order.length, 1, "a race never forks the roster");
  assert.equal(second.state.players.p1.connected, true);

  // A racer with a DIFFERENT name and the same (now live) pid becomes its own
  // player rather than hijacking the seat.
  const stranger = RP.lobbyReduce(first.state, joinEv("racer3", "Mallory", { pid: "p1" }));
  assert.equal(stranger.state.players.p1.name, "Alex", "a live seat is never overwritten");
  assert.equal(stranger.state.order.length, 2);
  // Re-sending join on the SAME connection is idempotent, not a second player.
  const again = RP.lobbyReduce(second.state, joinEv("racer1", "Alex", { pid: "p1" }));
  assert.equal(again.state.order.length, 1);
  assert.deepEqual(Object.keys(again.state.peers), ["racer1"]);
  assert.equal(sent(again.effects)[0].msg.t, "joined");
});

test("ADV-C3 kick-then-rejoin comes back as a brand-new player, not the old one", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;
  const kicked = RP.lobbyReduce(s, { type: "kick", pid: "p1" });
  s = kicked.state;
  assert.equal(s.players.p1, undefined);
  assert.equal(s.peers.peerA, undefined, "a kicked peer is off the peer map immediately");

  // The kicked phone reconnects and replays its stored pid.
  const back = RP.lobbyReduce(s, joinEv("peerA2", "Alex", { pid: "p1" }));
  assert.equal(back.state.order.length, 2);
  assert.ok(back.state.players.p3, "the returning phone gets a fresh pid");
  assert.equal(back.state.players.p1, undefined, "the kicked pid is not resurrected");
  assert.equal(sent(back.effects)[0].msg.pid, "p3");

  // Kicking, then locking, then rejoining is refused — a kick really removes you.
  let locked = RP.lobbyReduce(RP.createLobbyState(), joinEv("x1", "Zed")).state;
  locked = RP.lobbyReduce(locked, { type: "kick", pid: "p1" }).state;
  locked = RP.lobbyReduce(locked, { type: "lock", locked: true }).state;
  const refused = RP.lobbyReduce(locked, joinEv("x2", "Zed", { pid: "p1" }));
  assert.equal(sent(refused.effects)[0].msg.reason, "locked");
});

test("ADV-C4 a relinking phone cannot take the name of a live player", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;      // p2 = Bo, live
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).state; // p1 = Alex, offline

  // A phone that remembers pid p1 rejoins claiming the live player's name.
  const out = RP.lobbyReduce(s, joinEv("peerC", "Bo", { pid: "p1" }));
  const roster = names(out.state).map((n) => n.toLowerCase());
  assert.equal(new Set(roster).size, roster.length, `duplicate names on the roster: ${roster}`);
});

test("ADV-C5 duplicate detection sees through control characters and case", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  for (const attempt of ["ALEX", "  alex  ", `A${CTRL(0)}l${CTRL(7)}e${CTRL(127)}x`, "aLeX\n"]) {
    const out = RP.lobbyReduce(s, joinEv("peerB", attempt));
    assert.equal(sent(out.effects)[0].msg.reason, "name-taken", `"${attempt}" slipped through`);
  }
  // Homoglyphs are NOT deduplicated (documented, not a defect): a Cyrillic А
  // is a different name. Colour + avatar + the 🟢 dot keep rows tellable apart.
  const cyrillic = RP.lobbyReduce(s, joinEv("peerC", "Аlex"));
  assert.equal(sent(cyrillic.effects)[0].msg.t, "joined");
});

test("ADV-C6 a prototype-shaped pid never looks like a player", () => {
  const s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  for (const pid of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    for (const type of ["kick", "remove", "rename"]) {
      const out = RP.lobbyReduce(s, { type, pid, name: "X" });
      assert.deepEqual(out.effects, [], `${type} ${pid} produced effects`);
      assert.deepEqual(out.state, s, `${type} ${pid} changed the state`);
    }
  }
});

test("ADV-C7 reducers stay pure against hostile events and deep-frozen state", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;
  s = RP.lobbyReduce(s, { type: "addManual", name: "Cy" }).state;
  const frozen = deepFreeze(JSON.parse(JSON.stringify(s)));
  const before = JSON.stringify(frozen);

  const hostile = [
    joinEv("peerA", "Alex"),                                    // duplicate on a live peer
    joinEv("peerZ", "x".repeat(240)),                           // max-length name
    joinEv("peerY", "🦊".repeat(40), { avatar: "💣" }),          // astral name, bad avatar
    joinEv("peerX", "Dee", { pid: "p999999" }),                 // unknown but legal pid
    { type: "join", peerId: "peerW", name: "Eve", pid: 12 },    // wrong pid type
    { type: "leave", peerId: "__proto__" },
    { type: "status", peerId: "peerA", connected: "yes" },
    { type: "kick", pid: null },
    { type: "rename", pid: "p3", name: CTRL(0) + CTRL(0) },
    { type: "setGame", gameId: "x".repeat(200) },
    { type: "setMax", n: -50 },
    { type: "setMax", n: 1.5 },
    { type: "addManual", name: { toString: () => "Eve" } },
    Object.assign(Object.create(null), { type: "kick", pid: "p1" }),
  ];
  for (const ev of hostile) {
    const out = RP.lobbyReduce(frozen, ev);
    assert.ok(out && out.state && Array.isArray(out.effects), `bad shape for ${JSON.stringify(ev)}`);
    assert.equal(JSON.stringify(frozen), before, `mutated the input on ${JSON.stringify(ev)}`);
    // Every effect must be JSON-serialisable — they go straight onto the wire.
    for (const eff of out.effects) assert.doesNotThrow(() => JSON.stringify(eff));
  }
  // The frozen state is still a legal lobby afterwards.
  assert.ok(RP.validateEnvelope(RP.lobbySnapshot(frozen)));
});

test("ADV-C8 restoreLobby tolerates a poisoned localStorage blob", () => {
  const poisoned = {
    players: [
      lobbyPlayer(1),
      lobbyPlayer(1),                                    // duplicate pid
      { ...lobbyPlayer(2), pid: "__proto__" },           // illegal pid
      { ...lobbyPlayer(3), color: "x".repeat(400) },     // oversized colour
      { ...lobbyPlayer(4), name: CTRL(0) },             // empty after sanitising
      null, "nope", [],
      ...Array.from({ length: 40 }, (_, i) => lobbyPlayer(i + 10)),
    ],
    nextId: -5,
  };
  const out = RP.restoreLobby(poisoned);
  assert.ok(out.order.length <= RP.MAX_PLAYERS_CAP, `restored ${out.order.length} players`);
  assert.equal(new Set(out.order).size, out.order.length, "no duplicate pids");
  for (const pid of out.order) assert.ok(RP.isPid(pid), `bad pid restored: ${pid}`);
  assert.ok(Number.isInteger(out.nextId) && out.nextId > 0, "nextId is a usable counter");
  assert.deepEqual(out.peers, {}, "connections are never restored");
  for (const pid of out.order) assert.equal(out.players[pid].connected, false);
  assert.equal({}.polluted, undefined);
  // A restored roster still accepts new joins with fresh, non-colliding pids.
  const joined = RP.lobbyReduce({ ...out, maxPlayers: 16 }, joinEv("newPeer", "Newbie"));
  assert.ok(joined.state.players["p" + out.nextId], "the next join uses nextId");
});

/* ============================================================
   D — VirtualPeer lifecycle edges
   ============================================================ */

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

const vpPlayer = (pid, name) => ({ pid, name, color: "#e69f00", avatar: "🦊", connected: true, manual: false });

test("ADV-D1 send() after close() must not reach the bridge", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [vpPlayer("p1", "Alex")] } });
  const conn = conns[0];

  conn.close();
  conn.close(); // idempotent
  assert.deepEqual(bus.posted, [{ t: "close", pid: "p1" }], "close posts exactly once");

  conn.send({ leaked: true });
  assert.deepEqual(bus.posted, [{ t: "close", pid: "p1" }],
    "a closed connection must not forward a payload to the shell");
  assert.equal(conn.open, false);
});

test("ADV-D2 destroy() twice emits close once and stays inert", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const closes = [];
  peer.on("close", () => closes.push(1));
  await tick();
  peer.destroy();
  peer.destroy();
  peer.destroy();
  assert.equal(closes.length, 1, "PeerJS emits close once per peer");
  assert.equal(peer.destroyed, true);
  assert.equal(peer.open, false);
  // A destroyed peer never re-opens through reconnect().
  const opens = [];
  peer.on("open", () => opens.push(1));
  peer.reconnect();
  await tick();
  assert.deepEqual(opens, []);
  // Roster traffic after destroy must not resurrect connections.
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  bus.deliver({ gsc: 1, t: "player-join", player: vpPlayer("p9", "Zed") });
  await tick();
  assert.deepEqual(conns, []);
});

test("ADV-D3 a player who leaves before init never leaves a dangling connection", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  const closed = [];
  peer.on("connection", (c) => { conns.push(c); c.on("close", () => closed.push(c.peer)); });
  await tick();

  bus.deliver({ gsc: 1, t: "player-join", player: vpPlayer("p9", "Zed") });
  bus.deliver({ gsc: 1, t: "player-leave", pid: "p9" });
  bus.deliver({ gsc: 1, t: "player-leave", pid: "p9" }); // a duplicate leave is harmless
  await tick();
  bus.deliver({ gsc: 1, t: "init", room: { code: "ABCD", players: [] } });
  await tick();

  assert.equal(hub._conns.size, 0, "no dangling connection survives the leave");
  assert.deepEqual(closed, ["p9"], "the connection closed exactly once");
  for (const c of conns) assert.equal(c.open, false);
  // Traffic aimed at the departed pid is dropped silently.
  assert.doesNotThrow(() => bus.deliver({ gsc: 1, t: "msg", pid: "p9", m: { x: 1 } }));
  assert.doesNotThrow(() => bus.deliver({ gsc: 1, t: "msg", pid: "pX", m: { x: 1 } }));
});

test("ADV-D4 init is idempotent and never double-announces a player", async () => {
  const bus = fakeBus("embed-host");
  const hub = VP.createHub(bus);
  const peer = new hub.Peer("gsc-ABCD");
  const conns = [];
  peer.on("connection", (c) => conns.push(c));
  await tick();
  const room = { code: "ABCD", players: [vpPlayer("p1", "Alex"), vpPlayer("p2", "Bo")] };
  bus.deliver({ gsc: 1, t: "init", room });
  bus.deliver({ gsc: 1, t: "init", room });            // host reload replay
  bus.deliver({ gsc: 1, t: "player-join", player: vpPlayer("p1", "Alex") }); // duplicate join
  await tick();
  assert.deepEqual(conns.map((c) => c.peer), ["p1", "p2"], "one connection per player");
  // A disconnected player in the init roster is not announced at all.
  const bus2 = fakeBus("embed-host");
  const hub2 = VP.createHub(bus2);
  const peer2 = new hub2.Peer();
  const conns2 = [];
  peer2.on("connection", (c) => conns2.push(c));
  await tick();
  bus2.deliver({
    gsc: 1, t: "init",
    room: { code: "AB", players: [{ ...vpPlayer("p1", "Alex"), connected: false }] },
  });
  await tick();
  assert.deepEqual(conns2, [], "a manual/offline player is not a connection");
});

test("ADV-D5 the phone shim: conn-close before connect, and repeated status drops", async () => {
  const bus = fakeBus("embed-player");
  const hub = VP.createHub(bus);
  // conn-close with no connection yet must not throw.
  assert.doesNotThrow(() => bus.deliver({ gsc: 1, t: "conn-close" }));
  const peer = new hub.Peer();
  const errs = [];
  peer.on("error", (e) => errs.push(e && e.type));
  await tick();

  const conn = peer.connect("gsc-ABCD", { metadata: { name: "Alex" } });
  const closes = [];
  conn.on("close", () => closes.push(1));
  await tick();
  assert.equal(conn.open, true);

  bus.deliver({ gsc: 1, t: "conn-close" });
  bus.deliver({ gsc: 1, t: "conn-close" });
  assert.equal(closes.length, 1, "conn-close closes once");
  assert.equal(conn.open, false);

  conn.send({ leaked: true });
  assert.deepEqual(bus.posted.filter((p) => p.t === "send"), [],
    "a closed phone connection must not send");

  // Only `status connected:false` raises the synthetic network error (00 §8).
  bus.deliver({ gsc: 1, t: "status", connected: true });
  bus.deliver({ gsc: 1, t: "msg", m: { x: 1 } });
  assert.deepEqual(errs, [], "nothing but a drop raises an error");
  bus.deliver({ gsc: 1, t: "status", connected: false });
  assert.deepEqual(errs, ["network"]);
});

test("ADV-D6 install() only takes over window.peerjs in embedded mode", () => {
  const before = globalThis.peerjs;
  assert.equal(VP.install({ mode: "standalone-host", bus: fakeBus("standalone-host") }), null);
  assert.equal(VP.install({ mode: "standalone-player", bus: fakeBus("standalone-player") }), null);
  assert.equal(VP.install({ mode: "nonsense" }), null);
  assert.equal(globalThis.peerjs, before, "a non-embedded page keeps the real PeerJS slot");
  const hub = VP.install({ mode: "embed-host", bus: fakeBus("embed-host") });
  assert.ok(hub && typeof hub.Peer === "function");
  assert.equal(globalThis.peerjs.Peer, hub.Peer);
  globalThis.peerjs = before;
});

/* ============================================================
   E — the standalone SDK before a room exists
   ============================================================ */

globalThis.location = { origin: "https://shell.test", search: "", pathname: "/", href: "https://shell.test/" };
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {},
};
globalThis.window.parent = globalThis.window;
globalThis.RoomProtocol = RP;

const hostCalls = [];
globalThis.RoomHost = {
  createRoomHost() {
    return {
      open: (code) => hostCalls.push(["open", code]),
      close: () => hostCalls.push(["close"]),
      send: (peerId, msg) => hostCalls.push(["send", peerId, msg]),
      broadcast: (msg) => hostCalls.push(["broadcast", msg]),
      dropConnection: (peerId) => hostCalls.push(["drop", peerId]),
      kick: (peerId) => hostCalls.push(["kick", peerId]),
      code: () => null,
      status: () => ({ status: "closed", code: null, error: null, broker: "ok" }),
      peerIds: () => [],
    };
  },
};

await import("../shared/bridge.js");

test("ADV-E1 a standalone game can build a roster before the room is open", async () => {
  const room = await globalThis.GSC.host({});
  assert.equal(globalThis.GSC.mode, "standalone-host");
  assert.equal(room.code, null);
  // "Everything works without phones": the host adds players, THEN opens a room.
  assert.doesNotThrow(() => room.lock(true), "lock before open");
  assert.doesNotThrow(() => room.addManual("Dana"), "addManual before open");
  assert.doesNotThrow(() => room.addManual("Eve"), "a second manual player");
  assert.deepEqual(room.players().map((p) => p.name), ["Dana", "Eve"]);
  assert.doesNotThrow(() => room.kick(room.players()[0].pid), "kick before open");
  assert.doesNotThrow(() => room.send("p9", { x: 1 }), "send to nobody before open");
  assert.doesNotThrow(() => room.broadcast({ x: 1 }), "broadcast before open");
  assert.doesNotThrow(() => room.close(), "close before open");
  // Embedded-only calls stay no-ops rather than throwing.
  assert.equal(room.reportScores([{ pid: "p1", score: 1 }]), undefined);
  assert.equal(room.setTitle("Round 2"), undefined);
  assert.equal(room.joinUrl(), null, "no join URL until a code exists");
});
