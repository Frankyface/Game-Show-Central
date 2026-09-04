# 12 — Deal or No Deal

Status: **approved for implementation** · Component id: `deal-or-no-deal`
Owns: `games/deal-or-no-deal/**`. Depends on: 00 (SDK), design-system.md.
Follow the cross-cutting rules in `docs/reports/00-orchestrator-triage.md`.

## 1. The format (normative)

One contestant, 26 sealed cases holding amounts from $0.01 to $1,000,000
(configurable list; 26 by default). The amounts are shuffled into cases by
the pure core with an injected rng.

1. The contestant **picks their own case** (kept closed).
2. **Rounds** open cases in this schedule: 6, 5, 4, 3, 2, 1, 1, 1, 1
   (configurable). Each opened case removes its amount from the board.
3. After each round the **Banker** calls with an offer: `offer = round(EV ×
   factor[round] × (1 + jitter))`, where EV is the mean of the remaining
   amounts, `factor` rises by round (default 0.12, 0.2, 0.3, 0.4, 0.5, 0.65,
   0.8, 0.9, 1.0) and `jitter` is rng in ±5 %, rounded to a "nice" number
   (nearest 100 under 10k, nearest 1k under 100k, nearest 5k above). The
   host reveals the offer with drama; the contestant says **Deal** or **No
   Deal**.
4. **Deal** → the game ends; the remaining cases (and the contestant's) are
   opened for "what you would have won". **No Deal** → next round.
5. With two cases left the contestant may **swap** their case for the last
   one (configurable), then their case is opened: that's the win.
6. Optional **audience advice**: phones vote Deal / No Deal after each
   offer, shown as a live split on the host screen (like Millionaire's Ask
   the Audience). Configurable; on by default when phones are present.

Several contestants can play in turn during a night; winnings are recorded
and reported to the hub scoreboard. Non-goals: real money, the banker's
"trades", multi-contestant rounds.

## 2. Content JSON (`games/deal-or-no-deal/board.json`)

```json
{
  "title": "Deal or No Deal — Game Night",
  "settings": {
    "currency": "$",
    "amounts": [0.01, 1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1000, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000, 750000, 1000000],
    "rounds": [6, 5, 4, 3, 2, 1, 1, 1, 1],
    "offerFactors": [0.12, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0],
    "jitter": 0.05, "allowSwap": true, "audienceAdvice": true
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `settings.amounts` | no | 10–30 distinct non-negative numbers; case count = length |
| `settings.rounds` | no | positive integers whose sum ≤ cases − 2 |
| `settings.offerFactors` | no | one per round, 0–1.5 |
| `settings.jitter` | no | 0–0.2 |

Content is configuration only; the editor edits the board (amounts with a
preview of the two columns), the round schedule and factors. Mirror the
defaults in `js/data.js`.

## 3. Host UI

Palette: deep red curtain `#5a0a1a` → black, gold `#f5c542` case numbers,
the amount board in two columns (low values blue-ish, high values orange/red
as on TV), opened amounts struck through and dimmed.

Screens: **Setup** (contestant from the roster / typed; settings; 🔊; Start)
→ **Pick your case** (26 gold cases in a grid; click or phone) → **Round**
(cases grid, amount board, "open N more" counter, each opened case flips to
its amount with a sting; the board crosses it out) → **Banker's offer**
(phone-ringing animation, the offer huge, EV shown to the host only via a
toggle, audience split bar if enabled, **Deal** / **No Deal**) → **Swap?**
(when two remain) → **Reveal** (the contestant's case opens; on a Deal, the
remaining cases open one by one for the "would have won" reveal) →
**Result** / **Next contestant** / **Standings**. Undo everywhere,
consistent toolbar, splash (skipped when embedded).

## 4. Pure core (`js/dond-core.js`, UMD → `DondCore`; content validation in
`js/dond-content.js`)

State: `{phase, cases:[{n, amount, opened}], own, round, toOpen, offer,
offers:[…], deal:null|{offer, round}, swapped, contestants:[{pid,name,won}],
current, advice:{open, votes:{pid:"deal"|"no"}}, history}`. Events: `start`,
`seat{pid}`, `pickCase{n}`, `openCase{n}`, `bankerOffer` (rng), `deal`,
`noDeal`, `adviceVote{pid,choice}`, `adviceClose`, `swap{yes}`, `revealOwn`,
`revealRest`, `nextContestant`, `undo`, `finish`. Selectors: `ev(state)`,
`offerFor(state, rng)`, `boardColumns`, `phoneView`, `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"pick",n}` (contestant, any phase that expects a case),
`{t:"decision",choice:"deal"|"no"}` (contestant, intent only; host confirms),
`{t:"advice",choice}` (everyone else while advice is open). Host → phone:
`{t:"view",…}`. Screens: `wait`, `pick` (case grid with opened ones greyed),
`decision` (offer + Deal / No Deal), `advice` (Deal / No Deal vote), `result`.
The contestant's phone never shows amounts inside unopened cases (nobody's
does; the core keeps them but `phoneView` strips them).

## 6. Editor, files, success states

Files: `games/deal-or-no-deal/index.html`, `css/dond.css` + `dond-phone.css`,
`js/dond-content.js`, `dond-core.js`, `dond-app.js`, `dond-room.js`,
`dond-phone.js`, `dond-editor.js`, `dond-sound.js`, `data.js`, `board.json`,
`tests/dond-core.test.mjs`, `tests/harness.html`, `README.md`.
`<body data-gsc-game="deal-or-no-deal">`.

Success states — unit **N-U1…N-U10**: validator (rounds sum, distinct
amounts, factors); shuffle deterministic under rng and a permutation; round
schedule and `toOpen` counters; EV and offer formula incl. nice-number
rounding and jitter bounds; Deal ends the game and records the offer; swap
only with two left and only when allowed; advice votes exclude the
contestant and close; would-have-won reveal order; undo/illegal-event/
immutability; `phoneView` never contains unopened amounts. Loopback
**N-I1…N-I6**: phone case picks; offer reveal and audience split from two
phones; Deal flow with the remaining reveal; swap; reload mid-round;
editor round-trip; gates. Standalone T4: two contestants host-only.
