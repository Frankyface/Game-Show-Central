# Family Feud — verification report

Component: `family-feud` · Spec: `docs/03-family-feud-spec.md` · Plan:
`docs/06-verification-plan.md` · Implementer's report:
`docs/reports/family-feud-implementation.md`

Tester: independent (did not write the code under test). Date: 2026-09-03.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 (`node --test`, zero deps) |
| Browser | Chromium via the in-app browser pane |
| Server | `python -m http.server 8642 --bind 127.0.0.1` at the repo root (tester's own port, `hub-test-feud`). A second loopback process on `127.0.0.1:8650` existed only to write evidence PNGs into `docs/reports/img/` — nothing under test talks to it. |
| Code under test | `games/family-feud/**` on `main`, unmodified by me |
| Files I created | `games/family-feud/tests/feud-adversarial.test.mjs` (new, 798 lines), this report, `docs/reports/img/feud-*.png` |

**I changed no product code.** Every defect below is reported, not fixed —
including the ones under five lines, because my scope forbids writing outside
`games/family-feud/tests/` and `docs/reports/`.

### Evidence caveats (stated so nothing here is over-claimed)

- **Screenshots are DOM rasterisations**, not framebuffer grabs: the page is
  serialised into an SVG `foreignObject` and drawn to a canvas. They were
  spot-checked against real `computer screenshot` captures and match; the
  rasteriser needs two overrides (`backface-visibility` on board tiles, live
  `input.value`) that are noted where relevant. Nothing in the app was changed
  to produce them.
- **T3's "phones" are same-origin iframes in one browser profile**, not separate
  devices — the shared browser's tab pool was saturated by other components'
  testers and `window.open` was popup-blocked. They are real, separate browsing
  contexts with their own PeerJS peers over the real broker, so WebRTC is
  genuinely exercised; but they share one `localStorage`, which I had to clear
  between joins (see D6 and the T3 notes). Anywhere that constraint could have
  produced a false result, I say so.

---

## 2. Results

### T1 — unit (`cd games/family-feud && node --test`)

```
ℹ tests 87
ℹ suites 0
ℹ pass 87
ℹ fail 0
```

38 from the implementer's `tests/feud-core.test.mjs`, **49 new adversarial
tests** from `tests/feud-adversarial.test.mjs`.

**Audit of the existing suite:** every F-U id is genuinely asserted, not
rubber-stamped. F-U7 really deep-equals the pre-event state and pins
`HISTORY_MAX`; F-U9 is genuinely table-driven (26 events × 8 phases) and
deep-freezes its inputs; F-U10 asserts the absence of a specific secret string
in the other player's `phoneView`. I found no test that asserts less than its
id claims.

| ID | Result | Evidence |
|---|---|---|
| **F-U1** | PASS | Existing 3 tests plus `ADV validator: junk types anywhere in the tree…` (30 hostile shapes: `rounds:{}`, `answers:"abc"`, `count:"50"`, `count:NaN`, `settings:[]`, `multipliers:[Infinity]`, 13 rounds, `fastMoney:[null]`, `Symbol`, functions). Every one throws an `Error` that is **not** a bare `TypeError` and carries a readable message. Boundaries pinned both ways: answer text 40 OK / 41 rejected, question 200 OK / 201 rejected. |
| **F-U2** | PASS | Existing tests + `ADV validator: count 100 twice…` (sum 201 loads fine, `warningsFor` reports it — warning, not failure) and `normalizeGame never mutates its input and is idempotent` (also passes on a deep-frozen input). |
| **F-U3** | PASS | Existing 4 tests + 6 adversarial face-off tests. Notably `two board answers of the same COUNT are ranked by board index` — equal *counts* resolve by board rank, and an equal-*rank* tie is structurally impossible because a revealed tile is a no-op, so `rank(a0) <= rank(a1)` never has to break a tie. `clicking a tile before anyone buzzed changes nothing` (all five tiles no-op, and are `disabled` in the UI). `a buzz from a pid on no team is ignored`. |
| **F-U4** | PASS | Existing 3 tests + `ADV play-or-pass: strike / reveal / steal are all inert until Play or Pass` (7 event types plus tile and steal clicks, all reference-identical no-ops) and `ADV strike at 2 then undo…`. |
| **F-U5** | PASS | Existing 4 tests + `revealing the LAST remaining answer during a steal awards the stealers` (bank 80 + stolen 20 → 100 to the stealing team, board complete, `revealRest` then a no-op) and `stealing an already-revealed tile is a no-op, not a free win` (also index 99 / −1 / 1.5 / `"1"`). |
| **F-U6** | PASS | Existing 3 tests + `a full 6-round run-through` — a real 6-round file played end to end asserts `bank × [1,1,2,3,3,3]` per round and that round 7 does not exist. Fractional and single-entry ladders covered. |
| **F-U7** | PASS | Existing 3 tests + `strike at 2 then undo rewinds the third strike exactly` (deep-equal to the recorded state, then 40 undos unwind to an empty stack and stop) and `history entries never carry game or a nested history` (45 events → `history.length === 30`, `HISTORY_MAX >= 20`, serialised state < 400 KB). |
| **F-U8** | PASS | Existing 6 tests + 8 adversarial ones: duplicate on the same board answer index → `points 0, duplicate true`; **"no match" on both sheets is NOT a duplicate**; a duplicate on a different question index is not flagged; **total exactly equal to the target wins** (`>=`), one point short loses, target 0 wins on an empty sheet; the stage machine only walks forward (`play→reveal→cover→play→reveal→done→done`) and `finish` always escapes; junk `seconds`/`now` fall back without ever changing the stage. |
| **F-U9** | PASS | Existing 2 tests + `a whole game can be played with every state deep-frozen` (30-event game, input deep-compared after each step) and `an illegal event returns the IDENTICAL object` (reference identity, so renders are not churned). |
| **F-U10** | PASS | Existing 6 tests + 7 adversarial ones: control chars (NUL, BEL, ESC, DEL, U+0085, newline, CR) stripped; 61 chars capped to 60, 601 rejected at the boundary; **41 junk payloads all return `null` and never throw**, including host→phone shapes (`{t:"view"}`) and reducer event names (`{t:"setScore"}`, `{t:"start"}`); `{t:"buzz",host:true,team:"B"}` is reduced to `{t:"buzz"}`, so a phone cannot smuggle host authority; a `__proto__` key in parsed JSON pollutes nothing; a validated payload is inert in the wrong phase; **no board answer text or count reaches any phone in any of 9 game states**, and only the seated player sees their own Fast Money sheet. |

### T2 — loopback harness (`tests/harness.html` on 127.0.0.1:8642)

`All 42 loopback checks passed.` · `__FEUD_HARNESS__ = {total:42, failed:0,
uncaught:null}` · `#summary.ok` set. Screenshot:
`docs/reports/img/feud-t2-harness.png`.

I read the harness before trusting it: it loads the **real** page in an
`?embed=host` iframe and four `?embed=player` iframes, speaks the 00 §6 bridge
itself, refetches assets with `cache:"reload"`, and stubs no game code.

| ID | Result | Evidence |
|---|---|---|
| **F-I1** | PASS (5) | `Ana, Ben, Cleo, Dev` on the roster; all four open on `team-pick`; taps → `p1+p3 \| p2+p4`; the host toggle moves Cleo (`Cleo is on team 1`) and her phone is pushed `team B`. |
| **F-I2** | PASS (8) | `p1:faceoff p2:faceoff p3:wait p4:wait`; unarmed buzzer `disabled`; early tap → `buzzed=null` with no lockout; arming lights both; first buzz wins (`buzzed=1`), second ignored; `You buzzed!` / `Too late`; `#3` passes the podium, `#1` takes control. |
| **F-I3** | PASS (12) | Fast Money seats `team=0 players=p1,p3`; player 2 sees "Cover your ears!"; five typed phone answers land; reveals total 177; no trace of `Strawberry` in player 2's view or the host's visible table; the repeat is flagged `duplicate=true points=0`. |
| **F-I4** | PASS (2) | Reload mid-round: before/after identical `{phase:"play",revealed:"true,true,true,false,false",strikes:2,control:0,bank:77,history:15,roster:4}`; 3 tiles repaint revealed. |
| **F-I5** | PASS (8) | Download JSON → `application/json` blob, passes `validateGame`, byte-identical to `cleanDraft()`; sum > 100 → amber `Sum 140 ⚠` and the draft still validates; Use in game switches the session. |
| **F-I6** | PASS (7) | Zero markup/dynamic-code sinks, zero `console.log`, all 18 files < 800 lines, only Google Fonts external, `data-gsc-game` + `#gsc-join` present. |

### T3 — real network through the hub (real PeerJS broker + WebRTC) — **not blocked**

Host tab `http://127.0.0.1:8642/` → **Host a game night** → room **`ASKS`**,
join URL `http://127.0.0.1:8642/?room=ASKS`. Two phones joined as `Rita` (p1)
and `Sam` (p2); host status `2 phones connected`. Screenshots:
`feud-t3-hub-host.png`, `feud-t3-phone-fastmoney.png`,
`feud-t3-phone-coverears.png`.

| Scenario | Result | Evidence |
|---|---|---|
| Host picks Family Feud | PASS | Host iframe `games/family-feud/index.html?embed=host&room=ASKS`, `GSC.mode="embed-host"`, `body.gsc-embedded`; phones swap to `?embed=player&room=ASKS&pid=p1&name=Rita`, `body="player-mode gsc-embedded"`; shell bar reads `🎤 Family Feud`. |
| Team picks from phones | PASS | Rita taps A, Sam taps B → host `teams [[p1],[p2]]`; phone badges `Team A` / `Team B` with `aria-pressed="true"`. |
| Host override wins | PASS | Host's "Put Sam on team A" → `teams [[p1,p2],[]]`, and Sam's phone repaints to `Team A` (`view.teamLabel === "A"`). |
| Face-off arm / buzz from phones | PASS | Early tap before arming → `buzzed:null, armed:false` (ignored, no lockout). Arm → both phones show `BUZZ`, enabled. Sam buzzes then Rita: `buzzed=1`; Sam gets `You buzzed!` / "Give your answer out loud", Rita gets `Too late` / "The other podium got there first"; host hint `Team Red answers — click the matching tile…`. |
| Fast Money typed from a phone, other phone covering ears | PASS | Both phones on team A; `beginFastMoney` seats `players:[p1,p2]`. Rita gets `fm-answer` ("Question 1 of 5"), Sam gets `fm-wait` → "Cover your ears! / Mute the call or step away…". Rita types five answers → they arrive verbatim in `fastMoney.rows[1]` **and** in the host's five inputs. **Leak check: none of `Strawberry / Butter / A restaurant / A lion / Read a book` appears anywhere in Sam's DOM or in his `phoneView`.** |
| `⌂ Lobby` then back | PASS | Full state identical across the round trip: `{phase:"play",round:0,control:1,bank:60,strikes:2,revealed:"true,false,true,false,false",scores:[0,0],teams:[[p1],[p2]],hist:12}`; both phones get their views back. |
| Phone reload mid-round | PASS | Rita's phone reloaded; rejoined as `p1:Rita:true`, host still `2 phones connected`, and the correct `wait` view arrived unprompted. Recovery took **~5–10 s**, during which the phone shows "Connecting… / Hold tight — the host screen has everything" — a plain-English placeholder, not a blank page. |
| Late joiner | **FAIL** | See **D2**. Tia joined mid-Fast-Money, reached the hub roster (`p3:Tia:true`) and got the right iframe src, but **zero** bridge messages ever reached her game iframe — stuck on "Connecting…" for 16+ s, across two iframe reloads and a full phone reload, while p1/p2 kept working. A `⌂ Lobby` → re-enter round trip fixed it instantly (`p3 → wait`). Root cause is in the shell, not this component. |

### T4 — standalone / host-only

A complete 6-round game plus Fast Money was played with **no phones at all**.
Screenshots: `feud-t4-board-steal.png`, `feud-t4-fastmoney-done.png`,
`feud-t4-final.png`.

| Check | Result | Evidence |
|---|---|---|
| Setup | PASS | Four manual players added, A/B/– toggles, team names `Rita's Rebels` / `Sam's Squad`; `aria-pressed` tracks the choice. |
| Tiles during face-off before a buzz | PASS | All five tiles `disabled`; clicking each is a no-op; state byte-identical. Space arms the buzzers. |
| Face-off ranking | PASS | Blue reveals `#3` (12) → podium passes to Red → Red reveals `#2` (17) → `control=1, bank=29`; banner `Sam's Squad — play or pass?`. |
| Strike during play-or-pass | PASS | No Strike button rendered; tiles `disabled`; phase unchanged. |
| Strikes → steal | PASS | `✕` / `✕✕` / `✕✕✕` overlay; strike slots gain `.on` **and** `aria-label="Strike n"` vs `"Strike n unused"`; third strike → `steal`, `{active:true,team:1}`, only unrevealed tiles clickable. |
| Undo repeatedly | PASS | Five consecutive undos walked steal-award → steal → strike 3 → 2 → 1 → reveal, each exactly restoring bank / strikes / scores / phase. |
| Reload at every phase | PASS | Reload at `steal` and at `fastmoney/done`: serialised state **identical** before/after; the board repaints 3 revealed tiles and 3 strike marks; FM total `205` and the win banner survive. |
| Edit a score by click | PASS | `<button class="team-score" aria-label="Rita's Rebels score 0. Click to edit.">`; `250` accepted, `abc` refused with *"That score wasn't a whole number — nothing changed."*, Cancel is a no-op, `-40` and `0` accepted, all undoable. (See **D8** for a nit.) |
| Bad JSON via the file input | PASS | Four hostile files each refused with a plain-English `#setup-error`, loaded game untouched: not-JSON, 2-answer round (`Round 1 needs between 3 and 8 answers (found 2).`), empty file, top-level array (`Game file must be a JSON object.`). |
| Good JSON via the file input | PASS | Loads, keeps roster and team names, applies `strikes:2`, disables Fast Money with *"This question file has no Fast Money round (it needs at least 5 Fast Money questions)."* |
| `?game=URL` with the shipped `questions.json` URL | **FAIL** | See **D1**. Works on a clean profile (`Questions: custom URL (…/questions.json)`, 6 rounds); **silently ignored whenever a saved game exists**. A 404 / non-JSON `?game=` falls back to `data.js` and says why in the source note. |
| Editor Download JSON | PASS | `questions.json`, `application/json`, 6823 bytes, trailing newline, parses, **passes `validateGame`**, byte-identical to `cleanDraft()`; round-tripped back through the file-upload path and accepted. An invalid draft is **refused** (no blob created) with the inline message `Round 1 needs a non-empty "question".` Sum > 100 → `Sum 144 ⚠`, amber class and the warning line, and it still downloads (warning, not error). |
| Editor Use in game | PASS | Switches the session to `Tester Cut` / `Questions: question editor` with the edited count in play. |
| Multiplier ladder over 6 rounds | PASS | Live: `93 ×1, 97 ×1, 192 ×2, 285 ×3, 276 ×3, 279 ×3`; "Next round" correctly absent on round 6. |
| Fast Money host-typed | PASS | The clock renders 9 blocks and stops on Lock-in; typing survives the per-keystroke re-render with the **caret preserved** (five fields typed character by character; `focused:true`, caret at end); "Bring in player 2" stays `disabled` until all five rows are revealed; the cover screen **hides player 1's column entirely** (`#fm-table` hidden, no "Apple" in its text); duplicates → `points 0` + `.fm-row.duplicate` + *" Try again — duplicate"*; total `205 ≥ 200` → `Winner! …` with `.fm-result.win`. |
| Final / Play again / Back to setup | PASS | Standings with a text `Winner` badge; note `Fast Money: 205 of 200 — winners!`; Play again → round 1, scores 0, same line-ups and roster; Back to setup → roster and team names intact. |
| Standalone room + `?room=` join | PASS | **Open room (phones)** → `Room SV4P is open — phones can join.`, chip `Room SV4P`, join line with the URL. A phone at `?room=SV4P&name=Rita` joined over the real broker: `GSC.mode="standalone-player"`, `body.player-mode`, `#screen-player` visible, and it received its `phoneView`. |

### T5 — static gates

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | PASS | 87/87. |
| **V2** files < 800 lines, functions < ~50 | PASS | Largest file is now my own `tests/feud-adversarial.test.mjs` at **798**; largest product file `js/feud-app.js` at 728. A brace-depth scan over every `.js`/`.mjs` in the component found **no** function ≥ 50 lines. |
| **V3** no `innerHTML` / `insertAdjacentHTML` / `outerHTML =` / `document.write` / `eval(` / `new Function`, tests included | PASS | `grep -rnE … games/family-feud` → no matches, both test files included. |
| **V4** no `console.log` | PASS | No matches; diagnostics use `console.warn`. |
| **V5** no Peer / connection / DOM / timer handle in state | PASS | Verified at runtime, not only by reading: the live mid-game state `JSON.parse(JSON.stringify(s))` round-trips **deep-equal**, and a recursive walk found **zero** functions and zero non-`Object`/`Array` constructors anywhere in it. The SDK `room` lives in a `FeudRoom` closure, the countdown in `FeudTimer` module state, and the only timer data in state is the serialisable `{running,startedAt,seconds,slot}` cue. |
| **V6** external URLs | PASS | Only `fonts.googleapis.com` / `fonts.gstatic.com` in `index.html`. The component ships no CDN script; PeerJS is pulled lazily by `shared/room-host.js`. (Two `localhost:8620` URLs in `README.md` are prose, not requests.) |
| **V7** `data-gsc-game`, `#gsc-join`, `player-mode` / `gsc-embedded` | PASS | Confirmed live in all four modes: standalone host (bare `body`), embedded host (`gsc-embedded`), embedded player (`player-mode gsc-embedded`), standalone player (`player-mode`); `#gsc-join` present. |
| **V8** `?game=URL` and upload validate through the same `validateGame` | **PARTIAL** | Both paths do call `FeudCore.validateGame` (`feud-app.js:132` fetch, `feud-app.js:177` upload) and I exercised both in the browser, including round-tripping the editor's own download through the upload path. But the `?game=` path is **unreachable in the common case** — see **D1**. |

### Design and accessibility

| Check | Result | Evidence |
|---|---|---|
| Host board readable at 1280×720 | PASS | Measured computed type: question 33.6 px / 700 Inter, phase banner 28.8 px Anton, answer text 24 px Anton, answer count 28.2 px, tile number 41.6 px, bank 57.6 px, team score 57.6 px, strike glyph 32 px. The only small text is the host-only hint line (14.4 px), which the room never needs to read. |
| Phone at 320×640, targets ≥ 56 px | PASS | At a 316 px effective viewport: team A/B 269×84, BUZZ 269×210, FM input 269×56, Back 122×79, Submit 141×79 — all ≥ 56 px, and **no horizontal overflow**. Screenshot `feud-a11y-phone-320.png`. |
| Buttons are `<button>` | PASS | Zero non-`<button>` clickables and zero `.btn`-styled non-button/non-anchor elements on the host page or the phone controller. |
| Colour is never the only signal | PASS | Strikes carry `✕` plus `aria-label="Strike n"` / `"Strike n unused"`; a revealed tile shows answer **text and count** instead of a number; team panels carry text badges `Control` / `Stealing` / `Buzzed in`; the phone buzzer reads `Wait…` / `BUZZ` / `You buzzed!` / `Too late`; FM duplicates carry *" Try again — duplicate"*; the win/lose line and the final `Winner` badge are text; the editor's over-100 badge is `Sum 144 ⚠`. |
| Live regions | PASS | `aria-live="polite"` on `#phase-banner`, `#bank-value`, `#fm-banner`, `#fm-total`; `role="alert"` ×5, `role="status"` ×1; the strike overlay is correctly `aria-hidden="true"` (cue only). |
| `prefers-reduced-motion` honoured | **PARTIAL** | `css/feud.css:582` disables the tile flip, the strike pop, the FM flash and `.btn`; `css/timer.css:71` disables the time-up flash. **`css/feud-phone.css` has no reduced-motion block at all**, so the phone buzzer's transform transition survives — **D3**. |
| Dialogs use `role="dialog"` | **FAIL (minor)** | The question editor is a real modal (`position:fixed; inset:0; z-index:50`, `body.editor-open{overflow:hidden}`) but carries only `aria-label` — **D4**. |

### Security

| Check | Result | Evidence |
|---|---|---|
| Every phone payload validated before it touches state | PASS | `feud-room.js:97` runs `FeudCore.validatePhoneMsg(payload)` and returns on `null` before any `dispatch`. My 41-shape fuzz plus the "inert in the wrong phase" test show a phone cannot set a score, start the game, strike, steal, undo, buzz unarmed, pick a team outside setup, or write into the other player's Fast Money sheet. A phone-supplied `host:true` / `team` / `pid` on a `{t:"buzz"}` is stripped by the validator. |
| No phone string reaches the DOM except via `textContent` | PASS | Component-wide sink census: 46 `textContent`, 23 `.value` (form fields), 8 `className` (static literals), 2 `href`, **0** `innerText`, **0** `src=`, 0 markup sinks. Both `href` writes are host-generated (`feud-editor.js:147` a blob URL, `feud-room.js:192` `room.joinUrl()`); no phone string reaches either. Phone-supplied strings (`row.text`, `player.name`) reach only `el(…) → textContent` and `input.value`. |
| `phoneView` leaks nothing | PASS | Asserted in Node across 9 game states × 3 pids that no board answer text or count ever reaches a phone, and that only the seated player sees their own Fast Money rows; confirmed live over WebRTC in T3 (player 2's DOM and view contain none of player 1's five typed answers). Player 2's `fm-wait` view carries `fm: null`. |
| Content loading | PASS | All three content paths (`questions.json`, `?game=`, upload) and the editor's export go through the same `validateGame`; a `__proto__` key in parsed JSON pollutes nothing and is dropped by `normalizeGame`. |

---

## 3. Defects

### D1 — `?game=URL` is silently ignored once a game has been saved · **major** · not fixed

- **Where:** `games/family-feud/js/feud-app.js:699-706` (`bootHost`).
- **What:** `bootHost` returns the `localStorage` state before it ever looks at
  `?game=`. Since `saveState()` runs on the very first render, every visit after
  the first ignores the query parameter. The host is given a different game than
  the URL asked for, with **no message** — `#source-note` confidently reads
  `Questions: uploaded file (good.json)`.
- **Repro:** open `/games/family-feud/` once (a save is written), then open
  `/games/family-feud/?game=http://127.0.0.1:8642/games/family-feud/questions.json`.
  Observed `source: "uploaded file (good.json)"`, `rounds: 2`. Remove
  `gsc-family-feud-state-v1` and reload the same URL → `source: "custom URL
  (…/questions.json)"`, `rounds: 6`. That is the exact boundary.
- **Why it matters:** `?game=URL` is a house rule (CLAUDE.md), a spec §7
  requirement and gate **V8**. A host who shares a `?game=` link with a co-host,
  or who re-opens their own link after a test run, silently gets the wrong
  content.
- **Proposed fix** (implementer's call — about four lines, still outside my
  write scope):

  ```js
  async function bootHost() {
    wireHostEvents();
    const wanted = new URLSearchParams(window.location.search).get("game");
    const saved = loadSavedState();
    if (saved && (!wanted || saved.sourceUrl === wanted)) { state = saved; render(); return; }
    ...
  ```

  i.e. only resume a save that came from the same `?game=` URL. `sourceUrl` is
  already persisted for exactly this, so nothing else has to change, and a host
  reloading mid-game on the same URL still resumes.

### D2 — a phone that joins while a game is running is never wired to the game iframe · **major** · **not in this component** · not fixed

- **Where:** the hub shell — most likely `js/hub-host.js` (connection
  bookkeeping / `t:"game"` routing) or `js/hub-player.js` (posting `init` to the
  phone's game iframe). **Not** `games/family-feud/**`.
- **What:** a third phone joined mid-Fast-Money. The hub accepted it and the
  Family Feud host correctly listed `p3:Tia:connected true`; the phone's shell
  even swapped in the right iframe
  (`games/family-feud/index.html?embed=player&room=ASKS&pid=p3&name=Tia`). But
  **no `postMessage` traffic of any kind ever reached that iframe** — a listener
  installed on the inner window recorded an empty array across two iframe
  reloads and a full phone reload, over 16+ seconds, while p1 and p2 kept
  receiving views normally. The controller sat on "Connecting…". The host
  shell's own counter also disagreed with its roster (`2 phones connected`
  against three players listed).
- **Recovery:** `⌂ Lobby` → re-enter Family Feud wires it immediately
  (`p3 → wait`). So the game code handles late joiners correctly; only the
  initial wiring at join-during-active-game fails.
- **Caveat:** my three phones are same-origin iframes in one profile (see §1).
  I could not rule out an environment artifact with certainty, but the failure
  is deterministic, survives reloads, is specific to *joining after the game
  started*, and is repaired by a shell-side re-init — all of which point at the
  shell. **The orchestrator should hand this to the shell owner to confirm on
  two real devices.**
- **Workaround for a host today:** after a late arrival, tap `⌂ Lobby` and
  re-enter the game.

### D3 — `prefers-reduced-motion` is not honoured on the phone controller · **minor** · not fixed

- **Where:** `games/family-feud/css/feud-phone.css:93` (`.player-buzz-btn`,
  `transition: transform …`); that file contains **no**
  `@media (prefers-reduced-motion: reduce)` block. The `.btn { transition: none }`
  rule at `feud.css:585` does not match `.player-buzz-btn` / `.player-team-btn`.
- **Repro:** set the OS or browser to "reduce motion"; the phone's buzz button
  still animates its transform on arm and press. The largest, most animated
  element on the phone is the one that ignores the preference.
- **Proposed fix:** add to `css/feud-phone.css`:

  ```css
  @media (prefers-reduced-motion: reduce) {
    .player-buzz-btn, .player-team-btn { transition: none; }
  }
  ```

- Related and even smaller: `css/timer.css:34`
  `.timer-block { transition: background… }` is not covered by that file's
  reduced-motion block (only the time-up flash is). A background cross-fade is
  low-motion; listed for completeness.

### D4 — the question editor is a modal without `role="dialog"` · **minor** · not fixed

- **Where:** `games/family-feud/index.html:159`.
- **What:** `.editor` is `position:fixed; inset:0; z-index:50` with
  `body.editor-open { overflow:hidden }` — modal behaviour — but carries only
  `aria-label="Question editor"`. CLAUDE.md's accessibility rule says dialogs use
  `role="dialog"`. There is also no focus trap and no Esc-to-close; the Close
  button is reachable, so this is unpolished rather than a trap.
- **Proposed fix:** add `role="dialog" aria-modal="true"` to the section;
  optionally wire Esc to `FeudEditor.close()`.

### D5 — a Fast Money timer configured as `0` can never be started · **minor** · not fixed

- **Where:** `games/family-feud/js/feud-core.js:473` (`if (!seconds) return s;`).
- **What:** spec §2 allows `timer1` / `timer2` of `0–120`, and `validateGame`
  accepts `0`. But `fmTimer{action:"start"}` falls back to the configured value
  and then bails on `0`, so on a `timer1: 0` file the **Start timer** button does
  nothing and gives no feedback. Asserted in `ADV Fast Money timers: 0-second
  timers are legal content but the clock cue cannot start`.
- **Judgement:** arguably the intended reading of "0 means no clock", but the
  button is still rendered and silently inert, which breaks the house rule that
  every failure path surfaces a message.
- **Proposed fix:** hide or disable the clock group when
  `clockSeconds(state) === 0` in `feud-fm.js:261`, or label it "No clock for
  this round".

### D6 — a saved game re-applies pid-keyed line-ups to whoever gets that pid in a new room · **minor** · not fixed

- **Where:** design-level; `feud-app.js:92-107` (`loadSavedState`) restores
  `teams[].players` and `fastMoney.players`, which are arrays of shell pids.
- **What:** pids (`p1`, `p2`, …) restart at `p1` for each new room, but the
  persisted Feud state keys team membership and Fast Money seats by pid. A brand
  new phone that happens to be issued `p1` inherits the previous session's team
  **and** Fast Money seat, and is shown that seat's previously typed answers.
- **Repro (observed):** after the T3 session I opened a fresh standalone room on
  the game page; the first phone to join (`?room=SV4P&name=Rita`, pid `p1`)
  landed on `screen: "fm-answer"` with
  `rows: [Strawberry, Butter, A restaurant!, A lion, Read a book]` — the previous
  session's answers — without ever picking a team.
- **Judgement:** partly *intended* (resuming a saved game should restore the
  sheet). The flaw is that identity is not scoped to the room. Low real-world
  impact — the answers belong to a game the host is deliberately resuming — but
  it is surprising, and it is the one place a phone sees text it did not type.
- **Proposed fix:** stamp the room code into the saved state and drop
  `teams[].players` / `fastMoney.players` when the code differs; or clear
  line-ups whenever the roster arrives empty.

### D7 — `fmReveal` does not check the active slot · **minor (informational)** · not fixed

- **Where:** `games/family-feud/js/feud-core.js:420-440`.
- **What:** the reducer accepts a slot-2 reveal while `fastMoney.slot === 1`.
  Duplicate detection only ever inspects slot 1, so an out-of-order reveal skips
  it and the same board answer can be counted twice (`ADV known looseness:
  fmReveal does not check the active slot` pins `fmTotal === 120` where it should
  be 60).
- **Unreachable through the shipped UI** — `feud-fm.js:184` only renders a reveal
  control for `fastMoney.slot` — so this is hardening, not a live bug. Worth a
  `if (slot !== s.fastMoney.slot) return s;` guard so the pure core stands on its
  own.

### D8 — the score prompt accepts trailing junk · **minor** · not fixed

- **Where:** `games/family-feud/js/feud-app.js:482` (`Number.parseInt(raw, 10)`).
- **What:** typing `12abc` sets the score to `12` rather than being refused; the
  "wasn't a whole number" message only fires when the string does not *start*
  with a number. Cosmetic — the host sees the resulting score immediately and can
  undo it.
- **Proposed fix:** `if (!/^-?\d+$/.test(raw.trim())) { …refuse… }`.

### Not defects — checked and cleared

- **A face-off with two equal-rank board answers is structurally impossible** (a
  revealed tile is a no-op), so `rank(a0) <= rank(a1)` never has to break a tie.
  Equal *counts* resolve by board index, which is the right reading of §1.
- **"Face-off again" after an answer was already revealed** keeps that answer
  revealed and its count in the bank. That matches the show (revealed answers
  stay revealed); Undo is the tool for rewinding a mis-click.
- **The blank Fast Money field in an early screenshot** was my rasteriser not
  copying live `input.value`; the live DOM held the typed answer. Fixed in the
  capture — not a product bug.
- **A phone rejected with "That name is taken" on the second join** was my
  single-profile setup (both phones sharing one `gsc-phone-v1`), not the product.

### Note on the implementer's report

`docs/reports/family-feud-implementation.md` §6 lists *"Fast Money reveals are
top-down — a host who wants to reveal out of order can't."* That is **not
accurate**: `feud-fm.js:184` renders a `<select>` for **every** unrevealed row
during the reveal stage, so out-of-order reveal already works (I used it). That
entry should be dropped from the known-gaps list. Everything else I spot-checked
in that report held up, including the file and function line-count claims.

### Judgement on the implementer's ten declared deviations

| # | Deviation | Verdict |
|---|---|---|
| 1 | `feud-core.js` split, content validation in `feud-content.js` | **Acceptable.** Forced by the 800-line rule; `FeudCore` re-exports the whole content API, so the spec §4 surface is exactly as written. |
| 2 | Extra glue files `feud-fm.js`, `feud-boot.js` | **Acceptable.** Same reason; spec §7's file list is a layout sketch, and every file stays well under the limit. |
| 3 | `fastMoney.enabled` defaults to `true` only when FM questions exist | **Acceptable, and better than the literal spec.** The spec's literal default would make every rounds-only file fail to load. Both halves are pinned by tests, and the setup screen explains the disabled checkbox in plain English. |
| 4 | Fast Money questions use the same 3–8 answer rule | **Acceptable.** A reasonable concretisation of "same answer rules". |
| 5 | Extra events (`arm`, `setPodium`, `setTeamName`, `setRoundsToPlay`, `setFastMoney`, `fmAdvance`) | **Acceptable.** All additive; `arm` is in fact *required* by spec §5's phone table, which the spec's own event list omitted. `fmAdvance` collapses the documented FM stage machine into one event — cleaner — and the table-driven no-op test covers all of them. |
| 6 | Podium default is `players[roundIndex % n]` | **Acceptable.** Deterministic, matches "next unused player", overridable via `setPodium`. |
| 7 | Score editing via `window.prompt` | **Acceptable with a caveat.** Keyboard-friendly and short. Worth flagging that `prompt` is blocked in sandboxed iframes: it works in the hub today (verified), but if the shell ever adds `sandbox` to the game iframe, score editing dies silently. See also **D8**. |
| 8 | Timer files vendored from Jeopardy rather than cross-imported | **Acceptable.** Cross-game relative imports would couple two independently shipping components; the duplication is ~190 lines and is clearly attributed. |
| 9 | `feud.css` re-declares `.btn`, `.hidden`, tokens | **Acceptable, but worth a follow-up.** It makes the page work from disk before `shared/theme.css` exists, which is the house rule "works offline / from disk". It does mean a future token change in `shared/theme.css` will not reach this game — the implementer's own note about deleting the duplicated `:root` block should be tracked. |
| 10 | Sudden death omitted | **Correct** — the spec instructs it. |

---

## 4. Verdict

**Fix-then-ship.** The Family Feud rules engine is the strongest part of this
component and I could not break it: 49 adversarial tests aimed squarely at §1
edge cases, validator fuzz, phone-payload fuzz and deep-frozen immutability all
passed on the first run; the reducer returns a reference-identical state for
every illegal event in every phase; and no board answer or other player's Fast
Money text ever reaches a phone — verified in Node, in the loopback harness, and
live over real WebRTC. A full six-round game plus Fast Money plays end to end
host-only, survives a reload at every phase, undoes cleanly, and the editor's
Download JSON round-trips through the upload path. The one defect that belongs
to this component and blocks a clean release is **D1**: `?game=URL` — a house
rule, a spec §7 requirement and gate V8 — is silently dead for any host who has
opened the page before, and the fix is about four lines in `bootHost` using the
`sourceUrl` that is already persisted for exactly this purpose. Everything else
inside `games/family-feud/**` is minor and could ship as known issues, though
**D3** (reduced motion on the phone buzzer) and **D4** (the editor's missing
`role="dialog"`) are one-liners I would still fix first. **D2** — a phone
joining mid-game is never wired to the game iframe — is more serious than
anything in this component, but it is shell-side and needs the shell owner plus
a confirmation on two real devices; Family Feud recovers correctly the moment
the shell re-inits it.
