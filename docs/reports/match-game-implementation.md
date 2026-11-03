# Match Game — implementation report

Component `match-game` · spec `docs/18-match-game-spec.md` · cross-cutting
`docs/19-cross-cutting-round.md` · date 2026-11-03 · environment: Windows 11, Node 24,
Python http.server on 127.0.0.1:8714, built-in Chromium browser pane.

## What was built

| Area | Files |
|---|---|
| Pure core | `js/mg-content.js` (validation, normalisation, draw), `js/mg-select.js` (selectors), `js/mg-core.js` (reducer). `MgCore` re-exports all three. The handler lookup is guarded with `hasOwnProperty`. |
| Content | `prompts.json` (60 original fill-in-the-blank prompts, each with `___` and ≤ 80 chars, plus 20 audience prompts), its mirror `js/data.js`, and `sets/index.json` with **Kids' night** (32 + 12, 4-seat panel) and **Movies & TV** (32 + 12, round-two rule on). |
| Host UI | `index.html`, `js/mg-app.js`, `js/mg-view.js`, `js/mg-super.js`, `js/mg-sound.js`, `css/mg.css`. Screens: setup, prompt (six face-down flip cards with "answered n/6", per-card host typing, contestant lock-in, one-at-a-time reveal, Match / No match), round scores (tiebreak), and the Super Match (live audience count, top-three board with merge buttons, three guess slots, panelist pick, ×10/20/30 spinner, two-card Head-to-Head). Then standings, undo, hotkeys R / Space / X / U / N, and sounds. |
| Cross-cutting §1 | `btn-game-lobby` ("⟲ Game lobby") in the toolbar opens a `role="dialog"` with Keep this game, Start over and Cancel. The game is kept in `resumable`, and setup shows **Resume**. |
| Cross-cutting §2 | `GSCLibrary.mountPicker` on setup (`#mg-library`). Loaded sets go through `validateGame` and the source note reads `set: <name>`. The editor's **Download for the library** downloads `<slug>.json` and prints the manifest entry and the commit path. |
| Editor | `js/mg-editor.js` |
| Phones | `js/mg-room.js` and `js/mg-phone.js`. Panelists type secretly, the audience types during the Audience Match, and the chosen panelist types in the Head-to-Head. Screens: `wait` / `panel` / `audience` / `hth` / `result`. |
| Tests | `tests/mg-core.test.mjs` (M-U1…M-U10), `tests/mg-adversarial.test.mjs`, `tests/mg-fixtures.mjs`, `tests/harness.html` (MG-I1…MG-I6), `tests/fixtures/harness-game.json` |
| Docs | `games/match-game/README.md`, this report |

The editor supports Download JSON, Download for the library, Use in game,
Reset, Start blank and a draft auto-save. It has one textarea per list, with
`text | hint` per line, and it lists every bad line by number.

## Format decisions (normative rules → code)

- **Turn order.** Each round has one turn per contestant, each with a fresh
  prompt. The opener alternates by round (`seatFor(round, n) = (round-1+n)%2`)
  and carries on into tiebreaks.
- **Reveal.** No card can flip until the contestant's answer is locked. Only
  one card can be face up and unjudged at a time. Panel answers can be
  rewritten until the first flip, then they are frozen.
- **`secondRoundRule`** (default off). From round 2, the slots this contestant
  matched earlier are left out of the reveal order and shown as "already
  matched". A locked-out panelist's phone says to sit out. Tiebreaks ignore
  the rule.
- **Tie.** After the last round, a level score stops on the scores screen.
  **Tiebreak** adds an extra round; repeat until someone leads.
- **Super Match runs in sequence** (spec §3 says "then Head-to-Head"):
  1. **Audience Match** (one answer per phone; the panel and contestants are
     refused; resending replaces the earlier answer; capped at 200).
  2. **Top three** by normalised frequency: trim, case-fold, collapse spaces,
     and drop end punctuation. Merges resolve in chains and refuse cycles.
  3. Up to **three guesses**. The first hit pays that row.
  4. **Head-to-Head** for `won × multiplier`, or `min(audienceValues) ×
     multiplier` when the Audience Match won nothing.
- **Spinner.** `spin` takes a serialisable `roll` (0–1), so undo and a reload
  replay it exactly. It also accepts `rng`. The multiplier defaults to the
  first entry until someone spins.

## Deviations / additions to the spec's event list (documented, all tested)

- `toHeadToHead` was added. It lets the host skip the Audience Match from the
  winner's choice or from the board, for example in a room with no phones.
- `nextPrompt` swaps the prompt before any reveal. `nextContestant` advances
  the turn, round or scores; it moves on from the scores screen too.
- `audiencePick{idx:-1}` (or any idx outside 0–2) is a miss. The event takes
  an optional `text` (what the contestant said) for the guess slot.
- `hthAnswer{text, who}`: `who:"contestant"` for the host-typed card; the
  default is the panelist.
- `revealNext` in the Head-to-Head turns both cards over once both are in.
- The selectors live in `mg-select.js` so that `mg-core.js` stays at 478 lines.
- Merge buttons appear on the board rows too ("Map" → "maps") and on
  off-board rows targeting other off-board answers. The spec only implied
  board targets. This was found in manual play.

## Verification I ran

| Check | Result |
|---|---|
| `cd games/match-game && node --test` | **73 / 73 pass**: M-U1…M-U10 (58 tests, including the leak tests on `phoneView`/`hostCards` and top-three with normalisation, merges and cycles) plus 15 adversarial tests (hostile frames, caps, 10 000-event fuzz with the invariant "shown card texts = reveals", a secret-leak fuzz) |
| `tests/harness.html` on :8714 (shell + 3 panel phones + 2 audience phones, `?store=harness`) | **55 / 55 pass**, run twice. It covers MG-I1 through MG-I6: secret panel, reload and lobby, reveal order, Audience Match and merges, Head-to-Head, and library, editor and gates. Real storage keys were untouched. |
| T4 standalone, host types the panel, two manual contestants (Marcy / Otis), full game at **1280×676** | Played start → 2 rounds → scores → Audience Match (9 host-typed answers, two merges, a miss then #1 = $500) → Head-to-Head ×20 = $10,000 → standings. `scrollHeight == clientHeight` (676) on every screen; no horizontal scroll. The harness host frame is 1280×720 with the same assertion. |
| T3 real network | Standalone host opened room CG4B over the real PeerJS broker. A second tab joined as `?room=CG4B&name=Brett` and was seated on panel seat 1, then typed an answer. The host showed "answered 1/6" and the word "answered" on the card. The host DOM (text and every input value) did **not** contain the answer until **Reveal**, when the card flipped to it. The phone then went pencils-down. Brett then played the Head-to-Head from the phone ($10,000). |
| Static gates | No innerHTML, insertAdjacentHTML, document.write, eval or new Function. No console.log. Every file is under 800 lines (largest: `mg-core.test.mjs` 751, `mg.css` 737, `mg-app.js` 689). The only external URLs are Google Fonts. No local `[data-gsc-game]` override: the hub's theme block for `match-game` (#ff8c1a / #e6b800 / ink #2a1403) is already in `shared/theme.css`. Every `@keyframes`, `animation:` and the flip transition sit inside `prefers-reduced-motion: no-preference`. The splash is skipped when embedded or under reduced motion. Phone Send and the field are 56 px tall at 320 px, with no sideways scroll. |
| Contrast (both gradient stops under text) | The card faces and board rows use ink #2a1403 on #ff8c1a (7.5:1) and on #e6b800 (9.4:1). On the stage, `--ink-mute` is 5.0:1 on #3b1f0e and 6.5:1 on #150802. Avocado #6b8e23 (3.96:1) is only used for fills; text uses `--mg-leaf` #9dc44a (7.5:1). |

## Notes for the orchestrator

- **Hub/shell:** the registry entry and the theme accent block for
  `match-game` already exist, so nothing else is needed from the shell. The
  game uses `shared/library.js` exactly as shipped (`gameDir: ""`, relative to
  the game page).
- **Known minors:**
  - An unanswered panel card can still be flipped (blank face); the host
    judges it as a miss.
  - Audience answers are not stemmed; that is what the merge buttons are for.
  - Functions in the wiring tables (`mgWireSettings` in the editor, ~50 lines)
    sit at the soft limit.
- **Hygiene:** I did not touch anything outside `games/match-game/**` and this
  report, and I ran no git commands. The test servers' namespaced storage keys
  (`-manual`, `-t3`) were removed. The :8714 server is still running in the
  background and can be stopped.
