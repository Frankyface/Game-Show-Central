# Deal or No Deal — the banker calls, for game night

Twenty-six sealed cases from a cent to a million, a round schedule that thins
the board, and a banker who keeps ringing with an offer. Part of
[Game Show Central](../../README.md); it also runs perfectly well on its own.

- **Host:** open `games/deal-or-no-deal/` and share the screen.
- **Phones (optional):** press **Open room (phones)** and give people the link
  and the four-letter code. Everything works without them.
- **Your own board:** the built-in **Board editor**, a `.json` upload, or
  `?game=https://example.com/my-board.json`.

---

## 1. How to run it

| Where | What to do |
|---|---|
| GitHub Pages / any static host | open `games/deal-or-no-deal/` |
| From the hub | pick the Deal or No Deal tile in the lobby; phones follow automatically |
| From disk (`file://`) | works — `board.json` can't be fetched, so the built-in copy in `js/data.js` is used, and phones are unavailable |
| Locally with phones | `python -m http.server 8620` at the repo root, then `http://<your-ip>:8620/games/deal-or-no-deal/` |

Tests:

```bash
cd games/deal-or-no-deal && node --test    # the pure core, N-U1 … N-U10
python -m http.server 8620                 # then open
# http://localhost:8620/games/deal-or-no-deal/tests/harness.html   (N-I1 … N-I6)
```

## 2. Playing it

1. **Setup.** Add contestants by hand, or let phones join and become the list.
   Decide whether the final swap is offered and whether phones advise, then
   **Start the game**.
2. **Who's playing.** One contestant at a time. Pick a name; a fresh, shuffled
   board of cases is dealt for them.
3. **Pick the case you keep.** Click a gold case (or the contestant taps one on
   their phone). It stays sealed, marked with a white rim, until the very end.
4. **The rounds.** The schedule is **6, 5, 4, 3, 2, 1, 1, 1, 1** — open that
   many cases, and each one flips to its amount with a sting while the two-column
   board strikes the amount out. The counter in the banner says how many are
   left in the round.
5. **The banker.** When the round is done, press **The banker is calling**. The
   phone rings, the offer lands huge on screen, and the room's phones vote Deal
   or No Deal as a live split. **Close the vote** freezes the split; the same
   button then reads **Open the vote** and re-opens it — so a phone that joined
   after the banker had already called still gets a ballot, and a board whose
   file switched advice off can still be put to the room. Votes already cast
   survive a close and re-open. **Show the odds (host only)** reveals the board
   average and what percentage of it the banker is offering — for the host's
   eyes, on the shared screen, so use it when you want the drama of a bad offer.
6. **Deal** ends the board: the remaining cases open one by one for the
   "what you would have won", and the contestant's own case goes last.
   **No deal** starts the next round.
7. **The swap.** With two cases left the contestant may swap theirs for the last
   one. Then **Open case N** — that is the win.
8. **Result.** "You leave with $X", then **Next contestant** or **Finish the
   night** for the standings. **End the night** from the board also works. The
   hub's night scoreboard is told every total.

Hotkeys on the host screen: `B` the banker calls, `D` deal, `N` no deal,
`Space` the next step of a reveal, `U` undo. Undo works everywhere and steps
back exactly one move.

## 3. The banker's arithmetic

`offer = round(EV × factor[round] × (1 + jitter))`

- **EV** is the mean of every amount still sealed — the contestant's own case
  included. That is why the offer collapses when a big case goes.
- **factor** rises with the round: `0.12, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0`.
  Early on the banker is mean; by the last round he offers the board average.
- **jitter** is a random ±5 % so two identical boards never get identical
  offers. Set `jitter: 0` for a repeatable game.
- **round** is a *nice* number: nearest 100 below 10,000, nearest 1,000 below
  100,000, nearest 5,000 above. One guard beyond the spec: below $50 that
  rounding lands on **zero**, and an offer of nothing is not a game, so such an
  offer goes to the nearest **whole dollar** instead, floored at one cent. The
  banker never offers nothing while money is on the board, and never reads out
  a value like "$3.15".

The offer is **not** guaranteed to rise round on round. It tracks the board, and
the board gets worse when the top amounts go. That is the game.

## 4. The board file (`board.json`)

```json
{
  "title": "Deal or No Deal — Game Night",
  "settings": {
    "currency": "$",
    "amounts": [0.01, 1, 5, "…", 750000, 1000000],
    "rounds": [6, 5, 4, 3, 2, 1, 1, 1, 1],
    "offerFactors": [0.12, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0],
    "jitter": 0.05,
    "allowSwap": true,
    "audienceAdvice": true
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | text, ≤ 80 characters |
| `settings.currency` | no | ≤ 3 characters (default `$`) |
| `settings.amounts` | no | 10–30 **distinct, non-negative** numbers. The case count is the length of this list; the order in the file does not matter (they are sorted for the board and shuffled into the cases at the table) |
| `settings.rounds` | no | whole numbers above zero, one per round, summing to **at most `cases − 2`** — two cases must survive to the end |
| `settings.offerFactors` | no | one per round, each 0–1.5. Omitted, a rising ramp is generated |
| `settings.jitter` | no | 0–0.2 (default 0.05) |
| `settings.allowSwap` | no | boolean, default true |
| `settings.audienceAdvice` | no | boolean, default true. It decides whether the banker's call opens a ballot; the host can open or close one by hand at any offer regardless. The panel is simply not drawn when nobody is connected and nobody has voted |

Everything in the file is configuration: there is no question text to write.
The **Board editor** edits exactly these fields, previews the amounts as the two
columns the host screen shows, and previews the round schedule with the banker's
factor per round. **Download JSON** writes a `board.json` that has already
passed `validateBoard`; **Use in game** loads the draft straight into the
session. Drafts auto-save under `gsc-dond-draft-v1`.

## 5. Phones

Phones are optional and thin — they render what the host sends and send one
intent back. **No phone ever receives the amount inside a sealed case**: the
core keeps the amounts and `phoneView` strips them, and every money value a
phone receives arrives as a formatted string rather than a number.

| Screen | Who sees it | What they can do |
|---|---|---|
| `wait` | everyone else | nothing |
| `pick` | the contestant | tap a case: the one they keep, then one per opening |
| `decision` | the contestant | **Deal** / **No deal** — an *intent*: a banner appears on the host screen and nothing happens until the host presses the button |
| `advice` | everyone but the contestant | vote Deal / No deal once per offer; the host screen shows the live split |
| `result` | everyone | the standings, and their own total |

The host is authoritative throughout. A phone can never open a case out of
turn, take the banker's money, or advance the game.

## 6. Files

```
index.html               host screens + phone screens in one page
board.json               the shipped 26-case board
css/dond.css             host screens (curtain red, gold cases, the amount board)
css/dond-phone.css       the phone controller, 320-430 px portrait
js/dond-content.js       PURE: the JSON contract, the shuffle, the banker's arithmetic
js/dond-core.js          PURE: the reducer and every selector (re-exports the above)
js/dond-view.js          host rendering + the four DOM helpers
js/dond-app.js           host glue: state, persistence, buttons, hotkeys, sound
js/dond-editor.js        the board editor
js/dond-room.js          host glue on GSC.host: roster, validation, per-phone views
js/dond-phone.js         the phone controller on GSC.player
js/dond-sound.js         WebAudio cues (no audio files)
js/data.js               offline mirror of board.json
tests/dond-core.test.mjs node:test, N-U1 … N-U10
tests/harness.html       the loopback harness, N-I1 … N-I6
```

## 7. Known behaviour worth knowing

- **Ending the night mid-board** banks the contestant at the offer they had
  already accepted, or at nothing if they had not dealt — there is no partial
  credit for a sealed case.
- **A new room clears a game in progress** when the contestants came from
  phones: shell player ids restart at `p1` in every room, so the old seats
  cannot be trusted. Contestants the host typed in survive.
- **The reveal can be stopped early.** `Open case N` ends the board whenever the
  host presses it; any cases still sealed simply stay sealed, except that a
  single lone remaining case is opened with it so the board is never left with
  one mystery.
- **A saved game is rewritten on the way out.** The page saves on `beforeunload`,
  so deleting `gsc-dond-state-v1` from devtools *while the tab is open* used to
  bring the game straight back on reload. The unload save now skips itself when
  the key has been deleted, so clear-then-reload works — but the tidy way to
  start over is still the editor's **Reset to shipped** → **Use in game**, or
  **Play again** on the standings screen.
- **The accent colours** come from the per-game block in `shared/theme.css`
  (`--accent #b5121b`, `--accent-2 #f2c14e`), so the hub's shell bar and splash
  match the `.gsc-*` components inside the game. This sheet declares none of
  its own; the game's identity is `--case-gold` and the curtain `--stage-*`.
