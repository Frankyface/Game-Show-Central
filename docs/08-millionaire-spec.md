# 08 — Who Wants to Be a Millionaire

Status: **approved for implementation** · Component id: `millionaire`
Owns: `games/millionaire/**`. Depends on: 00 (conventions, SDK) and the design
system in `docs/09-ui-upgrade-brief.md` (use `shared/theme.css` v2 classes when
they exist; the game must still look right on the v1 tokens).

## 1. The format (normative)

One contestant at a time sits in the **hot seat** and answers up to 15
multiple-choice questions (A–D) of rising difficulty for rising money.

- **Money tree** (configurable; default US-style 15 rungs):
  100, 200, 300, 500, 1,000, 2,000, 4,000, 8,000, 16,000, 32,000, 64,000,
  125,000, 250,000, 500,000, 1,000,000. **Safe havens** at rung 5 (1,000) and
  rung 10 (32,000): a wrong answer drops the contestant to the last safe haven
  reached (0 if none).
- **Answering.** The host reads the question and four options. The contestant
  names a letter; the host asks "Final answer?" and **locks** it. The reveal
  is deliberately paced (host clicks **Reveal**): correct → the rung lights
  green, money climbs; wrong → the correct answer flashes, game over at the
  safe-haven amount. The contestant may **walk away** before locking an answer
  and keep the current amount.
- **Lifelines** (each once per contestant; set configurable):
  - **50:50** — two wrong options are removed (host clicks; the core picks
    two wrong options with the injected rng).
  - **Phone a Friend** — 30-second timer (cue only). In a voice chat the
    contestant simply talks to someone; the host names the friend on screen
    (text field, optional).
  - **Ask the Audience** — every connected phone (except the contestant)
    votes A/B/C/D within 20 seconds; results shown as a live bar chart in
    percentages. Without phones the host may type four percentages or skip.
  - **Switch the Question** (off by default) — replaces the question with an
    unused one of the same level.
- **Fastest Finger First** (optional, on by default when phones are present):
  to pick the next contestant, phones order four items (e.g. "Put these in
  chronological order") by tapping them in sequence and submitting; the host
  screen shows arrival order; the fastest **correct** submission wins the hot
  seat. Ties are impossible (host arrival order is authoritative). Without
  phones the host picks the contestant from the roster.
- **Game night flow.** Several contestants may play in turn; each contestant's
  final amount is recorded; the hub's night scoreboard receives it.

Configurable: money tree values and currency symbol, safe-haven rungs,
which lifelines exist, phone/audience timers, Fastest Finger on/off,
questions per contestant (default 15 = tree length). Non-goals: the
"Clock format" per-question countdown, "Ask the Host", jackpot/random
million questions.

## 2. Content JSON (`games/millionaire/questions.json`)

```json
{
  "title": "Millionaire — Game Night",
  "settings": {
    "currency": "$",
    "moneyTree": [100,200,300,500,1000,2000,4000,8000,16000,32000,64000,125000,250000,500000,1000000],
    "safeHavens": [5, 10],
    "lifelines": { "fifty": true, "phone": true, "audience": true, "switch": false },
    "phoneSeconds": 30, "audienceSeconds": 20, "fastestFinger": true
  },
  "questions": [
    { "level": 1, "category": "Food", "q": "Which of these is a citrus fruit?",
      "options": ["Lemon", "Carrot", "Potato", "Onion"], "answer": 0 }
  ],
  "fastestFinger": [
    { "q": "Put these planets in order from the Sun, nearest first.",
      "options": ["Earth", "Mercury", "Mars", "Venus"], "order": [1, 3, 0, 2] }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `settings.moneyTree` | no | 5–20 strictly increasing positive integers |
| `settings.safeHavens` | no | rung numbers (1-based) inside the tree, ascending; default `[5,10]` for a 15-rung tree, else empty |
| `settings.lifelines.*` | no | booleans; defaults above |
| `settings.phoneSeconds/audienceSeconds` | no | 0–120 (0 = no timer) |
| `settings.fastestFinger` | no | boolean |
| `questions` | yes | ≥ 15; each `q` ≤ 200, exactly 4 `options` ≤ 60 chars each and distinct, `answer` 0–3, `level` 1..tree length (default: spread evenly by file order), `category` optional |
| `fastestFinger` | when enabled | ≥ 1; exactly 4 options, `order` a permutation of 0–3 |

The editor warns when any level has fewer than 2 questions ("a second
contestant may repeat questions"). Ship **45** original questions (3 per
level, difficulty rising with level, verifiable facts, family-friendly) and
**6** Fastest Finger questions. Mirror in `js/data.js`.

## 3. Host UI (projector-first)

The iconic look, built with CSS only: deep navy-to-violet stage with a
spotlight glow, the question in a wide **hexagonal lozenge** at the bottom
with four option lozenges (A–D) beneath in a 2×2 grid, the **money tree** as
a right-hand column with the current rung lit, safe havens in a distinct
colour, and the three lifeline badges top-right (used ones crossed). Type:
Anton for money and letters, Inter for text; sizes readable at 1280×720.

Screens:

1. **Setup**: roster (contestant order; from lobby/manual, standalone typed),
   Fastest Finger on/off (auto-off when no phones), lifeline toggles mirrored
   from JSON, load JSON / editor, 🔊, **Start**.
2. **Fastest Finger** (optional): question + four items; phones submit;
   a live arrival list (name, time since open, ✓/✗ once revealed);
   **Reveal order** → the correct order shown, the winner spotlighted →
   **To the hot seat**. Host may **Pick manually** at any time.
3. **Hot seat**: contestant name + current winnings; question lozenge;
   options; controls: **A/B/C/D** (select), **Final answer** (lock),
   **Reveal**, lifeline buttons, **Walk away**, **Undo**, **Next question**.
   Option states: idle, selected (amber), locked (amber pulse), correct
   (green), wrong (red), removed (dimmed, 50:50). Sounds: lights-down
   sting on lock, correct chime, wrong buzz, million fanfare.
4. **Ask the Audience** overlay: bar chart A–D with percentages updating
   live, "votes in: n/m", timer blocks; **Close** applies the final chart.
5. **Phone a Friend** overlay: friend name field, 30 s timer blocks, **Done**.
6. **Result**: "You leave with $X" / "MILLIONAIRE!"; **Next contestant** /
   **Finish**. Standings across contestants at the end.

## 4. Pure core (`js/wwm-core.js` + `js/wwm-content.js`, UMD → `WwmCore`)

- `validateGame`, `normalizeGame` (assign levels, sort), `warningsFor`.
- `createState(game, players, options{rng})` → `{phase, contestants:[{pid,
  name, won, rung, out}], current, rung, question, used:[ids], selected,
  locked, revealed, removed:[idx], lifelines:{fifty,phone,audience,switch},
  audience:{open, votes:{pid:idx}, deadline, chart}, phone:{friend,deadline},
  fff:{question, submissions:[{pid,order,at}], revealed, winner}, history}`.
- `reduce(state, event, rng, now)`: `start`, `fffOpen`, `fffSubmit{pid,order,
  at}`, `fffReveal`, `fffPick{pid}`, `seat{pid}`, `select{idx}`, `lock`,
  `reveal`, `walkAway`, `useFifty`, `usePhone`, `phoneFriend{name}`,
  `phoneDone`, `useAudience`, `audienceVote{pid,idx}`, `audienceHostChart
  {pcts}`, `audienceClose`, `useSwitch`, `nextQuestion`, `nextContestant`,
  `undo`, `finish`. Illegal → unchanged. Questions are drawn per level
  without repeats across contestants until exhausted (then wraps with a flag).
- Selectors: `winningsIfWrong`, `winningsIfWalk`, `chart(state)`,
  `phoneView(state,pid)`, `legalActions(state)`, `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"fff",order:[0..3]}`, `{t:"answer",idx}` (contestant:
selects; host still locks), `{t:"lifeline",which}` (contestant requests; host
confirms), `{t:"walk"}` (request), `{t:"vote",idx}` (audience).
Host → phone: `{t:"view",…}`.

| screen | shows |
|---|---|
| `wait` | who's in the hot seat and their money |
| `fff` | the four items as tap-to-order chips, Submit |
| `hotseat` | question + A–D (selected highlighted), lifeline buttons still available, Walk away |
| `locked` | "Final answer locked — look at the host screen" |
| `vote` | A–D vote buttons with the question, timer |
| `result` | outcome for the contestant / standings |

Host confirmation is always required for lock, lifelines and walking away —
a phone only expresses intent.

## 6. Editor

Questions table with level select, category, question, four options with an
"answer" radio; Fastest Finger list with drag-free order pickers (four
selects); settings (money tree as an editable list with a preview column,
safe havens, lifelines, timers); Download / Use / Reset / Blank; draft
auto-save (`gsc-wwm-draft-v1`); per-level count badges.

## 7. Files

```
games/millionaire/index.html
games/millionaire/css/wwm.css, wwm-phone.css
games/millionaire/js/wwm-content.js, wwm-core.js, wwm-app.js, wwm-view.js,
                     wwm-room.js, wwm-phone.js, wwm-editor.js, wwm-sound.js,
                     wwm-timer.js (+ timer-core.js copied from Jeopardy), data.js
games/millionaire/questions.json
games/millionaire/tests/wwm-core.test.mjs, harness.html
games/millionaire/README.md
```

`<body data-gsc-game="millionaire">`. Registry entry (shell agent adds it):
`{ id:"millionaire", name:"Millionaire", path:"games/millionaire/", icon:"💎",
accent:"#1d2a7a", tagline:"Fifteen questions. One hot seat.",
phone:["fastest finger","hot seat","ask the audience"], players:[1,16] }`.

## 8. Success states

Unit (T1): **M-U1** validator accepts the shipped file, rejects 14 questions, 3 options, duplicate options, `answer` 4, non-increasing tree, safe haven outside the tree, FFF `order` not a permutation. **M-U2** level assignment and no-repeat draw across two contestants, wrap flag. **M-U3** select → lock → reveal correct climbs; wrong drops to the last safe haven (0 below rung 5; 1,000 between 5 and 9; 32,000 from 10). **M-U4** walk away keeps the current rung's amount and only before lock. **M-U5** 50:50 removes exactly two wrong options, deterministic under rng, once only. **M-U6** audience votes: one per pid, contestant excluded, chart percentages sum to 100 (largest-remainder rounding), host chart override, close freezes. **M-U7** phone-a-friend deadline with injected now; timers cue-only. **M-U8** FFF: submissions ordered by `at`, only correct orders count, winner selection, manual pick, phones that never submitted. **M-U9** undo exact; illegal events ignored (table-driven); frozen inputs. **M-U10** `validatePhoneMsg` + `phoneView`: a non-contestant never gets `hotseat`; the audience never sees the correct answer; the vote screen has no `answer` field.

Loopback (T2): **M-I1** FFF with 3 fake phones: fastest correct wins, a faster wrong loses. **M-I2** hot seat: phone selects, host locks, reveal correct; lifelines from phone require host confirm. **M-I3** Ask the Audience: 3 phones vote, chart updates live, contestant's phone shows no vote screen, close freezes. **M-I4** wrong answer → safe-haven amount, next contestant, standings; night scoreboard report. **M-I5** reload mid-question restores everything including a running audience window (deadline). **M-I6** editor: download validates, level badges, Use in game. **M-I7** gates.

Standalone (T4): a full host-only contestant run to the million with all lifelines used.
