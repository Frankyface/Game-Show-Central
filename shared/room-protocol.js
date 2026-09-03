/* ============================================================
   Game Show Central — room protocol core (PURE)
   Room codes, envelope validation/sanitisation for the v2 phone⇄host
   protocol (docs/00-architecture.md §5), and the lobby reducer that
   owns the roster. No DOM, no PeerJS, no app globals — the only side
   effect is attaching the export. Runs in the browser
   (globalThis.RoomProtocol) and in Node (module.exports) so node:test
   can exercise it directly. Reducers are pure and immutable: they
   never mutate their inputs and never throw on junk.
   Shape and conventions copied from games/jeopardy/js/buzzer-protocol.js.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RoomProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ============ Constants ============ */

  // A–Z and 2–9 minus the visually ambiguous I, L, O, 0, 1 (Jeopardy's alphabet).
  const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const ROOM_CODE_LEN = 4;
  // Deliberately broader than ROOM_ALPHABET so a restored/typed code normalises.
  const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;
  const PEER_PREFIX = "gsc-";

  const NAME_MAX = 24; // display cap
  const NAME_FIELD_MAX = 240; // structural cap (~10×) at the validation boundary
  const GAME_ID_MAX = 40;
  const MAX_PLAYERS_CAP = 16;
  const DEFAULT_MAX_PLAYERS = 12;
  const PAYLOAD_MAX_BYTES = 32768; // 32 KB serialised game payload

  // C0 controls + DEL + C1 controls, built from escapes so this file stays
  // pure printable ASCII.
  const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

  // 12 avatars; the phone picker offers exactly these and the host validates
  // against the list so a crafted message can never inject arbitrary text.
  const AVATARS = ["🦊", "🐼", "🐙", "🐝", "🦖", "🐧", "🦁", "🐸", "🦄", "🐳", "🦉", "🐰"];

  // 12 distinct, colour-blind-friendly hexes (Okabe–Ito extended). Colour is
  // never the only signal anywhere in the UI — names and emoji always ride along.
  const COLORS = [
    "#e69f00", "#56b4e9", "#009e73", "#f0e442",
    "#0072b2", "#d55e00", "#cc79a7", "#999999",
    "#8dd3c7", "#bebada", "#fb8072", "#b3de69",
  ];

  const REJECT_REASONS = new Set(["name-taken", "room-full", "bad-name", "locked"]);

  /* ============ Typedefs ============ */

  /**
   * @typedef {{pid:string, name:string, color:string, avatar:string,
   *            connected:boolean, manual:boolean}} Player
   * @typedef {{players:Record<string,Player>, order:string[], locked:boolean,
   *            maxPlayers:number, activeGame:string|null, nextId:number,
   *            peers:Record<string,string>}} LobbyState
   * @typedef {{send:{to:string, msg:object}}} SendEffect
   * @typedef {{broadcastLobby:true}} BroadcastEffect
   * @typedef {{close:string}} CloseEffect
   * @typedef {{frame:object}} FrameEffect — a bridge message for the host game iframe.
   * @typedef {SendEffect|BroadcastEffect|CloseEffect|FrameEffect} Effect
   */

  /* ============ Room codes ============ */

  /**
   * 4 characters from ROOM_ALPHABET. `randFn` is injectable so tests are
   * deterministic.
   * @param {() => number} [randFn]
   * @returns {string}
   */
  function generateRoomCode(randFn) {
    const rand = typeof randFn === "function" ? randFn : Math.random;
    let code = "";
    for (let i = 0; i < ROOM_CODE_LEN; i += 1) {
      const idx = Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length;
      code += ROOM_ALPHABET.charAt(idx);
    }
    return code;
  }

  /** @param {unknown} s @returns {boolean} */
  function isRoomCode(s) {
    return typeof s === "string" && ROOM_CODE_RE.test(s);
  }

  /** Uppercase + trim a typed code, or "" when it is not code-shaped. */
  function normalizeRoomCode(s) {
    if (typeof s !== "string") return "";
    const up = s.trim().toUpperCase();
    return ROOM_CODE_RE.test(up) ? up : "";
  }

  /* ============ Sanitising ============ */

  /**
   * Clean a player-supplied name: strip control chars, trim, cap at 24.
   * @param {unknown} raw
   * @returns {string|null} null when empty/invalid.
   */
  function sanitizeName(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.replace(CONTROL_CHARS, "").trim();
    if (!trimmed) return null;
    return trimmed.slice(0, NAME_MAX).trim() || null;
  }

  /**
   * Only an exact member of AVATARS survives; everything else → null.
   * @param {unknown} raw
   * @returns {string|null}
   */
  function sanitizeAvatar(raw) {
    if (typeof raw !== "string") return null;
    return AVATARS.indexOf(raw) === -1 ? null : raw;
  }

  /** UTF-8 byte length without depending on TextEncoder/Buffer. */
  function utf8Bytes(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i += 1; } // surrogate pair
      else bytes += 3;
    }
    return bytes;
  }

  /**
   * True when a game payload is larger than the 32 KB cap (or not serialisable —
   * a cyclic object is refused rather than thrown on).
   * @param {unknown} m
   * @returns {boolean}
   */
  function payloadTooBig(m) {
    let json;
    try {
      json = JSON.stringify(m === undefined ? null : m);
    } catch (err) {
      return true;
    }
    if (typeof json !== "string") return true;
    return utf8Bytes(json) > PAYLOAD_MAX_BYTES;
  }

  /* ============ Envelope validation (00 §5) ============ */

  /**
   * Validate + normalise a decoded v2 envelope (either direction). Returns a
   * message carrying only the known fields, or null for anything malformed or
   * unknown, so receivers can ignore junk without throwing.
   * @param {unknown} obj
   * @returns {object|null}
   */
  function validateEnvelope(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const m = /** @type {Record<string, unknown>} */ (obj);
    if (m.v !== 2 || typeof m.t !== "string") return null;
    switch (m.t) {
      case "join": return validateJoin(m);
      case "ping": return { v: 2, t: "ping" };
      case "pong": return { v: 2, t: "pong" };
      case "game": return validateGame(m);
      case "avatar": {
        const emoji = sanitizeAvatar(m.emoji);
        return emoji ? { v: 2, t: "avatar", emoji } : null;
      }
      case "joined": return validateJoined(m);
      case "reject":
        if (typeof m.reason !== "string" || !REJECT_REASONS.has(m.reason)) return null;
        return { v: 2, t: "reject", reason: m.reason };
      case "lobby": return validateLobby(m);
      case "room-closed": return { v: 2, t: "room-closed" };
      case "kicked": return { v: 2, t: "kicked" };
      // ADDITION to 00 §5 (documented in docs/reports/shell-implementation.md):
      // the carrier for bridge `close` (00 §6) — a host game closed one phone's
      // virtual connection, so that phone's game iframe must get `conn-close`.
      case "conn-close":
        if (typeof m.g !== "string" || !m.g || m.g.length > GAME_ID_MAX) return null;
        return { v: 2, t: "conn-close", g: m.g };
      default: return null;
    }
  }

  function validateJoin(m) {
    if (typeof m.name !== "string" || m.name.length > NAME_FIELD_MAX) return null;
    const out = { v: 2, t: "join", name: m.name };
    if (m.avatar !== undefined) {
      if (typeof m.avatar !== "string") return null;
      const avatar = sanitizeAvatar(m.avatar);
      if (avatar) out.avatar = avatar; // an unknown emoji is dropped, not fatal
    }
    if (m.pid !== undefined) {
      if (!isPid(m.pid)) return null;
      out.pid = m.pid;
    }
    return out;
  }

  function validateGame(m) {
    if (typeof m.g !== "string" || !m.g || m.g.length > GAME_ID_MAX) return null;
    if (m.m === undefined) return null;
    if (payloadTooBig(m.m)) return null;
    return { v: 2, t: "game", g: m.g, m: m.m };
  }

  function validateJoined(m) {
    const name = sanitizeName(m.name);
    if (!isPid(m.pid) || !name) return null;
    if (typeof m.color !== "string" || m.color.length > 24) return null;
    const avatar = sanitizeAvatar(m.avatar);
    if (!avatar) return null;
    return { v: 2, t: "joined", pid: m.pid, name, color: m.color, avatar };
  }

  function validateLobby(m) {
    if (m.game !== null && (typeof m.game !== "string" || m.game.length > GAME_ID_MAX)) return null;
    if (!Array.isArray(m.players) || m.players.length > MAX_PLAYERS_CAP) return null;
    const players = [];
    for (const raw of m.players) {
      const p = validateLobbyPlayer(raw);
      if (!p) return null;
      players.push(p);
    }
    return { v: 2, t: "lobby", game: m.game, players };
  }

  function validateLobbyPlayer(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const name = sanitizeName(raw.name);
    const avatar = sanitizeAvatar(raw.avatar);
    if (!isPid(raw.pid) || !name || !avatar) return null;
    if (typeof raw.color !== "string" || raw.color.length > 24) return null;
    if (typeof raw.connected !== "boolean") return null;
    return {
      pid: raw.pid, name, color: raw.color, avatar,
      connected: raw.connected, manual: raw.manual === true,
    };
  }

  /** A player id the host assigned: "p" + digits, short. */
  function isPid(v) {
    return typeof v === "string" && /^p[0-9]{1,6}$/.test(v);
  }

  /* ============ Message builders ============ */

  function joinedMsg(player) {
    return { v: 2, t: "joined", pid: player.pid, name: player.name, color: player.color, avatar: player.avatar };
  }
  function rejectMsg(reason) { return { v: 2, t: "reject", reason }; }
  function gameMsg(g, m) { return { v: 2, t: "game", g, m }; }

  /* ============ Lobby state ============ */

  /** @returns {LobbyState} */
  function createLobbyState() {
    return {
      players: {}, order: [], locked: false, maxPlayers: DEFAULT_MAX_PLAYERS,
      activeGame: null, nextId: 1, peers: {},
    };
  }

  /**
   * The `lobby` broadcast payload (00 §5). Players are listed in join order.
   * @param {LobbyState} state
   */
  function lobbySnapshot(state) {
    return {
      v: 2, t: "lobby", game: state.activeGame,
      players: state.order.map((pid) => {
        const p = state.players[pid];
        return {
          pid: p.pid, name: p.name, color: p.color, avatar: p.avatar,
          connected: p.connected, manual: p.manual,
        };
      }),
    };
  }

  /** Immutable snapshot of one player (what games see). */
  function playerCopy(p) {
    return { pid: p.pid, name: p.name, color: p.color, avatar: p.avatar, connected: p.connected, manual: p.manual };
  }

  /** All players, in order, as immutable copies. */
  function playerList(state) {
    return state.order.map((pid) => playerCopy(state.players[pid]));
  }

  /** First unused colour, else cycle by roster length so we never run dry. */
  function pickColor(state) {
    const used = new Set(state.order.map((pid) => state.players[pid].color));
    for (const c of COLORS) if (!used.has(c)) return c;
    return COLORS[state.order.length % COLORS.length];
  }

  /** Deterministic avatar fallback (the phone normally sends its own choice). */
  function pickAvatar(state) {
    const used = new Set(state.order.map((pid) => state.players[pid].avatar));
    for (const a of AVATARS) if (!used.has(a)) return a;
    return AVATARS[(state.nextId - 1) % AVATARS.length];
  }

  function findByName(state, lowerName, wantDisconnected) {
    for (const pid of state.order) {
      const p = state.players[pid];
      if (p.name.toLowerCase() !== lowerName) continue;
      if (wantDisconnected && p.connected) continue;
      return pid;
    }
    return null;
  }

  /** peerId currently bound to a pid, or null. */
  function peerForPid(state, pid) {
    for (const peerId of Object.keys(state.peers)) {
      if (state.peers[peerId] === pid) return peerId;
    }
    return null;
  }

  /* ============ Lobby reducer ============ */

  /**
   * @param {LobbyState} state
   * @param {{type:string}} event
   * @returns {{state:LobbyState, effects:Effect[]}}
   */
  function lobbyReduce(state, event) {
    switch (event && event.type) {
      case "join": return reduceJoin(state, event);
      case "leave": return reduceLeave(state, event);
      case "status": return reduceStatus(state, event);
      case "kick": return reduceKick(state, event);
      case "addManual": return reduceAddManual(state, event);
      case "rename": return reduceRename(state, event);
      case "remove": return reduceRemove(state, event);
      case "lock": return reduceLock(state, event);
      case "setGame": return reduceSetGame(state, event);
      case "setMax": return reduceSetMax(state, event);
      default: return unchanged(state);
    }
  }

  function unchanged(state) { return { state, effects: [] }; }

  function rejectJoin(state, peerId, reason) {
    return { state, effects: [{ send: { to: peerId, msg: rejectMsg(reason) } }, { close: peerId }] };
  }

  /**
   * Join / rejoin. Relink first (by the pid the phone remembered, else by the
   * name of a disconnected player — which is also how a manual player is
   * adopted), so a lock or a full room never strands someone who was already in.
   * Longer than 50 lines because the acceptance ladder reads as one decision;
   * splitting it would hide the ordering that the tests pin down.
   */
  function reduceJoin(state, event) {
    const peerId = event.peerId;
    if (typeof peerId !== "string" || !peerId) return unchanged(state);
    const name = sanitizeName(event.name);
    if (!name) return rejectJoin(state, peerId, "bad-name");
    const lower = name.toLowerCase();
    const avatar = sanitizeAvatar(event.avatar);

    let pid = null;
    if (isPid(event.pid) && state.players[event.pid] && !state.players[event.pid].connected) {
      pid = event.pid;
    } else if (isPid(event.pid) && state.peers[peerId] === event.pid) {
      pid = event.pid; // same phone, same connection — idempotent re-join
    } else {
      pid = findByName(state, lower, true);
    }

    if (pid) return relink(state, event, pid, name, avatar);

    const liveSameName = findByName(state, lower, false);
    if (liveSameName) return rejectJoin(state, peerId, "name-taken");
    if (state.locked) return rejectJoin(state, peerId, "locked");
    if (state.order.length >= state.maxPlayers) return rejectJoin(state, peerId, "room-full");

    const newPid = "p" + state.nextId;
    const player = {
      pid: newPid, name, color: pickColor(state), avatar: avatar || pickAvatar(state),
      connected: true, manual: false,
    };
    const next = {
      ...state,
      players: { ...state.players, [newPid]: player },
      order: [...state.order, newPid],
      nextId: state.nextId + 1,
      peers: { ...bindPeer(state.peers, peerId, newPid) },
    };
    return {
      state: next,
      effects: [
        { send: { to: peerId, msg: joinedMsg(player) } },
        { broadcastLobby: true },
        { frame: { t: "player-join", player: playerCopy(player) } },
      ],
    };
  }

  /** Point `peerId` at `pid`, dropping any other peer that claimed the same pid. */
  function bindPeer(peers, peerId, pid) {
    const next = {};
    for (const id of Object.keys(peers)) {
      if (peers[id] === pid || id === peerId) continue;
      next[id] = peers[id];
    }
    next[peerId] = pid;
    return next;
  }

  /** An existing (or manual) player is taken over by this connection. */
  function relink(state, event, pid, name, avatar) {
    const prev = state.players[pid];
    const player = {
      ...prev,
      name: prev.manual ? prev.name : name, // a manual entry keeps the host's spelling
      avatar: avatar || prev.avatar,
      connected: true,
      manual: false,
    };
    const next = {
      ...state,
      players: { ...state.players, [pid]: player },
      peers: bindPeer(state.peers, event.peerId, pid),
    };
    return {
      state: next,
      effects: [
        { send: { to: event.peerId, msg: joinedMsg(player) } },
        { broadcastLobby: true },
        { frame: { t: "player-status", pid, connected: true } },
      ],
    };
  }

  /** A connection dropped: the player stays on the roster, marked 🔴. */
  function reduceLeave(state, event) {
    const pid = state.peers[event.peerId];
    if (!pid || !state.players[pid]) return unchanged(state);
    const peers = { ...state.peers };
    delete peers[event.peerId];
    const next = {
      ...state,
      players: { ...state.players, [pid]: { ...state.players[pid], connected: false } },
      peers,
    };
    return {
      state: next,
      effects: [{ broadcastLobby: true }, { frame: { t: "player-status", pid, connected: false } }],
    };
  }

  /** Host-side liveness sweep flipping a player's dot without dropping them. */
  function reduceStatus(state, event) {
    const pid = state.peers[event.peerId];
    if (!pid || !state.players[pid]) return unchanged(state);
    const connected = event.connected === true;
    if (state.players[pid].connected === connected) return unchanged(state);
    const next = {
      ...state,
      players: { ...state.players, [pid]: { ...state.players[pid], connected } },
    };
    return {
      state: next,
      effects: [{ broadcastLobby: true }, { frame: { t: "player-status", pid, connected } }],
    };
  }

  function reduceKick(state, event) {
    const pid = event.pid;
    if (!state.players[pid]) return unchanged(state);
    const peerId = peerForPid(state, pid);
    const next = dropPlayer(state, pid, peerId);
    const effects = [];
    if (peerId) {
      effects.push({ send: { to: peerId, msg: { v: 2, t: "kicked" } } });
      effects.push({ close: peerId });
    }
    effects.push({ broadcastLobby: true });
    effects.push({ frame: { t: "player-leave", pid } });
    return { state: next, effects };
  }

  function dropPlayer(state, pid, peerId) {
    const players = { ...state.players };
    delete players[pid];
    const peers = { ...state.peers };
    if (peerId) delete peers[peerId];
    return { ...state, players, peers, order: state.order.filter((id) => id !== pid) };
  }

  /** A player with no phone, added by the host so games see a full roster. */
  function reduceAddManual(state, event) {
    const name = sanitizeName(event.name);
    if (!name) return unchanged(state);
    if (findByName(state, name.toLowerCase(), false) || findByName(state, name.toLowerCase(), true)) {
      return unchanged(state);
    }
    if (state.order.length >= state.maxPlayers) return unchanged(state);
    const pid = "p" + state.nextId;
    const player = {
      pid, name, color: pickColor(state), avatar: sanitizeAvatar(event.avatar) || pickAvatar(state),
      connected: false, manual: true,
    };
    const next = {
      ...state,
      players: { ...state.players, [pid]: player },
      order: [...state.order, pid],
      nextId: state.nextId + 1,
    };
    return {
      state: next,
      effects: [{ broadcastLobby: true }, { frame: { t: "player-join", player: playerCopy(player) } }],
    };
  }

  /** Manual players only — a phone owns its own name. */
  function reduceRename(state, event) {
    const p = state.players[event.pid];
    if (!p || !p.manual) return unchanged(state);
    const name = sanitizeName(event.name);
    if (!name) return unchanged(state);
    const clash = findByName(state, name.toLowerCase(), false) || findByName(state, name.toLowerCase(), true);
    if (clash && clash !== event.pid) return unchanged(state);
    const next = {
      ...state,
      players: { ...state.players, [event.pid]: { ...p, name } },
    };
    return { state: next, effects: [{ broadcastLobby: true }] };
  }

  /** Manual players only — a phone player is removed with `kick`. */
  function reduceRemove(state, event) {
    const p = state.players[event.pid];
    if (!p || !p.manual) return unchanged(state);
    return {
      state: dropPlayer(state, event.pid, null),
      effects: [{ broadcastLobby: true }, { frame: { t: "player-leave", pid: event.pid } }],
    };
  }

  function reduceLock(state, event) {
    const locked = event.locked === true;
    if (state.locked === locked) return unchanged(state);
    return { state: { ...state, locked }, effects: [] };
  }

  function reduceSetGame(state, event) {
    const id = event.gameId;
    const gameId = typeof id === "string" && id && id.length <= GAME_ID_MAX ? id : null;
    if (state.activeGame === gameId) return unchanged(state);
    return { state: { ...state, activeGame: gameId }, effects: [{ broadcastLobby: true }] };
  }

  function reduceSetMax(state, event) {
    const n = Number(event.n);
    if (!Number.isInteger(n)) return unchanged(state);
    const clamped = Math.max(1, Math.min(MAX_PLAYERS_CAP, n));
    if (state.maxPlayers === clamped) return unchanged(state);
    return { state: { ...state, maxPlayers: clamped }, effects: [] };
  }

  /* ============ Persistence helpers (00 §3.7) ============ */

  /** The serialisable slice of the lobby (no peer ids — connections die on reload). */
  function serializeLobby(state) {
    return {
      players: state.order.map((pid) => ({ ...playerCopy(state.players[pid]), connected: false })),
      nextId: state.nextId,
    };
  }

  /** Rebuild a lobby from `serializeLobby` output; junk yields a fresh lobby. */
  function restoreLobby(saved) {
    const fresh = createLobbyState();
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.players)) return fresh;
    const players = {};
    const order = [];
    for (const raw of saved.players.slice(0, MAX_PLAYERS_CAP)) {
      const p = validateLobbyPlayer(raw);
      if (!p || players[p.pid]) continue;
      players[p.pid] = { ...p, connected: false };
      order.push(p.pid);
    }
    const nextId = Number.isInteger(saved.nextId) && saved.nextId > 0 ? saved.nextId : order.length + 1;
    return { ...fresh, players, order, nextId };
  }

  return {
    // codes
    ROOM_ALPHABET, ROOM_CODE_LEN, ROOM_CODE_RE, PEER_PREFIX,
    generateRoomCode, isRoomCode, normalizeRoomCode,
    // caps + palettes
    NAME_MAX, NAME_FIELD_MAX, GAME_ID_MAX, MAX_PLAYERS_CAP, DEFAULT_MAX_PLAYERS,
    PAYLOAD_MAX_BYTES, AVATARS, COLORS, REJECT_REASONS,
    // sanitising + validation
    sanitizeName, sanitizeAvatar, payloadTooBig, utf8Bytes, isPid, validateEnvelope,
    // builders
    joinedMsg, rejectMsg, gameMsg,
    // lobby
    createLobbyState, lobbyReduce, lobbySnapshot, playerCopy, playerList,
    serializeLobby, restoreLobby,
  };
});
