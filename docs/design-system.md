# Design system v3 — Game Show Central

One broadcast package across the hub and every game. This is the reference the
game agents work from: every token and every component class, each with a
one-line usage example.

**Files**

| File | What it holds | Lines |
| --- | --- | --- |
| `shared/theme.css` | tokens, per-game accents, the stage, v1 utilities/`.btn`/`.field`, type utilities | 367 |
| `shared/theme-components.css` | the `.gsc-*` component kit (incl. the shared toolbar, §4b) + the motion vocabulary | 666 |

The hub's own sheets, for reference: `css/hub.css` (host screens),
`css/hub-art.css` (the CSS-drawn game art, one `--art` stack per registry id),
`css/hub-phone.css` (the phone controller).

`theme.css` starts with `@import url("theme-components.css")`, so **any page
that already links `shared/theme.css` gets the whole system with no markup
change**. You may also link the components sheet explicitly if you prefer one
fewer chained request:

```html
<link rel="stylesheet" href="../../shared/theme.css">
<link rel="stylesheet" href="../../shared/theme-components.css"><!-- optional -->
```

(The split exists only because the house rule caps files at 800 lines.)

**v2 is additive.** Every v1 token (`--ink`, `--ink-dim`, `--gold`,
`--stage-*`, `--radius`, `--duration`, `--ease-out`, `--tap`, …) and every v1
class (`.btn` family, `.field` family, `.hidden`, `.visually-hidden`,
`.error-msg`, `.hint-msg`) keeps its exact name and value. A game that changes
nothing renders as before, apart from a richer body stage and a shared focus
ring — both strict improvements.

---

## 0. v3: what changed (docs/21-ui-cleanup-brief.md)

The v2 look read as a generated mock-up: marquee bulbs, glowing gold, CSS-drawn
card art, emoji iconography, glass panels and shouty uppercase. **v3 keeps
every v1/v2 token and class name** — so no game breaks — and changes the
values to a quiet, editorial broadcast look. Where this document's later
sections still describe a v2 *look* (gradients, glow, uppercase, rails), v3
values now apply; the class names and examples remain valid.

| Area | v2 | v3 |
| --- | --- | --- |
| Stage | layered radial spotlight + accent bloom + vignette | flat: `color-mix(--accent 5%, #0b0d12)` (`--stage-base`), nothing else |
| Surfaces | translucent glass, 12 px blur, accent rails, nested panels | **one** flat level: `--surface #151820`, 1 px `--hairline` (10 % white), 8 px radius, no blur, no rails |
| Type | Anton uppercase with tracking on titles, labels, buttons | Anton only for the **one hero** per screen (game name, money, room code), source case, no tracking; everything else Inter 400/500/600, sentence case |
| Eyebrows | "WELCOME TO", "SURVEY SAYS…" on every panel | removed; `.gsc-eyebrow` is now a quiet sentence-case group label |
| Buttons | gradient fill, glow, uppercase, pill-ish | 6 px radius, 44–48 px host / 56 px phone, sentence case 600; primary = flat accent + `--accent-ink`, secondary = hairline outline, danger = red outline |
| Gold | the hub's accent, titles, buttons | **money only** (`--gold*` unchanged in value) |
| Focus | gold ring | `--focus #9ec1ff`, 2 px |
| Icons | emoji | `shared/icons.js` (`GSCIcons`) inline SVG, 1.5 px stroke, `currentColor` |
| Motion | hover lifts, shimmer, idle pulses, marquee chase, splash glow | only motion that carries meaning (flip, reveal, clock, reconnect dot); `gsc-glow/-shimmer/-pulse/-bulbs-*` keyframes kept as **no-ops** |
| Splash | 600 ms, glowing hero, kicker + tagline | **600 ms** plain card: the name in Anton + one accent rule on the flat stage |
| `.gsc-marquee`, `.gsc-sheen` | running bulbs, light sweep | render nothing (names kept) |

**New tokens:** `--surface`, `--hairline`, `--stage-base` (and `--radius-sm`
is now the 6 px control radius). **Changed values, same names:** `--panel`
(= `--surface`, opaque), `--panel-strong`, `--panel-line` (= `--hairline`),
`--panel-blur: 0`, `--radius`/`--radius-lg`/`--radius-xl: 8px`,
`--shadow-*: none`, `--ink*` (neutral greys, not lavender), `--fs-*` (calmer
scale; `--fs-title` is Inter-sized), `--track-*: 0`, `--focus`. The v1
`.btn` family in `shared/theme.css` now has the v3 look too, so **every game
that uses `.btn` changes on its own** — `.btn-gold` is the primary button and
fills with the game's **accent**, not gold.

**Contrast:** `--ink` 16.7:1 on the stage, `--ink-dim` 8.0:1 and `--ink-mute`
5.6:1 on a surface, every `--accent-ink` ≥ 4.6:1 on its accent. The hub's own
accent moved from gold to `#2f5fe0` (white ink 5.5:1).

### `shared/icons.js` — `GSCIcons`

```html
<script src="../../shared/icons.js"></script>
```

```js
const svg = GSCIcons.make("sound");              // <svg class="gsc-icon gsc-icon-sound"> 18 px
GSCIcons.make("undo", { size: 16 });             // 12–32, clamped
GSCIcons.make("lock", { label: "Locked" });      // only when no text label sits beside it
GSCIcons.prepend(button, "sound-off");           // put it before the label; replaces a previous one
GSCIcons.decorate();                             // every [data-gsc-icon="undo"] gets its icon (auto on load)
GSCIcons.names();                                // the registry
```

Icons: `sound`, `sound-off`, `settings`, `back`, `undo`, `lobby`, `edit`,
`phone`, `check`, `cross`, `play`, `pause`, `chevron-down`, `copy`, `lock`.
A 24-unit grid, 1.5 px stroke, round caps/joins, no fill, `currentColor`,
`aria-hidden` by default (the button's text carries the meaning). Built with
`createElementNS`; an unknown name returns `null` and warns. **Icons go
beside a text label, never instead of one** on host toolbars (rule 9). If
your JS re-sets a button's `textContent`, call `GSCIcons.prepend` again
afterwards. Tested in `tests/icons.test.mjs`.

### One bar, one vocabulary (cross-game consistency pass)

Fifteen games once had fifteen toolbars. Now there is one, and it lives in
`shared/theme-components.css` §4b. Its rules carry a `body` prefix, which
puts them above a game's own `.topbar .btn` rules. A game's
`body.player-mode …` rules still win.

```html
<header class="topbar gsc-toolbar">
  <h1 id="xx-title" class="topbar-title gsc-toolbar-title">Family Feud</h1>
  <div class="topbar-actions gsc-toolbar-actions">
    <span id="xx-room-chip" class="room-chip hidden"></span>   <!-- standalone only -->
    <button id="btn-sound" class="btn btn-ghost gsc-toolbar-btn" type="button" aria-pressed="true">Sound</button>
    <button id="btn-editor" class="btn btn-ghost gsc-toolbar-btn" type="button">Editor</button>
    <button id="btn-game-lobby" class="btn btn-ghost gsc-toolbar-btn" type="button">Game lobby</button>
  </div>
</header>
```

| Part | Measure |
| --- | --- |
| Bar (`.gsc-toolbar`) | 56 px tall (`box-sizing: border-box`), full page width, 16 px inline padding, 16 px gap, 1 px `--hairline` bottom rule. No fill of its own: the game's flat stage shows through. |
| Game name (`.gsc-toolbar-title`) | Inter 600, 18 px, `--ink`, left edge 16 px from the viewport, one line with ellipsis |
| Actions (`.gsc-toolbar-actions`) | pushed right (`margin-left: auto`), 8 px gap, no wrap. Last button 16 px from the right edge. |
| Button (`.gsc-toolbar-btn`) | 44 px tall, 0 14 px padding, Inter 600, 15 px, sentence case. Hairline outline (22 % white), 6 px radius. Icon (18 px `GSCIcons`) and label with an 8 px gap. Disabled is shown at 45 % opacity, never hidden. |

**What may sit in the bar:**
- The game name.
- The standalone room chip.
- Sound, Editor, Game lobby, in that order.

**What must not:**
- A primary-styled button. Jeopardy's Final Jeopardy now lives on the board screen.
- A subtitle or set name. Krillion's "Deep Dive · prompt 1 of 7" is already on each screen's own round line.
- Any game control (Undo, End game, New game).

**Labels: one vocabulary in every game.** The bar always shows the plain
registry name (`js/hub-registry.js`). A loaded set's title may appear on the
setup screen only.

| Control | Label | Icon | State rule |
| --- | --- | --- | --- |
| Bar title | Registry name ("Family Feud", "Jeopardy", "Deal or No Deal", "Millionaire", …), never "— Game Night" or a set title | — | static |
| Sound toggle | **Sound** when on, **Sound off** when muted | `sound` / `sound-off` | `aria-pressed` mirrors on/off |
| Editor | **Editor** (not "Question editor", "Board editor", "Prompt editor") | `edit` | Always present. Deal or No Deal disables it mid-game, because a board swap would drop the game. |
| Game lobby | **Game lobby** | `lobby` | always present; **disabled** while no game is in progress |
| End the game (play screens) | **End game** (not "End the night" / "End the game"). Millionaire adds what it banks: "End game (banks $200)". | — | Weakest Link's **End round** is a different action, so it keeps its name. |
| Undo (play screens) | **Undo**, optionally with its key hint | `undo` (markup: `data-gsc-icon="undo"`, drawn by `GSCIcons.decorate()`) | — |
| Connection status (rosters, buzzer panel) | a CSS dot (`.gsc-status-dot`, filled = connected, hollow red ring = away) plus the word **Connected** / **Away** (visually hidden in rosters) | — | never an emoji |

**Action rows and badges.**
- Every host button is at least 44 px tall and 15 px. `.btn` and `.btn-small` are now 44 px, and `.gsc-btn-sm` is 44 px too.
- In a `.controls` footer every button is 48 px, so a row never mixes sizes.
- A disabled primary (`.btn-gold:disabled`, `.gsc-btn-primary:disabled`) is drawn as a disabled outline, so a row never shows two filled buttons.
- `.gsc-badge` is a flat label: hairline outline, no fill, 15 px.
- `.gsc-chip`, `.gsc-kbd` and `.gsc-podium-note` are 14 px, the floor for tags and labels.
- Nothing is a pill.

**Hub card accents.** The `accent` of each registry entry equals that game's
`--accent` in `shared/theme.css`. `tests/registry-accent.test.mjs` fails if
the two ever drift.

### Per-game checklist (tick every line; docs/21 §2)

Copy this list into your report and tick it.

**Tokens and stage**
- [ ] `<body data-gsc-game="<id>">`; no local `--accent*` / `--stage-glow` overrides.
- [ ] Your `body` paints no radial/linear gradient, spotlight or vignette; delete
      your `body { background: … }` or set it to `var(--stage-bg)`.
- [ ] `--stage-deep` / `--stage-night` in your `:root` may stay, but nothing
      paints a gradient from them.

**Type (rule 1)**
- [ ] Anton appears for **one** hero per screen only (game name / money / room
      code); everything else is Inter 400/500/600.
- [ ] No `text-transform: uppercase` and no `letter-spacing` > 0 outside that
      hero (the phone room-code input is the one allowed exception).
- [ ] Decorative eyebrows deleted ("SURVEY SAYS…", "BIG MONEY, BIG PRIZES…",
      "TONIGHT'S TEAM PLAYS FOR…"); a label stays only when it names a control group.
- [ ] Body text ≥ 16 px, controls ≥ 15 px.

**Colour (rule 2)**
- [ ] The accent is used for exactly: the active state, the primary button, one
      rule or underline.
- [ ] Gold (`--gold*`) only on money amounts.
- [ ] No `text-shadow`, no glow `box-shadow`, no neon.

**Surfaces (rule 3)**
- [ ] One panel level (`var(--surface)` + `1px solid var(--hairline)` + `var(--radius)`).
- [ ] No `backdrop-filter`, no translucent panel inside a panel, no accent rails
      (`border-left/top: Npx solid var(--accent)` on panels).
- [ ] Dividers are `var(--hairline)`.

**Buttons (rule 4)**
- [ ] 6 px radius, 44–48 px tall on host, 56 px on phones, sentence case, 600.
- [ ] Primary = accent fill + `--accent-ink`; secondary = hairline outline; danger = red outline.
- [ ] No gradient fill, no glow, no uppercase in any button rule.

**Icons (rule 5)**
- [ ] Zero emoji in host-screen DOM text (titles, toolbars, chips, buttons,
      banners). Emoji only in player avatars (phones, rosters).
- [ ] Where an icon helps, `GSCIcons.make/prepend` beside a text label.

**Motion (rule 8)**
- [ ] Only meaningful motion remains (reveal/flip, wheel spin, case open, clock).
- [ ] No hover lifts (`translateY` on `:hover`), shimmer, idle pulses, splash glow.
- [ ] Every `@keyframes` and `animation:` sits inside
      `@media (prefers-reduced-motion: no-preference)`; `getAnimations()` is
      empty under `reduce`.
- [ ] The game-switch splash is the 600 ms plain card (copy `showSplash()` from
      `js/hub-host.js`: `SPLASH_MS = 600`, sub line empty, no kicker).

**Host toolbar (rule 9)**
- [ ] One bar: game name (Inter 600, 18 px) on the left; on the right, in this
      order: **Sound**, **Editor**, **Game lobby** — icon + text label each.
      Use the shared `.gsc-toolbar` classes and the label table above; no
      per-game toolbar geometry.
- [ ] Embedded (`body.gsc-embedded`): nothing else in the bar (the hub's shell
      bar already carries Lobby and the room chip).

**Copy (rule 10)**
- [ ] No tagline-speak in chrome. Each setup screen has one plain sentence that
      says what to do next. Error messages unchanged.

**Gates (docs/21 §3)**
- [ ] JS edits limited to class names, `GSCIcons` insertion and toolbar order.
- [ ] Unit tests and `tests/harness.html` green before and after.
- [ ] Host fits 1280×720 and 1280×676 (inside the hub bar) with no vertical
      scroll in play; phone 320×640 no horizontal scroll, targets ≥ 56 px.
- [ ] Contrast ≥ 4.5:1 (sample the DOM); every file < 800 lines.
- [ ] UI-10 no emoji outside roster/avatar elements; UI-11 no `backdrop-filter`,
      `text-shadow` glow or gradient under text; UI-12 toolbar order as above.

## 1. Tokens

### 1.1 Stage (a game overrides the v1 ones in its own `:root`)

| Token | Value (hub) | Example |
| --- | --- | --- |
| `--stage-deep` | `#150a2c` | `:root { --stage-deep: #071634; }` — the top of your stage |
| `--stage-night` | `#05010e` | `:root { --stage-night: #04091c; }` — the bottom |
| `--stage-card` | `#1b0c33` | `background: var(--stage-card);` on an opaque card |
| `--stage-glow` | `#33124f` | set per game in `theme.css`; the colour spilling from the top |
| `--stage-accent` | `#e23c50` | v1 accent, still read by existing game sheets |
| `--stage-bg` | *(computed on `body`)* | `.overlay { background: var(--stage-bg); }` — reuse the exact stage |

`body` already paints `--stage-bg`: a top glow, an off-axis accent bloom, a
vignette and the deep→night base, all gradients (no filters). To restyle a
game's stage, set `--stage-deep` / `--stage-night` in your `:root` and let the
shared body rule do the rest.

### 1.2 Ink

| Token | Value | Example |
| --- | --- | --- |
| `--ink` | `#f4f5ff` | `color: var(--ink);` — primary copy (17.9:1 on the stage) |
| `--ink-dim` | `#aab0e0` | `color: var(--ink-dim);` — secondary copy (9.3:1) |
| `--ink-mute` | `#8b91c4` | `color: var(--ink-mute);` — eyebrows, chips, metadata (6.4:1) |
| `--ink-faint` | `rgba(170,176,224,.45)` | `border-color: var(--ink-faint);` — never for text |

### 1.3 Accent (per game, keyed on `data-gsc-game`)

| Token | Example |
| --- | --- |
| `--accent` | `border-left: 6px solid var(--accent);` |
| `--accent-2` | `background: linear-gradient(90deg, var(--accent), var(--accent-2));` |
| `--accent-ink` | `color: var(--accent-ink);` — the readable text colour *on* `--accent` |

The map lives in `shared/theme.css` and is keyed on the **attribute**, not on
`body`, so a sub-tree can wear another game's accent (the hub's shell bar and
splash card do exactly that):

| `data-gsc-game` | `--accent` | `--accent-2` | `--stage-glow` |
| --- | --- | --- | --- |
| `hub` | `#2f5fe0` | `#8fb0ff` | — (v3: flat) |
| `jeopardy` | `#2b34ff` | `#ffcc4d` | `#0a1158` |
| `family-feud` | `#e21b3c` | `#ffcc4d` | `#10306b` |
| `wheel-of-fortune` | `#9d4edd` | `#2ec4b6` | `#3d1268` |
| `weakest-link` | `#7c99b6` | `#d33` | `#16222e` |
| `millionaire` | `#3346c8` | `#a06bff` | `#141c63` |
| `price-is-right` | `#e63946` | `#ffd23f` carnival yellow | `#123a86` carnival blue |
| `pyramid` | `#f4b400` | `#2ec4b6` | `#0b3b3c` deep teal |
| `deal-or-no-deal` | `#b5121b` | `#f2c14e` case gold | `#4a0810` |
| `password` | `#f2c94c` gold | `#7aa2ff` | `#0d1b4b` midnight blue |
| `chain-reaction` | `#ff2e88` hot pink | `#4d7bff` | `#10276e` |
| `the-chase` | `#d10000` chaser red | `#6aa8ff` contestant blue | `#04143a` |
| `one-vs-100` | `#19c9ff` electric cyan | `#ffcc4d` bank gold | `#062a3d` |
| `press-your-luck` | `#ff3ea5` hot pink | `#ffe14d` | `#2a0b45` deep purple |
| `match-game` | `#ff8c1a` 70s orange | `#e6b800` mustard | `#3b1f0e` chocolate |
| `krillion` | `#2ee6c5` teal | `#ff6b57` coral | `#03111f` |

```html
<body data-gsc-game="family-feud">          <!-- whole page wears Feud red -->
<div class="gsc-splash" data-gsc-game="jeopardy">  <!-- one node wears Jeopardy blue -->
```

`--accent-ink` is the readable text colour on that accent, so it is not always
white: on Price Is Right's `#e63946` white reaches only 4.2:1, so that block
uses a near-black `#1a0206` (4.8:1); Pyramid's and Password's gold use
`#241a02` (9.3:1 / 10.8:1); Chain Reaction's hot pink takes `#2a0213` (5.4:1)
because white on it is only 3.5:1. Check any accent you change with a contrast
calculator before you ship it. Of the fourteen, only Jeopardy, Family Feud,
Wheel of Fortune, Weakest Link, Millionaire, Deal or No Deal and The Chase take
white ink; the seven bright accents all take a near-black.

One accent is deliberately below 4.5:1 against the stage: The Chase's
`#d10000` measures 3.4:1. It is a **fill** colour — rails, bars, markers,
buttons with `--accent-ink` white on top (5.7:1) — and clears the 3:1
threshold that applies to non-text. Never set it as a text colour directly;
`color-mix(in srgb, var(--accent) 60%, var(--ink))` is how the shell bar
lightens an accent for type.

`--accent-2` is a *UI* colour and sometimes has to be a lifted version of a
brand colour: Chain Reaction's electric blue `#0f3bd9` measures 2.5:1 on the
stage and is unreadable as ink, so `--accent-2` is `#4d7bff` (5.2:1). Use the
brand `#0f3bd9` as a background fill — white on it is 7.9:1 — not as a
foreground.

Set your own accents by editing that block in `shared/theme.css`, **not** in
your game's `:root` (a `:root` declaration sets the value on `<html>` and the
`[data-gsc-game]` rule on `<body>` would shadow it).

### 1.4 Signal colours (never overridden)

`--gold #ffcc4d` · `--gold-deep #d9a437` · `--gold-text #ffd35e` ·
`--red #ff6b6b` · `--green #51d88a` · `--amber #ffb347`

```css
.score-up { color: var(--green); }   /* plus an arrow — colour is never the only signal */
```

### 1.5 Glass and shape

| Token | Value | Example |
| --- | --- | --- |
| `--panel` | `rgba(255,255,255,.06)` | `background: var(--panel);` |
| `--panel-strong` | `rgba(255,255,255,.10)` | `background: var(--panel-strong);` — the panel in focus |
| `--panel-line` | `rgba(255,255,255,.12)` | `border: 1px solid var(--panel-line);` |
| `--panel-blur` | `12px` | `backdrop-filter: blur(var(--panel-blur));` |
| `--well` | `rgba(0,0,0,.28)` | `background: var(--well);` — an inset row inside a panel |
| `--line` | `rgba(170,176,224,.25)` | v1 hairline, still valid |
| `--radius-sm / --radius / --radius-lg / --radius-xl / --radius-pill` | `6 / 10 / 18 / 26 / 999px` | `border-radius: var(--radius-lg);` |
| `--shadow-panel` | `0 18px 44px rgba(0,0,0,.45)` | `box-shadow: var(--shadow-panel);` |
| `--shadow-lift` | `0 22px 56px rgba(0,0,0,.55)` | `box-shadow: var(--shadow-lift);` — hovered/raised |
| `--shadow-inset` | `inset 0 1px 0 rgba(255,255,255,.1)` | `box-shadow: var(--shadow-panel), var(--shadow-inset);` |
| `--tap` | `56px` | `min-height: var(--tap);` — every phone target |

### 1.6 Type

| Token | Range | Example |
| --- | --- | --- |
| `--fs-hero` | 64 → 140px | `font-size: var(--fs-hero);` — the room code, a splash title |
| `--fs-display` | 40 → 72px | `font-size: var(--fs-display);` — a question, a money value |
| `--fs-title` | 28 → 40px | `font-size: var(--fs-title);` — a panel heading |
| `--fs-body` | 18 → 22px | `font-size: var(--fs-body);` — projector body copy |
| `--fs-ui` | 15 → 17px | `font-size: var(--fs-ui);` — controls and forms |
| `--fs-micro` | 12px | `font-size: var(--fs-micro);` — eyebrows only |
| `--font-display` | Anton + fallbacks | `font-family: var(--font-display);` |
| `--font-ui` | Inter + system stack | `font-family: var(--font-ui);` |
| `--track-display` | `-0.015em` | `letter-spacing: var(--track-display);` — always with Anton |
| `--track-eyebrow` | `0.22em` | `letter-spacing: var(--track-eyebrow);` |

Ready-made classes: `.gsc-hero`, `.gsc-display`, `.gsc-title` (Anton, uppercase,
tight), `.gsc-eyebrow`, `.gsc-body`, `.gsc-dim`, `.gsc-mute`.

```html
<p class="gsc-eyebrow">Round 3</p>
<h2 class="gsc-display">Survey says…</h2>
```

### 1.7 Motion

| Token | Value | Example |
| --- | --- | --- |
| `--dur-fast` | `120ms` | `transition: background-color var(--dur-fast) var(--ease-out);` |
| `--dur` | `220ms` | `transition: transform var(--dur) var(--ease-out);` |
| `--dur-slow` | `480ms` | `transition: transform var(--dur-slow) var(--ease-out);` — a tile flip |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | the default |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | `animation: gsc-pop var(--dur) var(--ease-spring);` |
| `--duration` | `180ms` | v1, still valid |

Keyframes (all defined inside `@media (prefers-reduced-motion: no-preference)`):

| Keyframe | Example |
| --- | --- |
| `gsc-pop` | `animation: gsc-pop var(--dur) var(--ease-spring) both;` — a score landing |
| `gsc-flip` | `animation: gsc-flip var(--dur-slow) var(--ease-out) both;` — a board tile |
| `gsc-glow` | `animation: gsc-glow 5s ease-in-out infinite;` — a decorative halo layer |
| `gsc-shimmer` | `animation: gsc-shimmer 5.5s var(--ease-out) infinite;` — a light sweep |
| `gsc-rise` | `animation: gsc-rise var(--dur) var(--ease-out) both;` — a panel arriving |
| `gsc-pulse` | `animation: gsc-pulse 3.2s ease-in-out infinite;` — "it's your turn" |
| `gsc-dot` | `animation: gsc-dot 1.1s ease-in-out infinite;` — a working status dot |
| `gsc-bulbs-a` / `gsc-bulbs-b` | used by `.gsc-marquee`; a chasing bulb pair |
| `gsc-splash-in` / `gsc-splash-title` | used by `.gsc-splash` |

> **The motion rule.** Put every `@keyframes` **and** every `animation:`
> declaration inside `@media (prefers-reduced-motion: no-preference)`. Then
> under `reduce` no animation exists at all and `document.getAnimations()` is
> empty (verification UI-4). The v1 `animation-duration: .001ms !important`
> block is only a safety net for sheets that have not been converted.

```css
@media (prefers-reduced-motion: no-preference) {
  .feud-strike { animation: gsc-pop var(--dur) var(--ease-spring) both; }
}
```

---

## 2. Components

Every class is prefixed `gsc-` and styles nothing else, so adopting one is
always opt-in.

### Surfaces

| Class | One-line example |
| --- | --- |
| `.gsc-panel` | `<section class="gsc-panel">` — the standard glass panel |
| `.gsc-panel-strong` | `<section class="gsc-panel gsc-panel-strong">` — the panel in play |
| `.gsc-panel-accent` | `<section class="gsc-panel gsc-panel-accent">` — the one panel that matters most |
| `.gsc-card` | `<article class="gsc-card">` — a panel with padding built in |
| `.gsc-card-interactive` | `<li class="gsc-card gsc-card-interactive">` — lifts and lights on hover |
| `.gsc-well` | `<li class="gsc-well">` — an inset row inside a panel |
| `.gsc-rule` | `<hr class="gsc-rule">` — a hairline that fades at both ends |
| `.gsc-scroll` | `<ul class="gsc-scroll">` — scrolls inside a fixed-height panel, thin scrollbar |
| `.gsc-sheen` | `<div class="gsc-tile-face gsc-sheen">` — one slow light sweep; one per screen |

### Buttons

| Class | One-line example |
| --- | --- |
| `.gsc-btn` | `<button class="gsc-btn" type="button">Undo</button>` |
| `.gsc-btn-primary` | `<button class="gsc-btn gsc-btn-primary">Start</button>` — accent-filled |
| `.gsc-btn-ghost` | `<button class="gsc-btn gsc-btn-ghost">Skip</button>` |
| `.gsc-btn-danger` | `<button class="gsc-btn gsc-btn-danger">Strike</button>` |
| `.gsc-btn-big` | `<button class="gsc-btn gsc-btn-primary gsc-btn-big">Reveal</button>` (58px) |
| `.gsc-btn-sm` | `<button class="gsc-btn gsc-btn-sm">Rename</button>` (32px) |
| `.gsc-btn-tap` | `<button class="gsc-btn gsc-btn-primary gsc-btn-tap">Buzz</button>` (56px, phones) |
| `.gsc-btn-block` | `<button class="gsc-btn gsc-btn-block">Join</button>` |
| `.gsc-btn-icon` | `<button class="gsc-btn gsc-btn-icon" aria-label="Sound">🔊</button>` |

### Chips, badges, keys, status

| Class | One-line example |
| --- | --- |
| `.gsc-chip` | `<li class="gsc-chip">fast money</li>` |
| `.gsc-chip-accent` | `<button class="gsc-chip gsc-chip-accent">Copy link</button>` |
| `.gsc-badge` | `<span class="gsc-badge">$800</span>` |
| `.gsc-kbd` | `<kbd class="gsc-kbd">B</kbd>` — a keyboard shortcut in help copy |
| `.gsc-pill-status` | `<span class="gsc-pill-status is-on">Connected</span>` (`is-on` / `is-off` / `is-busy`) |

`is-on` is a filled dot, `is-off` a hollow ring, `is-busy` blinks — the state
reads without colour.

### Show furniture

| Class | One-line example |
| --- | --- |
| `.gsc-banner` | `<div class="gsc-banner"><p class="gsc-banner-title">Face-off</p><p class="gsc-banner-sub">Buzz in</p><div class="gsc-banner-end">…</div></div>` |
| `.gsc-podium` | `<div class="gsc-podium is-active"><span class="gsc-podium-name">Team Red</span><span class="gsc-podium-score">240</span><span class="gsc-podium-note">2 strikes</span></div>` (`is-active` / `is-out`) |
| `.gsc-lozenge` | `<div class="gsc-lozenge gsc-lozenge-accent">Movie quotes</div>` — hex end caps via `clip-path`; `.gsc-lozenge-sm` for a category strip |
| `.gsc-tile` | `<div class="gsc-tile is-flipped"><div class="gsc-tile-inner"><div class="gsc-tile-face">$400</div><div class="gsc-tile-face gsc-tile-back">Answer</div></div></div>` (`.gsc-tile-empty` for a used cell) |
| `.gsc-timer` | `<div class="gsc-timer is-urgent"><i class="gsc-timer-block is-lit"></i>…<span class="gsc-timer-label">07</span></div>` |
| `.gsc-marquee` | `<section class="landing-card gsc-marquee">` — running bulbs on all four edges, CSS only |
| `.gsc-splash` | see §3 |

`.gsc-timer-block` honours a game's existing `--timer-lit`, `--timer-off-bg`,
`--timer-off-shadow`, `--timer-lit-glow` if they are defined, so a game can drop
`.gsc-timer` in and keep its own colour.

### Overlays

| Class | One-line example |
| --- | --- |
| `.gsc-toast` | `<p class="gsc-toast gsc-toast-good">Saved</p>` (`-danger` / `-good`) |
| `.gsc-modal-backdrop` | `<div class="gsc-modal-backdrop">…</div>` |
| `.gsc-modal` | `<div class="gsc-modal" role="dialog" aria-modal="true"><h2 class="gsc-modal-title">Leave?</h2><p class="gsc-modal-body">…</p><div class="gsc-modal-actions">…</div></div>` |

---

## 3. Library picker (`shared/library.js` + `.gsc-library`)

Every game ships `games/<id>/sets/index.json`, a manifest of the extra content
files committed beside it (docs/19 §2, docs/00-architecture.md §9.12). One
shared module reads it and mounts one shared picker, so all fourteen games get
the same control:

```html
<script src="../../shared/library.js"></script>
```

```js
GSCLibrary.mountPicker(document.getElementById("questions-library"), {
  gameDir: "",                       // "" = this game's own folder
  validate: validateChase,           // the game's existing validator
  onPick(json, meta) { useContent(json, `set: ${meta.name}`); },
});
```

### The manifest

`sets/index.json` is a plain array (an object with a `sets` array is also
accepted). At most **50** entries are kept; junk rows are dropped, not fatal.

```json
[{ "file": "kids.json", "name": "Kids' night",
   "description": "Nothing after 2005.", "by": "GSC",
   "counts": { "rounds": 3, "questions": 30 } }]
```

- `file` — **required**, a bare `*.json` name that sits in `sets/`. No slashes,
  no `..`, no query, no scheme; anything else drops the row.
- `name` — capped at 60 characters; falls back to the file's stem.
- `description` — capped at 200. `by` — capped at 60. Both optional.
- `counts` — optional flat map of label → number; up to 6 are shown in Preview.

### The API

All three calls **resolve, never reject and never throw**, because a page
opened from disk and a game with no `sets/` folder are normal states.

| Call | Resolves to |
| --- | --- |
| `GSCLibrary.load(gameDir)` | `{ ok: true, sets, url }` or `{ ok: false, error, url }` |
| `GSCLibrary.fetchSet(gameDir, file)` | `{ ok: true, json, url }` or `{ ok: false, error, url }` |
| `GSCLibrary.mountPicker(container, options)` | returns `{ el, ready, destroy() }` synchronously; `ready` is the `load()` result |

`gameDir` is a path prefix: `""`, `"."` and `"games/x"` all work; the module
adds the single slash. Both fetches use `cache: "no-store"`.

`mountPicker` options: `gameDir`, `onPick(json, meta)`, `validate` (optional),
`label` (optional, default "Saved sets"), `fetch` (optional, tests only).

`validate` may **throw**, return a **string** error, return `{ok:false,error}`
or return `false`. Anything else — `true`, `undefined`, an object — passes. On
a rejection the message lands in the picker's error line and `onPick` is never
called.

### What it renders

`.gsc-library` — a well with an accent rail holding `.gsc-library-label`
(a `<label>` bound to the select), `.gsc-library-row` (`.gsc-library-select` +
a `.gsc-btn.gsc-btn-primary.gsc-library-load` "Load set" button),
`.gsc-library-preview` (`role="status"`: name — by — description — counts) and
`.gsc-library-error` (`role="alert"`). On a phone the select and the button
each go full width at `--tap` height.

When the manifest cannot be fetched — `file://`, or no `sets/` folder yet — the
label, row and preview get `.hidden`, the box gets `.gsc-library-off`, and the
error line carries a plain-English sentence. Nothing else on the setup screen
changes, so a game that ships no sets simply shows a one-line note.

## 4. The splash (`.gsc-splash`)

A 600 ms plain title card on a game switch, on the host screen and on every phone.

```html
<div id="gsc-splash" class="gsc-splash hidden" role="status" aria-live="polite">
  <p class="gsc-splash-kicker">Game Show Central presents</p>
  <p id="gsc-splash-title" class="gsc-splash-title">Millionaire</p>
  <div class="gsc-splash-rule"></div>
  <p id="gsc-splash-sub" class="gsc-splash-sub">Fifteen questions. One hot seat.</p>
</div>
```

Rules the hub follows and games should copy:

- `pointer-events: none` — it can never swallow a click, even if a timer is lost.
- Show it by removing `.hidden`, hide it 600 ms later. Nothing waits on it and
  no message is delayed by it.
- **Skip it entirely** when `matchMedia("(prefers-reduced-motion: reduce)").matches`.
- Put the game id on the node (`data-gsc-game="millionaire"`) so the card wears
  that game's accent.

The hub's implementation is `showSplash()` in `js/hub-host.js` and
`js/hub-player.js` — ~14 lines, copy it.

---

## 5. Adopting v2/v3 in three steps (then run the §0 checklist)

1. **Link the theme and name your game.**
   `<link rel="stylesheet" href="../../shared/theme.css">` and
   `<body data-gsc-game="<registry id>">`. You now have the layered stage, your
   accent, the type scale, the motion vocabulary and the whole `.gsc-*` kit.
   Delete any `--stage-*` / radius / duration / font values you were
   re-declaring; keep only the `--stage-deep` / `--stage-night` (and any
   game-specific colours) you actually override.

2. **Swap the furniture, class by class.** Phase text → `.gsc-banner`.
   Score panels → `.gsc-podium` (+ `is-active` / `is-out`). Countdown →
   `.gsc-timer`. Board cells → `.gsc-tile`. Category / question plates →
   `.gsc-lozenge`. Dialogs → `.gsc-modal`. Capability and metadata text →
   `.gsc-chip`. 🟢/🔴 lines → `.gsc-pill-status`.
   Buttons: add `gsc-btn` (+ a variant) **alongside** the existing `btn`
   classes — never remove a class a script or a harness selects on. If you
   would rather not touch markup at all, alias in your own sheet the way
   `css/hub.css` does (`.btn { …the .gsc-btn declarations… }`); your sheet loads
   after the theme, so it wins.

3. **Add the splash and re-check the four gates.** Copy `showSplash()`, then:
   `node --test` green · host screen fits 1280×720 with no vertical scroll ·
   phone at 320×640 with no horizontal scroll and every target ≥ 56 px ·
   every `animation:` and `@keyframes` you added sits inside
   `@media (prefers-reduced-motion: no-preference)`.

### Things not to do

- Don't put a `backdrop-filter` or a `filter` on a full-screen element — glass
  is for panels. Bake glows into gradients (`.gsc-marquee` does).
- Don't set `--stage-*` on `body[...]`; a game's `:root` is the right place.
- Don't give a colour its only meaning: pair `--green`/`--red` with a shape,
  an icon or a word.
- Don't rename or drop a class or id a script, a harness or a test selects on.
  Add the new class next to the old one.
