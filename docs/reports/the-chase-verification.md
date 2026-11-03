# The Chase — verification report

Component `the-chase` · spec `docs/15-the-chase-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` and `docs/reports/00-orchestrator-triage.md` ·
independent tester (did not write the code under test).

## 1. Environment

- Windows 11 Home 10.0.22635, Node v24.16.0, Python `http.server` on
  `127.0.0.1:8733` (own port), Claude desktop built-in browser (Chromium).
- Date: 2026-11-03.
- Real network (T3): hub host at `http://127.0.0.1:8733/?store=th`, real PeerJS
  broker, room **SZAT**. The browser pane's tab cap was taken by other agents'
  tabs, so the two phones ran as two 320 × 640 iframes of
  `/?room=SZAT&store=pa|pb` inside the host tab. Each is a separate browsing
  context with its own `?store=` slot and its own PeerJS connection.
- Afterwards: all `127.0.0.1:8733` storage cleared, tab closed, server stopped.

## 2. Results

| ID | Result | Evidence |
|---|---|---|
| T1 `node --test` (before) | PASS | 54/54. The tests assert real values, not just "no throw". |
| T1 `node --test` (after) | PASS | **74/74**: 54 original + 20 in the new `tests/chase-adversarial.test.mjs`. |
| CH-U1 validator | PASS | ADV-VALID: 79 rapid / 39 multi / 2 or 4 options / answer 3, "1" or 1.5 / steps 2 / startStep 1 and 6 / case-duplicate options and questions / control-char-only text / non-object items all rejected in plain English. 80/40 accepted. A 2000-case junk fuzz threw no TypeError. A `__proto__` settings key does not pollute `Object.prototype`. |
| CH-U2 Cash Builder | PASS | ADV-CB: the question in flight after the buzzer counts once (correct → 4000, wrong → 3000); waving it away banks 3000; a second in-flight mark is refused; a paused clock cannot expire or take marks. |
| CH-U3 offers | PASS (rule note, D5) | ADV-OFFER: 333/2 → 167; the low offer is never below 1; boards of 12 steps place 11/10/9; prototype-named choices are ignored. With $0 built the offers are $5,000 / $0 / $1,000 (see D5). |
| CH-U4 movement | PASS | ADV-H2H: 500 seeded chases on 7/9/12-step boards and every offer, checked step by step against a hand-written model. Every catch and home matches. The Chaser can never be revealed first. If the contestant gets home on the same question the Chaser would catch them, **home banks first** and the Chaser is not revealed. |
| CH-U5 head start | PASS | 0 home → no Final Chase ("takes the lot"); 1/2/3/4 home → 1/2/3/4; `minHeadStart: 2` lifts a lone finalist to 2. |
| CH-U6 Final Chase | PASS (rule notes, D3/D4) | Pushback correct/incorrect; junk `correct` values ignored; at 0 steps a pushback does nothing; a Pass is not offered; time running out during a pushback means the team wins. Both endings work. |
| CH-U7 bank split | PASS | The split adds up to the bank exactly. 10001 between 3 → 3334/3334/3333. Each standings row equals its share. A caught contestant gets $0 when the team wins. |
| CH-U8 undo / illegal / immutable | PASS | ADV-UNDO: undo works across h2h → offer → Cash Builder, home → pending, nextContestant → interstitial, result → finalChaser (clock running again), standings → result; history never nests. ADV-IMMUTABLE: a whole night runs on deep-frozen states. ADV-PROTO: prototype-named event types and a `__proto__` event payload change nothing. |
| CH-U9 content | PASS (2 fixes) | 40 rapid-fire + 20 multiple-choice questions drawn at random from `questions.json` were all correct (R193, "most active volcanoes → Indonesia", is the usual quiz answer but disputable). Both library sets skimmed in full: 2 errors fixed (D6). |
| CH-U10 leak test | PASS | ADV-LEAK is a differential test. The same game is run with the hidden lock set to 0, 1 and 2, and every other pid (p1–p3, the Chaser, a ghost) must get byte-identical views at every step before the reveal. `answer` is never sent before both reveals. A full night (all phases, pushback included) never puts a rapid-fire question or answer in any phone view. |
| CH-I1…I6 harness | PASS | `tests/harness.html`: **All 63 checks passed**, before and after my fixes. |
| T4 standalone, host as Chaser, 3 manual players | PASS | `?store=t`, 1280×720: Ada home ($4,000, in-flight correct counted), Ben caught (higher offer $10,000), Cleo $0 built → lower $1,000 → home. Final: head start 2, team 6. **Ending 1:** caught, result reads "with 114 seconds to spare". **Ending 2** (after undo): team wins $5,000, split $2,500 / $2,500. Hotkeys Enter / Space / W / P worked. |
| T4 reload at every phase | PASS after fix | Cash Builder mid-clock → resumed **paused** at 0:54. Interstitial, h2h with one lock pending, Final team mid-clock (1:52, paused) all restored. A reload *after* the deadline had passed got stuck before the fix (D1). |
| T4 undo | PASS | Undo of a Chaser reveal; undo from the result back to the Chaser's half. |
| X-1 game lobby | PASS | `btn-game-lobby` is in the toolbar and the confirm is `role="dialog"`. Keep → reload → **Resume**: the resumed core JSON is identical to the parked one (mid-h2h, lock pending). Start over: core and resumable both null; roster (Ada/Ben/Cleo), questions and rules kept; Resume hidden. |
| X-2 library | PASS | The picker lists Kids' night and Movies & TV and loads both (88/43 and 83/43). The source note reads "set: Kids' night". The file's settings are adopted (Kids' $500 Cash Builder). |
| X-3 editor | PASS | Download → `questions.json` and Download for the library → `the-chase-kids-night.json` both validate. The manifest line and commit path are shown. A broken draft blocks the download with a plain message. Use in game → source "Custom questions (from the editor)". |
| V8 `?game=URL` vs save | PASS | The URL won over the editor save; reloading the same URL kept the game in progress. `?game=README.md` (not JSON): "Could not load questions from README.md: Unexpected token '#'… Keeping the questions you already had." A corrupt save: "Your saved game couldn't be read, so it was cleared — this night starts fresh." |
| 1280×720 / 1280×676 no scroll | PASS | `scrollHeight == innerHeight` on setup, cash, offer, board, interstitial, finalTeam, finalChaser, result and standings at both sizes. No leaf text was clipped below the viewport at 676. |
| T3 secret locks (hub, 2 real phones) | PASS | Zoe (contestant) locked B and Max (Chaser-as-player) locked C from the phone option buttons. The host DOM showed only "Locked in" / "Locked in"; option rows had no marks; no `value`, `data-*` or `aria-pressed` attribute carried an index. Reveal order contestant → Chaser: "B — correct", then "C — wrong". `answer` reached both phones only after the second reveal. |
| T3 clocks in sync | PASS | Cash Builder: host / phone A / phone B 0:59 / 0:59 / 0:59. Final team: 1:59 on all three. |
| T3 phone reload mid-question | PASS | Phone A reloaded with its lock on: back to `answer`, myLock 1, "Locked in". Same for phone B (Chaser). |
| T3 `⌂ Lobby` and back | PASS | Lobby → "Leave The Chase? Its progress is saved…" → Back to lobby → Play The Chase again → h2h restored at the same positions; both phones back on answer/chaser. |
| T3 night scoreboard | PASS | Zoe home ($2,000), Ann (manual) home ($1,000), team won. Hub "night's scoreboard": Ann 1500, Zoe 1500. |
| T3 phone layout | **FAIL → fixed** | D2: the host setup screen rendered on every phone. |
| Phone 320×640 targets | PASS | Option buttons 56 / 56 / 56 px high; `scrollWidth == innerWidth` (after D2 fix). |
| Reduced motion | PASS | CSSOM walk: no `@keyframes`, `animation` or `transition` outside `prefers-reduced-motion: no-preference` in any Chase stylesheet. |
| Contrast | PASS | Runtime walk of every visible text node on every screen. Gradient stops under marker text: white on #2f6fd0 4.9 / #12336e 12.2; #fff2f2 on #d10000 5.2 / #5a0000 13.4. Interstitial text ≥ 5.7 on both stops. No solid-background pair failed. |
| #d10000 never as text | PASS | No element's computed `color` is rgb(209,0,0) on any screen. In CSS, #d10000 / `--accent` are used only as fills and borders. |
| V1 | PASS | 74/74. |
| V2 | PASS | Largest files: test 790, harness 774, rules 689, adversarial 587. No function over ~50 lines (`SCREENS` in chase-phone.js is an object of short methods). |
| V3 | PASS | Matches only in comments ("never innerHTML") and in the harness's own banned-word regex. |
| V4 | PASS | No `console.log`. |
| V5 | PASS | Code read: `chaseSerialise` holds core / resumable / game / setup / source / roomCode only. Room, clock and timer handles live in closures. |
| V6 | PASS | Only Google Fonts in `index.html`. PeerJS comes in via `shared/`. A local harness URL appears in the README text. |
| V7 | PASS | `<body data-gsc-game="the-chase">`, `#gsc-join`, and `player-mode` / `gsc-embedded` toggled in `chaseBoot`. |
| V8 | PASS | Code read: `?game=`, file upload, library and editor all go through `validateGame`. Browser check in the row above. |

**Security read.** Every phone message goes through `validatePhoneMsg`, which
returns a narrow copy: only `{t:"ready"}` or `{t:"lock", idx 0–2}` survive.
3000 fuzzed frames confirmed this. `lockSideFor` then rechecks the sender, and
the reducer checks it a third time. Phones cannot mark, reveal, move or offer.
All text reaches the page through `textContent`. `?store=` is sanitised to
`[A-Za-z0-9-]{0,24}`. Handler, hotkey and cue lookups use `hasOwnProperty`.
`?game=` can fetch any URL, but the content is validated and rendered as text
only, the same as every other game.

## 3. Defects

| # | Sev. | Where | Repro | Status |
|---|---|---|---|---|
| D1 | **major** | `js/chase-app.js:176` `chasePauseRestored` | Start the Cash Builder clock. Close the tab, or reload after the deadline has passed (the save's `deadline` is in the past). On restore the clock is frozen at `remainingMs: 0, running: false`. In that state the reducer refuses `cbStart`, `cbExpired`, `cbMark` and `nextQuestion` (pinned in ADV-CB), so the screen shows "0:00 Paused." with every button dead; only Undo or End the night get out. In the Final Chase, End the night then awards the **Chaser** a win the team had earned. Also reachable through Keep this game → Resume. Reproduced in the browser. | **Fixed** (+2 lines): a clock already past its deadline stays running, so the clock loop fires the expiry. After the fix, the same repro reads "Buzzer — judge the question in flight", with the judge buttons and "End the Cash Builder" live. Harness still 63/63. |
| D2 | **major** | `index.html:34` (`#screen-setup` has no `hidden`) + `css/chase-phone.css` | Join through the hub on a phone (320 px). The host's whole setup screen (team, Chaser mode, rules inputs) shows beside the phone card. The phone card is squeezed into a narrow column and the page scrolls sideways. Host screens are only hidden by `ChaseView.render`, which never runs on phones. The harness missed it because it reads phone text through `ChasePhone`, not layout. | **Fixed** (+2 lines in `css/chase-phone.css:18-19`): `body.player-mode .screen:not(.screen-phone) { display:none !important; }`. After the fix: setup `display:none`, `scrollWidth == innerWidth`, options 56 px. Suggest a harness check for this. |
| D3 | minor (rule) | `js/chase-rules.js:528-549` | The spec says "every Chaser miss is offered to the team". The implementation offers the question only on **Wrong**; a **Pass** is counted and skipped. The host can work around it by pressing Wrong. | Not fixed. Proposed: treat `pass` like `wrong` (open a pushback), or document the choice in the README and the spec. |
| D4 | minor (rule) | `js/chase-rules.js:567-578`, `528` | (a) On the show the Chaser's clock stops while the team answers a pushback. Here it keeps running (marks are blocked, but time drains) unless the host presses Enter, and expiring mid-pushback hands the team the win. (b) A pushback with the Chaser on 0 is simply wasted; on the show it adds a step to the team's target. | Not fixed. Proposed: pause the Chaser's clock when a pushback opens and resume it on `pushback`. For (b), either `teamSteps + 1` when `chaserSteps === 0`, or document the choice. |
| D5 | minor (rule) | `js/chase-rules.js:266-267` | With $0 built the offers are higher $5,000 / middle $0 / lower $1,000. The **lower** offer pays more *and* starts nearer home, so it dominates the middle. The view's note ("so it is high or low") admits it, but the middle button is still offered. | Not fixed. Proposed: hide or disable the middle offer when it is $0, or make the low offer $0 (or negative, as on the show). |
| D6 | minor (content) | `sets/kids.json:36`, `sets/movies-tv.json:140` | Kids: "Which **sea** animal … slow walk on land? → The tortoise" (a tortoise is a land animal). Movies: "the **line**-dancing penguin Mumble" (Mumble tap-dances). | **Fixed**: answer → "The sea turtle"; question → "tap-dancing". Both sets still validate. |
| D7 | minor | `js/chase-core.js:395` `resultSub` (phone) | After a catch every phone read "caught the team with **0** to spare": steps minus steps is always 0 at a catch. The host screen correctly showed seconds. | **Fixed** (1 line): uses `secondsLeft(final.chaserClock)` → "… with N seconds to spare". Pinned in ADV-FINAL. |
| D8 | minor | `js/chase-view.js:449` | "pushed back 1 times". | Not fixed (cosmetic): singular/plural. |
| D9 | minor (edge) | `js/chase-rules.js:542` | With `minHeadStart: 0` and `headStartPerMember: 0` the team can reach the Chaser's half with a target of 0. The Chaser has "caught" them already, but a catch is only checked on a correct mark, so letting the clock run out gives the team the bank. | Not fixed. Proposed: check the catch on `finalChaserStart` (or require a target of at least 1). |

Diffs I applied:

```diff
--- js/chase-app.js  (chasePauseRestored)
     if (!clock) return clock;
+    // Already past its deadline: leave it running so the clock loop fires the expiry.
+    if (clock.running && clock.deadline && clock.deadline <= Date.now()) return clock;
--- css/chase-phone.css
 body.player-mode .screen-phone:not(.hidden) { display: flex; }
+/* Tester fix: the host setup screen starts visible in the markup; a phone never shows it. */
+body.player-mode .screen:not(.screen-phone) { display: none !important; }
--- js/chase-core.js  (resultSub)
-      Math.max(0, out.teamSteps - out.chaserSteps)} to spare.`;
+      secondsLeft(state.final ? state.final.chaserClock : null, 0)} seconds to spare.`;
--- sets/kids.json:36        "a":"The tortoise"  →  "a":"The sea turtle"
--- sets/movies-tv.json:140  "line-dancing"      →  "tap-dancing"
+++ tests/chase-adversarial.test.mjs (new, 20 tests)
```

`questions.json` and `js/data.js` needed no correction, so they are untouched
and still identical (CH-U9).

**Judging the implementer's rule choices.**
- Pause events (`cbPause` / `finalTeamPause` / `finalChaserPause`): sensible,
  kept out of undo, freeze correctly. Accept.
- The chase ends at home without revealing the Chaser: consistent with "home
  banks first". Accept.
- Judging the question in flight after the Cash Builder buzzer: matches the
  show, exactly one mark. Accept.
- Pushback only on Wrong: deviates from the spec's "every miss" (D3).
- Offers when $0 was built: the low offer dominates the middle (D5).

## 4. Verdict

**fix-then-ship → shippable with my fixes applied.** Before testing, the
component had two majors:
- D1: a restore after the deadline froze the round dead and could give a won
  Final Chase to the Chaser.
- D2: every phone in the hub showed the host's setup screen beside the phone
  card at 320 px.

Both are fixed with ≤ 2-line changes and verified live; harness 63/63 and 74/74
unit tests are green. The core is solid:
- 500 model-checked chases, a differential leak test across every pid and
  phase, deep-frozen and prototype fuzzing all clean;
- secret locks held over the real PeerJS network with a Chaser-as-player;
- the night scoreboard received the exact split.

Remaining: rule-fidelity minors (D3 Pass not offered as a pushback, D4 clock
runs during a pushback and a pushback at 0 is wasted, D5 the $0 middle offer,
D9 a zero-target Final Chase) and one cosmetic (D8). The orchestrator should
send D3–D5 and D9 to the implementer, or record them as documented choices in
the README's known issues.
