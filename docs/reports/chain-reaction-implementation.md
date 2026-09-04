# Chain Reaction — implementation report

Component: `chain-reaction` · Owner: implementer agent · Date: 2026-09-04
Spec: `docs/14-chain-reaction-spec.md` · Owns `games/chain-reaction/**`
Nothing outside that directory was touched (no registry entry, no hub art, no
`shared/**`, no `git commit`).

---

## 1. What was built

A faithful Chain Reaction: two teams build a column of eight linked words a
letter at a time, then the leading team plays a 60-second Speed Chain.

| Screen | State | Notes |
| --- | --- | --- |
| Setup | `setup` | two team names, phones dropped onto teams from the roster, values / Speed Chain settings, JSON load, editor, Start |
| Chain | `chain` | the eight-word letter-tile column, control indicator, chain value badge, "chain n of N", Reveal from top / bottom (only the two frontier words), Correct / Wrong, a typed guess field that mirrors the phone, Peek, Pass control, Undo, End the night |
| Chain complete | `chainDone` | an interstitial over the board: the whole chain in team colours, the standings, and the one button that applies (Next chain / Sudden death / Speed Chain) |
| Sudden death | `sudden` | one chain word with its two neighbours as the clue, letters revealed one at a time, first correct call takes the tie |
| Speed Chain | `speed` | the column with the first letter of every hidden word, a giant clock, ✓ / Pass, hotkeys |
| Result | `result` | winner banner and standings |
| Editor | — | every chain as eight stacked fields with **live per-word validation** and the pair label under each field |
| Phone | — | `wait` / `control` / `watch` / `speed` / `result` |

Sounds are WebAudio only: letter tick, word-reveal chime, wrong buzz, chain
chime, clock beat, time-up, all-six fanfare, win. Behind the shared `gsc-sound`
toggle.

## 2. Files

```
games/chain-reaction/
  index.html            332   host + phone screens in one page
  chains.json            38   18 chains + 4 speed chains
  README.md             187
  js/cr-content.js      338   PURE: JSON contract, word helpers, wordProblem
  js/cr-select.js       285   PURE: every read of a state (frontier, column, phoneView)
  js/cr-core.js         585   PURE: the immutable reducer (UMD → CrCore)
  js/cr-view.js         406   host rendering + the shared $ / el / show / setText
  js/cr-app.js          588   host glue: state, persistence, buttons, hotkeys, cues, splash
  js/cr-clock.js         96   the Speed Chain clock (the only frame loop)
  js/cr-editor.js       323   the chain editor
  js/cr-room.js         224   GSC.host glue: roster, payload validation, masked views
  js/cr-phone.js        310   the phone controller
  js/cr-sound.js        117
  js/data.js            253   generated mirror of chains.json
  css/cr.css            454   host
  css/cr-phone.css      186   phone
  tests/cr-core.test.mjs  744  57 unit tests
  tests/harness.html      634  29 loopback checks
  tests/fixtures/harness-game.json  24
```

Largest file 744 lines (a test), largest shipped file 585. All under 800.

### Deviations from the spec's file list (both precedented, both documented in the README)

- `js/cr-select.js` — the spec lists the pure core as `cr-content.js` +
  `cr-core.js`. A single core came out at **813 lines**, so the read-only
  selectors moved into a third file, exactly as Feud / Wheel / Weakest Link /
  Millionaire did. `CrCore` re-exports all of it, so the API in the spec §4 is
  unchanged and the tests import only `cr-core.js`.
- `js/cr-view.js` — host rendering split out of `cr-app.js` for the same
  reason (Millionaire's `wwm-view.js` pattern). It also holds the four DOM
  helpers the editor / room / phone glue share, because it loads first.

## 3. The rules, and where they live

`js/cr-core.js` is the only place a rule is decided. Events:
`start`, `reveal{direction}`, `guess{text,pid?}`, `judge{correct}`,
`passControl`, `nextChain`, `suddenDeath`, `toSpeed{team}`, `speedStart`,
`speedMark{result}`, `speedExpired`, `finish`, `notice`, `undo`.

- **Eligibility** — `frontier()` returns the first unsolved word from the top
  and from the bottom; `eligibleWords()` lists them (one entry when a single
  word is left). A reveal in a direction with no eligible word is a no-op, and
  a second reveal before a judgement is refused.
- **Letters** — a per-character reveal mask. `revealNext` lights the leftmost
  unlit letter; punctuation (apostrophes, hyphens) starts lit and never costs a
  turn. A reveal that lights the **last** letter gives the word away: solved,
  no points, control unchanged (spec §1).
- **Judging** — correct: solved, `scores[control] += chainValue`, control
  stays, the word is credited to that team (`chain.owner`) so it lights in
  their colour. Wrong: control passes, the letter already given stays given,
  and with `settings.revealOnWrong` the incoming team gets the next letter too.
- **Chains** — completing one moves to `chainDone`; `nextChain` advances
  `chainIndex`, takes the next chain in file order, and alternates who opens
  (`chainIndex % 2`). The number of chains is `settings.values.length`.
- **Sudden death** — legal only when the chains are done and the scores are
  level. The word comes from a chain nobody played, its two neighbours are the
  clue, and the winner is credited the last chain's value so the standings show
  a clear leader (a small addition to the format; noted in the README).
- **Speed Chain** — six hidden words in a queue. ✓ banks the word and drops it
  from the queue; Pass sends it to the **back** so it comes back. Empty queue =
  all six = `speedAllClear`; expiry pays `speedPerWord × banked`. Marks after
  the round is over, and a second `speedExpired`, are both no-ops.
- **The clock** is a deadline timestamp with an injected `now`; `cr-clock.js`
  is the only frame loop and fires `onExpire` exactly once per running period
  (rAF plus a 250 ms safety interval, copied from `wl-clock.js`).

## 4. Phones — what they can and cannot do

`validatePhoneMsg` accepts exactly three shapes and nothing else:
`{t:"direction",dir}`, `{t:"guess",text}` (≤ 24 chars, control chars stripped),
`{t:"speed",result}`. `cr-room.js` then checks the sender is on the team in
control (or, for `speed`, the team playing) before the reducer sees anything,
and the reducer checks again.

- A direction reveals one letter — the controlling team's choice by the rules.
- A guess is **only shown** to the host, tagged with the phone's name. Nothing
  a phone sends can score, solve, advance or end anything.
- In the Speed Chain a phone may send `pass`; a `got` from a phone is dropped
  (pinned by a harness check that sends one).

**No phone ever holds a hidden letter.** `CrSelect.columnRows` copies a
character only when its mask flag is true, so an unrevealed letter is absent
from the payload rather than hidden by CSS. Pinned by `C-U10` (four tests,
every phase) and by `C-I3`, which scans both the phone's payload and the
phone's rendered card for every still-hidden word.

### Peek — a deliberate trade-off

The host screen *is* the shared screen, so it shows exactly what the players
see. The host still has to judge, so there is a **Peek** button that prints the
word in play in the corner. It is off by default, it says what it does, and it
clears itself on every judgement, undo and new target. Documented in the
README's "read this once" note and in "Known limits".

## 5. Content

`chains.json` ships **18 chains and 4 speed chains**, each exactly eight words,
each adjacent pair a common phrase or compound. Every pair was written and then
re-read individually; `js/data.js` is generated from the file and a unit test
asserts the two are byte-identical after parsing.

The validator enforces everything it can: ≥ 6 chains / ≥ 2 speed chains, 8
words each, A–Z after uppercasing with an apostrophe or hyphen allowed strictly
inside, 2–12 letters, no two neighbours the same, no word twice in a chain,
1–6 positive values, sane Speed Chain numbers. It cannot check that a pair is
*a phrase* — so the editor shows the pair under each field (`↳ SPACE SHIP`) and
flags length / letters / duplicates on every keystroke.

## 6. Cross-cutting rules from `00-orchestrator-triage.md`

| Rule | How it is met |
| --- | --- |
| Payloads dropped before the iframe is ready | the shell queues; the game additionally clears its `lastSent` cache on join **and** on status, and pushes on both |
| `?game=URL` beats a save unless the save came from that URL | `crChooseContent()`, with the plain-English "the game in progress was cleared" message |
| Room-scoped saves | `crBindRoom()`: a **different** room code drops the phone teams and any game that depended on them; the **first** bind only records the code (see §8) |
| `globalThis` fallback in `data.js` | `globalThis.CR_DEFAULT_GAME`, read as `globalThis.CR_DEFAULT_GAME` in the app and the editor |
| Views pushed on join/status | `onPlayerJoin` / `onPlayerStatus` both `delete lastSent[pid]` then `pushViews` |
| Phones only express intent | §4 above |
| Own-property handler lookups | `Object.prototype.hasOwnProperty.call(HANDLERS, event.type)` in `reduce`, and the same guard on `INTENTS`, `PHONE_SCREENS`, `CR_KEYMAPS`, `CR_CUES` and the sound cue map. A unit test fires `toString`, `valueOf`, `__proto__`, `hasOwnProperty`, `constructor`, `__defineGetter__` |
| The shared theme accent block is canonical | **no** `body[data-gsc-game]` block in `css/cr.css`; only `:root` stage colours and `--cr-*` extras. A harness gate greps for `body[data-gsc-game` and fails if it appears |
| Both gradient stops must clear contrast | measured, §7 |
| Every `@keyframes` / `animation:` inside `prefers-reduced-motion: no-preference` | both sheets; a harness gate parses the CSS and fails on any unguarded one |
| Splash skipped when embedded | `crShowSplash()` returns early on `gsc-embedded` and under reduced motion |

`chain-reaction` is **not** yet in `tests/core-prototype-guard.test.mjs` (a
root-level file this component does not own). The guard itself is implemented
and covered by the local suite; adding the row is a one-line change for whoever
owns that file:

```js
{ name: "chain-reaction", files: ["../games/chain-reaction/js/cr-content.js", "../games/chain-reaction/js/cr-select.js", "../games/chain-reaction/js/cr-core.js"], global: "CrCore", make: (C) => C.createState(C.normalizeGame(require("../games/chain-reaction/chains.json")), [{ pid: "p1", name: "A" }, { pid: "p2", name: "B" }], {}) },
```

## 7. Testing done

Environment: Windows 11, Node v24.16.0, Chromium via the in-app browser,
`python -m http.server 8702 --bind 127.0.0.1` from the repo root, 2026-09-04.

| Tier | Result |
| --- | --- |
| **T1 unit** — `cd games/chain-reaction && node --test` | **57 / 57 pass**, 0 fail (C-U1 … C-U10, plus validator adversarials, `validatePhoneMsg` junk, immutability, history cap, `legalActions`, and a full three-chain + Speed Chain play-through of the shipped file) |
| **T2 loopback** — `tests/harness.html` | **29 / 29 pass**, `#summary.ok`, run three times with the same result (C-I1 … C-I6 + the static gates) |
| **T3 real network** — real PeerJS broker, host tab + phone tab | room `4N7X` opened, phone joined as `p1`/Ada over WebRTC, tapped **Build from the top** (host revealed exactly one letter, target = word 2), typed `ship` (host field showed `ship`, "Typed on Ada's phone"), and **nothing was judged**: `solved[1] === false`, scores `[0,0]` |
| **T4 standalone host-only** | three chains + Speed Chain played with no phones at all: reveals, given words, correct/wrong, control indicator, interstitial, sudden death (forced with a one-chain game), all-six bonus `$1,000`, standings, undo at every stage |
| **T5 static gates** | below |

### Static gates

- **V1** `node --test` exits 0.
- **V2** every file < 800 lines (largest shipped file 585; largest file 744, a test).
- **V3** `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` /
  `eval(` / `new Function` — **zero matches** across the whole component,
  tests included.
- **V4** `console.log` — **zero**. (`console.warn` for diagnostics only.)
- **V5** no Peer / connection / DOM / timer handle in anything passed to
  `crSet` — the clock, the room and the phone connection all live in module
  scope, never in state (code read; `crSerialise` lists the six saved fields).
- **V6** the only external URLs on the page are Google Fonts.
- **V7** `<body data-gsc-game="chain-reaction">`, `#gsc-join` present,
  `player-mode` / `gsc-embedded` wired (and now used by CSS to hide the host
  chrome on a phone and the room controls when embedded).
- **V8** `?game=URL`, the file upload and the editor all go through
  `CrCore.validateGame` / `normalizeGame`.

### Layout and accessibility

- **1280×720 host, no vertical scroll in play**: `scrollHeight === 720` on
  chain, chain-complete, sudden death, Speed Chain and result.
- **1280×676 (the hub's game frame)**: `scrollHeight === 676` on all five.
  `scrollWidth === 1280` (no horizontal scroll).
- **Phone at 320×640**: `scrollWidth === 320`, no horizontal scroll; every
  button and input ≥ 56 px (measured 56 px for the guess field and Send,
  77 px for the two direction buttons).
- **Gradient-under-text contrast, both stops** (WCAG, computed):

  | Pair | stop A | stop B |
  | --- | --- | --- |
  | lit tile ink `#0a0d20` on white→`#f6f7ff` | 19.24 | 18.02 |
  | team-1 word `#05081f` on `#9fb6ff`→`#5f80ff` | 10.00 | 5.67 |
  | team-2 word `#24030f` on `#ffb4d6`→`#ff5fa2` | 11.65 | 6.77 |
  | `.btn-blue` white on `#3d63ff`→`#0f3bd9` | 4.74 | 7.93 |
  | phone card ink on its gradient | 15.15 | 18.72 |

  Solid pairs sampled from the live DOM (36 text nodes on the chain screen,
  the topbar and the interstitial) all clear 4.5:1 for body text; the only
  "failures" the sweep reported were the gradient-backed nodes above, which it
  cannot resolve and which are measured by hand here.
- Colour is never the only signal: the control indicator says "▶ in control" /
  "waiting", every row carries an `aria-label` ("3 of 5 letters showing" /
  "SHIP — solved"), the frontier rows are tagged "next from the top", the
  Speed Chain marks read "✓ got it" / "passed — comes back", and the standings
  mark the leader "◆ ahead".
- Every control is a `<button>`; the editor is `role="dialog"`; the notice,
  guess-source, standings and clock regions are live regions; hotkeys are
  ignored while typing.

## 8. Defects found and fixed during the build

1. **The phone crashed on its very first render** (major, found by the
   harness). The page starts with `view = {screen:"wait"}`, and the `wait`
   screen read `v.teams[v.team]` — a `TypeError` that was swallowed by
   `boot().catch`, so `GSC.player()` resolved but `CrPhone` was never
   published and the phone sat on "Waiting for the host…" for ever. Fixed with
   `teamName()` / `myName()` guards and an early return in `buildScores`.
2. **The first room bind wiped the host's team assignment** (major, found by
   the harness's reload scenario, and a genuine race in real play). The room
   resolves after boot, so `crBindRoom()` fired *after* the host had put phones
   on teams and pressed Start, and the "new room" rule cleared both. Fixed:
   binding when `roomCode === null` only records the code; only a *different*
   code clears. Pinned by a new harness check ("the teams keep the phones the
   host put on them"). This also means opening a room mid-game no longer wipes
   the game.
3. **`toSpeed{team:null}` chose team 0** because `Number(null) === 0`, so the
   Speed Chain could start on a tie with the wrong team. Fixed with a strict
   `team === 0 || team === 1` test; pinned by a unit test.
4. **Host chrome leaked onto the phone.** `body.player-mode` had no CSS, so a
   phone was rendering the hidden host screens' markup (and the page scrolled
   ~1700 px). Added `body.player-mode` / `body.gsc-embedded` rules.
5. **The rail overflowed 720 px** by ~100 px (podiums stacked, reveal buttons
   stacked). Podiums are now a two-up grid with tighter padding and the two
   reveal buttons share a row.
6. Smaller ones: the interstitial printed `200 a word` without the currency
   symbol; the editor's example copy used `SPACE SHIP SHAPE UP`, which is
   chain 1 of the shipped file, so a naive "does the phone DOM contain a hidden
   word" scan false-positived on it (changed to `JELLY BEAN BAG PIPE`, words
   that appear in no chain); the harness used `new PW("p1").Event(...)`, which
   `new` binds to the call, not the member.

## 9. Known limits (also in the README)

- **Peek is on the shared screen** — there is no second screen for the host.
- A phone that joins after Start is a spectator until the next game; the host
  puts phones on teams on the setup screen.
- The sudden-death winner is credited the last chain's value so the standings
  show a leader; the TV show simply awards the tiebreak.
- The Speed Chain uses `speedChains[(chains played − 1) % length]` and the
  rounds use the chains in file order — deterministic, so a host who plays two
  nights in a row from the same file sees the same chains unless they load a
  different file or reorder it. (Deliberate: it makes the tester's and the
  host's life predictable.)

## 10. For the orchestrator

- Registry entry and hub art are **not** in this component, as instructed.
  The registry row needs `id: "chain-reaction"`, path
  `games/chain-reaction/index.html`; the game reports `setTitle` ("Chain 2 of
  3", "Speed Chain", "Sudden death", "Standings") and `reportScores` (two team
  rows) to the shell.
- `shared/theme.css` already carries the canonical `chain-reaction` accent
  block (`--accent #ff2e88`, `--accent-2 #4d7bff`, `--accent-ink #2a0213`,
  `--stage-glow #10276e`) and the game inherits it with no local override —
  verified by the tester on the live page. Nothing further is needed here.
- `tests/core-prototype-guard.test.mjs` already carries the chain-reaction row
  and passes.

---

# Fixes after verification

Round two, against `docs/reports/chain-reaction-verification.md`
(verdict **fix-then-ship**). The tester had already fixed **CR-1** (the harness
cleared `localStorage` before unloading the old page, so `beforeunload` wrote
the finished game straight back and the run silently stopped at 29 of 52
checks) and **CR-3** (the giant clock jumped back to the round length at
"Time!"). Both of those are kept exactly as they left them. Everything below
is mine.

## CR-2 — the Speed Chain clock is frozen on save · **major** · fixed

The clock was an absolute `deadline` timestamp written verbatim to
`localStorage`, so it kept burning while the tab was closed: a reload cost the
team the time it was away, and a tab reopened after the round length had passed
came back to a Speed Chain that had already ended and paid out — with Undo
unable to recover, because the restored state re-expired on the next paint.

It now works the way Password, Pyramid and Weakest Link work: **the clock is
stored as time left, never as a deadline.**

| Where | What changed |
| --- | --- |
| `js/cr-core.js` | new `speed.remainingMs`, set to the whole round by `buildSpeed`. New pure helper `pauseSpeed(speed, now)` → `{started:false, deadline:null, remainingMs: max(0, deadline - now)}`, exported on `CrCore`. `evSpeedStart` starts **or resumes**: `deadline = now + remainingMs`. `finishSpeed` clears both. |
| `js/cr-core.js` | `withHistory(before, next, now)` snapshots a running clock **paused**, using the `now` of the event that caused it — so undo hands the round back with the time it actually had, and a stale deadline can never be restored live. `evUndo` pauses defensively as well, for saves written by the old build. |
| `js/cr-app.js` | `crSerialise()` freezes a running clock into the saved copy (the **live** state keeps running — a save never stops the host's clock). `crLoadSaved()` pauses anything that still comes back running, so a pre-fix save cannot expire on the first paint either. |
| `js/cr-app.js` | `crSpeedDeadline()` returns a deadline only while `started && !over`, so `speedExpired` structurally cannot fire on a restored round. `crSpeedSeconds()` shows the remaining time when paused (keeping the tester's CR-3 "0 at Time!" behaviour). |
| `js/cr-view.js` | the button reads **“Resume the clock (47s)”** instead of “Start the clock” when a save or an undo paused it. |
| `js/cr-select.js`, `js/cr-phone.js` | the phone view carries `remaining`, so a phone shows the paused time rather than the round length; a **disconnected** phone now freezes its clock instead of counting down against a deadline the host may already have paused. |

Measured on the live page (standalone, 1280×720):

- Mid-round with 57 s showing, the save on disk read
  `{started:false, deadline:null, remainingMs:57000}` while the on-screen clock
  kept running — the freeze is in the copy, not in the game.
- Reload mid-round → `phase speed`, `over:false`, scores unchanged, clock
  paused at 47 s, button **“Resume the clock (47s)”**, ✓/Pass disabled until
  the host restarts. Resuming gave 46 s, not 60.
- A hand-crafted **pre-fix** save (`started:true`, deadline five minutes in the
  past, no `remainingMs`), loaded under `?store=stale` so the live page could
  not overwrite it: restored `started:false`, `deadline:null`,
  `remainingMs:0`, `over:false`, scores unchanged — it did **not** fire
  `speedExpired`, and the host still decides what happens next.

Pinned by 6 new unit tests (`tests/cr-regression.test.mjs`) and 3 new harness
checks folded into C-I4 (reload mid-round → paused with the time it had; no
expiry on the first paint; Start resumes from the remainder, not the round).

## CR-4 — one night-scoreboard row per team member · **minor** · fixed

`js/cr-room.js` reported `pids[0]` for each team, so the hub's night board
showed the first phone's name instead of the team's and credited everyone else
on the team nothing. It now emits **one row per member**, each carrying the
team's score, with a `pid: null` row under the team's own name for a team with
no phones — the `family-feud` / `pyramid` convention, which `js/hub-night.js`
keys off the name. Verified live over a real PeerJS room:
`[{pid:"p1", name:"Ada", score:600}, {pid:null, name:"Team Pink", score:0}]`.

## CR-5 — the letter column is the centrepiece · **minor** · fixed

`--cr-tile` was 34 px at 720 and 30 px at 676, leaving ~285 px of empty stage
under a board that is the whole point of the format.

- `--cr-tile` 40 → **64 px** base, **58 px** under `max-height: 780px`,
  **51 px** under `max-height: 690px`; row gaps up accordingly.
- The rail narrows 22rem → **19rem**, the per-row tag column 9.5rem → 8rem, the
  row cap 44rem → 56rem, and the grid centres rather than top-aligns.
- Tile tracks are now `minmax(0, var(--cr-tile))` with `aspect-ratio: 1` and a
  `min()` font size, so a 12-letter word squeezes to fit instead of overflowing.
- The rail, not the column, sets the page height at 676, so that breakpoint
  also tightens the rail's gaps and drops its big buttons to 46 px (host
  buttons on a shared screen — the ≥ 56 px rule is a phone rule).

Measured: **1280×720** tiles 58 px, glyphs 36 px, column 506 px (was 300),
`scrollHeight === 720` on setup, chain, mid-turn, interstitial, sudden death,
Speed Chain and result. **1280×676** tiles 51 px, `scrollHeight === 676` on all
of the same. No horizontal scroll at either size.

## CR-6 — the tiebreak word is one nobody has seen · **minor** · fixed

`pickSudden` chose an unplayed *chain* but not an unseen *word*, so a tiebreak
could land on a word the teams had just solved; and with as many values as
chains it fell back to chain 1, which had definitely been played. It now
collects every word that has been on the board, searches the unplayed chains
first (from an rng-drawn offset) and then the played ones, and only falls back
to the first word drawn if literally every candidate has been seen.

The tester's two "KNOWN GAP" tests said *"if this now fails, pickSudden()
learned to avoid words already seen — update this test"*, so both were updated
in place to pin the fixed behaviour: A8 now asserts across seven rng values
that the word (and its clue) was never on the board, and A16 asserts the
no-spare-chain case still yields a real, blank, playable tiebreak. A new test
does the same across the shipped 18-chain file.

## CR-7 — double full stop · **nit** · fixed

`js/cr-app.js` strips a trailing full stop from the inner error before building
*"Could not load chains from …: "chains" is missing. Using the built-in set
instead."*

## Cross-cutting — `?store=NAME`

`crStoreSuffix()` (the `games/price-is-right` pattern) suffixes both keys —
`gsc-cr-state-v1-NAME` and `gsc-cr-draft-v1-NAME` — and is exported on
`CrApp.storeSuffix` for `cr-editor.js`. The harness now loads both frames with
`?store=harness` and clears the suffixed keys. Confirmed after a full harness
run: the only Chain Reaction keys written were `gsc-cr-state-v1-harness` and
`gsc-cr-draft-v1-harness`, and a real `gsc-cr-state-v1` sitting on the same
origin was untouched.

## Content — the two borderline pairs swapped

The tester flagged `LACE → CURTAIN` and `ANIMAL → CRACKER` as thin (both
singulars of phrases people say in the plural). Both chains were replaced
rather than patched, so every pair in them stands on its own:

| Chain | Was | Now |
| --- | --- | --- |
| 5 | `HORSE SHOE LACE CURTAIN CALL BACK FIRE PLACE` | `COLD SHOWER CURTAIN CALL BACK FIRE PLACE MAT` |
| 18 | `STOP WATCH DOG TAG TEAM SPIRIT ANIMAL CRACKER` | `STOP WATCH DOG TAG ALONG SIDE WALK OUT` |

That is cold shower · shower curtain · curtain call · callback · backfire ·
fireplace · placemat, and stopwatch · watchdog · dog tag · tag along ·
alongside · sidewalk · walkout. All 154 pairs in the file were re-read and are
now also **all distinct** — no pair appears in two chains. `js/data.js` was
regenerated from `chains.json`; the mirror test still passes.

## Test counts after this round

| Suite | Before | After |
| --- | --- | --- |
| `cd games/chain-reaction && node --test` | 119 | **126 / 126** |
| root `node --test` | 989 | **996 / 996** |
| `tests/harness.html` | 52 | **55 / 55** (`#summary.ok`, three consecutive runs) |

The seven new unit tests are `tests/cr-regression.test.mjs` (6 for CR-2, 1 for
CR-6 across the shipped file) — a new file because folding them into
`cr-core.test.mjs` pushed it to 861 lines, over the V2 gate. It is named in the
harness's `SOURCES`, so V2/V3/V4 cover it. The three new harness checks are the
CR-2 reload checks inside C-I4. The tester's two adversarial files are intact
apart from the two "KNOWN GAP" tests they explicitly asked to be updated when
the fix landed.

Static gates re-run after every change: largest file 744 lines
(`cr-core.test.mjs`), zero `innerHTML` / `document.write` / `eval` /
`new Function`, zero `console.log`, no local `body[data-gsc-game]` override,
every `@keyframes` and `animation:` still inside
`@media (prefers-reduced-motion: no-preference)`, phone targets ≥ 56 px with no
horizontal scroll at 320 px.

---

# Cross-cutting round (docs/19)

Round three: the game-lobby control, the in-repo set library, and the phone
column fix from `docs/19-cross-cutting-round.md` §3.

## §3 — the phone chain is a real tile grid · fixed

**The bug, exactly.** `css/cr-phone.css` gave every row `width: 100%` and
`grid-template-columns: repeat(n, minmax(0, 1fr))`. Each row therefore
stretched across the whole phone independently of its length, so `UP` became
two enormous tiles and `POISONING` nine small ones — the words read as
spaced-out fragments rather than one stacked board.

**The fix.** One tile size for the whole column, driven by the longest word:

- `js/cr-phone.js` writes `--cr-cols` (the longest `row.len`) onto
  `#cr-phone-column` on every render.
- `css/cr-phone.css` derives the tile from it —
  `--cr-ptile: min(30px, calc((100% - (cols - 1) * gap) / cols))` — and each
  row is `display: grid`, `grid-template-columns: repeat(n, 1fr)`, exactly
  `n` tiles wide, centred in a flex row. The column is `align-items: center`,
  so the rows stack down the middle like the show's board.
- Tiles keep `aspect-ratio: 1`; no letter-spacing anywhere.
- The two words in play now carry a dashed outline on the phone as well
  (`.row.is-eligible`), so the frontier reads without the host screen.

**Measured** in a phone frame emulated at 320 × 640 with a synthetic
12-letter chain (`THANKSGIVING`): `--cr-cols: 12`, every tile exactly
**20 px**, one row per word with 5/4/4/5/8/4/6/12 tiles, widest row 274 px in
a 274 px column, `scrollWidth === innerWidth === 320` — **no horizontal
scroll**. At the harness's own 240 px frames the tiles come out at 30 px
(the cap) and the spread across all 8 rows is 0 px.

## §1 — the Game lobby control · added

`⟲ Game lobby` (`btn-game-lobby`) sits in the toolbar between Sound and the
Chain editor and opens a `role="dialog"` confirm with three buttons.

| Control | What it does |
| --- | --- |
| **Keep this game** | `crApp.resumable = freezeClock(core)`, `core = null` → the setup screen returns with **Resume the game** and a line saying where the parked game stands ("A game is parked on chain 2, $300 to Team Blue and …"). |
| **Start over** | `core` and `resumable` both cleared. Teams, the phones on them, the loaded chains and the settings all stay. |
| **Cancel** | Nothing changes. Escape does the same. |

- Undo-safe by construction: the parked value is a whole core state, history
  included, so **Resume** restores it byte for byte (the harness compares an
  11-field snapshot before and after).
- The parked clock is **frozen** on the way in, so a Speed Chain parked with
  40 s left does not burn while the host is on the setup screen, and Resume
  offers "Resume the clock (40s)" rather than a deadline that already passed.
- `resumable` is persisted (and re-frozen) with the save, and validated by
  `crUsableCore` on the way back in.
- Hotkeys are disabled while the confirm is open.

Two real bugs were caught by the new checks and fixed before this shipped:
`crLobbyKeep` parked the *live* clock (only the localStorage copy was being
frozen), and `renderResume` only ran inside `renderSetup`, so the Resume
button kept its visible class after the game came back.

## §2 — the set library · added

- `index.html` loads `shared/library.js` and carries a `#cr-library`
  container under the setup screen's **Chains** block;
  `crMountLibrary()` mounts `GSCLibrary.mountPicker` with `gameDir: ""`,
  `validate: CrCore.validateGame` and an `onPick` that adopts the set through
  the same path as an upload (`source` becomes `set: Kids' night`).
- **Two themed sets** ship beside the default file, both written to the same
  bar as `chains.json` — 6 chains + 2 speed chains each, all 56 adjacent
  pairs per set re-read one by one, no pair repeated inside a set:

  | File | Set | Notes |
  | --- | --- | --- |
  | `sets/kids-night.json` | Kids' night | playground / bubble gum / birthday words; `revealOnWrong: true` so it moves faster with children |
  | `sets/out-and-about.json` | Out & about | roads, trails and campfires at `[200, 400, 600]` with a $2,000 all-six bonus |

- The **editor** gained **Download for the library**: it validates, saves
  `your-title.json` (slugged from the title) and prints the exact manifest
  line plus the path to commit to, in a selectable monospace block. Static
  hosting cannot write files, so this is the honest workflow and the README
  documents it.

## Tests

| Suite | Before | After |
| --- | --- | --- |
| `cd games/chain-reaction && node --test` | 126 | **130 / 130** |
| root `node --test` | 996 | **1243 / 1243** (other games landed in between; no regression from this round) |
| `tests/harness.html` | 55 | **81 / 81** (`#summary.ok`, repeated runs) |

The four new unit tests (in `tests/cr-regression.test.mjs`) cover X-2 from the
content side: the manifest parses through the shared module, every file it
names validates, normalises to the counts it advertises, plays end to end,
repeats no word inside a chain, and is not a copy of `chains.json`.

The 26 new harness checks are **X-1** (10: the control exists; the confirm;
Keep → setup + Resume; roster and chains survive; Resume restores the exact
state; Resume disappears; Start over keeps roster/chains/settings; Cancel;
from the Speed Chain; the parked clock is frozen and resumes paused),
**X-2** (6: the picker lists the manifest, previews it, loads a set through the
validator, the source note updates, the game plays with it, a missing manifest
hides the picker with a plain-English line), **X-3** (4: one download, a
slugged file name, a valid manifest line with the right shape, the commit
path, and the file passes the picker's validator) and **X-4** (4: one row per
word with a tile per letter, one tile size across the column, `--cr-cols` set
from the longest word, a real grid with no horizontal scroll). Two gate checks
were added for the new markup and for `sets/index.json` naming real, valid
files.

`tests/harness.html` reached 881 lines with all of that, over the V2 gate, so
its two generic pieces — the PASS/FAIL list and the architecture 00 §6 bridge
shell — moved to `tests/harness-kit.js` (141 lines, in `SOURCES`, so the gates
still cover it). The page is 796 lines. No game logic moved.

Static gates re-run: largest file 796, zero `innerHTML` / `document.write` /
`eval` / `new Function`, zero `console.log`, motion still inside
`prefers-reduced-motion: no-preference`, no local `body[data-gsc-game]`
override.
