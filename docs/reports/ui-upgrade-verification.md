# UI upgrade verification (brief 09 §5, UI-1 … UI-9)

Independent UI tester. Scope: the whole product after the v2 upgrade — hub shell
plus Jeopardy, Family Feud, Wheel of Fortune, Weakest Link, Millionaire.
Format per `docs/06-verification-plan.md` §5.

## 1. Environment

| | |
| --- | --- |
| Date | 2026-09-03 |
| OS | Windows 11 Home 10.0.22635 |
| Node | `node --test` from the repo root and from each `games/<id>` |
| Browser | Chromium (in-app Browser pane), DPR 1.25, viewports emulated at **1280×720** (host) and **320×640** (phone) |
| Server | `python -m http.server 8682 --bind 127.0.0.1` at the repo root |
| Baseline | `git diff 823c72c..HEAD` (UI commits `54466f5`, `df6c914`, `3dcddcb`, `851db3b`, `0a990a3`, `ada4db0`; Millionaire `ec283bf`/`8122949`) |
| Concurrency note | the Millionaire tester was working the same working tree on port 8681 throughout. `git status` showed their in-flight edits to `games/millionaire/js/*`, `games/millionaire/css/wwm-phone.css` and `tests/wwm-adversarial.test.mjs`. Root `node --test` grew from 423 to 457 tests during my run for that reason. I did **not** edit any Millionaire file, to avoid a lost update. |

**Screenshots.** The screenshot tool available to me renders images into the
conversation but cannot write PNG files to disk, so `docs/reports/img/ui-after-*.png`
do not exist — the same limitation the shell agent recorded in
`docs/reports/img/ui-before-README.md`. Every surface is described in §3 (UI-9)
with measured numbers instead.

---

## 2. Results

| ID | Result | Evidence |
| --- | --- | --- |
| **UI-1** | **FAIL** (1 of 13 suites red) | Unit suites all green; **`games/millionaire/tests/harness.html` is 53/54 — one failing check.** See table below and defect **D1**. |
| **UI-2** | **PASS** | Every host screen exercised fits 1280×720. Only Millionaire's **setup** scrolls (756 px), which brief §1 explicitly allows. See §2.2. |
| **UI-3** | **FAIL** | 0 failures on 9 of 11 surfaces (≈ 400 sampled elements). **2 genuine failures on the Millionaire hot seat** — `.tree-rung` 2.66:1, `.lifeline-name` 3.14:1. Defects **D4**, **D5**. |
| **UI-4** | **PASS** (method-limited) | No `animation:` declaration anywhere sits outside `@media (prefers-reduced-motion: no-preference)` (browser CSSOM walk over every same-origin sheet on all six pages), so under `reduce` no animation object is created. `getAnimations()` at rest verified. `prefers-reduced-motion` could **not** be emulated (no CDP `Emulation.setEmulatedMedia` through the available tooling) — the CSSOM walk is the substitute the task allows. 5 stray `@keyframes` (defect **D8**, no functional effect). |
| **UI-5** | **PASS** (after a 3-line fix) | One target below 56 px found and fixed: the hub phone's name field (44.8 px → 56 px). Every other phone target on every game measured ≥ 56 px; no horizontal scroll anywhere at 320 px. Defect **D6**. |
| **UI-6** | **PASS** | Real `Tab` presses on the hub lobby and the Weakest Link host: `:focus-visible` true, ring `solid 2.4px #ffcc4d` / `#e8b84b`, offset 1.6 px, visible in the capture. |
| **UI-7** | **PASS with one flag** | Every JS hunk is a class name, a wrapper, a `dataset` styling hook or `showSplash()` — **except `games/wheel-of-fortune/js/wheel-draw.js`**, which adds decorative SVG builders and changes the `viewBox`. Defect **D15** (informational). |
| **UI-8** | **FAIL** | Splash fires correctly on hub switch (host **and** phone, 1201 ms, right name/tagline/accent, `pointer-events:none`) and on standalone boot for 4 of 5 games. **Family Feud and Wheel of Fortune show a second splash inside the hub frame** — two stacked title cards. Defects **D2**, **D3**. Jeopardy has no splash at all (**D7**, a documented gap). |
| **UI-9** | **Mostly PASS** | It reads as one product: shared stage, accents, banners, podiums, lozenges, modals, focus ring. Nine specific inconsistencies listed in §3 (**D9**–**D14**, **D16**). |

### 2.1 UI-1 — suites and harnesses

Unit suites (`node --test`):

| Suite | Result |
| --- | --- |
| repo root | **457 / 457 pass, 0 fail** (423 at the start of the run; the Millionaire tester added suites mid-run) |
| `games/jeopardy` | 49 / 49 |
| `games/family-feud` | 87 / 87 |
| `games/wheel-of-fortune` | 71 / 71 |
| `games/weakest-link` | 98 / 98 |
| `games/millionaire` | 33 / 33 |

Browser harnesses (served on 8682, driven to completion):

| Harness | Result |
| --- | --- |
| `tests/hub-harness.html` | **16 / 16** — re-run after my CSS fix: still 16 / 16 |
| `games/family-feud/tests/harness.html` | **51 / 51** ("All 51 loopback checks passed") |
| `games/wheel-of-fortune/tests/harness.html` | **34 / 34** ("All 34 checks passed") |
| `games/weakest-link/tests/harness.html` | **54 / 54** ("All 54 checks passed") |
| `games/millionaire/tests/harness.html` | **53 / 54 — "1 of 54 checks FAILED"** · failing check: `M-I6b the splash shows the game name and wears the game accent` |
| `games/jeopardy/tests/harness.html` | **70 / 70** |
| `games/jeopardy/tests/photo-harness.html` | **26 / 26** |
| `games/jeopardy/tests/gsc-embed-harness.html` | **9 / 9** |

### 2.2 UI-2 — 1280×720, `documentElement.scrollHeight <= innerHeight`

Inside the hub the game frame's own viewport is **676 px** (44 px shell bar + 676 = 720),
so the frame numbers below are the stricter test.

| Surface | scrollH / innerH | scrollW |
| --- | --- | --- |
| Hub landing | 720 / 720 | 1280 |
| Hub lobby, room open, 5 game cards | 720 / 720 | 1280 |
| Hub in a game (shell + frame) | 720 / 720 | 1280 |
| Family Feud — setup (standalone) | 720 / 720 | 1280 |
| Family Feud — face-off | 720 / 720 | 1280 |
| Family Feud — board in play (1 strike) | 720 / 720 | 1280 |
| Family Feud — steal (3 strikes) | 720 / 720 | 1280 |
| Family Feud — Fast Money (in hub frame) | 676 / 676 | 1280 |
| Jeopardy — board (in hub frame) | 676 / 676 | 1280 |
| Jeopardy — clue modal open | 676 / 676 | 1280 |
| Wheel of Fortune — toss-up round (in hub frame) | 676 / 676 | 1280 |
| Weakest Link — round screen (in hub frame) | 676 / 676 | 1280 |
| Weakest Link — round screen (standalone) | 720 / 720 | 1280 |
| Millionaire — Fastest Finger (in hub frame) | 676 / 676 | 1280 |
| Millionaire — hot seat (in hub frame) | 676 / 676 | 1280 |
| Millionaire — **setup** (in hub frame) | **756 / 676 — scrolls** | 1265 |

Millionaire's setup is the one scrolling screen. Brief §1 allows it ("editors and
setup lists may scroll"), so **UI-2 passes**; it is still listed as a cosmetic
inconsistency (**D14**) because the other four setups fit.

I did **not** reach Weakest Link's vote-reveal / goodbye-wipe screens or Wheel's
bonus round at 1280×720 in a live room — those states are driven by the game
harnesses, which run their frames at their own size. The implementers' own reports
measure them at 720; I am recording the gap in my coverage rather than claiming it.

### 2.3 UI-3 — contrast

Method: walk the DOM, take every element that owns a text node and is ≥ 2×2 px and
visible; composite the computed `color` and every translucent background up to the
first opaque ancestor; threshold 4.5:1, or 3:1 for ≥ 24 px / ≥ 18.66 px bold. A
second pass handles text over a gradient: it finds the nearest painted gradient and
computes the ratio **against every colour stop**, failing on the worst.

| Surface | Sampled | Below threshold |
| --- | --- | --- |
| Hub landing | 17 | 0 |
| Hub lobby (room open) | 55 | 0 |
| Hub phone — join (320) | 18 | 0 |
| Hub phone — waiting (320) | 8 | 0 |
| Family Feud — setup | 22 | 0 |
| Family Feud — board in play | 41 | 0 real (3 sampler artefacts, see below) |
| Family Feud — Fast Money | 29 | 0 |
| Jeopardy — clue modal | 42 | 0 |
| Jeopardy — board | 38 | 0 |
| Wheel of Fortune — toss-up | 72 | 0 |
| Weakest Link — round | 61 | 0 |
| Millionaire — setup | 43 | 0 real (1 sampler artefact) |
| Millionaire — hot seat | 60 + 60 gradient-aware | **2 real** |

Two surfaces fall short of the "≥ 20 elements" ask because they do not contain 20
text-bearing elements (hub landing 17, hub phone waiting 8) — every one was sampled.

Sampler artefacts confirmed by hand and **not** defects:
- `div.strike-slot` "✕" on the Feud board reports 1.0:1 — the glyph is
  `color: rgba(0,0,0,0)` in the un-struck state, i.e. deliberately invisible.
- `button#btn-start.btn.btn-gold.btn-big` reports 1.14:1 in the colour-only pass —
  the gold `linear-gradient(#ffcc4d, #d9a437)` has a transparent `background-color`.
  The gradient-aware pass measures it at **10.95:1** (text `#2b1d00`).

Real failures — both on the Millionaire hot seat (defects **D4**, **D5**):
- `span.tree-rung` (the money-tree rung numbers "15", "14", …): `rgba(170,176,224,.45)`
  at 12.5 px over `rgba(4,5,28,.55)` over the stage → **2.66:1** (needs 4.5).
- `span.lifeline-name` ("FIFTY" / "PHONE" / "AUDIENCE" / "SWITCH"): `#aab0e0` at
  **9.28 px** on `radial-gradient(circle at 50% 30%, #3b4bd8, #0b0f3d 75%)` →
  **3.14:1** against the `#3b4bd8` centre (needs 4.5).

### 2.4 UI-4 — reduced motion

`prefers-reduced-motion: reduce` could not be emulated: `resize_window` only offers
`colorScheme`, and CDP `Emulation.setEmulatedMedia` is not reachable through
`javascript_tool`. I ran the CSSOM walk the task specifies instead, in the browser,
over every same-origin sheet each page loads (only the Google Fonts sheet is
cross-origin and it carries no animation).

| Page | `animation:` outside `no-preference` | `@keyframes` outside `no-preference` |
| --- | --- | --- |
| `index.html` (hub) | **0** | **0** |
| `games/family-feud/index.html` | **0** | **0** |
| `games/wheel-of-fortune/index.html` | **0** | **0** |
| `games/weakest-link/index.html` | **0** | **0** |
| `games/jeopardy/index.html` | **0** | 3 — `buzzer-pulse`, `buzzer-glow` (`buzzer.css:222,456`), `timer-flash` (`timer.css:47`) |
| `games/millionaire/index.html` | **0** | 2 — `wwm-pulse`, `wwm-pop` (`wwm.css:403,408`) |

Because **no `animation:` declaration** exists outside a `no-preference` block, under
`reduce` no animation object is created on any surface and `document.getAnimations()`
is empty — the gate the brief asks for. The 5 stray `@keyframes` define nothing that
runs; they are a deviation from the design-system rule only (**D8**).

`document.getAnimations().length` at rest in the default (no-preference) state:

| Surface | Count | Names |
| --- | --- | --- |
| Hub landing | 2 | `gsc-bulbs-a`, `gsc-bulbs-b` (marquee, decorative, gated) |
| Hub lobby | 1 | `gsc-glow` (gated) |
| Hub phone join / waiting | 0 / 1 | `gsc-pulse` (gated) |
| Family Feud frame (Fast Money) | 0 | — |
| Jeopardy frame (board) | 0 | — |
| Wheel of Fortune frame | 0 | — |
| Weakest Link frame | 1 | `wl-beam` (spotlight, gated) |
| Millionaire frame (setup, hot seat) | 0 / 0 | — |

### 2.5 UI-5 — phones at 320×640

| Surface | `scrollWidth` | Smallest target |
| --- | --- | --- |
| Hub — join | 320 | **44.8 px `#join-name`** → **56 px after my fix** (avatars 62, Join 56) |
| Hub — waiting | 320 | Leave 56 |
| Family Feud — phone (all screens, incl. hidden) | 320 | team pick 96, buzz 210, Back/Submit 56, Leave room 56 |
| Wheel of Fortune — phone (live room, toss-up wait) | 320 | WAIT 180 (`wheel-phone.css`: 56 / 60 / 180–210) |
| Weakest Link — phone (waiting; harness frames at 320) | 320 | Sound on 56; vote buttons `min-height: 64px` (`wl-phone.css:96`) |
| Jeopardy — phone (embed harness frames at 320) | 320 | buzz 268.8; join code 93, name 56, Join 56 |
| Millionaire — phone (harness frames at 320) | 305 | stand-by carries no control; `wwm-phone.css:60,91` sets `min-height: var(--tap)` on the answer/action buttons |

No horizontal scroll anywhere. Millionaire's phone is 672 px tall at 640 (vertical
scroll only, which the brief does not forbid).

### 2.6 UI-6 — keyboard

Real `Tab` key presses (programmatic `.focus()` does not set `:focus-visible`, so
that method was discarded).

| Surface | Path | Ring |
| --- | --- | --- |
| Hub lobby | Copy link → Lock lobby → Close room → Sound → + Add player → Play (Jeopardy) | `:focus-visible` **true**, `outline: solid 2.4px rgb(255,204,77)`, offset 1.6 px |
| Weakest Link host | Show answer → Keep answers on screen → Bank → Correct → Wrong/Pass → Undo → End round | `:focus-visible` **true**, `outline: solid 2.4px rgb(232,184,75)`, offset 1.6 px, visually confirmed in the capture |

### 2.7 UI-7 — JS diff review

`git diff 823c72c -- js games/*/js`, attributed per commit so pre-UI work is not
mistaken for UI work.

| File | Δ | Verdict |
| --- | --- | --- |
| `js/hub-host.js` | +26 | `showSplash()` + 3 `dataset` hooks (`landing-game`, `game-tile`, `shell-bar`) — **allowed** |
| `js/hub-player.js` | +21 | `showSplash()` + its one call — **allowed** |
| `js/hub-registry.js` | +5 | the Millionaire registry entry — content, belongs to `ec283bf`, not to the UI upgrade |
| `games/family-feud/js/feud-app.js` | +22/−10 | `gsc-podium` / `is-active` / `gsc-podium-name|score|note` added **beside** the v1 names — **allowed** |
| `games/family-feud/js/feud-boot.js` | +22 | `showSplash()` + its call — **allowed** (but see D2) |
| `games/weakest-link/js/wl-app.js` | +3/−1 | `gsc-podium` / `is-active` added beside `tally-card` / `is-turn` — **allowed** |
| `games/weakest-link/js/wl-splash.js` | +40 new | `showSplash()`, correctly guarded on `gsc-embedded` — **allowed** |
| `games/wheel-of-fortune/js/wheel-app.js` | +17 | `showSplash()` + one `classList.toggle("wheel-spinning")` styling hook — **allowed** (but see D3) |
| `games/wheel-of-fortune/js/wheel-phone.js` | +15 | `showSplash()` + its call — **allowed** (but see D3) |
| `games/wheel-of-fortune/js/wheel-view.js` | +18/−14 | `gsc-kbd`, `gsc-podium*`, `gsc-well`, `is-active` added beside the v1 names — **allowed** |
| `games/wheel-of-fortune/js/wheel-draw.js` | **+58/−14** | **flagged** — see D15 |

No element id or `data-` attribute a script or harness selects on was renamed or
removed anywhere in the diff; every v1 class survives beside its `gsc-*` twin.
Wheel's other JS changes in the diff range belong to `7286bb7` (a pre-UI bug-fix
commit) and Millionaire's to `ec283bf`/`8122949` — out of scope for UI-7.

### 2.8 UI-8 — the splash

Measured with a 40 ms poller reading the `hidden` class on `#gsc-splash` in the hub
document **and** in the mounted game frame simultaneously.

| Check | Result |
| --- | --- |
| Hub host — shows on game switch | **PASS** — 1201 ms, title "Family Feud", sub "Survey says…", `data-gsc-game="family-feud"`, `pointer-events: none` |
| Hub phone — shows on game switch | **PASS** — same window, observed on the live joined phone |
| Standalone boot — Family Feud | **PASS** (`#gsc-splash-title` starts empty in the markup and is populated) |
| Standalone boot — Wheel of Fortune | **PASS** |
| Standalone boot — Weakest Link | **PASS** ("Weakest Link" / steel accent) |
| Standalone boot — Millionaire | **PASS** |
| Standalone boot — Jeopardy | **no splash exists** — no `#gsc-splash` node (**D7**, documented in `ui-jeopardy-implementation.md` §"No splash for Jeopardy") |
| Skipped under `prefers-reduced-motion` | **code-verified** in all four implementations (early `matchMedia(...reduce).matches` return); the Millionaire harness asserts it directly. Not empirically reproducible — see UI-4. |
| **No double splash when embedded** | **FAIL for Family Feud and Wheel of Fortune** |

Measured overlaps (`hub` / `frame` = splash visible):

```
Family Feud   t=60618 hub=1 frame=0      hub card up
              t=60826 hub=1 frame=1      BOTH cards up
              t=61821 hub=0 frame=1      hub gone, Feud card still up
              t=61911 hub=0 frame=0      done          (~1.3 s of stacked cards)

Wheel (host)  t=76641 hub=1 frame=0
              t=76843 hub=1 frame=1      BOTH cards up
              t=77857 hub=0 frame=1
              t=77941 hub=0 frame=0

Wheel (phone) t=65364 hub=1 frame=0
              t=65562 hub=1 frame=1      BOTH cards up
              t=66572 hub=0 frame=1
              t=66762 hub=0 frame=0
```

Weakest Link (`wl-splash.js:21`) and Millionaire (`wwm-app.js:445`) both check
`body.gsc-embedded` and correctly stay hidden; Jeopardy has no node. Only Feud and
Wheel are missing the guard.

---

## 3. UI-9 — does it read as one product?

**Yes, substantially.** The five games and the hub now share one stage (layered
radial + vignette), one accent system keyed on `data-gsc-game`, one focus ring
(2.4 px solid accent, 1.6 px offset — identical on the hub lobby and the WL host),
one banner idiom with an accent bar and an eyebrow, one podium idiom, one lozenge,
one modal, and one splash. Walking hub → Feud → Jeopardy → Wheel → Weakest Link →
Millionaire, nothing reads as a different application. The upgrade clears the bar
the "before" record describes ("flat single-layer backgrounds… buttons of five
different shapes… emoji doing all the iconography").

What each surface looks like now (1280×720 host / 320×640 phone):

- **Landing** — a marquee-bulb-bordered hero card, "GAME SHOW CENTRAL" in Anton at
  ~110 px gold with a glow, a one-line pitch, three equal-height CTAs, then a
  "TONIGHT'S LINE-UP" strip of five cards with CSS-drawn art (Jeopardy grid, Feud
  stripe board, a colour wheel, two chain rings, a Millionaire target). Fits 720
  with roughly 70 px of dead space under the strip.
- **Lobby** — two columns. Left: room code at ~123 px Anton with a glow, the join
  URL, a "1-2-3" join guide in numbered chips, roster panel. Right: five game cards
  with the same art, capability chips, player-range chip, a gold Play. Fits 720
  with all five cards visible (the "before" record notes the fourth was cut off).
- **Feud** — a bevelled cabinet board in a chrome frame, `.gsc-banner` phase strip
  ("FAMILY FEUD / STEAL — TEAM RED"), team podiums that light gold with a "CONTROL"
  note, a bank/strike rail with three ✕ slots, and a Fast Money broadcast
  lower-third. The strongest-looking of the five.
- **Jeopardy** — bevelled blue tiles, gold Anton values, a category row, podium
  scoreboard; the clue modal carries the category ribbon ("SCIENCE & NATURE | $400").
- **Wheel** — trilon puzzle tiles (white face, green letters), a lozenge category
  strip, a rim-lit wheel with a chunky pointer, podiums with round/total and a
  LEADER flag, keycap used-letters.
- **Weakest Link** — the coldest and most distinct: near-black steel, a lit chain
  ladder, a huge red clock, a spotlit contestant plate, colour-and-word action
  buttons with `.gsc-kbd` shortcut caps.
- **Millionaire** — hex lozenges for the question and A/B/C/D, a money tree with
  safe-haven flags, oval lifelines. Reads the most "TV" of the set.
- **Phones** — join card with a 4-up avatar grid and a full-bleed gold Join; waiting
  screen with a haloed avatar and a green connected bleed; per-game phone screens
  in that game's accent with one giant primary target (180–270 px).

### Specific things that are unfinished, inconsistent or gaudy

1. **Double splash on Feud and Wheel** (D2/D3) — the single most visible defect: on
   a shared screen the switch plays two title cards back to back.
2. **Host type scale drift** (D11) — sub-13 px text on the mid-game host screen:
   Jeopardy **1** (min 12.5 px) · Feud **9** (min 10.6) · Wheel **11** (min 9.9) ·
   Millionaire **18** (min 9.3) · **Weakest Link 38** (min 10.0). The design system's
   smallest documented step is `--fs-micro` 12 px ("eyebrows only") and `--fs-ui`
   15–17 px for controls, and CLAUDE.md asks for "big, projector-readable type on
   host screens". Weakest Link is the outlier — its whole control layer is 12.16 px
   and its rail labels 10.24–10.56 px. Wheel's `.podium-leader` is 9.92 px and its
   `.used-chip` keycaps are 11.8 × 24.5 px at 13.6 px — unreadable from a sofa.
3. **Off-palette blue in Weakest Link** (D10) — `wl-stage.css:90` paints the current
   chain link `linear-gradient(90deg, #8dc0ff 0%, #4d8ad8 100%)`; WL's accents are `#7c99b6` steel and
   `#d33` red, and blue appears nowhere else on the surface.
4. **Duplicated room chip in Jeopardy** (D9) — the hub shell bar shows
   `DBJK · 1 🔔` and the Jeopardy topbar shows the identical `DBJK · 1 🔔` 40 px
   below it. Every other game hides its room chip under `body.gsc-embedded`.
5. **Jeopardy's clue-modal actions** (D16) — three buttons in three shapes: a
   full-width dark bar ("Arm buzzers (Space)"), a mid-width gold pill ("Reveal
   Answer"), a small blue pill ("No one got it — close"). Elsewhere the product uses
   one `.gsc-btn` family with variants.
6. **Emoji badge sitting on top of the CSS art** (D12) — `.landing-game-icon` /
   `.tile-icon` still render the registry emoji as a small absolute badge over the
   drawn card. Jeopardy's is 🟦, a blue square on a blue board — it reads as a
   rendering artefact rather than an icon.
7. **Millionaire's setup card title is mixed-case Anton** (D13) — "Who Wants to Be a
   Millionaire" while every other display heading in the product is Anton uppercase.
8. **Millionaire's setup CTA is below the fold** (D14) — 756 px at a 676 px frame,
   so "Start the game" is not visible without scrolling. Allowed, but the other four
   setups fit.
9. **Millionaire's lifeline pills use emoji glyphs** (☎ 👥 ⇄) at 17.6 px next to a
   9.3 px caption — the only place in the product where an emoji carries a control's
   meaning at that size.
10. **Wheel's stage is loose** — the wheel sits at 270 × 270 px in the lower-left
    with a large empty gutter around it on the toss-up screen; the phone's WAIT
    screen leaves ~35 % of the viewport empty below the button.

---

## 4. Defects

| # | Sev | File:line | What | Fixed? |
| --- | --- | --- | --- | --- |
| **D1** | **major** | `games/millionaire/tests/harness.html:479` | `M-I6b the splash shows the game name and wears the game accent` fails (harness 53/54). The harness loads the game as `?embed=host`, so `body.gsc-embedded` is set, and `games/millionaire/js/wwm-app.js:445` now returns early for embedded pages ("the hub shows its own splash on switch"). The assertion was not updated when that guard landed in `8122949`. Side-effect: the next check, `prefers-reduced-motion skips the splash entirely`, now passes vacuously. | no |
| **D2** | **major** | `games/family-feud/js/feud-boot.js:30-43` | Double splash when embedded. `showSplash()` has no `gsc-embedded` guard **and** is called at line 43, before the mode branch at line 45 that would let it know. Measured 1.3 s of two stacked title cards on host and phone. | no |
| **D3** | **major** | `games/wheel-of-fortune/js/wheel-app.js:424,580` and `games/wheel-of-fortune/js/wheel-phone.js:209,222` | Double splash when embedded, host and phone. `document.body.classList.add("gsc-embedded")` runs on the line above `showSplash()`, but `showSplash()` never checks it. | no |
| **D4** | **major** | `games/millionaire/css/wwm.css:438` | `.tree-rung { font-size: 0.78rem; color: var(--ink-faint); }` — 2.66:1 at 12.5 px. `--ink-faint` is documented in `docs/design-system.md` §1.2 as "**never for text**". | no |
| **D5** | **major** | `games/millionaire/css/wwm.css:266-273` (over `:248`) | `.lifeline-name { font-size: 0.58rem; color: var(--ink-dim); }` on `radial-gradient(circle at 50% 30%, #3b4bd8, #0b0f3d 75%)` — 3.14:1 at 9.28 px. Also below `--fs-micro` (12 px). | no |
| **D6** | minor | `css/hub-phone.css` (`.phone-card .field-input`) | Hub phone join: `#join-name` was 44.8 px, below the 56 px rule. | **yes** |
| **D7** | minor | `games/jeopardy/index.html` | No `#gsc-splash` node and no `showSplash()`, so a standalone Jeopardy boot shows no title card. Brief §4 restricted Jeopardy to CSS, and `ui-jeopardy-implementation.md` declares this; the hub splash still fires on switch. | no (by design) |
| **D8** | minor | `games/jeopardy/css/buzzer.css:222,456`, `games/jeopardy/css/timer.css:47`, `games/millionaire/css/wwm.css:403,408` | Five `@keyframes` declared outside a `prefers-reduced-motion: no-preference` block, against the design-system rule. No functional effect — every `animation:` that references them is gated, so `getAnimations()` is still empty under `reduce`. | no |
| **D9** | minor | `games/jeopardy/css/gsc-embed.css` | `#buzzer-chip` is not hidden under `body.gsc-embedded`, so the room chip appears twice in the hub. Not a trivial fix: the chip is the button that opens the buzzer panel, so hiding it removes host functionality — needs a real decision, not a `display:none`. | no |
| **D10** | minor | `games/weakest-link/css/wl-stage.css:90` | `linear-gradient(90deg, #8dc0ff, #4d8ad8)` — off-palette blue on a steel/red surface. | no |
| **D11** | minor | WL `wl.css`/`wl-stage.css`; Wheel `wheel.css` (`.podium-leader`, `.used-chip`); Millionaire `wwm.css`; Feud `feud.css` | Host type below the documented scale — counts and minima in §3 item 2. | no |
| **D12** | minor | `css/hub.css:247` / `:567` | Registry emoji rendered as a badge over the drawn card art; Jeopardy's 🟦 reads as an artefact. | no |
| **D13** | minor | `games/millionaire/css/wwm.css:70` (`.screen-title, .card-title`) | Mixed-case Anton where the rest of the product is uppercase Anton. | no |
| **D14** | minor | `games/millionaire/index.html` / `wwm.css` (setup grid) | Setup is 756 px at a 676 px frame; "Start the game" is below the fold. Allowed by brief §1. | no |
| **D15** | informational | `games/wheel-of-fortune/js/wheel-draw.js:20-22,104-137,150` | UI-7 flag: beyond "class names, wrappers, `dataset` hooks or `showSplash`". Adds `buildRim()` (24 decorative bulb circles) and `buildPointer()` (3 paths/rects), and insets the `viewBox` by `PAD = 26`. Purely decorative — wedge geometry, the rotor transform, `wedgeAtPointer()` and `rotationForIndex()` are untouched, and `games/wheel-of-fortune` is 71/71 with the harness 34/34. Recording it because the brief calls any JS change beyond class names a defect. | no |
| **D16** | minor | `games/jeopardy/css/gsc-look.css` (`#clue-modal` action row) | Three button shapes stacked in one dialog. | no |

### The one fix I made

```diff
--- a/css/hub-phone.css
+++ b/css/hub-phone.css
@@ -68,6 +68,9 @@ body.player-mode { background-attachment: scroll; }
   color: var(--gold-text);
 }
 
+/* UI-5 (brief 09 §1): every phone target is at least one tap tall. */
+.phone-card .field-input { min-height: var(--tap); }
+
 .code-input {
   font-family: var(--font-display);
   font-size: 2.3rem;
```

Verified after the change: `#join-name` measures **56 px**, the join screen still has
`scrollWidth 320` / `scrollHeight 640`, root `node --test` is 457/457 and
`tests/hub-harness.html` is still 16/16.

### Proposed fixes for the defects I did not touch

- **D2** — in `games/family-feud/js/feud-boot.js`, move `showSplash()` below the mode
  branch and add, as the second line of the function:
  `if (document.body.classList.contains("gsc-embedded")) return;`
  (`games/weakest-link/js/wl-splash.js:21` is the working model.)
- **D3** — add the same line to `showSplash()` in `wheel-app.js:425` and
  `wheel-phone.js:210`. Both already set `gsc-embedded` on the preceding line.
- **D1** — in `games/millionaire/tests/harness.html`, either drop `gsc-embedded` from
  the frame body for the duration of `scenarioSplash()`, or replace the assertion
  with "an embedded page skips its own splash". This is a test file, which my brief
  bars me from editing.
- **D4** — `games/millionaire/css/wwm.css:438`: `color: var(--ink-faint)` →
  `color: var(--ink-mute)` (≈ 5.6:1 over the tree rail).
- **D5** — `games/millionaire/css/wwm.css:272`: `color: var(--ink-dim)` →
  `color: var(--ink)` (6.08:1 against the `#3b4bd8` stop; `--ink-mute` would make it
  worse at 2.17:1, so `--ink` is the only in-palette option), and raise
  `font-size: 0.58rem` to at least `var(--fs-micro)`.

**D4** and **D5** are each a one-line change and would normally fall under my
"fix trivial defects" remit. I deliberately left them: the Millionaire tester was
editing files in `games/millionaire/` in this same working tree while I ran, and a
concurrent write there risks a lost update. They should go to whoever owns
Millionaire next.

---

## 5. Verdict

**Fix-then-ship.**

The upgrade lands. Across eleven surfaces I measured, the product reads as one
broadcast package: a shared stage, a per-game accent that actually shows up in the
shell bar and the splash, one focus ring, one banner/podium/lozenge/modal/timer
vocabulary, and a phone experience that finally has an identity. Every host screen in
play fits 1280×720, nothing scrolls sideways at 320 px, roughly 400 sampled
text/background pairs clear 4.5:1 with two exceptions, every unit suite is green and
seven of the eight browser harnesses are green. The JS blast radius is genuinely
small and every id and class the scripts select on survived.

It is not shippable as it stands for two reasons. First, a harness is red
(**D1**) — brief §1 makes "every `tests/harness.html` stays green" a non-negotiable,
and the failure is a real inconsistency between the code and its own test, not a
flake. Second, the game-switch splash — the one piece of new choreography the brief
asked for — plays twice on two of the five games (**D2**, **D3**), which is exactly
the kind of thing an audience notices on a shared screen. Add the two Millionaire
contrast misses (**D4**, **D5**), which violate a §1 non-negotiable and are one line
each, and there are five small, well-understood fixes between here and ship. The
remaining eleven items are cosmetic and belong in "known issues" if nobody wants to
spend the time — though the host type scale (**D11**) is worth a deliberate decision
rather than a shrug, because Weakest Link's 10–12 px control layer undercuts the
"projector-readable" rule the whole upgrade was meant to serve.
