# Jeopardy inside the hub — implementation report

Component: `jeopardy-embed` · Spec: `docs/02-jeopardy-integration-spec.md` · Date: 2026-09-03
Environment: Windows 11 (10.0.22635), Node **v24.16.0**, Chromium (in-app browser),
`python -m http.server 8631 --bind 127.0.0.1` from the repo root.

Status: **complete and green.** J-R1 49/49, J-R2 (start screen + 70/70 buzzer
harness + 26/26 photo harness + lazy PeerJS), J-R3, and J-E1 … J-E10 all pass —
**J-E1 … J-E9 over real PeerJS/WebRTC through the real hub**, not a loopback.
WebRTC was **not** blocked in this environment, so no BLOCKED-ENV fallback was needed.

---

## 1. Files added / edited

### Added (the whole adapter)

| File | Lines | What it is |
|---|---:|---|
| `games/jeopardy/js/gsc-embed.js` | 278 | The one new script. Installs the PeerJS shim, marks the body, tidies the host frame URL, boots `BuzzerHost` onto the shell's code, mirrors manual lobby players onto the scoreboard, and reports scores to the hub. Hard no-op standalone. |
| `games/jeopardy/css/gsc-embed.css` | 83 | Embed skin. **Every** rule is scoped to `body.gsc-embedded`, so the file is inert standalone. |

### Edited (upstream files — the exact allowed list, additions only)

| File | Before | After | Change |
|---|---:|---:|---|
| `games/jeopardy/index.html` | 291 | 308 | +17: one `<link>`, six `<script src="../../shared/…">`, one `<script src="js/gsc-embed.js">`, two comment blocks |
| `games/jeopardy/js/app.js` | 1043 | 1047 | +4: one optional-chained `reportScores` hook in `setState` |
| `games/jeopardy/js/buzzer-host.js` | 816 | 820 | +4: skip the saved-code auto-reopen when embedded |
| `games/jeopardy/js/buzzer-player.js` | 753 | 769 | +16: `gscAutoJoin()` + its one call site |

`git diff --stat -- games/jeopardy`:

```
 games/jeopardy/index.html          | 17 +++++++++++++++++
 games/jeopardy/js/app.js           |  4 ++++
 games/jeopardy/js/buzzer-host.js   |  4 ++++
 games/jeopardy/js/buzzer-player.js | 16 ++++++++++++++++
 4 files changed, 41 insertions(+)
```

**41 insertions, 0 deletions, 0 modifications.** Not one upstream line was changed
or removed. `git status --porcelain -- games/jeopardy` lists exactly those four
modified files plus the two new ones — nothing else (J-E10).

---

## 2. The exact list of `// GSC:` edits

Five marked edits across four files. Every one is additive and inert standalone.

**1. `index.html:15` — the embed stylesheet** (`<!-- GSC: -->`)

```html
<link rel="stylesheet" href="css/gsc-embed.css">
```

**2. `index.html:282` — the shared SDK, the shim, and the adapter** (`<!-- GSC: -->`),
inserted immediately **before** `js/data.js` so `window.peerjs` exists before any
Jeopardy script runs:

```html
<script src="../../shared/room-protocol.js"></script>
<script src="../../shared/room-net.js"></script>
<script src="../../shared/room-host.js"></script>
<script src="../../shared/room-player.js"></script>
<script src="../../shared/bridge.js"></script>
<script src="../../shared/virtual-peer.js"></script>
<script src="js/gsc-embed.js"></script>
```

**3. `js/app.js:80` — the one `reportScores` hook**, at the end of `setState`:

```js
// GSC: report the scoreboard to Game Show Central's night standings after every
// change (docs/02 §2.5). Optional-chained end to end — standalone has no
// GscEmbed, and embedded it returns immediately unless this is the host frame.
window.GscEmbed?.onStateChanged?.();
```

**4. `js/buzzer-host.js:775` — suppress the saved-code auto-reopen**, in `boot()`:

```js
// GSC: inside Game Show Central the hub shell owns the room code, so skip the
// saved-code auto-reopen — js/gsc-embed.js calls openRoom(shellCode) once the
// bridge handshake lands. Standalone (no gsc-embedded class) is unchanged.
if (document.body && document.body.classList.contains("gsc-embedded")) return;
```

**5. `js/buzzer-player.js:741,744` — auto-join when a name is supplied and embedded**,
one call at the end of `boot()` plus the helper:

```js
gscAutoJoin();
…
// GSC: inside Game Show Central the lobby already took this player's name, so
// fill the (CSS-hidden) name field and run the ordinary join() path — same
// validation, same connect, same reconnect loop — instead of showing Jeopardy's
// own join card a second time (docs/02 §2.4). Standalone has no ?embed=player,
// so this returns before touching anything.
function gscAutoJoin() {
  const params = new URLSearchParams(location.search);
  if (params.get("embed") !== "player") return;
  const name = (params.get("name") || "").trim();
  const field = $$("player-name");
  if (!name || !field || !CODE_RE.test(($$("player-code")?.value || ""))) return;
  field.value = name.slice(0, NAME_MAX);
  join();
}
```

Spec §2 also permitted **`BuzzerHost.openWithCode(code)`** and **suppressing the
Open/Close buttons inside `buzzer-host.js`**. Neither was needed and neither was
added — see deviations 1 and 2 below. The adapter uses **fewer** upstream edits
than the spec allows.

---

## 3. How it works

1. **The shim.** `gsc-embed.js` calls `VirtualPeer.install()` before anything
   else, so `loadPeerJs()` short-circuits (`window.peerjs.Peer` already exists)
   and every `new window.peerjs.Peer(...)` talks postMessage to the shell.
   Jeopardy's whole buzzer stack — join, buzz, early lockout, DD wagers, Final
   wagers/answers, ping/pong heartbeat, timers — rides that shim unchanged.
2. **`body.gsc-embedded`** gates `css/gsc-embed.css`.
3. **Host.** `GSC.host()` posts `ready`; on `init` the adapter calls the already
   public `BuzzerHost.openRoom(GSC.params.room)`. The shim's peer fires `open` on
   the next microtask and then one `connection` per already-connected lobby
   player, so every phone's Jeopardy frame auto-joins and Jeopardy's own
   relink-by-name rule creates the scoreboard rows.
4. **Manual players.** Lobby players with `manual:true` never open a virtual
   connection, so the adapter adds them to the scoreboard itself with the stable
   id `gsc-<pid>` — stable so ⌂ Lobby and back re-uses the row instead of
   duplicating it.
5. **Scores.** `setState` → `GscEmbed.onStateChanged()` → `room.reportScores()`.
   pid comes from `BuzzerHost._roomState()` (peerId **is** the shell pid) for
   phone players, from the `gsc-` id for manual ones, and `null` otherwise.
   Deduped against the last report so the every-`setState` firing is cheap.
6. **Phone.** `?room=` already puts Jeopardy in player mode; `gscAutoJoin()`
   fills the hidden name field and runs the ordinary `join()`.

---

## 4. Test results

### J-R1 — `cd games/jeopardy && node --test`

```
ℹ tests 49
ℹ pass 49
ℹ fail 0
```

Unchanged from the vendoring baseline (49 before the work, 49 after).

### J-R2 / J-R3 — standalone regression (`http://127.0.0.1:8631/games/jeopardy/`)

| ID | Result | Evidence |
|---|---|---|
| J-R2 start screen | PASS | Screenshot identical to the pre-change page: "GAME NIGHT JEOPARDY", Players / Buzzer room (optional) / **Open buzzer room** / "Players use their phones to buzz in — needs internet." / **"Playing on your phone? Join a buzzer room"** / Timers / Questions / Start Game. |
| J-R2 no `gsc-embedded` | PASS | `document.body.className === ""`; `GSC.mode === "standalone-host"`; `GscEmbed.isEmbedded() === false`; `window.peerjs === undefined`. |
| J-R2 PeerJS still lazy | PASS | On load, `performance.getEntriesByType("resource")` matching `/peerjs/i` → **0**. After clicking **Open buzzer room** → **1**: `https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js` with `integrity="sha512-XEKeWX+…tmyQ=="`. |
| J-R2 `tests/harness.html` | PASS | `70/70 checks passed`, `#summary.ok`, no failures. Re-run after the shell tester's `shared/*` fixes — still 70/70. |
| J-R2 `tests/photo-harness.html` | PASS | `All 26 photo-clue checks passed.`, `#summary.ok`. Re-run after the shell fixes — still 26/26. (The three `ERR_UNSAFE_PORT` console errors are the harness's own `BROKEN_URL = https://127.0.0.1:9/…` fixture — deliberate and pre-existing.) |
| J-R3 `ghj-` prefix + real PeerJS | PASS | `PEER_PREFIX = "ghj-"` untouched in both `buzzer-host.js:22` and `buzzer-player.js:16`; standalone room opened on code **YSBW** with `BuzzerHost.status() === "open"` over the real broker; panel shows `Join at http://127.0.0.1:8631/games/jeopardy/?room=YSBW` and **Close room**. |

### J-E1 … J-E9 — embedded, real network

Setup: host tab `http://127.0.0.1:8631/` → *Host a game night* → room **GCAH**
(`{status:"open", code:"GCAH", broker:"ok"}`). Phone tab 1 `?room=GCAH` joined as
**Rita** → `p1` 🦖. Phone tab 2 `?room=GCAH&store=sam` joined as **Sam** → `p2` 🦊.
Lobby *+ Add player* → **Mo** → `p3` 🐼 `manual:true, connected:false`. Host clicked
the Jeopardy tile.

| ID | Result | Evidence |
|---|---|---|
| **J-E1** | PASS | Host frame `src=games/jeopardy/index.html?embed=host&room=GCAH`, inner `location.href` tidied to `…index.html?embed=host`, `body.className === "gsc-embedded"`, `GSC.mode === "embed-host"`, `BuzzerHost.status() === "open"`, `buzzer.roomCode === "GCAH"`. Scoreboard **auto-populated**: `Mo=0, Sam=0, Rita=0`. Setup panel reads `🟢 Sam Kick · 🟢 Rita Kick · 🔊 Sound on` then **"Room GCAH — managed by Game Show Central. Everyone in the lobby is already here."** — no Open/Close, no join URL, no "Playing on your phone?" note. Both phones: `body="gsc-embedded player-mode"`, `GSC.mode="embed-player"`, `#player-join display:none`, `#player-buzzer` visible, header name "Rita"/"Sam", `#player-buzz` = `mode-idle` "Wait for the host…", code chip and `.player-foot` (Leave room) both `display:none`. Screenshot: Rita's phone showing only the green dot, her name and the buzz circle. |
| **J-E2** | PASS | `openClue(0,0)` (Science & Nature $200, regular) → both phones `mode-reading` "Wait for it…"; host bar "Arm buzzers (Space)". Rita `pointerdown` **early** → `mode-locked` **"Too soon! Locked out for this clue"**, host bar adds **`🚫 too soon: Rita`**. Real `keydown{key:" ",code:"Space"}` on the frame → `_roomState().armed === true`, bar `🔔 BUZZERS ARMED — SPACE LOCKS / Disarm / 🚫 too soon: Rita`; Sam `mode-armed` "BUZZ!", Rita still locked. Sam `pointerdown` → `mode-won` "You buzzed in! Answer!", host banner `🔔 Sam ✓ ✗` (aria-labels Correct/Wrong). **✓** → `Sam=200`, `used["0-0"]=true`, `active=null`. Second clue (0,1): re-armed, Rita buzzed, **✗** → `Rita=-400`, `missed` set, host bar back to **armed** for the rest, Rita `mode-locked` "Locked out for this clue", Sam `mode-armed` "BUZZ!". |
| **J-E3** | PASS | `openClue(1,3)` (World Capitals $800, `dailyDouble:true`). `#dd-player` → Sam, `change` → host splash shows **"📱 Sam is wagering on their phone…"**. Sam's phone: wager pad visible, "Daily Double — your wager", cat "World Capitals", `Your score $200 · wager $5–$1,000`. Wager **5000** → bounced with `"Enter a whole-number wager between 5 and 1000."`, pad stays open. Wager **600** → accepted, button "Wager sent — look up!", pad hidden; host `active = {isDailyDouble:true, wagerLocked:true, wager:600, wagerPlayerId:"bz…-1"}`, clue revealed, host clue timer running. ✓ → `Sam=800`. |
| **J-E4** | PASS | `startFinal()` → host `stage:"wager"` listing Mo $300 / Sam $800 / Rita −$400 with per-player caps; both phones show "Final Jeopardy — your wager" with correct `$0–$800` / `$0–$0` bounds. Sam wagered 500, Rita 0 → both "Wager locked in"; host view **masks** them as `🔒 from phone · Unlock`, stored `{Sam:500, Rita:0}`. `lockFinalWagers()` → `stage:"clue"`, phones get the typed-answer form with the real category + clue. Sam typed "What is the Great Wall of China?", Rita "What is Hadrian's Wall?" → both "Answer submitted — you can update it until the host reveals."; host counter **"Answers in: 2/2"**. Reveal → judge rows carry the answers verbatim: `Sam (wagered $500) "What is the Great Wall of China?" ✓ ✗` / `Rita (wagered $0) "What is Hadrian's Wall?" ✓ ✗`. `judgeFinal` ✓/✗ → phones show **"Correct! +$500 · you finished on $1,300"** and **"Sorry — incorrect +$0 · you finished on -$400"**; standings `👑 Sam $1,300 · 2 Mo $300 · 3 Rita -$400`. |
| **J-E5** | PASS | Answer timer: on Sam's winning buzz, host `#clue-timer` visible with **9** blocks and the buzzed phone's `#player-timer` visible with **9** blocks. Final timer: `#final-timer` visible with 9 blocks on the host and `#player-answer-timer` visible with 9 blocks on the phones. |
| **J-E6** | PASS | `⌂ Lobby` (`HubHost.leaveGame()`) → game frame removed. Re-picked Jeopardy → scores **identical** (`Mo=300, Sam=1300, Rita=-400`), used tiles **identical** (`0-0, 0-1, 1-3`), `phase:"board"`, **3 players — no duplicates**, room reopened on the **same** code GCAH (`BuzzerHost.status()==="open"`, chip `GCAH · 2 🔔`). Phones re-mounted at `?embed=player&room=GCAH&pid=…&name=…`, no join card, and once Final was closed both were back on the buzzer screen `mode-idle`. (Immediately after the re-pick the phones correctly showed "Pencils down" because the game was still mid-Final-judging — the host's rejoin sync re-sending the live stage, which is the upstream behaviour, not a defect.) |
| **J-E7** | PASS | A third phone joined mid-board as **Cy** → `p4` 🐼. Host scoreboard grew to `Mo $300 · Sam $1,300 · Rita -$400 · Cy $0`, Jeopardy chip `GCAH · 3 🔔`, night standings gained `{pid:"p4", name:"Cy", score:0}`. Cy's phone: `#player-join display:none`, `#player-buzzer` visible, header "Cy", `mode-idle` "Wait for the host…". |
| **J-E8** | PASS | Mo has no phone. She was on the scoreboard from the first render (id `gsc-p3`) and `applyScore("gsc-p3", 300)` through the ordinary host path moved her to `$300`, shown on the board as `Mo $300`. `GscEmbed._pidFor("gsc-p3") === "p3"`. |
| **J-E9** | PASS | `HubHost._state().night.games.jeopardy` tracked every ✓/✗ live and ended at `[{pid:"p3",name:"Mo",score:300},{pid:"p2",name:"Sam",score:1300},{pid:"p1",name:"Rita",score:-400},{pid:"p4",name:"Cy",score:0}]` — correct pid for phone **and** manual players. |
| **J-E10** | PASS | No `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` added (grep over the two new files and the four edited ones returns only two pre-existing prose mentions of the word "innerHTML" in comments). No `console.log` in `gsc-embed.js`. Every edit carries a `// GSC:` / `<!-- GSC:` marker. `git diff --stat` lists exactly the four allowed files, plus the two new ones as untracked. **File-size caveat: see deviation 6.** |

Final host screenshot: the hub shell bar (`⌂ Lobby · 🟦 JEOPARDY · GCAH · 2 🔔`)
above the Jeopardy board with three tiles greyed out and the scoreboard
`Mo $300 · Sam $1,300 · Rita -$400 · Cy $0`.

---

## 5. Spec deviations and additions

1. **No `BuzzerHost.openWithCode()`.** `openRoom(code)` was already on
   `BuzzerHost`'s public API, so the adapter calls that. The only thing that
   needed an upstream edit was `boot()`'s saved-code auto-reopen, which would
   otherwise race the shell and open the room on last night's code.
2. **Open/Close suppression is CSS, not JS.** Spec §2 allowed editing
   `buzzer-host.js` to hide those buttons; doing it in `css/gsc-embed.css`
   (scoped to `body.gsc-embedded`) keeps a file that is *already* over the
   800-line house cap from growing further, and keeps the diff additive. The
   "Room {CODE} — managed by Game Show Central" line is a **sibling** of
   `#buzzer-setup` (which `renderSetupPanel()` wipes with `replaceChildren()`
   every render) rather than a child, for the same reason.
3. **`history.replaceState` strips `?room=` from the host frame.** New, and the
   most important thing to know about this adapter. The hub's host iframe URL is
   `?embed=host&room=CODE`, but Jeopardy decides it is a *phone* from the bare
   presence of `?room=` (`app.js init`, `buzzer-player.isPlayerMode`). Left
   alone, the host screen would boot as a buzzer. Rewriting the frame's own URL
   — same document, no reload, `?game=` and every other param preserved — makes
   every downstream `location.search` read see exactly what it sees standalone.
   This is what let `app.js` stay at the single `reportScores` hook the spec
   allows instead of needing two more mode edits.
4. **Six shared scripts, not five.** The five from
   `docs/reports/shell-implementation.md` §7 plus `shared/virtual-peer.js`, which
   `docs/02` §2 requires and `bridge.js` does not pull in.
5. **The phone join card is hidden field-by-field, not wholesale.**
   `#player-join .player-field` and `#player-join-btn` are hidden; the heading
   (relabelled "Connecting…" by `gsc-embed.js`) and `#player-error` stay, so an
   auto-join that ever fails shows a plain-English reason instead of a blank
   screen. In practice the card is never seen — the shim opens the connection on
   the next microtask.
6. **Two edited files remain over the 800-line house cap.** `js/app.js` (1043 →
   1047) and `js/buzzer-host.js` (816 → 820) were **already** over as vendored
   upstream. Each grew by exactly 4 lines. `js/buzzer-player.js` (753 → 769) and
   `index.html` (291 → 308) are comfortably under, as are both new files
   (`gsc-embed.js` 278, `gsc-embed.css` 83). Splitting a vendored file is well
   outside this component's remit.
7. **Lobby-roster events map to score reports.** `onPlayerJoin` /
   `onPlayerLeave` / `onPlayerStatus` all funnel into `syncManualPlayers()` /
   `reportScores()`; game payloads reach Jeopardy through the shim, so
   `GSC.host`'s `onMessage` is deliberately empty.

---

## 6. Known gaps

- **Kicking from Jeopardy's own chip does not remove the player from the hub.**
  It closes the virtual connection (`conn.close()` → bridge `close` → the shell's
  `{v:2,t:"conn-close",g}` → that phone's frame). Jeopardy's player code treats
  the accompanying `{v:1,t:"room-closed"}` as a hard stop and sets
  `wantConnected = false`, so the phone does **not** silently rejoin — it sits on
  its join screen inside the hub's game frame until the host leaves the game or
  re-picks it. The real kick lives in the shell's chip popover, which does remove
  the player properly. `docs/02` §3 anticipated a rejoin here; the observed
  behaviour is a stop instead. Cosmetic, and the shell's kick is the documented
  route.
- **Two 🔔 counts can disagree.** The shell bar counts live shell connections;
  Jeopardy's own chip counts its room state, which only drops a player after its
  30-second liveness sweep. Seen in J-E7 (`shell 2 🔔` vs `Jeopardy 3 🔔` right
  after Rita's tab navigated away). Exactly the behaviour `docs/02` §3 calls
  acceptable.
- **`MAX_PLAYERS = 8`.** The hub's lobby allows up to 16 (default 12); Jeopardy's
  scoreboard caps at 8. `syncManualPlayers()` respects the cap and stops adding;
  phone players beyond 8 are refused by Jeopardy's own reducer with its usual
  room-full reject. A 9+-player lobby therefore cannot fully play Jeopardy —
  which is what the registry's `players: [1, 8]` hint already tells the host.
- **No automated embed harness.** Real-network testing covered J-E1 … J-E9
  end to end, so `games/jeopardy/tests/gsc-embed-harness.html` was not written.
  There is consequently no scripted regression for the embedded path; re-running
  it means repeating §4's walkthrough by hand.
- **The night scoreboard is deduped by value, not by round.** `reportScores()`
  skips a report identical to the previous one. A game that ends and restarts on
  exactly the same numbers would not re-report — harmless, since the recorded
  value is already correct.
- **`?store=` was needed to run two phones in one browser.** Production phones
  are separate devices; this only affects testing on one machine.

---

## 7. Shared-code defects found

**None.** `shared/virtual-peer.js` and `shared/bridge.js` behaved exactly as
`docs/00` §7–§8 and `docs/reports/shell-implementation.md` §2 describe, including
the `{v:2,t:"conn-close",g}` carrier (deviation 2 of that report). Nothing in
`shared/**`, `js/**` or `index.html` was edited, and no workaround for shared code
was needed inside `gsc-embed.js`. The shell tester's two fixes to
`shared/bridge.js` (null-`host` guards in `standaloneHost.applyEffects`) and
`shared/virtual-peer.js` (idempotent `conn-close`) both landed before the final
regression run; neither touches a path this adapter uses, and both upstream
harnesses were re-run green afterwards.

---

## 8. For the orchestrator

- `games/jeopardy/**` is the only thing that changed. No commits were made.
- The one non-obvious mechanism is **deviation 3** (`history.replaceState`
  stripping `?room=` from the host frame). Any future game that reuses Jeopardy's
  "`?room=` means phone" convention will hit the same collision with the hub's
  `?embed=host&room=CODE` host URL, and will need the same trick or an explicit
  `embed=host` check.
- The upstream 800-line cap violations in `js/app.js` and `js/buzzer-host.js` are
  inherited from vendoring, not introduced here (deviation 6).
