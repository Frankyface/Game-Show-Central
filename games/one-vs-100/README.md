# 1 vs 100

One contestant against **the Mob**: every other phone in the room. Three
options a question. Every Mob member who gets it wrong (or doesn't answer) is
out, and the contestant banks money for each one. Spec: `docs/16-one-vs-100-spec.md`.

## Hosting

- **In the hub:** pick *1 vs 100* in the lobby. Every connected phone joins
  the line-up; pick the contestant on the setup screen. Everybody else is the Mob.
- **Standalone:** open `games/one-vs-100/index.html`. Press **Open room
  (phones)** for a room code; players open the page with `?room=CODE`.
- **No phones (or fewer than 3):** choose **Simulated Mob**, set its size
  (1–100). On each question the host types how many got it wrong.

### A question, step by step

1. **Open the Mob window** (default 20 s). Mob phones get the question and A/B/C.
   The host sees *Answered n/m*, and each tile that has answered gets a gold border and a dot.
2. **Close the Mob** once everyone is in. It also closes by itself at zero.
3. The contestant answers: on their phone, or the host picks an option and
   presses **Lock it in**. **Helps** are available here, once each:
   - **Poll the Mob**: shows the Mob's A/B/C split on the host screen and the
     contestant's phone.
   - **Ask the Mob**: names one member who picked the right answer and one
     who didn't (the host can ask them out loud).
   - **Trust the Mob**: locks the majority answer. A tie goes to the earlier
     option, and the host is told it was a tie.
4. **Reveal.** Wrong Mob members' tiles go dark and the bank grows by
   *eliminated × per-member value*.
5. **Walk away** with the bank, or **Play on**.

The game ends three ways: the contestant is **wrong** (they leave with
nothing; the surviving Mob splits the bank, rounded down to whole money), the
contestant **walks**, or the **whole Mob is out** (bank × bonus, default ×2).
**Undo** steps back one action at a time. **End the night** banks a walk.

Hotkeys (host, when not typing): `A/B/C` or `1/2/3` pick, `Enter` locks,
`Space` opens, closes or reveals, `U` undoes.

### Toolbar

**Sound** · **Editor** · **Game lobby** (`btn-game-lobby`), each an icon plus a label:
*Keep this game* parks the game behind a **Resume** button on setup; *Start
over* clears it. The players, questions and settings stay either way.

## Content JSON (`questions.json`)

| Field | Type | Rule |
|---|---|---|
| `title` | string | optional, ≤ 80 chars |
| `settings.currency` | string | ≤ 3 chars, default `$` |
| `settings.ladder` | number[] | 1–20 whole numbers, never decreasing; money **per eliminated member** by question number; the last value repeats. Default `100,200,300,500,1000,2000,3000,5000,7500,10000` |
| `settings.answerSeconds` | int | 0–120 (0 = no clock), default 20 |
| `settings.helps` | `{poll,ask,trust}` booleans | default all on |
| `settings.bonusMultiplier` | number | 1–10, default 2 (doubles the bank) |
| `settings.mobSize` | int | 1–100, default simulated Mob size |
| `questions[]` | ≥ 30 | `{q, options:[3 strings], answer:0..2, level?:1..10, category?}` |

Questions without a `level` are spread evenly over levels 1–10 in file order.
Question *n* is drawn from level *n* (capped at 10), and a used question is not
repeated until its level runs out. The shipped file has 60 original questions,
6 per level. `js/data.js` is a byte-for-byte mirror for `file://` use.

Loading: `?game=URL` (wins over a saved game unless the save came from that
URL), **Load questions (.json)**, the library picker, or the editor's **Use in game**.
Every path goes through `validateGame`, which gives a plain-English reason
when it rejects a file.

## Question-set library (`sets/`)

`sets/index.json` lists the committed sets (`kids-night.json`, `movies-and-tv.json`).
The setup screen's picker (`shared/library.js`) loads one through
`validateGame`. The source note then reads `set: <name>`.
To add a set: in the editor press **Download for the library**. It downloads
`<slug>.json` and shows the exact manifest line plus the path to commit
(`games/one-vs-100/sets/<slug>.json`). Static hosting can't write files, so
you commit both files yourself.

## Phones

| Screen | Who | What |
|---|---|---|
| `wait` | anyone | bank, Mob left, a hint |
| `mob-answer` | alive Mob member, window open | question, A/B/C (one tap, locked), countdown |
| `mob-eliminated` | Mob member who is out | "You're out — watch the host screen" |
| `contestant` | contestant, after the Mob locks | question, A/B/C to lock, poll split if bought |
| `result` | everyone | what they personally take home |

Phone → host: `{t:"mob",idx}`, `{t:"lock",idx}`. Nothing else is accepted.
Host → phone views carry the answer window as `msLeft` (time left when the
view was sent), so a phone with a wrong clock still counts down correctly.
The host is authoritative: a phone can't open, close, reveal, use a help or
advance. A Mob phone's view never contains the correct answer or any other
member's pick. Phones joining mid-game watch, and are added to the setup list as soon as
no game is in progress (Play again, Start over, or the phone reloading).

## Layout

```
index.html              host + phone page (branches on GSC.mode)
questions.json          default 60 questions;  js/data.js  offline mirror
sets/                   library: index.json + kids-night.json + movies-and-tv.json
js/ovh-content.js       PURE validator, normaliser, draw, ladder maths
js/ovh-phoneview.js     PURE validatePhoneMsg + phoneView (masked per phone)
js/ovh-core.js          PURE reducer + selectors (UMD → OvhCore)
js/ovh-view.js          host rendering + DOM helpers
js/ovh-app.js           host glue: state, persistence, clock, setup, hotkeys, lobby, library
js/ovh-editor.js        editor (Download JSON / for the library / Use / Reset / Blank)
js/ovh-room.js          GSC.host glue (seats waiting phones between games);  js/ovh-phone.js  GSC.player glue
js/ovh-sound.js         WebAudio cues behind the shared gsc-sound toggle
css/ovh.css, css/ovh-phone.css
tests/ovh-core.test.mjs node:test, O-U1…O-U10 (43 tests)
tests/ovh-adversarial.test.mjs  the independent tester's suite (43 tests)
tests/harness.html      loopback: harness = shell, 5 Mob phones + 1 contestant (O-I1…O-I6, 68 checks)
```

Storage: `gsc-ovh-state-v1` and `gsc-ovh-draft-v1`, with a `-NAME` suffix
under `?store=NAME` (the harness uses `?store=harness`). A running answer
window is saved **paused** with the time it had left. After a reload the host
presses **Resume the Mob window**.

## Testing

```bash
cd games/one-vs-100 && node --test          # 86 unit tests
python -m http.server 8712 --bind 127.0.0.1  # then open games/one-vs-100/tests/harness.html (68 checks)
```

## Known issues

- A full room (about 12 players) makes the setup columns taller than the hub's
  1280×628 frame, so setup scrolls. **Start** and **Resume** sit in the setup
  header and stay on screen. Up to 6 players fit at 628 px. Play, result and
  standings never scroll at 1280×720, 1280×676 or 1280×628.
- Undoing an automatic close (the window ran out) gives back a window with
  0 seconds left, which closes again at once. The answers already in are kept.
