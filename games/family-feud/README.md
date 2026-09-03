# Family Feud

A projector-first Family Feud for Game Show Central. Two teams, survey boards,
strikes, steals, multipliers and Fast Money. **Phones are optional** — a host
alone with a screen share can run the whole game, Fast Money included.

Static, no build step, no npm, no framework. Open `index.html` and play.

---

## How to host

### From the hub

Pick **Family Feud** in the lobby. The hub owns the room and the phones; the
game runs in an iframe and gets the roster automatically. Nothing to set up.

### On its own

```bash
# from the repo root
python -m http.server 8620
# then open http://localhost:8620/games/family-feud/
```

It also works straight off disk (`file://`) — the built-in survey in
`js/data.js` takes over when `questions.json` can't be fetched.

To let phones join a standalone game, press **Open room (phones)** on the setup
screen and read out the four-letter code. Players open the same page with
`?room=CODE` (the setup screen prints the exact link once the room is open).

### Running a game

1. **Setup** — name the teams, drag nothing: every player (phone or typed in by
   hand) gets an **A / B / –** toggle. The host's choice always wins over the
   phone's own pick. Choose how many rounds to play and whether to finish with
   Fast Money.
2. **Face-off** — read the question, then **Arm buzzers** (or press
   <kbd>Space</kbd>). The first podium phone to tap wins; with no phones, press
   **{Team} buzzed** yourself. Click the tile they said, or **Not on the board**.
   The better-ranked answer takes control. Nothing on the board? **Face-off
   again**, or hand it over with **Give control to …**.
3. **Play or pass** — the winning team decides.
4. **Team play** — click a tile per correct answer, **Strike ✕** per miss.
   Clearing the board wins the round outright.
5. **Steal** — after the last strike the other team gets one guess: click their
   tile to steal the bank, or **No steal — they missed**.
6. **Round over** — **Let's see the rest**, then **Next round**, **Fast Money**
   or **Finish the game**.
7. **Fast Money** — five questions, two players. Type (or let the phone type)
   each answer, run the red-block clock as a cue, then reveal each row by
   picking the matching board answer. Player 2 gets a *cover your ears*
   interstitial and their duplicate answers flash **TRY AGAIN** and score zero.
8. **Final standings** — **Play again** (same teams, scores reset) or **Back to
   setup**.

**Undo** in the top bar rewinds the last game action (30 steps deep) and never
touches the roster. Click a team's score to type a correction. 🔊 toggles the
synthesised sounds and the choice sticks. The game auto-saves after every
action — a refresh drops you back exactly where you were.

---

## Questions JSON

Default content: `questions.json` (mirrored in `js/data.js` for offline use).
Load your own with **Load custom questions (.json)**, with `?game=URL`, or build
one in the built-in editor and press **Download JSON** / **Use in game**.

```json
{
  "title": "Family Feud — Game Night",
  "settings": {
    "strikes": 3,
    "multipliers": [1, 1, 2, 3],
    "fastMoney": { "enabled": true, "target": 200, "timer1": 20, "timer2": 25 }
  },
  "rounds": [
    {
      "question": "Name something people do while waiting in a long line.",
      "answers": [
        { "text": "Check their phone", "count": 48 },
        { "text": "Chat with someone", "count": 17 },
        { "text": "Sigh loudly", "count": 12 }
      ]
    }
  ],
  "fastMoney": [
    { "question": "Name a fruit that is red.",
      "answers": [{ "text": "Apple", "count": 52 }, { "text": "Cherry", "count": 13 },
                  { "text": "Strawberry", "count": 24 }] }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | string; shown in the top bar and on the setup card |
| `settings` | no | object; every key below has a default |
| `settings.strikes` | no | whole number 1–5 (default 3) |
| `settings.multipliers` | no | non-empty array of positive numbers; index = round, the **last value repeats** for extra rounds (default `[1, 1, 2, 3]`) |
| `settings.fastMoney.enabled` | no | boolean; defaults to **true when the file has Fast Money questions**, false otherwise |
| `settings.fastMoney.target` | no | whole number 0–100000 (default 200) |
| `settings.fastMoney.timer1` / `timer2` | no | whole seconds 0–120 (default 20 / 25); a cue only — the clock never scores or advances anything |
| `rounds` | **yes** | 1–12 rounds |
| `rounds[].question` | **yes** | non-empty, ≤ 200 characters |
| `rounds[].answers` | **yes** | 3–8 answers; **sorted by count descending on load** (the validator sorts, it does not fail) |
| `answers[].text` | **yes** | non-empty, ≤ 40 characters, unique within the question (case-insensitive) |
| `answers[].count` | **yes** | whole number 1–100 |
| `fastMoney` | when enabled | ≥ 5 questions, same answer rules; the game plays the first 5 (reorder them in the editor) |

Counts that add up to more than 100 are a **warning**, not a load failure: the
editor turns the sum badge amber and prints the reason, and the game still runs.

Regenerate `js/data.js` after editing `questions.json`:

```bash
cd games/family-feud
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('questions.json','utf8'));
const b=JSON.stringify(d,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n');
const h=fs.readFileSync('js/data.js','utf8').split('const DEFAULT_FEUD_GAME = ')[0];
fs.writeFileSync('js/data.js',h+'const DEFAULT_FEUD_GAME = '+b+';\n')"
```

---

## Phones

Phones are thin: they render exactly the view the host sends and post back
intents. The host judges everything.

| Phone screen | When | What the player can do |
|---|---|---|
| `team-pick` | setup | tap **Team A** / **Team B** (the host can move them) |
| `faceoff` | face-off, if they're at the podium | a giant buzzer — red **Wait…** until the host arms it, then green **BUZZ**. An early tap is ignored (no lockout in Feud), and only the first buzz counts |
| `fm-answer` | their Fast Money turn | the five questions one at a time with a text field, **Back** / **Submit**, and the same red-block clock the host sees |
| `fm-wait` | while the other Fast Money player answers | **Cover your ears!** |
| `wait` | anything else | team badge, phase and the host's message |
| `result` | round over / final | the same, plus both team scores |

Podium players default to a rotation through each team's line-up (round 1 takes
the first name, round 2 the second, and so on), so everyone gets a turn.

Phone → host payloads (all validated by `FeudCore.validatePhoneMsg` before they
touch state — control characters stripped, text capped at 60 chars, junk
dropped): `{t:"team",team:"A"|"B"}`, `{t:"buzz"}`,
`{t:"fm-answer",slot:1|2,q:0-4,text}`.
Host → phone: `{t:"view", …}` — the whole `phoneView`, pushed on every change.
A phone is never sent the board answers, and never the other Fast Money
player's typed answers.

Players with no phone are typed into the roster by hand; they show up in the
team line-ups and nothing else changes.

**Rooms and identity.** Phone ids (`p1`, `p2`, …) are handed out per room and
start again at `p1` in the next one, so the saved game records the room code it
belongs to. Resume it in the same room (a refresh, a trip back to the lobby) and
everyone keeps their seat. Open a **different** room and every phone seat —
team line-ups, the podium and the Fast Money seats — is vacated first, so a new
arrival can never inherit the previous player's seat or be shown their typed
Fast Money answers. Hand-typed players keep their seats either way.

---

## Layout

```
games/family-feud/
  index.html              host screens + phone screens in one page
  questions.json          the default surveys (6 rounds + 8 Fast Money)
  README.md               this file
  css/
    feud.css              host stage: palette, board, tiles, strikes, Fast Money
    feud-phone.css        phone controller + the question editor
    timer.css             the red-block clock (vendored from Jeopardy)
  js/
    feud-content.js       PURE (UMD FeudContent): validateGame / normalizeGame / warningsFor
    feud-core.js          PURE (UMD FeudCore): createState / reduce / selectors / validatePhoneMsg
    feud-app.js           host glue: state, localStorage, setup + board + standings
    feud-fm.js            the Fast Money screen
    feud-editor.js        the question editor
    feud-room.js          GSC.host glue: roster, inbound validation, outbound views
    feud-phone.js         GSC.player glue: the phone controller
    feud-boot.js          picks host or phone mode and starts the right stack
    feud-sound.js         WebAudio cues (ding, strike, buzz-in, try-again, fanfare)
    feud-timer.js         red-block countdown DOM glue
    timer-core.js         PURE countdown math (vendored from Jeopardy)
    data.js               offline mirror of questions.json
  tests/
    feud-core.test.mjs    node:test unit suite (F-U1–F-U10)
    harness.html          loopback browser harness (F-I1–F-I6)
```

`FeudCore` re-exports everything in `FeudContent`, so game code and tests only
ever need `FeudCore`. Storage keys: `gsc-family-feud-state-v1` (the game),
`gsc-family-feud-draft-v1` (the editor draft), `gsc-sound` (shared 🔊 setting).

---

## Tests

```bash
cd games/family-feud && node --test        # F-U1–F-U10, zero deps
python -m http.server 8620                 # from the repo root, then open
# http://localhost:8620/games/family-feud/tests/harness.html   → F-I1–F-I6
```

The harness is its own shell: it loads the real page in one host iframe and four
phone iframes and speaks the bridge protocol from `docs/00-architecture.md` §6
directly — no PeerJS, no hub. `#summary.ok` means everything passed.

## Known issues

- Real-network play across two separate physical devices has not been
  exercised; the room has been opened and joined for real over the PeerJS
  broker, but from two browsing contexts on one machine.
- Opening a **new** room while a saved game is being resumed clears the phone
  players out of the team line-ups and the Fast Money seats (see below).
  Everyone re-picks their team; players the host typed in by hand are kept.
