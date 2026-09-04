# Family Feud — implementation report

Component: `family-feud` · Spec: `docs/03-family-feud-spec.md` · Verification
plan: `docs/06-verification-plan.md` · Date: 2026-09-03

Environment: Windows 11 (10.0.22635), Node **v24.16.0**, Chromium via the
in-app browser, static server `python -m http.server 8620` at the repo root.

Status: **complete and green**. Unit suite 38/38, loopback harness 42/42, a full
host-only game played through the browser, and a real PeerJS room joined by a
second browser tab (T3 was **not** blocked in this environment).

---

## 1. Files

Everything below is new. Nothing outside `games/family-feud/**` and this report
was touched.

| File | Lines | What it is |
|---|---:|---|
| `games/family-feud/index.html` | 289 | host screens + phone screens in one page; `<body data-gsc-game="family-feud">`, `#gsc-join` container |
| `games/family-feud/questions.json` | 151 | 6 original survey rounds + 8 Fast Money questions |
| `games/family-feud/README.md` | 211 | host guide, JSON schema table, phone features, layout, known issues |
| `games/family-feud/css/feud.css` | 586 | host stage: palette, board tiles (flip), strikes, bank, Fast Money, standings |
| `games/family-feud/css/feud-phone.css` | 222 | phone controller + question editor |
| `games/family-feud/css/timer.css` | 73 | red-block clock, vendored from `games/jeopardy/css/timer.css` |
| `games/family-feud/js/feud-content.js` | 219 | **PURE** (UMD `FeudContent`): `validateGame` / `normalizeGame` / `warningsFor` / `sanitizeText` |
| `games/family-feud/js/feud-core.js` | 677 | **PURE** (UMD `FeudCore`): `createState` / `reduce` / selectors / `phoneView` / `validatePhoneMsg`; re-exports the content API |
| `games/family-feud/js/feud-app.js` | 728 | host glue: the one state object, `localStorage`, setup screen, board, controls, standings |
| `games/family-feud/js/feud-fm.js` | 332 | Fast Money host screen (answer sheet, reveal, duplicates, clock) |
| `games/family-feud/js/feud-editor.js` | 395 | question editor (Download JSON / Use in game / Reset / Start blank / auto-save draft) |
| `games/family-feud/js/feud-room.js` | 206 | `GSC.host` glue: roster, inbound payload validation, outbound `phoneView`s |
| `games/family-feud/js/feud-phone.js` | 209 | `GSC.player` glue: the phone controller |
| `games/family-feud/js/feud-boot.js` | 34 | picks host or phone mode and starts the right stack |
| `games/family-feud/js/feud-sound.js` | 125 | WebAudio cues (ding, strike, buzz-in, try-again, fanfare, round-end) |
| `games/family-feud/js/feud-timer.js` | 134 | red-block countdown DOM glue (trimmed sibling of Jeopardy's `timer.js`) |
| `games/family-feud/js/timer-core.js` | 57 | **PURE** countdown math, vendored verbatim from Jeopardy |
| `games/family-feud/js/data.js` | 377 | offline mirror of `questions.json` (generated) |
| `games/family-feud/tests/feud-core.test.mjs` | 619 | `node:test` unit suite, F-U1–F-U10 |
| `games/family-feud/tests/harness.html` | 613 | loopback browser harness, F-I1–F-I6 (it **is** the shell) |
| `docs/reports/family-feud-implementation.md` | — | this report |

Largest file 728 lines; no function exceeds 50 lines (checked by script).

## 2. How to run it

```bash
# unit tests
cd games/family-feud && node --test

# browser: host game, and the loopback harness
python -m http.server 8620            # from the repo root
#   http://localhost:8620/games/family-feud/
#   http://localhost:8620/games/family-feud/tests/harness.html
```

The harness reports into `#results li[data-pass]`, sets `#summary.ok` when
everything passes, and publishes `window.__FEUD_HARNESS__ = {total, failed,
uncaught, results}` for automation.

## 3. Test results

### T1 — unit (`cd games/family-feud && node --test`)

```
ℹ tests 38
ℹ suites 0
ℹ pass 38
ℹ fail 0
```

| ID | Result | Evidence |
|---|---|---|
| **F-U1** | PASS | 3 tests. `validateGame` accepts the shipped `questions.json`, the fixtures, a rounds-only file and an 8-answer question; rejects no rounds, 2 answers, 9 answers, count `0` / `101` / `12.5`, a duplicate answer text (case- and whitespace-insensitive), a blank question, a 201-char question, a 41-char answer, `fastMoney` with 4 questions while enabled, `strikes: 0` and `strikes: 6`, empty/zero multipliers, `timer1: 500`, non-string `title`. A separate test pins that 4 Fast Money questions are legal once `fastMoney.enabled` is `false`. |
| **F-U2** | PASS | `normalizeGame` sorts `["low","high","mid"] → ["high","mid","low"]`, fills `strikes 3`, `multipliers [1,1,2,3]`, `fastMoney {enabled:true,target:200,timer1:20,timer2:25}`, leaves the input untouched and is idempotent. `warningsFor` returns `[]` for the shipped file and exactly two messages ("Round 2: the counts add up to 130…", "Fast Money question 1: … 125") when counts are pushed over 100. |
| **F-U3** | PASS | 4 tests. Buzz A + reveal `#1` → `playpass`, `control 0`, `bank 50`. Buzz A + `#3` → podium passes to B; B's `#2` → `control 1`, `bank 40`. Two `notOnBoard` → still `faceoff`, message "…face off again", `faceoffAgain` clears the attempts, `giveControl` overrides to `playpass`. Unarmed phone buzz ignored; after `arm`, the first phone buzz lands and the second returns the same state object. |
| **F-U4** | PASS | `play` keeps control, `pass` flips it and moves to `play`. Strikes 1 → 2 (phase stays `play`) → 3 → `steal` with `{active:true, team:1, result:null}`. A `settings.strikes: 1` file opens the steal on the first strike. |
| **F-U5** | PASS | Steal success → stealing team gets `bank + stolen count` (50+30=80), the other team stays on 0, `result:"success"`. Steal fail → controlling team gets the bank, `result:"fail"`; stealing an already-revealed tile is a no-op. Clearing every answer → `roundover`, `reason:"cleared"`, 90 to the controlling team, no steal. `revealRest` fills the board without changing scores and is a no-op when full. |
| **F-U6** | PASS | `multiplierFor` = 1,1,2,3,3,3 for round indexes 0,1,2,3,4,11. Playing round 3 out banks 77 and awards **154** (77 × 2). `nextRound` stops once `roundsToPlay` is reached. |
| **F-U7** | PASS | `undo` deep-equals the pre-event state and shares the same `game` object. A five-step sequence unwinds step by step, each one deep-equal to the recorded trail. `undo` on an empty history returns the same object; 45 recorded events leave `history.length === 30` (`HISTORY_MAX`, ≥ the 20 the spec asks for) and no history entry carries `game` or a nested `history`. |
| **F-U8** | PASS | 5 tests: totals (60+5+0 = 65), duplicate → `duplicate:true, points:0` while a different answer to the same question scores normally, target reached → `stage:"done"`, `winner:true`, message "Fast Money winner!"; falling short → `winner:false`, "So close!". `fmTimer start` sets `{running:true,startedAt:1000,seconds:20,slot:1}` and leaves `stage:"play"` — a stopped clock still accepts a late answer. `fmAnswer` refuses another player's `pid`, a revealed row, junk slots/indexes. |
| **F-U9** | PASS | Table-driven: 26 events × 8 phases. Every event not in the phase's legal list returns the **same** state object. A second test deep-freezes the state in each phase and fires all 26 events plus 15 junk payloads (`null`, `"buzz"`, `[]`, `{type:7}`, out-of-range indexes, `team:"C"`, `score:1.5`) — nothing throws and the frozen state is unchanged. |
| **F-U10** | PASS | `validatePhoneMsg` accepts the three documented payloads and drops extra fields (`{t:"buzz",pid,admin}` → `{t:"buzz"}`); strips `NUL`/`ESC` from `"  Ap\0ple\x1B  "` → `"Apple"`; caps 200 chars at 60; rejects 17 junk shapes. `phoneView` returns `team-pick` / `faceoff` (armed, at-podium, with the question) / `wait` for a bystander / `result` / `fm-answer` / `fm-wait`. Player 2's view never contains `"SECRET-ONE"` (player 1's typed answer) before or during their own turn, and no board answer text ever reaches a phone. `teamOfPid` / `podiumFor` follow the roster and fall back when an off-roster pid is pinned. |

### T2 — loopback (`tests/harness.html`)

`All 42 loopback checks passed.` (`__FEUD_HARNESS__.failed === 0`,
`uncaught === null`). The harness loads the real page in one `?embed=host`
iframe and four `?embed=player` iframes and speaks the bridge protocol from
00 §6 itself — no PeerJS, no hub.

| ID | Result | Evidence (harness detail lines) |
|---|---|---|
| **F-I1** | PASS (5 checks) | Four phones land on the host roster (`Ana, Ben, Cleo, Dev`); all four open on `team-pick`; taps produce `p1+p3 \| p2+p4`; the host's "Put Cleo on team B" toggle moves her (`Cleo is on team 1`) and the phone is pushed `team B`. |
| **F-I2** | PASS (8 checks) | Only the two podium phones get the buzzer (`p1:faceoff p2:faceoff p3:wait p4:wait`); an unarmed buzzer is `disabled`; an early tap leaves `buzzed=null` with **no lockout**; arming lights both phones; the first buzz wins (`buzzed=1`) and the second is ignored; phones read "You buzzed!" / "Too late"; revealing `#3` passes the podium (`phase=faceoff buzzed=0`) and `#1` takes control (`phase=playpass control=0`). |
| **F-I3** | PASS (12 checks) | Fast Money seats `team=0 players=p1,p3`; player 1 gets `fm-answer` with 5 questions; player 2 sees "Cover your ears!"; p2/p4 stay on `wait`; five typed phone answers arrive as `Strawberry\|Butter\|Restaurant\|Lion\|Read a book` in both the state and the host's inputs; reveals total **177**; player 2's view and the host's visible table both contain no trace of "Strawberry"; the repeated "Butter" is `duplicate=true points=0` with the `.fm-row.duplicate` styling and the "Try again — duplicate" flag; the target is cleared (`Winner! …`); the shell received `title=Fast Money` and a `scores` array. |
| **F-I4** | PASS (2 checks) | Reload mid-round: before `{phase:"play",round:0,revealed:"true,true,true,false,false",strikes:2,control:0,bank:77,history:15,roster:4}` — after identical; the restored board repaints 3 revealed tiles. |
| **F-I5** | PASS (8 checks) | Download JSON emits an `application/json` blob; it passes `validateGame`; it is byte-identical to `FeudEditor.cleanDraft()`; the error line is empty. Pushing a count to 95 turns the badge amber (`Sum 140 ⚠`) with the words "…can't total more than 100" and the draft **still validates** (warning, not failure). Use in game switches the session to "Harness Edition" with `Questions: question editor` and the edited count (95) at the top of the board. |
| **F-I6** | PASS (7 checks) | Every component file served; zero markup-injection / dynamic-code sinks; zero `console.log`; every file under 800 lines (the harness prints all 18 counts); the only external URLs are Google Fonts; the phone controller writes only through `textContent`; the page carries `data-gsc-game="family-feud"` and `#gsc-join`. |

### T3 — real network (two browser tabs, real PeerJS broker) — **PASS, not blocked**

- Standalone host → **Open room (phones)** → `Room EGTM is open — phones can join.`
  and `Players open http://localhost:8620/games/family-feud/?room=EGTM and enter EGTM.`
- Second tab at `?room=EGTM&name=Phoebe` → `mode:"standalone-player"`,
  `player-mode` on `<body>`, first view `{screen:"team-pick"}`.
- The phone tapped **Team A** → host roster `[{Phoebe, phone:true}]`, teams
  `[["p1"],[]]`, phone badge `Team A`.
- Host **Start the Feud** → **Arm buzzers**; the phone's button went from
  disabled `Wait…` to enabled `BUZZ`; tapping it produced host
  `buzzed=0` with hint *"Team Blue answers — click the matching tile…"* and the
  phone repainted to `You buzzed!`.
- `?room=CODE` with no `name` renders the SDK's own join card into `#gsc-join`
  (`"Join the roomRoom codeYour nameJoin"`, 2 inputs).

### T4 — standalone / host-only regression

A complete game was played in the browser with **no phones at all**:

- Setup: 4 manual players added, A/B toggles assigned, `Team Blue` / `Team Red`.
- Round 1 face-off: Blue buzzed, revealed `#3` (12) → podium passed to Red →
  Red revealed `#2` (17) → `control 1`, `bank 29`; **Pass** → Blue playing;
  reveal `#1`; three strikes (the big red ✕ overlay fired each time, marks
  `✕`, `✕✕`, `✕✕✕`) → `steal` for Red at `bank 77`; Red stole `#4` →
  `{team:1, points:86, reason:"steal"}`, banner *"Round over — Team Red takes
  86"*; **Let's see the rest** filled the board.
- Round 2: both podiums **Not on the board** → *"Nobody hit the board. Face off
  again…"* → **Face-off again** → **Give control to Team Blue** → **Play** →
  board cleared → `{team:0, points:97, reason:"cleared"}`.
- Rounds 3–6 confirmed the multiplier ladder: `×2 → 192`, `×3 → 285`,
  `×3 → 276`, `×3 → 279`. Final scores Blue 565 / Red 650.
- Undo twice from the cleared board rewound the award and one reveal exactly,
  leaving the 4-player roster intact.
- Reload mid-round restored `phase/round/revealed/strikes/control/history/roster`.
- Fast Money host-typed: clock started (9 lit red blocks), five answers typed
  **by the host** with the caret preserved across the per-keystroke re-render,
  reveals → 177, "Player 2 — cover your ears!" interstitial, player 2's answers
  with a duplicate ("Butter") flagged and scored 0, total **278 of 200** →
  *"Winner! Team Red takes the grand prize."* with the fanfare.
- Final standings: `Team Blue 565` / `Team Red 650 Winner`, note *"Fast Money:
  278 of 200 — winners!"*. **Play again** reset to round 1 with scores 0 and the
  same line-ups; **Back to setup** returned to setup with the roster intact.

### T5 — static gates

| Gate | Result |
|---|---|
| **V1** `node --test` exits 0 | PASS (38/38) |
| **V2** files < 800 lines, functions < ~50 | PASS (max file 728; a script over `js/**` and the test file found no function ≥ 50 lines) |
| **V3** no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` — tests included | PASS (`grep -rn … games/family-feud` → no matches) |
| **V4** no `console.log` | PASS (no matches; diagnostics use `console.warn`) |
| **V5** no Peer / connection / DOM / timer handle in state | PASS by construction: the SDK `room` handle lives in a `FeudRoom` closure, the countdown lives in `FeudTimer` module state, and the only timer data in state is the serialisable `fastMoney.timer = {running, startedAt, seconds, slot}` cue |
| **V6** external URLs | PASS — only `fonts.googleapis.com` / `fonts.gstatic.com`. This game loads **no** CDN script of its own; PeerJS is pulled lazily by `shared/room-host.js` |
| **V7** `data-gsc-game`, `#gsc-join`, `player-mode` / `gsc-embedded` | PASS (F-I6 + T3) |
| **V8** `?game=URL` and upload go through `validateGame` | PASS by code (`fetchGameData` and `handleCustomFile` both call `FeudCore.validateGame`); the editor path is covered by F-I5 |

## 4. Phone integration status

**Verified against the real SDK.** `shared/bridge.js`, `room-protocol.js`,
`room-net.js`, `room-host.js`, `room-player.js` and `theme.css` all existed by
the time I reached step 4, and I read `bridge.js` before wiring anything. Both
paths are exercised:

- **Embedded** (`?embed=host` / `?embed=player`): the loopback harness drives
  the real `GSC.host` / `GSC.player` code over the real postMessage bridge
  (the harness only plays the shell's part).
- **Standalone with a real room**: a genuine PeerJS room was opened and joined
  from a second tab over WebRTC (see T3).

Notes on the SDK as built:

- `room.onStatus(fn)` hands back `{status, code, error, broker}` while
  `room.status()` returns `{open, connecting, error, code}`. `FeudRoom` ignores
  the callback argument and re-reads `room.status()`, so both shapes are fine.
- In embedded mode `room.onStatus`, `open`, `close`, `kick`, `reportScores` and
  `setTitle` are the documented no-ops / shell relays; `FeudRoom` feature-checks
  before calling and returns early from the room chrome when embedded.
- `room.reportScores` takes `[{pid,name,score}]`, which is per-player; Feud
  scores are per-team, so each player is reported with their team's score (and a
  synthetic `team0`/`team1` row for a team with no phones).

Two bugs were found and fixed by this verification:

1. **`#screen-player` never unhid** — `.hidden` uses `!important`, so the CSS
   rule `body.player-mode #screen-player { display: block }` could not win. The
   phone rendered a blank page. Fixed in `js/feud-phone.js` (`show($("screen-player"), true)`
   in `init`).
2. **A reconnecting phone got a blank screen** — `FeudRoom` skips re-sending an
   unchanged `phoneView`, and a refreshed phone keeps its `pid`, so nothing was
   ever pushed to it. Fixed by clearing that pid's cache entry on
   `onPlayerJoin` / `onPlayerStatus` (`js/feud-room.js`).

## 5. Spec deviations (all documented, none behavioural regressions)

1. **`feud-core.js` was split in two.** Content validation lives in
   `js/feud-content.js` (UMD `FeudContent`); the single file was 871 lines,
   over the 800-line house rule. `FeudCore` re-exports the whole content API, so
   `FeudCore.validateGame` / `normalizeGame` / `warningsFor` are exactly what
   the spec asks for and nothing else had to change.
2. **`js/feud-fm.js` is a fifth glue file** (spec §7 lists four). The Fast Money
   screen would have pushed `feud-app.js` past 800 lines. `js/feud-boot.js` was
   likewise split out so the host and phone stacks share one entry point.
3. **`settings.fastMoney.enabled` defaults to `true` only when the file carries
   Fast Money questions**, otherwise `false`. The spec's literal default (`true`)
   would make every rounds-only file fail validation. F-U1 pins both halves:
   4 Fast Money questions with Fast Money on is an error; the same file with
   `enabled: false` is legal.
4. **Fast Money questions use the same 3–8 answer rule as rounds** (the spec
   says "same answer rules"; this makes it concrete).
5. **Reducer events added** beyond the spec's list, all additive:
   `arm{on}` (host arms the phone buzzers — the spec's §5 phone screen needs it),
   `setPodium{team,pid}`, `setTeamName`, `setRoundsToPlay`, `setFastMoney{on}`,
   and `fmAdvance` (one event driving the documented Fast Money stage machine
   `play → reveal → cover → play → reveal → done`, instead of several ad-hoc
   ones). `fmTimer` takes `{action:"start"|"stop"|"reset", seconds?, now?}`.
6. **Face-off podium default** is a rotation: `team.players[roundIndex % n]`,
   so "the next unused player of each team" is deterministic and needs no extra
   state. The host can pin a player with `setPodium`.
7. **Score editing uses `window.prompt`** (the spec says "editable by click,
   Jeopardy behaviour"). Reachable, keyboard-friendly and short; a bespoke
   inline editor would have been more code for no gain.
8. **Timer files vendored from Jeopardy** rather than imported across game
   folders: `js/timer-core.js` (verbatim, banner changed) and `css/timer.css`
   (Jeopardy's setup-screen section dropped). `js/feud-timer.js` is a trimmed
   `timer.js` with two slots (host + phone). Cross-game relative imports would
   have coupled two components that are meant to ship independently.
9. **`feud.css` also defines `.btn`, `.hidden`, `.visually-hidden`, `.error-msg`
   and the shared tokens.** It loads after `shared/theme.css`, so the game's
   values win — deliberate, so the page is fully styled when opened straight
   from disk or before the shell exists. If the hub later wants games to inherit
   theme tokens instead, delete the duplicated block from `:root` in `feud.css`.
10. **Sudden death is omitted**, as the spec instructs.

## 6. Known gaps

- **No automated visual regression.** Board flip, strike overlay and the win
  flourish were checked by eye in the browser; `prefers-reduced-motion` is
  honoured in CSS (`.tile-inner` transition, `strike-pop`, `fm-flash` and the
  `.btn` transition all disabled) but is not asserted by a test.
- **Sound is not asserted.** `FeudSound` is a thin WebAudio wrapper; the cues
  were heard-by-inspection only (no AudioContext assertions in the harness).
- **Only two teams.** The TV format is two teams and the spec's state shape says
  `teams:[…]` with A/B throughout; more teams would need `phoneView`, the team
  panels and the face-off logic reworked.
- **`room.kick` is not surfaced** on the standalone setup screen (removing a
  phone player is the shell's job when embedded; standalone hosts can only set a
  player to "–"). Easy to add if the orchestrator wants it.
- **No `?game=URL` browser check.** The code path is shared with the upload path
  (both call `validateGame`) and the upload path is covered, but a live
  `?game=` fetch was not exercised in a browser this session.

## 7. What the orchestrator should know

- Nothing outside `games/family-feud/**` and this report was created or edited,
  and no git command was run.
- `shared/*` was consumed exactly as documented in 00 §7; no changes to it are
  needed for this game. The only friction points are the two `onStatus` /
  `status()` shapes and `reportScores` being per-player — both worked around
  inside `feud-room.js`, but they may be worth aligning across games.
- No server is left running. The tester should start their own from the repo
  root (`python -m http.server 8620`) before opening the game or the harness.

---

## 8. Fixes after verification

The independent tester's report (`docs/reports/family-feud-verification.md`,
verdict *fix-then-ship*) is the source for the ids below. D1, D3 and D4 were
fixed by the coordinator; D2 turned out to be a shell bug and is fixed there.
This section covers the rest, which are mine.

Re-run after the changes: **`node --test` 87/87 pass** (38 F-U + 49 adversarial),
**harness 51/51 pass** (`All 51 loopback checks passed.`,
`__FEUD_HARNESS__ = {total:51, failed:0, uncaught:null}`), served from
`python -m http.server 8642 --bind 127.0.0.1` at the repo root.

### D6 (minor, privacy) — a new room no longer inherits the old room's seats

Shell pids (`p1`, `p2`, …) restart at `p1` in every room, but the saved game
keyed team line-ups, the face-off podium and the Fast Money seats by pid. A new
phone issued `p1` inherited the previous session's seat — and, on a Fast Money
seat, was shown that player's typed answers.

The saved state now carries the **room code** it belongs to (`state.roomCode`,
an `APP_FIELDS` entry so `undo` cannot rewind it, defaulting to `null` on saves
written before this change). `FeudApp.bindRoom(code)` is called by `feud-room.js`
the moment a code is known — from `init` when embedded, from `room.onStatus`
when standalone, i.e. **before any phone can join**. When the code differs from
the stored one it drops every pid that is not a hand-typed player from
`teams[].players`, `faceoff.podium` and `fastMoney.players`, **including in every
history snapshot**, so an undo cannot resurrect them. Binding to the same code
is a no-op, so a refresh or a lobby round trip keeps everyone seated.

Vacating the seat is enough to close the leak: with `fastMoney.players` cleared,
`phoneView` returns the plain `wait` screen and carries no `fm` slice at all, and
seats can only be re-filled by `beginFastMoney`, which resets the sheet. The
host's own typed answers are deliberately **kept** — they are the host's work,
on the host's screen, and no phone can reach them.

- Files: `js/feud-app.js` (`bindRoom`, `withoutPhoneSeats`, `APP_FIELDS`,
  `loadSavedState`, `stateForGame`, `keepFromState`), `js/feud-room.js` (`init`).
- New coverage: **F-I7**, nine harness checks that seat two phones and a
  hand-typed player, type `OLD-ROOM-SECRET` onto the Fast Money sheet, rewrite
  the saved room code to `OLD`, reboot into room `TEST`, and assert the phone
  seats are gone, the hand-typed player keeps his, the Fast Money seats are
  `[null, null]`, a fresh `p1` gets `screen:"wait"` with no trace of the secret,
  every history entry is scrubbed, the host keeps their sheet, and re-binding to
  the same room changes nothing.
- Also verified live on the standalone page: opening a real room stamped
  `roomCode: "RJJJ"` into the state and into `localStorage`; binding to a
  different code dropped the phone pid (`[["p1"],["m1"]] → [[],["m1"]]`) and kept
  the hand-typed one; a second bind to the same code changed nothing.

### D5 (minor) — a 0-second Fast Money clock says so instead of doing nothing

`timer1`/`timer2` of `0` is legal content meaning "no clock", but the **Start
timer** button was still rendered and silently inert. `feud-fm.js` now renders a
plain-English note in the clock group instead of the two buttons when
`clockSeconds(state) === 0`; `Lock in — reveal the answers` is unaffected. The
reducer is unchanged, so the tester's `ADV Fast Money timers: 0-second timers…`
test still holds.

- Files: `js/feud-fm.js` (`playControls`), `css/feud.css` (`.control-note`).
- Verified live: on a `timer1: 0` file the controls read
  *"Clock · No clock — this question file sets the timer to 0. · When they're
  done · Lock in — reveal the answers"* with no timer button; on the shipped
  20-second file the group still reads *"Clock (20s) · Start timer · Stop"* and
  starting it paints 9 red blocks.

### D8 (minor) — the score prompt requires a whole number

`Number.parseInt("12abc", 10)` was accepted as `12`. The prompt now tests
`/^-?\d+$/` against the trimmed input and otherwise shows the existing message.

- File: `js/feud-app.js` (`editScore`).
- Verified live: `12abc` → score unchanged at `0` with *"That score wasn't a
  whole number — nothing changed."*; `12.5` → same refusal; `  -40  ` → accepted
  as `-40`; Cancel → no change.

### D7 (informational) — `fmReveal` checks the active slot

`fmReveal` accepted a reveal for the slot that is not up, which skipped duplicate
detection (it only reads slot 1) and could double-count a board answer. Now
guarded with `if (slot !== s.fastMoney.slot) return s;`, so the pure core no
longer relies on the host UI to stay honest. Unreachable through the shipped UI
either way.

- File: `js/feud-core.js` (`HANDLERS.fmReveal`).
- The tester's `ADV known looseness: fmReveal does not check the active slot`
  pinned the old behaviour (`fmTotal === 120`), so it was rewritten in place as
  **`ADV D7 regression: fmReveal ignores a slot that is not the active one`** —
  same fixture, now asserting the out-of-band reveal is a reference-identical
  no-op, that the legitimate order still flags the duplicate (`fmTotal === 60`),
  and that a stale slot-1 reveal after player 2 is up is ignored too. It is the
  only test I changed.

### Report correction

The tester was right that *"Fast Money reveals are top-down"* was wrong:
`feud-fm.js` renders a `<select>` for **every** unrevealed row during the reveal
stage, so out-of-order reveal already works. That line is removed from §6 above
and from the README's known issues. (My harness's `revealAll` helper takes the
first select each time, which is what misled me.)

### Housekeeping

- `tests/feud-adversarial.test.mjs` reached 801 lines after the D7 rewrite,
  breaking gate **V2**; the replacement test was tightened to bring the file to
  797. The harness's F-I6 line-count/sink gate predated that file and never
  scanned it — it is now in `SOURCE_FILES`, so all three test files are gated
  (`tests/feud-adversarial.test.mjs=798` appears in the F-I6 evidence line).
- Static gates re-run clean: no markup/dynamic-code sinks, no `console.log`,
  every file under 800 lines (largest product file `js/feud-app.js` at 771), no
  function ≥ 50 lines, no new external URLs, no console errors in the browser.
- No server is left running.

### Still open from the tester's list

- **D2** (a phone joining mid-game is never wired to its game iframe) is
  shell-side; the coordinator reports it fixed there. Nothing in this component
  changed for it — Family Feud already recovers as soon as the shell re-inits it.
- The tester's caveat on deviation 7 stands: `window.prompt` score editing would
  die silently if the shell ever added `sandbox` to the game iframe.
- The tester's note on deviation 9 stands: `feud.css` re-declares the shared
  tokens and `.btn`, so a future change in `shared/theme.css` will not reach this
  game until that duplicated `:root` block is deleted.

---

## 9. Cross-cutting round (docs/19)

Scope: §1 the Game lobby control, §2 the question-set library, §3's
`?store=NAME` namespacing. §3's three game fixes are other components'.

Re-run after the changes: **`node --test` 87/87**, **harness 84/84**
(`All 84 loopback checks passed.`, `uncaught: null`) served from
`python -m http.server 8642 --bind 127.0.0.1`. 33 of those 84 are new
(17 X-1, 9 X-2, 7 X-3).

### §1 — the Game lobby control

`btn-game-lobby` ("⟲ Game lobby") sits in the host toolbar between Sound and
Question Editor, visible from every phase except setup, where there is nothing
to park. It opens a real `role="dialog" aria-modal="true"` confirm (Esc and
Cancel close it, focus lands on the first choice) offering:

- **Keep this game** — snapshots the game into `state.resumable` and returns to
  setup, which then shows a **Resume this game** card naming the round and the
  scores. Resume restores the snapshot exactly, undo history included.
- **Start over** — clears the game; roster, content, team names, rounds-to-play
  and the Fast Money setting all stay.

The snapshot stores everything but the content and any nested snapshot, so it
costs a few KB and cannot recurse. It rides in the saved state, so a parked
game survives a reload. Loading new content (upload, editor, a library set) or
pressing Start retires it, because a snapshot taken against different questions
could not be restored honestly.

- Files: `js/feud-setup.js` (the whole flow), `js/feud-app.js`
  (`render` visibility, `startGame`, persistence tolerance), `index.html`,
  `css/feud.css`.
- Verified embedded by X-1's 17 harness checks and standalone by hand:
  `mode:"standalone-host"`, label `⟲ Game lobby`, dialog opens with focus on
  Keep, Esc closes, Keep → Resume → `resumedExactly: true`, Start over →
  `{phase:"setup", bank:0, strikes:0, scores:[0,0], card:false}` with the
  content and hand-typed roster intact.

### §2 — the question-set library

`sets/index.json` lists two new sets committed beside the default file, each
6 rounds + 6 Fast Money questions of original, family-friendly content:
**Kids' night** (`kids.json`) and **Office party** (`office.json`). Both pass
`validateGame` with no `warningsFor` output.

`GSCLibrary.mountPicker` is mounted into `#questions-library` under the existing
Questions section, wired to this game's own `validateGame`; `onPick` routes
through a new `useContent()` that sets the source note to `set: <name>`. The
picker is entirely optional — no `shared/library.js`, no `sets/` folder or a
page opened from disk and it says so in plain English and hides itself.

The editor gained **Download for the library**: it saves the draft under a file
name derived from the title (`office-party.json`) and prints the two paths to
commit plus the exact `sets/index.json` line, which the shared
`GSCLibrary.parseManifest` accepts. The note retires itself the moment the draft
changes again, so it can never name a stale file.

- Files: `sets/index.json`, `sets/kids.json`, `sets/office.json`,
  `js/feud-setup.js` (`useContent`, `mountLibrary`), `js/feud-editor.js`
  (`saveFile`, `libraryFileName`, `downloadForLibrary`, `showLibraryNote`),
  `index.html`, `css/feud.css`.
- X-2 pins the listing, the preview line, a real load (`set: Office party`,
  6 rounds, still playable), a set that fails `validateGame` being refused with
  the validator's own words while the current content stays put, a broken
  manifest, and the from-disk case. X-3 pins the export end to end.

### §3 — `?store=NAME`

`feudStoreSuffix()` (same shape as `games/price-is-right`) namespaces both
`gsc-family-feud-state-v1` and `gsc-family-feud-draft-v1`; the harness runs on
`?store=harness`. Confirmed live: three independent keys coexist on one origin
(`…-v1`, `…-v1-harness`, `…-v1-manual`).

### Two bugs this round surfaced

1. **The cross-file export was evaluated too early.** Splitting the setup half
   out meant `window.FeudApp = { useContent, … }` in `feud-app.js` referenced
   functions that had not been defined yet, and the page died on load with
   `useContent is not defined`. The five cross-file names are now thin wrappers
   that resolve at call time.
2. **The Start button kept its "Start a fresh game" label** after the parked
   game was resumed or discarded, because `renderResumeCard` only set the label
   in the parked branch. It now sets it both ways — caught by X-1, which failed
   with `no enabled button "Start the Feud"` on the first run.

### Housekeeping

- `js/feud-app.js` reached 936 lines once the lobby and library landed, so the
  setup screen, the picker and the lobby flow moved to **`js/feud-setup.js`**
  (306 lines; `feud-app.js` is now 648). `tests/harness.html` reached 981, so
  the X scenarios moved to **`tests/harness-x.js`** (298 lines; the harness is
  now 712), which the harness loads and hands a helper kit. Both new files are
  in the harness's cache-refresh list and its F-I6 gate.
- `shared/theme-components.css` is now linked (the picker's `.gsc-library`
  styles live there). Every selector in it is `.gsc-*`, so nothing in this
  game's own sheet is affected; it loads before `css/feud.css` so the Feud
  palette still wins.
- Static gates re-run clean: 21 files, largest 798 (the tester's suite), largest
  product file `css/feud-board.css` at 721; no markup or dynamic-code sinks, no
  `console.log`, no new external URLs, no console errors.
- Spec deviation to note: docs/19 §1 says the control is "next to Sound /
  Editor"; here it sits **between** them.
- No server is left running.
