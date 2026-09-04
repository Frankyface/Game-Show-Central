# 19 — Cross-cutting round: game lobby, question-set library, three fixes

Status: **approved** · Applies to every game (existing ten and the four new
ones). Behaviour additions only where stated; every harness stays green.

## 1. "Game lobby" button in every game

Problem: games auto-resume their saved state, and once you are past setup
there is no way back to the game's own start screen — only the hub's lobby.

Requirement (every game): a **Game lobby** control in the host toolbar (label
"⟲ Game lobby"; id `btn-game-lobby`; same place in every game, next to
Sound / Editor). It opens a small confirm with two choices:

- **Keep this game** — returns to the setup screen with the in-progress
  game preserved; the setup screen shows a **Resume** button (and the usual
  Start, which starts fresh).
- **Start over** — clears the in-progress game (roster, content and settings
  stay) and shows setup.

Both are undo-safe (no history mutation needed; the saved state carries a
`resumable` snapshot). Jeopardy: its upstream **New Game** already returns to
the start screen; make sure it is visible when embedded and add the same
confirm ("keep / start over") without changing upstream files beyond the
allowed list (a `// GSC:` hook or the adapter). Hub shell: nothing changes.

## 2. Question-set library in the repo

Every game gets a `sets/` folder with committed JSON files and a manifest:

```
games/<id>/sets/index.json     [{ "file": "kids.json", "name": "Kids' night", "description": "…", "by": "…" }]
games/<id>/sets/kids.json      a complete content file for that game
```

- `shared/library.js` (shell agent) exposes `GSCLibrary.load(gameDir)` →
  fetches `sets/index.json` (cache: "no-store"), validates the manifest shape
  (≤ 50 entries; `file` is a bare `*.json` name, no slashes), and
  `GSCLibrary.fetchSet(gameDir, file)`. It also renders a picker into a
  container: `GSCLibrary.mountPicker(container, { gameDir, onPick(json,
  meta), validate })` — a labelled `<select>` of sets plus a **Load set**
  button, an inline error line, and a **Preview** line (name, description,
  counts from the manifest). Works from disk too: if the manifest cannot be
  fetched, the picker says so in plain English and hides.
- Each game's setup screen mounts the picker under the existing "Questions"
  / content section; loading a set goes through the game's own
  `validateGame` and becomes the current content (source note: "set: Kids'
  night").
- Each game's **editor** gets **Save to library** guidance: a "Download for
  the library" button that downloads the JSON *and* shows the exact manifest
  line to paste into `sets/index.json` plus the path to commit to. (Static
  hosting cannot write files; this is the honest workflow and the README
  documents it.)
- Ship at least **two** extra sets per game (themed, original content, same
  quality bar as the default file: e.g. "Kids' night", "Movies & TV",
  "Office party", "90s"). The default file stays the default.
- The hub landing/lobby is unchanged; a future hub-level library page is out
  of scope.

## 3. Game fixes

- **The Price Is Right — prize photos.** Every prize/item (`oneBid[]`,
  `cliffhangers[].items[]` and `.prize`, `luckyseven[]`, `showcases[].prizes[]`)
  accepts an optional `image` (https URL, repo-relative path, or data URI)
  and `imageAlt`, validated by the same gate Jeopardy uses (copy
  `games/jeopardy/js/media.js` semantics: `validateImageRef`; reject
  `javascript:`/`data:` non-image). The editor gets the 📷 control per item
  with **paste URL** or **Choose file…** (downscale + compress in the browser
  as Jeopardy's `editor-media.js` does; embedded-size meter). Host screens
  show the photo on the item card (One Bid card, Cliff Hangers item, Lucky
  Seven car, Showcase prize list); phones never receive images.
- **Deal or No Deal — case animation.** Only the case being opened animates;
  already-open cases and the untouched grid must not re-run their flip on
  every render, and nothing on the grid animates when the Banker calls. Track
  the last-opened case and key the animation class on it only (or animate
  via a one-shot class removed after `animationend`). Pin with a harness
  check: after opening case 7, only case 7 has the animating class; after a
  banker offer, no case does.
- **Chain Reaction — phone column.** The phone's chain must look like the
  show: each word is one row of letter tiles, rows stacked vertically and
  centred, revealed letters in tiles, hidden letters as blank tiles, the top
  and bottom words fully shown, the frontier rows highlighted. No
  letter-spacing tricks; a real tile grid (`display:grid` per row with
  `repeat(n, 1fr)`), sized to fit 320 px for a 12-letter word.

## 4. Verification (per game, by the assigned tester of the new games and
by a cross-cutting tester for the existing ten)

- **X-1** `btn-game-lobby` exists in every game's toolbar; Keep → setup with
  Resume that restores the exact state; Start over → clean setup with roster
  and content intact; both from every phase; embedded and standalone.
- **X-2** library picker lists the shipped sets, loads one (validated),
  source note updates, a broken manifest shows a message; from disk the
  picker hides with a message.
- **X-3** editor "Download for the library" produces a valid file and the
  manifest line.
- **X-4** the three game fixes as specified (photos render and never reach
  phones; only the opened case animates; the phone chain is a tile grid).
- **X-5** every existing harness and `node --test` still green; static gates.
