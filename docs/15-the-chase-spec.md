# 15 — The Chase

Status: **approved for implementation** · Component id: `the-chase`
Owns: `games/the-chase/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md` (game-lobby button, question-set library —
required from day one). Follow every cross-cutting rule in
`docs/reports/00-orchestrator-triage.md`.

## 1. The format (normative)

A team of up to 4 contestants faces the **Chaser**, a trivia expert. The
Chaser is either the **host** (default in a voice chat) or a designated
player (phone).

1. **Cash Builder.** Each contestant in turn answers rapid-fire questions for
   60 seconds; each correct answer is worth $1,000 (configurable). The host
   reads, the contestant answers aloud, the host marks ✓ / ✗ / pass.
2. **Head-to-head.** A board of 7 steps. The contestant starts 3 steps from
   the bottom (home) with their Cash Builder total; the Chaser starts at the
   top. Before play the Chaser **offers** a higher amount (one step closer to
   the Chaser, default ×5) and a lower amount (one step further, default the
   amount halved); the contestant picks. Then multiple-choice questions with
   **3 options**: contestant and Chaser each lock an answer **secretly**
   (phones, or the host locks for the Chaser and types the contestant's
   spoken letter); reveal contestant → move down one on correct; reveal
   Chaser → move down one on correct. Caught (same step) → the contestant is
   out; reaching home → their amount is **banked** and they join the Final
   Chase.
3. **Final Chase.** The team gets a head start of 1 step per member who got
   home (a lone finalist gets 1). Team round: 2 minutes of rapid-fire
   questions, one step per correct (one player answers, host judges). Then
   the Chaser has 2 minutes to reach the team's total; every Chaser miss is
   offered to the team: a correct team answer **pushes the Chaser back** one
   step. Chaser catches → the Chaser wins; time runs out → the team splits
   the bank (recorded per member; hub scoreboard).

Configurable: board steps (7), start step (3), Cash Builder value/seconds,
offer multipliers, final-round seconds, head start rules. Non-goals: the
"Beat the Chasers" variant, multiple chasers.

## 2. Content JSON (`games/the-chase/questions.json`)

```json
{
  "title": "The Chase — Game Night",
  "settings": { "currency": "$", "steps": 7, "startStep": 3, "cashBuilderValue": 1000, "cashBuilderSeconds": 60,
    "higherMultiplier": 5, "lowerDivisor": 2, "finalSeconds": 120, "chaserIsHost": true },
  "rapid": [ { "q": "What is the largest planet in our solar system?", "a": "Jupiter" } ],
  "multi": [ { "q": "Which of these is a primary colour?", "options": ["Green", "Red", "Orange"], "answer": 1 } ]
}
```

`rapid` ≥ 80 (the editor warns below 200; a 4-player game uses ~120),
`multi` ≥ 40 with exactly 3 distinct options and `answer` 0–2. Ship 200
rapid-fire and 60 multiple-choice original, verifiable, family-friendly
questions; mirror in `js/data.js`. Ship at least two extra **sets** in
`games/the-chase/sets/` per `docs/19`.

## 3. Host UI

Palette: the show's cold blue-black stage `#04143a`, board steps as lit
slabs, contestant marker blue, Chaser marker red `#d10000`.

Screens: Setup (team order, Chaser = host or a player, settings, library
picker, 🔊, Start) → Cash Builder (giant clock, running total, question card
with the answer host-only, ✓/✗/pass + hotkeys) → Offer (three amounts,
pick) → Head-to-head board (7 steps with both markers, the question and 3
options, "locked" indicators for both sides, Reveal contestant / Reveal
Chaser, movement animation) → Caught / Home interstitials → Final Chase (team
clock and step count, Chaser clock, pushback prompts) → Result / Standings.
Undo everywhere; consistent toolbar incl. the game-lobby button; splash.

## 4. Pure core (`js/chase-content.js` + `js/chase-core.js`, UMD → `ChaseCore`)

Clock as deadline timestamps (injected `now`). Events: `start`, `cbStart
{now}`, `cbMark{result}`, `cbExpired{now}`, `offer{choice:"higher"|"middle"|
"lower"}`, `lock{side:"contestant"|"chaser", idx}`, `revealContestant`,
`revealChaser`, `nextQuestion`, `nextContestant`, `finalTeamStart{now}`,
`finalTeamMark{result}`, `finalTeamExpired`, `finalChaserStart{now}`,
`finalChaserMark{result}`, `pushback{correct}`, `finalChaserExpired`, `undo`,
`finish`. Selectors: `board`, `offers`, `bank`, `phoneView` — a locked answer
is never visible to the other side before reveal; `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"lock",idx}` (contestant in the hot seat, or the Chaser
if a player), `{t:"ready"}`. Host → phone: `{t:"view",…}`. Screens: `wait`,
`answer` (question + A/B/C, locked state), `chaser` (same, red), `final`
(team clock + steps), `result`.

## 6. Success states

Unit **CH-U1…CH-U10**: validator; Cash Builder totals and expiry; offers
maths; head-to-head movement and catch/home at every step; head start rules;
Final Chase pushbacks and both endings; bank split; undo/illegal/immutable;
leak test (no side sees the other's lock before reveal; phones never see
rapid-fire answers). Loopback **CH-I1…CH-I6**: secret locks from two phones
reveal in order; Chaser-as-player; clocks on phones; reload mid-final
resumes paused; library picker loads a set; editor round-trip; gates.
Standalone T4: host as Chaser, full game with 3 manual players.
