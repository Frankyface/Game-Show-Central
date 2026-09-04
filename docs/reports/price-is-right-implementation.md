# price-is-right — implementation report

Component: **The Price Is Right** (`games/price-is-right/**`)
Spec: `docs/10-price-is-right-spec.md` · Owner: implementer agent · 2026-09-04
Environment: Windows 11 (10.0.22635), Node v24.16.0, Chromium via the in-app
browser, served from the repo root with `python -m http.server 8691 --bind 127.0.0.1`.

Status: **complete**. 46 unit tests green, 57 loopback-harness checks green, a
full episode played host-only with four manual players at 1280×720 with no
vertical scroll on any screen, and one phone joined over the real PeerJS broker
to exercise a masked bid, a Plinko slot pick and a wheel spin.

---

## 1. Files

| File | Lines | What it holds |
| --- | ---: | --- |
| `index.html` | 264 | Every host screen plus the phone screen, one page, `data-gsc-game="price-is-right"` |
| `prizes.json` | 112 | 12 One Bid items, 3 Cliff Hangers sets, 3 Plinko sets, 3 Lucky Seven cars, 4 showcases |
| `js/tpir-content.js` | 432 | **Pure**: the JSON contract, `validateGame`, `normalizeGame`, `warningsFor`, `drawFrom` |
| `js/tpir-select.js` | 466 | **Pure**: `plan`, `rowWinner`, `cliffClimb`, `plinkoPath`, `l7Cost`, `showdownWinner`, `showcaseResult`, `phoneView`, `validatePhoneMsg` |
| `js/tpir-core.js` | 741 | **Pure**: the immutable reducer, `createState`, `legalActions`, `segmentDone`, undo |
| `js/data.js` | 350 | Offline mirror of `prizes.json`; sets `globalThis.TPIR_DEFAULT_GAME` |
| `js/tpir-sound.js` | 136 | WebAudio cues (no audio files), `gsc-sound` preference |
| `js/tpir-wheel.js` | 266 | The big wheel drawn as a vertical drum, plus its spin animation |
| `js/tpir-view.js` | 469 | Host screens + the shared `$` / `el` / `show` / `setText` helpers |
| `js/tpir-games.js` | 464 | Cliff Hangers, Plinko and Lucky Seven stages, and the chip animation |
| `js/tpir-app.js` | 581 | Host glue: app state, persistence, content loading, buttons, hotkeys, splash |
| `js/tpir-editor.js` | 409 | The prize editor (tabs, add/remove/reorder, live validation, download/use) |
| `js/tpir-room.js` | 243 | Host glue on `GSC.host`: phone intents in, masked views out |
| `js/tpir-phone.js` | 232 | The phone controller |
| `css/tpir.css` | 548 | Carnival stage, topbar, setup, row, showdown, showcase, standings, editor |
| `css/tpir-games.css` | 308 | The three pricing-game stages |
| `css/tpir-phone.css` | 139 | The phone, 320 px and up |
| `tests/helpers.mjs` | 123 | Shared unit-test fixtures |
| `tests/tpir-core.test.mjs` | 396 | P-U1 … P-U5 |
| `tests/tpir-show.test.mjs` | 410 | P-U6 … P-U10 |
| `tests/harness.html` | 786 | The loopback harness, P-I1 … P-I6 (57 checks) |
| `tests/fixtures/harness-prizes.json` | 75 | A deterministic prize file for the harness |
| `README.md` | 202 | How to host, the JSON schema table, phone features, layout, known limits |

Every file is under the 800-line house limit; no function exceeds 50 lines
(checked with a brace-depth scan over every `.js`/`.mjs`).

## 2. How to run it

```bash
cd games/price-is-right && node --test            # 46 unit tests
python -m http.server 8620                        # from the repo root
#   host:    http://localhost:8620/games/price-is-right/
#   harness: http://localhost:8620/games/price-is-right/tests/harness.html
#   phone:   http://localhost:8620/games/price-is-right/?room=CODE
```

The harness is the shell: it loads the real page as `?embed=host` plus four
`?embed=player` frames and speaks the bridge protocol itself. It is green when
`#summary` has class `ok`; `window.__TPIR_HARNESS__` carries the machine-readable
result.

---

## 3. Results per success state

### Unit — `node --test`, 46 tests, 0 failures

| ID | What it covers | Evidence |
| --- | --- | --- |
| **P-U1** | The validator table: 31 broken files each rejected with a plain-English reason naming the field; a disabled pricing game needs no content; `prizes.json` validates and `js/data.js` mirrors it byte-for-byte; `normalizeGame` fills defaults, totals the showcases and never mutates its input; `warningsFor` flags a thin file without rejecting it | 5 tests. `assert.deepEqual(DEFAULT_GAME, SHIPPED)`; showcase totals 8600 / 6180 / 11550 / 8140 |
| **P-U2** | One Bid: closest without going over; an exact bid wins the bonus; everybody over → `allOver` and a rebid; a tie goes to the earliest bid (both orders checked); illegal bids (0, −5, 12.5, `"300"`, 1e9, empty pid) ignored; the reducer masks bids, banks `price + bonus`, records `comeOnDown`; the row refills from the queue with more than four players | 7 tests. `seats ["p1","p5","p3","p4"]`, `queue ["p6","p2"]` after p2 came on down |
| **P-U3** | Cliff Hangers: one dollar of error = one step; 25 steps survives, 26 falls; three exact prices win the prize; a fall ends the game and later guesses are ignored; out-of-range guesses ignored | 4 tests |
| **P-U4** | Plinko: `plinkoTruth`; the first chip is free and each right answer earns one more, capped at `maxChips`; wrong index / junk answer ignored; the bounce path is 13 long, stays on the board, keeps its parity and reflects off both walls; a drop pays the slot the **core** chose; no sixth chip | 5 tests. `plinkoPath(4, fixed(0))` → landing 0; `fixed(0.99)` → 8; `seq(0.1,0.9)` → 4 |
| **P-U5** | Lucky Seven: digits and cost; perfect digits keep $7 and win; exactly $1 left still wins, $0 loses; running out stops the game before the last two digits; out-of-range digits ignored | 4 tests |
| **P-U6** | Showdown: closest total ≤ $1.00 wins, over is out, a draw returns a tie, all-bust flagged; spinners ordered by winnings ascending; an exact dollar pays the bonus and ends the turn; a second spin can bust; staying keeps the total; a tie starts a one-spin-each spin-off from zero with no second spin | 4 tests |
| **P-U7** | Showcase: closest without going over; inside the margin wins both; both over → nobody wins and no money moves; the chooser's take/pass swaps the assignments and can only be made once; the payout adds both totals when `both`; **one player winning both showdowns still yields two different finalists** (regression, see §5) | 4 tests |
| **P-U8** | `plan(roster, settings, limits)` for 1 … 12 players: seats `min(4, n)`, 6 games, 2 showdowns, the segment list identical for every roster size; a 4-item and a 1-item file still produce a complete plan; `gamesPerShowdown` 1 and 4; a single player runs the whole episode to `standings` alone | 3 tests |
| **P-U9** | Unknown/illegal/`null` events return the identical object; undo walks back one step and restores exactly (and keeps `content`); the reducer never mutates a deep-frozen state across five event types; `legalActions` reports exactly what is available (`["start"]` at setup, `bid` but not `revealBids` on a fresh row, `chGuess` but not `plinkoDrop` in Cliff Hangers); `finish` jumps to the standings from anywhere and stops there | 5 tests |
| **P-U10** | `validatePhoneMsg` against a 22-row table (only the four documented intents survive, and the copy is narrow); a bidding phone sees its own bid and never another's, and never the price; a pricing-game phone never sees the answer, the Lucky Seven digits it has not reached, the `actual` of a Plinko price or the bounce `path`; only the active player gets controls; wheel, showcase, spectator and end-of-night views | 4 tests |

### Loopback — `tests/harness.html`, 57 checks, 0 failures

Final run: **“All 57 checks passed.”**

| ID | What it covers | Evidence in the run |
| --- | --- | --- |
| **P-I1** | The shell roster becomes the line-up; every phone gets the bid screen and none sees the price; three phones bid through the real pad; **the host masks all three as `•••` and the amount appears nowhere in the host DOM**; one phone never sees another's bid; a phone that has not bid still sees who has; the reveal pays `price + 500` for the exact bid, prints the real numbers and marks the over-bidder with the word “Over” | podiums `••• ••• ••• —`, `document.body.textContent` has no `$300`; winner `p2`, exact, `winnings.p2 = price + 500` |
| **P-I2** | Plinko end to end from a phone: the higher/lower screen never carries `actual`; four right answers earn the cap of five chips; the phone picks only the drop slot and the core rolls a 13-step path the phone never sees; **the chip animation ends on the core's slot** (`cx` within 0.6 units of `colX(landing)`); winnings grow by exactly the slot value; the game ends when the fifth chip lands | `slot 4 → landing N`, resting chip `cx` equals the slot centre |
| **P-I3** | The showdown: both contestants who came on down are at the wheel, lowest winnings first; only the current spinner gets the SPIN button; a phone spin drives the host; **the drum stops with the core's segment under the pointer** and the value shown is the value scored; the showdown closes with one contestant through | `segmentAtPointer(rotationOf(svg), 20) === lastSpin.index`; the band's `y` is 210 (the pointer line) and its text is `TpirWheel.label(value)` |
| **P-I4** | Take over: only the player who came on down gets the guess screen; the host's own field is disabled while the phone holds the controls; **Take over** unlocks it; the host's typed price is accepted; the taken-over phone's later `{t:"guess"}` is ignored; three exact prices win the prize | `guesses.length` stays 1 after the phone sends `value: 99` |
| **P-I5** | A reload at the showdown, at the row and at the showcase restores the same phase, segment index, winnings and roster, and repaints the right screen; the finalists, the pass, the masked showcase bids, the “wins both” margin, the standings and the phones' end-of-night view | `showcase#10 → showcase#10`; `Total hidden` before the reveal |
| **P-I6** | Editor round-trip (tab per list, a broken price explained and Use disabled, Download JSON re-validates, Use in game adopts the draft and clears the show) and the static gates: every file served and < 800 lines, no banned DOM API, no `console.log`, only Google Fonts as external URLs, `data-gsc-game` + `#gsc-join` present, the splash markup and call present, `prizes.json` validates, `data.js` mirrors it and reaches `globalThis`, the embedded page wears `gsc-embedded` and skips its own splash, **every `@keyframes` / `animation:` sits inside `prefers-reduced-motion: no-preference`**, every phone target ≥ 56 px across all seven phone screens at 320 px, and no phone screen scrolls sideways | 7 phone screens × ~9 targets = 40 targets measured, none under 55.5 px |

### T4 standalone — a full episode, host only, four manual players

Driven by clicking the real host controls (58 clicks) at 1280×720 in the
standalone page with no room open:

- Screens visited: `row`, `game:pick`, `game:cliffhangers`, `game:luckyseven`,
  `showdown`, `showcase`, `standings`; a second targeted pass covered
  `game:plinko` (answers and drops).
- `document.documentElement.scrollHeight` was **720 on every screen**, equal to
  `innerHeight` — no vertical scroll anywhere in play.
- The episode finished at `standings` with money on the board.
- Plinko in that pass: chip dropped from slot 1, core landing 1, resting chip
  `cx = 80.7` against an expected `80.7`.

### T3 real network — one phone over the real PeerJS broker

Standalone host opened a room (`Room VN2B`, then `Room CST2` after a restart),
phone joined at `?room=CODE&name=Ada` from a second tab emulating 320×640:

| Step | Result |
| --- | --- |
| Join | `GSC.mode = "standalone-player"`, host roster gains `p1 Ada`, `phones: ["p1"]`, phone `scrollWidth = 320` |
| Masked bid | Phone typed `$675` on the pad and pressed Bid → host `row.bids = {p1: 675}`, podiums `••• — — —`, and `675` appears nowhere in the host DOM |
| Plinko | Phone answered four small prices (`higher/lower/lower/that's right`, view carried no `actual`), earned 4 chips, picked slot 5 → host rolled `landing 6, value $1,000` |
| Wheel | Phone pressed SPIN → host `lastSpin {index: 3, value: 35}`, drum pointer at segment 3, `total 35¢`, `busy` cleared, no vertical scroll |

### Static gates

| Gate | Result |
| --- | --- |
| **V1** `node --test` | 46 pass, 0 fail |
| **V2** every file < 800 lines; functions < ~50 | largest file 786 (`tests/harness.html`); brace-depth scan reports no function over 50 lines |
| **V3** no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` | zero matches across the component, tests included |
| **V4** no `console.log` | zero matches (`console.warn` is used for diagnostics) |
| **V5** no Peer / connection / DOM / timer handle in state | code read: `tpirSet` only ever receives the core state, the content, the setup, strings and booleans; `tpirSerialise` drops `busy`, `phones` and `editorOpen`; the room, the rAF ids and the splash timer are module-local |
| **V6** external URLs | only `fonts.googleapis.com` / `fonts.gstatic.com` (the SVG namespace URI is not a fetch) |
| **V7** `data-gsc-game`, `#gsc-join`, `player-mode` / `gsc-embedded` | all present and wired in `tpirBoot` |
| **V8** `?game=URL` and file upload validate through `validateGame` | both go through `tpirFetchContent` / `tpirUseContent`, which call it; the harness loads the host with `?game=tests/fixtures/harness-prizes.json` |

### Contrast

Every text/background pair on the host and phone surfaces was computed from the
DOM. All pass (≥ 4.5:1 for body text, ≥ 3:1 for large display text), including
**both stops of every gradient that sits under text**: the price tag
(11.67 / 8.09), the gold button (10.95 / 7.29), the blue button (4.82 / 8.17),
the Lucky Seven bill (5.48 / 8.73) and every wheel band (5.45 … 11.67). Three
pairs failed on the first pass and were fixed:

- the Lucky Seven $1 bill (3.80:1) — gradient darkened to `#2f7346 → #1c5230`;
- the wheel's red band (3.89:1) — palette red darkened to `#b3242f`;
- the Cliff Hangers “The edge” label (3.08:1) — recoloured to `#ff9aa2`.

Colour is never the only signal: an over-bidder's podium carries the word
“Over”, the winner's says “Comes on down!”, a busted spinner says “Over a
dollar”, and the Plinko value chips carry their slot number.

---

## 4. Phone integration status

**Working.** Embedded (through the harness's bridge shell) and standalone
(through the real PeerJS broker) both verified.

- Phone → host: `{t:"bid",amount}`, `{t:"guess",value}`,
  `{t:"plinko",answer|slot}`, `{t:"spin"}`. Everything else is dropped by
  `validatePhoneMsg`, which returns a narrow copy or `null` and never throws.
- Host → phone: one `{t:"view",…}` per phone, de-duplicated by a `lastSent`
  cache that is cleared on join and on a status change so a reconnecting phone
  always gets a fresh push.
- Views are pushed on every state change, on `player-join` and on
  `player-status`, so a late joiner or a reloading phone never sits on
  “Waiting…”.
- The host is authoritative: every intent is rebuilt into an event and checked
  again inside the reducer. A phone cannot reveal bids, advance a segment, pick
  a Plinko landing slot, or act for someone else.
- Saved state is room-scoped: `bindRoom` clears a resumed show whose roster
  contains phone pids when the room code changes, so a fresh `p1` never
  inherits the previous room's seat.
- **Take over** on the host silences a phone for the current segment and shows
  it a plain waiting card; moving on returns the controls.

---

## 5. Defects found and fixed during implementation

| # | Severity | What | Fix |
| --- | --- | --- | --- |
| 1 | **major** | The same contestant can win both Showcase Showdowns (they only have to keep winning One Bid). `showcaseFinalists` returned `[p1, p1]`, so the second showcase had no owner and the reveal threw. Found by the harness. | `showcaseFinalists` now de-duplicates the showdown winners and fills the empty chair from the standings. Regression test added (P-U7). |
| 2 | **major** | The Plinko chip animation had no wall-clock guard, so a backgrounded host tab (where `requestAnimationFrame` stops) left `busy = true` and locked the host out of their own show. Found during the real-network run. | `animateDrop` now has an idempotent `finish()` plus a `setTimeout` guard, matching `tpir-wheel.js` and `wheel-draw.js`. |
| 3 | minor | The host screens collapsed to their content height: `.screen { height: 100% }` resolved against an `auto` parent. | `#tpir-main` is a flex column and each `.screen` claims `flex: 1`. |
| 4 | minor | The drum's intrinsic SVG height stretched the grid row and pushed the showdown screen 10 px past 720. | The drum and the Plinko board are capped against the viewport (`min(27rem, 57vh)` / `min(25rem, 52vh)`). |
| 5 | minor | Plinko slot values drawn as SVG text overflowed their 50-unit columns (`$10,000`). | Values moved to a nine-column row of HTML chips under the board, which CSS can size. |
| 6 | minor | Three contrast pairs below 4.5:1 (see above). | Recoloured. |

---

## 6. Deviations from the spec, and why

1. **The pure core is three files, not two.** The spec names
   `js/tpir-content.js` + `js/tpir-core.js`; a third, `js/tpir-select.js`, holds
   every selector and the rules maths. Without it `tpir-core.js` would be about
   1,150 lines. `TpirCore` re-exports everything from all three, so the API in
   spec §4 is unchanged. This is the same accepted split as Feud, Wheel,
   Weakest Link and Millionaire (triage report, “Deviations … accepted”).
2. **The unit suite is two files plus `helpers.mjs`.** Same reason: one file was
   885 lines. `node --test` picks up both.
3. **`js/tpir-view.js` is a separate file** from `tpir-app.js` (as in
   Millionaire), so both stay well under the cap.
4. **`showcasePass` carries a `pass` flag.** The spec lists only
   `showcasePass`; the host needs both “bid on this one” and “pass it over”, so
   the event is `{type:"showcasePass", pass:boolean}` (default `true`). No new
   event name was introduced.
5. **`plan(roster, settings, limits)` takes a third, optional argument.**
   `limits.oneBid` caps the number of pricing games at the number of One Bid
   items the file actually carries, so a thin file yields a shorter but complete
   episode instead of running dry. Omitting it falls back to
   `gamesPerShowdown × 2`, which is what spec §4 describes.
6. **The per-game accent lives in `css/tpir.css`, not `shared/theme.css`.**
   The design system asks for accents to be added to the shared sheet, but this
   component owns only its own directory. `body[data-gsc-game="price-is-right"]`
   in `tpir.css` sets `--accent`, `--accent-2`, `--accent-ink` and
   `--stage-glow`; the sheet loads after the theme, so it wins at equal
   specificity. **The orchestrator may want to move that block into
   `shared/theme.css` alongside the other six games** when the registry entry is
   added.
7. **`.btn-blue` is defined locally.** The shared theme ships gold, ghost and
   danger; the show's blue button is defined in `tpir.css` the same way the
   other games define their own extra button.
8. **The showcase pair is drawn, not fixed.** With four showcases in the shipped
   file the two the finalists see are drawn without repeating, which keeps
   replays fresh. Spec §1 only requires “two showcases”.
9. **Take over is scoped to the current segment.** The spec says “Everything
   mirrored on the host with a Take over control” without saying how long it
   lasts. Persisting it for the whole show meant a phone silenced for one
   pricing game could never bid again; it now clears on `nextSegment`, `rebid`,
   `finish` and `undo`.

---

## 7. Known gaps

- **A pricing game cannot be replayed.** Once a segment is done the host moves
  on; there is no “play that one again”. Undo covers a misclick.
- **No image hosting for prizes** — a text `note` only. This is a spec non-goal.
- **With one or two players the showdown can have a single spinner**, who wins
  by default. The show still reaches a showcase and a set of standings, and a
  single-player episode is unit-tested end to end (P-U8).
- **`reportScores` is sent from the showcase and the standings only.** Sending
  it after every segment would make the hub's night scoreboard noisier than the
  other games'.
- **The splash is skipped when embedded**, by design: the hub shows its own on a
  game switch (this is the double-splash defect the UI tester found in Feud and
  Wheel).
- Reduced motion is verified structurally (the harness proves every `@keyframes`
  and `animation:` in all three sheets sits inside
  `prefers-reduced-motion: no-preference`), not by emulating the media query in
  a live browser — the in-app browser has no control for it. The climber and the
  Plinko chip move with **transitions**, which the shared theme's `reduce` block
  already collapses, and both the wheel and the chip check
  `prefersReducedMotion()` and snap straight to the result.
- Only one physical browser profile was available, so the real-network tier used
  two tabs on one machine. A check on two devices is still worth doing.

---

## 8. For the orchestrator

- The registry entry is yours to add. Suggested capability chips: *phones
  optional*, *1–16 players*, *JSON prizes*, *editor*.
- Consider moving the `[data-gsc-game="price-is-right"]` accent block from
  `games/price-is-right/css/tpir.css` into `shared/theme.css` so all seven games
  are declared in one place (deviation 6 above).
- Nothing outside `games/price-is-right/**` and this report was touched.
