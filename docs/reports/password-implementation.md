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

- **`shared/theme.css` still has no `[data-gsc-game="password"]` block.** The
  game currently inherits the `:root` defaults — `--accent: var(--gold)`
  `#ffcc4d`, `--accent-ink: #241a02`, `--stage-glow: #0a1158` — which happen to
  land almost exactly on the spec's gold `#f2c94c` over midnight blue, so the
  page looks right today. When the accent block is added (the registry entry
  already carries `#f2c94c`), please keep `--accent-ink` dark: white on
  `#f2c94c` is only 1.8:1, and the ladder rung, the badge, the room chip and the
  won Lightning slot all print `--accent-ink` on that gold. `#241a02` gives
  10.8:1. Nothing in `css/pwd.css` needs to change.
- Nothing outside `games/password/**` and this report was touched. No git
  commands were run.
