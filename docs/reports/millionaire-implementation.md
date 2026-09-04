# Millionaire — implementation report

Component: `millionaire` · Spec: `docs/08-millionaire-spec.md` · Owns
`games/millionaire/**`. Built 2026-09-03 on Windows 11, Node v24.16.0, Chromium
(in-app browser). Nothing outside `games/millionaire/**` and this report was
touched; the registry entry was added by the hub agent (verified present in the
hub lobby during testing). No git commit or push was run.

---

## 1. Files

| File | Lines | What it is |
|---|---:|---|
| `index.html` | 301 | host screens + phone screens in one page, `<body data-gsc-game="millionaire">`, `#gsc-join` |
| `css/wwm.css` | 620 | stage, hex lozenges, money tree, lifelines, overlays, editor |
| `css/wwm-phone.css` | 116 | phone controller (320–430 px portrait) |
| `js/wwm-content.js` | 466 | **PURE** JSON contract, level assignment, question draw, 50:50 pair, largest-remainder maths (UMD → `WwmContent`) |
| `js/wwm-core.js` | 789 | **PURE** reducer, selectors, phone views (UMD → `WwmCore`, re-exports the content module) |
| `js/data.js` | 683 | offline mirror of `questions.json`; sets `globalThis.WWM_DEFAULT_GAME` |
| `js/wwm-view.js` | 405 | host rendering + the shared `$ / el / show / setText` helpers |
| `js/wwm-app.js` | 514 | app state, persistence, content loading, buttons, hotkeys, sound cues |
| `js/wwm-editor.js` | 413 | in-page editor (Download / Use / Reset / Blank, draft auto-save) |
| `js/wwm-room.js` | 210 | host side of the GSC SDK |
| `js/wwm-phone.js` | 246 | phone controller |
| `js/wwm-sound.js` | 117 | WebAudio cues, no audio files |
| `js/timer-core.js` | 59 | **PURE** block-countdown maths, vendored from Jeopardy via Family Feud |
| `js/wwm-timer.js` | 137 | lifeline countdown DOM glue (deadline-driven, cue only) |
| `questions.json` | 133 | 45 original questions (3 per rung) + 6 Fastest Finger questions |
| `tests/wwm-core.test.mjs` | 704 | `node:test` suite, M-U1 … M-U10 |
| `tests/harness.html` | 554 | loopback harness, M-I1 … M-I7 |
| `tests/fixtures/harness-game.json` | 415 | deterministic harness content (2 per rung, 5-second timers) |
| `README.md` | 177 | hosting, rules, JSON schema table, phone features, known limits |

Largest file 789 lines (`wwm-core.js`), everything under the 800-line cap. No
function exceeds 45 lines (scanned; only the two module IIFE wrappers are
longer, and those are file wrappers, not functions).

## 2. How to run it

```bash
cd games/millionaire && node --test                  # 32 tests, M-U1 … M-U10
python -m http.server 8620                           # from the repo root
#   http://localhost:8620/games/millionaire/                       host
#   http://localhost:8620/games/millionaire/?room=CODE             phone
#   http://localhost:8620/games/millionaire/tests/harness.html     M-I1 … M-I7
```

The harness is self-driving: it finishes in ~8 s and `#summary` turns green
(`.ok`) with `window.__WWM_HARNESS__.failed === 0`.

## 3. Results

### Unit (T1) — `node --test` from `games/millionaire`

```
ℹ tests 32   ℹ pass 32   ℹ fail 0   ℹ duration_ms 361.8
```

| ID | Status | Evidence |
|---|---|---|
| **M-U1** validator | PASS | `M-U1 the shipped questions.json validates and mirrors data.js`, `M-U1 the validator rejects the documented bad files`, `M-U1 warningsFor flags a thin level`. The rejection test is table-driven over exactly the spec's list: 14 questions (`/at least 15/`), 3 options (`/exactly 4 options/`), duplicate options (`/repeats the option/`), `answer: 4`, non-increasing tree (`/increase at every rung/`), safe haven 99 (`/outside the money tree/`), FFF order `[0,1,2,2]` (`/exactly once/`), plus level > tree length, a non-boolean lifeline, a 500-second timer, `null` and `[]`. A separate test asserts the shipped answers use all four letters. |
| **M-U2** levels + no-repeat draw | PASS | `M-U2 questions with no level are spread evenly by file order` (15 questions → levels 1…15; 30 → 2 each). `M-U2 two contestants never see the same question, and the pool wraps`: two contestants play all 15 rungs of a 2-per-level pool, `new Set(...).size === 30`, `wrapped === false`; a third contestant sets `wrapped === true` and the notice matches `/wrapped/`. |
| **M-U3** select → lock → reveal, safe havens | PASS | `M-U3 select then lock then reveal climbs the money tree` (locking does **not** reveal). `M-U3 a wrong answer drops to the last safe haven reached` is table-driven over rungs 1, 4, 5, 9, 10, 15 → 0, 0, 1000, 1000, 32000, 32000, and checks the committed contestant row. `M-U3 the top rung pays the million`. |
| **M-U4** walk away | PASS | `M-U4 walking away keeps the money banked so far, and only before the lock`: 0 on rung 1, 2000 on rung 7 (the value of rung 6), `walkAway` after `lock` returns the identical state object. |
| **M-U5** 50:50 | PASS | `M-U5 50:50 removes exactly two wrong options, deterministically, once`: two removals, never the answer, identical pair under the same rng, a different rng still legal, a second call is a no-op, a removed option can't be selected and a stale selection is cleared. `M-U5 the lifelines reset for the next contestant`. |
| **M-U6** audience | PASS | `M-U6 audience votes: one per phone, contestant excluded, 100% total`: the contestant's vote is dropped, a second vote from the same pid is ignored, `chart().pcts` = `[0,67,33,0]` (largest remainder, sums to 100), a post-deadline vote and a junk index are no-ops, `audienceClose` freezes and later votes change nothing. `M-U6 the host can type the chart instead of using phones`: `[50,20,20,20]` → `[46,18,18,18]`, `source === "host"`, survives the close. |
| **M-U7** phone a friend | PASS | `M-U7 phone a friend runs on an injected clock and only cues`: deadline = `now + 30000`, `secondsLeft` 30 → 15 → 0, the friend name is cleaned, the game still accepts a selection long past the deadline (cue only), `phoneDone` closes, a second `usePhone` is a no-op. `M-U7 a zero-second setting means no timer at all`. |
| **M-U8** Fastest Finger | PASS | `M-U8 the fastest correct submission wins the hot seat`: three submissions sorted by `at` (`p2,p3,p4` order of arrival), correctness hidden before the reveal, `winner === "p2"` (fastest **correct**, not the fastest overall), `fffRows` times 1100/2200/3000 ms, a phone that never submitted is absent, one submission per phone. `M-U8 junk submissions and a nobody-was-right round` (5 malformed payloads ignored, manual `fffPick` after nobody was right). `M-U8 without Fastest Finger the host picks straight from the roster`. |
| **M-U9** undo / illegal / frozen | PASS | `M-U9 undo restores the previous state exactly` (two undos land on a deep-equal copy of the seated state). `M-U9 undo unwinds a whole question, including a wrong reveal`. `M-U9 illegal events are ignored (table-driven)` — 23 rows including `null`, a string event, `{}`, an unknown type, a `select` of `"0"`, a request from the wrong phone. `M-U9 the reducer never mutates its inputs` runs 15 events over a deeply frozen state. `M-U9 legalActions tracks what the host may do`. |
| **M-U10** phone surface | PASS | `M-U10 validatePhoneMsg keeps only well-formed intents` (5 good, 16 junk, and the returned copy is narrow — `["t","idx"]`). `M-U10 phoneView never leaks the answer and never mis-seats a phone`: only the contestant gets `hotseat`, everybody else `wait`; the vote screen has no `answer` key; a phone learns only its own vote. `M-U10 the Fastest Finger phone screen hides the order and closes on submit`. |

Four extra tests cover Switch the Question, the phone-request/host-confirm
handshake, the standings sort and the money-tree view.

### Loopback (T2) — `tests/harness.html`

`All 45 checks passed.` — four embedded phones (p1–p4) plus the real game page
as an embedded host, driven through the bridge protocol only.

| ID | Status | Evidence (harness line text) |
|---|---|---|
| **M-I1** FFF with fake phones | PASS | 8 checks: the shell roster becomes the contestant list (`Ada,Ben,Cleo,Dev`); Fastest Finger switches itself on because 4 phones are connected; every phone gets the four items and never the answer `order`; `arrivals are listed in the order they landed` = `p2,p1,p3`; correctness hidden until the reveal; **`winner p1`** — p2 submitted first but wrong; the reveal shows `✗ wrong / ✓ correct / ✓ correct` and the four items in the right order; the winner takes the hot seat. |
| **M-I2** hot seat | PASS | 7 checks: only the contestant gets `hotseat` (p2/p3 stay on `wait`); no `answer` key anywhere in the view; a 50:50 **request** leaves `lifelines.fifty === true` and `removed === []` until the host clicks *Give it to them*; the phone's tap sets `selected` but leaves `locked === false`; locking pushes the phone to "Locked in"; the reveal turns the option `correct`; the next question is rung 2. |
| **M-I3** Ask the Audience | PASS | 5 checks: p2/p3/p4 get a ballot, the contestant does not; the ballot carries no `answer`; the chart updates live and always totals 100% (counts `[2,0,1,0]`); a phone that has voted cannot vote again; closing freezes the chart against further taps. |
| **M-I4** wrong answer → next contestant → standings | PASS | 8 checks: past the first safe haven `winningsIfWrong === 1000`; the wrong option is marked `wrong` and the right one `correct`; the result reads `$1,000` and the contestant row is committed; the phone shows `mine === "$1,000"`; a contestant who has played is not offered again (`Ben,Cleo,Dev`); walking away banks 100; the standings list everyone; the shell receives a `scores` frame containing `p1 → 1000` and `title` frames matching `Question N of 15`. |
| **M-I5** reload mid-question | PASS | 2 checks inside the audience window: after reloading the host frame the audience window is still open **with the identical deadline**, the rung is unchanged, all three votes are still counted and the overlay is still on screen; the spent lifelines and the seated contestant survive. |
| **M-I6** editor | PASS | 4 checks: fifteen per-level count badges (`L1: 2` … `L15: 2`); **Download JSON** produces a blob that passes `validateGame` with 30 questions (captured by wrapping `URL.createObjectURL`); deleting a question flags the level (`.level-badge.thin` + the warning text `3 (1)`); **Use in game** adopts the draft (`title === "Edited in the harness"`), clears the finished game and returns to setup. |
| **M-I7** gates | PASS | 8 checks: every source served; every file under 800 lines; no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function`; no debug logging; the only external URLs in `index.html` are the two Google Fonts hosts; `data-gsc-game="millionaire"` and `#gsc-join` present; `questions.json` passes `validateGame`; `js/data.js` mirrors it **and reaches `globalThis.WWM_DEFAULT_GAME`**; the embedded page carries `gsc-embedded`. |

### Standalone host-only (T4) — browser, 1280×720

A full three-contestant night at `http://127.0.0.1:8672/games/millionaire/`,
clicking the real controls:

- Ada: **all four lifelines used** (50:50 on rung 1 → A and C dimmed;
  Phone a Friend on rung 2 with "Grandma" typed and a 28 s block strip running;
  Ask the Audience on rung 3 with the host typing `52/21/15/12` → the chart
  showed exactly those bars and froze at close; Switch the Question on rung 4
  swapped "Romeo and Juliet" for "the capital city of Japan"), then rungs 5–15
  answered correctly → `outcome {reason:"million", won:1000000}` and the result
  screen "We have a millionaire! · Ada · $1,000,000".
- Ben: correct to rung 7, then **wrong** → `$1,000` (the rung-5 safe haven), the
  wrong option red and the right one green before the result screen.
- Cleo: correct to rung 5, then **Walk away** → `$500`.
- **Finish the night** → standings `Ada $1,000,000 · Ben $1,000 · Cleo $500`.
- **Reload-resume:** with Ben on rung 7 and an option selected, the page was
  reloaded — phase `hotseat`, rung 7, `selected` preserved, Ada's million still
  in the standings.
- `document.documentElement.scrollHeight === 720` on the hot-seat screen at
  1280×720: **no vertical scroll in play.**

`?game=URL` precedence was checked live: with a game in progress from the
shipped questions, opening `?game=tests/fixtures/harness-game.json` loaded the
linked file, cleared the game and said so ("Loaded the questions from the link,
so the game in progress was cleared"); reloading the *same* link kept both the
questions and the game in progress.

### Real network (T3) — one phone over the public PeerJS broker

Host tab standalone at `127.0.0.1:8672`, **Open room** → `Room ZGC2` on the real
broker; a second tab at `?room=ZGC2&name=Ben` joined over WebRTC.

| What | Result |
|---|---|
| join | `GSC.mode === "standalone-player"`, roster shows `Ben:phone`, `phoneCount 1`, Fastest Finger switched itself on |
| Fastest Finger | the phone's chips numbered 1–4 as tapped, **Submit my order** sent `[2,0,3,1]`; the host logged `p1:true` and the arrival row `1 Ben 26.06s`; reveal made Ben the winner |
| hot seat | Ben tapped D → host `selected: 3`, `locked: false`, option state `selected`; the host locked, revealed and advanced |
| walk away | Ben tapped **Ask to walk away** → the host banner appeared with Confirm/Dismiss and the phase stayed `hotseat`; confirming produced the `$100` result |
| Ask the Audience | with Ada (a host-typed contestant) in the hot seat, Ben's phone got the ballot with no `answer` field, voted B, the host chart read `Votes in: 1` / `[0,100,0,0]` and froze on close |
| phone reload | reloading the phone re-joined and immediately received the current view ("Ada is in the hot seat") — the `lastSent` cache is dropped on rejoin |

### Static gates (T5)

| Gate | Result |
|---|---|
| V1 `node --test` exits 0 | PASS (32/32). Repo-root `node --test` also still passes: 422/422. |
| V2 files < 800 lines, functions < ~50 | PASS (max 789; no function over 45 lines) |
| V3 no `innerHTML` / `document.write` / `eval` / `new Function` | PASS — `grep -rnE` over the whole component returns only prose in two file banners and the harness's own gate code |
| V4 no debug logging | PASS — `grep -rn "console.log"` returns nothing; diagnostics use `console.warn` |
| V5 no Peer/connection/DOM/timer handle in state | PASS by construction: the SDK room handle lives in `wwm-room.js` module scope, the countdown interval in `wwm-timer.js`, and `wwmSerialise()` only writes `core / game / setup / source / sourceKind / sourceUrl / roomCode` |
| V6 external URLs | PASS — only `fonts.googleapis.com` and `fonts.gstatic.com`; PeerJS is loaded lazily by `shared/room-net.js` |
| V7 body attribute, `#gsc-join`, `player-mode` / `gsc-embedded` | PASS |
| V8 `?game=URL` and upload go through `validateGame` | PASS — `wwmFetchGame` and `wwmOnFile` both call `WwmCore.validateGame` before the game is adopted |
| Phone at 320 px | PASS — `scrollWidth === clientWidth`, every tap target ≥ 56 px |

## 4. Design system

`shared/theme.css` v2 and `docs/design-system.md` landed while this game was
being built, so the finished UI sits on v2: the game sets only
`--stage-deep/night/card` and its own `--hex` clip path and lets the shared
`--stage-bg` composite (glow spill, off-axis accent bloom, vignette) and the
registry accent `[data-gsc-game="millionaire"]` (`#3346c8` / `#a06bff`) do the
rest, so the stage reads as the same package as the hub. The setup card uses
the v2 `--panel` glass with `--panel-line` and `--panel-blur`. All v1 `.btn`,
`.field` and utility classes v2 keeps are used as before.

Not adopted, deliberately: `.gsc-lozenge` (this game's hexagon needs a gold rim
drawn as an outer clip with an inset face, which the shared class does not do)
and `.gsc-timer` (the lifeline strip is driven from a deadline in state through
`TimerCore`, which the shared class does not know about). Both are visual-only
choices a UI pass can revisit; behaviour does not depend on either.

## 5. Spec deviations, with reasons

1. **Safe-haven rule.** §1 says "the last safe haven reached"; §8 pins the
   numbers as "0 below rung 5; 1,000 between 5 and 9; 32,000 from 10". The
   implementation follows §8 exactly — the highest safe-haven rung **at or
   below** the rung being played — which means a slip on rung 5 itself still
   pays 1,000. The TV show is stricter (you must *bank* rung 5). §8 is what the
   tester checks, so §8 wins; the README states the rule plainly.
2. **Two core files.** `wwm-core.js` (789) + `wwm-content.js` (466) as spec §4
   allows and as Feud/Wheel/Weakest Link already do; `WwmCore` re-exports
   everything, so the spec'd API is unchanged. `wwm-view.js` is likewise split
   out of `wwm-app.js` for the same reason.
3. **Two events beyond §4's list:** `request{pid,which}` and `clearRequest`.
   §5 requires host confirmation for a phone's lifeline and walk-away intents;
   holding that pending intent in the state is what lets the host screen render
   the confirm banner and lets the harness assert on it. Neither event takes an
   undo step, and neither can change a lifeline or end a turn on its own.
4. **`nextQuestion` doubles as "see the result".** §4 has no separate event for
   ending a contestant's turn, so after a revealed wrong answer or the million,
   `nextQuestion` commits the outcome and moves to the result screen (the
   button relabels itself *See the result*). This keeps the reveal deliberately
   paced, which §1 asks for.
5. **Fastest Finger questions are required only when explicitly enabled.**
   §2 marks `fastestFinger` "required when enabled", but the setting defaults to
   on, which would make every hand-written 15-question file invalid. The
   validator fails only when `settings.fastestFinger === true` is written in the
   file with no items; otherwise `normalizeGame` turns the flag off. Documented
   in the README schema table.
6. **Fastest Finger is off by default when no phones are connected** (§3 "auto-off
   when no phones"), overridable by the host's checkbox at any time.
7. **One vote per phone means the first tap counts.** §8 M-U6 says "one per
   pid"; allowing changes would have been friendlier but is ambiguous against
   that wording, so the second tap is ignored and the phone's buttons disable.
   Called out in the README's known limits.
8. **Phone a Friend has no per-friend timer control beyond the JSON setting** —
   the overlay shows the name field, the seconds and the block strip, and the
   host closes it. §3 asks for exactly that.

## 6. Known gaps

- **End the night from the hot seat does not bank the contestant playing.**
  `finish` jumps straight to the standings; a contestant mid-question is left at
  0. Walking away or finishing the question first is the documented workflow
  (README §7). Making `finish` bank the current rung would silently invent a
  result, so it was left explicit.
- **`wwm-core.js` is 789 lines** — inside the cap but with little headroom. The
  next thing added to the core should move into `wwm-content.js` or a third
  file.
- **The state is written on `beforeunload`**, so clearing `localStorage` from a
  console and reloading in the same tab restores the game. That is correct
  behaviour for a host, but it surprises anyone trying to reset by hand; the
  supported resets are **Play again**, **Finish the night** and the editor's
  **Reset to shipped**.
- **Only one phone was exercised on the real broker.** Fastest Finger with
  several real phones racing, and an audience of more than one, were verified
  in the loopback harness (four phones) but not over live WebRTC. Worth a pass
  on two physical devices before a real game night.
- **No splash card yet** (09 §4 asks every game to show the `.gsc-splash` title
  card on switch). The shell owns the splash; if it turns out to be per-game,
  this component needs a small addition.
- **`prefers-reduced-motion`** is honoured through `shared/theme.css` plus
  `@media (prefers-reduced-motion: no-preference)` around this game's own
  keyframes, but was not measured with `getAnimations()`; that is UI-4's job.

## 7. What the tester should know

- The harness fixture (`tests/fixtures/harness-game.json`) uses 5-second
  lifeline timers and 2 questions per rung so scenarios are quick and the
  no-repeat draw is exercised; the shipped file uses 30/20 seconds and 3 per
  rung.
- `window.WwmApp` (state, core, dispatch, seat, select, useLifeline,
  confirmRequest, bindRoom), `window.WwmCore`, `window.WwmPhone` (me, view,
  order) and `window.WwmRoom` are the handles the harness drives; they are
  stable and safe to script against.
- Option states are exposed as `data-state` on each `#wwm-options .option`
  button (`idle` / `selected` / `locked` / `correct` / `wrong` / `removed`), which
  is the cheapest way to assert a reveal.
