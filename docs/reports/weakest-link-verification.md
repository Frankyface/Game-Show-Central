# Weakest Link — verification report

Component: `weakest-link` · Spec: `docs/05-weakest-link-spec.md` ·
Plan: `docs/06-verification-plan.md` · Implementer's report:
`docs/reports/weakest-link-implementation.md`
Tester: independent (did not write the code).

**Verdict: fix-then-ship.** Three majors (WL-1, WL-2, WL-7); nothing critical.

---

## 1. Environment

| | |
|---|---|
| OS | Windows 11 Home 10.0.22635 |
| Node | v24.16.0 |
| Browser | Chromium (in-app Browser pane) |
| Server | `python -m http.server 8644 --bind 127.0.0.1` at the repo root (launch config `hub-test-wl`) |
| Date | 2026-09-03 |
| Under test | `games/weakest-link/**` on `main` |

Screenshots: the in-app browser returns images inline and cannot write files, so
no `docs/reports/img/` files were produced for this component. Evidence below is
DOM text, harness PASS lines and `node --test` output, all captured live.

New test files added by the tester:

- `games/weakest-link/tests/wl-adversarial.test.mjs` — 33 adversarial rules tests (A1–A7).
- `games/weakest-link/tests/wl-adversarial-fuzz.test.mjs` — 19 validator / phone-message /
  immutability / undo tests (A8–A10). Split from the first file **only** because a single
  file came to 875 lines and gate **V2** caps every file at 800.

Tests named `DEVIATION …` assert what the code does *today* (so `node --test` stays green)
and carry the defect id in their name.

---

## 2. Results

### T1 — unit (`cd games/weakest-link && node --test`)

`ℹ tests 97 · ℹ pass 97 · ℹ fail 0` (45 shipped + 52 new adversarial).

| ID | Result | Evidence |
|---|---|---|
| **K-U1** `validateGame` | PASS | Shipped file accepted (160 q, 9 categories); 39 questions, non-increasing chain, `finalPlayers:3`, empty answer and `roundSeconds:0` all rejected. Re-checked adversarially with 30 more malformed files (`A8 validateGame rejects the documented bad files…`): descending chain, chain of 2 and of 13, float/zero/string chain values, `roundSeconds` `[601]`/`[-30]`/`[]`/non-array, `finalQuestionsEach` 11 and 2.5, `finalMultiplier` 0, 4-char currency, non-boolean `topOfChainEndsRound`, non-object settings, numeric title, `[]`, `"a string"`, `42`, `undefined`. 201-char question rejected, 200 accepted; 81-char answer and 31-char category rejected; nine junk-row shapes named by index ("Question 6 …"). `js/data.js` deep-equals `questions.json`. |
| **K-U2** chain | PASS | Correct climbs, wrong resets, bank moves the chain and credits the player on turn, top auto-banks. Adversarial: bank at chain 0 returns the **identical object** and pushes no undo step; a second bank in a row is a no-op; with `topOfChainEndsRound:false` a second full climb leaves the round bank capped at the chain top ($125,000) and the round alive; a 3-link custom chain auto-banks at its own top. |
| **K-U3** clock | PASS | `clockStart/Pause/Expired` with injected `now`; expiry lets the in-flight question be judged, then the round ends and the unbanked chain is lost (total 2,500, chain 0). Adversarial: double-pause and second `clockExpired` are no-ops; the clock refuses to restart at 0 ms; pausing past the deadline clamps to 0; resuming re-bases the deadline from `now`; clock events outside a round are ignored; an expired **correct** answer that reaches the top still banks before the round closes. |
| **K-U4** turn order | PASS | Rotation wraps through `active` only; the eliminated never get a turn; round 2 starts with the previous round's strongest link and `remainingMs` 140000; the departed player keeps no `roundStats` entry. |
| **K-U5** statistics | PASS | Strongest = most correct → most banked → fewest wrong; weakest = fewest correct → least banked → most wrong; a total tie collapses to seat order both ways; the optional `pool` argument restricts the ranking. Full rankings asserted, not just the winner. |
| **K-U6** voting | PASS | Self-votes refused by `canVote`, by `reduce` and by the ballot itself; a vote may be changed until the first reveal and is locked after a **partial** reveal; the reveal is refused at n−1 votes; reveals come out in seat order and resolve on the last; a **three-way** tie yields `tied:["p4","p5","p6"]` in seat order with `tiebreakPid` set and `breakTie` refusing untied and unknown targets; `breakTie` outside `tiebreak` is a no-op. |
| **K-U7** final | PASS | ×3 bonus, first-player choice (strangers and missing `pid` refused), alternating turns, winner by correct count, sudden death. Adversarial: `finalQuestionsEach:1` decides after one question each and drops straight into sudden death when level; sudden death survives **five** level pairs, restarting each pair with the first player, and is decided only by a split; `finalAnswer` with a non-boolean is refused; after a winner, `correct/wrong/bank/endRound/eliminate/nextRound/revealAll/finalAnswer` are all dead. |
| **K-U8** question pool | PASS | Deterministic shuffle under an injected rng, permutation with no duplicates; wrap sets `repeating:true`, resets `qIndex` and serves question 0 again; the flag is sticky (see WL-4 for the notice). |
| **K-U9** undo / immutability | PASS | A 36-event script covering every phase: each single `undo` deep-equals the exact previous state, and unwinding the whole game returns to the start of round 1 and then to `setup`. Undo restores an eliminated player. History is capped at 60 and snapshots never carry `game`/`order`. Every one of 21 event shapes was fired at a deep-frozen sample state for **all ten phases** (`setup … result`) without a mutation. |
| **K-U10** phone boundary | PASS | `validatePhoneMsg` rejected 33 hostile frames (nulls, numbers, arrays, `Object.create(null)` handled correctly, oversize and 100 000-char targets, `toString` objects, wrong `t`, `type` instead of `t`) and strips extra keys. A `__proto__` target parses but is not a player and cannot pollute `Object.prototype`; hostile pids (`__proto__`, `constructor`, `toString`) do not crash any selector. `phoneView` never contains the question, the answer, the vote map or `revealed` — verified per-pid by JSON string search. |

### T2 — loopback harness (`http://127.0.0.1:8644/games/weakest-link/tests/harness.html`)

`#summary.ok` = **"All 46 checks passed."**, `window.__WL_HARNESS__ = {total:46, failed:0, uncaught:null}`,
every `#results li[data-pass="true"]`. Re-run after the WL-8 fix: still 46/46.

| ID | Result | Evidence (harness detail lines) |
|---|---|---|
| **K-I1** round / hotkeys / clock / reload | PASS (9) | Roster `Ada,Ben,Cleo,Dev,Eve`; `chain 2500` after two Spaces; `B` → `$2,500`; `X` → `Cleo wrong=1, turn=Dev`; `clock 0:02 -> paused with 1285ms of 2000ms, bank $2,500` after a mid-round reload; `1 state step(s) after expiry`; round ends with `total 2500`. |
| **K-I2** secret voting | PASS (14) | `Votes in: 1/5` with one `•••` and no name on stage; another phone sees `1/5 in, own vote null`; re-vote lands; host types the last votes; Reveal unlocks at 5/5; statistics `strongest Ada (1 right · 0 wrong · $0 banked) · weakest Eve`; one reveal per click; `Eve has 3 votes.`; goodbye card; eliminated phone → `goodbye` → `out` with 5 standings rows. |
| **K-I3** tie → strongest link | PASS (4) | `It is a tie between Ben and Cleo. Ada was the strongest link and decides.`; only Ada's phone gets `tiebreak` with ballot `Ben,Cleo`; her tap resolves it. |
| **K-I4** final to a winner | PASS (6) | `bank $12,500, bonus 5000`; both finalists' tallies; `2 each — sudden death.`; `Ada wins $12,500`; all five phones land on `result`; a 5-row `scores` frame reaches the shell. |
| **K-I5** editor | PASS (6) | 3 pasted lines → 3 rows; tab and quoted-comma lines parse; badge `3` with `warn`; Download refused with `This game needs at least 40 questions — it has 3.`; Reset restores 160; Use in game → `160 questions loaded.` |
| **K-I6** static gates | PASS (7) | 17 files served; V2/V3/V4/V6/V7/V8 all green in-browser. |

### T3 — real network through the hub (real PeerJS broker + WebRTC)

Not blocked: the broker was reachable and the room opened as code **6329**.
Because the shared browser pane was at its tab cap (other components' agents were
using it), the three phones ran as three 320×640 iframes of
`http://127.0.0.1:8644/?room=6329&name=…` inside the host tab. Each is a full,
independent hub phone controller with its own `Peer` and its own real WebRTC
DataConnection to the host — only the browser *profile* is shared.

| Check | Result | Evidence |
|---|---|---|
| Host a game night → room opens | PASS | `ROOM CODE 6329`, `0 phones connected`, no console errors. |
| Three phones join over WebRTC | PASS | `3 phones connected`; roster `Pam, Quinn, Rita`; each phone shows `YOU'RE IN, …` plus the shared roster. |
| Host picks Weakest Link → iframe swap | PASS | host frame `…/games/weakest-link/index.html?embed=host&room=6329`; phones `…?embed=player&room=6329&pid=pN&name=…`; shell bar reads `🔗 WEAKEST LINK · Round 1`. |
| Round runs; phones never see Q or A | PASS | Phones show `Pam's turn` / `Your question` only; `body.innerText` contains neither "Madagascar" nor "Indian Ocean" on any phone. |
| Host shows dots + n/m before the reveal | PASS | `Votes in: 1/3 · Team total $2,500`, masks `["•••","—","—"]`, all `<select>` values `""`, no name in `#wl-vote-list` until revealed. |
| Phones never see other votes (DOM read) | PASS | Pam's `WlPhone.view()` = `{…,"myVote":"p3","castCount":1,"voterCount":3}`; Quinn's and Rita's = `"myVote":null`; **no `votes` key on any phone**, no other pid→pid pair anywhere in the payload. |
| Vote change before the reveal | PASS | Pam re-taps: host `votes` goes `{p1:"p3"}` → `{p1:"p2"}`, counter stays `1/3`, `aria-pressed` moves to the new button. |
| Host override by dropdown | PASS | Host typed Quinn's vote; counter `3/3`, Reveal enabled, masks still `•••`. |
| Reveal one at a time → majority | PASS | `Quinn has 2 votes.` after the third click; names appear one row per click. |
| Eliminated phone gets the goodbye screen | PASS | Quinn's phone: headline `You are the weakest link`, sub `Goodbye.`, card class `phone-card goodbye-card`; host card reads `Quinn`. |
| `⌂ Lobby` and back restores state | PASS | Confirm dialog → lobby (`2 phones connected`, no game frame, phones back to the waiting screen) → Play → core is byte-identical (`phase goodbye, active [p1,p3], total 2500, eliminated [p2], votes {…}`), screen `screen-voting`, Next round offered; Quinn's phone comes back on `goodbye`. |
| Full game to a winner over the real network | PASS | `Pam wins $10,000`; both live phones on `result` with kicker `Tonight's winner`. |
| Phone **reload** mid-vote keeps the vote | PARTIAL / ENV-LIMITED | Host side PASS: after the phone reloaded, `votes` still held `{p3:"p1"}` and the counter was unchanged. Phone side could not be exercised: host and all three phones share one browser profile, so the host's `gsc-hub-state-v1` overwrites the phone-side join record and the reload landed on the join card (`That name is taken`). This is a single-profile artefact, not a broker/WebRTC block. Re-test needs three real devices or three browser profiles. |

### T4 — standalone, host-only, five players, to a winner

Played at `http://127.0.0.1:8644/games/weakest-link/` with Ada, Ben, Cleo, Dev, Eve.

| Check | Result | Evidence |
|---|---|---|
| Setup validation | PASS | `160 questions loaded.`; duplicate name → `ada is already on the team — pick another name.`; blank → `Give the player a name first.`; Start enabled at 3. |
| Round screen | PASS | `Round 1`, clock `2:30`, chain lit at `$1,000`, spotlight `ADA`, question shown, **answer hidden by default**. |
| Hotkeys with an input focused | PASS | Key events dispatched from the focused `#wl-player-name` left `chainIndex 0`, the turn unchanged and all five stat rows at zero. |
| Hotkeys with a button focused | PASS | Space from a focused `#btn-correct` was ignored (the button handles it itself) — no double count. |
| Hotkeys from the page | PASS | Two Spaces → chain `$2,500`, Bank enabled; `X` advances the turn; `B` banks. |
| Show answer | PASS | Hidden → click → visible (`1945`) → hidden again after 2 s; a peek followed by a judgement hides it immediately; "Keep answers on screen" toggles it on and off. |
| Bank twice | PASS | First → `$5,000` banked, button disabled; second click is a no-op (bank unchanged, no history entry). |
| Pause / resume | PASS | `2:30 → 2:28`, pause holds `2:28` / `147485 ms` across 1.5 s, a second pause is a no-op, resume counts down again. |
| Reload at every phase | PASS | round (`139271 ms` of `139273 ms`, paused, bank/turn/stats intact), voting (5 masked votes restored, statistics panel closed), tiebreak (tie text + both buttons), goodbye (Next round offered, card not stuck), finalIntro (`$20,000` splash), result (winner + total). |
| Undo repeatedly | PASS | Four Undos rewound four judgements exactly; replaying them reproduced the identical `roundStats`. Undo also crosses phases (`goodbye → voteResult`, restoring the eliminated player). |
| End round | PASS | Escape hatch from any point in a round; bank moves to total; voting screen opens at `Votes in: 0/5 · Team total $5,000`. |
| Voting, statistics, tie, goodbye | PASS | Masks + blank dropdowns; statistics `Ada 2 right · 0 wrong · $0 banked` / `Eve 0 right · 1 wrong · $0 banked`; 2-2-1 tie → `It is a tie between Ben and Eve. Ada was the strongest link and decides.`; goodbye card `Eve` clears after 2 s. |
| Final + winner | PASS | Splash, first-player choice, five each, `3 each — sudden death.`, two level pairs, split → `Ada` / `$20,000`, standings `Ada · Ben · Cleo — voted off · Dev — voted off · Eve — voted off`. |
| Play again | PASS | Returns to setup keeping the roster. |
| Editor: CSV/TSV import | PASS | Reset to shipped (160, badge not warned) then 3 pasted lines (one TSV, one quoted-CSV `"Cities, plural of city",Cities,…`, one plain CSV) → `Imported 3 questions, skipped 1 unusable line.`, badge `163`, fields parsed exactly. |
| Editor: Download JSON | PASS | Blob captured: 23 029 bytes, `questions.json`, `JSON.parse` + `WlCore.validateGame` → **true**, 163 questions, full `settings` block, the three imported rows last. Refusals: `This game needs at least 40 questions — it has 3. — fix that before downloading.` and nothing written. |
| Editor: Use in game | PASS | `163 questions loaded.`; blank draft refused with the same plain-English message and the editor stays open. |
| `?game=URL` | **FAIL (WL-7)** | With a clean profile: `Custom questions from ../../games/weakest-link/questions.json`, `sourceKind:"fetch"`, 160 questions. With **any** saved game present the parameter is silently ignored. |
| Bad JSON via the file input | PASS | `{ this is not json` → `That file is not a usable Weakest Link game: Expected property name or '}' …`; `{"hello":"world"}` → `… “questions” must be a list.`; 1 question → `… at least 40 questions — it has 1.`; an HTML file → `… Unexpected token '<' …`. A valid 45-question upload loads and warns. |
| Standalone player mode | PASS | `?room=…` renders `#gsc-join`, `body.player-mode`, all host chrome `display:none`. |

### T5 — static gates on `games/weakest-link`

| Gate | Result | Evidence |
|---|---|---|
| **V1** `node --test` exits 0 | PASS | 97 tests, 97 pass, 0 fail. |
| **V2** every file < 800 lines | PASS | Largest: `js/wl-core.js` 789, `js/wl-app.js` 740, `tests/wl-core.test.mjs` 716, `tests/harness.html` 563, `tests/wl-adversarial.test.mjs` 538, `tests/wl-adversarial-fuzz.test.mjs` 404. Functions over ~50 lines: none. |
| **V3** no `innerHTML`/`insertAdjacentHTML`/`outerHTML =`/`document.write`/`eval(`/`new Function` | PASS | Zero matches in code. The only textual hits are two prose comments ("never innerHTML", "no innerHTML anywhere") and the harness's own gate regex — no executable use. |
| **V4** no `console.log` | PASS | Zero (only `console.warn` diagnostics). |
| **V5** no Peer/connection/DOM/timer handle in state | PASS (code read) | Every `wlSet` patch is `core`/`game`/`setup`/`source*`/`keepAnswers`; `wlClock`, `wlAnswerTimer`, `room`, `lastSent` are module-level. `wlSerialise` round-trips through `JSON.stringify` and the clock is written back paused. |
| **V6** external URLs | PASS | Only `fonts.googleapis.com` / `fonts.gstatic.com` in `index.html`. PeerJS is loaded by `shared/`, not by this component. |
| **V7** `data-gsc-game`, `#gsc-join`, body classes | PASS | `<body data-gsc-game="weakest-link">`; `#gsc-join` inside `#screen-phone`; live check on an embedded phone: `body.className === "player-mode gsc-embedded"`, all host sections `display:none`, `#btn-exit` hidden. |
| **V8** `?game=` and upload share `validateGame` | PASS (code read + live) | `wlLoadContent` and `wlOnFile` both call `window.WlCore.validateGame` before adopting; both refusal paths observed above. |

### Security / privacy

| Check | Result |
|---|---|
| Votes validated before touching state | PASS — `wl-room.js` runs `validatePhoneMsg` (shape/type/24-char cap/control-char strip) then `WlCore.canVote` (phase, voter in `active`, target in `active`, no self-vote) then dispatches; `evVote` additionally refuses once `revealed.length > 0`. `tiebreak` frames additionally require `phase === "tiebreak" && tiebreakPid === pid`. Junk is dropped silently and never throws (33-case fuzz). |
| `phoneView` never contains other votes or the answer | PASS in the reducer and live over WebRTC — payloads carry `myVote`, `castCount`, `voterCount` only. |
| No phone string reaches the DOM except via `textContent` | PASS — every phone-facing node is built with `document.createElement` + `textContent` (`el()`, `setText()`); the only attributes written from data are `aria-pressed` and an `aria-label`. Zero `innerHTML` anywhere (V3). |
| Prototype pollution | PASS — a `__proto__` vote target is rejected as "not a player"; `Object.prototype` is untouched. |

### Design / accessibility

| Check | Result | Evidence |
|---|---|---|
| Readable at 1280×720 | PASS | Clock 112 px, question 41.6 px, player name 48 px, round bank 35.2 px, chain 18.4 px. `scrollWidth 1280`, `scrollHeight 720` — nothing clipped, no scrollbars. Screenshot inspected. |
| Phone targets ≥ 56 px at 320×640 | PASS | Vote buttons 256×60 px in a 318 px viewport; `scrollWidth === 318` (no horizontal overflow). |
| `prefers-reduced-motion` honoured | PASS | Blocks in `shared/theme.css`, `css/wl.css` (neutralises the `.clock.danger` pulse) and `css/wl-phone.css` (phone card). |
| Colour is never the only signal | MOSTLY PASS | Chain: won links carry a `✓`; votes: `•••` vs `—` plus a `title`; Correct/Wrong carry text + `<kbd>`; clock: the digits themselves. **Exception WL-10**: the head-to-head tally dots differ only by fill colour (green/red), though `N correct` is printed beside them. |
| Buttons are `<button>` | PASS | Zero `[onclick]`, `[role="button"]` or `a[href="#"]`; every control is a `<button type="button">` (the add-player form uses `submit`). Editor is `role="dialog"`; nine `aria-live` regions incl. bank/total/notice and an `assertive` goodbye card. |
| Sound toggle persists | PASS | `gsc-sound` flips `on`/`off`, `aria-pressed` tracks it. |

### Content check — 30 random questions

Sampled with a fixed seed (indices 4, 9, 17, 29, 31, 34, 35, 39, 43, 54, 58, 59, 62, 67, 69,
70, 82, 85, 88, 89, 103, 105, 113, 119, 123, 126, 129, 131, 156, 158) and then all 160 skimmed.

**All 30 sampled answers are factually correct; no corrections applied.** `questions.json`
and `js/data.js` still deep-equal (asserted by the shipped K-U1 test).

Two host-judgement notes, not errors:

- #128 "Constantinople, now Istanbul, was the capital of which empire? → The Byzantine Empire" —
  it was also the Ottoman capital; a host may need to accept either.
- #85 "The tango is the national dance of which South American country? → Argentina" —
  Uruguay shares the tango's heritage; Argentina is the standard answer.
- #129 spells the author "Gabriel Garcia Marquez" without accents (the file is deliberately
  ASCII-safe); cosmetic only.

---

## 3. Defects

### WL-1 — an extra round is played by the last two players · **major** · not fixed

`games/weakest-link/js/wl-core.js:560` (`endRoundFrom`) decides "vote or final" **before**
the vote, and `games/weakest-link/js/wl-core.js:659` (`evNextRound`) never checks whether the
vote has already reduced the field to `finalPlayers`. So after the vote that leaves two
players the host is offered **Next round** and a full round is played by the two finalists —
and it is *that* round's bank the multiplier triples, not the last full-team round's.
Spec §1: "Rounds continue until 2 players remain. The last full round's bank is tripled
(`finalMultiplier`…) before the head-to-head."

Repro (T4, five players): round 3 ended with `$5,000` banked; the vote left Ada and Ben;
the host screen showed `Round 4`, active `[Ada, Ben]`, clock `2:00`. That round banked
`$2,500`, and the splash read `$20,000` with `lastRoundBank 2500, finalBonus 5000`.
Reproduced again over the real network in T3 (three players → 2-player Round 2 → final).
Recorded as `DEVIATION A5 a 3-player game plays an extra TWO-player round before the final (WL-1)`.

Proposed fix (implementer): in `evEliminate` — or at the top of `evNextRound` — when
`state.active.length <= state.game.settings.finalPlayers`, return `enterFinal(state)` instead
of opening a round; relabel `#btn-next-round` to "To the head-to-head" in that case
(`games/weakest-link/js/wl-app.js:639`). The `toFinal()` fixtures in
`tests/wl-core.test.mjs:419` and both adversarial files then need one fewer round, and the
`DEVIATION A5` test should be inverted.

### WL-2 — a phone that is not in the game is served a live vote ballot · **major** · not fixed

`games/weakest-link/js/wl-core.js:299-305`: a pid that is in neither `active` nor `eliminated`
falls through to `livePhoneView`, so during `voting` it gets `screen:"vote"` with **every**
player on the ballot, an empty `name`, and taps the host silently drops.

Repro (T3, real network): a phone joined mid-game as `Sam` (pid `p4`). The host correctly
showed `Sam joined — they can play from the next game.` but Sam's phone rendered
`Who is the weakest link?` with buttons `Pam, Quinn, Rita` and
`view = {"screen":"vote","name":"","choices":[p1,p2,p3],"myVote":null,"castCount":3,"voterCount":3}`.
Tapping does nothing (`canVote` refuses), so it is confusing rather than corrupting.
Recorded as `DEVIATION A9 … (WL-2)`.

Proposed fix: first line of `phoneView`, before the `eliminated` branch —
`if (state.active.indexOf(pid) < 0 && state.eliminated.indexOf(pid) < 0) return Object.assign(base, { screen: "wait", spectator: true });`
plus a phone-side string ("You're watching — you can play from the next game") in
`SCREENS.wait` of `games/weakest-link/js/wl-phone.js:44`.

### WL-7 — `?game=URL` is ignored whenever a saved game exists · **major** · not fixed

`games/weakest-link/js/wl-app.js:706` (`wlBoot`):
`game: (saved && saved.game) || loaded.game` — the `localStorage` copy always wins, even when
the URL explicitly asked for other content. Any host who has played once (or opened the editor
once) and then follows a `?game=…` link silently gets their old question set.

Repro: play any game, then open
`http://127.0.0.1:8644/games/weakest-link/?game=../../games/weakest-link/questions.json` →
`source = "Questions from the editor"`, `sourceKind = "editor"`. Clear the saved state and
reload the same URL → `Custom questions from …`, `sourceKind = "fetch"`. Same for uploads
made in a previous session.

Proposed fix: prefer the fetched game when the URL supplied one —
`const fromUrl = loaded.kind === "fetch";` then `game: (!fromUrl && saved && saved.game) || loaded.game`
(and likewise for `source`/`sourceKind`/`sourceUrl`), and skip `patch.core = saved.core` when
`fromUrl` is true, since a resumed core carries the old questions inside it. Not fixed here:
it is >5 lines and the "drop the in-progress game" half is a product decision.

### WL-8 — the `?game=` failure message was wiped before the host could read it · **minor** · **FIXED**

`wlLoadContent`'s catch called `wlError(...)`, but the very next `wlSet(patch)` in `wlBoot`
runs `wlSave()`, which clears the error node on a successful save — so a bad `?game=` URL fell
back to the built-in set **silently**, against CLAUDE.md's "every failure path surfaces a
plain-English message".

Repro before the fix: `…/games/weakest-link/?game=nope-does-not-exist.json` → `#wl-error`
empty. After: `Could not load questions from nope-does-not-exist.json: the server answered 404.
Using the built-in set instead.`

Diff applied (3 lines, `games/weakest-link/js/wl-app.js`):

```diff
+let wlLoadMessage = "";   // survives the wlSet() in wlBoot, which clears wlError
+
 async function wlLoadContent() {
@@
-      wlError(`Could not load questions from ${url}: ${err.message}. Using the built-in set instead.`);
+      wlLoadMessage = `Could not load questions from ${url}: ${err.message}. Using the built-in set instead.`;
@@
   wlSet(patch);
+  if (wlLoadMessage) wlError(wlLoadMessage);
   wlStartClock();
```

Residual: the message is still cleared by the next `wlSet`. A proper fix separates the
"storage" and "content" error channels — left to the implementer.

### WL-3 — Bank is still accepted after the clock has expired · **minor** · not fixed

`games/weakest-link/js/wl-core.js:492` (`evBank`) checks only `phase === "round"`. Spec §1
allows banking "before hearing their question"; once the clock has hit 0 the question is in
flight and the round is about to end, so the host can rescue a chain that should be lost.
Repro: `correct, correct, clockExpired, bank` → `roundBank 2500`, phase still `round`
(`DEVIATION A2 … (WL-3)`). Fix: add `if (state.expired) return state;` to `evBank`
(1 line) — left to the implementer because it also needs the Bank button disabled while
`expired` in `wlRenderRound`.

### WL-4 — "questions are repeating" only lives in the transient notice · **minor** · not fixed

Spec §2: the wrap should be flagged "in the host UI". `state.repeating` is set and sticky, but
the host renders only `core.notice` (`games/weakest-link/js/wl-app.js:281`), and the very next
`bank` (`evBank` sets `notice: ""`) or `nextRound` wipes it. Repro:
`DEVIATION A7 … (WL-4)`. Fix: render a small persistent badge from `core.repeating`.

### WL-9 — a phone that (re)joins mid-game may sit on "Waiting for the host…" · **minor** · not fixed

`games/weakest-link/js/wl-room.js:66` caches the last view per pid in `lastSent` and only
clears it in `onPlayerLeave`. `onPlayerStatus` is a no-op, so after a reconnect — or when the
first push races the phone's iframe becoming ready — the identical view is suppressed and the
phone shows nothing until the next state change.

Repro (T3): Sam's phone held `view = {screen:"wait"}` (wl-phone's built-in default; the host
never re-sent) until the host entered the next vote, at which point it repainted. Fix: clear
`lastSent[pid]` in `onPlayerJoin` and in an `onPlayerStatus(pid, true)` handler.

### WL-6 — a truncated saved state crashes the reducer instead of being ignored · **minor** · not fixed

`evClockPause` (`js/wl-core.js:478`) reads `state.clock.running` and `evUndo`
(`js/wl-core.js:762`) reads `state.past.length` with no guard, while `wlLoadSaved`
(`js/wl-app.js:104`) only checks `core.phase` and `core.game` before restoring. A hand-edited
or partially written `gsc-wl-state-v1` therefore throws instead of being rejected.
Recorded as `DEVIATION A10 … (WL-6)`. Fix: tighten the `wlLoadSaved` shape check, or guard
both handlers.

### WL-10 — the head-to-head tally dots are colour-only · **minor** · not fixed

`games/weakest-link/css/wl.css:433-434`: `.tally-dot.hit` and `.tally-dot.miss` differ only by
fill (green/red), same size and shape — unreadable for red-green colour blindness. The
`N correct` line beside the dots carries the total, so the impact is limited to the per-question
pattern. Fix: give `.miss` a different shape or a `✕` glyph, or add per-dot `title`/`aria-label`.

---

## 4. Judgement on the implementer's stated deviations (report §7)

| # | Deviation | Verdict |
|---|---|---|
| 1 | Pure core split into `wl-core.js` + `wl-content.js` | **Accept.** A single file would breach the 800-line hard rule; `WlCore` re-exports every symbol, so §4's "callers only touch WlCore" holds. Verified: the Node tests only `require` `wl-core.js`. |
| 2 | rAF clock plus a 250 ms interval safety net | **Accept.** Necessary — rAF stops in a background tab. The `firedFor` latch keeps `onExpire` to exactly once (harness: `1 state step(s) after expiry`), and no timer handle goes near state (V5). |
| 3 | Host override dropdown never shows the vote before the reveal | **Accept, and it is better than the spec.** The host can still enter/override any vote (verified in T4/T3); the dots plus `Votes in: n/m` carry the "a vote arrived" signal, and the option label changes to "change vote". |
| 4 | The final always plays all `finalQuestionsEach` questions | **Accept.** Spec §1 says "five questions each" and asks for no early exit. |
| 5 | `createState` floor 2, UI floor 3 | **Accept.** Verified: `#btn-start` stays disabled below 3 and `wlStart` throws "Weakest Link needs at least 3 players."; the core floor is documented in a comment. |
| 6 | `strongestLink`/`weakestLink` take an optional `pool` | **Accept.** Additive; the two-argument form still ranks everyone (asserted in A3). |
| 7 | The voting screen also shows the team total | **Accept.** Small addition; the counter still reads `n/m` while voting is open. |
| 8 | Extra fixture `tests/fixtures/harness-game.json` | **Accept.** Only way to exercise a real clock expiry in a browser test. |
| 9 | `js/wl-sdk-fallback.js` deleted | **Accept.** Confirmed absent; `index.html` loads the five real `shared/` scripts. |

The implementer's "known gaps" hold up: T3 is now done (this report), the reduced-motion
blocks are present and correct, and sound was again verified by reading, not listening.
Their §9 note about `localStorage` is right and worth keeping — see WL-7, which is the sharp
edge of the same behaviour.

---

## 5. Verdict

**Fix-then-ship.** The pure core is genuinely solid: 97 unit tests pass, including 52
adversarial ones I wrote to break it, and it survived deep-frozen inputs across all ten
phases, 33 hostile phone frames, 30 malformed content files and a full undo/redo of a whole
game. The loopback harness is honest (46/46, every K-I id really asserted), a five-player
host-only game and a three-phone game over the **real** PeerJS broker both ran to a winner,
the secret ballot holds up under direct DOM inspection of every phone, and the static gates
V1–V8 are clean. Three majors stand between this and release: **WL-1**, a genuine rules
deviation — an extra round is played by the two finalists and its bank, not the last full
round's, is the one that gets tripled; **WL-2**, a spectator phone being handed a live vote
ballot; and **WL-7**, `?game=URL` silently losing to any saved game, which breaks a
documented feature for every host who has played before. None of them corrupts state or
blocks play, so nothing here is critical, but WL-1 changes the money on screen and WL-7
defeats the sharing story, so both should land before release. WL-8 is fixed in place
(3 lines); the five remaining minors are cheap and can be triaged into the README's known
issues if they miss the cut.
