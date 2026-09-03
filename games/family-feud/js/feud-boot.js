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
