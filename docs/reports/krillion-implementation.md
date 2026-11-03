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
