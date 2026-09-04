# 11 — Pyramid ($100,000 Pyramid style)

Status: **approved for implementation** · Component id: `pyramid`
Owns: `games/pyramid/**`. Depends on: 00 (SDK), design-system.md. Follow the
cross-cutting rules in `docs/reports/00-orchestrator-triage.md`.

## 1. The format (normative)

Two teams of two: a **giver** and a **guesser**. The giver sees a list of
words and describes each without saying it (or any part of it); the guesser
calls out answers; the host marks ✓ / pass / illegal clue.

- **Main game.** A pyramid of six categories (titles are playful and hide
  the theme, e.g. "Things that are sticky"). Teams alternate picking a
  category; each has **7 words** and a **30-second** clock. Each correct
  word = 1 point. Passing skips to the next word (passed words may come back
  if time remains). An **illegal clue** (saying the word, a form of it, or
  spelling it) kills that word for the round. Three categories per team,
  roles swap between categories (configurable: fixed roles). Higher total
  goes to the Winner's Circle; tie → one tiebreak category, one word each.
- **Winner's Circle.** Six boxes in a pyramid, worth (default) $200, $300,
  $400 / $500, $800 / $1,000; clearing all six in **60 seconds** wins the
  grand prize (default $10,000; label configurable). The giver gives
  **examples** of a category; the guesser names the category (host judges
  "close enough" wording). Giving a description or any part of the category
  name is an illegal clue: that box is **blocked** and the team keeps what
  they've won so far. Pass allowed; passed boxes can be revisited.
- **Scoring for the night.** Winner's Circle money goes to both team
  members; main-game points are shown but not banked (show rule). The night
  scoreboard receives the money.

Configurable: seconds per category and for the Winner's Circle, box values
and grand prize, words per category, categories per team, whether roles swap.
Non-goals: the "mystery 7" bonus, celebrity partners.

## 2. Content JSON (`games/pyramid/categories.json`)

```json
{
  "title": "Pyramid — Game Night",
  "settings": { "currency": "$", "categorySeconds": 30, "circleSeconds": 60,
    "wordsPerCategory": 7, "categoriesPerTeam": 3, "swapRoles": true,
    "circleValues": [200, 300, 400, 500, 800, 1000], "grandPrize": 10000, "grandPrizeLabel": "$10,000" },
  "categories": [ { "title": "It's a Wrap", "hint": "Things you wrap", "words": ["Present", "Burrito", "Bandage", "Sandwich", "Scarf", "Mummy", "Christmas lights"] } ],
  "circles": [ { "boxes": [ { "category": "Things that are cold" }, { "category": "Things in a toolbox" }, { "category": "Things you plug in" }, { "category": "What a pirate says" }, { "category": "Things you find at the beach" }, { "category": "Things you shouldn't say to your boss" } ] } ]
}
```

| Field | Required | Rules |
|---|---|---|
| `categories` | yes | ≥ 12 (a full game uses 6 + tiebreak); `title` ≤ 40, optional `hint` ≤ 60 (shown only to the giver), `words` exactly `wordsPerCategory` (7) non-empty ≤ 30 chars, unique within a category |
| `circles` | yes | ≥ 2; exactly 6 boxes each; `category` ≤ 50 |

Ship 24 original categories and 4 Winner's Circle sets. Mirror in `js/data.js`.

## 3. Host UI and the "secret words" problem

The shared screen must **never** show the current word while the giver is
describing it — the guesser is looking at that screen. Two modes:

- **Phone mode (preferred).** The giver's phone shows the current word big,
  with **Got it / Pass** buttons the giver may tap (the host's ✓/pass remain
  authoritative and the host can override). The host screen shows only the
  category, the clock, the count (e.g. `3 / 7`), and after time a list of the
  words with ✓ / passed / illegal marks. The guesser's phone shows the clock.
- **Host-as-giver mode (no phones).** The host is the giver for both teams
  (common in small groups): a **Show words to me** panel reveals the words on
  the host screen and the host clicks ✓/pass/illegal; a warning reminds the
  host that the screen is shared. Alternatively the host reads the word list
  to the giver privately before the clock starts ("study mode": words shown
  for 10 s then hidden).

Screens: **Setup** (two teams, giver/guesser per team from the roster;
standalone typed; settings), **Pyramid board** (six category cards in a
pyramid; picked ones flip to show the score), **Category play** (giant
clock, count, the current-word panel hidden or shown by mode, ✓ / Pass /
Illegal buttons + hotkeys Space/P/X, Undo, results list), **Winner's
Circle** (the six boxes lighting up as won, blocked boxes red, clock, ✓ /
Pass / Illegal), **Result** (prize splash), **Standings**. Undo everywhere,
consistent toolbar, splash (skipped when embedded).

Palette: warm gold `#f4b400` on deep teal `#0b3d4a`, cream text; the pyramid
as stacked gold trapezoids.

## 4. Pure core (`js/pyr-content.js` + `js/pyr-core.js`, UMD → `PyrCore`)

Clock as deadline timestamps (injected `now`), like Weakest Link. Events:
`start`, `pickCategory{index}`, `clockStart{now}`, `mark{result:
"correct"|"pass"|"illegal", now}`, `clockExpired{now}`, `nextTurn`,
`tiebreak`, `toCircle{team}`, `circleStart{now}`, `circleMark{result, now}`,
`circleExpired`, `undo`, `finish`. Selectors: `currentWord`, `remainingWords`
(passed words cycle back), `scores`, `circleWinnings`, `phoneView(state, pid)`
— the giver's view carries the current word; **no other pid's view ever
contains a word or a circle category** (the guesser's phone shows only the
clock); `validatePhoneMsg`.

## 5. Phones

Phone → host: `{t:"mark", result:"correct"|"pass"}` (giver only; illegal is
host-only), `{t:"ready"}`. Host → phone: `{t:"view",…}`. Screens: `wait`,
`giver` (word huge, Got it / Pass, count, clock), `guesser` (clock + count
only), `circle-giver` (category + Got it / Pass), `circle-guesser`, `result`.

## 6. Editor, files, success states

Editor: categories table with 7 word fields each, circles with 6 boxes,
settings; Download / Use / Reset / Blank; draft key `gsc-pyr-draft-v1`.

Files: `games/pyramid/index.html`, `css/pyr.css` + `pyr-phone.css`,
`js/pyr-content.js`, `pyr-core.js`, `pyr-app.js`, `pyr-clock.js`,
`pyr-room.js`, `pyr-phone.js`, `pyr-editor.js`, `pyr-sound.js`, `data.js`,
`categories.json`, `tests/pyr-core.test.mjs`, `tests/harness.html`,
`README.md`. `<body data-gsc-game="pyramid">`.

Success states — unit **Y-U1…Y-U10**: validator; word cycling with passes;
illegal removes the word; clock expiry finishes the in-flight mark; scores and
tiebreak; role swap; Winner's Circle values, blocked boxes, grand prize on
six; undo/illegal-event/immutability; `phoneView` never leaks words to the
guesser or spectators. Loopback **Y-I1…Y-I6**: giver phone shows the word and
the host screen does not (DOM text assertion); Got it from the phone
advances; host override; clock sync on phones; reload mid-category resumes
paused; editor round-trip; gates. Standalone T4: host-as-giver full game.
