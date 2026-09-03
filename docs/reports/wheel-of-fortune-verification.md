# Wheel of Fortune — verification report

Component: `wheel-of-fortune` · Spec: `docs/04-wheel-of-fortune-spec.md` ·
Plan: `docs/06-verification-plan.md` · Tester: independent (did not write the code)

**Verdict: fix-then-ship.** One critical and two major defects, all with small
fixes. Details in §4 and §5.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 (`node --test`, zero deps) |
| Browser | Chromium (in-app browser), `prefers-reduced-motion` emulated via `matchMedia` shim + CSS rule inspection |
| Server | `python -m http.server 8643 --bind 127.0.0.1` from the repo root (launch config `hub-test-wheel`) |
| Date | 2026-09-03 |
| Under test | `games/wheel-of-fortune/**` at the state handed over in `docs/reports/wheel-of-fortune-implementation.md` |
| Added by the tester | `games/wheel-of-fortune/tests/wheel-adversarial.test.mjs` (798 lines, 28 tests). No source file was modified. |

Real-network note: the PeerJS broker and WebRTC **worked** from this machine
(host room `8DFG` through the hub, standalone room `UJT6` on the game page).
**No result below is BLOCKED-ENV.**

---

## 2. Results

### 2.1 T1 — unit (`cd games/wheel-of-fortune && node --test`)

```
ℹ tests 69      (41 implementer + 28 tester-added adversarial)
ℹ pass 69
ℹ fail 0
ℹ duration_ms 496
```
Exit code 0.

I read the whole of `tests/wheel-core.test.mjs` before running it. **Every
W-U id is genuinely asserted** — no tautologies, no assertions on values the
test itself computed from the implementation. Spot checks: W-U3 drives all 12
wedge indices with an injected rng and asserts `wedge.index`/`wedge.value`
against the wedge list; W-U9's illegal-event table asserts object *identity*
(`===`), which is the strongest form of "nothing happened"; W-U10 asserts the
answer string never appears in `JSON.stringify(phoneView(...))`.

| ID | Result | Evidence |
|---|---|---|
| **W-U1** `validateGame` | PASS | Implementer's table-driven rejections (lowercase+digits, 64-tile, 20-letter word, 2 bonus, bonus not last, all-BANKRUPT wheel, `-100`, `555`, 2-wedge list, empty/31-char category, `vowelCost:0`, `bonusSeconds:61`, `null`, `[]`). Tester added `A3`: **33 wedges** rejected (`"settings.wedges" needs between 12 and 32 wedges (found 33)`), 32 accepted, 12 accepted, 11 rejected; **any string other than the two sentinels** rejected — `"FREE PLAY"`, `"WILD CARD"`, `"MYSTERY"`, `"bankrupt"`, `"Lose A Turn"`, `"LOSE  A  TURN"`, `"BANKRUPT "`, `"$500"`, `"500"`; `NaN`/`Infinity`/`500.5`/`0` rejected; **lowercase puzzle accepted and normalised** (`"a penny for your thoughts"` → `A PENNY FOR YOUR THOUGHTS`, and the normalised form re-validates); **digits always rejected** (`level 42`, `1 2 3`, `ROOM 101`, `50% OFF`, `A+B`, `CAFÉ`, `你好`); non-array wedges, `settings: []`, `title: 7`, 21 rounds, `rounds:[null]`, missing puzzle/category all rejected with plain-English text. `puzzles.json` and `js/data.js` normalise to the identical object. |
| **W-U2** `layoutPuzzle` | PASS | Implementer: rows exactly `[12,14,14,12]`, centred, null for 20/15-letter words and 64 tiles, apostrophe owns a tile, deterministic. Tester `A1`: a **14-letter word fits** and lands on a 14-wide row (never row 0 or 3); a **15-letter word never fits**, alone or beside a short word; a **52-tile puzzle that exactly fills 12/14/14/12** fits (`[12,14,14,12]` occupied) and `validateGame` accepts it, while 53 tiles is rejected; **punctuation-only tokens** (`&`, `-`) own their own tile and survive; a letter-free puzzle (`"..."`) lays out but the validator rejects it (`"puzzle" needs at least one letter`); **double/triple spaces collapse** and leading/trailing whitespace (incl. `\t`, `\n`) is trimmed; **apostrophes never split a word** (`IT'S A DOG'S LIFE` → 4 words, 2 apostrophe tiles); across 8 sample puzzles every row is centred (±1), has no stray internal gaps, and the word list round-trips exactly. |
| **W-U3** spin / wedges | PASS | Implementer: all 12 indices from the injected rng, `rng()===1` clamps to the last, `rng()===0` to the first; BANKRUPT zeroes round only; LOSE A TURN keeps money; a second spin is a no-op. Tester `A2`: **BANKRUPT on a $0 pot** leaves 0 (never negative), spares a $7,500 bank, touches no other player, passes the turn, and owes no consonant. |
| **W-U4** letters / vowels | PASS | Implementer: 2×R at $500 = $1,000 and the turn is kept; absent letter passes; vowel after a spin illegal; buy needs round ≥ cost. Tester `A2`: **a used letter is refused in every casing** (`"R"`, `"r"`, `" r "`) and the reducer returns the *same object*, so a double-tap can never cost the turn; **every vowel casing** is refused after a spin (`A a " E " I o U`) with no money moved; **buying a vowel with exactly the cost** is allowed and lands the player on $0, after which `buyVowel` is both illegal and refused. |
| **W-U5** solving | PASS | Implementer: $800 → banks the $1,000 minimum, others' pots reset, solver starts the next round, wrong passes the turn. Tester `A2`: **roundMinimum applied on every winning path** — $500→$1,000, $900→$1,000, $900 banks in full with a $300 minimum, a $5,000 custom minimum is honoured, and a **cold solve on a $0 pot still banks the minimum** while everyone's pot resets. |
| **W-U6** only-vowels / full board | PASS | Implementer: `legalActions.spin === false` and the `spin` event ignored; a full board still needs a confirmed solve. Tester `A2`: on a full board `legalActions` is exactly `{spin:false,buyVowel:false,solve:true,letters:[]}` and `spin` is refused; **only vowels left → buy an ABSENT vowel** pays up front, passes the turn on the miss with **no refund**, burns the letter so it is never offered again, and spin stays dead for the next player too. |
| **W-U7** toss-up | PASS | Implementer: reveal order is a permutation of the hidden letter positions, reproducible per seed; buzz pauses and locks; wrong locks + resumes; nth value awarded; nobody solving = no points. Tester `A2`: **every player locked out** — after 3 wrong buzzes `locked === ["p1","p2","p3"]`, `running:false`, `done:true`, `roundDone:true`, all totals 0, `tossupStart`/`tossupRevealNext`/`tossupBuzz` are all no-ops, every phone's `armed` is false, and `nextRound` still moves on. |
| **W-U8** bonus | PASS | Implementer: leader chosen, RSTLNE pre-revealed, 9 rejection cases, one pick only, judged. Tester `A2`: **ties for the leader** — 3-way tie, all-zero tie and a tie at the top all go to the first player in turn order, the tied runner-up gets `screen:"wait"`, and `setTotal` re-picks the contestant while keeping RSTLNE; **picks containing a used or duplicate letter** — 14 refusal cases (`R`/`S` free, `E` as the vowel, duplicate consonant, duplicate vowel, vowel among the first 3, consonant in slot 4, 3 letters, 5 letters, a digit, a bare string, a nested array, empty, nulls) refused by both `validateBonusPicks` and `reduce`; a legal pick normalises casing/padding (`["c"," d ","M","o"]` → `C D M O`). |
| **W-U9** undo / illegal / immutability | PASS | Implementer: exact undo, 20-case illegal table asserting `===`, deep-frozen inputs, JSON round-trip. Tester `A5`: **deep-frozen state × 28 events × 9 phase-representative states** (idle, tossup, buzzed, round, called, solving, bonus, picked, final) — nothing throws, `JSON.stringify` of the frozen state is byte-identical after every event, the selectors don't mutate either, and a changed state never re-uses the frozen `players` array; **undo across phases** — a 14-step walk idle→tossup→round→bonus→final unwinds one event at a time and each step deep-equals its pre-event snapshot; **undo of a solve** rolls the bank back on the first press and the pot on the second; **undo of Next round** brings the solved board back, not a blank one; `history` never exceeds 60 entries and snapshots never nest. |
| **W-U10** phone payloads / views | PASS | Implementer: 16 junk cases → `null`, 80-char cap, control chars stripped, non-active players never get `turn`, the answer never leaves the host. Tester `A4`: an **81-char solve** caps at exactly 80 (as does 10,000 chars, in the message *and* in the state and banner); **`"ß"` is refused** (its `toUpperCase()` is `"SS"`), as are `é А Ａ İ Å Ⅰ` and empty/2-char/digit/`?`; accepted payloads are fresh minimal objects — `Object.keys({t:"spin",pid:"p9",cheat:true})` is `["t"]`, so **no attacker-controlled key ever reaches the reducer**; spoofed host events (`setTotal`, `solveJudged`, `undo`, `start`, `revealAll`, `view`) all return `null`; **a wrong pid** never gets actions, a wedge, or the answer, an unknown pid cannot buzz, and a non-leader never gets the bonus keypad. |

### 2.2 T2 — loopback (`tests/harness.html`)

`http://127.0.0.1:8643/games/wheel-of-fortune/tests/harness.html` →
**`#summary.ok` = "All 46 checks passed."**, `__WHEEL_HARNESS__.failed === 0`,
`uncaught === null`. Run twice in this session (start and end), identical.

| ID | Result | Evidence (harness detail text, verified independently where noted) |
|---|---|---|
| **W-I1** | PASS | `core=7 dom=7 rotation=1687.5deg`; `1688deg` ≥ 3 turns; readout `"$650"`; reduced motion settled synchronously on wedge 3 with `wheel-faded`. **Independently re-verified in the real host UI** — see §3.1: 6 consecutive spins where the core index, `wedgeAtPointer(DOM rotation)` and the label physically nearest the pointer all agreed. |
| **W-I2** | PASS | `p1=turn p2=wait`; 21 keys enabled, none a vowel; phone letter revealed on the host; used letters disabled; phone SPIN drove the host wheel; `"Waiting for Ana's phone…"`; Take over; `scores`/`title` reported. Re-verified over real WebRTC (§3.3). |
| **W-I3** | PASS | `WAIT` → `BUZZ`; reveals frozen at 4 for 1.8 s (> the 1.2 s tick); `🔔 Ben`; Wrong → `locked=p2 running=true`; correct pays 1000. Re-verified over real WebRTC (§3.3). |
| **W-I4** | PASS | `leader=p1, free letters=RSTLNE`; `p1=bonus p2=wait`; `vowels offered: AIOU`; picks land on the host; host lit 9/9 and phone blocks 9; `lit 9 → 7`; `🎉 $25,000!`. Re-verified over real WebRTC (§3.3). |
| **W-I5** | PASS | `roundIndex 1→1`, `used CBD→CBD`, `revealed` bit-identical, `turn 0→0`, totals identical, board repainted. **Independently re-verified with a reload mid-spin** (§3.1). |
| **W-I6** | PASS | Preview matches `layoutPuzzle` tile-for-tile; "doesn't fit" blocks Download **and** Use; fixing unblocks; wheel preview `24 → 25 → 24`; Use in game goes through `validateGame`. **Independently re-verified in the real editor** (§3.2). |
| **W-I7** | PASS | 19 files scanned, no HTML-string / `document.write` / `eval` / Function APIs; no `console.log`; every file < 800 lines; only Google Fonts + the SVG namespace; `data-gsc-game` + `#gsc-join`; body classes. Re-verified independently in §2.5. (Note: the harness's `SOURCE_FILES` list is hard-coded, so it does not scan the tester-added test file; §2.5 greps the whole tree instead.) |

### 2.3 T3 — real network through the hub (two phones, real PeerJS + WebRTC)

Host tab `http://127.0.0.1:8643/` → **Host a game night** → room **`8DFG`**,
`"2 phones connected"`. Two phone tabs at `?room=8DFG` joined as **Zoe** (p1)
and **Max** (p2), both emulated at **320×640**. Host picked Wheel of Fortune;
the shell loaded `…/games/wheel-of-fortune/index.html?embed=host&room=8DFG`,
`GSC.mode === "embed-host"`, body `gsc-embedded`; the phone iframes loaded
`?embed=player&room=8DFG&pid=p1&name=Zoe`, body `player-mode gsc-embedded`.

| Check | Result | Evidence |
|---|---|---|
| Roster → players | PASS | `players: [p1:Zoe, p2:Max]`, phone rows show `📱 on a phone` and no Remove button. |
| Toss-up buzzers, first wins | PASS | Host **Start reveal** → both phones read `BUZZ`; both buzzed within the same batch → host `buzzed:"p2"`, banner `🔔 Max`, reveals stopped (`running:false`). Zoe's buzzer fell back to `WAIT` (disabled). |
| Wrong locks and resumes | PASS | Host **Wrong** → `locked:["p2"]`, `running:true`, banner `Not it — Max is locked out. Reveals resume.`; Max's phone read `LOCKED OUT` (disabled, `.locked`); Zoe's read `BUZZ`, buzzed, host **Correct** → `Zoe takes the toss-up — $1,000!` and the board filled. |
| Phone **Spin** | PASS | Phone SPIN → host wheel spun, `core=19 dom=19`, readout `$600`, banner `$600 — Zoe, call a consonant.` |
| Phone letter, used letters disabled | PASS | Phone `S` → host `used:"S"`, `Zoe:600`, board `…S…`. Next spin: `S` disabled on the phone keyboard, 20 keys enabled, no vowels. |
| Phone solve shown to host, never auto-judged | PASS (rules) / see **W-D2** | Phone submitted `<b>game show central</b>` + 200 `x`. Host state: `solveText.length === 80`, banner `Zoe says: "<b>game show central</b> xxxx…" — host, judge it.`, `banner.children.length === 0` (markup is inert text), `roundDone:false`, no money moved — **never auto-compared**. But the host cannot then press Correct (**W-D2**). |
| Take over | PARTIAL | Clears the phone markers and hides `Waiting for {Name}'s phone…`, and the host's own buttons already mirror `legalActions`. It clears the marker for **all** phones, not just the active one (**W-D8**), and it does **not** re-enable the Solve dialog (**W-D2**). |
| Bonus on the leader's phone | PASS | Leader `p1` (Zoe, $2,250). Her phone got `screen:"bonus"` with `BCDFGHJKMPQVWXYZ` offered; after 3 consonants only `AIOU` were offered; **Send letters** → host `picks:["C","H","M","I"]`, board `THE _INNER'S CIRCLE`, host timer 9 blocks, phone timer 9 blocks, both counting. Max's phone stayed on `wait` (`Zoe is playing. Sit tight.`). |
| `⌂ Lobby` and back restores state | PASS | Confirm dialog → lobby (iframe destroyed) → **Play** again → `phase:"bonus"`, `roundIndex:9`, `picks:["C","H","M","I"]`, `used:"RSTLNECHMI"`, `revealed:18`, `Zoe:2250,Max:0`, banner and board identical. |
| Phone reload mid-turn | **FAIL — W-D3** | Zoe's phone reloaded, auto-re-linked to `pid=p1` and loaded the game iframe, but `WheelPhone.getView() === null` and `"Waiting for the host…"` 8–9 s later, while the host showed `Waiting for Zoe's phone…`. A standoff, broken only by the host acting (any state change re-pushes and the phone heals instantly — verified). |
| Standings to the shell | PASS | `shell-game-sub` tracked `Toss-up 1` → `Round 2` → `Bonus round 10` → `Final standings`; the hub night scoreboard read `Zoe 2250 / Max 0`. |
| Phones mirror the result | PASS | Both phones showed `screen:"result"` with `Zoe $2,250 / Max $0`. |

### 2.4 T4 — standalone / regression

| Check | Result | Evidence |
|---|---|---|
| Full game, host-only, no phones | PASS | 3 players (Ana/Ben/Cid) at `http://127.0.0.1:8643/games/wheel-of-fortune/`. Toss-up "THE JUNK DRAWER": Start reveal, reveals ticked one letter at a time, a podium click named Ben, reveals froze at 5 for 2 s, **Correct** → `Ben takes the toss-up — $1,000!` and the board filled. Regular round: 6 spins (§3.1), letters called, a $1,150 pot, **Solve…** dialog → **Correct** → `Ben solves it and banks $1,150!`. **Undo** rolled the whole solve back ($2,150→$1,000, revealed 17→5, `roundDone:false`); a second Undo cleared the attempt and the state deep-equalled the pre-solve snapshot. **Reveal all** → `The answer was "GAME SHOW CENTRAL".`, board full, Spin/Reveal disabled, Next round shown, totals untouched — and Undo restored the hidden board. Bonus round: leader spotlighted, RSTLNE free, host picked C H M + I, board `THE _INNER'S CIRCLE`, 9-block timer, **Correct** → `🎉 $25,000!`. **Next round** → final standings, **Play again** present. |
| Standalone with one phone via `?room=` | PASS | Game page → **Open room (phones)** → room **`UJT6`**, join link shown. Second context at `…/games/wheel-of-fortune/?room=UJT6`: `GSC.mode === "standalone-player"`, body `player-mode`, the SDK rendered its join card inside `#gsc-join` (code pre-filled `UJT6` + name field + Join). Joined as **Pia** (pid `p1`); the card hid itself and the phone UI appeared with a real view. Phone **SPIN** over real WebRTC → host `wedge {index:22, value:2500}`, banner `$2,500 — Pia, call a consonant.`, phone `"$2,500 — pick a consonant"` with 21 consonants enabled. |
| Reload mid-spin | PASS | Reloaded while the wheel was turning: `wedge {index:8,value:500}` and `pendingSpin:true` restored exactly, `used`/`turn`/`revealed`/`totals` unchanged, the wheel **snapped to the right wedge** (rotation −127.5°, `wedgeAtPointer` → 8, nearest label to the pointer → 8, `$500`), banner `$500 — Ana, call a consonant.`, 21 consonants enabled. |
| Reload mid-bonus | PASS (state) / see **W-D6** | `picks`, `revealed:18`, `used:"RSTLNECHMI"`, totals, banner, `bonus-who` and the board all restored exactly. The **countdown restarts from full** (`WheelTimer`'s `running` map is module state) — **W-D6**. |
| Editor | PASS | See §3.2. |
| `?game=URL` | PASS (happy path) / see **W-D1** | `?game=/games/wheel-of-fortune/puzzles.json` → `Puzzles: custom URL (…) — 10 rounds.`, `sourceInfo().kind === "fetch"`. A **failing** URL dead-ends — **W-D1**. |
| Bad JSON via file input | PASS | `{ this is not json` → `That file can't be used: Expected property name or '}' in JSON at position 2 …`, content unchanged. Structurally valid but invalid content (`"level 42"`) → `That file can't be used: Round 1: "puzzle" may only use letters, spaces and ' - & , . ! ?`, content unchanged. A good upload loaded through `validateGame`. |
| `prefers-reduced-motion` | PASS | With `matchMedia` shimmed to report `reduce`, `WheelDraw.prefersReducedMotion()` is true, `spin()` returns with `isSpinning() === false` after **26 ms** (no animation), lands on the right wedge (core 11 = DOM 11 = nearest-label 11), applies `wheel-faded`, and the banner/readout are correct. CSS carries four `@media (prefers-reduced-motion: reduce)` blocks (the shared global reset plus `.tile-flip`, `.wheel-faded`, `.btn/.key/.podium` transitions, `.timer-bar.timer-done`, `.p-buzzer`). |

### 2.5 T5 — static gates V1–V8 on `games/wheel-of-fortune`

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | PASS | `V1 node --test exit=0`, 69/69. |
| **V2** every file < 800 lines | PASS | Largest: `tests/wheel-adversarial.test.mjs` 798 (tester-added), `tests/wheel-core.test.mjs` 777, `js/wheel-core.js` 706, `tests/harness.html` 644, `js/wheel-app.js` 562. Functions over ~50 lines (`enterRound`, `build`, `renderGame`, `roundCard`, `standaloneHost`) each carry a justification comment — checked. |
| **V3** no HTML-string / `document.write` / `eval` / `new Function` | PASS | `grep -rnE "innerHTML\|insertAdjacentHTML\|outerHTML[[:space:]]*=\|document\.write\|[^.[:alnum:]_]eval\(\|new Function" games/wheel-of-fortune/` → **no matches** (exit 1), tests and harness included. All DOM is `createElement` / `createElementNS` / `textContent`; the SVG wheel is built only through `document.createElementNS` (`js/wheel-draw.js:31`) and every node under `#wheel` reports the SVG namespace at runtime. |
| **V4** no `console.log` | PASS | `grep -rn "console\.log" games/wheel-of-fortune/` → no matches (exit 1). Diagnostics use `console.warn` only. |
| **V5** no Peer/connection/DOM/timer handle in state | PASS | Every `setState(...)` payload (`wheel-app.js:182,188,195,386,467`, `wheel-room.js:49`) is plain data. Ephemeral handles live in module scope: `spinning`/`cancelSpin`/`tossupTimer`/`bonusPicks`/`phonePids`/`listeners` in `wheel-app.js`, `running` in `wheel-timer.js`, `room`/`known` in `wheel-room.js`. Proved mechanically by the tester's `A6`: a mid-game state walked recursively contains only strings/numbers/booleans/plain objects/arrays, `JSON.parse(JSON.stringify(state))` deep-equals the state, and every `phoneView` is likewise pure JSON. |
| **V6** external URLs | PASS | Loaded assets reference only `https://fonts.googleapis.com`, `https://fonts.gstatic.com` and the `http://www.w3.org/2000/svg` XML namespace (never fetched). The only other hits in the tree are prose in `README.md` and the harness's own allow-list literal for the pinned PeerJS cdnjs URL. The game loads no CDN script itself. |
| **V7** `data-gsc-game`, `#gsc-join`, body classes | PASS | `index.html:16` `<body data-gsc-game="wheel-of-fortune">`, `index.html:243` `<div id="gsc-join">`. Observed live: embedded host body `gsc-embedded`; embedded phone `player-mode gsc-embedded`; standalone phone `player-mode`; standalone host no class. |
| **V8** `?game=URL` and upload validate through `validateGame` | PASS | `fetchContent` (`wheel-app.js:85`), `onUpload` (`:476`), editor `validateNow`/`download`/`useInGame` all call `WheelCore.validateGame`. Exercised live with a good URL, a 404 URL, a non-JSON URL, malformed JSON and invalid content; every rejection surfaced a plain-English message **except** the fallback path — **W-D1**. |

---

## 3. Independent re-verification of the headline claims

### 3.1 The wheel lands where the banner says (W-I1, done outside the harness)

Six consecutive spins in the real host UI. Three *independent* measurements per
spin: (a) `state.wedge.index` from the core, (b) `WheelDraw.wedgeAtPointer` of
the rotor's live `style.transform`, (c) the wedge label whose
`getBoundingClientRect()` centre is physically closest to the pointer at the top
of the SVG.

| # | core | DOM rotation | nearest label | value | readout | rotation | turns | duration |
|---:|---:|---:|---:|---|---|---:|---:|---:|
| 1 | 3 | 3 | 3 (`$500`) | 500 | `$500` | 1747.5° | 4.85 | 5.0 s |
| 2 | 4 | 4 | 4 (`$900`) | 900 | `$900` | 3532.5° | 4.96 | 4.2 s |
| 3 | 23 | 23 | 23 (`$650`) | 650 | `$650` | 5047.5° | 4.21 | 4.1 s |
| 4 | 7 | 7 | 7 (`$650`) | 650 | `$650` | 6727.5° | 4.67 | 4.1 s |
| 5 | 20 | 20 | 20 (`$550`) | 550 | `$550` | 8332.5° | 4.46 | 4.1 s |
| 6 | 6 | 6 | 6 (`$600`) | 600 | `$600` | 9982.5° | 4.58 | 4.1 s |

Plus two more agreeing measurements: after a reload mid-spin (index 8) and under
reduced motion (index 11). **8/8 agreement, no drift.** ≥ 4.2 turns and ≥ 4.1 s
every time (spec asks ≥ 3 s).

**Spin while a spin is in progress** — refused on every spin: `#btn-spin` was
`disabled`, a second click left `state.wedge.index` unchanged, and the banner
stayed `Spinning…` with readout `…`.

**Clicking letters during a spin** — refused on every spin: `#keyboard-wrap` was
hidden, `0` of 26 keys enabled, and clicking **all 26** keys mid-spin added
nothing to `state.used` (verified `""`, `"B"`, `"BC"`, `"BCD"`, `"BCDF"`,
`"BCDFG"` before and after). Keyboard events are gated too (`onKeydown` returns
early while `spinning`).

### 3.2 Editor (W-I6, done outside the harness)

- Live preview matched `WheelCore.layoutPuzzle` **tile for tile for all 10
  rounds** of the shipped content.
- Over-long puzzle `SUPERCALIFRAGILISTICEXPIALIDOCIOUS`: inline
  `ed-fit ed-fit-bad` + *"Doesn't fit: 4 rows of 12, 14, 14, 12 tiles, and words
  are never split."*, top-level error *"Round 2: … does not fit the board …"*,
  and **both Download JSON and Use in game disabled**. Typing a fitting puzzle
  re-enabled both.
- **Download JSON validates**: the Blob the button creates is
  `application/json`, 1,701 bytes, `puzzles.json`, parses, and
  `WheelCore.validateGame` accepts it (10 rounds, the edited round present).
- Wheel preview follows the chips: 24 → 25 (`+ Value 750`) → 26 (`+ BANKRUPT`) →
  24 (two chips removed). An illegal chip (`555`) surfaced
  *`"settings.wedges" entry 25 ($555) must be a multiple of 50.`* and disabled
  Download until removed.
- **Use in game** loaded the edited content through `validateGame`
  (`Puzzles: the puzzle editor — 10 rounds.`) and returned to setup with the
  players intact.

### 3.3 Security

| Property | Result | Evidence |
|---|---|---|
| Phone payloads validated before touching state | PASS | `wheel-room.js:95` calls `WheelCore.validatePhoneMsg` first and drops `null` silently. `validatePhoneMsg` rebuilds a minimal literal, so no attacker key survives (`Object.keys` is `["t"]` / `["t","letter"]`). |
| Only the active player's intents accepted | PASS | Live hostile test: the **off-turn** phone sent 18 payloads over real WebRTC — `spin`, two `letter`s, `buy-vowel`, `solve`, `buzz`, `bonus-pick`, and the spoofed host events `setTotal{total:999999}`, `solveJudged{correct:true}`, `nextRound`, `revealAll`, `undo`, `view`, plus `'junk'`, `null`, `42`, `{letter:"<img src=x>"}`, `{solve:null}`. Afterwards the state was **byte-for-byte what it was before**: `phase:"round"`, `roundIndex:1`, `turn:"Zoe"`, `used:""`, `wedge:null`, `solving:false`, `roundDone:false`, totals `0/0`, `revealed:2`, banner unchanged. `buzz` is additionally checked against the toss-up lock list and `bonus-pick` against `bonus.leaderPid`, both in the pure core. |
| No phone string reaches the DOM except via `textContent` | PASS | V3 grep is clean tree-wide. Proved at runtime: a phone solve of `<b>game show central</b>` rendered as literal text in the host banner with `banner.children.length === 0` — no element was created. All builders (`wheel-view.js`, `wheel-phone.js`, `wheel-editor.js`) use `createElement` + `textContent`; the wheel uses `createElementNS`. |
| Solve text capped/sanitised | PASS | A 224-char solve arrived as exactly 80 chars; control characters stripped (unit-tested); the phone's own `maxlength="80"` was bypassed by setting `.value` directly and the host still capped it. |

### 3.4 Design and accessibility

**Host at 1280×720** — no horizontal overflow (`scrollWidth 1265`); **~72 px of
vertical scroll** (`scrollHeight 792` vs 720) → **W-D5**. Board 706×276, wheel
274×274, podiums 296×187. Spin 118×54, Buy a vowel 132×41, Solve… 100×41,
on-screen keys 33×35 → **W-D7**. Every control in `#screen-game` is a real
`<button>` (the check for non-`<button>` clickables returned an empty list);
podiums are `<button>`s too. `#banner` is `role="status" aria-live="polite"`,
`#wedge-readout` likewise; the solve dialog is
`role="dialog" aria-modal="true" aria-labelledby`; 20 `role=`/`aria-` attributes
in the page.

**Phone at 320×640** (real embedded phone, mid-turn) — no horizontal overflow
(`scrollWidth === 320`). **Keyboard keys 44×48 px (≥ 44 ✓)**, **SPIN 294×60 px
(≥ 56 ✓)**, buzzer 294×210 px, Buy a vowel / Solve full-width.

**Colour is never the only signal** — checked case by case:
`readout-bad` is red *and* the text itself reads `BANKRUPT` / `LOSE A TURN`;
`podium-active` is a gold border + glow *and* the banner names the player;
`podium-buzzed` is teal *and* `🔔 {Name}` appears; `podium-locked` is opacity
0.45 (luminance, not hue) *and* the phone reads `LOCKED OUT`; `podium-leader` is
the literal word `LEADER`; used letters are `opacity`-dimmed chips *and* the
matching key carries the programmatic `disabled` state; `tile-punct` colouring is
redundant with the character shown. No hue-only carrier found.

**SVG** — built only with `createElementNS`; verified at runtime that every
descendant of `#wheel` has `namespaceURI === "http://www.w3.org/2000/svg"`.

---

## 4. Defects

Tester fixes are limited to `games/wheel-of-fortune/tests/**` and
`docs/reports/**` by the task brief, so **no source defect below was fixed by
me** — each carries the exact proposed diff instead.

### W-D1 — `data.js` never publishes its global: the offline fallback is dead and the page dead-ends silently · **major**

`games/wheel-of-fortune/js/data.js:38` (and `js/wheel-app.js:98`)

`data.js` declares `const DEFAULT_PUZZLES = {…}` in a classic script and only
exports it for Node (`module.exports`). A top-level `const` in a classic script
lives in the *script* lexical scope, **not** on `window` — verified at runtime:
`'DEFAULT_PUZZLES' in window === false` while the bare identifier resolves.
`wheel-app.js:98` reads `window.DEFAULT_PUZZLES`, so the fallback is `undefined`.

**Repro** (any of): open `games/wheel-of-fortune/index.html` from `file://`;
load it with the network down; or `…/games/wheel-of-fortune/?game=/nope.json`
(404) or `?game=/CLAUDE.md` (not JSON).

**Observed:** console `Uncaught (in promise) Error: Puzzle file must be a JSON
object.`; `WheelApp.getState() === null`; the setup card sits on
*"Loading puzzles…"* forever; `#load-error` is **empty**; adding a player does
nothing; **Start game is enabled and does nothing**. Two hard rules broken at
once — "works offline / from disk" (00 §1) and "every failure path surfaces a
plain-English message in the UI" (CLAUDE.md).

**Fixed by tester:** no. **Proposed fix** — one line in `js/data.js`, exactly the
pattern `games/weakest-link/js/data.js` already uses:

```diff
 if (typeof module === "object" && module.exports) module.exports = DEFAULT_PUZZLES;
+if (typeof globalThis !== "undefined") globalThis.DEFAULT_PUZZLES = DEFAULT_PUZZLES;
```

Recommended second line of defence in `wheel-app.js` `init()` — wrap the final
`useGame(info.game, info)` in `try/catch` and write `err.message` into
`#load-error`, so no future fallback failure can dead-end silently.

**Regression test to add:** the harness already fetches assets; a check that
`window.DEFAULT_PUZZLES` is an object would have caught this. (I did not add it
to `tests/harness.html` because that file is a fixture the implementer owns; the
one-liner above plus a harness assertion is the right pair.)

### W-D2 — a phone's solve can never be judged Correct from the host UI · **critical**

`games/wheel-of-fortune/js/wheel-app.js:271` together with
`games/wheel-of-fortune/js/wheel-core.js:221`

`legalActions` returns `solve:false` while `state.solving` is true
(`wheel-core.js:221 if (state.solving) return none;`), and `renderGame` gates the
only opener of the judge dialog on it:
`wheel-app.js:271 $("btn-solve").disabled = !actions.solve || spinning;`.
`#solve-dialog` (which holds **Correct** / **Wrong**) is opened *only* by
`#btn-solve` (`wheel-app.js:424`). So once a phone submits a solve there is no
click path to the judge buttons.

**Repro (real network, verified):** phone → **Solve** → type an answer →
**Submit**. Host state `solving:true`, banner
`Zoe says: "…" — host, judge it.` Host UI:

```
#btn-solve       visible, DISABLED
#solve-dialog    hidden  (#btn-solve-right / #btn-solve-wrong unreachable)
enabled buttons  btn-next-player, btn-undo, btn-reveal, btn-take-over, podiums
```

**Take over does not help** — it clears `phonePids`, which `#btn-solve`'s
disabled state does not depend on (re-verified: still disabled afterwards).
The host's only outs all lose the solve: **Next player** (turn passes),
**Undo** (attempt discarded), **Reveal all** (round ends, no money). A player
who solves correctly from their phone **cannot be paid**.

This breaks spec §5 (`solve` screen — "the host still judges") and spec §3
("**Correct / Wrong** for solves"). The host-only path is unaffected, which is
why T2/T4 missed it: the harness drives phone letters and spins but never a
phone *solve* through the host's judge buttons.

**Fixed by tester:** no. **Proposed fix** — one line:

```diff
-    $("btn-solve").disabled = !actions.solve || spinning;
+    // A phone's solve leaves legalActions.solve false; the host still has to
+    // judge it, so the dialog must stay reachable while state.solving is true.
+    $("btn-solve").disabled = (!actions.solve && !state.solving) || spinning;
```

`openSolve()` already pre-fills the dialog with `state.solveText` and
`judgeSolve()` already skips the redundant `solveAttempt` when `state.solving`,
so nothing else has to change. Nicer still: auto-open the dialog (or show an
inline Correct/Wrong row like `#tossup-judge`) the moment `state.solving`
becomes true, so the host does not have to know to click Solve….

**Harness check to add:** phone submits `solve` → the host clicks a *visible,
enabled* control → `Correct` → totals move.

### W-D3 — a phone that reloads in embedded mode gets no view until the host next acts · **major**

`games/wheel-of-fortune/js/wheel-room.js:60–82` (`onPlayerJoin` / `onPlayerStatus`
call `pushViews()` before the phone's game iframe is listening)

**Repro (real network, verified twice):** with a game in progress in the hub,
reload a phone tab. It re-links to the same `pid` and the shell loads
`?embed=player&…`, but `WheelPhone.getView()` stays `null` and the screen reads
*"Waiting for the host…"* — for 9 s in the test, indefinitely in principle.
When it is that phone's turn the result is a standoff: the host shows
*"Waiting for Zoe's phone…"* while the phone shows *"Waiting for the host…"*.

Calling `WheelRoom.pushViews()` from the console fixes it instantly, and so does
**any** host state change (verified: the next host button press delivered the
full, correct view). That recoverability is why this is major rather than
critical — but the host has to know to press something.

Root cause is a race, not a logic error: the host pushes the view the moment the
`DataConnection` re-opens, while the phone's shell is still creating the game
iframe, so the `{t:"msg"}` lands with nothing listening. **The standalone
`?room=` path is unaffected** (verified: Pia's first view arrived normally),
because there the phone page *is* the game page — which confirms the diagnosis.

**Fixed by tester:** no. **Proposed fix** (game-level, ~6 lines, keeps the host
authoritative):

```diff
  // js/wheel-phone.js, after GSC.player resolves
+   me.send({ t: "hello" });          // ask the host for a fresh view

  // js/wheel-core.js, validatePhoneMsg
    case "spin":
    case "buy-vowel":
+   case "hello":
    case "buzz":
      return { t: msg.t };

  // js/wheel-room.js, onMessage, before the phase checks
+   if (msg.t === "hello") {
+     room.send(pid, { t: "view", ...core().phoneView(state, pid) });
+     return;
+   }
```

**For the orchestrator:** this is very likely shell-wide. `shared/bridge.js`
posts `{t:"msg"}` to a phone's game iframe with no queue, so any game payload
that arrives before that iframe posts `ready` is dropped. Family Feud and
Weakest Link should be checked for the same symptom; a queue in the shell would
fix all four games at once and would be the better fix.

### W-D4 — `layoutPuzzle` is greedy, so short puzzles can be rejected · **minor**

`games/wheel-of-fortune/js/wheel-content.js:149` (`packWords`)

`"ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN"` is 39 letters / 48 tiles on
a 52-tile board, yet `layoutPuzzle` returns `null` and the validator says
*"does not fit the board"*. Greedy line-filling runs out of rows; an optimal
break would fit. Dropping one word makes it fit, which isolates the packer as
the cause.

**Spec-conformant** — §3 says the packer is greedy — so this is recorded, not
charged as a rules break. It is a content-authoring wart: the editor's message
tells the author the puzzle is too long when it is really the word order.
Characterised by the tester's test *"A1 layoutPuzzle is GREEDY…"* so any future
change to the packer is a deliberate one. If it is ever worth fixing, the
cheapest improvement is to try the next row when the greedy fit fails on the
last row before returning `null`; a better error message ("try re-ordering or
shortening the words") would help more for less risk.

### W-D5 — the host game screen needs ~72 px of vertical scroll at 1280×720 · **minor**

`games/wheel-of-fortune/css/wheel.css`

`scrollHeight 792` vs a 720-px viewport, mid-round with 3 players. 00 §10 says
host screens are designed for a shared screen at **1280×720 and up**. Nothing is
cut off and there is no horizontal overflow, but a projector at exactly 720p
hides part of the podium column until the host scrolls. (The implementer
measured 1280×900 and 1280×820, not 720.)

### W-D6 — reloading during the bonus round restarts the countdown from full · **minor**

`games/wheel-of-fortune/js/wheel-timer.js:45` + `js/wheel-app.js:350`

`WheelTimer`'s `running` map is module state and the deadline is not in the game
state, so after a refresh `sync("bonus", key, seconds)` finds no entry and calls
`start(...)` with a brand-new `startAt`. The contestant gets a fresh 10 seconds.
`wheel-timer.js`'s header comment says "a refresh just drops the clock" — it
actually *restarts* it. Low impact (the timer is a cue and the host judges), but
it is a free do-over. Fix: either persist a `bonus.deadline` timestamp in state,
or leave the bar expired after a reload and document it.

### W-D7 — host on-screen keyboard keys are 33×35 px and Spin is 54 px tall · **minor**

`games/wheel-of-fortune/css/wheel.css:265–274`, `index.html:103`

Measured at 1280×720. Below the 44 px / 56 px touch-target guidance, though the
host screen is mouse-driven and the phone UI (which the guidance is written for)
comfortably passes at 44×48 and 60. Recorded for completeness; worth two `min-height`
bumps if the host screen is ever used on a touch panel.

### W-D8 — "Take over" clears the phone marker for every phone, not just the active one · **minor**

`games/wheel-of-fortune/js/wheel-app.js:441`

`phonePids = new Set()` wipes the whole set, so all `📱` markers vanish and
`Waiting for {Name}'s phone…` will not reappear for *any* player until the next
roster event restores `phonePids` (verified: a phone reload brought them all
back). Spec §3 describes Take over as an escape hatch for one turn. Fix:
`phonePids = new Set([...phonePids].filter((p) => p !== active.pid));` or a
separate `takenOver` set cleared on `nextPlayer`/`nextRound`.

### W-D9 — "— 1 rounds." · **minor (cosmetic)**

`games/wheel-of-fortune/js/wheel-app.js:231`. Seen live after uploading a
one-round file: `Puzzles: uploaded file (good.json) — 1 rounds.`
Fix: `${n} round${n === 1 ? "" : "s"}`.

### W-D10 — saved state is keyed per game, not per room, so a new room's `p1` inherits the old `p1`'s podium · **minor**

`games/wheel-of-fortune/js/wheel-app.js:16` (`STORAGE_KEY`) +
`js/wheel-room.js:39–58`, `:60–70`

`gsc-wheel-state-v1` carries no room identity. Shell pids are assigned
sequentially per room, so when a *new* room's first phone is handed `p1`,
`syncRoster` sees `p1` already present in the restored state and skips it, and
`onPlayerJoin` then **renames** that existing player. Observed: joining a fresh
standalone room as "Pia" (pid `p1`) merged her onto the restored `p1` podium.
Harmless in the normal flow (the host presses **New game**, which zeroes totals)
but a stranger can land on someone's podium and grand total if the host resumes
instead. Fix: store the room code alongside the state and start a fresh game
when it changes, or namespace phone pids with the room code.

### W-D11 — "Next player" after Buy a vowel forfeits the $250 with no refund · **minor (observation)**

`games/wheel-of-fortune/js/wheel-core.js:403` (`doNextPlayer` clears
`pendingVowel` without restoring the cost). Reproduced in Node: pot 1800 →
buyVowel → 1550 → nextPlayer → 1550 with no vowel called. Defensible (a host
escape hatch is a host decision) and Undo restores it exactly, but worth one
line of README text so a host is not surprised.

### Non-defects worth recording

- **Bonus prize is not banked.** `bonusJudged{correct:true}` announces
  `$25,000` but adds nothing to the grand total (final standings read
  `Zoe $2,250`). Spec §1 calls the prize "a configurable **label**", so this
  matches the spec. Flagging it only because a host may expect otherwise.
- **A phone solve is never auto-compared.** Verified live with a *correct*
  answer: `roundDone` stayed false and no money moved. Working as specified.
- **Two phone tabs in one browser profile clobber each other's stored hub
  identity** (both are the same origin, so they share `localStorage`; the second
  tab's reload came back as the other player's name and was rejected with
  *"That name is taken — add an initial."*). This is a **test-environment
  artefact**, not a wheel defect — real phones are separate profiles. If the
  shell team wants two-tab testing to work, per-tab `sessionStorage` for the
  phone identity would do it. Out of scope for this component.

---

## 5. Judgement on the implementer's declared deviations (`…-implementation.md` §5)

| # | Deviation | Verdict |
|---|---|---|
| 1 | Pure core split into `wheel-content.js` + `wheel-core.js` | **Accepted.** The 800-line house rule is hard and 1,037 lines would break it. `wheel-core.js` re-exports the content half (`return { ...C, … }`), so `WheelCore` is still the single spec §4 API — every test, the app, the editor and the phones use only `WheelCore`, verified. Load order is enforced by `index.html` and documented in both file headers and the README. |
| 2 | `wheel-view.js` added | **Accepted.** Same rule. Read it in full: dumb renderers only, no rules, no state, no transport. |
| 3 | `js/timer-core.js` and `css/timer.css` copied from `games/jeopardy` | **Accepted.** `diff` says both are **byte-identical** to the Jeopardy originals, and the ownership argument (a cross-game `<script src="../jeopardy/…">` would break re-vendoring) is right. Worth a one-line note in the Jeopardy README so the two copies stay in step. |
| 4 | `solveJudged{correct:true}` does not itself advance the round | **Accepted.** W-U5 says "advances round"; the implementation banks, clears the other pots, fills the board and sets `roundDone`, then **Next round** advances *and the solver starts it* — which is the behaviour W-U5 is really specifying, and keeping the solved board on screen to be read out is the TV behaviour. Asserted by both suites. |
| 5 | `layoutPuzzle` also centres short puzzles vertically | **Accepted.** A harmless superset of spec §3; rows are still exactly 12/14/14/12, still greedy, still deterministic (tester's A1 re-checks all of that). One cosmetic wrinkle: a lone 13- or 14-letter word lands on row 2 with two empty rows above and one below, because the packer emits a leading empty line for a word too wide for row 0 and `verticalOffset` counts it. Not worth a fix. |
| 6 | `settings.autoOrder` added | **Accepted.** It implements spec §1's "whether the game auto-orders rounds" as an explicit, validated setting with an editor checkbox; default `false` keeps existing content unchanged. |
| 7 | Spin driven by `requestAnimationFrame`, not a CSS transition | **Accepted.** The group's `style.transform` is still what changes (spec §3's wording), and per-frame stepping is what makes the per-wedge tick possible. Measured 4.1–5.0 s and 4.2–5.0 turns (spec asks ≥ 3 s), `prefers-reduced-motion` still jumps with a fade, and the backgrounded-tab wall-clock guard is a genuine improvement. |

All three defects the implementer self-reported in §7 (normalize/validate
round-trip, the keyboard's stale click handler, the backgrounded-tab spin) are
fixed in the code I tested and are covered by tests.

---

## 6. Verdict

**Fix-then-ship.** The pure core is genuinely solid — 28 adversarial tests
attacking layout fuzz, rules corners, validator fuzz, phone-payload fuzz,
deep-frozen immutability and undo across every phase transition found **zero**
reducer defects, and the security posture is excellent: 18 hostile payloads from
an off-turn phone over real WebRTC moved nothing, and phone strings provably
reach the DOM only as text. The wheel is honest — eight spins across three
independent measurements always landed on the wedge the banner reported — the
harness's 46 checks are real, and the full game runs end to end host-only, in the
hub over PeerJS, and standalone with a `?room=` phone. But three things must be
fixed before release: **W-D2 (critical)** makes a phone player's correct solve
impossible to award, which breaks the documented phone flow in a way a host
cannot work around; **W-D1 (major)** leaves the page a silent dead-end whenever
content cannot be fetched, breaking both the "works offline / from disk" and the
"every failure path surfaces a plain-English message" hard rules; and **W-D3
(major)** leaves a reconnecting phone blind until the host happens to press
something. All three have small, low-risk fixes — one line, one line and about
six — and W-D3 is probably a shell-wide bridge issue worth fixing once for every
game. The eight minors can ship as README "known issues" if the orchestrator
prefers. Re-run `node --test` (69 tests) and `tests/harness.html` after the
fixes, and add the two coverage gaps those fixes imply: a harness check that a
phone `solve` can be judged **Correct** from a visible host control, and one
that `window.DEFAULT_PUZZLES` exists.
