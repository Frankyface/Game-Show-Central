# 20 — Krillion (most-niche-answer game)

Status: **approved for implementation** · Component id: `krillion`
Owns: `games/krillion/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md` (game-lobby control, library — required),
`docs/21-ui-cleanup-brief.md` (build to the cleaned-up look). Follow every
cross-cutting rule in `docs/reports/00-orchestrator-triage.md`.

## 1. What we are adapting

Krillion (krillion.io) is a category game where you try to give the **rarest
valid answer** — "one in a krillion". The real game grades rarity against a
global frequency database and runs an elimination mode ("Puffer Party") where
a pufferfish is passed by naming valid answers before it pops. We cannot run a
database on a static site, so **rarity is graded against the room**: the fewer
other players who gave your answer, the more it scores. The host judges
validity. This is an original adaptation; use the name "Krillion" as the game's
title and credit the inspiration in the README.

## 2. The format (normative)

Two modes, chosen on the setup screen. Both need ≥ 3 players for rarity to
mean anything (2 is allowed with a warning; host-only play uses "the host
types the room's answers").

### 2.1 Deep Dive (default) — everyone answers at once

- A **prompt** is a category ("Name a chemical element", "Name a fruit",
  "Name something in a kitchen drawer"). Every player has **25 seconds**
  (configurable) to type **one** answer on their phone. Answers are hidden
  until the clock ends or everyone has submitted.
- **Normalisation** groups identical answers: trim, case-fold, collapse
  spaces, strip articles ("the", "a", "an") and trailing punctuation; the host
  can **merge** two groups by hand ("NYC" into "New York") before scoring.
- **Validity**: the host marks each distinct answer ✓ valid or ✗ invalid
  (wrong category, not a real thing, made up). Invalid answers score 0 and
  show a ⬛ for that player, as the real game does for a miss.
- **Rarity scoring** (per valid answer group; `n` = players who gave it,
  `N` = players who answered validly):
  - **One in a Krillion** — unique (n = 1): **100**
  - **Deep Cut** — n ≤ 25 % of N: **85**
  - **Rare** — n ≤ 50 %: **60**
  - **Schooler** — n < 100 %: **30**
  - **Obvious** — everyone gave it: **10**
  Tiers, thresholds and points are configurable; the defaults mirror the
  real game's five depth tiers.
- **Depth**: a player's running total is shown as **metres descended**
  (1 point = 10 m), with a per-prompt reveal that drops each player's marker
  down the reef. A game is **7 prompts** (configurable). Highest depth wins;
  ties stay ties (shared podium).
- **Reveal pacing**: the host reveals answer groups from most common to
  rarest ("surface to abyss"), so the unique answers land last with a sting.

### 2.2 Puffer Party — pass the puffer

- Players sit in a ring. One prompt per round. The player holding the
  **puffer** must submit a valid answer **not already used** this round
  before the clock pops; on a valid answer the puffer passes to the next
  player and the clock resets a little **shorter** (12 s down to 3 s floor,
  configurable). Used answers are listed on the host screen.
- The host judges validity live (✓ passes, ✗ keeps the puffer with the
  clock running). A phone may also type while the host reads along.
- **Pop**: the holder loses a **heart** (start with 3, configurable, max 4);
  the round ends and a new prompt starts with the next player.
- Rarity still matters: each valid answer earns meter points by tier
  (Obvious 0, Schooler 1, Rare 2, Deep Cut 3, One in a Krillion 4 — rarity
  judged by the host against the room's used list plus a one-tap "that was
  niche" host badge, since there is no global database); **100 meter points =
  +1 heart**.
- Out at 0 hearts (spectator). **Last one floating wins.** Optional round
  cap for big groups.

Configurable: prompt seconds, prompts per game, tier thresholds/points,
hearts, puffer clock range, which mode. Non-goals: a frequency database,
accounts, the daily puzzle, "Noillirk" reverse mode.

## 3. Content JSON (`games/krillion/prompts.json`)

```json
{
  "title": "Krillion — Game Night",
  "settings": { "mode": "deepDive", "promptSeconds": 25, "promptsPerGame": 7,
    "tiers": [ { "name": "One in a Krillion", "maxShare": 0, "points": 100 },
               { "name": "Deep Cut", "maxShare": 0.25, "points": 85 },
               { "name": "Rare", "maxShare": 0.5, "points": 60 },
               { "name": "Schooler", "maxShare": 0.999, "points": 30 },
               { "name": "Obvious", "maxShare": 1, "points": 10 } ],
    "puffer": { "hearts": 3, "maxHearts": 4, "startSeconds": 12, "floorSeconds": 3, "meterForHeart": 100 } },
  "prompts": [ { "text": "Name a chemical element", "category": "Science", "examples": ["Iron", "Neon", "Ytterbium"] } ]
}
```

| Field | Required | Rules |
|---|---|---|
| `prompts` | yes | ≥ 40; `text` ≤ 120, `category` optional ≤ 30, `examples` optional (3 host-only sample answers, shown to the host as a judging aid, never to phones) |
| `settings.tiers` | no | 2–6 tiers with strictly increasing `maxShare` 0..1 and non-increasing points; the first tier with `maxShare` 0 means "unique" |

Ship **120** original prompts across ≥ 10 categories with wide answer
spaces (so rare answers exist), with examples; mirror in `js/data.js`; two
library sets ("Kids' night", "Pop culture").

## 4. Host UI

Palette: deep ocean — near-black blue stage `#03111f`, bioluminescent teal
`#2ee6c5` and coral `#ff6b57` accents, soft white. Designed to the cleaned-up
look in `docs/21`: no marquee, no glows beyond one accent, no emoji in the
host UI; the reef is a quiet vertical depth scale with player markers.

Screens: Setup (mode, roster, settings, library, Start) → **Prompt** (prompt
huge, clock, "answers in n/m", host examples panel toggle) → **Reveal**
(answer groups as cards with the names who gave them, merge control, ✓/✗
per group, tier badges and points appear as the host reveals from common to
rare, depth markers descend) → **Depth board** between prompts → **Result**
(podium by depth, the night scoreboard gets the depth as points) /
**Puffer Party** (ring of seats, the puffer at the holder, shrinking clock,
used-answers list, ✓/✗, hearts, elimination, last one floating). Undo,
game-lobby control, splash (skipped when embedded), sounds (sonar ping on
submit, pop, abyss sting).

## 5. Pure core (`js/kr-content.js` + `js/kr-core.js`, UMD → `KrCore`)

Events: `start`, `openPrompt{now}`, `answer{pid,text}`, `hostAnswer{pid,text}`
(host types for a phone-less player), `closePrompt`, `merge{from,into}`,
`judge{group,valid}`, `revealNext`, `nextPrompt`, Puffer: `pufferStart{now}`,
`pufferAnswer{pid,text}`, `pufferJudge{valid, niche?}`, `pufferPop{now}`,
`nextRound`, `undo`, `finish`. Selectors: `groups(state)` (normalised),
`tierFor(n, N, tiers)`, `depth(pid)`, `ring`, `phoneView` — a phone never sees
other players' answers before the reveal, nor the host examples;
`validatePhoneMsg` (answers ≤ 40 chars, sanitised). Clock as deadlines with
injected `now`, frozen on save.

## 6. Phones

Phone → host: `{t:"answer",text}` (Deep Dive, while the prompt is open; may
resubmit until close), `{t:"puffer",text}` (holder only). Host → phone:
`{t:"view",…}`. Screens: `wait`, `answer` (prompt + field + clock + "sent ✓
— you can change it"), `reveal` (your tier and points for this prompt, your
depth), `puffer-hold` (prompt + field + shrinking clock), `puffer-watch`
(whose turn, used answers), `out`, `result`.

## 7. Files and success states

Files: `games/krillion/index.html`, `css/kr.css` + `kr-phone.css`,
`js/kr-content.js`, `kr-core.js`, `kr-select.js` (if needed), `kr-app.js`,
`kr-view.js`, `kr-clock.js`, `kr-room.js`, `kr-phone.js`, `kr-editor.js`,
`kr-sound.js`, `data.js`, `prompts.json`, `sets/`, `tests/kr-core.test.mjs`,
`tests/harness.html`, `README.md`. `<body data-gsc-game="krillion">`.
Registry: `{ id:"krillion", name:"Krillion", path:"games/krillion/", icon:"🐡",
accent:"#2ee6c5", tagline:"The rarest answer wins.", phone:["everyone answers",
"pass the puffer"], players:[2,16] }`.

Unit **KR-U1…KR-U10**: validator; normalisation and merges; tier maths at
every boundary (N=3..16); invalid → 0 and ⬛; depth totals and tie; reveal
order common→rare; Puffer: used-list rejection, shrinking clock floor, pop
costs a heart, meter → heart up to max, elimination, last one floating;
undo/illegal/immutable/prototype guard; leak test (no phone sees others'
answers before reveal, nor examples). Loopback **KR-I1…KR-I6**: 5 phones
answer a prompt (two identical, one unique), host merges and judges, reveal
order and points; a phone resubmits before close; Puffer round with pop;
reload mid-prompt keeps the deadline; library + editor; game-lobby; gates.
Standalone T4: host types answers for 4 manual players, full 7-prompt game.
