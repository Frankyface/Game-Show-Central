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


---

## Round 2 (2026-11-03): tester minors D5–D8, the load-failure message, and the v3 UI pass

The tester's in-place fixes D1–D4 (hotkeys mid-spin, editor stale closure, badge contrast, Q29) are
kept as they were. Everything below runs on top of them.

**Gates after this round:** `node --test` gives **73 / 73**. `tests/harness.html` gives **66 / 66** (it had 62; 4 v3 checks are new). Both ran headless on port 8713 through
`.scratch/pyl-v3-check.mjs`, which uses the tester's CDP driver `.scratch/pyl-cdp.mjs`.
Every file is under 800 lines (largest `js/pyl-app.js` 681; `tests/harness.html` 752). There is no `innerHTML` and no `console.log`.

### Minors

| # | Fix |
| --- | --- |
| D5 | `btn-game-lobby` is disabled while the light is travelling (`app.spin`) and on setup, where there is nothing to park. The click handler also refuses mid-spin. Checked headless: `lobbyDisabledMidSpin: true` and `lobbyDisabledOnSetup: true` at both heights. |
| D6 | `sets/index.json` entries carry `counts: {boards, squares, questions}` (kids 2 / 36 / 24, movies 2 / 36 / 24). The picker's Preview line now ends "2 boards · 36 squares · 24 questions". The editor's **Download for the library** line includes the same `counts`. |
| D7 | `pylSquareCard` is split into `pylTypeSelect`, `pylPrizeField` and `pylAmountField`, plus one `pylEditSquare`. The card itself is now 15 lines. Every edit writes to the live square, keeping the D2 fix, and refreshes **that square's own problem line** (`aria-live`) without rebuilding the grid, so typing focus is never stolen. |
| D8 | The phone pass is two taps. "Pass to Ben" turns into "Pass all 3 spins to Ben? They have to use them." with **Yes, pass to Ben** and **Cancel**. Only the confirm sends `{t:"pass"}`. Headless check: nothing is sent after the first tap and exactly one pass after the confirm. The pass block now sits under the player's standing card, 154 px below STOP, behind a hairline. |
| README | "A Whammy ends the turn but keeps the spins" is now labelled a **house rule**, along with the passed-spins simplification the tester pointed out. |
| Load failure | The new `js/pyl-boot-check.js` loads last. On `load`, if any of `PylContent`/`PylCore`/`PylBoard`/`PylView`/`PylApp` is missing, it replaces "Loading the board…" (and the phone headline) with a plain-English message: "Part of the game didn’t load, so it can’t start. Reload the page; if it keeps happening, the site is missing a file." It uses no helpers from the other files. |

### v3 UI pass (docs/21, design-system §0)

The v2 sheets are saved as `.scratch/pyl-css-v2-before.css` and `.scratch/pyl-phone-css-v2-before.css`.
Screenshots: `.scratch/pyl-v3-{setup,question,board,whammy,card,phone-board,phone-confirm}.png`.

The JS changes are limited to class names, `GSCIcons.prepend` on the three toolbar buttons (the
Sound icon is re-prepended on each repaint), the splash (600 ms, empty sub line), the Game-lobby
disabled state, and the D8 phone confirm. Markup changes: the toolbar labels are "Editor" and "Game lobby" (the ⟲ is gone),
the setup eyebrow is replaced by one plain sentence, the badge fill and `gsc-eyebrow` classes are dropped, the card reads
"Whammy!", the splash kicker is removed, and `shared/icons.js` is loaded.

**Checklist**
- [x] `data-gsc-game="press-your-luck"`. There are no local accent or stage overrides; the old `--stage-deep/-night` purple is deleted, so the body paints the shared flat `--stage-bg` (accent at 5 %).
- [x] Anton is used for one hero per screen. Audited: setup `card-title`, board `total-money`, result `pyl-result-winner`, question screen none. Everything else is Inter 400/500/600. Nothing uses `text-transform: uppercase` or letter-spacing (audit `caps: []`).
- [x] No decorative eyebrows. Setup reads "Name two to four players, seat any phones that have joined, then start the game."
- [x] Text ≥ 14 px, body ≥ 16 px, controls ≥ 15 px. The key hints inside buttons are 14 px (the audit flagged 12.8 px and they were raised).
- [x] The accent appears only on the active state (the buzzed lamp, the spinner's total, picked buttons, seat picks), on primary buttons (Start, Arm, STOP, Next player, Load set) and on the correct-option / winner underline. Gold appears only on money: the totals, the standings, the hit card and the phone's own total.
- [x] No `text-shadow`, glow `box-shadow`, `backdrop-filter`, gradient fill or neon. Grepped and audited (UI-11 is a harness check).
- [x] One flat surface level (`--surface` with a `--hairline` border and 8 px radius). The roster, standings and editor rows are hairline lists, not nested panels. No accent rails.
- [x] Buttons come from the shared v3 `.btn` (6 px radius, sentence case, 600). Primary is the flat accent with `--accent-ink`, secondary a hairline outline, Wrong a red outline. The host STOP is a flat 6 px accent rectangle, 74 px tall at 720 and 66 px at 676.
- [x] **The Big Board stays saturated, as the brief allows.** Squares are flat `#23308a` blue with `#ffe14d` money (8.7:1). A Whammy square is flat `#b3122e` with white "WHAMMY" text (6.9:1). The travelling light is flat `#ffe14d` with a white 3 px outline. Where the light stops is flat cyan for money and flat red for a Whammy, both outlined. No gradients and no glow anywhere on the board.
- [x] No emoji in the host DOM (UI-10 harness check). Icons come from `GSCIcons` beside text labels.
- [x] Motion: the tile colour transition is removed. It lagged the instant ink change and blanked a square's text mid-hop; the audit caught it at 1.00:1. The only motion left is the light itself (JS). The CSSOM walk finds no unguarded `@keyframes` or animation. Under `prefers-reduced-motion: reduce`, STOP resolves in about 50 ms, the light sits on the core's square, `getAnimations()` returns 0, and the splash is skipped.
- [x] The splash is the 600 ms plain card (no kicker, empty sub line).
- [x] The toolbar reads **Sound · Editor · Game lobby**, each icon plus text (UI-12 harness check). When embedded, `#btn-exit` is hidden by CSS because the hub's shell bar carries Lobby.
- [x] Copy: no tagline in the chrome. The phone's board headline is "Your turn on the board" / "Your turn is over".
- [x] Gates:
  - In play at 1280×720 and 1280×676 there is no vertical or horizontal scroll on question (open, picks, revealed), board, landed, result or lobby modal. Setup scrolls (931 px) by design; it isn't a play screen.
  - On the phone at 320 there is no horizontal scroll. Targets are STOP 176 px, BUZZ 176 px and every other button 56 px. STOP keeps its flat fill on hover (selectors scoped under `.phone-actions`).
  - The DOM contrast audit samples every text node on every screen and finds **0** below 4.5:1, at both heights and on the phones.

**Layout defects found during the pass and fixed**
1. A landing card sat on top of STOP. The centre panel is now laid out down the left, and cards land in its right half. A headless geometry check gives `cardOverStop: false`, `cardOverPass: false`, `cardOverNext: false`.
2. The setup inputs rendered as browser defaults. `.field input/select` now carries the shared `.field-input` look.
3. The phone confirm button rendered as an outline because `.btn` beats `.gsc-btn-primary`. It now also carries `btn-gold`, like every other primary button.

**Harness additions:** UI-10, UI-11, UI-12, and "Game lobby disabled on setup". Two harness waits were also
hardened: phone views after the second question, and all three phones after a host reload, which flaked once in five runs.

**Deliberate exceptions, for the UI tester**
- The words on the squares come from the core's `squareLabel`, not CSS: "WHAMMY" and "+ ONE SPIN" are capitals in the source text. The brief keeps "a text WHAMMY" on the board.
- The phone's race buttons say **BUZZ** and **STOP**, the show's call words, set as text in JS. No CSS uppercase is involved.
