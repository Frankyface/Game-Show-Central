# Cross-game UI consistency pass: implementation

Implementer: consistency agent.

**Inputs:**
- `docs/reports/ui-v3-verification.md`, ranked top ten. This pass covers items 1, 3, 4, 5, 6, 8, 9 and 10, plus Jeopardy's two emoji (D7).
- `docs/21-ui-cleanup-brief.md` rules 4, 5, 9 and 10.
- `docs/design-system.md` §0.

**Out of scope.** Two other agents own these concurrently, and this pass left their code alone:
- the Deal or No Deal contestant picker (top-ten #2, `#screen-seat` and the picker code in `dond-view.js`);
- the Millionaire hot-seat picker (#7).

## 1. What changed

### 1.1 One toolbar rule (items 3 and 6)

`shared/theme-components.css` §4b adds `.gsc-toolbar`, `.gsc-toolbar-title`, `.gsc-toolbar-actions` and `.gsc-toolbar-btn`.

| Part | Spec |
| --- | --- |
| Bar | 56 px (border-box), full width, 16 px inline padding, 1 px hairline rule |
| Name | Inter 600, 18 px, 16 px from the left edge |
| Actions | pushed right, 8 px gap, no wrap |
| Buttons | 44 px tall, Inter 600, 15 px, sentence case, icon + label with an 8 px gap, hairline outline, 6 px radius; disabled is 45 % opacity, never hidden |

**Specificity.** Every rule is prefixed `body`, at 0,2,1. That beats the games' own `.topbar .btn`-style rules (0,2,0). The games' `body.player-mode …` rules still win, so phones are unchanged.

**Applied to all 15 `games/*/index.html`.** In each header:
- the header gets `gsc-toolbar`;
- the `h1` gets `gsc-toolbar-title`;
- the actions div gets `gsc-toolbar-actions`;
- every bar button gets `gsc-toolbar-btn` and loses `btn-small` / `gsc-btn-sm`.

**Per-game clean-up:**
- Dead toolbar overrides removed from `cr.css`, `pwd.css`, `pyl.css`, `chase.css`, `pyr.css` and `wwm.css`.
- `--feud-topbar` is now 56 px.
- Pyramid and Password had their bar inside the page padding. They now pull it out to full width with `body .topbar.gsc-toolbar { margin: … }`.

**Game name in the bar = the plain registry name:**

| Game | Change |
| --- | --- |
| Family Feud | `feud-app.js:259` |
| Match Game | `mg-view.js:401` |
| Deal or No Deal | `dond-view.js` `renderChrome` (not the picker) |
| Jeopardy | A new `syncBarTitle()` in `gsc-extras.js` runs on app.js's render hook. app.js itself is untouched. The set title still shows on the setup hero (`#setup-title`). |
| Krillion | The "Deep Dive · prompt 1 of 7" subtitle is gone from the bar. Each screen already shows it on its own round line, and the dead `subtitle()` code is removed from `kr-view.js`. |

### 1.2 One set of labels (item 4)

The label table is in `docs/design-system.md` §0, under "One bar, one vocabulary". It is repeated here:

| Control | Label | Icon | Notes |
| --- | --- | --- | --- |
| Bar title | Registry name ("Family Feud", "Jeopardy", "Deal or No Deal", "Millionaire", …) | — | A set title may appear on setup only |
| Sound | **Sound** / **Sound off** | `sound` / `sound-off` | Before: "Sound on" (10 games), "Muted" (Wheel, TPIR). Twelve JS files changed (a string in each), plus Jeopardy's buzzer-panel copy and the hub lobby row. |
| Editor | **Editor** | `edit` | Before: "Question Editor", "Question editor", "Board editor", "Prompt editor" |
| Game lobby | **Game lobby** | `lobby` | Disabled while no game is in progress, never hidden |
| End action | **End game** | — | Before: "End the night" (8 games) and "End the game" (PYL, Krillion). Millionaire's reads "End game (banks $200)". |
| Undo | **Undo** | `undo` | Each Undo button now has `data-gsc-icon="undo"`. A new `GSCIcons.decorate()` in `shared/icons.js` runs on load and draws the icon. |
| Status | CSS dot + "Connected" / "Away" | — | Replaces 🟢 / 🔴 / ⚠ |

**Exceptions:**
- Weakest Link's **End round** ends a round, not the game, so it keeps its name.
- Deal or No Deal's picker still has `#btn-seat-finish` "End the night" and an Undo without an icon. That markup belongs to the picker agent; see §4.

**No primary button in the bar.** Jeopardy's Final Jeopardy is now on the board screen:
- `gsc-extras.js` `mountFinalOnBoard()` moves upstream's own `#btn-final` (same node, id and listener) into a right-aligned `.gsc-board-actions` row above the scores.
- `gsc-look.css` draws it as a secondary outline, and hides the row while the board-done banner (the screen's one primary) is showing.
- `gsc-extras.js` also creates the Sound and Game lobby buttons with `gsc-toolbar-btn`.
- `index.html` labels the editor button "Editor".

**Deal or No Deal keeps Editor in the bar during play.** It is disabled mid-game, with a title explaining why, and enabled on setup and standings. "Use in game" sets `core: null`, so offering it mid-game would silently drop the game.

### 1.3 Game lobby disabled on setup (item 5, D5)

`chase-view.js` `render()` and `ovh-view.js` `render()` now set `$("btn-game-lobby").disabled = !app.core`. The button is present but disabled, as in the other 13 games.

### 1.4 Hub card accents (item 1, D6)

Each `accent` in `js/hub-registry.js` is now the `--accent` from `shared/theme.css`:

| Game | Old accent | New accent |
| --- | --- | --- |
| Jeopardy | `#060ce9` | `#2b34ff` |
| Family Feud | `#c8102e` | `#e21b3c` |
| Wheel of Fortune | `#7b2cbf` | `#9d4edd` |
| Weakest Link | `#8a0303` | `#7c99b6` |
| Millionaire | `#1d2a7a` | `#3346c8` |
| Pyramid | `#f4b400` | `#2ec4b6` |
| Password | `#f2c94c` | `#7aa2ff` |

**Drift guard.** The new test `tests/registry-accent.test.mjs` fails if the two ever disagree again. I kept a copy rather than having the hub read the CSS at runtime; the test keeps it honest. On the live landing page all 15 card bars match the theme.

### 1.5 Status dots (item 8, D7)

**Shared.** `.gsc-status-dot` is in theme-components §4: a filled green dot, or a hollow red ring for `.is-away`. Colour is never the only signal.

**Hub.** `hub-host.js` (roster) and `hub-player.js` (waiting room) use a new `statusDot()` helper. It draws the dot (`aria-hidden`) plus a visually hidden "Connected" or "Away".

**Jeopardy** (vendored files, each a one-line `// GSC:` edit; line counts unchanged):

| File | Line | Was | Now |
| --- | --- | --- | --- |
| `buzzer-host.js` | 606 | 🔴 / 🟢 | the word "Away" / "Connected", class `is-away`. `gsc-look.css` turns it into the CSS dot, with the word at `font-size: 0` so screen readers still read it. |
| `buzzer-host.js` | 618 | "🔊 Sound on" / "🔇 Sound off" | "Sound" / "Sound off" |
| `buzzer-host.js` | 637 | chip ending "· ⚠" | "· joins paused" (the broker-lost state) |
| `buzzer-player.js` | 613 | the emoji | empty text; the phone dot is CSS, keyed on its existing `aria-label` ("Connected" / "Reconnecting") |

### 1.6 Action rows, badges and sizes (items 9 and 10)

**Button sizes.**

| Rule | Was | Now |
| --- | --- | --- |
| `.btn` | 40 px | 44 px, 15 px type |
| `.btn-small` | 34 px | 44 px, 15 px |
| `.gsc-btn-sm` | 36 px | 44 px, 15 px |

**Fixed button sizes:**
- PYL's 32 px Undo and End buttons, the TPIR Bid and playbar buttons, and the CR, Wheel and Feud small buttons are now 44 px or more.
- The Match Game card "Save" buttons went from 40 to 44 px.

**One height per action row.**
- **Shared rule:** `.controls > .btn` is 48 px.
- **Krillion:** `.kr-actions > .kr-btn` is 48 px.
- **Overrides:** Password, Millionaire and The Chase had their own 44 px `.controls` rules that beat the shared one, so they are aligned in their own CSS.

**Never two filled buttons side by side.**
- **Shared rule:** a disabled `.btn-gold` or `.gsc-btn-primary` is drawn as a disabled outline. This covers PYL's "Correct" beside "Arm the buzzers".
- **1 vs 100:** "Close the Mob" is an outline while "Open the Mob window" is offered.
- **Match Game:** `.btn-green` (Match) is now a green outline. The footer is one primary (Reveal or Lock it in) plus outlines, and "No match" keeps its red outline.

**Flat, no pills.**
- `.gsc-badge` is now flat: hairline outline, no fill, 15 px. That covers The Chase "Contestant 1 of 4" and the badges in DOND, Password, Pyramid, TPIR, CR and Match Game.
- The 1 vs 100 lifeline chips use a hairline, not the accent ring.
- No `999px` radius is left in any active rule. Jeopardy's upstream pills were already overridden in `gsc-look.css`.

**Tags and labels at 14 px or more:**

| Element | Was | Now |
| --- | --- | --- |
| `.gsc-chip` | 13.6 px | 14 px |
| `.gsc-kbd` key hints | 12.8 px | 14 px |
| `.gsc-podium-note` | 13.6 px | 14 px (TPIR "No bid yet") |
| Hub `.tile-chip` | 13.6 px | 14 px |
| Hub `.roster-tag` | 13.6 px | 14 px |
| Hub roster Kick / Rename / Remove | 13.6 px, 32 px tall | 15 px, 36 px tall |
| Jeopardy Kick | 12 px | 15 px |
| Match Game merge buttons | 14.4 px | 15 px |

### 1.7 Docs

`docs/design-system.md` changes:
- §0 gains "One bar, one vocabulary": the markup, the measurements, what may and may not sit in the bar, the label table, and the action-row and badge rules.
- `GSCIcons.decorate()` is documented.
- The checklist's toolbar line points at the shared classes.
- The file-table line counts are updated.

## 2. Measurements

**How it was measured.** `.scratch/cons-measure.mjs` ran on headless Chrome over CDP, with a Node static server on port 8811. For each game it:
- loads the standalone host page with a `?store=cons…` namespace, so no real save is touched;
- audits the setup screen;
- fills names and presses Start (the tester's `START` script);
- measures the first play screen at 1280×720, 1280×676 and 1280×672.

"Before" is the same script on `main` before any change. Insets are measured from the bar's own left edge.

### 2.1 Toolbar, play screen, 1280×720: before → after

| Game | Bar h (px) | Title inset in bar | Button h | Button font (px) | Title text | Bar buttons |
| --- | --- | --- | --- | --- | --- | --- |
| Jeopardy | 64 → **56** | 20 → **16** | 44 → **44** | 15 → **15** | "Game Night Jeopardy" → **"Jeopardy"** | Final Jeopardy (primary, no icon) · Sound on · Question Editor · Game lobby → **Sound · Editor · Game lobby** |
| Family Feud | 60 → **56** | 24 → **16** | 44 → **44** | 15.2 → **15** | "Family Feud — Game Night" → **"Family Feud"** | Sound · Question editor · Game lobby → **Sound · Editor · Game lobby** |
| Wheel of Fortune | 59 → **56** | 18 → **16** | 44 → **44** | 15.2 → **15** | "Wheel of Fortune" (unchanged) | Sound · Editor · Game lobby (gap 6 → 8) |
| Weakest Link | 59 → **56** | 38 → **16** | 44 → **44** | 15 → **15** | "Weakest Link" (unchanged) | Sound on · Editor · Game lobby → **Sound · Editor · Game lobby** |
| Millionaire | 58 → **56** | 19 → **16** | 44 → **44** | 15 → **15** | "Millionaire" (unchanged) | Sound on · … → **Sound · Editor · Game lobby** |
| The Price Is Right | 51 → **56** | 18 → **16** | 34 → **44** | 14.4 → **15** | "The Price Is Right" (unchanged) | Sound · Editor · Game lobby (gap 7 → 8) |
| Pyramid | 55 → **56** | 0 (bar inset 20 px from viewport) → **16** | 44 → **44** | 14.4 → **15** | "Pyramid" (unchanged) | Sound on · … → **Sound · Editor · Game lobby** |
| Deal or No Deal | 58 → **56** | 19 → **16** | 44 → **44** | 14.4 → **15** | "Deal or No Deal — Game Night" → **"Deal or No Deal"** | Sound on · Game lobby (Editor gone in play) → **Sound · Editor · Game lobby** |
| Password | 36 (no hairline) → **56** | 0 (bar inset 18 px from viewport) → **16** | 36 → **44** | 14.4 → **15** | "Password" (unchanged) | Sound on · … → **Sound · Editor · Game lobby** |
| Chain Reaction | 48 → **56** | 16 → **16** | 36 → **44** | 14.4 → **15** | "Chain Reaction" (unchanged) | Sound on · … → **Sound · Editor · Game lobby** |
| The Chase | 49 → **56** | 16 → **16** | 38 → **44** | 14.4 → **15** | "The Chase" (unchanged) | Sound on · … (lobby **enabled** on setup) → **Sound · Editor · Game lobby** (disabled on setup) |
| 1 vs 100 | 58 → **56** | 19 → **16** | 44 → **44** | 15 → **15** | "1 vs 100" (unchanged) | Sound on · … (lobby **enabled** on setup) → **Sound · Editor · Game lobby** (disabled on setup) |
| Press Your Luck | 53 → **56** | 16 → **16** | 36 → **44** | 14.4 → **15** | "Press Your Luck" (unchanged) | Sound on · … → **Sound · Editor · Game lobby** |
| Match Game | 56 → **56** | 20 → **16** | 44 → **44** | 15.2 → **15** | "Match Game — Game Night" → **"Match Game"** | Sound · Prompt editor · Game lobby → **Sound · Editor · Game lobby** |
| Krillion | 64 → **56** | 20 → **16** | 44 → **44** | 15 → **15** | "Krillion" + subtitle "Deep Dive · prompt 1 of 7" → **"Krillion"** | Sound · Editor · Game lobby (unchanged) |

**After.** The setup screen, play at 1280×720 and play at 1280×676 each give exactly one geometry signature across all 15 games:
- bar 56 px, full width (x = 0, w = 1280);
- title Inter 600 18 px at x = 16;
- buttons 44 px, Inter 600 15 px, every one with an icon;
- gap 8 px, last button 16 px from the right edge.

The button order is Sound · Editor · Game lobby everywhere. On setup, Game lobby is disabled in all 15.

The sizes before were 36–64 px for the bar, 34–44 px for the buttons, 14.4–15.2 px for the button type, and 16–38 px for the title inset (plus two bars inset from the page edge). Each game is a row in `.scratch/cons-measure-before.json` and `.scratch/cons-measure-after.json`. `node .scratch/cons-sum.mjs after play|play676|setup` prints them.

**Embedded** (`?embed=host`, 1280×672, `.scratch/cons-embed.mjs`): every bar is 56 px with the title at x = 16, three 44 px buttons and no room chip.

### 2.2 Gates (after)

| Gate | Result |
| --- | --- |
| `node --test` (root) | **1423 / 1423 pass**: 1422 before, plus the new accent test |
| Browser harnesses (`.scratch/cons-harness.mjs`, 19 pages) | **All green.** Hub 16, Jeopardy 70, Jeopardy embed 21, Jeopardy photo 26, Feud 84, Wheel 95, Weakest Link 75, Millionaire 79, TPIR 80, Pyramid 97, DOND 83, Password 75, Password harness-x 54, CR 81, Chase 64, 1 vs 100 68, PYL 21, Match Game 64, Krillion 65. That is 1,218 checks, the same count as before. Password, Chase and Millionaire were re-run after their row-height fix; Jeopardy was re-run after the final `index.html` comment. |
| Harness edits (label pins only) | Feud `harness.html:481` and `harness-x.js:248` click "Editor"; Millionaire `harness.html:457` expects "End game (banks $200)"; Pyramid `harness-scenarios.js:112,122` expect "End game". |
| No scroll in play, 1280×720 / 676 / 672 | **15/15 fit at all three sizes.** `scrollHeight == clientHeight`; Wheel's run had 5 players. |
| Contrast ≥ 4.5:1 (every visible text node, setup and play) | **0 failures.** The lowest ratios are Wheel 4.60, Feud 4.71 and TPIR 4.77, the same as before; all others are ≥ 5.37. |
| No emoji in host DOM text | **0** on every setup and play screen and on the hub landing. The four emoji status sites in hub and Jeopardy code are gone. |
| Reduced motion | `getAnimations()` is empty on all 15 play screens under `reduce`. No new keyframes were added. |
| Action rows | Every play-screen `.controls` / `.kr-actions` row has one height (48 px). There are no buttons under 44 px. The only 44 px leftover is Feud's click-to-edit score number, which is not an action. No row has two enabled filled buttons. |
| Undo icons | Every visible `[data-gsc-icon]` button has its SVG |
| Files < 800 lines | All edited files are under 800 lines (the largest is `gsc-look.css` at 769). Jeopardy's vendored `buzzer-host.js` is 820, as before; its edits replaced lines in place. |

## 3. Files touched

- **Shared:**
  - `shared/theme-components.css`: §4b toolbar, flat `.gsc-badge`, `.gsc-status-dot`, `.gsc-btn-sm` 44 px, `.controls` row height, chip/kbd/podium-note at 14 px.
  - `shared/theme.css`: `.btn` 44 px / 15 px, `.btn-small` 44 px, disabled primary drawn as an outline.
  - `shared/icons.js`: `decorate()`.
- **Hub:**
  - `js/hub-registry.js`: accents.
  - `js/hub-host.js`: status dot, "Sound".
  - `js/hub-player.js`: status dot.
  - `css/hub.css`: roster status, tag and Kick sizes.
  - `tests/registry-accent.test.mjs`: new.
- **Games:**
  - **Markup:** all 15 `index.html` files (toolbar classes, labels, undo icons, "End game").
  - **Bar title and Game lobby JS:** `feud-app.js`, `mg-view.js`, `dond-view.js` (`renderChrome` only), `kr-view.js`, `chase-view.js` and `ovh-view.js`.
  - **Sound-label JS:** twelve app files.
  - **Other JS:** `wwm-view.js:347`.
  - **Jeopardy:** `gsc-extras.js`, `gsc-look.css`, `buzzer-host.js` and `buzzer-player.js` (`// GSC:` string edits).
  - **Per-game CSS clean-up:** cr, pwd, pyl, chase, pyr, wwm, tpir, feud, mg, ovh and kr.
- **Docs:** `docs/design-system.md`.

## 4. For the orchestrator

1. **Deal or No Deal picker leftovers, intentionally not touched.** In `index.html` `#screen-seat`, `#btn-seat-finish` still reads "End the night" and `#btn-seat-undo` has no `data-gsc-icon="undo"`. The picker agent, or a two-line follow-up after both land, should apply the label table there.
2. **Concurrent files.** I edited `dond-view.js` (`renderChrome` only), `deal-or-no-deal/index.html` (header, the play-screen Undo/End buttons and the other screens' Undo buttons; not `#screen-seat`), `millionaire/index.html` and `wwm-view.js:347` while the picker agents were working. Check that their diffs and mine merge cleanly before committing.
3. **Global size change.** `.btn` and `.btn-small` are now 44 px in `shared/theme.css`, so every v1 small button in editors and dialogs also grew from 34 to 44 px. All 15 play screens still fit at 672 and all harnesses are green, but setup and editor screens are a little taller (they already scroll).
4. **Behaviour changes, deliberately small:**
   - Deal or No Deal's Editor is visible but disabled mid-game (it was hidden).
   - Game lobby is disabled on setup in The Chase and 1 vs 100.
   - Jeopardy's Final button lives on the board screen.
   - Krillion's bar subtitle is gone.

   Nothing else changes behaviour.
5. **Scratch helpers.** The prefixed helpers in `.scratch/` are `cons-serve`, `cons-cdp`, `cons-audit`, `cons-measure`, `cons-sum`, `cons-table`, `cons-embed`, `cons-harness`, `cons-hub` and `cons-rowpeek`. The measurement JSON files are `cons-measure-before.json` and `cons-measure-after.json`, and the screenshots are `cons-after-<game>-play.png`.
