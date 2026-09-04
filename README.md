# Game Show Central

Game shows for your video call. The host opens one page, shares their screen,
and reads out a four-letter room code. Everyone else opens the same site on
their phone, types the code and their name **once**, and stays connected while
the host hops between games: Jeopardy, Family Feud, Wheel of Fortune,
Weakest Link, Who Wants to Be a Millionaire, The Price Is Right, Pyramid, Deal
or No Deal, Password, Chain Reaction, The Chase, 1 vs 100, Press Your Luck and
Match Game.

No accounts. No server. No install. It is a folder of static files —
HTML, CSS and plain JavaScript — that runs from GitHub Pages, from any web
server, or straight off your hard drive.

---

## Deploy it in five minutes

1. Fork or download this repository.
2. In your fork: **Settings → Pages → Build and deployment**.
3. Source: **Deploy from a branch**. Branch: `main`, folder: `/ (root)`.
4. Save. A minute later your site is at
   `https://<your-username>.github.io/<repo-name>/`.
5. Open that URL on the machine you will screen-share from. Done.

Phones need that same public URL, so a GitHub Pages deploy (or any other
public host) is what makes the phone features work. Everything else — the
whole game, every score, every question — works fine from `file://` with no
internet at all; only the phones need a network.

**Running it locally**

```bash
python -m http.server 8620      # from the repository root
# then open http://localhost:8620/
```

Phones on the same Wi-Fi can join a locally served game if they can reach your
computer's IP (`http://192.168.x.x:8620/`).

---

## How a game night works

### The host

1. Open the site and press **Host a game night**. A room opens and a huge
   room code appears. Screen-share this window.
2. Read the code out, or paste the join link into the chat.
3. Players appear on the roster as they join, each with a colour and an emoji.
   Somebody playing without a phone? Press **+ Add player** and type their
   name — games will score them just the same, you just play their turns.
4. Press **Play** on a game tile. The game fills the screen, the phones follow
   automatically, and a slim bar across the top keeps the room code, the
   connected count and a **⌂ Lobby** button in reach.
5. **⌂ Lobby** goes back to the tiles. Every game saves its own progress in the
   browser, so you can leave Family Feud half-finished, play a Wheel round, and
   come back to it.

Don't fancy phones at all? Press **Play without phones**. Every game is fully
playable by the host alone, with the scoring buttons on screen. You can open
the room later from the lobby at any time.

### The players

1. Open the site on a phone (the host's link, or type the address and tap
   **Join on your phone**).
2. Type the four-letter code, a name, tap an emoji, press **Join**.
3. Wait in the lobby. When the host starts a game your phone becomes whatever
   that game needs — a buzzer, a wager pad, a voting card.
4. If your phone sleeps, drops Wi-Fi, or you reload the page, it comes back as
   the same player automatically. You never re-enter the code.

---

## Lobby reference

| Control | What it does |
|---|---|
| **Copy link** | Puts `…/?room=CODE` on the clipboard for the chat window. |
| **🔊 Sound** | The small chime when somebody joins. Remembered per browser. |
| **Lock lobby** | Stops new players joining. Anyone already in can still reconnect. |
| **Close room** | Ends the phone side. Everyone sees "The host closed the room." The games keep working. |
| **Kick** | Removes one player. Their phone goes back to the join screen. |
| **+ Add player** | A player with no phone. Renameable, removable, scoreable. |
| **Tonight's scoreboard** | Running totals across every game that reported standings. **Reset night** clears it. |

Room codes are four characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no
I, L, O, 0 or 1, so nobody mis-reads them over a bad microphone.

---

## Playing a game on its own

Every game also works as its own page, with its own room, without the hub:

- `games/jeopardy/`
- `games/family-feud/`
- `games/wheel-of-fortune/`
- `games/weakest-link/`
- `games/millionaire/`
- `games/price-is-right/`
- `games/pyramid/`
- `games/deal-or-no-deal/`
- `games/password/`
- `games/chain-reaction/`
- `games/the-chase/`
- `games/one-vs-100/`
- `games/press-your-luck/`
- `games/match-game/`

Open one directly and it shows its own "Open room (phones)" button; the join
link is that game's URL with `?room=CODE`. This is the mode to use if you only
ever play one game, or if you want to send somebody a single link.

## Customising a game

Each game reads its questions from a JSON file and ships with an in-page
editor. In every game you can:

- edit the content in the browser and press **Use in game**,
- press **Download JSON** to keep your pack,
- upload a pack you saved earlier,
- load one straight off the web with `?game=https://…/my-pack.json`,
- or replace the game's own `.json` file in your fork so it is the default.

The JSON schema, the editor's quirks and the phone features are documented in
each game's own README:

- [`games/jeopardy/README.md`](games/jeopardy/README.md)
- [`games/family-feud/README.md`](games/family-feud/README.md)
- [`games/wheel-of-fortune/README.md`](games/wheel-of-fortune/README.md)
- [`games/weakest-link/README.md`](games/weakest-link/README.md)
- [`games/millionaire/README.md`](games/millionaire/README.md)
- [`games/price-is-right/README.md`](games/price-is-right/README.md)
- [`games/pyramid/README.md`](games/pyramid/README.md)
- [`games/deal-or-no-deal/README.md`](games/deal-or-no-deal/README.md)
- [`games/password/README.md`](games/password/README.md)
- [`games/chain-reaction/README.md`](games/chain-reaction/README.md)
- [`games/the-chase/README.md`](games/the-chase/README.md)
- [`games/one-vs-100/README.md`](games/one-vs-100/README.md)
- [`games/press-your-luck/README.md`](games/press-your-luck/README.md)
- [`games/match-game/README.md`](games/match-game/README.md)

---

## Project layout

```
index.html              the hub: lobby (host) and phone controller (?room=CODE)
css/hub.css             hub styles
js/hub-registry.js      the list of games and their tiles
js/hub-host.js          host shell: room, roster, lobby UI, game iframe
js/hub-player.js        phone shell: join, waiting room, game iframe
js/hub-night.js         tonight's running scoreboard
shared/theme.css        design tokens, buttons, utilities — used by every page
shared/room-protocol.js pure: room codes, message validation, the roster reducer
shared/room-net.js      shared ICE config, timings and reconnect logic
shared/room-host.js     the host's side of the connection
shared/room-player.js   the phone's side of the connection
shared/bridge.js        the GSC SDK games are written against
shared/virtual-peer.js  a PeerJS-shaped shim so Jeopardy runs inside the hub
games/<id>/             one folder per game — its page, code, content and tests
tests/                  hub unit tests (node --test) and browser harnesses
docs/                   the specs everything was built from
```

## Under the hood

- Phones connect straight to the host's browser over WebRTC using
  [PeerJS](https://peerjs.com) 1.5.5, loaded from cdnjs with a Subresource
  Integrity hash and only ever when a room actually opens. Nothing else is
  fetched from the internet except Google Fonts.
- Nothing is uploaded anywhere. There is no database and no analytics. Your
  questions live in your fork; your scores live in your browser.
- The host is the referee. Every message a phone sends is checked for shape,
  type and size before it is allowed near the game, and no phone can score
  itself or move the game on.

## Troubleshooting

**A phone says "Can't reach the room server."**
WebRTC is blocked, or the phone has no route to the host. Put both on the same
Wi-Fi, or switch the phone between Wi-Fi and mobile data. Corporate and campus
networks are the usual culprit.

**A phone opened the link inside Instagram / Facebook / TikTok.**
Those in-app browsers frequently break WebRTC. The join screen says so when it
detects one: tap the `⋯` menu and choose **Open in Safari** or **Open in
Chrome**.

**The room code says "Couldn't reach the room server".**
The host's browser could not register with the PeerJS broker. Check the host's
internet, then press **Open room** again. Games keep working without phones in
the meantime.

**"That name is taken — add an initial."**
Somebody connected is already using that name. Names are compared without
regard to case.

**A game tile opens a blank frame.**
That game's folder is not on the site yet (or the deploy is still building).
The shell bar says which page it could not load.

**Scores or questions vanished.**
Everything is kept in this browser's `localStorage`. A private window, a
"clear site data", or a full disk will lose it. Download your JSON packs if
they matter.

**"Couldn't save this game night — browser storage is full or blocked."**
Same cause. The night keeps playing; it just will not survive a refresh.

## Development

```bash
node --test                     # hub + shared unit tests, from the repo root
cd games/<id> && node --test    # one game's unit tests
python -m http.server 8620      # then open /tests/hub-harness.html
```

No build step, no bundler, no npm dependencies — `node:test` is the only test
runner and it ships with Node. House rules for anyone extending this live in
[`CLAUDE.md`](CLAUDE.md); the design specs are in [`docs/`](docs/).

## Credits

The Jeopardy game is vendored from
[Frankyface/Jeopardy](https://github.com/Frankyface/Jeopardy) (see
`games/jeopardy/UPSTREAM_COMMIT`); its buzzer stack is the field-tested code
the hub's room transport is built from. Jeopardy!, Family Feud, Wheel of
Fortune, The Weakest Link, Who Wants to Be a Millionaire, The Price Is Right,
The $100,000 Pyramid, Deal or No Deal, Password, Chain Reaction, The Chase,
1 vs 100, Press Your Luck and Match Game are trademarks of
their respective owners; this is
an unaffiliated fan project for playing at home.

## Build status and known issues

Every component was built to a written spec (`docs/00`–`07`) and verified by an
independent tester against that spec's success states — unit tests, browser
harnesses, real PeerJS/WebRTC rooms, standalone play and static gates. The
verdicts, the defects found and fixed, and the open known issues are collected
in [docs/reports/00-orchestrator-triage.md](docs/reports/00-orchestrator-triage.md);
each component has an implementation and a verification report beside it.

```bash
node --test   # runs every suite in the repo (shell, shared, all four games)
```
