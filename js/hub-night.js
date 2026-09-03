/* ============================================================
   Game Show Central — tonight's scoreboard (SHOULD, spec §1.2)
   Games report standings through the bridge `scores` message; the hub
   keeps the LATEST report per game and shows the running total across
   the night. Pure bookkeeping over a serialisable object: no DOM
   handles, no timers, nothing that cannot go into localStorage.
   ============================================================ */

"use strict";

const HubNight = (function () {
  "use strict";

  const NAME_MAX = 24;

  /** @returns {{games:Record<string, Array<{pid:string|null,name:string,score:number}>>}} */
  function createNight() {
    return { games: {} };
  }

  /** Keep only well-formed rows; a junk report is ignored entirely. */
  function cleanScores(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const row of raw.slice(0, 32)) {
      if (!row || typeof row !== "object") continue;
      const score = Number(row.score);
      if (!Number.isFinite(score)) continue;
      const pid = typeof row.pid === "string" && row.pid ? row.pid : null;
      const name = typeof row.name === "string" ? row.name.slice(0, NAME_MAX).trim() : "";
      if (!pid && !name) continue;
      out.push({ pid, name, score: Math.round(score) });
    }
    return out;
  }

  /**
   * Immutably record one game's standings.
   * @returns {object} the next night state (unchanged on junk).
   */
  function recordScores(night, gameId, scores) {
    const rows = cleanScores(scores);
    if (!rows || typeof gameId !== "string" || !gameId) return night;
    return { ...night, games: { ...night.games, [gameId]: rows } };
  }

  /** Forget a single game's contribution. */
  function clearGame(night, gameId) {
    if (!night.games[gameId]) return night;
    const games = { ...night.games };
    delete games[gameId];
    return { ...night, games };
  }

  function resetNight() {
    return createNight();
  }

  /**
   * Running totals across every game, highest first. `players` (the lobby
   * roster) supplies the display name and colour when a row carries a pid.
   * @returns {Array<{key:string, name:string, color:string|null, total:number, games:number}>}
   */
  function totals(night, players) {
    const byKey = new Map();
    const roster = new Map((players || []).map((p) => [p.pid, p]));
    for (const gameId of Object.keys(night.games)) {
      for (const row of night.games[gameId]) {
        const key = row.pid || `name:${row.name.toLowerCase()}`;
        const known = roster.get(row.pid);
        const entry = byKey.get(key) || {
          key,
          name: (known && known.name) || row.name || "Player",
          color: known ? known.color : null,
          total: 0,
          games: 0,
        };
        if (known) { entry.name = known.name; entry.color = known.color; }
        entry.total += row.score;
        entry.games += 1;
        byKey.set(key, entry);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  /** Restore from localStorage, tolerating anything. */
  function restoreNight(saved) {
    const fresh = createNight();
    if (!saved || typeof saved !== "object" || !saved.games || typeof saved.games !== "object") return fresh;
    const games = {};
    for (const id of Object.keys(saved.games)) {
      const rows = cleanScores(saved.games[id]);
      if (rows && rows.length) games[id] = rows;
    }
    return { games };
  }

  /** Has anything been reported yet? */
  function isEmpty(night) {
    return Object.keys(night.games).length === 0;
  }

  return { createNight, recordScores, clearGame, resetNight, totals, restoreNight, isEmpty, cleanScores };
})();

if (typeof module === "object" && module.exports) module.exports = HubNight;
if (typeof globalThis !== "undefined") globalThis.HubNight = HubNight;
