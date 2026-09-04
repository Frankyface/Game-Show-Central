/* ============================================================
   Jeopardy — Game Show Central cross-cutting features
   (docs/19-cross-cutting-round.md §1 and §2)

   Unlike js/gsc-embed.js, this file runs in EVERY mode — standalone and
   embedded — because docs/19 §4 asks for the game lobby and the set
   library on both. It is still additive: it only ever ADDS controls
   (`#btn-game-lobby`, `#btn-resume`, the library picker, the editor's
   "Download for the library"), and it drives the game exclusively
   through app.js's own globals, so no upstream file gains a hook.

   Everything hangs off app.js's global-lexical `state` / `setState` and
   its function declarations (`newGame`, `validateGame`, `clearSavedState`,
   `cleanDraft`, …), which classic scripts share. Every reference is made
   at CALL time and guarded, so a missing script degrades to "the control
   is not there" rather than a broken page.

   Host screens only: it returns immediately in player mode.
   No innerHTML anywhere — every node is createElement + textContent.
   ============================================================ */

"use strict";

const GscExtras = (function () {
  "use strict";

  const SET_SOURCE_PREFIX = "set: ";
  const LIB_PATH = "games/jeopardy/sets/";

  let picker = null;
  let wired = false;

  /* ============ App-global bridges (defensive) ============ */

  const $$ = (id) => document.getElementById(id);

  function appState() {
    return typeof state !== "undefined" ? state : null;
  }
  function appSetState(patch) {
    if (typeof setState === "function") setState(patch);
  }
  function isPlayerMode() {
    return !!(document.body && document.body.classList.contains("player-mode"));
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ============================================================
     §1 — the Game lobby control
     ============================================================ */

  /**
   * Jeopardy's upstream "New Game" already returns to the start screen, but it
   * asks one blunt window.confirm and always wipes the board. docs/19 §1 wants
   * the same two-choice dialog every other game has, on a control with the
   * shared id. So: add `#btn-game-lobby` beside the upstream button and hide
   * that button (CSS, `body.gsc-has-lobby`) rather than rewiring it — upstream
   * `newGame` stays exactly as it is and is still what "Start over" runs.
   */
  function mountLobbyButton() {
    if ($$("btn-game-lobby")) return;
    const original = $$("btn-new-game");
    if (!original || !original.parentNode) return;
    const btn = el("button", "btn btn-ghost hidden", "⟲ Game lobby");
    btn.id = "btn-game-lobby";
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", openLobbyDialog);
    original.parentNode.insertBefore(btn, original);
    document.body.classList.add("gsc-has-lobby");
    syncLobbyButton();
  }

  /** Same visibility rule as the button it replaces: anywhere but setup. */
  function syncLobbyButton() {
    const btn = $$("btn-game-lobby");
    const s = appState();
    if (!btn || !s) return;
    btn.classList.toggle("hidden", s.phase === "setup");
  }

  /**
   * Keep this game: the whole point is that NOTHING is lost — Jeopardy already
   * keeps the board, scores, used tiles and Final in `state`, so returning to
   * setup is a one-key patch and Resume is its exact inverse. No snapshot to
   * drift out of date.
   */
  function keepAndExit() {
    closeLobbyDialog();
    appSetState({ phase: "setup" });
    const resume = $$("btn-resume");
    if (resume) resume.focus();
  }

  /** Start over: upstream `newGame`, minus its own confirm (ours replaced it). */
  function startOver() {
    closeLobbyDialog();
    const s = appState();
    if (!s || typeof clearSavedState !== "function" || typeof freshState !== "function") return;
    clearSavedState();
    appSetState({
      ...freshState(),
      game: s.game,
      source: s.source,
      sourceKind: s.sourceKind,
      sourceUrl: s.sourceUrl,
      players: s.players.map((p) => ({ ...p, score: 0 })),
      buzzer: s.buzzer,
      settings: s.settings,
    });
  }

  /** Is there a game worth resuming — i.e. did we leave one mid-flight? */
  function hasResumableGame() {
    const s = appState();
    if (!s || s.phase !== "setup" || !s.game) return false;
    if (s.finalPlayed || s.final || s.active) return true;
    if (s.used && Object.keys(s.used).length > 0) return true;
    return (s.players || []).some((p) => p.score !== 0);
  }

  /* ---- the dialog (role="dialog", built node by node) ---- */

  let dialogCloser = null;

  function openLobbyDialog() {
    closeLobbyDialog();
    const back = el("div", "gsc-dialog-backdrop");
    const box = el("div", "gsc-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "gsc-dialog-title");

    const title = el("h2", "gsc-dialog-title", "Back to the game lobby?");
    title.id = "gsc-dialog-title";
    box.appendChild(title);
    box.appendChild(el("p", "gsc-dialog-body",
      "Keep this game and the board, scores and used clues are waiting for you " +
      "on the start screen. Start over clears the board and zeroes the scores — " +
      "your players, questions and timers stay."));

    const row = el("div", "gsc-dialog-actions");
    const keep = el("button", "btn btn-gold", "Keep this game");
    keep.type = "button";
    keep.id = "btn-lobby-keep";
    keep.addEventListener("click", keepAndExit);
    const over = el("button", "btn btn-ghost", "Start over");
    over.type = "button";
    over.id = "btn-lobby-startover";
    over.addEventListener("click", startOver);
    const cancel = el("button", "btn btn-ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeLobbyDialog);
    row.appendChild(keep);
    row.appendChild(over);
    row.appendChild(cancel);
    box.appendChild(row);

    back.appendChild(box);
    document.body.appendChild(back);
    keep.focus();

    const onKey = (event) => { if (event.key === "Escape") closeLobbyDialog(); };
    back.addEventListener("click", (event) => { if (event.target === back) closeLobbyDialog(); });
    document.addEventListener("keydown", onKey);
    dialogCloser = () => {
      document.removeEventListener("keydown", onKey);
      if (back.parentNode) back.parentNode.removeChild(back);
      const btn = $$("btn-game-lobby");
      if (btn && !btn.classList.contains("hidden")) btn.focus();
    };
  }

  function closeLobbyDialog() {
    if (!dialogCloser) return;
    const close = dialogCloser;
    dialogCloser = null;
    close();
  }

  /* ---- Resume, on the setup screen ---- */

  /**
   * Sits beside upstream's "Start Game" (which always starts fresh). Kept in
   * sync by our render hook, so it appears the moment a game is parked and
   * disappears once it is started over or finished.
   */
  function mountResumeButton() {
    if ($$("btn-resume")) return;
    const start = $$("btn-start");
    if (!start || !start.parentNode) return;
    const btn = el("button", "btn btn-gold btn-big hidden", "▸ Resume game");
    btn.id = "btn-resume";
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (!hasResumableGame()) return;
      appSetState({ phase: "board" });
    });
    start.parentNode.insertBefore(btn, start);
    syncResumeButton();
  }

  function syncResumeButton() {
    const btn = $$("btn-resume");
    if (!btn) return;
    const resumable = hasResumableGame();
    btn.classList.toggle("hidden", !resumable);
    const start = $$("btn-start");
    // With a game parked, "Start Game" is the destructive one — say so.
    if (start) start.textContent = resumable ? "Start a fresh board" : "Start Game";
  }

  /* ============================================================
     §2 — the question-set library
     ============================================================ */

  /**
   * Mount the shared picker under the existing "Questions" section. The
   * container is our own node appended to that section; renderSetup() only
   * replaces #player-list, so nothing here is ever wiped.
   */
  function mountLibrary() {
    if (picker || !window.GSCLibrary) return;
    const anchor = $$("btn-load-json");
    const section = anchor && anchor.closest ? anchor.closest(".setup-section") : null;
    if (!section) return;
    const host = el("div", "gsc-library-host");
    host.id = "gsc-library-host";
    section.appendChild(host);
    picker = window.GSCLibrary.mountPicker(host, {
      gameDir: "",
      label: "Saved sets",
      validate: (json) => { if (typeof validateGame === "function") validateGame(json); },
      onPick: useSet,
    });
  }

  /**
   * A picked set becomes the current game. `sourceKind: "upload"` is the
   * existing "the host chose this deliberately" kind, so app.js's init() keeps
   * it across a reload instead of re-fetching questions.json over the top.
   */
  function useSet(json, meta) {
    if (typeof setSetupError === "function") setSetupError("");
    appSetState({
      game: json,
      source: SET_SOURCE_PREFIX + ((meta && meta.name) || "saved set"),
      sourceKind: "upload",
      sourceUrl: null,
    });
  }

  /* ---- the editor's "Download for the library" ---- */

  /**
   * Static hosting cannot write into the repo, so the honest workflow is:
   * download the file, drop it in sets/, paste one line into sets/index.json.
   * This button does the download and shows the exact line and path.
   */
  function mountEditorDownload() {
    if ($$("btn-editor-library")) return;
    const actions = document.querySelector(".editor-head-actions");
    const download = $$("btn-editor-download");
    if (!actions || !download) return;
    const btn = el("button", "btn btn-ghost", "Download for the library");
    btn.id = "btn-editor-library";
    btn.type = "button";
    btn.addEventListener("click", downloadForLibrary);
    actions.insertBefore(btn, download.nextSibling);
  }

  function libraryNote() {
    let note = $$("gsc-library-note");
    if (note) return note;
    const anchor = $$("editor-image-meter");
    if (!anchor || !anchor.parentNode) return null;
    note = el("pre", "gsc-library-note");
    note.id = "gsc-library-note";
    note.setAttribute("role", "status");
    note.classList.add("hidden");
    anchor.parentNode.insertBefore(note, anchor);
    return note;
  }

  /** "Movies & TV" → "movies-tv.json" — a bare, manifest-legal file name. */
  function fileNameFor(title) {
    const stem = String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return (stem || "my-set") + ".json";
  }

  function downloadForLibrary() {
    if (typeof validateDraft !== "function" || typeof cleanDraft !== "function") return;
    if (!validateDraft()) return;
    const draft = cleanDraft();
    const file = fileNameFor(draft.title);
    const json = JSON.stringify(draft, null, 2) + "\n";
    saveBlob(json, file);
    showManifestLine(draft, file);
  }

  function saveBlob(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showManifestLine(draft, file) {
    const note = libraryNote();
    if (!note) return;
    const clues = (draft.categories || []).reduce((n, c) => n + (c.clues || []).length, 0);
    const entry = {
      file,
      name: draft.title || file.replace(/\.json$/, ""),
      description: "",
      by: "",
      counts: { categories: (draft.categories || []).length, clues },
    };
    note.textContent =
      `Saved ${file}.\n\n` +
      `1. Commit it to ${LIB_PATH}${file}\n` +
      `2. Add this line to ${LIB_PATH}index.json (fill in description and by):\n\n` +
      `  ${JSON.stringify(entry)}`;
    note.classList.remove("hidden");
  }

  /* ============================================================
     Boot
     ============================================================ */

  function sync() { syncLobbyButton(); syncResumeButton(); }

  /**
   * Keep our two controls in step with app.js's own renders. We are not allowed
   * a hook inside app.js, so wrap its global `render` instead: a top-level
   * `function render()` in a classic script IS the global-object property, so
   * every bare `render()` call inside app.js goes through this wrapper. The
   * original is called first and its return value passed through, so app.js
   * cannot tell the difference. If app.js failed to load we fall back to
   * watching the class flips on the two screens it toggles.
   */
  function watchRenders() {
    if (wired) return;
    wired = true;
    if (typeof window.render === "function") {
      const original = window.render;
      window.render = function gscRender() {
        const out = original.apply(this, arguments);
        sync();
        return out;
      };
    } else if (typeof MutationObserver === "function") {
      const observer = new MutationObserver(sync);
      for (const id of ["screen-setup", "screen-board"]) {
        const node = $$(id);
        if (node) observer.observe(node, { attributes: true, attributeFilter: ["class"] });
      }
    }
    sync();
  }

  function boot() {
    if (isPlayerMode()) return; // phones have no setup screen and no editor
    mountLobbyButton();
    mountResumeButton();
    mountLibrary();
    mountEditorDownload();
    watchRenders();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    // Test seams for tests/gsc-embed-harness.html.
    _openLobbyDialog: openLobbyDialog,
    _closeLobbyDialog: closeLobbyDialog,
    _keepAndExit: keepAndExit,
    _startOver: startOver,
    _hasResumableGame: hasResumableGame,
    _picker: () => picker,
    _useSet: useSet,
    _fileNameFor: fileNameFor,
    _downloadForLibrary: downloadForLibrary,
    _sync: () => { syncLobbyButton(); syncResumeButton(); },
  };
})();

window.GscExtras = GscExtras;
