# Host phone — verification through the real hub (docs/22 §7 step 3)

Tester run, 2026-11-10. No code was changed and no git command was run.

**Verdict: fix, then ship.** The core promise holds in every game:

- The shared laptop screen never showed an answer before its public reveal, with the host phone connected and with it away.
- The contestant phones never received a host payload. That is 0 of 486 messages captured on the wire across all 15 games.
- The host phone always showed the right secret.

Two games fail the seat-reconciliation requirement (§5.6): Match Game and Jeopardy. Both are small and local fixes. The rest are low-severity polish items.

## How it was run

- **Server.** A Node static server on 127.0.0.1:8790 (`.scratch/hpt-serve.mjs`).
- **Browsers.** Headless Chrome over CDP, one Chrome process with its own profile per device, so each had separate storage. The controller is `.scratch/hpt-ctl.mjs`, driven step by step with `.scratch/hpt-c.mjs`. The helpers are `.scratch/hpt-*.js|sh`.
- **Devices:**
  - The laptop: hub at `/?store=hpt`, 1280×720.
  - The host phone "Hana": `/?room=CODE`, 320×640, mobile emulation.
  - A contestant phone "Cole": the same setup as Hana.
  - Later a second contestant "Dex", and two impostor devices.
- **Room.** Everything went through the real PeerJS broker, room `DWC4`.
- **Wire capture.** On every phone, `RTCPeerConnection.prototype.createDataChannel` was wrapped before the page loaded. Every inbound frame was decoded to text, so check (b) is made on what actually crossed the network, not on what the page chose to render.
- **Host-view capture.** On the laptop, a `message` listener recorded every `host-view` the game frame posted to the hub.
- **Leak scan** (`T.scan` in `.scratch/hpt-lib-host.js`). It searched the game frame's document and the hub document:
  - every text node, visible or hidden;
  - every `.value` and every `<option>`;
  - the attributes `placeholder`, `title`, `alt`, `aria-label` and `data-*`;
  - `document.title` and the shell subtitle (`setTitle`).

  Matching is case-insensitive at word boundaries, so "Au" does not match "audience". Every hit was reviewed by hand. Hits on static copy, such as "Four" in "two to four players", are reported as false positives.
- **Host phone "locked" (check d).** I froze all JavaScript on the host-phone tab (CDP `Debugger.pause`), which is what a locked phone does. The hub flagged it away after **23–35 s**. Force-closing the tab (used for Chain Reaction) was flagged in about 33 s.
- **Restore (check e).** I unfroze the tab, or reopened it in the same profile. Both rejoin with the stored pid and host key.
- **Host-phone layout (check a).** Measured inside the game frame at 320 px:
  - `scrollWidth`;
  - the smallest computed font on any visible text;
  - the font size of the answer;
  - every visible control (`button`, `input`, `select`, `textarea`, `a[href]`).
- **Seat reconciliation.** Before granting the role, Hana played as a contestant: I opened all 15 games with Hana and Cole seated, then went back to the lobby. After the grant, I checked each game's setup on its next open.

## Per-game results

Key: ✓ pass · ✗ fail · ⚠ pass with a low-severity note · n/a = not applicable by the §6 row.

| Game | Secret tested | (a) host phone | (b) contestant | (c) shared screen | (d) away + fallback | (e) restore | Seat reconcile |
|---|---|---|---|---|---|---|---|
| Jeopardy | Open clue "What is Mars?", next clue "What is Paris?" | ✓ 30 px answer, 320 px, no buttons | ✓ | ✓ on visible text (the response is in the hidden modal DOM, accepted by §6) | n/a: no note and no fallback (§6 "Unchanged"); still clean while away ⚠ L2 | ✓ | **✗ M2** |
| Family Feud | Round 1 survey (5 answers); Fast Money | ✓ 28 px | ✓ | ✓ | ✓ fallback lists the round's answers and clears on round 2 | ✓ | ✓ |
| Wheel of Fortune | Toss-up "THE JUNK DRAWER", next "GAME SHOW CENTRAL" | ⚠ L3: board tiles 12.8 px | ✓ | ✓ editor disabled in play | ✓ "Answer: THE JUNK DRAWER", cleared on the next round | ✓ | ✓ |
| Weakest Link | "The Indian Ocean", next "Au", "1945" | ✓ 30 px | ✓ | ⚠ L4: hidden editor placeholder holds a built-in Q/A | ✓ fallback, cleared on Correct | ✓ | ✓ |
| Millionaire | FFF order "C A B D"; hot seat "C — Lemon" | ✓ 30 px | ✓ | ✓ the four options are identical (class, `data-*`, colour) | ✓ "Correct answer: C — Lemon", cleared on question 2 | ✓ | ✓ |
| The Price Is Right | Row "Leather recliner $739" (matches `prizes.json`); Cliff Hangers $29 / $17 / $46 | ✓ 32 px | ✓ | ✓ | ✓ "Actual retail price: $739", cleared after the row | ✓ | ✓ |
| Pyramid | "Between the Tides", 7 words, current "Seashell" | ✓ 32 px | ✓ the giver's phone holds only its current word | ✓ "Words are on your host phone" | ✓ fallback shows "Seashell" only, cleared on "Got it" | ✓ | ✓ seat cleared |
| Deal or No Deal | Pending offer $18,000 (band $17k–$19k) | ✓ 44 px | ✓ | ✓ the offer is absent until the call; no sealed case carries its amount | n/a: no fallback by design (§6 "No change"); clean while away | ✓ the phone then shows the announced $17,000 | ✓ |
| Password | "Umbrella", next "Whisper"; Lightning words | ✓ 38 px | ✓ the giver's phone holds only the current word | ✓ | ✓ fallback, cleared on Next word | ✓ | ✓ |
| Chain Reaction | Frontier "SHIP", hidden SHAPE / UP / TOWN / HALL / WAY | ✓ 32 px | ✓ | ✓ | ✓ (tab force-closed) "The word is SHIP", cleared on the next word | ✓ tab reopened | not exercised (Hana was never on a team) |
| The Chase | Cash Builder "Eight", next "Green"; head to head | ✓ 30 px | ✓ | ✓ (one hidden editor example happens to contain "Green") | ✓ fallback, cleared on Correct | ✓ | ✓ |
| 1 vs 100 | "C — Seven", next "B — Paris" | ✓ 30 px | ✓ | ✓ the options are identical | ✓ "Answer: C — Seven", cleared on Play on | ✓ | ✓ |
| Press Your Luck | "B — Four", next "B — Five" | ✓ 30 px | ✓ | ✓ the options stay covered | ✓ "Answer: B — Four", cleared on Next question | ✓ | not exercised (Hana was never seated) |
| Match Game | Hint "kitchen / bathroom", a panel answer from a phone | ✓ 28 px | ✓ | ✓ | ✓ fallback shows the hint, cleared on Different prompt | ✓ | **✗ M1** |
| Krillion | The "Name a board game" rated list (24 answers) and Cole's answer with its tier | ✓ 28 px | ✓ | ✓ | ✓ fallback shows the list, cleared on the next prompt (⚠ L5: intro phase) | ✓ | ✓ (also a running game) |

### Special rules, spot-checked

**The Chase, head to head with the host playing the Chaser.** The host view had `correct:null, withheld:true` and the phone showed no "Correct".

| Moment | `correct` in the host view | Host phone |
|---|---|---|
| Before either lock | `null` (`withheld:true`) | no "Correct" mark |
| After only the contestant locked | `null` (`withheld:true`) | no mark |
| After the Chaser locked | `1` | "B Red Correct" |

**Pyramid giver panels.** While Cole was the giver with a connected phone:

| Moment | Shared screen |
|---|---|
| Cole's phone connected | "Words are on your host phone"; no "Show words to me" or Study |
| Cole's phone frozen (away) | "Show words to me" and "Study (10 s)" came back |
| Cole's phone back | Both were removed again |

**Password.** The same rule held in practice: after the roles swap, both givers were phone-less manual players, and the giver panel was offered as F6 says.

**Family Feud, Fast Money.** Every picker read `Pick the answer number… | Answer 1 | … | Answer N | No match → 0`. Option values are unchanged. No survey text was anywhere on the shared screen.

**Deal or No Deal.**
- All 20 sealed cases carry only `data-n` and "Case n" in their text and attributes. There is no amount attribute anywhere.
- The host view has no case-to-amount mapping.
- The offer appeared on the laptop only after "The banker is calling".

**Host phone "Reconnecting".** I froze the laptop for 38 s. The host phone dimmed its card to opacity 0.55 and showed "Reconnecting — this may be out of date". It cleared on resume. Screenshot: `.scratch/hpt-hp-stale.png`.

## Hub-level checks

| Check | Result |
|---|---|
| Grant from the lobby roster ("Make host phone") | ✓ The roster row shows the "Host phone" tag and a "Make player" button. The count reads "1 player + 1 host phone · 2/12". Tile hints count contestants only (Feud still says "plays best with 2+"). |
| Key isolation | ✓ The `role` envelope with `hk` went to Hana only. Cole received 0 `role` messages and no `hk` all night. No lobby snapshot carries a key. |
| Amber Host header | ✓ Amber "Host" tag; "Host phone — Hana"; the second-screen text; `body.phone-host`. In a game, the amber strip reads "Host phone · keep this screen to yourself". Screenshot: `.scratch/hpt-hp-waiting.png`. |
| Host phone not in game rosters | ✓ Contestants only in every game's setup and `players()`. The shell chip reads "1 connected", and "Host phone ●/○" sits beside it. |
| Role survives a host-phone reload, and a tab close then reopen | ✓ (lobby reload; mid-game reopen in Chain Reaction) |
| Role changes refused while a game runs | ✓ Both roster buttons are disabled with the title "Go to the lobby to change roles". Force-enabling them and clicking left the roster unchanged: the reducer refuses too. |
| A second device under the same **name**, mid-game, with the host phone away | ✓ Seated as a player; its frame was mounted without `role=host`. The laptop showed "Hana rejoined from another device — host phone role removed." The device received 0 `h:1` payloads and 0 `role` messages. The original device trying to come back was refused with "That name is taken". |
| A second device under the same **pid**, no key, in the lobby | ✓ Demoted to player with no key stored (⚠ L6: notice wording). |
| Third host phone | ✓ Refused: "There are already two host phones". With two host phones assigned, both received the Krillion view. |
| A contestant in a **running** game made host phone (Dex in Krillion) | ✓ Setup dropped Dex. The running game kept his seat and score, and the laptop showed one notice: "Dex is no longer a player in this room (now the host phone, or gone) — type their answers from this screen, or start a new game." |
| Revoke ("Make player") | ✓ The phone returns to the player waiting room and its stored key is cleared. With no host phone left, Weakest Link shows the old answer line and peek exactly as before (`answersPrivate` false). |
| Contestant wire, whole night | ✓ Cole: **0** `h:1` and 0 `t:"host"` frames in 486 messages across all 15 games. Dex: exactly 1, sent only while he held the role in Krillion. |

## Regression: no host phone assigned

| Suite | Result |
|---|---|
| `node --test` (repo root) | **1577 / 1577** pass |
| `tests/hub-harness.html?store=harness` | **26 / 26** |
| Every game's `tests/harness.html?store=harness` | All pass. Jeopardy 70, Family Feud 109, Wheel 110, Weakest Link 86, Millionaire 79, The Price Is Right 80, Pyramid 97, Deal or No Deal 83, Password 75, Chain Reaction 81, The Chase 64, 1 vs 100 68, Press Your Luck 21, Match Game 64, Krillion 78. |
| Jeopardy `gsc-embed-harness` / `photo-harness`; Password `harness-x` | 28 / 28, 26 / 26, 54 / 54 |
| Every `tests/harness-hostphone.html` | All pass **except Password: 38 / 39** (L1 below). Millionaire 26, The Price Is Right 20, Pyramid 26, Deal or No Deal 28, Chain Reaction 26, The Chase 22, 1 vs 100 28, Press Your Luck 24, Match Game 29. |

Results: `.scratch/hpt-harness-out.json`, `.scratch/hpt-nodetest.txt`.

## Defects, by severity

### M1 — Match Game: reconciliation keeps the former contestant's name in the seat, and a different phone then plays under that name

**Repro**

1. Two phones join: Hana and Cole.
2. Open Match Game. Hana and Cole are auto-seated as Contestant 1 and Contestant 2. Go back to the lobby.
3. Make Hana the host phone. A third phone, Dex, joins.
4. Open Match Game.

**Expected:** Contestant 1 is emptied, because Hana is no longer a player.

**Actual:**
- `setup.contestants` is `[{"name":"Hana","pid":"p3"},{"name":"Cole","pid":"p2"}]`.
- The UI shows `#mg-c1-name = "Hana"` with `#mg-c1-pid = Dex`.
- So the host phone's owner stays listed as a contestant, and Dex's phone would play as "Hana".
- Without a new phone joining, Hana would still be seated as a phone-less "host types" contestant.

**Suspect:** `games/match-game/js/mg-hostscreen.js:128`. `keep()` clears only `pid` and keeps the auto-filled `name`. The same applies to `panel`. The implementation report's "Seat names follow the phone" fix does not cover a reconciled seat.

**Fix direction:** when reconciliation clears a pid on a seat whose name was filled from that phone, clear the name too, or drop the seat.

### M2 — Jeopardy: a former contestant made host phone stays on the player list and scoreboard

**Repro**

1. Two phones join: Hana and Cole.
2. Open Jeopardy. Both appear under Players. Go back to the lobby.
3. Make Hana the host phone.
4. Open Jeopardy.

**Actual:**
- The setup still reads "Players: Cole ✕, Hana ✕".
- The saved state `gh-jeopardy-state-v1.players` still has `{id:"bz…-2", name:"Hana"}`.
- The buzzer room correctly lists only Cole.
- The host-phone person would be a scoreboard contestant. `reportScores` maps rows to lobby pids by name, so her row's score would also be credited to her on the night scoreboard.

**Suspect:** `games/jeopardy/js/gsc-embed.js` around 188–207. The roster sync only ever **adds** manual players. Nothing removes rows that belonged to a phone which is now a host phone. Implementation report §12 item 6 says reconciliation is "not applicable … the host phone never joins", but it did join earlier as a contestant.

**Fix direction:** on `init` and on `onHostPhones`, drop setup-phase scoreboard rows whose name matches a host-phone entry and that carry no score. Keep them, with one notice, if a game is running.

### L1 — Password `harness-hostphone.html` HP-I5 fails 3/3 runs (test race, not a product bug)

**Failing check:** "HP-I5 game over: the host phone lists the Lightning words …".

**Evidence:** I paused at the check with `.scratch/hpt-pw-debug.mjs`.
- `leaks()` is empty for all three words.
- The harness's `heldView` already holds the Lightning words.
- But `hostPhoneText()` still shows the previous "Password 3" view. The postMessage to the phone frame has not been rendered yet.

In the real hub, the host phone showed all five Lightning words at game over, and none were on the laptop.

**Suspect:** `games/password/tests/harness-hostphone.html:370-374`. Add `await waitFor(() => hostPhoneText().includes(upcoming[0]))` before the check. Until then the documented "39/39" is not reproducible.

### L2 — Jeopardy: no "Host phone disconnected" note and no private fallback

With the host phone away and a clue open, the laptop shows nothing new. The only way to see the response is "Reveal Answer", which reveals it to the whole room. §6 sanctions "Unchanged", so this is a spec gap rather than an implementation bug. A host who relies on the phone has no private recovery in Jeopardy.

### L3 — Wheel of Fortune host phone: the mini-board letters are 12.8 px

§5.3 requires text ≥ 16 px. The solution line itself is 29.6 px. The letters come from `.hc-tile` in `games/wheel-of-fortune/css/wheel-phone.css:145-149` (`font-size: 0.8rem`).

### L4 — Weakest Link: a built-in question's answer sits in the host document

The editor paste box placeholder (`#wl-ed-paste`, `games/weakest-link/index.html:315`) reads "In which ocean is Madagascar?\tThe Indian Ocean\tGeography". That is the answer to the first built-in question.

It is hidden while playing, but it fails the §5.5 attribute scan, and it is visible if the host opens the Editor mid-game. Use a made-up example instead.

### L5 — Krillion: no note and no fallback during the prompt intro while the host phone is away

In the intro phase (before "Start the clock"), the host view is already `secret:true` with the rated list. With the phone away, the laptop shows no "Host phone disconnected" and no fallback. Both appear once the clock starts, so the host cannot privately preview the list before opening the prompt.

### L6 — Demotion notice names the impostor, not the role holder

When a device relinks by **pid** under a new name, the laptop says "Zed rejoined from another device — host phone role removed." Nothing tells the host that this was Hana's host phone.

**Suspect:** `js/hub-host.js` `showHostNotice`. It reads the name after the relink renamed the entry. It could use the pre-relink name.

### Out of scope (seen in passing, not host-phone code)

- **Password, phone mode.** When both current givers are manual players, the notice still says "The password is on both givers' phones. Nothing secret is on this screen." (`games/password/js/pwd-view.js:245`).
- **Family Feud host card.** The game name appears twice ("Family Feud / Host / Family Feud"). This is cosmetic.

## Clean-up

- The static server (8790), the controller (8795) and every headless Chrome I started were stopped.
- No Chrome process with a `hpt-prof` profile remains, and the profiles were deleted.
- The helpers and evidence are kept in `.scratch/hpt-*` (gitignored).
