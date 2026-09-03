# Shell — verification report

Component: `shell` · Spec: `docs/01-lobby-shell-spec.md` §5 · Plan: `docs/06-verification-plan.md`
Tester: independent (did not write the code) · Date: 2026-09-03

Verdict: **fix-then-ship** — see §5.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home, 10.0.22635 |
| Node | v24.16.0 (`node --test`, zero deps) |
| Browsers | Chromium in-app browser pane; Chrome/152.0.7977.66 headless (scripted over CDP) for the screenshot run |
| Server | `python -m http.server 8641 --bind 127.0.0.1` from the repo root (my own port; 8620 avoided — other agents were bound there) |
| Real network | PeerJS 1.5.5 from cdnjs (SRI-pinned), public PeerJS broker, real WebRTC. **Not blocked** in this environment. |
| Code under test | `index.html`, `css/`, `js/`, `shared/`, `tests/` at repo `main` |

Test artefacts I added: `tests/shell-adversarial.test.mjs` (new, 23 cases) and
screenshots under `docs/reports/img/shell-*.png`. `games/**` was not touched, no
registry entry was added or removed (`git diff js/hub-registry.js` is empty,
`grep -c fake-game js/hub-registry.js` → 0), and no git commit/push was run.

---

## 2. Results

### T1 — Unit (`node --test`)

```
repo root :  tests 354 · pass 351 · fail 0 · todo 3   → exit 0
shell only:  tests  80 · pass  77 · fail 0 · todo 3   → exit 0
```

The 3 `todo` cases are my own adversarial tests for defects **S-1, S-2, S-4**
below. They run and currently fail; `node:test` reports them as todo so the gate
stays honest without going red. Remove the `todo` flag when each is fixed.

I read all four existing test files and confirmed every L-U id is **genuinely
asserted**, not merely named — each one drives the real export and asserts on
values/effects, not on a label.

| ID | Result | Evidence |
|---|---|---|
| L-U1 | PASS | `room code: 4 chars, allowed alphabet only, deterministic`. Genuine: 500 codes checked against `ROOM_ALPHABET`, `I/L/O/0/1` explicitly excluded, two same-seed LCGs compared element-wise, plus `isRoomCode`/`normalizeRoomCode`/`PEER_PREFIX`. |
| L-U2 | PASS | 3 tests. Genuine: control-char stripping via `String.fromCharCode(0/9/127)`, 24-cap, junk→null; avatar allow-list iterated over all 12 with `💣`/`<img>`/`7` rejected; `payloadTooBig` incl. cyclic→true and UTF-8 byte counts. Extended by ADV-A2/A3/B1–B3. |
| L-U3 | PASS | 2 tests. Genuine: every documented v2 message asserted with `deepEqual` on the **exact** returned fields; ~25 rejection fixtures. Gap I found and closed: the 17-player cap was only probed with `new Array(17).fill(null)` (which fails on the first member anyway) — ADV-A4 now proves it with 17 *valid* players. |
| L-U4 | PASS | 6 tests. Genuine: `p1…` ids, 12 unique colours then palette cycle, case-insensitive `name-taken` + `close` effect, `bad-name`/`room-full`/`locked`, relink by pid and by disconnected name, manual adoption keeping the host's spelling, locked-lobby rejoin. **But see defect S-1** — relink has no name-collision check. |
| L-U5 | PASS | 5 tests. Genuine: leave/status keep the player and flip `connected`; kick deletes and emits `kicked`+`close`+`player-leave`; manual add/rename/remove incl. "a phone player is neither renameable nor removable"; `setGame` broadcasts; snapshot order; serialize/restore. |
| L-U6 | PASS | Genuine: 11 events replayed against a `deepFreeze`d fixture with byte-identical JSON afterwards; 19 junk events return unchanged state without throwing. Extended by ADV-C7 (14 hostile events, incl. null-prototype events, + every effect asserted JSON-serialisable). |
| L-U7 | PASS | 10 tests with fake peer factory + fake clock/timers. Genuine: collision→regenerate and the 5-retry ceiling error text; whole-phase open deadline retries once then errors; library-load failure text; 21st message dropped while 60 pings all get pongs; junk never reaches `onEvent`; `room-closed` then close after the 400 ms flush; kick; stale sweep; broker blip does not tear the room down. |
| L-U8 | PASS | 10 tests. Genuine: 3 attempts with `Connecting… attempt N of 3` then failure text + tips; wrong code = hard stop; join envelope carries pid/avatar; drop→3 s loop; 25 s silence→teardown+reconnect; host traffic keeps alive; `reject` surfaces reason and stops retrying; `room-closed` stops the loop; `leave`; in-app-browser hint. |
| L-U9 | PASS | 10 tests over a fake postMessage bus. Genuine on both sides. Extended by ADV-D1–D6, which found **S-5, S-6, S-7** (all fixed). |
| L-U10 | PASS | 7 tests. Genuine: wrong origin, wrong source window, missing/wrong `gsc` marker, non-objects and arrays all ignored on both frame bridges; outbound shape + `location.origin` asserted; `detach` unhooks; mode detection; `rejectText`. |

#### My adversarial suite — `tests/shell-adversarial.test.mjs`

| ID | Result | What it presses |
|---|---|---|
| ADV-A1 | PASS | 13 hostile envelopes: `Object.create(null)`, JSON-parsed `__proto__` payloads, `Map`/`Set`/function/`Symbol`/`NaN`, throwing getters. Nothing malformed passes; `Object.prototype` stays clean; pass-throughs are stripped to exactly the documented keys. |
| ADV-A2 | PASS | The 32 KB cap is exact **at the byte**: 32768 allowed, 32769 refused; 33 KB refused as a string, nested in an object, and in an array; 9000 × 4-byte emoji refused despite `.length` 18000. |
| ADV-A3 | PASS | A 40 000-deep nested array (`JSON.stringify` throws `RangeError`) is *refused*, not thrown on; `toJSON` that throws; `BigInt`; `undefined`→null is legal. |
| ADV-A4 | PASS | 16-player lobby accepted, 17 refused, one bad member poisons the whole snapshot. |
| ADV-A5 | PASS | pid `p1234567` (7 digits) refused, `__proto__` as pid refused on the wire, 41-char game id refused, 25-char colour refused. |
| ADV-B1/B2 | PASS | Unicode names survive (`Ünïcödé`, `日本語の名前`, combining marks, emoji); newlines/tabs/C0/C1 stripped; wire cap 240 enforced before sanitising; never longer than `NAME_MAX` code units. |
| ADV-B3 | **todo → S-4** | 24-unit truncation splits a surrogate pair. |
| ADV-C1 | PASS | `setMax 99` clamps to 16; 16 joins accepted, the **17th** gets `room-full` and changes nothing; a 16-player snapshot still validates; manual players count against the cap. |
| ADV-C2 | PASS | **Rejoin race:** two phones claiming the same disconnected pid — the second is rejected `name-taken` + `close`, the seated phone keeps the pid alone, the roster never forks; a stranger with the same pid but a different name becomes their own player instead of hijacking the live seat; same-connection re-join is idempotent. |
| ADV-C3 | PASS | **Kick-then-rejoin:** the kicked pid is not resurrected — the phone returns as a fresh pid; kick + lock + rejoin is correctly refused `locked`. |
| ADV-C4 | **todo → S-1** | A relinking phone can take a live player's name. |
| ADV-C5 | PASS | Duplicate detection sees through case, padding and control chars. Documents that homoglyphs (Cyrillic `А`) are deliberately *not* deduplicated. |
| ADV-C6 | **todo → S-2** | Prototype-shaped pids (`__proto__`, `constructor`, …) on kick/remove/rename. |
| ADV-C7 | PASS | 14 hostile events against a deep-frozen state: input never mutated, every effect JSON-serialisable, state still a legal lobby. |
| ADV-C8 | PASS | A poisoned `localStorage` blob (duplicate pids, illegal pid, 400-char colour, blank name, `null`/string/array members, 45 players, `nextId:-5`) restores to ≤16 well-formed players, no duplicate pids, usable `nextId`, no peers, all `connected:false`. |
| ADV-D1 | PASS *(after fix S-5)* | `send()` after `close()` must not reach the bridge; `close()` posts exactly once. |
| ADV-D2 | PASS *(after fix S-6)* | `destroy()` ×3 emits `close` once; a destroyed peer ignores `reconnect()` and later roster traffic. |
| ADV-D3 | PASS | A player who joins and **leaves before `init`** leaves no dangling connection; duplicate `player-leave` is harmless; traffic for a departed/unknown pid is dropped silently. |
| ADV-D4 | PASS | `init` replayed (host reload) never double-announces; a duplicate `player-join` does not fork; an offline/manual player in the init roster is not announced as a connection. |
| ADV-D5 | PASS *(after fix S-7)* | `conn-close` before `connect` does not throw; repeated `conn-close` closes once; a closed phone connection cannot send; only `status:false` raises the synthetic `{type:"network"}`. |
| ADV-D6 | PASS | `install()` is a no-op outside embedded mode and never clobbers the real `window.peerjs`. |
| ADV-E1 | PASS *(after fix S-3)* | A standalone game can `lock`/`addManual`/`kick`/`send`/`broadcast`/`close` **before** `room.open()` — the "everything works without phones" rule. |

### T2 — Loopback (`tests/hub-harness.html` on `http://127.0.0.1:8641`)

**16/16 passing**, `#summary.ok`, `document.title === "Hub harness: ALL PASS"`,
zero console messages. Screenshot: `docs/reports/img/shell-t2-harness.png`.

| ID | Result | Evidence (harness detail text) |
|---|---|---|
| L-I1 | PASS | `code=F6RQ · on screen "F6RQ"`; `roster=Alex,Bo colours=rgb(230,159,0) / rgb(86,180,233)`; duplicate → `text="That name is taken — add an initial."` |
| L-I2 | PASS | host frame `players=p1:Alex:true|p2:Bo:true`; `p1=p1:Alex:🐼 p2=p2:Bo:🦖` |
| L-I3 | PASS | `log entry=p1:{"probe":1}`; broadcast reached both; `send pid` → `p2 log grew from 1 to 1 with no solo entry` |
| L-I4 | PASS | both phones back to waiting; re-pick → `p1 me=p1:Alex` with the same pids |
| L-I5 | PASS | `told=true frameGone=true (screen=join) roster=true · p1 sees Alex,Cy (was 3)` |
| L-I6 | PASS | `events=status:p1:false,status:p1:true pid=p1`, colour unchanged |
| L-I7 | PASS | late joiner `me=p3:Cy`, screen `play` |
| L-I8 | PASS | `locked=true refused="The host locked the lobby." cy-back=true` |
| L-I9 | PASS | after reload `code=F6RQ game=fake-game`, host frame re-inited |
| L-I10 | PASS | `banned=[] long=[] missing=[]` — **I extended this gate** to also cover `tests/shell-adversarial.test.mjs` (21 shell files now). |

### T3 — Real network (two browser tabs, real PeerJS broker + WebRTC)

Two independent top-level tabs on `http://127.0.0.1:8641/`, real broker, real
WebRTC data channels; a third and fourth phone were same-origin child contexts
with their own `?store=` slot (real, separate PeerJS peers) used only for the
duplicate-name and lock checks. **No temporary registry entry was needed** —
`games/family-feud/index.html` now exists and is embed-aware
(`data-gsc-game="family-feud"`, `body.className === "gsc-embedded"`), so L-E2/E3/E4
ran against a **real game page**, not `tests/fake-game.html`.

| ID | Result | Evidence |
|---|---|---|
| L-E1 | PASS | Host: `status {status:"open", code:"ED2H", broker:"ok"}`. Phone `?room=ED2H`, name "Robin": accepted in **835 ms** (≪ 5 s), `me={pid:"p1",name:"Robin",color:"#e69f00",avatar:"🐧"}`; host roster row `🐧Robin🟢Kick`, `1/12`, `"1 phone connected"`, `peers={376e8f41-…:"p1"}`. Screens: `shell-t3-lobby-1280.png`, `shell-t3-phone-waiting-320.png`. |
| L-E2 | PASS | Host clicked the tile → host frame ready in **1829 ms**, `src=games/family-feud/index.html?embed=host&room=ED2H`, shell bar `🎤 Family Feud`, chip `ED2H · 2 🔔`. Both phones already on `screen:"play"` when polled (< 3 s), `src=…?embed=player&room=ED2H&pid=p1&name=Robin`. The real game page in the host frame reported `GSC.mode="embed-host"`, `players=["p1:Robin:true","p2:Casey:true"]`, `code="ED2H"`. Screens: `shell-t3-host-ingame-1280.png`, `shell-t3-phone-ingame-320.png`. |
| L-E3 | PASS | Phone reloaded mid-game → back on `screen:"play"` as `p1 Robin` in the same game frame, **no code re-entry** (`askedForCode:false`). |
| L-E4 | PASS | Host tab reloaded mid-game → **same code `ED2H`**, `activeGame:"family-feud"` restored, host frame re-inited, and the phone reconnected **with no user action** under a brand-new PeerJS id (`peers={89da6b7e-…:"p1"}`). Phone side stayed `screen:"play"`, `connected:true`, health line up, no banner. Independently reproduced at boot: a fresh tab with a saved `roomCode` auto-reopened the same room. |
| L-E5 | PASS | Host "Close room" → `status:"closed"`, code `— — — —`, `"Room closed — the games still work without phones."`, controls collapse to `Open room`. Phone in **505 ms**: `screen:"join"`, `join-error="The host closed the room."`, frame removed, `gsc-phone-v1` cleared. Screen: `shell-t3-phone-room-closed-320.png`. |

Additional manual walkthrough (all on the real network):

| Check | Result | Evidence |
|---|---|---|
| Duplicate name rejection text | PASS | Second phone joining as `robin` (different case) → `"That name is taken — add an initial."`, stays on the join screen. |
| Lock lobby | PASS | `locked=true`, button flips to `🔒 Locked`, hint `"The lobby is locked: new players can't join, but anyone who drops can come back."`; a new phone gets `"The host locked the lobby."`; unlock restores. |
| Manual player add | PASS | Dialog is `role="dialog" aria-modal="true"`; row renders `🦊Sam No-Phone🔴no phoneRenameRemove`, `{connected:false, manual:true}`. |
| Manual rename | PASS | Title `"Rename Sam No-Phone"`; renamed to `Sammy`; a blank name is refused inline with `"Enter a name."` and the dialog stays open; `Escape` closes it. |
| Manual remove | PASS | Row gone, roster back to two. |
| Kick (from the in-game shell-bar chip popover) | PASS | Popover is `role="dialog"`, chip `aria-expanded="true"`; kick → host roster drops the player, `peers={}`, chip `ED2H · 0 🔔`. Phone in 601 ms: `"The host removed you from the room."`, frame gone, store cleared. |
| Kick-then-rejoin | PASS | Rejoining as the same name yields a **fresh pid `p4`** and lands straight in the running game (late-joiner path) — matches ADV-C3. |
| Host game ↔ shell bridge | PASS | Real Family Feud page in `embed-host` received the full roster with correct pids over the real transport. |

### T4 — Responsiveness / accessibility spot checks

| Check | Result | Evidence |
|---|---|---|
| Phone at 320×640 | PASS | No horizontal overflow (`scrollWidth == innerWidth`); **no element wider than the viewport**. |
| Phone tap targets | PARTIAL → **S-8** | Join button 277×56 ✓; avatar buttons 64×**48**; name field 277×**45**. Spec asks ≥ 56 px. Nothing under 44 px. |
| Lobby at 1280×720 | PASS | No horizontal overflow; room code renders at **140 px** in `Anton` (spec: ≥ 140 px); layout matches the spec's left room/roster + right tiles. |
| Keyboard focus on buttons | PASS | 12 focusable controls in the lobby, **all native `<button>`/`<a>`/`<input>`**; `.btn:focus-visible` and `.avatar-btn:focus-visible` give a 3 px gold outline with 2 px offset; `Escape` closes dialogs; dialog focus is moved to the input/confirm on open. |
| Avatar picker semantics | PARTIAL → **S-9** | `role="radiogroup"` with 12 `role="radio"` `<button>`s and correct `aria-checked`, but no arrow-key roving focus (click/Tab only). |
| Live regions | PASS | `room-status`/`tile-hint`/`join-note`/`wait-status`/`phone-banner` are `role="status"`; `room-error`/`join-error` are `role="alert"`. |
| Colour never the only signal | PASS | Every roster row carries emoji + name + 🟢/🔴 alongside the swatch (`🐼Casey🔴Kick`); the swatch is `aria-hidden`, the dot has an `aria-label`. |
| `prefers-reduced-motion` | PASS (code read) | `shared/theme.css:190` — a global `*, *::before, *::after` override killing animation/transition duration and `scroll-behavior`, plus `.btn:hover/:active { transform: none }`. `css/hub.css` has exactly one `transition` (the tile hover at :228) and no `@keyframes`, so the override covers everything. |

### T5 — Static gates

| Gate | Result | Evidence |
|---|---|---|
| V1 `node --test` exits 0 | PASS | root exit 0 (354 tests, 0 fail); shell-only exit 0 (80 tests, 0 fail, 3 todo). |
| V2 every file < 800 lines | PASS | Max `js/hub-host.js` 691. Full shell range 92–691; my new test file is 555. Functions > ~50 lines all carry the justification comment (5 closure factories). |
| V3 no banned DOM sinks | PASS | `grep -rnE "innerHTML\|insertAdjacentHTML\|outerHTML\s*=\|document\.write\|eval(\|new Function"` over `index.html css js shared tests README.md` → **zero matches**, tests included. |
| V4 no `console.log` | PASS | zero matches across `index.html css js shared tests`; diagnostics are `console.warn` only. |
| V5 nothing non-serialisable in `setState` | PASS (code read) | `setState` is only ever called with `{roomCode}`, `{activeGame}`, `{night}` (7 call sites, `js/hub-host.js:141,148,227,280,306,640`). Peer, connections, iframes, bridges and timers live in module scope (`js/hub-host.js:41–53`). |
| V6 external URLs | PASS | Only the SRI-pinned cdnjs PeerJS 1.5.5 (`shared/room-host.js:30`, `shared/room-player.js:27`) and Google Fonts (`index.html:9–11`). `https://shell.test` / `https://evil.test` in `tests/bridge.test.mjs` and my `tests/shell-adversarial.test.mjs` are string fixtures, never fetched. |
| V7 game-page conventions | N/A for the shell | Verified live on `games/family-feud/index.html`: `data-gsc-game="family-feud"`, `body.className="gsc-embedded"`. That page is the feud agent's deliverable. |
| V8 `?game=URL` validation | N/A | The shell serves no content JSON. |

### Security read

| Control | Result | Where |
|---|---|---|
| Origin **and** source-window checks on the bridge | PASS | `shared/bridge.js:509–513` (`event.origin !== ORIGIN`, `event.source !== iframe.contentWindow`, `d.gsc !== 1`, `typeof d.t !== "string"`) — both directions, plus the same triple in `listenDown` (`:74–85`) and in `VirtualPeer.defaultBus.listen` (`shared/virtual-peer.js:209–215`). Proven by L-U10 and ADV-A1. |
| Envelope validated **before** it touches state | PASS | `shared/room-host.js:267` validates before anything reaches `onEvent`; `js/hub-host.js:onRoomData` only ever sees validated messages. Junk returns `null` and is dropped without throwing (L-U7 "junk never reaches onEvent", ADV-A1/A3). |
| Payload cap enforced on the **HOST** before forwarding | PASS — both directions | Phone→host: `validateGame` → `payloadTooBig` (32 KB **UTF-8 bytes**, cyclic/unserialisable → refused) in `shared/room-protocol.js:209–214`, so an oversized payload never reaches `frameBridge.postMsg`. Host-game→phone: `js/hub-host.js` `frameApi.onSend` returns early on `RP.payloadTooBig(m)` before building the envelope. Phone-game→host: `js/hub-player.js:208` does the same. Exact boundary proven by ADV-A2. |
| No phone-controlled string reaches the DOM except via `textContent` | PASS | Every node is `document.createElement` + `textContent` (`el()` helpers in `hub-host.js`, `hub-player.js`, `bridge.js`); zero `innerHTML` repo-wide (V3). `name` is control-stripped and capped; `avatar` is allow-listed to exactly 12 emoji so a crafted emoji field cannot inject text; `color` is host-assigned from `COLORS` and only ever written to `style.backgroundColor`. |
| Rate limiting | PASS | `shared/room-host.js:279–285` — 20 msgs/s per peer, sliding 1 s window, **pings/pongs exempt**, and a flooder's connection is dropped. Proven by L-U7 (21st dropped, 60 pings all ponged). |
| Runtime dependency integrity | PASS | PeerJS pinned to 1.5.5 on cdnjs with `integrity` + `crossOrigin="anonymous"`, loaded lazily only when a room opens. |
| Prototype pollution | PASS | I attacked `validateEnvelope`, `lobbyReduce`, `restoreLobby` and `HubNight` with `__proto__`/`constructor` keys and a `__proto__` **PeerJS peer id**: `Object.prototype` is never polluted, `state.peers` keeps no own key for it, follow-up `leave`/`status` degrade to no-ops, and the lobby snapshot stays a legal envelope. Two cosmetic residues are recorded as **S-2** and the note below. |

Hardening notes (no action required, recorded for the orchestrator):

- `markHeard()` runs *before* the flood check in `shared/room-host.js:266–267`,
  so a flooding phone keeps itself "fresh" in the liveness sweep for the
  moment before it is disconnected. Cosmetic only — it is disconnected anyway.
- A phone that picks `__proto__` as its own PeerJS id becomes a player that
  `leave`/`status` can no longer address (both become no-ops), so it would sit
  🟢 forever until the host kicks it. No pollution, no crash. A
  `hasOwnProperty`-based peer map (or a `Map`) would close it.

---

## 3. Defects

Severity per 06 §5: **critical** = blocks play or corrupts state · **major** = a
documented feature doesn't work · **minor** = everything else.

| ID | Sev | File:line | Summary | Fixed? |
|---|---|---|---|---|
| S-1 | **major** | `shared/room-protocol.js:376–385, 426–434` | A relinking phone can take a **live** player's name → duplicate roster names | ✗ reported |
| S-2 | minor | `shared/room-protocol.js:485` (also `:533`, `:548`) | A prototype-shaped pid passes the `!state.players[pid]` guard | ✗ reported |
| S-3 | **major** | `shared/bridge.js:227–231` | Standalone `room.addManual/kick` throws before `room.open()` | ✓ **fixed** |
| S-4 | minor | `shared/room-protocol.js:112` | Name truncation can split a surrogate pair | ✗ reported |
| S-5 | minor | `shared/virtual-peer.js:84–88` | `conn.send()` after `conn.close()` still posts to the bridge | ✓ **fixed** |
| S-6 | minor | `shared/virtual-peer.js:176–180` | `peer.destroy()` twice emits `close` twice | ✓ **fixed** |
| S-7 | minor | `shared/virtual-peer.js:136–138` | A repeated `conn-close` emits `close` twice | ✓ **fixed** |
| S-8 | minor | `css/hub.css` (`.avatar-btn`, `.field-input`) | Tap targets 48 px / 45 px vs the spec's ≥ 56 px | ✗ reported |
| S-9 | minor | `js/hub-player.js:308–331` | `role="radiogroup"` without arrow-key roving focus | ✗ reported |
| S-10 | minor | `docs/reports/shell-implementation.md` §4 | "T1 230/230" is the repo-wide count, not the shell's | ✗ reported |

---

### S-1 · major · relink lets a phone take a live player's name

`shared/room-protocol.js:376–385` picks a relink target, then `relink()` at
`:426–434` writes the incoming `name` straight onto the player. The
`name-taken` check at `:387–388` is only reached when **no** relink target was
found, so a phone holding a valid disconnected pid bypasses uniqueness entirely.
This contradicts spec §3.1 ("Name uniqueness is case-insensitive") and L-U4.

Repro (`tests/shell-adversarial.test.mjs` ADV-C4, currently `todo`):

```js
let s = RP.lobbyReduce(RP.createLobbyState(), joinEv("peerA", "Alex")).state;
s = RP.lobbyReduce(s, joinEv("peerB", "Bo")).state;          // p2 = Bo, LIVE
s = RP.lobbyReduce(s, { type: "leave", peerId: "peerA" }).state; // p1 = Alex, offline
const out = RP.lobbyReduce(s, joinEv("peerC", "Bo", { pid: "p1" }));
// names(out.state) === ["Bo", "Bo"]   ← two live players called "Bo"
```

Reachable from the UI: the join screen prefills the remembered name but the user
can type anything, and the phone still sends its stored `pid`.

Proposed fix (implementer's call — it is a behaviour decision, so I did not make
it): inside `reduceJoin`, after a relink target is chosen, reject when the name
is held by a *different* live player —

```js
const clash = findByName(state, lower, false);
if (clash && clash !== pid) return rejectJoin(state, peerId, "name-taken");
if (pid) return relink(state, event, pid, name, avatar);
```

Then drop `{ todo: … }` from ADV-C4.

### S-2 · minor · prototype-shaped pid passes the player guard

`reduceKick` (`shared/room-protocol.js:485`) tests `if (!state.players[pid])`.
For `pid = "__proto__"` (or `constructor`, `toString`, `hasOwnProperty`) that
lookup returns an inherited value from `Object.prototype`, which is truthy, so
the reducer proceeds and emits a spurious `{broadcastLobby:true}` and
`{frame:{t:"player-leave", pid:"__proto__"}}` for a player that never existed.
`reduceRename`/`reduceRemove` survive only by accident (`p.manual` is
`undefined`). **Not reachable from a phone** — `validateEnvelope`'s `isPid`
(`/^p[0-9]{1,6}$/`) blocks it on the wire and every `kick` pid comes from the
host's own roster — hence minor, but it is a latent trap for any future caller.

Repro: ADV-C6 (`todo`). Proposed fix: a one-line helper used by all three
reducers, `const has = (s, pid) => Object.prototype.hasOwnProperty.call(s.players, pid);`.

### S-3 · major · standalone roster ops throw before the room is open — **FIXED**

`standaloneHost.applyEffects` dereferenced `host` unconditionally, but `host` is
only created by `ensureHost()` inside `room.open()`. So a standalone game that
lets the host build a roster first — precisely the "**Everything works without
phones**" house rule — crashed:

```
TypeError: Cannot read properties of null (reading 'broadcast')
    at applyEffects (shared/bridge.js:228:43)
    at room.addManual (shared/bridge.js:294:32)
```

`room.addManual()` and `room.kick()` were both affected. `js/hub-host.js` already
had the correct guards, so **the hub shell was never affected — only standalone
games**, i.e. all four game agents. Fixed by mirroring `hub-host.js` (3 lines):

```diff
     function applyEffects(effects) {
       for (const eff of effects) {
-        if (eff.send) host.send(eff.send.to, eff.send.msg);
+        // TESTER FIX: `host` is null until room.open(); a standalone game may build
+        // its roster (addManual/kick/lock) with the room still closed.
+        if (eff.send) { if (host) host.send(eff.send.to, eff.send.msg); }
         // A kicked peer is off `lobby.peers`, so it never receives the snapshot
         // that follows its `kicked` message.
-        else if (eff.broadcastLobby) host.broadcast(RP.lobbySnapshot(lobby), (peerId) => !!lobby.peers[peerId]);
-        else if (eff.close) host.dropConnection(eff.close, true);
+        else if (eff.broadcastLobby) { if (host) host.broadcast(RP.lobbySnapshot(lobby), (peerId) => !!lobby.peers[peerId]); }
+        else if (eff.close) { if (host) host.dropConnection(eff.close, true); }
         else if (eff.frame) dispatchFrame(eff.frame);
       }
```

Covered by ADV-E1.

### S-4 · minor · name truncation splits surrogate pairs

`sanitizeName` (`shared/room-protocol.js:112`) slices at 24 **UTF-16 code
units**. `"a".repeat(23) + "🦊"` yields 23 `a`s plus a lone high surrogate
(`\ud83e`), which renders as `�` and is not well-formed UTF-8 on the wire.
Repro: ADV-B3 (`todo`). Proposed fix: after slicing, drop a trailing lone high
surrogate — `if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);`.

### S-5 / S-6 / S-7 · minor · VirtualPeer lifecycle — **ALL FIXED**

Three PeerJS-fidelity gaps in the shim Jeopardy depends on. Diff
(`shared/virtual-peer.js`, 3 lines + 2 comments):

```diff
         send(m) {
+          if (!conn.open) return; // TESTER FIX: a closed connection never reaches the bridge
           if (isHost) bus.post({ t: "send", pid, m });
           else bus.post({ t: "send", m });
```
```diff
       if (d.t === "conn-close") {
-        if (playerConn) { playerConn.open = false; playerConn.ev.emit("close"); }
+        // TESTER FIX: a repeated conn-close must not emit a second `close`.
+        if (playerConn && playerConn.open) { playerConn.open = false; playerConn.ev.emit("close"); }
         return;
       }
```
```diff
     VirtualPeer.prototype.destroy = function () {
+      if (this.destroyed) return; // TESTER FIX: PeerJS emits `close` once per peer
       this.destroyed = true;
       this.open = false;
```

- **S-5** mattered most: a host game that called `conn.close()` and then
  `conn.send()` would still push a payload to the shell, which forwards it to a
  phone the game believes it has disconnected.
- **S-6/S-7** were duplicate `close` events, which double-fire a game's teardown
  handlers.

Covered by ADV-D1, ADV-D2, ADV-D5.

### S-8 · minor · phone tap targets below the spec's 56 px

Spec §10/CLAUDE.md ask for "thumb-sized targets (≥ 56 px)". Measured at 320×640:
`#btn-join` 56 px ✓, `.avatar-btn` **48 px**, `#join-name` **45 px**. All are
above the 44 px WCAG floor, and nothing overflows, so this is cosmetic.

### S-9 · minor · radiogroup without arrow-key navigation

`js/hub-player.js:308–331` builds `role="radiogroup"` with 12 `role="radio"`
buttons and correct `aria-checked`, but only wires `click`. ARIA expects arrow
keys plus a roving `tabindex`; today all 12 are separate tab stops. Functional
for keyboard users, just not idiomatic.

### S-10 · minor · implementation report over-states the shell unit count

`docs/reports/shell-implementation.md` §4 reports "T1 230/230" as the shell
result. 230 was the **repo-wide** total at that time; the shell's own suite was
57 (now 80 with mine). No code impact — worth correcting so the number is not
read as shell coverage.

---

## 4. Notes for the orchestrator

- **A concurrently-edited file briefly reddened the root gate.** Mid-run,
  `node --test` at the repo root failed on
  `games/family-feud/tests/feud-adversarial.test.mjs` (another agent's
  in-flight file). It was green again by the end of my session — final root run
  is 354 tests / 0 fail / exit 0. Nothing to do; recorded so the transient is
  not attributed to the shell.
- **`docs/reports/img/` is shared.** The feud tester is writing `feud-*.png`
  into the same folder. All my files are prefixed `shell-`.
- **Deviation 4 in the implementation report is still open by design:** the
  `{v:2,t:"avatar",emoji}` message is validated but ignored (`console.warn`),
  so a phone cannot change its avatar without rejoining. That is a SHOULD, and
  it is documented; I did not count it as a defect.
- **The `?store=` and `?harness=1` params are test seams on a production page.**
  They are inert without the param and both sanitise their input
  (`js/hub-host.js:22–27`), so I see no risk — flagging only so it is a
  conscious decision.
- I added `tests/shell-adversarial.test.mjs` to the harness's L-I10 file list so
  the static gate covers it too (1 line, `tests/hub-harness.html:459`).

---

## 5. Verdict

**Fix-then-ship.** The shell is in good shape: all ten L-U ids are genuinely
asserted rather than merely named, all ten L-I loopback states pass 16/16, and —
the part I most expected to fall over — **all five L-E real-network states pass
against the real PeerJS broker and real WebRTC, driven through the real Family
Feud page rather than a fixture**, including a host reload mid-game that
reopened the same code and pulled the phone back with no user action. Every
static gate is clean, the security posture is genuinely good (origin *and*
source-window checks, envelope validation before state, the 32 KB cap enforced
on the host in **both** directions, allow-listed avatars, host-assigned colours,
`textContent` everywhere, 20 msg/s rate limiting, SRI-pinned lazy PeerJS), and
my prototype-pollution and hostile-envelope attacks all bounced. Five of the
eight code defects I found were trivial and are fixed in place (S-3, S-5, S-6,
S-7 — diffs above; all four were < 5 lines each). What holds it back from a
plain "ship" is **S-1**: the relink path bypasses the case-insensitive name
uniqueness the spec makes normative and L-U4 claims to cover, so a phone that
remembers a valid pid can seat itself under a live player's name and produce a
roster with two identical names. That is a small, well-localised fix but it is a
behaviour decision I deliberately left to the implementer rather than redesign.
Fix S-1, optionally S-2/S-4 (both one-liners) and the two cosmetic a11y items,
and this component is ready to merge. Nothing here blocks the game agents —
indeed S-3 was blocking them and is now cleared.
