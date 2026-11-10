# Orchestrator triage — Game Show Central build, 2026-09-03

How the build was run, what the independent testers found, what was fixed,
and what is left. Per-component detail lives in the sibling reports.

## Process

1. Specs written first (`docs/00`–`07`), including success states per component.
2. Five Opus implementer agents built the shell, the three new games, and the
   Jeopardy embed adapter, each confined to its own directory.
3. Five Opus tester agents verified each component independently against its
   spec (unit, loopback harness, real PeerJS/WebRTC in two or more browser
   tabs, standalone play, static gates), adding adversarial suites.
4. Defects went back to the implementer that owned the code; shell-level
   defects (and one-line criticals) were fixed by the orchestrator, each with
   a live reproduction before and after.

## Verdicts

| Component | Tester verdict | Blocking defects found | Status now |
|---|---|---|---|
| shell (lobby, room, SDK, virtual peer) | fix-then-ship | S-1 relink bypassed name uniqueness (major) | fixed + unit test |
| family-feud | fix-then-ship | D1 `?game=URL` ignored once a save exists (major); D2 late joiner stuck (shell) | both fixed; minors D3–D8 fixed |
| wheel-of-fortune | fix-then-ship | W-D2 a phone solve could never be judged (critical); W-D1 dead offline fallback (major); W-D3 phone reload got no view (shell) | all fixed; minors handed to implementer |
| weakest-link | fix-then-ship | WL-1 finalists played an extra round (major); WL-2 mid-game joiner got a ballot (major); WL-7 `?game=URL` ignored (major) | all fixed; harness 54/54 |
| jeopardy-embed | fix-then-ship | D1 phone reload muted the player; D2 join could beat the room open; D3 hub refresh killed buzzers (all critical, all in shared code) | all fixed in `shared/virtual-peer.js` + shell; live-verified |

## Cross-cutting defects (found by more than one tester)

- **Game payloads dropped before the game iframe was ready.** The phone shell
  and the host shell both discarded bridge traffic that arrived before the
  iframe posted `ready`. Symptom: a late joiner or a reloading phone sat on
  "Connecting…" until the host's next action. Fixed by queueing (cap 50) and
  flushing right after `init` in `js/hub-player.js` and `js/hub-host.js`.
- **`?game=URL` ignored when a saved game exists.** Feud and Weakest Link both
  restored the save first. Rule now: an explicit URL wins unless the save
  already came from that URL. Wheel of Fortune did not have the bug.
- **Saved state not scoped to the room.** A fresh room's `p1` inherited the
  previous room's seat (Feud D6, Wheel W-D9). Feud fixed; Wheel handed to its
  implementer.
- **Hub refresh mid-game.** Phones stayed connected at the shell level but
  games that join on connect (Jeopardy) never re-joined. Fixed with a
  `session` marker in `lobby` snapshots: phones remount their game frame when
  the host frame was remounted. The virtual peer now also tracks players who
  are offline at `init` and announces them when the shell reports them back,
  closes a dropped phone's connection so the game frees the seat, and queues
  messages per pid until the game has opened its room.

## Deviations from the specs, accepted

- Pure cores split into two files (`*-content.js` + `*-core.js`) in Feud,
  Wheel and Weakest Link to stay under the 800-line cap; the `*Core` global
  re-exports everything so the spec'd API is unchanged.
- Feud: `settings.fastMoney.enabled` defaults to true only when the file
  carries Fast Money questions.
- Weakest Link: a 250 ms interval backs the rAF clock so it keeps running in
  a background tab.
- Jeopardy: `history.replaceState` strips `room` from the host frame's own URL
  because upstream Jeopardy treats a bare `?room=` as "I am a phone".

## Known issues (open, non-blocking)

- Jeopardy's own kick chip does not stick when embedded; kick from the hub
  roster instead (documented in `docs/02`).
- Jeopardy's two 🔔 counts can disagree for up to 30 s (its own heartbeat).
- Weakest Link: the "questions are repeating" flag only shows in the
  transient notice (WL-4).
- Shell: avatar changes after joining are validated but ignored (SHOULD).
- Two vendored Jeopardy files were already over the 800-line cap upstream
  (`app.js`, `buzzer-host.js`); each grew by four `// GSC:` lines.
- Testers ran real-network tiers from one browser profile; a check on two
  physical devices is still worth doing before a big game night.
- UI minors left open (see `ui-upgrade-verification.md`): Jeopardy has no
  game splash by design (the hub's covers it), the registry emoji badge sits
  over the drawn card art on the landing page, Jeopardy's clue modal mixes
  button shapes, Millionaire's setup title casing; `wheel-draw.js` gained
  decorative SVG (rim lights, pointer) beyond the brief's "class names only"
  rule — accepted since geometry and rotation are untouched and all wheel
  suites pass.

## Phase 2 (same day): Millionaire + UI upgrade

Same process: spec first (`docs/08-millionaire-spec.md`, `docs/09-ui-upgrade-brief.md`),
one implementer per surface, independent testers, defects back to owners.

| Component | Tester verdict | Notes |
|---|---|---|
| millionaire | **ship** | 67 unit tests (34 adversarial), harness 55/55, real-network hub run incl. Fastest Finger and Ask the Audience; all 45 questions fact-checked; six minors closed afterwards (phone vote countdown, Switch-the-Question notice, docs). Safe-haven rule clarified to the TV rule: a haven counts once its question is answered correctly. |
| ui-upgrade (hub + 5 games) | fix-then-ship → fixed (double splash in Feud/Wheel when embedded, two Millionaire contrast pairs, hub phone field height; Weakest Link small text raised) | Design system v2 in `shared/theme.css` + `shared/theme-components.css` (`docs/design-system.md`); CSS-only upgrade per game (Jeopardy via a new `gsc-look.css`, no JS); every game harness green before and after; game-switch splash (games skip theirs when embedded). |

UI rules learned: both stops of a gradient under text must clear contrast; every
`@keyframes`/`animation:` lives inside `prefers-reduced-motion: no-preference`;
CSS `filter` cannot transition from `none`; harness asset lists must name new
stylesheets or they go ungated. A harness must not clear storage before the
frame unloads (the outgoing page's beforeunload save rewrites it) and must
namespace its storage with `?store=harness` so fixture state never reaches a
real host's save.

## Phase 3 (2026-09-04): fixes + three more games

- Wheel of Fortune labels are now stacked TV-style (one glyph per row down the wedge, `wheel-draw.js buildLabel`); Weakest Link's Show answer works in the head-to-head.
- Cross-cutting: unguarded `HANDLERS[event.type]` lookups let prototype-shaped event types (`toString`, `__proto__`) reach or corrupt state; guarded in every core, pinned by `tests/core-prototype-guard.test.mjs`.
- Cross-cutting: games declared their own `body[data-gsc-game]` token overrides that disagreed with `shared/theme.css`; decision: the theme block is canonical, local palette overrides are deleted (a game may still override `--stage-bg` for contrast, as Pyramid does).

| Component | Tester verdict | Notes |
|---|---|---|
| deal-or-no-deal | fix-then-ship → fixed | tester fixed a validator deadlock (rounds vs case count) and the handler-map bug; implementer made audience advice live with a host toggle; whole-dollar small offers. 89 unit tests, harness 63/63, real-network run. |
| pyramid | fix-then-ship → fixed | tester fixed a tiebreak bias (Team A could win on an unmatched word); implementer blocked phone marks while paused, added name adoption and End the night. 95 unit tests, harness 66/66, real-network run; secret words never reach the host DOM or non-giver phones. |
| price-is-right | fix-then-ship → fixed | tester fixed a masked bid leaking into a host input (major), the handler-map guard and a flaky harness; implementer removed the local accent override, added plain-English messages for every rejected input, fixed the hub-frame overflow and namespaced harness storage. 106 unit tests, harness 60/60, real-network run; Plinko and the big wheel land where the core decides (18/18). |

## Phase 4 (2026-09-04): Password + Chain Reaction

Ten games in the registry. Process unchanged; new rule from Phase 3 applied from
the start: game agents declare no local palette override, the hub agent adds the
`shared/theme.css` accent block and card art.

| Component | Tester verdict | Notes |
|---|---|---|
| password | **ship** | tester fixed PW-D1 (marks allowed while the Lightning clock was paused); minors (harness storage namespace, damaged-save message, 12 px floor) sent back. | 54 unit tests, harness 74/74, real-network run; both givers' phones carry the password and the host DOM never does; 200 words. |
| chain-reaction | fix-then-ship → fixed | tester fixed a harness that silently stopped at 29 of 52 checks and a clock jump; CR-2 (Speed Chain clock not frozen on save) plus minors sent back. | 57 unit tests, harness 29/29, real-network run; 18 chains + 4 speed chains re-read pair by pair by the implementer. |

## Phase 5 (2026-11-03): four more games, Krillion, cross-cutting round, UI v3

Specs 15–21. Same process. Cross-cutting round (docs/19) applied to all games and
verified (`cross-cutting-verification.md`): `btn-game-lobby` Keep/Resume/Start over
(disabled, not hidden, on setup), the `shared/library.js` set picker with two themed
sets per game and "Download for the library", TPIR prize photos through the Jeopardy
media gate, DoND single-case animation, Chain Reaction phone tile grid. UI v3 (docs/21):
flat stage, hairline surfaces, Inter sentence case, `shared/icons.js`, no card art, no
emoji on host screens, hub rebuilt; per-game passes on every game.

| Component | Tester verdict | Notes |
|---|---|---|
| the-chase | fix-then-ship → fixed | tester fixed a stale-clock restore and host screens on phones; implementer made a Chaser pass a pushback, paused the Chaser clock during pushbacks, sane $0 offers. |
| one-vs-100 | fix-then-ship → fixed | late joiners now seated for the next game; grid overflow and trust-tie notice fixed by the tester; remaining-time clocks on phones. |
| press-your-luck | fix-then-ship → fixed | tester fixed hotkeys mid-spin, editor edits, badge contrast, an ambiguous question; minors + v3 pass with the implementer. |
| match-game | fix-then-ship → fixed | critical: host could not finish the Head-to-Head without phones (implementer's T4 claim was wrong) — fixed with a typed-answer form; room-scoped saves; merge labels; a global-name clash that silently disabled every settings input. |
| krillion | see `krillion-verification.md` | author-rated tiers (Prawn … One in a Krillion), alias matching, judge's review after the 30 s round, Add to this question, editor rated-answer table + Import judged answers, Puffer Party; 100 prompts / 2,493 rated answers. |
| cross-cutting round (10 games) | 8 ship, 2 fix-then-ship → fixed | P-1 Pyramid parked game lost on reload (one line); J-1 Jeopardy lobby button live over an open clue (now disabled while a clue is open); content fixes in Jeopardy, Chain Reaction, Weakest Link and Password sets; hub now passes `?store=` into game frames. |

Lessons: a harness that clears storage before the frame unloads is rewritten by the
outgoing page's save; `.scratch/` is shared between agents, so helper files need a
per-game prefix; `python -m http.server` drops requests under three concurrent browsers.

## Verification pointers

- `node --test` at the repo root runs every suite (shell, shared, all games).
- Browser harnesses: `tests/hub-harness.html`, `games/<id>/tests/harness.html`,
  `games/jeopardy/tests/harness.html`, `games/jeopardy/tests/photo-harness.html`.
- Reports: `shell-*`, `family-feud-*`, `wheel-of-fortune-*`, `weakest-link-*`,
  `jeopardy-embed-*` (implementation + verification each).

## Phase 6 — host phone (2026-11-10)

Spec `docs/22-host-phone-spec.md` (Fable review: `host-phone-spec-review.md`).
Shell (3b0b91f) then all 15 games in three waves (355ed63 + waves 2 and 3).
Independent verification through the real hub and PeerJS room:
`host-phone-verification.md` — verdict **fix, then ship**; the core promise
held in every game (shared screen answer-free before reveal with the host
phone connected and away; 0 of 486 contestant messages carried host data).

| # | Defect | Resolution |
|---|---|---|
| M1 | Match Game kept the host phone's name on a reconciled seat bound to another phone | fixed — `mgUnseat` clears phone-derived names (HP-6b) |
| M2 | Jeopardy kept a former contestant turned host phone on its roster | fixed — `reconcileRoster()` in `gsc-embed.js`; mid-game rows with points stay, unbuzzable, no night credit |
| L1 | Password HP-I5 harness race | fixed — waits on seq + content |
| L2 | Jeopardy has no private fallback while the host phone is away | accepted — spec §6 leaves Jeopardy's shared screen unchanged; Reveal is public as before |
| L3 | Wheel host-card tiles 12.8 px | fixed — 16 px, word-wrapped rows |
| L4 | Weakest Link editor placeholder held a shipped Q/A | fixed — made-up example |
| L5 | Krillion intro had no note/fallback | fixed |
| L6 | Demotion notice named the newcomer | fixed — effect carries `was`, notice names the holder |

Known, accepted: opening a game's editor mid-game shows its content on the
shared screen (Wheel disables the Editor during play; the others clear
answer fields on close). Root suite 1578; 29 browser harnesses green.
