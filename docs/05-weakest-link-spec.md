# 05 — Weakest Link

Status: **approved for implementation** · Component id: `weakest-link`
Owns: `games/weakest-link/**`. Depends on: 00. Core + JSON + editor + host UI
first; phone voting last.

## 1. The format (normative)

A team of players (3–12; TV: 8–9) answers rapid-fire general-knowledge
questions in turn order against a round clock to build a **money chain**.
After each round they **vote off** one of their own. The last two play
head-to-head for the bank.

**Round.** The clock starts (round 1 = 150 s, each later round 10 s shorter —
configurable). The host asks the current player a question. **Correct** →
the chain climbs one link (1,000 → 2,500 → 5,000 → 10,000 → 25,000 → 50,000 →
75,000 → 125,000, configurable). **Wrong** (or pass) → the chain drops to 0.
Before hearing their question a player may say **"Bank"** → the current
chain amount is added to the round bank and the chain resets. Reaching the
**top of the chain** banks it automatically and **ends the round**. When the
clock hits 0 the current question still completes (host judges), then the
round ends; unbanked chain money is lost. The round bank joins the team
total (max per round = chain top).

**Voting.** Each remaining player votes (secretly, on phones — or the host
enters them) for the player they think is the weakest link. Before the
reveal the host can show the **statistics**: strongest link (most correct,
tie-break most banked, then fewest wrong) and weakest link (fewest correct,
tie-break least banked, then most wrong). Votes are revealed one at a time
("{Voter} votes … {Name}"); the player with the most votes leaves: **"You are
the weakest link. Goodbye."** A tie is broken by the **strongest link** of
that round (host picks who among the tied on their behalf, or the phone of
the strongest link chooses — SHOULD).

**Rounds continue** until 2 players remain. The **last full round's bank is
tripled** (`finalMultiplier`, default 3; UK show) before the head-to-head.

**Head-to-head.** The strongest link of the last round chooses who answers
first. Five questions each, alternating. Most correct wins the total bank.
Tie → **sudden death** in pairs: if one answers correctly and the other
doesn't, it's over.

Configurable: chain values, round seconds (array), players remaining before
the final (2), questions per player in the final (5), final multiplier,
whether the top-of-chain auto-ends the round (true), voting: phones/host,
tie-break rule. Non-goals: prize money in real currency (it's points with a
currency symbol), "banking" mid-question.

## 2. Content JSON (`games/weakest-link/questions.json`)

```json
{
  "title": "Weakest Link — Game Night",
  "settings": {
    "currency": "$",
    "chain": [1000, 2500, 5000, 10000, 25000, 50000, 75000, 125000],
    "roundSeconds": [150, 140, 130, 120, 110, 100, 90, 90, 90, 90],
    "finalPlayers": 2, "finalQuestionsEach": 5, "finalMultiplier": 3,
    "topOfChainEndsRound": true
  },
  "questions": [
    { "q": "In which ocean is Madagascar?", "a": "Indian Ocean", "category": "Geography" }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `settings.chain` | no | 3–12 strictly increasing positive integers |
| `settings.roundSeconds` | no | positive integers ≤ 600; index = round; last repeats; default above |
| `settings.finalPlayers` | no | 2 (only 2 supported; validator rejects others) |
| `settings.finalQuestionsEach` | no | 1–10 |
| `settings.finalMultiplier` | no | 1–5 |
| `settings.currency` | no | ≤ 3 chars, default `$` |
| `questions` | yes | ≥ 40 (the editor warns below 120: "a 6-player game uses ~150"); each `q` ≤ 200, `a` ≤ 80 non-empty; `category` optional ≤ 30 |

Questions are drawn in file order by default; setting **Shuffle** on the
setup screen shuffles with an injected rng. When the pool is exhausted the
game wraps and flags "questions are repeating" in the host UI.

Ship **160** original general-knowledge questions (mixed difficulty,
family-friendly, verifiable facts; spread across ≥ 8 categories). Mirror in
`js/data.js`.

## 3. Host UI (projector-first)

Palette: black stage `#0a0a0a`, steel `#2b2f36`, cold blue spot `#3a7bd5`,
red accent `#c1121f` for the goodbye, white type; Anton + Inter.

Screens:

1. **Setup**: player order list (from lobby/manual; standalone typed),
   shuffle questions toggle, load JSON / editor, 🔊, **Start**.
2. **Round**: top: round number + big clock (mm:ss, turns red under 10 s;
   cue with a beat), the **chain** as a vertical ladder on the left (current
   link lit, banked links flash), round **bank** and team **total** on the
   right, the current player's name spotlighted in the centre with the
   question text (large; host reads it aloud) and the answer in a smaller
   "host only" line that can be toggled hidden for screen-share (default:
   hidden; **Show answer** reveals it for 2 s or until judged — the host
   usually reads the answer from the reveal). Controls: **Bank** (before the
   question), **Correct**, **Wrong / Pass**, **Undo**, **Pause clock**,
   **End round** (escape hatch). Space = Correct, X = Wrong, B = Bank
   hotkeys (ignored in inputs).
   Per-player stats accumulate silently (correct, wrong, banked).
3. **Voting**: "Vote for the weakest link" with the roster; phone votes
   arrive masked (dots) with an "in: n/m" counter; host can enter/override
   any vote via a per-player dropdown; **Show statistics** panel (strongest /
   weakest with numbers); **Reveal votes** (one per click, TV cadence);
   result: the eliminated player, or the tie panel (tied names; the
   strongest link decides — host clicks). **"You are the weakest link.
   Goodbye."** card (red, 2 s, sound), then **Next round**.
4. **Final**: "Bank tripled: $X" splash; the strongest link picks who goes
   first (host clicks); alternating question cards with a 5-dot tally per
   player; sudden death pairs when tied; **Winner** screen with the total.
5. **Standings / Play again**.

Sounds: clock tick under 10 s, correct blip, wrong buzz, bank cha-ching,
goodbye sting (descending two-note).

## 4. Pure core (`js/wl-core.js`, UMD → `WlCore`)

- `validateGame`, `normalizeGame`, `warningsFor` (question count).
- `createState(game, players, options{shuffle, rng})`.
- `reduce(state, event, now?)`: `start`, `clockStart{now}`, `clockPause{now}`,
  `bank`, `correct`, `wrong`, `clockExpired` (host glue calls it when the
  deadline passes — the core stores `deadline` timestamps, never timers),
  `endRound`, `vote{voter,target}`, `revealVote`, `revealAll`,
  `breakTie{target}`, `eliminate`, `nextRound`, `finalFirst{pid}`,
  `finalAnswer{correct}`, `undo`, `finish`. Illegal → unchanged.
- Selectors: `strongestLink(state, roundIndex)`, `weakestLink(...)`,
  `chainValue(state)`, `voteTally(state)`, `phoneView(state,pid)`,
  `validatePhoneMsg`.
- Clock: the core keeps `{running, deadline, remainingMs}`; the host glue
  renders with `requestAnimationFrame` and dispatches `clockExpired` once.
  Reload mid-round: the clock resumes paused with the saved `remainingMs`.

## 5. Phones

Phone → host: `{t:"vote",target:pid}` (during voting only; may change until
reveal), `{t:"tiebreak",target:pid}` (strongest link only, SHOULD).
Host → phone: `{t:"view",…}`.

| screen | shows |
|---|---|
| `wait` | "It's {Name}'s turn", the round bank and team total; per-player stats stay host-only |
| `vote` | roster (excluding self) as big buttons; tap to vote; "Vote locked — you can change it until the reveal" |
| `tiebreak` | the tied names for the strongest link |
| `goodbye` | for the eliminated player: "You are the weakest link. Goodbye." |
| `out` | eliminated players watch: standings |
| `final` | the two finalists: whose question it is + tally |
| `result` | winner |

## 6. Editor

Questions table (q / a / category; add / remove / import from pasted CSV or
TSV lines `question<TAB>answer[<TAB>category]` — parse with `textContent`-
safe code, no `innerHTML`), settings fields (chain as editable list, round
seconds list), count badge with the warning threshold, Download / Use /
Reset / Blank, draft auto-save (`gsc-wl-draft-v1`).

## 7. Files

```
games/weakest-link/index.html
games/weakest-link/css/wl.css, wl-phone.css
games/weakest-link/js/wl-core.js
games/weakest-link/js/wl-app.js        host glue + persistence (gsc-wl-state-v1)
games/weakest-link/js/wl-clock.js      rAF clock renderer (DOM only)
games/weakest-link/js/wl-room.js
games/weakest-link/js/wl-phone.js
games/weakest-link/js/wl-editor.js
games/weakest-link/js/wl-sound.js
games/weakest-link/js/data.js
games/weakest-link/questions.json
games/weakest-link/tests/wl-core.test.mjs
games/weakest-link/tests/harness.html
games/weakest-link/README.md
```

`<body data-gsc-game="weakest-link">`.

## 8. Success states

Unit (T1):

- **K-U1** `validateGame`: accepts shipped JSON (≥ 160 questions); rejects 39 questions, non-increasing chain, `finalPlayers` 3, empty answer, `roundSeconds` 0.
- **K-U2** Chain: correct climbs, wrong resets, bank moves chain to round bank and resets, top-of-chain auto-banks and ends the round when enabled (and doesn't when disabled).
- **K-U3** Clock: `clockStart/Pause/Expired` with injected `now`; expiry lets the in-flight question be judged, then `endRound` moves the bank to total and unbanked chain is lost.
- **K-U4** Turn order rotates through remaining players only; eliminated players are skipped; each new round starts with the previous round's **strongest link** (TV rule).
- **K-U5** Stats: strongest/weakest tie-breaks in the documented order.
- **K-U6** Voting: one vote per remaining voter, changeable until reveal, self-votes rejected, tally, majority eliminated, tie → `tiebreak` phase restricted to tied targets, `breakTie` by the strongest link.
- **K-U7** Final: the last full round's bank ×3, first-player choice, alternating 5 each, winner by correct count, sudden death pairs until decided.
- **K-U8** Question pool: shuffle deterministic under rng, wrap sets `repeating:true`.
- **K-U9** Undo exact; illegal events ignored (table-driven); inputs frozen.
- **K-U10** `validatePhoneMsg`/`phoneView`: votes only accepted during `voting` from remaining players; `phoneView` never contains other players' votes or the answer text.

Loopback (T2):

- **K-I1** Round with 5 fake players: Space/X/B hotkeys drive the core; the clock ticks and expiry triggers exactly once; reload mid-round resumes paused with the right remaining time.
- **K-I2** Voting: phone votes arrive masked; counter n/m; host override; reveal one-by-one; goodbye card and the eliminated phone's `goodbye` screen.
- **K-I3** Tie → strongest link's phone gets `tiebreak` (SHOULD) / host click resolves.
- **K-I4** Final flow to a winner; phones show `final` and `result`.
- **K-I5** Editor CSV import of 3 lines produces 3 rows; Download validates; count badge warning under 120.
- **K-I6** Grep/size gates.

Standalone (T4): a host-only game to a winner with votes entered by the host.
