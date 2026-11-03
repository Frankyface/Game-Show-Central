# 20 — Krillion (most-niche-answer game)

Status: **approved for implementation** · Component id: `krillion`
Owns: `games/krillion/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md` (game-lobby control, library — required),
`docs/21-ui-cleanup-brief.md` (build to the cleaned-up look). Follow every
cross-cutting rule in `docs/reports/00-orchestrator-triage.md`.

## 1. What we are adapting

Krillion (krillion.io) is a category game where you try to give the **rarest
valid answer** — "one in a krillion". The real game grades rarity against a
global frequency database. Our version grades rarity against a **rated answer
list written with the question**: every prompt ships with potential answers
each rated **Prawn, Schooler, Rare, Deep Cut, or One in a Krillion**. Any
answer not on the list goes to the **judge** (the host) for review after the
round. The host can rate it on the spot, and the editor can fold judged
answers back into the question set so lists grow over time. This is an
original adaptation; credit the inspiration in the README.

## 2. The format (normative)

Two modes, chosen on the setup screen. Host-only play uses "the host types
the room's answers".

### 2.1 Deep Dive (default) — everyone answers at once

- A **prompt** is a category ("Name a chemical element", "Name a fruit").
  Every player has **30 seconds** (configurable) to type **one** answer on
  their phone (they may change it until the clock ends). Answers are hidden
  until the clock ends or everyone has submitted.
- **Matching.** Each answer is normalised (trim, case-fold, collapse spaces,
  strip articles and trailing punctuation) and matched against the prompt's
  rated list (`text` and `aliases`). A match takes the listed tier
  automatically.
- **Judge's review.** Unmatched answers queue for the host after the clock:
  each shows the player's exact text, and the host picks a tier
  (Prawn … One in a Krillion) or **Not valid** (0 points, shown as ⬛). The
  host can also tap **Add to this question** so the answer and its tier are
  remembered in the session's content (and exported by the editor).
- **Tiers and points** (defaults, configurable):
  Prawn 10 · Schooler 30 · Rare 60 · Deep Cut 85 · One in a Krillion 100.
  Two players who give the same answer both get its tier (as in the real
  game). The host sees, per prompt, how many players landed in each tier.
- **Depth**: a player's running total is shown as **metres descended**
  (1 point = 10 m) with markers dropping down the reef on reveal. A game is
  **7 prompts** (configurable). Highest depth wins; ties stay ties.
- **Reveal pacing**: the host reveals from Prawn up to One in a Krillion,
  so the rarest answers land last with a sting.

### 2.2 Puffer Party — pass the puffer

- Players sit in a ring. One prompt per round. The holder must give a valid
  answer **not already used** this round before the clock pops; a valid
  answer passes the puffer and the clock resets a little **shorter** (12 s
  down to a 3 s floor, configurable). Used answers are listed.
- Validity: on the rated list → valid at once; off-list → the host rules
  live (✓ with a tier, or ✗ keeps the puffer with the clock running).
- **Pop**: the holder loses a **heart** (start 3, max 4); the round ends and
  a new prompt starts with the next player.
- Each valid answer earns meter points by tier (Prawn 0, Schooler 1, Rare 2,
  Deep Cut 3, One in a Krillion 4); **100 meter points = +1 heart**. Out at 0
  hearts (spectator). **Last one floating wins.** Optional round cap.

Configurable: prompt seconds, prompts per game, tier points, hearts, puffer
clock range, mode. Non-goals: a frequency database, accounts, the daily
puzzle, "Noillirk" reverse mode.

## 3. Content JSON (`games/krillion/prompts.json`)

```json
{
  "title": "Krillion — Game Night",
  "settings": { "mode": "deepDive", "promptSeconds": 30, "promptsPerGame": 7,
    "tiers": [ { "id": "prawn", "name": "Prawn", "points": 10 },
               { "id": "schooler", "name": "Schooler", "points": 30 },
               { "id": "rare", "name": "Rare", "points": 60 },
               { "id": "deepcut", "name": "Deep Cut", "points": 85 },
               { "id": "krillion", "name": "One in a Krillion", "points": 100 } ],
    "puffer": { "hearts": 3, "maxHearts": 4, "startSeconds": 12, "floorSeconds": 3, "meterForHeart": 100 } },
  "prompts": [
    { "text": "Name a chemical element", "category": "Science",
      "answers": [
        { "text": "Iron", "tier": "prawn", "aliases": ["Fe"] },
        { "text": "Neon", "tier": "schooler" },
        { "text": "Tungsten", "tier": "rare" },
        { "text": "Ytterbium", "tier": "deepcut" },
        { "text": "Oganesson", "tier": "krillion" } ] }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `settings.tiers` | no | 2–6 tiers with unique `id`, `name` ≤ 24, strictly increasing points; defaults above; `tier` values in answers must be a listed id |
| `prompts` | yes | ≥ 40; `text` ≤ 120; `category` optional ≤ 30; `answers` ≥ 5 with at least one answer in each of at least 3 tiers; `text` ≤ 40 unique within the prompt after normalisation (aliases included); `aliases` optional ≤ 8 |

Ship **100** original prompts across ≥ 10 categories, each with **10–25**
rated answers covering every tier (the rating is the content: common
answers Prawn, genuinely obscure ones One in a Krillion); mirror in
`js/data.js`; two library sets ("Kids' night", "Pop culture").

## 4. Host UI

Palette: deep ocean — near-black blue stage `#03111f`, bioluminescent teal
`#2ee6c5` and coral `#ff6b57` accents, soft white. Designed to the cleaned-up
look in `docs/21`: no marquee, no glows beyond one accent, no emoji in the
host UI; the reef is a quiet vertical depth scale with player markers.

Screens: Setup (mode, roster, settings, library, Start) → **Prompt** (prompt
huge, clock, "answers in n/m", host examples panel toggle) → **Reveal**
(matched answers already carry their tier; the **Judge's review** panel
lists off-list answers with a tier picker + Not valid + Add to this question;
then Reveal walks Prawn → One in a Krillion with depth markers descending) → **Depth board** between prompts → **Result**
(podium by depth, the night scoreboard gets the depth as points) /
**Puffer Party** (ring of seats, the puffer at the holder, shrinking clock,
used-answers list, ✓/✗, hearts, elimination, last one floating). Undo,
game-lobby control, splash (skipped when embedded), sounds (sonar ping on
submit, pop, abyss sting).

## 5. Pure core (`js/kr-content.js` + `js/kr-core.js`, UMD → `KrCore`)

Events: `start`, `openPrompt{now}`, `answer{pid,text}`, `hostAnswer{pid,text}`
(host types for a phone-less player), `closePrompt`, `review{group,tier|null}`,
`remember{group}` (adds the judged answer + tier to the session content), `revealNext`, `nextPrompt`, Puffer: `pufferStart{now}`,
`pufferAnswer{pid,text}`, `pufferJudge{valid, niche?}`, `pufferPop{now}`,
`nextRound`, `undo`, `finish`. Selectors: `groups(state)` (normalised, with matched tier or `pending`),
`matchAnswer(prompt, text)`, `reviewQueue(state)`, `depth(pid)`, `ring`, `phoneView` — a phone never sees
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

Unit **KR-U1…KR-U10**: validator (tier ids, per-prompt coverage, alias
uniqueness); normalisation + alias matching; off-list → pending until reviewed;
review assigns a tier or 0/⬛; remember() adds to content and matches next time; depth totals and tie; reveal
order common→rare; Puffer: used-list rejection, shrinking clock floor, pop
costs a heart, meter → heart up to max, elimination, last one floating;
undo/illegal/immutable/prototype guard; leak test (no phone sees others'
answers before reveal, nor examples). Loopback **KR-I1…KR-I6**: 5 phones
answer a prompt (three on-list across tiers, one alias, one off-list), the off-list
one waits in the judge queue until the host rates it, reveal order and points; a phone resubmits before close; Puffer round with pop;
reload mid-prompt keeps the deadline; library + editor; game-lobby; gates.
Standalone T4: host types answers for 4 manual players, full 7-prompt game.
