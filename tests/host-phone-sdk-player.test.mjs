/* ============================================================
   docs/22 §4.4 — the player-side SDK in embedded mode: me.role and
   onHostView. A host view never reaches onMessage, and a contestant
   frame never fires onHostView. The shell-side postHostView /
   postHostPhones / onHostView plumbing is checked here too.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";

const ORIGIN = "https://hub.test";
const listeners = [];
const parent = { postMessage: () => {} };

globalThis.location = { origin: ORIGIN, search: "?embed=player&room=ABCD&pid=p2&role=host", pathname: "/g/", href: `${ORIGIN}/g/` };
globalThis.window = {
  parent,
  addEventListener: (ev, fn) => { if (ev === "message") listeners.push(fn); },
  removeEventListener: (ev, fn) => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
};
globalThis.RoomProtocol = RP;
await import("../shared/bridge.js");
const { GSC, GSCBridge } = globalThis;

const down = (data) => { for (const fn of listeners.slice()) fn({ origin: ORIGIN, source: parent, data: { gsc: 1, ...data } }); };

test("HP-P1 a host phone: me.role is host; host-view reaches onHostView, never onMessage", async () => {
  const seen = [];
  const p = GSC.player({ onMessage: (m) => seen.push(["msg", m]), onHostView: (v) => seen.push(["view", v]) });
  down({ t: "init", me: { pid: "p2", name: "Bo", color: "#000", avatar: "🦊", role: "host" }, room: { code: "ABCD" } });
  const me = await p;
  assert.equal(me.role, "host");
  down({ t: "host-view", m: { t: "host", item: "Q1", answer: "Paris" } });
  assert.deepEqual(seen, [["view", { t: "host", item: "Q1", answer: "Paris" }]]);
});

test("HP-P2 a contestant (no role in init): me.role is player and onHostView never fires", async () => {
  // Re-init the same SDK instance as a contestant (the hub sends no role for players).
  const seen = [];
  const p = GSC.player({ onMessage: (m) => seen.push(["msg", m]), onHostView: (v) => seen.push(["view", v]) });
  down({ t: "init", me: { pid: "p1", name: "Alex", color: "#000", avatar: "🦊" }, room: { code: "ABCD" } });
  const me = await p;
  assert.equal(me.role, "player");
  seen.length = 0;
  down({ t: "host-view", m: { t: "host", item: "Q1", answer: "Paris" } });
  down({ t: "msg", m: { hello: 1 } });
  assert.deepEqual(seen.filter((e) => e[0] === "view"), [], "a contestant frame never sees a host view");
  assert.ok(seen.some((e) => e[0] === "msg"));
});

test("HP-P3 shell side: attachHostFrame relays host-view; postHostPhones / postHostView post the right shapes", () => {
  const posts = [];
  const iframe = { contentWindow: { postMessage: (data) => posts.push(data) } };
  const got = [];
  const host = GSCBridge.attachHostFrame(iframe, { onHostView: (m) => got.push(m) });
  for (const fn of listeners.slice()) fn({ origin: ORIGIN, source: iframe.contentWindow, data: { gsc: 1, t: "host-view", m: { item: "x" } } });
  assert.deepEqual(got, [{ item: "x" }]);
  host.postHostPhones([{ pid: "p2", name: "Bo", connected: true }]);
  const phone = GSCBridge.attachPlayerFrame(iframe, {});
  phone.postHostView({ item: "y" });
  assert.deepEqual(posts, [
    { gsc: 1, t: "host-phones", list: [{ pid: "p2", name: "Bo", connected: true }] },
    { gsc: 1, t: "host-view", m: { item: "y" } },
  ]);
  host.detach();
  phone.detach();
});
