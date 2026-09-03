# Wheel of Fortune — implementation report

Component: `wheel-of-fortune` · Spec: `docs/04-wheel-of-fortune-spec.md` ·
Status: **complete, self-verified, ready for the tester.**

Environment: Windows 11 (10.0.22635), Node v24.16.0, Python 3.13.14,
Chromium in-app browser, 2026-09-03. Server used for browser checks:
`python -m http.server 8643 --bind 127.0.0.1` from the repo root.

---

## 1. Files

Everything below is new. Nothing outside `games/wheel-of-fortune/**` and this
report was created or edited. No git commands were run.

| File | Lines | What it is |
|---|---:|---|
| `games/wheel-of-fortune/index.html` | 318 | Host screens + phone screens in one page, `<body data-gsc-game="wheel-of-fortune">` |
| `games/wheel-of-fortune/puzzles.json` | 27 | The shipped content: 10 rounds (2 toss-ups, 7 regular, 1 bonus) |
| `games/wheel-of-fortune/README.md` | 163 | How to host, JSON schema table, phone features, layout, known issues |
| `js/wheel-content.js` | 386 | **PURE (UMD)** constants, sanitisers, `layoutPuzzle`, `validateGame`, `normalizeGame` |
| `js/wheel-core.js` | 706 | **PURE (UMD)** `createState`, `reduce`, `legalActions`, selectors; re-exports all of the above |
| `js/wheel-draw.js` | 271 | The SVG wheel + spin animation (`createElementNS`), tick callback, reduced-motion path |
| `js/wheel-view.js` | 193 | Board / used-letters / keyboard / podium / standings DOM builders |
| `js/wheel-app.js` | 562 | Host glue: state, `localStorage` (`gsc-wheel-state-v1`), content loading, every button |
| `js/wheel-room.js` | 210 | `GSC.host` glue: roster → players, phone intents → reducer events, phone views out |
| `js/wheel-phone.js` | 226 | `GSC.player` glue: the phone controller |
| `js/wheel-editor.js` | 397 | In-page editor (draft `gsc-wheel-draft-v1`), live board + wheel preview |
| `js/wheel-sound.js` | 155 | WebAudio synthesis behind the shared `gsc-sound` toggle |
| `js/wheel-timer.js` | 130 | Bonus-round red-block countdown, DOM half |
| `js/timer-core.js` | 55 | Countdown maths, copied verbatim from `games/jeopardy/js/timer-core.js` |
| `js/data.js` | 38 | Offline mirror of `puzzles.json` |
| `css/wheel.css` | 394 | Host styles (royal purple stage, teal, white/green board, gold money) |
| `css/wheel-phone.css` | 158 | Phone controller, 320–430 px portrait, ≥ 56 px targets |
| `css/timer.css` | 112 | Red-block timer, copied from `games/jeopardy/css/timer.css` |
| `tests/wheel-core.test.mjs` | 777 | `node:test` suite, 41 tests covering W-U1 … W-U10 |
| `tests/harness.html` | 644 | Browser loopback harness, 46 checks covering W-I1 … W-I7 |

Largest file is 777 lines — every file is under the 800-line limit.

## 2. How to run it

```bash
# unit tests (zero dependencies)
cd games/wheel-of-fortune && node --test

# browser: serve the repo ROOT, not the game folder
python -m http.server 8643 --bind 127.0.0.1
```

- Host, standalone: `http://127.0.0.1:8643/games/wheel-of-fortune/`
- Phone, standalone: the join link the host shows, `…/?room=CODE`
- Loopback harness: `http://127.0.0.1:8643/games/wheel-of-fortune/tests/harness.html`
  — green when `#summary` reads **"All 46 checks passed."** and carries class `ok`.
  It also publishes `window.__WHEEL_HARNESS__ = {total, failed, uncaught, results, done}`.
- Embedded: open the hub at `/` and choose Wheel of Fortune.

## 3. Test results

### 3.1 Unit (T1) — `cd games/wheel-of-fortune && node --test`

```
ℹ tests 41
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 496.4163
```

| ID | Result | Evidence (test names, all ✔) |
|---|---|---|
| **W-U1** `validateGame` | PASS | "accepts the shipped puzzles.json" (10 rounds = 2 toss-up + 7 regular + 1 bonus, 24 wedges); "rejects bad content with a plain-English message" — table-driven over lowercase-with-digits, a 64-tile puzzle, a 20-letter word, two bonus rounds, bonus not last, an all-BANKRUPT wheel, wedge `-100`, wedge `555` (not a multiple of 50), a 2-wedge list, empty category, 31-char category, empty `rounds`, `vowelCost: 0`, `bonusSeconds: 61`, `null`, `[]`; "normalizeGame uppercases puzzles and fills settings defaults"; "autoOrder sorts tossup, regular, bonus"; "a normalized game re-validates (reload-resume round-trip)" |
| **W-U2** `layoutPuzzle` | PASS | "never splits a word and respects 12/14/14/12" (rows exactly `[12,14,14,12]`, each word whole on exactly one row); "centres each row" (left/right padding differ by ≤ 1); "returns null when it cannot fit" (20-letter word, 15-letter word, 64-tile puzzle, empty, digits, `null`; a 14-letter word does fit); "punctuation occupies a tile and layout is deterministic" (apostrophe owns a tile, `cell.i` indexes the normalised text, two calls deep-equal) |
| **W-U3** spin / wedges | PASS | "spin lands on the index the injected rng picks" (all 12 indices, plus `rng()===1` clamps to the last and `rng()===0` to the first); "BANKRUPT zeroes the round total only, and passes the turn" (round 1000→0, banked 4000 untouched, turn 0→1); "LOSE A TURN passes the turn and keeps the money"; "a dollar wedge requires a consonant next" (spin/buyVowel/solve all false, no vowels offered, a second `spin` is a no-op) |
| **W-U4** letters / vowels | PASS | "callLetter reveals every occurrence, pays value × count, keeps the turn" (2 × R at $500 = $1,000, both tiles on the board); "an absent letter passes the turn; a used letter is not offered"; "a vowel after a spin is illegal"; "buying a vowel deducts and needs round ≥ cost" ($1,000 → $750, only A E I O U offered, consonants rejected, a revealed vowel keeps the turn, a missed vowel passes it) |
| **W-U5** solving | PASS | "a correct solve banks max(round, roundMinimum) and clears the others" ($800 → banks $1,000, everyone else's pot → 0, board full); "a big round total banks in full and the solver starts the next round" ($1,800 banked, next round `turn` = the solver, money carries over); "a wrong solve passes the turn" |
| **W-U6** only-vowels / full board | PASS | "onlyVowelsLeft disables spin" (`legalActions.spin === false`, the `spin` event itself is ignored); "a fully revealed board still needs a solve confirmation" (`roundDone` stays false until `solveJudged{correct:true}`; only `solve` is legal) |
| **W-U7** toss-up | PASS | "the reveal order is a permutation of the hidden letter positions" (sorted order equals the letter indices, no duplicates, reproducible for a seed); "a buzz pauses reveals and locks the other players out"; "a wrong toss-up answer locks that player and resumes reveals"; "a correct answer awards the nth toss-up value" (1st = 1000, 2nd = 2000, winner starts the next round); "nobody solving means no points" |
| **W-U8** bonus | PASS | "the leader plays the bonus round and RSTLNE are pre-revealed"; "ties go to the first player, and setTotal can override the leader"; "picks must be 3 distinct unused consonants and 1 vowel" (9 rejection cases); "picks are revealed, then the host judges" (one pick only, win/lose one-shot, board filled) |
| **W-U9** undo / illegal / immutability | PASS | "undo restores the exact previous state" (deep-equal to the pre-event snapshot; replay reproduces the post-event state; undo past the start is a no-op); "illegal events are ignored (table-driven)" — 20 cases, each asserting the reducer returns the **same object** (`===`); "the reducer never mutates its inputs" (deep-frozen state + events across the regular, toss-up and bonus paths, `JSON.stringify` unchanged); "state survives a JSON round-trip" |
| **W-U10** phone payloads / views | PASS | "validatePhoneMsg accepts the documented shapes and rejects junk" (16 junk cases → `null`); "solve text is capped and control characters are stripped" (80-char cap, no C0/C1 survives); "phoneView never gives a non-active player the turn screen"; "phoneView masks unrevealed letters" (the answer never appears in the serialised view); "phoneView tossup and bonus screens are player-specific" |

### 3.2 Loopback (T2) — `tests/harness.html`

**All 46 checks passed** (`#summary.ok`), run twice back to back with the same
result. The harness *is* the shell: it implements the bridge protocol from
00 §6 itself (posts `init`, routes `send` ↔ `msg`) and drives one
`?embed=host` frame and two `?embed=player` frames. It re-fetches every asset
with `cache:"reload"` first (the Jeopardy stale-bundle guard).

| ID | Result | Evidence (harness detail text) |
|---|---|---|
| Boot | PASS | `players: Ana, Ben` — both phones joined through the bridge, `phonePids.size === 2` |
| **W-I1** | PASS | "the animation stops on the wedge the core chose" — `core=7 dom=7 rotation=1687.5deg` (DOM rotation fed back through `WheelDraw.wedgeAtPointer`); "turns several times before landing" — `1688deg` ≥ 3 turns; "the readout matches the wedge" — `"$650"`; "with reduced motion the wheel jumps straight to the result" — `onDone` had already fired when `spin()` returned, landing on wedge 3 with the `wheel-faded` fade class |
| **W-I2** | PASS | "only the player on turn gets the turn screen" — `p1=turn p2=wait`; "the phone keyboard offers consonants only after a spin" — `21 keys enabled, none a vowel`; "a phone letter (C) reveals on the host board" — `revealed 2 → 3`; "used letters are disabled on the phone keyboard"; "a phone SPIN drives the host wheel" — host banner `"$650 — Ana, call a consonant."`; "the host shows it is waiting for a phone player" — `"Waiting for Ana's phone…"`; "Take over lets the host act instead of the phone"; "the host reports standings to the shell" — `scores=[{p1,Ana,1000},{p2,Ben,0}] title="Round 2"` |
| **W-I3** | PASS | "buzzers are disarmed before Start" — `p1 button = "WAIT"`; "buzzers arm on Start reveal" — both read `"BUZZ"`; "the first buzz pauses the reveals" — `revealed frozen at 4 for 1.8 s` (longer than the 1.2 s tick); "only the buzzing phone is on the spot"; "the host shows who buzzed" — `"🔔 Ben"`; "Wrong locks that player and the reveals resume" — `locked=p2 running=true`; "a correct toss-up pays the nth value and fills the board" — `Ana total = 1000` |
| **W-I4** | PASS | "the leader plays the bonus round" — `leader=p1, free letters=RSTLNE`; "only the leader's phone gets the bonus screen" — `p1=bonus p2=wait`; "the free letters are not offered again" — `vowels offered: AIOU`; "the phone collects 3 consonants and a vowel" — `picked B C D A`; "the phone's picks land on the host and are revealed" — host shows `"B  C  D  A"`; "the countdown blocks run on the host and on the phone" — `host lit 9/9, phone blocks 9`; "the countdown actually counts down" — `lit 9 → 7`; "the host judges … and the prize is announced" — `"🎉 $25,000!"`; "the game ends on the standings, mirrored to the phones" |
| **W-I5** | PASS | Host frame reloaded mid-round; `roundIndex` `1→1`, `used` `CBD→CBD`, `revealed` bit-for-bit identical, `turn` `0→0`, totals `650/1000,0/0 → 650/1000,0/0`, and the board tiles repaint to the same text |
| **W-I6** | PASS | "the editor's live board preview matches layoutPuzzle" (tile-for-tile); "a puzzle that doesn't fit blocks Download and Use" — both buttons disabled, inline `ed-fit-bad`, error `Round 2: "SUPERCALIFRAGILISTICEXPIALIDOCIOUS" does not fit the board (…)`; "fixing the puzzle unblocks Download"; "the wheel preview follows the wedge chips" — `24 → 25 → 24` SVG wedges as a chip is added and removed; "Use in game loads the edited content through validateGame" |
| **W-I7** | PASS | 19 files scanned: no HTML-string / `document.write` / `eval` / Function-constructor APIs; no `console.*log` in `js/`; every file under 800 lines; the only external URLs in loaded assets are Google Fonts (plus the SVG XML namespace, which is never fetched); `data-gsc-game="wheel-of-fortune"` and `#gsc-join` present; body classes — host `gsc-embedded`, phone `player-mode gsc-embedded` |

### 3.3 Standalone / regression (T4)

**Host-only, full game, no phones at all** — driven through the real UI at
`http://127.0.0.1:8643/games/wheel-of-fortune/` with three players
(Ana, Ben, Cid):

1. Toss-up "AROUND THE HOUSE" — Start reveal, letters appeared one at a time
   (E, J, A …), host clicked Ben's podium to name the solver, **Correct** →
   `Ben takes the toss-up — $1,000!`, board filled, Ben shows the LEADER badge.
2. Regular round "THING" — Spin landed $800 (core index 11, DOM rotation
   1627.5° → same index), called N, S, H; forced **BANKRUPT** (round pot
   $1,700 → $0, banked money untouched, turn passed) and **LOSE A TURN**
   (turn passed, pot kept); bought a vowel (−$250, only A E I O U offered);
   solved → `Cid solves it and banks $1,550!`.
3. Regular round "FOOD & DRINK" — 4 × H on the $2,500 wedge = $10,000
   (plural banner `4 H's — $10,000 for Cid.`), 2 × C, vowel O, solve →
   banked $10,950, grand total $12,500.
4. Bonus round — leader Cid, `R S T L N E` auto-revealed
   (`T_E __NNER'S __R_LE`), host picked C H M + I, letters revealed, the
   9-block red timer ran, **Correct** → `🎉 $25,000!`.
5. **Play again** / **Final standings** — Cid $12,500, Ben $9,000, Ana $4,000.
6. Reload mid-round restored the board, used letters, turn, pending wedge and
   totals exactly (also asserted mechanically as W-I5).

**Standalone with a real phone over PeerJS (real broker + WebRTC, not faked):**
clicked **Open room (phones)** → room `GRSP` opened, join link
`http://127.0.0.1:8643/games/wheel-of-fortune/?room=GRSP`. A second browsing
context joined as "Zoe"; the host added her automatically and a local player
"Hal" was added by hand alongside her (mixed phone / no-phone roster).
Verified over the live connection: toss-up buzzer showed `WAIT` → `BUZZ` on
Start, buzz reached the host (`Zoe buzzed in — what is it?`), **Correct**
awarded $1,000; in the next round the phone's **SPIN** drove the host wheel to
$800 and the phone's letter **C** revealed on the host board
(`1 C — $800 for Zoe.`), with the phone mirroring `$800 · $1,000 banked`.
An earlier identical run on a different port also succeeded, so this is not a
one-off. **T3/T4 are not BLOCKED-ENV here** — the PeerJS broker and WebRTC both
worked from this machine.

**Screenshot evidence** was captured in-session at 1280×900 (board + wheel in a
regular round: white tiles with dark-green letters on the green board, the
`THING` category strip, the banner `$600 — Ana, call a consonant.`, the
used-letter tracker with E/S/T greyed, the on-screen keyboard with vowels and
used letters disabled, the 24-wedge SVG wheel with the white pointer, black
BANKRUPT and white LOSE A TURN wedges, the `$600` readout, and three podiums
with Ana highlighted at $1,450). Image files are **not** committed: I own only
`games/wheel-of-fortune/**` and this report, and `docs/reports/img/` belongs to
the tester (06 §5). The tester can reproduce the exact frame with the T4 steps
above. At 1280×900 the whole game screen fits with no scrolling
(`scrollHeight === innerHeight === 900`); at 1280×820 it is 830 px, i.e. ~10 px
of scroll.

### 3.4 Static gates (T5)

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | PASS | 41/41, above |
| **V2** every file < 800 lines | PASS | largest is `tests/wheel-core.test.mjs` at 777; see the table in §1 |
| **V3** no HTML-string / `document.write` / `eval` / `new Function` | PASS | `grep -rnE "innerHTML\|insertAdjacentHTML\|outerHTML[[:space:]]*=\|document\.write\|[^.[:alnum:]_]eval\(\|new Function" games/wheel-of-fortune/` → no matches (exit 1). The literals do not appear even in comments or in the harness's own gate, so a repo-wide `rg` stays clean. All DOM is `createElement` / `createElementNS` / `textContent` |
| **V4** no `console.log` | PASS | `grep -rn "console\.log" games/wheel-of-fortune/` → no matches (exit 1); diagnostics use `console.warn` only |
| **V5** no Peer/connection/DOM/timer handles in state | PASS | code read — `createState` returns only JSON-serialisable values, and the suite proves it (`W-U9 state survives a JSON round-trip`). The `setInterval` id for toss-up reveals, the spin cancel function, `phonePids`, the bonus pick buffer and the countdown map are all module-scoped, never in `setState` |
| **V6** external URLs | PASS | only `https://fonts.googleapis.com`, `https://fonts.gstatic.com` and the `http://www.w3.org/2000/svg` XML namespace (never fetched). The game itself loads no CDN script; PeerJS is pulled lazily by `shared/room-host.js` / `room-player.js`, which this component does not own |
| **V7** `data-gsc-game`, `#gsc-join`, body classes | PASS | W-I7 above; host body gets `gsc-embedded`, phone body gets `player-mode gsc-embedded` |
| **V8** `?game=URL` and upload use the same `validateGame` | PASS | code read (`fetchContent`, `onUpload`, `useGame`, editor `validateNow`/`download`/`useInGame` all call `WheelCore.validateGame`) plus the W-I6 "Use in game" check |

## 4. Phone integration status

**Verified against the real `shared/bridge.js`.** It did not exist when I
started, so I began against 00 §7 and wrote a temporary shim; the real SDK
landed mid-task and **the shim was deleted** — the page now loads
`shared/room-protocol.js`, `room-net.js`, `room-host.js`, `room-player.js`,
`bridge.js` (in that order) and uses `window.GSC` exactly as specified.

- **Embedded (`?embed=host` / `?embed=player`)**: verified by the harness,
  which speaks the 00 §6 bridge protocol as the shell — join, `msg` routing
  both ways, `scores`, `title`, roster events. Not yet exercised against the
  real `index.html` hub shell (that is the hub's own integration test), but the
  wire format is the one the shell posts.
- **Standalone (`?room=CODE`)**: verified over a real PeerJS room end to end
  (§3.3), including a mixed phone / manually-added roster.
- **Host authority**: every phone payload goes through
  `WheelCore.validatePhoneMsg` and is then dropped unless the sender is the
  player whose turn it is (`buzz` is checked against the toss-up lock list,
  `bonus-pick` against the bonus leader). Phones never score and never advance.
- **Take over**: the host shows "Waiting for {Name}'s phone…" with a
  **Take over** button that clears the phone marking so the host can act.
  The host buttons mirror the phone's `legalActions` at all times anyway, so
  the host can act even without pressing it.
- `room.exit()` is wired to a **Back to lobby** button, shown only when embedded.

## 5. Deviations from the spec, with reasons

1. **`js/wheel-core.js` split into `wheel-content.js` + `wheel-core.js`.**
   Spec §4/§7 describe one pure file. Written as one it came to 1,037 lines,
   over the hard 800-line house rule. `wheel-content.js` holds the constants,
   sanitisers, `layoutPuzzle` and the validators; `wheel-core.js` holds the
   state, reducer and selectors **and re-exports everything from the content
   half**, so `WheelCore` is still the single API in spec §4 and every caller
   and test uses only `WheelCore`. `wheel-content.js` must load first.
2. **`js/wheel-view.js` added.** Same reason: the host glue with its DOM
   builders inline exceeded 800 lines. `wheel-view.js` is dumb renderers only
   (board, used letters, keyboard, podiums, standings); all rules stay in the
   core and all state in `wheel-app.js`.
3. **`js/timer-core.js` and `css/timer.css` copied from `games/jeopardy`.**
   The task says to reuse the red-block timer, but `games/jeopardy/**` is
   vendored and outside this component's ownership; a cross-game
   `<script src="../jeopardy/js/timer-core.js">` would break the next
   re-vendoring. `js/wheel-timer.js` is the DOM half, adapted from Jeopardy's
   `timer.js` to this game's two slots (`bonus`, `phoneBonus`) and given an
   `onExpire` hook for the time's-up sting.
4. **`solveJudged{correct:true}` does not itself advance the round.** W-U5 says
   "advances round". It banks the money, clears the other pots, fills the board
   and sets `roundDone: true`, then the host presses **Next round** — the
   solved board has to stay up to be read out. `nextRound` then advances and
   the solver starts, which the tests assert explicitly.
5. **`layoutPuzzle` also centres short puzzles vertically.** Spec §3 only asks
   for horizontal centring per row. A 1- or 2-line puzzle packed against the
   top of a 4-row board looks wrong on a projector, so the rows are pushed down
   when — and only when — every line still fits its new, wider row (a 3-line
   puzzle packed against 12/14/14 can never slide onto 14/14/12, so it stays).
   Still greedy, still deterministic, still 12/14/14/12.
6. **`settings.autoOrder` added** (default `false`), implementing the
   "whether the game auto-orders rounds" line in spec §1 as an explicit,
   validated JSON setting and an editor checkbox.
7. **Spin animation is driven by `requestAnimationFrame`, not a CSS
   `transition`.** Spec §3 says "CSS transform on the SVG group" — the group's
   `style.transform` is still what changes, but stepping it per frame is what
   lets the wedge-crossing tick sound fire at the right moments. Ease-out cubic
   over 3.2 s (≥ the 3 s minimum), ≥ 4 full turns. `prefers-reduced-motion`
   still jumps to the result with a fade, as specified.

## 6. Known gaps

- **Non-goals not implemented, as specified**: prize wedges, Wild Card, Free
  Play, Mystery and Million-dollar wedges, and the "Final Spin" speed-up round.
  The host can jump to the bonus round with **Next round**.
- **The hub shell integration is untested from the hub side.** The game's
  embedded half is proven by the harness against the real `shared/bridge.js`,
  but nobody has yet loaded it from `index.html`'s lobby. Worth one pass in the
  hub's own verification.
- **Mid-game joins** land the new player at $0 and they play from the next
  turn; there is no "wait until the round ends" gate. Deliberate, but it is a
  judgement call the tester may want to look at.
- **A player who leaves stays on the board** with their money, so a phone
  refresh re-links to the same podium. They are still dealt turns; the host
  skips them with **Next player**.
- **Sound needs a gesture.** The AudioContext is created on the first click
  (Start game or the sound toggle). Before that, nothing plays — browser
  autoplay policy, not a bug.
- **The wheel's tick sound is throttled twice** (once in `wheel-draw.js` at
  45 ms between wedge crossings, once in `wheel-sound.js` at 40 ms). Early in a
  fast spin some wedges pass without a tick; this reads better than a buzz.

## 7. Defects found and fixed during self-verification

Recorded because they are the kind of thing the tester would otherwise hit.

1. **`normalizeGame` produced content its own `validateGame` rejected**
   (`wheel-content.js`). It emitted `wedges: null` / `value: null` for absent
   per-round overrides, and `validateRound` only skipped `undefined`. Because
   `init()` re-validates the saved game slice, **reload-resume silently threw
   away every game in progress**. Fixed by omitting the keys instead of
   nulling them, and by treating an explicit `null` as "not set" (hand-written
   JSON uses it too). Regression test added: "W-U1 a normalized game
   re-validates (reload-resume round-trip)".
2. **The on-screen keyboard kept its first click handler**
   (`wheel-view.js`, same pattern in `wheel-phone.js`). The A–Z buttons are
   built once and reused, so the handler captured at build time stayed bound —
   in the bonus round the keys still ran the regular round's "call a letter"
   handler and **picking bonus letters did nothing**. Fixed by looking the
   handler up per render through a `WeakMap` keyed on the container.
3. **A spin could never finish in a backgrounded tab** (`wheel-draw.js`).
   `requestAnimationFrame` stops firing when the tab is hidden, so `onDone`
   never ran, `spinning` stayed `true` and the host was **locked out of their
   own game**. Fixed with an idempotent wall-clock guard
   (`setTimeout(finish, duration + 900)`) alongside the rAF loop.
