# 00 — Architecture: the hub, rooms, and how games plug in

Status: **approved** · Owner: orchestrator · Applies to every component.

## 1. What we are building

A Jackbox-style **game-show hub** for voice chats (Google Meet, Teams, Discord).
The host opens one page, screen-shares it, and gets a 4-letter **room code**.
Players open the same site on their phones, enter the code and a name **once**,
and stay connected while the host picks games from a **lobby**: Jeopardy,
Family Feud, Wheel of Fortune, Weakest Link (more later — see `07-future-games.md`).

Everything that makes the existing Jeopardy special is a requirement here:

| Jeopardy trait | Hub requirement |
|---|---|
| JSON content files + in-page editor + Download/Use | every game |
| Web rooms via PeerJS, no server, no accounts | one shared room owned by the hub |
| Faithful adaptation of the TV format | every game (rules sections are normative) |
| Customisable (settings in JSON, editor, `?game=URL`, upload) | every game |
| Works offline / from disk, phones optional | every game |
| Pure testable core + node:test + browser harness + spec'd success states | every component |

## 2. Hosting constraints (locked)

- GitHub Pages static hosting. **No server, no build, no npm runtime deps.**
- PeerJS `1.5.5` from cdnjs with SRI is the only runtime CDN script:
  `https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js`
  `sha512-XEKeWX+mI3Ov+tg2evDlVQFzVOIp4T8J3cNcCEPaEUGpxJV3eZaN8rHuvnFPvQpGJBHPmrozJDMpm2xcDvtmyQ==`
  Loaded lazily, only when a room is opened or a phone joins.
- ICE config, heartbeat timings, join deadlines, press-latch and broker
  reconnect logic are **copied verbatim** from `games/jeopardy/js/buzzer-net.js`
  into `shared/room-net.js` (rename the export to `RoomNet`). Do not re-derive
  them; they are field-tested.

## 3. Topology

```
HOST (laptop, screen-shared)                 PHONES
+-------------------------------+            +--------------------------+
| index.html  (hub shell)       |  PeerJS    | index.html?room=CODE     |
|  - owns THE PeerJS peer       |<--WebRTC-->|  - owns THE connection   |
|  - lobby UI, roster, code     |            |  - join screen, roster   |
|  - shell bar (code / n / ⌂)   |            |  - "waiting" screen      |
|  +-------------------------+  |            |  +--------------------+  |
|  | <iframe> games/<id>/    |  | postMessage|  | <iframe> games/<id>|  |
|  | index.html?embed=host   |<-+--bridge----+->| ?embed=player&...  |  |
|  +-------------------------+  |            |  +--------------------+  |
+-------------------------------+            +--------------------------+
```

- **The shell owns the transport.** One `Peer` on the host (id `gsc-<CODE>`),
  one `DataConnection` per phone. Games never touch PeerJS when embedded.
- **Games are same-origin iframes.** Host game UI and phone game UI are the
  *same page* (`games/<id>/index.html`) branching on the `embed` query param —
  the Jeopardy pattern (one page, `?room=` = player mode).
- **The bridge** (`shared/bridge.js`) relays messages between a game iframe
  and the shell with `postMessage`. The shell wraps game messages in the room
  envelope and routes them to the right phone; phones unwrap and forward to
  their game iframe.
- **Switching games** = the shell swaps the iframe `src` on the host and tells
  every phone to swap theirs. Connections persist; nobody rejoins.
- **Standalone mode.** Every game page also works opened directly (no shell):
  the SDK then opens its own room using the *same* transport code
  (`shared/room-host.js` / `shared/room-player.js`). Jeopardy standalone keeps
  its original buzzer stack untouched.

## 4. Repository layout

```
index.html                  hub shell (lobby + phone controller)
css/hub.css                 shell styles
js/hub-registry.js          GAME_REGISTRY constant (tiles, paths, capabilities)
js/hub-host.js              host shell: room lifecycle, lobby UI, iframe host bridge
js/hub-player.js            phone shell: join, roster/waiting screen, iframe player bridge
js/hub-night.js             (SHOULD) game-night running scoreboard
shared/room-protocol.js     PURE: envelope validation, room-code, roster reducer (UMD)
shared/room-net.js          PURE+config: ICE, timings, liveness, broker controller (from Jeopardy)
shared/room-host.js         host transport: PeerJS peer, connections, heartbeat, rate limit, routing
shared/room-player.js       player transport: connect, join, reconnect loop, heartbeat
shared/bridge.js            postMessage bridge (shell side + iframe side) and the GSC SDK
shared/virtual-peer.js      PeerJS-API-compatible shim over the bridge (used by Jeopardy)
shared/theme.css            shared tokens + .btn + .hidden + .visually-hidden
games/jeopardy/             vendored Jeopardy + games/jeopardy/js/gsc-embed.js adapter
games/family-feud/          see 03
games/wheel-of-fortune/     see 04
games/weakest-link/         see 05
tests/*.test.mjs            shell/shared unit tests (node --test from root)
tests/*.html                browser harnesses
docs/                       specs + reports
```

Path rule: game pages reference shared code with relative paths
(`../../shared/...`) so the site works under any GitHub Pages base path.

## 5. Room envelope protocol (v2) — phone ⇄ host shell over PeerJS

JSON over PeerJS data connections (`serialization: "json"`). Every message
carries `v: 2`. Receivers ignore unknown `t` and never throw on junk
(`RoomProtocol.validateEnvelope` returns null for anything malformed).

Phone → host:

| Message | Notes |
|---|---|
| `{v:2,t:"join",name,avatar?,pid?}` | once per connection open. `pid` = previously assigned id (phone stored it) so a refresh re-links to the same player. |
| `{v:2,t:"ping"}` | heartbeat every 10 s (RoomNet timings); exempt from rate limit. |
| `{v:2,t:"game",g,m}` | game payload `m` for game id `g`; shell forwards to host game iframe if `g` is the active game, else drops. |
| `{v:2,t:"avatar",emoji}` | (SHOULD) change avatar; validated against the allowed emoji list. |

Host → phone:

| Message | Notes |
|---|---|
| `{v:2,t:"joined",pid,name,color,avatar}` | accepted; the name may be the canonical relinked name. |
| `{v:2,t:"reject",reason}` | `name-taken` / `room-full` / `bad-name` / `locked` (host locked the lobby); host then closes the connection. |
| `{v:2,t:"pong"}` | heartbeat reply. |
| `{v:2,t:"lobby",game,players}` | full lobby snapshot: `game` = active game id or null; `players` = `[{pid,name,color,avatar,connected}]`. Sent on join, on any roster change, on game switch. |
| `{v:2,t:"game",g,m}` | game payload for the phone's game iframe. |
| `{v:2,t:"room-closed"}` | host closed the room. |
| `{v:2,t:"kicked"}` | host removed this player; then the connection closes. |

Caps: `name` ≤ 24 chars after sanitising (control chars stripped, trimmed;
structural cap 240); `m` serialised ≤ 32 KB (host drops larger; never
forwards); 20 messages/s per phone (Jeopardy's `MAX_MSGS_PER_SEC`), pings exempt.
Room codes: 4 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, peer id `gsc-<CODE>`.
Max players: 16 (lobby setting, default 12).

## 6. Bridge protocol — shell ⇄ game iframe (postMessage, same origin)

Every message is `{gsc:1, t, ...}`. The receiver checks `event.origin ===
location.origin` and, on the shell side, `event.source === iframe.contentWindow`.

Shell → host game iframe:

| Message | Meaning |
|---|---|
| `{t:"init",mode:"embed-host",room:{code,players:[Player]}}` | sent after the iframe posts `ready`. |
| `{t:"player-join",player}` / `{t:"player-leave",pid}` / `{t:"player-status",pid,connected}` | roster events. |
| `{t:"msg",pid,m}` | game payload from phone `pid`. |

Host game iframe → shell:

| Message | Meaning |
|---|---|
| `{t:"ready"}` | iframe scripts loaded; shell replies `init`. |
| `{t:"send",pid,m}` | send to one phone (`pid:"*"` = broadcast to connected). |
| `{t:"close",pid}` | (virtual-peer only) game closed that connection; shell forwards `conn-close` to that phone's iframe. |
| `{t:"exit"}` | back to lobby. |
| `{t:"scores",scores:[{pid,name,score}]}` | (SHOULD) report standings for the night scoreboard. |
| `{t:"title",text}` | (SHOULD) shell bar subtitle, e.g. "Round 2". |

Shell → phone game iframe:

| Message | Meaning |
|---|---|
| `{t:"init",mode:"embed-player",me:{pid,name,color,avatar},room:{code}}` | after `ready`. |
| `{t:"msg",m}` | game payload from the host. |
| `{t:"status",connected}` | transport up/down (phone shows its own reconnect banner; the shell also shows one). |
| `{t:"conn-close"}` | host game closed this player's virtual connection. |

Phone game iframe → shell: `{t:"ready"}`, `{t:"send",m}`.

`Player` = `{pid, name, color, avatar, connected, manual}`. `pid` is a short
opaque string (`p1`, `p2`, … assigned by the host shell, stable for the
room's life). `manual:true` = a player the host added by hand (no phone).

## 7. The GSC SDK (`shared/bridge.js` → `window.GSC`)

What new games code against. One API, four modes, detected at load:

```js
GSC.mode  // "embed-host" | "embed-player" | "standalone-host" | "standalone-player"
          // from ?embed=host|player, else ?room= present → standalone-player, else standalone-host
GSC.params // parsed URL params (room, name, pid, game…)

// Host side
const room = await GSC.host({
  onPlayerJoin(player), onPlayerLeave(pid), onPlayerStatus(pid, connected),
  onMessage(pid, m),          // game payload — validate it yourself
});
room.code                      // "ABCD" (standalone: null until open)
room.players()                 // [Player] snapshot (immutable copies)
room.send(pid, m); room.broadcast(m);
room.exit();                   // embedded: back to lobby; standalone: close room + reload to setup
room.reportScores([{pid,name,score}]); room.setTitle("Round 2");
room.status()                  // {open, connecting, error, code}
room.onStatus(fn)              // standalone room lifecycle (opening/open/error/closed)
room.open(); room.close()      // standalone only (embedded: no-ops)
room.joinUrl()                 // standalone: page URL without query + ?room=CODE
room.kick(pid)                 // standalone only (embedded: no-op; the shell kicks)

// Player side
const me = await GSC.player({ onMessage(m), onStatus(connected) });
me.pid, me.name, me.color, me.avatar, me.send(m), me.leave()
```

- Embedded: `GSC.host/player` post `ready`, resolve on `init`.
- Standalone host: `GSC.host` resolves immediately with a closed room; the
  game shows its own "Open room (phones)" button and calls `room.open()`; the
  SDK drives `shared/room-host.js` and updates `room.code` / `onStatus`.
- Standalone player: the SDK reads `?room=` and `?name=`; if no name, the SDK
  renders a minimal join card (code + name) inside the page's `#gsc-join`
  container (games provide that empty `<div>` in player mode), then resolves.
- Messages are opaque to the SDK beyond the 32 KB cap; **games validate their
  own payloads** in their pure core.
- The SDK never touches `innerHTML`.

## 8. The virtual peer (`shared/virtual-peer.js`) — for Jeopardy

Jeopardy's buzzer stack checks `window.peerjs && window.peerjs.Peer` before
loading the CDN. In embedded mode the adapter installs
`window.peerjs = { Peer: VirtualPeer }` **before** any Jeopardy script runs.
`VirtualPeer` implements the subset of the PeerJS API Jeopardy uses:

- `new Peer(id?, opts?)` → emits `open` (id) on the next tick; `peer.id`,
  `peer.open`, `peer.disconnected=false`, `peer.destroyed`, `on(ev, fn)`,
  `off`, `reconnect()` (no-op that re-emits `open`), `destroy()`,
  `connect(remoteId, opts)` → VirtualConnection.
- Host: `peer.on("connection", conn)` fires once per already-connected player
  after `init` and again per `player-join`. `conn.peer` = pid, `conn.metadata
  = {name}`, `conn.open=true`, `on("data"|"open"|"close"|"error")`, `send(m)`
  → bridge `send`, `close()` → bridge `close`.
- Phone: `peer.connect(...)` → connection emits `open` on next tick;
  `send(m)` → bridge `send`; `conn-close` → emits `close`.
- Errors (`peer.on("error")`) are never emitted in embedded mode except a
  synthetic `{type:"network"}` when the shell reports `status connected:false`
  — Jeopardy's player then shows its own "Reconnecting…" and its reconnect
  loop resolves instantly once `status connected:true` arrives.

## 9. Shared conventions every game implements

1. `games/<id>/index.html` — host screens + phone screens in one page.
   Phone mode when `GSC.mode` ends in `-player`. Body gets class `player-mode`
   (hide all host chrome) and, when embedded, `gsc-embedded` (hide standalone
   room controls, "Leave room", own topbar code chip).
2. `js/<id>-core.js` — pure reducer + validators + selectors (UMD, tested).
3. `js/<id>-app.js` — host glue: state, persistence (`localStorage` key
   `gsc-<id>-state-v1`), render, buttons.
4. `js/<id>-editor.js` — the content editor (Download JSON / Use in game /
   Reset / Start blank / auto-save draft).
5. `js/<id>-phone.js` — phone glue on top of `GSC.player`.
6. `js/<id>-room.js` — host glue on top of `GSC.host` (roster → game players,
   payload validation → reducer events, outbound phone screens).
7. `js/data.js` — offline fallback content (mirror of the JSON file).
8. `<content>.json` — the default content GitHub Pages serves.
9. `css/<id>.css` (+ more files if needed, each < 800 lines).
10. `tests/<id>-core.test.mjs` + `tests/harness.html` (loopback with a fake
    `GSC` — see 06-verification-plan.md §3).
11. `README.md` — how to host, JSON schema table, phone features, layout.

Phone screens are **thin**: they render what the host tells them and send
intents. The host never trusts phone state.

## 10. Design language

- `shared/theme.css` defines tokens (`--ink`, `--ink-dim`, `--gold`, `--red`,
  `--green`, radii, fonts) and `.btn`, `.btn-gold`, `.btn-ghost`, `.btn-big`,
  `.btn-small`, `.hidden`, `.visually-hidden`, `.error-msg`. Games override
  `--stage-*` colours for their own palette (defined in each spec).
- Host screens are designed for a **shared screen at 1280×720 and up**: huge
  type, high contrast, animations that read at a glance, `prefers-reduced-motion`
  honoured. Phone screens: 320–430 px portrait, thumb-sized targets (≥ 56 px).
- Sounds are WebAudio-synthesised (no audio files), behind a 🔊 toggle that
  persists in `localStorage` (`gsc-sound`), default on, never autoplay before
  a user gesture.
