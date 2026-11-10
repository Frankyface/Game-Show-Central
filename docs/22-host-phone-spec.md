# 22 — Host phone: a private second screen for the host

Status: **approved for implementation** (revised after the Fable review in `docs/reports/host-phone-spec-review.md`) · Applies to: shell (hub, protocol, SDK) and all
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
answer** and whatever else only the host should know. While a host phone is **assigned** (connected or not), every game switches
its shared screen to **answers private**: no answer is drawn on the laptop
until the game reveals it to the room, or until the host presses the
explicit per-item fallback button. The laptop keeps every control; the host
phone is read-only in v1 and nothing it sends reaches a game.

## 3. Roles and who may grant them

- A roster entry has `role: "player"` (default) or `role: "host"`.
- **Only the laptop grants the role**, from the hub lobby roster row ("Make
  host phone" / "Make player"). No phone→host message carries a role.
- **The role is bound to the device.** On grant the hub creates a random
  host key, stores it on the roster entry and sends it to that phone only;
  the phone stores it with its pid and presents it when it rejoins. A join
  that relinks onto a host-role entry **without the matching key** (another
  device using that pid or that name) is seated as a `player`, the key is
  cleared, and the laptop shows "‹name› rejoined from another device — host
  phone role removed". The key is never in a lobby snapshot.
- At most **two** host phones. Manual (phone-less) entries cannot hold the
  role. Host phones count toward the room's player limit.
- **Role changes only while no game is running** (control disabled in-game,
  tooltip "Go to the lobby to change roles"). Kicking a host phone is allowed
  at any time.
- Host phones are **not contestants**: the hub never tells a game about them
  as players, games never seat or score them, and anything a host phone
  sends to a game is dropped by the hub. Points the same phone earned as a
  player earlier in the night stay on the night scoreboard.
- The role survives that phone reloading or reconnecting, a hub reload, and
  a locked lobby; it is kept in the hub save.
- The tag "Host phone" on the roster row is public; only what the phone
  shows is secret.

## 4. Shell changes (protocol, hub, SDK) — one agent

### 4.1 Protocol (`shared/room-protocol.js`)

- `Player` (internal lobby state) gains `role` and `hostKey` (string or
  null). `validateLobbyPlayer` accepts `role` (anything but `"host"` →
  `"player"`); `lobbySnapshot` carries `role` and never `hostKey`;
  `serializeLobby`/`restoreLobby` keep both. `playerList`/`playerCopy` (what
  games see) return **contestants only and no `role` field**; a new
  `hostPhoneList(state)` returns `[{pid,name,connected}]`.
- `join` gains optional `hk` (string ≤ 64). `validateEnvelope` accepts it.
- `lobbyReduce` event `setRole{pid, role, key}`: refused when
  `state.activeGame` is set, when the pid is manual or unknown, or when it
  would make a third host. Granting stores `key`; revoking clears it.
  Effects: `send` to that phone `{v:2,t:"role",role,hk?}`, then
  `broadcastLobby`.
- Relink onto a host-role entry: role kept only if `event.hk === hostKey`;
  otherwise demote, clear the key, add effect `{notice:"host-demoted",pid}`.
- For a host-role pid, `join`/`leave`/`status`/`kick` emit
  `{frame:{t:"host-phones"}}` instead of `player-join/leave/status`.
- The phone learns its role from its own row in the `lobby` snapshot (the
  single source); `joined` is unchanged.
- Unit tests: grant/revoke; the three refusals; key match keeps the role;
  relink by pid without the key and by name without the key both demote;
  stale-then-takeover demotes; the key never appears in a snapshot;
  `playerList` excludes host phones; host-pid roster events emit
  `host-phones` and never `player-*`; persistence; junk roles; prototype-
  shaped pids.

### 4.2 Hub host (`js/hub-host.js`, CSS)

- Roster row: "Host phone" tag and a "Make host phone" / "Make player"
  button (secondary outline, 44 px, icon `phone`); disabled in-game. Roster
  count reads "N players + H host phone(s)".
- Tiles' player counts and "plays best with" hints count contestants only.
- The game frame sees contestants only: `init.room.players` excludes host
  phones; `init.room.hostPhones` and the new `{t:"host-phones",list}`
  message carry `[{pid,name,connected}]`; `init.room.answersPrivate` is true
  when any host-role entry exists.
- New frame→shell message `{t:"host-view", m}`. The hub keeps the latest
  one for the mounted frame, sends it to every host phone as
  `{v:2,t:"game",g,m,h:1}`, and re-sends it when a host phone connects,
  reconnects or is granted a key match. It is cleared when the frame is
  unmounted. A `{t:"send",pid}` addressed to a host-role pid, and a
  broadcast, are never delivered to host phones.
- `game` payloads arriving **from** a host-role pid are dropped (not queued).
- In-game shell bar shows "Host phone ●/○" (connected/away) next to the room
  chip; "N connected" counts contestants.

### 4.3 Hub phone (`js/hub-player.js`)

- Role is read from the phone's own `lobby` row. When it is `host`: the
  waiting room reads "You're the host's second screen. Answers for each game
  appear here — keep this phone to yourself." and the game frame URL gets
  `&role=host` and **no `name=`** (a layout hint only).
- The phone stores `{code,pid,name,avatar,hk}` and sends `hk` on every join.
- An `h:1` game payload is forwarded to the frame as bridge `host-view`
  only when the phone's own row says `host`; otherwise it is dropped.
- A role change received while a frame is mounted (cannot normally happen)
  remounts the frame.
- Distinct header colour plus the word "Host" (colour is never the only
  signal).

### 4.4 SDK (`shared/bridge.js`, `window.GSC`)

- Host side: `room.players()` is unchanged in meaning and now simply never
  contains a host phone (the hub filters). New: `room.hostPhones()` →
  `[{pid,name,connected}]`; `room.answersPrivate()` → boolean;
  `room.setHostView(view)` → hands the hub the current private view (call it
  on every state change; the hub de-duplicates, caches and re-delivers);
  handler `onHostPhones(list)` fires when the set or a connection changes.
  `onPlayerJoin/Leave/Status/onMessage` never fire for a host phone.
- Player side: `me.role`; new handler `onHostView(view)`. `onMessage` never
  receives a host view.
- All four additions exist on every room object (`makeRoomShell`):
  standalone returns `[]`, `false`, no-op. Standalone roles are out of scope
  for v1.
- A host view larger than 16 KB is refused with a `console.warn` and
  replaced by `{t:"host",item,tooBig:true}`.
- `shared/virtual-peer.js` needs no change and must be shown by test not to
  announce a host phone.

### 4.5 Shell verification
L-U additions for the reducer; hub harness: grant role → that phone's frame
loads with `role=host` and gets `init` with `me.role === "host"`; the host
game frame's `players()` excludes it and `hostPhones()` includes it;
`sendHost` reaches only that phone; role change refused while a game is
active; a host phone that reloads keeps the role.

With no host-role entry, every existing unit test and browser harness passes
unmodified. Harness additions: a phone that joins with a host pid and no key
is seated as a player and receives no host view; a host phone marked stale
keeps `answersPrivate` true; a host phone's `game` payload never reaches the
frame; the virtual-peer hub holds no connection for a host pid.

## 5. The per-game contract — every game implements the same seven things

1. **Pure selector** `hostView(state)` in the game's core (or `*-select.js`),
   returning a plain object with the host's private information for the
   current moment (shape per game in §6). Pure, deterministic, ≤ 16 KB; lists are truncated (first N and a count) rather than exceed it. A host view never contains information a role the host is currently playing must not have.
2. **Room glue**: on every state change, `room.setHostView({ t:"host", item,
   seq, ...hostView(state) })`. No cache, no resend logic, no use of
   `room.send` for host data. Contestant `phoneView` is unchanged.
3. **Phone page in `role=host`**: a host screen instead of the player screen.
   v3 look, flat, readable at arm's length: a small "Host" header with the game
   name; the **current item** large (question/clue/prompt) with the **answer**
   in the game's accent; secondary info below (what's next, the rest of the
   board). Text ≥ 16 px, answer ≥ 28 px, no horizontal scroll at 320 px,
   no buttons in v1 (the next item, when there is one, is listed below the
   current one).
   When nothing private applies (setup, standings) it shows "Nothing secret
   right now" plus the game phase.
4. **Answers-private mode**: when `room.answersPrivate()` is true the shared
   screen never renders answer text before the game's public reveal — the
   game's own remembered reveal switches (keep-answers, peek, rated list,
   "show to me") are ignored, and host-only answer lines are not created at
   all. In their place: "Answer is on your host phone" while one is
   connected; while none is connected, "Host phone disconnected" and a
   single button **Show answer on this screen**, which reveals the current
   item only and clears on the next item. Exception: a control that exists so
   a *phone-less contestant* can see their own secret (Pyramid/Password giver
   panels) stays available, behind its existing click and warning, while that
   contestant has no connected phone. Public reveals that are part of the
   show are unchanged.
5. **Tests**: unit — `hostView` holds the right answer at each phase, nothing
   in phases with no secret, and nothing a host-played role must not know;
   `phoneView` unchanged. Harness — a host-role frame receives the view via
   `onHostView`; contestant frames never do; with a host phone assigned
   (connected *and* disconnected) the answer string is absent from the host
   document's text, `value`, `placeholder`, `<option>`, `title`, `alt`,
   `aria-label` and `data-*`, and from `setTitle`, before the reveal; it
   appears after the fallback button and disappears on the next item.
6. **Seat reconciliation on boot**: phone seats in the saved setup whose pid
   is not in `room.players()` are removed; a running or resumable game that
   seats such a pid keeps the seat, treats it as phone-less and shows one
   notice.
7. **Host-phone page**: shows `item` beside the answer; dims and shows
   "Reconnecting — this may be out of date" when the transport is down;
   renders `tooBig` as "Too much to show — use the button on the laptop";
   sends nothing. No buttons in v1.

## 6. What the host phone shows, game by game

| Game | Host phone shows | Shared screen in answers-private mode |
|---|---|---|
| **Jeopardy** | Open clue: category, value, clue, **correct response**, "has an answer image" flag; Daily Double context; Final: clue + response; board: nothing secret. | Unchanged (upstream hides the response until "Reveal answer"; it is in the DOM but not visible, so the assertion for this game is on visible text). Host side: `gsc-embed.js` computes the view in `onStateChanged` and calls `room.setHostView`. Phone side: the hub omits `name=` for `role=host` so upstream's auto-join does not run; `gsc-embed.js` hides `#screen-player`, skips the stuck-join card and renders the host card from `onHostView`. No upstream edit. |
| **Family Feud** | The full survey with tile numbers, counts, revealed ticks; strikes; Fast Money: the five questions with numbered answers and counts. | Unrevealed tiles stay blank (already). Fast Money's board-answer picker lists "Answer 1…N", not answer text. |
| **Wheel of Fortune** | The full puzzle solution and category; toss-up solution; bonus solution; letters still hidden. | No change before solve (board already hides letters); any "Reveal all" stays a host action. |
| **Weakest Link** | Current player, question and **answer**; next two questions; in the final, both players' questions and answers. | The peek button and host-only answer line are not rendered. |
| **Millionaire** | Question, the four options with the **correct one marked**, money at stake and the safe-haven payout if wrong; Fastest Finger correct order; 50:50's remaining options. | No correct-answer hint before the paced reveal (already). |
| **The Price Is Right** | Actual prices for the item(s) in play; both showcase totals. | No change (nothing private is rendered before its reveal today). |
| **Pyramid** | The category's seven words (current highlighted, passed/correct marked), the hint; Winner's Circle categories. | "Show words to me" / study is rendered only while the current giver has no connected phone; otherwise "Words are on your host phone". |
| **Deal or No Deal** | The banker's offer before it is announced and how it was computed. | No change. |
| **Password** | The password and ladder position; Lightning Round: all five words. | "Show password to me" / study is rendered only while a current giver has no connected phone. |
| **Chain Reaction** | The whole chain (every word), the frontier words highlighted; Speed Chain words. | No hidden letters on screen (already). |
| **The Chase** | Cash Builder: question + answer and the next question; head-to-head: question and options, **correct one marked — withheld until the Chaser has locked when the host is playing the Chaser**; Final Chase: question + answer and the next question. | The answer lines are not created. |
| **1 vs 100** | Question with the **correct option marked**, the Mob's live answer split, how many would fall. | Nothing private on screen (already). |
| **Press Your Luck** | Question round: question + **answer** (the correct option); on the Big Board: nothing secret. | No answer hint. |
| **Match Game** | The prompt's hint; panel answers as they arrive (so the host can prepare the match calls); Super Match top-three board before it is revealed. | Panel cards stay face-down (already). |
| **Krillion** | The current prompt's **rated answer list** (tiers), each player's submitted answer as it arrives with its matched tier, and the judge's queue preview. | The examples panel is not rendered; the reveal is unchanged. |

## 7. Rollout and verification

1. Shell agent implements §4 (protocol, hub, SDK, tests) first; nothing in the
   games changes until it lands.
2. Then one agent per game in three waves: (a) Jeopardy, Weakest Link, The
   Chase, Family Feud, Wheel; (b) Pyramid, Password, Chain Reaction,
   Krillion, Match Game, Press Your Luck; (c) Millionaire, 1 vs 100, The
   Price Is Right, Deal or No Deal (minimal views).
3. Then one tester verifies across the hub and all fifteen games through a real
   room (a host phone assigned in the lobby, a contestant phone, each game
   played to a hidden answer; the shared screen and contestant phone never hold
   the answer before its reveal, the host phone always does; the role survives a
   host-phone reload; roles are locked during a game), and also asserts: locking the host phone for 40 s mid-question leaves the
   shared screen answer-free and shows the fallback button; a second phone
   joining under the host phone's name or pid gets no host view and the role
   is removed; a former contestant made host phone is reconciled out of each
   game's setup; with no host phone assigned the whole existing suite passes
   unchanged.

## 8. Non-goals (v1)

- Remote control from the host phone (judging, revealing, advancing).
- Host phones in standalone (no-hub) play.
- Hiding the shared screen's *public* reveals.
- Encrypting host views on the wire (they travel only to the chosen phone, as
  every phone view already does).
- A per-game or per-night "answers on this screen" preference (use the
  per-item fallback button, or make the phone a player again).
- Sending answer images to the host phone.
