# Weakest Link

A faithful, projector-first adaptation of *The Weakest Link* for Game Show
Central. A team of 3–12 players answers rapid-fire general-knowledge questions
in turn against a round clock to build a **money chain**; after each round they
vote one of their own off; the last two play head-to-head for the bank.

Phones are optional. A host alone with a screen share can run the whole game
and enter every vote by hand. When phones are connected, the vote is a **secret
ballot** — the host screen shows dots and an `n/m` counter until the reveal, and
no phone ever learns another phone's vote.

- **Host screen:** `games/weakest-link/index.html`
- **Phone screen:** the same page in player mode (`?embed=player` inside the
  hub, or `?room=CODE` standalone)
- **Content:** `questions.json` — 160 original questions across 9 categories

## Running it

```bash
# from the repo root
python -m http.server 8620
# host:    http://localhost:8620/games/weakest-link/
# harness: http://localhost:8620/games/weakest-link/tests/harness.html

cd games/weakest-link && node --test      # pure-core unit tests (K-U1…K-U10)
```

The page also works opened straight from disk: if `questions.json` cannot be
fetched it falls back to the identical copy in `js/data.js`.

Custom questions load three ways, all through the same `validateGame`:

| How | What to do |
|---|---|
| URL | `index.html?game=https://example.com/my-questions.json` |
| File | **Load questions (.json)** on the setup screen |
| Editor | **Question editor** → build or paste → **Use in game** |

## How a game runs

1. **Setup** — add players (list order is the order of play), optionally
   shuffle the question order, optionally open a phone room, **Start**.
2. **Round** — the clock starts at 150 s and drops 10 s each round. Ask the
   player in the spotlight the question on screen.
   - **Correct** (`Space`) climbs the chain: 1,000 → 2,500 → 5,000 → 10,000 →
     25,000 → 50,000 → 75,000 → 125,000.
   - **Wrong / Pass** (`X`) drops the chain to zero.
   - **Bank** (`B`) — *before* the question — moves the chain into the round
     bank and resets the chain.
   - Completing the top link banks it automatically and ends the round.
   - When the clock hits 0 the question in flight is still judged, then the
     round ends. Anything left on the chain is lost; the bank joins the total.
   - **Undo** steps back exactly one action. **End round** is the escape hatch.
   - The answer is hidden by default so it is safe to screen-share. **Show
     answer** reveals it for two seconds; the checkbox keeps it up.
3. **Voting** — each remaining player votes for the weakest link, on their
   phone or through the host's dropdown. **Show statistics** reveals the round's
   strongest and weakest link with the numbers behind them. **Reveal a vote**
   goes one at a time. A tie is broken by that round's strongest link.
4. **Goodbye** — "You are the weakest link. Goodbye." When that vote leaves two
   players, the button reads **To the head-to-head**: the last two do not play a
   round of their own.
5. **Final** — the last full-team round's bank is tripled.
   The strongest link picks who answers first; five questions each, alternating;
   a tie goes to sudden death in pairs.

## Content JSON

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
    { "q": "In which ocean is the island of Madagascar?", "a": "The Indian Ocean", "category": "Geography" }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | text, trimmed to 80 characters |
| `settings.currency` | no | ≤ 3 characters, default `$` |
| `settings.chain` | no | 3–12 strictly increasing positive integers |
| `settings.roundSeconds` | no | positive integers ≤ 600; index = round, the last entry repeats |
| `settings.finalPlayers` | no | must be `2` — only a two-player head-to-head is supported |
| `settings.finalQuestionsEach` | no | 1–10, default 5 |
| `settings.finalMultiplier` | no | 1–5, default 3 |
| `settings.topOfChainEndsRound` | no | boolean, default `true` |
| `questions` | **yes** | ≥ 40 rows; the editor warns below 120 |
| `questions[].q` | **yes** | non-empty, ≤ 200 characters |
| `questions[].a` | **yes** | non-empty, ≤ 80 characters |
| `questions[].category` | no | ≤ 30 characters |

Questions are drawn in file order unless **Shuffle** is ticked. When the pool
runs out the game wraps and says so on the host screen.

## Phone features

Phones do one thing the host screen cannot: keep the ballot secret.

| Phone screen | What the player sees |
|---|---|
| `wait` | whose turn it is, the round bank and the team total |
| `vote` | every other remaining player as a big button; the vote can be changed until the reveal |
| `tiebreak` | the tied names — only on the strongest link's phone |
| `goodbye` | "You are the weakest link. Goodbye." |
| `out` | the standings, for players already voted off |
| `final` | whose question it is and the head-to-head tally |
| `result` | the winner |

Phone → host messages are only `{t:"vote",target}` and `{t:"tiebreak",target}`,
and both are re-checked host-side (`WlCore.canVote`) before they touch state.
Host → phone is a single `{t:"view", …}` payload built by `WlCore.phoneView`,
which never contains the question, the answer, or anyone else's vote.

## Layout

| File | Lines | What it is |
|---|---|---|
| `index.html` | host + phone screens in one page (`?embed=` picks the mode) |
| `css/wl.css` | the black/steel stage, cold-blue spotlight, red goodbye |
| `css/wl-phone.css` | the 320 px-wide phone controller |
| `js/wl-content.js` | **pure**: the JSON contract, `validateGame`, `normalizeGame`, question order |
| `js/wl-core.js` | **pure**: the reducer, the clock as deadline timestamps, selectors, phone payloads |
| `js/wl-app.js` | host glue: state, `localStorage` (`gsc-wl-state-v1`), rendering, hotkeys |
| `js/wl-clock.js` | the clock renderer (rAF + an interval safety net); DOM only |
| `js/wl-sound.js` | WebAudio cues behind the shared `gsc-sound` toggle |
| `js/wl-editor.js` | the question editor and the CSV/TSV importer |
| `js/wl-room.js` | host glue on `GSC.host` — roster in, masked views out |
| `js/wl-phone.js` | phone glue on `GSC.player` |
| `js/data.js` | offline mirror of `questions.json` |
| `tests/wl-core.test.mjs` | `node --test` suite, success states K-U1…K-U10 |
| `tests/harness.html` | loopback harness, success states K-I1…K-I6 |

`wl-content.js` and `wl-core.js` are the only files with game rules in them,
they have no DOM or timers, and they run unchanged in Node and the browser.

## Known limits

- Only a two-player head-to-head is supported (`finalPlayers` must be 2).
- When the question pool wraps, "Questions are repeating" appears in the notice
  line under the question, but the next Bank or Next round clears it — there is
  no persistent badge yet.
- Players who join mid-game watch until the next game starts.
- The head-to-head always plays all `finalQuestionsEach` questions; it does not
  stop early when the result is already decided.
