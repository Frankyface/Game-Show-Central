# UI v3 "look real" cleanup — verification (UI-1 … UI-12)

Tester: independent UI tester · Brief: `docs/21-ui-cleanup-brief.md` §2–§3, `docs/09-ui-upgrade-brief.md` §5, `docs/design-system.md` §0.

## 1. Environment

- Windows 11 Home 10.0.22635, Node v24.16.0, headless Chrome (current stable) over CDP. Repo on `main` at `6692bcf`, plus the krillion commit another agent landed during this run.
- Served by a small Node static server (`.scratch/uit-serve.mjs`, port 8790). Every page was loaded with a `?store=` namespace (`uit…`), so no real save was touched.
- Scripts are in `.scratch/uit-*`:
  - `uit-harness.mjs` runs every browser harness.
  - `uit-run.mjs` does the standalone host audit (setup screen, then the first play screen, at 720 and 676, plus reduced motion).
  - `uit-hub.mjs` covers the hub landing and lobby, the shell bar, all 15 games embedded, and one real phone at 320×640 over the PeerJS broker.
  - `uit-audit.js` is the in-page DOM and CSSOM audit.
  - `uit-bar.mjs` measures toolbar geometry. `uit-kbd.mjs` does the Tab walks. `uit-fit.mjs` covers the UI-2 deep checks. `uit-accent.cjs` compares the registry accents with the theme accents.
- Screenshots are in `docs/reports/img/uiv3-*.png`:
  - `uiv3-<game>-setup.png` and `uiv3-<game>-play.png`: standalone at 1280×720.
  - `uiv3-hub-<game>.png`: the game inside the hub frame.
  - `uiv3-phone-<game>.png`: the phone at 320×640.
  - `uiv3-hub-landing.png`, `uiv3-hub-lobby.png`, `uiv3-hub-phone-join.png`, `uiv3-hub-phone-waiting.png`, `uiv3-focus-the-chase.png`.
- A second agent changed `games/krillion/**` during this run. In the first pass Krillion's toolbar had no icons. After their commit it has them, and the Krillion results below are re-measured on the committed code.

## 2. Results

| ID | Surface | Result | Evidence |
| --- | --- | --- | --- |
| UI-1 | `node --test` (root) | **PASS** | 1422 / 1422 pass, 0 fail (`.scratch/uit-nodetest.txt`) |
| UI-1 | 19 browser harness pages | **PASS** | All checks pass on every page (1,218 checks in total). Detail is in the first list below this table. |
| UI-1 | re-run after the tester CSS fixes | **PASS** | Feud 84/84, Wheel 95/95, Chase 64/64, 1 vs 100 68/68, Match Game 64/64 |
| UI-2 | 15 games standalone, first play screen, 1280×720 and 1280×676 | **PASS after 2 tester fixes** | Before the fixes: Feud overflowed by 4 px at 720 and 29 px at 676; Wheel with 4 players overflowed (770/720). After D1/D2: every game is `scrollHeight == clientHeight` at both sizes. |
| UI-2 | 15 games inside the hub frame (iframe 1280×**672**, shell bar 48 px) | **FAIL (1)** | 14 games fit. **Deal or No Deal fails: 844/672** on the contestant picker with 7 players (D4). Feud was 699/672 before D1 and fits after it. |
| UI-2 | Wheel at 2/3/4/6 players | **PASS after D2** | Each count is 720/720 and 672/672 |
| UI-3 | contrast: every visible text node on every surface, gradients checked on both stops | **PASS** | 0 nodes below 4.5:1 (or 3:1 at ≥ 24 px). Minimum ratio per surface: hub 5.48, Wheel 4.60, Feud 4.71, TPIR 4.77, every other game ≥ 5.37. |
| UI-4 | CSSOM walk | **PASS (with a documented exception)** | 0 `@keyframes` or `animation` rules outside `no-preference` in the hub, shared CSS and 14 games. Jeopardy's vendored `buzzer.css` (`buzzer-pulse`, `buzzer-glow`) and `timer.css` (`timer-flash`) are gated with `reduce` instead. `gsc-look.css:546` sets `animation:none` on both buzzer animations, and the timer flash is a meaningful clock cue. The vendored files must not be edited, so this is accepted. |
| UI-4 | `getAnimations()` under reduced motion | **PASS** | Empty on every host play screen and the hub, and inside the game frame |
| UI-4 | wheel / Plinko / lights / case open resolve under reduce | **PASS (via harness)** | Each game's harness covers this, and all are green. Not re-driven by hand. |
| UI-5 | phones at 320×640 through the hub with a real room (15 games) | **PASS (partial coverage)** | No horizontal scroll on any phone frame, and no visible target under 56 px. TPIR (704/636) and DOND (662/636) scroll vertically, which is allowed. The joined phone usually sat in that game's waiting or first state, so in-game phone controls are only exercised by each game's harness. |
| UI-5 | hub phone join / waiting | **PASS** | 640/640, no scroll, targets ≥ 56 px |
| UI-6 | keyboard: landing, lobby, Feud, The Chase, Krillion, Wheel | **PASS** | Tab reaches the toolbar, then play controls, then the podiums. Every stop shows a ring (`--focus`, 2 px). No `[NO RING]` stop except `body` on wrap-around. |
| UI-7 | `git diff 5492d9c -- js games/*/js` | **PASS (see notes)** | See the UI-7 notes below this table. |
| UI-8 | hub splash on switch | **PASS** | All 15 games: the name is visible at 120 ms and hidden at 820 ms. Each game's own splash stays hidden when embedded; Jeopardy has none. Under reduced motion it is skipped. |
| UI-9 | subjective | **FAIL: not yet one product** | Sections 3 and 4 |
| UI-10 | no emoji in host DOM text outside roster/avatar | **PASS on audited states, 2 latent** | 0 hits on landing, lobby, shell bar, and every game's setup and play screen. Two latent hits are listed below this table. |
| UI-11 | no `backdrop-filter`, `text-shadow` or gradient under text | **PASS** | 0 elements on every surface audited (live DOM, all elements, hidden ones included). The only shadows found are 3 px spread rings on the phone avatar, not glow. |
| UI-12 | Sound · Editor · Game lobby, icons, lobby disabled on setup | **FAIL (2 games)** | All 15 bars are in the right order with icons. The failures are listed below this table. |

**UI-1 harness detail** (checks passed on each page):

| Page | Checks |
| --- | --- |
| hub | 16 |
| Jeopardy (main harness) | 70 |
| Jeopardy embed | 21 |
| Jeopardy photo | 26 |
| Family Feud | 84 |
| Wheel of Fortune | 95 |
| Weakest Link | 75 |
| Millionaire | 79 |
| The Price Is Right | 80 |
| Pyramid | 97 |
| Deal or No Deal | 83 |
| Password | 75 |
| Password harness-x | 54 |
| Chain Reaction | 81 |
| The Chase | 64 |
| 1 vs 100 | 68 |
| Press Your Luck | 21 |
| Match Game | 64 |
| Krillion | 65 |

**UI-7 notes.**
- The pure-v3 commits stay within scope: class names, `GSCIcons.prepend`, splash 1200 → 600 ms with an empty sub line, emoji-free strings, and Game lobby disabled on setup.
- Three edits go beyond that, and each one is documented in its commit:
  - Jeopardy `gsc-extras.js` (cb555dd) adds a new toolbar **Sound** button. It drives `BuzzerHost.toggleSound()` and stores the result in the hub-wide `localStorage` key `gsc-sound`. That is new behaviour, needed for UI-12.
  - `wheel-draw.js` (d7d42f7) removes the SVG rim bulbs and redraws the pointer and hub. This is decorative geometry; the wedge maths is unchanged.
  - `pwd-view.js` changes a visually-hidden "worth now" span into a visible tag.
- The mixed commits (Chase, 1 vs 100, Match Game, Press Your Luck, Millionaire, DOND, Wheel, Jeopardy, Pyramid) also carry documented functional fixes. Krillion is a new game.
- I found nothing undocumented. I did not re-review the logic of those fix commits.

**UI-10 latent hits** (states with an open room that my audit did not render):
- Jeopardy's host buzzer panel dot, `buzzer-host.js:606` (`🔴`/`🟢`).
- The Jeopardy room chip, `buzzer-host.js:637` (`· ⚠`).

The hub roster dot (`hub-host.js:565`) is inside a roster element, so it is allowed, but see top-ten #8.

**UI-12 failures.**
- The Chase and 1 vs 100: **Game lobby is enabled on setup** (D5).
- Embedded, The Chase, 1 vs 100 and Match Game showed an extra **"Back to lobby"** in the bar. Tester fix D3 resolves this.
- Deal or No Deal drops **Editor** from the bar during play, so the bar changes mid-game. That is the same order, but not "the same bar".

## 3. Defects

| # | Sev | Where | Defect | Status |
| --- | --- | --- | --- | --- |
| D1 | minor | `games/family-feud/css/feud-board.css:15` | The face-off board overflowed 1280×720 by 4 px and the 672 px hub frame by 27 px. | **Fixed by tester**: `--slot-h: clamp(44px, 8.2vh, 68px)` → `clamp(44px, 7.2vh, 68px)`. Fits both sizes; harness 84/84. |
| D2 | minor | `games/wheel-of-fortune/css/wheel.css:315-317` | With 4 players the podium column overflowed (770/720, 756/672). The two-column grid only started at 5 players. | **Fixed by tester**: `:has(> :nth-child(5))` → `:has(> :nth-child(4))` (3 selectors). 2/3/4/6 players all fit; harness 95/95. |
| D3 | minor | `games/the-chase/css/chase.css`, `games/one-vs-100/css/ovh.css`, `games/match-game/css/mg.css` (end of each file) | Embedded, `#btn-exit` "Back to lobby" appeared in the game bar (UI-12 / rule 9). Ten other games already hide it. | **Fixed by tester**: appended `body.gsc-embedded #btn-exit { display: none !important; }` (1 rule each). Harnesses 64/68/64 green. |
| D4 | **major** | `games/deal-or-no-deal/js/dond-view.js:399`, DOND picker | The picker is too tall for the hub frame: 844/672 with 7 players. The full fix is in **top-ten #2**. | Open |
| D5 | **major** (UI-12) | The Chase (`chase-view.js` render) and 1 vs 100 (`ovh-view.js` render) | Game lobby is enabled on the setup screen. | Open. Fix: `$("btn-game-lobby").disabled = !state.core` (or equivalent), as the other 13 games do. JS, so not done by the tester. |
| D6 | minor | `js/hub-registry.js:15-63` | The hub card accent bars use stale registry accents for 8 of 15 games (see top-ten #1). | Open. Fix: set the `accent` value in each registry entry to the matching `--accent` in `shared/theme.css`. Data-only JS edit. |
| D7 | minor | `js/hub-host.js:565`, `js/hub-player.js:333`, `games/jeopardy/js/buzzer-host.js:606,637`, `buzzer-player.js:613` | Status shown as emoji (`🟢`/`🔴`/`⚠`) at 9.6 px. Rule 7 asks for a status dot. | Open. Fix: a CSS dot (`.roster-dot::before { background: var(--green|--red) }`) plus a visually-hidden "connected/offline" text. |
| D8 | minor | Toolbars of TPIR, Password, Chain Reaction, The Chase, PYL (`index.html` header buttons use `btn-small`, e.g. `price-is-right/index.html:21-23`) | Toolbar buttons are 34–38 px tall and 14.4 px. Rule 4 says 44–48 px on host; rule 1 says controls ≥ 15 px. | Open. Fix: drop `btn-small` from the three header buttons, or add one shared `header .btn { min-height:44px; font-size:15px }` to `shared/theme-components.css` (hub agent). |
| D9 | minor | Millionaire hot-seat picker (`millionaire/index.html:98`, `wwm-view.js:182`) | Looks unfinished; see top-ten #7. | Open |

No critical defects.

## 4. UI-9: does it read as one real product?

The v3 pass worked on the big things. There is no glass, glow, bulb, marquee or emoji left on any audited host surface. Type is Inter sentence case with one Anton hero, and the stages are flat. The landing, lobby and most play screens now read as a restrained TV app (Jeopardy board, Pyramid, Weakest Link, The Chase and 1 vs 100 look finished).

What still gives it away is **inconsistency between games**: fifteen hands built fifteen toolbars and fifteen sets of conventions.

### Ranked top ten remaining issues

1. **Hub card accent bars contradict the games.** `js/hub-registry.js:15-63` hard-codes v2 accents, and `hub-host.js:487` paints them as `--tile-accent`. Eight cards show the wrong colour:

   | Game | Card bar shows | Game accent |
   | --- | --- | --- |
   | Pyramid | gold `#f4b400` | teal |
   | Password | gold | blue |
   | Weakest Link | dark red | steel blue |
   | Jeopardy | old shade | `#2b34ff` |
   | Family Feud | old shade | v3 value in theme |
   | Wheel of Fortune | old shade | v3 value in theme |
   | Millionaire | old shade | v3 value in theme |

   This is the first screen anyone sees, and gold is supposed to be money only.
2. **The Deal or No Deal contestant picker looks unfinished and overflows** (`dond-view.js:399`, `uiv3-hub-deal-or-no-deal.png`):
   - Every name is listed twice: a row of red buttons, then a standings list.
   - The standings list labels each name "to play" in **Anton 16 px grey** (`.gsc-podium-score`), so the hero font is used for a label.
   - The screen is 844/672 in the hub frame (D4).
   - Fix: hide the standings list while picking (or drop the button row), and give the "to play" text a quiet Inter label class.
3. **The toolbar is not one bar.** Measured by `uit-bar.mjs`:
   - Bar height ranges from 36 px (Password, which also has no hairline) to 64 px (Jeopardy).
   - Toolbar buttons are 34, 36, 38 or 44 px tall, at 14.4, 15 or 15.2 px type.
   - The title inset ranges from 16 px (Chase, CR, PYL) to 38 px (Weakest Link).

   Fix: one shared header rule in the theme, `min-height 56px; padding 0 20px; border-bottom 1px var(--hairline)`, with the toolbar buttons at 44 px and 15 px (D8).
4. **Toolbar wording differs.**
   - Sound: "Sound on" in 10 games, "Sound" in Feud, Wheel, TPIR, Match Game and Krillion.
   - When off, it reads "Muted" (Wheel, TPIR) or "Sound off" (the others).
   - Editor: "Editor", "Question Editor" (Jeopardy, title case), "Question editor" (Feud), "Board editor" (DOND), "Prompt editor" (Match Game).
   - DOND removes Editor during play.
   - Jeopardy puts a primary "Final Jeopardy" button inside the bar (`uiv3-jeopardy-play.png`).

   Pick one set ("Sound on/Sound off", "Editor", "Game lobby") and move Final Jeopardy out of the bar.
5. **Game lobby enabled on setup in The Chase and 1 vs 100** (D5), against UI-12.
6. **The game name is shown in four styles.**
   - "Family Feud — Game Night", "Deal or No Deal — Game Night" and "Match Game — Game Night" (the set title is appended).
   - "Game Night Jeopardy" (set title only).
   - Plain "Millionaire", while the setup hero says "Who Wants to Be a Millionaire".
   - Krillion adds a subtitle ("Deep Dive · prompt 1 of 7") in the bar.

   Rule 9 is the game name. Move the set name into the setup hero or the phase line.
7. **The Millionaire hot-seat picker looks unfinished** (`uiv3-millionaire-play.png`):
   - A left-aligned grey "Who is next in the hot seat?" sits above a centred heading.
   - An "Arrivals" heading at x≈780 has nothing under it.
   - The Undo button floats above "Pick the hot seat by hand" (`millionaire/index.html:98`, `wwm-view.js:182`).

   Centre a single column, hide the empty Arrivals heading, and put Undo with the other footer controls.
8. **Emoji traffic-light dots.** `🟢`/`🔴` appear in the hub lobby roster, the phone waiting room, and Jeopardy's host buzzer panel and phone; Jeopardy's room chip ends with "· ⚠" (D7). At 9.6 px they render as cartoon blobs next to an otherwise editorial roster.
9. **Footer action rows mix sizes and words.**
   - Press Your Luck puts 32 px Undo and "End the game" buttons beside 48 px buttons (`uiv3-press-your-luck-play.png`).
   - The TPIR Bid button is 36 px.
   - The end action is called "End the night" (8 games), "End the game" (PYL, Krillion) or "End round" (Weakest Link).
   - Undo carries an icon only in Feud and Match Game.
10. **Leftover v2 shapes and colour habits.**
    - The Chase "Contestant 1 of 1" is a red **pill** badge.
    - 1 vs 100 lifeline chips are cyan pills, and that screen has two primary buttons side by side ("Open the Mob window" and "Close the Mob").
    - Match Game's footer has three colour-filled buttons (orange, green, red).
    - Hub card tags, Kick, and many podium labels are 13.6–14 px, under the 15 px controls floor.

    Each is small; together they read as "different templates".

Also noted (not ranked):
- Password repeats "Worth now" and "10 worth now".
- The Password bar title "Password" sits above a "Password 1" panel heading.
- Feud strike boxes render an invisible "✕" at 0 px.
- The hub lobby leaves a large empty area to the right of the roster at 1280 px.

## 5. Tester diff (all CSS, each under 5 lines)

```diff
games/family-feud/css/feud-board.css
-  --slot-h: clamp(44px, 8.2vh, 68px);
+  --slot-h: clamp(44px, 7.2vh, 68px); /* UI v3 tester: 8.2vh overflowed 720 by 4 px and the 672 px hub frame by 27 px */
games/wheel-of-fortune/css/wheel.css (lines 315-317)
-.podiums:has(> :nth-child(5)) …   (×3)
+.podiums:has(> :nth-child(4)) …   (×3)
games/the-chase/css/chase.css, games/one-vs-100/css/ovh.css, games/match-game/css/mg.css (appended)
+/* UI-12 (docs/21 rule 9): embedded, the hub shell bar carries Lobby; nothing extra in this bar. */
+body.gsc-embedded #btn-exit { display: none !important; }
```

## 6. Verdict

**Fix-then-ship.** The mechanical gates hold:

- Every unit suite and harness is green.
- No `backdrop-filter`, text glow, gradient under text or host emoji appears in the audited states.
- Motion is gated, contrast is ≥ 4.5:1 everywhere, the splash is 600 ms, focus rings show, and phones have no horizontal scroll.

Two majors remain: the Deal or No Deal picker overflows the hub frame and lists every name twice (D4), and Game lobby is enabled on setup in The Chase and 1 vs 100 (D5).

The goal of this round was "looks like one real product", and it is not met yet. The product is clean screen by screen but not consistent across games. The registry accents (#1), toolbar geometry and wording (#3, #4, #6) and the two unfinished pickers (#2, #7) are cheap, mostly CSS or data fixes, and should land before release. Items #8–#10 can go to known issues if time is short.
