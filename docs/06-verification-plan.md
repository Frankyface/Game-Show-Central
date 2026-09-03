# 06 — Verification plan (all components)

Status: **approved** · Applies to: shell, jeopardy-embed, family-feud,
wheel-of-fortune, weakest-link. Success states live in each spec's last
section; this document says how they are checked and reported.

## 1. Tiers

| Tier | What | How |
|---|---|---|
| **T1 Unit** | pure cores, validators, reducers, transport with fakes | `node --test` in the component folder (root for shell/shared). Node ≥ 18 (we have 24). Zero deps. |
| **T2 Loopback** | real UI + real scripts, fake transport, scripted scenarios | `tests/harness.html` (per component) served from `python -m http.server 8620` at the repo root; PASS/FAIL list in `#results li[data-pass]`; `#summary.ok` when all pass. |
| **T3 Real network** | two browser tabs, real PeerJS broker + WebRTC | manual/automated via the in-app browser: host tab + phone tab on `http://localhost:8620/`. If the environment blocks the broker or WebRTC, record **BLOCKED-ENV** with the exact console error — never fake a pass. |
| **T4 Regression / standalone** | Jeopardy standalone unchanged; every game playable host-only; every game standalone with one phone | scripted click-through + upstream Jeopardy tests/harnesses. |
| **T5 Static gates** | see §4 | shell greps + line counts. |

## 2. Shell-specific harness notes

`tests/hub-harness.html` loads the real `index.html` scripts in two iframes
(one as host, one as phone) and connects them with an in-page fake
`peerFactory` (a pair of fake `Peer` objects that hand each other fake
`DataConnection`s; messages delivered on `setTimeout(0)`). `tests/fake-game.html`
is a tiny game page built on the SDK that echoes `msg` back as `send` and
renders `init` data into the DOM so the harness can assert on it. The
VirtualPeer unit tests use a fake `postMessage` pair in Node (`globalThis
.window` shims kept inside the test file).

## 3. Game harness pattern

Every game's `tests/harness.html` loads the game page in an iframe with
`?embed=host&harness=1` and N iframes with `?embed=player&harness=1&pid=pN&name=…`.
The harness page **is** the shell for them: it implements the bridge
protocol from 00 §6 directly (post `init`, route `send`↔`msg`) — no PeerJS.
Scenarios click real buttons in the host frame and real buttons in the phone
frames and assert on DOM text. Each success-state id becomes one list item.
Harnesses reload with `cache:"reload"` fetches first (Jeopardy's stale-bundle
guard) — copy the pattern from `games/jeopardy/tests/photo-harness.html`.

## 4. Static gates (every component)

- **V1** the component's `node --test` exits 0.
- **V2** every file < 800 lines; functions > ~50 lines carry a justification comment.
- **V3** `rg -n "innerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write|eval\(|new Function" <component>` → zero matches (excluding `tests/`? **no** — tests too).
- **V4** `rg -n "console\.log" <component>/js <component>/shared` → zero.
- **V5** no `Peer`/connection/DOM/timer handle inside anything passed to `setState` (code read).
- **V6** every external URL in the component is the pinned PeerJS cdnjs URL or Google Fonts (`rg -n "https?://"`).
- **V7** every game page has `<body data-gsc-game="…">`, the `#gsc-join` container in player mode, and `player-mode`/`gsc-embedded` body classes wired.
- **V8** `?game=URL` and file upload paths validate through the same `validateGame` (code read + one harness check).

## 5. Tester deliverable

Write `docs/reports/<component>-verification.md`:

1. Environment (OS, Node, browser, date).
2. A table: **ID · PASS / FAIL / BLOCKED-ENV · evidence** (test output lines,
   DOM text, screenshot file under `docs/reports/img/` for E-states).
3. Defects: severity (**critical** = blocks play or corrupts state / **major**
   = a documented feature doesn't work / **minor**), `file:line`, repro, and
   whether you fixed it. Testers **fix only trivial (< 5 lines) defects**
   themselves and note the diff; everything else goes back to the implementer
   (the orchestrator will dispatch it) — do not redesign.
4. A one-paragraph verdict: ship / fix-then-ship / not ready.

Severity guide for the orchestrator's triage: a critical anywhere blocks the
merge of that component; majors are fixed before release; minors are listed
in the README "known issues" if not fixed.
