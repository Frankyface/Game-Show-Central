# Password — implementation report

Component: `password` · Owns `games/password/**` · Spec: `docs/13-password-spec.md`
Built: 2026-09-04 · Node v24.16.0 · Windows 11 · Chromium (in-app browser)

---

## 1. What was built

A classic `Password` for two teams of two: both givers see the same secret word,
the teams alternate one-word clues, and the word slides 10 → 1 down a lit gold
ladder. First to 25 wins the game and plays the Lightning Round. Playable end to
end with **no phones at all**, and playable with phones as the intended
experience.

| File | Lines | What it is |
| --- | --- | --- |
| `index.html` | 375 | host screens + phone screens in one page, `<body data-gsc-game="password">` |
| `words.json` | 215 | 200 original, common, family-friendly passwords + settings |
| `js/data.js` | 228 | generated mirror of `words.json` (a unit test asserts they are identical) |
| `js/pwd-content.js` | 276 | PURE: the JSON contract, normalisation, the word order (UMD → `PwdContent`) |
| `js/pwd-core.js` | 729 | PURE: the reducer and every selector (UMD → `PwdCore`, re-exports content) |
| `js/pwd-view.js` | 438 | host rendering + the four DOM helpers |
| `js/pwd-app.js` | 774 | host glue: state, persistence, setup, buttons, hotkeys, clock, sound, splash |
| `js/pwd-clock.js` | 104 | rAF + interval clock renderer (copied in shape from `pyr-clock.js`) |
| `js/pwd-sound.js` | 128 | WebAudio cues behind the shared `gsc-sound` preference |
| `js/pwd-editor.js` | 272 | the in-page word editor (one password per line) |
| `js/pwd-room.js` | 209 | host glue on `GSC.host` |
| `js/pwd-phone.js` | 245 | the phone controller |
| `css/pwd.css` | 774 | host styles |
| `css/pwd-phone.css` | 157 | phone styles |
| `tests/pwd-core.test.mjs` | 677 | 54 `node:test` cases (PW-U1 … PW-U10) |
| `tests/pwd-fixtures.mjs` | 110 | deterministic builders + the leak assertion |
| `tests/harness.html` | 787 | 74 loopback checks (PW-I1 … PW-I6) |
| `tests/fixtures/harness-game.json` | 75 | the small, fast game the harness plays |
| `README.md` | 199 | hosting, the JSON table, phone features, layout |

Every file is under the 800-line cap; the largest is `tests/harness.html` at 787.

## 2. The secret-password requirement (spec §3/§4) — how it is enforced

This is the heart of the game and it is enforced in three independent places.

**1. The core.** `PwdCore.phoneView(state, pid)` is the only masked surface.
In the `word` phase only the branch for `giverPids(state).indexOf(pid) >= 0`
builds an object with a `word` key at all — **both** givers, because both are
shown the same password; in the Lightning Round only `pid === lightning.giverPid`
does. Every other branch — either receiver, the other team, a spectator, a giver
after the word is over — returns an object that has no such key. Unit test
**PW-U10** serialises every view for every pid in every phase and asserts that
neither the password in play nor any Lightning word appears as a substring
(`assertNoLeak` in `tests/pwd-fixtures.mjs`; fixture words are all the same
length so a plain substring search cannot give a false result).

**2. The host DOM.** `renderWordPanel` and `renderLightningPanel`
(`js/pwd-view.js`) build their children only while the host has explicitly asked
to see the word, and call `replaceChildren()` first. There is no hidden node
parked with the password in it, because a hidden node still shows up in a
DOM-text check — and, more to the point, in a screen share the moment a
stylesheet fails to load. The ladder, the counters and the clue log carry
numbers, team names and outcomes but never a word, so the whole screen is safe
on a shared display at any moment while a word is live. Once the word is over
the password **is** printed with the clue count, which is the show's own rule.

**3. The transport.** `pwd-room.js` sends each phone `phoneView(state, thatPid)`
and nothing else; there is no broadcast of game state.

Harness check **PW-I1** asserts the positive and the negative in the same
breath: both givers' `#pwd-phone-word` equals `state.round.word`, and
`hostDocument.body.textContent.indexOf(word) < 0`. **PW-I4** does the same for
all the Lightning words. Both were also confirmed live over the real PeerJS
broker (§6).

## 3. The rules, and where each one lives

| Rule (spec §1) | Where |
| --- | --- |
| ladder 10, 9, 8 … 1 | `valueAfter(state, clues)` = `startValue - max(0, clues - 1)`; selector `value(state)` |
| a correct guess scores the current value | `guessCorrect` |
| dead after ten clues | `guessWrong` / `evIllegal`: `dead = clues >= startValue` |
| the loser of the last word opens the next | `afterWord`: `first = won === null ? 1 - firstTeam : 1 - won` |
| host override of who opens | `evSetFirst`, refused once a clue is out |
| illegal clue forfeits the clue: control passes **and** the value drops | `evIllegal` |
| target reached mid-word ends the game | `guessCorrect` → `phase: "gameOver"` |
| roles swap between words | `rolesFor(state, team)` off `wordsPlayed % 2` |
| Lightning: N words in T seconds, V each, all of them doubles | `evToLightning` / `lightningOutcome` |
| passing allowed; passed words come back | `nextIndex` cycles `pending`/`passed` |
| the buzzer does not cut off the word in flight | `evLightningMark`: `finished = l.expired \|\| next < 0` |
| money to both members, and to the hub scoreboard | `standings()` + `pwd-room.js reportProgress` |
| several games a night, money carries, points reset | `evNextGame` + `bankGame` (idempotent) |

**The illegal clue, both ways round.** The host may press *Illegal clue* before
*Clue given* (they heard two words) or after it (they only realised once the
receiver started guessing). `evIllegal` counts the clue only when it has not
been counted already, so the ladder moves exactly one rung either way and the
receiver never gets a guess on an illegal clue. Harness **PW-I3** pins the
after-the-fact case, unit test PW-U4 both.

## 4. Deviations from the spec, and why

1. **`js/pwd-view.js` is a split out of `pwd-app.js`.** Spec §6 lists one
   `pwd-app.js`; together they are 1,212 lines, well over the house cap. This is
   the same accepted deviation Feud, Wheel, Weakest Link and Pyramid took. No
   API changed — `window.PwdApp` is still the whole public surface, and
   `PwdView.render(app)` is the only thing app calls.
2. **One extra event, `lightningPause`.** Spec §4 lists `lightningStart` and
   `lightningExpired` but no pause. A host needs to stop the clock when somebody
   knocks at the door, and a restored save needs somewhere to resume from. It is
   in `NO_HISTORY` with the other clock events, so it leaves no undo step.
3. **`nextWord` is the generic "move on".** Spec §4 lists `nextWord` and no
   separate event for Lightning → result → standings, so `nextWord` does all
   three (the same shape as Pyramid's `nextTurn`). The buttons are labelled for
   what they do on each screen.
4. **`skipWord` also exists on the toolbar as *Skip this word*** — spec'd as an
   event, not as a button; it is on the toolbar because a misprint in a
   host-supplied list is the obvious reason it exists.

## 5. Cross-cutting rules from `docs/reports/00-orchestrator-triage.md`

| Item | How it is handled |
| --- | --- |
| game payloads before the iframe is ready | shell-side; nothing to do here. `pwd-room.js` re-pushes on `player-join` **and** `player-status`, and clears that pid's `lastSent` cache first so an identical view is not suppressed |
| `?game=URL` beats a save unless the save came from that URL | `pwdChooseContent()`; the banner says which list it settled on |
| saved state scoped to the room | `pwdBindRoom(code)` drops every phone seat (and a game in progress that used one) when the room code changes; typed players keep their ids |
| `globalThis` fallback in `data.js` | `data.js` sets both `module.exports` and `globalThis.PWD_DEFAULT_GAME`; `pwd-app.js` and `pwd-editor.js` read `globalThis.PWD_DEFAULT_GAME` |
| views pushed on join/status | `onPlayerJoin` / `onPlayerStatus` both call `pushViews` |
| phones only express intent | `validatePhoneMsg` accepts `ready` / `clue` / `got` / `pass` and nothing else; a judgement has no wire representation at all. Every intent is re-checked by `phoneCanClue` / `phoneCanMark` before it reaches the reducer, and the reducer checks the phase again |
| own-property handler lookups | `Object.prototype.hasOwnProperty.call(HANDLERS, event.type)` in `reduce`, and the same guard on the `CUES` map in `pwd-sound.js`, the `SCREENS` map in `pwd-phone.js` and the hotkey maps in `pwd-app.js`. PW-U9 probes six prototype-shaped event types |
| the shared theme accent block is canonical | `css/pwd.css` declares **no** `body[data-gsc-game]` block. It sets `--stage-deep` / `--stage-night` / `--stage-card` in `:root` and its own `--pwd-*` tokens; `--accent`, `--accent-2`, `--accent-ink` and `--stage-glow` come from `shared/theme.css`. Harness gate **PW-I6** greps the sheet for `body[data-gsc-game` and fails if it ever comes back |
| every `@keyframes` / `animation:` inside `prefers-reduced-motion: no-preference` | one block at the foot of `pwd.css`; a harness gate strips comments and asserts nothing matches outside it |
| splash skipped when embedded | `pwdShowSplash()` returns early on `body.gsc-embedded` and under `prefers-reduced-motion: reduce` |

## 6. Verification performed by the implementer

| Tier | Result |
| --- | --- |
| **T1 unit** | `cd games/password && node --test` → **54 pass, 0 fail** (PW-U1 … PW-U10). Repo-root `node --test` → **865 pass, 0 fail**, so nothing elsewhere regressed |
| **T2 loopback** | `games/password/tests/harness.html` → **74/74 PASS**, `#summary.ok`. Real embedded host + four real embedded phones over the bridge protocol |
| **T3 real network** | Standalone host at `http://127.0.0.1:8701/games/password/`, **Open room (phones)** → room `4M3T` on the real PeerJS broker; a second tab joined as `?room=4M3T&name=Ada` over real WebRTC. Verified: the password on the giver's phone and **absent from the host page's DOM text**; *Clue given* from the phone moved the host's ladder; a host *Wrong* passed control and the phone followed; a reload of the phone re-linked to the same pid; as the Lightning giver the phone showed the word, *Got it* and *Pass* both worked and its clock matched the host's; the result screen paid `$1,000` to both members |
| **T4 standalone** | A full host-as-giver game to 25 with no phones (28–20 over four words, including a wrong guess and an illegal clue), then a Lightning Round, the result and the standings, then *Play another game* (points reset to 0–0, `$1,000` still banked). Editor round-trip and every hotkey (`C`, `Space`, `W`, `X`, `N`, `U`, `P`, `Enter`) driven from the page |
| **T5 static gates** | V2 every file < 800 lines (largest 787). V3/V4 zero `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` / `console.log` anywhere under `games/password/`. V6 the only external URLs are Google Fonts. V7 `<body data-gsc-game="password">`, `#gsc-join`, `player-mode` / `gsc-embedded` wired. V8 `?game=URL` and file upload both go through `validateGame` |

**Layout gates.** No vertical scroll at **1280×720** or at the hub's
**1280×676** on the word, game-over, Lightning and result screens (measured
`scrollHeight === clientHeight` on each), and no horizontal scroll. Phone at
**320×640**: `scrollWidth === clientWidth`, every action button exactly 56 px
tall, and a 20-character password still fits the card.

**Contrast.** Every gradient that sits under text was checked at **both** stops:
the phone card (13.2:1 / 18.7:1 for the cream copy, 9.4:1 / 13.4:1 for the dim
copy), the lit ladder rung and the won Lightning slot (`--accent-ink` at 13.1:1
/ 10.8:1), and the splash (12.6:1 / 18.7:1). Panel and well copy runs 8.8–15.5:1.
The one value that came in under 4.5:1 was the *spent* ladder rung's number at
3.09:1 — raised to `rgba(201,212,245,.55)` = 4.34:1 even though it is 24 px
display type and would have qualified as large text. Spent rungs also lose their
gold fill and gain a dark well, so the countdown reads without colour.

## 7. Content

`words.json` ships **200** original passwords chosen the way the show mixes
them: concrete nouns (Umbrella, Lantern, Pancake), abstract nouns (Courage,
Patience, Nonsense), verbs (Stumble, Persuade, Rummage) and adjectives (Jealous,
Slippery, Peculiar), short and long interleaved so difficulty varies word to
word. All are family-friendly, single words, unique case-insensitively and at
most 20 characters. `js/data.js` is generated from it and a unit test asserts
the two are byte-identical after parsing.

Words are dealt in **file order** (the show reads its list in order) unless the
host presses **Shuffle the list**, which deals the same words through an
injected rng. Running past the end wraps and sets `repeating`, which the host
sees under the ladder as "The list has come round again."

## 8. Known limits (also in the README)

- One Lightning Round per game; play another game for another one.
- The main game has no clock — the show's rule is that a word dies on its tenth
  clue, not on time. Only the Lightning Round has one.
- Undo steps through decisions only: starting, pausing and expiring the Lightning
  clock leave no undo step.
- A saved game is written on `beforeunload`, so clearing `gsc-pwd-state-v1` from
  a console and then reloading writes the old state straight back. Use the
  editor's **Use in game**, or clear the key from a page you are not about to
  unload. (Same behaviour as Pyramid; not a defect, but it surprised the
  implementer once.)

## 9. For the orchestrator

- **The accent block landed — closed.** `shared/theme.css` now carries
  `[data-gsc-game="password"]` with `--accent: #f2c94c`, `--accent-2: #7aa2ff`,
  `--accent-ink: #241a02` and `--stage-glow: #0d1b4b`. The dark ink is what the
  ladder rung, the badge, the room chip and the won Lightning slot print on the
  gold; the tester measured it live at 10.8:1. Nothing in `css/pwd.css` changed,
  and the sheet still declares no `body[data-gsc-game]` block of its own (harness
  gate PW-I6 greps for one).
- Nothing outside `games/password/**` and this report was touched. No git
  commands were run.

---

## 10. Fixes after verification (2026-09-04)

The independent tester's verdict was **ship**
(`docs/reports/password-verification.md`). They fixed PW-D1 (marks accepted
while the Lightning clock was paused), PW-D2 (a revealed password left in a
hidden panel), PW-D3 (`Polish` → `Sparkle`) and PW-D4 (the two new suites were
outside the harness gate list); all four are kept as they wrote them. This
section covers the three minors they handed back.

### PW-D5 — the harness wrote to the real save keys

`tests/harness.html` cleared `gsc-pwd-state-v1` / `gsc-pwd-draft-v1` at the
start of a run and left its 60-word fixture game and its roster in them at the
end, so opening `games/password/` afterwards on the same origin found the
harness's night waiting.

Fixed with the `?store=NAME` namespace Price Is Right settled on in Phase 3:

| File | Change |
| --- | --- |
| `js/pwd-app.js` | new `pwdStoreSuffix()` reads `?store=`, strips anything but letters/digits/hyphens, caps at 24 chars; `PWD_STORAGE_KEY` becomes `` `gsc-pwd-state-v1${pwdStoreSuffix()}` ``; exported as `PwdApp.storeSuffix()` |
| `js/pwd-editor.js` | `PWD_DRAFT_KEY` picks up the same suffix through `PwdApp.storeSuffix()` |
| `tests/harness.html` | `HOST_SRC` / `PHONE_SRC` carry `store=harness`; `KEYS` are the `-harness` pair; a new `REAL_KEYS` + `REAL_BEFORE` snapshot |

A new gate, **PW-I6 V-store**, asserts the host frame's `PwdApp.STORAGE_KEY` is
`gsc-pwd-state-v1-harness`, the editor's `DRAFT_KEY` is
`gsc-pwd-draft-v1-harness`, and both real keys are byte-for-byte what they were
before the run (a snapshot comparison, not a clear — a test page has no business
deleting a host's actual save).

Verified with the tester's own repro: after a full harness run,
`localStorage` held `gsc-pwd-state-v1-harness` = "Edited in the harness" while
`gsc-pwd-state-v1` still held the shipped "Password — Game Night" with its 200
words, and opening `games/password/` resumed the *real* saved night.

### PW-D6 — a discarded save said nothing in the UI

`pwdLoadSaved()` dropped a damaged save with only a `console.warn`, against the
house rule that every failure path surfaces a plain-English message.

Three silent branches now speak, through a new `pwdNote()` helper that
**appends** to the boot banner instead of overwriting it (so a `?game=` failure
and a damaged save can both be reported in the same load):

| Branch | Message |
| --- | --- |
| the save is not JSON (`catch`) | "Your saved game couldn’t be read, so it was cleared — this night starts fresh." |
| the save parsed to something that is not an object | the same |
| `core` fails `pwdUsableCore` but the file and roster are intact | "Your saved game couldn’t be read, so it was cleared — the words and the line-up are still here." |

`pwdChooseContent`'s two existing writers were routed through `pwdNote` as well,
so the `?game=` banner no longer silently replaces a save message.

Verified live in both directions: `{{{ not json` → the first message, the
built-in 200 words loaded, setup screen shown; the tester's exact damaged-core
save (`{"core":{"phase":"word","teams":[],"scores":"x"}}` grafted onto a real
save) → the second message with **Ada, Ben, Cleo and Dev still seated** and the
word list intact.

### PW-D7 — labels under the `--fs-micro` floor

`.log-note` computed to 10.88 px. It is the word ("clue" / "correct" / "wrong" /
"illegal clue") that keeps colour from being the only signal in the clue log, so
it is exactly the text that should not be the smallest on the screen. Raised to
`var(--fs-micro)` (12 px). The tester's report called it the only sub-12 px text
on the host screens; two more were hiding on the Lightning screen — `.l-slot-n`
(0.68 rem) and `.l-slot-note` (0.66 rem, the "got it" / "passed" / "to come"
label, the same non-colour signal) — both raised to `var(--fs-micro)` too. That
is now every host-screen label at or above the floor.

The risk the tester flagged was the fixed-height word screen, so the rows were
pinned to one line first: `.log-note` gained `white-space: nowrap` and
`.log-team` gained `min-width: 0` + `overflow: hidden` + `text-overflow:
ellipsis` + `nowrap`, so no team name can grow a row however long it is.

Re-measured with 17-character team names ("The Unstoppables" / "Wordsmiths
United") and a seven-entry log: rows 26 px, the log does not overflow its own
scroll box, and **zero vertical and zero horizontal overflow on all seven
in-play states** (word, word revealed, game over, Lightning idle, Lightning
running, Lightning finished, result, standings) at **both 1280×676 and
1280×720**.

PW-D8 (the setup screen scrolls at 1280×720) needs no change — the no-scroll
rule is for screens in play, and a setup form that scrolls is normal.

### One structural change the fixes forced

PW-D5 and PW-D6 pushed `js/pwd-app.js` to 806 lines, over the house cap — the
harness's own V2 gate caught it. `pwdShowSplash()` and its two module variables
moved to `js/pwd-view.js` as `PwdView.showSplash()`; it paints DOM and nothing
else, so it belongs with the rest of the painting. `PwdApp.showSplash` stays as a
one-line delegate, so every caller (including the harness's splash scenario) is
unchanged. `pwd-app.js` 806 → **780**, `pwd-view.js` 443 → **470**.

`tests/harness.html` is now **797** lines. Two lines of its own report-page CSS
were merged, and its lede reflowed, to pay for the new gate and the race fix
below. It is the file closest to the cap in this component — anything further
added to it should be paid for the same way, or the V2 gate will fail the run
that adds it.

### A race the re-runs exposed

Two checks failed on one re-run and passed on the next: **PW-I3** "the password
moves to the other two phones when the roles swap" and **PW-I5** "the phones
re-attach to the reloaded host". Neither is a product defect — the host pushes
all four views in one pass, but each crosses its own `postMessage`, and both
scenarios waited on *one* phone and then asserted on *another*. Moving the
splash shifted the timing enough to lose the race that had been won by luck.
Both `waitFor` predicates now wait for every phone the check is about to read
(both givers on the giver screen **and** both receivers on the receiver screen).
Three consecutive full runs green afterwards.

### State after the fixes

| Check | Result |
| --- | --- |
| `cd games/password && node --test` | **114 pass / 0 fail** |
| `node --test` (repo root) | **996 pass / 0 fail** (the repo total moves as other components land) |
| `tests/harness.html` on `127.0.0.1:8701` | **75/75 PASS**, `#summary.ok` (74 + the new V-store gate), three consecutive runs |
| every file < 800 lines | largest `tests/harness.html` 797, `css/pwd.css` 792, `js/pwd-app.js` 780 |
| `innerHTML` / `document.write` / `eval(` / `new Function` / `console.log` | zero under `games/password/` |
| 1280×676 and 1280×720, all in-play states | no vertical or horizontal scroll |

Files touched in this pass: `js/pwd-app.js`, `js/pwd-view.js`,
`js/pwd-editor.js`, `css/pwd.css`, `tests/harness.html`, `README.md` and this
report. Nothing outside `games/password/**`; no git commands were run. The
server on port 8701 was stopped and the browser tabs closed.
