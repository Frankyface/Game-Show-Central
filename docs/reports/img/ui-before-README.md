# "Before" state of every surface (UI upgrade, brief 09 §5)

The screenshot tool available to the shell agent renders images into the
conversation but **cannot write PNG files to disk**, so the `ui-before-*.png`
files asked for in brief §5 do not exist. This file records the same
information: what each surface looked like immediately before the v2 upgrade,
and the *measured* computed type sizes / colours (read out of the live DOM with
`getComputedStyle` on a local server at `http://127.0.0.1:8671`).

Captured 2026-09-03, before any v2 edit, at 1280×720 (host) and 320×640 (phone).
Existing `shell-t3-*.png` / `feud-t3-*.png` in this folder are earlier
verification captures of the same v1 look and can be used as visual "before"
references.

---

## ui-before-landing (1280×720)

One centred glass card (`max-width 760px`) on the hub's purple radial gradient,
vertically centred with a lot of dead space above and below. Order: eyebrow
"WELCOME TO" (12.8px Inter, letterspaced), the title "GAME SHOW CENTRAL" in
Anton with a stacked brown text-shadow, a one-line pitch, two buttons side by
side (gold "Host a game night", ghost "Play without phones"), a "Join on your
phone" text link, then a hairline rule and a single row of four
`emoji + name` labels for the games. No game art, no motion, no border
treatment. Reads as a generic dark modal, not a marquee.

Measured: `.landing-title` 83.2px Anton `#ffd35e` · `.landing-pitch` 18.4px
Inter `#aab0e0` on transparent over the gradient.

## ui-before-lobby (1280×720, room open, one manual player "Riley")

Two columns, `minmax(360px,42%) 1fr`, 1.5rem padding.
Left column, three stacked flat panels with the same
`linear-gradient(180deg, rgba(20,28,96,.85), rgba(8,12,52,.95))` fill and a
1px `rgba(170,176,224,.25)` border:

1. Room card — "ROOM CODE" eyebrow, the code in Anton (measured **122.88px**,
   capped at 140px ≥1100px), the full join URL wrapping onto two lines at
   18.4px, a status line, then a row of four small ghost buttons
   (Copy link / Lock lobby / Close room / 🔊 Sound on).
2. Players card — heading + "+ Add player", rows of
   `swatch · emoji · name · 🟢 · [Kick]` on `rgba(0,0,0,.25)`.
3. Tonight's scoreboard — hidden until a game reports scores.

Right column: "PICK A GAME" heading over a `repeat(auto-fit, minmax(260px,1fr))`
grid of four tiles. Each tile is a 2px accent-coloured box with a
`color-mix` accent wash, a 2rem emoji, the name in Anton 28.8px, the tagline,
two/three pill chips at 11.52px, an amber player hint and a gold "Play" button.
Hover lifts 3px. The tiles are the only colour in the layout.

Vertical scroll: at 1024×576 the lobby's `scrollHeight` was **970px** — the
lobby already scrolls below ~970px of viewport height, and at 1280×720 the
fourth tile is cut off.

## ui-before-shellbar (Family Feud loaded, 1280×720)

A 40px strip, `background:#000` flat, 1px bottom border. Contents left to right:
small ghost "⌂ Lobby" button, "🎤 FAMILY FEUD" in Anton 1.1rem, the game's own
subtitle in `--ink-dim`, an amber broker string, and a gold-outlined pill
"3KSY · 0 🔔" on the right. Fully opaque, visually detached from the game
underneath; the iframe starts hard against it.

## ui-before-phone-join (320×640, `?room=3KSY`)

Single `.phone-card` panel, 430px max width, full-height dark gradient.
Title "GAME SHOW CENTRAL" 35.2px Anton gold wrapping to two lines, "ROOM CODE"
label, the code input in Anton 32px letterspaced and centred, "YOUR NAME"
input, "PICK AN AVATAR" 6-column emoji grid (48px min-height buttons — **below
the 56px tap target**), then a full-width gold "Join" button (56px).
`scrollWidth == 320` (no horizontal scroll) and `scrollHeight == 640` (fits).
Same navy/gold as every other surface: nothing tells the player which room or
which player they are at a glance.

## ui-before-phone-waiting (320×640)

Same card. A 3.5rem avatar emoji, "You're in, {name}!" in Anton, the grey line
"Waiting for the host to pick a game…", an "IN THE ROOM" heading with roster
rows, a full-width ghost "Leave" button and a status line. No colour identity,
no motion, no sense of being "in" anything.

---

## Game host screens (unchanged by this agent — captured for the game agents)

- **Jeopardy setup** — the upstream page: black bar with "GAME NIGHT JEOPARDY"
  in Anton, a single centred navy card with Players / Buzzer room / Timers /
  Questions sections in small Inter type, a gold "Start Game".
- **Jeopardy board (mid-game)** — the upstream 5×5 board: flat
  `#060ce9` tiles, category row in white caps, values in gold Anton, a small
  centred scoreboard chip under the board. No bevel, no reveal animation, a
  hard black stage.
- **Family Feud setup** — full-width dark navy page, "FAMILY FEUD – GAME NIGHT"
  in gold Anton, then plain stacked label/field sections (Teams, Game,
  Questions) with 1px-outlined inputs; a single manual-player row with A/B/×
  chips. Reads as a form, not a setup screen.
- **Wheel of Fortune setup** — purple gradient, gold Anton title wrapping to
  two lines, Players / Phones / Puzzles sections as ghost buttons, and a
  partially visible wheel below the fold.
- **Weakest Link setup** — near-black steel page, "THE WEAKEST LINK" in white
  Anton, Players / Phones / Questions sections, a blue "Start the game" button
  bottom-right. The coldest of the four; the only one that already has a
  distinct stage colour.

Common "before" problems the v2 upgrade targets, on every one of these:
flat single-layer backgrounds, panels that are all the same rectangle, form
type at 12–16px on a projector, buttons of five different shapes, no shared
banner/podium/timer language, and emoji doing all the iconography.
