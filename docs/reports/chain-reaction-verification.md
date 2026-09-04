# Chain Reaction — verification report

Component: `chain-reaction` · Independent tester (did not write the code)
Spec: `docs/14-chain-reaction-spec.md` · Format: `docs/06-verification-plan.md` §5
Code under test: `games/chain-reaction/**` · Date: 2026-09-04

---

## 1. Environment

| | |
| --- | --- |
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app browser pane), one host tab + one phone tab |
| Server | `python -m http.server 8704 --bind 127.0.0.1` from the repo root (my own port; stopped afterwards) |
| Network tier | real PeerJS broker + WebRTC, room `57QU`, two live phones (`p1` Ada, `p2` Ben) |
| Date | 2026-09-04 |

Everything I changed is inside `games/chain-reaction/` and `docs/reports/`.
No `git commit`, no `git push`.

### What I added

| File | Why |
| --- | --- |
| `games/chain-reaction/tests/cr-adversarial.test.mjs` | 27 adversarial tests, A1–A9 (the rules) |
| `games/chain-reaction/tests/cr-adversarial-fuzz.test.mjs` | 35 adversarial tests, A10–A16 (masking, fuzz, immutability, undo, prototypes) |

The brief asked for one file. The suite came out at **1171 lines**, which breaks
the V2 gate (< 800 lines, tests included), so it is split in two; each file
repeats its own fixtures and stands alone. Both are now named in the harness's
`SOURCES` list, so the V2/V3/V4 gates cover them.

---

## 2. Results

### T1 — unit (`cd games/chain-reaction && node --test`)

`ℹ tests 119 · pass 119 · fail 0` (57 shipped + 62 adversarial).
Root `node --test`: `ℹ tests 989 · pass 989 · fail 0` — no regression anywhere.

| ID | Result | Evidence |
| --- | --- | --- |
| C-U1 validator | **PASS** | Shipped file: 18 chains, 4 speed chains, 8 words each, all A–Z, unique in chain. Every documented fault throws a plain-English `Error`. Re-verified adversarially: A11 fuzzes 7- and 9-word chains, digits (`SPACE1`, `5PACE`), edge punctuation (`-SHIP`, `SHIP'`, `SH--IP`), non-ASCII (`ÉTÉ`), 1- and 13-letter words, adjacent duplicates (incl. case-folded `SPACE`/`space`), in-chain repeats, 5 chains, 1 speed chain, and 21 junk shapes — every one throws a plain `Error` with a readable message, never a `TypeError`. |
| C-U2 eligibility | **PASS** | `eligibleWords` = `[1, 6]` at the start and walks inwards; the last word is listed once. A1 additionally sweeps a whole chain asserting **no word outside the current frontier ever gains a letter**, that a second reveal before judging cannot switch ends, and that 12 bogus `direction` values (`"TOP"`, `" top"`, `0`, `true`, `{}`, `null`…) reveal nothing. |
| C-U3 letter order / all-letters-given | **PASS** | Reveals produce `S...` → `SH..` → `SHI.`; A2 asserts the lit set is always a strict prefix (no gaps). A3 uses a two-letter word (`AX`): the letter that completes a word solves it with **no points, owner `null`, control unchanged**, `target` cleared, and judging afterwards is a no-op. Same under `revealOnWrong`. Punctuation starts lit, costs no turn, is not counted by `shown`. |
| C-U4 correct scores + keeps control | **PASS** | A4 runs three chains at `[100, 250, 700]`: each correct pays exactly that chain's value to the team in control, never touches the other score, and control stays. A truthy-but-not-`true` verdict (`"yes"`) is treated as **wrong** — the host must be explicit. |
| C-U5 wrong passes control | **PASS** | Control flips, `target`/`guessText`/`guessBy` clear, the letter already given stays given, scores untouched, and the incoming team may build from **either** end. Verified over 12 alternating turns. |
| C-U6 chain completion | **PASS** | Completing a chain → `chainDone`, `target`/`direction` null; `nextChain` advances the index, takes the next chain, alternates the opener and changes the value (100 → 200 → 300). The **number of chains is `settings.values.length`**, not the file length. `nextChain` outside the interstitial, or with none left, is a no-op. |
| C-U7 Speed Chain | **PASS** | Board carries the first letter of every hidden word and nothing more. A9 passes the same word **18 times** (three full laps) — it cycles to the back for ever, scores nothing, never ends the round. Expiry with a word in flight pays `perWord × banked` only, drops the in-flight word, clears the deadline and refuses every later mark and a second expiry. All six pays the all-clear bonus **instead of** the per-word rate (1000, not 600). A 0 per-word rate pays 0. Marks before the clock starts, and 11 junk `result` values, are refused. |
| C-U8 sudden death | **PASS** | A tie after the chains → `sudden` with a blank word and its two neighbours as the clue; one letter per reveal; a wrong call hands the buzzer over; the **first correct call** takes it, moves to `chainDone`, breaks the tie, and cannot be won twice. Refused mid-chain, with chains left, or when somebody is already ahead. The source chain is one nobody played (verified over 5 different `rng` values by matching the `before/word/after` triple). |
| C-U9 undo / illegal / immutability | **PASS** | A13 **deep-freezes** a state in each of 8 phases and fires all 18 event types at it: no mutation anywhere, no shared arrays, and the shipped `chains.json` object is byte-for-byte unchanged after a full three-chain + Speed-Chain play-through. A14 walks undo back over `nextChain`, `suddenDeath`, a won tiebreak, the whole Speed Chain (award reversed, queue restored) and `finish`; the stack is capped at 60 and unwinding it completely leaves the game playable. Typing (30 guesses) and `notice` take no undo slot. |
| C-U10 `phoneView` masks everything | **PASS** | A10 walks a complete game — every reveal, guess, judgement, interstitial, sudden death (blank / one letter / handed over), Speed Chain (set up, running, after a pass, after a got, expired) and the result — and for **9 different pids** (`p1`, `p2`, `p3`, `stranger`, `""`, `null`, `undefined`, `__proto__`, `constructor`) asserts that no unsolved word appears whole in the payload, that every unlit cell carries `ch: null`, and that the payload never contains `game`, `chainOrder` or `history`. Off-team and unknown pids only ever get the watcher's view with no direction buttons. `phoneView` is total: junk states and prototype-shaped phases fall back to `wait`. |
| A12 phone-message fuzz | **PASS** | A 25-character guess is cut to 24 with no trailing space; control characters are stripped (`"sh\tip"` → `"ship"`); a guess of only control characters is dropped. Extra fields are never forwarded — `{t:"guess",text:"ship",correct:true}` yields exactly `{t:"guess",text:"ship"}`, so a phone cannot smuggle a verdict. 22 other shapes (including `{t:"judge"}`, `{t:"toSpeed"}`, `{t:"__proto__"}` and a `JSON.parse`'d `__proto__` payload) return `null`, and `Object.prototype` survives. A guess from the **non-controlling** team is recorded but changes nothing, and `teamOf` gives `cr-room.js` what it needs to drop it (the drop itself is proven live in C-I1 and T3). Guesses and directions outside their phase are ignored. |
| A15 prototype-shaped events | **PASS** | 13 prototype keys (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, …), with and without payloads, against 5 states: every one returns the identical object and `Object.prototype` is untouched. `legalActions` never names a prototype key and never promises an action that would do nothing. |

### T2 — loopback harness (`games/chain-reaction/tests/harness.html`)

**All 52 checks passed**, `#summary.ok`, reproduced on **three** consecutive runs.

> This is after fixing defect **CR-1**. As shipped, the harness aborted at
> C-I4 with `timed out waiting for the chain` — 29 checks recorded, 1 FAIL,
> `#summary.bad`. C-I5, C-I6 and every static gate inside it had never run.

| ID | Result | Evidence |
| --- | --- | --- |
| C-I1 phone intent, never auto-judged | **PASS** | 8 checks: roster reaches setup; teams keep the phones the host assigned; only the controlling phone gets `control`; its direction reveals exactly one letter on the host board; a typed guess shows as `ship` + "Typed on Ada's phone"; `solved[1] === false`, scores `[0,0]`; a non-controlling phone's `direction` and `guess` change nothing. |
| C-I2 the host judges | **PASS** | Correct scores 100 and keeps control; the solved row wears `owner-0`; Wrong passes control and leaves the letter given; the other phone takes the `control` screen; Undo puts the turn back. |
| C-I3 column renders as revealed, only as revealed | **PASS** | 8 rows; top and bottom given; the phone draws the solved word letter for letter; **no phone holds a letter of an unrevealed word — neither in `#screen-phone`'s rendered text nor in the payload**; the per-row lit counts match the host exactly. |
| C-I4 Speed Chain + clock on phones | **PASS** | 11 checks: interstitial shows the whole chain; the next chain is worth more; the board shows one letter per hidden word; it goes to the leading team's phone (`mine: true` there, `false` on the other); the phone clock matches the host within 1 s and counts down; the playing phone gets Pass and nothing that scores; a pass goes to the back and banks nothing; a phone `got` is dropped; all six pays the bonus; every phone ends on the standings. |
| C-I5 reload mid-chain | **PASS** | Phase, board, scores and target restored exactly; the revealed letters are exactly what they were; the phones are pushed a fresh view after the host reloads. Re-verified by hand standalone: an 11-field snapshot (phase, scores, target, control, full reveal mask, words, typed guess, history depth, chainIndex) matched byte for byte, and the guess field still read `hallway`. |
| C-I6 editor round-trip + gates | **PASS** | 19 checks: the editor lists every chain as 8 stacked fields; a bad word is flagged on the field as it is typed and blocks the file; a repeat is flagged; fixing it clears the message; **Use in game** adopts the edit and clears the game in progress; the result still validates through the one validator; plus V2/V3/V4/V6/V7/V8, the reduced-motion CSS parse, the "no local `body[data-gsc-game]` override" grep, `data.js` ≡ `chains.json`, 18/4 chains, `gsc-embedded` wiring, and `title`/`scores` reaching the shell. |

### T3 — real network, through the hub

Real PeerJS broker, real WebRTC. Host tab ran the hub; the second tab carried
Ada (`p1`) plus a second full phone shell in a same-origin frame for Ben (`p2`),
because the browser pane caps me at two tabs — both are genuine PeerJS
connections with their own peer, seat and roster row.

| Check | Result | Evidence |
| --- | --- | --- |
| The controlling phone's direction reaches the host | **PASS** | Ada tapped **Build from the top** → host `target = 1`, `shown = 1`, board row `S___`. |
| Its typed guess reaches the host and is never auto-judged | **PASS** | Host field `ship`, label **"Typed on Ada's phone"**, hint "Nothing is judged automatically — you decide."; `solved[1] false`, scores `[0,0]`, control unchanged. |
| The non-controlling phone cannot act | **PASS** | Ben sent `{t:"direction"}`, `{t:"guess"}`, `{t:"speed",result:"got"}` **and a forged `{t:"judge",correct:true}`** — every one dropped; board, scores and control unchanged, Ben stayed on `watch` with zero buttons. |
| The host judges | **PASS** | Correct → `[100, 0]`, `owner-0`, notice "Team Blue got SHIP." |
| Column letters render as revealed on both phones | **PASS** | Both phones: `SPACE / SHIP(owner-0) / _____ / __ / ____ / ____ / ___ / OUT`, scores `$100 / $0`, control marker on Team Blue. |
| Speed Chain clock on phones | **PASS** | Both phones read `52` then `50` in step with the host; only the playing team's phone had **Pass**; nobody had a "Got it". A phone Pass moved word 1 to the back of the queue and banked nothing. |
| Phone reload mid-chain | **PASS** | Ben's phone reloaded, relinked as `p2`, and came back on `watch` with the correct board (`SPACE / SHIP / _____ …`) — no "Waiting for the host" stall. |
| `⌂ Lobby` and back | **PASS** | Exit returned to the lobby with both phones still connected; re-entering the game resumed at `result`, scores `[3400, 1200]`, same room `57QU`, teams intact, no spurious "new room" wipe. |
| Night scoreboard receives Speed Chain money | **PASS** (with **CR-4**) | `gsc-hub-state-v1.night.games["chain-reaction"] = [{score:3400},{score:1200}]` — 2400 from the chains plus the $1,000 all-clear bonus. The shared screen renders it as "Ada 3400 / Ben 1200" rather than the team names; see CR-4. |

No BLOCKED-ENV. The broker was reachable throughout.

### T4 — standalone, host-only

| Check | Result | Evidence |
| --- | --- | --- |
| Three chains + Speed Chain with no phones | **PASS** | Chain 1 `SPACE…OUT` (500 to Team Pink, incl. one given word), chain 2 `FIRE…BAND` at $200, chain 3 at $300, final `[1800, 1700]`; Speed Chain `GREEN…BREAK` with first letters, clock 60 → 59, pass cycled, got banked, standings "Team Blue $1,900 ◆ ahead". |
| Wrong → control passes; given word keeps control | **PASS** | After three wrong guesses the fourth reveal spelled `SHIP` out: `solved` true, control **unchanged**, scores **unchanged**, notice "SHIP was fully spelled out — given, no points." |
| Forced tie → sudden death | **PASS** | Values `[100, 100]`, two clean sweeps → `[600, 600]`, `leader === null`, the interstitial offered **Sudden death** (not Speed Chain) with "Level — one sudden-death word decides…". Clue `HOLE … LINE`, word masked, one letter per reveal (`P____`), Wrong handed the buzzer over, Correct resolved to `[700, 600]` and the Speed Chain button appeared. |
| Undo | **PASS** | Undo after a correct judgement restored `target: 2` and `[0,0]`; undo across `nextChain`, `suddenDeath`, the Speed Chain award and `finish` all verified in T1. |
| Hotkeys, including with an input focused | **PASS** | `T` revealed, `Y` judged correct, `U` undid. With `#cr-guess` focused, `y n t b p u Enter` changed **nothing** (target, scores, control and the full reveal mask identical). Peek printed "The word is SHAPE" and cleared itself on the next judgement. |
| Editor Download (validate) + Use | **PASS** | With `SH1P` typed, **Download JSON** refused (`Fix this before downloading: chains 1 word 2 ("SH1P") must be letters only…`) and no anchor click fired; **Use in game** refused too and kept the editor open. After the fix, "This file is ready to play.", Download fired, and **Use** adopted the title and cleared the game in progress. Pair labels read `↳ SPACE SHIP`, `↳ SHIP SHAPE`, … |
| `?game=URL` vs a save | **PASS** | With a game in progress from a different source, `?game=tests/fixtures/harness-game.json` won and said so: *"Loaded the chains from the link, so the game in progress was cleared."* Reloading the **same** URL kept the game in progress (`[100, 0]`, no banner). |
| Bad JSON | **PASS** | 404 → "the server answered 404"; a Markdown file → the JSON parse error; a valid-JSON-but-wrong-game → `"chains" is missing.`. Navigating with a bad `?game=` showed *"Could not load chains from …: … Using the built-in set instead."* and **kept the game in progress** (still `chain`, `[100, 0]`). |
| 1280×720 no scroll in play | **PASS** | `scrollWidth/scrollHeight === 1280/720` on setup, chain, chain-complete, sudden death, Speed Chain (idle / running / over) and result. |
| 1280×676 no scroll in play | **PASS** | `1280/676` on all of the same screens. |

### Design and accessibility

| Check | Result | Evidence |
| --- | --- | --- |
| Theme accent block is canonical | **PASS** | Computed on `body[data-gsc-game="chain-reaction"]`: `--accent #ff2e88`, `--accent-2 #4d7bff`, `--accent-ink #2a0213`, `--stage-glow #10276e` — exactly `shared/theme.css:148-155`. A CSSOM walk of both game sheets found **no** `body[data-gsc-game]` rule. (The implementation report §10 proposed a different pairing; the theme's block landed instead and the code correctly inherits it — that note is stale, not a defect.) |
| Nothing hard-codes white on the pink accent | **PASS** | White text appears at exactly three sites (`cr.css:119, 150, 376`) and every one sits on the blue fill. White on `#ff2e88` is 3.5:1 and is used nowhere; the pink chips use `#1a0210` ink (5.66:1). |
| `#0f3bd9` only as a background fill | **PASS** | Three uses, all `background` (`cr.css:118, 150, 376`); `--cr-blue #4c74ff` is the text-on-dark blue. `--stage-accent: #0f3bd9` (`cr.css:20`) is declared but nothing in the page consumes it. |
| Contrast, both gradient stops | **PASS** | lit tile ink on `#ffffff`→`#f6f7ff` **19.24 / 18.02**; team-0 word on `#9fb6ff`→`#5f80ff` **10.00 / 5.67**; team-1 word on `#ffb4d6`→`#ff5fa2` **11.65 / 6.77**; `.btn-blue` white on `#3d63ff`→`#0f3bd9` **4.74 / 7.93**. Plus a live sweep of every leaf text node on the chain screen and topbar against its resolved solid background: **zero failures** at the 4.5 / 3.0 thresholds. |
| Reduced motion | **PASS** | CSSOM walk of `cr.css` + `cr-phone.css` (no emulation available): **zero** `animation:` declarations and **zero** `@keyframes` outside `prefers-reduced-motion: no-preference`; all three keyframes (`cr-land`, `cr-target`, `cr-beat`) are inside it. The splash is also skipped under reduced motion (`cr-app.js:494`). |
| Phone 320×640, targets ≥ 56 px | **PASS** | `scrollWidth === 320` on every phone screen (no horizontal scroll). Direction buttons **134 × 77**, guess field **274 × 56**, Send **274 × 56**, Pass **274 × 56**. Phone clock 46 px. |
| Colour is never the only signal | **PASS** | Podiums say "▶ in control" / "waiting"; every row carries `aria-label` ("3 of 4 letters showing" / "SHIP — solved"); frontier rows tagged "next from the top"; Speed marks read "✓ got it" / "passed — comes back"; standings mark "◆ ahead". Every control is a `<button>`; the editor is `role="dialog"`; notice, guess source, standings and clock are live regions. |
| 1280×720 readability of the tile column | **FAIL (minor)** | See **CR-5**: 34 px tiles / 21 px glyphs, column 300 px tall beside a 616 px rail. |

### T5 — static gates

| Gate | Result | Evidence |
| --- | --- | --- |
| V1 `node --test` exits 0 | **PASS** | 119/119 in the component, 989/989 at the root. |
| V2 every file < 800 lines | **PASS** | Largest shipped file `cr-app.js` 591; largest file `cr-core.test.mjs` 744; my suites 581 and 678. (Breached at 1171 before I split them — see §1.) |
| V3 no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function` | **PASS** | Zero matches across the whole component, tests included. |
| V4 no `console.log` | **PASS** | Zero. `console.warn` only, for diagnostics. |
| V5 no Peer/connection/DOM/timer handle in state | **PASS** | Code read of all 12 `crSet(...)` call sites: only plain data (core state, setup, a `{pid,name,connected}` array, a room-code string, booleans). `crClock`, `room` and the guess timer live in module scope; `crSerialise` names six plain fields. |
| V6 external URLs | **PASS** | The page loads only Google Fonts. The other `http://` strings are localhost examples in `README.md`. |
| V7 `data-gsc-game`, `#gsc-join`, `player-mode` / `gsc-embedded` | **PASS** | `index.html:15`, `:270`; classes toggled in `cr-app.js:543-544` and `cr-phone.js:284`, and actually used by CSS (`cr.css:400-409`). Confirmed live: `body.className === "gsc-embedded"` in the hub, room chip hidden. |
| V8 `?game=URL` and upload go through the same validator | **PASS** | `crFetchGame` → `validateGame` (`cr-app.js:161`), `crOnFile` → `crUseGame` → `normalizeGame` (`cr-app.js:203, 220`), editor → the same. Verified live for all three paths. |

### Security read

No issues found. Every phone frame goes through `validatePhoneMsg` (shape,
`≤ 24` chars, control characters stripped, extra fields dropped) → an
own-property `INTENTS` lookup with a team/phase check → the reducer, which
checks again. `got` from a phone is dropped by `cr-room.js:72`; a forged
`judge` never reaches a handler. Own-property guards are on `HANDLERS`,
`INTENTS`, `PHONE_SCREENS`, `SCREENS`, `CR_KEYMAPS` and `CR_CUES`, and my A11
and A15 tests confirm nothing pollutes `Object.prototype`. A hostile
`?game=` link can only inject content that survives `validateGame` — words
are `^[A-Z]+(?:['-][A-Z]+)*$` and ≤ 12 letters, title/currency/label are
`cleanText`-capped — and everything reaches the page through `textContent`,
so there is no injection path. `localStorage` reads are wrapped in try/catch
and gated by `crUsableCore`, which rejects a hand-edited or half-written save.

### Content — all 18 chains and 4 speed chains read

All 154 adjacent pairs are genuine English phrases or compounds. Nothing was
clearly broken, so **`chains.json` and `js/data.js` are unchanged**. Two pairs
are worth the implementer's eye but neither is wrong enough to force a swap:

| Chain | Pair | Note | If you want a replacement |
| --- | --- | --- | --- |
| 5 `HORSE SHOE LACE CURTAIN CALL BACK FIRE PLACE` | `LACE → CURTAIN` | "lace curtains" is real (and "lace-curtain Irish" is an idiom), but the singular reads thinner than every other pair in the file. | `HORSE SHOE LACE UP GRADE SCHOOL BOOK CASE` — but `UP GRADE` and `SCHOOL BOOK` already appear in chains 3 and 13, so the cleaner swap is `SHOE LACE` → `LACE WORK` → `WORK BENCH` → `BENCH MARK` → `MARK DOWN` → `DOWN TOWN`. |
| 18 `STOP WATCH DOG TAG TEAM SPIRIT ANIMAL CRACKER` | `ANIMAL → CRACKER` | "animal crackers" is normally plural; the singular is a touch awkward. | `SPIRIT ANIMAL` → `ANIMAL KINGDOM` is taken by chain 14; `TEAM SPIRIT LEVEL HEADED` would need a restructure. Leaving it is defensible. |

`js/data.js` is not literally byte-identical to `chains.json` (different JSON
formatting) but parses to the identical object, which a unit test pins. That
satisfies the spec's "mirror in `js/data.js`".

---

## 3. Defects

### CR-1 — the loopback harness never reached C-I5 or C-I6 · **major** · FIXED

`games/chain-reaction/tests/harness.html:190` (`bootHost`), interacting with
`games/chain-reaction/js/cr-app.js:476` (`window.addEventListener("beforeunload", crSave)`).

**Repro (as shipped):** serve the repo, open
`games/chain-reaction/tests/harness.html`. The run stops with
`1 of 30 checks FAILED — uncaught: timed out waiting for the chain`,
`#summary.bad`. Checks 0–28 pass, then nothing.

**Cause:** `bootHost()` removed `gsc-cr-state-v1` and *then* set `frame.src`.
Setting `src` unloads the old document, whose `beforeunload` handler writes the
state straight back — after the clear. So the second and third `bootHost()`
calls restored the previous scenario's finished game (`phase: "result"`),
`btn-start` was disabled, and `waitFor(phase === "chain")` timed out. It is
deterministic: I reproduced it, then confirmed the mechanism directly
(`localStorage.removeItem` → reload → the key is back with `core.phase === "result"`).

**Consequence:** C-I5 (reload), C-I6 (editor round-trip) and every static gate
folded into C-I6 (V2, V3, V4, V6, V7, V8, the reduced-motion parse, the
`data.js` mirror, the accent-override grep) had **never been executed**. The
implementation report's "T2 loopback — 29 / 29 pass, `#summary.ok`, run three
times" does not reproduce; a completed run has 52 checks, and an aborted one
can never be `.ok` because the failure check is appended.

**Fixed** (4 lines) — unload to `about:blank` first, so the old page's save
lands before the clear:

```diff
     async function bootHost(clear) {
-      if (clear !== false) KEYS.forEach((k) => localStorage.removeItem(k));
+      if (clear !== false) {
+        // Unload the old page FIRST: its beforeunload handler saves the state,
+        // which would otherwise land in localStorage after we cleared it.
+        await loadFrame(hostFrame, "about:blank");
+        KEYS.forEach((k) => localStorage.removeItem(k));
+      }
       await loadFrame(hostFrame, HOST_SRC);
```

Result: **52 / 52, `#summary.ok`, three consecutive runs.** I also added the two
new test files to the harness's `SOURCES` list so they are covered by V2/V3/V4.

### CR-2 — the Speed Chain clock is not paused across a save/reload · **major** (borderline critical) · NOT fixed

`games/chain-reaction/js/cr-app.js:88-93` (`crSerialise`), with
`js/cr-clock.js:61` and `js/cr-core.js:427-435` (`evSpeedStart`).

`crSerialise` stores `core` verbatim, so `speed.deadline` — an absolute
wall-clock timestamp — is written to `localStorage` and restored as-is.

**Repro A (time is lost).** Standalone, reach the Speed Chain, start the clock,
reload. Measured: 52 s left before, **44 s** after — eight seconds of the
team's bonus round burned by the reload, and it keeps burning while the tab
is gone.

**Repro B (the round is destroyed, and Undo cannot save it).** Start the Speed
Chain, close the tab, reopen a couple of minutes later. `cr-clock.js` paints
once, sees `left <= 0`, fires `onExpire` → `speedExpired`. Observed:
`over: true`, `got: 1`, `award: 100`, scores `[1800, 1700] → [1900, 1700]`,
notice "Time! Team Blue bank $100." — a round that could have paid $1,000 is
over before the host touches anything. **Pressing Undo does not recover it**:
the restored state carries the same stale deadline, `crClock.reset()` clears
the fired latch, and the clock re-expires immediately (verified: `over` still
`true`, `award` still 100 after Undo).

Every sibling game freezes its clock on save — `games/password/js/pwd-app.js:150`,
`games/pyramid/js/pyr-app.js:147`, `games/weakest-link/js/wl-app.js:87` all
write `{running:false, deadline:null, remainingMs: max(0, deadline - Date.now())}`.
Chain Reaction has no `remainingMs` concept at all, so this is not a
tester-sized fix.

**Proposed fix (implementer):**
1. `js/cr-core.js` — give `buildSpeed` a `remainingMs: seconds * 1000`; have
   `evSpeedStart` set `deadline = now + (speed.remainingMs || seconds * 1000)`
   and clear `remainingMs`; have `finishSpeed` null both.
2. `js/cr-app.js` `crSerialise()` — when `core.speed && core.speed.started && !core.speed.over`,
   emit `speed: {...speed, started: false, deadline: null, remainingMs: Math.max(0, speed.deadline - Date.now())}`.
3. The host then sees **Start the clock** again on the restored screen and the
   round resumes from where it stopped, which is what §T2's "resumes paused"
   asks for. Worth a unit test and a harness check.

### CR-3 — the giant clock read "60" the moment time ran out · **minor** · FIXED

`games/chain-reaction/js/cr-app.js:311` (`crSpeedSeconds`) and
`games/chain-reaction/js/cr-phone.js:149` (`paintClock`), via `js/cr-clock.js:47`.

`finishSpeed` clears `deadline`, so the clock stops being "running" and falls
back to `getSeconds()` — the **round length**. Observed: the biggest number on
the shared screen jumped `1 → 60` at exactly the moment "Time!" appeared, and
every phone did the same.

**Fixed** (2 lines each):

```diff
 function crSpeedSeconds() {
   const state = crApp.core;
-  return state && state.speed ? state.speed.seconds : 0;
+  if (!state || !state.speed) return 0;
+  // Once the round is over the deadline is cleared, so the clock falls back to
+  // this. It must read 0, not the round length, or "Time!" shows "60".
+  return state.speed.over ? 0 : state.speed.seconds;
 }
```

```diff
-    const left = Number.isFinite(view.deadline) && core ? core.secondsLeft(view.deadline, Date.now()) : view.seconds;
+    const fallback = view.over ? 0 : view.seconds;   // "Time!" must not show the round length again
+    const left = Number.isFinite(view.deadline) && core ? core.secondsLeft(view.deadline, Date.now()) : fallback;
```

Verified standalone and again on the real hub run: the clock reads `0` beside
"All six — the full bonus! Team Blue bank $1,000." The idle pre-start display
still correctly shows the round length.

### CR-4 — only the first phone on each team reaches the night scoreboard · **minor** · NOT fixed

`games/chain-reaction/js/cr-room.js:107-111`.

```js
room.reportScores(state.teams.map((team, i) => ({
  pid: team.pids[0] || `team${i}`, name: team.name, score: state.scores[i],
})));
```

`js/hub-night.js:73,78` prefers the **roster** name whenever a row carries a
known pid, so the shared scoreboard shows the first phone's player name, not
the team's. Observed live (room `57QU`): the night board read
**"Ada 3400 / Ben 1200"** for what were Team Blue and Team Pink. A second or
third phone on a team is credited **nothing**.

The house convention for team games is one row per member carrying the team's
score — `games/family-feud/js/feud-room.js:151-155` and
`games/pyramid/js/pyr-room.js:96-98` both do exactly that.

**Proposed fix** (just over the trivial line, and it changes what the shared
screen says, so it goes back to the implementer):

```js
const names = new Map(room.players().map((p) => [p.pid, p.name]));
room.reportScores(state.teams.flatMap((team, i) => (team.pids.length
  ? team.pids.map((pid) => ({ pid, name: names.get(pid) || team.name, score: state.scores[i] }))
  : [{ pid: null, name: team.name, score: state.scores[i] }])));
```

(`hub-night.js:29-32` accepts `pid: null` and keys off the name, so a
phone-less team still lands on the board under its own name.)

### CR-5 — the chain column uses half the height it has at 1280×720 · **minor** · NOT fixed

`games/chain-reaction/css/cr.css:31` (`--cr-tile: 40px`), `:414` (`34px` under
`max-height: 780px`), `:423` (`30px` under `max-height: 690px`).

Measured at 1280×720: tiles **34 × 34 px** with **21 px** Anton glyphs; the
column is **300 px** tall while the rail beside it is **616 px** — about 285 px
of stage sits empty under the board. At 1280×676 it is worse: 30 px tiles,
a 261 px column in a 676 px viewport. The rail (podiums + guess box + three
button rows) is what sets the height, not the column, so the shrink buys
nothing. Spec 14 §3 and architecture 00 §10 both ask for big, projector-readable
type, and the letter column is the centrepiece of this format.

I measured the headroom directly by overriding `--cr-tile` live:

| `--cr-tile` | column height @720 | overflow @720 | column height @676 | overflow @676 |
| --- | --- | --- | --- | --- |
| 34 / 30 px (shipped) | 300 px | none | 261 px | none |
| 46 px | — | — | 389 px | **none** |
| 52 px | 444 px | **none** | 437 px | **none** |
| 58–60 px | 508 px | **none** | 485 px | **none** |

**Proposed fix:** raise the two media-query values to roughly `48px` / `44px`
(and nudge `--cr-row-gap`), then re-check both heights with the longest shipped
word (`POISONING`, 9 letters) and the Speed Chain screen. Left to the
implementer because it is a design change across two breakpoints, not a
one-liner.

### CR-6 — the sudden-death word can be one the teams already solved · **minor** · NOT fixed

`games/chain-reaction/js/cr-core.js:320-335` (`pickSudden`).

Two related gaps, both pinned by "KNOWN GAP" tests in
`tests/cr-adversarial.test.mjs` and `tests/cr-adversarial-fuzz.test.mjs` so a
fix is visible when it lands:

1. `pickSudden` chooses an **unplayed chain** but not an **unseen word**. With
   the shipped file, two chains played and `rng → 0.999…`, the tiebreak word is
   **`UP`** — which chain 1 (`SPACE SHIP SHAPE UP TOWN …`) already put on the
   board. The teams have literally just seen the answer.
2. When `settings.values.length === game.chains.length` (legal: 6 values, 6
   chains) there is **no** unplayed chain, and the `for` loop leaves `from = 0`,
   a chain that was definitely played.

Neither corrupts state or blocks play; both make a tiebreak land flat.
**Proposed fix:** collect the words already solved this game and skip a
candidate that is in that set (falling back to any word if every candidate
collides), and pick the source chain at random among the unplayed ones instead
of taking the first.

### CR-7 — double full stop in the failed-`?game=` message · **nit** · NOT fixed

`games/chain-reaction/js/cr-app.js:171`. The template appends `.` to a message
that already ends in one: *"Could not load chains from ../password/words.json:
"chains" is missing.. Using the built-in set instead."* Cosmetic only.

---

## 4. Verdict

**Fix-then-ship.**

Chain Reaction is a careful, faithful implementation: the rules in `cr-core.js`
match spec 14 §1 exactly, including the awkward ones (a fully-spelled word is
given for nothing and does not move control; the incoming team may switch ends;
passed Speed Chain words cycle for ever; the all-clear bonus replaces the
per-word rate). The masking discipline is genuinely strong — I could not get a
hidden letter into a phone payload from any phase, for any pid, including
prototype-shaped ones, and the same holds over real WebRTC. The core survived
deep-freezing under every event in every phase, the validator threw a plain
English `Error` for all 60-odd malformed inputs I could invent, and nothing a
phone sends — including a forged `judge` — can score, solve or advance
anything. It plays host-only end to end, fits 1280×720 and 1280×676 without
scrolling, clears contrast on both stops of every gradient, guards all its
motion behind `prefers-reduced-motion`, and inherits the theme's canonical
pink/blue accents with no local override and no white-on-pink anywhere. All 154
adjacent word pairs in the shipped file are real English. 119/119 unit tests,
52/52 harness checks, 989/989 at the repo root.

Two things stop it shipping as-is. **CR-2** is the real one: the Speed Chain
stores an absolute deadline that is never paused, so a host who reloads loses
the team's clock, and a host whose tab was closed for longer than the round
comes back to a Speed Chain that has already ended — with Undo unable to
recover it, because the restored state re-expires on the next paint. Every
other game in the repo already solves this; Chain Reaction needs the same
`remainingMs` treatment before a real game night. **CR-1** is not a product
bug but it matters just as much for confidence: the shipped harness aborted
before C-I5 and C-I6 ever ran, so the implementation report's "29/29,
`#summary.ok`" described a run that could not have happened. With the four-line
fix the suite is 52/52 and everything it claimed is now actually verified.
CR-3 is fixed. CR-4 through CR-7 are minors that can ride along or land in the
README's known issues.
