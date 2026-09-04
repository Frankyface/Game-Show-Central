/* ============================================================
   Game Show Central — the game registry
   One entry per game folder. The hub builds its lobby tiles and its
   iframe URLs from this list and nothing else, so adding a game is a
   one-object change. Paths are relative to the site root so the hub
   works under any GitHub Pages base path.
   `players:[min,max]` is advisory only — a tile is never disabled by
   player count; the lobby shows a soft hint instead.
   ============================================================ */

"use strict";

const GAME_REGISTRY = [
  {
    id: "jeopardy", name: "Jeopardy", path: "games/jeopardy/", icon: "🟦", accent: "#060ce9",
    tagline: "The classic answer-and-question board.",
    phone: ["buzzers", "wagers", "final answers"], players: [1, 8],
  },
  {
    id: "family-feud", name: "Family Feud", path: "games/family-feud/", icon: "🎤", accent: "#c8102e",
    tagline: "Survey says…",
    phone: ["face-off buzzers", "fast money"], players: [2, 16], teams: true,
  },
  {
    id: "wheel-of-fortune", name: "Wheel of Fortune", path: "games/wheel-of-fortune/", icon: "🎡", accent: "#7b2cbf",
    tagline: "Spin, call a letter, solve the puzzle.",
    phone: ["spin", "letters", "solve", "toss-up buzzers"], players: [1, 6],
  },
  {
    id: "weakest-link", name: "Weakest Link", path: "games/weakest-link/", icon: "🔗", accent: "#8a0303",
    tagline: "Bank it before the chain breaks.",
    phone: ["secret votes"], players: [3, 12],
  },
  {
    id: "millionaire", name: "Millionaire", path: "games/millionaire/", icon: "💎", accent: "#1d2a7a",
    tagline: "Fifteen questions. One hot seat.",
    phone: ["fastest finger", "hot seat", "ask the audience"], players: [1, 16],
  },
  {
    id: "price-is-right", name: "The Price Is Right", path: "games/price-is-right/", icon: "🏷️", accent: "#e63946",
    tagline: "Come on down. Closest without going over.",
    phone: ["secret bids", "plinko", "big wheel"], players: [1, 16],
  },
  {
    id: "pyramid", name: "Pyramid", path: "games/pyramid/", icon: "🔺", accent: "#f4b400",
    tagline: "Describe it. Guess it. Beat the clock.",
    phone: ["secret words for the giver", "got it / pass"], players: [2, 16], teams: true,
  },
  {
    id: "deal-or-no-deal", name: "Deal or No Deal", path: "games/deal-or-no-deal/", icon: "💼", accent: "#b5121b",
    tagline: "Twenty-six cases. One banker.",
    phone: ["pick cases", "deal or no deal", "audience advice"], players: [1, 16],
  },
];

const HubRegistry = (function () {
  "use strict";

  /** @returns {object|null} the entry with this id. */
  function find(id) {
    return GAME_REGISTRY.find((g) => g.id === id) || null;
  }

  /** The page inside a game folder — always index.html for real games. */
  function pageOf(game) {
    return game.page || "index.html";
  }

  /** Host iframe URL for a game. */
  function hostUrl(game, code) {
    return `${game.path}${pageOf(game)}?embed=host&room=${encodeURIComponent(code || "")}`;
  }

  /** Phone iframe URL for a game — name and pid ride along for games that read them. */
  function playerUrl(game, code, pid, name) {
    const q = [
      "embed=player",
      `room=${encodeURIComponent(code || "")}`,
      `pid=${encodeURIComponent(pid || "")}`,
      `name=${encodeURIComponent(name || "")}`,
    ].join("&");
    return `${game.path}${pageOf(game)}?${q}`;
  }

  /** "Plays best with 4+" style hint, or "" when the roster suits the game. */
  function playerHint(game, count) {
    const min = game.players && game.players[0];
    const max = game.players && game.players[1];
    if (Number.isFinite(min) && count < min) return `${game.name} plays best with ${min}+ players.`;
    if (Number.isFinite(max) && count > max) return `${game.name} is built for up to ${max} players.`;
    return "";
  }

  /**
   * Add a tile at runtime. Used by tests/hub-harness.html (and, temporarily, by
   * a T3 smoke run) to point a tile at a page outside games/. Production code
   * never calls it; the four shipped games are the literal list above.
   */
  function register(entry) {
    if (!entry || !entry.id || find(entry.id)) return null;
    GAME_REGISTRY.push(entry);
    return entry;
  }

  return { all: () => GAME_REGISTRY.slice(), find, hostUrl, playerUrl, playerHint, register, pageOf };
})();

if (typeof module === "object" && module.exports) module.exports = { GAME_REGISTRY, HubRegistry };
if (typeof globalThis !== "undefined") {
  globalThis.GAME_REGISTRY = GAME_REGISTRY;
  globalThis.HubRegistry = HubRegistry;
}
