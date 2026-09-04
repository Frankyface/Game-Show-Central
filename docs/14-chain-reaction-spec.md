# 14 — Chain Reaction

Status: **approved for implementation** · Component id: `chain-reaction`
Owns: `games/chain-reaction/**`. Depends on: 00 (SDK), design-system.md.
Follow the cross-cutting rules in `docs/reports/00-orchestrator-triage.md`
(Phases 1–3): `?game=URL` beats a save unless it came from that URL;
room-scoped saves; `globalThis` fallback in data.js; views pushed on
join/status; phones only express intent; own-property handler lookups; the
shared theme accent block is canonical.

## 1. The format (normative)

A **chain** is a column of 8 words where every adjacent pair forms a common
phrase or compound (`SPACE – SHIP – SHAPE – UP – TOWN – HALL – WAY – OUT`).
The **top and bottom words are shown**; the six between are hidden.

- Two teams. The team in control picks a **direction** (build down from the
  top or up from the bottom) and one letter of the next hidden word in that
  direction is **revealed** (letters reveal left to right). They then give
  **one guess** for that word.
  - Correct → the word is revealed, the team scores the word's value, and
    they keep control (they may again pick either direction).
  - Wrong → control passes to the other team, who reveals the next letter of
    **either** adjacent hidden word and guesses.
  - A word whose letters are all revealed is simply given (no points) and
    control stays.
- **Values.** Chain 1: 100 per word, Chain 2: 200, Chain 3: 300 (configurable
  list; number of chains = list length). Completing a chain moves to the next.
- **Speed Chain** (bonus, the leading team): a chain with the top and bottom
  shown and the **first letter of each hidden word**; the team calls out the
  words in order in **60 seconds**; the host marks each ✓ / pass (passed words
  come back); all six = bonus (default $1,000 label, configurable); otherwise
  a per-word amount.
- Ties after the chains → one sudden-death chain word (first correct guess).

Configurable: values per chain, Speed Chain seconds/per-word/all-clear
bonus, whether a wrong guess also reveals the next letter for the opponent.
Non-goals: the "Instant Reaction" bonus, buzz-in variants.

## 2. Content JSON (`games/chain-reaction/chains.json`)

```json
{
  "title": "Chain Reaction — Game Night",
  "settings": { "currency": "$", "values": [100, 200, 300],
    "speedSeconds": 60, "speedPerWord": 100, "speedAllClear": 1000, "speedAllClearLabel": "$1,000" },
  "chains": [ ["SPACE", "SHIP", "SHAPE", "UP", "TOWN", "HALL", "WAY", "OUT"] ],
  "speedChains": [ ["FIRE", "WORKS", "SHOP", "KEEPER", "RING", "SIDE", "WALK", "OUT"] ]
}
```

| Field | Required | Rules |
|---|---|---|
| `chains` | yes | ≥ 6; each exactly **8** words; letters A–Z only after uppercasing (apostrophes/hyphens allowed inside), 2–12 letters; adjacent words distinct; no word repeated within a chain |
| `speedChains` | yes | ≥ 2, same rules |
| `settings.values` | no | 1–6 positive integers |

Ship **18** chains and **4** speed chains — every adjacent pair must be a
genuinely common phrase or compound (write them carefully; the tester will
read all of them). Mirror in `js/data.js`.

## 3. Host UI

Palette: electric blue `#0f3bd9` and hot pink `#ff2e88` accents on a
near-black stage, white tiles; the chain as a vertical column of letter
tiles (like a word-column crossword), revealed letters filling in from the
left, revealed words lighting in the team's colour.

Screens: **Setup** (two teams from the roster / typed; settings; 🔊; Start)
→ **Chain** (the 8-word column with letter tiles, top and bottom words
shown; team score panels; control indicator; **Reveal from top / Reveal from
bottom** (only the two hidden words adjacent to revealed words are
eligible), **Correct / Wrong** for the spoken guess, an optional typed
guess field that mirrors the phone, chain value badge, chain n of N) →
**Chain complete** interstitial → **Speed Chain** (column with first letters,
giant clock, ✓ / Pass, hotkeys) → **Result / Standings**. Undo everywhere,
consistent toolbar, splash (skipped when embedded). Sounds: letter tick,
word reveal chime, wrong buzz, clock beat.

## 4. Pure core (`js/cr-content.js` + `js/cr-core.js`, UMD → `CrCore`)

State: `{phase, chainIndex, chain:{words, revealed:[[bool]], solved:[bool]},
control, scores:[a,b], values, guessText, speed:{words, revealed, marks,
deadline}, history}`. Events: `start`, `reveal{direction:"top"|"bottom"}`,
`guess{text?}` (records the spoken/typed guess), `judge{correct}`,
`passControl`, `nextChain`, `toSpeed{team}`, `speedStart{now}`,
`speedMark{result}`, `speedExpired{now}`, `suddenDeath`, `undo`, `finish`.
Selectors: `eligibleWords`, `leader`, `phoneView`, `validatePhoneMsg`.
Clock as deadline timestamps (injected `now`).

## 5. Phones

Phone → host: `{t:"direction",dir}` (controlling team, intent), `{t:"guess",
text}` (controlling team, ≤ 24 chars, shown to the host, never auto-judged),
`{t:"speed",result:"got"|"pass"}` (host-only actually judges; phones may
send `pass`). Host → phone: `{t:"view",…}`. Screens: `wait`, `control`
(direction buttons + guess field, the chain column with revealed letters),
`watch` (column only), `speed` (clock + column), `result`.

## 6. Editor, files, success states

Editor: chains as 8 stacked fields each with live validation of length and
letters; speed chains likewise; settings; Download / Use / Reset / Blank;
draft key `gsc-cr-draft-v1`.

Files: `games/chain-reaction/index.html`, `css/cr.css` + `cr-phone.css`,
`js/cr-content.js`, `cr-core.js`, `cr-app.js`, `cr-clock.js`, `cr-room.js`,
`cr-phone.js`, `cr-editor.js`, `cr-sound.js`, `data.js`, `chains.json`,
`tests/cr-core.test.mjs`, `tests/harness.html`, `README.md`.
`<body data-gsc-game="chain-reaction">`.

Success states — unit **C-U1…C-U10**: validator; eligibility (only words
adjacent to revealed ones); letter reveal order and the all-letters-given
rule; correct keeps control and scores the chain value; wrong passes
control; chain completion advances and values change; Speed Chain marks,
passes cycling, expiry, all-clear bonus; sudden death on a tie; undo/
illegal-event/immutability; `phoneView` never contains hidden letters of
unrevealed words. Loopback **C-I1…C-I6**: phone direction + guess reach the
host and are not auto-judged; host judges; column letters render as
revealed; Speed Chain clock on phones; reload mid-chain; editor round-trip;
gates. Standalone T4: three chains and a Speed Chain host-only.
