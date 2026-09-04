# Millionaire — Who Wants to Be a Millionaire for game night

Fifteen questions, one hot seat, a money tree with two safe havens, four
lifelines and a Fastest Finger First round on phones. Part of
[Game Show Central](../../README.md); it also runs perfectly well on its own.

- **Host:** open `games/millionaire/` and share the screen.
- **Phones (optional):** press **Open room (phones)** and give people the link
  and the four-letter code. Everything works without them.
- **Your own questions:** the built-in **Question editor**, a `.json` upload,
  or `?game=https://example.com/my-questions.json`.

---

## 1. How to run it

| Where | What to do |
|---|---|
| GitHub Pages / any static host | open `games/millionaire/` |
| From the hub | pick the Millionaire tile in the lobby; phones follow automatically |
| From disk (`file://`) | works — `questions.json` can't be fetched, so the built-in copy in `js/data.js` is used, and phones are unavailable |
| Locally with phones | `python -m http.server 8620` at the repo root, then `http://<your-ip>:8620/games/millionaire/` |

Add `?store=NAME` to the URL to give a tab its own saved game — the harness uses
`?store=harness` so a test run can never overwrite a real host's save on the
same origin.

Tests:

```bash
cd games/millionaire && node --test          # the pure core, M-U1 … M-U10
python -m http.server 8620                   # then open
# http://localhost:8620/games/millionaire/tests/harness.html    (M-I1 … M-I7, X-1 … X-5)
```

## 2. Playing it

1. **Setup.** Add contestants by hand, or let phones join and become the list.
   Turn Fastest Finger and each lifeline on or off, then **Start the game**.
2. **Choosing the hot seat.** With phones, **Fastest Finger First**: open the
   question, phones tap four items into order and submit, the arrival list
   fills in, **Reveal the order** shows the answer and the fastest *correct*
   submission wins. Without phones (or at any time) the host picks a name from
   **Pick the hot seat by hand**.
3. **The hot seat.** Click A–D (or press `A`–`D` / `1`–`4`), then **Final
   answer** (`Enter`), then **Reveal** (`Space`). Right: the rung lights green
   and the money climbs. Wrong: the correct answer turns green and the
   contestant leaves with their last safe haven. **Walk away** any time before
   the lock. `U` undoes.
4. **Lifelines** (each once per contestant): **50:50** removes two wrong
   options; **Phone a Friend** opens a named 30-second cue timer; **Ask the
   Audience** opens a 20-second vote — phones vote A–D against the same
   countdown the host sees and the bar chart fills live, or the host types four
   percentages; **Switch the Question** (off by default) swaps in an unused
   question of the same level, and says so on screen when the rung holds nothing
   else — the lifeline is not spent.
5. **Result.** "You leave with $X", then **Next contestant** or **Finish the
   night** for the standings. **End the night** from the hot seat also works and
   banks whoever is playing at their walk-away amount first. The hub's night
   scoreboard is told each total.
6. **⟲ Game lobby** (in the toolbar, any time) asks two questions:
   **Keep this game** parks it and goes back to setup, where a **Resume the
   game** button puts it back exactly as it was — same rung, same lifelines,
   and a running Ask the Audience window keeps its deadline. **Start over**
   throws the game away but keeps the contestants, the questions and the
   settings. Neither touches the undo history, and a parked game survives a
   reload.

Every lifeline and every walk-away a phone asks for is only a *request*: a
banner appears on the host screen and nothing happens until the host confirms.

## 3. The money tree

Default US-style 15 rungs: 100, 200, 300, 500, **1,000**, 2,000, 4,000, 8,000,
16,000, **32,000**, 64,000, 125,000, 250,000, 500,000, 1,000,000, with safe
havens at rungs **5** and **10** (bold).

A **rung** is a question *answered correctly*, so a contestant who has got
four right is on rung 4 and is looking at question 5.

- **Walking away** pays the amount for the current rung — the value of the last
  question answered correctly, and nothing on question 1.
- **A wrong answer** drops to the last safe haven **reached**, and a haven is
  only reached once its own question has been answered correctly. So:

| Right answers so far | A wrong answer on question… | Pays |
|---:|---:|---:|
| 0–3 | 1–4 | 0 |
| 4 | 5 | **0** — rung 5 is not banked yet |
| 5–9 | 6–10 | 1,000 |
| 10–14 | 11–15 | 32,000 |

  This is the TV rule: sitting down to question 5 does not protect you; getting
  question 5 right does.

## 4. The question file (`questions.json`)

```json
{
  "title": "Millionaire — Game Night",
  "settings": {
    "currency": "$",
    "moneyTree": [100, 200, 300, 500, 1000, "…", 1000000],
    "safeHavens": [5, 10],
    "lifelines": { "fifty": true, "phone": true, "audience": true, "switch": false },
    "phoneSeconds": 30, "audienceSeconds": 20, "fastestFinger": true
  },
  "questions": [
    { "level": 1, "category": "Nature", "q": "How many legs does a spider have?",
      "options": ["Six", "Eight", "Ten", "Four"], "answer": 1 }
  ],
  "fastestFinger": [
    { "q": "Put these planets in order of distance from the Sun, nearest first.",
      "options": ["Earth", "Mercury", "Mars", "Venus"], "order": [1, 3, 0, 2] }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | text, ≤ 80 characters |
| `settings.currency` | no | ≤ 3 characters (default `$`) |
| `settings.moneyTree` | no | 5–20 strictly increasing whole numbers above zero |
| `settings.safeHavens` | no | rung numbers (1-based) inside the tree, rising, no repeats. Default `[5, 10]` for a 15-rung tree, otherwise none |
| `settings.lifelines.*` | no | `fifty` / `phone` / `audience` / `switch`, booleans. Default: all but `switch` |
| `settings.phoneSeconds`, `settings.audienceSeconds` | no | whole seconds 0–120 (0 = no timer) |
| `settings.fastestFinger` | no | boolean; ignored when the file has no `fastestFinger` questions |
| `questions` | **yes** | at least 15. Each: `q` ≤ 200 chars, exactly 4 distinct `options` ≤ 60 chars, `answer` 0–3, optional `level` 1…tree length, optional `category` ≤ 30 chars |
| `fastestFinger` | when switched on explicitly | each: `q`, exactly 4 distinct `options`, `order` = a permutation of 0, 1, 2, 3 |

Questions with no `level` are spread evenly over the tree in file order — a
plain list of 45 becomes 3 per rung. Each rung draws a question nobody has seen
yet; once a rung is exhausted the pool wraps and the host is told on screen.

The shipped file has **45 questions** (3 per rung, rising in difficulty) and
**6 Fastest Finger** questions. `js/data.js` is a byte-for-byte mirror used
when `questions.json` cannot be fetched; the unit tests fail if they drift
apart, so regenerate both together.

## 5. The question-set library

`sets/` holds extra content files with a manifest beside them:

```
sets/index.json        [{ "file": "kids-night.json", "name": "Kids' night", … }]
sets/movies-tv.json    45 film and television questions, 3 per rung
sets/kids-night.json   45 gentler questions, 3 per rung
```

The setup screen's **Saved sets** picker lists them, previews the one you have
highlighted, and **Load set** makes it the current content — through the same
`validateGame` as every other route, with the source note becoming
`set: Kids' night`. Opened straight from disk the picker hides itself and says
why; `questions.json` stays the default either way.

**Adding your own set.** Static hosting cannot write files, so the editor gives
you the two things to commit: **Download for the library** saves the JSON under
a name derived from the title and prints the path to put it at
(`games/millionaire/sets/<name>.json`) plus the exact line to paste into
`sets/index.json`, each with a Copy button. Commit both and the set appears in
the picker for everyone.

## 6. Phones

| Phone screen | What it shows |
|---|---|
| `wait` | who is in the hot seat and what they have banked |
| `fff` | the four items as tap-to-order chips, then **Submit my order** |
| `hotseat` | the question, A–D, the lifelines still available, **Ask to walk away** |
| `locked` | "Locked in — look at the host screen" |
| `vote` | Ask the Audience: the question, A–D, and the same countdown the host sees (a cue) |
| `result` | what this player leaves with, and the standings |

The host is authoritative. A phone message is validated
(`WwmCore.validatePhoneMsg`) before it reaches the reducer, a phone only ever
receives its own view, and no view ever contains the correct answer — not the
ballot, not the hot seat, not the Fastest Finger order.

## 7. Files

```
index.html                 host screens + phone screens in one page
css/wwm.css                host stage, money tree, lozenges, overlays
css/wwm-phone.css          phone controller
js/wwm-content.js          PURE: the JSON contract, level assignment, question draw, percentages
js/wwm-select.js           PURE: every selector that reads a state, incl. the phone views
js/wwm-core.js             PURE: the reducer and the state machine (UMD -> WwmCore, re-exports the other two)
js/data.js                 offline mirror of questions.json (globalThis.WWM_DEFAULT_GAME)
js/wwm-view.js             host rendering
js/wwm-app.js              host state, persistence, buttons, hotkeys, sound cues
js/wwm-editor.js           the in-page question editor
js/wwm-room.js             host side of the GSC SDK (roster, inbound intents, outbound views)
js/wwm-phone.js            the phone controller
js/wwm-sound.js            WebAudio cues (no audio files)
js/timer-core.js           PURE block-countdown math (vendored from Jeopardy)
js/wwm-timer.js            the lifeline countdown DOM glue
questions.json             the shipped question set
tests/wwm-core.test.mjs    node:test suite (M-U1 … M-U10)
tests/harness.html         loopback harness (M-I1 … M-I7, X-1 … X-5)
tests/x-scenarios.js       the X-1/X-2/X-3 scenarios, loaded by the harness
sets/index.json            the question-set library manifest
sets/*.json                the sets themselves
```

Game state is one serialisable object saved under `gsc-wwm-state-v1`; the
editor draft lives under `gsc-wwm-draft-v1`. Both take a `-NAME` suffix when
the page is opened with `?store=NAME`. The saved game is scoped to the
room it was played in, so a new room never inherits the old room's seats.

## 8. Accessibility and known limits

- Every control is a real `<button>`; option states carry a visually hidden
  word ("selected", "locked in", "correct answer", "removed by 50:50") so
  colour is never the only signal. Focus rings are visible throughout.
- Phone screens work at 320 px wide with ≥ 56 px targets; host screens fit
  1280×720 with no vertical scroll during play.
- Decorative motion is behind `prefers-reduced-motion`, including the 1.2 s
  `.gsc-splash` title card, which is skipped entirely under `reduce` and is
  `pointer-events: none` so it never eats a click.
- Sounds are synthesised with WebAudio behind the 🔊 toggle (`gsc-sound`) and
  never play before a click.

Known limits:

- The Phone a Friend and Ask the Audience clocks are **cues**: reaching zero
  flashes the strip and changes nothing, on the host screen and on the phone
  ballot alike. The host closes the window.
- Ask the Audience counts the **first** tap from each phone; a phone cannot
  change its vote (one phone, one vote).
- **End the night** from the hot seat banks the contestant who is still
  playing at their walk-away amount (the button says which) and then shows the
  standings. Contestants who never reached the hot seat are listed as "still to
  play" with no total.
- Fastest Finger ties are decided by arrival order at the host, so a slow
  network is a real disadvantage — exactly as the format intends.
- **Undo goes back 60 steps.** That is deep enough for any single question but
  not for a whole 15-question run (which is exactly 60 steps: select, lock,
  reveal and next, fifteen times), and it keeps the saved game small enough for
  `localStorage`. To start a contestant again, finish or walk them and use
  **Next contestant**.
- **A parked game is not a save slot.** There is one shelf: **Keep this game**
  replaces whatever was on it, and **Start the game** or loading new questions
  clears it. Opening a new room clears it too if it held phone contestants.
- **Clearing `localStorage` by hand only works with the tab closed.** The game
  saves itself on `beforeunload`, so wiping the key from the console and
  reloading the same tab writes it straight back. Close the tab first, or use
  the supported resets: **Play again**, **Finish the night**, or the editor's
  **Reset to shipped**.
