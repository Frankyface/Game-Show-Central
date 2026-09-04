# UI upgrade — design system v2 and the hub (shell agent)

Scope: brief `docs/09-ui-upgrade-brief.md` §2 (design system v2) and §3 (the
hub). **No behaviour changed.** Every element id, every class a script or a
harness selects on, and every message in the protocol are untouched.

---

## 1. What changed

| File | Status | Lines | What |
| --- | --- | --- | --- |
| `shared/theme.css` | rewritten (additive) | 387 | v1 tokens/classes kept verbatim; v2 tokens, per-game accents, the layered stage, type utilities, a shared focus ring |
| `shared/theme-components.css` | **new** | 774 | the `.gsc-*` component kit, the motion vocabulary and the `.gsc-library` picker; `@import`ed by `theme.css` |
| `shared/library.js` | **new** | 329 | the question-set library: `GSCLibrary.load` / `fetchSet` / `mountPicker` (docs/19 §2) |
| `tests/library.test.mjs` | **new** | 475 | 29 unit tests over a fake fetch and a fake DOM |
| `docs/design-system.md` | **new** | — | the reference: every token and class with a usage example, plus "adopting v2 in three steps" |
| `index.html` | restructured | 159 | landing hero + line-up strip, lobby join-steps, phone copy, the `.gsc-splash` node, `data-gsc-game="hub"` |
| `css/hub.css` | rewritten | 699 | landing, lobby, game cards, shell bar, dialogs |
| `css/hub-art.css` | **new** | 187 | the CSS-drawn game art, one `--art` gradient stack per registry id (all fourteen) |
| `css/hub-phone.css` | **new** | 217 | the phone controller (split out only to stay under the 800-line rule) |
| `js/hub-registry.js` | +5 lines | 112 | the Millionaire entry from `docs/08-millionaire-spec.md` §7 (the three later games were added by the coordinator) |
| `js/hub-host.js` | +26 lines | 732 | `showSplash()` + 3 styling-hook attributes |
| `js/hub-player.js` | +21 lines | 433 | `showSplash()` + its one call |
| `docs/reports/img/ui-before-README.md` | **new** | — | the "before" record (see §5) |

### The only JS additions (UI-7)

`git diff js/` is 5 hunks, all reviewable in one screen:

1. `showSplash(game)` in `hub-host.js` and the mirror in `hub-player.js` — a
   14-line function that fills two `textContent`s and toggles `.hidden` on a
   node that is `pointer-events: none`. It is skipped when
   `prefers-reduced-motion: reduce`. Nothing waits on it; no message flow,
   state shape, timer or reducer was touched.
2. `showSplash(game)` called at the end of `pickGame()` (host) and at the top
   of `mountFrame()` (phone).
3. Three styling-hook attributes, each with a `// styling hook only` comment:
   `li.dataset.game = game.id` on a game card and on a landing card (so
   `css/hub.css` can draw that game's art), and
   `$("shell-bar").dataset.gscGame = game.id` (so the bar wears the running
   game's accent). No script or harness reads any of them.
4. The Millionaire registry object.

Nothing else in `js/` changed. No class was renamed or removed anywhere: the
harness selectors `.roster-name`, `.roster-swatch`, `.roster-row`,
`.game-tile`, `.tile-name`, `.tile-play`, `.btn`, `.btn-gold`, `.btn-danger`,
`.phone-frame` and every `#id` are all still present and still selected.

---

## 2. Design system v2 — token and class inventory

Full detail with a usage example each: **`docs/design-system.md`**. Summary:

**Tokens (new in v2)** — `--ink-mute`; `--accent`, `--accent-2`,
`--accent-ink`; `--panel`, `--panel-strong`, `--panel-line`, `--panel-blur`,
`--well`; `--radius-sm/-xl/-pill`; `--shadow-panel`, `--shadow-lift`,
`--shadow-inset`; `--stage-bg`; `--fs-hero`, `--fs-display`, `--fs-title`,
`--fs-body`, `--fs-ui`, `--fs-micro`; `--track-display`, `--track-eyebrow`;
`--dur-fast`, `--dur`, `--dur-slow`, `--ease-spring`; `--focus`.

**Tokens kept verbatim from v1** — `--stage-deep/-night/-card/-glow/-accent`,
`--ink`, `--ink-dim`, `--ink-faint`, `--gold`, `--gold-deep`, `--gold-text`,
`--red`, `--green`, `--amber`, `--line`, `--font-display`, `--font-ui`,
`--radius`, `--radius-lg`, `--duration`, `--ease-out`, `--tap`.
`--panel` changed from a gradient to a glass colour; no game sheet uses it
(checked with a repo-wide grep) and the hub was the only consumer.

**Per-game accents** are keyed on the `[data-gsc-game="…"]` **attribute**, not
on `body`, so the shell bar and the splash card can wear another game's accent
inside the hub page. Blocks exist for `hub`, `jeopardy`, `family-feud`,
`wheel-of-fortune`, `weakest-link`, `millionaire`, `price-is-right`,
`pyramid`, `deal-or-no-deal`, `password`, `chain-reaction`, `the-chase`,
`one-vs-100`, `press-your-luck`, `match-game` — fourteen in all, and the
**only** source of those games' accents (no game declares local overrides). `--accent-ink` is picked for contrast, not
convention: Price Is Right's `#e63946` fails with white (4.2:1) so its ink is a
near-black `#1a0206` (4.8:1); Pyramid's and Password's gold use `#241a02`
(9.3:1 / 10.8:1); Chain Reaction's hot pink takes `#2a0213` (5.4:1) because
white on it is 3.5:1. `--accent-2` is a UI colour, so Chain Reaction's
electric blue is lifted from the brand `#0f3bd9` (2.5:1 on the stage,
unreadable) to `#4d7bff` (5.2:1); the brand blue stays a background fill in
the card art, where white on it is 7.9:1.

**Components (all `.gsc-*`)** — `.gsc-panel` (+`-strong`, `-accent`),
`.gsc-card` (+`-interactive`), `.gsc-well`, `.gsc-rule`, `.gsc-scroll`,
`.gsc-sheen`; `.gsc-btn` (+`-primary`, `-ghost`, `-danger`, `-big`, `-sm`,
`-tap`, `-block`, `-icon`); `.gsc-chip` (+`-accent`), `.gsc-badge`,
`.gsc-kbd`, `.gsc-pill-status` (`is-on`/`is-off`/`is-busy`); `.gsc-banner`
(+`-title`, `-sub`, `-end`); `.gsc-podium` (+`-name`, `-score`, `-note`,
`is-active`, `is-out`); `.gsc-lozenge` (+`-accent`, `-sm`); `.gsc-tile`
(+`-inner`, `-face`, `-back`, `-empty`, `is-flipped`); `.gsc-timer`
(+`-block`, `-label`, `is-lit`, `is-urgent`); `.gsc-toast` (+`-good`,
`-danger`); `.gsc-modal-backdrop`, `.gsc-modal` (+`-title`, `-body`,
`-actions`); `.gsc-marquee`; `.gsc-splash` (+`-kicker`, `-title`, `-sub`,
`-rule`). Type utilities: `.gsc-hero`, `.gsc-display`, `.gsc-title`,
`.gsc-eyebrow`, `.gsc-body`, `.gsc-dim`, `.gsc-mute`.

**Keyframes** — `gsc-pop`, `gsc-flip`, `gsc-glow`, `gsc-shimmer`, `gsc-rise`,
plus `gsc-pulse`, `gsc-dot`, `gsc-bulbs-a/-b`, `gsc-splash-in`,
`gsc-splash-title`.

### The file split

`shared/theme.css` would have been ~1000 lines with the component kit inside
it, so the kit lives in `shared/theme-components.css`. `theme.css` opens with
`@import url("theme-components.css")`, so **games need no markup change** —
any page that already links `shared/theme.css` gets both. A game may also link
the components sheet directly to avoid the chained request. Same reason for
`css/hub-phone.css`; `index.html` links `theme.css`, `hub.css`, `hub-phone.css`.

---

## 3. The hub

**Landing.** A hero card ringed by a CSS-only marquee: two interleaved rings
of bulbs (repeated `radial-gradient`s with the halo baked into the gradient, so
there is no filter anywhere) trading opacity on a `steps(1)` chase. Title at
`--fs-hero` (140px at 1280), three equal calls to action (host / no phones /
join on your phone — the third is now a real button-shaped link), and a
"tonight's line-up" strip of five cards, each with **CSS-drawn art, no
images**: the Jeopardy board grid under a gold category strip, the Feud survey
board with answer slots and score boxes, a Wheel of Fortune conic wheel, two
interlocking Weakest Link chain rings, the Millionaire concentric rings, the
Price Is Right bidders' podium row under a red marquee band, the Pyramid
six-box 3-2-1 board, and a row of gold Deal or No Deal cases on a folded red
curtain, the Password 10-to-1 value ladder lit at the top and dimming as the
points fall with a padlock beside it, and the Chain Reaction column of white
word tiles joined by hot-pink links. The same art stack drives the lobby
cards, keyed on `[data-game="…"]`, and lives in `css/hub-art.css`.
Each plate is one `--art` gradient stack with `background-repeat: no-repeat`;
the motifs are sized with `min(%, px)` so they read correctly on both the wide
landing plate (~118×62) and the tall lobby art rail (~64×140).

**Lobby.** One screen, `height: 100dvh`, `overflow: hidden` — the page never
scrolls at 1280×720; the roster and the game grid scroll internally if they
have to (measured: they don't with five games and a full roster). The room code
is the hero (Anton, `clamp(88px, min(10.5vw, 20vh), 150px)` = 150px at 1280×720)
on an accent-lit glass panel with a slow breathing gold bloom behind it, over
the join URL, the status line, the controls and a "join in 3 steps" mini-guide.
Roster rows are colour-railed wells with an avatar disc and a status dot. The
night scoreboard is a leaderboard: a CSS-counter rank, gold/silver/bronze rails
on the top three, tabular-numeral totals. Game cards are horizontal — the art
as a full-height left rail, name in Anton, tagline, capability chips, the soft
player hint, and Play — with an accent-tinted wash, a hover lift and an accent
glow. The grid is `repeat(auto-fit, minmax(262px, 1fr))`: at **fourteen** games
it lays out 3×5 at 1280×720. Five rows of 155px do not fit the 648px panel, so
**the game grid is the one place in the hub that scrolls** — inside its own
bounded panel, with the visible thin `.gsc-scroll` scrollbar. The page itself
still never scrolls. (Four columns were tried and rejected: at ~211px a
horizontal card leaves ~119px of text column, which pushes every card to two
title lines and makes the grid taller, not shorter.) The card was compressed
to 155px for the ten-game round —
the tagline is clamped to two lines and each capability chip to one line with
an ellipsis, so a very long `phones:` list is now truncated on the card. That
is the one piece of information the density costs; the full list is still in
`js/hub-registry.js` and in each game's own UI.

**Shell bar.** 44px, translucent (`rgba(7,4,18,.72)` + a 14px backdrop blur),
an accent hairline under it, the game name in Anton tinted with that game's
accent, the broker note, and the room chip. It sits above the frame, never over
it: `44px + calc(100dvh - 44px) = 100dvh` exactly.

**Phone.** Full-bleed accent per screen — gold/marquee for "join", green for
"you're in" — and below 480px the card loses its box entirely so the colour runs
edge to edge like a native app. Join: big Anton code field, a 4-up avatar grid
at 65×56 px (was 48px high — now above the 56px rule), a full-width Join. The
waiting screen gives the player a 108px avatar disc ringed and haloed in **their
own roster colour** with a soft pulse. The reconnect banner is 56px tall with an
animated amber dot.

**Splash.** `.gsc-splash` full-screen title card — kicker, the game name at
`--fs-hero`, an accent rule, the tagline, on the game's accent glow. 1200 ms,
`pointer-events: none`, skipped under reduced motion, shown on both the host
screen and every phone at the moment the frame mounts.

---

## 4. Test results

| Check | Result |
| --- | --- |
| `node --test` at root | **1025/1025 pass**, 0 fail (390 at the start of this work; each game that landed since brings its own suites, plus 29 new `tests/library.test.mjs` cases) |
| `tests/hub-harness.html` on `http://127.0.0.1:8671` | **16/16 pass**, including L-I10 (no banned DOM sinks, every gated file < 800 lines) |
| Landing at 1280×720, **14 games** | `scrollHeight == 720`, `scrollWidth == 1280` — no scroll; the line-up strip is pinned to a clean 7 x 2 above 1140px (5 x 3 on a laptop) |
| Lobby at 1280×720, room open, manual player, **14 games** | page `scrollHeight == 720` — the page does not scroll. The game grid is 3 columns × 5 rows and scrolls inside its panel (`scrollHeight 801` in a `clientHeight 648` box), by design |
| Host in a game at 1280×720 | bar 44px + frame 676px = 720; page `scrollHeight == 720` |
| Phone join at 320×640 | `scrollWidth == 320`, `scrollHeight == 640`; all 13 controls measure ≥ 56px tall (12 avatars 65×56, Join 278×56) |
| Phone waiting at 320×640 | `scrollWidth == 320`, `scrollHeight == 640`; Leave 56px |
| Splash | fires on `pickGame`, carries `data-gsc-game`, auto-hides after 1.2s, `pointer-events:none` |
| Contrast | worst real pair on the hub is `--ink-mute` on a panel at **5.91:1**; `--ink-dim` 8.5:1, `--ink` 16.5:1, gold code 11.9:1, `--red` 6.4:1, `--green` 9.8:1, gold-button ink 11.4:1. All ≥ 4.5:1. |
| Reduced motion | static gate: a scan of all four sheets finds **zero** `animation:` / `@keyframes` outside a `prefers-reduced-motion: no-preference` block, so under `reduce` no animation object is created at all |
| No `innerHTML` / files < 800 lines | all shell and CSS files clean; largest is `shared/theme-components.css` at 774 |

Note for the tester on contrast tooling: `.btn-gold` and `.gsc-btn-primary` now
declare a flat `background-color` under their gradient, so a DOM sampler reads
the true surface instead of walking up to the parent (a naive sampler reported
1.13:1 before this).

---

## 5. Screenshots

**The screenshot tool available to this agent renders images into the
conversation but cannot write PNG files to disk**, so the `ui-before-*.png` and
`ui-after-hub-*.png` files asked for in brief §5 do not exist.

Instead: **`docs/reports/img/ui-before-README.md`** records every "before"
surface — landing, lobby (room open + one manual player), the shell bar with
Family Feud loaded, the phone join and waiting screens at 320×640, and the four
game setup/mid-game host screens — with the *measured* computed type sizes and
colours read out of the live DOM. The existing `shell-t3-*.png` and
`feud-t3-*.png` in the same folder are earlier captures of the same v1 look and
serve as visual "before" references.

Surfaces the UI tester should capture as `ui-after-hub-*.png`:
`landing`, `lobby`, `lobby-night` (after a game reports scores),
`shellbar-feud`, `splash`, `phone-join-320`, `phone-waiting-320`,
`phone-ingame-320`.

---

## 6. The question-set library (`shared/library.js`)

Built to docs/19 §2 and documented in `docs/design-system.md` §3 and
`docs/00-architecture.md` §9.12, because fourteen game agents code against it.

- `GSCLibrary.load(gameDir)` → `{ok, sets, url}` / `{ok:false, error, url}`
- `GSCLibrary.fetchSet(gameDir, file)` → `{ok, json, url}` / `{ok:false, error, url}`
- `GSCLibrary.mountPicker(container, {gameDir, onPick, validate, label})` →
  `{el, ready, destroy()}`

Nothing rejects and nothing throws: a page opened from `file://` and a game
with no `sets/` folder are normal states, so both come back as `ok:false` with
a plain-English sentence and the picker hides itself. The manifest is validated
hard — at most 50 entries, `file` must be a bare `*.json` name (no slashes, no
`..`, no query, no scheme), `name` ≤ 60, `description` ≤ 200, control
characters stripped, duplicates collapsed; junk rows are dropped rather than
failing the whole library. Both fetches use `cache: "no-store"`.

The picker is built node by node (no HTML strings) as a `.gsc-library` well
with a `<label>` bound to the `<select>`, a `.gsc-btn.gsc-btn-primary`
**Load set** button, a `role="status"` Preview line (name — by — description —
counts) and a `role="alert"` error line; on a phone both controls go full
width at `--tap` height.

`validate` may throw, return a string, return `{ok:false,error}` or return
`false`; anything else passes. A rejection lands in the error line and
`onPick` is never called — all six shapes are pinned by tests.

29 unit tests in `tests/library.test.mjs` cover manifest shapes, the 50-entry
cap, bad file names (including `../`, `sets/`, backslash, query, scheme,
non-`.json`), fetch failure (throwing = file://, and 404), bad JSON, gameDir
normalisation, and the whole picker over a small fake DOM.

## 7. What the game agents need to know

1. **Link nothing new.** `shared/theme.css` `@import`s the component kit, so
   your existing `<link rel="stylesheet" href="../../shared/theme.css">`
   already gives you v2. Jeopardy does not link the theme at all and is
   therefore completely unaffected — adopt it deliberately if you want it.
2. **Set `data-gsc-game` on your body** (Feud, Wheel and Weakest Link already
   do; Millionaire must). That is what gives you `--accent`, `--accent-2`,
   `--accent-ink` and your stage glow. Change your accents by editing your
   block in `shared/theme.css` — **not** by declaring them in your `:root`.
3. **Your `:root` stage colours are safe.** Nothing in v2 overrides
   `--stage-deep/-night/-card`; the shared `body` rule just builds a richer
   layered stage out of them. Your pages already look better with zero edits.
4. **The motion rule is a hard gate.** Every `@keyframes` *and* every
   `animation:` must sit inside `@media (prefers-reduced-motion: no-preference)`.
   UI-4 checks `getAnimations()` is empty under `reduce`.
5. **Add the splash** by copying the 14-line `showSplash()` from
   `js/hub-host.js` plus the `.gsc-splash` markup from `index.html`. It must be
   `pointer-events:none` and must be skipped under reduced motion.
6. **Never remove a class.** Add `gsc-btn` next to `btn`, never instead of it —
   harnesses and tests select on the v1 names. If you would rather not touch
   markup, alias `.btn` to the `.gsc-btn` declarations in your own sheet, the
   way `css/hub.css` does (your sheet loads after the theme, so it wins).
7. `docs/design-system.md` §5 is the three-step adoption checklist; §2 lists
   every component with a copy-pasteable example; §3 is the library picker.
8. **Mount the library picker** under your Questions/content section even
   before you have a `sets/` folder — it hides itself with a one-line note
   until a manifest exists. Do not re-implement the fetch or the validation.
