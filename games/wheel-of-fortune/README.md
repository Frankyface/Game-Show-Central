# Wheel of Fortune — Game Show Central

Spin the wheel, call letters, buy vowels and solve the puzzle. Built to the
same rules as the rest of the hub: **static, no build step, no npm runtime
dependencies, no framework** — plain `<script>` tags and browser globals.

- **Works with no phones at all.** A host alone with a screen share can run a
  whole game from the on-screen buttons and keyboard.
- **Works with phones.** Inside the hub lobby (as an iframe) or standalone via
  a 4-letter room code and PeerJS. The host is always authoritative and can
  **Take over** for any phone player at any moment.
- **Works offline / from disk.** If `puzzles.json` can't be fetched, the
  bundled `js/data.js` copy is used and the source note says so.

## How to run it

```bash
# from the repo root
python -m http.server 8643 --bind 127.0.0.1
```

| Screen | URL |
|---|---|
| Host (standalone) | `http://127.0.0.1:8643/games/wheel-of-fortune/` |
| Phone (standalone) | `.../games/wheel-of-fortune/?room=CODE` (use the join link the host shows) |
| Custom content | `.../games/wheel-of-fortune/?game=https://example.com/mine.json` |
| Inside the hub | open the hub at `/` and pick Wheel of Fortune from the lobby |

Unit tests (Node >= 18, zero dependencies):

```bash
cd games/wheel-of-fortune && node --test
```

Browser loopback harness (serve the repo root first):
`http://127.0.0.1:8643/games/wheel-of-fortune/tests/harness.html` — it is its
own shell, so it needs no hub and no PeerJS. Green when `#summary` reads
"All 91 checks passed."

`?store=NAME` puts a page's `localStorage` in its own namespace — the harness
runs on `?store=harness`, so a test run can never overwrite the real host's
saved game or editor draft on the same origin.

## Playing it

**Regular round.** On their turn a player may **Spin**, **Buy a vowel**
($250 by default, needs that much in the round pot) or **Solve**.

- A dollar wedge means "call a consonant": every occurrence is revealed and the
  player earns *value x occurrences* and keeps the turn. A miss passes the turn.
- **BANKRUPT** wipes the round pot only — money already banked is safe — and
  passes the turn. **LOSE A TURN** just passes the turn.
- A correct solve banks `max(round pot, roundMinimum)`, clears everyone else's
  round pot, and that player starts the next round. A wrong solve passes the turn.
- **A bought vowel is always called.** The $250 comes out of the pot up front, so
  **Next player** (and handing the turn over by clicking a podium) is blocked
  until the vowel is picked. **Undo** is the way back if you bought by mistake.
- When only vowels are left, **Spin** is disabled and the banner says so.
- A full board still needs a confirmed solve — the host clicks **Solve...** then
  **Correct**.

**Toss-up.** Letters reveal one at a time (~1.2 s). Press **Start reveal**; the
first phone to buzz — or the podium the host clicks — gets one attempt.
Correct pays that toss-up's value and they start the next round; wrong locks
that player out and the reveals resume. Nobody solving pays nothing.

**Bonus round.** The player with the highest grand total plays. **R S T L N E**
are revealed automatically; they pick **3 consonants and 1 vowel** (on the host
keyboard or their phone), those are revealed, and a 10-second red-block timer
runs as a cue while they guess out loud. The host judges with **Correct** /
**Time's up**. The prize is a label, not a number, so it never touches scores.
The countdown's deadline is part of the saved game, so a reload mid-round
resumes the bar where it was rather than handing out a fresh ten seconds.

**Game lobby.** The toolbar's **⟲ Game lobby** returns to this game's own start
screen from any phase, mid-spin included. It asks first:

- **Keep this game** — parks the game and shows setup with a **Resume** button
  that puts it back exactly as it was.
- **Start over** — clears the board but keeps your players, puzzles and settings.

**Host escape hatches, always available:** **Next player** (skip), **Undo**
(exact, one step at a time), **Reveal all**, **Next round** (skip a round),
clicking a podium to hand someone the turn, and the sound toggle.
Typing a letter on the physical keyboard calls it too.

## The saved-set library

`sets/` holds extra puzzle files committed beside the game, listed in
`sets/index.json`. The setup screen mounts the shared picker
(`shared/library.js`) under **Puzzles**: choose a set, press **Load set**, and
it becomes the current content (source note `set: Movies & TV`). A set goes
through the same `validateGame` as every other route, board layout included, so
a set that cannot fit the board is refused with the same plain-English message.

Shipped sets:

| File | Name | What's in it |
|---|---|---|
| `sets/movies-and-tv.json` | Movies & TV | 10 rounds — the silver screen, the red carpet, the final episode |
| `sets/around-the-house.json` | Around the House | 10 rounds — squeaky floorboards, fitted sheets, the couch cushions |

Opened straight from disk (`file://`) the picker hides itself and says why —
saved sets need a web server.

### Adding your own set

Static hosting cannot write files, so the editor gives you the two steps:

1. Build the set in the **Puzzle Editor**, then press **Download for the
   library**. It downloads `your-title.json` and shows the exact path to commit
   it to (`games/wheel-of-fortune/sets/your-title.json`).
2. It also prints the exact manifest line — copy it into
   `games/wheel-of-fortune/sets/index.json`.

Both buttons are disabled until the draft validates, so a set can never reach
the library in a state the game would reject.

## Content JSON

Default file: `puzzles.json` (mirrored in `js/data.js` for offline use).
Load your own with the in-page **Puzzle Editor**, **Upload puzzles JSON**, or
`?game=URL` — all three go through the same `validateGame`.

```json
{
  "title": "Wheel of Fortune — Game Night",
  "settings": { "vowelCost": 250, "roundMinimum": 1000, "bonusSeconds": 10,
                "bonusPrize": "$25,000", "tossUpValues": [1000, 2000, 3000],
                "autoOrder": false, "wedges": [800, "BANKRUPT", 650] },
  "rounds": [
    { "type": "tossup",  "category": "Around the House", "puzzle": "THE JUNK DRAWER" },
    { "type": "regular", "category": "Thing",            "puzzle": "GAME SHOW CENTRAL" },
    { "type": "bonus",   "category": "Place",            "puzzle": "THE WINNER'S CIRCLE" }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | string |
| `settings.wedges` | no | 12-32 entries; each a positive whole number that is a multiple of 50, or `"BANKRUPT"` / `"LOSE A TURN"`; at least one dollar wedge. Default = the 24-wedge TV wheel |
| `settings.vowelCost` / `roundMinimum` | no | positive whole numbers (250 / 1000) |
| `settings.bonusSeconds` | no | 0-60 (0 = no timer); default 10 |
| `settings.bonusPrize` | no | any label string; default `"$25,000"` |
| `settings.tossUpValues` | no | positive whole numbers; index = nth toss-up, the last repeats |
| `settings.autoOrder` | no | `true` reorders rounds to toss-ups, then regular, then bonus |
| `rounds` | **yes** | 1-20 rounds; at most one `bonus`, and it must be last |
| `rounds[].type` | no | `regular` (default) / `tossup` / `bonus` |
| `rounds[].category` | **yes** | non-empty, 30 characters or fewer |
| `rounds[].puzzle` | **yes** | A-Z, spaces and `' - & , . ! ?` (the validator uppercases). No digits. Must **fit the board** |
| `rounds[].wedges` | no | per-round wheel override, same rules as above |
| `rounds[].value` | no | toss-up value override |

**Fitting the board.** The board is the TV layout: 4 rows of **12 / 14 / 14 /
12** tiles. `layoutPuzzle` packs words greedily, never splitting one, centres
each row and centres short puzzles vertically. Punctuation takes a tile and is
shown from the start. A puzzle that can't fit is rejected with a plain-English
message, and the editor blocks Download / Use until you fix it.

## Phone screens

| Screen | Shows |
|---|---|
| `wait` | your round pot and banked total, whose turn it is, the category and the live board |
| `turn` | SPIN / Buy a vowel / Solve per the host's `legalActions`; after a spin, "$700 — pick a consonant" plus a keyboard with used and illegal letters disabled |
| `solve` | a text box; the host still judges — nothing is auto-compared |
| `tossup` | a big buzzer: red while waiting, green once the host starts, dimmed once you're locked out |
| `bonus` | (leader only) pick 3 consonants and a vowel, then the countdown |
| `result` | final standings |

Phone to host messages: `spin`, `letter`, `buy-vowel`, `solve` (80 chars max),
`buzz`, `bonus-pick`. Every one is re-validated by `validatePhoneMsg` and
dropped unless it comes from the player whose turn it actually is.

## Layout

```
index.html                 host screens + phone screens in one page
puzzles.json               the default content GitHub Pages serves
js/wheel-content.js        PURE: constants, sanitisers, layoutPuzzle, validateGame/normalizeGame
js/wheel-core.js           PURE: createState, reduce, legalActions, selectors (re-exports the above)
js/wheel-draw.js           the SVG wheel + spin animation (visualises the core's result only)
js/wheel-view.js           board / keyboard / podium DOM builders
js/wheel-app.js            host glue: state, persistence (gsc-wheel-state-v1), buttons
js/wheel-room.js           GSC.host glue - roster in, phone intents in, phone views out
js/wheel-phone.js          GSC.player glue - the phone controller
js/wheel-editor.js         the in-page puzzle editor (draft key gsc-wheel-draft-v1)
js/wheel-sound.js          WebAudio sounds behind the shared gsc-sound toggle
js/wheel-timer.js          bonus-round red-block countdown (DOM half)
js/timer-core.js           the countdown maths (copied from games/jeopardy)
js/data.js                 offline mirror of puzzles.json
sets/index.json            the saved-set manifest; sets/*.json the sets themselves
css/wheel.css              host styles; css/wheel-phone.css; css/timer.css
tests/wheel-core.test.mjs  node:test suite (W-U1 ... W-U10)
tests/wheel-fixes.test.mjs node:test regressions for the reviewed defects
tests/harness.html         browser loopback harness (W-I1 ... W-I7, W-D fixes)
tests/harness-x.js         the cross-cutting scenarios (X-1 ... X-3, X-5)
```

A saved game is bound to the room it was played in: open a **different** room
and the previous room's phone podiums are cleared before the new roster is
applied, so a new player handed the same `p1` can never inherit a stranger's
grand total. Players the host typed in by hand keep their name and money.

`js/wheel-content.js` **must** load before `js/wheel-core.js`; the split exists
only to keep both files under the 800-line house limit, and `WheelCore` remains
the single API the app, editor, phones and tests use.

## Known limitations

- Prize wedges, Wild Card, Free Play, the Mystery and Million-dollar wedges and
  the "Final Spin" speed-up round are out of scope (spec 04 §1). The host can
  skip straight to the bonus round with **Next round**.
- Solve answers are never auto-compared — by design, the host judges.
- The bonus timer is a cue: reaching zero flashes the bar and plays a sting,
  and nothing else changes until the host presses a button.
- Sound needs a user gesture first (browser autoplay policy); the first click
  on **Start game** or the sound toggle unlocks it.
- `layoutPuzzle` packs words greedily, as the spec requires, so a long puzzle
  can occasionally be rejected when a different word order would have fitted
  (e.g. `ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN`, 48 of 52 tiles).
  Re-order or shorten the words if the editor says a puzzle doesn't fit.
