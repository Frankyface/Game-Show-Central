# UI upgrade — Wheel of Fortune

Scope: brief `docs/09-ui-upgrade-brief.md` §4 (the Wheel bullet) on design
system v2 (`docs/design-system.md`). **No behaviour changed.** Every element
id, every class a script or a harness selects on, every reducer, every message
and the wheel's rotation mechanics are untouched.

---

## 1. What changed

| File | Status | Lines | What |
| --- | --- | --- | --- |
| `games/wheel-of-fortune/css/wheel.css` | rewritten | 610 | glossy trilon board, lozenge category strip, `.gsc-banner` phase strip, rim-lit wheel, `.gsc-podium` rail, `.gsc-kbd` used-letter board, two-column setup card, tidy editor, `.btn` aliased to the `.gsc-btn` recipe |
| `games/wheel-of-fortune/css/wheel-phone.css` | rewritten | 189 | full-bleed Wheel accent (purple → teal), lozenge category, bevelled mini-board, 56 px targets |
| `games/wheel-of-fortune/css/timer.css` | rewritten | 123 | chunkier `.gsc-timer`-shaped blocks; the one `@keyframes` moved inside `prefers-reduced-motion: no-preference` |
| `games/wheel-of-fortune/index.html` | +18 net | 331 | `.gsc-splash` card, setup two-column wrapper, banner wrapper, `gsc-*` classes added beside the v1 ones, the wedge readout moved into the banner |
| `games/wheel-of-fortune/js/wheel-view.js` | class names only | 197 | `gsc-podium` / `gsc-podium-name` / `gsc-podium-score` / `gsc-podium-note` / `is-active` / `gsc-kbd` / `gsc-well` added **beside** the v1 names |
| `games/wheel-of-fortune/js/wheel-app.js` | +18 | 649 | `showSplash()` + one call, one styling-hook class toggle |
| `games/wheel-of-fortune/js/wheel-phone.js` | +15 | 248 | `showSplash()` + one call |
| `games/wheel-of-fortune/js/wheel-draw.js` | SVG styling only | 315 | rim lights, chunky pointer, an inset viewBox to make room for them |

Not touched: `shared/**`, `tests/**`, any other game, `wheel-core.js`,
`wheel-room.js`, `wheel-editor.js`, `wheel-sound.js`, `wheel-timer.js`,
`timer-core.js`, `wheel-content.js`, `data.js`, `puzzles.json`.

### The only JS changes (UI-7 review list)

1. **`wheel-view.js` — class names only.** Five one-line edits that *append*
   `gsc-*` names to the class strings the renderers already build. Nothing was
   renamed or removed: `.podium`, `.podium-active`, `.podium-locked`,
   `.podium-buzzed`, `.podium-name`, `.podium-round`, `.podium-total`,
   `.podium-total-value`, `.podium-leader`, `.podium-phone`, `.used-chip`,
   `.used-vowel`, `.is-used`, `.key`, `.key-vowel`, `.player-row`,
   `.final-row`, `.final-win` are all still emitted and still selected.
2. **`wheel-app.js`** — `showSplash()` (a 7-line copy of the one in
   `js/hub-host.js`), its single call at the end of the host boot, a
   `SPLASH_MS` constant, and one line in `renderWheel()`:
   `svg.classList.toggle("wheel-spinning", spinning); // styling hook only`.
   No state shape, reducer, timer, message or spin mechanic touched.
3. **`wheel-phone.js`** — the same `showSplash()` and one call in `boot()`.
4. **`wheel-draw.js`** — purely visual SVG additions: `buildRim()` (24
   decorative bulbs on the bezel), `buildPointer()` (the chunky flap, replacing
   the old thin triangle; it keeps the `wheel-pointer` class), and a viewBox
   inset by `PAD = 26` so the bulbs and the pointer are not clipped.
   **Unchanged:** `wedgePath()`, the wedge fills, `.wheel-wedge`,
   `.wheel-rotor`, `setRotation()`, `rotationOf()`, `wedgeAtPointer()`,
   `rotationForIndex()`, `spin()`, `showIndex()`, the reduced-motion branch and
   `dataset.rotation`. The harness's W-I1 check — DOM rotation vs the core's
   wedge index — reads exactly the same numbers as before.

---

## 2. The look (brief §4)

- **Puzzle tiles.** A glossy white trilon face (a three-stop gradient with a
  bright top edge, a soft bottom bevel and a drop shadow) carrying the deep
  green letter (`--tile-ink #0f5132`). An unrevealed gap is the deep
  green/teal `--tile-empty` with the same bevel inverted. The board sits in a
  gold bezel with a second gold hairline over dark-green felt.
- **Category strip** is a `.gsc-lozenge gsc-lozenge-sm` — the hex end caps from
  the shared kit, filled with the same white plate as the tiles.
- **The wheel** gained a dark bezel ring, 24 rim lights (alternating brightness
  so the ring reads as a chase without any animation), a gold rim and a chunky
  gold pointer flap with a cap bar. While spinning the SVG wears
  `.wheel-spinning` — a soft accent glow
  (`drop-shadow` in `--accent` purple + `--accent-2` teal). Idle it desaturates,
  exactly as before.
- **Podiums** are `.gsc-podium`: an accent top rail, the round money in Anton,
  the banked total under it, and the active player lit gold and lifted
  (`is-active`, plus the v1 `podium-active`). Colour is never the only signal —
  the rail, the lift and the class change together. With 5 or 6 players the rail
  goes two-up so the screen still fits 720.
- **Used-letter board** is a 13-wide grid of `.gsc-kbd` keycaps; a spent letter
  loses its bevel (shape, not just colour) and steps down to `--ink-mute`.
- **Phase banner** is a real `.gsc-banner` — accent bar, accent wash — with the
  landed wedge riding in its `gsc-banner-end` slot (that also freed 46 px in the
  wheel column, which is where the bigger wheel came from).
- **Bonus timer** carries `.gsc-timer` alongside `.timer-bar`; blocks are taller
  and rounder and still driven by `.timer-block` / `.off`.
- **Setup** is a two-column card (Players on the left spanning both rows, Phones
  and Puzzles stacked on the right), each section in its own well, with a
  full-width Start.
- **Editor** is a tidy two-panel form: a sticky-feeling head rule, panelled
  columns, labelled fields, pill wedge chips. **Both live previews are kept** —
  the per-round board preview (`.ed-preview`, `.ed-preview-tile`, `.ed-fit`) and
  the `#ed-wheel` wheel preview, which now shows the rim lights too.
- **Host toolbar** is a translucent bar with an accent hairline, the game name
  in Anton/gold and the room chip; all buttons come from one `.btn` recipe
  (the `.gsc-btn` declarations aliased onto the v1 names per
  `docs/design-system.md` §4 step 2, so no markup a script selects on moved).
- **Splash.** `.gsc-splash` with `data-gsc-game="wheel-of-fortune"`, shown for
  1200 ms on the host boot and on every phone boot, `pointer-events: none`,
  skipped entirely under `prefers-reduced-motion: reduce`.
- **Phone** screens are full-bleed: the `.player` column carries a purple→teal
  accent wash, the header rule is teal, the category is the same lozenge plate,
  the mini-board is bevelled, and below 480 px the card loses its max-width so
  the colour runs edge to edge.

---

## 3. Verification

Served from the repo root on `http://127.0.0.1:8674`.

| Check | Result |
| --- | --- |
| `cd games/wheel-of-fortune && node --test` | **71/71 pass**, 0 fail — before and after |
| `games/wheel-of-fortune/tests/harness.html` | **63/63 pass**, 0 fail, no uncaught — before and after (re-run three times across the change) |
| W-I1 specifically | still green: DOM rotation matches the core's wedge index, ≥ 3 turns, readout matches, reduced-motion spin still settles synchronously on the right wedge with `.wheel-faded` |
| Host at 1280×720, 6 players, full walk | `scrollHeight === 720` at every step: setup, toss-up (idle / revealing / buzzed / judged), regular round, spinning, after the spin, letter called, vowel bought, vowel called, solve dialog open, bonus picks, bonus timer running, bonus won, final standings. `scrollWidth === 1280` throughout |
| Setup with 6 players | 859 px — the one screen that scrolls, which brief §1 explicitly allows ("editors and setup lists may scroll"). Every play screen is 720 |
| Editor | scrolls (allowed); 10 rounds, 24-wedge preview, board previews and fit messages all render |
| Reduced motion | a CSSOM walk over every same-origin sheet the page loads (`theme.css`, `theme-components.css`, `timer.css`, `wheel.css`, `wheel-phone.css`) finds **zero** `@keyframes` and **zero** `animation:` declarations outside a `prefers-reduced-motion: no-preference` block, so under `reduce` no animation object is created. `document.getAnimations().length === 0` at rest. The spin itself still finishes under reduced motion by jumping to the result (`wheel-draw.js` unchanged) |
| Contrast (computed from the DOM, every element with a text node) | setup 20 samples, min **7.29:1** · toss-up 73 samples, min **5.73:1** · regular round 100 samples, min **5.73:1** · bonus 111 samples, min **5.68:1** · standings 8 samples, min **7.29:1** · editor 349 samples, min **7.29:1** · phone 320 px, min **7.29:1**. **Zero** pairs below 4.5:1 (3:1 for large text) on any surface |
| Focus rings | Tab reaches all 30 focusable controls on the game screen; `:focus-visible` gives a 3 px gold ring at 2 px offset on buttons, keycaps and podiums (verified with real Tab presses, not `.focus()`) |
| Phone at 320×640 | `scrollWidth === 320` (no horizontal scroll) on the wait, toss-up and turn screens. Keyboard keys **44 × 56 px**; SPIN / Buy a vowel / Solve **301 × 60 px**; the buzzer 180–210 px tall |
| Static gates | no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval` / `new Function` / `console.log` anywhere in the game's `index.html`, `css/` or `js/`. Largest file is `css/wheel.css` at **610** lines (limit 800). No new external URL — the sheets add none, and W-I7's external-URL gate is green |
| ids / classes | W-I7 green: `data-gsc-game="wheel-of-fortune"`, `#gsc-join`, `body.player-mode` and `body.gsc-embedded` all still present and wired. Every harness selector (`#board .tile`, `#wheel .wheel-rotor`, `#keyboard .key[data-letter]`, `#p-keyboard .key`, `#p-bonus-keys .key`, `#bonus-timer .timer-block`, `.off`, `#final-list .final-row`, `.ed-round`, `.ed-round-row input`, `.ed-preview-row`, `.ed-fit`, `.ed-fit-bad`, `.wedge-chip`, `#ed-wheel .wheel-wedge`) is untouched |

### Two layout fixes that came out of the 720 gate

Both are new CSS-only rules; both make a screen that used to overflow fit.

- **Six players.** `.podiums:has(> :nth-child(5))` puts the rail two-up. Without
  it a 6-player board ran to 951 px.
- **Bonus round.** The pick keypad and the bonus panel are on screen together;
  `.mid-col:has(> #bonus-panel:not(.hidden))` puts them side by side and
  `.stage-lower:has(#bonus-panel:not(.hidden))` narrows the (idle) wheel rail so
  the keypad keeps its 44 px keys without growing a row. Without them the bonus
  round ran to 834 px.

Both degrade to the old stacked layout if `:has()` is unsupported.

### One thing worth knowing

`.wheel` deliberately does **not** transition `filter`. Chrome cannot
interpolate `none` → a filter list and leaves the shadow pinned at zero, which
silently killed both the spin glow and the idle desaturation. The comment in the
sheet says so.

---

## 4. Screenshots

The screenshot tool available to this agent renders images into the
conversation but cannot write PNG files to disk, so no `ui-after-wheel-*.png`
files were produced. Surfaces the UI tester should capture:

`setup` (2 and 6 players), `tossup`, `tossup-buzzed`, `round-after-spin`,
`round-spinning` (for the glow), `solve-dialog`, `bonus`, `bonus-timer`,
`standings`, `editor`, `splash`, `phone-turn-320`, `phone-tossup-320`,
`phone-bonus-320`.

## 5. Notes for the orchestrator / tester

- The port used here was 8674; nothing is left running by this report.
- `document.getAnimations()` under an emulated `reduce` is worth re-checking
  with the tester's own emulation — this agent verified it through the CSSOM
  (every keyframe and every `animation:` gated) plus a live `getAnimations()`
  of 0 at rest, because the browser tool available here cannot emulate the
  media query.
- The contrast sampler used here walks up for the first opaque
  `background-color`. Every gradient surface in this game now declares a flat
  `background-color` underneath its gradient (tiles, keycaps, category plate,
  board felt, podiums, setup/modal cards, buzzer, phone tiles), the same fix the
  shell agent applied to `.btn-gold`, so a naive DOM sampler reads the true
  surface instead of the panel behind it.
