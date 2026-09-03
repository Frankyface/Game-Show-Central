/* ============================================================
   L-U10 — the shell side of the bridge: origin, source and shape
   guards, plus the SDK's mode detection. Runs in Node against a
   fake window/postMessage pair (no DOM library).
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import RP from "../shared/room-protocol.js";

const ORIGIN = "https://shell.test";

/* ---- window / location shims, installed before bridge.js loads ---- */

const listeners = [];
globalThis.location = { origin: ORIGIN, search: "", pathname: "/", href: `${ORIGIN}/` };
globalThis.window = {
  addEventListener: (ev, fn) => { if (ev === "message") listeners.push(fn); },
  removeEventListener: (ev, fn) => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  },
};
globalThis.window.parent = globalThis.window;
globalThis.RoomProtocol = RP;

await import("../shared/bridge.js");
const { GSC, GSCBridge } = globalThis;

/** A fake iframe whose contentWindow records everything posted to it. */
function fakeIframe() {
  const posts = [];
  return { contentWindow: { posts, postMessage: (data, origin) => posts.push({ data, origin }) } };
}

/** Deliver a fake `message` event to every registered listener. */
function deliver(event) {
  for (const fn of listeners.slice()) fn(event);
}

function msgEvent(source, data, origin = ORIGIN) {
  return { origin, source, data };
}

/* ============ L-U10 ============ */

test("L-U10 the host frame bridge accepts only same-origin gsc:1 from its own frame", () => {
  const iframe = fakeIframe();
  const seen = [];
  const bridge = GSCBridge.attachHostFrame(iframe, {
    onReady: () => seen.push("ready"),
    onSend: (pid, m) => seen.push(["send", pid, m]),
    onClose: (pid) => seen.push(["close", pid]),
    onExit: () => seen.push("exit"),
    onScores: (s) => seen.push(["scores", s]),
    onTitle: (t) => seen.push(["title", t]),
  });

  // Wrong origin.
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "ready" }, "https://evil.test"));
  // Wrong source window.
  deliver(msgEvent({ other: true }, { gsc: 1, t: "ready" }));
  // Missing / wrong marker.
  deliver(msgEvent(iframe.contentWindow, { t: "ready" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 2, t: "ready" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1 }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: 7 }));
  // Not an object at all.
  deliver(msgEvent(iframe.contentWindow, null));
  deliver(msgEvent(iframe.contentWindow, "ready"));
  deliver(msgEvent(iframe.contentWindow, [{ gsc: 1, t: "ready" }]));
  assert.deepEqual(seen, [], "nothing malformed gets through");

  // The real thing.
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "ready" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "send", pid: "p1", m: { a: 1 } }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "close", pid: "p2" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "exit" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "scores", scores: [{ pid: "p1", score: 5 }] }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "title", text: "Round 2" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "who-knows" })); // unknown t: ignored
  assert.deepEqual(seen, [
    "ready",
    ["send", "p1", { a: 1 }],
    ["close", "p2"],
    "exit",
    ["scores", [{ pid: "p1", score: 5 }]],
    ["title", "Round 2"],
  ]);

  bridge.detach();
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "exit" }));
  assert.equal(seen.length, 6, "detach really unhooks");
});

test("L-U10 the shell posts init/roster/msg to the host frame at its own origin", () => {
  const iframe = fakeIframe();
  const bridge = GSCBridge.attachHostFrame(iframe, {});
  const room = { code: "ABCD", players: [{ pid: "p1", name: "Alex" }] };
  bridge.postInit(room);
  bridge.postPlayerJoin({ pid: "p2", name: "Bo" });
  bridge.postPlayerLeave("p2");
  bridge.postPlayerStatus("p1", false);
  bridge.postMsg("p1", { buzz: true });
  const posts = iframe.contentWindow.posts;
  assert.deepEqual(posts.map((p) => p.origin), new Array(5).fill(ORIGIN));
  assert.deepEqual(posts[0].data, { gsc: 1, t: "init", mode: "embed-host", room });
  assert.deepEqual(posts[1].data, { gsc: 1, t: "player-join", player: { pid: "p2", name: "Bo" } });
  assert.deepEqual(posts[2].data, { gsc: 1, t: "player-leave", pid: "p2" });
  assert.deepEqual(posts[3].data, { gsc: 1, t: "player-status", pid: "p1", connected: false });
  assert.deepEqual(posts[4].data, { gsc: 1, t: "msg", pid: "p1", m: { buzz: true } });
  bridge.detach();
});

test("L-U10 the player frame bridge has the same guards and its own messages", () => {
  const iframe = fakeIframe();
  const seen = [];
  const bridge = GSCBridge.attachPlayerFrame(iframe, {
    onReady: () => seen.push("ready"),
    onSend: (m) => seen.push(["send", m]),
  });
  deliver(msgEvent({ other: true }, { gsc: 1, t: "ready" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "ready" }, "https://evil.test"));
  deliver(msgEvent(iframe.contentWindow, { nope: 1 }));
  assert.deepEqual(seen, []);

  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "ready" }));
  deliver(msgEvent(iframe.contentWindow, { gsc: 1, t: "send", m: { press: 1 } }));
  assert.deepEqual(seen, ["ready", ["send", { press: 1 }]]);

  bridge.postInit({ pid: "p1", name: "Alex" }, { code: "ABCD" });
  bridge.postMsg({ mode: "armed" });
  bridge.postStatus(false);
  bridge.postConnClose();
  const posts = iframe.contentWindow.posts;
  assert.deepEqual(posts[0].data,
    { gsc: 1, t: "init", mode: "embed-player", me: { pid: "p1", name: "Alex" }, room: { code: "ABCD" } });
  assert.deepEqual(posts[1].data, { gsc: 1, t: "msg", m: { mode: "armed" } });
  assert.deepEqual(posts[2].data, { gsc: 1, t: "status", connected: false });
  assert.deepEqual(posts[3].data, { gsc: 1, t: "conn-close" });
  bridge.detach();
});

test("L-U10 a detached frame with no contentWindow never throws", () => {
  const bridge = GSCBridge.attachHostFrame({ contentWindow: null }, {});
  bridge.postInit({ code: "ABCD", players: [] });
  bridge.postMsg("p1", {});
  bridge.detach();
  assert.ok(true);
});

test("L-U10 SDK mode detection covers all four modes", () => {
  assert.equal(GSC._detectMode({ embed: "host" }), "embed-host");
  assert.equal(GSC._detectMode({ embed: "player" }), "embed-player");
  assert.equal(GSC._detectMode({ room: "ABCD" }), "standalone-player");
  assert.equal(GSC._detectMode({}), "standalone-host");
  assert.equal(GSC._detectMode({ embed: "nonsense", room: "ABCD" }), "standalone-player");
  assert.equal(GSC.mode, "standalone-host", "no query string in this rig");
  assert.equal(GSC.isEmbedded(), false);
  assert.equal(GSC.isPlayer(), false);
});

test("L-U10 rejectText turns every reject reason into plain English", () => {
  for (const reason of RP.REJECT_REASONS) {
    const text = GSC.rejectText(reason);
    assert.ok(typeof text === "string" && text.length > 5, `no text for ${reason}`);
  }
  assert.ok(GSC.rejectText("something-new").length > 5, "unknown reasons still get a sentence");
});

test("L-U10 GSC.host/player refuse the wrong mode instead of hanging", async () => {
  await assert.rejects(() => GSC.player({}), /standalone-host/);
});
