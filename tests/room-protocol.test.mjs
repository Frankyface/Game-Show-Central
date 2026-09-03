/* ============================================================
   L-U1 … L-U6 — the pure room protocol core.
   Zero npm deps: node:test + node:assert only.
   Run from the repo root:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";

/* ---- helpers ------------------------------------------------ */

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CTRL = (n) => String.fromCharCode(n);

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  return obj;
}

/** Apply a list of events, returning the final state and the last effects. */
function run(state, events) {
  let s = state;
  let effects = [];
  for (const ev of events) {
    const out = RP.lobbyReduce(s, ev);
    s = out.state;
    effects = out.effects;
  }
  return { state: s, effects };
}

const joinEv = (peerId, name, extra = {}) => ({ type: "join", peerId, name, ...extra });

function sent(effects) {
  return effects.filter((e) => e.send).map((e) => e.send);
}
function frames(effects) {
  return effects.filter((e) => e.frame).map((e) => e.frame);
}

/* ============ L-U1 — generateRoomCode ============ */

test("L-U1 room code: 4 chars, alphabet only, deterministic under injected rng", () => {
  const rng = lcg(20260903);
  for (let i = 0; i < 500; i += 1) {
    const code = RP.generateRoomCode(rng);
    assert.equal(code.length, 4);
    for (const ch of code) {
      assert.ok(RP.ROOM_ALPHABET.includes(ch), `char ${ch} not in alphabet`);
      assert.ok(!"ILO01".includes(ch), `ambiguous char ${ch} leaked`);
    }
  }
  // Same seed → same sequence.
  const a = lcg(7);
  const b = lcg(7);
  for (let i = 0; i < 20; i += 1) assert.equal(RP.generateRoomCode(a), RP.generateRoomCode(b));

  assert.ok(RP.isRoomCode("ABCD"));
  assert.ok(!RP.isRoomCode("abcd"));
  assert.ok(!RP.isRoomCode("ABC"));
  assert.ok(!RP.isRoomCode(null));
  assert.equal(RP.normalizeRoomCode(" abcd "), "ABCD");
  assert.equal(RP.normalizeRoomCode("nope!"), "");
  assert.equal(RP.PEER_PREFIX, "gsc-");
});

/* ============ L-U2 — sanitizers ============ */

test("L-U2 sanitizeName strips controls, trims, caps at 24; junk → null", () => {
  assert.equal(RP.sanitizeName("  Alex  "), "Alex");
  assert.equal(RP.sanitizeName(`A${CTRL(0)}l${CTRL(9)}e${CTRL(127)}x`), "Alex");
  assert.equal(RP.sanitizeName("x".repeat(80)), "x".repeat(24));
  assert.equal(RP.sanitizeName("   "), null);
  assert.equal(RP.sanitizeName(""), null);
  assert.equal(RP.sanitizeName(CTRL(7) + CTRL(8)), null);
  assert.equal(RP.sanitizeName(42), null);
  assert.equal(RP.sanitizeName(null), null);
  assert.equal(RP.sanitizeName({ name: "Alex" }), null);
  // A name that is only trailing whitespace after the cap still trims clean.
  assert.equal(RP.sanitizeName("A".repeat(23) + "   B"), "A".repeat(23));
});

test("L-U2 sanitizeAvatar is an allow-list", () => {
  for (const a of RP.AVATARS) assert.equal(RP.sanitizeAvatar(a), a);
  assert.equal(RP.sanitizeAvatar("💣"), null);
  assert.equal(RP.sanitizeAvatar("<img>"), null);
  assert.equal(RP.sanitizeAvatar(""), null);
  assert.equal(RP.sanitizeAvatar(7), null);
  assert.equal(RP.AVATARS.length, 12);
  assert.equal(RP.COLORS.length, 12);
  assert.equal(new Set(RP.COLORS).size, 12);
});

test("L-U2 payloadTooBig honours the 32 KB cap and refuses cycles", () => {
  assert.equal(RP.PAYLOAD_MAX_BYTES, 32768);
  assert.equal(RP.payloadTooBig({ ok: true }), false);
  assert.equal(RP.payloadTooBig("x".repeat(32000)), false);
  assert.equal(RP.payloadTooBig("x".repeat(33000)), true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(RP.payloadTooBig(cyclic), true);
  // Multi-byte characters count as their UTF-8 length, not their JS length.
  assert.equal(RP.utf8Bytes("é"), 2);
  assert.equal(RP.utf8Bytes("あ"), 3);
  assert.equal(RP.utf8Bytes("🦊"), 4);
  assert.equal(RP.payloadTooBig("🦊".repeat(9000)), true);
});

/* ============ L-U3 — validateEnvelope ============ */

test("L-U3 validateEnvelope accepts every documented v2 message", () => {
  const ok = (obj, expected) => assert.deepEqual(RP.validateEnvelope(obj), expected);

  ok({ v: 2, t: "join", name: "Alex" }, { v: 2, t: "join", name: "Alex" });
  ok({ v: 2, t: "join", name: "Alex", avatar: "🦊", pid: "p3" },
     { v: 2, t: "join", name: "Alex", avatar: "🦊", pid: "p3" });
  ok({ v: 2, t: "ping" }, { v: 2, t: "ping" });
  ok({ v: 2, t: "pong" }, { v: 2, t: "pong" });
  ok({ v: 2, t: "game", g: "jeopardy", m: { buzz: 1 } },
     { v: 2, t: "game", g: "jeopardy", m: { buzz: 1 } });
  ok({ v: 2, t: "avatar", emoji: "🐼" }, { v: 2, t: "avatar", emoji: "🐼" });
  ok({ v: 2, t: "joined", pid: "p1", name: "Alex", color: "#e69f00", avatar: "🦊" },
     { v: 2, t: "joined", pid: "p1", name: "Alex", color: "#e69f00", avatar: "🦊" });
  ok({ v: 2, t: "reject", reason: "locked" }, { v: 2, t: "reject", reason: "locked" });
  ok({ v: 2, t: "room-closed" }, { v: 2, t: "room-closed" });
  ok({ v: 2, t: "kicked" }, { v: 2, t: "kicked" });

  const lobby = {
    v: 2, t: "lobby", game: "family-feud",
    players: [{ pid: "p1", name: "Alex", color: "#e69f00", avatar: "🦊", connected: true, manual: false }],
  };
  assert.deepEqual(RP.validateEnvelope(lobby), lobby);
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "lobby", game: null, players: [] }),
                   { v: 2, t: "lobby", game: null, players: [] });
});

test("L-U3 validateEnvelope rejects wrong v, unknown t, junk and oversized payloads", () => {
  const bad = (obj) => assert.equal(RP.validateEnvelope(obj), null, JSON.stringify(obj));
  bad(null);
  bad(undefined);
  bad("string");
  bad(7);
  bad([]);
  bad([{ v: 2, t: "ping" }]);
  bad({});
  bad({ v: 1, t: "join", name: "Alex" });
  bad({ v: "2", t: "ping" });
  bad({ v: 2 });
  bad({ v: 2, t: 5 });
  bad({ v: 2, t: "buzz" }); // a v1 Jeopardy message is not a room envelope
  bad({ v: 2, t: "unknown-future" });
  bad({ v: 2, t: "join", name: 5 });
  bad({ v: 2, t: "join", name: "x".repeat(241) });
  bad({ v: 2, t: "join", name: "Alex", pid: "nope" });
  bad({ v: 2, t: "join", name: "Alex", avatar: 5 });
  bad({ v: 2, t: "game", g: "", m: {} });
  bad({ v: 2, t: "game", g: "jeopardy" }); // no payload
  bad({ v: 2, t: "game", g: "x".repeat(41), m: {} });
  bad({ v: 2, t: "game", g: "jeopardy", m: "x".repeat(40000) }); // > 32 KB
  bad({ v: 2, t: "avatar", emoji: "💣" });
  bad({ v: 2, t: "reject", reason: "because" });
  bad({ v: 2, t: "joined", pid: "p1", name: "Alex", color: "#e69f00", avatar: "💣" });
  bad({ v: 2, t: "lobby", game: null, players: "nope" });
  bad({ v: 2, t: "lobby", game: null, players: [{ pid: "p1" }] });
  bad({ v: 2, t: "lobby", game: null, players: new Array(17).fill(null) });

  // An unknown avatar on a join is dropped, not fatal (forward compatible).
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "join", name: "Alex", avatar: "💣" }),
                   { v: 2, t: "join", name: "Alex" });
  // Extra fields never survive.
  assert.deepEqual(RP.validateEnvelope({ v: 2, t: "ping", evil: "<script>" }), { v: 2, t: "ping" });
});

/* ============ L-U4 — lobbyReduce: join ============ */

test("L-U4 join assigns p1…, distinct colours, and announces to the game frame", () => {
  const s0 = RP.createLobbyState();
  const a = RP.lobbyReduce(s0, joinEv("peerA", "Alex", { avatar: "🦊" }));
  assert.equal(a.state.order.length, 1);
  const p1 = a.state.players.p1;
  assert.equal(p1.pid, "p1");
  assert.equal(p1.name, "Alex");
  assert.equal(p1.avatar, "🦊");
  assert.equal(p1.connected, true);
  assert.equal(p1.manual, false);
  assert.equal(a.state.peers.peerA, "p1");
  assert.deepEqual(sent(a.effects)[0], { to: "peerA", msg: RP.joinedMsg(p1) });
  assert.ok(a.effects.some((e) => e.broadcastLobby));
  assert.deepEqual(frames(a.effects)[0], { t: "player-join", player: RP.playerCopy(p1) });

  const b = RP.lobbyReduce(a.state, joinEv("peerB", "Bo"));
  assert.equal(b.state.players.p2.pid, "p2");
  assert.notEqual(b.state.players.p2.color, p1.color);
  assert.notEqual(b.state.players.p2.avatar, p1.avatar);
});

test("L-U4 colours stay unique for 12 players then cycle", () => {
  let s = RP.createLobbyState();
  s = RP.lobbyReduce(s, { type: "setMax", n: 16 }).state;
  for (let i = 1; i <= 12; i += 1) s = RP.lobbyReduce(s, joinEv("peer" + i, "P" + i)).state;
  const colors = s.order.map((pid) => s.players[pid].color);
  assert.equal(new Set(colors).size, 12);
  s = RP.lobbyReduce(s, joinEv("peer13", "P13")).state;
  const thirteenth = s.players.p13.color;
  assert.ok(RP.COLORS.includes(thirteenth), "13th colour still comes from the palette");
  assert.equal(s.order.length, 13);
});

test("L-U4 duplicate live names are rejected case-insensitively and the peer is closed", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  const out = RP.lobbyReduce(s, joinEv("peerB", "  aLeX "));
  assert.deepEqual(out.state, s, "state unchanged on reject");
  assert.deepEqual(sent(out.effects), [{ to: "peerB", msg: { v: 2, t: "reject", reason: "name-taken" } }]);
  assert.ok(out.effects.some((e) => e.close === "peerB"));
});

test("L-U4 bad name, room-full and locked each produce their own reason", () => {
  const s0 = RP.createLobbyState();
  const badName = RP.lobbyReduce(s0, joinEv("peerX", "   "));
  assert.equal(sent(badName.effects)[0].msg.reason, "bad-name");

  let full = RP.lobbyReduce(s0, { type: "setMax", n: 2 }).state;
  full = RP.lobbyReduce(full, joinEv("p_a", "Alex")).state;
  full = RP.lobbyReduce(full, joinEv("p_b", "Bo")).state;
  const third = RP.lobbyReduce(full, joinEv("p_c", "Cy"));
  assert.equal(sent(third.effects)[0].msg.reason, "room-full");

  const locked = RP.lobbyReduce(RP.lobbyReduce(s0, { type: "lock", locked: true }).state,
                                joinEv("peerL", "Dee"));
  assert.equal(sent(locked.effects)[0].msg.reason, "locked");
});

test("L-U4 relinks by pid and by disconnected name, and adopts a manual player", () => {
  // by pid
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex", { avatar: "🦊" })).state;
  const color = s.players.p1.color;
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).state;
  assert.equal(s.players.p1.connected, false);
  let out = RP.lobbyReduce(s, joinEv("peerA2", "Alexandra", { pid: "p1" }));
  assert.equal(out.state.order.length, 1);
  assert.equal(out.state.players.p1.connected, true);
  assert.equal(out.state.players.p1.color, color);
  assert.equal(out.state.players.p1.name, "Alexandra", "a phone owns its own name");
  assert.equal(out.state.peers.peerA2, "p1");
  assert.deepEqual(frames(out.effects), [{ t: "player-status", pid: "p1", connected: true }]);

  // by disconnected name
  let t = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  t = RP.lobbyReduce(t, { type: "leave", peerId: "peerA" }).state;
  const back = RP.lobbyReduce(t, joinEv("peerZ", "alex"));
  assert.equal(back.state.order.length, 1);
  assert.equal(back.state.players.p1.connected, true);

  // manual adoption: the host's spelling wins, manual flips false
  let m = RP.lobbyReduce(RP.createLobbyState(), { type: "addManual", name: "Casey" }).state;
  assert.equal(m.players.p1.manual, true);
  const adopted = RP.lobbyReduce(m, joinEv("peerC", "casey", { avatar: "🐼" }));
  assert.equal(adopted.state.players.p1.manual, false);
  assert.equal(adopted.state.players.p1.connected, true);
  assert.equal(adopted.state.players.p1.name, "Casey");
  assert.equal(adopted.state.players.p1.avatar, "🐼");
  assert.equal(adopted.state.order.length, 1);
});

test("L-U4 a locked lobby still lets an existing player back in", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).state;
  s = RP.lobbyReduce(s, { type: "lock", locked: true }).state;
  const back = RP.lobbyReduce(s, joinEv("peerA2", "Alex", { pid: "p1" }));
  assert.equal(back.state.players.p1.connected, true);
  assert.equal(sent(back.effects)[0].msg.t, "joined");
});

/* ============ L-U5 — leave / status / kick / manual / setGame ============ */

test("L-U5 leave and status flip connected without deleting the player", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  const left = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" });
  assert.equal(left.state.order.length, 1);
  assert.equal(left.state.players.p1.connected, false);
  assert.equal(left.state.peers.peerA, undefined);
  assert.ok(left.effects.some((e) => e.broadcastLobby));
  assert.deepEqual(frames(left.effects), [{ t: "player-status", pid: "p1", connected: false }]);

  // an unknown peer is a no-op
  assert.deepEqual(RP.lobbyReduce(left.state, { type: "leave", peerId: "ghost" }).effects, []);

  // status
  const stale = RP.lobbyReduce(s, { type: "status", peerId: "peerA", connected: false });
  assert.equal(stale.state.players.p1.connected, false);
  assert.deepEqual(frames(stale.effects), [{ t: "player-status", pid: "p1", connected: false }]);
  // idempotent
  assert.deepEqual(RP.lobbyReduce(s, { type: "status", peerId: "peerA", connected: true }).effects, []);
});

test("L-U5 kick deletes the player and emits kicked + close", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;
  const out = RP.lobbyReduce(s, { type: "kick", pid: "p1" });
  assert.equal(out.state.players.p1, undefined);
  assert.deepEqual(out.state.order, ["p2"]);
  assert.equal(out.state.peers.peerA, undefined);
  assert.deepEqual(sent(out.effects), [{ to: "peerA", msg: { v: 2, t: "kicked" } }]);
  assert.ok(out.effects.some((e) => e.close === "peerA"));
  assert.deepEqual(frames(out.effects), [{ t: "player-leave", pid: "p1" }]);
  // kicking a ghost changes nothing
  assert.deepEqual(RP.lobbyReduce(out.state, { type: "kick", pid: "p9" }).effects, []);
});

test("L-U5 manual players: add, rename, remove", () => {
  const add = RP.lobbyReduce(RP.createLobbyState(), { type: "addManual", name: " Dana " });
  assert.equal(add.state.players.p1.name, "Dana");
  assert.equal(add.state.players.p1.connected, false);
  assert.equal(add.state.players.p1.manual, true);
  assert.deepEqual(frames(add.effects), [{ t: "player-join", player: RP.playerCopy(add.state.players.p1) }]);

  // duplicates and blanks are refused
  assert.deepEqual(RP.lobbyReduce(add.state, { type: "addManual", name: "dana" }).effects, []);
  assert.deepEqual(RP.lobbyReduce(add.state, { type: "addManual", name: "  " }).effects, []);

  const renamed = RP.lobbyReduce(add.state, { type: "rename", pid: "p1", name: "Dana P" });
  assert.equal(renamed.state.players.p1.name, "Dana P");
  assert.ok(renamed.effects.some((e) => e.broadcastLobby));

  const removed = RP.lobbyReduce(renamed.state, { type: "remove", pid: "p1" });
  assert.equal(removed.state.order.length, 0);
  assert.deepEqual(frames(removed.effects), [{ t: "player-leave", pid: "p1" }]);

  // a phone player is neither renameable nor removable this way
  const phone = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  assert.deepEqual(RP.lobbyReduce(phone, { type: "rename", pid: "p1", name: "Nope" }).effects, []);
  assert.deepEqual(RP.lobbyReduce(phone, { type: "remove", pid: "p1" }).effects, []);
});

test("L-U5 setGame, lock and setMax", () => {
  const s0 = RP.createLobbyState();
  const g = RP.lobbyReduce(s0, { type: "setGame", gameId: "wheel-of-fortune" });
  assert.equal(g.state.activeGame, "wheel-of-fortune");
  assert.deepEqual(g.effects, [{ broadcastLobby: true }]);
  const back = RP.lobbyReduce(g.state, { type: "setGame", gameId: null });
  assert.equal(back.state.activeGame, null);
  assert.deepEqual(back.effects, [{ broadcastLobby: true }]);
  assert.deepEqual(RP.lobbyReduce(back.state, { type: "setGame", gameId: null }).effects, []);

  assert.equal(RP.lobbyReduce(s0, { type: "lock", locked: true }).state.locked, true);
  assert.equal(RP.lobbyReduce(s0, { type: "setMax", n: 99 }).state.maxPlayers, RP.MAX_PLAYERS_CAP);
  assert.equal(RP.lobbyReduce(s0, { type: "setMax", n: 0 }).state.maxPlayers, 1);
  assert.deepEqual(RP.lobbyReduce(s0, { type: "setMax", n: "many" }).effects, []);
  assert.equal(s0.maxPlayers, 12, "the default lobby holds 12");
});

test("L-U5 lobbySnapshot is the wire payload, in join order", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, { type: "addManual", name: "Bo" }).state;
  s = RP.lobbyReduce(s, { type: "setGame", gameId: "jeopardy" }).state;
  const snap = RP.lobbySnapshot(s);
  assert.equal(snap.v, 2);
  assert.equal(snap.t, "lobby");
  assert.equal(snap.game, "jeopardy");
  assert.deepEqual(snap.players.map((p) => p.pid), ["p1", "p2"]);
  assert.deepEqual(snap.players.map((p) => p.connected), [true, false]);
  assert.ok(RP.validateEnvelope(snap), "a snapshot validates as an envelope");
});

test("L-U5 serialize/restore keeps the roster across a host reload", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, { type: "addManual", name: "Bo" }).state;
  const saved = JSON.parse(JSON.stringify(RP.serializeLobby(s)));
  const restored = RP.restoreLobby(saved);
  assert.deepEqual(restored.order, ["p1", "p2"]);
  assert.equal(restored.players.p1.connected, false);
  assert.equal(restored.players.p2.manual, true);
  assert.equal(restored.nextId, 3);
  assert.deepEqual(restored.peers, {});
  // junk restores a clean lobby
  assert.deepEqual(RP.restoreLobby(null).order, []);
  assert.deepEqual(RP.restoreLobby({ players: "no" }).order, []);
  assert.deepEqual(RP.restoreLobby({ players: [{ pid: "bad" }] }).order, []);
});

/* ============ L-U6 — purity ============ */

test("L-U6 reducers never mutate their inputs", () => {
  let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;
  s = RP.lobbyReduce(s, { type: "addManual", name: "Cy" }).state;
  const frozen = deepFreeze(JSON.parse(JSON.stringify(s)));
  const before = JSON.stringify(frozen);
  const events = [
    joinEv("peerC", "Dee"),
    joinEv("peerD", "Alex"),
    { type: "leave", peerId: "peerA" },
    { type: "status", peerId: "peerB", connected: false },
    { type: "kick", pid: "p2" },
    { type: "rename", pid: "p3", name: "Cy Jr" },
    { type: "remove", pid: "p3" },
    { type: "lock", locked: true },
    { type: "setGame", gameId: "weakest-link" },
    { type: "setMax", n: 5 },
    { type: "addManual", name: "Eve" },
  ];
  for (const ev of events) {
    const out = RP.lobbyReduce(frozen, ev);
    assert.ok(out && out.state && Array.isArray(out.effects), `bad shape for ${ev.type}`);
    assert.equal(JSON.stringify(frozen), before, `${ev.type} mutated the input`);
  }
});

test("L-U6 reducers never throw on junk events", () => {
  const s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
  const junk = [
    undefined, null, 7, "join", [], {},
    { type: "nope" },
    { type: "join" },
    { type: "join", peerId: 5, name: "Al" },
    { type: "join", peerId: "", name: "Al" },
    { type: "leave" },
    { type: "status" },
    { type: "kick" },
    { type: "kick", pid: {} },
    { type: "addManual" },
    { type: "rename", pid: "p1" },
    { type: "remove" },
    { type: "lock" },
    { type: "setGame" },
    { type: "setMax" },
  ];
  for (const ev of junk) {
    const out = RP.lobbyReduce(s, ev);
    assert.ok(out && out.state, `threw or returned junk for ${JSON.stringify(ev)}`);
    assert.ok(Array.isArray(out.effects));
  }
});
