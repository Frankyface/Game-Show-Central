# 16 — 1 vs 100

Status: **approved for implementation** · Component id: `one-vs-100`
Owns: `games/one-vs-100/**`. Depends on: 00 (SDK), design-system.md,
`docs/19-cross-cutting-round.md`. Follow every cross-cutting rule in
`docs/reports/00-orchestrator-triage.md`.

## 1. The format (normative)

One contestant plays against **the Mob**: every other connected phone.

- Each question has **3 options**. The Mob answers on their phones within
  the answer window (default 20 s; the host closes it early once everyone
  has answered). The contestant answers (phone or host) **after** the Mob
  locks; the host reveals.
- Every Mob member who answered wrong (or did not answer) is **eliminated**.
  The contestant earns **money per eliminated member** on that question,
  using a ladder by question number (default per-member values: 100, 200,
  300, 500, 1000, 2000, 3000, 5000, 7500, 10000 — configurable; the last
  value repeats).
- A wrong contestant answer ends the game with **nothing**; the surviving
  Mob members split the bank (shown, and their names go to the hub scoreboard
  as winners). After any correct answer the contestant may **walk away** with
  the bank. Eliminating the whole Mob wins the bank plus a bonus
  (configurable, default doubles).
- **Helps** (once each): **Poll the Mob** (the Mob's answer split is shown
  before the contestant locks), **Ask the Mob** (one Mob member who chose an
  option is asked to explain — the host picks; the app shows one right and
  one wrong member's names), **Trust the Mob** (the contestant takes the
  majority answer automatically).
- No phones (or fewer than 3): the host enters the Mob size and how many
  answered wrong per question ("simulated Mob"), so the game still runs.

Configurable: money ladder, answer window seconds, helps, the bonus. Non-
goals: the "Mob member profiles", jackpot rules by year.

## 2. Content JSON (`games/one-vs-100/questions.json`)

`questions` ≥ 30 items `{q, options:[3], answer:0..2, level?:1..10}`; ship
60 original questions with rising difficulty; mirror in `js/data.js`; at
least two extra sets in `games/one-vs-100/sets/`.

## 3. Host UI

Palette: black stage, electric cyan `#19c9ff` mob grid, gold bank. The Mob
as a **grid of numbered tiles** (one per connected phone; simulated mob shows
the count) that go dark as members are eliminated; the question lozenge and
three options; the bank and the "per member" value; the helps as badges;
an answer-window timer.

Screens: Setup (contestant, settings, library, 🔊, Start) → Question (Mob
answering: live count "answered n/m", timer; then the contestant's answer:
options with lock; Reveal: Mob tiles flip, eliminated count, bank grows) →
Walk / Continue → Helps overlays → Result (win / walk / lose with the Mob
split) → Standings. Undo; toolbar incl. game-lobby; splash.

## 4. Pure core (`js/ovh-content.js` + `js/ovh-core.js`, UMD → `OvhCore`)

Events: `start`, `seat{pid}`, `openQuestion{now}`, `mobAnswer{pid,idx}`,
`closeMob`, `simulateMob{size,wrong}`, `contestantLock{idx}`, `usePoll`,
`useAsk`, `useTrust`, `reveal`, `walk`, `continue`, `undo`, `finish`.
Selectors: `bank`, `perMember(q)`, `mobAlive`, `split`, `phoneView` — a Mob
member's view never contains other members' answers or the correct answer
before reveal; `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"mob",idx}` (any alive Mob member while the window is
open), `{t:"lock",idx}` (contestant). Host → phone: `{t:"view",…}`. Screens:
`wait`, `mob-answer` (question + A/B/C + timer), `mob-eliminated` ("You're
out — watch the host screen"), `contestant` (question + A/B/C + helps),
`result`.

## 6. Success states

Unit **O-U1…O-U10**: validator; elimination and bank maths per ladder;
non-answer counts as wrong; contestant wrong → 0 and Mob split; walk; full
Mob eliminated bonus; helps once each and Trust auto-locks majority (tie →
first option in order flagged for the host); simulated Mob; undo/illegal/
immutable; leak test. Loopback **O-I1…O-I6**: 5 phones as Mob, one as
contestant; window closes early when all answered; eliminated phones see
`mob-eliminated`; helps; reload mid-question keeps the window deadline;
library + editor; gates. Standalone T4: simulated Mob full game.
