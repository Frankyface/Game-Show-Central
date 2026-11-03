# Press Your Luck — implementation report

Component `press-your-luck` · spec `docs/17-press-your-luck-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` · implementer report, 2026-11-03.

## Summary

The game is complete and playable host-only, embedded in the hub, and standalone
with phones. That covers the question round (armed buzzers, first in wins, a
host-judged buzz-in, then A/B/C picks for everyone else), the 18-square Big Board
with a travelling light and STOP, Whammies, passing, two rounds, standings, undo,
the game-lobby control, the set library and a board-grid editor.

| Gate | Result |
| --- | --- |
| `cd games/press-your-luck && node --test` | **49 / 49 pass**: 39 success-state tests (L-U1 … L-U10) + 10 adversarial/fuzz |
| `tests/harness.html` (port 8713, `?store=harness`) | **62 / 62 pass** (L-I1 … L-I6, gates folded into L-I6) |
| Board landings, harness | **10 / 10** light index == core landing (`4/4 5/5 14/14 2/2 17/17 5/5 10/10 15/15 0/0 11/11`), plus 1/1 from a phone STOP |
| Manual standalone, three host-run players, two rounds | played to "Ben wins with $14,050". 28 real spins plus 9 earlier, **0** light/core mismatches |
| No vertical scroll in play | question and board screens: 720 / 720 at 1280×720, 676 / 676 at 1280×676 (also asserted in the harness at 1280×676) |
| Real network (PeerJS broker + WebRTC), standalone | room `EJSN` opened. Phone `?room=EJSN&name=Dee` at 320 px joined, buzzed by a real click, then pressed STOP by a real click. The light landed on the core's square (11/11) and the phone received the result only after it landed. A phone reload relinked to its seat. |
| Static gates | no `innerHTML`/`insertAdjacentHTML`/`outerHTML=`/`document.write`/`eval`/`new Function` (the only matches are the comments `never innerHTML`). No `console.log`. Every file < 800 lines (largest `js/pyl-app.js` 677). The only external URLs are Google Fonts. Every `@keyframes`/`animation:` is inside `prefers-reduced-motion: no-preference`. No `body[data-gsc-game]` override. Phone targets ≥ 56 px at 320 px (smallest measured: 56). |

## Files

```
games/press-your-luck/
  index.html                 host + phone screens, one page; data-gsc-game, #gsc-join, splash
  board.json                 2 boards × 18 squares (4 and 5 Whammies), 40 original questions
  sets/index.json            library manifest (2 entries)
  sets/kids-night.json       24 questions, 2 boards (3 / 4 Whammies)
  sets/movies-and-tv.json    24 questions, 2 boards (4 / 5 Whammies)
  js/pyl-content.js    349   PURE: JSON contract, validateGame/normalizeGame, square helpers
  js/pyl-select.js     370   PURE: spinOrder, alive, passTargets, standings, phoneView, validatePhoneMsg
  js/pyl-core.js       538   PURE: immutable reducer, UMD → PylCore (re-exports the two above)
  js/data.js           121   byte-identical mirror of board.json (harness-checked)
  js/pyl-sound.js            WebAudio cues: board tick, cash chime, bonus, whammy sting, out, buzz, round, win
  js/pyl-board.js      195   the travelling light (animation only; wall-clock guard; reduced motion = jump)
  js/pyl-view.js       521   host rendering + shared DOM helpers
  js/pyl-app.js        677   state, persistence (?store=), setup, hotkeys, spin choreography, game lobby, splash
  js/pyl-editor.js     511   board-grid + question editor, Download JSON, Download for the library
  js/pyl-room.js       246   GSC.host glue: roster, intent validation, per-phone views, title/scores
  js/pyl-phone.js      214   GSC.player glue: wait / buzz / pick / board / result
  css/pyl.css, css/pyl-phone.css
  tests/pyl-core.test.mjs, tests/pyl-adversarial.test.mjs, tests/harness.html, tests/fixtures/harness-game.json
  README.md
```

## How the spec maps to the code

- **Events** (spec §4): `start`, `buzz{pid|seat}`, `judgeBuzz{correct}`, `pick{pid|seat,idx}`,
  `revealPicks`, `nextQuestion`, `toBoard`, `stop{pid?}`, `pass{to}`, `nextSpinner`,
  `nextRound`, `undo`, `finish`, plus `arm{on}` and `notice{text}` (see deviations).
  Handler lookup uses `hasOwnProperty` (`toString`, `__proto__` and the like are no-ops, tested).
  `rng` is injected; the core never calls `Math.random` on its own.
- **Selectors** (spec §4): `spinOrder`, `alive`, `phoneView`, `validatePhoneMsg`, `legalActions`
  (probe-based, as in Chain Reaction), plus `canStop`, `passTargets`, `standings`, `boardTiles`.
- **The core decides and the animation shows it.** `evStop` picks
  `floor(rng() * 18)` at the moment of the press. Before that, nothing in the state names a
  future square: `landing` is `null` up to the stop, and the unit leak test shows that
  two rngs on the same state give two different squares. `pyl-board.js stopAt(index)`
  walks at least one full lap and then eases out onto that index. Under reduced motion it
  jumps straight there. A `setTimeout(duration + 900)` guard finishes the run when the tab is
  backgrounded. While the light travels, `app.spin.frozen` (the pre-press state) drives
  both the host screens and the phone pushes, so the result and the WHAMMY! card appear
  only when the light arrives. `spin` is never persisted, so a reload lands on the settled state.
- **Phones never see the landing square, the board or an answer** (L-U10 unit test, harness
  L-I2/L-I3, and the fuzz suite checks it after every event of 400 random games).
- **Cross-cutting rules.** `?store=NAME` namespacing, with the harness on `?store=harness`. The
  harness unloads the frame *before* it clears storage. The room binding (`bindRoom`)
  drops phone seats when the room code changes. `?game=URL` beats a save unless the save came
  from that same URL. The splash is skipped when embedded or under reduced motion. Every
  failure path shows a plain-English message.
- **docs/19 §1.** The `btn-game-lobby` control ("⟲ Game lobby") opens a confirm.
  **Keep this game** parks the state in `resumable` and shows setup with **Resume**.
  **Start over** clears the game and keeps the roster, the content and the settings. Harness L-I5
  covers both, including an exact restore.
- **docs/19 §2.** `GSCLibrary.mountPicker(#pyl-library, {gameDir: ".", validate: validateGame, onPick})`
  runs on setup, and the source note becomes `set: <name>`. `shared/library.js` landed during
  the build. The harness takes the real-picker branch and lists both sets. The page also degrades
  to a plain-English note when the script is absent. The editor's **Download for the library**
  downloads `<slug>.json` and prints the manifest line and the commit path (harness-checked).

## Rule choices made where the spec was loose (documented in README as normative)

1. **The buzzer is excluded from the picks, right or wrong.** If nobody buzzes, the host
   presses "Nobody had it" (`judgeBuzz{correct:false}` with no buzzer) and everyone picks.
2. **A Whammy ends the turn.** The spins left stay with the player for later (the show's
   rule). Reaching the whammy limit eliminates the player and voids their spins, passed ones included.
3. **Turn structure.** A player spins until they run out, pass, or hit a Whammy. Then the
   reducer sets `awaiting:"advance"`, `stop` becomes illegal, and the host presses **Next player**.
   `nextSpinner` hands over to the next player in `spinOrder` other than the one who just
   finished. That order puts holders of passed spins first, then the fewest spins, then the lower
   total, then the seat.
4. **Passing** moves *all* the controller's own spins, is allowed only with ≥ 1 own spin and
   no passed spins pending, and ends the turn. Passed spins are spent before the player's own
   and cannot be passed on.
5. **Rotation** (optional `alternatives`, `settings.rotate`). Faces are re-rolled after each
   spin for the next one. Because the host paints the frozen pre-press board, a rotation never
   happens visibly in mid-flight.
6. **Winner.** The highest total wins. A tie is a shared win. If every total is zero, there is no
   winner ("Everybody got Whammied").

## Deviations from the spec

- **An added `arm{on}` event** (not in spec §4's list). Without it a phone could buzz while
  the host was still reading. This is the Jeopardy/Feud buzz-bar pattern the brief points to.
  It is not an undo step.
- **`rounds` must be ≤ the number of boards** (the spec says "boards = rounds arrays"). Extra
  boards are allowed, so adding a board in the editor can never deadlock validation (compare
  the Deal or No Deal validator deadlock in the triage).
- **The core is split** into `pyl-content.js` + `pyl-select.js` + `pyl-core.js`, the accepted
  pattern for the 800-line cap. `PylCore` re-exports everything.

## Defects found and fixed during my own verification

| # | Severity | What | Fix |
| --- | --- | --- | --- |
| 1 | critical | In round 2 the board's centre panel (STOP / Next player) vanished. `buildTiles` moved it into the grid; the next rebuild's `replaceChildren()` detached it, and `getElementById` cannot find a detached node. | Keep a direct reference (`centreNode`) and look it up before the rebuild. A harness regression check (L-I5, after Resume re-enters the board) now pins it. |
| 2 | major | The centre panel sat below the board instead of in the hole of the 7×4 rectangle, and the board did not fill the screen. | The centre is now a grid child. `#screen-board` is sized to the viewport, the rows use `minmax(0,1fr)`, and the centre uses top/bottom layout so a landing card never hides Next player. |
| 3 | major | Phone STOP lost its pink fill under a resting pointer: the shared `.gsc-btn` hover rule (0,3,0) overrode it. | Scoped `.phone-actions .btn-stop-phone(:hover)` (also BUZZ and the picks). Verified on the real-network phone. |
| 4 | minor | Scores reached the hub only at round end, and the title was re-sent on every render. | Standings are reported from the board onward and both are de-duplicated. |
| 5 | minor | The Resume button's visibility went stale off the setup screen. | It is toggled on every render. |
| 6 | minor | After a reload the light sat on square 0, not the landing square. | A rebuild re-attaches the light at `landing.index`. |
| 7 | minor | `"settings": []` was accepted silently. Copy said "Whammys" and a hard-coded "four Whammies". | The validator rejects it. Copy fixed and now reads the configured limit. |

The fuzz suite (400 seeded random games) found no deadlock and no broken invariant. It
confirmed that an eliminated spinner keeps `control` only while `awaiting:"advance"` and can never spin.

## Notes for the orchestrator

- **Hub wiring already present.** `shared/theme.css` has the `[data-gsc-game="press-your-luck"]`
  accent block, and `js/hub-registry.js` has the registry entry, both added by the hub agent. I touched
  neither. My CSS sets only `--stage-*` and `--pyl-*` on `:root`.
- **`shared/library.js`** was present by the time I ran the harness. The page loads it with a
  plain `<script>` tag, and the picker passes `gameDir: "."` (dirPrefix maps it to `""`).
- **Not tested by me:** the embedded run through the real hub shell with real phones. That
  path is covered only by the loopback harness, which emulates the shell. The standalone
  real-network run and the harness both pass. Reduced-motion mode is not exercised by the harness
  (the browser pane cannot emulate it). The code path is a straight `setLit(target)` plus `onDone`, and every
  animation sits in the no-preference block.
- **Harness runtime is about 40 s** because the ten board landings use real animations (1.5–3.4 s each).
- The browser tab cap (shared with other agents) blocked browser work for part of the session.
  I used at most two tabs and closed both, and stopped the port-8713 server.
- No git commands were run.
