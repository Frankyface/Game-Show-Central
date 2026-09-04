# The Price Is Right — Game Show Central

Contestants' Row, three pricing games, the big wheel and two showcases, for a
voice chat and a shared screen. Part of [Game Show Central](../../README.md):
open it from the hub lobby, or open this page on its own.

**Everything works with no phones.** The host types the bids, prices, digits,
Plinko answers and slot picks that players call out. Phones are a convenience,
never a requirement.

---

## Running it

| How | What to do |
| --- | --- |
| **From the hub** | Open the site, start a room, pick *The Price Is Right* from the lobby. Phones follow automatically. |
| **On its own** | Open `games/price-is-right/index.html`. Add players by name and press **Start the show**. |
| **On its own, with phones** | Press **Open room (phones)** on the setup screen and read out the join link. |
| **From disk** | Double-click `index.html`. `prizes.json` cannot be fetched from `file://`, so the identical copy in `js/data.js` is used instead. |
| **Your own prizes** | `index.html?game=https://example.com/my-prizes.json`, or **Load prizes (.json)**, or build a file in the **Prize editor**. |

A `?game=` link always wins over a saved show unless that save came from the
same link, so a shared link never silently serves somebody's old prizes.

Tests:

```bash
cd games/price-is-right && node --test          # 106 unit tests (P-U1 … P-U10, A1 … A10)
python -m http.server 8620                      # from the repo root, then open
#   http://localhost:8620/games/price-is-right/tests/harness.html
```

---

## How a night runs

1. **Contestants' Row (One Bid).** The first four players in the line-up bid
   whole dollars on an item. Bids stay masked (`•••`) until the host presses
   **Reveal the bids**. Closest **without going over** wins; an exact bid takes
   a bonus (default $500). If everybody goes over, they all bid again. The
   winner comes on down and the next player in line takes their seat.
2. **A pricing game.** The host picks, or takes the one marked *next up*:
   - **Cliff Hangers** — three small items, one guess each. The climber moves
     one step per dollar of error; 25 steps is still safe, 26 goes over the
     edge. Stay on and the prize is theirs.
   - **Plinko** — four small prices, each shown at a price that may be right.
     Guess *higher*, *lower* or *that's right*; each correct answer earns a
     chip (the first is free, five is the cap). Then drop each chip from one of
     nine slots. **The landing slot is decided by the pure core** and the
     animation only replays the bounce it rolled.
   - **Lucky Seven** — five digits of a car's price, the first given. Each digit
     costs the difference between the guess and the truth out of $7. At least
     $1 must be left after the last digit to win the car.
3. **Showcase Showdown.** After every `gamesPerShowdown` pricing games (default
   3) the players who came on down spin the big wheel, lowest winnings first.
   One spin, then the host offers a second. Closest to $1.00 without going over
   goes through; exactly $1.00 pays a bonus (default $1,000); a tie is settled
   by a one-spin-each spin-off.
4. **The Showcase.** The two showdown winners are the finalists. The one with
   more winnings chooses to bid on the first showcase or pass it over. Each
   bids on their own; closest without going over wins theirs, and a bid within
   the margin (default $250) wins **both**. Both over means nobody wins.
5. **Standings**, then **Play again**.

Fewer than four players is fine: the row simply has fewer seats and, with four
or fewer players, the winner sits back down after their pricing game. One
player can run the whole show alone.

**Undo** is on the toolbar and steps back through everything, up to 60 moves.
Hotkeys while the host screen has focus: <kbd>U</kbd> undo, <kbd>N</kbd> next
segment, <kbd>R</kbd> reveal the bids.

---

## The prize file (`prizes.json`)

| Field | Required | Rules |
| --- | --- | --- |
| `title` | no | text, ≤ 80 characters |
| `settings.currency` | no | ≤ 3 characters, default `$` |
| `settings.exactBidBonus` | no | whole dollars, default 500 |
| `settings.showcaseMargin` | no | whole dollars, default 250 |
| `settings.wheel` | no | exactly 20 whole numbers, 5–100 in steps of 5, in wheel order |
| `settings.wheelDollarBonus` | no | whole dollars, default 1000 |
| `settings.gamesPerShowdown` | no | 1–8, default 3 |
| `settings.plinko.slots` | no | exactly 9 whole dollar values, 0 or more |
| `settings.plinko.maxChips` | no | 1–9, default 5 |
| `settings.pricingGames` | no | any of `cliffhangers`, `plinko`, `luckyseven` |
| `oneBid` | **yes** | ≥ 4 items; `name` (≤ 60), `price` a positive whole number, `note` optional (≤ 120) |
| `cliffhangers` | when enabled | ≥ 1 set; exactly 3 `items` priced 1–99, plus a `prize` |
| `plinko` | when enabled | ≥ 1 set; exactly 4 `smallPrices` with `shown` and `actual` 1–9 |
| `luckyseven` | when enabled | ≥ 1 car; `car` name and a 5-digit `price` (10000–99999) |
| `showcases` | **yes** | ≥ 2 showcases of 2–4 prizes each; the total is computed for you |

```json
{
  "title": "The Price Is Right — Game Night",
  "settings": { "currency": "$", "exactBidBonus": 500, "gamesPerShowdown": 3 },
  "oneBid": [{ "name": "Espresso machine", "price": 249, "note": "15-bar pump" }],
  "cliffhangers": [{
    "items": [{ "name": "Toaster", "price": 39 }, { "name": "Blender", "price": 64 },
              { "name": "Kettle", "price": 27 }],
    "prize": { "name": "Weekend getaway", "price": 1800 }
  }],
  "plinko": [{ "smallPrices": [{ "name": "Soap", "shown": 3, "actual": 4 }] }],
  "luckyseven": [{ "car": "Compact hatchback", "price": 21485 }],
  "showcases": [{ "prizes": [{ "name": "Living-room set", "price": 3200 }] }]
}
```

The shipped file carries 12 One Bid items, 3 Cliff Hangers sets, 3 Plinko sets,
3 Lucky Seven cars and 4 showcases — enough for a full six-game episode without
repeating anything. Every message the validator produces is plain English and
names the field it is complaining about.

### The editor

**Prize editor** on the toolbar opens tabs for the settings and each list, with
add, remove and reorder, and a banner that says exactly why a file would not
load. **Download JSON** writes a file, **Use in game** adopts the draft
immediately, **Reset to shipped** restores the built-in prizes and **Start
blank** gives a minimal valid file to build on. The draft auto-saves under
`gsc-tpir-draft-v1`, so a reload never loses typing.

---

## Phones

Phones express intent; the host decides. A phone can offer a bid, a price, a
Plinko answer, a Plinko slot and a spin — it can never reveal bids, advance a
segment, or see anything it should not.

| Screen | What the player does |
| --- | --- |
| `wait` | Watches. Sees who has bid, never what they bid. |
| `bid` | A numeric pad for a One Bid bid. |
| `guess` | A pad for a Cliff Hangers price, or ten keys for a Lucky Seven digit. |
| `plinko` | *Higher / Lower / That's right*, then a slot from 1 to 9. |
| `spin` | One big SPIN button. |
| `showcase-bid` | The finalist's own showcase and a pad for their bid. |
| `result` | The final standings. |

What a phone is never sent: another player's bid before the reveal, the actual
retail price of anything still in play, the Cliff Hangers prices, the Lucky
Seven digits it has not reached, which way a Plinko small price is wrong, the
Plinko bounce path, or a showcase total.

**Take over** sits next to every phone-owned control on the host screen. One
click hands that player's controls to the host for **the rest of the current
segment** — useful when a phone drops out mid-game. The phone is shown a plain
waiting card while it lasts, and anything it sends is ignored. Moving on to the
next segment gives every phone its controls back.

---

## Layout

| File | Lines | What it holds |
| --- | --- | --- |
| `index.html` | 264 | Every host screen and the phone screen, in one page |
| `prizes.json` | 112 | The shipped prizes |
| `js/tpir-content.js` | 432 | **Pure**: the JSON contract, validation, normalisation, the draw |
| `js/tpir-select.js` | 466 | **Pure**: the plan, One Bid, the climb, the bounce, the wheel, the showcase, `phoneView` |
| `js/tpir-core.js` | 744 | **Pure**: the immutable reducer, `legalActions`, undo |
| `js/data.js` | 350 | The offline copy of `prizes.json` |
| `js/tpir-sound.js` | 136 | WebAudio cues, no audio files |
| `js/tpir-wheel.js` | 266 | The big wheel drawn as a vertical drum, and its spin |
| `js/tpir-view.js` | 473 | The host screens (and the shared `$`, `el`, `show`, `setText`) |
| `js/tpir-games.js` | 471 | The three pricing-game stages and the Plinko chip animation |
| `js/tpir-app.js` | 694 | Host glue: state, persistence, content loading, buttons, hotkeys |
| `js/tpir-editor.js` | 410 | The prize editor |
| `js/tpir-room.js` | 244 | Host glue on `GSC.host`: intents in, masked views out |
| `js/tpir-phone.js` | 232 | The phone controller |
| `css/tpir.css` | 552 | The carnival stage, the host furniture |
| `css/tpir-games.css` | 308 | The three pricing-game stages |
| `css/tpir-phone.css` | 139 | The phone, 320 px and up |
| `tests/helpers.mjs` | 123 | Shared unit-test fixtures |
| `tests/tpir-core.test.mjs` | 396 | P-U1 … P-U5: content, the row, the three games |
| `tests/tpir-show.test.mjs` | 410 | P-U6 … P-U10: the wheel, the showcase, the plan, undo, phones |
| `tests/adversarial-helpers.mjs` | 98 | Shared fixtures for the two adversarial suites |
| `tests/tpir-adversarial.test.mjs` | 573 | A1 … A6 (tester): row, cliff, plinko, Lucky Seven, wheel, showcase edges |
| `tests/tpir-adversarial-show.test.mjs` | 449 | A7 … A10 (tester): plan, validator fuzz, phone fuzz, immutability, undo |
| `tests/harness.html` | 798 | The loopback harness, P-I1 … P-I6 (60 checks) |

The four accent tokens (`--accent`, `--accent-2`, `--accent-ink`,
`--stage-glow`) come from `shared/theme.css`, so the hub shell bar, the
game-switch splash and this page all wear the same carnival red; the show's own
yellow, blue and green live in the `--tpir-*` tokens in `css/tpir.css`.

The core is split across three files (`tpir-content.js` + `tpir-select.js` +
`tpir-core.js`) and the unit suite across two, to stay under the 800-line house
limit; `TpirCore` re-exports everything, so callers only ever touch one object.
The same split is used by Family Feud, Wheel of Fortune, Weakest Link and
Millionaire.

Saved show: `localStorage` key `gsc-tpir-state-v1`, scoped to the room code, so
a new room never inherits the previous room's seats. Editor draft:
`gsc-tpir-draft-v1`. Adding `?store=NAME` to the URL moves both into their own
namespace — `tests/harness.html` uses `?store=harness` so a test run never
leaves harness prizes in the real host page's save. Sound preference:
`gsc-sound`, shared with the rest of the hub.

---

## Known limits

- The Plinko board is drawn with 12 peg rows; the core rolls that bounce and
  the animation replays it, so the odds are the core's, not the animation's.
- A pricing game is played once per contestant; there is no "play it again".
- Prizes are text only — there is no image hosting (spec 10 §1, non-goals).
- With one or two players the Showcase Showdown can have a single spinner, who
  wins it by default; the show still reaches a showcase and a set of standings.
- **A phone that joins mid-show watches until the next show.** Contestants' Row
  seats `min(4, players)`, so a running show has no empty seat to put an
  arrival in. The host is told, and the new phone gets a spectator screen with
  no controls and no numbers.
