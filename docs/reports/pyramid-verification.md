# Pyramid — verification report

Component: `pyramid` · Owns `games/pyramid/**` · Spec: `docs/11-pyramid-spec.md`
Tester: independent (did not write the code) · Report format: `docs/06-verification-plan.md` §5

---

## 1. Environment

| | |
| --- | --- |
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app browser), viewport emulation 1280×720 (host) and 320×640 (phones) |
| Server | `python -m http.server 8695 --bind 127.0.0.1` from the repo root |
| Date | 2026-09-04 |
| Broker | live PeerJS broker reachable — **no BLOCKED-ENV** anywhere in this run |
| Under test | `games/pyramid/**` at the state committed on `main` before this report |

Suites run: `cd games/pyramid && node --test` (unit), `games/pyramid/tests/harness.html`
(loopback), `games/pyramid/index.html` standalone (T4), the hub at `/` with two real
phone tabs over PeerJS/WebRTC (T3), plus a static/security read (T5).

New adversarial tests added by this tester:

- `games/pyramid/tests/pyr-adversarial.test.mjs` — 29 cases, A1…A6 (the rules)
- `games/pyramid/tests/pyr-hostile.test.mjs` — 24 cases, A7…A11 (hostile input)
- `games/pyramid/tests/pyr-fixtures.mjs` — shared builders + the leak assertion
  (split out only so every file stays under the 800-line house cap)

`cd games/pyramid && node --test` → **92 tests, 92 pass, 0 fail** (39 shipped + 53 new).
`node --test` at the repo root → **0 failures** (678/678 when I started, 751/751 on the final
re-run — other components' suites were growing concurrently). No regression elsewhere.

---

## 2. Results

### T1 — unit (`node --test` in `games/pyramid`)

| ID | Result | Evidence |
| --- | --- | --- |
| Y-U1 validator | PASS | 6 shipped cases green; my A8 fuzz adds 41 more rejections (6-vs-7 words, 8 words, case- and space-folded duplicate words, 11 categories, circles of 5 and 7, one circle set, repeated subject, blank subject, 51-char subject, `categories` as a string, `circles` as a number, `settings` as an array, a category that is a string, numeric/null/empty words, boolean title, fractional and out-of-range clocks, fractional/zero box values, 13 words per category, 7 categories per team, string grand prize, string `swapRoles`, over-long labels/titles/hints/words, `categoriesPerTeam:6` with 12 categories) — every one throws a plain-English sentence |
| Y-U2 word cycling with passes | PASS | `A2 passes cycle for ever…`: three full laps of passes return the queue in order; `remainingWords` matches the order the cursor actually walks |
| Y-U3 illegal removes the word | PASS | `A2 …an illegal in the middle removes exactly one word`: the doomed word never reappears in six further passes, `wordCount.left` 4→3, score 0 |
| Y-U4 clock expiry finishes the in-flight mark | PASS | `A3 the buzzer while a mark is in flight`, run for all three verdicts: after `clockExpired` the round is **not** finished, the giver still holds the word, the next mark closes it, and a second mark and a restart are both refused |
| Y-U5 scores and tiebreak | PASS (after Y-1 fix) | `A4` ×5. Defect **Y-1** found here and fixed — see §3 |
| Y-U6 role swap | PASS | `A5`: `swapRoles:true` gives A `p1,p2,p1` and B `p3,p4,p3`, `false` gives `p1,p1,p1` / `p3,p3,p3`; the rotation carries into the Winner's Circle (`p2` gives); `firstGiver:1` starts the other member; `toCircle{giver}` overrides |
| Y-U7 circle values / blocked boxes | PASS | `A6`: values `[200,300,400,500,800,1000]` in the spec's pyramid order, cursor starts on the cheapest; an illegal clue blocks a box, play carries on, `$200` already won is kept, the blocked box never returns in ten further passes, final `$2,900` for five of six |
| Y-U8 grand prize on six | PASS | `A6 all six … pays the grand prize INSTEAD of the box values`: `winnings === 10000`, explicitly `!== 3200`; both members' rows carry it, the other team's carry 0, total paid exactly once |
| Y-U9 undo / illegal events / immutability | PASS | `A9`: 21 events × 9 phase seeds against a **deep-frozen** state — no throw, no mutation, and every selector plus `phoneView` for 9 pids is read-only; a 50-event frozen replay end-to-end; 26 unknown/inherited/malformed events (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, string index, `NaN` index, `"Correct"`) all return the *same object*; non-finite `now` never produces a non-finite deadline |
| Y-U10 `phoneView` never leaks | PASS | `A1`: every pid (4 players, a spectator, `""`, `__proto__`, `constructor`, `toString`) × every phase × pick/start/pause/three marks/buzzer/undo/next, then the whole Winner's Circle. Asserts (a) no non-giver view contains any word, **any hint**, or any circle subject, and (b) **no** view — the giver's included — carries `board`, `game`, `history`, `round`, `circle`, `circleSet`, `tiebreakCat`, `words`, `boxes` or `outcome`. The giver's view carries exactly one word and no other |

Extra unit coverage beyond the spec's success states: `A7` (the phone protocol —
`validatePhoneMsg` refuses `illegal`, `ILLEGAL`, `" illegal "`, 24 junk frames, a
`__proto__` payload, and returns a fresh two-key copy; only the current giver's pid may
mark; a mark that slipped the gate still dies at the reducer), `A11` (roster validation,
the nightly draw, `categories.json` ↔ `js/data.js` equality, shipped-content hygiene).

### T2 — loopback harness

| ID | Result | Evidence |
| --- | --- | --- |
| Y-I1…Y-I6 | PASS | `http://127.0.0.1:8695/games/pyramid/tests/harness.html` → `#summary.ok`, **“All 57 checks passed.”** Re-run after my core fix: still 57/57 |

The harness's assertions are genuine: `Y-I1 THE HOST SCREEN DOES NOT CONTAIN THE WORD
(DOM text)` compares the giver frame's `#pyr-phone-word` against
`PyrCore.currentWord(state)` and then greps the host document's `textContent` for all
four words; `Y-I1 hiding them removes the nodes again, not merely their styling` asserts
`#pyr-word-panel.childNodes.length === 0`.

### T3 — real network, hub + two phones

Room `GAFP` on the live PeerJS broker; host tab plus two phone tabs at
`?room=GAFP` (320×640).

| Check | Result | Evidence |
| --- | --- | --- |
| Pyramid launches from the hub | PASS | `games/pyramid/index.html?embed=host&room=GAFP`; `#shell-bar` gets `data-gsc-game="pyramid"`, subtitle follows the game (`Never Sinks In` → `Winner’s Circle` → `Standings`) |
| Word on the giver's phone only | PASS | giver phone `#pyr-phone-word` = `Rubber duck`, kicker `You give · Never Sinks In`, `Theme: Things that float`; host frame `body.textContent` contained **none** of the seven words at any point; guesser phone: screen `guesser`, `word` field absent from the view object, zero action buttons, none of the seven words in its DOM |
| Got it / Pass from the phone advance | PASS | `Rubber duck` → Got it → `Cork` → Pass → `Iceberg`; host count `1 / 7`, statuses `correct, passed, pending…` |
| Host override wins | PASS | host `Illegal clue` marked the live word `illegal`; host `Undo` rolled it back to `pending`; both reflected on the phones |
| Guesser's phone cannot mark | PASS | `PyrPhone.me.send()` of `mark:correct`, `mark:pass`, `mark:illegal`, `pickCategory`, `finish` and the string `"junk"` from the **guesser's** phone left the state byte-identical |
| Clock in sync within 1 s | PASS | same millisecond window: host `0:22`, giver `0:22`, guesser `0:22`, all three carrying deadline `1788505848652` |
| Phone reload mid-category | PASS | reloaded the giver's phone, re-joined, got pid `p1` and its seat back, screen `giver`, current word `Iceberg`, Got it/Pass enabled |
| Circle on phones | PASS | circle giver: `circle-giver`, `Things in a picnic basket`, "Examples only. Describing the subject is an illegal clue."; circle guesser: `circle-guesser`, `"circleCategory" in view === false`, zero buttons |
| ⌂ Lobby and back | PASS | ⌂ Lobby opens the "Leave Pyramid?" dialog → Back to lobby returns to the lobby; the Pyramid tile re-enters the running game at phase `result`, `$10,000`, both phones still attached and showing the result screen |
| Night scoreboard gets the money for **both** team members | PASS | `#night-list` → `Ada 10000`, `Ben 10000`, `Cleo 0`, `Dev 0`; hub state `night.games.pyramid` carries all four rows with `pid` p1/p2 |
| BLOCKED-ENV | n/a | the broker was reachable; nothing faked |

### T4 — standalone, host-as-giver, 1280×720

| Check | Result | Evidence |
| --- | --- | --- |
| Full game host-only | PASS | four typed players, host-as-giver mode, six categories, Winner's Circle, prize card `$2,900` (blocked box) and, in a second run, `$10,000` all six; standings `Team A Ada & Ben 16 pts $0 / Team B Cleo & Dev 21 pts $2,900` |
| Nothing secret on screen by default | PASS | at every point in play, `document.body.textContent` contained none of the round's words; notice reads "Read the list to Ada privately, or press “Show words to me”." |
| Show words to me | PASS | word panel builds 4 children (warning, hint, current word, queue); the notice flips to `notice notice-warn` "The words are on this screen — everyone watching the share can read them."; toggling off leaves `childElementCount === 0` and the word absent from the DOM |
| Study mode (10 s) | PASS | panel shows "Study mode — hiding in 10s.", auto-hides after 10 s (`studyUntil: null`, `childElementCount 0`, word gone) |
| Shared-screen warning | PASS | panel header "Shared screen — the guesser must not be looking." on both the word panel and the circle panel |
| Hotkeys | PASS | Space/P/X mark, U undoes, Enter starts and pauses the clock, N advances |
| Hotkeys with an input focused | PASS | Space/P/X/U dispatched at a focused `<input>` changed nothing; the same keys at a focused `<button>` also changed nothing (no double-fire) |
| Reload mid-category | PASS | comes back `phase: play`, `Paused.`, `Resume`, `remainingMs 19917` of the 30 s, statuses preserved, `reveal:false`, no word in the DOM |
| Reload mid-circle | PASS | `phase: circle`, `Paused.`, `0:54` left, boxes `won, blocked, pending…`, running total `$200`, no subject in the DOM |
| Undo | PASS | undoes marks, steps out of a category back to the board, back into a finished round, out of the Winner's Circle, un-blocks a box and un-banks money (unit A10 plus live) |
| Editor Download (validates) | PASS | blob is `application/json`, 24 categories, passes `validateGame`; with one word blanked the button refuses with "Fix this before downloading: Category 1, word 1 is empty." and produces **no** file |
| Editor Use / Reset / Blank | PASS | Use adopts the draft (`Custom categories (from the editor)`, first word `Sunbeam`) and clears the finished game; blocked with the same sentence while broken; Reset restores `Honey`; Blank gives 12 empty rows and "Not playable yet: Category 1 needs a title." |
| `?game=URL` vs a save | PASS | with a save present, `?game=tests/fixtures/harness-game.json` wins (12 categories, `sourceUrl` set); reloading the **same** URL keeps the game in progress (`phase: play`, score `[1,0]`) |
| Bad JSON / missing file | PASS (see **Y-4**) | 404 → "Could not load categories from nope-not-here.json: the server answered 404. …"; a Markdown file → "…Unexpected token '#', "# Pyramid\n"... is not valid JSON. …" |
| File upload | PASS | `{"categories":[]}` → "That file is not a usable Pyramid game: A Pyramid game needs at least 12 categories; this file has 0."; non-JSON → parse error, same banner; a good file loads and the input is cleared. Upload and `?game=` both run through `PyrCore.validateGame` (V8) |
| 1280×720 no scroll in play | PASS | `scrollHeight === clientHeight` on board (720), play words hidden (720), play words revealed (720), round over (720), mainResult (720), circle (720), result (720), standings (720); embedded in the hub the same screens fit 676. Setup (817) and the editor scroll — allowed by the brief |

### T5 — static gates

| Gate | Result | Evidence |
| --- | --- | --- |
| V1 `node --test` exits 0 | PASS | 92/92 in the component, 751/751 at the repo root |
| V2 files < 800 lines | PASS | largest `css/pyr.css` 738, `js/pyr-core.js` 732, `tests/pyr-core.test.mjs` 724, `pyr-app.js` 687, `tests/harness.html` 677; my new files 532 / 522 / 169. No function over ~50 lines without a justification comment |
| V3 no `innerHTML` etc. | PASS | `rg` over the whole component: 3 prose comments and the harness's own gate regex (which the harness excludes by name); zero real uses |
| V4 no `console.log` | PASS | zero; `console.warn` only |
| V5 no Peer/DOM/timer in state | PASS | `pyrSerialise` whitelists `core, game, setup, usedIds, source, sourceKind, sourceUrl, roomCode`; `pyrRoundClock`, `pyrCircleClock`, `pyrStudyTimer`, `pyrSplashTimer`, the phone's `ticker` and the clock's `frame`/`safety` are all module-level; `reveal` / `circleReveal` / `studyUntil` / `editorOpen` / `phoneCount` are deliberately not persisted, so a reload never comes back with the words on screen (verified live) |
| V6 external URLs | PASS | only `fonts.googleapis.com` / `fonts.gstatic.com` in `index.html`; no CDN script at all (PeerJS is loaded by `shared/`) |
| V7 game id / `#gsc-join` / body classes | PASS | `<body data-gsc-game="pyramid">`, `#gsc-join` inside `#screen-phone`, `player-mode` and `gsc-embedded` toggled in `pyrBoot`; live: embedded run hid `#pyr-room-chip` and the standalone room controls |
| V8 one validator for every path | PASS | `?game=`, file upload, editor Use and editor Download all call `PyrCore.validateGame`; exercised live above |

**Security read.** Every phone→host frame goes through `PyrCore.validatePhoneMsg`, which
returns a freshly built two-key object or `null` — `illegal` is unreachable from a phone
by construction, and `pyrPhoneMark` re-checks the sender against `round.giverPid` /
`circle.giverPid` before the reducer, which checks the phase again. Host→phone traffic is
only ever `phoneView(state, thatPid)`; there is no state broadcast. The reducer's handler
lookup is `Object.prototype.hasOwnProperty` + `typeof === "function"`, so `{type:"__proto__"}`
is inert (unit A9). `normalizeGame` on a `__proto__`-carrying JSON file leaves
`Object.prototype` untouched (unit A8). All text reaches the DOM through `textContent`;
control characters and C1 controls are scrubbed by `cleanText` before anything is stored.
A corrupt `localStorage` entry is validated (`validateGame`) and shape-checked
(`pyrUsableCore`) before it is trusted, and a running clock always comes back paused. No
`eval`, no `new Function`, no dynamic script, no third-party endpoint. Nothing found.

### Design and accessibility

| Check | Result | Evidence |
| --- | --- | --- |
| 1280×720 readability | PASS | giant clock, `3 / 7` count and category banner all display-sized; the word-status strip carries a number, a glyph **and** a visually-hidden word ("got it" / "passed" / "illegal clue"), so colour is never the only signal |
| Phone 320×640 targets ≥ 56 px | PASS | live over WebRTC: Got it and Pass both measured exactly `56` px tall on the giver and the circle-giver screens; `documentElement.scrollWidth === 320` on giver, guesser, circle-giver and circle-guesser — no sideways scroll |
| Reduced motion | PASS | CSSOM walk of the loaded sheets inside the game frame: 3 `@keyframes` in `pyr.css`, **all three** inside `@media (prefers-reduced-motion: no-preference)`, and **zero** un-guarded `animation-name` declarations anywhere in `pyr.css` / `pyr-phone.css`. The splash is skipped outright under `reduce` and when embedded |
| Contrast on the teal/gold stage | PASS | a computed-style walk of every visible text node on setup, board, play (hidden and revealed), round-over, circle, result and standings flagged only gradient-backed elements, which the walker cannot resolve. Computed by hand against **both** stops: gold button ink 10.95 / **7.29**, green 9.86 / **4.66**, blue 7.83 / **5.25**, pyramid-card ink 12.39 / **5.29**, won-box ink 12.39 / **5.29**, won-box note 5.02, blocked-box value 6.11 / 9.93. Flat pairs: `--pyr-dim` on glass 8.04, on the deep stage 9.68; `--pyr-cream` 10.69; gold `#f4b400` 6.39; `--pyr-red` on glass 4.92. **Nothing below 4.5:1.** The implementer's `--stage-bg` override (dropping the shared 22 % gold bloom) is what makes the small text on the top-right of the stage clear the threshold — verified, and it should stay |

### Content — all 24 categories and 4 Winner's Circle sets

Read in full. **Every word is family-friendly and guessable, and no word appears twice
inside its category. I changed nothing in `categories.json` or `js/data.js`.** The four
circle sets are clean too (the spec's own example subject "Things you shouldn't say to
your boss" is sensibly *not* shipped). Every category carries a hint, `warningsFor` is
silent on the shipped file, and `js/data.js` is byte-identical in content to
`categories.json` (asserted structurally and by re-parsing the embedded literal).

Titles do hide the theme — the literal theme lives in the giver-only `hint`, which is a
better reading of spec §3 than the spec's own literal example. Non-blocking notes, in
descending order of how much they give away to a guesser reading the board:

| Category | Hint | Note | Suggested title |
| --- | --- | --- | --- |
| "Who's a Good Boy" | Things a dog does | names the animal outright | "Off the Lead" |
| "Nine Lives" | Things a cat does | names the animal outright | "Curiosity Calls" |
| "Round and Round" | Things that spin | "round and round" *is* spinning | "Dizzy Business" |
| "Give It a Rattle" | Things you shake | rattle ≈ shake | "Well Mixed" |
| "Never Sinks In" | Things that float | close, but the pun earns it | "Staying on Top" (optional) |

One word worth a swap for judging clarity, not for taste: **"Say Ahh" (Things in a
doctor's bag) ships both "Bandage" and "Plaster"** — near-synonyms in British English, so
a guesser who says "plaster" for "Bandage" is right and will be marked wrong. Suggest
replacing "Plaster" with **"Latex gloves"** (still 7 words, still unique). Whoever makes
that change must edit `categories.json` **and** `js/data.js` together — a unit test
asserts they match.

Style note: the set is consistently British English ("Tin opener", "Ice lolly", "Spirit
level", "Plaster", "Toffee apple"). Fine, but the README should say so.

### The implementer's deviations — judged

| Deviation | Verdict |
| --- | --- |
| `js/pyr-view.js` added to the spec's file list | **Accepted.** Same split the orchestrator already accepted for Feud / Wheel / Weakest Link, same shape as `wwm-view.js`; both files stay well under 800 lines and no rule logic moved into the view |
| `settings.tiebreakSeconds` added (default 15) | **Accepted.** Optional, defaulted, validated (5–300), exposed in the editor; files without it still validate and play. Reusing the 30 s category clock for a single word would indeed be wrong |
| `categories[].title` must be unique | **Accepted and correct.** The board is identified to the room by title; two identical cards would be unrecoverable |
| Illegal clue in the Winner's Circle blocks the box, play continues, banked money kept, grand prize lost | **Correct** — matches the accepted reading. Verified in unit A6 and live |
| Clearing six pays the grand prize *instead of* the box values | **Correct.** Verified explicitly (`10000`, not `3200`) |
| Money is the night's score, paid to both members | **Correct.** Verified live on the hub scoreboard |
| Tiebreak: one category, one word each, own short clock, Team A leads off, playable once | **Correct in design, one bug in the edge case** — see defect Y-1 |

### Cross-cutting defects from `00-orchestrator-triage.md` — re-checked here

| Cross-cutting item | Result in Pyramid |
| --- | --- |
| Game payloads dropped before the iframe was ready | PASS — a phone reloading mid-category re-joined and had its giver view (with the live word) immediately, no "Connecting…" stall |
| `?game=URL` ignored once a save exists | PASS — the URL wins; a save that came from that same URL keeps the game in progress. Implemented in `pyrChooseContent` |
| Saved state not scoped to the room | PASS — `pyrBindRoom` binds the save to the room code before any phone can join and drops phone seats (with a plain-English notice) when the code changes; verified bound to `GAFP` |
| Hub refresh mid-game | Not independently re-tested (shell-level); the phone-side remount path worked |
| Splash: games skip theirs when embedded | PASS — harness `Y-I6 an embedded frame skips the card`; also skipped under `prefers-reduced-motion: reduce` |
| Registry entry (implementer's open item #1) | **Done** — `js/hub-registry.js:45` carries the Pyramid tile; it launches from the hub |
| `shared/theme.css` pyramid accent block (open item #2) | **Done**, but the glow value diverges — see defect **Y-7** |

---

## 3. Defects

### Y-1 · **major** · fixed by this tester

**The tiebreak could be decided on a word the other team never got.**

`games/pyramid/js/pyr-core.js:343` (`markTiebreak`).

`finished = decided || outOfWords`, and `tbWinner` was computed from the raw running
score. When the tiebreak category's words ran out on an **odd** turn, the round ended with
Team A having had one word more than Team B, and the extra word decided who went to the
Winner's Circle — i.e. the money. Spec 11 §1 is explicit: "tie → one tiebreak category,
**one word each**". Team A always leads off, so the bias is always toward Team A.

*Repro (pre-fix):* level board, tiebreak category of 3 words, both teams answer correctly.
Turns run A, B, A; on the third the words run out. `tbScores [2,1]`, `tbWinner 0`,
`leader(state) === 0` — Team A takes the Winner's Circle after 2 words to B's 1. With the
shipped 7-word categories the same happens on the 7th word whenever the score is level
after each of the first three pairs and the 7th word is judged correct or illegal.

*Fix applied (2 lines, `< 5`):*

```js
    const finished = decided || outOfWords;
+   // Only COMPLETE pairs decide it: spec 11 §1 is "one word each", so if the
+   // words run out mid-pair the unmatched word cannot win it — the host picks.
+   const settled = pairDone ? scores : r.tbScores;
...
-     tbWinner: scores[0] === scores[1] ? null : (scores[0] > scores[1] ? 0 : 1),
+     tbWinner: settled[0] === settled[1] ? null : (settled[0] > settled[1] ? 0 : 1),
```

An unmatched last word now leaves `tbWinner` null, which drops straight into the path the
implementer had already built for a tiebreak that runs out level: `tiebreakPlayed` is set,
the mainResult panel says "Still level — pick the team that goes up." and shows **both**
Winner's Circle buttons. No new UI, no new state. Regression test:
`A4 running out of tiebreak words must not hand it to whoever had the extra word`.
All 92 component tests and every repo-root test pass after the change, and the loopback
harness is still 57/57.

### Y-2 · **minor** · not fixed

**A phone whose name matches a typed player is silently refused a seat.**

`games/pyramid/js/pyr-room.js:38` → `games/pyramid/js/pyr-app.js:259` (`pyrAddPlayer`).

`onPlayerJoin` calls `PyrApp.addPlayer(player.name, player.pid, false)`. `pyrAddPlayer`
rejects a name that is already on the list and shows *"Ada is already on the list — pick
another name."* — a sentence written for the host typing at the keyboard. The phone is
never added and never seatable, and the host's only remedy is to delete their own typed
row.

*Repro:* on the setup screen type a player "Ada", then join a phone named Ada.

*Proposed fix:* in `onPlayerJoin`, when `addPlayer` returns false, surface a
phone-specific message and add the player under a disambiguated label (e.g. `Ada (phone)`)
rather than dropping them. Keep the typed-entry duplicate check as it is.

### Y-3 · **minor** · not fixed

**The restored roster can hold two players with the same name.**

`games/pyramid/js/pyr-app.js:596` (`pyrMergeSetup`).

The merge de-duplicates by `pid` only, so a saved typed "Ada" and a live phone "Ada"
(different pids) both survive. The four seat dropdowns then offer two identical "Ada"
options with nothing to tell them apart.

*Repro (observed live):* saved game with typed Ada/Ben/Cleo/Dev, then two phones join as
Ada and Ben — roster showed six rows, two of them duplicate names.

*Proposed fix:* append the source to the option label in `renderSeats` (the roster list
already prints "typed in" / "on a phone"), or fold Y-2 and Y-3 into one rule: a phone that
matches a typed name takes over that typed row's seat.

### Y-4 · **minor** · not fixed

**A failed `?game=` says "Using the built-in set instead" when it actually uses the save.**

`games/pyramid/js/pyr-app.js:200` (`pyrLoadContent`) — the message is written before
`pyrChooseContent` decides what is really loaded.

*Repro:* open `?game=tests/fixtures/harness-game.json` once, then open
`?game=missing.json`. Banner: *"Could not load categories from missing.json: the server
answered 404. Using the built-in set instead."* — but the source line still reads *"Custom
categories from tests/fixtures/harness-game.json"* and that is what plays.

*Proposed fix:* set the second sentence in `pyrChooseContent`, where `useSaved` is known
("Keeping the categories you already had." vs "Using the built-in set instead.").

### Y-5 · **minor** · not fixed

**The giver's phone can still score while the host has paused the clock.**

`games/pyramid/js/pyr-core.js:667` (`playPhoneView` sends `started: r.started`) and
`pyr-core.js:298` (`evMark` gates on `r.started` only).

`started` stays true through `clockPause`, so Got it / Pass stay enabled on the phone and
the reducer accepts them. The host's own buttons staying live during a pause is
deliberate (judging a word in flight); the *phone* staying live is not — a pause is the
host's way of stopping play.

*Repro:* start a category, press Pause on the host, tap Got it on the giver's phone — the
word scores.

*Proposed fix:* one line in `pyrPhoneMark` — refuse a phone mark unless
`round.clock.running || round.expired` — plus the matching flag in `playPhoneView` /
`circlePhoneView` so the buttons grey out. (I did not apply it: it touches two files and
changes what a phone is allowed to do, which is the implementer's call.)

### Y-6 · **minor** · not fixed

**No way off the play or circle screen without judging a word.**

`games/pyramid/index.html:182-197` and `:219-233`. After the buzzer the host must mark the
word in flight before Next appears; the play and circle screens carry Undo but no "End the
night" / "Back to the board". Recoverable (Undo works, and any of the three verdicts
closes the round), but the board and result screens both have an escape and these two do
not.

*Proposed fix:* add the existing `btn-board-finish` ("End the night") to both toolbars.

### Y-7 · **minor** · not fixed (orchestrator-owned file)

**`--stage-glow` disagrees between the hub shell and the game.**

`shared/theme.css:137` declares `--stage-glow: #0b3b3c` for `[data-gsc-game="pyramid"]`;
`games/pyramid/css/pyr.css:38` declares `#0a4351` on `body[data-gsc-game="pyramid"]`. The
hub's shell bar and game-switch splash wear the theme value, the game page its own, so the
top glow shifts hue as the splash clears. `--accent` (`#f4b400`), `--accent-2` (`#2ec4b6`)
and `--accent-ink` (`#241a02`) agree exactly, so the accent itself is consistent.

`pyr.css` also overrides `--stage-bg` to drop the shared 22 % gold bloom (documented in
the implementation report §5.3). That override is **correct and should stay** — I verified
the contrast argument behind it — but it means the shell's stage and the game's stage are
not the same painting.

*Note for triage:* the same divergence already exists for `price-is-right` (`#123a86` vs
`#8a3d12`) and `deal-or-no-deal` (`#4a0810` vs `#5a0a1a`), so this is a repo-wide pattern,
not a Pyramid slip. Either make `theme.css` the single source for all three, or make the
bloom strength a token as the implementer suggested.

### Y-8 · **minor** · not fixed (documentation)

**24 categories cover three games a night, not four.**

Each game consumes seven (six board + one tiebreak), so the fourth game's draw wraps and
repeats. `PyrContent.warningsFor` does not warn, because its threshold is
`categoriesPerTeam * 2 + 1 + 4` = 11. `games/pyramid/README.md` should say "three games
before a category repeats"; a fourth game still deals a full board rather than stalling
(asserted in `A11`).

### Y-9 · **trivial** · not fixed

`games/pyramid/tests/pyr-core.test.mjs:131` embeds literal C0/C1 control characters, which
makes the file report as binary to `grep`, `file` and some editors.
`js/pyr-content.js` deliberately builds the same characters from escapes for exactly this
reason ("so this file stays pure printable ASCII"); my `pyr-hostile.test.mjs` does the
same. Cosmetic only — the test itself is correct.

### Y-10 · **trivial** · not fixed

`games/pyramid/css/pyr-phone.css:130-146` styles `.phone-boxes`, `.phone-box`,
`.phone-box.is-won` and `.phone-box.is-blocked`. `js/pyr-phone.js` never builds those
nodes — dead CSS (about 17 lines). Either build a small six-box strip on the circle
phones or delete the block.

### Non-defects, recorded so they are not re-filed

- **The guesser's phone shows the category title.** Spec §5 says "clock + count only", but
  the title is printed on the pyramid the whole room is watching, so it leaks nothing. The
  shipped unit test says so explicitly. Correct as built.
- **Undo on the very first board returns to Setup.** `start` is an undoable decision, so
  the last undo unwinds it; the setup screen is intact and "Start the game" deals a new
  board. Documented in `A10`.
- **The harness leaves its fixture as the saved game** for the next visit to
  `games/pyramid/` (same origin, same `localStorage` key). Already in the implementer's
  known limits, and every game in the repo behaves this way.
- **A phone reload landed on the hub join screen with the *other* phone's name pre-filled.**
  Artefact of running two phones in one browser profile (`gsc-phone-v1` is shared), not a
  Pyramid bug. The triage note about testing on two physical devices still stands.

---

## 4. Verdict

**Fix-then-ship — and the one blocking defect is already fixed.**

Pyramid is the most carefully built game in this repo on the dimension that matters most
to it: the current word is a secret, and that secret holds against everything I could
throw at it. Nine pids — including `__proto__`, `constructor` and an empty string — across
every phase, through passes, illegal clues, the buzzer, undo and the whole Winner's
Circle, never saw a word, a giver-only hint or a scrap of host state; the host page's
`textContent` was clean at every point in a full live game over real WebRTC; and turning
"Show words to me" off removes the nodes rather than hiding them. The reducer is genuinely
pure — 21 events against a deep-frozen state in nine phases mutated nothing and threw
nothing — the validator refuses 41 kinds of broken file with sentences a host can act on,
and every documented feature I was asked to check works: word cycling with passes, the
in-flight mark at the buzzer, role swap on and off, a blocked box that keeps the money and
lets play continue, six cleared paying the grand prize *instead of* the box values, undo
across every phase, the editor round-trip, `?game=URL` beating a stale save, reload
mid-category and mid-circle both resuming paused, 1280×720 with no scroll in play, 56 px
phone targets at 320 px, every animation behind `prefers-reduced-motion`, and not one
contrast pair below 4.5:1 on the teal-and-gold stage. The one real bug — the tiebreak
letting an unmatched last word decide who plays for the money (**Y-1**, major) — was a
two-line fix into a host-picks path the implementer had already built, and it is done,
tested and green: 92/92 in the component, 751/751 at the repo root, 57/57 in the loopback
harness. What is left is eight minors and trivials, none of which can block or corrupt a
game night: **Y-2/Y-3** (a phone sharing a name with a typed player), **Y-4** (a
misleading fallback sentence), **Y-5** (a phone that can still score during a pause),
**Y-6** (no escape hatch on two screens), **Y-7** (a glow token the shell and the game
disagree on, shared with two other games), **Y-8/Y-9/Y-10** (docs and dead code). Ship it
once the orchestrator has looked at Y-5 and decided whether Y-7 belongs to the shell.
