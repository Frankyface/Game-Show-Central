/* ============================================================
   The hub card accent bar (js/hub-registry.js `accent`) must be the
   game's canonical accent in shared/theme.css, so the first screen
   anyone sees never contradicts the game it opens
   (docs/reports/ui-consistency-implementation.md, item 1).
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GAME_REGISTRY } = require("../js/hub-registry.js");
const css = readFileSync(new URL("../shared/theme.css", import.meta.url), "utf8");

function themeAccent(id) {
  const at = css.indexOf(`[data-gsc-game="${id}"]`);
  if (at < 0) return null;
  const block = css.slice(at, css.indexOf("}", at));
  const m = block.match(/--accent:\s*(#[0-9a-fA-F]{3,8})/);
  return m ? m[1].toLowerCase() : null;
}

test("every registry entry's accent matches its --accent in shared/theme.css", () => {
  for (const game of GAME_REGISTRY) {
    const want = themeAccent(game.id);
    assert.ok(want, `${game.id} has no [data-gsc-game] accent block in theme.css`);
    assert.equal(game.accent.toLowerCase(), want, `${game.id}: card bar ${game.accent} vs theme ${want}`);
  }
});
