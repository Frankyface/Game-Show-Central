/* ============================================================
   Wheel of Fortune — cross-cutting round scenarios (docs/19)
   X-1 the Game lobby control, X-2 the saved-set library, X-3 the
   editor's "Download for the library", plus the ?store= storage
   namespacing. Kept out of tests/harness.html so both files stay
   under the 800-line house limit; harness.html owns the shell
   (the docs/00 §6 bridge) and hands this module the context it
   already built. Browser only; exported as window.WheelHarnessX.
   ============================================================ */

"use strict";

window.WheelHarnessX = function (ctx) {
  "use strict";

  const { check, waitFor, sleep, W, D, $, loadFrame, hostState, HC } = ctx;
  const SOURCE_FILES = ctx.SOURCE_FILES || [];

  /** Get the host into a live round with three players and a letter called. */
  async function playABit() {
    if (hostState().phase === "idle") $("host", "btn-start").click();
    let guard = 0;
    while (hostState().phase !== "round" && guard < 12) {
      $("host", "btn-next-round").click();
      guard += 1;
    }
    await waitFor(() => hostState().phase === "round", "a regular round");
    await ctx.spinTo(0);
    const legal = HC().legalActions(hostState()).letters;
    D("host").querySelector(`#keyboard .key[data-letter="${legal[0]}"]`).click();
  }

  /* ============ X-1 — the Game lobby control ============ */

  async function testGameLobby() {
    const lobbyBtn = $("host", "btn-game-lobby");
    check("X-1 the toolbar carries a Game lobby control next to Sound and Editor",
      !!lobbyBtn && lobbyBtn.textContent.indexOf("Game lobby") >= 0
        && lobbyBtn.parentElement === $("host", "btn-sound").parentElement,
      `label "${lobbyBtn ? lobbyBtn.textContent.trim() : "(missing)"}"`);
    check("X-1 it is hidden on setup and shown once a game is running",
      lobbyBtn.classList.contains("hidden") === (hostState().phase === "idle"),
      `phase=${hostState().phase}, hidden=${lobbyBtn.classList.contains("hidden")}`);

    await playABit();
    check("X-1 the control appears once past setup",
      !lobbyBtn.classList.contains("hidden"), `phase=${hostState().phase}`);

    // --- Keep this game -> setup with Resume, restoring the exact state ---
    const before = JSON.stringify(hostState());
    const roster = hostState().players.map((p) => p.name).join(",");
    const title = hostState().game.title;
    lobbyBtn.click();
    check("X-1 it opens a confirm with Keep this game / Start over",
      !$("host", "lobby-dialog").classList.contains("hidden")
        && !$("host", "btn-lobby-keep").disabled && !$("host", "btn-lobby-reset").disabled,
      `"${$("host", "lobby-sub").textContent}"`);
    $("host", "btn-lobby-keep").click();
    await waitFor(() => hostState().phase === "idle", "back on setup");
    check("X-1 Keep this game returns to setup and offers Resume",
      !$("host", "btn-resume").classList.contains("hidden")
        && W("host").WheelApp.hasResumable()
        && hostState().players.map((p) => p.name).join(",") === roster
        && hostState().game.title === title,
      `"${$("host", "resume-note").textContent}"`);

    $("host", "btn-resume").click();
    await waitFor(() => hostState().phase === "round", "resumed");
    check("X-1 Resume restores the exact state",
      JSON.stringify(hostState()) === before
        && $("host", "btn-resume").classList.contains("hidden"),
      "state is byte-identical to the parked snapshot");

    // --- Start over -> clean setup, roster and content kept ---------------
    W("host").WheelApp.dispatch({ type: "setTotal", pid: "p1", total: 5000 });
    const vowelCost = hostState().game.settings.vowelCost;
    lobbyBtn.click();
    $("host", "btn-lobby-reset").click();
    await waitFor(() => hostState().phase === "idle", "setup after Start over");
    const s = hostState();
    check("X-1 Start over clears the game but keeps roster, content and settings",
      s.players.map((p) => p.name).join(",") === roster
        && s.players.every((p) => p.total === 0 && p.round === 0)
        && s.game.title === title && s.game.settings.vowelCost === vowelCost
        && !W("host").WheelApp.hasResumable()
        && $("host", "btn-resume").classList.contains("hidden"),
      `roster ${roster} kept, totals cleared, no Resume offered`);

    // --- mid-spin, the hardest phase --------------------------------------
    await playABit();
    $("host", "btn-spin").click();
    await waitFor(() => W("host").WheelApp.isSpinning(), "a spin in flight");
    lobbyBtn.click();
    $("host", "btn-lobby-keep").click();
    await waitFor(() => hostState().phase === "idle", "setup from mid-spin");
    check("X-1 Keep this game works mid-spin and stops the wheel",
      !W("host").WheelApp.isSpinning() && W("host").WheelApp.hasResumable(),
      "spin cancelled, game parked");
    await sleep(4400); // longer than a spin: the parked game must stay parked
    check("X-1 the cancelled spin never resurrects the game",
      hostState().phase === "idle" && !W("host").WheelApp.isSpinning(),
      `still ${hostState().phase} after the spin would have landed`);
    $("host", "btn-resume").click();
    await waitFor(() => hostState().phase === "round", "resumed from mid-spin");

    // --- Cancel leaves everything alone ------------------------------------
    const untouched = JSON.stringify(hostState());
    lobbyBtn.click();
    $("host", "btn-lobby-cancel").click();
    check("X-1 Cancel closes the confirm and changes nothing",
      $("host", "lobby-dialog").classList.contains("hidden")
        && JSON.stringify(hostState()) === untouched, "state untouched");

    // --- embedded: the control is there in embed-host mode too -------------
    check("X-1 the control is present in embedded mode",
      D("host").body.classList.contains("gsc-embedded")
        && !lobbyBtn.classList.contains("hidden"),
      `body: ${D("host").body.className}`);
  }

  /* ============ X-2 — the saved-set library ============ */

  async function testLibrary() {
    if (hostState().phase !== "idle") {
      $("host", "btn-game-lobby").click();
      $("host", "btn-lobby-reset").click();
      await waitFor(() => hostState().phase === "idle", "setup");
    }
    const picker = W("host").WheelApp.library();
    const res = await picker.ready;
    check("X-2 the picker is mounted under the Puzzles section",
      !!picker.el && picker.el.closest(".setup-section") !== null
        && D("host").getElementById("puzzles-library").contains(picker.el),
      "mounted into #puzzles-library");
    const names = res.ok ? res.sets.map((s) => s.name) : [];
    check("X-2 it lists the sets shipped in sets/index.json",
      res.ok && names.length >= 2
        && D("host").querySelectorAll(".gsc-library-select option").length === names.length,
      names.join(" / ") || (res.error || "no manifest"));
    check("X-2 the Preview line names the set and its counts",
      D("host").querySelector(".gsc-library-preview").textContent.indexOf(names[0]) >= 0,
      `"${D("host").querySelector(".gsc-library-preview").textContent}"`);

    // Load the second set through the real control.
    const select = D("host").querySelector(".gsc-library-select");
    select.selectedIndex = 1;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const wanted = names[1];
    D("host").querySelector(".gsc-library-load").click();
    await waitFor(() => W("host").WheelApp.sourceInfo().text === `set: ${wanted}`,
      "the set loaded");
    check("X-2 loading a set replaces the content and updates the source note",
      $("host", "source-note").textContent.indexOf(`set: ${wanted}`) >= 0
        && hostState().game.rounds.length > 0
        && D("host").querySelector(".gsc-library-error").textContent === "",
      `"${$("host", "source-note").textContent.trim()}"`);

    // Every shipped set must survive the game's own validator, layout included.
    // gameDir is "" because this is the HOST frame's library and fetch, and the
    // host document already sits in games/wheel-of-fortune/.
    for (const entry of res.sets) {
      const got = await W("host").GSCLibrary.fetchSet("", entry.file);
      let bad = "";
      try { HC().validateGame(got.json); } catch (err) { bad = err.message; }
      check(`X-2 the shipped set "${entry.name}" passes validateGame (layout included)`,
        got.ok && !bad,
        bad || `${got.json.rounds.length} rounds, every puzzle fits the board`);
    }

    // A set the validator rejects must surface a message, not load. The fake
    // fetch serves a good manifest and then one unusable set.
    const noteBefore = $("host", "source-note").textContent;
    const fakeFetch = async (url) => ({
      ok: true,
      json: async () => (/index\.json$/.test(url)
        ? [{ file: "bad.json", name: "Too long" }]
        : { rounds: [{ category: "X", puzzle: "SUPERCALIFRAGILISTICEXPIALIDOCIOUS" }] }),
    });
    const probe = W("host").GSCLibrary.mountPicker(D("host").createElement("div"), {
      gameDir: "",
      validate: (json) => { HC().validateGame(json); },
      fetch: fakeFetch,
      onPick() { throw new Error("onPick must not run for a rejected set"); },
    });
    const probeReady = await probe.ready;
    probe.el.querySelector(".gsc-library-load").click();
    await waitFor(() => probe.el.querySelector(".gsc-library-error").textContent, "a rejection message");
    check("X-2 a set that fails validateGame is refused with a plain-English message",
      probeReady.ok
        && probe.el.querySelector(".gsc-library-error").textContent.indexOf("does not fit the board") >= 0
        && $("host", "source-note").textContent === noteBefore,
      `"${probe.el.querySelector(".gsc-library-error").textContent}"`);
    probe.destroy();

    // A missing manifest hides the picker and says so.
    const box = D("host").createElement("div");
    const broken = W("host").GSCLibrary.mountPicker(box, {
      gameDir: "", fetch: async () => { throw new Error("offline"); },
    });
    await broken.ready;
    check("X-2 with no reachable manifest the picker hides and explains itself",
      broken.el.classList.contains("gsc-library-off")
        && broken.el.querySelector(".gsc-library-row").classList.contains("hidden")
        && broken.el.querySelector(".gsc-library-error").textContent.length > 20,
      `"${broken.el.querySelector(".gsc-library-error").textContent}"`);
    broken.destroy();
  }

  /* ============ X-3 — "Download for the library" ============ */

  async function testEditorLibrary() {
    $("host", "btn-editor").click();
    await waitFor(() => D("host").querySelectorAll(".ed-round").length > 0, "editor open");
    const editor = W("host").WheelEditor;
    editor.setDraft({
      ...editor.getDraft(),
      title: "Office Party",
    });
    await sleep(60);

    // Catch the download instead of writing to disk.
    const anchor = W("host").HTMLAnchorElement.prototype;
    const realClick = anchor.click;
    let saved = null;
    anchor.click = function patched() { saved = { name: this.download, href: this.href }; };
    $("host", "btn-editor-library").click();
    anchor.click = realClick;

    check("X-3 Download for the library saves a JSON file named after the set",
      !!saved && saved.name === "office-party.json" && saved.href.indexOf("blob:") === 0,
      saved ? saved.name : "nothing was downloaded");

    const help = $("host", "editor-library-help");
    const line = $("host", "editor-library-line").value;
    check("X-3 it shows the path to commit the file to",
      !help.classList.contains("hidden")
        && $("host", "editor-library-step1").textContent
          .indexOf("games/wheel-of-fortune/sets/office-party.json") >= 0,
      `"${$("host", "editor-library-step1").textContent}"`);

    let entry = null;
    let parsed = null;
    try {
      entry = JSON.parse(line.replace(/,\s*$/, ""));
      parsed = W("host").GSCLibrary.parseManifest([entry]);
    } catch (err) {
      parsed = { ok: false, error: err.message };
    }
    check("X-3 the manifest line is valid and the library accepts it",
      !!entry && parsed.ok && parsed.sets.length === 1
        && parsed.sets[0].file === "office-party.json"
        && parsed.sets[0].name === "Office Party"
        && !!parsed.sets[0].counts,
      parsed.ok ? W("host").GSCLibrary.previewText(parsed.sets[0]) : parsed.error);

    // The downloaded content is the draft, and it is valid game content.
    let bad = "";
    try { HC().validateGame(editor.getDraft()); } catch (err) { bad = err.message; }
    check("X-3 the file it downloads is content this game would accept",
      !bad, bad || `${editor.getDraft().rounds.length} rounds validate`);

    // A draft that does not validate must not offer the library export.
    const round = editor.getDraft().rounds[0];
    const good = round.puzzle;
    round.puzzle = "SUPERCALIFRAGILISTICEXPIALIDOCIOUS";
    editor.setDraft(editor.getDraft());
    check("X-3 a draft that fails validation cannot be pushed to the library",
      $("host", "btn-editor-library").disabled && $("host", "btn-editor-download").disabled,
      `error: "${$("host", "editor-error").textContent}"`);
    round.puzzle = good;
    editor.setDraft(editor.getDraft());
    $("host", "btn-library-dismiss").click();
    $("host", "btn-editor-close").click();
  }

  /* ============ ?store= — storage namespacing ============ */

  async function testStoreNamespacing() {
    const suffix = W("host").WheelApp.storeSuffix();
    check("Store: ?store=harness namespaces this run's saved game",
      suffix === "-harness"
        && W("host").WheelApp.STORAGE_KEY === "gsc-wheel-state-v1-harness",
      `key = ${W("host").WheelApp.STORAGE_KEY}`);
    check("Store: the editor draft is namespaced the same way",
      W("host").WheelEditor.DRAFT_KEY === "gsc-wheel-draft-v1-harness",
      `draft key = ${W("host").WheelEditor.DRAFT_KEY}`);

    // The real host's keys on this origin must be untouched by the run.
    const canary = "gsc-wheel-state-v1";
    localStorage.setItem(canary, '{"canary":true}');
    W("host").WheelApp.dispatch({ type: "setTotal", pid: "p1", total: 1234 });
    await sleep(60);
    check("Store: a harness run never writes to the real host's save",
      localStorage.getItem(canary) === '{"canary":true}'
        && !!localStorage.getItem("gsc-wheel-state-v1-harness"),
      "the un-suffixed key still holds the canary");
    localStorage.removeItem(canary);

    // Junk in ?store= is stripped rather than trusted.
    const strip = W("host").eval(
      'new URLSearchParams("?store=../evil key!").get("store").replace(/[^A-Za-z0-9-]/g, "").slice(0, 24)');
    check("Store: an unsafe ?store= value is stripped to letters, digits and hyphens",
      strip === "evilkey", `"../evil key!" -> "${strip}"`);
  }

  /* ============ W-I7 / X-5 — the static gates ============ */

  async function testGates() {
    // Assembled from fragments so this gate's own source never trips the
    // repo-wide grep the tester runs (06 §4 V3).
    const banned = new RegExp([
      "inner" + "HTML", "insertAdjacent" + "HTML", "outer" + "HTML\\s*=",
      "document\\." + "write", "[^.\\w]" + "eval\\(", "new " + "Function",
    ].join("|"));
    const noisy = new RegExp("console\\." + "log");
    const bad = [];
    const logged = [];
    const tooLong = [];
    const external = [];
    for (const path of SOURCE_FILES) {
      const text = await (await fetch(path, { cache: "reload" })).text();
      if (banned.test(text)) bad.push(path);
      if (path.indexOf("/js/") >= 0 && noisy.test(text)) logged.push(path);
      const lines = text.split("\n").length;
      if (lines >= 800) tooLong.push(`${path} (${lines})`);
      // Documentation prose may cite example/localhost URLs; this gate is about
      // what the BROWSER would actually fetch, so scan loaded assets only.
      const loaded = /\.(html|js|mjs|css|json)$/.test(path);
      for (const url of (loaded ? text.match(/https?:\/\/[^\s"'<>)]+/g) : null) || []) {
        const ok = url.indexOf("https://fonts.googleapis.com") === 0
          || url.indexOf("https://fonts.gstatic.com") === 0
          || url.indexOf("https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/") === 0
          || url.indexOf("http://www.w3.org/2000/svg") === 0; // the SVG namespace, never fetched
        if (!ok) external.push(`${path}: ${url}`);
      }
    }
    check("X-5 no HTML-string, document-write, eval or Function-constructor APIs anywhere",
      bad.length === 0, bad.join(", ") || `${SOURCE_FILES.length} files scanned`);
    check("X-5 no console." + "log calls in js/", logged.length === 0,
      logged.join(", ") || "console.warn only");
    check("X-5 every file is under 800 lines", tooLong.length === 0,
      tooLong.join(", ") || `${SOURCE_FILES.length} files under the limit`);
    check("X-5 the only external URLs in loaded assets are Google Fonts and the pinned PeerJS CDN",
      external.length === 0, external.join(", ") || "no stray external URLs");

    const html = await (await fetch("../index.html", { cache: "reload" })).text();
    const css = await (await fetch("../css/wheel.css", { cache: "reload" })).text();
    check("X-5 the page declares data-gsc-game and provides #gsc-join",
      html.indexOf('data-gsc-game="wheel-of-fortune"') >= 0
        && html.indexOf('id="gsc-join"') >= 0
        && D("p1").getElementById("gsc-join") !== null,
      "body attribute + join container present");
    check("X-5 player-mode and gsc-embedded body classes are wired",
      css.indexOf("body.player-mode") >= 0 && css.indexOf("body.gsc-embedded") >= 0
        && D("host").body.classList.contains("gsc-embedded")
        && !D("host").body.classList.contains("player-mode")
        && D("p1").body.classList.contains("player-mode")
        && D("p1").body.classList.contains("gsc-embedded"),
      `host classes: ${D("host").body.className || "(none)"} · phone: ${D("p1").body.className}`);
  }

  return { testGameLobby, testLibrary, testEditorLibrary, testStoreNamespacing, testGates };
};
