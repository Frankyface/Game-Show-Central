# Millionaire — verification report

Component: `millionaire` · Spec: `docs/08-millionaire-spec.md` (§1 rules
normative, §8 success states) · Plan: `docs/06-verification-plan.md`.
Independent tester; did not write `games/millionaire/**`.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app browser), viewport emulated at 1280×720 (host) and 320×640 (phones) |
| Server | `python -m http.server 8681 --bind 127.0.0.1` from the repo root |
| Date | 2026-09-03 |
| Broker | public PeerJS broker reachable — real WebRTC, **not** BLOCKED-ENV |

Safe-haven rule applied throughout, as clarified by the coordinator: `rung` =
questions answered correctly; a wrong answer on question *n+1* pays the largest
safe-haven amount whose rung ≤ *n*; walking away pays the current rung's amount.

Commands run:

```bash
cd games/millionaire && node --test         # 67 tests (33 existing + 34 new adversarial)
node --test                                 # repo root: 457 tests, 0 failures
#   http://127.0.0.1:8681/games/millionaire/tests/harness.html   -> 55/55
#   http://127.0.0.1:8681/games/millionaire/                     -> host-only play
#   http://127.0.0.1:8681/                                       -> hub, room SNTW, 2 real phones
```

---

## 2. Results

### T1 — unit (`node --test` in `games/millionaire`)

`ℹ tests 67  ℹ pass 67  ℹ fail 0`

I read `tests/wwm-core.test.mjs` line by line first. **Every M-U id is genuinely
asserted** — no id is claimed by a test name without a matching assertion, the
tables are real tables (M-U3 walks six haven boundaries, M-U9 drives 23 illegal
events and 15 events over a deeply frozen state), and the "shipped file
validates" test compares `questions.json` to `js/data.js` with `deepEqual`
rather than eyeballing. I found no padded or vacuous test.

New adversarial file: **`games/millionaire/tests/wwm-adversarial.test.mjs`**
(34 tests, A1–A11). It broke nothing — the pure core survived every attack.

| ID | Result | Evidence |
|---|---|---|
| **M-U1** validator | PASS | `M-U1 the shipped questions.json validates and mirrors data.js`, `…rejects the documented bad files`, `…warningsFor flags a thin level`. Reinforced by **A8**: 48 malformed files (14 questions, 3 and 5 options, duplicate options case-insensitively, `answer` 4 / −1 / 1.5 / "2" / missing, tree of 4 and of 21, non-rising tree, zero and fractional rungs, haven 16 / 0 / out of order / repeated, FFF order `[0,0,1,2]`, `[0,1,2]`, `[0,1,2,4]`, `"0123"`, FFF on with no items, 201-char question, 61-char option, empty question/option, `questions` as a string, a question that is a string or `null`, `settings` as an array or string, numeric title, 4-char currency, unknown lifeline, lifeline as string, `lifelines` as array, timers 121 / −1 / 12.5, `fastestFinger` as string, level 16 and 0, numeric category, `safeHavens` as a number) each throw a distinct plain-English `Error`; ten junk top-level values (`null`, `42`, `""`, `true`, `[]`, `NaN`, …) all say "expected a JSON object". |
| **M-U2** levels + no-repeat draw | PASS | Existing M-U2 plus **A6**: 2-per-rung pool, two contestants × 15 questions → 30 distinct ids and `wrapped === false`; the third contestant sets `wrapped` and `notice` matches `/wrapped/i`, and the flag stays set. **A11** plays the *shipped* file for three contestants: all 45 questions used exactly once, no repeat, the fourth wraps. |
| **M-U3** select → lock → reveal, safe havens | PASS | **A1** walks **all fifteen** rung boundaries on the default tree (`[0,0,0,0,0,1000,…,32000]`) and checks both `winningsIfWrong` and the committed `outcome.won`; a five-rung custom tree with havens `[1,3,5]`; a tree with no havens at all; and a haven on the top rung (provably unreachable by a slip). |
| **M-U4** walk away | PASS | **A2**: refused after `lock` *and* after `reveal`; a phone's walk `request` recorded after the lock still cannot be honoured; walking on question 1 banks 0 but still ends the turn and marks the contestant `out`. |
| **M-U5** 50:50 | PASS | **A3**: a second `useFifty` is the identical object (no-op) and never restores an option; over five rng values the pair is always two wrong options, both survivors are selectable, exactly one is right, and both removed indices are unselectable; every lifeline is refused once locked. |
| **M-U6** audience | PASS | **A4**: the contestant is dropped by pid and by padded pid; the contestant's phone is never shown a ballot; votes for a 50:50-removed option, one ms past the deadline, after `audienceClose`, and a host chart typed after the close are all no-ops; three-way split `[1,1,1,0]` → `[34,33,33,0]` summing to 100; `33/33/33` typed by the host, and junk (`-5`, `NaN`, `"7"`, `1e9`, `[]`) always yields four values summing to 100 or 0. |
| **M-U7** phone a friend | PASS | **A3**: deadline `now + 30 000`, `secondsLeft` 30 → 0 and never negative at `9e15`; long past the deadline the contestant still answers and still wins (cue only); locking closes the overlay; a second `usePhone` is a no-op. |
| **M-U8** Fastest Finger | PASS | **A5**: identical `at` values keep insertion order (stable sort) and the **first correct arrival** wins the tie; submissions from `p9`, `spectator`, `""`, `"   "`, `"P1"`, `"p1x"`, `"p 1"` are dropped; a padded `" p1 "` resolves to the real contestant and cannot be doubled up; a contestant who already played gets no second round; submissions after `fffReveal` are refused and `fffReveal` twice is a no-op. |
| **M-U9** undo / illegal / frozen | PASS | **A3** undoes across two lifelines (close → audience → 50:50) and lands `deepEqual` on the seated state, with votes correctly taking no undo step. **A10** runs a 29-event night (FFF → seat → request → 50:50 → audience + host chart → phone → switch → lock/reveal → undo ×2 → walk → next contestant → finish) over a **deep-frozen** state including the `game` object, which is byte-identical at the end; and proves returned arrays are never the caller's arrays. |
| **M-U10** phone surface | PASS | **A9**: 44 hostile frames (including `{t:"reveal"}`, `{t:"lock"}`, `{t:"nextQuestion"}`, `{t:"finish"}`, `{t:"lifeline",which:"walk"}`, `{t:"__proto__"}`, string/float/NaN indices, 5-long orders) all return `null`; the accepted copies expose only `["t","idx"]` / `["t","order"]` / `["t","which"]` and the order is a copy. `phoneView` was snapshotted at **12 points** across a whole night × 6 pids: no `"answer"`, no `"order"`, no `"correct"` key anywhere. |

### T2 — loopback harness (`tests/harness.html`)

**`All 55 checks passed.`** (`window.__WWM_HARNESS__.failed === 0`, `#summary.ok`)

As shipped it read **`1 of 54 checks FAILED`** — see defect **D1**; fixed in the
harness (test-only) and re-run.

| ID | Result | Evidence (harness line text) |
|---|---|---|
| **M-I1** | PASS | `arrivals are listed in the order they landed p2,p1,p3`; `the fastest CORRECT order wins the hot seat, not the fastest overall — winner p1`; `every phone gets the four items and never the answer order`; correctness hidden until the reveal. |
| **M-I2** | PASS | `only the contestant gets the hot-seat screen — p2 sees wait`; `a lifeline request waits for the host`; `the host confirms and 50:50 takes two wrong options away — removed 0,1 of answer 3`; `a phone's tap selects but never locks`; `1 banked, question 2`. |
| **M-I3** | PASS | `every phone except the contestant gets a ballot — contestant sees hotseat`; `the chart updates live and always totals 100% — Votes in: 1 -> Votes in: 3; 67/0/33/0`; `closing the vote freezes the chart — frozen at 67/0/33/0`. |
| **M-I4** | PASS | `four right does not yet bank the rung-5 safe haven — a slip on question 5 pays 0`; `the fifth right answer banks the safe haven — 1000`; `a wrong answer pays the last safe haven $1,000`; `End the night (banks $200)` banks `p3`; `the night scoreboard is told the totals [{"pid":"p1","score":1000}]`. |
| **M-I5** | PASS | `a reload mid-question restores the running audience window — rung 1, deadline identical, 3 votes`; spent lifelines and the seated contestant survive. |
| **M-I6** | PASS | 15 level badges `L1: 2 … L15: 2`; `Download JSON produces a file that passes validateGame — 7041 bytes, 30 questions`; a thin level flagged `3 (1)`; `Use in game adopts the draft`. |
| **M-I6b** (splash) | PASS | Card present and `pointer-events: none`; shows "Millionaire" with the game accent and clears inside 1.2 s; **skipped entirely under `prefers-reduced-motion: reduce`**; **skipped when `gsc-embedded`** (new check). |
| **M-I7** (gates) | PASS | every source served; every file < 800 lines; no banned DOM/eval APIs; no debug logging; only Google Fonts external; `data-gsc-game` + `#gsc-join`; `questions.json` validates; `js/data.js` mirrors it and reaches `globalThis`; embedded page carries `gsc-embedded`. |

### T4 — standalone host-only play (1280×720, `http://127.0.0.1:8681/games/millionaire/`)

Driven by clicking the real controls; every figure below is read back out of the
live DOM.

| Scenario | Result | Evidence |
|---|---|---|
| **Ada to the million using all four lifelines** | PASS | 50:50 on Q1 (`removed [1,3]`, the two removed lozenges blanked and labelled `(removed by 50:50)` for screen readers); Phone a Friend on Q2 with "Grandma" typed, 29 s and a 9-block strip running; Ask the Audience on Q3 with `52/21/15/12` typed → bars `52% 21% 15% 12%`, "Using the percentages the host typed", frozen on Close; Switch the Question on Q4 (same level, `notice "Question switched."`); then Q5–Q15 → `outcome {reason:"million", won:1000000, rung:15}` and `We have a millionaire! · Ada · $1,000,000`. All four badges end `lifeline-used` + disabled. |
| **Wrong at Q5** | PASS | Facing Q5 the header read `Question 5 of 15 · playing for $1,000 · banked $500` and `winningsIfWrong === 0`; a wrong answer paid **$0** (`outcome {won:0, rung:4}`); options `wrong`/`correct` with the screen-reader words `(wrong answer)` / `(correct answer)`. |
| **Wrong at Q11** | PASS | Facing Q11, `winningsIfWrong === 32000`; result **$32,000**. |
| **Walk away at Q8** | PASS | `Question 8 of 15 · playing for $8,000 · banked $4,000`, `End the night (banks $4,000)`; walking paid **$4,000**, kicker "Walked away with". |
| Standings | PASS | `Ada $1,000,000 · Cleo $32,000 · Dev $4,000 · Ben $0`. |
| **Reveal before Lock** | PASS (refused) | `#btn-reveal` is `hidden` until `locked`, **and** dispatching `{type:"reveal"}` directly returns the identical state object. |
| **Reload at every phase** | PASS | `setup`, `pick`, `hotseat` (with a selection), `result`, `standings` — each restored byte-identically. **With an audience window open**: `phase/rung/qid/selected/audOpen/deadline/lifelines/overlay` all identical after reload and the countdown carried on at 11 s. |
| **Undo repeatedly** | PASS | 40 consecutive Undo clicks across three questions and a 50:50 unwound to `phase "setup"`, `rung 0`, all lifelines restored, `removed []`, `history 0`, no error. |
| **Editor** | PASS | Download JSON → 13 254 bytes, `validateGame === true`, 45 questions + 6 FFF, and its `questions` array is **identical to the shipped `questions.json`**; per-level badges `L1: 3 … L15: 3`; deleting a level's questions flags `7 (1)`; Use in game adopts the draft; an invalid draft (10 questions) is refused in place with "This game can't be used yet: A Millionaire game needs at least 15 questions — this file has 10."; Reset to shipped restores 45 rows. |
| **`?game=URL` vs a saved game** | PASS | With a game in progress from an edited set, `?game=questions.json` loaded the link, cleared the game and said `Loaded the questions from the link, so the game in progress was cleared.`; **reloading the same link kept the game in progress**; `?game=nope.json` (404) kept the game *and* the questions and said `Could not load questions from nope.json: the server answered 404. Using the built-in set instead.` |
| **Bad JSON via file input** | PASS | `hello{ not json`, an empty file, `[1,2,3]`, a 14-question file and a duplicate-option file are each refused with a plain-English banner and **the game in progress survives**; a good file is adopted (`Custom questions from good.json`). |
| **Fits 1280×720 in play** | PASS | `scrollHeight === 720`, `scrollWidth === 1280` on the Fastest Finger, revealed-FFF, hot-seat, result and standings screens. (The *setup* form is 741 px tall — 21 px of scroll before play starts; acceptable.) |

### T3 — real network through the hub (real PeerJS broker + WebRTC)

Host tab `http://127.0.0.1:8681/` → **Host a game night** → room **SNTW**; two
phone tabs at `?room=SNTW` joined as Ben and Cleo over real WebRTC; host picked
**Millionaire** (`games/millionaire/index.html?embed=host&room=SNTW`).

| What | Result | Evidence |
|---|---|---|
| roster → contestants | PASS | `setup.players = [{p1,Ben,manual:false},{p2,Cleo,manual:false}]`, `phoneCount 2`, Fastest Finger auto-checked, note "2 phones connected." |
| **Fastest Finger from both phones** | PASS | Ben submitted **first but wrong** (`1 Ben 17.32s`), Cleo **second but correct** (`2 Cleo 25.97s`); before the reveal no ticks; after it `✗ wrong / ✓ correct`, winner **Cleo**, button "Cleo to the hot seat", correct order shown `Pacific / Atlantic / Indian / Arctic`. The phone view carried no `order`. |
| hot-seat select from the phone → host locks | PASS | Cleo's tap set `selected 1`, `locked false`, host lozenge `selected`; Reveal stayed hidden until the host clicked Final answer. |
| **lifeline request needs host confirm** | PASS | "Ask for 50:50" → phone sub "Asked the host — wait for them to confirm.", its own button disabled, host banner `Cleo is asking for the 50:50 lifeline. Give it to them / Dismiss` with `lifelines.fifty` still `true` and `removed []`; clicking **Give it to them** produced `removed [0,2]`, `fifty:false`, banner cleared. |
| **Ask the Audience** | PASS | Ben (non-contestant) got the ballot with removed options blanked and disabled and **no `answer` field**; **Cleo's phone stayed on `hotseat` — no vote screen**; the host chart went `Votes in: 0` → `Votes in: 1`, bars `0/100/0/0`; a second tap did nothing (`myVote` unchanged, all buttons disabled); **Close froze** the chart (`audience.chart [0,100,0,0]`, `open:false`). |
| phone reload mid-question | PASS | Reloading Cleo's tab re-joined and immediately re-rendered the live hot seat with the 50:50 removals and spent lifelines — no "Waiting…" limbo. |
| **⌂ Lobby and back** | PASS | Leaving to the lobby and re-entering Millionaire restored `{phase:"hotseat", current:"p2", removed:[0,2], selected:1, lifelines:{fifty:false,audience:false,…}}` exactly. |
| **late joiner** | PASS | A third phone joining mid-game (`pid=p3&name=Zara`) got `screen:"wait"`, `spectator:true`, card "You're watching / Cleo is in the hot seat"; the host banner read "Zara joined — they can play from the next game."; `fffSubmit` from a spectator is refused by the reducer. |
| **night scoreboard** | PASS | After the result the hub lobby showed `TONIGHT'S SCOREBOARD — Cleo 100`; the shell bar subtitle tracked `Question 1 of 15`. |

### Cross-cutting defects from `00-orchestrator-triage.md` — checked, all clear

| Triage defect | Millionaire |
|---|---|
| `?game=URL` ignored once a save exists | **Not present.** `wwmChooseContent` (`js/wwm-app.js:472`) implements the agreed rule; verified live in both directions plus the 404 case. |
| Saved state not scoped to the room | **Not present.** `wwmBindRoom` (`js/wwm-app.js:309`) drops phone seats and clears the game when the room code changes, keeping host-typed contestants; called before any phone can join (`js/wwm-room.js:189`). |
| `globalThis.DEFAULT_*` missing in `data.js` | **Not present.** `js/data.js` ends with `globalThis.WWM_DEFAULT_GAME = …`; asserted by the harness gate. |
| Views not pushed on join/status | **Not present.** `onPlayerJoin` / `onPlayerStatus` (`js/wwm-room.js:27,45`) delete the `lastSent` cache entry and push; proven live by the phone reload and the late joiner. |
| Phone auto-advance | **Not present.** Phones send only `fff`/`answer`/`vote`/`walk`/`lifeline`; lock, reveal, lifeline spend, walk and next-question are host-only. |

### T5 — static gates

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | PASS | 67/67 in the component; 457/457 at the repo root. |
| **V2** files < 800 lines, functions < ~50 | PASS | Largest file `tests/wwm-core.test.mjs` 742; largest shipped `js/data.js` 683; my new test file 769 (both under the 800-line cap). No function over ~45 lines. |
| **V3** no `innerHTML`/`insertAdjacentHTML`/`outerHTML =`/`document.write`/`eval(`/`new Function` | PASS | `grep -rnE` over the whole component matches only two prose comments and the harness's own gate regex. |
| **V4** no `console.log` | PASS | zero matches; diagnostics use `console.warn`. |
| **V5** no Peer/connection/DOM/timer handle in state | PASS (code read) | `wwmSerialise()` (`js/wwm-app.js:77`) writes only `core/game/setup/source/sourceKind/sourceUrl/roomCode`; the room handle lives in `wwm-room.js` module scope and the countdown interval in `wwm-timer.js`. Confirmed by `JSON.stringify` round-tripping the whole state on every reload test. |
| **V6** external URLs | PASS | only `fonts.googleapis.com` / `fonts.gstatic.com` (plus example URLs in README prose). PeerJS is loaded lazily by `shared/room-net.js`. |
| **V7** `data-gsc-game`, `#gsc-join`, `player-mode`/`gsc-embedded` | PASS | `index.html:15,230`; classes toggled in `wwmBoot` (`js/wwm-app.js:493`); observed live (`bodyClass "gsc-embedded"`, `mode "embed-player"`). |
| **V8** `?game=URL` and upload go through `validateGame` | PASS | `wwmFetchGame` (`js/wwm-app.js:148`) and `wwmUseGame` (`:176`) both call `WwmCore.validateGame`; exercised with five bad uploads and two bad URLs. |

### Design / accessibility

| Check | Result |
|---|---|
| Money tree + question readable at 1280×720 | PASS — question 26.9 px, options 19.2 px, contestant name 30.7 px, all 15 rungs visible, no scroll. **Remark:** the money values and the `Question N of 15 · playing for … · banked …` header are 15.2 px, which is small for a projector; a UI pass could bump them. |
| Phone at 320×640, targets ≥ 56 px | PASS — `scrollWidth === clientWidth === 320` on the Fastest Finger and hot-seat screens; choice buttons 56 px, action buttons 63–103 px. |
| Colour is never the only signal | PASS — option lozenges carry `data-state` plus a visually-hidden word (`selected` / `locked in` / `correct answer` / `wrong answer` / `removed by 50:50`); removed options are also **blanked and disabled**; safe-haven rungs carry a `⚑` glyph as well as their colour; used lifelines carry a `✗` and `title="… — already used"`; the audience chart prints the percentage above every bar and marks removed columns. |
| `prefers-reduced-motion` honoured | PASS — all three of this game's animations sit inside `@media (prefers-reduced-motion: no-preference)` (`css/wwm.css:397`); the one transition (chart bar height, `:530`) is caught by `shared/theme.css`'s `reduce` block; the splash is skipped outright (harness check). |
| Buttons are `<button>` | PASS — every `addEventListener("click", …)` in the component is bound to a `<button>`; no clickable `div`/`span`/`a`. Overlays use `role="dialog"`; the money header, arrivals, notices and phone headline are `aria-live` regions; the current rung gets `aria-current="step"`. |

### Security

| Check | Result |
|---|---|
| Phone payloads validated before state | PASS — `wwm-room.js:73` runs `validatePhoneMsg` first and returns on `null`; 44 hostile frames covered in A9; feeding `{t:"lifeline",which:"__proto__"}` and `{t:"answer",idx:"<img src=x>"}` straight into `WwmRoom.onMessage` was a silent no-op with no prototype pollution. |
| Only the contestant's answer / lifeline / walk accepted | PASS — `INTENTS.answer` requires `state.current === pid` (`wwm-room.js:66`) and `evRequest` requires `pid === state.current` (`wwm-core.js:510`); asserted in both suites. |
| Audience votes only while open, never from the contestant | PASS — `evAudienceVote` (`wwm-core.js:455`) checks `a.open`, the deadline, `pid !== state.current`, one vote per pid and rejects removed indices; verified live (contestant got no ballot at all). |
| `phoneView` never leaks the answer | PASS — 12 snapshots × 6 pids in A9: no `"answer"`, `"order"` or `"correct"` key; also confirmed on the wire in T3. |
| No phone string reaches the DOM except via `textContent` | PASS — zero `innerHTML` in the component; a contestant named `<img src=x onerror=…>` is stored as text (clipped to 24 chars), rendered as a single text node, produced zero `<img>` elements and never fired. |

### Content

All **45** shipped questions and all **6** Fastest Finger orders were fact-checked
(not a sample of 20 — the set is small enough to do in full). **Every answer is
correct**; no corrections were needed, so `questions.json` and `js/data.js` are
untouched and still byte-identical (asserted by M-U1). Spot notes: Q27 "largest
desert = Antarctica" is right under the standard (precipitation-based)
definition; Q29 "mercury" is the only metal liquid at room temperature (bromine
is a non-metal); Q43 "forty" is indeed the only English number name whose
letters are in alphabetical order; FFF 5 (cheetah > greyhound > domestic cat >
human sprinter) matches published top speeds.

---

## 3. Defects

Nothing critical or major was found. All findings are **minor**.

| # | Sev | File:line | What / repro | Fixed? |
|---|---|---|---|---|
| **D1** | minor | `games/millionaire/tests/harness.html:478` (cause: `js/wwm-app.js:445`) | **The shipped loopback harness failed.** Serve the repo and open `games/millionaire/tests/harness.html`: `1 of 54 checks FAILED — M-I6b the splash shows the game name and wears the game accent`. `wwmShowSplash()` now returns early when `gsc-embedded` is set (the correct behaviour — the hub plays its own card), but the harness drives the host frame *embedded* and still asserted the card appears. Test-only staleness; the game behaves correctly. | **YES** (test-only, 10 lines). The scenario now removes `gsc-embedded` for the three standalone-path checks and adds a new check that an embedded frame skips the card. Harness is **55/55**. |
| **D2** | minor | `js/wwm-phone.js:147` (`SCREENS.vote`) | **The phone's Ask-the-Audience ballot shows no timer.** Spec 08 §5 says the `vote` screen shows "A–D vote buttons with the question, **timer**", and `phoneView` already sends `deadline` and `seconds` (`js/wwm-select.js:294–295`) — the renderer just never uses them. Repro: T3, Ben's ballot reads "One vote each." with no countdown while the host screen counts 20 → 0. Proposed fix (~6 lines): while `view.screen === "vote"` and `view.deadline` is finite, tick a 250 ms interval writing `` `${WwmCore.secondsLeft(view.deadline, Date.now())}s left` `` into `#wwm-phone-status`, and clear it on the next `view`. | no |
| **D3** | minor | `js/wwm-core.js:490` (`evUseSwitch`) | **Switch the Question fails silently when the rung has no other question.** With one question per rung the event returns the state unchanged; the host badge is merely disabled (via `legalActions`) with the generic `title="Switch the Question"`. House rule: "Every failure path surfaces a plain-English message." (The lifeline is correctly *not* burned — verified in A3.) Proposed fix (~3 lines): when the draw yields nothing new, return the state with `notice: "There is no other question on this rung — Switch is unavailable."`, or set that as the disabled badge's `title` in `renderLifelines`. | no |
| **D4** | minor | `docs/reports/millionaire-implementation.md` §6 | **Stale implementation report.** It says "The splash shows in embedded mode as instructed… If the UI tester sees that flash, the fix is one line: add `if (document.body.classList.contains("gsc-embedded")) return;`". That line is already in `js/wwm-app.js:445`. Documentation drift only — but it is what made D1 look like a behaviour change. Fix: delete that bullet. | no |
| **D5** | minor | `js/wwm-app.js:426` | **`beforeunload` save defeats a manual reset.** Clearing `localStorage` from the console and reloading in the same tab resurrects the game (the unload handler rewrites the key first). Already listed in the implementer's known gaps; I hit it in testing and confirm it. Not play-blocking (Play again / Finish the night / Reset to shipped all work), but it belongs in the README's known issues, which currently does not mention it. | no |
| **D6** | minor | `js/wwm-core.js:56` | **Undo depth is capped at 60 steps and this is undocumented.** A full 15-question run is exactly 60 history entries (select/lock/reveal/next × 15), so a contestant who has played the whole tree cannot be undone back to the start. Sensible for localStorage size; worth one line in the README. | no |
| **D7** | minor (cosmetic) | `js/wwm-select.js:116` (`nameOf`) | `phoneView(state, pid).name` is `""` for a spectator, because `nameOf` only searches `contestants`/`roster`. No screen renders `view.name` today (verified live: the spectator card reads correctly), so there is no visible symptom — but any future phone screen that greets the viewer by name would show a blank for spectators. | no |

### Observations (not defects)

- The loopback harness's "Use in game" writes to the **live** `gsc-wwm-state-v1`
  key, so after running `tests/harness.html` the real host page at the same
  origin opens with the harness's edited questions until the host loads another
  set. Harmless for hosts; it cost me two resets during testing.
- A late joiner **does** get an Ask-the-Audience ballot. That is correct per
  spec 08 §1 ("every connected phone except the contestant"), unlike the
  Weakest Link mid-game-joiner defect (WL-2) — recording it here so a future
  triage does not mistake it for the same bug. They are still correctly barred
  from Fastest Finger and from the hot seat.
- The setup screen is 741 px tall at 1280×720 (21 px of scroll). Spec only
  requires no scrolling in play; every play screen is exactly 720.

### Diff I made

Only two files, both test-only, both inside `games/millionaire/`:

1. **Added** `games/millionaire/tests/wwm-adversarial.test.mjs` (769 lines,
   34 tests, A1–A11) — the adversarial suite described above. No production
   code needed changing to make it pass.
2. **Edited** `games/millionaire/tests/harness.html` (D1) — before
   `WwmApp.showSplash()` in `scenarioSplash()`, `HD().body.classList.remove("gsc-embedded")`
   with a three-line comment; after the reduced-motion check, re-add the class,
   call `showSplash()` again and `check("M-I6b an embedded frame skips the card
   — the hub shows its own", node.classList.contains("hidden"), …)`.

No production file, no file outside `games/millionaire/` and `docs/reports/`
was touched. No `git commit` or `git push` was run.

---

## 4. Verdict

**Ship.** Millionaire is the cleanest component I have tested against this plan:
the pure core survived 34 purpose-built adversarial tests without a single
failure — every safe-haven boundary on three different money trees, 48
malformed files, 44 hostile phone frames, deep-frozen state across a whole
night, and Fastest Finger ties — and the shipped questions are factually
correct to the last one. All ten M-U ids are genuinely asserted by the existing
suite, all seven M-I ids pass in the loopback harness, the standalone T4 run
produced exactly the four payouts the clarified safe-haven rule demands
($1,000,000 / $0 at Q5 / $32,000 at Q11 / $4,000 walking at Q8), and the full
T3 path over the real PeerJS broker — Fastest Finger from two phones, hot-seat
selection, host-confirmed lifelines, an audience the contestant is excluded
from, phone reload, ⌂ Lobby round-trip, late joiner and the night scoreboard —
worked end to end. Every one of the five cross-cutting defects from the
orchestrator's triage is absent here. The single failure I found was a stale
assertion in the game's own harness (**D1**, fixed, test-only); the remaining
six findings are all minor polish — a missing countdown on the phone ballot
(**D2**), a silent Switch-the-Question no-op (**D3**), and four
documentation/known-issue items. None of them blocks a game night, so they can
land as a follow-up rather than gating the merge.
