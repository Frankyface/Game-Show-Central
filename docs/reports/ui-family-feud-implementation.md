# UI upgrade — Family Feud (game agent)

Scope: brief `docs/09-ui-upgrade-brief.md` §4, the Family Feud bullet, built on
design system v2 (`docs/design-system.md`). **No behaviour changed.** Every
element id, every class a script/harness/test selects on, every reducer event
and every phone message is untouched. The only JS edits are class-name strings
and a 20-line `showSplash()`.

---

## 1. Files

| File | Status | Lines | What |
| --- | --- | --- | --- |
| `games/family-feud/index.html` | restructured (markup only) | 323 | host toolbar, two-column setup, `.gsc-banner` phase bars, board chrome wrapper, Fast Money lower-third wrapper, `.gsc-splash` node, `gsc-timer` on the two timer strips, one new `<link>` |
| `games/family-feud/css/feud.css` | rewritten | 461 | tokens, layered blue stage, `.btn` aliased to the v2 `.gsc-btn` shape, host toolbar, setup card, final standings |
| `games/family-feud/css/feud-board.css` | **new** | 720 | phase banner, board cabinet + bevelled slots, bank/strike rail, team podiums, host controls, the three-X strike overlay, the whole Fast Money screen incl. the lower-third |
| `games/family-feud/css/feud-phone.css` | rewritten | 442 | full-bleed phone controller + the question editor |
| `games/family-feud/css/timer.css` | rewritten | 85 | same red-block strip, richer housing, motion moved inside `no-preference` |
| `games/family-feud/js/feud-app.js` | +2 hunks | 773 | class names only (see §3) |
| `games/family-feud/js/feud-boot.js` | +1 hunk | 56 | `showSplash()` + one call |
| `games/family-feud/js/feud-fm.js`, `feud-phone.js`, `feud-room.js`, `feud-editor.js`, `feud-core.js`, `feud-timer.js`, `feud-sound.js`, `feud-content.js`, `data.js` | **untouched** | — | — |

`css/feud-board.css` exists only because `feud.css` would otherwise have gone
past the 800-line house rule; it is linked from `index.html` right after
`feud.css`. Nothing new is loaded from the network — `shared/theme.css` was
already linked and it `@import`s the `.gsc-*` kit.

---

## 2. What changed, screen by screen

### Host toolbar (every host screen)

One consistent translucent bar: a CSS-drawn red mic disc + the game title in
Anton/gold on the left, and the room chip → Undo → Sound → Question Editor →
New game on the right. Fixed 54 px (46 px when embedded, because the hub's own
shell bar sits above it and owns **Lobby** — the game has no lobby of its own
when it runs standalone). Buttons keep their `btn btn-ghost btn-small` classes;
`feud.css` aliases `.btn` to the v2 `.gsc-btn` declarations (uppercase, 0.07em
tracking, glass fill, 40 px min-height) exactly the way `css/hub.css` does, so
no markup or selector moved.

### Setup — a clean two-column card

One card with a header rule (kicker / title / source note), a two-column body
(**Teams** left: names, roster, add-player; **Game**, **Questions**,
**Phones** right) and a footer rail carrying the error line and **Start the
Feud**. Section headings are eyebrow-cased with a fading accent rule. Roster
rows are gold-railed wells; the empty state is a dashed panel. The columns
collapse to one below 900 px. Fits 1280×720 exactly.

### Board — the survey cabinet

- **Phase banner** is now a `.gsc-banner`: a red accent bar, a `FAMILY FEUD`
  eyebrow and `#phase-banner` as the `.gsc-banner-title` (the id, the class
  `phase-banner` and `aria-live="polite"` are all unchanged).
- **Chrome frame**: `#board` is wrapped in `.board-frame > .board-frame-inner`
  — a brushed metal bezel with corner rivets (repeated radial gradients, no
  images) around a dark inner well with an inset shadow.
- **Bevelled slots**: unrevealed tiles are recessed navy slots with a light top
  edge, a dark bottom edge and the gold number glowing; revealed tiles are lit
  glass with a gold rail, a fixed specular highlight, the answer in Anton and
  the count in its own gold-railed box.
- **Light sweep**: one slow 7 s sweep crosses the cabinet glass
  (`.board-frame::after`). It lives on the frame, not on a tile, on purpose —
  `renderTiles()` rebuilds every tile on every reducer event, so a per-tile
  one-shot flip/sweep would replay on all revealed tiles on every strike and
  every score edit. The 3-D flip state (`.tile.revealed .tile-inner {
  rotateX(180deg) }` plus its `--dur-slow` transition) is kept exactly as it
  was.
- **Bank + strikes** sit on a lit rail under the board: the bank in glowing
  gold with tabular numerals and a gold multiplier badge, the strike slots as
  recessed red boxes that light up with a glow when set.
- **Team panels are `.gsc-podium`s**: a coloured top rail (gold A / blue B),
  the name, a tabular score, the state badge and the roster under a hairline.
  The team in control gets `is-active` — a 5 px lift and a gold rail
  (`.control` is still there and still does the work).
- The board screen is a five-row grid whose board row is the only flexible one,
  so 5, 6 or 8 answers all fit 720 px with no page scroll.

### Strike overlay — three giant X's with a shake

`#strike-overlay` now paints a red radial bloom over a scrim and fades in; the
marks are ~15 rem Anton in Feud red with a hot glow and a bevel, spaced so the
three X's read as three separate marks. They punch in (`feud-strike-pop`,
400 ms) and then shake (`feud-shake`, 520 ms, delayed, no fill so it hands the
transform back). The overlay stays `pointer-events: none` and still hides
itself after the same 950 ms the JS already used.

### Fast Money — a broadcast lower-third

The five rows are gold-railed cards that share the available height; duplicates
turn red. Under them the **lower-third**: a new `.fm-lower-third` wrapper (the
`.fm-total-row` and `#fm-result` inside it are unchanged) drawn as a
red-to-navy bar with a gold top rule — `TOTAL`, the giant gold total, the
target on the left, the verdict right-aligned in Anton (green for a win). The
timer strip sits in its own inset housing.

### Final standings

Both cards are `.gsc-podium`s with the team's colour as the top rail; the
winner gets `winner is-active` — a lift, a gold ring and a gold `Winner` badge.

### Question editor — a tidy form

Sticky translucent header with the title and the three actions; the settings
block is a rounded fieldset on a dark well; each round/Fast Money question is a
gold-railed card with a pill "Sum NN" badge (`.editor-sum` / `.editor-sum.over`
unchanged — the harness reads that class name); answer rows keep their
`1fr / 6rem / 2.2rem` grid with eyebrow-cased labels.

### Phone — full-bleed, Feud accent, giant targets

The controller is a flex column that fills the viewport; the **visible panel
fills what is left and carries its own colour** — gold-lit for the team pick,
red-lit for the face-off — so the screen reads as one colour at arm's length,
edge to edge, with no card box. The two team buttons now grow to share the
screen (154 px each at 320×640); the buzz button is 298 px and goes green +
white-ringed when armed (with a slow glow pulse) with the word `BUZZ`, so the
state never depends on colour alone. The Fast Money input, both nav buttons and
**Leave room** are all ≥ 56 px (Leave room was a `btn-small` before — it is
now full-width and 56 px). The SDK's own join card (`shared/bridge.js` renders
it into `#gsc-join`) is styled from this sheet — red-railed card, 56 px fields
and a 56 px full-width Join — and the "connecting…" panel behind it is hidden
with a sibling selector while the card is up, so the join screen is one thing
rather than two.

### Splash

`.gsc-splash` markup copied verbatim from the hub's `index.html`;
`showSplash()` copied from `js/hub-host.js` into `js/feud-boot.js` and called
once at boot, before the host or phone stack starts — so it plays on the host
screen and on every phone, in standalone and embedded mode alike. Title
"Family Feud", subtitle "Survey says…" (the registry tagline),
`data-gsc-game="family-feud"` so it wears the Feud accent.

---

## 3. The JS diff (UI-7)

`git diff games/family-feud/js` is **three hunks in two files** and nothing
else:

**`js/feud-app.js`** — class-name strings only, in `renderTeamPanel()` and
`renderFinal()`:

- `team-panel …` → `team-panel gsc-podium …`, and `" control"` →
  `" control is-active"`
- `final-team …` → `final-team gsc-podium …`, and `" winner"` →
  `" winner is-active"`
- `team-name` → `team-name gsc-podium-name`, `team-score` →
  `team-score gsc-podium-score`, `team-badge` → `team-badge gsc-podium-note`

No v1 class was removed, no id, no attribute, no text, no logic. The harness's
`aria-label` selectors (`Put Cleo on team B`), `#board .tile`,
`.tile.revealed`, `.fm-row.duplicate`, `.fm-dup-flag`, `#fm-table input`,
`#fm-table .fm-row select`, `.editor-q`, `.editor-sum`,
`.editor-answer-row input[type=number]` and every button label it clicks by
text are all untouched.

**`js/feud-boot.js`** — `+22` lines: the copied `showSplash()` (writes two
`textContent`s, sets `dataset.gscGame`, toggles `.hidden` on a
`pointer-events: none` node, returns early under
`prefers-reduced-motion: reduce`) and its single call. Nothing waits on it, no
message or timer is delayed by it.

**`js/feud-fm.js` and `js/feud-phone.js` were not edited at all** — everything
those screens needed came from CSS plus the two wrapper `<div>`s in
`index.html`.

**`index.html`** changes are markup only: wrapper elements
(`.topbar-brand`, `.setup-head`, `.setup-cols` / `.setup-col`, `.setup-foot`,
`.phase-bar`, `.board-frame` / `.board-frame-inner`, `.fm-lower-third`), added
classes (`screen-board`, `screen-fm`, `screen-final`, `gsc-banner`,
`gsc-banner-title`, `gsc-eyebrow`, `gsc-timer`), the `.gsc-splash` node and one
`<link>`. `<body data-gsc-game="family-feud">` is byte-identical (F-I6 matches
it with a literal regex).

---

## 4. Test results

| Check | Before | After |
| --- | --- | --- |
| `cd games/family-feud && node --test` | 87/87 pass | **87/87 pass, 0 fail** |
| `node --test` at repo root | 423/423 | **423/423 pass, 0 fail** |
| `games/family-feud/tests/harness.html` on `http://127.0.0.1:8673` | 51/51 | **51/51 pass, 0 fail, no uncaught** |
| Banned sinks (`innerHTML`, `insertAdjacentHTML`, `outerHTML =`, `document.write`, `eval(`, `new Function`, `console.log`) in `index.html`, `js/**`, `css/**` | none | **none** |
| Every file < 800 lines | yes | **yes** — largest of mine is `css/feud-board.css` at 720 |
| External URLs | Google Fonts only | **unchanged** — no new link, no new dependency |

### Layout (host, 1280×720, Chrome)

| Screen | `documentElement.scrollHeight` / `innerHeight` | `scrollWidth` |
| --- | --- | --- |
| Setup | 720 / 720 | 1280 |
| Face-off | 720 / 720 | 1280 |
| Play (5 answers, 1 column) | 720 / 720 | 1280 |
| Play (8 answers, 2 columns, 2-line question) | 720 / 720 | 1280 |
| Round over (all revealed, team picker open) | 720 / 720 | 1280 |
| Fast Money — play, timer running | 720 / 720 | 1280 |
| Fast Money — result (win) | 720 / 720 | 1280 |
| Final standings | 720 / 720 | 1280 |

Embedded in the hub (shell bar 44 px + iframe 676 px): the iframe's own
`scrollHeight` is **676 = innerHeight** on the board and Fast Money, and the
hub page stays at 720. It still fits with the storage-full `#save-warning`
banner showing, because each play screen is `flex: 1` and gives the height
back. Setup at 676 px is 713 px tall and scrolls — allowed by §1 ("editors and
setup lists may scroll").

### Phone (320×640)

`scrollWidth === 320` and `scrollHeight === 640` on every screen (join,
team pick, face-off, Fast Money, waiting/result). Measured targets:

| Control | Size |
| --- | --- |
| `#player-team-a` / `#player-team-b` | 288 × 154 |
| `#player-buzz` | 288 × 298 |
| `#player-fm-input` | 288 × 56 |
| `#player-fm-prev` / `#player-fm-next` | 139 × 56 |
| `#player-leave` | 288 × 56 |
| join card room code / name fields, Join | 56 tall each |

All ≥ 56 px, no horizontal scroll.

### Contrast (computed from the DOM, alpha-composited up the ancestor chain,
with the brightest point of the stage gradient `#17408c` as the opaque base —
i.e. the worst case)

| Surface | elements sampled | worst real pair |
| --- | --- | --- |
| Setup | 23 | 7.87:1 (`.setup-kicker`, `--ink-dim` on the card) |
| Board / face-off / play | 45 | 5.97:1 (`.btn-danger` "Strike ✕"), then 6.88:1 (`.tile-number` gold on a slot) |
| Round over | 48 | 6.88:1 |
| Fast Money (play and reveal) | 29 / 36 | 6.87:1 (`.fm-head` labels) |
| Final standings | 14 | 7.98:1 (`.final-note`) |
| Question editor | 229 | 6.71:1 (`.editor-sum` green pill) |
| Phone — join | 6 | 7.87:1 |
| Phone — team pick | 8 | 7.98:1 (buttons 9.01 / 9.98) |
| Phone — face-off | 7 | armed 7.26:1 · idle 14.23:1 · won 9.01:1 · lost 13.55:1 |
| Phone — Fast Money | 10 | 6.87:1 |
| Phone — waiting / result | 10 | 7.98:1 |

**Zero pairs below their threshold**, with one expected sampler artifact:
`.strike-slot` *without* `.on` renders its `✕` at `color: transparent` — a
deliberately invisible placeholder (this is v1 behaviour, unchanged). The state
is carried by the slot outline and by the `aria-label`
("Strike 2 unused"). A naive sampler reports 1:1 for it; exclude
`color: transparent`.

Two tooling notes for the UI tester:

1. Every gradient surface now also declares a flat `background-color` under its
   `background-image` (`.setup-card`, `.topbar`, `.phase-bar`, `.tile-back`,
   `.tile-face`, `.bank-row`, `.team-panel`, `.fm-row`, `.fm-lower-third`,
   `.player-team-btn`, `.player-buzz-btn` in all four modes, `.editor-q`,
   `.gsc-join-card`, and `body` itself), so a DOM sampler reads the true
   surface instead of walking past it.
2. Sample the phone buzz button **after its `background` transition settles**
   (or with `transition: none`). A frozen/backgrounded tab reports the
   in-flight interpolated colour and gives a false failure.

### Reduced motion (UI-4)

I could not toggle the emulated media query from this harness, so I ran the
equivalent **structural** check in the live page: walk every readable
`document.styleSheets` rule (recursing through `@media`, `@supports` and
`@import`, which covers `shared/theme.css` → `shared/theme-components.css` plus
all four Feud sheets) and flag any `@keyframes` rule or any rule with a
non-`none` `animation-name` that is not inside a
`prefers-reduced-motion: no-preference` block.

**Result: zero offenders.** The only unreadable sheet is the cross-origin
Google Fonts stylesheet (`@font-face` only). So under `reduce` none of the
keyframes exist and `document.getAnimations()` is empty. A source scan agrees:
the only `animation:` outside a `no-preference` block anywhere in
`games/family-feud/css` is `animation: none !important` inside the existing
`prefers-reduced-motion: reduce` safety net in `feud-phone.css`.

`showSplash()` returns before touching the DOM when `reduce` matches, so the
title card does not appear either.

### Keyboard (UI-6)

15 focusable controls on the board screen, all reachable with Tab in DOM order.
A real Tab press lands on `button.tile` with `:focus-visible` matching and a
solid gold 3 px outline at 3 px offset; `feud.css` also declares the bare
`:focus-visible { outline: 3px solid var(--focus) }` so nothing can end up
ring-less.

### Splash (UI-8)

Fires on boot on the host page and on the phone, shows
`GAME SHOW CENTRAL PRESENTS / FAMILY FEUD / Survey says…` on the Feud accent
glow, carries `data-gsc-game="family-feud"`, computes to
`pointer-events: none`, and `#gsc-splash` is back to `.hidden` 1.2 s later.

---

## 5. Things the orchestrator / tester should know

1. **`tests/harness.html` does not know about `css/feud-board.css`.** Its
   `ASSETS` (cache-buster) and `SOURCE_FILES` (F-I6 static gates: banned sinks,
   `console.log`, < 800 lines, external URLs) lists are hard-coded and I do not
   own `tests/**`. The new sheet passes all of those gates (I ran the same
   checks by hand — see §4), but whoever owns `tests/` should add
   `"../css/feud-board.css"` to both arrays so the gate stays honest. Same for
   the two lists in any future sheet split.
2. **The accent is unchanged.** `[data-gsc-game="family-feud"]` in
   `shared/theme.css` gives `--accent #e21b3c`, `--accent-2 #ffcc4d`,
   `--stage-glow #10306b` and that is exactly right for Feud — I did not need a
   change there, and I did not touch `shared/**`.
3. **The flip animation is deliberately not a one-shot.** `renderTiles()`
   rebuilds the whole board on every reducer event, so any per-tile
   `animation:` would re-fire on every already-revealed tile each time the host
   reveals, strikes or edits a score. The reveal is therefore a persistent
   flipped state plus a board-level light sweep. Making the flip animate per
   reveal would need a render-logic change (reuse tiles instead of
   `replaceChildren`) — out of scope for a styling pass, and worth a follow-up
   ticket if it is wanted.
4. **Two toolbars stack when embedded** — the hub's 44 px shell bar (which owns
   **Lobby**) above the game's 46 px bar (Undo / Sound / Editor / New game).
   That is 90 px of chrome; the board still fits the 676 px frame with room to
   spare. If the orchestrator would rather have one bar, the game's brand block
   can be hidden under `body.gsc-embedded` in one CSS line.
5. `css/feud.css` and `css/feud-phone.css` are full rewrites, so `git diff` is
   large for them even though the markup they style barely moved. The JS diff
   (§3) is the one worth reading line by line.
