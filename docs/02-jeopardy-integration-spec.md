# 02 — Jeopardy inside the hub

Status: **approved for implementation** · Component id: `jeopardy-embed`
Owns: `games/jeopardy/**` only. Upstream: `Frankyface/Jeopardy` at the commit
in `games/jeopardy/UPSTREAM_COMMIT` (vendored copy, no submodule).

## 1. Goal

Jeopardy runs inside the hub with **zero regression** for its standalone use
(`games/jeopardy/index.html` opened directly must behave byte-for-byte like
the upstream repo, including its own buzzer rooms with the `ghj-` prefix) and
**full phone features** when embedded (buzzers, early-buzz lockout, Daily
Double wagers, Final wagers/answers, timers), using the hub's shared room.

## 2. Approach: the virtual peer (see 00 §8)

Add ONE new script, `games/jeopardy/js/gsc-embed.js`, loaded **first** in
`index.html` (before `data.js`), plus `../../shared/bridge.js` and
`../../shared/virtual-peer.js` before it. When the page is embedded
(`?embed=host|player`):

1. Install `window.peerjs = { Peer: VirtualPeer }` so `loadPeerJs()` resolves
   immediately and `createPeer` / `new window.peerjs.Peer` get the shim.
2. Add `gsc-embedded` to `<body>`.
3. **Host (`embed=host`)**: after `BuzzerHost` boots, open the room with the
   shell's code (`GSC.params.room`). Expose whatever tiny public method is
   needed on `BuzzerHost` (e.g. `BuzzerHost.openWithCode(code)`) — a minimal,
   clearly commented edit in `buzzer-host.js`. The setup-screen room panel
   shows "Room {CODE} — managed by Game Show Central" instead of Open/Close
   buttons; the topbar chip still works (kick stays useful). The player join
   note ("Playing on your phone?") is hidden when embedded.
   Add a `⌂ Lobby` affordance? **No** — the shell bar provides it. Do not add
   host chrome.
4. **Phone (`embed=player`)**: Jeopardy's player mode already triggers on
   `?room=`. Prefill the name from `GSC.params.name` and **auto-join**
   (programmatically run the same `join()` path) so the player never sees the
   Jeopardy join card; hide the header code chip and "Leave room" footer via
   `body.gsc-embedded` CSS (add `css/gsc-embed.css`, don't grow `buzzer.css`).
   Show the Jeopardy buzzer screen exactly as today.
5. Scores: after every scoreboard change, if embedded, call
   `GSC`'s host `reportScores` with `[{pid, score}]` where pid comes from the
   virtual connection that joined with that name (map name → pid in
   `gsc-embed.js`; manual/unlinked players are reported with `pid:null` and
   their name). Optional-chain everything so standalone is untouched.
6. `GSC.host().exit` is never called by Jeopardy (shell bar handles it).

Allowed edits to upstream files: `index.html` (script/link tags + at most
two `class`/`hidden` hooks), `js/buzzer-host.js` (expose open-with-code,
suppress Open/Close buttons when embedded), `js/buzzer-player.js` (auto-join
when a name is supplied and embedded), `js/app.js` (one `reportScores` hook,
optional-chained). Every edit is marked `// GSC:` and keeps the file under
800 lines. Nothing else changes. `README.md` in the folder gets a short
"Inside Game Show Central" section at the top.

## 3. Behaviour details

- Existing players when Jeopardy starts: the shim fires one `connection` per
  connected player; their phone's Jeopardy frame auto-joins with their name →
  scoreboard players get created with those names (Jeopardy's relink-by-name
  rule). Manual (phone-less) lobby players are **also** added to the
  scoreboard (from `init.room.players` where `connected:false && manual:true`)
  so they can be scored by hand.
- Late joiner: `player-join` → `connection` → auto-join → new scoreboard player.
- Phone `status:false` → the shim emits a network error to the player
  Jeopardy code, which shows "Reconnecting…"; `status:true` → reconnect
  resolves at once. The Jeopardy host code never sees a drop (the shell's
  connection map is authoritative); stale 🔴 markers come from Jeopardy's own
  ping/pong heartbeat, which still flows through the pipe. That is fine.
- Jeopardy's saved state (`gh-jeopardy-state-v1`) continues to persist; the
  saved `buzzer.roomCode` in embedded mode is the shell's code. Jeopardy's
  auto-reopen on reload works through the shim.
- Kick from Jeopardy's chip → virtual `conn.close()` → bridge `close` → that
  phone's frame gets `conn-close` → its Jeopardy player reconnects (over the
  shim) and re-joins immediately. Acceptable; the real kick lives in the
  shell. Document it.

## 4. Success states

Regression (T4 — must stay green):

- **J-R1** `cd games/jeopardy && node --test` → all upstream tests pass (49 at vendoring time).
- **J-R2** `games/jeopardy/index.html` opened standalone over a local server: start screen identical, no `gsc-embedded` class, PeerJS still lazy (no network request for peerjs until "Open buzzer room"), `tests/harness.html` (upstream loopback) green, `tests/photo-harness.html` green.
- **J-R3** Standalone buzzer room still uses the `ghj-` prefix and real PeerJS.

Embedded (T2 loopback via the hub harness with the real Jeopardy page in the iframes, and T3 real network):

- **J-E1** Host opens the hub, 2 phones join, host picks Jeopardy → both names appear on the Jeopardy scoreboard automatically, phones show the Jeopardy buzzer screen without a join card.
- **J-E2** Open a regular clue → phones go red; early tap → "Too soon" lockout on that phone, host bar lists them; arm (Space) → green; first tap wins; ✓ scores; ✗ locks + re-arms.
- **J-E3** Daily Double with a phone player selected → wager pad on that phone; out-of-range wager bounced; accepted wager locks the DD.
- **J-E4** Final Jeopardy → secret wagers from phones (masked on host), typed answers land in judge rows, verdicts show on phones.
- **J-E5** Timers: answer timer runs on host + buzzed phone; Final timer on all phones.
- **J-E6** `⌂ Lobby` then pick Jeopardy again → the board, scores and used tiles are exactly where they were (state persisted); phones get the buzzer screen again.
- **J-E7** Late joiner mid-board → appears on the scoreboard, phone gets the buzzer screen in `idle`.
- **J-E8** A manual (phone-less) lobby player is on the scoreboard and scorable.
- **J-E9** Night scoreboard in the hub reflects Jeopardy scores after a ✓ (SHOULD).
- **J-E10** No `innerHTML` added; every edited file < 800 lines; every edit carries a `// GSC:` marker; `git diff --stat` vs upstream lists only the allowed files plus the new ones.
