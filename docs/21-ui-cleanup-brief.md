# 21 — UI cleanup brief: make it look real, not generated

Status: **approved** · Applies to: hub, every game. Behaviour unchanged; every
harness stays green. Owner of the shared pass: the hub/design agent; then one
pass per game.

## 1. What reads as fake today (from the live site)

- **Marquee-bulb borders and glowing gold titles.** A real broadcast package
  uses one strong idea per screen and a lot of dark space; the bulbs plus
  glow plus gradient reads as a theme-park mock-up.
- **CSS-drawn "card art".** The little stripes, rings and rectangles on the
  game cards look like placeholder wireframes, and the emoji badge on top
  makes it worse. Nothing on a real show's menu looks like that.
- **Emoji as iconography** on host screens (toolbars, chips, titles).
- **Everything in Anton uppercase with letter-spacing.** When every label is
  a shout, nothing is. Decorative eyebrows ("WELCOME TO", "SURVEY SAYS…") on
  every panel.
- **Glass panels everywhere**: translucent boxes with borders and blur inside
  other translucent boxes, each with its own accent rail.
- **Saturated gradients under text** and accent glows on buttons; rounded
  pill buttons with uppercase tracking (a generic SaaS look).
- **Generic copy**: "Game shows for your video call — share your screen,
  players use their phones." is fine, but taglines like "Survey says…" and
  "Bank it before the chain breaks." on cards read as filler.

## 2. The new direction: quiet, editorial, broadcast

Think the title cards and lower-thirds of a real network game show, or a
well-made TV app: flat dark stage, one accent per game, precise typography,
real spacing, nothing decorative that does not carry information.

Rules (shared tokens and components get updated first; games follow):

1. **Type.** Keep Anton for the one hero word per screen (the game name, the
   money amount, the room code). Everything else is Inter: sentence case,
   normal tracking, weights 400/500/600 only. Kill decorative eyebrows; keep
   a label only when it names a control group. Body ≥ 16 px, controls ≥ 15 px.
2. **Colour.** Each game keeps its accent, used for exactly: the active
   state, the primary button, one rule or underline. Stage is a flat dark
   (`#0b0d12`-family with the game's tint at ≤ 6 %), no radial spotlights,
   no vignette, no glow on text, no neon. Gold is reserved for money.
3. **Surfaces.** One panel level: a flat surface 1 step lighter than the
   stage, 1 px hairline border at 10 % white, radius 8 px. No blur, no
   nested panels, no accent rails. Dividers are hairlines.
4. **Buttons.** Rectangular with 6 px radius, 44–48 px tall on host, 56 px on
   phones, sentence case, weight 600. Primary = accent fill with its
   `--accent-ink`; secondary = hairline outline; danger = red outline. No
   gradients, no glow, no uppercase.
5. **Iconography.** No emoji on host screens. Where an icon helps, use a
   16–20 px inline SVG from a single consistent set (draw them in
   `shared/icons.js` as a tiny registry: sound, settings, back, undo, lobby,
   edit, phone, check, cross, play, pause, chevron). Emoji remain only for
   player avatars on phones and in rosters.
6. **Game cards.** Replace the drawn art and emoji with a clean card: the
   game name in Anton (large), a one-line factual description of how it
   plays ("Teams guess survey answers; three strikes and the other team can
   steal."), a small row of plain-text capability tags, and a thin accent
   bar on the left edge. Cards are the same height; the grid never scrolls
   inside a panel at 1280×720 (reflow to fewer columns + page scroll instead).
7. **Landing.** The title, one sentence, three buttons, the cards. No
   marquee, no "Welcome to", no shimmer. The lobby: room code is the only
   hero (Anton, large, plain), join URL as a copyable line, roster as a
   plain list with avatar + name + status dot, game cards as above, night
   scoreboard as a plain table.
8. **Motion.** Keep only the motion that carries meaning (reveal flips,
   wheel spin, case open, clock). Remove hover lifts, shimmer, pulses on
   idle elements, splash glow. The game-switch splash becomes a 600 ms
   plain title card (name in Anton on the game's flat stage).
9. **Host toolbars.** One consistent bar across every game: game name (Inter
   600, 18 px), then on the right: Sound, Editor, Game lobby, and (embedded)
   nothing else. Icons + text labels. Same order everywhere.
10. **Copy.** Remove tagline-speak from UI chrome. Setup screens explain in
    one plain sentence what to do next. Error messages stay as they are
    (they are already plain).

## 3. Mechanics of the pass

- The hub/design agent updates `shared/theme.css` and
  `shared/theme-components.css` to the rules above (v3 tokens: keep every v2
  token name so games do not break; change the values; add `--surface`,
  `--hairline`, `--radius-sm`), adds `shared/icons.js`, rebuilds the hub
  (landing, lobby, shell bar, phone controller, splash), and updates
  `docs/design-system.md` with a "v3: what changed" section and a per-game
  checklist. Captures before/after measurements in the report.
- Each game then does a **CSS + markup-only** pass against the checklist
  (JS edits only for class names, icon insertion via `GSCIcons`, and the
  toolbar order). Every harness green before and after; every file < 800
  lines; contrast ≥ 4.5:1; 1280×720 and 1280×676 no scroll in play; phone
  320×640 targets ≥ 56 px; reduced motion clean.
- The UI tester repeats `docs/09` §5 UI-1…UI-9 and adds **UI-10**: no emoji
  in any host-screen DOM text outside roster/avatar elements; **UI-11**: no
  element uses `backdrop-filter`, `text-shadow` glow, or a gradient
  background under text; **UI-12**: every game toolbar has the same control
  order.
