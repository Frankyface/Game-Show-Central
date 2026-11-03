# 1 vs 100: implementation report

Component `one-vs-100` · spec `docs/16-one-vs-100-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` · date 2026-11-03 · Windows 11, Node 24,
headless Chrome over CDP (a private profile, not the shared browser pane).

## What was built

All files are under `games/one-vs-100/`. No file outside it was changed.

| Area | Files |
|---|---|
| Pure core (UMD → `OvhCore`) | `js/ovh-content.js` (validator, normaliser, draw, ladder, simulated-wrong spread), `js/ovh-phoneview.js` (`validatePhoneMsg`, `phoneView`), `js/ovh-core.js` (reducer + selectors) |
| Content | `questions.json` (60 original three-option questions, 6 per level 1–10, correct answers spread 18/24/18 over A/B/C), `js/data.js` (exact mirror) |
| Library | `sets/index.json`, `sets/kids-night.json` (30), `sets/movies-and-tv.json` (30) |
| Host UI | `index.html`, `js/ovh-view.js`, `js/ovh-app.js`, `js/ovh-sound.js`, `css/ovh.css` |
| Editor | `js/ovh-editor.js`: Download JSON, **Download for the library** (slug file + manifest line + commit path), Use in game, Reset, Start blank, auto-saved draft |
| Phones | `js/ovh-room.js` (GSC.host), `js/ovh-phone.js` (GSC.player), `css/ovh-phone.css` |
| Tests | `tests/ovh-core.test.mjs`, `tests/harness.html`, `tests/fixtures/harness-game.json` |
| Docs | `README.md`, this report |

Events implemented exactly as spec §4: `start`, `seat{pid}`,
`openQuestion{now}`, `mobAnswer{pid,idx}`, `closeMob`, `simulateMob{size,wrong}`,
`contestantLock{idx}`, `usePoll`, `useAsk{pid?}`, `useTrust`, `reveal`, `walk`,
`continue`, `undo`, `finish`. Selectors include `bank`, `perMember(q)`, `mobAlive`,
`split`, `phoneView`, `validatePhoneMsg`, plus `mobTiles`, `mobSplit`,
`majorityIndex`/`majorityIsTied`, `standings` and `legalActions`.

### Rule decisions (where the spec left room)

- **Wrong contestant answer:** wrong Mob members on that question are still
  eliminated. The survivors split the bank as it stood, `floor(bank / survivors)`
  each. If nobody survives, the bank is lost and the notice says so.
- **Wipe-out:** `round(bank × bonusMultiplier)`, default ×2.
- **Simulated Mob:** wrong answers are spread alternately over the two wrong
  options, so Poll/Ask/Trust work the same as with phones. A wrong count larger
  than the surviving Mob is refused with a message. The host may close a
  simulated Mob without ever opening the clock.
- **Answer window:** stored as `remainingMs`, and as an absolute `deadline` only
  while running. History snapshots, undo and every save freeze it, per the triage
  rule. A reload brings it back *paused* with its time ("Paused with Ns left");
  **Resume the Mob window** re-arms it. Reaching zero closes the Mob
  automatically. The host can close early at any time.
- **One answer per Mob phone:** the first tap counts. Answers after the
  deadline, from eliminated members or from the contestant are dropped.
- **Contestant choice** is a host-local `pick` (not in the core) until
  **Lock it in** dispatches `contestantLock`. The contestant's phone locks directly.
- **Late joiners** during a game watch (`wait`) and play from the next game.
- **End the night** mid-question banks a walk (Millionaire precedent).

### Cross-cutting rules applied

`hasOwnProperty` handler lookup (prototype-shaped types tested). Phone intent
lookup is guarded the same way. `?store=NAME` namespacing on the state and
draft keys, with the harness on `?store=harness`. The harness loads
`about:blank` before clearing storage. Clocks are stored as remaining time and
frozen on save. `?game=URL` beats a save unless the save came from that URL.
The game is bound to its room code, so a fresh room's `p1` never inherits a
seat. There is no `body[data-gsc-game]` palette override: stage colours and
the game's cyan live on `:root`. Every animation sits inside
`prefers-reduced-motion: no-preference`. The splash is skipped when embedded
and under reduced motion. The phone page hides every host screen.

## Verification (all run by me)

| Tier | Result | Evidence |
|---|---|---|
| T1 `cd games/one-vs-100 && node --test` | **43/43 pass** | O-U1 validator (5 tests) · O-U2 ladder and bank (3) · O-U3 non-answer, late answer, one answer each (3) · O-U4 lose and split (3) · O-U5 walk/finish (2) · O-U6 bonus (2) · O-U7 helps, tie flag (6) · O-U8 simulated Mob (7) · O-U9 undo/illegal/immutable/prototype (7) · O-U10 leak tests (5) |
| T1 repo root `node --test` | **1259/1259 pass** | unchanged by this component |
| T2 `tests/harness.html` on port 8712 | **66/66 pass** | 6 phones (1 contestant + 5 Mob), O-I1…O-I6 plus X-1 (lobby Keep/Resume exact state, Start over), X-2 (picker lists both sets, loads one, source note), X-3 (manifest line accepted by `GSCLibrary.parseManifest`), static gates, and a simulated-Mob game in the frame |
| T3 real network | **PASS** | standalone room `G4VP` over the PeerJS broker. One Mob phone (Mia) and one contestant phone (Cass), each in an isolated browser context. Mob view carried no `answer`. *Answered 1/1*. The contestant locked from the phone. Result "The Mob is wiped out / $200". Phones read "You take $200" and "Nothing this time". No console errors. |
| T4 simulated-Mob full game | **PASS** at 1280×720 and 1280×676 | 100-tile Mob, 37 wrong → $3,700, 63 left. Poll + Ask, then a wrong answer on Q2: lose, 63 survivors at $58 each. Standings. **Play/result/standings screens: no vertical or horizontal scroll at either size.** |
| Phones at 320×640 | **PASS** | `mob-answer`, `contestant`, `mob-eliminated`, `result`: smallest target 56 px, no horizontal scroll (long two-line options included) |
| Static gates | **PASS** | V3 repo grep for innerHTML/insertAdjacentHTML/outerHTML=/document.write/eval(/new Function on `games/one-vs-100` returns zero matches, harness included. No `console.log`. The only external URLs are Google Fonts. Every file is under 800 lines (largest `ovh-core.js` 732, `ovh-app.js` 716). |
| Contrast (both gradient stops under text) | **PASS** | cyan button `#4fdcff`/`#1899c9` vs ink `#04121a`: 11.9:1 / 5.9:1. Mob tile `#12667f`/`#0a3d4d` vs `#d6f6ff`: 5.7:1 / 9.7:1. Gold text and ink on the black stage are well above 7:1. |

### Defects I found and fixed during testing

- **Phone pages showed the host setup screen** under the phone card, causing a
  6 px horizontal scroll at 320 px. Fixed: `body.player-mode` hides every
  non-phone screen and the lobby dialog. A harness check now pins it.
- **Editor answer radios** were not grouped per question. Fixed: one group per card.
- **Play screen was 1 px over** at 720/676. Fixed by tightening the height calc.
- **`ovh-core.js` exceeded 800 lines.** Phone views moved to `js/ovh-phoneview.js`
  (core re-exports them; same accepted split pattern as Feud/Wheel/WL).

## Things the orchestrator must know

1. **`shared/theme.css` needs a `[data-gsc-game="one-vs-100"]` accent block**
   (I don't own that file). Suggested values: `--accent: #19c9ff; --accent-2: #ffcc4d;
   --accent-ink: #04121a; --stage-glow: #0a3d4d;` (white on that cyan fails
   contrast, so the ink must be dark). Until it lands, `.gsc-*` accent components
   (the splash card, `gsc-btn-primary` in the library picker) wear the hub gold.
   The game's own cyan lives in `--mob`, so the game looks right either way.
   The hub's card art in `css/hub-art.css` is also still to add.
2. **`tests/core-prototype-guard.test.mjs`** (root, not mine) doesn't list this
   core yet. Suggested entry: files `ovh-content.js`, `ovh-phoneview.js`, `ovh-core.js`;
   global `OvhCore`; `make: (C) => C.createState(C.normalizeGame(require("../games/one-vs-100/questions.json")), [{pid:"p1",name:"A"}], {})`.
   The guard is already covered by O-U9 locally.
3. `shared/library.js` landed while I worked. The picker is mounted with
   `gameDir: "."` and verified live (X-2). If it fails to load, setup says so in plain English.
4. The shared in-app browser pane was being driven by other agents at the same
   time (my tabs were repeatedly navigated to their ports). So every browser
   tier above ran in a private headless Chrome over CDP with its own profile. I
   left the shared pane tabs alone, because other agents had taken them over.
   My server on 8712 is stopped.
5. Known minor: the **setup** screen scrolls about 20 px inside the 1280×676 hub
   frame (play screens do not).

---

## Round 2 (2026-11-03): tester defects and the v3 UI pass

The tester's in-place fixes D1, D2, D3 and D5 are kept. Their D1 tile tuning
was retuned in this pass (below). One edit to their suite: in
`tests/ovh-adversarial.test.mjs` the allowed Mob-view key `deadline` became
`msLeft`, because D12 renamed that field.

### Defects

| ID | Fix |
|---|---|
| D4 (major) | `ovh-room.js` `seatWaitingPhones()`: whenever no game is in progress, every connected non-manual phone missing from `setup.players` is added. A name already on the list is skipped. It runs on join, on a phone coming back up, and from the subscribe callback when the core becomes null (Play again, Start over). New harness check: Neo joins mid-game, is told "next game", and is on the roster after Play again. |
| D6 | The harness snapshots `gsc-ovh-state-v1` before the run and requires it unchanged, instead of requiring it absent. |
| D7 | O-I2 waits up to 8 s for p2's own view to show its locked answer before asserting. |
| D8 | Setup restructured: Start/Resume moved into the setup header, the player list is two columns, the timer and bonus fields share a row, the helps sit inline, and the duplicate hint is gone. Setup now fits 1280×628 (the hub frame) with 6 players. A full 12-player room still scrolls, but Start stays on screen. Was 82 px of scroll. |
| D9 | Every host text ≥ 14 px (the gate below found none smaller). Body ≥ 16 px, controls ≥ 15 px. Seat numbers are 17 px (14 px on big grids). |
| D10 | The win line is built from `bonusMultiplier`: ×1 "takes the bank", ×2 "the bank is doubled", otherwise "multiplied by N". |
| D11 | `ovhSlug` turns a title of "index" into `index-set.json`. Reset and Start blank hide the library recipe. |
| D12 | Phones get `msLeft` (time left at send, from `phoneView(state, pid, now)`). The phone turns it into a deadline on its own clock when the view arrives. |
| D13 | After a loss, every surviving Mob member is reported to the hub scoreboard even when the share is $0. |

### v3 UI pass (docs/21, design-system §0)

Two sheets were rewritten: `css/ovh.css` and `css/ovh-phone.css`. Markup changes: the setup header, the field row, plain toolbar labels, no splash kicker, and `shared/icons.js` loaded. JS was touched only for class names (`is-big` cut-off, which button is the primary on setup), `GSCIcons.prepend` (Sound/Editor/Game lobby, again after each Sound toggle), removing the help emoji and the tile "✕" text, and the splash (600 ms, empty sub).

- **Stage, surfaces and colour:** the stage is the shared flat one (cyan mixed in at 5 %). There is one surface level with a hairline. No gradients anywhere: buttons, tiles, options and phone card are all flat. The question plate is flat with one hairline and no hex cut. No glow or hover lift. The accent is used for the active state and primary buttons. Gold is only on money (bank, per-member value, winnings, ladder values).
- **Type:** Anton is used for one hero per screen only: the game name on setup, the bank in play, the amount on the result. The editor has none. Everything else is Inter in sentence case. The decorative setup eyebrow was replaced by one plain sentence of what to do next.
- **The Mob:** flat tiles with a count label above ("63 of 100 still in"). A tile that is still in has the accent tinted into the surface. An eliminated tile is the stage colour, with its number struck through so the state does not rest on colour. An answered tile gets an accent border and a dot. Only the knocked-out tiles flip on a reveal.
- **Grid sizing (D1 retuned):** the big grid now starts above 28 tiles (was above 35), at 1.75 rem. Measured: 16, 28, 29, 35, 36, 40, 60 and 100 tiles all fit with no hidden rows at 1280×720, 676 and 628, with the simulated-Mob form open.

**Checklist (design-system §0):**

- [x] data-gsc-game; no local accent override; no gradient stage
- [x] one Anton hero per screen; no uppercase or tracking; no decorative eyebrows; body ≥ 16 / controls ≥ 15
- [x] accent for active state, primary and rule only; gold only on money; no text-shadow or glow
- [x] one surface level with a hairline; no backdrop-filter; no accent rails
- [x] buttons 6 px radius, 44–48 px host / 56 px phone, sentence case, flat
- [x] no emoji in the host DOM; GSCIcons beside labels
- [x] only meaningful motion (the elimination flip); every animation inside no-preference; splash 600 ms plain
- [x] toolbar is Sound · Editor · Game lobby, icon + label
- [x] plain setup sentence
- [x] JS edits limited as above

**Verification (headless Chrome over CDP; scripts in `.scratch/ovh-*`):**

| Check | Result |
|---|---|
| `node --test` | 86/86 |
| `tests/harness.html` (port 8712) | 68/68 (66 + two D4 checks) |
| Real network (PeerJS broker, Mob phone + contestant phone) | PASS: room MWN9, "Answered 1/1", "Mob wiped out / $200", no console errors |
| Play / result / standings, 1280×720, 676, 628 | no vertical or horizontal scroll |
| Setup | fits 720 and 676; fits 628 with ≤ 6 players |
| Phone 320×640 | smallest target 56 px; no horizontal scroll on mob-answer, contestant, mob-eliminated or result |
| Live DOM walk (setup, lobby modal, window open, picked, locked, revealed, result, standings, editor) | 0 emoji, 0 backdrop-filter, 0 text-shadow, 0 gradients under text, 0 uppercase or tracked text outside Anton, 0 text < 14 px, minimum contrast 5.62:1 |
| Reduced motion (emulated) | `getAnimations()` is 0 after a reveal. CSSOM walk found no @keyframes or animation outside no-preference, and no hover lifts. |
| Static | V3 grep clean across `games/one-vs-100` (harness included), no `console.log`, every file < 800 lines (largest `ovh-core.js` 734) |
