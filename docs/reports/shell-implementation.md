# Shell — implementation report

Component: `shell` · Spec: `docs/01-lobby-shell-spec.md` · Date: 2026-09-03
Environment: Windows 11 (10.0.22635), Node **v24.16.0**, Chromium (in-app
browser), served with `python -m http.server`.

Status: **complete and green.** T1 230/230, T2 16/16, T3 5/5 with real
PeerJS/WebRTC, all T5 static gates clean.

---

## 1. What was built

| File | Lines | What it is |
|---|---:|---|
| `shared/theme.css` | 200 | Tokens (`--stage-*`, ink/gold/red/green, Anton + Inter, radii), `.btn` family, `.field`, `.hidden`, `.visually-hidden`, `.error-msg`, `prefers-reduced-motion`. |
| `shared/room-protocol.js` | 618 | PURE UMD. Room codes, sanitisers, `validateEnvelope`, the lobby reducer + snapshot, persistence helpers. |
| `shared/room-net.js` | 377 | **Verbatim copy** of `games/jeopardy/js/buzzer-net.js` (see §5). |
| `shared/room-host.js` | 375 | `RoomHost` — the host's PeerJS peer, code collisions, open deadline, rate limit, heartbeat sweep, broker controller, close flush. |
| `shared/room-player.js` | 409 | `RoomPlayer` — join deadline + 3 attempts, 3 s reconnect loop, heartbeat + visibility probe, wake lock, in-app hint, tips. |
| `shared/bridge.js` | 564 | `GSC` (the SDK, all four modes) + `GSCBridge` (shell side). |
| `shared/virtual-peer.js` | 235 | PeerJS-shaped shim over the bridge, for Jeopardy. |
| `index.html` | 139 | Hub skeleton: landing, lobby, shell bar + host frame, phone join/waiting/play. |
| `css/hub.css` | 473 | Projector lobby + 320 px phone. |
| `js/hub-registry.js` | 86 | `GAME_REGISTRY` + URL builders + soft player hints. |
| `js/hub-host.js` | 694 | Host shell: room lifecycle, roster, lobby UI, tiles, dialogs, shell bar, persistence. |
| `js/hub-player.js` | 388 | Phone shell: join card, waiting room, game frame, reconnect banner. |
| `js/hub-night.js` | 108 | Tonight's running scoreboard (pure bookkeeping). |
| `README.md` | 210 | Rewritten for the hub (spec §4). |
| `tests/room-protocol.test.mjs` | 444 | L-U1 … L-U6. |
| `tests/room-transport.test.mjs` | 495 | L-U7, L-U8 (fake peers, fake clock, fake timers). |
| `tests/virtual-peer.test.mjs` | 234 | L-U9 (fake postMessage bus, no DOM). |
| `tests/bridge.test.mjs` | 173 | L-U10 (fake window/postMessage pair). |
| `tests/fake-game.html` | 119 | The smallest SDK game: renders `init`, echoes `msg` as `send`. |
| `tests/hub-harness.html` | 515 | L-I1 … L-I10 with an in-page fake peer pair. |

Largest file: `js/hub-host.js` at 694 lines (cap 800).

---

## 2. The SDK as actually implemented

`shared/bridge.js` exports `window.GSC` (games) and `window.GSCBridge` (shell).
Games load, in order:

```html
<script src="../../shared/room-protocol.js"></script>
<script src="../../shared/room-net.js"></script>
<script src="../../shared/room-host.js"></script>
<script src="../../shared/room-player.js"></script>
<script src="../../shared/bridge.js"></script>
```

`shared/bridge.js` does not fetch its own dependencies — load all five.

```js
GSC.mode      // "embed-host" | "embed-player" | "standalone-host" | "standalone-player"
GSC.params    // parsed URL params, e.g. GSC.params.room
GSC.gameId    // <body data-gsc-game="…">, else ?game=, else "game"
GSC.isEmbedded()  GSC.isPlayer()
GSC.rejectText(reason)   // plain-English text for a reject reason
```

### Host

```js
const room = await GSC.host({
  onPlayerJoin(player), onPlayerLeave(pid), onPlayerStatus(pid, connected),
  onMessage(pid, m),
});
room.code            // "ABCD" (standalone: null until room.open() succeeds) — a live getter
room.gameId
room.players()       // [Player] immutable copies, join order
room.send(pid, m)    // pid "*" is accepted and means broadcast
room.broadcast(m)
room.exit()          // embedded: back to the lobby · standalone: close + reload
room.reportScores([{pid, name, score}])   // embedded only; standalone is a no-op
room.setTitle("Round 2")                  // embedded only; standalone is a no-op
room.status()        // {open, connecting, error, code}
room.onStatus(fn)    // standalone: fires immediately, then on every change
room.open(code?) / room.close()           // standalone only; embedded no-ops
room.joinUrl()       // standalone: page URL + ?room=CODE · embedded: null
room.kick(pid)       // standalone only; embedded no-op (the shell kicks)
```

`Player` = `{pid, name, color, avatar, connected, manual}`.

Two standalone-only extras exist so a game can offer a full lobby without the
hub: `room.addManual(name)` and `room.lock(bool)`. They are no-ops when
embedded; ignore them if you don't want them.

### Player

```js
const me = await GSC.player({
  onMessage(m), onStatus(connected), onConnClose(),   // onConnClose optional
});
me.pid, me.name, me.color, me.avatar, me.code, me.gameId, me.connected
me.send(m)
me.leave()   // standalone: leaves the room · embedded: no-op (the shell owns it)
```

Standalone player: the SDK reads `?room=` and `?name=`. With no name it renders
a minimal join card into your page's **empty `<div id="gsc-join">`** (provide
one in player mode) and resolves once the host accepts. It remembers
`{code, pid, name, avatar}` in `localStorage["gsc-standalone-player-v1"]`, so a
refresh relinks to the same player.

Payloads are opaque to the SDK apart from the 32 KB cap — **validate your own
`m` in your pure core.** Anything larger is dropped, never forwarded.

### Notes game authors should know

- `onStatus(connected)` can fire `false` before the first `true` while the
  standalone transport is still connecting. Treat the first `true` as "live".
- There is **no rename message** on the bridge. A manual player renamed in the
  lobby reaches you as a fresh `lobby` snapshot only, so read `room.players()`
  when you render names rather than caching them from `onPlayerJoin`.
- Embedded `room.code` is whatever the shell has; it is `null` when the host
  chose "Play without phones".
- `GSC.host()` in a player mode (and vice versa) rejects with a clear error
  instead of hanging.

### Shell side (used by `index.html`, and by a game's own harness)

```js
const b = GSCBridge.attachHostFrame(iframe, {onReady, onSend(pid,m), onClose(pid),
                                             onExit, onScores, onTitle});
b.postInit({code, players}); b.postPlayerJoin(p); b.postPlayerLeave(pid);
b.postPlayerStatus(pid, connected); b.postMsg(pid, m); b.detach();

const p = GSCBridge.attachPlayerFrame(iframe, {onReady, onSend(m)});
p.postInit(me, room); p.postMsg(m); p.postStatus(connected); p.postConnClose(); p.detach();
```

Every inbound message is checked for `event.origin === location.origin`,
`event.source === iframe.contentWindow` and the `{gsc:1}` marker (L-U10).

### Virtual peer (for the Jeopardy adapter)

```js
const hub = VirtualPeer.install();          // reads GSC.mode; null when not embedded
// or, for tests:  VirtualPeer.install({mode:"embed-host", bus})
// bus = {mode, post(msg), listen(fn)}
```

`install()` sets `window.peerjs = {Peer}`. Call it **before** any Jeopardy
script runs. Host peers get one `connection` per already-connected player after
`init` (buffered if `init` arrives first) and one per `player-join`;
`conn.peer` is the pid, `conn.metadata = {name}`. Phone peers get `open` on the
next tick from `peer.connect(...)`; `conn-close` closes the connection; a shell
`status connected:false` raises exactly one synthetic `peer.on("error")` with
`{type:"network"}` and nothing else.

---

## 3. How to run the tests

```bash
node --test                       # from the repo root: T1 (shell + shared + Jeopardy)
python -m http.server 8620        # then open /tests/hub-harness.html (T2)
```

The harness needs no arguments: it clears `localStorage`, boots the real
`index.html` in iframes over a fake peer network, and writes PASS/FAIL into
`#results li[data-pass]` with `#summary.ok` when everything is green. It takes
about 12 seconds (two real 3-second reconnect waits).

**Port note:** three other agents had servers bound to `0.0.0.0:8620` on this
machine at the same time, and Windows happily round-robins between them, so
requests to `localhost:8620` landed on the wrong repo. Everything below was run
on `http://127.0.0.1:8626` instead (`python -m http.server 8626 --bind
127.0.0.1`). Nothing depends on the port.

---

## 4. Results

### T1 — `node --test` (repo root)

```
ℹ tests 230
ℹ pass 230
ℹ fail 0
```

| ID | Result | Evidence |
|---|---|---|
| L-U1 | PASS | `L-U1 room code: 4 chars, allowed alphabet only, deterministic under injected rng` — 500 codes, no I/L/O/0/1, same seed → same sequence. |
| L-U2 | PASS | Three tests: name control-stripping/trim/24-cap/junk→null, the 12-emoji avatar allow-list, and `payloadTooBig` at the 32 KB UTF-8 boundary (incl. cyclic → true). |
| L-U3 | PASS | Two tests: every documented v2 message accepted with exactly its fields; wrong `v`, unknown `t`, arrays, non-objects, oversized `m`, bad pid, bad avatar, 17-player lobby all → `null`. |
| L-U4 | PASS | Six tests: `p1…` ids, 12 unique colours then a palette cycle, case-insensitive `name-taken`, `bad-name`/`room-full`/`locked`, relink by pid and by disconnected name, manual adoption, locked-lobby rejoin. |
| L-U5 | PASS | Five tests: leave/status keep the player and flip `connected`; kick deletes + emits `kicked`/`close`/`player-leave`; manual add/rename/remove; `setGame` broadcasts; snapshot ordering; serialize/restore. |
| L-U6 | PASS | Eleven events replayed against a deep-frozen state with byte-identical JSON afterwards; 19 junk events return unchanged state and never throw. |
| L-U7 | PASS | Ten tests: collision → new code (and 5-retry ceiling → "free room code" error); open deadline retries once then errors "Couldn't reach the room server…"; library failure message; 21st message dropped and the flooder disconnected while 60 pings are all ponged; junk never reaches `onEvent`; `room-closed` then close after the 400 ms flush; kick; stale sweep; broker blip does not close the room. |
| L-U8 | PASS | Ten tests: three attempts with `Connecting… attempt N of 3` then the failure text + tips; wrong code = hard stop; the join envelope carries pid/avatar; drop → 3 s loop; 25 s silence → teardown + reconnect; host traffic keeps it alive; `reject` surfaces the reason and stops retrying; `room-closed` stops the loop; `leave`; the Instagram hint. |
| L-U9 | PASS | Ten tests, host and phone: `open`, one `connection` per existing player and per join (with `init` buffered), `conn.send` → bridge `send` with the pid, `conn.close` → bridge `close` (once), `player-leave` → close, phone `connect` → `open`, `conn-close` → `close`, `status:false` → exactly one `{type:"network"}`, `reconnect`/`destroy`. |
| L-U10 | PASS | Seven tests: wrong origin, wrong source window, missing/wrong `gsc` marker, non-objects and arrays are all ignored on both frame bridges; every outbound post carries the right shape and `location.origin`; `detach` unhooks; mode detection; `rejectText`. |

### T2 — `tests/hub-harness.html`

`16/16 passing`, `#summary.ok`. Screenshot taken in the in-app browser
(title "Hub harness: ALL PASS"); the run leaves no console errors.

| ID | Result | Evidence (harness detail text) |
|---|---|---|
| L-I1 | PASS | `code=4EQ9 · on screen "4EQ9"`; `roster=Alex,Bo colours=rgb(230,159,0) / rgb(86,180,233)`; duplicate: `text="That name is taken — add an initial."` |
| L-I2 | PASS | host frame `players=p1:Alex:true|p2:Bo:true`; `p1=p1:Alex:🦊 p2=p2:Bo:🦁` |
| L-I3 | PASS | `log entry=p1:{"probe":1}`; broadcast reached both; `send pid` → `p2 log grew from 1 to 1 with no solo entry` |
| L-I4 | PASS | both phones back to `waiting`; re-pick → `p1 me=p1:Alex:🦊` |
| L-I5 | PASS | `told=true frameGone=true (screen=join) roster=true · p1 sees Alex,Cy (was 3)` |
| L-I6 | PASS | `events=status:p1:false,status:p1:true pid=p1` with the colour unchanged |
| L-I7 | PASS | late joiner: `me=p3:Cy:🦉`, screen `play` |
| L-I8 | PASS | `locked=true refused="The host locked the lobby." cy-back=true` |
| L-I9 | PASS | after reload: `code=4EQ9 game=fake-game`, host frame re-inited |
| L-I10 | PASS | `banned=[] long=[] missing=[]` over all 20 shell files |

### T3 — real network (two tabs, real PeerJS broker + WebRTC)

Run on `http://127.0.0.1:8626/` with the real `shared/room-*.js` stack and a
**temporary** `fake-game` registry entry (since no `games/*/index.html` exists
yet). **The temporary entry has been removed** — `grep -c fake-game
js/hub-registry.js` → 0.

| ID | Result | Evidence |
|---|---|---|
| L-E1 | PASS | Host tab: `status {status:"open", code:"MENW", broker:"ok"}`. Phone tab `?room=MENW`, name "Robin": accepted in **1233 ms**, `me={pid:"p1",name:"Robin",color:"#e69f00",avatar:"🐙"}`; host roster row `🐙Robin🟢Kick`. |
| L-E2 | PASS | Host clicked the tile: shell bar `MENW · 1 🔔`, subtitle `Fixture round`, host frame `players=p1:Robin:true`. Phone within the 2.5 s poll: `screen:"play"`, `src=tests/fake-game.html?embed=player&room=MENW&pid=p1&name=Robin`, frame `me=p1:Robin:🐙`. |
| L-E3 | PASS | Phone tab reloaded → `screen:"play"`, `me={pid:"p1",name:"Robin"}`, game frame `p1:Robin:🐙` — no code re-entry. |
| L-E4 | PASS | Host tab reloaded → `status {status:"open", code:"MENW"}` (same code), `peers {818ac0b1-…-10b714285714: "p1"}` — a live PeerJS id rebound to p1 with no user action; host game frame logged `status:p1:false` then `status:p1:true`. |
| L-E5 | PASS | Host "Close room" → host `status:"closed"`, chip `— · 0 🔔`. Phone: `screen:"join"`, `join-error = "The host closed the room."`, game frame removed. |

Also smoke-tested (not a numbered state, but the game agents depend on it):
**standalone host + standalone player over real WebRTC.**
`tests/fake-game.html` alone → `mode:"standalone-host"`, `room.open()` →
`code:"C6VV"`, `joinUrl:"…/tests/fake-game.html?room=C6VV"`; second tab at that
URL → the SDK's `#gsc-join` card, name "Sam" → `me={pid:"p1",name:"Sam",
color:"#e69f00",avatar:"🦊"}`, join card auto-hidden; `room.broadcast()` →
phone log `host:{"from":"standalone-host"}` and the echo back →
host log `p1:{"echo":{…},"from":"p1"}`.

### T5 — static gates

| Gate | Result |
|---|---|
| V1 `node --test` exits 0 | PASS (230/230) |
| V2 every file < 800 lines | PASS (max 694, `js/hub-host.js`) |
| V3 no `innerHTML`/`insertAdjacentHTML`/`outerHTML =`/`document.write`/`eval(`/`new Function` | PASS — zero matches across `index.html`, `css/`, `js/`, `shared/`, `tests/` (including the harness, which builds the banned strings from fragments so it doesn't trip its own gate) |
| V4 no `console.log` | PASS (only `console.warn` diagnostics) |
| V5 nothing non-serialisable in `setState` | PASS — `setState` only ever receives `{roomCode, activeGame, night}`; the peer, connections, iframes, bridges and timers live in module scope. |
| V6 external URLs | PASS — the pinned cdnjs PeerJS 1.5.5 URL (with SRI) and Google Fonts, nothing else. (`https://evil.test` / `https://shell.test` in `tests/bridge.test.mjs` are string fixtures, never fetched.) |
| V7 game-page conventions | N/A for the shell; `tests/fake-game.html` follows them (`data-gsc-game`, `#gsc-join`, `player-mode` + `gsc-embedded`). |
| V8 `?game=URL` validation | N/A — the shell serves no content JSON. |

Functions over ~50 lines: five closure factories (`createRoomHost`,
`createRoomPlayer`, `standaloneHost`, `standalonePlayer`, `createHub`), each
carrying a justification comment. They are module bodies of small named
functions over private state — the same shape as Jeopardy's `BuzzerHost` IIFE.

---

## 5. Spec deviations and additions

1. **`shared/room-net.js`** is a verbatim copy of `buzzer-net.js` except: the
   UMD export is `RoomNet`; `brokerLabel()` says "room server" instead of
   "buzzer server" (the hub runs four games, not just buzzers); one
   `console.warn` prefix. **No constant, timing or behaviour differs.** The
   header records this.
2. **New envelope `{v:2, t:"conn-close", g}` (host → phone).** 00 §6 says a
   host game's bridge `close` must reach that phone's game iframe as
   `conn-close`, but 00 §5 defines no room-level carrier for it. This is that
   carrier; `validateEnvelope` accepts it and the phone shell forwards it only
   when `g` matches the active game. Only the virtual peer (Jeopardy) uses it.
3. **`RoomHost.onEvent` has a fourth type, `{type:"stale", peerId, stale}`**
   (spec §3.3 lists open/data/close). It carries the Jeopardy 30-second
   liveness sweep so the lobby can paint 🔴 without dropping anybody.
4. **`{v:2,t:"avatar",emoji}` is validated but not applied.** It was a SHOULD;
   the host logs a `console.warn` and ignores it. A phone changes its avatar by
   rejoining. The reducer has no `avatar` event yet.
5. **Rename emits no frame message.** The bridge protocol has no rename, so a
   renamed manual player reaches games as a fresh `lobby` snapshot only. Noted
   at the top of `shared/bridge.js` and in §2 above.
6. **`?store=` query param** on `index.html` suffixes the two `localStorage`
   keys. Production never passes it; the loopback harness uses it to give each
   fake phone its own slot inside one shared origin.
7. **`?harness=1`** makes both shells defer boot and expose `window.__gscBoot`,
   so the harness can install `window.__gscPeerFactory` before the real
   transport starts. Without the param nothing changes.
8. **`HubRegistry.register(entry)` and an optional `entry.page`.** Lets the
   harness (and a T3 smoke run) point a tile at a page outside `games/`. The
   four shipped entries are the literal list the spec gives, with the exact
   paths `games/jeopardy/`, `games/family-feud/`, `games/wheel-of-fortune/`,
   `games/weakest-link/`.
9. **Broadcasts skip peers that are no longer on the roster.** Found by L-I5: a
   kicked phone was receiving the `lobby` snapshot that followed its `kicked`
   message and bouncing straight back into the game frame. `broadcastLobby` now
   filters on `lobby.peers`, and the phone shell latches "dismissed" until it
   rejoins. Fixed in `js/hub-host.js`, `shared/bridge.js`, `js/hub-player.js`.

Everything else follows `docs/01-lobby-shell-spec.md` as written, including the
registry contents, the iframe URL shapes, the persistence keys
(`gsc-hub-state-v1`, `gsc-phone-v1`, `gsc-sound`) and the game-switch sequence
of §3.8.

---

## 6. Known gaps

- **Avatar changes after joining** (`t:"avatar"`, a SHOULD) are not applied —
  see deviation 4.
- **`room.reportScores` is embedded-only.** A standalone game has no shell to
  report to, so it is a no-op there. Tonight's scoreboard is a hub feature.
- **The night scoreboard keeps the latest report per game and sums them.** A
  game that reports mid-round and then never reports its final standings will
  leave the mid-round number in the total. Games should report on every
  scoreboard change (that is what the Jeopardy adapter is specified to do).
- **Missing-game detection is an 8-second `ready` timeout**, not an HTTP probe:
  a game page that loads but never calls `GSC.host()` looks identical to a 404.
  The shell bar says which page it could not load.
- **Kicking from inside a game** is only reachable through the shell-bar chip
  popover; there is no roster row on the game screen itself (by design — the
  spec forbids overlaying the game).
- **No automated T4.** Standalone mode was smoke-tested by hand (see §4) but has
  no scripted regression yet; it will be covered when the first real game lands.
- The four game folders are still empty, so the hub's tiles currently lead
  nowhere. That is expected at this point in the build.

---

## 7. For the orchestrator

- `shared/` is complete and stable — the four game agents can code against §2
  above with no further changes expected. The one thing to broadcast: **games
  must load all five `shared/*.js` scripts**, and `#gsc-join` must exist in
  player mode.
- The Jeopardy adapter can rely on `VirtualPeer.install()` plus the
  `conn-close` carrier (deviation 2), both exercised by L-U9.
- Nothing in `games/**` was touched. No commits were made.
