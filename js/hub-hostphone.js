/* ============================================================
   Game Show Central — host-phone helpers for the hub (docs/22 §4.2)
   The two pieces of host-phone plumbing that are not roster rules:
     · newKey()            a random host key, generated HERE so the
                           lobby reducer stays pure (it takes the key
                           in the setRole event);
     · createViewHolder()  the latest `host-view` the mounted game
                           frame handed the hub, de-duplicated, so the
                           hub can re-deliver it whenever a host phone
                           connects, reconnects or relinks with its key.
   UMD so the unit tests can load it in Node.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HubHostPhone = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEY_BYTES = 18; // → 24 URL-safe characters

  /** @returns {string} a random URL-safe key (RoomProtocol.isHostKey accepts it). */
  function newKey(rng) {
    const bytes = new Uint8Array(KEY_BYTES);
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (typeof rng === "function") {
      for (let i = 0; i < KEY_BYTES; i += 1) bytes[i] = Math.floor(rng() * 256) & 255;
    } else if (c && typeof c.getRandomValues === "function") {
      c.getRandomValues(bytes);
    } else {
      console.warn("Hub: no crypto.getRandomValues; host key uses Math.random");
      for (let i = 0; i < KEY_BYTES; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < KEY_BYTES; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63];
    }
    return out;
  }

  /**
   * The latest host view for the mounted frame. `set` returns true only when
   * the view actually changed, so the hub sends each distinct view once (and
   * again on demand via `get`). `clear` runs when the frame is unmounted.
   */
  function createViewHolder() {
    let json = null;
    let view = null;
    return {
      set(m) {
        let next;
        try { next = JSON.stringify(m === undefined ? null : m); } catch (err) { return false; }
        if (typeof next !== "string" || next === json) return false;
        json = next;
        view = JSON.parse(next);
        return true;
      },
      get() { return view; },
      clear() { json = null; view = null; },
    };
  }

  return { newKey, createViewHolder };
});
