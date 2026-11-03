# Match Game — verification report

Component `match-game` · spec `docs/18-match-game-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` and every rule in `docs/reports/00-orchestrator-triage.md`.
Independent tester: I did not write this code.

## 1. Environment

- Windows 11 Home 10.0.22635, Node v24.16.0, Python `http.server` on 127.0.0.1:8731 (my own port;
  stopped when I finished), date 2026-11-03.
- Browser: the shared in-app browser pane was being driven by other agents at the same
  time (my tab was navigated away twice and the tab cap was reached). I ran every browser tier in
  my own **headless Microsoft Edge 157** (Chromium) instead. It had a separate profile and I drove it
  over the Chrome DevTools Protocol from a small Node script. Viewports were set per call: 1280×720,
  1280×676, and 320×640 mobile.
- T3 used the **real PeerJS broker and WebRTC** with one hub host tab and two phone tabs (rooms
  NK3G and DFT4). The broker was reachable, so nothing is recorded as BLOCKED-ENV.
- Storage: the standalone runs used `?store=t`. The hub runs used the real key, but only inside the
  throw-away headless profile, so the user's browser was not touched.

## 2. Results

| ID | Result | Evidence |
|---|---|---|
| **V1 / T1** `cd games/match-game && node --test` | PASS | 93 tests: **91 pass, 0 fail, 2 todo**. The 2 todo tests pin the open defects MG-D3 and MG-D4. The implementer's 73 tests plus my 20 in `tests/mg-tester.test.mjs`. Root `node --test`: 1395 tests, 1393 pass, 0 fail, 2 todo. |
| Tests are genuine | PASS | I read M-U1…M-U10 and the adversarial file. They contain real assertions on values, not just "does not throw": a deepEqual of data.js against prompts.json, a 10 000-event fuzz with invariants, and leak searches. |
| M-U1 validator | PASS (with MG-D4) | 29 prompts, a prompt with no `___`, panelSize 7 or 1, 2 audience values, 0 / 7 / "abc" multipliers, Infinity rounds, 9 audience prompts, and null, 7, string or array input are all refused with an English sentence (no "undefined", "NaN" or "[object"). **A 161-character prompt is accepted and silently cut to 160** (MG-D4). |
| M-U2 / M-U10 masking (my `T-leak` ×3) | PASS | After every single event through a full turn, no phone view (other panelists, both contestants, 8 audience pids) contains an unrevealed answer, and `hostCards` hands out `null` for each unflipped card. Exactly `i+1` texts show after flip `i`. Contestant phones never carry a panel answer in any phase. The Head-to-Head cards reach only the chosen panelist's phone, the contestant's card reaches no phone, and audience phones never see each other. |
| M-U3 points / M-U4 alternation (`T-points`) | PASS | With pointsPerMatch=2 the order is r1 Ada, Ben · r2 Ben, Ada · tiebreak Ada, and scores are 4–4. A tie cannot move on to the Super Match. |
| M-U4 round-two rule on/off (`T-rule2`) | PASS | On: round 2 locks exactly the slots this contestant matched. A locked slot cannot be answered and its phone is told to sit out. Round 3 is cumulative. Off: all slots, nothing locked. In the browser, the Movies & TV set (rule on) showed "already matched" and hid the form on the matched card. |
| M-U5 tiebreak (`T-tiebreak`) | PASS | A repeated level score gives Tiebreak 1, then Tiebreak 2. The tiebreak is refused when the score is not level. The leader goes to superChoice. The browser showed "Level", "Play a tiebreak prompt", then "Tiebreak 1". |
| M-U6 top three (`T-top3` ×3) | PASS (with MG-D3) | "  Ice   Scraper ", "ice scraper" and "ICE SCRAPER!" make one row. A row merged into a row re-ranks the board. An off-board pair (flashlight + torch) climbs onto the board. Merging maps (3) into torch (2) gives torch 5 on top. A self-merge after normalising is refused. A 30-link chain past MERGE_DEPTH never hangs and counts every answer once. **A cycle through a chain (a→b, b→c, then b→a) was accepted — fixed (MG-D8).** **The label of a merged row can be the folded-in answer** (MG-D3). Articles ("a map" / "the map") are not folded automatically. The spec does not require it, and the merge buttons fold them. |
| M-U7 audience values (`T-values`) | PASS | idx 0/1/2 pay 500/250/100 and go to hthPick. The idx values "0", 3 and -1 are misses. Three misses pay $0. A fourth pick is refused. The Head-to-Head base is then min = 100. |
| M-U8 spin under rng, Head-to-Head with and without an Audience Match (`T-spin`, `T-hth`) | PASS | rng 0, .33 → ×10; .34, .66 → ×20; .67, .9999, 1, 5 → ×30; -3 and NaN → ×10. A spin after the judgement is refused. With an Audience Match: 250 × 20 = 5 000, total 5 250. Without: 100 × 30 = 3 000. A reveal needs both cards. |
| M-U9 undo / illegal / immutable (`T-undo`, `T-frozen`, `T-proto`) | PASS | Undo walks back 40 steps across standings → hthResult → hthPrompt → audienceBoard → superChoice → prompt, and each step equals the earlier state exactly. A whole game runs on **deep-frozen** states and events with no write. `__proto__`, `constructor`, `toString`, `__defineGetter__` and similar event types, slots, pids and merge keys never reach state, and the prototype is intact. |
| Phone-message fuzz (`T-phone` ×2) | PASS | A 41-character answer is capped at 40. C0/C1 control characters are stripped. Junk frames (number, array, `t:"__proto__"`, a 5000-character text, an object `t`) return null. An audience or contestant phone cannot answer for the panel. A phone sending `slot:0,pid:"p1"` still only writes its own seat. The wrong panelist, a contestant or an audience phone cannot write the Head-to-Head, a phone can never write the contestant's card, and a late hth after the reveal is refused. |
| **MG-I1…MG-I6** harness `tests/harness.html` | PASS (one flake) | 55/55 on three runs (one of them after all my fixes). On the very first run MG-I1 "each panelist gets their own answer back with a sent tick" failed once (MG-D10, a harness race). |
| **T4** standalone, host types the panel, two manual contestants (Marcy / Otis) | **FAIL** (MG-D1) | Setup → library set → R1 (Marcy 2, Otis 1) → round scores → R2 with the round-two rule → level → tiebreak → Super Match → Audience Match with 10 host-typed answers and merges → a miss, then #1 = $500 → pick a panelist → **stuck: "Waiting for Cy."** There is no control for the host to type the panelist's Head-to-Head card (`img/mg-verify-hth-hostonly-stuck.png`). The run finished only by dispatching the event from the console: ×20 = $10,000, standings "Marcy takes the night". |
| T4 reload at every phase | PASS | Reloaded mid-reveal (card 2 live): `current` was identical and Match was enabled. Also reloaded at round scores, during the round-two prompt (after Keep), at hthPrompt, and on the board. Each restored the same phase and screen with no error. |
| T4 undo | PASS | Undo after a flip took revealed from 2 to 1, and the card back emptied again. Undo on the board, at standings and on the result screen all worked. |
| **X-1** game lobby | PASS | `btn-game-lobby` reads "⟲ Game lobby" and is disabled until there is a game. Its dialog has `role="dialog"`. **Keep** goes to setup with Resume visible and no answer anywhere in the DOM; after a reload, Resume restored the state byte-for-byte (`JSON.stringify(core) === saved.resumable`). **Start over** gives setup with no Resume, and the names, seats, set, and the round-two rule are kept. Embedded in the hub, Keep and Start over behaved the same. |
| **X-2** library | PASS | The picker lists Kids' night and Movies & TV. Loading each validates and gives "set: Kids' night" (4 seats, $300) and "set: Movies & TV" (6 seats, rule on). Mounting the picker on a missing manifest shows a plain-English "No saved sets…" line. |
| **X-3** editor | PASS | A bad line gives "Fix these lines: Prompt line 33 has no ___ blank" and **Download is blocked** with an explanation. Download JSON produces a valid `prompts.json`. Download for the library produces a valid `tester-night.json`, the manifest entry and the commit path. **Use in game** gives "Custom prompts (from the editor)". |
| **V8** `?game=URL` vs a save; bad JSON; upload | PASS (MG-D11 minor) | `?game=sets/kids-night.json` won over a saved Movies & TV set, and reloading kept it (it came from that URL). A 404, README.md (not JSON) and `sets/index.json` (an array) each give a plain message. Upload of `{not json` or a file with no blanks is refused with a reason, and a good upload loads. Every path goes through `mgUseGame → validateGame`. |
| Layout 1280×720, no scroll in play | PASS | scrollHeight = clientHeight = 720 on the prompt, round scores, all Super Match screens and standings (setup scrolls, which is allowed). |
| Layout 1280×676, no scroll in play | PASS after fix, small residual | Every play screen is 676/676 with six 40-character answers and 40-character Head-to-Head cards, **except** the Audience Match board with long answers: **1995 px** before my CSS fix (MG-D5, one letter per line, `img/mg-verify-board-overflow-1280x676.png`) and **784 px** after it (`img/mg-verify-board-fixed-1280x676.png`). |
| **T3** the panelist's answer is not in the host DOM (input values included) until the reveal | PASS | Pat (p1, panel seat 1) sent `zqpatsecret1`. The host shell and game iframe outerHTML and every input value did **not** contain it after the send or after the contestant's answer was locked. It appeared on the card back only after **Reveal**. The phone then said "Pencils down." |
| T3 Audience Match goes to the audience phone, not the panelist | PASS | Aud saw the "Audience Match" prompt with a form, and Pat saw "Audience Match." with no form. Pat's forged `{t:"audience"}` and `{t:"hth"}` frames were ignored, so the board held only `p2:Gloves`. |
| T3 Head-to-Head from the panelist's phone | PASS | Pat's phone got the hth screen and Aud's waited. Pat sent `zqpathth`, Aud's forged hth frame was ignored, and the host DOM did not contain the answer until "Turn both cards over". Match at ×10 → $5,000. |
| T3 phone reload mid-prompt keeps the answer | PASS | Pat reloaded after sending. Both phone tabs share one browser profile (a test-environment limit noted in the triage), so the hub pre-filled the other phone's name. After rejoining as Pat (relinked to p1), the phone showed "Sent ✓ · Your answer zqpatsecret1". |
| T3 `⌂ Lobby` and back | PASS | Back to lobby, then Match Game again: the hthPrompt phase was intact with panelText kept, and Pat's phone was back on its hth screen. |
| T3 night scoreboard gets the winner's money | PASS after fix | Before the fix, **host-typed contestants never reached the scoreboard** (MG-D7). A phone contestant did ("Aud 1000"). After the fix, host-typed Marcy shows 3000 and Otis 0. |
| Cross-cutting: saved state scoped to the room | **FAIL** (MG-D2) | The game was saved in room NK3G with Pat = p1 on panel seat 1. In a brand-new room DFT4, a new phone "Zed" was issued p1 and **landed on Pat's panel seat with the prompt and answer form**. |
| Cross-cutting: prototype-shaped handler lookup guarded | PASS | `has(HANDLERS, type)`, plus `T-proto`. |
| Cross-cutting: `?game=URL` wins over a save | PASS | See V8. |
| Cross-cutting: no local palette override | PASS | No `[data-gsc-game]` block in `css/`. The tokens come from `shared/theme.css:171`. |
| Cross-cutting: both gradient stops clear contrast | PASS after fix | A walk over every visible text node on the prompt and board screens, against every stop, found one failure: Match / `btn-green` text #12200a on the avocado stop = **4.46:1** (MG-D9, fixed to 5.0:1). Card faces: ink on #ff8c1a is 7.5 and on #e6b800 is 9.4. |
| Cross-cutting: motion only under `no-preference` | PASS | CSSOM walk over the live sheets: all 3 `@keyframes` and 4 `animation` rules in the game sheets sit inside `prefers-reduced-motion: no-preference`. The only other transitions are the shared `.btn` colour fade in `shared/theme.css` and a browser-injected style. |
| Cross-cutting: splash skipped when embedded; harness `?store=` namespace; damaged-save message | PASS | `gsc-splash` stayed hidden in the hub frame. The harness uses `?store=harness`. `mgLoadSaved` names the damaged save. |
| Cross-cutting: every rejected input explains itself | PASS | Settings, editor, uploads, `?game=` and Start all show an error line (see MG-D11 for one misleading one). |
| Phone 320×640 | PASS after fix | The field and Send are 268×56 px and there is no sideways scroll (320/320). **Before the fix, the phone frame showed the whole empty host setup form, and the answer card sat at y = 1025 px in a 636 px frame** (MG-D0, critical). Smallest text: the kicker at 11.2 px (MG-D14). |
| V2 file size | PASS | Largest: `mg-core.test.mjs` 751, `mg.css` 740, `mg-app.js` 692. I spot-read the long functions and found none clearly over ~50 lines. |
| V3 innerHTML / eval / … | PASS | The only hits are two comments and the harness's own banned-word regex. |
| V4 console.log | PASS | 0 in `js/` and `tests/`. |
| V5 no handles in state | PASS (code read) | `mgSerialise` stores plain data. The spin timer and room live in module variables. |
| V6 external URLs | PASS | Only Google Fonts (`index.html:8-10`). |
| V7 body / join / classes | PASS | `data-gsc-game="match-game"`, `#gsc-join`, and `player-mode` / `gsc-embedded` are all wired. |
| Security read | PASS | Every phone frame goes `validatePhoneMsg` → `phoneMaySend` → reducer phase check. `who` never comes from a phone. textContent is used everywhere. `?store` is sanitised. Merge keys pass through `normaliseAnswer`, so `__proto__` becomes `proto`. |
| Content: 60 prompts, 20 audience prompts | PASS (1 swap) | All are family-friendly, original, and have one clear `___` (≤ 80 chars). I replaced audience prompt 13 "Something you say when you stub your toe": it invites swearing, and audience answers go straight onto the shared board. The replacement, "A noise a car should never make", went into `prompts.json` and `js/data.js` (the M-U1 mirror test passes). |

## 3. Defects

Fixed by me (each under 5 lines; diffs below):

| # | Sev | Where | Problem → fix |
|---|---|---|---|
| MG-D0 | **critical** | `js/mg-phone.js:137` | In player mode `#screen-setup` was never hidden (it has no `hidden` class and `mgBoot` does not run on phones). Every phone showed an empty host setup form, and the prompt and answer field sat ~1000 px down the page. Fix: `show($("screen-setup"), false);` in the phone boot. Card now at y=30 (`img/mg-verify-phone-320.png`). |
| MG-D7 | major | `js/mg-room.js:105-108` | `.filter((row) => row.pid)` dropped host-typed contestants, so the usual night (contestants typed in) reported nothing to the night scoreboard. The hub keys pid-less rows by name. Fix: send `pid: row.pid \|\| null` and drop the filter. |
| MG-D5 | major → residual minor | `css/mg.css:604-606` | On the Audience Match board, the merge buttons (up to 5, each the full answer text) took the row's width, so a long answer wrapped **one letter per line** and the page grew to 1995 px at 1280×676. Fix: the merge box gets its own grid line (`.board-row .merge-box{grid-column:2/-1}`, `.other-row .merge-box{grid-column:1/-1}`). **Residual (open, minor):** with ~15 distinct 30+ character answers the board still scrolls 108 px at 1280×676. Suggest shortening the merge-button labels (ellipsis at ~16 characters) or lowering `.others` max-height. |
| MG-D6 | minor | `js/mg-app.js:504-506` | "Play another game" (`btn-next-game`) had no handler. Fix: when embedded it calls `room.exit()` (back to the hub lobby); standalone it starts over. Verified in the hub. |
| MG-D8 | minor | `js/mg-core.js:319` | The cycle check only compared the end of `into`'s chain with `from`, so a→b, b→c then b→a was accepted. Not reachable from the UI, which only passes root keys. Fix: refuse when `resolveKey(into) === resolveKey(from)`. |
| MG-D9 | minor | `css/mg.css:148` | `.btn-green` text #12200a was 4.46:1 on the avocado stop. Changed to #0a1205 (5.0:1). |

Open, for the implementer:

| # | Sev | Where | Repro | Proposed fix |
|---|---|---|---|---|
| **MG-D1** | **critical** | `js/mg-super.js:198-213`, `index.html:272-276`, `js/mg-app.js:417-423` | Standalone with no phones (every panel seat on "host types") → win → Head-to-Head → pick any panelist. The only form is "What the contestant wrote". Nothing can set `hth.panelText`, so "Turn both cards over" stays disabled forever ("Waiting for Cy."). This breaks the hard rule "everything works without phones". The implementer's report says this T4 run was played host-only to ×20 = $10,000, but that is not possible from the UI. | Add a second rail form, "What ⟨panelist⟩ wrote" → `hthAnswer{who:"panel"}`. Show it when `state.panel[hth.slot].pid` is empty (or always, as a host override), with the same "hide as I type" option. Add a harness check that drives a host-only Head-to-Head through the UI. |
| **MG-D2** | major | `js/mg-app.js:672-675` (`bindRoom`) | Play in room A with a phone on a seat → open a brand-new room B → the next phone to join is issued `p1` and **inherits that seat** (reproduced: Zed got Pat's panel seat 1 and the answer form in DFT4). `bindRoom` only stores the code and never compares it. This is the cross-cutting "saved state not scoped to the room" rule. | Port `pyrBindRoom` (`games/pyramid/js/pyr-app.js:443-458`): when the code differs, clear phone pids from setup, drop `core` / `resumable` if they seat phone pids, and say so in plain English. |
| **MG-D3** | major | `js/mg-select.js:113-121, 128-148` | Board: "Map" ×1, "flashlight" ×1, "Flashlight" ×1. Host merges Map → flashlight. The row now reads **"Map — 3 said it"**, and its merge buttons are labelled "→ Map" (`img/mg-verify-board-1280x720.png`). `bestLabel` counts exact texts and gives a tie to the first one seen, so the folded-in answer can name the group. The board the room sees then shows the wrong answer. Pinned by a todo test in `mg-tester.test.mjs`. | Choose the label only from submissions whose own `key === group.key` (the target's wording), most-said first. Fall back to all variants only if there are none. Remove `todo` from the test. |
| MG-D4 | minor | `js/mg-content.js:111` | A 161-character prompt passes `validateGame` and is cut to 160. If the `___` is at the end, it is cut off and the error then blames a missing blank. Spec: "≤ 160 chars". (I applied and then reverted a 2-line fix, because M-U1 `mg-core.test.mjs:75-83` pins the truncation behaviour.) | `cleanText(source.text, PROMPT_MAX + 1)`, then `fail("… is longer than 160 characters.")`. Change the M-U1 test to expect the refusal and remove `todo` from mine. |
| MG-D10 | minor | `tests/harness.html:287` | MG-I1 "sent tick" waits only for p1's view, then checks all three phones, so it failed once in four runs. | `waitFor(() => PANEL.every((pid) => view(pid).sent))`. |
| MG-D11 | minor | `js/mg-app.js:206` | When `?game=` fails, the message says "Falling back to the shipped prompts", but a saved non-default set is kept. The validator message also ends in "..": "it should be a JSON object.. Falling back". | Word it "Keeping the prompts you had", and strip the trailing period before appending. |
| MG-D12 | minor | `js/mg-core.js:394-401`, `js/mg-super.js:204-205` | "Spin again" re-spins until the reveal, so a host can fish for ×30. The show spins once. | Refuse `spin` when `hth.spun`, or keep the re-spin but log it. Disable the button after the first spin. |
| MG-D13 | minor | `js/mg-super.js:186-194` | The "Pick one panelist" cards show the **previous prompt's** flipped answers and "NO MATCH" marks (`img/mg-verify-hthpick-1280x720.png`), because they render `hostCards(state)` from the stale `current`. | Render name-only pick cards, or pass cards with `revealed:false, judged:null`. |
| MG-D14 | minor | `css/mg-phone.css` (kicker), `index.html:225` | The phone kicker is 11.2 px, below the 12 px floor. The board's prompt line (`.prompt-hint`, ~14 px green) is small for a shared screen at 1280×720. | Kicker 0.75rem → 0.8rem. On the board, use `.prompt-text` or a larger hint. |
| MG-D15 | minor | `js/mg-core.js:49, 470` | Phone events (panel and audience answers) go onto the undo history, so the host's Undo can remove a phone's answer instead of the host's last decision. 200 audience answers also push everything before the board out of the 40-slot history. | Add `panelAnswer` / `audienceAnswer` / `hthAnswer` from phones to `NO_HISTORY`, or keep a separate host-decision stack. |
| MG-D16 | minor (observation) | `js/mg-view.js:254` | The host's card form stays active on a phone-seated card, so the host can overwrite a phone panelist's secret answer by mistake. | Hide the form on phone seats (or label it "override"). |

Not a defect: articles are not normalised ("a map" vs "map"). Spec §4 normalisation is trim, case-fold and collapse spaces; the merge buttons cover the rest.

### Diff of my changes (all inside `games/match-game/`)

```diff
js/mg-phone.js
     show($("screen-phone"), true);
+    show($("screen-setup"), false);   // tester fix (MG-D0): the host setup form was showing above the phone card
js/mg-room.js
+      // Tester fix (MG-D7): host-typed contestants have no pid; the hub keys those rows by name.
       const rows = core().standings(state)
-        .filter((row) => row.pid)
-        .map((row) => ({ pid: row.pid, name: row.name, score: row.money }));
+        .map((row) => ({ pid: row.pid || null, name: row.name, score: row.money }));
js/mg-app.js
   ["btn-new-game", mgLobbyRestart],
+  // Tester fix (MG-D6): "Play another game" had no handler. Embedded → the hub lobby.
+  ["btn-next-game", () => { const r = window.MgRoom && window.MgRoom.room;
+    if (r && r.exit && document.body.classList.contains("gsc-embedded")) r.exit(); else mgLobbyRestart(); }],
js/mg-core.js
-    if (resolveKey(merges, into) === from) return state;                // never a loop
+    if (resolveKey(merges, into) === resolveKey(merges, from)) return state; // never a loop
css/mg.css
-  color: #12200a;
+  color: #0a1205;   /* tester fix (MG-D9): #12200a was 4.46:1 on the avocado stop; this is 5.0:1 */
+/* Tester fix (MG-D5): merge buttons get their own line so a 40-char answer never collapses to one letter per line. */
+.board-row .merge-box { grid-column: 2 / -1; }
+.other-row .merge-box { grid-column: 1 / -1; }
prompts.json + js/data.js (identical edit)
-    { "text": "Something you say when you stub your toe", "hint": "" },
+    { "text": "A noise a car should never make", "hint": "" },
tests/mg-tester.test.mjs   (new, 20 tests, 2 marked todo for MG-D3 / MG-D4)
```

Screenshots: `docs/reports/img/mg-verify-*.png` (prompt, board before and after, the Head-to-Head stuck host-only, the pick screen, 1280×676 Head-to-Head, phone at 320 px).

## 4. Verdict

**Fix-then-ship.** The core is solid, and its central promise holds under real PeerJS: no panel
answer reaches the host DOM (inputs included), another phone or a contestant before its card is
flipped. Scoring, alternation, the round-two rule, the tiebreak, the Audience Match values, the
spinner, undo and immutability all hold up to adversarial and frozen-state tests, and the
harness, library, editor and game lobby all work. Before the fixes, though, phones were close to
unusable (MG-D0, fixed). Three open defects must be fixed before merge:

- **MG-D1 (critical):** a host without phones cannot finish the Head-to-Head, which breaks the
  "everything works without phones" rule. This contradicts the implementer's report.
- **MG-D2 (major):** the save is not scoped to the room, so a new room's p1 inherits a seat.
- **MG-D3 (major):** a merged board row can display the wrong answer.

The rest are minors for the README's known issues or a quick follow-up.
