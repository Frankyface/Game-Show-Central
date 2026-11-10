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
| T4 standalone, host types the panel, two manual contestants (Marcy / Otis), full game at **1280×676** | **Corrected in round 2 below: this claim was wrong.** Start → 2 rounds → scores → Audience Match → $500 went through the UI, but I set the panelist's Head-to-Head card with `MgApp.dispatch` from the console; the UI had no field for it, so a host without phones could not finish (tester's MG-D1, critical). Fixed, and re-verified host-only through the UI in round 2. |
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

---

# Round 2: verification fixes and the v3 UI pass (2026-11-03)

This round worked from `docs/reports/match-game-verification.md` (verdict: fix-then-ship) and
from `docs/21-ui-cleanup-brief.md` with `docs/design-system.md` §0. The tester's own fixes are
kept as they were: MG-D0, D5, D6, D7, D8, D9 and the audience-prompt swap.

## Correction to round 1

In round 1, the T4 row said I played the host-only game through to ×20 = $10,000. That was not
true through the UI. I set the panelist's Head-to-Head card with `MgApp.dispatch(...)` from the
console and did not notice that the host had no control for it. The tester was right (MG-D1).
I re-ran the game below, through the UI only.

## Defects

| # | Sev | Fix | Where | Pinned by |
|---|---|---|---|---|
| MG-D1 | critical | The Head-to-Head rail gets a **What ⟨panelist⟩ wrote** form, which dispatches `hthAnswer{who:"panel"}`. It shows while the chosen seat has no phone and the card is still empty. It follows "hide as I type". | `index.html` (`#mg-hth-panel-form`), `js/mg-super.js` renderPlay, `js/mg-app.js` mgLockHthPanel | Harness **MG-I4b** plays a whole host-only game through the UI, Head-to-Head included ($100 × 20 = $2,000). The headless play-through at 1280×720 and 1280×676 covers it too. |
| MG-D2 | major | `mgBindRoom` now follows Pyramid's `pyrBindRoom`. On a new room code it drops phone players and every phone pid from the setup seats. It clears `core` / `resumable` if they seat a phone, and shows a plain-English note. Host-typed seats keep their names. | `js/mg-app.js` | Checked by reading it against `pyrBindRoom`. Harness MG-I5 reloads in the same room and keeps the game. |
| MG-D3 | major | `bestLabel` now picks the most-said wording only among answers whose own key is the group key, so the target answer names the row. Folded-in variants are only a fallback. | `js/mg-select.js` | Tester's `T-top3 … (MG-D3)` (todo removed) |
| MG-D4 | minor | A prompt over 160 characters is refused with "Prompts 3 is longer than 160 characters (161)" instead of being cut. | `js/mg-content.js` | M-U1 updated plus a new M-U1 test. Tester's `T-validate … (MG-D4)` (todo removed). |
| MG-D5 | minor | The board columns are now flex columns. The "Everything else" list fills the rest of the column and scrolls inside itself. Merge-button labels are cut at 16 characters, with the full text in the title. With 16 distinct 40-character answers the page is 676/676. | `css/mg.css`, `js/mg-super.js` | Headless audit `board-long` |
| MG-D10 | minor | The "sent tick" check now waits for all three phones. | `tests/harness.html` | 3 clean harness runs |
| MG-D11 | minor | The message now reads "Couldn’t load …: ⟨reason⟩." followed by "Keeping the prompts you had." or "Using the shipped prompts instead." The double period is gone, and `mgNote` keeps it on screen. | `js/mg-app.js` | Checked by reading the code |
| MG-D12 | minor | `spin` is refused once `hth.spun` is set or after the reveal. The button then reads "Spun" and is disabled. | `js/mg-core.js`, `js/mg-super.js` | Adversarial test `MG-D12`; harness MG-I4 |
| MG-D13 | minor | The pick-a-panelist screen shows name-only cards, instead of the previous prompt's `hostCards`. | `js/mg-super.js` | Harness MG-I4b |
| MG-D14 | minor | The phone kicker is now 15.2 px. The board's prompt line is 1.15 rem in `--ink`. | `css/mg-phone.css`, `css/mg.css` | Headless audit |
| MG-D15 | minor | Phone answers are tagged `fromPhone: true` in `mg-room.js` and never go on the undo stack. `undo` carries forward any phone answer for the same open card, audience board or Head-to-Head card. Undoing a host decision therefore never wipes a phone's answer. | `js/mg-core.js`, `js/mg-room.js` | Three new adversarial tests |
| MG-D16 | minor | On a seat that has a phone, the card's type-in form is hidden and the face reads "Writing on a phone…". | `js/mg-view.js` | Harness MG-I1 |
| **MG-D17** (new, found by me) | major | `mg-editor.js` declared a global `mgWireSettings` that **replaced** `mg-app.js`'s function of the same name. Every setup rule input was silently dead, so changing panel seats, rounds, points, values, multipliers or the round-two rule did nothing. I renamed the editor's function to `mgWireEditorSettings`. A scan for duplicate globals across the four classic scripts is now clean. Neither the harness nor the tester touched a setup rule input, which is why this went unnoticed. | `js/mg-editor.js` | Harness MG-I4b sets rounds to 1 through the input |

## v3 UI pass (docs/21)

The CSS is rewritten from scratch (`css/mg.css` at 670 lines, plus `css/mg-phone.css`). Markup
and JS changes are limited to:

- **Toolbar.** The order and labels are now Sound · Prompt editor · Game lobby; the ⟲ glyph is
  gone. Each button gets a `GSCIcons.prepend` icon, and `shared/icons.js` is now loaded.
- **Copy.** Three decorative eyebrows are gone, and setup gets one plain sentence.
- **Cards.** The card name and its Match / No match mark share one `.card-head` row, so six
  cards fit at 676. The marks are in sentence case.
- **Result line.** It is now factual ("Head-to-Head: a match").
- **Splash.** It is the plain 600 ms card with no subtitle.
- **Board.** The board columns get classes.

Checklist (`design-system.md` §0):

- [x] `data-gsc-game="match-game"` is set, with no local `--accent*` or `--stage-glow`. The 70s chocolate stage, the mustard and avocado, and every gradient are gone. The stage is the shared flat base with about 5 % orange.
- [x] Anton is used for one hero per screen:
  - the game name on setup;
  - the prompt in play and in the Head-to-Head;
  - the amount won on the result.

  Everything else is Inter 400/500/600 in sentence case. The audit finds no `text-transform: uppercase` and no `letter-spacing` above 0.5 px.
- [x] Decorative eyebrows are deleted. A label remains only where it names a group of controls.
- [x] Body text is at least 16 px and controls at least 15 px. The one exception is the merge buttons inside the board, at 14.4 px.
- [x] The accent is used only for the primary button, the face-up card waiting for a judgement, and the rule under the prompt.
- [x] Gold is used only on money: board values, the banner money badge, standings, the result amount and the phone standings.
- [x] There is no `text-shadow`, glow, `backdrop-filter` or gradient under text. Audit UI-11 is clean on every screen.
- [x] There is one surface level: `--surface` with a hairline border and an 8 px radius. Face-down cards use the stage colour and flipped cards use `--panel-strong`. Nothing is nested and there are no accent rails.
- [x] Buttons are rectangular with a 6 px radius, sentence case, weight 600:
  - Height is 44–48 px on the host, with two dense controls as exceptions: the merge buttons are 34 px and the in-card Save is 40 px. Phones are 56 px.
  - Primary is the flat accent, secondary a hairline outline, and danger a red outline.
  - Match is flat signal green with dark ink.
- [x] There is no emoji in host DOM text (UI-10 audit). Toolbar icons come from `GSCIcons`, each beside its label.
- [x] Motion is limited to the card flip, the board rows arriving and the spinner rattle, all inside `prefers-reduced-motion: no-preference`. A CSSOM walk over the game sheets finds nothing outside that block, and `getAnimations()` is 0 under `reduce` after a flip.
- [x] The splash is a plain 600 ms card, skipped when embedded and under reduced motion.
- [x] The toolbar order is Sound · Editor · Game lobby, each with an icon and a label (UI-12). The room chip shows only when standalone.
- [x] Setup copy is one plain sentence. Error messages are unchanged apart from MG-D11.

## Verification (round 2)

| Check | Result |
|---|---|
| `cd games/match-game && node --test` | **98 / 98 pass, 0 todo.** This includes the round-1 suites, the tester's 20 tests (both former todos now pass), one new M-U1 test and four new adversarial tests. Root `node --test`: 1403 / 1403. |
| `tests/harness.html` on 127.0.0.1:8714 | **64 / 64 pass** on three runs. I ran them in headless Chrome via `.scratch/cdp.mjs`, because other agents were driving the shared browser pane. This includes the new **MG-I4b**: a host-only game played entirely through the UI to a Head-to-Head payout. |
| Host-only full game through the UI, at 1280×720 and 1280×676 (`.scratch/mg-v3-check.mjs`) | The game was played start to finish with **both Head-to-Head cards typed by the host** and no console dispatch. Every play screen measures 720/720 and 676/676; setup scrolls inside its own screen. Each screen passed the audit at both sizes: contrast of at least 4.5:1 on every visible text node, and no emoji, text-shadow, backdrop-filter or gradient under text. |
| Phones (harness frames, 320 px wide) | 320/320 with no sideways scroll. The field and Send button are at least 56 px tall on the panel screen (MG-I6 V-phone). The kicker is 15.2 px, and the audit is clean. |
| Static gates | There is no innerHTML, eval, document.write or console.log. The largest files are `mg-core.test.mjs` (760), `mg-app.js` (740) and `mg.css` (670), all under 800. The only external URLs are Google Fonts, and there is no `[data-gsc-game]` block in the game CSS. |
| T3 real network | Not re-run this round. The transport path is unchanged apart from the `fromPhone` flag on the three answer events, which the harness exercises over the bridge. |

The screenshots I checked are headless captures kept out of the repo: `.scratch/mg-v3-{setup,prompt,scores,board,hth,result}.png`.

The full game played through the UI ran in this order:

1. Setup.
2. A prompt, with six 40-character answers typed into the cards.
3. Reveal and judge.
4. Scores, then round 2.
5. The Super Match: an Audience Match with 16 answers, 13 of them distinct 40-character answers.
6. The board, then picking a panelist.
7. The Head-to-Head, with both cards typed by the host.
8. Spin, reveal, the result, then standings.
9. The Game lobby dialog.

---

# Round 3 — the host phone (docs/22, 2026-11-10)

Built to `docs/22-host-phone-spec.md` §5 (the seven-item contract) and the Match Game row of §6, review F11, and
the SDK as built (`docs/reports/host-phone-shell-implementation.md` §1). I followed the shape of The Chase. All new
code is in new files. The edits to existing files are hooks only.

## The seven items

| # | Item | As built |
|---|---|---|
| 1 | Pure `hostView(state)` | `js/mg-hostview.js` (UMD, `MgHostView`, re-exported by `MgCore`). It is pure and deterministic, and never larger than ~2 KB: at most six panel rows and three board rows, with every answer already capped at 40 characters by the core. See the phase table below. The host plays no role in this game that must not know these things, since the host already types the answers for panelists without phones, so nothing is withheld. |
| 2 | Room glue | `js/mg-room.js`: `room.setHostView({t:"host", item, seq, ...hostView(state)})` runs in the subscriber on every change and once at boot. `seq` moves only when the view's JSON changes. There is no cache, no resend logic and no `room.send` for host data. `onHostPhones` re-reads `room.answersPrivate()`. Contestant `phoneView` is unchanged. |
| 3 | Phone page in `role=host` | `js/mg-hostphone.js` + `css/mg-hostphone.css`, routed from `mg-phone.js` on `me.role === "host"`. It shows a v3 card with a "Host" tag, the item large, the hint and the panel's answers in the accent at 28 px, and the contestant's answer. The Super Match shows the top three with counts and money; the Head-to-Head shows both cards and the stake. In phases with no secret it says "Nothing secret right now" plus the phase. The contestant renderer is blocked for a host phone, so a stray `msg` or a status change cannot redraw over it. |
| 4 | Answers-private mode | `js/mg-hostscreen.js`, wired into `mg-view.js` and `mg-super.js`. While a host phone is assigned (connected or not), the laptop changes in four places, listed below. In place of private text it shows "Answer is on your host phone"; while the phone is away it shows "Host phone disconnected" and **one** "Show answer on this screen" button. The button is keyed to the current item (prompt or board) and is forgotten on the next one. Public reveals are unchanged: a card flip, a hit on the board, and the Head-to-Head reveal. |
| 5 | Tests | Unit: `tests/mg-hostview.test.mjs`, 8 tests. Harness: `tests/harness-hostphone.html`, 29 checks, with a prefixed fixture (`tests/fixtures/hostphone-game.json`). See below. |
| 6 | Seat reconciliation on boot | Embedded only, because a standalone room has no roster at boot. `MgHostScreen.reconcileSeats(room.players())` runs right after `GSC.host()`. It drops phone players and phone pids from the setup seats when they are not in the room. A running or kept game keeps the seat, plays it phone-less (the host's type-in field and the Head-to-Head "What ⟨panelist⟩ wrote" field are shown for it), and shows one notice: "‹name› has no phone in this room — type their answers on this screen, or start a new game." The boot replay of the roster no longer posts "‹name› joined" messages, which would have overwritten that notice. |
| 7 | Host-phone page behaviour | It shows `item` beside the answers. It dims and says "Reconnecting — this may be out of date" when `onStatus(false)` arrives. It renders `tooBig` as "Too much to show — use the button on the laptop." It sends nothing: it does not even send the contestant `ready`. It has no buttons. |

What the host phone shows, by phase:

| Phase | Host phone shows |
|---|---|
| `prompt` | The prompt, its hint, every panel answer as it arrives (revealed or judged marks, and "already matched" under the round-two rule), and the contestant's answer once it is locked. |
| `audience` | The live top three (wording, count, money) while the room answers. |
| `audienceBoard` | The top three before they are revealed, with "on screen" once a guess hits a row. |
| `hthPrompt` | Both cards, the stake (`$500 × 20`), and the panelist's name. |
| Every other phase | `secret:false` |

What changes on the laptop in answers-private mode:

1. The prompt's hint is not rendered.
2. The Audience Match top three show rank, count and money, but read "Hidden" instead of the wording until a guess hits the row.
3. The merge buttons name hidden rows by rank (`→ #1`) in both their labels and their `title`s.
4. Every host type-in (panel cards, both Head-to-Head fields) is masked, and "hide as I type" is forced on and disabled. This removes the "peek".

## Fixes made along the way

- **Seat names follow the phone.** A seat whose name had been filled in from a phone's player took on the new phone's name when the host re-pointed it. Before this fix, re-seating Brett's phone onto a seat that had been auto-filled for Charles left it labelled "Charles". Names the host typed stay as typed.

## Verification

| Check | Result |
|---|---|
| `cd games/match-game && node --test` | **106 / 106** (98 before plus 8 host-view tests). Root `node --test`: **1546 / 1546**. |
| `tests/harness-hostphone.html` on 127.0.0.1:8714 (Node static server `.scratch/hp-mg-serve.mjs`; headless Chrome via `.scratch/hp-mg-run.mjs`) | **29 / 29, three runs.** It covers HP-1 to HP-7, listed below. |
| `tests/harness.html` | **64 / 64**, three runs, unchanged by the feature. |
| v3 audit (`.scratch/mg-v3-check.mjs`) at 1280×720 and 676 | Every play screen fits with no vertical scroll. There is no emoji, glow or gradient under text, and motion stays inside the reduced-motion guard. One sample reads 1.20:1 on **Reveal the next card**. This was taken in the 120 ms between the button becoming enabled and the shared theme's `.btn` background-color transition finishing. At rest the text is 7.5:1 (`#2a1403` on `#ff8c1a`), and the transition belongs to `shared/theme.css`, not this game. |
| Static gates | No innerHTML, eval, document.write or console.log. The largest files are `mg-core.test.mjs` (760) and `mg-app.js` (756), both under 800. |

The harness checks (prefixes: `ZQH-` hints, `ZQP-` panel answers, `ZQA-` audience answers, `ZQT-` Head-to-Head cards, `ZQG-` the contestant's answer):

- **HP-1:** the host-role frame receives the view via `onHostView`; contestant frames never do. The host phone is never seated.
- **HP-2:** with the host phone connected, no `ZQH-` or `ZQP-` string appears anywhere in the host document before the matching card flips. The search covers text, `value`, `placeholder`, `<option>`, `title`, `alt`, `aria-label` and `data-*`, plus `setTitle`. The host phone has every answer as it arrives, and its layout passes at 320 px: no sideways scroll, text ≥ 16 px, answers ≥ 28 px, no buttons. A flip is public and shows that card only.
- **HP-3:** with the host phone disconnected the screen stays private and shows one fallback button. The prompt screen with the button still fits 1280×676. The button shows the current hint, and the hint is gone on the next item. On reconnect the screen returns to "Answer is on your host phone". The stale banner shows on the phone.
- **HP-4:** the board's wording is absent until a hit, and merge labels and titles use ranks.
- **HP-5:** both Head-to-Head cards reach the host phone and are absent from the laptop until the reveal. The host phone sent nothing. `tooBig` shows its plain-words message.
- **HP-6:** seat reconciliation, with a former panelist now acting as the host phone.
- **HP-7:** with no host phone, the hint is shown exactly as before and the type-in is not forced.
