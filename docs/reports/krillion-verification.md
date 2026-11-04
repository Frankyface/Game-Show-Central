# Krillion — verification report (independent tester)

Component `krillion` · code under test `games/krillion/**` on `main` · spec `docs/20-krillion-spec.md`,
cross-cutting `docs/19`, `docs/21` + `docs/design-system.md` §0, triage rules `docs/reports/00-orchestrator-triage.md`.

## 1. Environment

- Windows 11 Home 10.0.22635, Node v24.16.0, Google Chrome (headless, `--headless=new`) driven over CDP
  by `.scratch/kr-cdp.mjs`; static server `.scratch/kr-serve.mjs` on `127.0.0.1:8741`.
- Real PeerJS broker reachable (hub room `UKBD`); host + three phone browsers, each its own profile.
- Dates: 2026-11-03 / 04.
- Helper scripts (all `.scratch/kr-*`): `kr-harness.mjs` (T2 harness runner), `kr-t4.mjs` (7-prompt Deep
  Dive), `kr-t4b.mjs` (Puffer Party, game lobby, library, editor, `?game=`, bad JSON), `kr-probe3.mjs`
  (remember + reload + Import), `kr-hub.mjs` (T3), `kr-design.mjs` (design/a11y/v3), `kr-review-fit.mjs`
  (judge's review fit), `kr-fnlen.mjs` (function lengths).

## 2. Results

| ID | Result | Evidence |
|---|---|---|
| T1 `node --test` (games/krillion) | PASS | 44/44 (26 implementer + 18 new adversarial in `tests/kr-adversarial.test.mjs`). Repo root `node --test`: 1422/1422. |
| T1 implementer tests are genuine | PASS | Read `kr-core.test.mjs`: real assertions on scores, phases, tiers, phone views, data.js mirror (deepEqual), not smoke tests. |
| KR-U1 validator | PASS | Adversarial fuzz: 39 prompts, 4 answers, unknown tier id (`shrimp`, `__proto__`, `toString`, `constructor`), 41-char answer (40 accepted), < 3 tiers, alias collision across answers (incl. case/article-insensitive `the APPLE`, `Durian` vs `The Durian`), aliases not a list, 9 aliases, 121-char prompt, bad tier lists (1 tier, equal points, duplicate id), bad numbers/mode/hearts/floor, junk roots — all throw with a plain-English message. |
| KR-U2 normalisation + aliases | PASS | case, padding, `an`/`the`, `!!`/`.`/`?`, accents (`ÀPPLE`), control chars, multi-word alias, simple plurals (`kiwis`, `lychees`); substrings (`pineapple`, `app`) do **not** match. |
| KR-U3 off-list → pending | PASS | identical off-list texts group once with count 2; `revealNext` refused while pending; review of unknown tier / on-list group / unknown group / missing tier refused. |
| KR-U4 review → tier or 0/⬛ | PASS | `null` → 0 points; `deepcut` → 85 → 850 m; review locked once the reveal walk has started. |
| KR-U5 remember | PASS (core) / **FAIL → fixed** (app) | Core: unruled and not-valid can't be remembered, double remember is a no-op, the answer then matches (`dragonfruit` loose form), `applyLearned` output re-validates and matches. App: remembered answers were dropped from the session content on reload — **K-1**, fixed. |
| KR-U6 depth totals + ties | PASS | per-tier 10/30/60/85/100, 1 point = 10 m, Apple/Banana share a rank; alias + entry answers make joint winners. |
| KR-U7 reveal order | PASS | misses first, then Prawn → Schooler → Rare → Deep Cut → One in a Krillion. |
| KR-U8 Puffer | PASS | used-list refusal incl. an alias (`Chinese gooseberry` after `Kiwi`), a plural, and a judged off-list answer typed with an article; clock 6→5→4→3→3… (floor holds); pop costs a heart; meter → heart and capped at `maxHearts`; elimination skips out players; last one floating wins; `pufferJudge` `{tier}` and `{valid, niche}` both work, `valid:false`/`tier:null` keep the puffer with the same deadline, junk shapes ignored, nothing-pending ignored. |
| KR-U9 phone input | PASS | answer after close rejected (reducer + `phoneMaySend`); unknown pid ignored; non-holder `pufferAnswer` rejected; `validatePhoneMsg` fuzz (17 junk frames incl. `review`, `hostAnswer`, `__proto__`, 4001 chars; 300 random frames never throw, always ≤ 40 chars). |
| KR-U10 leak | PASS | `phoneView` JSON never contains another player's answer during prompt, review or before their own group is revealed, nor any rated-list entry; Puffer watchers never see a pending off-list answer or the list. |
| Immutability / undo / prototype guard | PASS | deep-frozen states through every Deep Dive and Puffer event; undo from reveal restores the exact 18 000 ms remaining, undo walks back to the prompt with scores 0, undo removes a learned entry; `__proto__`/`constructor`/`toString` event types inert; answers named `toString`/`constructor`/`__proto__` group, rule and score correctly. |
| T2 `tests/harness.html` (KR-I1…KR-I6 + gates) | PASS | `All 57 checks passed.` (run three times, incl. after my fixes). |
| T4 standalone 7-prompt Deep Dive, 4 host-typed players, 1280×720 | PASS | `kr-t4.mjs`: all 7 prompts; off-list `Blorptastic Zebra` went through the judge's review (rated Rare) + Add to this question; result podium Di 6,600 m · Cy 4,200 · Bo 2,100 · Ann 700; no console errors; 31/31 play screens `scrollHeight == innerHeight`. |
| Reload mid-prompt | PASS | answers kept; clock frozen across the reload itself and running again after load (remaining 29.67 s → 27.99 s, of which ~1.5 s was my post-load wait) — design is "frozen on save". |
| Reload mid-review | PASS | phase `reveal`, 1 pending, queue item still listed. |
| Undo (UI) | PASS | Undo on reveal → prompt with 3 answers and 29 s. |
| Puffer Party via UI, 1280×676 and 720 | PASS | `kr-t4b.mjs`: used-answer notice, off-list ruling panel (5 tiers + Not valid), shrinking clock 12→11→10, used list with Add to this question, pops to last one floating (Cy, 1 heart); no scroll. |
| X-1 game lobby | PASS | disabled on setup; Keep → setup with Resume, Resume restores identical state (history length equal, answers equal, clock frozen while away); Start over → roster and content kept, no Resume; works from result; modal is `role="dialog"` `aria-modal`. Also works embedded (T3). |
| X-2 library picker | PASS | lists Kids' night / Pop culture; each loads (40 prompts), source note "set: …". |
| X-3 editor | PASS | rated-answer table; Download JSON produces a file that passes `validateGame`; Download for the library gives the file name + manifest entry; Use in game → "Custom prompts (from the editor)"; Import judged answers works ("Those judged answers are already on their prompts." once they were added in game). |
| `?game=URL` vs a save | PASS | `?game=sets/pop-culture.json` wins over a saved editor file. |
| `?game=` bad URL | PASS (minor wording) | message shown, but see **K-4**. |
| Bad JSON / unplayable file | PASS | "That file can’t be used: Expected property name…" and "…0 prompts isn’t enough — a playable file needs at least 40." |
| T3 hub, 3 phones, real broker | PASS | `kr-hub.mjs`: roster p1–p3 reaches setup; embedded toolbar Sound · Editor · Game lobby, no splash; all phones show prompt + field + clock; alias `Draughts` → Checkers (Schooler), off-list `Quixotic Offlistanswer` waits in the queue with the player's exact text, Reveal disabled ("Rule every answer first"); host DOM incl. input/select values contains neither answer while open; Eli's phone shows neither; phones show "The judge is reviewing answers…", then their own tier/points/depth (300/600/100 m); Fay's phone reload mid-prompt keeps "Your answer: Monopoly"; `⌂ Lobby` and back: state identical; night scoreboard "Eli 600 Dee 300 Fay 100"; Puffer: only the holder has a field, the answer passes the puffer and every phone shows the used list. No console errors on host or phones. |
| Design 1280×720 readability | PASS | no text < 15 px on any host screen; one Anton hero per screen. |
| No scroll in play (1280×720 / 676) | **FAIL** | judge's review scrolls with ≥ 3 off-list groups — **K-2**. Setup (790 px) and editor scroll, which is allowed. |
| Phone 320×640 | PASS | field and Send 56 px tall, 288 px wide; no horizontal scroll; 640/640. |
| Reduced motion | PASS | CSSOM walk: every `animation`/`transition`/`@keyframes` in Krillion sheets sits inside `prefers-reduced-motion: no-preference`; with `reduce` emulated `document.getAnimations()` = 0 and the splash is skipped. |
| Contrast ≥ 4.5 | PASS | computed fg/bg walk on every host screen and the phone: no pair under 4.5:1. |
| UI-10 no emoji in host DOM | PASS | none on any screen (registry badge 🐡 is the hub's). |
| UI-11 no backdrop-filter / text-shadow / gradient under text | PASS | none (computed-style walk). |
| UI-12 toolbar order | PASS (order) / minor | Sound · Editor · Game lobby, lobby disabled on setup; but no icons — **K-3**. |
| V1 | PASS | 44/44. |
| V2 | PASS | largest file `kr-app.js` 607 lines; no named function > 50 lines (`kr-fnlen.mjs`). |
| V3 | PASS after trivial fix | the only hit was a comment in `kr-view.js:5` ("never innerHTML"); reworded. Now zero matches incl. tests. |
| V4 | PASS | no `console.log`. |
| V5 | PASS | `krSerialise` writes only data fields; clock is a deadline/remaining number; no handles. |
| V6 | PASS | only Google Fonts URLs (PeerJS comes via shared code). |
| V7 | PASS | `<body data-gsc-game="krillion">`, `#gsc-join`, `player-mode` / `gsc-embedded` classes wired (`kr-phone.js:135-136`, `kr-room.js:173`). |
| V8 | PASS | `?game=`, file upload, library and saved game all go through `krUseGame` → `validateGame`. |
| Security read | PASS | phone frames: `validatePhoneMsg` then `phoneMaySend` then the reducer's own checks; phones build fresh events (cannot inject `now`, `hostAnswer`, `review`); textContent only; `?store=` sanitised to `[A-Za-z0-9-]{0,24}`; room-scoped saves re-key phone seats. Non-issue: `validatePhoneMsg` accepts an object with inherited `t`/`text`, unreachable over JSON. |
| Triage rules | PASS | prototype-guarded handler map (`has(HANDLERS, …)`); no local `[data-gsc-game]` palette override; harness namespaced `?store=harness`; `?game=URL` wins over a save; saves room-scoped; splash skipped when embedded; motion inside no-preference; payload queueing is shell-side and held in T3. |
| Content | PASS after corrections | 25 prompts sampled (#0,4,…,96) + 10 from the two sets; ratings broadly right, aliases sensible. Six corrections, below. |

## 3. Defects

| # | Severity | Where | Repro | Status |
|---|---|---|---|---|
| K-1 | **major** | `games/krillion/js/kr-app.js:259` (`krLoadContent`) | Shipped prompts, rule an off-list answer, Add to this question, reload. `krApp.game` was re-fetched from `prompts.json` because the source is still `"default"`, so the remembered answer vanished from the session content: the editor's Download / Use and the next game no longer had it (the running game still matched it via `core.learned`). | **Fixed** (1 line): `if (krApp.game && (krApp.sourceKind !== "default" \|\| krApp.learnedLog.length)) return;` — once the judge has remembered something, the saved content is kept. Re-verified in the browser (`kr-probe3.mjs`: game still has the answer after reload); harness 57/57. |
| K-2 | **major** | `games/krillion/css/kr.css` (reveal screen / `#kr-queue-box`), `kr-view.js renderQueue` | 1280×720, any prompt with 3+ distinct off-list answers: page height 912 (3), 1028 (4), 1260 (6) vs 720; at 676: 750 already with 3 items. Each queue item is ~116 px (answer line, who line, a row of six tier buttons). With 6–8 players 3+ off-list answers is the normal case, so the host has to scroll the shared screen to judge. Breaks the docs/21 "no scroll in play" gate. | Open — proposed: put the answer, the player line and the tier buttons on one row (compact two-column item), and/or hide the reef/groups strip while the queue is open and give `#kr-queue` a bounded internal scroll with the count shown ("3 to rule"). Add a harness check with 5 off-list answers at 1280×676. |
| K-3 | minor | `games/krillion/index.html:22-24`, `kr-view.js:454-456` | Toolbar buttons are text only and 36 px tall; docs/21 rule 9 asks for icon + label from `shared/icons.js` (now present; other games use `GSCIcons.prepend`). `btn-sound` text is rewritten with `textContent` each render, which would wipe an icon. | Open — load `shared/icons.js`, prepend `sound`/`edit`/`lobby` icons and set the sound label on a child `<span>` instead of the button. |
| K-4 | minor | `kr-app.js:252-255` | With a saved editor/url/set game, `?game=nope.json` shows "Couldn’t load nope.json: 404 Not Found. Falling back to the shipped prompts." but keeps the saved game (the source note says so). The message is wrong. | Open — say "Keeping the prompts you already had." when a non-default game is kept. |
| K-5 | minor | `kr-view.js renderQueue` / `kr-select.js reviewQueue` | After Add to this question the item leaves the review queue at once (the answer now matches the list), so the button's "On this question now" state is never seen. Correct behaviour, but the judge loses sight of the ruling. | Open, cosmetic — keep remembered items in the queue as ruled until the reveal starts. |
| K-6 | minor | `kr-select.js diveView` | A phone that typed an alias sees the canonical entry ("You said: Checkers" after typing "Draughts"). Defensible; spec says "your tier and points". | Note only. |

Trivial diffs I applied:

```
games/krillion/js/kr-app.js:259
-  if (krApp.game && krApp.sourceKind !== "default") return;
+  if (krApp.game && (krApp.sourceKind !== "default" || krApp.learnedLog.length)) return;   // keep remembered answers across a reload
games/krillion/js/kr-view.js:5   comment "never innerHTML" -> "never as markup" (V3 grep)
```

Content corrections (`prompts.json` and `js/data.js` changed together; the JSON is still embedded byte-for-byte in data.js and the KR-U1 mirror test passes):

| Prompt | Answer | Was | Now | Why |
|---|---|---|---|---|
| Name a chemical element | Titanium | Deep Cut | Rare | everyday word (bikes, implants) |
| Name a type of weather | Mist | Deep Cut | Rare | as common as fog/drizzle |
| Name a stage musical | Hadestown | One in a Krillion | Deep Cut | 2019 Tony winner, current hit |
| Name a colour | Fuchsia | One in a Krillion | Deep Cut | ordinary paint/fashion colour, next to Magenta/Teal |
| Name a job or profession | Astronaut | Deep Cut | Rare | a stock child's answer |
| `sets/kids-night.json` — Name an animal at the zoo | Capybara | One in a Krillion | Rare | very popular with children right now |

## 4. Implementer's choices

- **`pufferJudge` two shapes** — accept. The UI sends `{tier}`; `{valid, niche}` maps to shallowest/deepest tier; both tested; junk shapes are ignored.
- **The last answer can't be changed** (auto-close when everyone has answered) — accept; it is what the spec says ("until the clock ends or everyone has submitted"). Pinned in the adversarial suite.
- **Partial undo of Add to this question** (undo removes it from the game, not from the session file) — acceptable, documented in the README. With K-1 fixed the session copy now also survives reloads, so the README note is accurate.
- **`meterForHeart` default 100** — recommend changing the default to **10**. With meter values 0–4 per answer, 100 needs 25+ valid answers per player, so a heart essentially never comes back in a 3-heart game; 10 gives a heart after about 4 good answers (or 3 deep ones), which makes the meter a real part of the game. This is a spec change (docs/20 §2.2 and the §3 example say 100), so the orchestrator should decide and then change `DEFAULT_SETTINGS`, the docs and the README together.

## 5. Verdict

**Fix-then-ship.** The core is solid: the reducer survived every adversarial probe (normalisation, alias collisions, review, remember, Puffer edge cases, leak, frozen states, undo, prototype names), the harness is 57/57, a full 7-prompt game and a Puffer Party play cleanly standalone, and the real-network hub run with three phones did everything the spec asks without one console error. The one major I could fix (K-1, remembered answers lost on reload) is fixed. **K-2** (the judge's review scrolls the shared screen once three or more off-list answers come in, which will be most prompts with a real room) is a CSS/layout job for the implementer and should land before release; K-3–K-6 are minors for the README or a follow-up.
