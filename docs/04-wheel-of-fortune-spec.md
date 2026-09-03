# 04 — Wheel of Fortune

Status: **approved for implementation** · Component id: `wheel-of-fortune`
Owns: `games/wheel-of-fortune/**`. Depends on: 00. Build core + JSON + editor +
host UI (including the animated wheel) first; phones last.

## 1. The format (normative)

Up to 6 players (3 on TV) solve hidden word puzzles, hangman-style, by
spinning a wheel for dollar values and calling consonants.

**Regular round.** Puzzle shown as blank tiles with the **category**. On a
turn the player may:

- **Spin.** The wheel lands on a wedge:
  - dollar value → call a **consonant**. Each occurrence is revealed and the
    player earns value × occurrences (round total); they keep the turn. If the
    letter is absent or already called → turn passes.
  - **BANKRUPT** → round total → 0 (banked totals from earlier rounds are
    safe), turn passes.
  - **LOSE A TURN** → turn passes.
- **Buy a vowel** (costs `vowelCost`, default $250, needs round total ≥ cost;
  A E I O U). Reveal or not, the turn continues on a reveal and passes on a
  miss. (Show rule.)
- **Solve.** The player says the whole puzzle. Correct → they **bank** their
  round total into their grand total (min `roundMinimum`, default $1,000),
  everyone else's round total resets, next round. Wrong → turn passes.

When only vowels remain the host is told "only vowels remain" and spinning is
disabled (player must buy or solve). All letters revealed = solved by the last
revealer (host confirms).

**Toss-up** (optional rounds). Letters of the puzzle reveal one at a time in
random order every ~1.2 s; the first player to buzz (phones) or be named by
the host may solve once; correct → toss-up value (default $1,000 / $2,000 /
$3,000) to their grand total and they start the next round; wrong → they are
out of this toss-up and reveals continue. Nobody solves → no points.

**Bonus round.** The player with the highest grand total. Category shown;
**R S T L N E** revealed automatically; the player gives **3 consonants + 1
vowel**; they are revealed; a **10-second** (configurable) timer runs while
they guess out loud (cue only — the host judges with **Correct / Time**).
Prize: a configurable label (default "$25,000").

Configurable: wheel wedges per round (values, BANKRUPT/LOSE A TURN count),
vowel cost, round minimum, toss-up values, bonus timer and prize, whether the
game auto-orders rounds `tossup, regular…, bonus`. Non-goals: prize wedges,
Wild Card, Free Play, Mystery wedge, the Million-dollar wedge, "Final Spin"
speed-up round (host can just skip to bonus).

## 2. Content JSON (`games/wheel-of-fortune/puzzles.json`)

```json
{
  "title": "Wheel of Fortune — Game Night",
  "settings": {
    "vowelCost": 250, "roundMinimum": 1000, "bonusSeconds": 10,
    "bonusPrize": "$25,000", "tossUpValues": [1000, 2000, 3000],
    "wedges": [800, "BANKRUPT", 650, 500, 900, 700, 600, 650, 500, 700, "LOSE A TURN",
               800, 500, 650, 600, 700, 900, "BANKRUPT", 500, 600, 550, 700, 2500, 650]
  },
  "rounds": [
    { "type": "tossup",  "category": "Phrase",       "puzzle": "A PENNY FOR YOUR THOUGHTS" },
    { "type": "regular", "category": "Thing",        "puzzle": "GAME SHOW CENTRAL" },
    { "type": "regular", "category": "Food & Drink", "puzzle": "HOT CHOCOLATE WITH MARSHMALLOWS", "wedges": [/* optional override */] },
    { "type": "bonus",   "category": "Place",        "puzzle": "NEW YORK CITY" }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `settings.wedges` | no | 12–32 entries; each a positive integer (multiple of 50) or `"BANKRUPT"` / `"LOSE A TURN"`; at least one dollar wedge; default = the 24 above |
| `settings.vowelCost/roundMinimum` | no | positive integers |
| `settings.tossUpValues` | no | positive integers; index = nth toss-up; last repeats |
| `settings.bonusSeconds` | no | 0–60 (0 = no timer) |
| `rounds` | yes | 1–20; at most one `bonus` and it must be last if present |
| `rounds[].type` | no | `regular` (default) / `tossup` / `bonus` |
| `rounds[].category` | yes | non-empty ≤ 30 |
| `rounds[].puzzle` | yes | uppercase letters A–Z, spaces, and `' - & , . ! ?`; validator uppercases; must **fit the board** (§3 layout) |
| `rounds[].wedges` | no | per-round override, same rules |
| `rounds[].value` | no | toss-up value override |

Ship 10 rounds (2 toss-ups, 7 regular, 1 bonus) of original puzzles across
categories (Phrase, Thing, Place, Person, Food & Drink, Before & After, Song
Title…). Mirror in `js/data.js`.

## 3. Host UI (projector-first)

Palette: royal purple stage `#2a0a4a` → `#130422`, teal accents `#12b3a6`,
tile faces white with dark green letters (the TV board), gold for money.

**Puzzle board**: 4 rows of 12/14/14/12 tiles (TV layout). Words never break
across rows; `layoutPuzzle(puzzle)` (pure) greedily packs words into rows
with 1-tile gaps, centres each row, and returns `null` if it can't fit
(validator uses it). Punctuation occupies a tile and is shown from the
start. Letters flip white→revealed with a short animation and a "ding";
revealed tiles show the letter in green; the category strip sits below.

**The wheel**: an SVG/canvas wheel drawn from the wedge list (alternating
colours, BANKRUPT black, LOSE A TURN white), with a pointer at the top.
**Spin** animates ≥ 3 s with ease-out (CSS transform on the SVG group, honours
`prefers-reduced-motion` by jumping to the result with a fade). The landing
wedge index comes from the pure core (`rng` injected) **before** the
animation starts; the animation only visualises it. A tick sound plays per
wedge passed (WebAudio, throttled).

**Layout**: board top, wheel bottom-left (≈ 40 % width), players' podiums
bottom-right: name, round total (big), grand total (small), active player
highlighted; used-letter board (A–Z, used greyed, vowels marked) beside the
wheel; a status banner ("{Name}: spin, buy a vowel, or solve", "$700 — call a
consonant", "BANKRUPT!", "Only vowels remain").

Host controls (context-sensitive): **Spin**, **Buy a vowel**, **Solve…**,
letter buttons (an on-screen A–Z keyboard; disabled for used letters and,
after a spin, for vowels), **Correct / Wrong** for solves, **Next player**
(skip), **Undo**, **Reveal all** (host escape hatch), **Next round**, 🔊, and
the phone-turn indicator ("waiting for {Name}'s phone" with a **Take over**
button so the host can always act instead).

**Toss-up**: board reveals letters automatically (host **Start** button; pause
on buzz), buzz bar like Jeopardy's ("🔔 {Name}" with Correct/Wrong), host can
also click a podium to name the solver.

**Bonus**: the leader's podium spotlighted; RSTLNE auto-revealed with a
staggered animation; host types the 3 consonants + vowel (or the phone
picks); reveal; timer blocks; **Correct** / **Time's up**; prize splash.

**Final**: standings; **Play again**.

## 4. Pure core (`js/wheel-core.js`, UMD → `WheelCore`)

- `validateGame`, `normalizeGame`, `layoutPuzzle(puzzle) → rows|null`,
  `VOWELS`, `isVowel`, `letterCount(puzzle, letter)`, `onlyVowelsLeft(...)`.
- `createState(game, players, options)` → `{phase, roundIndex, round:{...},
  players:[{pid,name,round,total}], turn, used:[letters], revealed:[bool per
  char], wedge:{index,value}|null, pendingSpin, tossup:{revealOrder, next,
  locked:[pid], buzzed}, bonus:{...}, history, sound}`.
- `reduce(state, event, rng)` events: `start`, `spin`, `callLetter{letter}`,
  `buyVowel`, `solveAttempt`, `solveJudged{correct}`, `nextPlayer`,
  `tossupStart`, `tossupRevealNext`, `tossupBuzz{pid}`, `tossupJudged{correct}`,
  `bonusPick{letters:[c,c,c,v]}`, `bonusJudged{correct}`, `nextRound`,
  `revealAll`, `undo`, `setTotal{pid,total}`, `finish`. `spin` uses `rng()` to
  pick a wedge uniformly. Illegal events → unchanged.
- Selectors: `boardView`, `podiumView`, `phoneView(state,pid)`,
  `legalActions(state)` → `{spin,buyVowel,solve,letters:[...]}` used by both
  the host buttons and the phone keyboard, `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"spin"}`, `{t:"letter",letter}`, `{t:"buy-vowel"}`,
`{t:"solve",text}` (≤ 80 chars; host still judges — it's displayed, never
auto-compared), `{t:"buzz"}` (toss-up), `{t:"bonus-pick",letters}`.
Host → phone: `{t:"view",…}` from `phoneView`.

| screen | shows |
|---|---|
| `wait` | your totals, whose turn it is, the current category |
| `turn` | **SPIN** / **Buy a vowel** / **Solve** according to `legalActions`; after a spin: "$700 — pick a consonant" + keyboard (used/illegal letters disabled) |
| `solve` | text field + Submit ("the host will judge") |
| `tossup` | buzzer (red wait → green on host **Start**; locked after a wrong solve) |
| `bonus` | (leader only) pick 3 consonants + 1 vowel, then "Solve out loud!" with the timer |
| `result` | standings |

The host UI always mirrors phone actions and can take over at any time.

## 6. Editor

Rounds list (type select, category, puzzle with a **live board preview** using
`layoutPuzzle`, "doesn't fit" inline error, per-round wedge override toggle),
settings fields (wedge list as chips: add value / BANKRUPT / LOSE A TURN,
remove, live wheel preview), Download JSON / Use in game / Reset / Start
blank, draft auto-save (`gsc-wheel-draft-v1`).

## 7. Files

```
games/wheel-of-fortune/index.html
games/wheel-of-fortune/css/wheel.css, wheel-board.css (if needed), wheel-phone.css
games/wheel-of-fortune/js/wheel-core.js      pure
games/wheel-of-fortune/js/wheel-draw.js      wheel SVG builder + spin animation (DOM only)
games/wheel-of-fortune/js/wheel-app.js       host glue + persistence (gsc-wheel-state-v1)
games/wheel-of-fortune/js/wheel-room.js      GSC.host glue
games/wheel-of-fortune/js/wheel-phone.js     GSC.player glue
games/wheel-of-fortune/js/wheel-editor.js
games/wheel-of-fortune/js/wheel-sound.js
games/wheel-of-fortune/js/data.js
games/wheel-of-fortune/puzzles.json
games/wheel-of-fortune/tests/wheel-core.test.mjs
games/wheel-of-fortune/tests/harness.html
games/wheel-of-fortune/README.md
```

`<body data-gsc-game="wheel-of-fortune">`.

## 8. Success states

Unit (T1):

- **W-U1** `validateGame`: accepts shipped JSON; rejects lowercase-with-digits puzzle, 60-letter puzzle that can't fit, 2 bonus rounds, bonus not last, wedge list without a dollar wedge, wedge `-100`, category empty.
- **W-U2** `layoutPuzzle`: never splits a word; rows ≤ 12/14/14/12; centred; returns null when a word > 14 or the total doesn't fit; punctuation counts as a tile; deterministic.
- **W-U3** Spin with injected rng lands on the expected index; BANKRUPT zeroes round total only; LOSE A TURN passes; dollar wedge requires a consonant next.
- **W-U4** `callLetter`: reveals all occurrences, adds value×count, keeps the turn; absent/used letter passes the turn; vowel after a spin is illegal; buying a vowel deducts and requires round ≥ cost.
- **W-U5** Solve correct: banks max(round, roundMinimum), resets others' round totals, advances round; wrong passes the turn.
- **W-U6** `onlyVowelsLeft` disables spin in `legalActions`; all-revealed puzzle requires solve confirmation.
- **W-U7** Toss-up: reveal order is a permutation of letter positions; buzz locks others; wrong locks that player and resumes reveals; correct awards the nth toss-up value.
- **W-U8** Bonus: leader chosen (ties → first in order, host can override via `setTotal`), RSTLNE revealed, picks must be 3 distinct unused consonants + 1 vowel, reveal, judged.
- **W-U9** Undo exact; illegal events ignored (table-driven); inputs frozen.
- **W-U10** `validatePhoneMsg` + `phoneView`: a non-active player's `turn` screen is never emitted; solve text is capped/sanitised.

Loopback (T2, `tests/harness.html`):

- **W-I1** Spin animation ends on the wedge the core chose (DOM rotation → wedge index agrees) — with reduced-motion the result appears without animation.
- **W-I2** Phone `spin` → host shows the result; phone keyboard disables used letters; phone `letter` reveals on the host board; "Take over" lets the host act for a phone player.
- **W-I3** Toss-up: phone buzzers arm on Start; first buzz pauses reveals; Wrong locks and resumes.
- **W-I4** Bonus: leader's phone gets `bonus`; picks land on the host; timer blocks run on host and phone.
- **W-I5** Reload mid-round restores board, used letters, turn, totals.
- **W-I6** Editor: live board preview matches `layoutPuzzle`; "doesn't fit" blocks Download; wheel preview reflects the wedge chips.
- **W-I7** Grep/size gates.

Standalone (T4): a full 3-round game host-only, and one phone via `?room=`.
