# Chain Reaction

Two teams build a column of **eight linked words** — every neighbouring pair is
a phrase people actually say (`SPACE · SHIP · SHAPE · UP · TOWN · HALL · WAY ·
OUT`). The top and bottom words are given; the six between are earned a letter
at a time. The leaders then play the **Speed Chain** against a 60-second clock.

Part of [Game Show Central](../../README.md). Host on a shared screen, phones
optional. Spec: `docs/14-chain-reaction-spec.md`.

---

## Playing it

1. Open `games/chain-reaction/` (or pick it from the hub lobby).
2. Name the two teams. If phones are connected, tap each one onto a team.
3. Set the chain values (`100, 200, 300` = three chains), the Speed Chain
   seconds, the per-word amount and the all-six bonus. **Start the game.**
4. Each turn the team in control picks an end — **Reveal from top** or
   **Reveal from bottom** — one letter of that word lights up, and they give
   **one guess**. You press **Correct** or **Wrong**.
   - Correct → the word goes up in their colour, they score the chain value,
     and they keep control.
   - Wrong → control passes. The incoming team may build from either end.
   - A word whose last letter gets revealed is simply **given**: no points, and
     control does not move.
5. When all eight words are up, the interstitial shows the chain and the
   scores. **Next chain** until the chains run out.
6. Level at the end? **Sudden death**: one more chain word, its two neighbours
   as the clue, letters revealed one at a time, first correct call takes it
   (and the last chain's value with it).
7. The leaders play the **Speed Chain**: the same eight-word shape with the
   first letter of every hidden word showing. Start the clock; mark each word
   ✓ or Pass (passed words come back). All six pays the bonus; otherwise it is
   the per-word amount for each one banked.

### Host keys

| Screen | Keys |
| --- | --- |
| Chain | `T` reveal from top · `B` reveal from bottom · `Y`/`Enter` correct · `N` wrong · `P` pass control · `U` undo |
| Sudden death | `R` reveal a letter · `Y` correct · `N` wrong · `P` the other team buzzed · `U` undo |
| Speed Chain | `S` start the clock · `Y`/`Enter` got it · `P` pass · `U` undo |

Keys are ignored while you are typing in a field, and while the editor is open.

### Peek — read this once

The host screen **is** the shared screen, so it shows exactly what the players
see: an unrevealed letter is not on it. **Peek** puts the word in play in the
corner so you can judge — and everyone watching can read it too. It is off by
default and it clears itself the moment you press Correct or Wrong.

---

## Phones (optional)

Everything works with no phones at all: the host reveals, listens and judges.
With phones, the team **in control** gets:

- **Build from the top / Build from the bottom** — picks the end. That is a
  real move (it is the controlling team's choice by the rules), and the host
  still judges everything that follows.
- **A guess field** — what they type is mirrored on the host screen as they
  type it, tagged with their name. It is **never** judged automatically.

In the Speed Chain, the playing team's phones get the clock and a **Pass**
button. "Got it" is the host's call alone — a `got` message from a phone is
ignored.

Every other phone gets a watch screen: the same column, the same scores, no
buttons. **No phone ever receives a hidden letter** — the host builds each
phone's column character by character from the reveal mask, so an unrevealed
letter is not in the payload at all (pinned by `C-U10` and `C-I3`).

---

## Bring your own chains

`chains.json` ships 18 chains and 4 speed chains. Load your own three ways:

- **Chain editor** in the top bar → edit → **Use in game** or **Download JSON**
  (draft auto-saves under `gsc-cr-draft-v1`).
- **Load chains (.json)** on the setup screen.
- `?game=https://example.com/my-chains.json` on the URL. An explicit link wins
  over a saved game unless the save came from that same link.

### The file

```json
{
  "title": "Chain Reaction — Game Night",
  "settings": {
    "currency": "$",
    "values": [100, 200, 300],
    "speedSeconds": 60,
    "speedPerWord": 100,
    "speedAllClear": 1000,
    "speedAllClearLabel": "$1,000",
    "revealOnWrong": false
  },
  "chains": [["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"]],
  "speedChains": [["CHAIN", "REACTION", "TIME", "OUT", "SIDE", "STEP", "FATHER", "LAND"]]
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `title` | no | text, ≤ 80 chars |
| `chains` | **yes** | ≥ 6 chains, each **exactly 8** words |
| `speedChains` | **yes** | ≥ 2 chains, same rules |
| a word | — | A–Z after uppercasing, 2–12 letters; an apostrophe or hyphen may sit **inside** the word (`MOTHER‑IN‑LAW`); no two neighbours the same; no word twice in one chain |
| `settings.currency` | no | ≤ 3 chars, default `$` |
| `settings.values` | no | 1–6 whole numbers ≥ 1. **The length is the number of chains played.** Default `[100, 200, 300]` |
| `settings.speedSeconds` | no | 10–300, default 60 |
| `settings.speedPerWord` | no | ≥ 0, default 100 |
| `settings.speedAllClear` | no | ≥ 0, default 1000 |
| `settings.speedAllClearLabel` | no | ≤ 16 chars, default `$1,000` |
| `settings.revealOnWrong` | no | `true` also gives the incoming team the next letter of the word that was missed. Default `false` |

The one rule the validator **cannot** check is the one that matters: every
adjacent pair has to be a phrase people say. The editor shows the pair under
each field (`↳ SPACE SHIP`) so you can read them back as you write.

Rounds use the chains in file order, so chain 1 in the file is the first one
played. The Speed Chain uses `speedChains[(number of chains − 1) % length]`.

---

## Files

| File | What it is |
| --- | --- |
| `index.html` | the whole game: host screens and phone screens, branching on `GSC.mode` |
| `js/cr-content.js` | PURE: the JSON contract, the word helpers, `wordProblem` for the editor |
| `js/cr-select.js` | PURE: everything that reads a state — the frontier, the masked column, `phoneView` |
| `js/cr-core.js` | PURE: the immutable reducer (`CrCore`, UMD — Node and the browser) |
| `js/cr-view.js` | host rendering + the four DOM helpers the other files share |
| `js/cr-app.js` | host glue: state, `localStorage`, buttons, hotkeys, cues, splash |
| `js/cr-clock.js` | the Speed Chain clock — the only frame loop in the game |
| `js/cr-editor.js` | the chain editor, with live per-word validation |
| `js/cr-room.js` | host glue on `GSC.host`: roster, payload validation, masked views out |
| `js/cr-phone.js` | the phone controller |
| `js/cr-sound.js` | WebAudio cues (letter tick, reveal chime, buzz, clock beat) |
| `js/data.js` | offline mirror of `chains.json` |
| `css/cr.css`, `css/cr-phone.css` | host and phone styling on the v2 design system |
| `tests/cr-core.test.mjs` | 57 unit tests (C-U1 … C-U10) |
| `tests/cr-adversarial*.test.mjs` | 62 adversarial tests added by the tester (A1 … A16) |
| `tests/harness.html` | the loopback harness (C-I1 … C-I6) |

State lives in one serialisable object under `gsc-cr-state-v1`, scoped to the
room code: opening a **new** room clears a game whose teams were made of the
old room's phones, because shell player ids restart at `p1` in every room.

### Deviation from the spec

Spec 14 §6 lists the pure core as `cr-content.js` + `cr-core.js`. The
selectors are in a third file, `cr-select.js`, so every file stays under the
800-line house limit — the same split Millionaire, Feud, Wheel and Weakest
Link made. `CrCore` re-exports all of it, so the API in the spec is unchanged.
`cr-view.js` is split out of `cr-app.js` for the same reason.

---

## Testing

```bash
cd games/chain-reaction && node --test        # 119 unit tests
python -m http.server 8620                    # from the repo root, then:
#   http://localhost:8620/games/chain-reaction/tests/harness.html
#   http://localhost:8620/games/chain-reaction/            (host, standalone)
#   http://localhost:8620/games/chain-reaction/?room=CODE  (a phone)
```

The harness is the shell: it loads the real page as an embedded host plus
three embedded phones and speaks the bridge protocol itself. `#summary.ok`
means everything passed.

## Known limits

- **Peek is on the shared screen.** There is no second screen for the host, so
  the only way to see the word in play is to show it to the room. Use it when
  you have to; it clears itself on the next judgement.
- Phones on **no** team see the watch screen and can do nothing — which is the
  point, but a late joiner who is not put on a team before Start stays a
  spectator until the next game.
- The sudden-death winner is credited the **last chain's value** so the
  standings show a clear leader; the show simply awards the tiebreak.
