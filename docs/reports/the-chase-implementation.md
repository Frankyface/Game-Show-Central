# The Chase — implementation report

Component `the-chase` · spec `docs/15-the-chase-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` · owner: games/the-chase/** only.

## What shipped

| Area | Files |
|---|---|
| Pure core (UMD → `ChaseCore`) | `js/chase-content.js` (JSON contract), `js/chase-rules.js` (reducer), `js/chase-core.js` (selectors, phone views, re-exports) |
| Content | `questions.json` (200 rapid-fire, 60 head-to-head, rising difficulty, answers spread A 20 / B 20 / C 20), `js/data.js` mirror (`globalThis.CHASE_DEFAULT_GAME`), `sets/index.json` + `sets/kids.json` (88/43) + `sets/movies-tv.json` (83/43) |
| Host UI | `index.html`, `js/chase-view.js`, `js/chase-board.js`, `js/chase-app.js`, `js/chase-wire.js`, `js/chase-clock.js`, `js/chase-sound.js`, `css/chase.css`, `css/chase-play.css` |
| Editor | `js/chase-editor.js` — Download JSON, **Download for the library** (file + manifest line + commit path), Use in game, Reset, Start blank, auto-saved draft |
| Phones | `js/chase-room.js` (GSC.host glue), `js/chase-phone.js`, `css/chase-phone.css` |
| Tests | `tests/chase-core.test.mjs` + `tests/chase-fixtures.mjs` (CH-U1…U10), `tests/harness.html` (CH-I1…I6), `tests/fixtures/harness-game.json` |
| Docs | `README.md` |

## Rules as implemented

- Board positions are distances from HOME: contestant starts on `startStep`
  (3), Chaser on `steps` (7); higher offer = startStep+1, lower = startStep−1,
  clamped. Caught when Chaser position ≤ contestant position after the Chaser
  reveal; home when the contestant reaches 0 on the contestant reveal (the
  chase ends there; the Chaser's answer no longer matters).
- Offers: middle = built; higher = built × multiplier; lower = round(built ÷
  divisor). A contestant who built nothing is offered value × multiplier and
  one Cash Builder value (the show always offers a real high/low).
- Locks are re-lockable until that side is revealed; reveal order enforced
  (contestant, then Chaser).
- Cash Builder: after the buzzer the host may judge the question in flight
  (one mark) or wave it away. Final Chase: both buzzers are final; the
  Chaser's expiry = the team wins. A Chaser **Wrong** opens a pushback that
  blocks further Chaser marks until resolved; a correct pushback moves him
  back one (never below 0). A **Pass** is not offered to the team.
- Head start = max(minHeadStart, finalists × headStartPerMember). Nobody home
  → no Final Chase, result says the Chaser takes the lot.
- Bank split is exact: floor share, remainder one each in seat order.
- Clocks are `{running, deadline, remainingMs}` with injected `now`; clock
  events are not undo steps. Restore and **Keep this game** both freeze every
  clock to its remaining time.

## Additions to the spec'd event list

`cbPause`, `finalTeamPause`, `finalChaserPause` (pause/resume; the spec lists
only starts). Everything else matches §4 exactly. The core is three files
rather than two (`chase-rules.js` added to stay under 800 lines) — same
accepted deviation as Feud/Wheel; `ChaseCore` exposes the whole API.

## Cross-cutting rules applied

`?game=URL` beats a save unless the save came from it · room-scoped saves
(`bindRoom` drops phone seats/game on a new room code) · `globalThis`
fallback in data.js · views pushed on join and on status, de-dup cache
cleared per pid · phones only express intent (`{t:"lock",idx}`, `{t:"ready"}`)
re-checked with `lockSideFor` · `hasOwnProperty` handler/hotkey/cue lookups
(prototype-name events tested) · `?store=NAME` namespace, harness uses
`?store=harness` and parks the frame on about:blank before clearing keys ·
no local `body[data-gsc-game]` override (only `:root --stage-*` plus local
`--chase-*` colours) · every animation inside `prefers-reduced-motion:
no-preference` · splash skipped when embedded · `btn-game-lobby` with
Keep / Start over and Resume · `GSCLibrary.mountPicker(container, {gameDir:"",
validate, onPick})` with source note "set: <name>" (falls back to a plain
message if `shared/library.js` is absent; it is present now).

## Verification (all run by me)

| Check | Result |
|---|---|
| `cd games/the-chase && node --test` | **54/54 pass** (CH-U1 validator · U2 Cash Builder totals/expiry/pause · U3 offers · U4 movement, catch and home from every start step, reveal order · U5 head start · U6 pushbacks + both endings · U7 bank split/standings · U8 undo/illegal/prototype names/immutability/seeded shuffle · U9 shipped content + manifest · U10 leak test) |
| `tests/harness.html` on 127.0.0.1:8711 | **All 63 checks passed** (CH-I1 secret locks from two phones, host DOM shows "Locked in" never the letter, reveal order · I2 player-Chaser catch from a phone · I3 clocks on phones, rapid answers never on phones · I4 reload mid-Final Chase restores paused, pushback, exact split, scores to shell · I5 X-1 game lobby Keep/Resume/Start over, X-2 picker lists and loads a set, X-3 editor round-trip + manifest line · I6 gates) |
| T4 standalone, host as Chaser, 3 typed players, 1280×720 | full game (home / caught / home → Final Chase, pushback, team win $28,000 split); scrollHeight = clientHeight on every play screen; host text never contained a locked letter before reveal |
| Same at 1280×676 | no vertical scroll and no element clipped below the viewport on any screen (Chaser-wins ending) |
| T3 real network | standalone room opened on the PeerJS broker (code RGEW); phone tab `?room=RGEW&name=Zoe` at 320×640 joined, locked C; host showed "Locked in" (no "C —") until **Reveal contestant**, then "C — wrong"; phone received the answer only after both reveals; option buttons 75–93 px tall, no sideways scroll |
| Static gates | no innerHTML/eval/document.write/console.log; every file < 800 lines (largest 790 test file, 774 harness, 689 rules); only Google Fonts external; both gradient stops under marker text pass (white on #2f6fd0 4.9:1 / #12336e 12:1; on #d10000 5.5:1 / #5a0000 13:1) |

Defects found and fixed during my own testing: spectators were sent the
head-to-head question (now `wait` with board only); "Keep this game" parked a
running clock (now frozen); Chaser's clock zeroed at a catch so the result read
"0 seconds to spare" (now stops where the catch happened); caught contestants'
"played for" showed $0 (now kept as `played`); board banner after both reveals.

## For the orchestrator

- **Hub agent:** add the `[data-gsc-game="the-chase"]` accent block to
  `shared/theme.css` (suggest `--accent: #d10000`-family with a checked
  `--accent-ink`; registry accent is `#d10000`) and card art.
- Library manifest uses `counts: {"rapid-fire": n, "head-to-head": n}`, the
  shape `shared/library.js` renders.
- Browser pane was shared with other agents (tab cap hit once); I worked in my
  own tabs, closed them, cleared my `?store=manualt4` keys and stopped my server.
- Not run: the in-hub embedded run with real phones (the loopback harness
  covers the embedded bridge path); physical second device.

## Round 2 — tester's rule minors (2026-11-03)

Tester fixes D1, D2, D6, D7 kept as applied. Remaining minors from
`the-chase-verification.md`:

| # | Change | Where |
|---|---|---|
| D3 | Every Chaser miss — **Wrong or Pass** — opens a pushback (`pushback.miss` records which). | `chase-rules.js` `evFinalChaserMark` |
| D4 | The Chaser's clock **pauses** when a pushback opens and restarts from the time left on `pushback`; `finalChaserStart` and `finalChaserExpired` are refused while one is pending. A pushback with the Chaser on 0 is a no-op (not counted in `pushbacks`), and the host screen says "He is still on the start line, so a right answer cannot move him back." | `chase-rules.js` `evPushback`, `chase-view.js` `finalState` |
| D5 | With $0 built the offers are worked out as if one Cash Builder answer landed: higher = value × multiplier (one step up), middle = one value (start step), lower = value ÷ divisor (one step down) — $5,000 / $1,000 / $500 by default; documented in the README and on the offers screen. | `chase-rules.js` `offersFor` |
| D8 | "pushed back 1 time / n times". | `chase-view.js` |
| D9 | `minHeadStart` must be 1–4, so a Final Chase target of 0 cannot exist. | `chase-content.js` |
| harness | New check: no host `.screen` is displayed on any phone (tester's D2 suggestion). | `tests/harness.html` |

Tests that pinned the old rules were updated (`ADV-OFFER`, `ADV-FINAL
pushbacks`, `CH-U3`) and one added (`CH-U5` zero head start). **`node --test`
75/75.** Harness CH-I4 now expects the D5 amounts.

## Round 2 — v3 UI pass (docs/21, design-system §0)

CSS rewritten flat (`chase.css` 271, `chase-play.css` 319, `chase-phone.css`
111 lines); markup/JS limited to copy, class names, `GSCIcons.prepend`,
the `shared/icons.js` script tag and the splash timing.

Checklist:
- [x] `data-gsc-game="the-chase"`, no local accent override; stage is flat:
      `color-mix(#2a5bd7 6%, --stage-base)` — the show's blue-black as a tint, no gradient, spotlight or vignette.
- [x] Anton only for one hero per screen: setup "The Chase", Cash Builder total, caught/home name, result amount, phone headline. Everything else Inter 400/500/600, sentence case, no tracking, no uppercase.
- [x] Decorative eyebrows removed (setup tagline → one plain sentence: "Add up to four contestants in hot-seat order, choose who plays the Chaser, then start."; splash kicker gone). Labels kept only where they name a group. Body ≥ 16 px, controls ≥ 15 px.
- [x] Accent (#d10000) only on the primary button, the Chaser's marker / active underline and the pushback rule; gold only on money.
- [x] One surface level (`--surface` + `--hairline` + 8 px); inner lists are hairline rows; no blur, rails, nested panels, glow or text-shadow.
- [x] Buttons 6 px radius, 44–48 px host / 56 px phone, sentence case 600; primary accent, secondary hairline, danger red outline, "Correct" green outline. No gradients.
- [x] Board = flat steps with two flat markers (blue #2f6fd0 white ink 4.9:1; Chaser accent fill, white 5.7:1); marker glyphs are initials (no ▼), "Right answer" tag (no ✓), Up/Down text (no arrows). Zero emoji in host DOM text.
- [x] Toolbar: name (Inter 600 18 px) · Sound · Editor · Game lobby, each with a `GSCIcons` icon + text label.
- [x] Motion: only the marker slide and the caught/home card; offer hover lift, option fade, clock pulse and phone rise removed; all inside `prefers-reduced-motion: no-preference`. Splash 600 ms, plain (name only).
- [x] Phone screens flat (one card, hairline stat row, option rows 56 px, "locked"/"you" in words).

Verification (headless Chrome over CDP, `.scratch/chase-v3-check.mjs`, server 127.0.0.1:8711):
- `tests/harness.html`: **All 64 checks passed**.
- 1280×720 and 1280×676: scrollHeight = viewport on cash, offer, board (locked / revealed / home / caught), Final Chase (intro / team / pushback), result, standings, lobby modal; no text clipped. Setup scrolls (allowed).
- DOM walk on every one of those screens and all four 320 px phone frames: no text pair under 4.5:1 (3:1 for large / disabled), no emoji, no `backdrop-filter`, no `text-shadow`, no gradient under text.
- CSSOM walk: no `@keyframes`, `animation` or `transition` outside the no-preference guard; under emulated `reduce`, `document.getAnimations()` is 0.
- Phones: no horizontal scroll at 320 px, option buttons ≥ 56 px, no host screen displayed.

## Round 3 — host phone (docs/22 §5–§6, review F4)

The seven per-game items:

1. **Selector** `ChaseCore.hostView(state)` (`js/chase-core.js`): Cash Builder →
   question, answer, next question + answer, who is in the hot seat; head to head →
   question, the three options, `correct` index; Final Chase → question, answer,
   next, `pushback` flag (the missed question stays the item). Setup, offers,
   result, standings and the gap between the two Final Chase halves →
   `secret:false`, "Nothing secret right now" + the phase label.
   **F4:** while `chaser.isHost` and the Chaser has not locked (and no outcome),
   `correct` is `null`, `withheld:true` and no answer field exists; the
   contestant's lock does not release it, undo of the Chaser's lock withholds it
   again. With a player-Chaser it is present at once. Final Chase with a host
   Chaser keeps the answer (the reader judges) and says so in `note`.
2. **Room glue** (`js/chase-room.js`): `room.setHostView({t:"host", item, seq, ...hostView})`
   on every state change (seq bumps when the view changes); `onHostPhones` feeds
   the app. Contestant `phoneView` unchanged.
3. **Host page** (`js/chase-hostphone.js`, `role=host`): "Host · The Chase"
   header, the item large, the answer at 30 px in `--accent-2` (7.2:1), the next
   question below; in the head to head the right option is outlined, 28 px and
   labelled "Correct". No buttons; sends nothing (not even `ready`).
4. **Answers-private** (`js/chase-view.js` `renderAnswerSlot`, markup slots
   `#chase-cash-answer` / `#chase-final-answer`): with a host phone assigned the
   answer node is not created; "Answer is on your host phone" while connected;
   "Host phone disconnected" + one **Show answer on this screen** (keyed to the
   item, cleared on the next) while not. The head-to-head options are public on
   the show and the correct mark is already reveal-only; `setTitle` never carried
   an answer. No host phone → the old "Answer (host only)" line, unchanged.
5. **Tests**: `tests/chase-hostview.test.mjs` HV-1…HV-7 (each phase, F4 both
   ways, pushback, size/determinism, phoneView unchanged) — **82/82** in the
   game, **1491/1491** at the root. `tests/harness-hostphone.html` **22/22**:
   view delivered via `onHostView` to the role=host frame only; contestant frames
   never get one; answer string absent from host text, `value`, `placeholder`,
   option, `title`, `alt`, `aria-label`, `data-*` and `setTitle` with the host
   phone connected AND disconnected; fallback reveals it, next item hides it;
   F4 on the live page; host phone at 320 px (no sideways scroll, text ≥ 16 px,
   answer ≥ 28 px, no buttons, stale dimming); no-host behaviour unchanged.
   Uses `tests/fixtures/hostphone-game.json` (answers prefixed `Zq<n>` so the leak
   scan cannot match static page copy such as "Eighty"). The original
   `tests/harness.html` stays **64/64**, unmodified except that its gate list now
   includes the three new files.
6. **Seat reconciliation** (`chaseReconcileSeats`, run after the saved game and
   content settle): setup phone seats not in `room.players()` are removed (and a
   Chaser pick pointing at one is cleared); a running or parked game keeps the
   seat as phone-less, shows one notice, and the laptop gets lock buttons for a
   phone-less player-Chaser. A phone that turns up later leaves the phone-less list.
7. Stale/tooBig on the host page as specified.

Served with the Node static server (`.scratch/hp-shell-serve.mjs 8711`), run
headless via `.scratch/cdp.mjs .scratch/hp-chase-run.mjs`; helpers
`.scratch/hp-chase-*`. Server stopped afterwards.
