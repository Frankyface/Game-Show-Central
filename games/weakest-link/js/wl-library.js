/* ============================================================
   Weakest Link — question-set library glue (docs/19 §2)

   Mounts the shared picker (shared/library.js) under the Questions
   section of setup, and adds the editor's "Download for the library"
   button, which hands the host the file AND the exact manifest line
   to paste into sets/index.json. Static hosting cannot write files,
   so that copy-and-commit step is the honest workflow.
   ============================================================ */

"use strict";

(function () {
  const $id = (id) => document.getElementById(id);

  /* ============ setup-screen picker ============ */

  function mount() {
    const box = $id("wl-library");
    if (!box || !window.GSCLibrary) {
      if (box) box.textContent = "The set library needs shared/library.js, which did not load.";
      return;
    }
    window.GSCLibrary.mountPicker(box, {
      gameDir: "",                       // this game's own folder
      label: "Saved sets",
      // The picker shows whatever this throws, and never calls onPick.
      validate: (json) => window.WlCore.validateGame(json),
      onPick(json, meta) {
        try {
          window.WlApp.useGame(json, `set: ${meta.name}`, "library");
        } catch (err) {
          window.WlApp.error(err.message);
        }
      },
    });
  }

  /* ============ editor: Download for the library ============ */

  /** A filename a manifest `file` will accept: bare, lowercase, *.json. */
  function slugFor(title) {
    const base = String(title || "set").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return (base || "set") + ".json";
  }

  /** The line to paste into sets/index.json, pretty-printed for copying. */
  function manifestLine(game, file) {
    const cats = new Set();
    game.questions.forEach((row) => { if (row.category) cats.add(row.category); });
    return JSON.stringify({
      file,
      name: game.title || "Untitled set",
      description: "",
      by: "",
      counts: { questions: game.questions.length, categories: cats.size },
    }, null, 2);
  }

  function download(game, file) {
    const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadForLibrary() {
    const out = $id("wl-ed-library-out");
    let game;
    try {
      game = window.WlEditor.cleanDraft();
      window.WlCore.validateGame(game);
    } catch (err) {
      out.textContent = `${err.message} — fix that before adding it to the library.`;
      out.classList.add("bad");
      return null;
    }
    const file = slugFor(game.title);
    download(game, file);
    out.classList.remove("bad");
    out.textContent =
      `Saved ${file}. Commit it to games/weakest-link/sets/${file}, then paste this into `
      + `games/weakest-link/sets/index.json:\n${manifestLine(game, file)}`;
    return file;
  }

  function wire() {
    if (document.body.classList.contains("player-mode")) return;
    mount();
    const btn = $id("btn-editor-library");
    if (btn) btn.addEventListener("click", downloadForLibrary);
  }

  window.WlLibrary = { mount, slugFor, manifestLine, downloadForLibrary };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
