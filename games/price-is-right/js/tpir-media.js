/* ============================================================
   The Price Is Right — prize photo media layer
   (docs/19-cross-cutting-round.md §3)

   The single security gate for prize images. `validateImageRef()` is
   the ONE allowlist every path funnels through — content validation in
   tpir-content.js AND the editor — and `buildPrizeImage()` is the only
   place an <img> is created for host rendering. No raw-HTML injection,
   ever: images are built programmatically with src + alt only, and a
   broken image swaps itself for a plain-text note.

   Semantics are copied verbatim from games/jeopardy/js/media.js so both
   games refuse exactly the same things. UMD like tpir-core.js: sets
   globalThis.TpirMedia in the browser AND module.exports in Node, so the
   accept/reject matrix is a unit test rather than a click-through.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TpirMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Generous enough for a downscaled JPEG data URI, small enough that no
  // single reference can be a denial-of-service payload.
  const MAX_IMAGE_REF_LEN = 2000000;
  const ALT_MAX = 200;
  const DEFAULT_ALT = "Prize photo";

  // A URL scheme per RFC 3986, anchored, so a relative path like
  // "img/a:b.svg" (which has "/" before any ":") matches no scheme.
  const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

  const ACCEPT = Object.freeze({ valid: true, error: null });
  const reject = (error) => ({ valid: false, error });

  /**
   * The single gate for any `image` stored in a prize file. Allows ONLY
   * https:/http: URLs, data:image/* URIs (the MIME prefix is really checked)
   * and relative repo paths (no scheme, and not protocol-relative "//").
   * Everything else — javascript:, data:text/html, file:, blob:, non-strings,
   * empty, over-length — is rejected with a reason. Pure; no DOM.
   * @param {unknown} str @returns {{valid:boolean, error:string|null}}
   */
  function validateImageRef(str) {
    if (typeof str !== "string") return reject("An image reference must be text.");
    if (str.length === 0) return reject("The image reference is empty.");
    if (str.length > MAX_IMAGE_REF_LEN) {
      return reject(`That image is too large (max ${MAX_IMAGE_REF_LEN.toLocaleString("en-US")} characters).`);
    }
    // Normalise the way the WHATWG URL parser would BEFORE detecting the
    // scheme, so "  javascript:…" or "jav\tascript:…" cannot smuggle a
    // disallowed scheme past the allowlist. The length check above stays on
    // the raw string so the cap cannot be dodged with padding.
    const normalized = str.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, "");
    if (normalized.slice(0, 2) === "//") {
      return reject("Protocol-relative references (//…) are not allowed — use https:// or a path inside the repo.");
    }
    const match = SCHEME_RE.exec(normalized);
    if (!match) return ACCEPT;                       // no scheme → a repo path
    const scheme = match[1].toLowerCase();
    if (scheme === "https" || scheme === "http") return ACCEPT;
    if (scheme === "data") {
      if (normalized.slice(0, 11).toLowerCase() === "data:image/") return ACCEPT;
      return reject('Only "data:image/*" data URIs are allowed (not data:text/html or similar).');
    }
    return reject(`The "${scheme}:" scheme is not allowed. Use https, a data:image/* URI, or a path inside the repo.`);
  }

  /** Alt text, trimmed and capped; "" when there is none. */
  function cleanAlt(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ALT_MAX);
  }

  /**
   * Build a prize <img> programmatically — never from an HTML string. On a
   * load error it replaces itself with a plain-text note instead of a broken
   * image icon. Callers MUST pass a src that already passed validateImageRef.
   * @param {string} src @param {string} [alt] @returns {HTMLImageElement}
   */
  function buildPrizeImage(src, alt) {
    const img = document.createElement("img");
    img.className = "prize-image";
    img.decoding = "async";
    img.loading = "lazy";
    img.alt = cleanAlt(alt) || DEFAULT_ALT;
    img.src = src;
    img.addEventListener("error", function onError() {
      const note = document.createElement("p");
      note.className = "prize-image-failed";
      note.textContent = "⚠ photo failed to load";
      if (img.parentNode) img.parentNode.replaceChild(note, img);
    });
    return img;
  }

  /** A built <img> for `ref` iff it passes the gate, else null. */
  function buildValidatedImage(ref, alt) {
    if (typeof ref !== "string" || !validateImageRef(ref).valid) return null;
    return buildPrizeImage(ref, alt);
  }

  /**
   * Mount (or clear) a prize photo inside a container: clear it, then append a
   * validated <img> and unhide, or leave it empty and hidden. One call per
   * card, with the gate applied here rather than at every call site.
   * @param {HTMLElement|null} container @param {unknown} ref @param {string} [alt]
   * @returns {boolean} whether a photo was mounted
   */
  function mountPrizeImage(container, ref, alt) {
    if (!container) return false;
    container.replaceChildren();
    const node = buildValidatedImage(ref, alt);
    container.classList.toggle("hidden", !node);
    if (node) container.appendChild(node);
    return !!node;
  }

  return {
    MAX_IMAGE_REF_LEN, ALT_MAX, DEFAULT_ALT,
    validateImageRef, cleanAlt, buildPrizeImage, buildValidatedImage, mountPrizeImage,
  };
});
