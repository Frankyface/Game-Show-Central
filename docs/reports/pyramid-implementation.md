# Pyramid — implementation report

Component: `pyramid` · Owns `games/pyramid/**` · Spec: `docs/11-pyramid-spec.md`
Built: 2026-09-04 · Node v24.16.0 · Windows 11 · Chromium (in-app browser)

---

## 1. What was built

A `$100,000 Pyramid` style game for two teams of two, playable end to end with
no phones at all, and playable with phones as the intended experience.

| File | Lines | What it is |
| --- | --- | --- |
| `index.html` | 356 | host screens + phone screens in one page, `<body data-gsc-game="pyramid">` |
| `categories.json` | 99 | 24 original categories × 7 words, 4 Winner's Circle sets |
| `js/data.js` | 439 | generated mirror of `categories.json` (a unit test asserts they are identical) |
| `js/pyr-content.js` | 357 | PURE: the JSON contract, normalisation, the nightly draw (UMD → `PyrContent`) |
| `js/pyr-core.js` | 729 | PURE: the reducer and every selector (UMD → `PyrCore`, re-exports content) |
| `js/pyr-view.js` | 470 | host rendering + the four DOM helpers |
| `js/pyr-app.js` | 687 | host glue: state, persistence, setup, buttons, hotkeys, clocks, sound, splash |
| `js/pyr-clock.js` | 103 | rAF + interval clock renderer (copied in shape from `wl-clock.js`) |
| `js/pyr-sound.js` | 118 | WebAudio cues behind the shared `gsc-sound` preference |
| `js/pyr-editor.js` | 349 | the in-page category editor |
| `js/pyr-room.js` | 207 | host glue on `GSC.host` |
| `js/pyr-phone.js` | 234 | the phone controller |
| `css/pyr.css` | 738 | host styles |
| `css/pyr-phone.css` | 167 | phone styles |
| `tests/pyr-core.test.mjs` | 724 | 39 `node:test` cases (Y-U1 … Y-U10) |
| `tests/harness.html` | 677 | 57 loopback checks (Y-I1 … Y-I6) |
| `tests/fixtures/harness-game.json` | 190 | the small game the harness plays |
| `README.md` | 203 | hosting, the JSON table, phone features, layout |

Every file is under the 800-line cap; the largest is `css/pyr.css` at 738.

## 2. The secret-words requirement (spec §3/§4) — how it is enforced

This is the heart of the game and it is enforced in three independent places.

**1. The core.** `PyrCore.phoneView(state, pid)` is the only masked surface.
Only the branch for `pid === round.giverPid` builds an object with a `word`
key at all, and only `pid === circle.giverPid` gets `circleCategory`. Every
other branch — guesser, the other team, a spectator, the giver after the round
has finished — returns an object that has no such key. Unit test **Y-U10**
serialises every view for every pid in every phase and asserts that none of the
game's words or circle subjects appears as a substring.

**2. The host DOM.** `renderWordPanel` and `renderCirclePanel` build their
children only while the host has explicitly asked to see them, and call
`replaceChildren()` first. There is no hidden node parked with the word in it,
because a hidden node still shows up in a DOM-text check — and, more to the
point, in a screen share the moment a stylesheet fails to load. The word-status
strip on the play screen carries positions and outcomes but no text, so it is
safe on a shared screen at any moment.

**3. The transport.** `pyr-room.js` sends each phone `phoneView(state, thatPid)`
and nothing else; there is no broadcast of game state.

Harness check **Y-I1** asserts the positive and the negative in the same breath:
the giver's phone `#pyr-phone-word` equals `PyrCore.currentWord(state)`, and
`hostDocument.body.textContent` contains none of the round's four words. It then
presses **Show words to me**, asserts the word *does* appear, presses it again,
and asserts both that the word is gone and that `#pyr-word-panel` has zero child
nodes. **Y-I5** does the same for the six Winner's Circle subjects.

The real-network run confirmed it outside the harness: with one phone joined
over the live PeerJS broker, the phone read `SUNFLOWER` while the host page's
`textContent` contained none of the seven words.

## 3. Rules decisions worth reviewing

The spec is normative; these are the places where it left room and I chose.

- **The word in flight at the buzzer.** `clockExpired` stops the clock and sets
  `round.expired`, but does **not** finish the round: the host still judges the
  word the giver was describing, and *that* mark closes it. This is the TV rule
  and it is what "clock expiry finishes the in-flight mark" (Y-U4) asks for.
  The same rule applies in the Winner's Circle.
- **An illegal clue in the Winner's Circle blocks that box and play continues.**
  The spec sentence ("that box is blocked and the team keeps what they've won
  so far") admits two readings. I read it as: the blocked box can never be won,
  the grand prize is therefore out of reach, the money already banked is safe,
  and the team carries on with the boxes that are left. The sentence that
  follows it in the spec ("Pass allowed; passed boxes can be revisited") only
  makes sense if the round continues, and it is how the show plays. If the
  orchestrator wants the other reading, it is a three-line change in
  `evCircleMark`.
- **Clearing all six pays the grand prize *instead of* the box values**, not in
  addition — `circleWinnings` returns `grandPrize` when six boxes are won and
  the sum of the won values otherwise.
- **The tiebreak** is one category, one word each, alternating, on its own
  short clock (`settings.tiebreakSeconds`, default 15 — an added setting). After
  each *pair* the higher score goes up; still level and the next pair is dealt.
  If the words run out level, the host picks (`toCircle{team}` accepts an
  explicit team). Team A always leads off. It can only be played once.
- **Role rotation continues into the tiebreak and the Winner's Circle** — a
  team's *n*-th appearance decides who gives. `toCircle` accepts an optional
  `giver` override in the core if a future UI wants a hand-over button.
- **Money is the night's score.** `reportScores` sends the Winner's Circle
  winnings for **both** members of the winning team and 0 for the others;
  main-game points are shown but never banked, per spec §1.
- **Two modes, one rule set.** The setup screen's phone / host-as-giver choice
  changes only the wording of the prompts on the play and circle screens. Both
  modes have **Show words to me** and **Study (10 s)**; the mode decides which
  one the notice suggests.

## 4. Deviations from the spec's file list

- **`js/pyr-view.js` added.** Host rendering is split out of `pyr-app.js` so
  both stay well under 800 lines — the same deviation the orchestrator already
  accepted for Feud, Wheel and Weakest Link's cores, and the same shape as
  Millionaire's `wwm-view.js`.
- **`settings.tiebreakSeconds` added** to the content contract (optional,
  default 15). The spec's configurable list did not name a tiebreak clock and
  reusing the 30-second category clock for a single word felt wrong.
- **`categories[].title` must be unique** within a file. Not in the spec, but
  two identically titled cards on the same board is a bug the host cannot
  recover from.

## 5. Things the orchestrator must do

1. **Registry entry.** `js/hub-registry.js` needs the `pyramid` tile (path
   `games/pyramid/index.html`). Not touched by this agent.
2. **`shared/theme.css` has no `pyramid` accent block.** The game declares its
   own in `css/pyr.css` under the same `body[data-gsc-game="pyramid"]` selector
   shape, so the block can be lifted into `theme.css` verbatim:
   `--accent: #f4b400; --accent-2: #2ec4b6; --accent-ink: #241a02;
   --stage-glow: #0a4351;`
3. **`css/pyr.css` also overrides `--stage-bg`** on the same selector, dropping
   the shared stage's 22%-accent bloom. Gold at 22% over a teal stage lifts the
   top-right corner far enough that 12–15 px secondary text falls under 4.5:1.
   Everything else about the stage is unchanged. If the shell agent would rather
   own that, the fix upstream is to make the bloom's strength a token.
4. **This game defines its own secondary ink**, `--pyr-dim: #d9ecf3`, and its
   own red, `--pyr-red: #ff9d9d`, instead of `--ink-dim` / `--ink-mute` /
   `--red`. Those three shared tokens are tuned for the hub's near-black navy
   and reach only ~3.4:1 on teal glass. Worth knowing before a future game picks
   a light stage.

## 6. Verification performed by this agent

| Tier | Result |
| --- | --- |
| **T1 unit** | `cd games/pyramid && node --test` → **39 tests, 39 pass, 0 fail** (Y-U1 … Y-U10, including the leak test) |
| **T2 loopback** | `tests/harness.html` → **All 57 checks passed** (Y-I1 … Y-I6) |
| **T3 real network** | standalone host opened room `NU7T` on the live PeerJS broker; one phone joined at `?room=NU7T&name=Ada`, was seated as Team A's first giver, showed `SUNFLOWER` while the host screen did not, and **Got it** / **Pass** advanced the host's word list (`1 / 7`, statuses `correct, passed, pending…`) |
| **T4 standalone** | full host-as-giver game at 1280×720: four typed players, six categories, all six Winner's Circle boxes, prize card, standings. Scores 18–14, grand prize `$10,000` |
| **T5 static gates** | see below |

**Static gates**

- V1 `node --test` exits 0.
- V2 every file < 800 lines (largest 738).
- V3 `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` /
  `eval(` / `new Function` → zero real uses. Three matches are prose comments
  ("never innerHTML", "no innerHTML anywhere") and the harness's own gate
  regex, which the harness excludes by name — the same pattern Millionaire uses.
- V4 `console.log` → zero (`console.warn` used for diagnostics).
- V5 no Peer / connection / DOM / timer handle reaches `setState`: the clocks,
  the study-mode interval and the splash timer are module-level variables in
  `pyr-app.js`, never fields of `pyrApp`. `reveal`, `circleReveal` and
  `studyUntil` are UI-only and `reveal` is deliberately **not** persisted, so a
  reload never comes back with the words on screen.
- V6 the only external URLs are the two Google Fonts hosts (README examples
  aside).
- V7 `<body data-gsc-game="pyramid">`, `#gsc-join` present, `player-mode` /
  `gsc-embedded` wired.
- V8 `?game=URL`, file upload and the editor all pass through the same
  `validateGame`; the harness loads its fixture through `?game=`.

**Layout / accessibility spot-checks (the UI tester should confirm)**

- 1280×720, no vertical scroll on **board, play (words hidden and revealed),
  round-over, mainResult, circle, result, standings** — `scrollHeight === 720`
  on every one. Setup and the editor scroll, which the brief allows.
- Contrast: an in-page checker measured every text element on all seven
  surfaces against the lightest background it could sit on (glass over the top
  glow) — **0 pairs below threshold**. Gradient-backed text (the gold cards,
  the coloured buttons, the revealed word panel) is excluded by the checker and
  was computed by hand; the worst is `.btn-green` at 4.7:1.
- Phones at 320 px: the harness asserts no phone (giver, guesser or spectator)
  scrolls sideways, and that **Got it** / **Pass** are ≥ 56 px tall. Both were
  340 px wide before a fix — see the defect list.
- Reduced motion: every `@keyframes` and every `animation:` in both sheets sits
  inside `@media (prefers-reduced-motion: no-preference)`; the harness gates
  this on the CSS source with comments stripped. The splash is skipped outright
  under `reduce` and when embedded.

## 7. Defects found and fixed during the build

| # | Severity | What | Fix |
| --- | --- | --- | --- |
| 1 | critical | `{type:"__proto__"}` reached `Object.prototype` through the handler map and threw `handler is not a function` — a phone could not send it, but a corrupt save could | `Object.prototype.hasOwnProperty.call(HANDLERS, …)` plus a `typeof === "function"` guard; adversarial case added to Y-U9 |
| 2 | major | the phone page loaded the same document as the host, so the 1180 px setup card stayed in the DOM and a 320 px phone scrolled sideways (340 px of content) | `body.player-mode .screen:not(#screen-phone) { display: none !important; }` |
| 3 | major | `.phone-actions .btn` used `flex-basis: 100%` with content-box padding, adding ~44 px of overflow | border-box for the whole phone subtree |
| 4 | major | the swap rotation counted the slot that had just been claimed, so a team's second category did not swap | roles are computed from the pre-claim state in `evPickCategory` |
| 5 | major | a tiebreak word handed to the other team kept the first team's giver/guesser | roles recomputed on every team flip in `markTiebreak` |
| 6 | major | a level tiebreak that ran out of words could be replayed forever | `state.tiebreakPlayed`; the host then picks the team |
| 7 | major | a file's own `categorySeconds` / `circleSeconds` / `categoriesPerTeam` / `swapRoles` were ignored — the setup screen's defaults always won | `pyrSettingsFromGame` seeds the setup from the loaded file unless the host has already touched a rule field (`settingsTouched`) |
| 8 | major | `window.PyrView` was undefined: a top-level `const` is not a property of `window` | explicit `window.PyrView = PyrView;` (the same line `wwm-view.js` ends with) |
| 9 | minor | `--ink-dim` / `--ink-mute` / `--red` fall to ~3.2–3.4:1 on this game's teal stage | `--pyr-dim`, `--pyr-red`, a darker `--stage-glow`, and a stage without the gold bloom |
| 10 | minor | `.pyr-card-hint` at `opacity: .75` on gold measured 3.6:1 | opacity removed |
| 11 | minor | the circle's "won" note (`#4a3400` on gold) measured 3.6:1 | darkened to `#2b1e00` |

## 8. Known limits (also in the README)

- Two teams of exactly two. Bigger groups rotate players between games.
- The tiebreak always leads off with Team A.
- No hand-over button for the Winner's Circle giver in the UI (the core supports
  it).
- ~~The harness and the real game share `localStorage` on the same origin~~ —
  **closed**: the harness runs under `?store=harness` and writes only to its own
  namespaced keys (see §9).
- Real-network testing used one browser profile on one machine; a check across
  two physical devices is still worth doing before a game night.


---

## 9. Fixes after verification

Written after `docs/reports/pyramid-verification.md` (verdict **fix-then-ship**).
The tester's own fix for **Y-1** (the tiebreak's unmatched last word) is kept as
they wrote it, and their three suites — `pyr-adversarial.test.mjs`,
`pyr-hostile.test.mjs`, `pyr-fixtures.mjs` — are kept and stay green.

### Y-5 · a phone could still score while the host had the clock paused

The gate was `round.started`, which stays true through a pause. New selector
`PyrCore.phoneCanMark(state, pid)` is the single rule: the pid must be the
current giver, the round must be live, and the clock must be **running or at the
buzzer** (the word in flight still has to be judged). It is enforced in two
places — `pyrPhoneMark` refuses the intent before it can become an event, and
the giver's view carries `canMark` so **Got it** / **Pass** grey out and the
phone reads *"The host has paused the clock."*

The host's own buttons deliberately stay live through a pause: the host is the
judge, not a player. Same rule in the Winner's Circle.

Covered by three new unit cases and, in the harness, by a check that greys the
buttons, sends a mark from a phone that has bypassed them anyway, and confirms
nothing moved while `btn-correct` is still enabled. Confirmed live over the real
PeerJS broker (room `RVSR`): paused, phone greyed, two hostile `mark` frames
refused (`0 / 7` unchanged), host's own ✓ then scored `1 / 7`.

### Y-2 / Y-3 · a phone sharing a typed player's name

A phone whose name matches a row the host typed **is** that person arriving with
a phone, so it now takes the row over — pid and seat — the way the hub relinks a
returning player, instead of being refused a seat entirely. New
`pyrAdoptSeat(row, pid)` in `pyr-app.js`; `pyrAddPlayer` only adopts when the
incoming player is a phone (`manual === false`) and the twin is a typed row, so
a second *typed* name is still refused with the original message.

`pyrMergeSetup` now de-duplicates the restored roster by **name as well as pid**
and carries the seat across, so a saved "Ada" and a live phone "Ada" can no
longer both appear in the four dropdowns.

Verified live: four typed players seated, then a phone called Ada joined —
roster stayed at four, Ada's row became `p1 / phone`, and seat A1 moved with it.

### Y-4 · the fallback sentence now matches what actually loaded

`pyrLoadContent` only records the failure (`pyrUrlFailure`); the second sentence
is written in `pyrChooseContent`, where `useSaved` is known — *"Keeping the
categories you already had."* when the save is what plays, *"Using the built-in
set instead."* when it is not.

### Y-6 · an escape hatch on the play and circle toolbars

`#btn-play-finish` and `#btn-circle-finish` ("End the night") dispatch `finish`.
From a running category it banks nothing new and goes straight to the standings;
from the circle it keeps whatever has already been won. Harness scenario
`scenarioEndNight` plays it for real and asserts `outcome === null` and `$0`.

### Y-7 · one source for the accent tokens (decided centrally)

The local `body[data-gsc-game="pyramid"]` token block is gone: `--accent`,
`--accent-2`, `--accent-ink` and `--stage-glow` now come only from
`shared/theme.css`, so the hub shell bar, the game-switch splash and the game
page paint the same glow. Confirmed in the browser: the page computes
`--stage-glow: #0b3b3c` from the theme.

The **`--stage-bg` override stays** — it is the reason small text on the
top-right of the stage clears 4.5:1, and the tester verified that argument. The
selector now carries nothing but the painting, with a comment saying why the
palette must not be re-declared there. Nothing in the sheet depended on the old
local glow value; the theme's is darker, so every measured pair improved.

### Content, docs and cosmetics

- **"Plaster" → "Latex gloves"** in *Say Ahh*: "Plaster" and "Bandage" are
  near-synonyms in British English, so a guesser saying "plaster" for "Bandage"
  was right and got marked wrong.
- **Four titles that named their own theme** are replaced: *Who's a Good Boy* →
  **Off the Lead**, *Nine Lives* → **Curiosity Calls**, *Round and Round* →
  **Dizzy Business**, *Give It a Rattle* → **Well Mixed**. *Never Sinks In* is
  kept — the tester marked that one optional and judged the pun earns it.
- `js/data.js` was **regenerated from `categories.json`** in the same script, so
  the two cannot drift; the mirror test and `A11` both still pass.
- README: **three games before a category repeats**, not four (a game eats seven
  — six board plus a held-back tiebreak); a note that the shipped words are
  British English; the paused-phone rule; and "End the night" in the key table.
- `css/pyr-phone.css`: the 17 dead `.phone-box` lines are deleted.
- `tests/pyr-core.test.mjs`: the literal NUL at the old line 131 is now the
  escape ` `, so all three test files are pure printable ASCII and no
  longer read as binary to `grep` and `file`.


### `?store=NAME` — the harness no longer writes to the real save

Cross-cutting fix, same shape as `games/price-is-right`. `pyrStoreSuffix()` in
`pyr-app.js` reads `?store=NAME` and suffixes every localStorage key this page
owns — `gsc-pyr-state-v1` and, through `PyrApp.storeSuffix()`,
`gsc-pyr-draft-v1`. Anything outside `[A-Za-z0-9-]` is stripped and the name is
capped at 24 characters (`?store=../../evil name!` resolves to
`gsc-pyr-state-v1-evilname`). No parameter means no suffix, so an ordinary visit
keeps the keys it always had.

`tests/harness.html` now loads both frames with `&store=harness` and clears
`gsc-pyr-state-v1-harness` / `gsc-pyr-draft-v1-harness` between boots, so a test
run can no longer leave its fixture categories, its half-played game or its four
fixture players in the real host's save on the same origin — the known limit
listed in §8, now closed.

`gsc-sound` is deliberately **not** namespaced: the 🔊 preference is shared with
the whole hub (architecture 00 §10).

Proved rather than assumed: the harness writes a sentinel into the two real keys
before it boots anything and asserts in the gates that both still hold it
(`Y-I6 ?store=harness keeps this run out of the real host's saved game`), then
removes them. `node --test` → **95 pass, 0 fail**; harness on port 8692 → **All
67 checks passed** (66 + the new one).

### Not changed, and why

- **Y-8** is documentation only and is now correct in the README; the
  `warningsFor` threshold is left alone because a fourth game still deals a full
  board rather than stalling (the tester's `A11` asserts it).
- Adoption is a **setup-screen** rule. A phone that joins after the game has
  started still gets *"X joined — they can play from the next game."* — seating
  them mid-game would mean rewriting pids inside a running core state, which is
  a bigger change than this round of fixes warrants.

### State after the fixes

| Check | Result |
| --- | --- |
| `cd games/pyramid && node --test` | **95 pass, 0 fail** (92 before + 3 new for Y-5) |
| `node --test` at the repo root | **754 pass, 0 fail** |
| `tests/harness.html` (port 8692) | **All 67 checks passed** (57 before + 9 for Y-5, Y-6, Y-2/Y-3, + 1 for `?store=`) |
| Real network | room `RVSR` on the live PeerJS broker: adoption, the paused-phone refusal and the host override all confirmed |
| 1280×720 | no vertical scroll on board, play (hidden and revealed), round-over, mainResult, circle, result, standings — with the new buttons in both toolbars |
| Contrast | re-walked all seven surfaces against the theme's darker glow: **0 pairs below threshold** |
| Static gates | V2 every file < 800 lines (largest `tests/pyr-core.test.mjs` at 775); V3/V4 clean; the tester's three suites are now in the harness's gate list |
