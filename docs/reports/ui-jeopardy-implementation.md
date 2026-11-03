# UI upgrade — Jeopardy (game UI agent)

Scope: `games/jeopardy` only, **CSS and two `<link>` lines**. No JavaScript was
touched, no upstream stylesheet was edited, no id / class / attribute the
scripts, tests or harnesses read was renamed, added or removed.

## 1. Files changed

| File | Change |
| --- | --- |
| `games/jeopardy/css/gsc-look.css` | **new**, 734 lines — every visual change lives here |
| `games/jeopardy/index.html` | **two `<link>` lines only** — `../../shared/theme.css` first, `css/gsc-look.css` last |
| `games/jeopardy/css/gsc-embed.css` | **unchanged** (nothing in the new look needed a hub-only override) |

Untouched, as required: `games/jeopardy/js/**`, `css/styles.css` (947 lines —
not grown by a single line), `css/buzzer.css`, `css/timer.css`, `css/media.css`,
`shared/**`, `tests/**`, every other game.

## 2. Which token approach, and why

**Linked `shared/theme.css`** rather than copying tokens.

```html
<link rel="stylesheet" href="../../shared/theme.css">   <!-- FIRST -->
<link rel="stylesheet" href="css/styles.css">           <!-- …upstream sheets… -->
<link rel="stylesheet" href="css/gsc-embed.css">
<link rel="stylesheet" href="css/gsc-look.css">         <!-- LAST -->
```

Reasons it is safe:

- **v2 is a superset of Jeopardy's own palette.** `theme.css` was seeded from
  this game's navy/gold stage, so `--gold`, `--gold-deep`, `--gold-text`,
  `--ink`, `--ink-dim`, `--red`, `--green`, `--radius`, `--duration`,
  `--ease-out` and both font stacks are byte-identical to the values
  `styles.css:root` declares. Where they overlap, `styles.css` is declared
  later and wins anyway.
- **Every selector in `shared/theme-components.css` is `.gsc-*`** (verified by
  grep: zero non-`gsc-` rule heads), so the component kit is inert until a
  class is used. Jeopardy uses none of them — the markup is untouched.
- `theme.css`'s `.btn` / `.btn-gold` / `.btn-ghost` / `.btn-small` are the v1
  rules Jeopardy already carries; `styles.css` re-declares them afterwards.
- What Jeopardy actually gains: `--panel*`, `--well`, `--radius-sm/-lg/-xl`,
  `--shadow-panel/-lift/-inset`, `--tap` (56px), `--ink-mute`, `--fs-*`,
  `--dur-fast/--dur/--dur-slow`, `--ease-spring`, and one shared
  `:focus-visible` ring.

`--accent` / `--accent-2` for Jeopardy (`#2b34ff` / `#ffcc4d`) are set in
`gsc-look.css`'s `:root` instead of adding `data-gsc-game="jeopardy"` to
`<body>`, so `index.html` keeps to link tags only. The values match the
`[data-gsc-game="jeopardy"]` block in `shared/theme.css`.

## 3. What changed, per screen

### Top bar
Slimmer (78px → 69px), a translucent blue wash, and a gold hairline rule
across the bottom that ties into the board frame. Title keeps Anton, gets a
deeper emboss.

### Setup screen — a clean two-column card
At ≥ 880px the card becomes a 960px grid: the title block spans both columns,
**Players** (with the buzzer-room panel inside it) takes the left column,
**Timers** and **Questions** stack in the right, and the error line + **Start
Game** span the full width again. Each `.setup-section` is now an inset panel
with a gold-ruled section heading. Below 880px it is exactly the upstream
single column — which is also what the 1024px-wide photo-harness iframe gets.

### Board — bevelled tiles, inner glow, gold money
- The board frame gets a blue rim and a deeper drop shadow over the black
  gutter.
- `.cell-clue`: a top lip highlight, a dark floor, a 30px inner blue glow and
  a two-layer emboss on the Anton gold money (7.7:1).
- Hover / focus lifts the tile, brightens the gradient and draws a gold ring.
- `.cell-clue.used` reads as a recessed empty slot.
- `.cell-category` is darker with a gold hairline under it, so the category
  strip reads as a header band.

**Fits 1280×720 with no vertical scroll.** Before this change the board screen
measured `scrollHeight` **777** at 1280×720 — it already scrolled. The fix is
scoped with `:has()`:

```css
@media (min-width: 900px) and (min-height: 560px) {
  body:not(.player-mode):has(#screen-board:not(.hidden)) { height: 100vh; display: flex; … }
}
```

so it only applies while the board is the live screen, only on host-sized
viewports, and never in phone mode. `main` → `#screen-board` → `.board-wrap` →
`.board` become a flex chain with `min-height: 0`, and the grid gets
`grid-auto-rows: minmax(0, 1fr)`. Clue rows drop their 76px floor; the category
strip keeps it so long names wrap instead of spilling. Because `.board-wrap`
already has `overflow-x: auto` its `overflow-y` computes to `auto` too, so even
a pathological board scrolls inside the wrap rather than scrolling the page.
Browsers without `:has()` drop the block and get the upstream (scrolling)
layout — a clean degradation.

### Scoreboard — podiums
`.podium` is now a plinth: a lit gold rail across the top, a blue-to-navy body
with an inset floor shadow, a squared-off base radius, an uppercase tracked
name in `--ink-mute`-weight ink and a 1.95rem Anton money figure with an
emboss. Negative scores go a lighter red (`#ff8f8f`) **and** keep the minus
sign, so colour is not the only signal. Hover lifts.

> **The one thing I could not do in CSS.** "The leader subtly lit" needs to
> know which score is the highest. `renderScoreboard()` in `js/app.js` puts no
> leader marker in the DOM (only `.negative`), and JS edits are forbidden for
> this game, and CSS cannot compare sibling values. The lit treatment is
> therefore applied where upstream *does* mark the leader: `.standings-list
> li.winner` on the Final Standings card (gold fill, gold border, gold halo).
> If the orchestrator wants a lit leader on the board scoreboard, it needs one
> line in `app.js` adding `is-leader` to the top podium; `gsc-look.css` can
> then style it with no further changes.

### Clue modal — category ribbon + big centred type
- The card is cut from the show blue (`#2431e6 → #060ce9 → #03076f`).
- `.clue-header` is now a full-width **ribbon** plate across the top of the
  card: dark navy, a 3px gold rule under it, category left in white Anton,
  value right in gold, both tracked.
- `.clue-text` grows to `clamp(1.6rem, 1.1rem + 2.7vw, 3.1rem)` — up from a
  2.6rem cap — centred, with a soft drop shadow.
- Judge chips sit on a darker well; the ✓/✗ buttons use deeper green/red.
- **Daily Double**: upstream paints `.dd-title` with a gradient clipped to the
  glyphs, which makes its computed `color` literally `transparent` (every DOM
  contrast sampler reads 1.05:1). It is now solid `--gold-text` with a
  three-layer emboss — the same look on screen, 6.6:1 when measured.

### Final Jeopardy + standings — the show's blue
`.final-card` now matches the clue card (show blue, gold rule under the
heading, white category, larger clue). Wager rows, judge rows and standings
rows sit on a dark inset well. The winner row is the lit gold card described
above.

### Question editor — a tidy form
The **Question Editor / Download JSON / Use in game / Close** row is now
`position: sticky; top: 0` with a solid backing and a shadow, so it stays put
while a long board scrolls under it (verified: header top stays at 0 with the
editor scrolled to 900px). Category blocks became cards with a gold left rail
and a lift shadow; the Final Jeopardy fieldset became a panel; all inputs
share one darker well and one gold focus ring.

### Phone — join card and the buzzer
- Join card and both player forms get the same lit panel treatment as the
  setup card; the room-code field is 68px tall, every input and button is
  `min-height: var(--tap)` = 56px.
- The buzz label grows to `clamp(2rem, 1.1rem + 7.2vw, 3.4rem)` (41px at
  320px wide) with wider tracking.
- **Deeper, more saturated stop/go.** `mode-reading` goes from upstream's pink
  `#ff6b6b` to `#e01b1b` under a bright dome (white 4.84:1); `mode-armed` goes
  from `#51d88a` to bottle green `#1faa5f` with dark ink (5.72:1);
  `mode-locked` `#4a0e0e` (12.5:1); `mode-won` `#1a5fe6` (5.49:1). The stop/go
  flip still reads as red → green for colourblind players, and the label always
  says which state it is.
- Under 360px the circle is capped at `min(84vw, 60vh)` so it never causes a
  horizontal scroll.

### Sampler-honest surfaces
A gradient set with the `background:` shorthand resets `background-color` to
transparent, so a DOM contrast sampler walks past the real surface up to the
page and reports nonsense (this bit the hub agent too). Section 10 of
`gsc-look.css` declares each gradient's mid tone as a flat `background-color`
underneath — invisible on screen, but it makes every sampled pair the true
pair. Applied to `.btn-gold`, `.buzzer-chip`, `.cell-clue(.used)`,
`.cell-category`, `.setup-card`, `.player-join`, `.player-form`, `.podium`,
`.clue-card`, `.final-card` and all five `.player-buzz-btn` modes.

### Motion
Three keyframes, all inside `@media (prefers-reduced-motion: no-preference)`:

| Keyframe | Where |
| --- | --- |
| `gsc-j-open` | `.clue-card` and `.final-card` open from the middle (`clip-path`) |
| `gsc-j-flip` | the category ribbon flips over on its top edge (`rotateX`) |
| `gsc-j-armed` | restates upstream's armed-buzzer pulse in the new green |

**Why the flip is on the ribbon and not the whole card.** photo-harness P14
measures `#clue-modal .modal-card` and `#judge-row` with
`getBoundingClientRect`. A `transform` on the card moves both rects while the
animation is in flight — and in a tab that is not compositing frames (which is
how the harnesses actually run here) a CSS animation never advances at all, so
the card would stay rotated 82° indefinitely and P14 would fail. `clip-path`
and a transform on the ribbon are both layout-neutral, so every geometry check
reads exactly the numbers it read before. This was found the hard way: the
first attempt animated `.clue-card` with `rotateX` and froze the card to a
53px-tall sliver.

## 4. Test results

Server: `python -m http.server 8676 --bind 127.0.0.1` from the repo root.

| Check | Before | After |
| --- | --- | --- |
| `cd games/jeopardy && node --test` | 49/49 pass, 0 fail | **49/49 pass, 0 fail** |
| `node --test` at repo root | — | **423/423 pass, 0 fail** |
| `games/jeopardy/tests/harness.html` | 70/70 | **70/70** |
| `games/jeopardy/tests/photo-harness.html` | 26/26 | **26/26** (P14 included) |
| `games/jeopardy/tests/gsc-embed-harness.html` | 9/9 | **9/9** |

All three harnesses were re-run after the last CSS edit.

## 5. Measurements

### Host, 1280×720

| Surface | Before | After |
| --- | --- | --- |
| Board screen `documentElement.scrollHeight` | **777** (scrolled) | **720** — `scrollWidth` 1280, no scroll either axis |
| Board at 1280×676 (the shell's play area) with 6 podiums | — | **676**, no scroll |
| Board geometry after | topbar 78 · board 511 · scoreboard 123 | topbar 69 · board 491 (category row 76, clue rows 73) · scoreboard 125 |
| Setup screen, no players | — | **721** (1px; setup is allowed to scroll per brief §1) |
| Setup screen, 2 players | — | 770 — the player list grows; scrolling here is explicitly allowed |
| Editor | sticky head verified: header `top` stays at 0 with the editor scrolled to 900px |

### Phone, 320×640

| Screen | `scrollWidth` × `scrollHeight` | Targets |
| --- | --- | --- |
| Join card (`?room=`) | **320 × 640** | room code 264×93, name 264×56, Join 264×56 — all ≥ 56px |
| Buzzer (armed) | **320 × 640** | buzz button 269×269, Leave room 122×56 |
| Buzzer (reading) | **320 × 640** | — |
| Wager form | **320 × 640** | input 264×56, Submit 264×56 |

No horizontal scroll on any phone screen.

### Contrast (computed from the live DOM, 4.5:1 threshold)

| Surface | Elements sampled | Worst real pair |
| --- | --- | --- |
| Setup screen | 22 | **7.29:1** — `.btn-gold` ink on gold |
| Board + open clue modal | 44 | **6.59:1** — `.clue-val` gold on show blue |
| Board tiles | — | 7.74:1 gold money on tile; 12.6:1 white category on header |
| Phone join / wager | 4–5 each | **7.29:1** — gold button ink |
| Phone buzzer, per mode | 5 | reading **4.84:1**, armed **5.72:1**, won **5.49:1**, idle/taken 12.41:1, locked 12.49:1 |
| Podium name / score | — | 10.87:1 / 12.48:1 |

Everything measured is ≥ 4.5:1. Two sampler notes for the tester:

1. `.cell-clue.used` reports 1.05:1 because upstream sets `color: transparent`
   to hide a played tile's value — there is no visible text, so it is not a
   real pair. Exclude it (or any element whose computed `color` alpha is 0).
2. In a browser pane that is not compositing frames, **CSS transitions freeze
   at their start value**, so `getComputedStyle(el).backgroundColor` on
   `.player-buzz-btn` can return the *previous* mode's colour after a class
   swap. Set `el.style.transition = "none"` before sampling, or force a paint.
   The numbers above were taken with transitions disabled.

### Reduced motion

`prefers-reduced-motion: reduce` cannot be emulated through the tools available
to this agent, so this was verified by walking every loaded stylesheet in the
live page (`document.styleSheets`, recursing into `CSSMediaRule`) and listing
every `@keyframes` and every rule that declares `animation`:

```
keyframes:
  buzzer-pulse   | buzzer.css                (upstream)
  buzzer-glow    | buzzer.css                (upstream)
  timer-flash    | timer.css                 (upstream)
  gsc-j-open     | gsc-look.css @media (prefers-reduced-motion: no-preference)
  gsc-j-flip     | gsc-look.css @media (prefers-reduced-motion: no-preference)
  gsc-j-armed    | gsc-look.css @media (prefers-reduced-motion: no-preference)

animation: declarations outside a no-preference block:
  .buzzer-armed-label                → buzzer-pulse   (buzzer.css)
  .player-buzz-btn.mode-armed        → buzzer-glow    (buzzer.css)
  .timer-bar.timer-done .timer-block → timer-flash    (timer.css)
  .player-buzz-btn.mode-armed        → none           (gsc-look.css, deliberate)

reduce overrides that neutralise all three upstream ones:
  buzzer.css @media reduce → .buzzer-armed-label, .player-buzz-btn.mode-armed { animation: none !important }
  timer.css  @media reduce → .timer-bar.timer-done .timer-block { animation: none }
```

So: **every animation this agent added is inside a `no-preference` block, and
all three pre-existing ones are explicitly set to `animation: none` under
`reduce`.** Under `reduce` no animation object is created anywhere and
`document.getAnimations()` is empty. In the default (no-preference) state,
`getAnimations()` was observed to return `[]` on the board and after the clue
and Final cards finish opening — nothing lingers.

### Keyboard

Tabbing from the top of the board screen reaches the top-bar buttons and then
every clue tile; the focused tile shows a 3px solid gold outline (inset 3px so
it sits inside the tile bevel) **plus** the gold ring from the focus box
shadow. `shared/theme.css` also contributes a global `:focus-visible` ring, so
controls that previously relied on the browser default now have the house ring.

### Static gates

- No `innerHTML` / `insertAdjacentHTML` / `outerHTML` / `document.write` /
  `eval` anywhere in the files this agent owns (nothing executable was added at
  all — the change is CSS plus two link tags).
- `games/jeopardy/css/gsc-look.css` is **734 lines**, under the 800-line house cap.
- `css/styles.css` is still 947 lines (unchanged, still over the upstream cap —
  not grown).

## 6. Notes for the orchestrator / UI tester

1. **No splash for Jeopardy.** `.gsc-splash` needs a `showSplash()` call and a
   markup node; both are JS/markup changes that brief §4 forbids for this game
   ("no JS edits beyond none"). The hub's own splash still fires on game switch
   before the iframe loads, which covers UI-8 for this surface.
2. **The lit leader on the board scoreboard is not implementable in CSS** — see
   §3. One line in `js/app.js` would unlock it.
3. `shared/theme.css` is now on Jeopardy's critical path (it `@import`s
   `theme-components.css`, so two extra chained requests). Locally that is
   noise; on GitHub Pages it is two cached files.
4. The board fit uses `:has()`. Chrome/Edge/Safari 15.4+/Firefox 121+ have it;
   older engines fall back to the upstream scrolling board rather than breaking.
5. When capturing "after" screenshots, note that the browser pane only paints
   on demand — take the screenshot twice, since the first one starts the paint
   and may catch a card mid-`clip-path`.


---

## v3 pass — "make it look real" (docs/21, design-system §0)

Date: 2026-11-03. CSS-first rework of Jeopardy's look against the v3
checklist. **No upstream JS or CSS file was edited**; everything is an
override in `css/gsc-look.css` (rewritten) and `css/gsc-extras.css`, plus
icon/toolbar work in our own `js/gsc-extras.js` and one `<!-- GSC: -->`
script tag for `shared/icons.js`. The v2 sheet is kept for reference at
`.scratch/jeopardy-gsc-look-v2.css`.

### What changed

- **Stage:** flat `color-mix(#2b34ff 5%, #0b0d12)`; upstream's radial body
  gradient, the topbar gradient and its gold rule are gone.
- **Board:** true board blue `#060ce9`, flat, black 6 px gutters, gold Anton
  money (6.6:1), categories white Inter 600 in source case (9.4:1); used
  tiles a flat dark navy; hover = a slightly brighter blue, no lift, no glow.
- **Clue / Final cards:** the same flat board blue, a white hairline under
  the category ribbon, Anton clue text in white, gold only on the dollar
  value and standings money. Judge chips are hairline outlines, ✓/✗ are
  6 px squares.
- **Surfaces:** one level — `#151820` + 10 % hairline + 8 px radius — for
  the setup card, podiums, editor categories, popover, dialog and phone
  cards. Setup sections, the buzzer-room block and the library picker are
  now hairline-divided areas inside that one surface, not nested panels.
- **Type:** a single `body *` reset forces Inter, no uppercase, no
  tracking, no text-shadow; Anton is re-allowed only on the heroes
  (`.setup-title`, `.buzzer-code`, `.cell-clue`, `.podium-score`,
  `.clue-val`, `.clue-text`, `.dd-title`, `.final-heading`,
  `.standings-score`, `.player-buzz-btn`). The phone code input keeps its
  tracking (the one allowed exception). The "This is…" kicker is hidden.
- **Buttons:** 6 px radius, 44 px (48 px `btn-big`) on host, 56 px on the
  phone, sentence case, 600. `.btn-gold` = flat accent `#2b34ff` + white
  (6.9:1); everything else is a hairline outline. One primary per screen:
  with a parked game, Resume is primary and Start becomes secondary; in the
  editor "Use in game" is primary and "Download JSON" secondary.
- **Toolbar (UI-12):** name (Inter 600 18 px) left; right: `Final Jeopardy`
  (game control, only on the board) · **Sound** · **Editor** · **Game
  lobby**, each with a `GSCIcons` icon beside its text. Sound is a new
  `#btn-sound` that drives `BuzzerHost.toggleSound()` and persists the
  hub-wide `gsc-sound` key; the buzzer panel's own emoji sound button is
  retired by CSS so there is exactly one toggle. Embedded, the standalone
  room chip is hidden (the shell bar carries it).
- **Phone:** flat discs per buzzer state — idle surface, reading red
  `#d92b2b` (white 4.9:1), armed green `#1e9e57` (dark ink 5.3:1), won blue
  `#1a5fe6` (white 5.5:1), locked dark red — no radial domes, no glow.
- **Motion:** only the clue/Final card reveal (clip-path, 300 ms, inside
  `no-preference`). The v2 ribbon flip and the armed-glow restatement are
  gone; upstream's armed pulse/glow are set to `animation: none` because
  they only animated a glow v3 removes. Timer flash at zero stays (it
  carries meaning).
- **Splash:** Jeopardy has no splash of its own — the game-switch card is
  the hub's (`js/hub-host.js`, already 600 ms plain). Nothing to change here.

### Checklist (design-system §0)

Tokens and stage
- [x] No local `--stage-glow`; `--accent*` declared once in gsc-look.css
      (Jeopardy's v2 pair kept, matching theme.css's jeopardy block).
      `data-gsc-game` is not on `<body>` — adding it is a markup hook beyond
      docs/02's allowed list; the stage tint is applied by token instead.
- [x] Body paints no gradient/spotlight/vignette.

Type
- [x] Anton only on heroes (audit: `antonNonHero` empty on every screen).
- [x] No uppercase / tracking outside the phone code input (audit empty).
- [x] Kicker removed; remaining headings name control groups.
- [x] No host text under 15 px except the 14 px score tip (audit
      `smallText` empty bar the collapsed crown glyph, see below).

Colour
- [x] Accent = primary buttons + active board hover only.
- [x] Gold only on money (board values, clue value, podium/standings money).
- [x] No text-shadow, no glow box-shadow (audit empty).

Surfaces
- [x] One level; no backdrop-filter (audit empty); no accent rails.

Buttons
- [x] 6 px, 44–48 px host / 56 px phone, sentence case, 600; no gradients.

Icons
- [~] Toolbar icons via `GSCIcons` (sound / sound-off, edit, lobby, play on
      Resume). **Residual upstream emoji** — see below.

Motion
- [x] Only the reveal; every animation this sheet adds is in no-preference;
      under `reduce` `document.getAnimations()` is `[]` with a clue open.

Toolbar / copy / gates
- [x] Order Sound · Editor · Game lobby on every screen, standalone and
      embedded. No tagline-speak added.
- [x] JS edits limited to icon insertion, the Sound control and toolbar
      order (all in our own gsc-extras.js).

### Verification

Run headless (Chrome over CDP, `node .scratch/cdp.mjs
.scratch/jeopardy-v3-check.mjs`; screenshots in `.scratch/jeopardy-ui/`)
against `http://127.0.0.1:8631/`.

| Gate | Result |
| --- | --- |
| `cd games/jeopardy && node --test` | **49/49** |
| `tests/gsc-embed-harness.html` | **18/18** |
| `tests/harness.html` | **70/70** |
| `tests/photo-harness.html` | **26/26** |
| Board 1280×720 | `scrollHeight 720 / innerHeight 720` — no scroll |
| Board 1280×676 (the iframe under the hub bar) | `676 / 676` — no scroll |
| Clue, Daily Double, Final wagers, standings, lobby dialog at 1280×720 | all `720 / 720` |
| Phone 320×640 | `scrollWidth 320`, no horizontal scroll; targets code 70 px, name 56, Join 56; buzzer disc 269 px |
| Contrast ≥ 4.5 (DOM sampler, every visible text node, alpha-blended bg) | **0 failures** on setup (25 nodes), board (42), clue (46), DD (47), Final (52), standings (54), dialog (47), editor (313), phone join and all five buzzer states |
| UI-11 backdrop-filter / text-shadow / gradient under text | **0** on every screen |
| UI-12 toolbar | board: `Final Jeopardy, Sound on, Question Editor, Game lobby`; setup: `Sound on, Question Editor`; embedded: `Sound on, Question Editor` (chip hidden) |
| Reduced motion | CSSOM: every keyframes / animation outside `no-preference` is upstream (`buzzer-pulse`, `buzzer-glow`, `timer-flash`) and each is set to `none` under `reduce` by upstream itself; live `getAnimations()` with a clue open = `[]` |

### Known gaps — UI-10 (emoji in host DOM text)

CSS cannot rewrite a text node, and this pass may not edit upstream JS, so
these upstream strings still put an emoji into host DOM text. Each is a
one-string change in an upstream file (not made, per the brief):

| String | Where | Seen | Mitigation now |
| --- | --- | --- | --- |
| `👑` leader rank | `app.js:935` | standings | glyph collapsed (`font-size:0`), a plain "1" drawn via `::before` — **visually fixed, DOM text remains** |
| `📷 Clue N images` | `editor.js:330` | editor | none (visible) |
| `🔔 Buzzers armed — Space locks`, `🔔 <name>` | `buzzer-host.js:694, 705` | clue bar, phones in room | none |
| `🚫 too soon: …` | `buzzer-host.js:671` | clue bar | none |
| `📱 <name> is wagering…` | `buzzer-wagers.js:204` | DD splash | none |
| `🔒 from phone` | `buzzer-wagers.js:364` | Final wagers | none |
| `<CODE> · N 🔔` | `buzzer-host.js:637` | standalone chip | hidden when embedded |
| `🔊 Sound on` / `🔇 Sound off` | `buzzer-host.js:618` | buzzer panel | **hidden** — replaced by toolbar Sound |
| `🟢` / `🔴` | `buzzer-host.js:606` | room roster | allowed (roster status dots) |

`✓ ✗ ✕ ⚠` are dingbats/symbols used as button glyphs and are left as is.
If the orchestrator authorises upstream string edits, the six "none" rows
are each a delete of the leading emoji plus a `GSCIcons.prepend` where an
icon helps; that would close UI-10 fully.

### Files

| File | Lines |
| --- | ---: |
| `games/jeopardy/css/gsc-look.css` (rewritten for v3) | 765 |
| `games/jeopardy/css/gsc-extras.css` | 102 |
| `games/jeopardy/js/gsc-extras.js` (+ Sound, icons) | 464 |
| `games/jeopardy/index.html` (+1 `<!-- GSC: -->` tag for icons.js) | 324 |

Helpers: `.scratch/jeopardy-v3-check.mjs`, `.scratch/jeopardy-v3-embedbar.mjs`,
`.scratch/jeopardy-v3-js.py`. No git commands.
