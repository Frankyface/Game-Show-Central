# Cross-cutting round — verification (docs/19, existing ten games)

Independent tester. Scope: X-1 … X-5 from `docs/19-cross-cutting-round.md` §4,
applied to jeopardy, family-feud, wheel-of-fortune, weakest-link, millionaire,
price-is-right, pyramid, deal-or-no-deal, password, chain-reaction. I fixed
nothing: every defect I found is either more than 5 lines or sits outside
`games/*/tests/` and `docs/reports/`.

## 1. Environment

- Windows 11 Home 10.0.22635, Node v24.16.0, Python `http.server` on
  `127.0.0.1:8732` (own port, stopped after the run).
- Browser: the Claude desktop built-in browser (Chromium). It was shared with
  other agents during the run; see the note under "Method".
- Date 2026-11-03. Every standalone page ran with `?store=t`. Jeopardy has no
  `?store=` support (a known, documented skip), so it used the unsuffixed key
  on the throw-away `:8732` origin.
- **Moving target.** While I was testing, the docs/21 v3 restyle was editing
  `index.html` toolbars (WL, WoF, FF, Pyramid and Jeopardy's `gsc-extras.js`
  were re-saved between 14:29 and 18:23). The toolbar label and placement
  findings below describe what I measured. Re-check them after docs/21 lands.

### Method

- Ran `node --test` at the root and in each game, then every browser harness.
- Ran my own probes from a scratch page. The page loaded each game in a
  1280×720 iframe (`?store=t`) and drove the real buttons: it added players,
  started the game, took a canonical (sorted-key) JSON snapshot of the saved
  state minus `resumable`, then did Game lobby → Keep → (optionally reload) →
  Resume and compared the snapshots. Start over was checked against the saved
  roster, content and settings.
- X-2: I read the picker's options and preview. I stubbed `fetch` so a set
  returns a bad file, then loaded a real set and read the source note. I
  mounted extra pickers with a non-list manifest, a 404 `gameDir` and a
  rejected fetch. Contrast is WCAG, computed from the composited colours.
- X-3: I intercepted `URL.createObjectURL` and the anchor click, ran the
  game's own validator on the downloaded blob, and ran the printed line through
  `GSCLibrary.parseManifest`.
- Embedded: hub at `/?store=t`, a room opened over PeerJS, one real phone
  (`/?room=CODE&store=p1` in a 320×640 iframe) and three hand-added players.
  Each game was picked from the hub. Note: the hub does **not** forward
  `store=` to the game frame, so embedded games wrote their unsuffixed keys on
  `:8732`. This was harmless here (throw-away origin), but worth knowing.
- Process note: some of my early harness navigations ran in the shared pane's
  active tab before I pinned my own tab ids. They may have navigated a tab that
  belonged to another agent (one of them was in turn navigated to `:8731`
  mid-run). All harness counts below come from completed runs I read
  directly.

## 2. Results

### Unit tests

| Suite | Result |
|---|---|
| root `node --test` | **PASS** — tests 1253 / pass 1253 / fail 0 |
| jeopardy | PASS 49/49 |
| family-feud | PASS 87/87 |
| wheel-of-fortune | PASS 71/71 |
| weakest-link | PASS 98/98 |
| millionaire | PASS 67/67 |
| price-is-right | PASS 111/111 |
| pyramid | PASS 95/95 |
| deal-or-no-deal | PASS 89/89 |
| password | PASS 114/114 |
| chain-reaction | PASS 130/130 |

### Browser harnesses (`#summary`, read after the count stopped changing)

| Harness | Result |
|---|---|
| jeopardy `tests/harness.html` | PASS "70/70 checks passed" |
| jeopardy `tests/gsc-embed-harness.html` | PASS "18/18 checks passed" |
| jeopardy `tests/photo-harness.html` | PASS "All 26 photo-clue checks passed." |
| family-feud | PASS "All 84 loopback checks passed." |
| wheel-of-fortune | PASS "All 91 checks passed." |
| weakest-link | PASS "All 74 checks passed." |
| millionaire | PASS "All 79 checks passed." |
| price-is-right | PASS "All 80 checks passed." |
| pyramid | PASS "All 93 checks passed." |
| deal-or-no-deal | PASS "All 83 checks passed." |
| password `harness.html` / `harness-x.html` | PASS "All 75 checks passed." / "All 54 checks passed." |
| chain-reaction | PASS "All 81 checks passed." |

These ran before most of the docs/21 toolbar edits landed. Any harness check
that asserts the old "⟲/↻/↺ Game lobby" label or the old order may need to
follow docs/21.

### Per game × check

Contrast is the picker label on that game's setup well, which is opaque
`rgb(21,24,32)` in every game (WoF has a gradient behind it).

| Game | Check | Result | Evidence |
|---|---|---|---|
| **Jeopardy** | X-1 toolbar | PASS* | `btn-game-lobby` "⟲ Game lobby", after Question Editor (no Sound button in this game). It replaces upstream New Game. |
| | X-1 Keep/Resume | **FAIL** | Embedded, with a clue open: Keep sets `phase:"setup"`, but `#clue-modal` (position fixed, z 50, full frame) **stays on top of the setup screen**. `elementFromPoint(centre)` = `clue-image`. Resume restores `phase:"board"` with `active` intact (state exact). See defect J-1. |
| | X-1 Start over / embedded / standalone | PASS (harness) | gsc-embed-harness X-1 lines; standalone `gsc-has-lobby`, hidden on setup. |
| | X-2 | PASS | options `movies-tv.json, kids-night.json`; preview with counts; stubbed bad set → `"categories" must be a non-empty array.`; load → title "Movies & TV"; broken / 404 / file:// → three plain-English lines, picker hidden; label 8.45:1 |
| | X-3 | PASS | download `photo-harness-game.json` validates with `validateGame`; printed line accepted by `parseManifest`; commit path shown |
| | X-5 | PASS* | No innerHTML/eval/console.log in the GSC files. Upstream `app.js` 1047, `styles.css` 947, `buzzer-*.js` 820/853 are over 800, but they were vendored before this round. **`gsc-extras.js` / `gsc-extras.css` are not in any static-gate source list** (Jeopardy has no gate scenario). |
| | Content | **FAIL (minor)** | see C-1 |
| **Family Feud** | X-1 toolbar | PASS* | "⟲ Game lobby" between Sound and Question Editor standalone; embedded measured Sound · Editor · Lobby (docs/21 order). Hidden on setup. |
| | X-1 Keep/Resume | PASS | Face-off, play/pass decision and mid-board (bank 17, 1 strike): identical snapshot each time, also across a reload; `role=dialog aria-modal=true`. Embedded: identical. |
| | X-1 Start over | PASS | phase setup, bank 0, `resumable:false`, team names and content ("Game Night") kept |
| | X-2 | PASS | kids/office listed; bad set → `"rounds" must be a non-empty array.`; "Questions: set: Office party"; broken manifest lines; label 8.76:1 |
| | X-3 | PASS | `family-feud-office-party.json` validates; line parses; both paths shown |
| | X-5 | PASS | gates clean, largest 797; `feud-setup.js` and `harness-x.js` in `SOURCE_FILES` (sets/*.json are not, which is acceptable for JSON) |
| | Content | PASS | 6 rounds + 6 FM per set, counts plausible, on theme |
| **Wheel of Fortune** | X-1 toolbar | PASS* | "↺ Game lobby" (spec: ⟲) between Sound and Puzzle Editor, hidden on setup. Embedded Sound · Editor · Lobby. |
| | X-1 Keep/Resume | PASS* | Toss-up mid-reveal, round phase and reload: identical. The reveal is frozen while parked (`next` 10→10 over 3 s) but **comes back running** on Resume, not paused (W-1). Embedded identical. |
| | X-1 Start over | PASS | phase idle, players Ann/Bob totals 0, content kept |
| | X-2 | PASS | both sets; bad set → `"rounds" must be a non-empty array.`; "Puzzles: set: Movies & TV — 10 rounds."; label 9.02:1 (on gradient) |
| | X-3 | PASS | `wheel-of-fortune-game-night.json` validates; line parses |
| | X-5 | PASS* | gates clean; `harness-x.js` gated. `harness-x.js:300` calls `W("host").eval(...)`. The gate regex `[^.\w]eval\(` deliberately skips `.eval(`, and the check only evals its own inline expression, so it tests nothing in the game (W-2). |
| | Content | PASS | 10 rounds each, matches the default's shape |
| **Weakest Link** | X-1 toolbar | PASS* | "↺ Game lobby" was **first**, before Sound (Lobby · Sound · Editor); since docs/21 it is Sound · Editor · Lobby. Enabled on setup: the dialog says "There is no game in progress" but still offers Keep. `aria-modal="false"` on the lobby dialog (`index.html:35`). |
| | X-1 Keep/Resume | PASS | With the clock running: comes back **paused** ("Start clock", 2:28 frozen over 1.5 s). The snapshot differs only in `core.clock.remainingMs` (stale running value → value at park). Voting phase + reload: identical. Embedded identical. |
| | X-1 Start over | PASS | `core:null`, roster Ann/Bob/Cy/Dee kept |
| | X-2 | PASS | both sets; bad set → `“questions” must be a list.`; "set: Science & nature"; label 8.24:1 |
| | X-3 | PASS | `weakest-link-science-nature.json` validates; line parses |
| | X-5 | PASS | `wl-store/lobby/library.js`, `harness-cross.js`, sets in the gate list; largest `wl-core.js` 797 |
| | Content | PASS (minor) | 66 questions per set vs 160 in the default. The game's own advice fires: "Only 66 questions — a 6-player game uses ~150" (C-3) |
| **Millionaire** | X-1 toolbar | PASS* | "⟲ Game lobby" between Sound and Question editor; enabled on setup |
| | X-1 Keep/Resume | PASS* | Choose-contestant phase, then question with 50:50 + Phone-a-Friend open, plus reload: identical. The phone window keeps its **absolute deadline**, so the 30 s clock **keeps running while parked** (by design per the report; M-1). Embedded identical. |
| | X-1 Start over | PASS | `core:null`, `resumable:null`, players kept |
| | X-2 | PASS | both sets; bad set → `“questions” must be a list.`; "set: Kids' night"; label 7.99:1 |
| | X-3 | PASS | `millionaire-kids-night.json` validates; line parses |
| | X-5 | PASS | `x-scenarios.js` and sets gated |
| | Content | PASS | 45 questions + 2 FF each. I spot-checked 90 answers and both FF orderings: all correct. |
| **Price Is Right** | X-1 toolbar | PASS* | "⟲ Game lobby" placed **before** Sound (Lobby · Sound · Editor). Hidden on setup. |
| | X-1 Keep/Resume | PASS | Contestants' Row before and after bids reveal, plus reload: identical. Embedded identical (dialog order Cancel / Start over / Keep). |
| | X-1 Start over | PASS | `core:null`, 4 players and "Game Night" content kept |
| | X-2 | PASS | both sets; bad set → `“oneBid” needs at least 4 items…`; "set: Tech & gadgets"; label 7.99:1 |
| | X-3 | PASS | `the-price-is-right-tech-gadgets.json` validates; line parses |
| | X-4 photos | PASS | One Bid card renders `img/mountain-bike.svg` (160×120, alt set, `.prize-photo`). `TpirView.photo` renders `img/espresso-machine.svg`. Note `loading="lazy"`: the image loaded only once the tab was visible. **No `image`/`.svg` in `TpirCore.phoneView` for any of 4 pids.** `javascript:`, `JaVaScRiPt:` and `data:text/html` are refused by `validateGame` with plain messages; `photo()` given `javascript:` renders no `<img>`. The phone DOM was not re-checked in this run (the harness covers it). |
| | X-5 | PASS | `harness-lib.js`, `harness-x.js`, `tpir-media.js`, `tpir-editor-media.js`, `tpir-setup.js` and sets gated |
| | Content | PASS | full shape (12/3/3/3/4). Tech set reuses "Ultrawide monitor" in One Bid (line 15) and Showcase 1 (line 87) (C-4, cosmetic). |
| **Pyramid** | X-1 toolbar | PASS* | "↻ Game lobby" between Sound and Category editor, disabled on setup (now docs/21 "Game lobby") |
| | X-1 Keep/Resume | PASS | Board and in-category with the clock running: Resume returns the clock **paused** (0:28 "Paused.", unchanged over 2 s; diff only `running/deadline/remainingMs` from the pause). Embedded identical. |
| | X-1 reload while parked | **FAIL** | Park (board or mid-category), then reload: `resumable` is saved (`true` before reload) but **dropped on boot** (`null` after), and Resume never appears. Repro twice. See P-1. |
| | X-1 Start over | PASS | `core:null`, players and seats kept |
| | X-2 | PASS | both sets; bad set → `“categories” must be a list.`; "set: Kids night"; label 14.57:1 |
| | X-3 | PASS | `pyramid-kids-night.json` validates; line parses |
| | X-5 | PASS | `pyr-lobby.js`, `harness-scenarios.js` and sets gated; largest `pyr.css` 784 |
| | Content | PASS | 12 categories / 2 circles / 84 words per set |
| **Deal or No Deal** | X-1 toolbar | PASS* | "↺ Game lobby" between Sound and Board editor, disabled on setup |
| | X-1 Keep/Resume | PASS | Banker offer phase, then after No deal + a case + reload: identical. Embedded identical. |
| | X-1 Start over | PASS | `core:null`, roster kept |
| | X-2 | PASS* | both sets; "set: Quick 16"; label 7.99:1. A set of `{}` or `{"title":"bad","nope":1}` is **accepted** as a board (all defaults), so another game's file loads silently as a default board (D-1). A truly bad set (`settings.amounts:"x"`) → `“settings.amounts” must be a list of numbers.` and the note is unchanged. |
| | X-3 | PASS | `quick-16.json` validates; line parses |
| | X-4 animation | PASS | After opening case 7, only case 7 has `is-flipping` and running animations. Cases 2–6 opened one by one: each time only the new case animated, and a MutationObserver never saw an old case get the class again. Banker call: no case flipping and no animations sampled every 30 ms for 1.5 s. After Resume and after reload: no case animating. Next open (case 8) animates alone. |
| | X-5 | PASS | `harness-x.js` and sets gated; `harness.html` 796 |
| | Content | PASS | Quick 16 / High rollers valid, no warnings |
| **Password** | X-1 toolbar | PASS* | "↻ Game lobby" between Sound and Word editor, disabled on setup. Dialog buttons are "Stay here / Start over / Keep this game" (other games say Cancel, and order differs). |
| | X-1 Keep/Resume | PASS | Mid-word after a clue + reload, then between words: identical. Embedded identical. (Lightning-clock park is covered by the harness only.) |
| | X-1 Start over | PASS | `core:null`, seats Ann/Bob/Cy/Dee kept |
| | X-2 | PASS | both sets; bad set → `“words” must be a list of passwords.`; "set: Hard mode"; label 7.99:1 |
| | X-3 | PASS | `password-hard-mode.json` validates; line parses. The line carries placeholder `description`/`by` ("One line about this set…", "Your name") to edit. |
| | X-5 | PASS | `pwd-library.js`/`pwd-lobby.js`/sets gated by `harness-x.html`; `harness-x.html` itself is not in a gate list (but it is under 800 lines, with no sinks found by grep) |
| | Content | PASS (minor) | 90 words per set vs 200 default; the game's own advice fires (C-3) |
| **Chain Reaction** | X-1 toolbar | PASS* | "↻ Game lobby" between Sound and Chain editor. **Enabled on setup** with "There is no game in progress" plus a Keep button. |
| | X-1 Keep/Resume | PASS | Mid-chain after a reveal + reload: identical; "Resume the game" / "Start a new game". Embedded: Keep → setup with Resume, phone shows "Waiting for the host…", Resume restores the reveal. |
| | X-1 Start over | PASS | `core:null`, team names and settings kept |
| | X-2 | PASS | both sets; bad set → `"chains" is missing.`; "set: Out & about"; label 7.99:1 |
| | X-3 | PASS | `chain-reaction-out-about.json` validates; line parses |
| | X-4 phone | PASS | Real phone through the hub at 320×640, with a chain containing THANKSGIVING. Eight rows, one per word, each `.row-tiles` with `display:grid`, `gridTemplateColumns` count = word length = tile count (6,6,5,6,12,3,5,4). Every tile 20 px. All rows centred at x=160. 12-letter row 274 px. `scrollWidth 320 = innerWidth 320`. Hidden letters are blank tiles; top and bottom are fully shown; frontier rows are `is-eligible`; `letter-spacing: normal`. |
| | X-5 | PASS | `harness-kit.js` and sets gated; `harness.html` 796 |
| | Content | FAIL (minor) | `KEEPER → SAKE` is not a compound (C-2) |

\* = passes the functional check, with a placement, label or consistency note
(see defect X-L).

## 3. Defects

| ID | Sev | Game | Where | Repro | Proposed fix | Fixed? |
|---|---|---|---|---|---|---|
| **P-1** | **major** | Pyramid | `games/pyramid/js/pyr-app.js:696` (`pyrChooseContent`) | Start a game → ↻ Game lobby → Keep this game → reload. Resume is gone and `resumable` is `null`. `pyrLoadSaved` keeps it (`:189`), but `pyrChooseContent` copies only `saved.core`. | Add `if (useSaved && saved.resumable) patch.resumable = saved.resumable;` after line 696. This is the same one-liner Password has at `pwd-app.js:726`. Add a harness check that reloads while parked. | No. It is 1 line, but outside my allowed paths. |
| **J-1** | **major** | Jeopardy | `games/jeopardy/js/gsc-extras.js:95-99` (`keepAndExit`) together with upstream `renderClueModal` (`app.js:554`, shows the modal whenever `state.active`) | Open a clue → ⟲ Game lobby → Keep. The setup screen renders underneath, but the clue modal (fixed, z 50, full frame) stays on top. The host sees the clue, not setup. "No one got it" / ✓ / ✗ stay clickable while "parked". Any running clue clock is not stopped (`active.revealed` is false). | Simplest: disable/hide `#btn-game-lobby` while `state.active` is set, with a hint ("finish this clue first"). Or stash `active` in a GSC-side snapshot on Keep and put it back on Resume. Add an X-1 harness check with a clue open. | No |
| W-1 | minor | Wheel of Fortune | `wheel-app.js` resume path | Start the toss-up reveal → Keep → Resume. The reveal resumes **running** immediately. It is frozen while parked, so nothing is lost, but the brief expected a running clock to come back paused. | Resume with `tossup.running:false` and let the host press "Resume reveal". | No |
| M-1 | minor | Millionaire | `wwm-app.js:348` (deliberate: "deadlines and all") | Open Phone-a-Friend (30 s) → Keep → wait → Resume. The window's absolute deadline kept running while parked. Ask the Audience works the same way. | Store remaining ms on Keep and rebase the deadline on Resume, like Pyramid/WL/CR. Otherwise document it as intended. | No |
| D-1 | minor | Deal or No Deal | `dond-core.js` `validateBoard` | Library or upload with `{}` or any object lacking `settings` (e.g. a Family Feud set) → accepted, and plays the default board under the note "set: <name>". | Require `settings` (or `settings.amounts`) to be present in library and upload files. | No (pre-existing validator behaviour) |
| W-2 | minor | Wheel of Fortune | `games/wheel-of-fortune/tests/harness-x.js:300` | "Store: an unsafe ?store= value is stripped" evals a literal expression in the host window. It never exercises `WheelApp.storeSuffix()`, and it uses `.eval(`, which the gate regex skips on purpose. | Call `W("host").WheelApp.storeSuffix()` on a frame loaded with a junk `store=` instead. | No (> 5 lines to do properly) |
| J-2 | minor | Jeopardy | `games/jeopardy/tests/*` | `js/gsc-extras.js` and `css/gsc-extras.css` (added this round) are not in any static-gate source list. | Add a small gate scenario to `gsc-embed-harness.html` covering the `gsc-*` files. | No |
| X-L | minor | all | toolbars | Measured before docs/21: labels were "⟲" (FF, J, WWM, TPIR), "↻" (CR, PWD, PYR) and "↺" (DOND, WL, WoF). Spec: "⟲ Game lobby". Placement was Sound · Lobby · Editor in 7 games, but **Lobby · Sound · Editor in TPIR and (pre-docs/21) WL**, and after Editor in Jeopardy. Setup behaviour differs: hidden (FF, WoF, TPIR, J), disabled (DOND, PWD, PYR), enabled with a "no game in progress" dialog that still offers Keep (CR, WL, WWM). Dialog wording differs ("Stay here" in PWD), as do button order (TPIR, PWD) and `aria-modal` (WL `false`). | docs/21 rule 9 is already moving every bar to Sound · Editor · Game lobby. Finish that in TPIR, WWM, DOND, PWD and CR, and settle one setup rule (disabled is the cleanest). | No (being handled by docs/21) |
| C-1 | minor | Jeopardy content | `games/jeopardy/sets/movies-tv.json` | Line 50: **ER ran 15 seasons, not 11**. Line 51: the M*A*S*H title clue says "about goodbyes and hello" (there is no hello). Line 11: the As I Lay Dying clue is circular and garbled ("shares its title with this 1930 phrase"). Line 17: "borough-adjacent neighbourhood of Manhattan" is nonsense. The "Opening Lines" category (lines 8–11) is mostly novels in a Movies & TV set. | Fix the facts and rewrite the clues; swap "Opening Lines" for opening lines of films. | No |
| C-2 | minor | Chain Reaction content | `games/chain-reaction/sets/kids-night.json:18` | `SHOP KEEPER → KEEPER SAKE`: "keeper sake" is not a phrase (the word is "keepsake"). | End the chain e.g. `… SHOP, KEEPER, GOAL` → reword, or `WORK, SHOP, LIFTER`. | No |
| C-3 | minor | WL, Password content | `weakest-link/sets/*.json`, `password/sets/*.json` | 66 questions (default 160) and 90 words (default 200). Each game's own `warningsFor` flags them. That is thinner than "same quality bar as the default file". | Grow WL sets to ≥150 and Password to ≥120. | No |
| C-4 | cosmetic | TPIR content | `price-is-right/sets/tech-and-gadgets.json:15,87` | "Ultrawide monitor" at $649 appears in both One Bid and Showcase 1. | Swap one of them. | No |

Not defects, but noted:

- The hub does not pass `?store=` through to the game iframe.
- Jeopardy ignores `?store=` (documented and deliberate).
- TPIR images are `loading="lazy"`, so they paint only once the page is
  visible. That is fine on a projector.
- I checked every shipped set against its game's validator in Node: all valid.
  Every manifest parses (2 entries each), and every manifest `counts` matches
  its file.

## 4. Verdicts

**Jeopardy — fix-then-ship.** Harnesses 70/18/26 green, and the library and
"Download for the library" work end to end. The lobby is state-exact (Keep is
just `phase:"setup"`). But parking while a clue is open leaves the clue modal
covering the setup screen, with its judge buttons live (J-1). Fix that, fix the
four factual or garbled clues in Movies & TV (C-1), and gate `gsc-extras.*`.

**Family Feud — ship.** Keep/Resume is exact from face-off, play/pass and
mid-board, across a reload and embedded. Start over keeps teams and content.
The library, its error paths and the export all pass. Content is solid. Only
the toolbar order note (X-L), which docs/21 resolves.

**Wheel of Fortune — ship.** Everything functional passes, including the reload
and embedded paths. The toss-up reveal resumes running rather than paused (W-1),
and one harness store check is tautological (W-2). Both are minor.

**Weakest Link — ship.** The clock comes back paused, voting phase and reload
are exact, and library and export pass. Minor: thin sets (66 questions, C-3),
a non-modal lobby dialog, a "Keep" offered with no game in progress, and the
toolbar order, which docs/21 is fixing.

**Millionaire — ship.** Exact restore through lifelines and a reload. Good
content; I checked all 90 answers. The phone and audience deadlines keep
running while parked (M-1). That is a deliberate design, and the orchestrator
should either accept it or ask for it to pause.

**Price Is Right — ship.** Photos render on the host One Bid card (both shipped
SVGs), never appear in any phone view payload, and `javascript:` and
`data:text/html` are refused. Lobby, library and export all pass. The toolbar
puts Lobby before Sound (X-L); there is one duplicated prize name (C-4).

**Pyramid — fix-then-ship.** In-session Keep/Resume is exact and the clock comes
back paused, and library and export pass. But **a parked game is lost on
reload** (P-1): `pyrChooseContent` never restores `resumable`. The fix is one
line plus a harness check.

**Deal or No Deal — ship.** The §3 animation fix is verified rigorously: only
the opened case flips, the banker call and restores animate nothing, and old
cases never re-flip. The lobby is exact through the offer phase and a reload.
D-1 (any object passes as a board) is pre-existing and minor.

**Password — ship.** Exact across a reload, embedded and between words.
Library and export pass. Minor: thin sets (C-3), and dialog wording and order
that differ from the other games.

**Chain Reaction — ship.** The §3 phone grid is verified on a real phone through
the hub at 320×640 with a 12-letter word: one grid row per word, n tiles per
row, 20 px tiles, centred, no horizontal scroll. The lobby is exact embedded,
standalone and across a reload. One weak link in the Kids' night set (C-2).
