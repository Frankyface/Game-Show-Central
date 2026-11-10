# Review — `docs/22-host-phone-spec.md` (host phone: a private second screen)

Reviewer pass against the code as it stands (shell: `shared/room-protocol.js`,
`shared/bridge.js`, `shared/virtual-peer.js`, `shared/room-host.js`,
`js/hub-host.js`, `js/hub-player.js`, `js/hub-registry.js`, `js/hub-night.js`;
games read in depth: Jeopardy adapter + `app.js`/`buzzer-*.js`, The Chase,
Weakest Link, Pyramid, Krillion, Family Feud Fast Money; the other games'
`*-room.js` / `*-view.js` were grepped, not read end to end — Match Game,
1 vs 100, Millionaire, Press Your Luck and Wheel are the least-checked rows).
Nothing was run; no code or spec was edited.

## Verdict

**Approve with changes.** The concept is right and is the smallest thing that
solves the request: a roster phone promoted by the laptop, a per-game pure
`hostView`, and a shared screen that stops drawing answers. It cannot be
implemented as written, though. Five things are wrong enough to change before
any agent starts: (1) answers-private is keyed to the host phone being
*connected*, so a phone that sleeps puts the answer back on the shared screen
mid-question; (2) the spec's claim that "a phone can never claim the role" is
false — the existing relink rules let any phone take over a disconnected host
pid, role included; (3) carrying `role` on every `Player` and filtering in the
SDK is the wrong layer — the virtual peer listens to the same bridge messages
and would hand the host phone to Jeopardy as a buzzer connection; (4) The
Chase's default setup has the *host playing the Chaser*, so the proposed host
view gives one side the answers; (5) removing the "Show words to me" / study
panels in Pyramid and Password strands phone-less givers, breaking the house
rule that everything works without phones. The remaining findings are
tightening: a simpler SDK shape (`setHostView`, held by the shell) that removes
fifteen copies of cache-and-resend logic, stale-view protection on the phone,
the Jeopardy adapter details, and scope trims.

## Does it solve the problem, game by game (question 1)

| Game | Verdict | Note |
|---|---|---|
| Jeopardy | Yes, with adapter changes | See F8. The response is already in the shared DOM (hidden) before reveal — `app.js:576-582`; not a visible leak, but it fails the spec's own DOM assertion. |
| Family Feud | Yes for the main board; **leak in Fast Money** | Host clicks blank tiles by number (`feud-app.js:329-331`), so the phone's numbered survey is exactly what is needed. Fast Money's reveal picker is a `<select>` listing every answer and count on the shared screen (`feud-fm.js:191-199`) — F10. |
| Wheel | Yes | Host judges a solve right/wrong today without seeing the solution (`wheel-app.js:564-568`); the phone fixes that. |
| Weakest Link | Yes | Answer text is always written into the DOM and only class-hidden (`wl-app.js:292,297,445-446`); "not rendered" is the right rule. `keepAnswers` (`wl-app.js:54,646`) must be overridden — F5. |
| The Chase | **No, as specified** | Host is the Chaser by default — F4. Cash Builder / Final answers are unconditionally on the shared screen today (`chase-view.js:153,398`), so the gain is real once F4 is fixed. |
| Pyramid, Password | **Regression as specified** | F6. |
| Krillion | Yes | Rated list is already built only on demand (`kr-view.js:352-371`). Judging stays on the laptop queue (`kr-view.js:287-320`), which is fine. |
| Chain Reaction | Yes | Peek line is the only early word (`cr-view.js:185-194`). |
| Press Your Luck, Match Game | Yes (grep-level check) | Host judges spoken buzz answers (`pyl-view.js:258`); nothing early on screen. |
| Millionaire, 1 vs 100, Price Is Right, Deal or No Deal | Solved already; host phone is a nice-to-have | These are machine-judged. TPIR has no "host-only price lines" to remove (`tpir-view.js:184,442`, `tpir-games.js:175-180`); DoND's "odds" are derived from the public board (`dond-view.js:307-312`). See F14. |

## Findings

### F1 — blocking — Answers-private flips off when the host phone drops, exposing the answer
**Evidence.** §5.4 defines `answersPrivate` as "true whenever `room.hostPhones()`
has a *connected* phone". A phone is marked disconnected after 30 s of silence
(`shared/room-net.js:73`, sweep in `shared/room-host.js:302-310`, flipped by
`reduceStatus`, `shared/room-protocol.js:481-494`) and immediately on a closed
connection (`reduceLeave`, `:464-478`) — i.e. whenever the phone locks, the
browser is backgrounded, or Wi-Fi blips. On that render The Chase would again
write `cb.item.a` (`chase-view.js:153`), Weakest Link `q.a`
(`wl-app.js:292`), and so on — to the whole call, mid-question, with no host
action.
**Change.** Private mode is a property of the *roster*, not the connection:
it is on whenever a host-role entry exists, connected or not. While no host
phone is connected the shared screen shows "Host phone disconnected" and one
explicit, per-item fallback button ("Show answer on this screen", same
behaviour as today's peek, auto-clears on the next item). Nothing appears
without a click. This also replaces the per-game "Answers on" toggle (F5).

### F2 — blocking — A phone *can* claim the role: relink hands a disconnected host pid to whoever asks
**Evidence.** §3 says "A phone can never ask for or claim the role". But
`reduceJoin` relinks a joining phone onto an existing entry if it presents the
pid of a disconnected player (`room-protocol.js:381-382`) or merely types the
*name* of a disconnected player (`:386`, `findByName(..., true)`), and
`bindPeer` evicts the previous device (`:428-436`). Pids are sequential
(`:400`) and broadcast to every phone in each lobby snapshot (`:281-291`,
`js/hub-host.js:233-235`). "Disconnected" includes the 30 s stale flag while
the real phone is still attached (`:481-494`). With the role stored on the
roster entry (§3 last bullet), the taker inherits it and receives every answer.
Low effort (type the host phone's name while it is asleep), high damage for a
feature whose whole purpose is privacy.
**Change.** Bind the role to the device, not just the pid: on grant the hub
generates a random host key (hub-side, `crypto.getRandomValues`; the reducer
stays pure and takes it in the event), stores it on the entry, and sends it
only to that phone. `join` gains an optional `hk`; a relink onto a host-role
pid keeps the role only when `hk` matches, otherwise the entry is demoted to
`player`, the key is cleared and the laptop shows "‹name› rejoined from another
device — host phone role removed". Never include the key in `lobbySnapshot`.

### F3 — blocking — Role filtering belongs in the shell, not the SDK; the bridge message set is incomplete
**Evidence.** §4.2 sends `role` on every `Player` in `init`/`player-join` and
§4.4 has `room.players()` filter. But `GSC` is not the only consumer of those
messages: `shared/virtual-peer.js:134-168` has its own listener, adds every
non-manual player from `init`/`player-join` to its roster and `announce`s a
PeerJS-style connection to Jeopardy's `BuzzerHost.handleConnection`
(`games/jeopardy/js/buzzer-host.js:264-271`); `embeddedHost` forwards
`player-status` for pids it does not know (`shared/bridge.js:148-152`). The
reducer's existing effects for a relink/leave/status/kick are
`player-status` / `player-leave` frames (`room-protocol.js:458,476,492,507`)
and the spec does not say what they become for a host-role pid. Nor does it
say what happens to `game` messages *from* a host phone
(`js/hub-host.js:193-202` forwards anything from a rostered pid) — a host
phone that used to be a seated contestant could still submit that seat's
intents while reading the answers.
**Change.** The hub strips host-role entries before anything reaches a game
frame: `init.room.players` is contestants only; host phones travel in
`init.room.hostPhones` and a new `{t:"host-phones", list}` message; for a
host-role pid the reducer emits `{frame:{t:"host-phones"}}` instead of
`player-join/leave/status`. Phone→host `game` payloads from a host-role pid are
dropped at `hub-host.js` (v1 is read-only). `Player` objects given to games
never carry `role`. Result: `virtual-peer.js`, `tests/fake-game.html` and every
existing game see exactly today's messages.

### F4 — blocking — The Chase: the host is the Chaser by default
**Evidence.** `games/the-chase/js/chase-app.js:43` (`chaserMode: "host"`),
`:394` (`chaserIsHost`), `:417` (`chaser: { isHost: !player, … }`); the room
glue's own header says the host locks the Chaser's answer on the laptop
(`chase-room.js:166-167`). §6 puts the head-to-head correct option on the host
phone, which is in the Chaser's hand.
**Change.** `hostView` for `headToHead` omits the correct option while
`chaser.isHost` and the Chaser has not locked; it appears once the Chaser's
lock is in. Final Chase with a host Chaser: keep today's behaviour (answer
visible to the reader) but say so in the row. The general rule goes in §5:
*a host view never contains information that a role the host is currently
playing must not have*.

### F5 — blocking (design) — The per-game "Answers on" override multiplies state and fights existing toggles
**Evidence.** §5.4 asks all fifteen games for a setting "remembered per game".
Games already persist their own reveal switches — Weakest Link `keepAnswers`
(`wl-app.js:54,84,297,646,749`), Krillion `showList` (`kr-view.js:352-358`),
Pyramid/Password `reveal` (`pyr-app.js:63`, `pwd-view.js:221`), Chain Reaction
`peek` (`cr-app.js:48`), DoND `evShown`. A remembered "This screen" from a
previous night silently disables the feature on the night it matters, and
nothing says which switch wins.
**Change.** Delete the per-game override. The shell owns the mode (F1) and
passes it to the game (`room.answersPrivate()`); in private mode the game's own
remembered reveal switches are ignored (not cleared), and the only way to put
an answer on the shared screen is the per-item fallback button from F1. To turn
the mode off for the night: make the phone a player again in the lobby.

### F6 — blocking — Pyramid and Password: removing the giver panel breaks phone-less givers
**Evidence.** The "Show words to me" / study panel is not only for the host: it
is how a giver without a phone learns the words — `pyr-view.js:266-268` ("Read
the list to ‹giver› privately, or press 'Show words to me'"), panel at
`:296-314`; Password `pwd-view.js:239`, `:244-257`. §6 says these are "not
rendered" in private mode. The giver is a remote contestant; the host phone
does not reach them. `CLAUDE.md`: "Everything works without phones."
**Change.** In private mode the panel/study control stays available **only
while the current giver has no connected phone**, behind the same explicit
click and warning as today. When every current giver has a phone it is not
rendered and the line reads "Words are on your host phone".

### F7 — should-fix — `sendHost` + `onHostPhones` pushes the hard part into fifteen games; let the shell hold the view
**Evidence.** Every game already carries a `lastSent` cache plus three roster
handlers whose only job is to invalidate it (`chase-room.js:22,29-58,78-90`;
`wl-room.js:18,23-53,76-88`; `pyr-room.js:20,27-55,75-87`; `kr-room.js:18,26-52,
77-90`, and Krillion additionally relies on a phone `ready` message to re-push,
`:69`). §5.2 asks each game to add a second cache "cleared when the host-phone
set changes" — the exact class of bug the existing comments record
("the phone would sit on Waiting…"). A missed invalidation here shows the host
the *previous* question's answer.
**Change.** Replace `sendHost(m)` with `room.setHostView(view)`: the game calls
it on every state change; the hub keeps the latest view for the mounted frame
and delivers it to every host phone now, and again whenever a host phone
(re)connects or its frame becomes ready. Games keep no host cache and need no
resend logic. `onHostPhones(list)` stays, but only to re-render the "Answer is
on your host phone / Host phone disconnected" line. Phone side: a separate
`onHostView(view)` handler so contestant code paths never see one. The hub
clears the held view in `unmountFrame` (`hub-host.js:323-333`).

### F8 — should-fix — Jeopardy: feasible, but four details are missing
**Evidence and change.**
1. *Host side works without new upstream edits.* `app.js:80` already calls
   `GscEmbed.onStateChanged` on every `setState`
   (`gsc-embed.js:345-348`), and `appState()` reads the global-lexical `state`
   (`:81-83`). Compute the host view there and call `room.setHostView`. It does
   bypass the virtual peer, as the spec says.
2. *The phone would join as a contestant.* With `?room=` present,
   `buzzer-player.js:734-741` boots the buzzer UI and `gscAutoJoin`
   (`:749-757`) joins under `?name=` — the host phone gets a scoreboard row and
   a buzzer. Fix without touching upstream logic: `HubRegistry.playerUrl`
   (`js/hub-registry.js:134-142`) omits `name=` when `role=host`, so
   `gscAutoJoin` returns at its `!name` guard; `gsc-embed.js` then, for
   `role=host`, hides `#screen-player`, skips the 12 s "stuck" join card
   (`:283`, `:335-340`) and renders the host card from `onHostView`.
3. *The virtual peer must never see the host phone* — delivered by F3; without
   it `virtual-peer.js:140,146` announces a connection that never joins.
4. *DOM assertion.* `app.js:582` writes `clue.answer` into `#answer-text`
   before reveal and hides it (`:576`); Final writes it only at the judge stage
   (`:864`). §5.5/§7 assert on DOM text. For vendored Jeopardy assert on
   *visible* text (`innerText`), and say so, rather than editing upstream.
   Answer images (`app.js:587`) cannot ride a 32 KB payload: send text plus a
   "has an answer image" flag.

### F9 — should-fix — A stale host view is worse than none; nothing protects against it
**Evidence.** `hub-host.js:299` silently drops any payload over 32 KB;
§5.1 says "≤ 8 KB" with no rule for what a game does when a view is larger
(Feud Fast Money with five full surveys, Krillion's rated list plus sixteen
submissions). The phone frame is told about transport loss
(`bridge.js:194-198`, `hub-player.js:139-143`) but the spec does not use it.
**Change.** Every host view carries `item` (a short label of what it answers:
"R2 · Q7", "History $400") shown beside the answer, and `seq`. The host-phone
page dims the card and shows "Reconnecting — this may be out of date" on
`onStatus(false)`. One size rule: the SDK refuses a host view over 16 KB with a
`console.warn` and sends `{t:"host", item, tooBig:true}` instead, which the
phone renders as "Too much to show — use the fallback on the laptop". Selectors
truncate lists (first N + "and M more") rather than exceed it.

### F10 — should-fix — Family Feud Fast Money leaks through the judging control
**Evidence.** `feud-fm.js:191-199` builds a `<select>` whose options are
`"${answer.text} — ${answer.count}"` for every board answer; opening it on the
shared screen shows the whole survey. §6 only says "remove any host-only answer
hints", but this is the control the host scores with.
**Change.** In private mode the options read "Answer 1 … Answer N" and "No
match"; the host phone lists the same numbers with text and counts.

### F11 — should-fix — A pid that games already seated becomes a host phone and nothing un-seats it
**Evidence.** Role changes happen with no game frame mounted, so no game ever
receives a leave for that pid. At boot games only *add* from the roster
(`chase-room.js:191` → `:29-45`; `wl-room.js:154` → `:23-40`; `pyr-room.js`
same pattern) and purge phone seats only when the room code changes
(`chase-app.js:521-540`, `pyr-app.js:445-461`). The saved setup list and any
resumable game keep the pid as a contestant whose phone now shows answers.
(The same gap exists today for a player kicked while in the lobby.)
**Change.** Add to the per-game contract: on boot, after `init`, drop from the
saved setup list every phone seat whose pid is not in `room.players()`; if an
in-progress or resumable game seats such a pid, keep the seat (scores stand)
but treat it as phone-less and show one notice ("‹name› is now the host phone —
play their turns from this screen, or start a new game"). Jeopardy keeps the
scoreboard row (its rows are by name); note it in the README. Combined with F3
(host-phone payloads dropped) the seat cannot be played from the host phone.

### F12 — should-fix — Protocol/hub details the spec leaves open
- `validateJoined` rebuilds a fixed object and would strip `role`
  (`room-protocol.js:216-223`); a role change in the lobby produces no
  `joined` at all. Make the `lobby` snapshot the single source: the phone reads
  its own row in `onLobby` (`hub-player.js:169-189`, roster is assigned before
  the frame mounts, so ordering is safe). Drop "`joined` carries `role`".
- `playerCopy`, `playerList` and `serializeLobby` (`:295-302`, `:593-598`) must
  carry `role` and the host key internally; the spec lists only
  `validateLobbyPlayer`, `lobbySnapshot`, `restoreLobby`.
- Host phones count toward `maxPlayers` (`:398`) and the 16-entry snapshot cap
  (`:227`) — say so; show the roster count as "N players + H host phone(s)"
  (`hub-host.js:558`), and exclude host phones from "N connected"
  (`:461-463`, `:645`) or label them.
- Kick stays available in-game (the popover reuses `rosterRow`,
  `hub-host.js:658`, `:587`): kicking a host phone is allowed, emits
  `host-phones`, and private mode ends only if no host-role entry remains — in
  which case answers do **not** appear automatically mid-item (F1 fallback
  rule applies until the next item).
- "The night scoreboard ignores them": `HubNight.totals` iterates recorded
  rows, not the roster (`js/hub-night.js:64-85`). Define it as "games never
  report host phones; points a phone earned as a player earlier tonight stay".
- Locking the lobby does not affect roles; a locked lobby still relinks a host
  phone (`:397` is after the relink branch) — state it.
- Defence in depth: host views travel as `{v:2,t:"game",g,m,h:1}`;
  `hub-player.js:191-195` forwards an `h:1` payload to its frame only when its
  own roster row says `host`, and delivers it as bridge `host-view`, never
  `msg`.

### F13 — should-fix — "Never in the DOM" needs a precise, testable definition
**Evidence.** §5.5/§7 assert "DOM text + input values". The audience sees
pixels over a screen share, so what matters is anything that can become
visible: text, `value`, `placeholder`, `<option>` text (F10), `title`
tooltips, `alt`, and text the game pushes to the shell bar through
`room.setTitle` (`hub-host.js:316-319`). ARIA labels and `data-*` are not
visible but are spoken by a screen reader into shared audio.
**Change.** For the fourteen house games (which build their DOM from scratch)
the assertion is: the answer string does not occur in `textContent`, any
`value`, `placeholder`, `title`, `alt`, `aria-label` or `data-*` attribute of
the host document, nor in `setTitle`/`reportScores` payloads, before the
public reveal. For Jeopardy: not in `innerText` and not in any of those
attributes (F8.4).

### F14 — should-fix — Scope: tier the games, cut what nobody asked for
- Judge-critical first (the host cannot run them without the answer): Jeopardy,
  Family Feud, Wheel, Weakest Link, The Chase, Pyramid, Password, Chain
  Reaction, Krillion, Match Game, Press Your Luck.
- Machine-judged (Millionaire, 1 vs 100, Price Is Right, Deal or No Deal): a
  minimal host view in the last wave; no shared-screen change is needed for
  TPIR (there are no host-only price lines) or for DoND's odds toggle.
- Cut DoND "Show case contents": the request is "so I can see the answer";
  nobody on the show knows the cases, and it adds the only button to a
  read-only screen.
- Cut "optional Show next disclosure" as a per-game choice; specify next-item
  preview only where the pace needs it (Weakest Link, The Chase Cash Builder
  and Final Chase), always visible, smaller type.
- Add to v1 (cheap, and the feature is unsafe without them): the stale banner
  (F9), the laptop fallback button (F1), and a "Host phone ●" indicator on the
  hub shell bar so the host knows the phone is live *before* reading a question.

### F15 — nit — Smaller points
- `&role=host` on the frame URL and `me.role` in `init` are two sources; say
  the URL is a layout hint only and no game sends anything because of it.
- Put `hostPhones`, `setHostView`, `answersPrivate` on `makeRoomShell`
  (`bridge.js:161-168`) so standalone games never feature-detect; standalone
  returns `[]` / no-op / `false`.
- Add an explicit regression gate: with no host-role entry, every existing unit
  test and browser harness passes **unmodified**.
- GitHub Pages caches scripts for minutes: an old `hub-player.js` ignores
  `role` and mounts the ordinary player page, which simply waits (the host game
  never addresses it). Harmless; worth one sentence in §7.
- Two host phones is fine once the shell fans out (F7); the cap needs no
  per-game work.
- §4.3 "wake lock stays on" is already true (`shared/room-player.js:380-384`);
  it does not survive the phone being locked by hand, which is the F1 case.
- Revoking a role must clear the host key and the held view cannot exist
  (no frame is mounted in the lobby) — one line each in §4.1.

## Proposed spec edits

Replacement text, section by section. Sections not listed stand as written.

### §2 — replace the last two sentences

> While a host phone is **assigned** (connected or not), every game switches
> its shared screen to **answers private**: no answer is drawn on the laptop
> until the game reveals it to the room, or until the host presses the
> explicit per-item fallback button. The laptop keeps every control; the host
> phone is read-only in v1 and nothing it sends reaches a game.

### §3 — replace the whole section

> - A roster entry has `role: "player"` (default) or `role: "host"`.
> - **Only the laptop grants the role**, from the hub lobby roster row ("Make
>   host phone" / "Make player"). No phone→host message carries a role.
> - **The role is bound to the device.** On grant the hub creates a random
>   host key, stores it on the roster entry and sends it to that phone only;
>   the phone stores it with its pid and presents it when it rejoins. A join
>   that relinks onto a host-role entry **without the matching key** (another
>   device using that pid or that name) is seated as a `player`, the key is
>   cleared, and the laptop shows "‹name› rejoined from another device — host
>   phone role removed". The key is never in a lobby snapshot.
> - At most **two** host phones. Manual (phone-less) entries cannot hold the
>   role. Host phones count toward the room's player limit.
> - **Role changes only while no game is running** (control disabled in-game,
>   tooltip "Go to the lobby to change roles"). Kicking a host phone is allowed
>   at any time.
> - Host phones are **not contestants**: the hub never tells a game about them
>   as players, games never seat or score them, and anything a host phone
>   sends to a game is dropped by the hub. Points the same phone earned as a
>   player earlier in the night stay on the night scoreboard.
> - The role survives that phone reloading or reconnecting, a hub reload, and
>   a locked lobby; it is kept in the hub save.
> - The tag "Host phone" on the roster row is public; only what the phone
>   shows is secret.

### §4.1 — replace

> - `Player` (internal lobby state) gains `role` and `hostKey` (string or
>   null). `validateLobbyPlayer` accepts `role` (anything but `"host"` →
>   `"player"`); `lobbySnapshot` carries `role` and never `hostKey`;
>   `serializeLobby`/`restoreLobby` keep both. `playerList`/`playerCopy` (what
>   games see) return **contestants only and no `role` field**; a new
>   `hostPhoneList(state)` returns `[{pid,name,connected}]`.
> - `join` gains optional `hk` (string ≤ 64). `validateEnvelope` accepts it.
> - `lobbyReduce` event `setRole{pid, role, key}`: refused when
>   `state.activeGame` is set, when the pid is manual or unknown, or when it
>   would make a third host. Granting stores `key`; revoking clears it.
>   Effects: `send` to that phone `{v:2,t:"role",role,hk?}`, then
>   `broadcastLobby`.
> - Relink onto a host-role entry: role kept only if `event.hk === hostKey`;
>   otherwise demote, clear the key, add effect `{notice:"host-demoted",pid}`.
> - For a host-role pid, `join`/`leave`/`status`/`kick` emit
>   `{frame:{t:"host-phones"}}` instead of `player-join/leave/status`.
> - The phone learns its role from its own row in the `lobby` snapshot (the
>   single source); `joined` is unchanged.
> - Unit tests: grant/revoke; the three refusals; key match keeps the role;
>   relink by pid without the key and by name without the key both demote;
>   stale-then-takeover demotes; the key never appears in a snapshot;
>   `playerList` excludes host phones; host-pid roster events emit
>   `host-phones` and never `player-*`; persistence; junk roles; prototype-
>   shaped pids.

### §4.2 — replace

> - Roster row: "Host phone" tag and a "Make host phone" / "Make player"
>   button (secondary outline, 44 px, icon `phone`); disabled in-game. Roster
>   count reads "N players + H host phone(s)".
> - Tiles' player counts and "plays best with" hints count contestants only.
> - The game frame sees contestants only: `init.room.players` excludes host
>   phones; `init.room.hostPhones` and the new `{t:"host-phones",list}`
>   message carry `[{pid,name,connected}]`; `init.room.answersPrivate` is true
>   when any host-role entry exists.
> - New frame→shell message `{t:"host-view", m}`. The hub keeps the latest
>   one for the mounted frame, sends it to every host phone as
>   `{v:2,t:"game",g,m,h:1}`, and re-sends it when a host phone connects,
>   reconnects or is granted a key match. It is cleared when the frame is
>   unmounted. A `{t:"send",pid}` addressed to a host-role pid, and a
>   broadcast, are never delivered to host phones.
> - `game` payloads arriving **from** a host-role pid are dropped (not queued).
> - In-game shell bar shows "Host phone ●/○" (connected/away) next to the room
>   chip; "N connected" counts contestants.

### §4.3 — replace

> - Role is read from the phone's own `lobby` row. When it is `host`: the
>   waiting room reads "You're the host's second screen. Answers for each game
>   appear here — keep this phone to yourself." and the game frame URL gets
>   `&role=host` and **no `name=`** (a layout hint only).
> - The phone stores `{code,pid,name,avatar,hk}` and sends `hk` on every join.
> - An `h:1` game payload is forwarded to the frame as bridge `host-view`
>   only when the phone's own row says `host`; otherwise it is dropped.
> - A role change received while a frame is mounted (cannot normally happen)
>   remounts the frame.
> - Distinct header colour plus the word "Host" (colour is never the only
>   signal).

### §4.4 — replace

> - Host side: `room.players()` is unchanged in meaning and now simply never
>   contains a host phone (the hub filters). New: `room.hostPhones()` →
>   `[{pid,name,connected}]`; `room.answersPrivate()` → boolean;
>   `room.setHostView(view)` → hands the hub the current private view (call it
>   on every state change; the hub de-duplicates, caches and re-delivers);
>   handler `onHostPhones(list)` fires when the set or a connection changes.
>   `onPlayerJoin/Leave/Status/onMessage` never fire for a host phone.
> - Player side: `me.role`; new handler `onHostView(view)`. `onMessage` never
>   receives a host view.
> - All four additions exist on every room object (`makeRoomShell`):
>   standalone returns `[]`, `false`, no-op. Standalone roles are out of scope
>   for v1.
> - A host view larger than 16 KB is refused with a `console.warn` and
>   replaced by `{t:"host",item,tooBig:true}`.
> - `shared/virtual-peer.js` needs no change and must be shown by test not to
>   announce a host phone.

### §4.5 — add

> With no host-role entry, every existing unit test and browser harness passes
> unmodified. Harness additions: a phone that joins with a host pid and no key
> is seated as a player and receives no host view; a host phone marked stale
> keeps `answersPrivate` true; a host phone's `game` payload never reaches the
> frame; the virtual-peer hub holds no connection for a host pid.

### §5 — replace items 2, 4 and 5; add 6 and 7

> 2. **Room glue**: on every state change, `room.setHostView({ t:"host", item,
>    seq, ...hostView(state) })`. No cache, no resend logic, no use of
>    `room.send` for host data. Contestant `phoneView` is unchanged.
> 4. **Answers-private mode**: when `room.answersPrivate()` is true the shared
>    screen never renders answer text before the game's public reveal — the
>    game's own remembered reveal switches (keep-answers, peek, rated list,
>    "show to me") are ignored, and host-only answer lines are not created at
>    all. In their place: "Answer is on your host phone" while one is
>    connected; while none is connected, "Host phone disconnected" and a
>    single button **Show answer on this screen**, which reveals the current
>    item only and clears on the next item. Exception: a control that exists so
>    a *phone-less contestant* can see their own secret (Pyramid/Password giver
>    panels) stays available, behind its existing click and warning, while that
>    contestant has no connected phone. Public reveals that are part of the
>    show are unchanged.
> 5. **Tests**: unit — `hostView` holds the right answer at each phase, nothing
>    in phases with no secret, and nothing a host-played role must not know;
>    `phoneView` unchanged. Harness — a host-role frame receives the view via
>    `onHostView`; contestant frames never do; with a host phone assigned
>    (connected *and* disconnected) the answer string is absent from the host
>    document's text, `value`, `placeholder`, `<option>`, `title`, `alt`,
>    `aria-label` and `data-*`, and from `setTitle`, before the reveal; it
>    appears after the fallback button and disappears on the next item.
> 6. **Seat reconciliation on boot**: phone seats in the saved setup whose pid
>    is not in `room.players()` are removed; a running or resumable game that
>    seats such a pid keeps the seat, treats it as phone-less and shows one
>    notice.
> 7. **Host-phone page**: shows `item` beside the answer; dims and shows
>    "Reconnecting — this may be out of date" when the transport is down;
>    renders `tooBig` as "Too much to show — use the button on the laptop";
>    sends nothing. No buttons in v1.

Also in §5.1 change "≤ 8 KB" to "≤ 16 KB; lists are truncated (first N and a
count) rather than exceed it", and add: "A host view never contains
information a role the host is currently playing must not have."

### §6 — replace these rows

> | **Jeopardy** | Open clue: category, value, clue, **correct response**, "has an answer image" flag; Daily Double context; Final: clue + response; board: nothing secret. | Unchanged (upstream hides the response until "Reveal answer"; it is in the DOM but not visible, so the assertion for this game is on visible text). Host side: `gsc-embed.js` computes the view in `onStateChanged` and calls `room.setHostView`. Phone side: the hub omits `name=` for `role=host` so upstream's auto-join does not run; `gsc-embed.js` hides `#screen-player`, skips the stuck-join card and renders the host card from `onHostView`. No upstream edit. |
> | **Family Feud** | The full survey with tile numbers, counts, revealed ticks; strikes; Fast Money: the five questions with numbered answers and counts. | Unrevealed tiles stay blank (already). Fast Money's board-answer picker lists "Answer 1…N", not answer text. |
> | **The Chase** | Cash Builder: question + answer and the next question; head-to-head: question and options, **correct one marked — withheld until the Chaser has locked when the host is playing the Chaser**; Final Chase: question + answer and the next question. | The answer lines are not created. |
> | **Pyramid** | The category's seven words (current highlighted, passed/correct marked), the hint; Winner's Circle categories. | "Show words to me" / study is rendered only while the current giver has no connected phone; otherwise "Words are on your host phone". |
> | **Password** | The password and ladder position; Lightning Round: all five words. | "Show password to me" / study is rendered only while a current giver has no connected phone. |
> | **The Price Is Right** | Actual prices for the item(s) in play; both showcase totals. | No change (nothing private is rendered before its reveal today). |
> | **Deal or No Deal** | The banker's offer before it is announced and how it was computed. | No change. |

### §7 — replace step 2 and extend step 3

> 2. Then one agent per game in three waves: (a) Jeopardy, Weakest Link, The
>    Chase, Family Feud, Wheel; (b) Pyramid, Password, Chain Reaction,
>    Krillion, Match Game, Press Your Luck; (c) Millionaire, 1 vs 100, The
>    Price Is Right, Deal or No Deal (minimal views).
> 3. …also asserts: locking the host phone for 40 s mid-question leaves the
>    shared screen answer-free and shows the fallback button; a second phone
>    joining under the host phone's name or pid gets no host view and the role
>    is removed; a former contestant made host phone is reconciled out of each
>    game's setup; with no host phone assigned the whole existing suite passes
>    unchanged.

### §8 — add

> - A per-game or per-night "answers on this screen" preference (use the
>   per-item fallback button, or make the phone a player again).
> - Sending answer images to the host phone.
