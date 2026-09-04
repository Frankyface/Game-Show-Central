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
2. **A per-game accent block in `shared/theme.css`**, if you want the hub's
   shell bar and splash card to wear this game's colours:
   ```css
   [data-gsc-game="deal-or-no-deal"] {
     --accent: #f5c542; --accent-2: #c81d3a; --accent-ink: #2a0209;
     --stage-glow: #5a0a1a;
   }
   ```
   Until then the same values are declared in `css/dond.css` on
   `body[data-gsc-game="deal-or-no-deal"]`, so the game itself already looks
   right standalone and embedded. Adding the block above is additive — the
   game's own sheet loads later and declares the same values, so nothing
   changes visually either way.
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
