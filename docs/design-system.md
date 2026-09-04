# Design system v2 — Game Show Central

One broadcast package across the hub and every game. This is the reference the
game agents work from: every token and every component class, each with a
one-line usage example.

**Files**

| File | What it holds | Lines |
| --- | --- | --- |
| `shared/theme.css` | tokens, per-game accents, the stage, v1 utilities/`.btn`/`.field`, type utilities | 338 |
| `shared/theme-components.css` | the `.gsc-*` component kit + the motion vocabulary | 700 |

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
| `hub` | `#ffcc4d` gold | `#ff4d5e` marquee red | `#33124f` |
| `jeopardy` | `#2b34ff` | `#ffcc4d` | `#0a1158` |
| `family-feud` | `#e21b3c` | `#ffcc4d` | `#10306b` |
| `wheel-of-fortune` | `#9d4edd` | `#2ec4b6` | `#3d1268` |
| `weakest-link` | `#7c99b6` | `#d33` | `#16222e` |
| `millionaire` | `#3346c8` | `#a06bff` | `#141c63` |

```html
<body data-gsc-game="family-feud">          <!-- whole page wears Feud red -->
<div class="gsc-splash" data-gsc-game="jeopardy">  <!-- one node wears Jeopardy blue -->
```

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

## 3. The splash (`.gsc-splash`)

A 1.2 s title card on a game switch, on the host screen and on every phone.

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
- Show it by removing `.hidden`, hide it 1200 ms later. Nothing waits on it and
  no message is delayed by it.
- **Skip it entirely** when `matchMedia("(prefers-reduced-motion: reduce)").matches`.
- Put the game id on the node (`data-gsc-game="millionaire"`) so the card wears
  that game's accent.

The hub's implementation is `showSplash()` in `js/hub-host.js` and
`js/hub-player.js` — ~14 lines, copy it.

---

## 4. Adopting v2 in three steps

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
