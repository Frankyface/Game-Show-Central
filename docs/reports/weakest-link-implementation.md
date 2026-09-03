# Weakest Link — implementation report

Component: `weakest-link` · Spec: `docs/05-weakest-link-spec.md` ·
Verification plan: `docs/06-verification-plan.md`
Environment: Windows 11 (10.0.22635), Node v24.16.0, Chromium (in-app browser),
2026-09-03. Repo served with `python -m http.server 8620` from the repo root.

**Status: complete and self-verified.** 45/45 unit checks and 46/46 loopback
checks pass; a full four-player game was played host-only in the browser to a
winner, and a five-phone embedded game was played through the harness to a
winner. Integration is against the **real** `shared/bridge.js` (it landed
mid-build) — not a stub.

---

## 1. Files

Everything below is inside `games/weakest-link/`.

| File | Lines | What it is |
|---|---:|---|
| `index.html` | 316 | Host screens + phone screen in one page; `<body data-gsc-game="weakest-link">`, `#gsc-join` present |
| `css/wl.css` | 529 | Black stage, steel, cold-blue spotlight, red goodbye; Anton + Inter; reduced-motion block |
| `css/wl-phone.css` | 117 | Phone controller, 320 px portrait, ≥ 60 px tap targets |
| `js/wl-content.js` | 241 | **PURE (UMD)** — the JSON contract: `validateGame`, `normalizeGame`, `warningsFor`, `buildOrder`, `cleanText` |
| `js/wl-core.js` | 789 | **PURE (UMD)** — `createState`, `reduce`, clock as deadline timestamps, selectors, `phoneView`, `validatePhoneMsg`; re-exports everything from `wl-content.js` |
| `js/wl-app.js` | 737 | Host glue: one serialisable state, `localStorage` (`gsc-wl-state-v1`), rendering, hotkeys, undo, goodbye sting |
| `js/wl-clock.js` | 101 | Clock renderer (rAF + interval safety net). DOM only, writes no state |
| `js/wl-sound.js` | 106 | WebAudio cues behind the shared `gsc-sound` toggle |
| `js/wl-editor.js` | 313 | Question editor + CSV/TSV importer, draft in `gsc-wl-draft-v1` |
| `js/wl-room.js` | 155 | Host glue on `GSC.host` — roster in, masked `phoneView` out |
| `js/wl-phone.js` | 161 | Phone glue on `GSC.player` |
| `js/data.js` | 187 | Offline mirror of `questions.json` (byte-for-byte identical game) |
| `questions.json` | 174 | **160 original questions across 9 categories** |
| `tests/wl-core.test.mjs` | 716 | `node --test` suite, K-U1…K-U10 |
| `tests/harness.html` | 563 | Loopback harness, K-I1…K-I6 |
| `tests/fixtures/harness-game.json` | 66 | 60-question fixture with a 2-second round 1 (clock-expiry test) |
| `README.md` | 148 | Hosting, JSON schema table, phone features, layout |

Largest file 789 lines (limit 800). No file uses `innerHTML`,
`insertAdjacentHTML`, `outerHTML =`, `document.write`, `eval` or
`new Function`; no `console.log` anywhere.

**Question bank.** 160 questions, mixed difficulty, family-friendly, each a
checkable fact, interleaved round-robin so the default (unshuffled) order
rotates through categories: Geography (20), Science & Nature (20), History
(18), Literature (18), Music (18), Film & Television (18), Sport (16), Food &
Drink (16), Words & Language (16).

## 2. How to run it

```bash
# unit tests
cd games/weakest-link && node --test          # 45 pass, 0 fail

# browser
python -m http.server 8620                    # from the repo root
#   host:    http://localhost:8620/games/weakest-link/
#   phone:   http://localhost:8620/games/weakest-link/?room=CODE
#   harness: http://localhost:8620/games/weakest-link/tests/harness.html
```

The harness page prints `All 46 checks passed.` in `#summary.ok` and exposes
`window.__WL_HARNESS__ = {total, failed, uncaught, results}` for automation.
Each `#results li` carries `data-pass="true|false"` per 06 §1.

## 3. Unit results (T1) — K-U1 … K-U10

`node --test` → **45 tests, 45 pass, 0 fail**.

| ID | Result | Evidence |
|---|---|---|
| **K-U1** `validateGame` | PASS | Accepts the shipped file (asserts ≥ 160 questions, ≥ 8 categories); rejects 39 questions (`/at least 40 questions/`), a non-increasing chain, `finalPlayers: 3`, an empty answer (`Question 8 has no answer`), `roundSeconds` containing 0, plus `finalQuestionsEach: 0`, `finalMultiplier: 9`, a 7-char currency and a 900-second round. A separate test asserts `js/data.js` deep-equals `questions.json`. `normalizeGame` fills defaults and leaves a deep-frozen input untouched. |
| **K-U2** chain | PASS | Correct climbs 1000 → 2500; wrong resets to 0; `bank` moves the chain into the round bank, resets the chain, credits `stats[pid].banked` and does **not** change the turn or burn a question; banking 0 is ignored; eight corrects auto-bank 125,000 and end the round when `topOfChainEndsRound` is true, and keep playing (capped at the chain top) when it is false. |
| **K-U3** clock | PASS | `clockStart` at `now=1000` sets `deadline=151000`; `clockPause` at 41000 leaves `remainingMs=110000`; resuming re-bases the deadline. After `clockExpired`, `expired` is true, the phase is still `round`, a second `clockExpired` is a no-op, and judging the in-flight question ends the round: total 2500 (banked) with the 1000 left on the chain lost. |
| **K-U4** turn order | PASS | Rotation `p1,p2,p3,p4,p1`; after p3 is voted off, rotation is `p1,p2,p4,p1`; round 2 starts with the previous round's strongest link and `clock.remainingMs` is 140000. |
| **K-U5** statistics | PASS | Strongest = most correct → most banked → fewest wrong (table-driven, full ranking asserted); weakest = fewest correct → least banked → most wrong; finished rounds are read from `roundHistory`. |
| **K-U6** voting | PASS | Self-votes and votes for non-players ignored; a voter may change their mind; votes lock once the reveal starts; `revealVote` is refused at 3/4 votes and reveals one at a time; a clear majority sets `eliminatedPid` and `eliminate` moves them to `eliminated`; a 2-2 tie goes to `tiebreak` with `tied` = the tied targets in seat order, `tiebreakPid` = the strongest link, and `breakTie` refuses an untied target. |
| **K-U7** final | PASS | Round 2's 5,000 bank is tripled (`finalBonus` 10,000, total 17,500); `finalMultiplier: 1` leaves it alone; `finalFirst` refuses a stranger; turns alternate `p2,p1,p2,p1…`; the higher correct count wins; 3-3 goes to sudden death led by the first player, two level pairs continue, a split decides it; `finalQuestionsEach: 2` is honoured. |
| **K-U8** question pool | PASS | The same seeded rng gives the same `buildOrder` twice and it is a permutation of the identity order; questions are drawn in file order and banking does not burn one; the 40th judgement wraps `qIndex` to 0, sets `repeating: true` and sets the "Questions are repeating" notice. |
| **K-U9** undo / immutability | PASS | `undo` deep-equals the previous state, unwinds several steps in order, and is a no-op with nothing to undo; 15 illegal/unknown events (wrong phase, missing fields, `null`) return the identical object; a deep-frozen state and event survive every event type and a whole round. |
| **K-U10** phone boundary | PASS | `validatePhoneMsg` accepts only `vote`/`tiebreak` with a clean short `target` (12 junk payloads rejected, control characters stripped); `canVote` is false outside `voting` and for eliminated voters/targets; `phoneView` for a waiting player contains neither the question nor the answer; the vote view carries `myVote`, `castCount`, `voterCount` and choices excluding self, and has **no** `votes` map; the eliminated phone gets `goodbye` then `out`; only the strongest link gets `tiebreak`; everyone gets `result`. |

## 4. Loopback results (T2) — K-I1 … K-I6

`tests/harness.html` **is** the shell (06 §3): it loads
`../index.html?embed=host&harness=1&game=tests/fixtures/harness-game.json` plus
five `?embed=player` iframes and speaks the 00 §6 bridge protocol itself — no
PeerJS, no hub. It re-fetches every asset with `cache:"reload"` first
(Jeopardy's stale-bundle guard). **46 checks, all pass.**

| ID | Result | Evidence (from the harness's own detail lines) |
|---|---|---|
| **K-I1** round, hotkeys, clock, reload | PASS (9 checks) | Shell roster becomes the team `Ada,Ben,Cleo,Dev,Eve`; the round screen shows `Harness question 0?` with the answer hidden; `Space` twice → `chain 2500`; `B` → `$2,500`; `X` → `Cleo wrong=1, turn=Dev`; the clock is started, the host iframe is reloaded mid-round and comes back **paused** — `clock 0:02 -> paused with 1285ms of 2000ms, bank $2,500` — with the round stats intact; the clock then expires and adds exactly **1** state step (`1 state step(s) after expiry; notice: Time is up — judge this question, then the round ends.`); judging the in-flight question ends the round with `total 2500`. |
| **K-I2** secret voting | PASS (14 checks) | Every phone gets `vote` with itself off the ballot (`Ben,Cleo,Dev,Eve` for Ada) and no question/answer text in the payload; one phone vote arrives as `Votes in: 1/5` with exactly one `•••` marker, **no** name on the stage and every host dropdown blank; another phone sees only `1/5 in, own vote null`; a phone re-votes and the change lands; the host types the last two votes by hand; Reveal unlocks only at 5/5; the statistics panel names both links with numbers (`strongest Ada (1 right · 0 wrong · $0 banked) · weakest Eve`); `Reveal a vote` reveals one row at a time (first revealed target `Eve`); the last reveal names the majority (`Eve has 3 votes.`); `eliminate` raises the full-screen goodbye card reading `Eve`; that phone flips to "You are the weakest link", then to `out` with 5 standings rows. |
| **K-I3** tie → strongest link | PASS (4 checks) | A 2-2 tie stops the elimination: `It is a tie between Ben and Cleo. Ada was the strongest link and decides.`; only Ada's phone switches to `tiebreak` and its ballot is exactly `Ben,Cleo` while another phone stays off it; **tapping Ben on Ada's phone resolves the tie** (`eliminatedPid` = Ben); the host's equivalent buttons are on screen. |
| **K-I4** final to a winner | PASS (6 checks) | The last full round's bank is tripled on the splash (`bank $12,500, bonus 5000`) and `finalBonus === lastRoundBank * 2`; both finalists' phones show the two-row head-to-head tally; a level head-to-head shows `Sudden death` (`2 each — sudden death.`); a split pair produces a winner and the total matches `WlCore.formatMoney(core.total)` (`Ada wins $12,500`); **all five phones**, in or out, land on `result`; the host reports a 5-row `scores` frame up to the shell. |
| **K-I5** editor | PASS (6 checks) | Three pasted lines → three rows; a tab line and a `"Cities, plural",…` quoted-CSV line both parse correctly; the count badge reads `3` with the `warn` class and `Only 3 questions — a 6-player game uses ~150.`; Download refuses with `This game needs at least 40 questions — it has 3.`; Reset restores 160 with the warning cleared; **Use in game** validates, closes the editor and the setup screen reads `160 questions loaded.` |
| **K-I6** static gates | PASS (7 checks) | All 17 source files served; **V2** every file < 800 lines (largest `wl-core.js`); **V3** zero `innerHTML`/`document.write`/`eval`; **V4** zero `console.log`; **V6** the only external URLs in `index.html` are Google Fonts; **V7** `data-gsc-game="weakest-link"` and `#gsc-join` present; **V8** `questions.json` validates through the same `validateGame`. |

## 5. Standalone play (T4) — host-only, no phones

Played in the in-app browser at `http://localhost:8620/games/weakest-link/`,
four players (Ada, Ben, Cleo, Dev) added by hand, to a winner:

- **Setup** — `160 questions loaded.`, players tagged `host`, Start enabled at 3.
- **Round 1** — clock `2:30`, chain ladder lit at `$1,000`, spotlight on Ada with
  "In which ocean is the island of Madagascar?" and the answer hidden. `Start
  clock` counts down (`1:19 → 1:17` observed). Hotkeys verified individually:
  `Space` twice → chain `$2,500`; `B` → `Round bank $2,500` credited to the
  banker with the turn unchanged; `X` → wrong, turn advances.
- **Reload mid-round** — page reloaded; came back on the round screen with the
  clock **paused at 78 s** of 150 s, bank `$2,500`, turn preserved.
- **Voting** — `Votes in: 4/4 · Team total $2,500`, all four rows showing `•••`
  and a blank `change vote` dropdown. Statistics: strongest `Ada — 1 right · 0
  wrong · $0 banked`, weakest `Dev — 0 right · 0 wrong · $0 banked` (the
  documented tie-break order: correct count first, then banked). `Reveal a vote`
  revealed Ada→Dev then Ben→Dev one at a time.
- **Tie** — 2-2 produced `It is a tie between Ben and Dev. Ada was the strongest
  link and decides.` with two red buttons; clicking Dev eliminated him and the
  full-screen red **"DEV / YOU ARE THE WEAKEST LINK. GOODBYE."** card played.
- **Rounds 2–3** — round 2 started with the strongest link, clock 2:20; down to
  Ada and Ben.
- **Final** — splash `THE BANK IS MULTIPLIED / $15,000` (last round's $5,000
  tripled) with "Ada was the strongest link and chooses who answers first";
  five questions each with the 5-dot tally; 3-3 → `Sudden death` (`3 each —
  sudden death.`); a split pair gave **Ada wins $15,000** with the standings
  `1. Ada · 2. Ben · 3. Cleo — voted off · 4. Dev — voted off`.
- **Standalone phone mode** — `?room=ABCD` renders the SDK's join card inside
  `#gsc-join`, hides all host chrome (`player-mode`), and shows the phone card
  reading "Waiting for the host…".

## 6. Phone integration status

**Verified against the real SDK.** `shared/bridge.js`, `room-protocol.js`,
`room-net.js`, `room-host.js` and `room-player.js` landed while this component
was being built; `index.html` loads all five before the game scripts, and both
`wl-room.js` (on `GSC.host`) and `wl-phone.js` (on `GSC.player`) run against
the real `window.GSC`. A short-lived local fallback shim was deleted once the
real SDK was present, so there is no stub left in the tree.

What is proven and what is not:

| Mode | Status |
|---|---|
| `embed-host` + `embed-player` (bridge postMessage) | **Verified** — 46/46 harness checks, five phones, a whole game to a winner. |
| `standalone-host` (no room opened) | **Verified** — the whole game plays host-only; the room controls report "Closed — the host can enter every vote instead." |
| `standalone-player` (`?room=CODE`) | **Partly verified** — the SDK's join card renders in `#gsc-join` and the phone card renders; no broker connection was attempted. |
| `standalone-host` with a real PeerJS room (T3) | **Not attempted** — real-broker/WebRTC testing is the tester's T3 tier and needs the hub shell; nothing here was faked as passing. |

Message contract (spec §5), enforced in `wl-room.js`:

- Phone → host: only `{t:"vote",target}` and `{t:"tiebreak",target}`. Every frame
  goes through `WlCore.validatePhoneMsg` (shape, type, 24-char cap, control-char
  stripping) and then `WlCore.canVote` / an explicit `tiebreakPid` check before
  it reaches the reducer. Junk is dropped silently; nothing throws.
- Host → phone: one `{t:"view", …}` per phone, built by `WlCore.phoneView`,
  de-duplicated so an unchanged view is not re-sent. It never contains the
  question, the answer, another player's vote, or the vote map.
- Masking: the host stage shows `•••` plus `Votes in: n/m` until the reveal; the
  host's override dropdown is deliberately left on its blank option even when a
  vote has arrived, and is replaced by the name only once that row is revealed.

## 7. Spec deviations, with reasons

1. **The pure core is two files, not one.** `wl-core.js` alone came to 977
   lines, over the hard 800-line rule in `CLAUDE.md`. The JSON contract
   (`validateGame`, `normalizeGame`, `warningsFor`, `buildOrder`, `cleanText`)
   moved to `js/wl-content.js` (241 lines); `wl-core.js` (789) requires it in
   Node, reads `window.WlContent` in the browser, and **re-exports every symbol**
   — so callers and tests still only touch `WlCore`. Spec §7's file list gains
   one entry.
2. **The clock renderer has an interval safety net.** Spec §4 asks for a
   `requestAnimationFrame` renderer; `wl-clock.js` is that, plus a 250 ms
   `setInterval` painting the same function. rAF stops in a background tab (and
   in the headless preview pane, where it delivered 0 frames), which would
   freeze the clock and mean `clockExpired` never fired for a host who tabbed
   away. The "already expired" latch still guarantees exactly one `onExpire`.
   No timer handle goes near the state object.
3. **The host's vote dropdown never displays the vote before the reveal.**
   Spec §3 says the host "can enter/override any vote via a per-player
   dropdown" — it still can — but a `<select>` sitting on a screen-shared stage
   with the answer selected defeats the secret ballot, so it stays on its blank
   option (labelled `change vote` once a vote is in) and the dots carry the
   "a vote arrived" signal.
4. **The head-to-head always plays all `finalQuestionsEach` questions.** It does
   not stop early when the result is already mathematically decided. Spec §1
   says "five questions each" and does not ask for an early exit.
5. **`createState` accepts 2 players; the setup screen requires 3.** The format
   is 3–12 (enforced in the UI and in `wlStart`); the core's floor is 2 so a
   head-to-head can be constructed directly in tests. Commented in the source.
6. **`strongestLink`/`weakestLink` take an optional third `pool` argument.** The
   spec signature is `(state, roundIndex)`; the extra argument restricts the
   ranking to the players still in the game, which is what the tie-break and the
   "strongest link starts the next round" rule need. Omitting it ranks everyone.
7. **The voting screen also shows the running team total** next to the counter,
   and switches to just the total once someone has been voted off (otherwise
   "4/3" would count the departed voter). Small addition, not a change.
8. **One extra test fixture**, `tests/fixtures/harness-game.json`, exists so the
   harness can exercise a real 2-second round clock rather than waiting 150 s.
9. `js/wl-sdk-fallback.js` existed briefly while `shared/` was empty and has
   been **deleted** now that the real SDK is present — noted only so nobody
   looks for it in an earlier draft.

## 8. Known gaps

- **T3 (real PeerJS broker, two tabs) was not attempted.** It needs the hub
  shell and is the tester's tier. Nothing was recorded as passing for it.
- **Sound was not heard.** WebAudio needs a user gesture and the automated pane
  produces no audio; the cue code paths run (they are called from the judge,
  bank, goodbye, round-end and win paths) but were verified by reading, not by
  listening. The 🔊 toggle persists to the shared `gsc-sound` key.
- **No screenshot files under `docs/reports/img/`.** The browser tooling here
  returns images inline rather than writing files, so the evidence above is DOM
  text and the harness's own PASS list. Every screen was inspected visually
  (setup, round, voting with masks, statistics, tie panel, goodbye card, final
  splash, head-to-head, winner, standalone phone join).
- **Players who join mid-game spectate** until the next game starts; the host
  sees a plain-English notice. A reconnecting phone that is already in the game
  is recognised and does not raise that notice.
- **`prefers-reduced-motion`** is honoured with a CSS block that neutralises
  every animation and transition; it was not exercised under an emulated
  reduced-motion setting.
- `wl-core.js` is 789 lines — close to the limit. Anything substantial added to
  the reducer should move the head-to-head into its own pure file.

## 9. Notes for the tester

- Start from a clean slate: the page persists to `gsc-wl-state-v1` and the
  editor to `gsc-wl-draft-v1`, and it saves on `beforeunload`, so
  `localStorage.clear()` immediately followed by a reload will be undone by the
  unload save. Clear the two keys **and** reset in place
  (`WlApp.set({core:null, setup:{players:[],shuffle:false}})`) before reloading.
- The `Space` hotkey needs a real key event (`key: " "`); some automation sends
  an empty `key`, in which case the handler correctly ignores it. `X` and `B`
  work with plain synthetic keys. A focused `<button>` deliberately suppresses
  the hotkeys so a click is never counted twice.
- `window.WlApp` (`state`, `core`, `dispatch`, `render`, `useGame`, `subscribe`),
  `window.WlEditor` and `window.WlPhone` are the intended automation surfaces.
