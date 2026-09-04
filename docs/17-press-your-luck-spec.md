# 17 — Press Your Luck

Status: **approved for implementation** · Component id: `press-your-luck`
Owns: `games/press-your-luck/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md`. Follow every cross-cutting rule in
`docs/reports/00-orchestrator-triage.md`. The Big Board follows the "core
decides, animation visualises" rule from `games/wheel-of-fortune/js/wheel-draw.js`.

## 1. The format (normative)

Three players (2–4 supported).

1. **Question round.** 4 questions per round. The host reads a question;
   the first to **buzz** (phones; or the host names them) answers aloud; a
   correct buzz-in earns **3 spins**. Then the three multiple-choice options
   are shown; every other player picks one (phones, or the host marks);
   each correct pick earns **1 spin**.
2. **Big Board.** 18 squares around a rectangle, each holding a value (cash
   or a prize with a value), a **Whammy**, or cash "+ one spin". A light
   bounces around the squares; the player in control presses **STOP** (phone
   or host). The landing square comes from the core (rng) at the moment of
   the press; the animation lands there. Cash/prize → added to their total;
   "+ spin" adds a spin; **Whammy** → total drops to 0, whammy count +1; 4
   whammies → out. Players use spins in order of fewest spins earned... (show
   rule: the player with the fewest spins goes first; ties → lower total
   first). A player may **pass** remaining spins to an opponent (who must
   use them; passed spins that hit a Whammy... show rule: passed spins can't
   be passed back; Whammies on passed spins count) once they have at least
   one spin and no passed spins pending.
3. **Round 2**: same, with a higher-value board (JSON has `boards[1]`).
   Highest total after round 2 wins (records to the hub scoreboard).

Configurable: questions per round, spins for buzz/pick, boards, whammy limit,
whether the board rotates values (the show swaps square contents between
spins — implement a simple per-spin re-shuffle of each square's alternatives
if the JSON provides `alternatives`; optional). Non-goals: the "Double
Whammy", "Big Bucks" jackpot, prize pictures (text + value only).

## 2. Content JSON (`games/press-your-luck/board.json`)

```json
{
  "title": "Press Your Luck — Game Night",
  "settings": { "currency": "$", "questionsPerRound": 4, "buzzSpins": 3, "pickSpins": 1, "whammyLimit": 4, "rounds": 2 },
  "boards": [ [ { "cash": 500 }, { "whammy": true }, { "cash": 750, "spin": true }, { "prize": "Weekend getaway", "value": 1200 } ] ],
  "questions": [ { "q": "Which planet is closest to the Sun?", "options": ["Venus", "Mercury", "Mars"], "answer": 1 } ]
}
```

`boards` = `rounds` arrays of exactly **18** squares; 3–6 whammies per board;
`questions` ≥ 24 with 3 options. Ship two boards and 40 questions; mirror in
`js/data.js`; two extra sets in `sets/`.

## 3. Host UI

Palette: the show's carnival — hot pink `#ff3ea5`, yellow `#ffe14d`, cyan
`#3ae0ff` on deep purple `#2a0b45`; squares as lit tiles with a travelling
highlight; a Whammy square flashes red with a cartoon "WHAMMY!" card (CSS
only). Screens: Setup → Question round (buzz bar like Jeopardy's, options,
spin tallies) → Big Board (the 18 squares, current player, spins left,
passed spins, STOP button + Space, pass controls, totals with whammy dots)
→ Round interstitial → Result / Standings. Undo; toolbar incl. game-lobby;
splash; sounds (board tick, whammy sting, cash chime).

## 4. Pure core (`js/pyl-content.js` + `js/pyl-core.js`, UMD → `PylCore`)

Events: `start`, `buzz{pid}`, `judgeBuzz{correct}`, `pick{pid,idx}`,
`revealPicks`, `nextQuestion`, `toBoard`, `stop{pid}` (rng picks the square),
`pass{to}`, `nextSpinner`, `nextRound`, `undo`, `finish`. Selectors:
`spinOrder`, `alive`, `phoneView`, `validatePhoneMsg`, `legalActions`.

## 5. Phones

Phone → host: `{t:"buzz"}`, `{t:"pick",idx}`, `{t:"stop"}` (player in
control), `{t:"pass",to}`. Host → phone: `{t:"view",…}`. Screens: `wait`,
`buzz` (red/green buzzer), `pick` (A/B/C), `board` (giant STOP + spins left +
pass), `result`.

## 6. Success states

Unit **L-U1…L-U10**: validator (18 squares, whammy counts); spin awards;
spin order rule; stop lands where rng says and applies cash/prize/spin/
whammy; whammy zeroes and counts; 4 whammies out; pass rules; round 2 board;
winner; undo/illegal/immutable; leak (phones never see the upcoming landing
square). Loopback **L-I1…L-I6**: board animation ends on the core's square
(10/10); phone STOP; buzzers; passes; reload mid-board; library + editor;
gates. Standalone T4: three manual players, two rounds.
