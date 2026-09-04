# Deal or No Deal — verification report

Independent tester for component `deal-or-no-deal`, verified against
`docs/12-deal-or-no-deal-spec.md` (rules and offer formula normative),
`docs/00-architecture.md`, `docs/design-system.md` and the cross-cutting
defects in `docs/reports/00-orchestrator-triage.md`. Reported in the format of
`docs/06-verification-plan.md` §5. No `git commit` / `git push` was run.
Nothing outside `games/deal-or-no-deal/**` and this file was touched.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 (`node --test`, zero deps) |
| Browser | Chromium (in-app Browser pane), real PeerJS broker + WebRTC |
| Server | `python -m http.server 8694 --bind 127.0.0.1` at the repo root |
| Date | 2026-09-04 |
| Code under test | `games/deal-or-no-deal/**` at `main` c4927d9 + the implementer's working tree |

Tests added by this tester:

- `games/deal-or-no-deal/tests/dond-adversarial.test.mjs` (732 lines, 30 tests) —
  A1–A9: the offer formula at every round at both jitter extremes, EV after each
  opening, Deal at the first and the last offer, No Deal to the end with and
  without the swap, `allowSwap:false`, advice from the contestant and after the
  close, opening the own case, opening past `toOpen`, reveal order, a second
  contestant's fresh shuffle, validator fuzz.
- `games/deal-or-no-deal/tests/dond-adversarial-state.test.mjs` (519 lines, 16 tests) —
  A10–A14: phone-message fuzz, immutability against a deep-frozen state,
  `Object.prototype` event names, undo in every phase, the structural leak probe,
  long-night selectors. **Split from the first file only to stay under the
  800-line house cap** (a single file would have been 1,251 lines).

`cd games/deal-or-no-deal && node --test` → **84 tests, 84 pass**
(38 the implementer wrote + 46 adversarial). Repo root `node --test` →
**739 tests, 739 pass**.

---

## 2. Success states

### Unit — N-U1 … N-U10 (`node --test`)

| ID | Result | Evidence |
|---|---|---|
| **N-U1** validator (rounds sum, distinct amounts, factors) | **PASS** (after fix N-D1) | `A9 the validator refuses boards the spec forbids` — 28 hostile boards, each with a plain-English message and no `undefined`/`[object` leak. `A9 exactly cases - 2 openings is allowed, and cases - 1 is not`. **Found N-D1 here: a board that omits `settings.rounds` was never checked against its own case count.** |
| **N-U2** shuffle deterministic under rng, always a permutation | **PASS** | `A8 the same rng deals the same board; a different seed deals a different one` — `lcg(11)` twice is identical, `lcg(999)` differs, and the multiset of amounts and the case numbers 1…10 are preserved in both. |
| **N-U3** round schedule and `toOpen` counters | **PASS** | `A6 opening more cases than toOpen is refused` — the 5th case of a 4-case round returns the identical object, `unopenedCases` stays 6, `bankerOffer` is the only legal move. `A1 …at every round` walks 4 rounds asserting `s.round` each time. |
| **N-U4** EV, offer formula, nice-number rounding, jitter bounds | **PASS** | `A1 the offer is niceOffer(EV x factor x (1 + jitter)) at every round` — selector, reducer and hand arithmetic agree at rng 0 / 0.5 / 1 for all four rounds. `A1 nice-number bands, including both edges` re-derives the spec's three bands independently (49.99→0, 50→100, 9949→9900, 9950→10000, 10499→10000, 10500→11000, 99499→99000, 99500→100000, 102499→100000, 102500→105000). `A1 the offer never leaves the +/- jitter band` with rng ∈ {−99, 0, .001, .25, .5, .75, .999, 1, 99, NaN, ±∞} and non-function rngs. `A2 EV is the mean of every sealed amount after each opening, own included`. Live: 9 offers on the shipped board, every one inside `niceOffer(ev·factor·[0.95,1.05])` — e.g. round 8, EV $2,700, factor 1.0, offer $2,600. **Deviation D-1 below.** |
| **N-U5** Deal ends the game and records the offer | **PASS** | `A3 Deal at round 1 …` (`openCase`/`bankerOffer`/`noDeal`/`pickCase`/`swap` all return the identical object afterwards; `outcome.won === offer`, contestant `out`), `A3 Deal at the LAST offer still ends the board on the offer` (skips the swap, `swapped:false`). |
| **N-U6** swap only with two left and only when allowed | **PASS** | `A4 No Deal all the way, swapping, pays what is in the OTHER case`; `A4 the swap is refused everywhere except the swap phase`; `A4 allowSwap:false goes straight to the reveal`; `A4 a schedule that leaves more than two cases skips the swap` (3 others sealed → `swap` is dead, and `warningsFor` warns). |
| **N-U7** advice excludes the contestant and closes | **PASS** | `A5 the contestant may never advise themselves`, `A5 a closed vote takes no more votes and keeps its frozen split` (chart frozen `[100,0]`, a later vote returns the identical object), `A5 rubbish votes and votes outside an offer are refused` (10 bad choices × 6 bad pids), `A5 audienceAdvice:false never opens a vote at all`. An empty vote reports `[0,0]`, not a fake 50/50. |
| **N-U8** would-have-won reveal order | **PASS** | `A7 the would-have-won reveal opens the others in case order, then theirs` — `revealRest` always opens the case `revealOrder` promised, ascending, the own case last; `A7 revealOwn on its own opens a lone survivor with it`. |
| **N-U9** undo / illegal events / immutability | **PASS** (after fix N-D2) | `A11 no event mutates a deep-frozen state, in any phase` — 11 phases × 25 events, `Object.freeze` deep, JSON identical before and after. `A12 undo steps back exactly one move through a whole game` walks a full game forwards recording every history-making step, then undoes all the way back to `setup` and deep-compares each restored state. `A12 undo brings a banked contestant back into play`, `A12 undo after finish reopens the night`, `A12 the history never grows past MAX_HISTORY`. **Found N-D2 here: `{type:"toString"}` returned a corrupted state and `{type:"valueOf"}` threw out of the pure core.** |
| **N-U10** `phoneView` never contains an unopened amount | **PASS** | `A13 no phone view carries a sealed amount, in any phase, for any pid` — a *structural* probe that replaces every sealed amount with a unique sentinel before `phoneView` runs, then scans every number and every string in the result; run for 8 pids (including `""`, `null`, `undefined`, `"__proto__"`) across all 9 phases. `A13 the same leak probe holds on the shipped 26-case board` — works even where a nice offer can collide with a real case amount, which the implementer's fixture-based test cannot. Live: `phoneView` for the contestant during a round returned 26 cases with `label:""` on every sealed one. |

### Loopback — N-I1 … N-I6 (`tests/harness.html`, served from 127.0.0.1:8694)

| ID | Result | Evidence |
|---|---|---|
| **N-I1** phone case picks | **PASS** | `#summary.ok` — "All 57 checks passed." (4 clean runs) |
| **N-I2** offer reveal + audience split from two phones | **PASS**, 1 intermittent | 57/57 on 4 of 5 runs. One cold-cache run stopped at 15 checks: `FAIL N-I2 the contestant is asked, the room is polled, and both see the offer — p2 sees wait`, then `uncaught: Cannot read properties of undefined (reading 'click')`. Root cause is **N-D3** (see §3), not the harness. Reproduced with the fix stashed and unstashed — unrelated to any tester change. |
| **N-I3** Deal flow with the remaining reveal | **PASS** | 57/57 |
| **N-I4** swap | **PASS** | 57/57 |
| **N-I5** reload mid-round | **PASS** | 57/57 |
| **N-I6** editor round-trip + gates | **PASS** | 57/57, including the harness's own `innerHTML`/`eval` detector and its `prefers-reduced-motion` CSS parse |

### T3 — real network, hub + two phone tabs

Room **7CMD** opened on the real PeerJS broker from `http://127.0.0.1:8694/`;
two phones joined over real WebRTC (`?room=7CMD`, pids `p1`/`p2`). Not blocked.

| Check | Result | Evidence |
|---|---|---|
| Contestant picks cases from the phone | **PASS** | Ada tapped case 12 → host `own:12`, `#dond-own-number` = "12", host grid button `is-own` + `disabled`; then six taps opened six cases, host counter tracking each. |
| Deal intent held until the host confirms | **PASS** | Ada tapped Deal → host `phase:"offer"`, `deal:null`, `request:{pid:"p1",choice:"deal"}`, banner "Ada says DEAL — press the button to confirm." Only after the host pressed **Deal** did `phase` become `reveal` with `deal:{offer:18000,round:0}` and `request:null`. |
| The other phone votes advice, split updates live | **PASS** | Ben tapped "No deal!" → host within one round trip: `votes:{p2:"no"}`, `dond-advice-count` = "1 vote so far — 0 deal / 1 no deal.", labels "Deal 0%" / "No deal 100%", bar widths 0% / 100%. Closing froze it: `chart:[0,100]`, "Vote closed: …". |
| Contestant's phone shows no advice ballot | **PASS** | Ada's view was `{screen:"decision", offer:"$18,000", asked:null}` with no `myVote` key at all; the full serialised view contained no `votes`. Ben's view had `myVote` but no `votes` key either. |
| Phone reload mid-round | **PASS** | Reloaded Ada's phone mid-round; on rejoin (pid `p1`) the host's de-dup cache was invalidated and the phone received a fresh, correct view: `own:12`, `toOpen:3`, three labelled opened cases, 22 sealed with `label:""`. |
| `⌂ Lobby` and back | **PASS** | Leave dialog → lobby (scoreboard visible) → re-launched the tile: `resumedPhase:"result"`, `outcome.won:18000`, standings intact, `phoneCount:2`, `roomCode:"7CMD"`, no "game was cleared" message. |
| Late joiner | **PASS** | A third phone (Cleo, pid `p3`) joined mid-board: host banner "Cleo joined — they can advise now and play from the next board", phone rendered "You're watching / Ben is at the cases" immediately (no "Connecting…" stall), and at the next offer it got the ballot and voted (`votes:{p3:"deal"}`). |
| Night scoreboard receives winnings | **PASS** | After Ada's deal the hub lobby showed "TONIGHT'S SCOREBOARD … Ada 18000". (Cosmetic note O-1 below.) |

### T4 — standalone, two contestants, host only

**PASS.** 1280×720, no phones, shipped 26-case board.

- **Ada — Deal.** Picked case 7; opened 6; banker offered $16,000 (EV $135,851, factor 0.12, `12% of it` on the host-only odds toggle); No Deal; opened 5; banker $29,000; Deal. Revealed 14 cases with `Space`, then her case: **$29,000 won, case 7 held $1,000,000** — "Case 7 held $1,000,000 — the banker won this one."
- **Ben — No Deal + swap.** Picked case 26; played all 9 rounds (offers $17,000 / $16,000 / $2,900 / $5,500 / $8,500 / $4,100 / $1,100 / $1,500 / $2,600, every one inside the ±5 % band for its factor); swapped case 26 → 25 at the end and **won $5,000** (case 26 held $400). "Swapped into case 25 at the last moment — and it held $5,000."
- **Reload at every phase** — `seat`, `pick`, mid-`round` (3 of 6 open), mid-`offer`, mid-`reveal`, `swap`: every one restored the phase, the shuffle, `own`, the counter, the struck-through board and the standings. The host-only odds correctly reset to hidden after a mid-offer reload.
- **Undo repeatedly** — 4 undos from mid-round back to `pick`; the shuffle was byte-identical (undoing a pick does **not** reshuffle). Hotkey `U` undid a banker call back to `round`/`toOpen 0`.
- **Hotkeys** `B` / `D` / `N` / `U` / `Space` all worked and were suppressed while typing.
- **EV toggle host-only** — "Board average $135,851 — the offer is 12% of it.", `aria-pressed` tracked, and `JSON.stringify(phoneView(...))` never contained the EV.
- **Editor** — Download JSON produced a 724-byte `application/json` blob that re-parsed, re-validated and round-tripped byte-for-byte against the draft; a 9-amount draft made Download **and** Use refuse with `"settings.amounts" needs between 10 and 30 amounts (this file has 9)`; `rounds` summing to cases−1, `jitter 0.5` and a bad factor each produced their own plain message; a valid 12-case board went in via **Use in game**.
- **Bad JSON via the file input** — not-JSON, empty, `[1,2,3]`, an HTML page and duplicate amounts were each refused with `"That file is not a usable Deal or No Deal board: …"`, the previous board was kept, and the input was cleared each time. A good file loaded.
- **`?game=URL` vs a save** — with a game in progress, `?game=tests/fixtures/harness-board.json` won: board swapped, `core` cleared, "Loaded the board from the link, so the game in progress was cleared." Reloading the *same* URL kept the game. A 404 URL fell back to `board.json` with "Could not load a board from does-not-exist.json: the server answered 404. Using the built-in one instead." and did **not** eat the game in progress.
- **Fits 1280×720 with no scroll** — `scrollWidth 1280 / scrollHeight 720` on setup, seat, play, banker overlay, swap, reveal, result and standings. (Except with a hostile title — defect N-D4, fixed.)

---

## 3. Defects

### Fixed by the tester (all trivial, < 5 lines each)

#### N-D1 — **critical** · a board without `settings.rounds` validates and then deadlocks

`games/deal-or-no-deal/js/dond-content.js:148`

```js
const rounds = s.rounds === undefined ? DEFAULT_ROUNDS.slice() : validateRounds(s.rounds, amounts.length);
```

`settings.rounds` is optional in spec 12 §2. When it is omitted the default
`[6,5,4,3,2,1,1,1,1]` (24 openings) was substituted **without** being checked
against the file's own case count. A board with 10–25 amounts and no `rounds`
key therefore passed `validateBoard`, produced no warning from `warningsFor`,
started, and then **wedged mid-play**.

Repro (before the fix):

```
$ node -e 'const C=require("./js/dond-core.js");
  const b={settings:{amounts:[1,7,53,411,3017,9973,40009,150011,640007,990013]}};
  C.validateBoard(b) // -> true, warningsFor(b) -> []'
… start, seat, pickCase 1, open round 1 (6 cases), bankerOffer, noDeal
  -> phase "round", round 1, toOpen 5, otherCases 0
  -> legalActions == ["finish","undo"]     // the banker can never call again
```

The host's only escape is Undo or End the night; the contestant banks nothing.

**Fix applied** (1 statement):

```js
    // The DEFAULT schedule must be checked against THIS board's case count too:
    // a file with ten amounts and no `rounds` key would otherwise validate and
    // then deadlock mid-play with more cases to open than exist (tester fix).
    const rounds = validateRounds(s.rounds === undefined ? DEFAULT_ROUNDS : s.rounds, amounts.length);
```

Such a file is now refused up front with the existing message: *"The rounds open
24 cases but only 8 may be opened with 10 cases — two must stay closed."*
Two of the implementer's own fixtures had baked in the old behaviour and were
adjusted to name a schedule (`tests/dond-core.test.mjs:144` and `:167`, 4 lines);
the assertion that `normalizeBoard` fills `DEFAULT_ROUNDS` now runs against
`normalizeBoard({})`, where it is true.

> **Orchestrator: this is a design fork.** Refusing the file is the minimal safe
> behaviour. The nicer option — symmetric with the existing `factorsFor(rounds)`
> — is a `roundsFor(cases)` that *derives* a schedule for any case count so an
> amounts-only file just plays. That is more than 5 lines, so it is the
> implementer's call; the guard should stay either way.

`A9 a board that is only defaults still validates and normalises` now also
sweeps 5 board shapes and asserts none of them can reach a state whose
`legalActions` is only `["finish","undo"]`.

#### N-D2 — **major** · an event named after an `Object.prototype` member corrupts or throws

`games/deal-or-no-deal/js/dond-core.js:381` (was `const handler = HANDLERS[event.type];`)

A bare lookup on an object literal finds inherited members, and the reducer then
**called** them. This breaks N-U9 ("unknown and illegal events return the very
same object") and the house rule that the pure core never throws.

```
$ node -e '…const s=Core.createState({},[{pid:"p1",name:"Ada"}],{});…'
toString              identical: false | keys: 0,1,2,3,4,5   (phase: undefined)
valueOf               THREW: TypeError Cannot convert undefined or null to object
hasOwnProperty        THREW: TypeError …
__defineGetter__      THREW: TypeError …
propertyIsEnumerable  THREW: TypeError …
```

`{type:"toString"}` returned `Object.assign({}, "[object Undefined]", {history})` —
a state object whose keys are the characters of that string and whose `phase` is
`undefined` — and that object was then persisted to `localStorage`.

**Not reachable from a phone**: `validatePhoneMsg` narrows `t` to
`pick`/`decision`/`advice` and `dond-room.js` maps those to fixed event types.
It is reachable from a harness, a hand-edited save, or any future caller.

**Fix applied** (2 statements) — identical to the fix the Price Is Right tester
made in `games/price-is-right/js/tpir-core.js`, so this is **cross-cutting**:

```js
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, event.type)
      ? HANDLERS[event.type] : null;
```

New regression test `A11 an event named after an Object.prototype member is just
unknown` — 12 poison names × 3 phases; it fails on the unpatched file and passes
on the patched one.

#### N-D4 — **minor** · a long board title pushes the host screen sideways

`games/deal-or-no-deal/js/dond-view.js:355` and `css/dond.css` `.topbar-title`

`validateBoard` accepts any-length `title`; `normalizeBoard` caps it at 80, but
`renderChrome` painted the **raw** file's title. Uploading a board with a
400-character title gave `scrollWidth 4210` at a 1280 viewport (topbar 112 px
tall, page scrolling horizontally). Even a validator-legal 80-character title
overflowed (`scrollWidth 1470`).

**Fix applied** (1 JS line + 4 CSS declarations):

```js
    setText("dond-title", core().cleanText(app.game && app.game.title, 80) || "Deal or No Deal");
```

```css
.topbar-title { … min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
```

After: 400-char title → `titleLen 80`, `scrollWidth 1280`, no overflow.

### Back to the implementer

#### N-D3 — **major** · audience advice is frozen off at Start, so phones that join later never get a ballot

`games/deal-or-no-deal/js/dond-app.js:262` (read at `:280`)

```js
  if (key === "audienceAdvice") return fromFile !== false && dondApp.phoneCount > 0;
```

`dondStart()` bakes this into the state via `createState(dondEffectiveBoard(), …)`.
If the host presses **Start the game** while `phoneCount === 0`, `audienceAdvice`
is `false` for that whole contestant's board and there is no in-play way to turn
it on (the checkbox lives on the setup screen only). Spec 12 §1.6 says advice is
"on by default when phones are present"; the host's own banner promises it.

**Live repro (real network, room 7CMD):**

1. Both phones leave → host setup shows "No phones yet…", `dond-advice` unchecked.
2. Host adds "Dee", presses **Start the game**, seats Dee.
3. A phone joins → host banner: **"Eve joined — they can advise now and play from the next board."**
4. Host opens the round and calls the banker: `offer 17000`, `advice.open false`,
   `#dond-advice-box` hidden.
5. Eve's phone: `{screen:"wait", sub:"The banker offered $17,000."}`, **0 choice
   buttons** — no ballot, for the rest of the board. The host banner is a lie.

This is also what made the T2 harness fail intermittently (1 run in 5): on a slow
cold load the harness clicked Start before the shell had reported the phones, so
`p2` got `screen:"wait"` at the offer and `phoneChoice("p2","deal")` was
`undefined`. A flaky harness will keep costing reviewers time.

**Recoverable** by the host: ticking "Phones advise Deal / No Deal" before Start
forces it on (verified — `override:true`, `settings.audienceAdvice:true`,
`advice.open:true`), so this is major, not critical.

**Proposed fix** (implementer's call, > 5 lines): stop conflating *the rule* with
*whether anyone is here to use it*. Let `dondSettingOn("audienceAdvice")` return
the file/toggle value only, so the vote always opens when the board says it
should, and move the "don't show an empty bar" concern into `renderAdvice`
(`show(box, wanted && (phoneCount > 0 || chart.total > 0))`). The reducer already
copes with a vote nobody answers (`adviceChart` reports `[0,0]`, source `null`).

#### N-D5 — **minor** · the game's local accent override disagrees with the hub shell bar and splash

`games/deal-or-no-deal/css/dond.css:25-33`

`docs/design-system.md` §1.3 is explicit: the per-game accent map "lives in
`shared/theme.css`" and you should "set your own accents by editing that block
in `shared/theme.css`, **not** in your game's `:root`". `shared/theme.css:139`
now carries that block for this game, but `css/dond.css` still declares its own
on `body[data-gsc-game="deal-or-no-deal"]`, which is one specificity point
higher *and* loads later.

Measured live in the hub with the game embedded (room 7CMD):

| Node | `--accent` | `--accent-2` | `--accent-ink` | `--stage-glow` |
|---|---|---|---|---|
| `#shell-bar` (hub chrome) | `#b5121b` red | `#f2c14e` gold | `#ffffff` | `#4a0810` |
| `.gsc-splash` (game-switch card) | `#b5121b` red | `#f2c14e` gold | `#ffffff` | `#4a0810` |
| game iframe `<body>` | `#f5c542` **gold** | `#c81d3a` **red** | `#2a0209` | `#5a0a1a` |

Accent and accent-2 are effectively swapped and the ink flips white ↔ near-black,
so the hub bar and splash wrapping the game do not match the `.gsc-badge`,
`.gsc-banner`, `.gsc-btn-primary` and splash *inside* it.

**Recommended fix: delete the local override** — `css/dond.css` lines 25–33
(the comment and the `body[data-gsc-game="deal-or-no-deal"]` block). This is
safe: neither `css/dond.css` nor `css/dond-phone.css` uses `var(--accent*)` at
all (`grep -c "var(--accent" → 0, 0`), so the game's own identity — the curtain
red, `--case-gold`, the blue/orange amount board — is untouched; only the shared
`.gsc-*` components change, and they change *into agreement with the hub*. Not
applied here because it is a 9-line deletion and a visible palette decision.

> **Cross-cutting:** `games/price-is-right/css/tpir.css:31` and
> `games/pyramid/css/pyr.css:32` have the same shape of override
> (Price Is Right's is also a swap of `--accent`/`--accent-2` against
> `shared/theme.css`; Pyramid's differs only in `--stage-glow`). Worth one sweep.

#### N-D6 — **minor** · a saved game cannot be cleared from outside the page

`games/deal-or-no-deal/js/dond-app.js:418` (`window.addEventListener("beforeunload", dondSave)`)

The implementation report lists this as a known issue; it is slightly worse than
described. `localStorage.removeItem("gsc-dond-state-v1")` followed by a reload
does **not** clear it, because the page rewrites the key on its own unload. The
only remedies are the editor's Reset → Use in game, or clearing storage with the
tab shut. It cost this tester two cycles before the cause was obvious; it will
cost a host the same. Cheapest improvement: skip the `beforeunload` write when
`app.core === null`, or read `localStorage` once more at unload and skip if the
key has been deleted.

#### N-D7 — **minor** · cosmetic and contract nits

| # | Where | What |
|---|---|---|
| a | `dond-core.js:112` | `state.notice` is initialised, cleared by every handler and rendered (`dond-view.js:128`) but **never set to anything**. Dead field — either populate it or drop it. |
| b | `dond-core.js:352` | `legalActions` probes `adviceVote` with `pid:null`, which `evAdviceVote` always rejects, so `adviceVote` never appears in the list even while the vote is open (`pickCase`/`openCase`/`seat` get the per-candidate treatment, this one does not). Harmless today — only `undo` is read — but the selector's contract says otherwise. |
| c | `dond-phone.js:32` | During a round with `toOpen === 0` the contestant's phone still renders enabled case buttons; the reducer silently refuses the tap. Disable them when `toOpen === 0` (the sub-line already says the banker is about to call). |
| d | `dond-core.js:624` | `phoneView(state, pid).name` is `""` for a spectator who is not on the roster (a late joiner). Not displayed on the `wait`/`advice` screens, so invisible today. |
| e | `dond-room.js:69` | `INTENTS[msg.t]` is the same bare-lookup pattern as N-D2. Unreachable because `validatePhoneMsg` narrows `t` first, but worth the same `hasOwnProperty` guard for consistency. |
| f | `dond-view.js:213` | `btn-reveal-own` is given the text `Open case ${state.own}` in every phase; when `own` is `null` that is "Open case null". The button is hidden then, so it never shows. |

### Deviations judged

**D-1 — offers under $50 keep cent precision instead of rounding to zero. ACCEPTED, with a caveat.**

Spec 12 §1.3 gives three bands and no floor, so `niceOffer(49.99)` is $0 by a
strict reading; `dond-content.js:296-304` falls back to cent precision instead.
The implementer's reasoning is right — a board played down to two pennies would
otherwise get a $0 offer, which is not a game — and the guard is narrow: every
value at or above $50 follows the spec exactly, verified band-edge by band-edge
in `A1 nice-number bands` (50→100, 9949→9900, 9950→10000, 10499→10000,
10500→11000, 99499→99000, 99500→100000, 102499→100000, 102500→105000). It is
documented in the README and in `js/dond-content.js`, and it is pinned by
`A1 DEVIATION: offers the spec would round to zero keep cent precision` so it
cannot drift silently.

The caveat is cosmetic: the fallback is `Math.round(raw*100)/100`, so the banker
can say "$0.38" or "$3.15" out loud — not a "nice" number in any sense the spec
would recognise. On a penny board (`amounts` all under $50) that is the *only*
offer shape the host will ever read out. If the orchestrator wants the guard to
stay in the spirit of the rule, round to the nearest dollar with a floor of one
cent instead. Not blocking, and the affected boards are exotic.

**D-2 — the offer is not monotonic. ACCEPTED**; that is the format, and A1 asserts
the formula per round rather than a rising sequence. Live run: $17,000 → $16,000 →
$2,900 → $5,500 → $8,500 → $4,100 → $1,100 → $1,500 → $2,600 as the board
collapsed and recovered.

**D-3 `request`/`clearRequest` added, D-4 `revealOwn` opens a lone survivor,
D-5 ending mid-board banks an accepted offer, D-6 `allowSwap` needs exactly two,
D-8 the core split in two. ALL ACCEPTED** — each is required by, or consistent
with, spec §5 and the accepted deviations already recorded in the triage; all
are covered by tests (A5, A7, A12, A4, and the file-size gate respectively).

**D-7 accent tokens in `css/dond.css`. REJECTED** — see N-D5; `shared/theme.css`
now carries the block, so the local one is a live conflict rather than a
placeholder.

---

## 4. Static gates and security read

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | **PASS** | 84 tests, 84 pass in the component; 739/739 at the repo root |
| **V2** every file < 800 lines | **PASS** | largest shipped `js/dond-core.js` 733, `css/dond.css` 623, `index.html` 281; largest test `tests/dond-core.test.mjs` 748, mine 732 / 519. No function over ~50 lines without a justification comment (read). |
| **V3** no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` | **PASS** | Only the two comments that name the rule and the harness's own detector. Every node is built with `document.createElement` / `textContent` / `replaceChildren`. |
| **V4** no `console.log` | **PASS** | zero matches across the component; `console.warn` used for diagnostics only |
| **V5** no Peer/connection/DOM/timer handle in state | **PASS** | Every `dondSet` payload (10 call sites) is plain data. `dondSerialise` persists only `core / game / setup / source / sourceKind / sourceUrl / roomCode`; `editorOpen`, `evShown`, `phoneCount` are deliberately not persisted. `room`, `lastSent` and `dondSplashTimer` are module-locals in the glue, never in state. The core takes `rng` per call and stores nothing random. |
| **V6** external URLs | **PASS** | exactly three, all Google Fonts (`fonts.googleapis.com` ×2, `fonts.gstatic.com`). PeerJS comes from `shared/`. |
| **V7** `<body data-gsc-game>`, `#gsc-join`, `player-mode` / `gsc-embedded` | **PASS** | `index.html:15`, `index.html:207`, toggled in `dond-app.js:485-486`. Live: the hub launched `?embed=host&room=7CMD` and the phones `?embed=player&room=7CMD&pid=p1&name=Ada`. |
| **V8** `?game=URL` and file upload validate through the same `validateGame` | **PASS** | both go through `dondUseBoard`/`dondFetchBoard` → `DondCore.validateBoard` (`= validateGame`). Verified live with 6 hostile files and a 404 URL (§2 T4). |

**Security read.**

- **Validation before state.** `dond-room.js:81` runs `core().validatePhoneMsg(raw)`
  first and returns on `null`; the narrow copy carries only `{t,n}` or
  `{t,choice}`, so extra fields on a hostile frame (`pid`, `admin`, `offer`,
  `cases`) never reach the reducer — asserted in `A10 validatePhoneMsg accepts
  three shapes and narrows them`. 40 hostile frames, including a JSON
  `__proto__` payload, all return `null` without throwing, and `{}.polluted`
  stays `undefined`.
- **Contestant-only picks and decisions.** `INTENTS.pick` refuses anyone but
  `state.current` (`dond-room.js:71`), and the reducer checks again:
  `evPickCase`/`evOpenCase` are phase-gated and refuse the own case;
  `evRequest` requires `pid === state.current`; `evAdviceVote` refuses
  `state.current` and refuses a second vote from the same pid. A phone can never
  deal — `evRequest` only writes `state.request`, verified live (§2 T3).
  `validatePhoneMsg` caps `n` at the global `MAX_CASES` 30, and a `pick` for
  case 26 on a 10-case board is still refused by `caseByN` (`A10`).
- **No unopened amounts in any view.** The structural sentinel probe (N-U10)
  proves it for every phase and every pid on two boards. Every money value in a
  phone payload is a pre-formatted string, so a numeric scan of a payload can
  never turn up a sealed amount. The host-only odds are computed in
  `dond-view.js:renderEv` and never enter `phoneView`.
- **`textContent` only** — see V3.
- One rough edge: `evAdviceVote` and `evRequest` accept any `pid` string
  (spectators may advise, which is intended), and votes are keyed by pid in a
  plain object. `Object.prototype.hasOwnProperty.call` is used for the
  duplicate-vote check, so a pid of `"__proto__"` cannot poison the tally
  (`A13` runs `phoneView` for that pid; `A5` votes with junk pids).

## 5. Design and accessibility

| Check | Result | Evidence |
|---|---|---|
| Amount board readable at 1280×720 | **PASS** | 26 rows in two columns, 26 px rows, labels 15.2 px bold. Live values on the blue gradient `#17325e → #2f6fd0` (white ≈ 4.8:1 at the light stop) and the orange `#8a2408 → #e4572e`; the widest label (`$1,000,000`) ends at 59 % of the row, where the gradient is ≈ `#bf421e` and white is ≈ 5.2:1. Text never reaches the light end of the orange (3.7:1). Whole play screen `scrollWidth 1280 / scrollHeight 720`. |
| Phone at 320×640, targets ≥ 56 px | **PASS** | Advice/decision buttons **229 × 56**; the 26-case grid **71 × 56** each. `document.documentElement.scrollWidth === 320` — no horizontal overflow on any phone screen. |
| Reduced motion honoured | **PASS** | CSSOM walk of `css/dond.css` + `css/dond-phone.css`: **0** `@keyframes`, **0** `animation:` and **0** `transition:` declarations outside `@media (prefers-reduced-motion: no-preference)`. `dondShowSplash` also returns early under `matchMedia("(prefers-reduced-motion: reduce)")` (`dond-app.js:436`). |
| Colour is never the only signal | **PASS** | Host board: opened rows carry `text-decoration: line-through`, a dimmed `#8b91c4` label (≈ 5.6:1 on the card) **and** a literal "gone" chip. Host grid: `aria-label` "Case 7, opened, $1,000,000" / "still sealed" / "Ada's own case", plus `disabled`. Phone grid: `data-state` `own`/`opened`/`sealed`, a "yours" or "case 7" text note, and matching `aria-label`s. Advice bars carry numeric "Deal 0% / No deal 100%" labels and a "1 vote so far — 0 deal / 1 no deal." line. |
| Buttons are `<button>`, dialogs `role="dialog"`, live regions | **PASS** | `#screen-editor` is `role="dialog"`; `#dond-error` is `role="alert"`; every control is a real `<button type="button">`; the odds and sound toggles carry `aria-pressed`. |

**O-1 (observation, hub-owned, not a defect).** The night scoreboard renders
Ada's winnings as `18000`, not `$18,000` — `room.reportScores` takes a numeric
`score` and the hub formats it as points. Fine for every other game; slightly odd
for a money game. Only the hub can fix it; flagging it so the orchestrator can
decide whether it is worth a `format` hint on the SDK.

---

## 6. Verdict

**fix-then-ship.**

This is a careful, genuinely pure implementation: the reducer is total and
immutable under a deep freeze, the offer arithmetic matches the spec formula at
every round and every jitter extreme, the leak rule survives a structural probe
strictly stronger than the one the implementer wrote, undo walks a whole game
backwards exactly, and the whole format plays end to end host-only, through the
loopback harness (57/57) and over a real PeerJS room with two phones — Deal held
as an intent until the host pressed the button, the audience split moving live,
a late joiner picked up mid-board, a lobby round trip and a mid-offer reload both
lossless. The static gates and the accessibility budget all pass, and reduced
motion is honoured completely.

Three real defects came out of it. **N-D1 was critical** — a board file that
merely omits an optional field could validate, start, and then wedge with no legal
move but Undo — and **N-D2 was a core-contract break** that returned a corrupted
state object; both were one-statement fixes and are applied, tested and green
(84/84, 739/739 at the root, harness 57/57 after). What is left for the
implementer is **N-D3**, a major: audience advice is frozen off at Start, so a
host who begins before the phones are in gets a whole board with no ballot while
the screen tells the room they can vote — that is also the cause of the one
intermittent harness failure I saw, so it is worth fixing before anyone else
chases the flake. **N-D5** (the accent block that makes the hub bar and the game
disagree) and the minors N-D6/N-D7 are quick. Nothing here threatens the format
or the data; with N-D3 fixed and the accent override deleted this ships.
