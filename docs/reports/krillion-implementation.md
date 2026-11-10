# Krillion — implementation report

Component `krillion` · built against the current `docs/20-krillion-spec.md` (rated answer lists +
judge's review) · 2026-11-03 · Node 24.16 · Windows 11 · Claude desktop browser pane.

## Status

| Check | Result |
|---|---|
| `cd games/krillion && node --test` | **26/26** pass (KR-U1 … KR-U10) |
| repo-root `node --test` | 1,403/1,403 pass |
| `tests/harness.html` on 127.0.0.1:8721 | **57/57** pass (KR-I1 … KR-I6 + gates) |
| T4 standalone, 4 manual players, full 7-prompt Deep Dive at 1280×720 | played through the real UI; no vertical scroll on intro, prompt, reveal, depth or result |
| Puffer Party round at 1280×676 | used-answer refusal, off-list live ruling, shrinking clock, pops through to last one floating; no vertical scroll |
| T3 real network | standalone host + two `?room=` phones over the real PeerJS broker (room 58H5): both joined (p1, p2), answered the same prompt, answers hidden on the host until close, each phone got its own tier/points/depth |
| Static gates | no innerHTML/eval/document writes, no `console.log`, every file < 800 lines (largest `kr-app.js` 607), only Google Fonts URLs, no `[data-gsc-game]` override, all motion inside `prefers-reduced-motion: no-preference`, phone targets ≥ 56 px at 320 px, contrast ≥ 4.5:1 (lowest pair 5.6:1) |

## What was built

- **Pure core** (`kr-content.js`, `kr-select.js`, `kr-core.js` → `KrCore`): validator for the §3
  schema (tiers 2–6 / unique ids / strictly rising points; prompts ≥ 40; answers ≥ 5 across ≥ 3
  tiers; alias uniqueness after normalisation); normalisation + `matchAnswer(prompt, text)` (aliases,
  accents, articles, simple plurals, squashed spaces); `groups` (with `pending`), `reviewQueue`,
  `revealOrder` (misses, then Prawn → One in a Krillion), `tierTally`, `depthBoard`/`depth`, `ring`,
  `phoneView`, `validatePhoneMsg`. Events: all of §5 including `review{group,tier|null}` and
  `remember{group}`, plus `pauseClock`/`resumeClock`. Clocks are deadlines from an injected `now`;
  `freeze`/`thaw` turn them into remaining time and back. History snapshots drop the content (it
  never changes) and freeze the clock, so undo restores the exact seconds and saves stay small.
- **Content**: `prompts.json` — 100 original prompts, 13 categories, 2,493 rated answers (10–25 each,
  every prompt covers all five tiers, aliases for common alternate spellings); `js/data.js` mirror
  (a unit test asserts they are identical); `sets/kids-night.json` (40 prompts / 746 answers) and
  `sets/pop-culture.json` (40 / 851) + manifest.
- **Host UI** to docs/21: flat `#03111f` stage, teal `#2ee6c5` as the one accent, coral only for
  misses/pop, hairline surfaces, Inter sentence case, one Anton hero per screen (title / clock /
  winner), no emoji, toolbar Sound · Editor · Game lobby. Screens: setup (mode, players, phones,
  settings incl. one points field per tier, library, shuffle), intro, prompt (clock, n/m answered,
  per-player chips, host typing with Hide-what-I-type, rated-list toggle), reveal (Judge's review
  with each player's exact text, tier picker + Not valid + Add to this question; reveal walk; tally;
  reef strip), depth board (per-prompt tier tally, reef with markers that glide down), result,
  Puffer Party (ring, holder, shrinking clock, live ruling, used list with Add to this question,
  hearts drawn + stated in words). Undo, game-lobby keep/start-over/resume, splash only standalone,
  WebAudio cues (sonar ping on submit, bubble per reveal, abyss sting for One in a Krillion, pop).
- **Editor**: prompt list (bad prompts flagged), per-prompt rated-answer table, Import judged answers,
  Download JSON, Download for the library (file + manifest entry), Use in game, reset/blank.
- **Phones**: wait / answer / reveal / puffer-hold / puffer-watch / out / result; local countdown from
  the host's remaining time; "Sent ✓ — you can change it until the clock ends."

## Decisions and deviations the orchestrator should know

1. **The spec changed mid-build** (coordinator message): the first draft graded rarity against the
   room; everything room-share (merges, `tierFor(n,N)`) was removed and replaced by the rated-list
   model now in docs/20. Built and tested against the current text.
2. **`pufferJudge`** accepts `{tier}` (what the host UI sends: any tier id or null) and also the
   spec's `{valid, niche?}` shape (valid → shallowest tier, valid+niche → deepest, valid:false → not
   valid). Unit-tested both.
3. **Meter**: a tier's meter value is its position in the tier list (Prawn 0 … Krillion 4), so custom
   tier lists work. `meterForHeart` defaults to **100 as the spec says** — that is ~25+ valid answers
   per heart, so it rarely fires; it is a setup/JSON setting and the README says so. Consider a
   default nearer 10.
4. **Auto-close**: a Deep Dive prompt closes as soon as every player has answered (the spec's "until
   the clock ends or everyone has submitted"), so the last player to answer cannot change theirs.
5. **Puffer standings**: eliminated players place by how long they lasted (`outAt`), then hearts,
   then answers.
6. **Room-scoped saves**: when the room code changes, phone players inside a saved/kept game are
   re-keyed to host-typed seats (`m1`, `m2`, …, history included) rather than dropped, so scores
   survive but a new `p1` inherits nothing; non-manual players leave the setup roster.
7. **"Add to this question"** updates the session content (`app.game`) immediately and is logged for
   the editor's import. Undo reverts it inside the game but not in the session file (README known
   issue).
8. **Toolbar label** is plain "Game lobby" (no ⟲) per docs/21's no-icon-glyph rule; `shared/icons.js`
   did not exist yet. Embedded mode shows no "Back to lobby" button (docs/21 §9: nothing else).
9. **Night scoreboard**: Deep Dive reports depth in metres; Puffer Party reports 10 × (players − place + 1).
   Host-typed players are not reported (they are not in the shell roster).
10. The page's rated-list toggle exists on the prompt screen as the spec asks, labelled as visible to
    everyone on a shared screen; it is off by default and the list is only in the DOM while on.

## For the hub agent

- Add the registry entry from spec §7 and a `[data-gsc-game="krillion"]` theme block, e.g.
  `--accent: #2ee6c5; --accent-2: #ff6b57; --accent-ink: #03111f;` (12.0:1). Krillion's sheet uses its
  own `--kr-*` values and paints its own flat stage, so it does not depend on the block.
- No shared files were touched.

## Defect found and fixed during testing

- Phones in standalone `?room=` mode showed the host setup screen beside the phone card (the host
  app does not boot on phones, so nothing hid it). Fixed in `kr-phone.css`; the harness now asserts
  a phone shows only the phone card.

## Fixes after verification (2026-11-04)

The tester's verdict was fix-then-ship (`docs/reports/krillion-verification.md`). I kept their K-1 fix (remembered answers survive a reload) and their six rating corrections. I made the `meterForHeart` change by editing the JSON in place rather than regenerating it, so those corrections are untouched.

| # | Fix |
|---|---|
| K-2 (major) | The judge's review is now one row per off-list answer: the answer and each player's exact text, then the tier buttons, Not valid, and Add to this question. The queue has a bounded inner scroll, and its heading shows a "n to rule" / "all ruled" count. While the queue is open, the screen hides the answer cards, the reef strip and the rated list. They come back when the reveal starts. New harness checks use 5 off-list answers at 1280×676: no page scroll, rows ≤ 60 px, cards and reef hidden, the count follows the rulings, and the reef returns after the first reveal with still no scroll. I also checked 7 off-list answers at 1280×676 by eye: no page scroll. |
| K-3 | Toolbar: `shared/icons.js` is loaded and the buttons read Sound · Editor · Game lobby, each with a `GSCIcons` icon and a text label, 44 px tall (bar 64 px). The Sound label is rewritten on every render ("Sound" / "Sound off"), then its `sound` / `sound-off` icon is put back. Game lobby is present but disabled on setup. New harness checks cover icon + label + 44–48 px, the icon surviving a Sound toggle, and the disabled lobby button. |
| K-4 | When `?game=URL` fails but a non-default (or judge-extended) game is kept, the message now says "Keeping the prompts you already had." instead of falling back to the shipped prompts. |
| K-5 | An answer added with Add to this question stays in the queue until the reveal starts. It is marked `remembered`, its tier shows as pressed and can't be changed, and the button reads "On this question now". `reviewQueue` reports `remembered`, and `review` refuses a remembered group. Covered by a unit test and a harness check. |
| Decision | `meterForHeart` default is **10**: in `DEFAULT_SETTINGS`, `prompts.json`, `js/data.js` (still a byte-for-byte mirror), both library sets, the harness fixture, the README and the unit test that pinned 100. I removed the old README known issue about hearts never coming back. |

Results: `cd games/krillion && node --test` passes **44/44** (including `tests/kr-adversarial.test.mjs`). The repo-root `node --test` passes 1422/1422. `tests/harness.html` on 127.0.0.1:8721 passes **65/65**. Static gates are still clean: no inner-HTML, string evaluation or console logging, and the largest file is `kr-app.js` at 613 lines.

## Host phone (docs/22 §5, Krillion row) — 2026-11-10

I built this to the seven-item contract in docs/22 §5, followed F11 for seat reconciliation, and coded against the SDK as described in `host-phone-shell-implementation.md` §1. The structure copies Weakest Link. All new code is in new files: `js/kr-host-view.js`, `js/kr-hostphone.js`, `js/kr-hostscreen.js`, `css/kr-host.css`, `tests/kr-host-view.test.mjs`, `tests/harness-hostphone.js` and `tests/fixtures/hostphone-game.json`. The existing files only got hooks: script and link tags, the host card `<div>`, `onHostPhones` / `attach(room)` in `kr-room.js`, `onHostView` / role routing in `kr-phone.js`, `KrApp.note`, a null guard in `renderList`, and the harness shell routing.

1. **Selector — `KrHostView.hostView(state)` (pure).**
   - **Deep Dive (intro, prompt, reveal):** shows the prompt, the rated list grouped by tier (the judge's remembered answers included), each submitted answer as it arrives with its matched tier (or "pending" / the ruling for off-list answers), "n / m answered", and a preview of the judge's queue.
   - **Puffer Party:** shows the prompt, the rated list, the holder, the pending answer and the used answers.
   - **Setup, depth board and result:** `secret:false`.
   - **Size limits:** lists are cut to 30 words per tier and 16 rows, each with a "more" count. The largest shipped prompt with 16 players stays under 8 KB.
   - **Fallback item key:** `itemKey(state)` changes only when a new prompt comes up.
2. **Room glue.** On every render the glue sends `room.setHostView({t:"host", item, seq, ...hostView})`. `seq` is a counter that goes up only when the view's JSON changes; pausing the clock, for example, sends the same `seq`. There is no cache, no resend and no `room.send` for host data, and `phoneView` is unchanged.
3. **Phone page in `role=host`.**
   - **What it shows:** a "Host · Krillion" header, the prompt, "Answers in" (name: text → tier, with pending answers in coral), the judge's queue, and the rated list with answers at 28 px in the accent.
   - **Size:** all text is at least 16 px, with no sideways scroll at 320 px.
   - **Behaviour:** no buttons, and it sends nothing (it skips the contestant `ready`). The contestant renderer returns early while the host screen is active.
4. **Answers-private mode.**
   - **What's removed:** both "Show the rated list" toggles and both rated-list panels are taken out of the document. The remembered `showList` switch is ignored but not cleared.
   - **What replaces them:** "Answers are on your host phone". While no host phone is connected it reads "Host phone disconnected" with one **Show answer on this screen** button. That button shows the current prompt's rated list only, and it clears on the next prompt.
   - **What's unchanged:** the judge's review, the public reveal and Puffer Party's shared screen. The Puffer screen never had a list panel.
5. **Tests.**
   - **Unit:** `kr-host-view.test.mjs` adds HV-1…HV-8 (8 tests). They cover nothing secret on setup, depth and result; the list grouped by tier; answers with tier or pending; queue rulings and remembered answers; Puffer; truncation and the 16 KB budget across all 100 shipped prompts; `itemKey` and purity; and `phoneView` unchanged.
   - **Harness:** `harness-hostphone.js` adds HP-1…HP-6 (13 checks). The fixture's rated answers all start with `Hpq`, so any `Hpq` on the shared screen before the reveal is a leak. The leak check covers text, `value`, `placeholder`, `title`, `alt`, `aria-label`, `data-*` and `setTitle`, with the host phone both connected and disconnected. The fallback shows the list, and it is gone on the next prompt.
6. **Seat reconciliation** (embedded only, once, at room attach, before phones are re-seated). Phone seats in the saved setup that are not in `room.players()` are dropped. A running or kept game keeps such a seat (the host types for it) and shows one notice that survives the content load: "‹name› is no longer a player in this room (now the host phone, or gone) — type their answers from this screen, or start a new game."
7. **Stale and tooBig states.** The phone dims with "Reconnecting — this may be out of date", and a refused view reads "Too much to show — use the button on the laptop".

**Results:**
- `cd games/krillion && node --test` passes **52/52**: 44 existing plus 8 new.
- The repo-root `node --test` passes **1546/1546**.
- `tests/harness.html` on 127.0.0.1:8721 (Node static server `.scratch/hp-kr-serve.mjs`) passes **78/78**: 65 existing plus 13 host-phone checks.

With no host phone assigned the original 65 harness checks pass unchanged.

**Harness change:** the frames now have `flex: none`. The browser pane is shared with other agents and was 268 px wide, which shrank the 1280 px host iframe and broke the no-scroll checks. That was a harness artefact, not a game bug.

**Gates:** no banned sinks, no `console.log`, and the largest file is `kr-app.js` at 614 lines.

Scratch helpers are `.scratch/hp-kr-fixture.mjs` (writes the prefixed-answer fixture) and `.scratch/hp-kr-serve.mjs`.
