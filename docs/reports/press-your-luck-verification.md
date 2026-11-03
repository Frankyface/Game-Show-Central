# Press Your Luck — verification report

Component: `press-your-luck` · Spec: `docs/17-press-your-luck-spec.md` · Cross-cutting: `docs/19-cross-cutting-round.md`
Format: `docs/06-verification-plan.md` §5. Independent tester (did not write the code). Verdict at §4.

---

## 1. Environment

| | |
| --- | --- |
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Headless Chrome (stable, `--headless=new`) driven over CDP by my own scripts in `.scratch/pyl-*.mjs`. The in-app browser pane was at its tab cap (other agents' tabs), so I did not use it and did not close anyone else's tabs. Viewports emulated: 1280×720, 1280×676, 320×640 (phone, mobile emulation), 360×640 (hub phones). |
| Server | `python -m http.server 8735 --bind 127.0.0.1` from the repo root (own port), plus a no-store Node static server `.scratch/pyl-serve.mjs` on 8736 for the final T3 run and re-runs (see the T3 note); both stopped at the end |
| Broker | real PeerJS cloud broker **reachable**: hub rooms `X2XU`, `BEXF`, `J64B`, `FJHD` opened, two phones joined over real WebRTC. No BLOCKED-ENV. |
| Date | 2026-11-03 |
| Under test | `games/press-your-luck/**` as the implementer left it, plus the four trivial fixes in §3 |

Commands run:

```
cd games/press-your-luck && node --test          73 pass / 0 fail   (49 implementer + 24 mine)
node --test tests/core-prototype-guard.test.mjs  13 pass / 0 fail   (repo root; includes the PYL row)
tests/harness.html (?store=harness)              "All 62 checks passed."  #summary.ok — before AND after my fixes
```

New suite added by me: `games/press-your-luck/tests/pyl-tester.test.mjs`, 24 tests (517 lines).

| Area | What it attacks |
| --- | --- |
| spin awards | `buzzSpins`/`pickSpins` (5/2), wrong picks pay nothing, buzz before `arm` is a no-op, a second buzz and a re-arm after a buzz are ignored, `judgeBuzz{correct:true}` with nobody buzzed is refused |
| picks | the buzzer cannot pick whether right or wrong (by seat or pid); a pick can change until reveal; nothing after reveal |
| spin order | fewest spins first, ties by lower total, then seat; players with 0 spins are dropped |
| STOP | every one of the 18 squares lands where the rng says and applies cash, prize, + one spin or Whammy correctly; rng edge values 0, 0.999999, 1, NaN, −0.1 never land off the board; STOP from a non-controlling pid, an unknown pid or the wrong seat is a no-op |
| Whammies | the total is zeroed and counted each time, the turn ends, remaining spins are kept; the 4th Whammy eliminates and voids spins, and `nextSpinner` then closes the round; `whammyLimit: 2` eliminates on the 2nd |
| passing | a pass moves all your own spins and ends the turn; the receiver comes up next, uses passed spins first, cannot pass while passed spins are pending, and may pass own spins again afterwards. Passing to an eliminated player (by seat and by pid), to yourself, out of range, fractional or missing is refused. A player holding only passed spins cannot pass. A Whammy on a passed spin counts. |
| round 2 | `boards[1]` values and its Whammy positions are used; the tiles show the round-2 board |
| winner | highest total; ties share the win; all-zero means no winner |
| validator fuzz | rejects 17 and 19 squares, 1/2/7/8 Whammies, 23 questions, 2 and 4 options, answer 3, one board for 2 rounds, negative or fractional cash, Whammy+cash, `whammy:"true"`, `settings: []`, `rounds: 7`, `whammyLimit: 0`, too few questions for rounds×qpr, and junk roots. Accepts 3 and 6 Whammies and 24 questions. |
| content | `board.json`, `js/data.js` (deep-equal) and both library sets validate; round 2 is bigger than round 1 in every shipped file |
| phone wire | junk frames do not validate; pass-to-self from a phone is refused |
| leak | during picks no phone view carries `answer` or the `picks` map, and a seat's `myPick` is only its own; on the board no phone view has `board`/`squares`/`faces`/`landing`/`tiles` and `last` is empty before the first STOP |
| immutability | 300 random events applied to **deep-frozen** states, so any hidden mutation throws in strict mode, plus undo on a frozen state |
| undo | across phases: round 2 → roundDone → board (landing cleared, totals restored) → question |
| prototype | `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, `isPrototypeOf`, `__defineGetter__`, a `__proto__` payload, `type:["stop"]` are all no-ops |
| 200 seeded games | 2–4 players, `whammyLimit` 1–4, 1–2 rounds, `buzzSpins` 0–3. Every game reaches `result`, every legal action changes state, and the invariants hold after each event. Depth is asserted: > 400 stops (552), > 5 eliminations, > 50 two-round games. |

My review of the implementer's tests: they make genuine assertions. Each success-state test checks concrete numbers and is not a smoke test. The adversarial file's 400-game fuzz checks invariants after every event, including that phone views carry no answer.

---

## 2. Results

### Unit (spec 17 §6)

| ID | Result | Evidence |
| --- | --- | --- |
| L-U1 validator | PASS | implementer L-U1 ×5; my validator fuzz (17/19 squares, 2/7 Whammies, 23 questions, 4 options, junk) |
| L-U2 spin awards | PASS | `T: buzz awards…`, `T: buzz before arm…`, `T: the buzzer cannot pick…` |
| L-U3 spin order | PASS | `T: spin order — fewest spins first, ties by lower total, then seat` |
| L-U4 stop lands where rng says | PASS | all 18 squares × effect; rng edge values |
| L-U5 Whammy zeroes + counts | PASS | `T: STOP lands…` (Whammy branch), `whammyRun` |
| L-U6 4 Whammies out | PASS | `T: the 4th Whammy eliminates…`, `T: whammyLimit 2…` |
| L-U7 pass rules | PASS | 4 tests incl. pass to eliminated player (refused) and passing passed spins (refused) |
| L-U8 round 2 board | PASS | `T: round 2 plays boards[1] values` |
| L-U9 winner | PASS | `T: winner is the highest total; ties share; all-zero has no winner` |
| L-U10 undo / illegal / immutable / leak | PASS | deep-frozen run, undo across phases, prototype types, leak test; implementer's 400-game fuzz |

### Loopback / browser (T2)

| ID | Result | Evidence |
| --- | --- | --- |
| harness | PASS | `tests/harness.html` → "All 62 checks passed." (≈ 2 min headless), re-run after my fixes: still 62/62 |
| L-I1 light ends on the core's square | PASS | In-page probe sampled every 2 ms at the instant `app.spin` cleared: **8/8** lit tile == hit tile == `core.landing.index`. Manual run: 19 spins, and every landed tile carried `is-hit` on the core's index. Note: the idle walk resumes 130 ms after a landing, so a probe taken later sees the light one or two squares on. That is by design: the landed tile keeps its `is-hit` frame and the value or WHAMMY card. |
| L-I2 phone STOP | PASS (T3) | see T3 table |
| L-I3 buzzers | PASS | manual: arm → buzz bar → judge, buzzer's seat excluded from the pick row (`pickable seats 1,2` when Ann buzzed) |
| L-I4 passes | PASS | manual: Ann passed 4 → `passed [4,0,0]` after hand-over, used 3 passed spins, then a Whammy on a passed spin; host pass row hidden mid-spin |
| L-I5 reload mid-board | PASS | reload with the board settled: the state is byte-identical (`RELOAD mid-board equal: true`). Reload 300 ms into an animation: the saved state is already post-stop (`spun 3 → 4`, landing 16), and after the reload the light sits on 16 with the value card showing, so no double spin and no lost spin |
| L-I5 undo | PASS | Undo after the mid-animation reload put back totals, spins and `spun` exactly as before the press |
| L-I6 library + editor | PASS (after fix D2) | picker lists "Kids' night" and "Movies & TV"; each loads, source becomes `set: <name>`, 24 questions. Editor: 18-square board grid, Download → `board.json` re-validates, Download for the library → valid `press-your-luck-movies-tv.json`, path `games/press-your-luck/sets/…` and the manifest line printed, Use → "Custom board (from the editor)" |
| T4 standalone, 3 manual players, 2 rounds | PASS | `?store=t`, Ann/Bob/Cat host-run, 8 questions, 19 spins, a pass, 6 Whammies, an elimination (Ann, 4th Whammy), ending "Cat wins with $2,700". Screens: `img/pyl-t-question.png`, `pyl-t-board.png`, `pyl-t-roundover.png`, `pyl-t-result.png` |
| X-1 game lobby, Keep → Resume | PASS | Round 2 mid-board: `⟲ Game lobby` opens a `role="dialog"`; Keep shows setup with Resume; Resume → `JSON.stringify(core)` **identical**; centre panel is inside `#pyl-board` and visible, STOP/Next visible (`img/pyl-t-after-resume.png`) |
| X-1 Start over | PASS | core null, names "Ann,Bob,Cat" kept, Resume hidden, content kept ("Built-in board (board.json)") |
| X-2 library | PASS | see L-I6. Manifest has no optional `counts`, so the Preview line has no counts (cosmetic, D6) |
| X-3 download for library | PASS | see L-I6 |
| `?game=URL` vs a save | PASS | with a game in progress, `&game=sets/kids-night.json` loads "Custom board from sets/kids-night.json" and says "Loaded the board from the link, so the game in progress was cleared." Following the same link again keeps the new save. |
| bad JSON | PASS | `?game=README.md` / `tests/harness.html` → "Could not load a board from …: Unexpected token … is not valid JSON. Using the built-in board instead."; `nope.json` → "…the server answered 404…"; upload `{not json` and `{boards:[],questions:[]}` → plain-English "That file is not a usable Press Your Luck board: …" |
| no scroll in play | PASS | question and board screens: scrollHeight 720/720 at 1280×720 and 676/676 at 1280×676; no horizontal overflow |

### Real network through the hub (T3)

Hub `index.html` on the host (1280×720) plus two phones, each in its **own** headless-Chrome profile, at
360×640 → `?room=CODE`. Final clean run: room `HH93` → game started at 23:45 (log `.scratch/pyl-hub.out`).

| Check | Result | Evidence |
| --- | --- | --- |
| join + roster into the game | PASS | game roster `[p1 Dee, p2 Eli]`, seated 0 and 1; seat 2 "Hoss" host-run |
| views reach phones | PASS | both phones on the BUZZ screen 156 ms after Start |
| buzz before arm | PASS | BUZZ rendered disabled ("Wait for the host to arm the buzzers."); `q.buzzed` stays null |
| arm → first buzz wins | PASS | both phones pressed BUZZ; one seat won (`buzzed = 0`); the other phone was moved to the pick screen |
| picks from the other phone | PASS | other phone picked B → `picks {"1":1}`; the buzzer's phone shows "You had the buzz-in." with no pick buttons |
| STOP from the non-controlling phone | PASS | that phone has no STOP button (6/6 attempts: `none`); reducer also refuses it (unit) |
| STOP from the controlling phone lands on the core square | PASS | **6/6**: hit tile == `core.landing.index` (16, 12, 12, 9, 0, 15). While the light travelled, the phone still showed the pre-press view (no early result). |
| pass from the phone | PASS | Eli tapped "Hoss" → `spins [4,0,0]`, `passed [0,0,3]`, `awaiting advance` |
| phone reload mid-board keeps the seat | PASS | reloaded Dee's tab and it relinked straight to "Eli is on the board"; the roster still has `p1,p2,null`. (An earlier run with both phones in ONE profile hit "That name is taken" on reload. That is shared localStorage between my two tabs, a test artefact the triage already lists.) |
| ⌂ Lobby and back | PASS | shell asks "Leave Press Your Luck?" → Back to lobby; the phones go to the waiting screen; Play again → state **identical** and both phones get their board view back |
| night scoreboard | PASS | lobby `#night-list`: "Eli 2550 · Dee 0 · Hoss 0" (host-run seat by name) |
| console | PASS | no errors on host or phones |

Environment note: with all three browsers on `python -m http.server` the embedded game frame
intermittently got status-0 responses for half its scripts (`pyl-board.js`, `pyl-app.js`, …). The page
then sat on "Loading the board…" with no `PylApp`. The server log shows those same files served 200.
Re-run on a no-store Node static server (`.scratch/pyl-serve.mjs`, port 8736) and it was clean. This is
an environment flake, not a game defect. One side observation: if a game script ever fails to load, the
setup screen stays on "Loading the board…" with no message.

### Design / accessibility

| Check | Result | Evidence |
| --- | --- | --- |
| 1280×720 board readability | PASS | tiles 171×136 px, values 20.5 px Anton, centre name 38 px; `img/pyl-t-board.png` |
| phone targets ≥ 56 px at 320×640 | PASS | BUZZ 192 px, picks 56 px, STOP 192 px, pass 56 px; no horizontal overflow (`img/pyl-t-phone-*.png`) |
| phone STOP keeps fill on hover | PASS | real CDP `mouseMoved`; `:hover` true, background stays `linear-gradient(#ff5cb4, #f02a8c)` |
| reduced motion | PASS | `prefers-reduced-motion: reduce` emulated: a CSSOM walk finds no `@keyframes` or `animation` outside a `no-preference` block (theme.css included; only the cross-origin Google Fonts sheet is unreadable). The splash is skipped, the idle light does not run, `document.getAnimations()` is empty, and a STOP resolves at once with the light on the landing square (12 == 12) and the card shown. |
| contrast (both gradient stops) | PASS after D3 | STOP text on the gradient: 4.85 / 6.67. Tile values 13.1, Whammy tiles 5.29, tile sub 5.40, lit tile 10.4–13.1, hit card 10.4–13.1, centre name 11.9, totals 13.7, buttons ≥ 5.77. **Failed before the fix:** the question badge `#pyl-q-badge` was 2.05:1 (D3). |
| colour never the only signal | PASS | Whammy squares print "WHAMMY" (not colour only); whammy dots carry text ("0 Whammies"); a disabled BUZZ also says "Wait for the host to arm the buzzers." |

### Static gates (T5)

| Gate | Result | Evidence |
| --- | --- | --- |
| V1 | PASS | 73/73 |
| V2 | PASS | largest file `js/pyl-app.js` 677 lines; tests 726 max. Only function > 50 lines without a justification comment is `pylSquareCard` (`js/pyl-editor.js:132`, 55 lines) — minor, D7. `evStop` carries its justification. |
| V3 | PASS | only matches are the comments "never innerHTML" and the harness's own gate regex |
| V4 | PASS | no `console.log` |
| V5 | PASS | `pylSerialise` persists core/resumable/game/setup/source/room code only; `app.spin` (frozen state + landing, plain data) is never persisted; no Peer/DOM/timer handles in state |
| V6 | PASS | only Google Fonts URLs |
| V7 | PASS | `<body data-gsc-game="press-your-luck">`, `#gsc-join`, `player-mode`/`gsc-embedded` toggled in `pylBoot` |
| V8 | PASS | `?game=URL` (`pylFetchGame`), upload (`pylOnFile → pylUseGame → normalizeGame`), library (`validate: validateGame`) and editor Use all go through `validateGame` |

Security read: every phone frame goes through `validatePhoneMsg` (four shapes, integer ranges) and then an
`INTENTS` own-property lookup, and every intent is re-checked by the reducer (seat == control for STOP/pass,
`picksOpen`, armed buzzers). Phone input is ignored while the light travels. All text reaches the DOM via
`textContent`. `?store=` is stripped to `[A-Za-z0-9-]`. `?game=` fetches any URL, but the result only ever
goes through the validator and `textContent`. Handler maps use `hasOwnProperty`. I found no issues.

### Content

All 40 default questions fact-checked; both library sets (48 questions) and all six boards skimmed.
One correction (D4): Q29 "How many time zones does the **mainland** United States span?" is ambiguous,
because Alaska is on the mainland and counting it gives five, which is one of the options. Reworded to
"…do the **48 contiguous US states** span?" (answer Four), identically in `board.json` and `js/data.js`
(still deep-equal; harness mirror check green). Everything else checks out. Board values are plausible: round 1
$250–$1,250 with two prizes, round 2 $1,000–$4,000 with two prizes, 4 and 5 Whammies. The Kids' night
and Movies & TV boards also scale up in round 2.

---

## 3. Defects

| # | Severity | Where | What / repro | Status |
| --- | --- | --- | --- | --- |
| D1 | **major** | `js/pyl-app.js:97–99` (`pylDispatch`) | Host hotkeys and the End button act **while the light is still travelling**. Press STOP, then within ~3 s press **U**: the spin is undone while the light keeps animating, and when it stops nothing restarts the idle walk. If the spin ended the turn, press **N** instead and the next player comes up before the light lands, so the value or WHAMMY card and its sound never appear. The on-screen Undo button was already disabled mid-spin, but the keymap bypassed that. | **Fixed** (1 line): `if (!state \|\| pylApp.spin) return;` with a comment. Re-tested: U and N are no-ops mid-spin and the spin lands normally. Harness still 62/62. |
| D2 | **major** | `js/pyl-editor.js:156,174` (`pylSquareCard`) | Stale closure in the board editor. Rename a prize square and then change its amount (or the other way round) without a re-render in between, and the first edit is lost. Repro: Speedboat (900) → amount 4321 gave "Front-row cinema tickets" = 4321, and Use put that in the game. | **Fixed** (2 lines): both input handlers now start from `pylDraft.boards[pylEdBoard][index]`, not the render-time `square`. Re-tested: "Speedboat" = 4321 survives Use. The per-square problem line under the inputs still shows the render-time verdict until the next re-render (minor, part of D7). |
| D3 | minor (a11y) | `css/pyl.css:129` | `.value-badge` (`#pyl-q-badge`, "3 spins to buzz in · 1 for a pick") set cyan text on the shared `.gsc-badge` pink fill: **2.05:1**. | **Fixed** (1 line): transparent background with a cyan inset outline, now 10.78:1. |
| D4 | minor (content) | `board.json:94`, `js/data.js:107` | Q29 was ambiguous (see Content). | **Fixed**, both files identical |
| D5 | minor | `js/pyl-app.js` Game lobby / End during a spin | ⟲ Game lobby is still enabled mid-spin. Keep halts the light and parks the already-resolved state, which is correct, but the landing card is skipped. End is now covered by D1's guard. | open, suggestion: disable `btn-game-lobby` while `app.spin` |
| D6 | minor | `sets/index.json` | Manifest entries have no optional `counts`, so the picker's Preview line shows no counts. | open |
| D7 | minor | `js/pyl-editor.js:132` | `pylSquareCard` is 55 lines with no justification comment, and its `.ed-problem` line is computed once per render. | open |
| D8 | minor (UX) | `js/pyl-phone.js` board screen | Pass buttons sit directly under STOP and pass **all** spins on one tap with no confirm. The host can Undo it. | open, suggestion: a second tap to confirm |

No critical defects.

**Rule choices in the implementation report.** I judged each of them.

- `arm` event: good. It is needed to stop phones buzzing while the host is still reading, and it matches Jeopardy/Feud.
- The buzzer cannot pick: defensible ("they had their shot") and well tested.
- A Whammy ends the turn but keeps the remaining spins: acceptable, but it is a house rule. I could not confirm the show's exact turn-after-Whammy rule from a reliable source, so the README should label it a house rule, not "the show's rule". The same applies to one detail of the show I know of: there, spins left over after a Whammy on *passed* spins become the player's own earned spins. Here they stay "passed", so they cannot be passed on. That is a reasonable simplification and is consistent with "passed spins can't be passed back".
- A pass hands over all spins and ends the turn: matches the show.
- Passed spins are used first and can never be passed back: matches the spec.
- `rounds` ≤ boards: good, and it avoids the editor deadlock seen in Deal or No Deal.

**Cross-cutting triage rules.** I checked each one.

| Rule | Status |
| --- | --- |
| `?store=` harness namespace | yes |
| Harness unloads the frame before clearing storage | yes |
| Room-scoped saves (`bindRoom`) | yes |
| `?game=URL` beats a save | yes |
| Handler maps use `hasOwnProperty` | yes |
| No local `body[data-gsc-game]` palette override | yes |
| Every animation in `no-preference` | yes |
| Both gradient stops checked | yes |
| Splash skipped when embedded or reduced | yes |
| Plain-English failures | yes |
| Phone queueing / relink | shell |

---

## 4. Verdict

**fix-then-ship → ship once the orchestrator accepts my fixes.** The pure core is solid. 73 unit tests pass,
including my 24: a deep-frozen run, 200 seeded games with no deadlock, the leak tests and validator fuzz. The
board animation lands on the core's square every time I checked: 8/8 at the instant of resolution, 6/6
from real phones over WebRTC, and 19 manual spins. Three players finished two rounds standalone and the
game ran through the hub with real phones. The game lobby, the library and `?game=URL` all behave as
specified. I found two majors and fixed both, as two small diffs (3 lines in total):

- D1: host hotkeys U/N (and End) acted mid-spin, so a result could be undone or skipped while the light was still travelling.
- D2: the editor silently reverted a prize's name or value.

I also fixed a contrast failure on the question badge (D3, 1 line) and an ambiguous question (D4). The
harness is still 62/62 and `node --test` 73/73 after the fixes. The open items (D5–D8) are minors for the
implementer or the README's known issues. The README should also call the "Whammy ends the turn" rule a
house rule rather than the show's rule.
