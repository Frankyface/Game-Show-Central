/* ============================================================
   Family Feud — boot (loads last)
   Picks host or phone mode from the GSC SDK (00 §7) and starts the
   right stack. With no SDK on the page the game boots host-only:
   every screen except the phone controller still works, which is
   the house rule — a host alone must be able to run the game.
   ============================================================ */

"use strict";

(function boot() {
  const GSC = window.GSC;
  const mode = GSC && typeof GSC.mode === "string" ? GSC.mode : fallbackMode();

  /** Without the SDK, `?room=CODE` still means "this is a phone". */
  function fallbackMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "player" || params.get("room")) return "standalone-player";
    if (params.get("embed") === "host") return "embed-host";
    return "standalone-host";
  }

  /**
   * The 1.2 s `.gsc-splash` title card, shown on the host screen and on every
   * phone as the game opens (docs/design-system.md §3). Copied from
   * `showSplash()` in js/hub-host.js. Decorative only: the node is
   * `pointer-events: none`, nothing waits on it, no message is delayed by it,
   * and it is skipped entirely under `prefers-reduced-motion: reduce`.
   */
  function showSplash() {
    const node = document.getElementById("gsc-splash");
    if (!node) return;
    if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const title = document.getElementById("gsc-splash-title");
    const sub = document.getElementById("gsc-splash-sub");
    if (title) title.textContent = "Family Feud";
    if (sub) sub.textContent = "Survey says…";
    node.dataset.gscGame = "family-feud"; // wears the Feud accent (shared/theme.css)
    node.classList.remove("hidden");
    window.setTimeout(() => node.classList.add("hidden"), 1200);
  }

  showSplash();

  if (mode.endsWith("-player")) {
    window.FeudPhone.init();
    return;
  }

  window.FeudEditor.wire();
  window.FeudApp.bootHost().then(() => window.FeudRoom.init()).catch((err) => {
    console.warn("Family Feud could not start:", err);
    const node = document.getElementById("setup-error");
    if (node) node.textContent = `Something went wrong starting the game: ${err.message}`;
  });
})();
