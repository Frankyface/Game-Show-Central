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
