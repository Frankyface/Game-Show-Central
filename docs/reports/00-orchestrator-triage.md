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

## Phase 2 (same day): Millionaire + UI upgrade

Same process: spec first (`docs/08-millionaire-spec.md`, `docs/09-ui-upgrade-brief.md`),
one implementer per surface, independent testers, defects back to owners.

| Component | Tester verdict | Notes |
|---|---|---|
| millionaire | **ship** | 67 unit tests (34 adversarial), harness 55/55, real-network hub run incl. Fastest Finger and Ask the Audience; all 45 questions fact-checked; six minors closed afterwards (phone vote countdown, Switch-the-Question notice, docs). Safe-haven rule clarified to the TV rule: a haven counts once its question is answered correctly. |
| ui-upgrade (hub + 5 games) | see `ui-upgrade-verification.md` | Design system v2 in `shared/theme.css` + `shared/theme-components.css` (`docs/design-system.md`); CSS-only upgrade per game (Jeopardy via a new `gsc-look.css`, no JS); every game harness green before and after; game-switch splash (games skip theirs when embedded). |

UI rules learned: both stops of a gradient under text must clear contrast; every
`@keyframes`/`animation:` lives inside `prefers-reduced-motion: no-preference`;
CSS `filter` cannot transition from `none`; harness asset lists must name new
stylesheets or they go ungated.

## Verification pointers

- `node --test` at the repo root runs every suite (shell, shared, all games).
- Browser harnesses: `tests/hub-harness.html`, `games/<id>/tests/harness.html`,
  `games/jeopardy/tests/harness.html`, `games/jeopardy/tests/photo-harness.html`.
- Reports: `shell-*`, `family-feud-*`, `wheel-of-fortune-*`, `weakest-link-*`,
  `jeopardy-embed-*` (implementation + verification each).
