/* ============================================================
   Weakest Link — the 1.2 s title card
   A straight copy of showSplash() from js/hub-host.js, scoped to
   this page. Purely decorative: the node is pointer-events:none,
   nothing waits on it, no state or message is touched, and it is
   skipped entirely under prefers-reduced-motion. Embedded in the
   hub it is skipped as well — the shell already plays one on the
   game switch, and two stacked title cards is one too many.
   ============================================================ */

"use strict";

(function () {
  const SPLASH_MS = 1200;
  const TITLE = "Weakest Link";
  const TAGLINE = "Bank it before the chain breaks.";

  function showSplash() {
    const node = document.getElementById("gsc-splash");
    if (!node) return;
    if (document.body.classList.contains("gsc-embedded")) return;
    if (globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.getElementById("gsc-splash-title").textContent = TITLE;
    document.getElementById("gsc-splash-sub").textContent = TAGLINE;
    node.dataset.gscGame = "weakest-link"; // wears this game's accent (shared/theme.css)
    node.classList.remove("hidden");
    setTimeout(() => { node.classList.add("hidden"); }, SPLASH_MS);
  }

  // One frame after boot, so wl-app.js/wl-phone.js have set the mode classes.
  function arm() { setTimeout(showSplash, 0); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else {
    arm();
  }

  window.WlSplash = { show: showSplash };
})();
