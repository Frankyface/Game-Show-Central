# Krillion

A party game about giving the rarest answer that is still right. Everyone gets the same prompt —
"Name a chemical element", "Name a dog breed" — and each answer is graded from **Prawn** (the
answer everybody gives) down to **One in a Krillion** (the one nobody else would think of).
The deeper your answers, the deeper you dive.

Inspired by **Krillion** ([krillion.io](https://krillion.io)), which grades rarity against a global
database of real players' answers. This is an original adaptation for Game Show Central and is not
affiliated with Krillion.

## How rarity works here

A static website can't keep a global answer database, so **every prompt ships with a rated answer
list** written with the question. Each listed answer carries a tier and, optionally, aliases
(other spellings: "Wolfram" for Tungsten, "NYC" for New York):

| Tier | Points (default) | Puffer meter |
|---|---|---|
| Prawn | 10 | 0 |
| Schooler | 30 | 1 |
| Rare | 60 | 2 |
| Deep Cut | 85 | 3 |
| One in a Krillion | 100 | 4 |

An answer is normalised (case, spacing, accents, a leading "the/a/an", punctuation, simple plurals)
and matched against the list and its aliases. A match takes the listed tier on the spot. **Anything
not on the list goes to the judge** — the host — who rates it with a tier or rules it **Not valid**
(0 points, shown with a black square). The host can press **Add to this question** so the answer
and its tier are remembered for the rest of the session; the editor's **Import judged answers**
folds those into a file you can download, so a question set gets better every time you play it.

Two players who give the same answer both get its tier. Depth is 10 m per point.

## Modes

**Deep Dive** (default). Everyone answers the same prompt within 30 seconds (they may change their
answer until the clock ends; it closes early once everybody has answered). Answers stay hidden
until the round closes. The host rules the off-list answers, then reveals from the misses through
Prawn down to One in a Krillion, so the rarest land last while the depth markers sink. Seven
prompts; deepest diver wins, ties stay ties.

**Puffer Party.** Players sit in a ring. The holder must give a valid answer that hasn't been used
this round before the clock pops. On-list answers pass at once; the host rules off-list ones live
(a tier passes the puffer, Not valid keeps it with the clock running). Every pass shortens the clock
(12 s down to 3 s). A pop costs the holder a heart (start with 3, at most 4) and starts a new prompt
with the next player. Meter points by tier; 100 meter points buy a heart. Out at 0 hearts; the last
one floating wins. An optional round cap ends the game on hearts.

## Hosting

- **In the hub:** pick Krillion in the lobby. Phones that joined the room become players.
- **On its own:** open `games/krillion/` and press **Open room (phones)**; players open the link
  shown. Or play with no phones at all — add players by name and type their answers (tick **Hide
  what I type** while screen-sharing).
- **Game lobby** (toolbar) returns to setup: **Keep this game** shows a **Resume** button; **Start
  over** clears the game but keeps the players, prompts and settings.
- **Undo** steps back one decision (clock time included). Keys: `C` close the answers, `R` reveal,
  `U` undo.
- The saved game is scoped to its room: when a new room opens, phone players from a saved game
  become host-typed seats so a new phone can't inherit someone's depth.

## Content

`prompts.json` holds 100 prompts across 13 categories, each with 10–25 rated answers covering all
five tiers. `js/data.js` is the same file for offline use. The library (`sets/`) adds **Kids' night**
and **Pop culture** (40 prompts each). Load your own with **Load prompts (.json)** or `?game=URL`.

```json
{
  "title": "Krillion — Game Night",
  "settings": { "mode": "deepDive", "promptSeconds": 30, "promptsPerGame": 7,
    "tiers": [ { "id": "prawn", "name": "Prawn", "points": 10 }, "…" ],
    "puffer": { "hearts": 3, "maxHearts": 4, "startSeconds": 12, "floorSeconds": 3,
                "stepSeconds": 1, "meterForHeart": 100, "roundCap": 0 } },
  "prompts": [ { "text": "Name a chemical element", "category": "Science",
    "answers": [ { "text": "Tungsten", "tier": "deepcut", "aliases": ["Wolfram"] } ] } ]
}
```

| Field | Rules |
|---|---|
| `prompts` | at least 40; `text` ≤ 120; `category` ≤ 30 (optional) |
| `prompts[].answers` | 5–60 answers spanning at least 3 tiers; `text` ≤ 40; `tier` is a listed tier id; `aliases` ≤ 8; no two answers (aliases included) may normalise to the same key |
| `settings.tiers` | optional; 2–6 tiers, unique lower-case ids, names ≤ 24, strictly increasing points |
| `settings.puffer` | optional; hearts ≤ most hearts ≤ 9; shortest clock ≤ starting clock |

**Writing a good list:** rate by how often a room of ordinary players would say it, not by how
clever it is. The first three things everyone says are Prawn; real but specialist answers are Deep
Cut; save One in a Krillion for answers that are correct and genuinely obscure.

**Editor:** prompts down the left, the selected prompt's rated-answer table on the right
(answer · aliases · tier). **Download JSON**, **Use in game**, **Import judged answers**, and
**Download for the library**, which downloads the file and prints the manifest entry to paste into
`sets/index.json` (static hosting can't write files, so you commit both).

## Phones

Phones show the prompt, a field and a countdown; "Sent ✓ — you can change it" until the clock ends;
then their own tier, points and depth. In Puffer Party the holder gets the field and the shrinking
clock, everyone else sees whose turn it is and the used answers. A phone never receives another
player's answer before it is revealed, and never the rated list.

## Layout and tests

```
index.html            host + phone page
css/kr.css            host screens        css/kr-phone.css   phone screens
js/kr-content.js      content rules, normalisation, matching (pure)
js/kr-select.js       selectors: groups, review queue, reveal order, depth, phone views (pure)
js/kr-core.js         the reducer; KrCore re-exports the two files above (pure)
js/kr-app.js          host state, persistence, setup, actions
js/kr-view.js         setup / Deep Dive / result rendering
js/kr-party.js        Puffer Party rendering
js/kr-clock.js        reads the core's deadline; reports expiry
js/kr-room.js         GSC.host glue        js/kr-phone.js     phone controller
js/kr-editor.js       editor               js/kr-sound.js     WebAudio cues
tests/kr-core.test.mjs   node --test (KR-U1 … KR-U10)
tests/harness.html       loopback harness with five phones (KR-I1 … KR-I6)
```

`cd games/krillion && node --test` runs the unit tests. Serve the repo root
(`python -m http.server 8620`) and open `games/krillion/tests/harness.html` for the loopback suite.

## Known issues

- With the spec's default of 100 meter points per heart and 0–4 meter points per answer, a heart
  takes about 25+ valid answers, so it rarely triggers in a normal Puffer Party. Lower
  `meterForHeart` (setup screen or JSON) for a livelier game.
- Undoing an **Add to this question** removes it from the game in progress, but the answer stays in
  the session's prompt file (and the editor's import list) until you reload the prompts.
