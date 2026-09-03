# 03 — Family Feud

Status: **approved for implementation** · Component id: `family-feud`
Owns: `games/family-feud/**`. Depends on: 00 (conventions, SDK API). Build the
pure core + JSON + editor + host UI first; phone integration last (read
`shared/bridge.js` when it exists; until then code to 00 §7).

## 1. The format (normative — faithful to the TV show)

Two **teams** compete to guess the most popular answers to survey questions
asked of 100 people. Each question has 3–8 hidden answers ranked by count.

**Round flow**

1. **Face-off.** One player from each team steps up. The host reads the
   question. The first to buzz answers. If their answer is the **#1** answer,
   their team takes control immediately. Otherwise the other face-off player
   answers; the **higher-ranked** answer wins control. If neither answer is on
   the board, the face-off repeats with the same two players (host decides;
   button "Face-off again") — or the host may pick who controls.
2. **Play or pass.** The team that won control chooses to **play** the board
   or **pass** it to the other team.
3. **Team play.** The controlling team guesses one at a time. Each answer on
   the board is revealed (the "ding"); a miss earns a **strike** (big red X,
   the buzz). Revealing **every** answer wins the round outright.
4. **Steal.** On the third strike the other team confers and gives **one**
   answer. If it's on the board, they **steal** all points in the bank
   (including the answers revealed so far). If not, the controlling team keeps
   the bank.
5. **Points.** Every revealed answer's count goes into the round bank; the
   bank is multiplied by the round multiplier (classic: rounds 1–2 ×1, round
   3 ×2, round 4+ ×3 — configurable) and awarded to the winning team. After
   the award the host reveals the remaining answers ("Let's see the rest").
6. **Fast Money** (optional, on by default). The team with more points (host
   can override) sends two players. Player 1 answers 5 questions in 20 s;
   answers are then revealed one by one with their counts. Player 2 (ideally
   not listening) answers the same 5 in 25 s; a **duplicate** answer triggers
   the "try again" buzz and they must give another. 200 points or more across
   both wins the grand prize. In voice chat player 2 can mute/leave the call
   briefly; the host UI shows a "Player 2 — cover your ears" interstitial.

House rules that stay configurable: strikes per round (3), multipliers per
round index, number of rounds (defaults to the count in the JSON), Fast Money
target (200), timers (20/25), whether "sudden death" (the last round with only
the #1 answer counted) is used — **sudden death is a non-goal**, omit.

## 2. Content JSON (`games/family-feud/questions.json`)

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
      "question": "Name something people do in the shower.",
      "answers": [
        { "text": "Sing", "count": 45 },
        { "text": "Shave", "count": 22 },
        { "text": "Think", "count": 14 },
        { "text": "Wash hair", "count": 11 }
      ]
    }
  ],
  "fastMoney": [
    { "question": "Name a fruit that's red.", "answers": [ { "text": "Apple", "count": 60 }, { "text": "Strawberry", "count": 25 }, { "text": "Cherry", "count": 10 } ] }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `title` | no | string |
| `settings.strikes` | no | 1–5, default 3 |
| `settings.multipliers` | no | array of positive numbers; index = round; last value repeats; default `[1,1,2,3]` |
| `settings.fastMoney.enabled/target/timer1/timer2` | no | defaults true / 200 / 20 / 25; timers 0–120 |
| `rounds` | yes | 1–12 rounds |
| `rounds[].question` | yes | non-empty ≤ 200 chars |
| `rounds[].answers` | yes | 3–8 answers, **sorted by count desc on load** (validator sorts, doesn't fail) |
| `answers[].text` | yes | non-empty ≤ 40 chars; unique within a question (case-insensitive) |
| `answers[].count` | yes | integer 1–100; sum per question ≤ 100 (else **warning** in the editor, not a load failure) |
| `fastMoney` | when enabled | ≥ 5 questions, same answer rules; the game uses the first 5 (editor lets you reorder) |

Ship 6 rounds + 8 Fast Money questions of original, family-friendly content
(write your own surveys; plausible counts). Mirror in `js/data.js`.

## 3. Host UI (projector-first)

Palette (`--stage-*`): deep blue stage `#0b1e4a`, board tiles navy-to-blue
gradient with gold numbers `#f2b632`, revealed answer text white on blue,
strikes red `#e4002b`, team A gold / team B silver-blue. Type: Anton + Inter.

Screens:

1. **Setup**: team names (defaults "Team Blue"/"Team Red", used as colours),
   team rosters (drag-free: each lobby/manual player has an A/B/– toggle;
   standalone shows a text list per team), rounds to play (default all),
   Fast Money on/off, sound toggle, load JSON / open editor, **Start**.
   Embedded: the roster comes from `room.players()`; phone players can also
   pick their own team from the phone (see §5); the host's toggle wins.
2. **Board**: question at the top (large, host reads it aloud), the answer
   board (numbered tiles 1–N, two columns when N > 5, TV-style flip reveal
   with the ding), round bank in the centre with `×2`/`×3` badge, team
   scores left/right with the controlling team highlighted, strike X's row
   (empty slots visible), phase banner ("FACE-OFF", "{Team} — play or pass?",
   "{Team} is playing", "STEAL — {Team}", "Round over").
   Host controls under the board (context-sensitive):
   - Face-off: **{Team A} buzzed** / **{Team B} buzzed** (or auto from phones),
     then per buzzed player: **Reveal answer #n** (click a tile) / **Not on
     the board** (strike sound, no strike count), **Give control to A/B**,
     **Face-off again**.
   - Play or pass: **Play** / **Pass**.
   - Team play: click a tile to reveal; **Strike**; **Undo**.
   - Steal: click a tile (steal succeeds) / **No steal** (fails).
   - Round over: **Reveal the rest**, **Next round** / **Fast Money** / **Finish**.
   - Always: **Undo** (last action; history stack of ≥ 20 states), **Scores**
     editable by click (Jeopardy behaviour), 🔊.
3. **Fast Money**: 5 rows (answer text · points), a timer bar (cue only, red
   blocks like Jeopardy's `timer.css`), **Start timer**, per-row text input
   for the host to type what player 1 said (or the phone's typed answer lands
   here), then **Reveal** per row (host picks the matching board answer from a
   dropdown or "no match → 0"), running total; the player 2 pass hides the
   player 1 column ("cover your ears" screen) until revealed, duplicate
   detection (same board answer) → "TRY AGAIN" flash + buzz and the row is
   marked duplicate. Total ≥ target → "WINNER" celebration; else "So close".
4. **Final standings** + **Play again** (same teams, fresh rounds) + **Back to
   setup**.

Sounds (WebAudio, behind 🔊): ding (reveal), strike buzz (low square-wave
burst ~500 ms), face-off buzz-in beep, Fast Money win fanfare (3-note arpeggio).

## 4. Pure core (`js/feud-core.js`, UMD → `FeudCore`)

- `validateGame(data)` → throws `Error(msg)` with the same style as Jeopardy's
  `validateGame`; `normalizeGame(data)` sorts answers and applies defaults;
  `warningsFor(data)` → `[string]` (sum > 100 etc.).
- `createState(game, options)` → `{phase, round, teams:[{name,score,players:[pid]}],
  control, buzzed, faceoff:{...}, revealed:[bool], strikes, bank, multiplier,
  steal:{...}, fastMoney:{...}, history:[…], sound}`.
- `reduce(state, event)` → new state (immutable). Events: `start`, `buzz{team,
  pid?}`, `reveal{index}`, `notOnBoard`, `giveControl{team}`, `faceoffAgain`,
  `play`, `pass`, `strike`, `steal{index|null}`, `revealRest`, `nextRound`,
  `beginFastMoney{players:[pid,pid]}`, `fmAnswer{slot,q,text}`, `fmReveal{slot,q,
  answerIndex|null}`, `fmTimer{...}`, `finish`, `undo`, `setScore{team,score}`,
  `setTeam{pid,team}`. Illegal events for the phase are ignored (state
  unchanged) — never throw.
- Selectors: `roundPoints(state)`, `awardFor(state)`, `fmTotal(state)`,
  `phoneView(state, pid)` → what that phone should show (see §5), `boardView`.
- Phone payload validation: `validatePhoneMsg(obj)` → typed message or null.

## 5. Phones

Phone → host payloads: `{t:"team",team:"A"|"B"}` (setup only), `{t:"buzz"}`,
`{t:"fm-answer",slot:1|2,q:0-4,text}` (≤ 60 chars, sanitised).
Host → phone: `{t:"view",…}` = the full `phoneView` for that player (thin
client; render whatever arrives), sent on every state change to every phone.

Phone screens by `phoneView.screen`:

| screen | shows |
|---|---|
| `team-pick` | "Pick your team" A/B buttons (setup) |
| `wait` | team badge + colour, "Watch the host screen", current phase text |
| `faceoff` | if this player is one of the two at the podium (host chooses them in the UI; default: next unused player of each team): buzzer button, red "wait" → green "BUZZ" on **Arm** (host presses Space/Arm like Jeopardy; early tap = ignored, no lockout in Feud), first buzz wins; others see "Face-off: {A} vs {B}" |
| `fm-answer` | the 5 questions one at a time with a text field and Submit, timer bar mirrored; "Next" advances; after time-out the host can still accept |
| `fm-wait` | "Cover your ears!" for player 2 while player 1 plays |
| `result` | round/final result with team scores |

Manual (phone-less) players just appear in rosters; nothing else changes.

## 6. Editor

Same shape as Jeopardy's editor: title, settings fields, rounds list (add /
remove / move up-down; question; answers rows with text + count; live sum
badge that turns amber when > 100), Fast Money list, **Download JSON**
(validates, `questions.json`), **Use in game**, **Reset to loaded**, **Start
blank**, draft auto-save (`gsc-family-feud-draft-v1`). Inline error text with
the validator's message.

## 7. Files

```
games/family-feud/index.html
games/family-feud/css/feud.css  (+ feud-phone.css if needed)
games/family-feud/js/feud-core.js      pure (UMD)
games/family-feud/js/feud-app.js       host glue + persistence (gsc-family-feud-state-v1)
games/family-feud/js/feud-room.js      GSC.host glue
games/family-feud/js/feud-phone.js     GSC.player glue
games/family-feud/js/feud-editor.js
games/family-feud/js/feud-sound.js     WebAudio cues
games/family-feud/js/data.js
games/family-feud/questions.json
games/family-feud/tests/feud-core.test.mjs
games/family-feud/tests/harness.html   loopback with a fake GSC (see 06 §3)
games/family-feud/README.md
```

Script tags: `../../shared/room-protocol.js`, `../../shared/room-net.js`,
`../../shared/room-host.js`, `../../shared/room-player.js`,
`../../shared/bridge.js`, then the game scripts. `<body data-gsc-game="family-feud">`.

## 8. Success states

Unit (T1, `cd games/family-feud && node --test`):

- **F-U1** `validateGame` accepts the shipped JSON and the fixtures; rejects: no rounds, 2 answers, 9 answers, count 0/101/non-integer, duplicate answer text, empty question, `fastMoney` with 4 questions while enabled, `strikes` 0.
- **F-U2** `normalizeGame` sorts answers desc, applies defaults; `warningsFor` flags sum > 100.
- **F-U3** Face-off: buzz A, reveal #1 → control A immediately; buzz A, reveal #3, then B reveals #2 → control B; both not-on-board → `faceoffAgain` allowed; `giveControl` overrides.
- **F-U4** Play/pass swaps control; strikes increment; 3rd strike → `steal` phase for the other team.
- **F-U5** Steal success → other team gets bank×multiplier; steal fail → controlling team gets it; revealing every answer ends the round for the controlling team without a steal.
- **F-U6** Multipliers apply by round index and the last value repeats for extra rounds.
- **F-U7** Undo restores the previous state exactly (deep equal) and is a no-op with empty history; history capped.
- **F-U8** Fast Money: totals, duplicate detection (same board answer index → 0 and `duplicate:true`), target reached flag; timer fields are cue-only (no state transition on timeout).
- **F-U9** Illegal events in every phase leave state unchanged (table-driven test over all events × phases); inputs deep-frozen.
- **F-U10** `validatePhoneMsg` accepts documented payloads, strips controls, caps text, rejects junk; `phoneView` per screen contains no other player's Fast Money answers before reveal.

Loopback (T2, `games/family-feud/tests/harness.html` — fake `GSC` in page):

- **F-I1** Setup with 4 fake phones → team picks land on the host roster; host override wins.
- **F-I2** Face-off buzzers: arm → first phone buzz sets `buzzed`; second is ignored; host reveal flow proceeds.
- **F-I3** Fast Money typed answers from phone land in the host rows; player 2's phone shows `fm-wait` during player 1's turn; duplicate flagged.
- **F-I4** Reload mid-round restores the board, strikes, control and history.
- **F-I5** Editor: Download JSON produces a file that `validateGame` accepts and that equals the draft; sum > 100 shows the amber warning; Use in game starts with it.
- **F-I6** Every phone-facing string is inserted via `textContent` (grep gate); files < 800 lines; no `console.log`.

Standalone (T4): the page opened directly runs a full game with no phones,
including Fast Money typed by the host; "Open room" shows a code and a phone
can join with `?room=`.
