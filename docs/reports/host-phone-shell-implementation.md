# Host phone — shell implementation (docs/22 §3–§4)

Shell side only: protocol, hub host, hub phone, SDK, docs and tests. No game
changed. With no host-role entry every pre-existing unit test and every browser
harness passes **unmodified** (see §6).

---

## 1. The SDK as built — what the fifteen game agents code against

Everything below lives in `shared/bridge.js` (`window.GSC`). The four host-side
additions and the two player-side additions exist on **every** room / `me`
object, including standalone mode, so no game ever feature-detects.

### Host side

```js
const room = await GSC.host({
  onPlayerJoin, onPlayerLeave, onPlayerStatus, onMessage,   // unchanged; NEVER fire for a host phone
  onHostPhones(list) { /* [{pid,name,connected}] — the set or a connection changed */ },
});

room.players()        // contestants only — a host phone is never in it (the hub filters)
room.hostPhones()     // [{pid, name, connected}] (copies). Standalone: []
room.answersPrivate() // true while ANY host-phone entry exists, connected or not. Standalone: false
room.setHostView(view)// hand the hub the current private view. Standalone: no-op
```

**`setHostView(view)` contract**

- Call it on **every state change** with `{ t: "host", item, seq, ...hostView(state) }`
  (docs/22 §5.2). The SDK skips a view identical to the last one it sent; the hub
  de-duplicates again, **holds the latest view for the mounted frame**, delivers
  it to every connected host phone, and re-delivers it whenever a host phone
  connects, reconnects or relinks with its key. Games keep **no cache and no
  resend logic** and never use `room.send` for host data.
- Size rule: if the view is not JSON-serialisable or its JSON is **over 16 KB**
  (16 384 bytes, UTF-8), the SDK logs `console.warn` and sends
  `{ t: "host", item, tooBig: true }` instead (`item` is kept when it is a
  string, capped at 120 chars). Selectors should truncate lists rather than hit
  this (docs/22 §5.1).
- A fresh `init` (the hub remounted or re-inited the frame) resets the SDK's
  de-duplication, so the next call is always delivered.
- The hub clears the held view when the game frame unmounts; a new game starts
  with no view until it calls `setHostView`.

**`answersPrivate()`** is a property of the roster, not of the connection: a host
phone that locks its screen or drops Wi-Fi stays assigned, so the value stays
`true` (docs/22 F1). Re-read it on `onHostPhones`. It becomes `false` only when
the last host-phone entry is kicked or (in the lobby) made a player again.

**`onHostPhones(list)`** fires on every `host-phones` message from the hub: a host
phone joined/relinked, went stale, came back, left or was kicked. Use it only to
re-render "Answer is on your host phone" / "Host phone disconnected" (docs/22 §5.4).
It does not fire for the initial `init`; read `room.hostPhones()` after
`GSC.host()` resolves.

### Player side

```js
const me = await GSC.player({
  onMessage(m),      // unchanged; NEVER receives a host view
  onStatus(connected),
  onHostView(view),  // fires only on a host phone (me.role === "host")
});
me.role              // "host" | "player" (standalone: always "player")
```

- `me.role` comes from `init.me.role` (absent → `"player"`). The frame URL also
  carries `&role=host` and no `name=` on a host phone — a **layout hint only**;
  branch on `me.role` once `GSC.player()` resolves.
- `onHostView` receives the held view after every `ready`/`init` (so a remounted
  or reloaded host-phone frame gets the current view again) and on every change.
- A host phone must **send nothing** (docs/22 §5.7): the hub drops every game
  payload from a host phone anyway.
- Transport loss still arrives as `onStatus(false)`; dim the host card and show
  "Reconnecting — this may be out of date" (docs/22 §5.7).

### Shell-side bridge (for reference)

`GSCBridge.attachHostFrame(iframe, { …, onHostView(m) })` gains `postHostPhones(list)`;
`GSCBridge.attachPlayerFrame` gains `postHostView(m)`; `GSCBridge.hostViewPayload(view)`
and `GSCBridge.HOST_VIEW_MAX_BYTES` (16384) are exported for tests.

---

## 2. Protocol (`shared/room-protocol.js`)

| Item | As built |
| --- | --- |
| Lobby entry | gains `role` (`"player"`/`"host"`) and `hostKey` (string or null). Entries from before the feature (no `role`) are players (`isHost(p)`). |
| `join` | optional `hk`; valid keys are 8–64 chars of `[A-Za-z0-9_-]` (`isHostKey`). A malformed `hk` is **dropped**, the join still validates. |
| `role` envelope (new, host→one phone) | `{v:2,t:"role",role:"host",hk}` on grant, `{v:2,t:"role",role:"player"}` on revoke. A grant without a valid key is junk. |
| `game` envelope | keeps `h:1` (exactly the number 1) — the host-view marker. |
| `lobbySnapshot` / `validateLobbyPlayer` | a row carries `role:"host"` **only** for a host phone; for players the field is absent, so a no-host room's wire shape is byte-for-byte unchanged (this is what lets every existing test pass unmodified). Any other role value, and any manual row, validates as a player. The key is **never** in a snapshot. |
| `playerList` / `playerCopy` | contestants only; never a `role` field. |
| `hostPhoneList(state)` (new) | `[{pid,name,connected}]` in join order. |
| `setRole{pid,role,key}` (new event) | refused when a game is active, for an unknown, prototype-shaped or manual pid, for a junk role, for a grant without a valid key, for a third host (`MAX_HOST_PHONES = 2`), **and for a phone that is not connected right now** (see §5). Grant stores the key; revoke clears it. Effects: `send` the `role` envelope to that phone, then `broadcastLobby`. |
| Relink onto a host entry | role kept only if `event.hk === hostKey`; otherwise demoted to player, key cleared, effects `{notice:"host-demoted",pid}`, `{frame:{t:"host-phones"}}` and `{frame:{t:"player-join",player}}` (the game never knew that pid, so it arrives as a new contestant). Works for relink by pid, by name, and stale-then-takeover. A locked lobby still relinks a host phone. |
| Roster events for a host pid | `join` (relink with key) / `leave` / `status` / `kick` emit `{frame:{t:"host-phones"}}` and never `player-*`. Kick is allowed at any time. |
| `serializeLobby` / `restoreLobby` | keep `role` and `hostKey` for host entries (the hub save); restore refuses keyless, manual, junk-role and third host entries. |
| `joined` | unchanged. The phone learns its role from its own lobby row. |

`shared/room-player.js`: `connect(code, name, pid, avatar, hk)` sends `hk` in
`join` only when it has one, and updates its key from every `role` envelope, so a
reconnect presents the current key.

---

## 3. Hub host (`js/hub-host.js`, `js/hub-hostphone.js`, `js/hub-ui.js`, CSS)

- **Roster row**: a "Host phone" tag and a hairline **Make host phone / Make player**
  button (`phone` icon, 44 px) before Kick. Disabled in-game (title "Go to the
  lobby to change roles"), when two host phones exist, and for a phone that is
  not connected. The key is generated hub-side (`HubHostPhone.newKey()`,
  `crypto.getRandomValues`, 24 URL-safe chars) and passed into `setRole`.
- **Counts**: roster reads "N players + H host phone(s) · total/max"; tiles'
  "plays best with" hints and the shell bar's "N connected" count contestants.
- **Game frame**: `init.room = {code, players, hostPhones, answersPrivate}` with
  contestants only; `host-phones` effects become `{t:"host-phones",list}` posts.
- **Host view**: `{t:"host-view",m}` from the frame is held in a de-duplicating
  `HubHostPhone.createViewHolder()`, sent to every bound host phone as
  `{v:2,t:"game",g,m,h:1}`, re-sent on every `host-phones` effect (connect,
  reconnect, keyed relink, status flip), cleared in `unmountFrame`.
- **Isolation**: a game `send` to a host pid is dropped; a broadcast filters out
  host-phone peers; `close` for a host pid is ignored; a `game` payload **from**
  a host pid is dropped (not queued).
- **Notice**: a demotion shows "‹name› rejoined from another device — host phone
  role removed." in the lobby roster hint and, in-game, in the shell bar's
  status line (30 s).
- **Shell bar**: "Host phone ●" / "Host phone ○" (away, amber) beside the room chip.
- `js/hub-ui.js` (new) holds the dialog and beep, moved out of `hub-host.js`
  unchanged to keep it under 800 lines; `js/hub-hostphone.js` (new, UMD) holds the
  key generator and the view holder. `index.html` loads both before `hub-host.js`.

## 4. Hub phone (`js/hub-player.js`, `js/hub-registry.js`)

- Role read from the phone's own `lobby` row each snapshot; a change while a frame
  is mounted remounts the frame.
- Stores `{code,pid,name,avatar,hk}`; sends `hk` on every join for that pid; a
  `role` envelope sets or clears the stored key.
- `HubRegistry.playerUrl(game, code, pid, name, role)`: `role === "host"` →
  `&role=host` and **no** `name=`.
- `h:1` payloads are forwarded as bridge `host-view` only when the own row says
  `host` (otherwise dropped), held as the latest view, and re-posted after every
  frame `ready`. `init.me.role` is `"host"` on a host phone (absent otherwise).
- UI: amber **Host** tag + amber-tinted waiting room reading "You're the host's
  second screen. Answers for each game appear here — keep this phone to
  yourself."; in a game, an amber strip "Host phone · keep this screen to
  yourself" above the frame (colour plus the word).

## 5. Decisions beyond the spec text

1. **No grant to an absent phone.** The spec says the key is sent "to that phone
   only". A grant to a disconnected or stale entry would hand the key to nobody,
   and the real phone would be demoted the moment it came back (found by the
   harness after the hub reload in L-I9). `setRole` therefore refuses a grant
   unless the entry is connected with a bound peer, and the button is disabled
   with "This phone is not connected right now". Revoking is always allowed.
2. **`role` travels only when it is `"host"`.** "Snapshot carries role" is met for
   host rows; omitting it for players keeps every no-host message identical, which
   is what the regression gate requires (an existing test deep-equals a validated
   lobby row).
3. **Demotion re-introduces the pid to the game** with `player-join` (the game was
   never told about a host phone, so a `player-status` would reference an unknown pid).

## 6. Verification

| Check | Result |
| --- | --- |
| `node --test` at the root (hub, shared and all fifteen games) | **1452 / 1452 pass**, 0 fail |
| New unit tests | `tests/host-phone.test.mjs` 21 · `tests/host-phone-sdk-host.test.mjs` 5 · `tests/host-phone-sdk-player.test.mjs` 3 — all pass |
| Pre-existing hub/shared unit tests | unmodified, all pass |
| `tests/hub-harness.html` (port 8671, Node static server) | **26 / 26** — the original 16 unmodified + 10 new HP-I checks |
| Every game browser harness (19 pages, headless, port 8671) | all pass with the same counts as before the change (Jeopardy 70, embed 21, photo 26, Feud 84, Wheel 95, WL 75, Millionaire 79, TPIR 80, Pyramid 97, DOND 83, Password 75 + 54, CR 81, Chase 64, 1v100 68, PYL 21, Match 64, Krillion 65) |
| Real two-phone run (real PeerJS broker, `.scratch/hp-shell-real.html`) | **7 / 7**: room opens; two phones join; Ana made host phone reads the role and the waiting text; the game sees `players=[Ben]`, `hostPhones=[Ana]`, `answersPrivate=true`, Ana `me.role=host`; the host view reaches Ana only; Ana's send is dropped and broadcasts skip her; after a real page reload Ana is still the host phone and gets the held view again |
| Static gates | no banned DOM sinks in any changed or new file; largest shell file `js/hub-host.js` 784 lines |

**Unit tests (§4.1):** grant/revoke; refusals (in-game, manual, unknown,
prototype-shaped, keyless, malformed key, junk role, third host, disconnected,
stale); key match keeps the role; relink by pid without key, with a wrong key, by
name, and stale-then-takeover all demote; locked lobby still relinks with the key;
the key never appears in a snapshot; no-host snapshot/playerList/serialize shapes
unchanged; `playerList` excludes host phones and carries no role; host-pid
`status`/`leave`/rejoin/`kick` (also in-game) emit only `host-phones`; `hk`, `role`
and `h:1` envelope validation; junk roles and manual rows; persistence and restore
refusals; `newKey` and the view holder; **virtual-peer holds no connection for a
host pid** across init, status, leave, keyed rejoin, kick and a host view (HP-U10);
standalone room objects expose the no-ops.

**Hub harness (§4.5):** HP-I1a role change refused in-game; HP-I1 grant, phone reads
the role and stores its key, roster count; HP-I2a host phone frame `role=host`, no
`name=`, `me.role === "host"`; HP-I2b `players()` excludes it, `hostPhones()`
includes it, `answersPrivate()`; HP-I2c the host view reaches only the host phone;
HP-I3 a host phone's game payload never reaches the frame, `send`/`broadcast` never
reach a host phone, no `player-*` events for it; HP-I4 a stale host phone keeps
`answersPrivate` true and the shell bar shows "Host phone ○"; HP-I5 a host phone
that reloads keeps the role and gets the held view again; HP-I6 the virtual-peer
hub, loaded in the live game frame, holds no connection for the host pid; HP-I7 a
phone joining with the host pid and no key is seated as a player, gets no host
view, the laptop shows the notice and private mode ends.

Helper files (not shipped): `.scratch/hp-shell-*` — patch scripts, the Node static
server (`hp-shell-serve.mjs`), the real-network run page and the headless
harness runner (`hp-shell-harnesses.mjs`).
