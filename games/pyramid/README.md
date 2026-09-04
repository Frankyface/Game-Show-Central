# Pyramid

A `$100,000 Pyramid` style game for Game Show Central. Two teams of two: one
partner **gives** clues, the other **guesses**. Seven words, thirty seconds,
and you may never say the word. The winning team goes up to the **Winner's
Circle** for the money.

Static, no build, no dependencies. Runs inside the hub lobby or on its own,
and plays end to end with **no phones at all**.

- Host: `games/pyramid/index.html`
- Phone: the same page with `?room=CODE` (standalone) or inside the hub
- Content: `categories.json` (+ `js/data.js`, the offline copy)

---

## 1. The rules as this build plays them

**Main game.** A pyramid of six categories. Teams take turns picking one.
Each category has seven words and a 30-second clock.

| Host button | Key | What it does |
| --- | --- | --- |
| **Got it** | `Space` | one point, on to the next word |
| **Pass** | `P` | skip it — a passed word comes back round if time is left |
| **Illegal clue** | `X` | the giver said the word, part of it, or spelled it: the word is dead for the round and scores nothing |
| Start / Pause / Resume | `Enter` | the clock |
| Undo | `U` | steps back through every pick and every mark |
| Next | `N` | back to the board |

The buzzer does **not** cut off a word already being described: when time runs
out the host still judges the word in flight, and that one last mark closes the
round.

Three categories each (configurable), and the giver and guesser **swap between
categories** unless you turn that off. Higher total goes up. Level? One
tiebreak category, one word each with its own short clock, until one team is
ahead — or the host picks if the words run out.

**Winner's Circle.** Six subjects in a pyramid worth $200 / $300 / $400 /
$500 / $800 / $1,000, and 60 seconds for all six. The giver gives **examples**
("cornflakes, porridge, toast…"), the guesser names the subject ("things you
eat for breakfast"). Clear all six and the team wins the **grand prize**
($10,000 by default) instead of the box values.

- **Pass** is allowed and a passed subject can be revisited.
- **Illegal clue** — describing the subject, or using any part of its name —
  **blocks** that box for good. Play carries on with the boxes that are left,
  the team keeps everything they have won, and the grand prize is gone.

Money goes to **both** members of the winning team and is what the hub's night
scoreboard receives. Main-game points are shown but never banked — that is the
show's rule.

## 2. The secret-words problem, and the two ways round it

The host screen is being screen-shared, and the guesser is looking at it. So
**the current word never reaches the host screen** unless the host asks for it.
There is no hidden element holding it: the nodes are not built at all.

**Phone mode (preferred).** Every player joins on their phone.

| Who | What their phone shows |
| --- | --- |
| Giver | the word, huge, plus **Got it** / **Pass**, the count and the clock |
| Guesser | the clock, the count and the category title — no word, ever |
| Everybody else | the clock and who is playing |

The host screen shows the category, a giant clock, `3 / 7`, and a strip of
seven pips (position + outcome, no text). After the round the whole word list
appears with ✓ / passed / illegal so the room can check the score.

The giver's taps are a convenience, not authority: the host's ✓ / Pass /
Illegal always win, and **Illegal clue is host-only** — a phone cannot send it.

**Host-as-giver mode (no phones).** Common with a small group: the host gives
the clues for both teams.

- **Show words to me** puts the list on the host screen with a standing
  "shared screen — the guesser must not be looking" warning. Press it again and
  the nodes are removed.
- **Study (10 s)** shows the list for ten seconds so the host can read it to
  the giver privately, then hides it again.
- The same two controls exist in the Winner's Circle (**Show subjects to me**).

Pick the mode on the setup screen; it only changes the wording of the prompts,
never the rules.

## 3. Content: `categories.json`

```json
{
  "title": "Pyramid — Game Night",
  "settings": { "currency": "$", "categorySeconds": 30, "circleSeconds": 60,
    "tiebreakSeconds": 15, "wordsPerCategory": 7, "categoriesPerTeam": 3,
    "swapRoles": true, "circleValues": [200, 300, 400, 500, 800, 1000],
    "grandPrize": 10000, "grandPrizeLabel": "$10,000" },
  "categories": [
    { "title": "Hard to Shake Off", "hint": "Things that are sticky",
      "words": ["Honey", "Glue", "Chewing gum", "Sticky tape", "Maple syrup", "Tree sap", "A toffee apple"] }
  ],
  "circles": [
    { "boxes": [ { "category": "Things in a picnic basket" }, { "category": "Things that buzz" },
                 { "category": "Reasons you are late" }, { "category": "Things a lifeguard shouts" },
                 { "category": "Things under the bed" }, { "category": "Things you do at a wedding" } ] }
  ]
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `title` | no | text, ≤ 80 characters |
| `settings.currency` | no | ≤ 3 characters, default `$` |
| `settings.categorySeconds` | no | 5–300, default 30 |
| `settings.circleSeconds` | no | 5–300, default 60 |
| `settings.tiebreakSeconds` | no | 5–300, default 15 — seconds for one tiebreak word |
| `settings.wordsPerCategory` | no | 3–12, default 7. Every category must hold exactly this many |
| `settings.categoriesPerTeam` | no | 1–6, default 3. The board is twice this |
| `settings.swapRoles` | no | `true` / `false`, default `true` |
| `settings.circleValues` | no | exactly 6 whole numbers above zero, cheapest first |
| `settings.grandPrize` | no | a whole number above zero, default 10000 |
| `settings.grandPrizeLabel` | no | ≤ 24 characters; defaults to the currency + the number |
| `categories` | **yes** | at least 12, and at least `categoriesPerTeam × 2 + 1` (six for the board, one for a tiebreak) |
| `categories[].title` | **yes** | ≤ 40 characters, unique. Playful, and it should **hide** the theme |
| `categories[].hint` | no | ≤ 60 characters. The plain theme — shown to the giver only |
| `categories[].words` | **yes** | exactly `wordsPerCategory`, each 1–30 characters, unique within the category |
| `circles` | **yes** | at least 2 sets |
| `circles[].boxes` | **yes** | exactly 6, each with a `category` of 1–50 characters, unique within the set |

The shipped file has **24 categories and 4 Winner's Circle sets**, so a night
can run three or four games without repeating. A category or a circle set that
has already been played is kept out of the next draw.

**Loading your own:**

- **Category editor** in the top bar → edit → **Use in game** or
  **Download JSON**. The draft auto-saves under `gsc-pyr-draft-v1`.
- **Load categories (.json)** on the setup screen.
- `?game=https://example.com/mine.json` — an explicit link always beats the
  saved game unless the save already came from that same link.
- If `categories.json` cannot be fetched (opened from disk, say), `js/data.js`
  is used instead. The two files hold the same game and a unit test asserts it,
  so regenerate them together.

## 4. Phones

Optional everywhere. In the hub the shell owns the room; standalone, press
**Open room (phones)** and share the `?room=CODE` link.

Phone → host: `{t:"mark", result:"correct"|"pass"}` (giver only) and
`{t:"ready"}`. Anything else is dropped by `PyrCore.validatePhoneMsg`.
Host → phone: `{t:"view", …}` — the output of `PyrCore.phoneView(state, pid)`,
which is the only masked surface in the game and **never** puts a word or a
Winner's Circle subject in any view but the giver's.

Phone screens: `wait`, `giver`, `guesser`, `circle-giver`, `circle-guesser`,
`result`. Targets are ≥ 56 px and the layout holds at 320 px portrait.

## 5. Files

```
index.html            host screens + phone screens in one page
categories.json       the shipped content
css/pyr.css           host styles (gold on deep teal, the pyramid in trapezoids)
css/pyr-phone.css     phone styles
js/pyr-content.js     PURE: the JSON contract, normalisation, the nightly draw
js/pyr-core.js        PURE: the reducer and every selector (UMD -> PyrCore)
js/pyr-app.js         host glue: state, persistence, buttons, hotkeys, clocks
js/pyr-view.js        host rendering (split out to stay under 800 lines)
js/pyr-clock.js       the rAF + interval clock renderer (DOM only)
js/pyr-sound.js       WebAudio cues behind the shared 🔊 preference
js/pyr-editor.js      the in-page category editor
js/pyr-room.js        host glue on GSC.host: roster, masked views, phone intents
js/pyr-phone.js       the phone controller
js/data.js            offline mirror of categories.json
tests/pyr-core.test.mjs   node:test suite (Y-U1 … Y-U10)
tests/harness.html        browser loopback harness (Y-I1 … Y-I6)
tests/fixtures/           the small game the harness plays
```

State lives in `localStorage` under `gsc-pyr-state-v1` and is restored on
reload — with both clocks **paused**, so nothing runs down while the host is
getting the room back.

## 6. Running the checks

```bash
cd games/pyramid && node --test          # Y-U1 … Y-U10
python -m http.server 8620               # from the repo root
# then open http://127.0.0.1:8620/games/pyramid/tests/harness.html
# and http://127.0.0.1:8620/games/pyramid/ to play
```

## 7. Known limits

- Two teams of exactly two. Bigger groups rotate players between games.
- The tiebreak always leads off with Team A.
- The Winner's Circle giver is whoever the swap rotation lands on; there is no
  button to hand the role over inside the circle (`toCircle` accepts a `giver`
  override in the core if a future UI wants one).
- `shared/theme.css` has no `pyramid` accent block yet — this game declares its
  own in `css/pyr.css` under the same selector shape, so it can move upstream
  unchanged.
