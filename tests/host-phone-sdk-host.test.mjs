/* ============================================================
   docs/22 §4.4 — the host-side SDK in embedded mode:
   room.hostPhones(), room.answersPrivate(), room.setHostView(view)
   with the 16 KB tooBig rule, onHostPhones, and the guarantee that
   no player-* handler ever fires for a host phone.
   A fake parent window stands in for the hub.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";

const ORIGIN = "https://hub.test";
const listeners = [];
const up = []; // what the game posts to the hub
const parent = { postMessage: (data) => up.push(data) };

globalThis.location = { origin: ORIGIN, search: "?embed=host&room=ABCD", pathname: "/g/", href: `${ORIGIN}/g/` };
globalThis.window = {
  parent,
  addEventListener: (ev, fn) => { if (ev === "message") listeners.push(fn); },
  removeEventListener: () => {},
};
globalThis.RoomProtocol = RP;
await import("../shared/bridge.js");
const { GSC } = globalThis;

const down = (data) => { for (const fn of listeners.slice()) fn({ origin: ORIGIN, source: parent, data: { gsc: 1, ...data } }); };
const player = (pid, name) => ({ pid, name, color: "#e69f00", avatar: "🦊", connected: true, manual: false });

const seen = [];
const roomP = GSC.host({
  onPlayerJoin: (p) => seen.push(["join", p.pid]),
  onPlayerLeave: (pid) => seen.push(["leave", pid]),
  onPlayerStatus: (pid, c) => seen.push(["status", pid, c]),
  onMessage: (pid, m) => seen.push(["msg", pid, m]),
  onHostPhones: (list) => seen.push(["host-phones", list]),
});
down({ t: "init", room: {
  code: "ABCD", players: [player("p1", "Alex")],
  hostPhones: [{ pid: "p2", name: "Bo", connected: true }], answersPrivate: true,
} });
const room = await roomP;

test("HP-S1 init: players() is contestants only; hostPhones() and answersPrivate() come from init", () => {
  assert.equal(GSC.mode, "embed-host");
  assert.deepEqual(room.players().map((p) => p.pid), ["p1"]);
  assert.deepEqual(room.hostPhones(), [{ pid: "p2", name: "Bo", connected: true }]);
  assert.equal(room.answersPrivate(), true);
  room.hostPhones()[0].name = "mutated";
  assert.equal(room.hostPhones()[0].name, "Bo", "hostPhones() returns copies");
});

test("HP-S2 host-phones updates the list and fires onHostPhones; a stale host phone keeps answersPrivate", () => {
  seen.length = 0;
  down({ t: "host-phones", list: [{ pid: "p2", name: "Bo", connected: false }] });
  assert.deepEqual(seen, [["host-phones", [{ pid: "p2", name: "Bo", connected: false }]]]);
  assert.equal(room.answersPrivate(), true, "private mode is about the roster, not the connection");
  down({ t: "host-phones", list: [] });
  assert.equal(room.answersPrivate(), false, "no host-role entry left");
  down({ t: "host-phones", list: [{ pid: "p2", name: "Bo", connected: true }] });
  assert.equal(room.answersPrivate(), true);
  assert.ok(!seen.some((e) => e[0] === "join" || e[0] === "leave" || e[0] === "status"),
    "no player-* handler fires for a host phone");
});

test("HP-S3 setHostView posts host-view, de-duplicates identical views", () => {
  up.length = 0;
  room.setHostView({ t: "host", item: "Q1", seq: 1, answer: "Paris" });
  room.setHostView({ t: "host", item: "Q1", seq: 1, answer: "Paris" });
  room.setHostView({ t: "host", item: "Q2", seq: 2, answer: "Rome" });
  assert.deepEqual(up.map((d) => [d.t, d.m.item]), [["host-view", "Q1"], ["host-view", "Q2"]]);
  assert.ok(up.every((d) => d.gsc === 1));
});

test("HP-S4 a view over 16 KB (or unserialisable) is replaced by {t:'host', item, tooBig:true} with a warning", () => {
  up.length = 0;
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    room.setHostView({ t: "host", item: "Fast Money", list: "x".repeat(17000) });
    const cyclic = { t: "host", item: "loop" }; cyclic.self = cyclic;
    room.setHostView(cyclic);
  } finally { console.warn = warn; }
  assert.deepEqual(up.map((d) => d.m), [
    { t: "host", item: "Fast Money", tooBig: true },
    { t: "host", item: "loop", tooBig: true },
  ]);
  assert.equal(warned.length, 2);
  up.length = 0;
  room.setHostView({ t: "host", item: "edge", s: "y".repeat(16000) }); // just under 16 KB
  assert.equal(up[0].m.tooBig, undefined);
});

test("HP-S5 a fresh init re-sends the next view even if it is identical", () => {
  room.setHostView({ t: "host", item: "same" });
  up.length = 0;
  down({ t: "init", room: { code: "ABCD", players: [player("p1", "Alex")], hostPhones: [], answersPrivate: false } });
  room.setHostView({ t: "host", item: "same" });
  assert.equal(up.length, 1);
  assert.equal(room.answersPrivate(), false);
});
