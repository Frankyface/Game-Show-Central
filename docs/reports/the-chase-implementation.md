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
