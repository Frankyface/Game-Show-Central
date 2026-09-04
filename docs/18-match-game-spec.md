# 18 — Match Game

Status: **approved for implementation** · Component id: `match-game`
Owns: `games/match-game/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md`. Follow every cross-cutting rule in
`docs/reports/00-orchestrator-triage.md`.

## 1. The format (normative)

Two contestants and a **panel** of up to 6 panelists (phones; or the host
types their answers).

- **Main game.** A fill-in-the-blank prompt is read ("Dumb Dora was so
  dumb, she thought a quarterback was ___"). Each panelist **secretly
  writes** an answer (phone; typed by the host otherwise). The contestant
  then gives their answer aloud; the host reveals the panel one at a time
  and marks each **match / no match** (judgement call: same idea counts).
  One point per match. Two rounds; contestants alternate; the second
  contestant in a round only faces the panelists the first did not match
  in... (show rule for round 2: a contestant may only match panelists not
  already matched — implement as configurable `secondRoundRule`; default
  off). Ties → tiebreak prompt.
- **Super Match.** The winner picks: **Audience Match** — a short prompt;
  the room's phones (everyone not on the panel) type an answer; the top
  three by frequency (host may merge synonyms by drag-free "merge into"
  buttons) are worth 500 / 250 / 100; the contestant picks one answer (three
  guesses shown as the show's 3 slots). **Head-to-Head** — the contestant
  picks one panelist; both write an answer to a new prompt; a match wins the
  audience amount × multiplier (default 10; the show uses a spinner for
  ×10/×20/×30 — implement a small spinner with rng).

Configurable: panel size, rounds, points, Super Match values and multiplier
options, second-round rule. Non-goals: real celebrity panels, blank
"nonsense" answers ranking.

## 2. Content JSON (`games/match-game/prompts.json`)

```json
{
  "title": "Match Game — Game Night",
  "settings": { "currency": "$", "panelSize": 6, "rounds": 2, "audienceValues": [500, 250, 100], "multipliers": [10, 20, 30], "secondRoundRule": false },
  "prompts": [ { "text": "Dumb Dora was so dumb, she thought a quarterback was ___.", "hint": "money / football" } ],
  "audiencePrompts": [ { "text": "Things you find in a glove box", "hint": "" } ]
}
```

`prompts` ≥ 30 (blank marked with `___`, ≤ 160 chars, family-friendly and
funny), `audiencePrompts` ≥ 10. Ship 60 prompts and 20 audience prompts;
mirror in `js/data.js`; two extra sets in `sets/`.

## 3. Host UI

Palette: the 70s show — orange `#ff8c1a`, mustard `#e6b800`, avocado
`#6b8e23` on chocolate brown `#3b1f0e`, chunky rounded panels. Screens:
Setup (contestants, panel from the roster or "host types", settings,
library, 🔊, Start) → Prompt (prompt big; panel cards face-down "answered
n/6"; contestant answer field; Reveal one at a time with a flip; Match /
No match per card; running points) → Round scores → Super Match (audience
collection with live count, top-3 board with merge controls, the
contestant's picks; then Head-to-Head with the spinner and the panelist's
card) → Result / Standings. Undo; toolbar incl. game-lobby; splash.

## 4. Pure core (`js/mg-content.js` + `js/mg-core.js`, UMD → `MgCore`)

Events: `start`, `nextPrompt`, `panelAnswer{pid|slot,text}`, `contestantAnswer
{text}`, `revealNext`, `judge{match}`, `nextContestant`, `tiebreak`,
`audienceOpen`, `audienceAnswer{pid,text}`, `audienceClose`, `mergeAnswers
{from,into}`, `audiencePick{idx}`, `pickPanelist{pid|slot}`, `spin` (rng),
`hthAnswer{text}`, `hthJudge{match}`, `undo`, `finish`. Selectors: `topThree`
(frequency after normalisation: trim, case-fold, collapse spaces),
`phoneView` — panelists never see each other's answers before reveal, the
contestant never sees panel answers; `validatePhoneMsg` (answers ≤ 40 chars,
sanitised).

## 5. Phones

Phone → host: `{t:"panel",text}` (panelists while a prompt is open),
`{t:"audience",text}` (everyone else during Audience Match), `{t:"hth",text}`
(the chosen panelist). Host → phone: `{t:"view",…}`. Screens: `wait`,
`panel` (prompt + text field + "sent ✓"), `audience`, `hth`, `result`.

## 6. Success states

Unit **M-U1…M-U10**: validator; panel answers masked until reveal; points;
alternation and rounds; tiebreak; top-three frequency with normalisation and
merges; audience values; multiplier spin; undo/illegal/immutable; leak test.
Loopback **MG-I1…MG-I6**: 3 panel phones + 2 audience phones; reveal order;
merges; Head-to-Head; reload mid-prompt keeps answers; library + editor;
gates. Standalone T4: host types the panel, full game with two manual
contestants.
