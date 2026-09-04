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
- `shared/theme.css` needs the accent block for `chain-reaction`. The game
  deliberately declares none. Suggested, matching spec §3 and checked for
  contrast: `--accent: #0f3bd9; --accent-2: #ff2e88; --accent-ink: #ffffff;
  --stage-glow: #16205e;` (white on `#0f3bd9` is 7.93:1). Until it lands the
  game falls back to the `:root` gold accent, which looks fine but is not the
  Chain Reaction palette.
- One row for `tests/core-prototype-guard.test.mjs` (snippet in §6).
