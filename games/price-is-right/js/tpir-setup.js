/* ============================================================
   The Price Is Right — setup-screen extras
   (docs/19-cross-cutting-round.md §1 and §2)

   Two small pieces of host glue that would otherwise bloat
   tpir-app.js: the "⟲ Game lobby" confirm (Keep this game /
   Start over) and the shared set-library picker mounted under the
   prize controls. Both talk to the app only through window.TpirApp,
   and every node is built with createElement.
   ============================================================ */

"use strict";

(function () {
  "use strict";

  /* ============ ⟲ Game lobby ============ */

  const modal = () => $("tpir-lobby-modal");

  /** Show or hide the confirm, moving focus so a keyboard host is not lost. */
  function openModal(open) {
    const box = modal();
    if (!box) return;
    show(box, open);
    if (open) {
      const first = $("btn-lobby-keep");
      if (first) first.focus();
    } else {
      const back = $("btn-game-lobby");
      if (back) back.focus();
    }
  }

  function wireLobby() {
    const open = $("btn-game-lobby");
    if (!open) return;
    open.addEventListener("click", () => openModal(true));
    const bind = (id, fn) => {
      const node = $(id);
      if (node) node.addEventListener("click", () => { fn(); openModal(false); });
    };
    bind("btn-lobby-cancel", () => {});
    bind("btn-lobby-keep", () => window.TpirApp.keepGame());
    bind("btn-lobby-over", () => window.TpirApp.startOver());
    const box = modal();
    if (box) {
      // A click on the backdrop itself (not the card) cancels, like the hub's.
      box.addEventListener("click", (event) => { if (event.target === box) openModal(false); });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && box && !box.classList.contains("hidden")) openModal(false);
    });
    const resume = $("btn-resume");
    if (resume) resume.addEventListener("click", () => window.TpirApp.resume());
  }

  /* ============ The set library ============ */

  /**
   * Mount the shared picker (shared/library.js) under the prize controls.
   * `validate` is this game's own validateGame, so a set that would not load
   * is refused inside the picker with its own message and never becomes the
   * current content. Loading one sets the source note to "set: <name>",
   * exactly as docs/design-system.md §3 specifies.
   */
  function mountLibrary() {
    const box = $("tpir-library");
    const lib = window.GSCLibrary;
    if (!box || !lib || typeof lib.mountPicker !== "function") return null;
    return lib.mountPicker(box, {
      gameDir: "",
      label: "Saved prize sets",
      validate: (json) => window.TpirCore.validateGame(json),
      onPick(json, meta) {
        try {
          window.TpirApp.useContent(json, `set: ${meta.name}`, "set");
        } catch (err) {
          window.TpirApp.error(err.message);
        }
      },
    });
  }

  function boot() {
    const mode = (window.GSC && window.GSC.mode) || "standalone-host";
    if (mode.endsWith("-player")) return;   // phones have no setup screen
    wireLobby();
    const picker = mountLibrary();
    window.TpirSetup = { picker, openModal, mountLibrary };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
