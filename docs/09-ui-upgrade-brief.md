# 09 — UI upgrade brief: one broadcast-grade look across the hub and every game

Status: **approved** · Applies to: shell, jeopardy (styling only), family-feud,
wheel-of-fortune, weakest-link, millionaire.
Goal: the whole product should look like one premium TV game-show package on a
shared screen, and feel native on a phone. **Behaviour does not change.**

## 1. Non-negotiables

- No functional changes. Every element id, data attribute and body class the
  scripts and harnesses use stays. Every `node --test` suite and every
  `tests/harness.html` stays green; run them before and after.
- House rules still apply (`CLAUDE.md`): no `innerHTML`, files < 800 lines,
  no new dependencies, Google Fonts only (Anton + Inter are already loaded;
  you may add one display face from Google Fonts if it clearly improves the
  look, with a real fallback stack).
- Accessibility keeps or improves: contrast ≥ 4.5:1 for text, ≥ 3:1 for large
  text, focus rings visible, `prefers-reduced-motion` disables all decorative
  motion, colour never the only signal, phone targets ≥ 56 px, 320 px width
  with no horizontal scroll.
- Host screens fit 1280×720 with **no vertical scroll** in normal play
  (editors and setup lists may scroll).

## 2. Design system v2 (`shared/theme.css`) — the shell agent owns this

Add, don't break, the v1 tokens. New tokens and utilities every game may use:

- **Stage**: `--stage-bg` (layered radial gradient + subtle vignette),
  `--stage-glow` (a game-accent glow), `--panel` (glass panel:
  `rgba(255,255,255,.06)` + 1px `rgba(255,255,255,.12)` border + blur 12px),
  `--panel-strong`, `--ink`, `--ink-dim`, `--ink-mute`, `--accent`,
  `--accent-2`, `--gold`, `--green`, `--red`, `--amber`.
- **Type scale**: `--fs-hero` (clamp 64–140 px), `--fs-display` (40–72),
  `--fs-title` (28–40), `--fs-body` (18–22), `--fs-ui` (15–17); display face
  Anton with tight letter-spacing; UI face Inter.
- **Motion**: `--dur-fast 120ms`, `--dur 220ms`, `--dur-slow 480ms`,
  `--ease-out`, `--ease-spring`; keyframes `gsc-pop`, `gsc-flip`, `gsc-glow`,
  `gsc-shimmer`, `gsc-rise`; all wrapped in `@media (prefers-reduced-motion:
  no-preference)`.
- **Components** (class names, all prefixed `gsc-`): `.gsc-panel`,
  `.gsc-card`, `.gsc-btn` (+ `-primary`, `-ghost`, `-danger`, `-big`,
  `-icon`), `.gsc-chip`, `.gsc-badge`, `.gsc-banner` (phase banner with
  accent bar), `.gsc-podium` (name + score + active state), `.gsc-lozenge`
  (hexagonal end caps via clip-path), `.gsc-tile` (board tile with flip
  faces), `.gsc-timer` (red-block countdown, shared look), `.gsc-toast`,
  `.gsc-modal`, `.gsc-kbd` (keyboard key), `.gsc-pill-status` (🟢/🔴 with
  text), `.gsc-splash` (full-screen title card with logo text and subtitle).
- **Per-game accent** via `body[data-gsc-game="…"]` setting `--accent`,
  `--accent-2`, `--stage-glow` (Jeopardy blue/gold, Feud red/gold, Wheel
  purple/teal, Weakest Link steel/red, Millionaire navy/violet, hub
  midnight/gold).

Document every class with a one-line example in `docs/design-system.md`
(the shell agent writes it) so the game agents work from one reference.

## 3. Hub (shell agent)

- **Landing**: a hero with an animated marquee-light border (CSS only), the
  title in the display face, three clear calls to action, a strip of game
  cards below with CSS-drawn art per game (no images): Jeopardy board grid,
  Feud answer board, a wheel segment, a chain link, a diamond/hex lozenge.
- **Lobby**: the room code as the hero (glow, subtle shimmer), join URL with a
  one-click copy chip, a QR-free "join in 3 steps" mini guide, roster cards
  with avatar/colour/status, game cards with capability chips and a hover
  lift, night scoreboard as a leaderboard panel.
- **Shell bar** in a game: compact, translucent, game name in the display
  face with the accent, connection chip, Lobby button.
- **Phone controller**: full-bleed accent colour per screen, giant name +
  avatar on the waiting screen with a soft pulse, reconnect banner with an
  animated dot, join screen with big fields and avatar grid.
- Add a per-game **splash** on game switch (host and phone): 1.2 s title card
  (`.gsc-splash`) then the game; skipped under reduced motion.

## 4. Games (one agent each; styling + tiny render-glue changes only)

Common: adopt the v2 tokens/components, add the splash, restyle setup screens
as a clean two-column card, restyle editors as tidy forms, unify sound/undo/
lobby controls in a consistent host toolbar, make every phase banner a
`.gsc-banner`, every timer a `.gsc-timer`, every podium a `.gsc-podium`.
Keep each game's identity:

- **Jeopardy** (`games/jeopardy/css/*` and `gsc-embed.css` only; no JS edits
  beyond none): richer board tiles (bevel, flip reveal), clue modal with the
  category ribbon, scoreboard podiums, phone buzzer with a deeper red/green.
  Upstream tests and harnesses must stay green.
- **Family Feud**: the survey board with a chrome frame and bevelled slots,
  flip reveal with a light sweep, the strike overlay as three giant X's with
  a shake, team panels as podiums, Fast Money as a broadcast lower-third.
- **Wheel of Fortune**: puzzle tiles with a glossy white face and green
  letters, category strip as a lozenge, wheel with rim lights and a chunky
  pointer, podiums with round/total, used-letter board as keycaps.
- **Weakest Link**: cold spotlight, the chain as a lit ladder with a glowing
  current link, the clock huge, the goodbye card as a full-screen red wipe,
  vote reveal cards.
- **Millionaire**: built directly on v2 (see 08 §3).

## 5. Verification (UI tester)

Deliverable `docs/reports/ui-upgrade-verification.md` with before/after
screenshots in `docs/reports/img/ui-*.png` (the shell agent captures
"before" for every surface first, at 1280×720 and 320×640, and stores them as
`ui-before-*.png`):

- **UI-1** every unit suite and every harness green after the change.
- **UI-2** each host screen fits 1280×720 with no vertical scroll in play.
- **UI-3** contrast checks on every text/background pair (compute from the
  DOM: sample 20 elements per surface).
- **UI-4** reduced motion: with the media query emulated, no animations run
  (check `getAnimations()` is empty on each surface).
- **UI-5** phones at 320×640: no horizontal scroll, targets ≥ 56 px.
- **UI-6** keyboard: Tab reaches every control, focus ring visible.
- **UI-7** ids/classes used by scripts unchanged (`git diff` review of every
  JS change; any JS change beyond class names is a defect).
- **UI-8** the splash appears on switch and is skipped under reduced motion.
- **UI-9** a subjective pass: does each surface read as the same product?
  List anything that looks unfinished.
