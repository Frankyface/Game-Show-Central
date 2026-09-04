# 10 — The Price Is Right

Status: **approved for implementation** · Component id: `price-is-right`
Owns: `games/price-is-right/**`. Depends on: 00 (SDK), 09/design-system.md
(build on v2 tokens; carnival palette below). Follow every convention the
existing games use (see `docs/reports/00-orchestrator-triage.md`
"Cross-cutting defects": `?game=URL` beats a save unless it came from that URL,
saved state is room-scoped, `data.js` sets a `globalThis` fallback, views are
pushed on join/status, phones only express intent).

## 1. The format (normative)

An episode is a sequence of segments the host steps through:

1. **Contestants' Row (One Bid).** Four players bid on the price of an item.
   Bids are whole dollars; the closest **without going over** wins (an exact
   bid wins a bonus, default $500). If everyone overbids, all four rebid. The
   winner "comes on down" to a pricing game; their row seat is refilled by the
   next player in the roster.
2. **Pricing game** (one per winner; the host picks, or "next in rotation"):
   - **Cliff Hangers.** Three small items, guessed one at a time. The
     mountain climber moves one step per dollar of error (25 steps total);
     falling off the cliff loses; staying on wins the prize.
   - **Plinko.** The player wins up to 5 chips by guessing whether each of 4
     small prices is shown correctly (first chip free). Each chip is dropped
     from one of 9 slots into a 9-slot board (defaults: 100, 500, 1000, 0,
     10000, 0, 1000, 500, 100); the landing slot comes from the pure core
     (rng) and the animation only visualises it (bounce path with the same
     rules as the wheel: result decided first).
   - **Lucky Seven.** The player has $7 in singles and guesses the five
     digits of a car's price one at a time (the first digit is given); each
     digit costs |guess − actual| dollars; they must have ≥ $1 left after the
     last digit to win.
3. **Showcase Showdown.** After every three pricing games (configurable),
   the three winners spin the **big wheel** (20 segments: 5¢ to $1.00):
   one spin, optionally a second; the closest total to $1.00 without going
   over advances; exactly $1.00 wins a bonus (default $1,000); ties → spin-
   off. Two showdowns produce the two **showcase** finalists.
4. **Showcase.** Two showcases (sets of prizes with a total value). The
   top winner chooses to bid or pass the first showcase; each bids on their
   own; closest without going over wins their showcase; within a margin
   (default $250) wins **both**.

Everything can be run with fewer than four players (empty seats are skipped)
and with **no phones** (host types bids/guesses that players call out).
Configurable: bonus amounts, margin, wheel values, plinko values and chip
rules, number of pricing games per showdown, which pricing games are
enabled. Non-goals: other pricing games, prize images (a text `note` field
only; no image hosting).

## 2. Content JSON (`games/price-is-right/prizes.json`)

```json
{
  "title": "The Price Is Right — Game Night",
  "settings": { "currency": "$", "exactBidBonus": 500, "showcaseMargin": 250,
    "wheel": [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100],
    "wheelDollarBonus": 1000, "gamesPerShowdown": 3,
    "plinko": { "slots": [100,500,1000,0,10000,0,1000,500,100], "maxChips": 5 },
    "pricingGames": ["cliffhangers", "plinko", "luckyseven"] },
  "oneBid": [ { "name": "Espresso machine", "price": 249, "note": "Stainless steel, 15-bar pump" } ],
  "cliffhangers": [ { "items": [ { "name": "Toaster", "price": 39 }, { "name": "Blender", "price": 64 }, { "name": "Kettle", "price": 27 } ], "prize": { "name": "Weekend getaway", "price": 1800 } } ],
  "plinko": [ { "smallPrices": [ { "name": "Soap", "shown": 3, "actual": 4 }, { "name": "Cereal", "shown": 5, "actual": 5 }, { "name": "Tea", "shown": 8, "actual": 6 }, { "name": "Chips", "shown": 2, "actual": 2 } ] } ],
  "luckyseven": [ { "car": "Compact hatchback", "price": 21485 } ],
  "showcases": [ { "prizes": [ { "name": "Living-room set", "price": 3200 }, { "name": "Trip to Lisbon", "price": 5400 } ] } ]
}
```

| Field | Required | Rules |
|---|---|---|
| `oneBid` | yes | ≥ 4 items; `price` positive integer; `name` ≤ 60; `note` ≤ 120 optional |
| `cliffhangers` | when enabled | ≥ 1; exactly 3 items with prices 1–99; a `prize` |
| `plinko` | when enabled | ≥ 1; exactly 4 small prices with `shown`/`actual` 1–9 |
| `luckyseven` | when enabled | ≥ 1; `price` a 5-digit integer 10000–99999 |
| `showcases` | yes | ≥ 2; 2–4 prizes each; total computed |
| `settings.wheel` | no | 20 integers 5..100 step 5 (order as on the wheel) |
| `settings.plinko.slots` | no | 9 non-negative integers |

Ship 12 One-Bid items, 3 Cliff Hangers sets, 3 Plinko sets, 3 Lucky Seven
cars, 4 showcases — original, plausible prices in USD. Mirror in `js/data.js`.

## 3. Host UI

Palette: carnival — saturated yellow `#ffd23f`, red `#e63946`, blue
`#1d6fdc`, green `#2dc653`, on a warm dark stage; chunky bevelled panels.

Screens: **Setup** (roster order; segment plan preview: how many pricing
games/showdowns the roster yields; enabled games; 🔊; Start) → **Contestants'
Row** (four bid podiums with names, the item card with name/note, bids appear
masked until "Reveal bids", actual price reveal with a "come on down"
animation for the winner) → **Pricing game** screen per game (Cliff Hangers:
mountain with a climber that steps per dollar; Plinko: 9-slot board with a
chip-drop animation to the core-chosen slot; Lucky Seven: five digit tiles
and a wallet of $1 bills) → **Showcase Showdown** (the big wheel, vertical
drum look, spin button, running total, bonus spin) → **Showcase** (two
showcase cards, bids masked until reveal, winner banner; "wins both") →
**Standings** (total winnings per player) → **Play again**. Undo everywhere;
consistent host toolbar; splash (skipped when embedded).

## 4. Pure core (`js/tpir-content.js` + `js/tpir-core.js`, UMD → `TpirCore`)

State: `{phase, segmentIndex, plan:[…], row:{seats:[pid], bids:{pid:n},
revealed}, game:{kind, …per-kind state}, showdown:{spinners, spins,
current}, showcase:{finalists, assignments, bids, revealed}, winnings:{pid:n},
history}`. Events: `start`, `bid{pid,amount}`, `revealBids`, `rebid`,
`pickGame{kind}`, `chGuess{amount}`, `plinkoAnswer{i, higher|lower|correct}`,
`plinkoDrop{slot}` (rng decides the landing slot), `l7Guess{digit}`,
`spin{pid}` (rng), `spinAgain`, `stay`, `showcasePass`, `showcaseBid{pid,
amount}`, `revealShowcase`, `nextSegment`, `undo`, `finish`. Selectors:
`plan(roster, settings)`, `rowWinner(bids, price, bonus)`, `showdownWinner`,
`showcaseResult`, `phoneView`, `validatePhoneMsg`, `legalActions`.

## 5. Phones

Phone → host: `{t:"bid",amount}` (row seat or showcase finalist), `{t:"guess",
value}` (Cliff Hangers price / Lucky Seven digit), `{t:"plinko",answer|slot}`,
`{t:"spin"}`. Host → phone: `{t:"view",…}`. Screens: `wait`, `bid` (numeric
pad, masked on the host until reveal), `guess`, `plinko` (higher/lower then
slot picker 1–9), `spin` (big button), `showcase-bid`, `result`. Everything
mirrored on the host with a **Take over** control.

## 6. Editor, files, success states

Editor: tabs per list (One Bid, Cliff Hangers, Plinko, Lucky Seven,
Showcases) with add/remove/reorder and inline validation; settings form;
Download / Use / Reset / Blank; draft key `gsc-tpir-draft-v1`.

Files as in the other games (`index.html`, `css/tpir.css` + `tpir-games.css`
+ `tpir-phone.css`, `js/tpir-content.js`, `tpir-core.js`, `tpir-app.js`,
`tpir-games.js` (per-game DOM), `tpir-wheel.js` (big wheel draw), `tpir-room.js`,
`tpir-phone.js`, `tpir-editor.js`, `tpir-sound.js`, `data.js`, `prizes.json`,
`tests/tpir-core.test.mjs`, `tests/harness.html`, `README.md`).
`<body data-gsc-game="price-is-right">`.

Success states — unit **P-U1…P-U10**: validator table; One Bid winner
incl. exact bonus, all-over → rebid, ties (earliest bid wins); Cliff Hangers
step maths and fall; Plinko chip earning and rng slot; Lucky Seven cost and
loss at $0; showdown totals, over $1.00 bust, exact $1.00 bonus, spin-off;
showcase closest-without-over and "wins both" margin; plan generation for
1–12 players; undo/illegal-event/immutability tables; phone message + view
leaks (bids masked). Loopback **P-I1…P-I6**: phone bids masked until reveal;
plinko drop animation ends on the core slot; big wheel lands on the core
segment; take over; reload at each segment; editor round-trip; gates.
Standalone T4: a full episode host-only with 4 manual players.
