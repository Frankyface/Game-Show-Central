# Password — verification report

Component: `password` · Spec: `docs/13-password-spec.md` · Format: `docs/06-verification-plan.md` §5
Independent tester (did not write the code). Verdict at §4.

---

## 1. Environment

| | |
| --- | --- |
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app browser), viewports emulated at 1280×720, 1280×676 and 320×640 |
| Server | `python -m http.server 8703 --bind 127.0.0.1` from the repo root (my own port; stopped at the end) |
| Date | 2026-09-04 |
| Broker | real PeerJS broker **reachable** — room `87C2` opened and two phones joined over real WebRTC. No BLOCKED-ENV. |
| Under test | `games/password/**` at the state the implementer left it, plus the four trivial fixes noted in §3 |

Commands run:

```
cd games/password && node --test            114 pass / 0 fail
node --test        (repo root)              989 pass / 0 fail
http://127.0.0.1:8703/games/password/tests/harness.html    All 74 checks passed. (#summary.ok)
```

New adversarial suites added by me (task item 1). `pwd-adversarial.test.mjs` was
split in two so every file stays under the 800-line house cap, and the shared
audit harness moved into `pwd-fixtures.mjs`:

| File | Tests | What it attacks |
| --- | --- | --- |
| `tests/pwd-adversarial.test.mjs` | 43 | leak crawls (pid × phase × event sequence), ladder, illegal clue, target, opener, swap, Lightning, word order, deep-frozen immutability, undo across phases, prototype-shaped events |
| `tests/pwd-fuzz.test.mjs` | 17 | validator fuzz and phone-wire fuzz |
| `tests/pwd-fixtures.mjs` | — | `auditViews` (the leak invariant), `EVENTS`, `PIDS`, `deepFreeze`, `lightningAt` |

The leak crawl is the centrepiece: 250 random walks × 40 events (10 000 states)
plus an exhaustive 4-deep crawl (1 000+ nodes), auditing **eight** pids per state
(four seats, a spectator, an empty id and two prototype-shaped ids). At every
state it asserts (a) no unentitled pid's serialised view contains any password
in the state, (b) an entitled giver's view contains **only** the word in play —
never a Lightning word that has not come up yet — and (c) no view carries a key
outside an audited allow-list, so a new field cannot quietly become a new leak.

I also added the two new test files to the harness's `SOURCES` list so gates
V2/V3/V4 cover them (they were otherwise ungated — the Phase-2 lesson about
harness asset lists applies to test files too).

---

## 2. Results

### T1 unit — success states PW-U1 … PW-U10

| ID | Result | Evidence |
| --- | --- | --- |
| PW-U1 validator | **PASS** | shipped file validates, 200 words, `data.js` byte-identical after parsing. My fuzz adds: 59 refused / 60 accepted, space in any disguise (tab, NBSP, double space) refused, duplicates caught across case and `'`/`’`, 20 chars accepted / 21 refused, `Level9` `!Bang` `-Leading` `'Quote` `a+b` emoji all refused, `Café` `Well-known` `O'Clock` accepted, junk types (`null` `7` `[]` `{}` `true`) each named in plain English, every numeric setting bounded at both ends, `__proto__` in `settings` cannot pollute `Object.prototype`, `normalizeGame` pure, `warningsFor` never throws. A bad word in a 200-word file is reported as "Password 138", not "the file". |
| PW-U2 ladder + dead word | **PASS** | ten clues walk `10,9,8,7,6,5,4,3,2,1`; the tenth clue still pays 1 on a correct guess; a wrong guess on the tenth kills the word; `clueGiven` / `illegal` / `skipWord` / `guess` are all refused afterwards. |
| PW-U3 alternation + first clue | **PASS** | opener across five words = `[0,0,0,1,0]`, exactly `1 − previous winner`; `setFirst` honoured before the first clue and refused after it (and after the clue has been answered); `"0"`, `1.5`, `-1`, `2`, `null`, `true`, `NaN` all ignored; a skipped word alternates the opener. |
| PW-U4 illegal clue | **PASS** | before *Clue given*: control passes and the counter moves one rung; after it: the same rung, never two; the receiver never gets a guess on a forfeited clue; nine illegal clues leave the word alive, the tenth kills it. |
| PW-U5 target mid-word | **PASS** | 18 ≥ 15 ends the game the instant the guess is judged; `clueGiven` / `illegal` / `skipWord` / `nextWord` / `setFirst` are all no-ops at `gameOver`; exactly the target wins, one short does not. |
| PW-U6 role swap | **PASS** | the swap follows `wordsPlayed`, not who won (`p1+p3, p2+p4, p1+p3, p2+p4, p1+p3, p2+p4` over six words with alternating winners); `swapRoles:false` pins the pair for the night **and** for the Lightning giver; a swap moves entitlement — `phoneCanClue` follows the new giver and the old one's view loses `word`. |
| PW-U7 Lightning | **PASS** | five passes cycle round and do not close the round; a one-word round can be passed forever and is closed only by the buzzer; the buzzer does not cut off the word in flight and the mark that follows closes it; a second buzzer and a restart after expiry are both refused; all-five doubles ($1,000) and `allFiveBonus:false` does not ($500) while still recording `allFive:true`; 4-of-5 never doubles, whichever word was dropped (all five permutations); a three-game night banks $1,000 / $2,000 / $3,000, each exactly once. |
| PW-U8 shuffle / wrap | **PASS** | shuffle is a repeatable permutation and survives a degenerate rng (`() => 0`, `0.9999999`, `NaN`, `-5`, `12`) without losing a word; the wrap raises `repeating` once and it never goes back down; a Lightning Round straddling the end of the file wraps and flags it; `wordAt` is total for any cursor (`-9 … 700`), empty list and `null`. |
| PW-U9 undo / illegal events / immutability | **PASS** | undo walks lightning → gameOver → word, restores the cursor so an undone Lightning Round re-deals the same words, unwinds the banking of a game, and does not resurrect game 1's points after `nextGame`; history capped and never nested; 13 prototype-shaped event types no-op on three different seed states and never write to `Object.prototype`; malformed events/states/`now` values are all inert. **Deep-freeze:** every event runs against a recursively frozen state (six seeds × 22 events, plus a 40-step frozen walk) without throwing or mutating, and every selector survives a frozen state. |
| PW-U10 `phoneView` leak | **PASS** | see the leak crawl above — 10 000+ audited states, zero leaks. Receivers, spectators, an empty pid, `__proto__`/`constructor` pids and **the losing team's giver throughout the Lightning Round** never see a password. `validatePhoneMsg` accepts only `ready`/`clue`/`got`/`pass` and returns a narrow `{t}` copy; 35 hostile shapes (control chars, casing, whitespace, `__proto__`, a 5 000-char `t`, `{type:"clue"}`) are all rejected; no judgement (`correct`, `wrong`, `illegal`, `guess`, `lightningMark`) has any wire representation at all. |

### T2 loopback — success states PW-I1 … PW-I6

`games/password/tests/harness.html` → **74/74 PASS**, `#summary.ok`
(PW-I1 ×10, PW-I2 ×7, PW-I3 ×10, PW-I4 ×15, PW-I5 ×8, PW-I6 ×24), re-run green
after each of my fixes and after the content change.

### T3 real network — hub, two phones, real PeerJS/WebRTC

Hub host at `http://127.0.0.1:8703/`, **Open room** → `87C2`. Two phones joined
over real WebRTC: Ada (`p1`) in a second tab, Ben (`p2`) in a same-origin frame
inside it (the browser enforces a two-tab cap here; the second phone owns its own
`Peer` and its own connection, and joined as a distinct pid — the roster shows
two separate players). Ada seated as Team A seat 1, Ben as Team B seat 1, so a
**giver on each team** is a phone.

| Check | Result | Evidence |
| --- | --- | --- |
| the password reaches both givers' phones only | **PASS** | both phones: `word = "Umbrella"`, card `is-giver`; Ada's *Clue given* enabled (her turn), Ben's disabled. |
| never in the host page's `textContent` | **PASS** | `hostDomLeak: false` on the game frame **and** `hubDomLeak: false` on the hub document, checked on every word and on all five Lightning words. |
| receivers get nothing | **PASS** | after the swap the phones became receivers: card `is-receiver`, `word` = "Listen…" / "Team B", and neither the live word ("Whisper") nor the previous one ("Umbrella") anywhere in the phone document. |
| *Clue given* from a phone advances the ladder | **PASS** | Ada tapped it → host `1 / 10`, clue log `Team A • clue`, *Correct/Wrong* enabled, phone sub → "Clue given. The host is judging the guess." |
| host override | **PASS** | on a fresh word the host pressed *Team B open instead* → `turn = Team B`, `round.firstTeam = 1`; the button is only offered while `clues === 0`. |
| Lightning clock sync on both phones | **PASS** | host deadline `1788525197468`; both phones reported the identical `clock.deadline` and both read `0:51` at the same moment. Ben (the winning giver) saw `Ticket` + *Got it* / *Pass*; Ada (losing team) saw the clock and the count and **no word**. |
| Lightning marks from a phone | **PASS** | five taps from Ben's phone drove the host: a pass put "Jealous" back in the queue and it came round again; all five → `$1,000`, `doubled: true`. |
| phone reload mid-word | **PASS** | Ben's phone reloaded, re-linked to `pid=p2`, and its view was pushed straight away (no "Connecting…" wait): `"One guess, and it is worth 10."`, no leak. |
| `⌂ Lobby` and back | **PASS** | the shell's *Leave Password?* dialog → lobby; re-launching Password restored `phase: standings`, `29–0`, the standings rows and the room chip `Room 87C2` unchanged. |
| night scoreboard pays both members | **PASS** | hub night list after the round: `Ben 1000`, `Dev 1000`, `Ada 0`, `Cleo 0`. |

### T4 standalone — host-as-giver, no phones

A full game at `http://127.0.0.1:8703/games/password/`, four typed players,
*Host as giver* mode.

| Check | Result | Evidence |
| --- | --- | --- |
| the secret-word rule with no phones | **PASS** | password absent from `document.body.textContent` at every point of every word while live (checked before each clue and after each clue on every word). |
| study mode | **PASS** | *Read it to the givers (5 s)* → panel shows `Shared screen — the receivers must not be looking. / Umbrella / Study mode — hiding in 5s.`; auto-cleared after 5 s and the word left the DOM entirely. |
| shared-screen warning | **PASS** | while revealed the notice turns `notice-warn` and reads "The password is on this screen — everyone watching the share can read it."; the panel itself repeats the warning above the word. |
| *Show password to me* toggle | **PASS** | label flips, `aria-pressed` tracks, and switching it off removes the node (not just hides it). |
| hotkeys | **PASS** | `C` `W` `X` `Space` `U` all fire on the word screen (verified with a **real** key press as well as synthetic events); `Space`/`P`/`Enter` on the Lightning screen. |
| hotkeys with an input focused | **PASS** | `C` and `Space` dispatched with `#pwd-player-name` focused changed nothing (`pwdIsTyping`); `Space` with a `<button>` focused is also ignored, so the button's own activation cannot double-fire. |
| full game to the target | **PASS** | 0–25 over three words including a wrong guess and an illegal clue; the ladder, clue log, podiums and *Next word* all behaved; game-over card `Team B win game 1 / 0 — 25`. |
| Lightning Round | **PASS** | slots, giant clock, *Show words to me*, a pass that came back round, all five → `$1,000` doubled, result and standings. |
| reload mid-word | **PASS** | word, clue count, turn, log, score and banked money all identical after reload; **`reveal` deliberately does not survive** — the word comes back hidden. |
| reload mid-Lightning | **PASS** | comes back `Paused.` with `0:47` of `0:59` left, slots `got,passed,pending,pending,pending`, `$100`, no word on the screen; *Resume* continues from there. |
| undo | **PASS** | undo across a scored word, an illegal clue, a Lightning mark, `toLightning`, the banking of a game and `nextGame`; pressing it past the beginning is inert. |
| editor Download (validate) | **PASS** | a draft with `Ice Cream` + `Level9` blocks *Download* with "Fix this before downloading: Password 60 (“Ice Cream”) has a space in it — a password is a single word."; 59 words blocks both *Download* and *Use*. A valid 64-word draft downloaded as `words.json`, and the blob re-parsed and re-validated through `validateGame` with the word list byte-identical. |
| editor Use | **PASS** | *Use in game* adopts the list, closes the editor, and the setup screen reads "Custom words (from the editor) / 64 passwords loaded". |
| `?game=URL` vs a save | **PASS** | with a saved editor list, `?game=tests/fixtures/harness-game.json` won (`sourceKind: fetch`, title "Harness Password"); reloading the **same** URL kept the game in progress (`Testaa`, 1 clue) because the save came from that URL. |
| bad JSON | **PASS** | `?game=README.md` → "Could not load words from README.md: … is not valid JSON. Keeping the words you already had." and the game in progress survived. `?game=does-not-exist.json` with no save → "…the server answered 404. Using the built-in list instead." and the built-in 200 loaded. |
| 1280×720 in play | **PASS** | `scrollHeight === clientHeight` and no horizontal scroll on word, game-over, Lightning and result. |
| 1280×676 in play | **PASS** | same, measured on all seven states (word, word-finished, gameOver, lightning idle, lightning finished, result, standings): `vScroll 0, hScroll 0`. |

### Design and accessibility

| Check | Result | Evidence |
| --- | --- | --- |
| shared accent block is the only palette | **PASS** | computed on the live page: `--accent #f2c94c`, `--accent-2 #7aa2ff`, `--accent-ink #241a02`, `--stage-glow #0d1b4b` — all from `shared/theme.css [data-gsc-game="password"]`. `css/pwd.css` declares no `body[data-gsc-game]` block (harness gate PW-I6 greps for it). |
| nothing hard-codes white on the gold | **PASS** | zero occurrences of `#fff` / `white` in either stylesheet; everything printed on the accent uses `var(--accent-ink)`. |
| contrast, **both** gradient stops | **PASS** | lit ladder rung number 13.11 / 10.82; gold *Next word* button 10.95 / 7.29; room chip and game badge 10.82; title 15.64 / 18.68; secondary copy 11.15 / 13.35; *Correct* 11.27; *Illegal clue* 8.28 / 9.91; podium score 10.38 / 12.42; clue-log rows 12.24 / 17.18. Lowest measured is the **spent** rung at 4.47 (24 px display type — clears the 3:1 large-text bar comfortably; the design-system nit is PW-D7). |
| reduced motion | **PASS** | CSSOM walk over all three sheets: every `@keyframes` and every `animation:` sits inside `@media (prefers-reduced-motion: no-preference)`; no `transition` on `filter`. The splash is skipped under `reduce` and when embedded. |
| phone 320×640 | **PASS** | *Clue given* 269×56, *Got it* / *Pass* 130×56 each — every action button exactly 56 px tall; `hScroll 0`, `vScroll 0` on the giver, receiver and Lightning-giver screens; a 20-character password still fits the 269 px card at 38.4 px. |
| colour is never the only signal | **PASS** | clue log carries a word ("clue"/"correct"/"wrong"/"illegal clue") beside every glyph; slots carry "to come"/"got it"/"passed"; spent rungs lose their fill and gain a dark well; the live rung carries a `visually-hidden` "worth now". |

### T5 static gates

| Gate | Result | Evidence |
| --- | --- | --- |
| **V1** `node --test` exits 0 | **PASS** | 114 pass / 0 fail in `games/password`; 989 / 0 at the repo root. |
| **V2** every file < 800 lines | **PASS** | largest is `tests/harness.html` at 789; `pwd-adversarial.test.mjs` 695, `pwd-app.js` 775, `pwd.css` 775, `pwd-core.js` 738. (My first draft of the adversarial suite was 963 lines — split before submitting.) Functions over ~50 lines: none found. |
| **V3** no `innerHTML`/`insertAdjacentHTML`/`outerHTML =`/`document.write`/`eval(`/`new Function` | **PASS** | zero matches under `games/password/` outside prose and the harness's own gate regex. Confirmed live: a saved game whose title/player name/source were `<script>`/`<img onerror>` strings rendered as literal text and created **0** script or img nodes. |
| **V4** no `console.log` | **PASS** | zero. |
| **V5** no Peer/connection/DOM/timer handle in state | **PASS** | `pwdSerialise` writes `core, game, setup, source, sourceKind, sourceUrl, roomCode` only; the clock is `{running, deadline, remainingMs}` timestamps; `pwdClock`, `pwdStudyTimer`, `pwdListeners` and `room` are module-level. `reveal` / `lightningReveal` / `studyUntil` are intentionally excluded — verified live, a reveal does not survive a reload. |
| **V6** external URLs | **PASS** | Google Fonts only (`fonts.googleapis.com`, `fonts.gstatic.com`). PeerJS is loaded lazily by `shared/`. |
| **V7** `data-gsc-game`, `#gsc-join`, body classes | **PASS** | `<body data-gsc-game="password">`, `#gsc-join` present, `player-mode` / `gsc-embedded` toggled in `pwdBoot`. |
| **V8** `?game=URL` and upload share `validateGame` | **PASS** | `pwdFetchGame` → `validateGame`; `pwdOnFile` → `pwdUseGame` → `validateGame`; the editor's *Use* and *Download* both validate first. Exercised live for all three paths. |

### Security read

- **The host is authoritative.** A phone can emit exactly four intents. Each is
  re-checked by `phoneCanClue` / `phoneCanMark` in `pwd-app.js` before it becomes
  an event, and the reducer checks the phase again. No judgement (`correct`,
  `wrong`, `illegal`), no `nextWord`, no `undo` and no `finish` has any wire form.
  Fuzzed with 35 hostile message shapes and with every seat trying every intent.
- **`pwd-room.js` sends each phone `phoneView(state, thatPid)` and nothing else** —
  there is no broadcast of state, so a receiver's dev tools hold nothing.
- **Corrupt / hostile `localStorage` cannot take the page down.** Seven crafted
  saves (`{{{`, `null`, an array, a broken core, a prototype-shaped phase, an
  XSS-shaped title/name/source) all landed on a clean setup screen with the
  built-in words and a live `PwdApp`.
- **Prototype pollution.** `hasOwnProperty` guards on `HANDLERS` (core), `CUES`
  (sound), `SCREENS` (phone) and the hotkey maps; a `__proto__` key inside a
  loaded `settings` object does not reach `Object.prototype`.
- Residual, accepted and repo-wide: `?game=` will fetch any URL the host pastes
  (CORS-limited, content validated, never executed) — the Jeopardy pattern used
  by every game here.

### Content — all 200 passwords read

All 200 are single words, letters only, unique case-insensitively, ≤ 20 chars
(longest `Lighthouse` / `Marvelous`), a genuine mix of concrete nouns, abstract
nouns, verbs and adjectives, and short/long interleaved. Nothing obscure enough
to be unguessable from one-word clues, nothing that isn't family-friendly, and —
after the change below — no proper nouns.

**One replaced (PW-D3):** `Polish` (#42). Capitalised as the list ships it,
`Polish` reads first as the nationality — a proper adjective, which spec §2 asks
the list to avoid, and genuinely ambiguous for a giver reading it off a phone.
Replaced with `Sparkle` in `words.json` **and** `js/data.js` together; the two
files still parse identically (`PW-U1` pins this) and `validateGame` passes.

Noted, not changed: `Curious` (#64) / `Curiosity` (#159) and `Wobbly` (#84) /
`Wobble` (#198) share a root, so if both come up in one night the second giver
cannot use the first as a clue ("any form of the password" is illegal). Both
words are still perfectly playable and the show's own lists do this too.
`Peace` (#103) is a homophone of "piece", which the host judges by ear. American
spellings (`Harbor`, `Rumor`, `Marvelous`, `Cozy`) are used consistently.

---

## 3. Defects

### Fixed by me (all trivial, < 5 lines each)

**PW-D1 — words could be scored while the Lightning clock was paused (major).**
`games/password/js/pwd-core.js:384` (`evLightningMark`) only checked `l.started`,
never whether the clock was running. `phoneCanMark` *did* check it, so phones went
quiet on a pause but the host's *Got it* / *Pass* buttons — and the `Space` / `P`
hotkeys, which bypass a disabled button entirely — stayed live. Repro before the
fix: reach the Lightning Round, *Start the clock*, *Pause*, press `Space` → a word
is marked `got` and $100 is awarded with the clock stopped. The realistic way to
hit it is a **reload mid-Lightning**, which by design comes back paused: the host
returns to the tab and starts judging before pressing *Resume*. It also breaks the
implementer's own stated rule ("a pause is the host stopping play", `pwd-core.js:598`).

```diff
  js/pwd-core.js  (evLightningMark)
     if (state.phase !== "lightning" || !l || l.finished || !l.started) return state;
+    // A pause is the host stopping play: nothing is judged off the clock, from
+    // the host's buttons, the hotkeys or a phone (the buzzer is the exception —
+    // the word in flight is still judged). Same rule as phoneCanMark.
+    if (!l.clock.running && !l.expired) return state;
     if (LIGHTNING_MARKS.indexOf(ev.result) < 0 || !l.words[l.cursor]) return state;

  js/pwd-view.js  (renderLightningControls)
-    ["btn-l-got", "btn-l-pass"].forEach((id) => { $(id).disabled = !(live && l.started); });
+    const judging = live && l.started && (l.clock.running || l.expired);
+    ["btn-l-got", "btn-l-pass"].forEach((id) => { $(id).disabled = !judging; });
```

Verified live: paused → both buttons disabled, `Space` inert, total unchanged;
*Resume* → both live again; at the buzzer the word in flight is still judged.
Pinned by `A6 pause stops play as well as the clock, and Resume hands the time back`.

**PW-D2 — a revealed password stayed in the hidden word panel (minor).**
`games/password/js/pwd-view.js:425` (`render`) only repaints the screen it is
showing, so leaving the word screen with *Show password to me* on left the
password parked in the hidden `#pwd-word-panel` for the rest of the night —
directly contradicting the implementation report's "There is no hidden node
parked with the password in it". Repro before the fix: reveal a password, press
*End the night* → `document.body.textContent` still contained "Pancake" on the
standings screen. Low impact (the word is spent by then and the node is hidden),
but the invariant is the one the whole game is sold on.

```diff
  js/pwd-view.js  (render)
     SCREENS.forEach((name) => show($(`screen-${name}`), name === which));
+    // A screen we are leaving is never repainted, so a revealed password would
+    // sit in its (hidden) panel for the rest of the night. Empty them here.
+    if (which !== "word" && $("pwd-word-panel")) $("pwd-word-panel").replaceChildren();
+    if (which !== "lightning" && $("pwd-l-panel")) $("pwd-l-panel").replaceChildren();
```

Verified live: same repro now gives `bodyHasWord: false`.

**PW-D3 — `Polish` is a proper adjective as capitalised (minor, content).**
`games/password/words.json:55` and `games/password/js/data.js:65`. Replaced with
`Sparkle` in both files together; `PW-U1` still asserts the two are identical.

**PW-D4 — the two new test files were outside the harness's gate list (minor).**
`games/password/tests/harness.html:681` — `SOURCES` drives V2/V3/V4, so a file
not named there is never line-counted or grepped. Added
`../tests/pwd-adversarial.test.mjs` and `../tests/pwd-fuzz.test.mjs` (one line).
`README.md` §5/§6 updated for the new suites (two lines).

### Reported, not fixed

**PW-D5 — the harness writes to the game's real `localStorage` keys (minor).**
`games/password/tests/harness.html:167` uses `KEYS = ["gsc-pwd-state-v1",
"gsc-pwd-draft-v1"]` — the production keys. It clears them at the *start* of a
run but leaves the harness's own 60-word fixture game and its players ("Zoe",
"Ada", …) behind at the *end*. Repro: open `tests/harness.html`, wait for
`All 74 checks passed`, then open `games/password/` on the same origin — the
setup screen reads "Custom words (from the editor) / 60 passwords loaded" with
the harness's roster already seated. This is exactly what Price Is Right fixed
in Phase 3 with a `?store=harness` namespace (`price-is-right/tests/harness.html:164-167`).
Proposed fix (implementer): accept a `?store=<suffix>` param in `pwd-app.js`
(and `pwd-editor.js` for the draft key) and pass `store=harness` from
`HOST_SRC` / `PHONE_SRC`, mirroring Price Is Right. Roughly 8–10 lines, so out
of a tester's remit.

**PW-D6 — a saved game that is discarded says nothing in the UI (minor).**
`games/password/js/pwd-app.js:168` warns to the console and silently drops a
damaged `core`; the host just finds themselves on the setup screen with no
explanation. CLAUDE.md asks that "every failure path surfaces a plain-English
message in the UI". Repro: put `{"core":{"phase":"word","teams":[],"scores":"x"}}`
in `gsc-pwd-state-v1` and reload — clean setup screen, `#pwd-error` empty.
Proposed fix: set `pwdLoadMessage` ("The saved game was damaged, so the night
starts fresh.") on that branch, the way `pwdChooseContent` already does for a
failed `?game=`.

**PW-D7 — `.log-note` is 10.88 px, below the design system's smallest token (minor).**
`games/password/css/pwd.css:534` — the clue log's plain-word label ("clue",
"correct", "wrong", "illegal clue") computes to 0.68 rem = 10.88 px. It is the
only text under 12 px anywhere on the host screens, and `docs/design-system.md`
line 148 puts the floor at `--fs-micro: 12px` ("eyebrows only"). It matters a
little more than usual because that word is what makes colour not the only
signal in the log. I did not change it because the word screen is a fixed-height
grid and a size bump could cost the no-scroll guarantee at 1280×676 — the
implementer should raise it to `var(--fs-micro)` and re-measure.

**PW-D8 — the setup screen scrolls vertically at 1280×720 (minor, informational).**
`scrollHeight 898` vs `clientHeight 720`. The spec's no-scroll rule is for the
screens "in play" and all of those pass at both heights; a setup form that
scrolls is normal. Recorded so nobody reads the implementation report's layout
claim as covering setup.

### Observations, no action needed

- The value read-out shows the **last** clue's worth between clues (10 after the
  first clue is answered, dropping to 9 only when the second clue is given).
  Because a guess can only follow a clue, the number is always correct at the
  moment the host judges. Matches the spec's wording; noted so it is not
  re-reported as a bug.
- `?game=` failures surface the raw parser text ("Unexpected token '#', …"). The
  sentence around it is plain English and it does tell the host what happened.
- The phone's transient "Sent — clue given." status is overwritten by the next
  view push a moment later; the button's disabled state carries the feedback.
- `nextGame` always deals the new game to Team A regardless of `state.firstTeam`;
  the host can still press *Team B open instead* before the first clue, and the
  spec only pins the host's choice for the first word of the night.
- The core lets `toLightning{team}` name the losing team. No UI path and no phone
  message can reach it (`pwdToLightning` only passes `giver`), so it is host
  flexibility rather than a hole.

---

## 4. Verdict

**Ship.** Password is a faithful, complete adaptation: the ladder, the alternation,
the illegal-clue forfeit, the mid-word target, the role swap, the Lightning Round
with passes, the buzzer rule and the all-five bonus all behave exactly as spec 13
§1 describes, and the money reaches both members of the team and the hub
scoreboard. The one rule the whole game rests on — that only the two givers ever
see the password, and only the winning giver ever sees a Lightning word — held
against an exhaustive audit of more than ten thousand states across eight pids,
against real WebRTC with a giver's phone on each team, and against the host
document's own text at every point of a full game in both modes. The one
substantive defect I found (PW-D1: words scoreable while the clock was paused,
reachable in practice after a reload mid-Lightning) is fixed in two lines, pinned
by a unit test, and re-verified in the browser; the other three fixes were a
hidden-DOM residue, one ambiguous word and a gate list. What is left for the
implementer — namespacing the harness's storage (PW-D5), a message when a
damaged save is dropped (PW-D6) and one under-sized label (PW-D7) — is all minor
and none of it blocks a game night. 114 unit tests, harness 74/74, repo-root
989/989, every static gate green.

### For the orchestrator

1. Hand **PW-D5**, **PW-D6** and **PW-D7** to the password implementer; none is
   release-blocking, so listing them under README "known issues" is an
   acceptable alternative for PW-D7.
2. **PW-D5 is a pattern worth a sweep**: only Price Is Right namespaces its
   harness storage. Chain Reaction, Pyramid and Deal or No Deal use the same
   `KEYS = [...production keys...]` shape and will leave fixture state behind in
   the same way. Worth one cross-cutting pass rather than four separate tickets.
3. `shared/theme.css` now carries the `password` accent block with the dark
   `--accent-ink: #241a02` the implementer asked for — confirmed live at
   10.8:1 on the gold. Nothing further needed there; the `§9` item in
   `password-implementation.md` can be closed.
4. Files touched by me, all inside my remit: `games/password/js/pwd-core.js`,
   `js/pwd-view.js`, `words.json`, `js/data.js`, `tests/harness.html`,
   `tests/pwd-fixtures.mjs`, `README.md`, new `tests/pwd-adversarial.test.mjs`
   and `tests/pwd-fuzz.test.mjs`, plus this report. No git commands were run.
