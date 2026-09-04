# Deal or No Deal — implementation report

Component: `deal-or-no-deal` · Spec: `docs/12-deal-or-no-deal-spec.md` · Owns
`games/deal-or-no-deal/**`. Built 2026-09-04 on Windows 11, Node v24.16.0,
Chromium (in-app browser), served from `python -m http.server 8693 --bind
127.0.0.1` at the repo root. Nothing outside `games/deal-or-no-deal/**` and this
report was touched; **the registry entry is still the orchestrator's to add**
(see §7). No `git commit` / `git push` was run.

---

## 1. Files

| File | Lines | What it is |
|---|---:|---|
| `index.html` | 281 | host screens + phone screens in one page, `<body data-gsc-game="deal-or-no-deal">`, `#gsc-join`, the `.gsc-splash` title card |
| `css/dond.css` | 618 | curtain-red stage, gold cases with a 3-D flip, the two-column amount board, the banker overlay, editor |
| `css/dond-phone.css` | 184 | phone controller (320–430 px portrait) |
| `js/dond-content.js` | 342 | **PURE** the JSON contract, the rng shuffle, nice-number rounding, bounded jitter, largest-remainder maths (UMD → `DondContent`) |
| `js/dond-core.js` | 729 | **PURE** the reducer, every selector, the masked phone views (UMD → `DondCore`, re-exports `DondContent`) |
| `js/data.js` | 73 | offline mirror of `board.json`; sets `globalThis.DOND_DEFAULT_BOARD` |
| `js/dond-view.js` | 377 | host rendering + the shared `$ / el / show / setText` helpers |
| `js/dond-app.js` | 533 | app state, persistence, content loading, buttons, hotkeys, sound cues, the splash |
| `js/dond-editor.js` | 281 | in-page board editor (Download / Use / Reset / Blank, draft auto-save) |
| `js/dond-room.js` | 226 | host side of the GSC SDK |
| `js/dond-phone.js` | 197 | phone controller |
| `js/dond-sound.js` | 127 | WebAudio cues, no audio files |
| `board.json` | 39 | the shipped 26-case US board |
| `tests/dond-core.test.mjs` | 747 | `node:test` suite, N-U1 … N-U10 (38 tests) |
| `tests/harness.html` | 719 | loopback harness, N-I1 … N-I6 (57 checks) |
| `tests/fixtures/harness-board.json` | 12 | a deterministic ten-case board, `jitter: 0` |
| `README.md` | 168 | hosting, rules, the banker's arithmetic, JSON schema table, phone features |

Largest file 747 lines (the test suite); largest shipped file 729
(`js/dond-core.js`). Everything is under the 800-line cap. No function exceeds
~45 lines; the two module IIFE wrappers are file wrappers, not functions.

## 2. The pure core

`dond-content.js` owns everything a board file means, `dond-core.js` owns
everything a game state means. Both are UMD (`module.exports` in Node,
`globalThis.DondContent` / `globalThis.DondCore` in the browser) and neither
touches the DOM, a timer, a network or `Math.random`.

**State** (spec §4, with three additions marked):

```js
{ phase, game, roster, contestants:[{pid,name,won,out,reason}], current,
  cases:[{n,amount,opened}], own, round, toOpen, offer, offers:[{round,offer,ev}],
  deal, swapped, lastOpened*, advice:{open,votes,chart,round}, request*,
  outcome*, notice, history }
```

`lastOpened` drives the flip-and-sting on exactly one case; `request` holds the
contestant phone's Deal / No Deal **intent** (spec §5 says the host confirms, so
the intent needs somewhere to live); `outcome` is the finished contestant's
result, the same shape Millionaire uses. All three are plain serialisable data.

**Phases** are `setup → seat → pick → round ⇄ offer → swap → reveal → result →
standings`. `round` with `toOpen === 0` is "the banker is about to call": the
host presses a button, nothing happens on a timer.

**Events**: `start`, `seat{pid}`, `pickCase{n}`, `openCase{n}`, `bankerOffer`
(rng), `deal`, `noDeal`, `adviceVote{pid,choice}`, `adviceClose`, `swap{yes}`,
`revealRest`, `revealOwn`, `nextContestant`, `finish`, `undo`, plus
`request{pid,choice}` / `clearRequest` for the phone intent. Illegal and unknown
events return the identical object; `reduce` never mutates its input (asserted
against a deep-frozen state).

**The offer** is `niceOffer(ev × factor[round] × (1 + jitter))` exactly as
specified — see §5 for the one documented guard.

## 3. Host UI

Screens: **Setup** (roster, phones, the two rule toggles, board summary,
🔊, Start) → **Who is playing** (a big gold button per waiting contestant, plus
the running standings) → **the play screen** (26 gold cases in a 7-wide grid, the
two-column amount board on the right, a `.gsc-banner` with the phase, the
contestant's own case in a gold chip and the round counter as a `.gsc-badge`) →
the **banker overlay** (a ringing phone, the offer at 52–104 px, the odds toggle,
the audience split, Deal / No deal / Undo) → **Swap** (two buttons in the play
controls) → **Reveal** (Open the next case / Open case N) → **Result** →
**Standings**.

- Opening a case flips it on the Y axis to reveal the amount and lands a sting
  380 ms in; the amount board strikes the row through and labels it "gone", so
  the signal is never colour alone.
- **The odds are host-only**: `Show the odds (host only)` reveals the board
  average and the offer as a percentage of it. It resets to hidden on every new
  offer, and it is never in any phone view.
- Undo is on every screen and steps back exactly one move. `B` calls the banker,
  `D` deals, `N` refuses, `Space` advances a reveal, `U` undoes.
- Sound: a gold chime on the pick, a click plus a bright or a heavy sting per
  case (relative to the median of what was still sealed), the two-tone banker
  ring, a fanfare on the deal and on the final case.

**Everything works with no phones at all.** Audience advice defaults off when no
phone is connected, so no empty vote bar appears.

## 4. Phones

`dond-room.js` maps three validated intents onto reducer events and pushes each
phone the one view `DondCore.phoneView` allows, de-duplicated per pid and
invalidated whenever a phone joins or reconnects (the cross-cutting defect from
`00-orchestrator-triage.md`). `dond-phone.js` renders `wait` / `pick` /
`decision` / `advice` / `result` and sends `{t:"pick",n}`,
`{t:"decision",choice}` and `{t:"advice",choice}`.

**The leak rule.** The amounts inside unopened cases exist only in
`state.cases`. `phoneView` never carries them, a sealed case's `label` is the
empty string, and — deliberately — **every money value a phone receives is a
pre-formatted string, never a number**, so a numeric scan of a phone payload can
never turn up a sealed amount. N-U10 asserts this across every phase of a full
game for four pids (three contestants and an unknown spectator), using a fixture
whose amounts can never coincide with an offer.

A phone decision is a *request*: the host screen shows "Ben says DEAL — press the
button to confirm" and the reducer refuses to act on it. The contestant is
excluded from their own audience; one phone is one vote; the split freezes when
the vote closes or when Deal / No Deal is pressed.

## 5. Deviations and judgement calls (please read)

1. **A nice-number guard.** The spec's bands (nearest 100 under 10k, nearest 1k
   under 100k, nearest 5k above) round anything under $50 to **zero**. A board
   played down to two pennies would get a $0 offer. `niceOffer` therefore falls
   back to cent precision when the banded rounding lands on zero. Every value at
   or above $50 follows the spec exactly. Documented in the README §3 and tested
   in N-U4.
2. **The offer is not monotonic.** It tracks the board, and the board collapses
   when a big case goes, so a later round can offer less than an earlier one
   even though the factor rose. That is the format, not a bug; the harness
   asserts the *formula* every round rather than a rising sequence.
3. **`request` / `clearRequest` added to the event list** (§2 above), because
   spec §5 requires the host to confirm a phone decision and the intent has to
   be somewhere the host screen can render it and undo can ignore.
4. **`revealOwn` also opens a lone survivor.** After the contestant's case
   opens, if exactly one other case is still sealed it opens too — a board can
   never end with a single mystery. With many cases still sealed (an early
   deal), the host may stop the ceremony whenever they like.
5. **Ending the night mid-board** banks the contestant at an offer they had
   already accepted, otherwise at nothing. There is no partial credit for a
   sealed case.
6. **`allowSwap` needs two cases.** If a custom schedule opens fewer than
   `cases − 2`, more than one case survives the last round and the swap is
   skipped rather than offered against several cases.
7. **Accent tokens live in `css/dond.css`**, on
   `body[data-gsc-game="deal-or-no-deal"]`, because `shared/theme.css` is not
   this component's file (see §7).
8. **The pure core is split in two** (`dond-content.js` + `dond-core.js`), the
   same accepted deviation Feud, Wheel, Weakest Link and Millionaire took;
   `DondCore` re-exports everything so the spec'd API is unchanged.

## 6. Testing done

| Tier | What was run | Result |
|---|---|---|
| **T1 unit** | `cd games/deal-or-no-deal && node --test` | **38 tests, 38 pass**, covering N-U1 … N-U10 |
| **T2 loopback** | `tests/harness.html` served from 127.0.0.1:8693, one embedded host + three embedded phones | **All 57 checks passed** (N-I1 … N-I6) |
| **T3 real network** | standalone host opened room `JJPQ` over the real PeerJS broker; a second tab joined at `?room=JJPQ&name=Ben` over real WebRTC | phone joined and became a contestant; picked its own case; opened all six cases of round 1; got the decision screen with the offer; tapped Deal → host showed the request banner and did **not** deal; host confirmed; as a non-contestant on the next board the same phone got the advice ballot and voted, and the host's split bar read "1 vote so far — 0 deal / 1 no deal". No console errors on either side. |
| **T4 standalone** | two contestants host-only on the shipped 26-case board at 1280×720 — Ada dealt at $24,000 in round 2 (would have won $75) and Ben went to the end, swapped, and took $10,000 | both flows clean; a mid-offer reload restored the phase, the board, the offer and the standings exactly |
| **T5 static gates** | greps + line counts + the harness's own gate scenario | all pass, see below |

Static gates: no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` /
`document.write` / `eval(` / `new Function` anywhere (only the comments that
name the rule, and the harness's own detector); no `console.log`; every file
under 800 lines; the only external URLs in the page are the two Google Fonts
hosts; `data-gsc-game="deal-or-no-deal"` and `#gsc-join` are both present;
`board.json` and `js/data.js` are byte-identical content and both validate;
every `@keyframes` and every `animation:` in both sheets sits inside
`@media (prefers-reduced-motion: no-preference)` (the harness parses the CSS to
prove it); at 320 px every phone target is ≥ 56 px and nothing scrolls
sideways; the host play screen fits 1280×720 with 94 px to spare and no scroll
in either axis.

The N-I5 scenario reloads the host frame mid-round and asserts the board, the
counter, the shuffled amounts and the already-banked contestants all come back,
and that every phone is pushed a fresh view afterwards.

## 7. What the orchestrator still has to do

1. **The registry entry** in `js/hub-registry.js` — id `deal-or-no-deal`, path
   `games/deal-or-no-deal/index.html`. Not touched by this agent.
2. ~~A per-game accent block in `shared/theme.css`.~~ **Done** — `shared/theme.css:139`
   now carries `[data-gsc-game="deal-or-no-deal"]` with `--accent #b5121b`,
   `--accent-2 #f2c14e`, `--accent-ink #ffffff`, `--stage-glow #4a0810`, and the
   game's local override has been deleted (§9, N-D5). Nothing further is needed.
3. Nothing else. `shared/**`, `js/**`, `css/**`, `index.html` and every other
   game are untouched.

## 8. Known issues (non-blocking)

- **A stale save survives a console `localStorage.clear()`** while the page is
  open, because the page writes its state back on `beforeunload` (the same
  resume behaviour every other game has). To get the shipped board back, use the
  editor's **Reset to shipped** → **Use in game**, or clear storage with the tab
  closed. Not a defect, but it surprised the implementer during testing, so it is
  worth knowing before a tester reports it.
- **A phone that joins mid-board** can advise immediately but cannot play until
  the next contestant; the host screen says so in a banner.
- **The would-have-won ceremony is one click per case.** After an early deal
  that is up to 19 clicks (or 19 presses of `Space`). A "reveal them all" button
  was left out on purpose — the slow reveal is the drama — but it is the obvious
  thing to add if a tester finds it tedious.
- The in-app browser could not deliver synthetic clicks while a 1280×720
  viewport was emulated, so the 1280×720 checks were made by measurement and
  by real DOM `click()` calls on the real buttons; every click-driven scenario
  was additionally run at the pane's own size, where synthetic clicks work.

---

## 9. Fixes after verification (2026-09-04)

Answering `docs/reports/deal-or-no-deal-verification.md` (verdict *fix-then-ship*).
The tester's own fixes for **N-D1** (the default round schedule is now validated
against the file's real case count), **N-D2** (`hasOwnProperty` on the handler
map) and **N-D4** (the board title is capped and ellipsised in the topbar) are
kept as they were. Everything below is this agent's work, again confined to
`games/deal-or-no-deal/**` and this report. No git.

### N-D3 (major) — audience advice is live again

The rule and the room were conflated: `dondSettingOn("audienceAdvice")` returned
`fromFile !== false && phoneCount > 0`, and `dondStart()` baked that into the
state, so a host who pressed **Start** before the phones had reported got a
board with advice off for its whole life.

- `js/dond-app.js` — `dondSettingOn` now returns the host toggle, then the file,
  then the default, and **never looks at `phoneCount`**. Whether the banker's
  call opens a ballot is a rule; whether anyone is here to answer it is not.
- `js/dond-core.js` — new event **`adviceOpen`**, legal only while an offer is on
  the table. It keeps the votes already cast and drops the frozen split, so a
  closed vote can be re-opened without losing anything.
- `js/dond-view.js` — `renderAdvice(app, state)` draws the panel when a phone is
  connected or a vote has been cast, and hides it for a host playing alone (the
  "no empty bar" concern the old rule was trying to serve, now solved where it
  belongs). The ballot is open in the state regardless, so a phone that arrives
  *after* the banker has called gets the ballot on **that** offer, not the next.
- `index.html` / `js/dond-app.js` — `#btn-advice-close` became
  **`#btn-advice-toggle`**: "Close the vote" ⇄ "Open the vote", with
  `aria-pressed`. It also lets the host put a board whose file switched advice
  off to the room anyway.

Live re-run of the tester's exact repro (real broker, room `N9J2`): host started
and reached an offer with `phoneCount 0` → `audienceAdvice true`,
`advice.open true`, panel hidden. "Eve" then joined mid-offer → the host banner
"Eve joined — they can advise now…" is now true: her phone showed
`{screen:"advice", offer:"$11,000"}` with both buttons, she voted, and the host
bar read "1 vote so far — 0 deal / 1 no deal."

This also removes the harness flake the tester saw (1 run in 5): the loopback
suite now passes **63/63 on three consecutive cold runs**.

### N-D5 (minor) — the shared accent map wins

Deleted the `body[data-gsc-game="deal-or-no-deal"]` block from `css/dond.css`
and left a comment in its place saying why. The game now resolves
`--accent #b5121b`, `--accent-2 #f2c14e`, `--accent-ink #ffffff`,
`--stage-glow #4a0810` from `shared/theme.css`, in agreement with the hub's
shell bar and splash. Verified live: `getComputedStyle(body)` on the game page
returns exactly those values, and the curtain/gold identity is untouched because
nothing in either sheet reads `var(--accent*)` — the game's colours are
`--case-gold` and the `--stage-*` block, both still local. §7 of this report and
the README's known-issues entry are updated accordingly. Gate added to the
harness: the sheet must contain no `--accent:` declaration **and** the body must
resolve to `#b5121b`.

### N-D6 / N-D7 (minors)

| Ref | Fix |
|---|---|
| N-D6 | `beforeunload` and `visibilitychange` now call `dondSaveOnExit()`, which skips the write when `gsc-dond-state-v1` has been deleted while the page was open. Clear-then-reload works; the README's known limits explain it and point at **Reset to shipped** / **Play again** as the tidy route. |
| N-D7a | `state.notice` is gone — from `createState`, from all fourteen handler writes, from `dond-view.js` and from `index.html`. It was never set to anything but `""`, and the spec's state list never had it. |
| N-D7b | `legalActions` probes `adviceVote` against every contestant who is not the current one, the same per-candidate treatment `seat`/`pickCase`/`openCase` already had. It now appears while the ballot is open and disappears when it closes or everyone has voted. |
| N-D7c | The contestant's phone disables its case grid when `toOpen === 0`; the sub-line already said the banker was about to call. |
| N-D7e | `dond-room.js` looks its `INTENTS` builder up with `hasOwnProperty` and checks it is a function, matching the core's N-D2 guard. |
| N-D7f | `btn-reveal-own` no longer builds the string "Open case null" when `own` is null. |

N-D7d (a spectator's empty `name` in `phoneView`) was left alone: it is not
rendered on any screen a spectator sees, and inventing a name for someone the
host has not seated would be worse than an empty string.

### Offer rounding under $50 (tester's D-1 caveat)

`niceOffer` no longer falls back to cent precision. Below $50 — where the spec's
bands round to zero — the offer is now the **nearest whole dollar, floored at one
cent**, so the banker never says "$3.15" and never says "$0". Every value at or
above $50 still follows the spec exactly. `js/dond-content.js`, the README §3 and
both pinning tests (`N-U4` and the tester's `A1 DEVIATION`, retitled) are
updated; the adversarial test now sweeps 0.5 → 50 and asserts every result is a
whole dollar or the one-cent floor.

### Tests and gates after the fixes

- `cd games/deal-or-no-deal && node --test` → **89 tests, 89 pass** (38 mine +
  46 the tester's + 5 new). Repo root → **751/751**.
- New file `tests/dond-advice.test.mjs` (142 lines) holds the five new cases —
  `adviceOpen` in and out of phase, close-and-re-open keeping votes, a board with
  advice off opened by hand, `adviceVote` in `legalActions` (including a
  "everything it names really changes the state" sweep), and the absence of
  `notice`. Split out only to keep `tests/dond-core.test.mjs` under the 800-line
  cap, the same reason the tester split theirs.
- `tests/harness.html` → **63/63**, three consecutive runs on
  `python -m http.server 8693`. Four checks added: the N-D3 regression, the
  in-play toggle closing and re-opening the ballot with votes intact, the phone's
  dead case grid at `toOpen === 0`, and the N-D5 accent gate. The static-gate
  scenario now also line-counts the tester's two adversarial files.
- Static gates re-run: largest shipped file `js/dond-core.js` 750, largest file
  overall `tests/harness.html` 761 — all under 800. No `innerHTML`/`eval`/
  `console.log`; three external URLs, all Google Fonts; `data-gsc-game` and
  `#gsc-join` present; host play screen still fits 1280×720 with no scroll in
  either axis (banker overlay card 328 px, centred).

### `?store=NAME` — the harness stays out of the host's save (cross-cutting)

A harness run wrote to the real `gsc-dond-state-v1` / `gsc-dond-draft-v1` on the
same origin, so it left its fixture board and its fixture contestants behind for
whoever opened the game next. `js/dond-app.js` now has `dondStoreSuffix()` —
`?store=NAME` (letters, digits and hyphens, capped at 24) suffixes the saved
night, and `js/dond-editor.js` builds its draft key from the same
`DondApp.storeSuffix()`. The pattern and the naming are copied from
`games/price-is-right/js/tpir-app.js`. The shared `gsc-sound` preference is
deliberately **not** namespaced: it belongs to the hub, not to this game
(architecture 00 §10).

`tests/harness.html` loads both frames with `store=harness`, so the whole run
lives in `gsc-dond-state-v1-harness` / `gsc-dond-draft-v1-harness`. A new gate
proves it: the harness writes a sentinel into the two real keys before anything
loads and asserts both still hold it at the end, and that the host frame's
`DondApp.STORAGE_KEY` really is the suffixed one.

`node --test` **89/89**; `tests/harness.html` **64/64** on two consecutive runs
on port 8693, leaving only the two `-harness` keys behind. A plain visit to
`games/deal-or-no-deal/` still reports `STORAGE_KEY: "gsc-dond-state-v1"` with
an empty suffix, so nothing changes for a real host.

---

## 10. Cross-cutting round (docs/19-cross-cutting-round.md, 2026-09-04)

### §3 — the case animation (the user-reported bug)

`renderCases` rebuilds the whole grid on every render, and the animation was
keyed on the **state** class `.is-open` (plus `.is-last`). Every freshly created
open case therefore re-ran its flip on every render: click one case and all the
open ones spun, and the whole grid spun again when the banker called, because
that render rebuilt the same nodes.

The animation is now a **one-shot class**. `css/dond.css` moved both keyframes
onto `.case.is-flipping` (the flip on `.case-inner`, the sting on the button, so
the two never fight over `transform`), and `js/dond-view.js` keeps a module-level
`flipped` — the case number whose flip has already been played. A case gets
`is-flipping` only when `state.lastOpened` differs from `flipped`, and the class
is removed on its own `animationend`. `flipped` starts as `undefined`, so the
first paint of a *restored* board seeds it without animating; `lastOpened` is
null on a fresh board, so the first case of the next contestant animates
normally. The banker's call leaves `lastOpened` untouched, so nothing animates.

Pinned by X-4 in the harness, exactly as the brief asks: after opening case 7
only case 7 carries the class, opening another case moves the class to that one
alone, and after the banker's call no case carries it.

### §1 — the `btn-game-lobby` toolbar control

`⟲ Game lobby` sits in the toolbar between Sound and Board editor and is enabled
in every phase (disabled on setup and in the editor, where there is nothing to
park). It opens a `.gsc-modal` confirm that names the phase and offers:

- **Keep this game** — the core state moves to a new `resumable` field, `core`
  becomes null, and the setup screen shows **Resume the game** plus a line
  saying who is parked and where. `resumable` is serialised alongside `core`,
  validated by the same `dondUsableCore` guard on load, and cleared by a new
  room whose phone seats it no longer matches — so a refresh still offers
  Resume, and a stale one is never offered.
- **Start over** — `core` and `resumable` both go; the roster, the board and the
  rules stay, so **Start the game** deals again immediately.
- **Cancel**, plus `Esc`. While the confirm is open it owns the keyboard, so
  `D`/`N`/`B` cannot fire behind it.

Loading any new content (file, `?game=`, editor, library) also drops a parked
game, because it was dealt from the old board.

### §2 — the board library

- `sets/index.json` plus two committed boards beyond the default: **Quick 16**
  (16 cases, rounds `5,4,2,1,1,1`, a whole game in about ten minutes) and
  **High rollers** (26 cases from $1,000 to $10,000,000 with a meaner banker,
  factors starting at 0.10 and jitter 0.08). Both pass `validateBoard` and
  produce no warnings; the manifest parses through `GSCLibrary.parseManifest`.
- `index.html` loads `shared/library.js` and carries `#dond-library` under *The
  board*; `dondMountLibrary()` mounts `GSCLibrary.mountPicker` there with the
  game's own `validateBoard` and an `onPick` that adopts the board with the
  source note `set: <name>`. The picker hides itself with a plain-English note
  when the manifest cannot be fetched, so a page opened from disk is fine.
- The editor's **Download for the library** validates the draft, downloads it
  under a slug of its title, and prints the two strings the workflow needs: the
  path to commit at and the exact manifest line (a real `JSON.stringify` of the
  entry, counts included) to paste into `sets/index.json`. Both downloads now
  share one `dondDownload(data, name)` helper.

### Tests and gates

- `cd games/deal-or-no-deal && node --test` → **89 tests, 89 pass** (unchanged;
  this round is UI and content, and the pure core did not move).
- `tests/harness.html` → **83 checks, all passing** on port 8693 — the previous
  64 plus 19 new ones covering X-1 (control present and live, confirm names the
  phase, Cancel is a no-op, Keep parks and saves, Resume restores byte-identical
  state, Start over keeps roster/board/rules, disabled on setup), X-2 (picker
  mounted, both sets listed, preview line, load-and-adopt with the source note,
  plus a broken manifest and a from-disk fetch each hiding the picker with a
  message), X-3 (the download validates, the path and a parseable manifest line
  are printed) and X-4 (the three animation assertions).
- The new scenarios live in `tests/harness-x.js` (173 lines), which
  `harness.html` loads and hands its own helpers; the split exists only to keep
  `harness.html` under the 800-line cap (it is 796). Largest shipped file is
  `js/dond-core.js` at 750.
- Static gates re-run clean: no `innerHTML`/`eval`/`console.log`, Google Fonts
  the only external URLs, `data-gsc-game` and `#gsc-join` present. The gate
  scenario's source list now also covers `harness-x.js` and the three `sets/`
  files.

