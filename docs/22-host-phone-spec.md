# 22 — Host phone: a private second screen for the host

Status: **draft for review** · Applies to: shell (hub, protocol, SDK) and all
fifteen games. Follow every cross-cutting rule in
`docs/reports/00-orchestrator-triage.md` and the v3 look in `docs/21` +
`docs/design-system.md` §0.

## 1. Problem

The host's laptop screen is shared with everyone on the call. Most games need
the host to know the answer before the room does (to judge a spoken answer, to
read a clue, to rule on a Pyramid clue), but anything the host can see, every
player can see. Today games either show the answer on the shared screen
(The Chase, Jeopardy after "Reveal", Krillion's examples panel, host-as-giver
panels) or hide it behind a "peek" that flashes it to the whole room
(Weakest Link). The host usually does not know the answers.

## 2. The feature in one paragraph

Any phone in the room can be made the **host phone** by the host, from the
hub lobby. That phone stops being a contestant and becomes a private second
screen: for whatever game is running it shows the current question **with its
answer** and whatever else only the host should know. While a host phone is
connected, every game switches its shared screen to **answers private**: no
answer text is ever drawn on the laptop until the moment the game reveals it to
the room. The laptop keeps every control; the host phone is read-only in v1.

## 3. Roles and who may grant them

- A roster player has `role: "player"` (default) or `role: "host"`.
- **Only the host's laptop can grant the role**: the hub lobby's roster row gets
  a "Make host phone" / "Make player" control. A phone can never ask for or
  claim the role; no phone→host message carries a role. The role is visible on
  the shared screen ("Host phone" tag on that roster row), which is fine: who
  holds the phone is not secret, only what it shows.
- At most **two** host phones (a co-host). Manual (phone-less) roster players
  cannot be host phones.
- **Role changes only while no game is running** (the control is disabled
  in-game with a tooltip "Go to the lobby to change roles"). This avoids a
  contestant vanishing from a game in progress. A host who wants a host phone
  mid-game uses ⌂ Lobby (the game is saved), assigns it, and re-enters.
- Host phones are **not contestants**: games never seat them, never score them,
  and the night scoreboard ignores them.
- The role belongs to the roster entry (pid), so it survives the phone
  reloading or reconnecting, and is kept in the hub save.

## 4. Shell changes (protocol, hub, SDK) — one agent

### 4.1 Protocol (`shared/room-protocol.js`)
- `Player` gains `role` (`"player"` | `"host"`); `validateLobbyPlayer` accepts
  it (default `"player"`, anything else → `"player"`); `lobbySnapshot` carries it;
  `restoreLobby` keeps it.
- `lobbyReduce` event `setRole{pid, role}`: refused when `state.activeGame` is
  set, when the pid is manual or unknown, or when it would make a third host;
  effects `broadcastLobby` (+ nothing to frames, because no game is running).
- The `joined` message carries `role` so the phone shell knows on (re)join.
- Unit tests: grant/revoke, the three refusals, persistence through
  `restoreLobby`, snapshot shape, junk role values, prototype-shaped pids.

### 4.2 Hub host (`js/hub-host.js`, CSS)
- Roster row: a "Host phone" tag and a small "Make host phone" / "Make player"
  button (secondary outline, 44 px, icon `phone`); disabled in-game.
- Game tiles: player counts and "plays best with" hints count contestants only.
- `init` / `player-join` to the host game frame carry `role` on every Player.

### 4.3 Hub phone (`js/hub-player.js`)
- When `role === "host"`: the waiting room reads "You're the host's second
  screen. Answers for each game appear here — keep this phone to yourself."
  The game frame URL gets `&role=host`.
- Wake lock stays on; a slightly dimmer, distinct header colour so the host can
  tell it apart from a player phone at a glance.

### 4.4 SDK (`shared/bridge.js`, `window.GSC`)
- Host side: `room.players()` returns **contestants only** (role player);
  new `room.hostPhones()` returns host-role players; new
  `room.sendHost(m)` sends `m` to every connected host phone; new handler
  `onHostPhones(list)` fires whenever the host-phone set or their connection
  changes (also once after init). `onPlayerJoin/Leave/Status` fire only for
  contestants. Back-compat: games that ignore the new API keep working and
  simply never send host views.
- Player side: `me.role` (`"player"` | `"host"`).
- Standalone (no hub): roles are not offered in v1 (`hostPhones()` is `[]`);
  noted in each README. (A later round can add "Make host phone" to the
  standalone room panel through the same reducer.)
- Message cap and validation unchanged; the shell never inspects game payloads.

### 4.5 Shell verification
L-U additions for the reducer; hub harness: grant role → that phone's frame
loads with `role=host` and gets `init` with `me.role === "host"`; the host
game frame's `players()` excludes it and `hostPhones()` includes it;
`sendHost` reaches only that phone; role change refused while a game is
active; a host phone that reloads keeps the role.

## 5. The per-game contract — every game implements the same five things

1. **Pure selector** `hostView(state)` in the game's core (or `*-select.js`),
   returning a plain object with the host's private information for the
   current moment (shape per game in §6). Pure, deterministic, ≤ 8 KB.
2. **Room glue**: on every state change, `room.sendHost({ t:"host", ...hostView })`
   (with the same last-sent cache the games already use for phone views, keyed
   on the serialised view; cleared when the host-phone set changes). Host views
   are **never** sent to a contestant pid, and contestant `phoneView` is
   unchanged.
3. **Phone page in `role=host`**: a host screen instead of the player screen.
   v3 look, flat, readable at arm's length: a small "Host" header with the game
   name; the **current item** large (question/clue/prompt) with the **answer**
   in the game's accent; secondary info below (what's next, the rest of the
   board). Text ≥ 16 px, answer ≥ 28 px, no horizontal scroll at 320 px,
   no buttons in v1 except an optional "Show next" disclosure for upcoming items.
   When nothing private applies (setup, standings) it shows "Nothing secret
   right now" plus the game phase.
4. **Answers-private mode on the shared screen**: `answersPrivate` is true
   whenever `room.hostPhones()` has a connected phone (and a toolbar-adjacent
   setting "Answers on: Host phone / This screen" lets the host override; it is
   remembered per game). When true, the shared screen **never renders answer
   text before the game's own public reveal**: host-only answer lines, peek
   buttons, example panels and host-as-giver word panels are not rendered at all
   (not merely hidden), and a quiet line reads "Answer is on your host phone".
   Public reveals that are part of the show (the Feud board flip, Jeopardy's
   revealed answer, Wheel's solved puzzle, Millionaire's green option) are
   unchanged.
5. **Tests**: unit — `hostView` contains the right answer at each phase and
   nothing for phases where nothing is private; `phoneView` for contestants is
   unchanged (existing leak tests still pass). Harness — with a host-role phone
   frame: it receives `host` views with the answer, contestant frames never do,
   the shared-screen DOM (all text and input values) contains no answer text
   before the reveal when a host phone is present, and does show it in "This
   screen" mode.

## 6. What the host phone shows, game by game

| Game | Host phone shows | Shared screen in answers-private mode |
|---|---|---|
| **Jeopardy** | Open clue: category, value, clue and **correct response**; Daily Double wager context; Final: clue + response; on the board: nothing secret. | Unchanged before reveal (upstream already hides the response until "Reveal answer"); host now judges from the phone and reveals after. Implemented in `gsc-embed.js`/`gsc-extras.js`: the adapter reads Jeopardy's `state` and sends host views through the bridge directly (not the virtual peer); the phone frame with `role=host` renders a host card instead of the buzzer. String-only `// GSC:` edits to upstream only if unavoidable. |
| **Family Feud** | The full survey: every answer with its count and tile number, revealed ones ticked; strikes; in Fast Money, the five questions with their top answers and counts. | Unrevealed tiles stay blank (already). Remove any host-only answer hints. |
| **Wheel of Fortune** | The full puzzle solution and category; toss-up solution; bonus solution; letters still hidden. | No change before solve (board already hides letters); any "Reveal all" stays a host action. |
| **Weakest Link** | Current player, question and **answer**; next two questions; in the final, both players' questions and answers. | The peek button and host-only answer line are not rendered. |
| **Millionaire** | Question, the four options with the **correct one marked**, money at stake and the safe-haven payout if wrong; Fastest Finger correct order; 50:50's remaining options. | No correct-answer hint before the paced reveal (already). |
| **The Price Is Right** | Actual prices: current One Bid item, the three Cliff Hangers items, Plinko's four actual prices, the Lucky Seven car price digit by digit, both showcase totals. | The host-only price lines are not rendered until revealed. |
| **Pyramid** | The current category's seven words (current one highlighted, passed/correct marked), the hint; Winner's Circle box categories. | The host-as-giver "Show words to me" panel is not rendered; the warning line becomes "Words are on your host phone". |
| **Deal or No Deal** | Expected value, the banker's offer before it is announced and how it was computed; **case contents only behind a "Show case contents" toggle on the phone** (off by default, since on the show nobody knows them). | Offer stays hidden until the host reveals it; the EV toggle is not rendered. |
| **Password** | The password, its value ladder position; Lightning Round: all five words. | The host-as-giver panel/study mode is not rendered. |
| **Chain Reaction** | The whole chain (every word), the frontier words highlighted; Speed Chain words. | No hidden letters on screen (already). |
| **The Chase** | Cash Builder: question + answer; head-to-head: question, the three options with the **correct one marked**; Final Chase: question + answer. | The host-only answer line is not rendered. |
| **1 vs 100** | Question with the **correct option marked**, the Mob's live answer split, how many would fall. | Nothing private on screen (already). |
| **Press Your Luck** | Question round: question + **answer** (the correct option); on the Big Board: nothing secret. | No answer hint. |
| **Match Game** | The prompt's hint; panel answers as they arrive (so the host can prepare the match calls); Super Match top-three board before it is revealed. | Panel cards stay face-down (already). |
| **Krillion** | The current prompt's **rated answer list** (tiers), each player's submitted answer as it arrives with its matched tier, and the judge's queue preview. | The examples panel is not rendered; the reveal is unchanged. |

## 7. Rollout and verification

1. Shell agent implements §4 (protocol, hub, SDK, tests) first; nothing in the
   games changes until it lands.
2. Then one agent per game in waves of four or five implements §5–§6.
3. Then one tester verifies across the hub and all fifteen games through a real
   room: a host phone assigned in the lobby, a contestant phone, each game
   played to the point of a hidden answer; asserts (DOM text + input values)
   that the shared screen and the contestant phone never contain the answer
   before its reveal and the host phone always does; the role survives a
   host-phone reload; roles are locked during a game.

## 8. Non-goals (v1)

- Remote control from the host phone (judging, revealing, advancing).
- Host phones in standalone (no-hub) play.
- Hiding the shared screen's *public* reveals.
- Encrypting host views on the wire (they travel only to the chosen phone, as
  every phone view already does).
