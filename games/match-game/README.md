# Match Game

A Match Game style party game for Game Show Central. A fill-in-the-blank
prompt is read out, a panel of up to six writes answers in secret, and the
contestant tries to say the same thing. The host reveals the panel one card at
a time and judges each one. The winner plays the **Super Match**: an Audience
Match where the room votes, then a Head-to-Head against one panelist with a
multiplier wheel. Spec: `docs/18-match-game-spec.md`.

## Hosting

- **In the hub:** pick Match Game in the lobby. Phones that are already in the
  room fill the seats in order (contestant 1, contestant 2, then the panel).
  Reassign anyone with the seat pickers.
- **Standalone:** open `games/match-game/index.html`. Press **Open room
  (phones)** and players open the join link (`?room=CODE`).
- **No phones:** leave every seat on "host types". Type each panelist's answer
  into their card. The field clears and the card turns face down. Tick
  **Hide the panel answers as I type them** if the screen is shared while you
  type. Type audience answers into the Audience Match box.

### A turn

1. The prompt comes out. Panelists write; the counter reads *answered n/6*.
   **Different prompt** swaps it while nothing has been revealed.
2. The contestant answers aloud. Type it and press **Lock it in**. Nothing can
   be revealed before this.
3. **Reveal the next card** (`R`), then **Match** (`Space`) or **No match**
   (`X`). Cards flip one at a time, and the next card waits for your
   judgement. Panel phones go pencils-down at the first flip.
4. **Next** (`N`) goes to the other contestant, then to the round scores. If
   the scores are level after the last round, **Play a tiebreak prompt**.
   **Undo** (`U`) steps back one decision.

### The Super Match

- **Audience Match:** everyone not on the panel and not a contestant sends one
  answer. A re-send replaces the earlier one. The count goes up live. Close
  the board to show the top three: answers are counted after trimming,
  ignoring case and squashing spaces, and are worth 500 / 250 / 100. Use the
  **→ answer** buttons to merge synonyms ("Map" into "maps", "flashlight" into
  "a torch"); the board re-ranks. The contestant gets three guesses. For each
  one, type what they said and press **Matched #n** or **No match**.
- **Head-to-Head:** pick a panelist. They write on their phone (or you type
  for them), and you type the contestant's answer. **Spin the wheel** for
  ×10/×20/×30, turn both cards over and judge. A match pays the audience money
  times the multiplier. If the Audience Match won nothing, it plays for the
  smallest audience value. **Straight to Head-to-Head** skips the Audience
  Match entirely.

### ⟲ Game lobby

This button sits in the toolbar. **Keep this game** goes back to setup and
shows a **Resume** button. **Start over** clears the game in progress; the
line-up, prompts and settings all stay.

## Content JSON (`prompts.json`)

| Field | Type | Rule |
|---|---|---|
| `title` | string | ≤ 80 chars |
| `settings.currency` | string | ≤ 3 chars, default `$` |
| `settings.panelSize` | int | 2–6, default 6 |
| `settings.rounds` | int | 1–6, default 2 |
| `settings.pointsPerMatch` | int | 1–100, default 1 |
| `settings.audienceValues` | int[3] | default `[500, 250, 100]` |
| `settings.multipliers` | int[1–6] | default `[10, 20, 30]` |
| `settings.secondRoundRule` | bool | default `false`. When on, from round 2 a contestant may only match panelists they have not matched yet. Tiebreaks always use the whole panel. |
| `prompts[]` | `{text, hint}` | ≥ 30; `text` ≤ 160 chars and must contain `___` |
| `audiencePrompts[]` | `{text, hint}` | ≥ 10; no blank needed |

You can load content in four ways, and every route goes through the same
`validateGame`:

- `?game=URL`. An explicit URL wins over a saved file.
- **Load prompts (.json)**.
- The set library on the setup screen.
- The editor's **Use in game**.

When the page is opened from disk, `js/data.js` (a mirror of `prompts.json`)
is the fallback.

## The set library (`sets/`)

`sets/index.json` lists the extra sets: **Kids' night** (`kids-night.json`, a
4-seat panel, 300/200/100) and **Movies & TV** (`movies-and-tv.json`, with the
round-two rule on). The setup screen's picker loads one through
`GSCLibrary.mountPicker` and the source note reads `set: <name>`.

To add a set, open the **Prompt editor** and press **Download for the
library**. It downloads `<title-slug>.json` and prints the line to paste into
`sets/index.json`, plus the path to commit to. Static hosting can't write
files, so the commit is a manual step.

In the editor, enter one prompt per line. To add a hint, put it after a
vertical bar: `Dizzy Daisy ate a ___. | food`.

## Phones

| Phone → host | When |
|---|---|
| `{t:"panel", text}` | a panelist, while a prompt is open and before the first flip |
| `{t:"audience", text}` | anyone not on the panel and not a contestant, during the Audience Match |
| `{t:"hth", text}` | the chosen panelist, during the Head-to-Head |
| `{t:"ready"}` | after joining (asks for a fresh view) |

The host checks every frame with `validatePhoneMsg`:

- `text` is a string of at most 40 chars, and control characters are stripped.
- `phoneMaySend` checks that the phone is actually on that screen.
- The reducer then checks the phase again.

There is no phone message that scores anything. Host → phone is `{t:"view",
screen:"wait"|"panel"|"audience"|"hth"|"result", …}` from
`MgCore.phoneView`. No view ever carries another seat's answer, and the host's
`hostCards` returns `text:null` for every unflipped card.

## Layout

```
index.html            host screens + phone screen (one page)
prompts.json          default content (60 prompts, 20 audience prompts)
sets/                 library manifest + two themed sets
js/mg-content.js      PURE: validation, normalisation, draw order
js/mg-select.js       PURE: selectors (hostCards, topThree, phoneView, validatePhoneMsg)
js/mg-core.js         PURE: the reducer; MgCore re-exports content + selectors
js/data.js            offline mirror of prompts.json
js/mg-app.js          host glue: state, persistence, setup, buttons, hotkeys, game lobby
js/mg-view.js         setup / prompt / scores / standings rendering + DOM helpers
js/mg-super.js        Super Match rendering
js/mg-editor.js       editor (Download JSON, Download for the library, Use in game)
js/mg-room.js         GSC.host glue: roster, phone validation, masked views
js/mg-phone.js        phone controller
js/mg-sound.js        WebAudio cues (gsc-sound preference)
css/mg.css, css/mg-phone.css
tests/                node:test suites + harness.html (loopback)
```

Storage uses the keys `gsc-mg-state-v1` and `gsc-mg-draft-v1`. Add
`?store=NAME` to namespace both; the harness uses `?store=harness`.

## Testing

```bash
cd games/match-game && node --test        # 73 tests: M-U1…M-U10 + adversarial + fuzz
python -m http.server 8714 --bind 127.0.0.1
# open http://127.0.0.1:8714/games/match-game/tests/harness.html   (MG-I1…MG-I6, 55 checks)
```

## Known issues

- An unanswered card can still be revealed: it flips to a blank face, and the
  host judges it as a miss.
- Audience answers are not stemmed ("map" and "maps" stay separate until the
  host merges them), by design.
