# Press Your Luck

Big money, no Whammies. Two to four players buzz in on questions to earn
spins, then stop a travelling light on an 18-square Big Board. Cash and
prizes pile up; a Whammy takes the lot. Four Whammies and you are out.

Part of **Game Show Central**. Plays inside the hub (phones optional) or on
its own from any static host — or straight off the disk.

---

## Running it

| How | What to do |
| --- | --- |
| In the hub | Open the hub, make a room, pick **Press Your Luck** from the lobby. |
| Standalone, host only | Open `games/press-your-luck/index.html`. Everything works with no phones at all. |
| Standalone, with phones | Open the page, press **Open room (phones)**, share the join link it prints. |
| From disk | Double-click `index.html`. `board.json` cannot be fetched from `file://`, so the identical copy in `js/data.js` is used instead. The set library needs a web server and says so. |
| Your own content | `index.html?game=https://example.com/my-board.json`, the **Load a board file (.json)** button, a set from the library, or the built-in editor. |

Serve it for a real game night:

```bash
python -m http.server 8620          # from the repo root
# then http://localhost:8620/games/press-your-luck/
```

---

## The rules this build plays (normative)

1. **Question round.** Four questions a round (configurable). The host reads
   the question and presses **Arm the buzzers**; the first player in answers
   out loud. A correct buzz-in banks **3 spins**. Then the three options go
   up and **every other player** picks one — the player who buzzed does not
   get a pick, right or wrong. Each correct pick banks **1 spin**. If nobody
   buzzes, the host presses **Nobody had it** and all players pick.
2. **The Big Board.** Eighteen squares around a 7 × 4 rectangle. A light
   travels; the player in control presses **STOP** (phone, the host's button,
   or the space bar).
   - **Cash** or a **prize** adds its value to their total.
   - **"+ one spin"** hands a spin straight back.
   - A **Whammy** drops their total to zero, counts one Whammy, and **ends
     their turn** — the spins they still have stay with them for later.
     *House rule:* "a Whammy ends the turn but keeps the spins" is this
     build's rule, not a documented rule of the TV show. Spins left over from
     a Whammy on *passed* spins also stay passed (on the show they are said
     to become the player's own); here they still cannot be passed on.
   - Four Whammies and a player is **out**: their total stays at zero and
     any spins they were holding are void.
3. **Whose turn.** The player with the **fewest spins** goes first; ties break
   on the **lower total**, then on seat order. A player keeps spinning until
   they run out, pass, or hit a Whammy. Anyone holding **passed** spins is
   brought up ahead of everyone else.
4. **Passing.** A player with at least one of their **own** spins and no
   passed spins pending may hand *all* their remaining own spins to one
   opponent. The receiver has to use them, spends them **before** their own,
   and **cannot pass them back**. A Whammy on a passed spin counts against
   the player who spun it.
5. **Round two** plays `boards[1]` — bigger money, usually more Whammies.
   Totals, Whammy counts and eliminations all carry over. The highest total
   at the end wins; a level game is a shared win, and if everybody has been
   Whammied to zero there is no winner.

Everything in bold is configurable per file (see the settings table).

### Deviations from the spec worth knowing

- The spec's event list has no "arm", so this build **adds an `arm` event**
  and an **Arm the buzzers** control, the way Jeopardy and Family Feud open
  their buzzers. Without it a phone could buzz while the host was still
  reading. Arming is not an undo step.
- After a Whammy, a pass, or a player's last spin the board **waits** for the
  host's **Next player** — the reducer sets `awaiting: "advance"` and `stop`
  becomes illegal. That is what keeps the WHAMMY! card on screen.
- Squares that carry `alternatives` are re-rolled **after each spin**, for the
  next one, and only when `settings.rotate` is true. The host screen paints
  the pre-spin board until the light lands, so a rotation is never visible
  mid-flight.

---

## Host controls

| Control | Key | What it does |
| --- | --- | --- |
| Arm the buzzers | `A` | Opens (or closes) the buzzers for this question. |
| A name in the buzz bar | `1`–`4` | Buzzes that player in, for anyone playing without a phone. |
| Correct / Wrong | `Y` / `N` | Judges the buzz-in. `N` with nobody on the buzzer means "nobody had it". |
| A / B / C in the picks row | — | Locks in a pick for a player with no phone. |
| Reveal the picks | `R` | Shows the answer and pays a spin for each correct pick. |
| Next question / To the Big Board | `Enter` | Moves the round on. |
| STOP | `Space` | Stops the light. |
| Next player | `N` | Brings the next spinner up once a turn has ended. |
| Pass … to | — | Passes the controller's own spins. |
| Undo | `U` | Steps back through the whole game, exactly. |
| Game lobby | — | **Keep this game** (setup with a **Resume** button) or **Start over**. |
| Sound | — | WebAudio cues, shared with the rest of the hub (`gsc-sound`). |

Hotkeys are ignored while you are typing in a field or while the editor or a
dialog is open.

## Phone screens

Phones are **optional** — a host alone with a screen share can run the whole
game. When they are used, a phone sends exactly four things and judges
nothing:

| Screen | What the player sees | What it sends |
| --- | --- | --- |
| `wait` | The question or the standings, plus their own money and Whammy count | — |
| `buzz` | The question and a giant **BUZZ** (dead until the host arms it) | `{t:"buzz"}` |
| `pick` | The three options, A/B/C, full width | `{t:"pick",idx}` |
| `board` | Whose board it is; for the player in control a giant **STOP** and the pass buttons | `{t:"stop"}`, `{t:"pass",to}` |
| `result` | The final standings | — |

A phone is **never** sent the board, a square, a face index, the landing
square, or a question's correct answer. The landing square does not exist
anywhere in the state until STOP is pressed, so there is nothing to leak;
while the light is travelling the phones are served the view from *before*
the press.

---

## Content JSON

`board.json` is the file the site serves. Its shape:

| Field | Type | Rules |
| --- | --- | --- |
| `title` | string | Optional, ≤ 80 chars. |
| `settings` | object | See below; every field optional. |
| `boards` | array of arrays | At least `settings.rounds` boards, each **exactly 18** squares with **3–6 Whammies**. Round *n* plays `boards[n]`. |
| `questions` | array | **At least 24**, and at least `rounds × questionsPerRound`. |

### `settings`

| Field | Default | Range |
| --- | --- | --- |
| `currency` | `"$"` | 1–3 characters |
| `questionsPerRound` | `4` | 1–12 |
| `buzzSpins` | `3` | 0–10 |
| `pickSpins` | `1` | 0–10 |
| `whammyLimit` | `4` | 1–10 |
| `rounds` | `2` | 1–6, and never more than the number of boards |
| `rotate` | `false` | rotate squares that carry `alternatives` |

`buzzSpins` and `pickSpins` cannot both be zero — nobody would ever reach the
board.

### A square

```json
{ "cash": 500 }
{ "cash": 750, "spin": true }
{ "prize": "Weekend getaway", "value": 1200 }
{ "whammy": true }
{ "cash": 3000, "alternatives": [ { "cash": 1400 }, { "prize": "Home cinema night", "value": 2600 } ] }
```

- `cash` / `value`: whole numbers, 1 – 1,000,000.
- `spin: true` gives the spin back as well as the money.
- A Whammy carries nothing else.
- `alternatives`: up to three other faces for that square, used only when
  `settings.rotate` is true. Alternatives cannot nest.

### A question

```json
{ "q": "Which planet is closest to the Sun?", "options": ["Venus", "Mercury", "Mars"], "answer": 1 }
```

Exactly three options, all different, `answer` is `0`–`2`.

Everything is validated by `PylCore.validateGame`, which is the same gate used
by `?game=URL`, the file upload, the library picker and the editor. Failures
come back as one plain-English sentence.

---

## The set library

`sets/index.json` lists the extra content files that ship with the game:

```json
[{ "file": "kids-night.json", "name": "Kids' night", "description": "…", "by": "…" }]
```

Two sets ship: **Kids' night** and **Movies & TV**. The setup screen mounts
the shared picker (`shared/library.js`) under *Questions and boards*; loading
a set runs it through `validateGame` and the source note becomes
`set: Kids' night`. Opened from a `file://` disk copy the manifest cannot be
fetched, and the picker says so and hides.

**Adding your own set.** Static hosting cannot write files, so the workflow is
honest about it:

1. Build the set in the editor.
2. Press **Download for the library**. The file downloads *and* the editor
   prints the exact manifest line plus the path to commit to.
3. Drop the file in `games/press-your-luck/sets/`, paste the line into
   `sets/index.json`, commit.

---

## The editor

**Editor** in the toolbar. The board tab lays the eighteen squares out
in the same rectangle the host screen paints; each one is a type (Cash / Cash
+ one spin / Prize / Whammy), an amount and — for a prize — a name, with the
problem with *that* square printed underneath as you type. The middle of the
board counts the squares, the Whammies and the "+ one spin" squares live. The
questions tab is one row per question with a radio for the answer.

- **Use in game** — validate and play it now.
- **Download JSON** — save it as `board.json`.
- **Download for the library** — save it under a slug of its title and print
  the manifest line (see above).
- **Reset to shipped** / **Start blank**.

The draft auto-saves under `gsc-pyl-draft-v1` and survives a refresh.

---

## Files

```
index.html              host screens + phone screens, one page
board.json              the shipped board and 40 questions
sets/index.json         the library manifest
sets/*.json             the shipped sets
js/pyl-content.js       PURE: the JSON contract, validation, square helpers
js/pyl-select.js        PURE: selectors, phoneView, validatePhoneMsg
js/pyl-core.js          PURE: the immutable reducer (UMD → PylCore)
js/data.js              an exact mirror of board.json for file:// use
js/pyl-sound.js         WebAudio cues
js/pyl-board.js         the travelling light (animation only)
js/pyl-view.js          host rendering + the shared DOM helpers
js/pyl-app.js           host state, persistence, hotkeys, the spin choreography
js/pyl-editor.js        the board and question editor
js/pyl-room.js          host glue on GSC.host
js/pyl-phone.js         phone glue on GSC.player
js/pyl-boot-check.js    says so in plain English if a script failed to load
css/pyl.css             host screens
css/pyl-phone.css       phone screens
tests/pyl-core.test.mjs node:test suite (L-U1 … L-U10)
tests/harness.html      loopback harness (L-I1 … L-I6)
```

The core is split in three so every file stays well under the 800-line house
limit; `PylCore` re-exports everything, so callers only ever touch `PylCore`.

## Testing

```bash
cd games/press-your-luck && node --test          # 39 unit tests, L-U1 … L-U10
python -m http.server 8620                       # from the repo root, then:
# http://localhost:8620/games/press-your-luck/tests/harness.html
```

The harness *is* the shell: it loads the real page as an embedded host plus
three embedded phones at 320 px and speaks the bridge protocol itself. It
namespaces its storage with `?store=harness`, so a test run never touches a
real host's saved game.

## Storage

| Key | What |
| --- | --- |
| `gsc-pyl-state-v1` | the game, the content and the setup screen |
| `gsc-pyl-draft-v1` | the editor draft |
| `gsc-sound` | the shared 🔊 preference |

`?store=NAME` moves both game keys into their own namespace.

## Accessibility

- Every control is a `<button>`; dialogs use `role="dialog"`; the notice line,
  the spin count and the Whammy cards are live regions.
- Colour is never the only signal: the lit square also grows a ring, the
  Whammy count is drawn as filled/hollow dots with an `aria-label`, an
  eliminated player is labelled "out — four Whammies", and every board tile
  carries a plain-English `aria-label`.
- Every animation lives inside `@media (prefers-reduced-motion: no-preference)`.
  Under `reduce` the travelling light **jumps straight to the square the core
  chose** — the result is identical, only the journey is gone.
- Phone targets are ≥ 56 px at 320 px; BUZZ and STOP are far bigger.

## Known limits

- The board is fixed at 18 squares — that is the shape the show uses and the
  validator enforces it.
- Prizes are text and a value; there are no prize pictures (spec 17 non-goal).
- No Double Whammy and no Big Bucks jackpot (spec 17 non-goals).
- A backgrounded tab throttles `requestAnimationFrame`, so a spin started and
  then hidden finishes on a wall-clock guard rather than mid-flight — the
  landing square is unaffected.
