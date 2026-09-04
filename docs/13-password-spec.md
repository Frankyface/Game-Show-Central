# 13 — Password

Status: **approved for implementation** · Component id: `password`
Owns: `games/password/**`. Depends on: 00 (SDK), design-system.md. Follow the
cross-cutting rules in `docs/reports/00-orchestrator-triage.md` (Phases 1–3):
`?game=URL` beats a save unless it came from that URL; room-scoped saves;
`globalThis` fallback in data.js; views pushed on join/status; phones only
express intent; own-property handler lookups; the shared theme accent block
is canonical (no local palette override).

## 1. The format (normative — classic Password)

Two teams of two: a **giver** and a **receiver** on each. Both givers are
shown the same secret **password**. Givers alternate giving **one-word
clues**; after each clue that team's receiver gets **one guess**.

- **Scoring.** The word is worth 10 points on the first clue and drops by 1
  with every clue (10, 9, 8 … 1). A correct guess scores the current value
  for that team. After ten clues with no correct guess the word is dead.
- **Who starts.** The team that did not win the previous word gives the first
  clue (host can override); the first word of the game is decided by the
  host (default Team A).
- **Illegal clues** (host judges): more than one word, any form of the
  password, hyphenated compounds, spelling, gestures. An illegal clue
  **forfeits the clue**: control passes to the other team **and the value
  drops** as if a clue had been given.
- **Game.** The first team to reach **25 points** (configurable) wins the
  game and plays the **Lightning Round**: the winning team's receiver must
  guess **5 passwords in 60 seconds** from single-word clues by their giver;
  each word is worth **$100** (configurable) and all five doubles the total
  (configurable). Passing is allowed; passed words may come back if time
  remains.
- **Roles swap** between words (giver ↔ receiver) unless the host disables
  it. Several games can be played in a night; Lightning Round money goes to
  both members and to the hub scoreboard.

Configurable: target score, starting value, Lightning Round seconds/words/
per-word value/all-five bonus, role swapping. Non-goals: Password Plus
puzzles, the Million Dollar Password ladder.

## 2. Content JSON (`games/password/words.json`)

```json
{
  "title": "Password — Game Night",
  "settings": { "currency": "$", "targetScore": 25, "startValue": 10,
    "lightningSeconds": 60, "lightningWords": 5, "lightningValue": 100, "allFiveBonus": true, "swapRoles": true },
  "words": ["Umbrella", "Whisper", "Mountain", "Ticket", "Jealous"]
}
```

| Field | Required | Rules |
|---|---|---|
| `words` | yes | ≥ 60 single words (letters, apostrophes and hyphens; no spaces), unique case-insensitively, ≤ 20 chars; the editor warns below 120 |
| `settings.*` | no | positive integers within sane bounds (target 5–100, seconds 15–180, words 1–10) |

Ship **200** original, common, family-friendly passwords across parts of
speech and difficulty (nouns, verbs, adjectives; the classic show mix).
Mirror in `js/data.js`. Words are drawn in file order with **Shuffle** on
the setup screen (rng injected); wrap sets a `repeating` flag the host sees.

## 3. Host UI and the secret-word rule

The shared screen must **never** show the password while it is in play.

- **Phone mode (preferred).** Both givers' phones show the password; the
  receivers' phones show only the value and whose clue it is. Givers tap
  **Clue given** after speaking (the host's button remains authoritative and
  can be pressed instead); the host judges every guess with **Correct /
  Wrong / Illegal clue**.
- **Host-as-giver mode (no phones).** The host gives clues for both teams
  from a **Show password to me** panel (with the shared-screen warning) or
  reads the password privately to both givers before the word starts
  ("study mode": password shown for 5 s, then hidden).

Screens: **Setup** (teams and roles, standalone typed; shuffle; settings; 🔊;
Start) → **Word** (the value ladder 10→1 lit at the current value, whose clue
it is, clue counter, team scores, Correct / Wrong / Illegal clue / Next word,
password hidden or revealed by mode; after the word ends the password is
shown with the clue count) → **Game over** (25 reached → celebration) →
**Lightning Round** (giant clock, 5 word slots that light on Got it, Got it /
Pass buttons and hotkeys, host-visible word panel in host-as-giver mode) →
**Result / Standings**. Undo everywhere; consistent toolbar; splash (skipped
when embedded).

Palette: classic show midnight blue `#0d1b4b` with white and gold `#f2c94c`;
the value ladder as lit gold rungs.

## 4. Pure core (`js/pwd-content.js` + `js/pwd-core.js`, UMD → `PwdCore`)

Events: `start`, `nextWord`, `clueGiven{team}` (host or giver intent),
`guess{result:"correct"|"wrong"}`, `illegal`, `setFirst{team}`, `skipWord`,
`toLightning`, `lightningStart{now}`, `lightningMark{result:"got"|"pass"}`,
`lightningExpired{now}`, `nextGame`, `undo`, `finish`. Selectors: `value`,
`turn`, `scores`, `lightningTotal`, `phoneView(state,pid)` — only the two
givers' views contain the password (and in the Lightning Round only the
winning giver's view contains the current word); `validatePhoneMsg`.
Clock as deadline timestamps with injected `now`.

## 5. Phones

Phone → host: `{t:"clue"}` (giver: "clue given"), `{t:"got"}` / `{t:"pass"}`
(Lightning giver), `{t:"ready"}`. Host → phone: `{t:"view",…}`. Screens:
`wait`, `giver` (password huge, current value, Clue given), `receiver`
(value + "listen for the clue"), `lightning-giver` (word + Got it / Pass +
clock), `lightning-receiver` (clock), `result`.

## 6. Editor, files, success states

Editor: word list as a textarea (one per line) with live count, duplicate
and format warnings; settings; Download / Use / Reset / Blank; draft key
`gsc-pwd-draft-v1`.

Files: `games/password/index.html`, `css/pwd.css` + `pwd-phone.css`,
`js/pwd-content.js`, `pwd-core.js`, `pwd-app.js`, `pwd-clock.js`,
`pwd-room.js`, `pwd-phone.js`, `pwd-editor.js`, `pwd-sound.js`, `data.js`,
`words.json`, `tests/pwd-core.test.mjs`, `tests/harness.html`, `README.md`.
`<body data-gsc-game="password">`.

Success states — unit **PW-U1…PW-U10**: validator; value ladder and dead
word after ten clues; alternation and first-clue rule; illegal clue passes
control and drops the value; target score reached mid-word ends the game;
role swap on/off; Lightning scoring, all-five bonus, passes cycling, expiry
finishing the in-flight word; shuffle/wrap; undo/illegal-event/immutability;
`phoneView` leak test (receivers and spectators never see a password).
Loopback **PW-I1…PW-I6**: both givers' phones show the password and the host
DOM does not; Clue given from a phone advances the ladder; host override;
Lightning clock sync; reload mid-word and mid-lightning; editor round-trip;
gates. Standalone T4: host-as-giver full game to 25 and a Lightning Round.
