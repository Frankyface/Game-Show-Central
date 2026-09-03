# Game Show Central — house rules

Static, no-build, vanilla-JS game-show hub for GitHub Pages. Read
`docs/00-architecture.md` first; every game has its own spec in `docs/`.

## Hard rules (every file, every agent)

- **No build step, no npm deps, no bundler, no framework.** Plain `<script>`
  tags, `"use strict"`, browser globals. `node:test` is the only test runner.
  PeerJS (pinned `1.5.5`, cdnjs, SRI) is the single runtime CDN dependency and
  is loaded lazily only when a room opens. Google Fonts are allowed.
- **`textContent` only.** Zero `innerHTML`, `insertAdjacentHTML`, `outerHTML =`,
  `document.write`, `eval`, `new Function`. Build DOM with `document.createElement`.
- **Pure core + thin glue.** Game rules live in a pure, immutable reducer file
  (`<game>-core.js`) that runs in Node AND the browser (UMD pattern copied from
  `games/jeopardy/js/buzzer-protocol.js`). DOM/transport/timers are injected or
  kept in separate glue files. Reducers never mutate inputs.
- **Host is authoritative.** Every phone message is validated (shape, type,
  size caps, control-char stripping) before it touches state. Phones never
  auto-score, never auto-advance; the host judges with buttons.
- **Everything works without phones.** Phones are optional. A host alone with
  a screen share must be able to run every game end to end.
- **Files < 800 lines; functions < ~50 lines** (or leave a comment justifying).
- **Every failure path surfaces a plain-English message** in the UI.
  `console.warn` for diagnostics is fine; `console.log` is not.
- **State is one serialisable object** updated with immutable patches through
  `setState`, saved to `localStorage`, restored on reload. Never put Peer,
  connection, DOM or timer handles in state.
- **JSON-driven content** with a `validate*` function, an in-page editor with
  **Download JSON** / **Use in game**, `?game=URL` loading, file upload, and a
  `data.js` offline fallback — exactly the Jeopardy pattern.
- **Accessibility:** buttons are `<button>`, dialogs use `role="dialog"`,
  live regions for scores, colour is never the only signal, honour
  `prefers-reduced-motion`. Phone UIs must work at 320px wide, portrait.
- **Visual language:** each game has its own palette (see its spec) but shares
  `shared/theme.css` tokens, `Anton` display + `Inter` UI fonts, `.btn`
  conventions. Big, projector-readable type on host screens.
- Do **not** run `git commit`/`git push` unless your task says so. The
  orchestrator commits.

## Layout

```
index.html                 hub: lobby (host) + phone controller (?room=CODE)
js/, css/                  hub-only code
shared/                    room transport, bridge SDK, virtual peer, theme
games/<id>/index.html      one page per game (host UI + phone UI)
games/<id>/js|css|tests    game code, pure core, editor, tests
games/jeopardy/            vendored from Frankyface/Jeopardy (see UPSTREAM_COMMIT)
tests/                     hub-level node:test + browser harnesses
docs/                      specs (00–07) and verification reports
```

## Running things

```bash
node --test                          # hub + shared unit tests (from repo root)
cd games/<id> && node --test         # a game's own unit tests
python -m http.server 8620           # serve for browser harnesses / manual play
```
