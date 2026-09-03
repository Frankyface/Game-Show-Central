# Jeopardy inside the hub — verification report

Component: `jeopardy-embed` · Spec: `docs/02-jeopardy-integration-spec.md` ·
Plan: `docs/06-verification-plan.md` §5 · Tester: independent (did not write this code)

**Verdict: fix-then-ship.** Three critical defects, all in the same mechanism
(a phone's one-shot Jeopardy `join` over the virtual peer), plus two minors.
Everything else — the whole standalone regression surface, and every
happy-path embedded success state — passes over real PeerJS/WebRTC.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app browser), 3–4 tabs (1 host, 2–3 phones, `?store=` to separate phone identities) |
| Server | `python -m http.server 8645 --bind 127.0.0.1` from the repo root (launch config `hub-test-jeopardy`) |
| Date | 2026-09-03 |
| Broker | **Reachable.** Real PeerJS 1.5.5 + WebRTC throughout — no BLOCKED-ENV was needed. |
| Repo state | `games/jeopardy` @ `696a5f3` "feat: embed Jeopardy in the hub via the virtual peer adapter" (its only commit; nothing under `games/jeopardy` changed during this run). The shell tester's `shared/bridge.js` / `shared/virtual-peer.js` / `js/hub-host.js` fixes were live throughout and landed as `0832712` mid-run; all line references below are against that committed state. |

Interaction method: real DOM events (`.click()`, `PointerEvent('pointerdown')`,
`KeyboardEvent('keydown', {code:'Space'})`) dispatched on the real buttons via
`javascript_tool`, plus assertions on live DOM text and state.

---

## 2. Results

### Regression / standalone (T4)

| ID | Result | Evidence |
|---|---|---|
| **J-R1** `cd games/jeopardy && node --test` | **PASS** | `ℹ tests 49 · ℹ pass 49 · ℹ fail 0` (run twice, before and after the browser work). |
| **J-R2** start screen unchanged | **PASS** | `http://127.0.0.1:8645/games/jeopardy/` → `GAME NIGHT JEOPARDY / Questions: questions.json / PLAYERS … / BUZZER ROOM (OPTIONAL) / Open buzzer room / "Players use their phones to buzz in — needs internet." / "Playing on your phone? Join a buzzer room…" / TIMERS / QUESTIONS / Start Game`. Sections `screen-setup` visible, `screen-board/editor/player` hidden. |
| **J-R2** no `gsc-embedded` | **PASS** | `document.body.className === ""`, `GSC.mode === "standalone-host"`, `GscEmbed.isEmbedded() === false`, `typeof window.peerjs === "undefined"`. |
| **J-R2** PeerJS still lazy | **PASS** | On load, resource entries matching `/peerjs/i` → **0**. After clicking **Open buzzer room** → **1**: `https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js`. |
| **J-R2** `tests/harness.html` | **PASS** | `#summary` = `70/70 checks passed`, `.ok`, zero `li[data-pass!=true]`. |
| **J-R2** `tests/photo-harness.html` | **PASS** | `#summary` = `All 26 photo-clue checks passed.`, `.ok`, 26 items. (Three `ERR_UNSAFE_PORT` console errors are the harness's own deliberate `https://127.0.0.1:9/` fixture.) |
| **J-R3** `ghj-` prefix + real broker | **PASS** | Room opened on code **U7G5** over the real broker, `BuzzerHost.status() === "open"`, panel shows `ROOM CODE U7G5 / JOIN AT http://127.0.0.1:8645/games/jeopardy/index.html?room=U7G5 / Close room`. `PEER_PREFIX = "ghj-"` untouched at `buzzer-host.js:22` (used at `:167`) and `buzzer-player.js:16` (used at `:200`). |
| `index.html?room=` standalone (no auto-join) | **PASS** | `body.className === "player-mode"` (no `gsc-embedded`), the ordinary join card is visible — `BUZZ IN / ROOM CODE / YOUR NAME / Join`, `#player-code.value === ""`, `#player-buzzer` hidden, `typeof window.peerjs === "undefined"`, 0 peerjs requests. Nothing auto-joins. |

### Embedded, real network through the hub (T3)

Setup: host tab `http://127.0.0.1:8645/` → **Host a game night** → room **A2SF**.
Phone tabs `?room=A2SF&store=rita` / `&store=sam` joined as **Rita** (`p2` 🐼) and
**Sam** (`p1` 🐙); lobby **+ Add player** → **Mo** (`p3` 🦊, `manual:true`).
Host clicked the Jeopardy tile.

| ID | Result | Evidence |
|---|---|---|
| **J-E1** | **PASS (with the D2 caveat below)** | Frame `src=games/jeopardy/index.html?embed=host&room=A2SF`, inner `location.href` tidied to `…?embed=host`, `body.className === "gsc-embedded"`, `GSC.mode === "embed-host"`, `BuzzerHost.status() === "open"`. Setup panel: `PLAYERS Mo ✕ Sam ✕ Rita ✕ … BUZZER ROOM (OPTIONAL) 🟢 Sam Kick 🟢 Rita Kick 🔊 Sound on / "Room A2SF — managed by Game Show Central. Everyone in the lobby is already here."` — no Open/Close, no join URL, no "Playing on your phone?" note (`getComputedStyle` on `.buzzer-join`, `.buzzer-code-wrap`, `.buzzer-join-note` all `display:none`; `#gsc-room-note` `display:block`). Phones: `body="gsc-embedded player-mode"`, `GSC.mode="embed-player"`, `#player-join` hidden, `#player-buzz` `mode-idle` "Wait for the host…". **Caveat: on the very first mount Rita's `join` was silently dropped (defect D2) and she did not reach the scoreboard until her frame was reloaded.** |
| **J-E2** | **PASS** | Science & Nature $200 → both phones `mode-reading` "Wait for it…", `_roomState() = {armed:false, reading:true}`. Rita `pointerdown` **early** → `mode-locked` **"Too soon! Locked out for this clue"**, host `lockedOut:{p2:true}, lockReason:{p2:"early"}`. Real `keydown{code:"Space"}` → `armed:true`; Sam `mode-armed` "BUZZ!", Rita still locked. Sam **triple**-tapped in one turn → exactly one winner, `winnerId:"p1"`, `mode-won` "You buzzed in! Answer!". ✓ → `Sam=200`, `used["0-0"]=true`, `active=null`. Second clue: armed, Rita buzzed, **✗** → `Rita=-400`, `active.missed={…-2:true}`, `lockedOut:{p2:true} lockReason:{p2:"wrong"}`, Rita `mode-locked` "Locked out for this clue", **Sam re-armed** `mode-armed` "BUZZ!". |
| **J-E3** | **PASS** | World Capitals $800 (`dailyDouble:true`). `#dd-player` → Sam → host splash `📱 Sam is wagering on their phone…`, Sam's pad `Your score $200 · wager $5–$1,000`. Wager **5000** → bounced, `#player-wager-error` = `"Enter a whole-number wager between 5 and 1000."`, pad stays open, host `wagerLocked:false`. **Dropdown changed to Rita mid-prompt** → Rita's pad opens (`Your score -$400 · wager $5–$1,000`), **Sam's pad closes back to `mode-idle`**, splash re-reads `📱 Rita is wagering on their phone…`. Rita wagered **600** → `Wager sent — look up!`, host `active={isDailyDouble:true, wagerLocked:true, wager:600, wagerPlayerId:"bz…-2"}`, clue revealed, clue timer running. Reveal + ✓ → `Rita = -400 + 600 = 200`. |
| **J-E4** | **PASS** | Wager stage: both phones `FINAL JEOPARDY — YOUR WAGER … wager $0–$200` / `$0–$0` (correct per-player caps). Out-of-range 500 bounced with `"Enter a whole-number wager between 0 and 200."`. Host **masks** submitted wagers as `Sam $200 — wager up to $200 🔒 from phone Unlock`. Lock → phones get the typed-answer form with the real category + clue; host counter `Answers in: 2/2`. Reveal → judge rows carry the answers verbatim: `Sam (wagered $0) "What is the Great Wall of China?" ✓ ✗` / `Cy (wagered $0) "What is Hadrian's Wall?" ✓ ✗`. ✓/✗ → bridge trace `{"t":"send","pid":"p1","m":{"t":"final-result","correct":true,…}}` / `{"pid":"p4",…"correct":false…}`, phones render **"CORRECT! +$0 · you finished on $0"** and **"SORRY — INCORRECT +$0 · you finished on $0"**. |
| **J-E5** | **PASS** | Answer timer: on Sam's winning buzz, host `#clue-timer` visible with **9** blocks and the buzzed phone's `#player-timer` visible with **9** blocks. Final timer: host `#final-timer` visible, 9 blocks; both phones `#player-answer-timer` visible, 9 blocks. |
| **J-E6** | **PASS** | `⌂ Lobby` → "Leave Jeopardy?" → **Back to lobby** (frame removed, lobby shows `TONIGHT'S SCOREBOARD … Mo 300 Rita 200 Sam 200 Cy 0`) → **Play** → `phase:"board"`, scores **identical** (`Mo 300, Sam 200, Rita 200, Cy 0`), used tiles **identical** (`0-0, 0-1, 1-3, 2-0`), **4 scoreboard rows — no duplicates**, room reopened on the same code, and all three phones relinked **by name to their original playerIds** (`bz…-1`, `bz…-2`, `bz…-6`). Note: on 3 of 4 re-pick cycles the phones' re-joins were lost first (defect D2) and only landed after their game frames were reloaded. |
| **J-E7** | **PASS** | A third phone joined mid-board as **Cy** → `p4` 🦉. Host scoreboard grew to `Mo $300 · Sam $200 · Rita $200 · Cy $0`, Jeopardy chip `A2SF · 3 🔔`, `_roomState().players.p4 = {name:"Cy", playerId:"bz…-6", connected:true}`, night standings gained `{pid:"p4",name:"Cy",score:0}`. Cy's phone: join card hidden, buzzer screen `mode-idle` "Wait for the host…". |
| **J-E8** | **PASS** | Mo (phone-less) was on the scoreboard from the first render with the stable id `gsc-p3`, is selectable in the Daily Double dropdown, and a manual score adjust through the ordinary podium button moved her to **$300** (`{"id":"gsc-p3","name":"Mo","score":300}`), reported to the hub as `{"pid":"p3","name":"Mo","score":300}`. |
| **J-E9** | **PASS** | `HubHost._state().night.games.jeopardy` tracked every ✓/✗ live: after the DD it read `[{p3,Mo,300},{p1,Sam,200},{p2,Rita,200},{p4,Cy,0}]` — correct pids for phone **and** manual players — and the lobby's TONIGHT'S SCOREBOARD rendered the same numbers. (See defect D4: pids transiently degrade to `null` around reconnects.) |
| **J-E10** | **PASS** | `git diff 066d003 -- games/jeopardy --stat` lists exactly `README.md`, `css/gsc-embed.css` (new), `index.html`, `js/app.js`, `js/buzzer-host.js`, `js/buzzer-player.js`, `js/gsc-embed.js` (new) — the spec's allowed list plus the two new files, additions only. All five edits carry `// GSC:` / `<!-- GSC: -->` markers (`index.html:15,282`, `app.js:80`, `buzzer-host.js:775`, `buzzer-player.js:744`). Each is guarded: `app.js` uses `window.GscEmbed?.onStateChanged?.()`; `buzzer-host.js` returns only when `body.classList.contains("gsc-embedded")`; `buzzer-player.js` returns unless `?embed=player`; the new stylesheet is scoped entirely to `body.gsc-embedded`; `gsc-embed.js` `install()` returns `false` unless `GSC.mode` is `embed-host`/`embed-player`. No `innerHTML` added. |

### Host-frame `?room=` collision (implementer's deviation 3)

| Check | Result | Evidence |
|---|---|---|
| Host frame never boots as a phone | **PASS** | Frame mounted at `?embed=host&room=A2SF`; inner `location.href` is `…index.html?embed=host`, `body.classList.contains("player-mode") === false`, `GSC.mode === "embed-host"`. |
| …after a hub refresh mid-game | **PASS** | Reloaded `http://127.0.0.1:8645/` with a game in progress: frame re-mounted at `?embed=host&room=A2SF`, inner href `…?embed=host`, `player-mode` false, `phase:"board"`, `BuzzerHost.status() === "open"` on the same code. (Buzzers were dead afterwards — that is defect D3, a separate problem.) |
| Other query params preserved | **PASS** | `…?embed=host&room=A2SF&game=questions.json&foo=1` → `…?embed=host&game=questions.json&foo=1`. Only `room` is removed. |

### Static gates (T5)

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | **PASS** | 49/49. |
| **V2** new files < 800 lines | **PASS** | `js/gsc-embed.js` **278**, `css/gsc-embed.css` **83**, `index.html` 308, `js/buzzer-player.js` 769. No function in `gsc-embed.js` exceeds ~50 lines. |
| **V2** pre-existing over-cap files | **noted, not failed** | `js/app.js` **1047** (1043 as vendored) and `js/buzzer-host.js` **820** (816 as vendored) were already over the 800-line house cap upstream; each grew by exactly 4 guarded lines. Splitting a vendored file is outside this component's remit. |
| **V3** no `innerHTML`/`eval`/… added | **PASS** | Only hits under `games/jeopardy` are two prose mentions of the word "innerHTML" in comments (`app.js:6`, `gsc-embed.js:31`) and one **pre-existing upstream** `W().eval(expr)` at `games/jeopardy/tests/photo-harness.html:102`. The latter violates 06 §4 V3 ("tests too") but predates this component — **noted, not failed**. |
| **V4** no `console.log` | **PASS** | Zero matches under `games/jeopardy/js`. Diagnostics use `console.warn`. |
| **V5** no handles in `setState` | **PASS** | `gsc-embed.js` only ever calls `appSetState({players: [...]})` with plain `{id,name,score}` objects; `room`, `lastReport`, `bootedHost` are module-local and never serialised. |
| **V6** external URLs | **PASS** | Google Fonts (`index.html:8–10`) and the pinned SRI'd `peerjs/1.5.5` cdnjs URL only. |
| **V7** `data-gsc-game` / `#gsc-join` | **N/A by design — flagged** | Jeopardy's `<body>` carries neither. `docs/02` §2.4 deliberately routes the phone through Jeopardy's own join card + `gscAutoJoin()` instead of the SDK's `#gsc-join`, and `gsc-embed.js` adds `gsc-embedded`/`player-mode` at runtime. Worth a one-line exception in 06 §4 for this vendored game. |
| **V8** `?game=URL` + upload validate | **PASS (code read)** | Untouched upstream path; `stripRoomParam` preserves `?game=` (verified above). |

---

## 3. Defects

### D1 — **critical** — a phone that reloads mid-game is permanently and silently muted

- **Where:** `shared/virtual-peer.js:122-126` — the host-side `bus.listen` branch
  `if (d.t === "player-status") { … return; }` is a deliberate no-op; combined
  with `makeConnection.send`'s `if (!conn.open) return;` (`:85`) and
  `announce`'s `if (!hostPeer || conns.has(pid)) return;` (`:64-65`). Surfaced by
  `games/jeopardy/js/gsc-embed.js:bootHost` (`onPlayerStatus: () => reportScores()`
  does nothing about the stale connection).
- **Repro:** host + 2 phones playing Jeopardy in the hub → reload one phone's
  page (or just its game iframe) mid-clue.
- **Observed:** the shell keeps the same pid and emits only
  `player-status connected:false` → `true`, which the shim ignores, so the
  host-side virtual connection for that pid is never closed and never
  re-announced. The reloaded Jeopardy frame sends `join` over that same
  connection; Jeopardy's duplicate-name guard answers
  `{"v":1,"t":"reject","reason":"name-taken"}` and calls `conn.close()`.
  The phone's `handleMessage` treats `reject` as a hard stop
  (`wantConnected = false`, `teardownPeer()`), so it parks on the
  "Connecting…" card forever. A **second** reload does re-register the player
  on the host (`_roomState().players.p2` present, `connected:true`, 🟢, counted
  in the `2 🔔` chip) but every host message to it is now swallowed by the
  closed connection's `send` guard — so the host sees a healthy player who
  receives nothing. Exact trace captured from the host frame:
  `{"gsc":1,"t":"send","pid":"p2","m":{"v":1,"t":"reject","reason":"name-taken"}}`
  followed by `{"gsc":1,"t":"close","pid":"p2"}`.
- **Recovery:** only `⌂ Lobby` → re-pick Jeopardy (a fresh host frame, fresh shim).
- **Fixed by tester?** No — the file is outside my allowed touch area
  (`games/jeopardy/tests/`, `docs/reports/`).
- **Proposed fix (~6 lines, `shared/virtual-peer.js`):**
  ```js
  if (d.t === "player-status") {
    const c = conns.get(d.pid);
    if (d.connected === false) { conns.delete(d.pid); if (c) { c.open = false; c.ev.emit("close"); } }
    else announce(d.pid);           // re-announce a fresh connection
    return;
  }
  ```
  This also frees the name so Jeopardy's relink-by-name rule works, which is
  what `docs/02` §3 assumed would happen.

### D2 — **critical** — a phone's one-shot `join` is dropped if it beats the host's buzzer room, with no retry

- **Where:** `shared/virtual-peer.js:127-135` — `if (d.t === "msg") { … const conn
  = conns.get(d.pid); if (conn) conn.ev.emit("data", d.m); }`. No connection for
  that pid ⇒ the payload is discarded.
- **Repro:** host + 2–3 phones; pick Jeopardy (or `⌂ Lobby` → re-pick). Hit it on
  the very first mount (1 of 2 phones lost) and on **3 of 4** re-pick cycles
  (all phones lost).
- **Observed:** the shell already buffers phone payloads that beat the frame's
  `ready` (`js/hub-host.js:180` + `:270-272` `pending` queue, flushed in `frameApi().onReady`).
  But `ready` is posted by `shared/bridge.js` from `gsc-embed.js` at script-parse
  time, whereas the host-side virtual connections are only announced once
  `BuzzerHost.openRoom()` constructs its Peer — after `DOMContentLoaded` and the
  `init` round trip. The flushed `join` therefore lands in that gap and is thrown
  away. Jeopardy sends `join` exactly once, on connection-open, and never retries,
  so the player parks on "Connecting…" while the host shows an empty room
  (`_roomState().players === {}`, Jeopardy chip `A2SF · 0 🔔` against the shell
  chip's `A2SF · 3 🔔`). Confirmed by reloading one phone frame in isolation:
  that phone's `join` then arrives and it joins correctly, while the others stay dead.
- **Fixed by tester?** No (outside my touch area).
- **Proposed fix (~8 lines, `shared/virtual-peer.js`):** hold inbound `msg`
  payloads for an un-announced pid in a small per-pid queue (cap it, e.g. 16),
  and drain that queue inside `announce()` right after `conn.ev.emit("open")`.

### D3 — **critical** — a hub page refresh mid-Jeopardy silently kills every buzzer

- **Where:** the interaction of `js/hub-host.js:mountFrame` (remounts only the
  **host** game frame on restore) with `shared/virtual-peer.js` and
  `games/jeopardy/js/gsc-embed.js` (nothing tells phones already in the game to
  re-handshake).
- **Repro:** with a Jeopardy game in progress, reload the hub host page.
- **Observed:** the shell restores the room, remounts the host frame correctly
  (see the collision table above — the `?room=` handling is fine), and all
  phones reconnect at the shell level within a second (`shell chip A2SF · 3 🔔`,
  all `connected:true`). But the phones' **game iframes are never remounted**, so
  no phone re-sends `join`; the new host frame's `BuzzerHost._roomState().players`
  stays `{}` and its own chip settles on `A2SF · 0 🔔`. Opening a clue leaves all
  three phones on `mode-idle` "Wait for the host…". Waited >50 s — no recovery.
  Neither side shows any error.
- **Recovery:** `⌂ Lobby` → re-pick Jeopardy, and then (because of D2) a reload
  of each phone's game frame.
- **Fixed by tester?** No (outside my touch area; also cross-component).
- **Proposed fix:** when a host game frame posts `ready` for a game that is
  already active, have the shell force the phone game frames to re-handshake
  (simplest: shell sends the phones the same `setGame` swap it sends on a fresh
  pick, so their frames remount). Fixing D2 alone is **not** sufficient here —
  there is no `join` in flight to buffer.

### D4 — **minor** — night-standings pids degrade to `null` around reconnects

- **Where:** `games/jeopardy/js/gsc-embed.js` `pidFor()` (returns `null` when
  `BuzzerHost._roomState()` has no peer for that scoreboard player) feeding
  `reportScores()`.
- **Observed:** `HubHost._state().night.games.jeopardy` contained
  `{"pid":null,"name":"Rita","score":200}` after a phone reload, and after the
  hub refresh **all three** phone players were recorded with `pid:null`. It
  self-heals on the next score change, but a game that ends inside that window
  records the wrong pids for the night.
- **Proposed fix (~4 lines):** memoise the last non-null pid per scoreboard
  player id inside `gsc-embed.js` and fall back to it in `pidFor`.

### D5 — **minor** — an embedded phone whose auto-join fails has no way to retry

- **Where:** `games/jeopardy/css/gsc-embed.css:57-62` hides
  `#player-join .player-field` and `#player-join-btn` unconditionally under
  `body.gsc-embedded`.
- **Observed:** the "Connecting…" card that D1/D2 leave behind is a dead end —
  no code field, no name field, no Join button, and `#player-error` is empty
  (nothing failed *locally*, the message was simply dropped upstream). The
  player's only escape is to reload the page from browser chrome. This turns two
  transport races into total dead ends, so it is worth fixing even after D1–D3.
- **Proposed fix:** after ~5 s without the buzzer screen, un-hide `#player-join-btn`
  and set `#player-error` to a plain-English "Couldn't reach the host — tap Join
  to retry" (`gsc-embed.js` + one CSS rule scoped to a `gsc-join-stuck` class).

### Not defects (recorded so they are not re-filed)

- **Self-inflicted:** two `TypeError: Cannot read properties of undefined
  (reading 'clues')` at `app.js:655` (`revealAnswer`) and `app.js:857`
  (`renderJudgeRow`) came from my scripted click on the **CSS-hidden**
  `#btn-reveal` while `state.active` was `null`. Not reachable through the UI.
  (Upstream nit for someone's backlog: both functions assume `state.active` is
  non-null.) A clean re-run of Final Jeopardy afterwards passed J-E4 in full.
- **Not reachable by mouse:** scripting a click on a lobby "Play" button while
  the "Leave Jeopardy?" dialog is open remounts the host frame without the
  shell's `setGame` broadcast, leaving the phones' frames stale.
- **Kick from the hub roster works as specified:** kicking Rita from the shell
  chip popover removed her from the lobby, her phone left the game frame and
  showed "The host removed you from the room.", the Jeopardy room dropped `p2`
  and both chips fell to `2 🔔`. Her Jeopardy scoreboard row remained, which
  `docs/02` §3 allows.
- **Environment noise:** `QuotaExceededError` on `localStorage.setItem` in the
  in-app browser despite <5 KB stored (Jeopardy surfaces it as
  `console.warn("Could not save game state")`); `ERR_UNSAFE_PORT` ×3 from
  photo-harness's deliberate `https://127.0.0.1:9/` fixture; `navigator.vibrate`
  blocked without a prior user gesture. **No product console errors on any phone
  tab** (`read_console_messages` returned nothing for all three).

---

## 4. Verdict

**Fix-then-ship.** The adapter itself is well-built and minimal: the diff is
exactly the allowed files, every upstream edit is additive and guarded, the
standalone page is untouched by every measure the spec asks for (49/49 unit
tests, 70/70 buzzer harness, 26/26 photo harness, lazy PeerJS, `ghj-` prefix, no
`gsc-embedded`, no auto-join on a bare `?room=`), and the `history.replaceState`
trick that keeps the host frame from booting as a phone holds up even across a
hub refresh. Every documented embedded feature — early-buzz lockout, arming,
first-tap-wins under a triple tap, ✗-then-re-arm, Daily Double wagers including
a mid-prompt player switch, masked Final wagers, typed Final answers, verdicts on
phones, both timers, state restore across `⌂ Lobby`, late joiners, manual players,
and the night scoreboard — works over real PeerJS/WebRTC. But three critical
defects share one root cause: a phone's Jeopardy `join` is a single, unretried
message riding a virtual connection whose `open` is unconditional, so any
disturbance in the mount ordering (a phone reload, a re-pick, a host refresh)
leaves a player — or the whole table — silently mute with a green dot on the
host's screen. On a real game night the host would not know anything was wrong.
D1–D3 must be fixed before this ships; D4 and D5 should follow, and D5 in
particular buys cheap resilience against whatever races remain.

### For the orchestrator

- **D1, D2 and D3 are not fixable inside `games/jeopardy/**`.** D1 and D2 are
  ~14 lines total in `shared/virtual-peer.js` (shell component); D3 needs a
  shell-side re-handshake when a host game frame remounts. Route them to the
  shell implementer with this report, and re-run this walkthrough afterwards —
  the same three races will bite Family Feud, Wheel and Weakest Link if any of
  them ever relies on a one-shot handshake message.
- **D4 and D5 are jeopardy-embed's own** (`js/gsc-embed.js`, `css/gsc-embed.css`),
  ~8 lines combined.
- **No automated embedded harness exists** for this component
  (`games/jeopardy/tests/gsc-embed-harness.html` was never written, per the
  implementer's own "known gaps"). Every embedded result above is a manual
  walkthrough. Given three critical races found by hand on the first pass, an
  automated T2 harness for the embed path is worth commissioning.
- Nothing was committed; nothing outside `docs/reports/` was written.
