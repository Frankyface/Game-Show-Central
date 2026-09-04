# UI upgrade — Weakest Link (game agent)

Scope: brief `docs/09-ui-upgrade-brief.md` §4, the Weakest Link bullet — *cold
spotlight, the chain as a lit ladder with a glowing current link, the clock
huge, the goodbye card as a full-screen red wipe, vote reveal cards* — plus the
§4 "common" list (v2 tokens, splash, two-column setup, tidy editor, consistent
host toolbar, `.gsc-banner` phase banners, `.gsc-podium` podiums).

**No behaviour changed.** One JS line changed, and it adds class names only.
Every element id, every class a script or the harness selects on, every message,
the reducer, the clock's rAF/interval renderer and the sound engine are
untouched. `tests/harness.html` is **54/54 before and after**; `node --test` is
98/98 in the game and 423/423 at the root.

---

## 1. What changed

| File | Status | Lines | What |
| --- | --- | --- | --- |
| `games/weakest-link/index.html` | restructured | 370 | two-column setup, `.gsc-banner` phase strips, `.gsc-lozenge` category plates, `.gsc-panel`/`.gsc-card` surfaces, question plate, scroll wrappers, the `.gsc-splash` node, the new sheet + script tags |
| `games/weakest-link/css/wl.css` | rewritten | 506 | stage tokens, the one-screen page frame, `.btn` aliased onto the v2 look, host toolbar, setup card, phase banner + clock, control bar, embedded/player mode, responsive, **all motion** |
| `games/weakest-link/css/wl-stage.css` | **new** | 426 | the stage furniture: chain ladder, spotlight, money rail, ballot cards, statistics, head-to-head podiums, result, goodbye wipe, editor |
| `games/weakest-link/css/wl-phone.css` | rewritten | 158 | full-bleed phone in the steel/red accent, 64 px vote buttons, the SDK join card sized to the 56 px rule |
| `games/weakest-link/js/wl-splash.js` | **new** | 40 | `showSplash()`, copied from `js/hub-host.js` |
| `games/weakest-link/js/wl-app.js` | +1 net line | 797 | one class-name string (see §1.2) |

### 1.1 Why there are now two host sheets

`wl.css` came out of the rewrite at **873 lines**, over the 800-line house rule
(and over harness gate K-I6 V2, which fails at `>= 800`). It is split the same
way the shell agent split `shared/theme.css` → `theme-components.css`:
`wl.css` holds the tokens, the page frame, the buttons, the chrome and **every
`@keyframes` and `animation:` in the game**, so the motion rule has exactly one
place to be audited; `wl-stage.css` holds the furniture. `wl-stage.css` is
linked immediately after `wl.css` in `index.html`, so it wins where both
declare.

### 1.2 The only JS change (UI-7)

`git diff games/weakest-link/js/` is one hunk:

```js
-    const card = el("div", `tally-card${row.pid === core.turnPid ? " is-turn" : ""}`);
+    // + the design-system names; `tally-card`/`is-turn` stay (styling hook only).
+    const card = el("div", `gsc-podium tally-card${row.pid === core.turnPid ? " is-turn is-active" : ""}`);
```

`tally-card` and `is-turn` are kept verbatim (nothing was renamed or removed);
`gsc-podium` and `is-active` are added beside them so the head-to-head cards
really are `.gsc-podium`s. The harness selects `#wl-final-tally .tally-dot`,
`.hit` and `.miss` — all untouched.

`js/wl-splash.js` is new and self-contained: it reads no state, sends no
message, and only toggles `.hidden` on a `pointer-events: none` node.

Nothing else in `js/` changed. `wl-core.js`, `wl-clock.js`, `wl-editor.js`,
`wl-room.js`, `wl-phone.js` and `wl-sound.js` are byte-identical.

### 1.3 Class names: added, never replaced

Buttons keep their v1 names. Rather than adding `gsc-btn` next to `btn`
everywhere (a large markup diff for no gain), `wl.css` **aliases** `.btn`,
`.btn-ghost`, `.btn-blue/green/red/gold`, `.btn-big`, `.btn-small` onto the v2
look — the route `docs/design-system.md` §4 step 2 offers, and the one
`css/hub.css` itself takes. `.btn-tap` is re-declared after `.btn` so the SDK's
56 px phone button is not flattened by the aliased `.btn` (see §5.3).

Components adopted by adding the class beside the existing one:
`.gsc-banner` / `-title` / `-sub` / `-end` on all three phase strips ·
`.gsc-lozenge gsc-lozenge-sm` on both category plates · `.gsc-card` on the setup
card, the two statistics cards and the editor panels · `.gsc-panel` on the
question plate, both money boxes, the stats well and the three voting panels ·
`.gsc-podium` on the head-to-head cards · `.gsc-splash` for the title card.

---

## 2. The look

**Stage.** `:root` sets `--stage-deep #0e151d` / `--stage-night #05070a` and
lets the shared `body` rule build the layered stage out of them; the
`weakest-link` accent block in `shared/theme.css` (steel `#7c99b6` / red
`#d33`, glow `#16222e`) supplies `--accent`, `--accent-2` and the top spill. Ink
is re-tinted steel (`--ink #f4f7fa`, `--ink-dim #a7b2be`, `--ink-mute #8b96a3`)
instead of the hub's violet greys, and `--panel` is a little more solid than the
hub's glass because a near-black stage swallows a 6 % white panel on a
projector.

**One screen, never a page scroll.** `body` is a `100dvh` flex column with
`overflow: hidden`; `#wl-main` and each play screen are flex children that own
their height; the chain rail and the stats well scroll internally if they ever
have to. Setup and the editor are block boxes with `overflow-y: auto` — the two
surfaces brief §1 allows to scroll.

**The chain is a lit ladder.** `column-reverse` so the money climbs, the rungs
sharing the rail out between them (`flex: 1 1 0`) so the ladder is exactly as
tall as the stage whatever the chain length. Every rung carries an unlit stud;
a won rung lights its stud blue and fills with a blue wash plus a ✓; the current
rung is a glowing light-blue bar with dark ink. Banking flashes every won rung
gold twice.

> **Latent bug found and fixed in CSS.** `wlBank()` puts `.banked` on the
> `<ol id="wl-chain">`, but the old sheet only styled `.chain li.banked`, so the
> bank flash had never once fired. The new rule is `.chain.banked li.won`. CSS
> only; `wlBank()` is untouched.

**The clock** is Anton, tabular, `clamp(2.6rem, 5.6vw, 4.6rem)` (74 px at 1280),
sitting in the phase banner's end slot: dim when idle, cold white while running,
`#ff5a66` with a 1 s two-step pulse under ten seconds (`.danger`, set by
`wl-clock.js` — its logic is untouched), flat red at `0:00`.

**The spotlight** is a separate `::before` beam layer under the content, so the
slow 6 s breathe never dims the question. The player's name is lit
(`text-shadow` at two radii), the category is a hex-capped lozenge, the question
sits on a glass plate at up to 34 px.

**Ballots are cards** in an auto-fill grid: name, `•••` mask (lit blue *and*
heavier when a vote has arrived), and the host's override select. A revealed row
swaps to a gold rail, a gold Anton name and a `gsc-pop` arrival.

**The head-to-head** is two `.gsc-podium`s, the player in play lifted and
rail-lit, each with a row of ✓/✗ chips — round for a hit, **square** for a miss,
each with its own glyph and `title`, so the pattern reads without colour (WL-10
preserved).

**The goodbye** is a full-screen red radial wipe (`clip-path: inset(0 100% 0 0)`
→ `inset(0)`) with the name landing on `gsc-pop`.

**The splash** is the hub's `.gsc-splash` markup and a verbatim copy of
`showSplash()`: kicker, "Weakest Link" at `--fs-hero`, an accent rule, the
registry tagline, 1200 ms, `pointer-events: none`, `data-gsc-game` set so it
wears the steel accent. It is skipped under `prefers-reduced-motion: reduce`
**and** when `body.gsc-embedded` — inside the hub the shell already plays one on
the game switch, and two stacked title cards is one too many.

**The phone** is full-bleed: the card *is* the screen, a steel→red rail across
the top, a cold radial wash, 64 px vote buttons that fill *and* add a ✓ when
chosen (the tick is `::after` generated content, so `button.textContent` is
still just the name — the harness compares those strings). The SDK's join card
is styled from this sheet only; its markup belongs to `shared/bridge.js`.

**The hidden-answer toggle stays obvious**: the revealed answer is a gold dashed
chip and "Keep answers on screen" is a gold dashed pill with a gold check —
neither can be mistaken for ordinary chrome on a lit stage.

---

## 3. Verification

Served from repo root on `http://127.0.0.1:8675`; host measurements at
1280×720, phone at 320×640.

### 3.1 Suites

| Check | Before | After |
| --- | --- | --- |
| `games/weakest-link/tests/harness.html` | **54/54** | **54/54** |
| `cd games/weakest-link && node --test` | 98/98 | **98/98** |
| `node --test` (repo root) | — | **423/423** |
| `tests/hub-harness.html` (regression) | — | **16/16** |

### 3.2 UI-2 — every host screen fits 1280×720

Measured as `documentElement.scrollHeight - innerHeight` and
`scrollWidth - innerWidth` after a full walk of the game:

| Screen | vertical overflow | horizontal overflow |
| --- | --- | --- |
| setup (5 players) | 0 | 0 |
| round | 0 | 0 |
| round, clock running | 0 | 0 |
| voting | 0 | 0 |
| voting + statistics panel open | 0 | 0 |
| votes revealed | 0 | 0 |
| tiebreak | 0 | 0 |
| vote result | 0 | 0 |
| goodbye | 0 | 0 |
| final intro | 0 | 0 |
| head-to-head | 0 | 0 |
| result | 0 | 0 |
| editor | 0 | 0 (scrolls **internally**, as brief §1 allows) |

Also checked **inside the hub frame** (1280×676, the height left by the 44 px
shell bar) with `body.gsc-embedded`: setup, round and voting all report 0/0, the
Phones setup block is correctly hidden.

### 3.3 UI-3 — contrast

Sampled from the live DOM: every element with a text child, alpha-composited
down the ancestor chain to the stage base, WCAG ratio against its own effective
background, threshold 4.5:1 (3:1 for ≥24 px or ≥18.66 px bold).

| Surface | elements | failures | worst pair |
| --- | --- | --- | --- |
| host toolbar | 4 | 0 | `.topbar-eyebrow` 6.69 |
| setup | 36 | 0 | Start button 5.37 |
| round | 54 | 0 | `.money-label` 6.11 |
| voting (open) | 22 | 0 | `.stats-kicker` 6.11 |
| votes revealed | 19 | 0 | red tie buttons 7.06 |
| vote result | 15 | 0 | eliminate button 7.06 |
| goodbye | 2 | 0 | `.goodbye-line` 14.62 |
| final intro | 5 | 0 | blue pick buttons 6.45 |
| head-to-head | 17 | 0 | `.tally-dot.miss` 6.01 |
| result | 9 | 0 | Play again 5.37 |
| editor | 145 | 0 | `.field` labels 6.11 |
| phone — vote | 12 | 0 | `.phone-money .k` 6.11 |
| phone — goodbye | 3 | 0 | `.phone-status` 9.37 |
| phone — winner | 4 | 0 | `.phone-sub` 9.37 |

**Four real failures were found and fixed** (they are worth knowing about
because the same pattern will bite the other games):

1. `.btn-green` "Correct" was **3.08:1** — near-black ink on a green that got
   too dark at the bottom of its gradient. A label sits across the *whole*
   button face, so **both ends of every gradient** now have to clear the
   threshold, not the average. All four action-button ramps were narrowed:
   blue `#2f6cb4→#1e4c88` (white, 5.3–9.0), green `#57cd93→#2f9d6a`
   (`#03150c`, 5.6–9.5), red `#cf2a35→#8d0b15` (white, 5.2–11), gold unchanged.
   The old blue ramp's top was 3.5:1 with white and would have failed too.
2. The pressed phone vote button was **2.5:1** at the top of its ramp. It is now
   a flat `#1d5fa8` with white at 6.5:1 across the whole face, plus an inner
   ring and the ✓.
3. `.tally-dot.miss` was **4.24:1** (white ✗ on `--stage-red`). Now `#c31824`,
   6.0:1. The square shape and the glyph already carried the meaning; this is
   just legibility.
4. Gradient-only surfaces read as *false* failures to a DOM sampler (the current
   chain rung scored 1.07 because `background-color` was `transparent` and the
   walk fell through to the stage). Following the hub report's note, every
   surface that carries text now declares a flat `background-color` under its
   gradient: the four buttons, `.chain li.current`, `.q-cat`.

### 3.4 UI-4 — reduced motion

Two independent checks.

*Static.* A parser over all three sheets (comments blanked, brace depth tracked)
looking for any `@keyframes` or `animation:` outside a
`@media (prefers-reduced-motion: no-preference)` block:

```
css/wl.css        -> CLEAN
css/wl-stage.css  -> CLEAN
css/wl-phone.css  -> CLEAN
```

*Empirical.* Every `prefers-reduced-motion: no-preference` media block reachable
from the page — **8 of them**, including the ones imported from
`shared/theme.css` and `shared/theme-components.css` — was switched to
`not all`, which is exactly what the browser does under `reduce`. Then the game
was walked again:

| Point | `document.getAnimations().length` |
| --- | --- |
| boot / setup | 0 |
| splash forced open | 0 |
| round + bank flash | 0 |
| votes revealed | 0 |
| goodbye | 0 |

Under normal motion the only persistent animation on a play screen is
`wl-beam` on the spotlight's decorative `::before` layer.

### 3.5 UI-5 — phone at 320×640

`scrollWidth === innerWidth === 320` on the join screen and the vote screen — no
horizontal scroll. Targets:

| Control | size |
| --- | --- |
| vote button ×4 | 284.8 × **64** |
| join room-code field | 288 × **56** |
| join name field | 288 × **56** |
| Join | 288 × **56** |
| toolbar "Sound on" | 82.7 × **56** |

### 3.6 UI-6 — keyboard

Real `Tab` presses (not `.focus()`, which does not arm `:focus-visible`):
`btn-final-show-answer` → `btn-final-correct` → `btn-final-wrong` → …, each
matching `:focus-visible` with `outline: 3px solid #e8b84b` and a 2 px offset —
the shared gold ring. The old sheet's blue `.btn:focus-visible` override was
dropped so the ring is the same one the hub and the other games use;
`--focus: #ffd35e` is declared in this game's `:root`.

### 3.7 UI-8 — the splash

| Condition | shown? |
| --- | --- |
| standalone host / standalone phone | yes — "Weakest Link" · "Bank it before the chain breaks." · `data-gsc-game="weakest-link"` |
| after 1200 ms | auto-hidden |
| `prefers-reduced-motion: reduce` | **no** |
| `body.gsc-embedded` (inside the hub) | **no** — the shell already played one |
| `pointer-events` | `none` |

### 3.8 Static gates

| Gate | Result |
| --- | --- |
| no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval` / `new Function` | clean across `index.html`, all CSS, all JS |
| no `console.log` | clean |
| every file < 800 lines | largest is `wl-app.js` at **797**; `wl-core.js` 796; `wl.css` 506; `wl-stage.css` 426; `index.html` 370 |
| only Google Fonts URLs in `index.html` | clean |
| `data-gsc-game="weakest-link"` + `#gsc-join` present | yes (harness K-I6 V7) |

---

## 4. Screenshots

The screenshot tool available to this agent renders into the conversation but
**cannot write PNG files to disk**, so no `ui-after-weakest-link-*.png` files
were produced. Surfaces the UI tester should capture, all reachable from
`http://127.0.0.1:<port>/games/weakest-link/index.html`:

`splash` · `setup` · `round` (chain lit, answer revealed) · `round-clock-danger`
· `voting` · `voting-revealed` · `voting-stats` · `goodbye` · `final-intro` ·
`head-to-head` · `result` · `editor` · `phone-join-320` · `phone-vote-320` ·
`phone-goodbye-320`.

---

## 5. Things the orchestrator and the UI tester should know

### 5.1 Two new files are outside the harness's gate lists

`tests/harness.html` is not mine to edit. Its `SOURCES` array (K-I6: line count,
banned sinks, `console.log`) and its `ASSETS` array (the stale-bundle
cache-buster) both name files individually, so **`css/wl-stage.css` and
`js/wl-splash.js` are currently ungated and un-cache-busted**. Both pass the
gates today (§3.8) — I ran them by hand — but somebody who owns `tests/` should
add these two strings to `SOURCES` and to `ASSETS`. Nothing fails without it;
the coverage is just thinner than it looks.

While testing, note that a plain reload can serve a **stale `wl-stage.css`** from
the browser cache (it cost me one wrong measurement). Cache-bust the `<link>`
hrefs before measuring.

### 5.2 A pre-existing bug I deliberately did **not** fix

`#btn-exit` ("Back to lobby") carries the `hidden` class in the markup, and
`wl-room.js` never removes it — it only attaches a click handler. The rule
`body.gsc-embedded #btn-exit { display: … }` loses to
`.hidden { display: none !important }`, so **the button has never been visible
in the hub**, before this change or after. Fixing it means either removing
`.hidden` in `wl-room.js` (a functional change, which brief §1 forbids me) or
forcing the CSS with `!important` (which would put a new control on screen).
I left it exactly as it was and am flagging it instead. Nothing tests it;
`docs/reports/weakest-link-verification.md` V7 only asserts it is hidden on an
embedded *phone*, which stays true either way.

### 5.3 `.btn-tap` was being flattened

`shared/theme.css` gives the SDK's join button `.btn-tap { min-height: 56px }`.
A game sheet that redeclares `.btn` with its own `min-height` silently wins
(equal specificity, later sheet) and drops that button to whatever the game
chose — 42 px here. Any other game aliasing `.btn` needs to re-declare
`.btn-tap` after it, as `wl.css` now does. Worth a line in
`docs/design-system.md` §4.

### 5.4 `.gsc-timer` is deliberately not adopted

Brief §4's common list says "every timer a `.gsc-timer`". `.gsc-timer` is a
lit-block bar built from child `<i class="gsc-timer-block">` elements; the
Weakest Link clock is an `mm:ss` readout that `wl-clock.js` writes with a single
`textContent` from its rAF loop. Adopting the component would mean rewriting
that renderer, which the task explicitly forbids. The clock instead borrows the
component's *language* — tabular numerals, the same urgent red, the same
`.danger` escalation — at the size brief §4 actually asks for ("the clock
huge"). Flagging it so it does not read as an oversight in UI-9.

### 5.5 Not touched

`shared/**`, `tests/**`, other games, `wl-core.js`, `wl-clock.js`,
`wl-editor.js`, `wl-room.js`, `wl-phone.js`, `wl-sound.js`, `questions.json`,
`data.js`. No commit or push was made.

---

## 6. After UI verification — D11 (type sizes) and D13 (chain palette)

Follow-up pass answering `docs/reports/ui-upgrade-verification.md` **D11**
(38 text elements under 13 px on the mid-game host screens, minimum 10 px, the
whole control layer at 12.16 px) and **D13** (the current chain link was an
off-palette blue). CSS only — no markup and no JS changed in this pass.

### 6.1 The rule now applied

- **Controls** — every button, input, select and textarea — are on
  `var(--fs-ui, 15px)` (15 px at 1280). `.btn-small` went 12.16 → 15 px, so the
  toolbar, "Start clock" and "Show answer" are no longer the smallest text on
  the stage; its `min-height` went 34 → 38 px to keep the proportions.
  `.btn kbd` (the `B` / `Space` / `X` hints) went ~11 → 14 px.
- **Labels, hints and data** are on a hard **14 px** floor: `.hint`,
  `.hint-inline`, `.source-note`, `.setup-heading`, `.count-badge`, `.field`,
  `.q-cat`, `.chain-tick`, `.vote-voter`, `.stats-detail`, `.stats` body and
  **both table header rows** (column headers are labels, not decoration, and
  the money rail was widened `15rem → 16.5rem` to hold them).
- **Eyebrows stay at exactly `--fs-micro` (12 px)** and nothing anywhere is
  below it. The 10 px offenders (`.topbar-eyebrow`, `.money-label`) came *up*
  to 12. The eyebrows are `.topbar-eyebrow`, `.kicker`, `.rail-label`,
  `.money-label`, `.stats-kicker`, `.player-tag`, `.phone-kicker` — all
  uppercase, wide-tracked, decorative or metadata.
- Several eyebrow colours moved `--ink-mute → --ink-dim` so the smallest type
  is also the higher-contrast type.
- The phone got the same floor: `.phone-sub` / `.phone-status` → `--fs-ui`,
  `.phone-money .k` 9.6 → 12 px, and the SDK join card's `.field-label`
  12.5 → 14 px.

### 6.2 Measured minimum font size per screen (1280×720)

| Screen | elements | **min font-size** | below 14 px | vertical scroll | horizontal scroll |
| --- | --- | --- | --- | --- | --- |
| host toolbar | 4 | **12 px** | `.topbar-eyebrow` (eyebrow) | 0 | 0 |
| setup | 36 | **12 px** | `.kicker`, `.player-tag` ×5 (eyebrows) | 0 | 0 |
| round | 54 | **12 px** | `.rail-label`, `.money-label` ×2 (eyebrows) | **0** | 0 |
| round, clock running | 54 | **12 px** | same three eyebrows | **0** | 0 |
| voting | 22 | **12 px** | `.stats-kicker` ×2 (eyebrows) | **0** | 0 |
| vote result | 15 | **14 px** | none | **0** | 0 |
| goodbye | 2 | **35.2 px** | none | **0** | 0 |
| final intro | 5 | **12 px** | `.kicker` (eyebrow) | **0** | 0 |
| head-to-head | 17 | **14 px** | none | **0** | 0 |
| winner | 9 | **12 px** | `.kicker` (eyebrow) | **0** | 0 |
| editor | 344 | **14 px** | none | **0** (scrolls internally) | 0 |
| phone 320×640 | — | **12 px** (`.phone-kicker`) | eyebrow only | n/a | **0** |

Every remaining sub-14 px element is exactly 12 px and is an eyebrow, per the
brief's "`--fs-micro` 12 px for eyebrows only". The previous 10 px minimum and
the 12.16 px control layer are both gone.

### 6.3 A layout bug the bigger type exposed

The editor started reporting `documentElement.scrollHeight − innerHeight = 45`.
Two causes, both fixed:

1. `body { overflow: hidden }` under an `overflow: visible` `html` **propagates
   to the viewport** and computes back to `visible` on the body itself, so
   `documentElement.scrollHeight` kept reporting the union of the content.
   `html` is now the clipper (`html { height: 100%; overflow: hidden }`),
   released again under 780 px so phones scroll normally.
2. The editor's `position: sticky` table header leaked scrollable overflow past
   its own `overflow-y: auto` box. `.screen-setup, .screen-editor` are now
   `position: relative`, which contains it.

The editor still scrolls internally (`clientHeight 665`, `scrollHeight 916`) —
brief §1 allows that — but the **page** no longer scrolls on any screen.

### 6.4 D13 — the chain is on the accent tokens

`.chain li.won` and `.chain li.current` were hand-picked sky blues
(`#8dc0ff` / `#4d8ad8` / `#6fa8e8`). They are now derived entirely from the
Weakest Link accent in `shared/theme.css`:

```css
.chain li.current {
  color: var(--accent-ink, #06101a);
  background-color: var(--accent);
  background-image: linear-gradient(90deg,
    color-mix(in srgb, var(--accent) 74%, #ffffff 24%) 0%, var(--accent) 100%);
  border-color: color-mix(in srgb, var(--accent) 56%, #ffffff 40%);
  box-shadow: 0 0 26px color-mix(in srgb, var(--accent) 55%, transparent);
}
```

The won rungs and their lit studs use `color-mix` over `--accent` too, so the
ladder tracks the accent if it ever moves. Contrast on the current rung is
**6.46:1** (`--accent-ink` on `--accent`).

### 6.5 Re-verification

| Check | Result |
| --- | --- |
| `tests/harness.html` on `http://127.0.0.1:8675` | **54/54** |
| `cd games/weakest-link && node --test` | **98/98** |
| every play screen at 1280×720 | vertical scroll **0**, horizontal **0** (table §6.2) |
| contrast, re-sampled after the colour moves | **0 failures** — toolbar 6.69, round 6.46 (the accent chain rung), voting 6.45, editor 6.11 |
| phone 320×640 | no horizontal scroll; targets 56 / 56 / 56 / 64 px |
| reduced motion static audit | all three sheets **CLEAN** (no `@keyframes` or `animation:` outside the `no-preference` guard) |
| no `innerHTML` / `console.log`, files < 800 lines | clean; largest `wl-app.js` 797, `wl.css` 517, `wl-stage.css` 433 |
