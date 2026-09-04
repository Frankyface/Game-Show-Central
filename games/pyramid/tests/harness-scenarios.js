/* ============================================================
   Pyramid — the second half of the loopback harness
   Split out of tests/harness.html only so both files stay under
   the 800-line house cap (the same reason pyr-fixtures.mjs exists
   beside the unit suites). This is not a second harness: the page
   hands these scenarios its own helpers and awaits them in order,
   so every check still runs in one pass and reports into the same
   PASS/FAIL list.

   Holds the editor round-trip, End the night, the Game lobby
   (docs/19 §1), the name-adoption rule, the splash, and the set
   library (docs/19 §2).
   ============================================================ */

"use strict";

/**
 * @param {object} ctx the harness page's helpers — see tests/harness.html
 * @returns {{editor:Function, endNight:Function, gameLobby:Function,
 *            adopt:Function, splash:Function, library:Function}}
 */
window.PyrHarnessScenarios = function (ctx) {
  "use strict";

  const { check, waitFor, sleep, H, HD, HW, core, click, hostText, freeCards, phoneView, phoneWord } = ctx;

    /* ============================================================
       Y-I6 — the editor round-trip, the splash, and the static gates
       ============================================================ */

    async function scenarioEditor() {
      click("btn-editor");
      await waitFor(() => !H("screen-editor").classList.contains("hidden"), "editor opens");
      check("Y-I6 the editor shows every category with a field per word",
        HD().querySelectorAll("#pyr-ed-rows .ed-row").length === 12
        && HD().querySelectorAll("#pyr-ed-rows .ed-words input").length === 48
        && HD().querySelectorAll("#pyr-ed-circles .ed-circle").length === 2,
        `${HD().querySelectorAll("#pyr-ed-rows .ed-row").length} categories, `
        + `${HD().querySelectorAll("#pyr-ed-rows .ed-words input").length} word fields`);

      let captured = null;
      const realCreate = HW().URL.createObjectURL;
      HW().URL.createObjectURL = (blob) => { captured = blob; return realCreate.call(HW().URL, blob); };
      click("btn-editor-download");
      await waitFor(() => captured, "download blob");
      HW().URL.createObjectURL = realCreate;
      const text = await captured.text();
      check("Y-I6 Download JSON produces a file that passes validateGame",
        HW().PyrCore.validateGame(JSON.parse(text)) === true && JSON.parse(text).categories.length === 12,
        `${text.length} bytes, ${JSON.parse(text).categories.length} categories`);

      // A broken draft is refused with a plain-English reason.
      const draft = HW().PyrEditor.draft();
      const keep = draft.categories[0].words[0];
      draft.categories[0].words[0] = "";
      HW().PyrEditor.setDraft(draft);
      check("Y-I6 an empty word blocks Use in game and says why",
        H("pyr-editor-msg").textContent.indexOf("word 1 is empty") > 0,
        H("pyr-editor-msg").textContent);
      draft.categories[0].words[0] = keep;
      HW().PyrEditor.setDraft(draft);

      // ---- X-3: "Download for the library" (docs/19 §2) ----
      let libBlob = null;
      const realCreate2 = HW().URL.createObjectURL;
      HW().URL.createObjectURL = (blob) => { libBlob = blob; return realCreate2.call(HW().URL, blob); };
      click("btn-editor-library");
      await waitFor(() => libBlob, "library download blob");
      HW().URL.createObjectURL = realCreate2;
      const libText = await libBlob.text();
      check("X-3 Download for the library produces a file that passes validateGame",
        HW().PyrCore.validateGame(JSON.parse(libText)) === true,
        libText.length + " bytes");
      check("X-3 it names the file from the set's title and says where to commit it",
        HW().PyrEditor.libraryFileName() === "harness-pyramid.json"
        && H("pyr-howto-path").textContent === "games/pyramid/sets/harness-pyramid.json",
        HW().PyrEditor.libraryFileName() + " -> " + H("pyr-howto-path").textContent);
      const line = H("pyr-howto-line").textContent;
      const entry = JSON.parse(line.replace(/,\s*$/, ""));
      check("X-3 the manifest line it prints is a valid sets/index.json entry",
        !H("pyr-library-howto").classList.contains("hidden")
        && entry.file === "harness-pyramid.json" && entry.name === "Harness Pyramid"
        && entry.counts.categories === 12 && entry.counts.words === 48
        && HW().GSCLibrary.parseManifest([entry]).ok === true,
        line.replace(/\s+/g, " ").slice(0, 120));

      draft.title = "Edited in the harness";
      HW().PyrEditor.setDraft(draft);
      click("btn-editor-use");
      await waitFor(() => H("screen-editor").classList.contains("hidden"), "editor closes");
      check("Y-I6 Use in game adopts the draft and clears the finished game",
        HW().PyrApp.state().game.title === "Edited in the harness"
        && HW().PyrApp.state().core === null
        && !H("screen-setup").classList.contains("hidden"),
        HW().PyrApp.state().source);
    }

    /* ============================================================
       Y-I6 — End the night, from a running category (defect Y-6)
       ============================================================ */

    async function scenarioEndNight() {
      HW().PyrApp.set({ core: null });
      await waitFor(() => !H("screen-setup").classList.contains("hidden"), "back to setup");
      click("btn-start");
      await waitFor(() => core() && core().phase === "board", "a fresh board");
      freeCards()[0].click();
      await waitFor(() => core().phase === "play", "a fresh category");
      click("btn-clock-start");
      click("btn-correct");
      check("Y-I6 the play toolbar carries an End the night that needs no word judged",
        !!H("btn-play-finish") && H("btn-play-finish").textContent === "End the night"
        && H("btn-next").classList.contains("hidden"),
        "Next is still hidden mid-round, End the night is not");
      click("btn-play-finish");
      await waitFor(() => core().phase === "standings", "straight to the standings");
      check("Y-I6 End the night mid-category goes to the standings and banks no prize",
        core().outcome === null && H("pyr-result-amount").textContent === "$0"
        && HD().querySelectorAll("#pyr-standings li").length === 2,
        `${H("pyr-result-team").textContent} — ${H("pyr-result-amount").textContent}`);
      check("Y-I6 the Winner's Circle toolbar carries the same escape",
        !!H("btn-circle-finish") && H("btn-circle-finish").textContent === "End the night");
    }

    /* ============================================================
       X-1 — "Game lobby": keep this game, or start over (docs/19 §1)
       ============================================================ */

    /** Everything Resume has to put back, as one comparable string. */
    function roundPrint() {
      const s = core();
      if (!s || !s.round) return "no round";
      const r = s.round;
      return JSON.stringify({
        slot: r.slot, team: r.team, giver: r.giverPid, cursor: r.cursor,
        words: r.words.map((w) => w.status), scores: HW().PyrCore.scores(s),
      });
    }

    const onSetup = () => !H("screen-setup").classList.contains("hidden");

    /** Open the confirm and press one of its two answers. */
    async function lobbyChoose(which) {
      click("btn-game-lobby");
      await waitFor(() => !H("pyr-lobby-modal").classList.contains("hidden"), "the confirm opens");
      click(which === "keep" ? "btn-lobby-keep" : "btn-lobby-over");
      await waitFor(() => onSetup(), "back on the setup screen");
    }

    async function scenarioGameLobby() {
      // Start a fresh game and get into a category with the clock running.
      HW().PyrApp.set({ core: null, resumable: null });
      await waitFor(() => onSetup(), "setup");
      click("btn-start");
      await waitFor(() => core() && core().phase === "board", "a fresh board");

      check("X-1 the toolbar carries the Game lobby control, next to Sound and the editor",
        !!H("btn-game-lobby") && H("btn-game-lobby").textContent.indexOf("Game lobby") > 0
        && H("btn-game-lobby").disabled === false,
        H("btn-game-lobby").textContent);

      // ---- from the board phase ----
      click("btn-game-lobby");
      await waitFor(() => !H("pyr-lobby-modal").classList.contains("hidden"), "the confirm opens");
      check("X-1 the confirm says what is on the table and what each answer keeps",
        H("pyr-lobby-body").textContent.indexOf("categories left") > 0
        && H("pyr-lobby-body").textContent.indexOf("Start over clears it") > 0,
        H("pyr-lobby-body").textContent);
      click("btn-lobby-cancel");
      check("X-1 Cancel leaves the game exactly where it was",
        H("pyr-lobby-modal").classList.contains("hidden") && core().phase === "board");

      await lobbyChoose("keep");
      check("X-1 Keep this game from the board parks it and offers Resume",
        core() === null && !!HW().PyrApp.state().resumable
        && !H("btn-resume").classList.contains("hidden")
        && H("pyr-resume-note").textContent.indexOf("clock is paused") > 0,
        H("pyr-resume-note").textContent);
      click("btn-resume");
      await waitFor(() => core() && core().phase === "board", "resumed on the board");
      check("X-1 Resume puts the board back and clears the parked copy",
        core().phase === "board" && HW().PyrApp.state().resumable === null);

      // ---- from a running category, mid-round, clock running ----
      freeCards()[0].click();
      await waitFor(() => core().phase === "play", "a category");
      click("btn-clock-start");
      click("btn-correct");
      click("btn-pass");
      await waitFor(() => core().round.clock.running, "the clock is running");
      const before = roundPrint();
      const leftBefore = core().round.clock.deadline - Date.now();

      await lobbyChoose("keep");
      const parked = HW().PyrApp.state().resumable;
      check("X-1 Keep this game from a running category parks it with the clock STOPPED",
        core() === null && !!parked && parked.phase === "play"
        && parked.round.clock.running === false && parked.round.clock.deadline === null
        && parked.round.clock.remainingMs > 0
        && Math.abs(parked.round.clock.remainingMs - leftBefore) < 2000,
        `${Math.round(parked.round.clock.remainingMs / 1000)}s parked, ${Math.round(leftBefore / 1000)}s was left`);
      check("X-1 nothing secret leaks onto the setup screen while a game is parked",
        parked.round.words.every((w) => hostText().indexOf(w.text) < 0),
        "the parked word list is not on screen");

      click("btn-resume");
      await waitFor(() => core() && core().phase === "play", "resumed mid-category");
      check("X-1 Resume restores the EXACT state — same word, same marks, same score",
        roundPrint() === before, `${roundPrint()} vs ${before}`);
      check("X-1 the resumed clock is paused and starts again from where it stopped",
        core().round.clock.running === false && core().round.started === true
        && H("btn-clock-start").textContent === "Resume",
        H("btn-clock-start").textContent);
      await waitFor(() => phoneView("p1").screen === "giver", "the phones follow the resume", 8000);
      check("X-1 the phones come back to the resumed game",
        phoneWord("p1") === HW().PyrCore.currentWord(core()),
        phoneWord("p1"));

      // ---- from the Winner's Circle ----
      HW().PyrApp.set({ core: null, resumable: null });
      click("btn-start");
      await waitFor(() => core() && core().phase === "board", "another board");
      let played = 0;
      while (core().phase !== "mainResult") {
        if (core().phase === "board") { freeCards()[0].click(); await sleep(15); continue; }
        if (!core().round.started) click("btn-clock-start");
        // One team clears its category and the other misses everything, so the
        // board ends with a clear leader and the circle buttons are on screen.
        const verdict = played === 0 ? "btn-correct" : "btn-illegal";
        let guard = 0;
        while (core().round && !core().round.finished && guard < 20) { click(verdict); guard += 1; }
        played += 1;
        click("btn-next");
        await sleep(15);
      }
      click(HW().PyrCore.leader(core()) === 1 ? "btn-to-circle-b" : "btn-to-circle-a");
      await waitFor(() => core().phase === "circle", "the Winner's Circle");
      click("btn-circle-start");
      click("btn-circle-correct");
      const circleBefore = JSON.stringify(core().circle.boxes.map((b) => b.status));
      await lobbyChoose("keep");
      check("X-1 Keep this game works from the Winner's Circle too",
        core() === null && HW().PyrApp.state().resumable.phase === "circle"
        && HW().PyrApp.state().resumable.circle.clock.running === false,
        "circle parked, clock stopped");
      click("btn-resume");
      await waitFor(() => core() && core().phase === "circle", "resumed in the circle");
      check("X-1 the circle comes back with the same boxes and the same money",
        JSON.stringify(core().circle.boxes.map((b) => b.status)) === circleBefore
        && H("pyr-circle-total").textContent === "$200",
        H("pyr-circle-total").textContent);

      // ---- Start over ----
      const rosterBefore = JSON.stringify(HW().PyrApp.state().setup);
      const gameBefore = HW().PyrApp.state().game.title;
      await lobbyChoose("over");
      check("X-1 Start over clears the game and keeps the roster, the content and the rules",
        core() === null && HW().PyrApp.state().resumable === null
        && H("btn-resume").classList.contains("hidden")
        && JSON.stringify(HW().PyrApp.state().setup) === rosterBefore
        && HW().PyrApp.state().game.title === gameBefore,
        `${HW().PyrApp.state().setup.players.length} players and "${gameBefore}" still here`);
      check("X-1 with nothing to leave or resume, the control disables itself",
        H("btn-game-lobby").disabled === true);
    }

    /* ============================================================
       Y-I6 — a phone adopts the typed row of the same name (Y-2/Y-3)
       ============================================================ */

    function scenarioAdopt() {
      const app = HW().PyrApp;
      app.set({ setup: Object.assign({}, app.state().setup, { players: [], seats: [["", ""], ["", ""]] }) });
      app.addPlayer("Zoe", null, true);                 // the host types a name
      const typed = app.state().setup.players[0].pid;
      app.setSeat(0, 0, typed);
      const adopted = app.addPlayer("zoe", "p9", false); // a phone joins under it
      const row = app.state().setup.players[0];
      check("Y-I6 a phone sharing a typed player's name takes that row over, not a refusal",
        adopted === true && app.state().setup.players.length === 1
        && row.pid === "p9" && row.manual === false && row.name === "Zoe",
        JSON.stringify(app.state().setup.players));
      check("Y-I6 the adopted row keeps the seat it was already in",
        app.state().setup.seats[0][0] === "p9",
        JSON.stringify(app.state().setup.seats));
      const twice = app.addPlayer("Zoe");
      check("Y-I6 a second TYPED player of the same name is still refused, with a reason",
        twice === false && H("pyr-error").textContent.indexOf("already on the list") > 0,
        H("pyr-error").textContent);
      app.error("");
    }

    async function scenarioSplash() {
      const node = H("gsc-splash");
      check("Y-I6 the page carries the shared .gsc-splash title card",
        !!node && node.classList.contains("gsc-splash")
        && HW().getComputedStyle(node).pointerEvents === "none",
        node ? `pointer-events: ${HW().getComputedStyle(node).pointerEvents}` : "missing");
      HD().body.classList.remove("gsc-embedded");
      HW().PyrApp.showSplash();
      check("Y-I6 the splash shows the game name and wears the game accent",
        !node.classList.contains("hidden") && H("gsc-splash-title").textContent === "Pyramid"
        && node.dataset.gscGame === "pyramid",
        `${H("gsc-splash-title").textContent} / ${H("gsc-splash-sub").textContent}`);
      await waitFor(() => node.classList.contains("hidden"), "the splash clears itself", 2500);
      const realMatch = HW().matchMedia;
      HW().matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(q), media: q,
        addEventListener() {}, removeEventListener() {} });
      HW().PyrApp.showSplash();
      const skipped = node.classList.contains("hidden");
      HW().matchMedia = realMatch;
      check("Y-I6 prefers-reduced-motion skips the splash entirely", skipped,
        skipped ? "stayed hidden" : "SHOWN under reduce");
      HD().body.classList.add("gsc-embedded");
      HW().PyrApp.showSplash();
      check("Y-I6 an embedded frame skips the card — the hub shows its own",
        node.classList.contains("hidden"),
        node.classList.contains("hidden") ? "stayed hidden when embedded" : "SHOWN over the hub's splash");
    }

    /* ============================================================
       X-2 — the shared set library (docs/19 §2)
       ============================================================ */

    const lib = (sel) => HD().querySelector("#pyr-library " + sel);

    async function scenarioLibrary() {
      await waitFor(() => lib(".gsc-library-select") && lib(".gsc-library-select").options.length, "the picker mounts");
      const names = [...lib(".gsc-library-select").options].map((o) => o.textContent);
      check("X-2 the picker lists the sets committed in games/pyramid/sets",
        names.length === 2 && names.indexOf("Movies & TV") >= 0 && names.indexOf("Kids night") >= 0,
        names.join(", "));
      check("X-2 Preview describes the highlighted set",
        lib(".gsc-library-preview").textContent.indexOf("Movies & TV") === 0
        && lib(".gsc-library-preview").textContent.indexOf("12 categories") > 0,
        lib(".gsc-library-preview").textContent);

      lib(".gsc-library-load").click();
      await waitFor(() => HW().PyrApp.state().source.indexOf("set:") === 0, "the set loads", 8000);
      check("X-2 Load set validates the file, adopts it, and names it in the source line",
        HW().PyrApp.state().source === "set: Movies & TV"
        && HW().PyrApp.state().game.categories.length === 12
        && HW().PyrCore.validateGame(HW().PyrApp.state().game) === true
        && H("pyr-source").textContent === "set: Movies & TV",
        H("pyr-source").textContent);
      check("X-2 a loaded set brings its own rules to the setup screen",
        H("pyr-category-count").textContent.indexOf("12 categories") === 0,
        H("pyr-category-count").textContent);

      // The second set carries different rules, and they reach the setup fields.
      const select = lib(".gsc-library-select");
      select.selectedIndex = names.indexOf("Kids night");
      select.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
      lib(".gsc-library-load").click();
      await waitFor(() => HW().PyrApp.state().source === "set: Kids night", "the second set loads", 8000);
      check("X-2 a second set replaces the first, rules and all",
        HW().PyrApp.state().game.settings.categorySeconds === 40
        && HW().PyrApp.state().game.settings.grandPrizeLabel === "$5,000"
        && HW().PyrApp.state().game.circles.length === 2,
        `${HW().PyrApp.state().game.settings.categorySeconds}s per category`);

      // A manifest that is not a list of sets: the picker says so and hides.
      const spare = HD().createElement("div");
      HD().body.appendChild(spare);
      const broken = HW().GSCLibrary.mountPicker(spare, {
        gameDir: "",
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ nope: 1 }) }),
      });
      await broken.ready;
      check("X-2 a broken manifest shows a plain-English message and hides the picker",
        spare.querySelector(".gsc-library-error").textContent.length > 0
        && spare.querySelector(".gsc-library").classList.contains("gsc-library-off")
        && spare.querySelector(".gsc-library-row").classList.contains("hidden"),
        spare.querySelector(".gsc-library-error").textContent);

      // No server (a page opened from disk) is a normal state, not a crash.
      const offline = HW().GSCLibrary.mountPicker(spare, {
        gameDir: "",
        fetch: () => Promise.reject(new Error("file://")),
      });
      await offline.ready;
      const offlineError = [...spare.querySelectorAll(".gsc-library-error")].pop().textContent;
      check("X-2 opened from disk, the picker explains itself instead of failing",
        offlineError.indexOf("web server") > 0, offlineError);
      broken.destroy();
      offline.destroy();
      spare.remove();
    }


  return {
    editor: scenarioEditor,
    endNight: scenarioEndNight,
    gameLobby: scenarioGameLobby,
    adopt: scenarioAdopt,
    splash: scenarioSplash,
    library: scenarioLibrary,
  };
};
