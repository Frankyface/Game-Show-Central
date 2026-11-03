# The Chase

A Chase-style game for Game Show Central (spec: `docs/15-the-chase-spec.md`).
A team of up to four builds cash against the clock, plays the Chaser on a
seven-step board, and the survivors face him together in the Final Chase.
Phones are optional: the host can run the whole night alone.

## How to host

1. Open `games/the-chase/` from the hub (or standalone: `games/the-chase/index.html`).
2. Add up to four contestants, in hot-seat order (↑/↓ to reorder).
3. Pick the Chaser: **the host** (default — you lock his answers on this
   screen) or **a player** (they lock on their own phone, in secret).
4. Optional: open a room (standalone) so contestants lock on phones.
5. **Start the chase.**

Per contestant:

| Round | What the host does | Hotkeys |
|---|---|---|
| Cash Builder | Start the clock, read each question aloud (the answer is on screen for the host), mark Correct / Wrong / Pass. At the buzzer judge the question in flight or wave it away, then **On to the offers**. | Enter clock · Space correct · W wrong · P pass · N next · U undo |
| Offers | Click the amount the contestant takes: higher (×5, one step nearer the Chaser), what they built, or lower (÷2, one step nearer home). With $0 built the offers are worked out from one Cash Builder answer: $5,000 / $1,000 / $500 with the default $1,000 value. | U undo |
| Head to head | Both sides lock A/B/C in secret — on phones, or the host presses the contestant's spoken letter and the Chaser's choice. The screen shows only "Locked in". **Reveal contestant**, then **Reveal Chaser**; markers slide. Caught or home ends the chase. | 1 reveal contestant · 2 reveal Chaser · N next question / next contestant |
| Final Chase | Team: 2 minutes, one step per correct (head start 1 step per finalist). Chaser: 2 minutes to reach the total; every miss (**Wrong** or **Pass**) is offered to the team as a pushback and his clock stops while they answer — **Team got it** moves him back a step (on the start line it cannot, and the screen says so). | Enter clock · Space / W / P · Space/W also answer a pushback |

**Game lobby** (toolbar: Sound · Editor · Game lobby) returns to setup: **Keep this game** parks it
(clocks frozen) and shows **Resume**; **Start over** clears the game but keeps
team, questions and rules. **Undo** works everywhere; a reload brings the game
back with any running clock paused.

## Content JSON (`questions.json`)

```json
{
  "title": "The Chase — Game Night",
  "settings": { "currency": "$", "steps": 7, "startStep": 3, "cashBuilderValue": 1000,
    "cashBuilderSeconds": 60, "higherMultiplier": 5, "lowerDivisor": 2, "finalSeconds": 120,
    "chaserIsHost": true, "headStartPerMember": 1, "minHeadStart": 1, "chaserName": "The Chaser" },
  "rapid": [ { "q": "What is the largest planet in our solar system?", "a": "Jupiter" } ],
  "multi": [ { "q": "Which of these is a primary colour of light?", "options": ["Cyan", "Red", "Yellow"], "answer": 1 } ]
}
```

| Field | Rule |
|---|---|
| `title` | text ≤ 80 |
| `settings.steps` | 3–12 rungs above HOME (Chaser starts on the top one) |
| `settings.startStep` | 2 … steps−2 (so both offers have a step to move to) |
| `settings.cashBuilderValue` / `cashBuilderSeconds` | 1–1,000,000 / 15–300 |
| `settings.higherMultiplier` / `lowerDivisor` | 2–100 / 2–10 |
| `settings.finalSeconds` | 30–600, each half of the Final Chase |
| `settings.headStartPerMember` / `minHeadStart` | 0–3 / 1–4 (a target of 0 is refused) |
| `settings.chaserIsHost`, `chaserName`, `currency` | boolean, ≤ 24, ≤ 3 |
| `rapid[]` | ≥ 80 (editor warns below 200); `q` ≤ 200, `a` ≤ 80, unique questions |
| `multi[]` | ≥ 40; exactly 3 distinct `options` (≤ 60 each), `answer` 0–2 |

Shipped: 200 rapid-fire + 60 head-to-head (rising difficulty), mirrored in
`js/data.js` (offline fallback, `globalThis.CHASE_DEFAULT_GAME`).

Loading: `?game=URL` (beats a saved game unless the save came from that URL),
**Load questions (.json)**, the set library picker, or the editor. Every path
goes through `ChaseCore.validateGame`. `?store=NAME` namespaces localStorage
(the harness uses `?store=harness`).

## Question-set library

`sets/index.json` lists the committed sets; the setup screen mounts
`GSCLibrary.mountPicker` under **Questions**. Shipped: **Kids' night**
(`kids.json`) and **Movies & TV** (`movies-tv.json`).

To add a set: open the **Question editor**, build it, press **Download for the
library**. Save the file at the path shown (`games/the-chase/sets/<name>.json`)
and paste the manifest line shown into `sets/index.json`, then commit. (Static
hosting cannot write files — this is the honest workflow.)

Editor format: rapid-fire one per line `Question? | Answer`; head-to-head
`Question? | A | B | C | B` (last field = right letter).

## Phones

| Screen | Who | Shows |
|---|---|---|
| `wait` | everyone else | status, clock + total during the Cash Builder (never the question or answer), the three offers |
| `answer` | contestant in the hot seat | question, A/B/C (≥ 56 px), own lock only; the Chaser's is a "locked" lamp until the reveal |
| `chaser` | the Chaser, when a player | same in red |
| `final` | everyone | the half in play, its clock, team and Chaser steps, pushback alert |
| `result` | everyone | outcome and winnings |

Phone → host: `{t:"lock", idx}` and `{t:"ready"}` only, validated by
`validatePhoneMsg` and re-checked against `lockSideFor`. Judging, revealing and
moving markers are host-only.

## Layout

```
index.html               host + phone UI
questions.json, sets/    content
js/chase-content.js      PURE: validation, normalisation, draw order
js/chase-rules.js        PURE: the reducer (all rules, clocks as deadlines)
js/chase-core.js         PURE: selectors, phone views; re-exports → ChaseCore
js/data.js               offline mirror of questions.json
js/chase-view.js         host rendering (+ $/el/show/setText helpers)
js/chase-board.js        the board + animated markers, Final Chase pips
js/chase-app.js          app state, persistence, setup, actions
js/chase-wire.js         event wiring, hotkeys, clock loop, boot
js/chase-editor.js       question editor (Download / Download for the library / Use)
js/chase-room.js         GSC.host glue: roster, validation, masked views
js/chase-phone.js        phone controller
js/chase-clock.js, chase-sound.js
css/chase.css, chase-play.css, chase-phone.css
tests/chase-core.test.mjs   CH-U1 … CH-U10 (node --test)
tests/harness.html          CH-I1 … CH-I6 loopback (serve the repo root)
```

## Tests

```bash
cd games/the-chase && node --test                    # 75 unit tests (incl. the tester's adversarial suite)
python -m http.server 8711 --bind 127.0.0.1          # from the repo root
# open http://127.0.0.1:8711/games/the-chase/tests/harness.html  → "All 64 checks passed."
```

## Known issues

- The shipped sets are at the playable minimum-plus (88/43 and 83/43), so the
  editor shows its "under 200 / under 60" advice for them; a full four-player
  night with a long Final Chase can wrap and the screen says so.
- The accent block for `the-chase` in `shared/theme.css` is the hub agent's
  job; until it lands the page uses the default gold accent with its own
  stage, marker blue and Chaser red.
