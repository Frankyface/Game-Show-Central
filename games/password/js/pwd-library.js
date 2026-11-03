/* ============================================================
   Password — the set library (docs/19 §2)
   Two halves of the same workflow:

   1. The setup screen mounts the SHARED picker
      (shared/library.js → GSCLibrary.mountPicker) under the Words
      section. Picking a set fetches games/password/sets/<file>,
      runs it through this game's own validateGame, and adopts it
      as the current words with the source note "set: <name>".
      A page opened from disk, or a game with no sets/ folder,
      simply shows the picker's own plain-English note.

   2. The editor gets "Download for the library": static hosting
      cannot write files, so the honest workflow is to download
      the JSON, drop it in games/password/sets/, and paste one
      line into sets/index.json. This prints that exact line.

   Everything is built with createElement/textContent.
   ============================================================ */

"use strict";

(function () {
  const SETS_DIR = "games/password/sets";

  /* ============ 1. The picker on the setup screen ============ */

  function mount() {
    const box = $("pwd-library");
    if (!box || !window.GSCLibrary) return null;
    return window.GSCLibrary.mountPicker(box, {
      gameDir: "",                       // "" = this game's own folder
      label: "Saved word sets",
      // validateGame throws a plain-English Error, which is exactly what the
      // picker's error line wants; returning true is a pass.
      validate: (json) => window.PwdCore.validateGame(json),
      onPick(json, meta) {
        window.PwdApp.useGame(json, `set: ${meta.name}`, "library");
      },
    });
  }

  /* ============ 2. "Download for the library" in the editor ============ */

  /** A committable file name from the list's title. Always a legal manifest file. */
  function fileNameFor(title) {
    const slug = String(title || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const name = `${slug || "my-set"}.json`;
    return window.GSCLibrary && window.GSCLibrary.safeFile(name) ? name : "my-set.json";
  }

  /** The one line the host pastes into sets/index.json. */
  function manifestLine(draft, file) {
    return JSON.stringify({
      file,
      name: draft.title || "My word set",
      description: "One line about this set — what is in it and who it suits.",
      by: "Your name",
      counts: { passwords: draft.words.length },
    });
  }

  function helpRow(box, className, text) {
    box.appendChild(el("p", className, text));
  }

  function renderHelp(draft, file) {
    const box = $("pwd-library-help");
    if (!box) return;
    box.replaceChildren();
    show(box, true);
    helpRow(box, "library-help-title", "Two steps to put this set in the library");
    helpRow(box, "library-help-step", `1. Save the download as ${SETS_DIR}/${file} and commit it.`);
    helpRow(box, "library-help-step", `2. Add this line to the array in ${SETS_DIR}/index.json:`);
    const line = el("pre", "library-help-line", manifestLine(draft, file));
    box.appendChild(line);
    const copy = el("button", "btn btn-ghost btn-small", "Copy the line");
    copy.type = "button";
    copy.addEventListener("click", () => copyLine(line.textContent, copy));
    box.appendChild(copy);
    helpRow(box, "library-help-step",
      "Edit the name, description and by first — they are what the picker shows.");
  }

  /** Clipboard access is refused often enough that the fallback matters. */
  function copyLine(text, button) {
    const selectIt = () => {
      const pre = $("pwd-library-help").querySelector(".library-help-line");
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      button.textContent = "Selected — press Ctrl/Cmd + C";
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { selectIt(); return; }
    navigator.clipboard.writeText(text)
      .then(() => { button.textContent = "Copied"; })
      .catch(() => selectIt());
  }

  function download(json, file) {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onDownloadForLibrary() {
    const draft = window.PwdEditor.draft();
    if (!draft) return;
    try {
      window.PwdCore.validateGame(draft);
    } catch (err) {
      show($("pwd-library-help"), false);
      window.PwdEditor.message(`Fix this before it can go in the library: ${err.message}`);
      return;
    }
    window.PwdEditor.message("");
    const file = fileNameFor(draft.title);
    download(draft, file);
    renderHelp(draft, file);
  }

  /* ============ Wiring ============ */

  function wire() {
    const button = $("btn-editor-library");
    if (button) button.addEventListener("click", onDownloadForLibrary);
    const picker = mount();
    window.PwdLibrary = { picker, mount, fileNameFor, manifestLine, renderHelp, SETS_DIR };
  }

  if (!(window.GSC && window.GSC.mode && window.GSC.mode.endsWith("-player"))) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wire);
    } else {
      wire();
    }
  }
})();
