# 01 — Hub shell: lobby, room, phone controller, bridge

Status: **approved for implementation** · Component id: `shell`
Owns: `index.html`, `css/`, `js/`, `shared/`, `tests/` (root), root `README.md`.
Depends on: nothing. Everything else depends on this — **build `shared/` first**
(protocol → net → host → player → bridge/SDK → virtual-peer), then the hub UI.

## 1. Host experience

### 1.1 Landing (`index.html`, no query)

- Title "Game Show Central", one-line pitch ("Game shows for your video call —
  share your screen, players use their phones").
- **Host a game night** (gold, big) → opens a room (lazy-loads PeerJS) and
  shows the lobby. If a room code is in saved state, auto-reopen with the same
  code (Jeopardy's reload behaviour) so phones reconnect on their own.
- **Play without phones** (ghost) → lobby with the room closed; tiles still
  work; a hint says phones can be enabled any time with "Open room".
- **Join on your phone** link → `?room=` (join screen with blank code).

### 1.2 Lobby (host)

Layout (1280×720 projector-first):

- **Room card** (left): the code HUGE (`Anton`, ≥ 140 px), the join URL
  (`<site>/?room=CODE`), connected count, room status line
  (`connecting… / open / error text`), buttons: **Copy link**, 🔊 sound,
  **Lock lobby** (rejects new joins; existing reconnects still allowed),
  **Close room** / **Open room**. Errors are plain English (broker unreachable,
  no internet, code collision after retries → regenerate automatically as
  Jeopardy does).
- **Players** (left, under the code): roster rows with avatar emoji, colour
  swatch, name, 🟢/🔴, **Kick**. Host can also **+ Add player** manually
  (a player without a phone; `connected:false`, `manual:true`) so games get a
  full roster even in voice-only sessions. Manual players are renameable and
  removable.
- **Game tiles** (right): one tile per `GAME_REGISTRY` entry: icon, name,
  tagline, "phones: buzzers · wagers" capability chips, min/max players.
  Click → **Play**. A tile is never disabled by player count; a soft warning
  ("Family Feud plays best with 4+") is fine.
- (SHOULD) **Tonight's scoreboard**: running totals from `scores` reports,
  with "Reset night".

### 1.3 In a game (host)

- The **shell bar** (a slim 40 px strip across the top; never overlays the
  game): `⌂ Lobby` button, game name + optional subtitle from `title`,
  `CODE · n 🔔` chip (click → roster popover with kick/lock/close), broker
  health text when degraded (RoomNet `brokerLabel`).
- Below it, the game iframe fills the rest of the viewport
  (`width:100%; height:calc(100vh - 40px); border:0`).
- `⌂ Lobby` asks "Leave Family Feud? Its progress is saved in this browser."
  (confirm dialog, `role="dialog"`), then swaps back. The game's own
  `localStorage` state lets it resume later.
- Refresh mid-game: shell restores `{roomCode, activeGame}` and reopens both.

### 1.4 Registry (`js/hub-registry.js`)

```js
const GAME_REGISTRY = [
  { id:"jeopardy",        name:"Jeopardy",         path:"games/jeopardy/",         icon:"🟦", accent:"#060ce9",
    tagline:"The classic answer-and-question board.", phone:["buzzers","wagers","final answers"], players:[1,8] },
  { id:"family-feud",     name:"Family Feud",      path:"games/family-feud/",      icon:"🎤", accent:"#c8102e",
    tagline:"Survey says…", phone:["face-off buzzers","fast money"], players:[2,16], teams:true },
  { id:"wheel-of-fortune",name:"Wheel of Fortune", path:"games/wheel-of-fortune/", icon:"🎡", accent:"#7b2cbf",
    tagline:"Spin, call a letter, solve the puzzle.", phone:["spin","letters","solve","toss-up buzzers"], players:[1,6] },
  { id:"weakest-link",    name:"Weakest Link",     path:"games/weakest-link/",     icon:"🔗", accent:"#8a0303",
    tagline:"Bank it before the chain breaks.", phone:["secret votes"], players:[3,12] },
];
```

Iframe URLs: host `path + "index.html?embed=host&room=CODE"`, phone
`path + "index.html?embed=player&room=CODE&pid=P&name=N"` (name URL-encoded).
The `room`/`name`/`pid` params are informational for the game (Jeopardy's
player mode keys off `room`); the bridge `init` message is authoritative.
A tile whose page is missing (404) shows an error in the shell bar rather than
a blank frame (detect via the iframe never posting `ready` within 8 s).

## 2. Phone experience (`index.html?room=CODE`)

Body class `player-mode`; nothing of the host UI is rendered.

1. **Join**: code field (prefilled, uppercase, 4 chars), name (≤ 24), avatar
   picker (12 emoji; random default), **Join**. Errors inline: "No room with
   that code", "That name is taken — add an initial", "Room is full",
   "The host locked the lobby", "Can't reach the room server — check
   internet / try leaving in-app browsers" (RoomNet in-app hint), attempt
   counter text from RoomNet.
2. **Waiting room**: "You're in, {name}!" with avatar/colour, the roster (who
   else is here), "Waiting for the host to pick a game…", **Leave**.
   Stores `{code, pid, name, avatar}` in `localStorage` (`gsc-phone-v1`) so a
   refresh auto-rejoins as the same player.
3. **In a game**: the game iframe fills the screen (`100dvh`), no shell chrome
   except a 4-px top health line and a reconnect banner overlay when the
   transport drops ("Reconnecting…"; the retry loop is the Jeopardy one:
   3 attempts with the whole-phase deadline, then the 3-s loop).
   Iframe attributes: `allow="screen-wake-lock"`.
4. **Room closed** → "The host closed the room" → join screen. **Kicked** →
   "The host removed you from the room" → join screen.
5. Wake lock while connected (feature-detected), `navigator.vibrate(30)` on
   join accepted.

## 3. Shell internals

### 3.1 `shared/room-protocol.js` (PURE, UMD → `RoomProtocol`)

- `ROOM_ALPHABET`, `generateRoomCode(rng)`, `isRoomCode(s)`, `PEER_PREFIX="gsc-"`.
- `sanitizeName`, `sanitizeAvatar` (allow-list `AVATARS`), `NAME_MAX=24`,
  `MAX_PLAYERS_CAP=16`, `PAYLOAD_MAX_BYTES=32768`, `COLORS` (12 distinct,
  colour-blind-friendly hexes), `payloadTooBig(m)`.
- `validateEnvelope(obj) → msg|null` for every v2 message (both directions).
- `createLobbyState()` → `{players:{pid:Player}, order:[pid], locked:false,
  maxPlayers:12, activeGame:null, nextId:1, peers:{peerId:pid}}`.
- `lobbyReduce(state, event) → {state, effects}` — events: `join{peerId,name,
  avatar,pid?}`, `leave{peerId}`, `status{peerId,connected}`, `kick{pid}`,
  `addManual{name}`, `rename{pid,name}`, `remove{pid}`, `lock{locked}`,
  `setGame{gameId|null}`, `setMax{n}`; effects: `{send:{to:peerId,msg}}`,
  `{broadcastLobby:true}`, `{close:peerId}`, `{frame:{...}}` (a bridge message
  for the host game frame). Name uniqueness is case-insensitive; a rejoin
  with a known `pid` **or** the same name as a disconnected player relinks to
  that player (Jeopardy behaviour). A manual player whose name a phone joins
  with becomes that phone's player (`manual:false`).
- `lobbySnapshot(state)` → the `lobby` message payload.
- Reducers are immutable; never throw on junk events (return state unchanged).

### 3.2 `shared/room-net.js` — copy of Jeopardy `buzzer-net.js` with the export
renamed `RoomNet`. Keep the file header's attribution.

### 3.3 `shared/room-host.js` (`RoomHost`)

`createRoomHost({ onEvent, onStatus, peerFactory?, loadPeerJs?, now?, timers? })`
with `open(code?)`, `close()`, `send(peerId,msg)`, `broadcast(msg, filter?)`,
`kick(peerId)`, `code()`, `status()`. Behaviour = Jeopardy `buzzer-host.js`
room lifecycle: lazy load, `gsc-<CODE>` id, collision retry (regenerate up
to 5×), whole-phase open deadline with one auto-retry (RoomNet §9.7), rate
limit, heartbeat sweep, broker controller, `room-closed` on close with the
400 ms flush. `onEvent` receives `{type:"open"|"data"|"close", peerId, msg?}`
after envelope validation. All effects injectable for the loopback harness.

### 3.4 `shared/room-player.js` (`RoomPlayer`)

`createRoomPlayer({ onMessage, onStatus, onRejected, peerFactory?, loadPeerJs?,
now?, timers? })` with `connect(code, name, pid?, avatar?)`, `send(m)`,
`leave()`. Behaviour = Jeopardy `buzzer-player.js` connection logic: whole-
phase join deadline, 3 attempts, 3-s reconnect loop, heartbeat + visibility
probe, wake lock, in-app-browser hint, failure guidance after repeated failures.

### 3.5 `shared/bridge.js` (`GSC` + `GSCBridge`)

- Iframe side (`GSC`): mode detection, `host()`, `player()` per 00 §7.
- Shell side (`GSCBridge.attachHostFrame(iframe, api)` /
  `attachPlayerFrame(iframe, api)`): listens for the iframe's messages,
  validates `{gsc:1}` + origin + source, exposes `postInit`, `postMsg`, etc.
- Standalone mode inside `GSC.host()`/`GSC.player()` uses `RoomHost`/`RoomPlayer`
  with the same v2 envelope (`g` = the page's own game id from
  `document.body.dataset.gscGame`). Standalone reuses `lobbyReduce` for the
  roster so join/reject/relink rules are identical to the hub.

### 3.6 `shared/virtual-peer.js` — per 00 §8. Tested in Node with a fake
`postMessage` pair (see 06 §2).

### 3.7 Persistence

Host: `localStorage["gsc-hub-state-v1"]` = `{roomCode, activeGame, locked,
maxPlayers, lobby (players + order + nextId, without peers), night}`. Phone:
`gsc-phone-v1`. Never store connections. Sound: `gsc-sound`.

### 3.8 Game switch sequence (host clicks a tile)

1. `setState({activeGame:id})`; shell bar shows the game; iframe `src` set.
2. On the iframe's `ready` → post `init` with the full roster.
3. Broadcast `lobby` (with `game:id`) to phones → each phone shell swaps its
   iframe; on that iframe's `ready` → `init` with `me`.
4. Phone→host `game` messages for a `g` ≠ active game are dropped (warn).
5. Host `exit` from the game (or `⌂ Lobby`) → `setState({activeGame:null})`,
   iframe removed, `lobby` broadcast with `game:null` → waiting room.

Late joiner during a game: the shell accepts them, broadcasts the roster,
posts `player-join` to the host iframe, and the phone goes straight to the
game iframe. Games decide what a late joiner can do (usually: watch).

## 4. Root README

Rewrite `README.md` for the hub: what it is, deploy to GitHub Pages (same
steps as Jeopardy's README), how a game night works (host / players), the
lobby, phones, standalone game URLs (`games/<id>/`), customising each game
(link to each game's README), project layout, troubleshooting (WebRTC blocked,
in-app browsers, storage full). Keep Jeopardy's tone.

## 5. Success states (see 06 for tiers and the report format)

Unit (T1, `node --test` at root):

- **L-U1** `generateRoomCode` 4 chars, alphabet only, deterministic under injected rng.
- **L-U2** `sanitizeName`/`sanitizeAvatar` strip controls, trim, cap, allow-list; junk → null.
- **L-U3** `validateEnvelope` accepts every documented message with exact fields, rejects wrong `v`, unknown `t`, oversized payloads (> 32 KB serialised), non-object, arrays.
- **L-U4** `lobbyReduce` join: assigns `p1…`, unique colours until 12 then cycles, rejects duplicate names case-insensitively, `room-full` at max, `locked` when locked, relinks by `pid` and by disconnected name, adopts a manual player of the same name.
- **L-U5** `lobbyReduce` leave/status flips `connected`, never deletes the player; kick deletes and emits `close` + `kicked`; manual add/rename/remove; `setGame` emits `broadcastLobby`.
- **L-U6** Reducers never mutate inputs (deep-frozen fixtures) and never throw on junk events.
- **L-U7** `RoomHost` with fake peer factory + fake timers: collision regenerates code; open deadline retries once then errors with a message; rate limit drops the 21st message in a second but not pings; close sends `room-closed` and closes after the flush.
- **L-U8** `RoomPlayer` with fakes: 3 attempts with deadline → failure message; reconnect loop every 3 s after a drop; heartbeat stale → teardown + reconnect; `reject` surfaces the reason.
- **L-U9** VirtualPeer host: `open` fires; one `connection` per existing player and per join; `conn.send` → bridge `send` with the pid; `conn.close` → bridge `close`. Phone: `connect` → `open`; `send` → bridge; `conn-close` → `close`; `status:false` → `error {type:"network"}`.
- **L-U10** Bridge shell side ignores messages from a wrong origin or a wrong source window, and non-`gsc:1` objects.

Loopback (T2, `tests/hub-harness.html` over a local server, fake transport
pair in-page, real hub scripts, real iframes pointing at `tests/fake-game.html`):

- **L-I1** Host opens a room; two fake phones join; roster shows both with distinct colours; a third with a duplicate name is rejected with the right text.
- **L-I2** Host picks the fake game → host iframe gets `init` with 2 players; both phone frames get `init` with their own `me`.
- **L-I3** Phone frame `send` reaches the host frame as `msg` with the right pid; host `send pid:"*"` reaches both; `send pid` reaches one.
- **L-I4** Host `exit` → phones back to waiting room; picking again re-inits with the same pids.
- **L-I5** Kick → that phone sees "removed" text and its frame is gone; roster updates on the other phone.
- **L-I6** Phone drop + rejoin with the stored pid relinks (same pid/colour); host iframe gets `player-status` false then true.
- **L-I7** Late joiner mid-game lands directly in the game frame with `init`.
- **L-I8** Lock lobby → new join rejected `locked`; existing rejoin still works.
- **L-I9** Host refresh mid-game restores room code + active game and re-inits the host frame.
- **L-I10** No `innerHTML` in any shell file (grep gate); all shell files < 800 lines.

Real network (T3, two browser tabs on the local server, real PeerJS):

- **L-E1** Host tab opens room; phone tab joins with the code; roster updates within 5 s.
- **L-E2** Host picks a game (Family Feud, or `tests/fake-game.html` via a temporary registry entry if games are not merged yet); phone tab swaps to the game frame within 3 s.
- **L-E3** Phone tab reload → back in the same game as the same player.
- **L-E4** Host tab reload → room reopens with the same code; phone reconnects without user action.
- **L-E5** Close room → phone shows "The host closed the room".
