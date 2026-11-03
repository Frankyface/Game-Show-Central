# 1 vs 100: verification report

Component `one-vs-100` · spec `docs/16-one-vs-100-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` · independent tester (I did not write this code).

## 1. Environment

- Windows 11 Home 10.0.22635, Node 24, Python `http.server` on 127.0.0.1:8734.
- Browser: the desktop app's built-in Chromium pane, at viewports of 1280×720 and 1280×676, with one tab of my own. Phones ran as 320×640 iframes inside that tab.
- Real PeerJS broker for T3. The broker was reachable, so nothing is BLOCKED-ENV.
- Date: 2026-11-03.

## 2. Results

| ID | Result | Evidence |
|---|---|---|
| T1 `cd games/one-vs-100 && node --test` | **PASS** | 86/86: the implementer's 43 plus my 43 in `tests/ovh-adversarial.test.mjs`. Two of mine failed before my fixes (D2, D3). The repo-root `node --test` gives 1395 tests, 1393 pass, 0 fail. |
| O-U1 validator | PASS | Fuzz rejects all of these: 29 questions, 4 options, 2 options, answer 3/-1/"0"/0.5, level 11/0/"3", blank or 201-character q, duplicate options (case/space), a non-string option, null or array rows, an empty, decreasing, zero, fractional or 21-long ladder, answerSeconds 121, bonus 0.5 or 11, mobSize 0, an unknown help, a non-boolean help, currency "EURO", `settings: []`, a numeric title, and the junk roots. Control characters are stripped. `__proto__` keys are harmless. |
| O-U2 elimination and bank maths | PASS | A simulated Mob of 100 loses 3 a question over Q1–Q12. The bank equals the ladder sum, and Q11 and Q12 pay the repeating 10 000. A one-value ladder repeats from Q1. Zero wrong earns 0 and the game continues. |
| O-U3 non-answer = wrong | PASS | Phone Mob of 5, three silent: 4 eliminated, $400. An answer after `closeMob` or after the deadline (`now > deadline`) is rejected. An answer exactly at the deadline counts, which is documented. |
| O-U4 contestant wrong → 0, split | PASS | `won` 0. Wrong Mob members on that question stay out. Survivors get `floor(bank/survivors)`: 300/7 → 42, 3700/21 → $176 live in the browser. With zero survivors the bank is lost and the notice says so. A wrong answer on Q1 gives 0 each. |
| O-U5 walk | PASS | Refused before Q1, mid-question and after the lock. Allowed only in `decision`, after a correct reveal. `finish` mid-question banks what a walk would pay. |
| O-U6 wipe-out bonus | PASS | Bank including the last question × multiplier (700 → 1400). 1.5× rounds. 1× pays the bank. Live: "The Mob is wiped out, $200". |
| O-U7 helps, Trust | **PASS after fix D2** | Each help works once per game, only between Mob close and the contestant's lock, and never when disabled in settings. Trust locks the majority. **On a tie it took the first option, but nothing told the host.** Fixed: a notice now says so. Live check: a 21/21/21 split showed "The Mob is tied, so Trust took A, the first tied option." |
| O-U8 simulated Mob | PASS | Size 0/101/-1/1.5/"7"/NaN/∞ is refused. Wrong count > survivors is refused (4 > 3), as are -1/2.5/"3". Wrong answers spread over both wrong options (5 → 3/2). Phones in the room cannot answer for a simulated Mob. `simulateMob` is refused for a phone Mob. |
| O-U9 undo / illegal / immutable | PASS | Undo across phases (setup → … → result) restores every earlier step exactly. Undoing a running window returns it paused with its time and answers. Standings → result → decision works. A deep-frozen state survives every event in every phase. Prototype-shaped types (`toString`, `__proto__`, `constructor`, …) and junk events return the same state. |
| O-U10 leak | PASS | Mob views have a whitelisted key set at every step before the reveal: no `answer`, `answers`, `correct`, `poll`, `counts`, `eliminated` or `ask`, and no other pid. The contestant sees no options while the Mob answers and no split before Poll (Ask and Trust do not leak it). Host option votes stay `null` until Poll or reveal, and host tiles never show letters. |
| Phone-message fuzz | PASS | 21 junk frames → null, plus a 2000-iteration sweep. A 100 kB extra field is stripped to `{t,idx}`. |
| Late joiner (core) | PASS | `p99` cannot answer and gets `wait` with no options. `seat` mid-game is refused. |
| T2 `tests/harness.html` | **PASS** | 66/66 before my changes and 66/66 after (tab in front). See D6 and D7 for two environment-sensitive checks that failed once each. |
| T4 simulated full game (standalone `?store=t`) | PASS | Mob of 100, 37 wrong on Q1. Poll showed 19/18/63; Ask named "Mob 55, chose C" and "Mob 5, chose A". Lock and reveal gave $3,700 and 63 left. Q2 was wrong: lose, 21 survivors at $176, then standings and play again. |
| T4 reload mid-window | PASS | Reloaded with 14 s left: "Paused with 14s left." It was still 14 s two seconds later. The button read "Resume the Mob window" and resumed at 13 s. |
| T4 undo | PASS | Undo after the reveal gave back the question, unrevealed, with $0. Repeated undo stepped back through Trust, close and simWrong. |
| X-1 game lobby | PASS | `btn-game-lobby` opens a `role="dialog"`. **Keep** goes to setup with Resume shown and Start reading "Start a new game"; Resume restores state byte-identical (`JSON.stringify` equal). **Start over** clears core and stash and keeps the roster and questions. Embedded: works from the hub frame. |
| X-2 library | PASS | The picker lists "Kids' night" and "Movies & TV". Both load and validate, and the source note reads "set: Kids' night" / "set: Movies & TV". |
| X-3 editor library download | PASS | Download JSON produces `questions.json`, which re-validates. Download for the library produces `1-vs-100-movies-tv.json` plus a manifest line, which `GSCLibrary.parseManifest` accepts. A blank draft is refused with a plain-English reason, for both download and Use. Use applies the edited title. |
| V8 `?game=URL` vs save | PASS | A URL wins over a save from another source, and the game in progress is cleared with a message. Reloading the same URL keeps the save. `?game=index.html` gives "Could not load questions … not valid JSON. Using the built-in set instead." Bad JSON and a 1-question file are refused on upload with messages. |
| 1280×720 / 1280×676 play | **PASS after fix D1** | Page scrollHeight equals the viewport on play, result and standings. **The Mob grid itself hid its last rows:** at 100 tiles by 25 px at 720 and 69 px at 676, and 36–40 tiles also overflowed. Fixed (D1). Now 16/35/36/40/100 tiles fit at 676, with the sim form open and closed. |
| Setup scroll in the hub frame | minor (D8) | The setup screen is 710 px in a 628 px hub frame (82 px of scroll at a 676 px viewport, roughly 38 px at 720), not the "20 px" the implementer reported. Standalone 676: 37 px with an error banner. Setup only. Play screens never scroll. |
| T3 Mob phone answers in the window | PASS | Real broker, room 4Y4W, phones Mia, Cass and Neo. Mia's tap made the host read "Answered 1/1" and the tile `is-answered`. The phone showed the button pressed, disabled, and "Answer in — good luck." |
| T3 contestant locks only after close | PASS | While the window was open Cass saw "The Mob is answering. You are up next." with no buttons. After close she saw options plus the Poll ("The Mob said 0/1/0"), and her phone lock reached the host. |
| T3 eliminated phone | PASS | Mia out on Q1: on Q2 she saw "You're out / Q1 / 1/2" with no buttons. A raw `me.send({t:"mob",idx:0})` left the answers `{}`. |
| T3 phone reload mid-window keeps the answer | PASS | Reloaded Neo's phone with 7 s left. It returned pressed and disabled on its earlier answer. One limitation: all phones shared one origin's localStorage, so only the last-joined phone could auto-rejoin. That is a test-rig artifact, and I rejoined by name. |
| T3 `⌂ Lobby` and back | PASS | The confirm "Leave 1 vs 100?" → Back to lobby, then Play 1 vs 100, restores setup with the roster. |
| T3 night scoreboard | PASS | "Tonight's scoreboard: Cass 200" after the wipe-out. After a second game (walk, $100) it shows Cass 100: the hub keeps the latest standings per game, by design (`HubNight.recordScores(night, activeGame, …)`). |
| T3 late joiner, next game | **FAIL (D4)** | Neo joined during the result screen and saw "Neo joined — they can play from the next game." After Play again, Neo is **not** on the setup roster, even after a phone reload. Only remounting the game frame (hub lobby and back) adds him. |
| Phones 320×640 | PASS | Choice buttons are 56 px high (80 px for two-line options) and 275 px wide. No horizontal scroll on `mob-answer`, `contestant`, `mob-eliminated`, `result` or `wait`. |
| Reduced motion (CSSOM walk) | PASS | Every `@keyframes`, `animation` and `transition` in the game sheets sits inside `prefers-reduced-motion: no-preference`. The only outside hit is the shared `theme.css .btn` colour transition, which is not motion and not owned here. |
| Contrast (both gradient stops) | **PASS after fix D5** | A runtime walk compositing every gradient stop found no host failures (setup, play open/closed, reveal, lobby modal). Phone: the pressed choice letter was cyan on the gold stop at **3.3:1**, and the player's own pick was dimmed to `opacity:.45` because it is disabled. Fixed (D5). No white text sits on the cyan anywhere. `shared/theme.css` already carries the one-vs-100 block with `--accent-ink: #04161d`. |
| Small text | minor (D9) | Host labels are 9.9–11.5 px (`.help-state` "ready/used" 9.9 px, `.top-k`, `.q-cat`). Seat numbers are 12.5 px on 31 px tiles at 36–100 tiles, and 16 px on 61 px tiles at 16 tiles. Readable at 1280, small for a projector. |
| V1 | PASS | 86/86. |
| V2 | PASS | Largest files: `ovh-core.js` 734 lines, `ovh-app.js` 716. No function over 50 lines (awk scan). |
| V3 | PASS | Zero innerHTML/insertAdjacentHTML/outerHTML=/document.write/eval(/new Function in `games/one-vs-100`, tests included. My suite reads `data.js` with `vm.runInNewContext`. |
| V4 | PASS | No `console.log`. |
| V5 | PASS | Code read: state holds no Peer, connection, DOM or timer handle. The clock is a module `let`; the room is a closure. |
| V6 | PASS | The only URLs are Google Fonts. |
| V7 | PASS | `<body data-gsc-game="one-vs-100">`, `#gsc-join`, and the `player-mode`/`gsc-embedded` classes are set in `ovhBoot`. |
| V8 | PASS | URL, upload, library and editor all go through `validateGame`. |
| Security read | PASS | Phone frames are validated to `{t,idx}`. Intent lookup uses `hasOwnProperty`. Only the contestant may `lock`. The reducer re-checks phase, membership, aliveness, one answer each and the deadline. All DOM uses textContent. Download names are slugged. Storage is namespaced by `?store`. |
| Content | PASS | All 60 default questions fact-checked; every marked answer is correct. Both library sets (30 each) skimmed and correct. No edits were needed. `data.js` deep-equals `questions.json` (adversarial test). |

## 3. Defects

| # | Sev | Where | Repro | Status |
|---|---|---|---|---|
| D1 | major | `css/ovh.css:326`, `js/ovh-view.js:195` | Play with a 100 Mob at 1280×676: the grid scrolls internally and rows 9–10 are hidden. The same happens with 36–40 tiles below the `is-big` cut-off. | **Fixed.** Big tiles `minmax(2.4rem)` → `minmax(1.9rem)` (13 columns, 31 px tiles), and the cut-off `size > 40` → `size > 35`. Measured to fit at 676 with the sim form open or closed. |
| D2 | major | `js/ovh-core.js:606` (`evUseTrust`) | Mob split B 2 / C 2 / A 1 → Trust locks B, and nothing on screen says it was a tie. Spec O-U7 requires the tie to be "flagged for the host". `majorityIsTied` existed but nothing used it. | **Fixed** (+2 lines): on a tie the notice reads "The Mob is tied, so Trust took X, the first tied option." Pinned by the adversarial test. |
| D3 | minor | `js/ovh-core.js:489` (`evOpenQuestion`) | A window paused with 0 ms left (a save written at the deadline before the 250 ms tick, or an undo of a timed-out close) resumed with `deadline: null`, which is an untimed window with "No clock". | **Fixed** (1 line): `deadline: seconds > 0 ? at + max(0,left) : null`, so it expires and closes at once. Remaining nuance for the implementer: after undoing an auto-close the host gets a 0 s window. Consider giving back a short grace. |
| D4 | major | `js/ovh-room.js:31-43`, `js/ovh-app.js:517` | Phone joins during a game and sees "can play from the next game". The host presses Standings → Play again (or Game lobby → Start over). The phone is missing from the setup roster, and a phone reload does not add it either (`onPlayerStatus` only pushes views). | **Open (sent back).** Proposed fix: in the `subscribe` callback, when `state` is null, add every connected non-manual `room.players()` entry missing from `setup.players` (skip names already taken) via `OvhApp.addPlayer(name, pid, false)`. |
| D5 | minor | `css/ovh-phone.css:80-82` | Phone, after picking: your own (pressed) choice is disabled, so it renders at 45 % opacity, and its cyan letter on the gold top stop is 3.3:1. | **Fixed** (+2 lines): the pressed and disabled choice keeps opacity 1, and the pressed letter uses `--ink`. |
| D6 | minor | `tests/harness.html:610-613` | O-I6 "storage is namespaced" fails whenever a real (un-namespaced) host has played on the same origin, for example after an embedded hub game. The check asserts `localStorage.getItem("gsc-ovh-state-v1") === null`. | Open. Proposed: snapshot that key before the run and assert it is unchanged. |
| D7 | minor | `tests/harness.html:306-308` | O-I2 "answered Mob phone cannot answer twice" failed once with `mine=null` while the harness tab was in the background (throttled timers). It passed on the rerun in front. | Open. Proposed: wait for the phone view to update before asserting. |
| D8 | minor | `css/ovh.css` (setup) | Setup is 710 px tall in the hub frame, giving 38–82 px of scroll, not the documented 20 px. | Open (README known issue). |
| D9 | minor | `css/ovh.css` (`.help-state`, `.top-k`, `.q-cat`, big tiles) | Host text at 9.9–12.5 px is small for a projector. | Open. |
| D10 | minor | `js/ovh-view.js:307` | The win copy says "The bank, doubled." even when `bonusMultiplier` is not 2. The money lines show the correct ×N. | Open. Proposed: build the sentence from the multiplier. |
| D11 | minor | `js/ovh-editor.js:297` (`ovhSlug`) | A set titled "Index" downloads as `index.json`, and the recipe tells the host to commit it over `sets/index.json`. Also, after "Start blank" the previous library recipe stays visible. | Open. Proposed: reserve `index` (for example `index-set.json`), and hide the recipe on reset or blank. |
| D12 | minor | `js/ovh-phoneview.js` (`deadline`) | Phones count down from the host's absolute `deadline`, so device clock skew shifts the phone's "Ns left". This is cosmetic; the host is authoritative. | Open. Could send `msLeft` instead. |
| D13 | minor | `js/ovh-room.js` (`reportProgress`) | After a loss where `each` is 0 (for example a wrong answer on Q1), surviving Mob members are not reported to the hub scoreboard. Spec: survivors' names "go to the hub scoreboard as winners". | Open. |

### Diffs I applied (all under `games/one-vs-100/`)

```diff
js/ovh-core.js  evOpenQuestion
-        deadline: left > 0 ? at + left : null,
+        deadline: state.q.seconds > 0 ? at + Math.max(0, left) : null,   // 0 s left still expires
js/ovh-core.js  evUseTrust
-    return spendHelp(state, "trust", { trust: true, locked: idx });
+    const next = spendHelp(state, "trust", { trust: true, locked: idx });
+    return majorityIsTied(state)
+      ? Object.assign(next, { notice: `The Mob is tied, so Trust took ${LETTERS[idx]}, the first tied option.` }) : next;
css/ovh.css:326
-.mob-grid.is-big { grid-template-columns: repeat(auto-fill, minmax(2.4rem, 1fr)); }
+.mob-grid.is-big { grid-template-columns: repeat(auto-fill, minmax(1.9rem, 1fr)); }   /* 100 tiles fit at 1280x676, sim form open */
js/ovh-view.js:195
-    grid.classList.toggle("is-big", size > 40);
+    grid.classList.toggle("is-big", size > 35);   // 36-40 normal tiles overflowed at 1280x676
css/ovh-phone.css (after .phone-choice[disabled])
+.phone-choice[aria-pressed="true"][disabled] { opacity: 1; }          /* your own pick stays readable */
+.phone-choice[aria-pressed="true"] .phone-letter { color: var(--ink); }  /* cyan on the gold stop was 3.3:1 */
```

New file: `games/one-vs-100/tests/ovh-adversarial.test.mjs` (43 tests).

### Judging the implementer's rule choices

- **Wrong-answer Mob members stay out:** accepted. It matches the spec's "every Mob member who answered wrong is eliminated".
- **Survivors split rounded down:** accepted.
- **Bank lost if nobody survives:** accepted, and the screen says so.
- **×2 wipe-out bonus including the last question's money:** accepted.
- **Window resumes paused after a reload:** accepted (triage clock rule). With D3 a 0 s window can no longer turn untimed.
- **Closing the window when everyone has answered** is a host action, not automatic. The spec says "the host closes it early", so this is accepted.

### Orchestrator items from the implementation report

Both are already done on `main`: `shared/theme.css` has the `[data-gsc-game="one-vs-100"]` block with a dark accent ink, and `tests/core-prototype-guard.test.mjs` lists this core. Still missing: there is no `css/hub-art.css`, so the hub card art the implementer mentions has nowhere to go. Hub owner to confirm.

## 4. Verdict

**Fix-then-ship.** The rules, money maths, leak guarantees, undo, the lobby or library or editor flows, and the real-network Mob play all hold up under adversarial testing. Every marked answer in the content is correct. I fixed three majors or minors in place: the hidden Mob-grid rows, the unflagged Trust tie and the untimed 0 s window. One major remains: **D4**, where a mid-game joiner is never added to the next game despite the on-screen promise. It is a small change in `ovh-room.js` and should land before release. The rest are minors for the README known issues or a polish pass.
