/* ============================================================
   Millionaire — the cross-cutting harness scenarios (docs/19 §4)
   X-1 the Game lobby, X-2 the question-set library, X-3 the
   editor's "Download for the library". Split out of
   tests/harness.html so both files stay under the 800-line house
   limit; the harness loads this first and calls the factory with
   its own helper bag, so these run inside the same shell.
   ============================================================ */

"use strict";

/** @param {object} bag the harness helpers: check, waitFor, click, core, HW, HD, H, ... */
window.WwmXScenarios = function WwmXScenarios(bag) {
  "use strict";

  const { check, waitFor, click, core, HW, HD, H, bootHost, phoneChoices, answerCorrectly } = bag;
  /* ============================================================
     X-1 — the Game lobby control (docs/19 §1, §4)
     ============================================================ */

  /** Play far enough to have a contestant seated with an audience window open. */
  async function seatWithAudienceOpen() {
    click("btn-start");
    await waitFor(() => core() && (core().phase === "fff" || core().phase === "pick"), "a fresh game");
    HD().querySelectorAll("#wwm-pick-list .pick-btn")[0].click();
    await waitFor(() => core().phase === "hotseat", "somebody in the hot seat");
    answerCorrectly();
    HD().querySelectorAll("#wwm-lifelines .lifeline")[2].click();
    await waitFor(() => core().audience.open, "an audience window");
    // The ballot reaches the phone over postMessage, so wait for the button.
    const ballot = await waitFor(() => phoneChoices("p2")[1], "p2's ballot");
    ballot.click();
    await waitFor(() => HW().WwmCore.chart(core()).total === 1, "a vote in the window");
  }

  async function scenarioLobby() {
    check("X-1 the toolbar carries a Game lobby control next to Sound and the editor",
      !!H("btn-game-lobby") && H("btn-game-lobby").textContent.indexOf("Game lobby") > 0
      && H("btn-game-lobby").parentNode === H("btn-sound").parentNode,
      H("btn-game-lobby") ? H("btn-game-lobby").textContent : "missing");

    // --- from the standings: Keep, then Resume, must be exact ---
    const standings = JSON.parse(JSON.stringify(core()));
    click("btn-game-lobby");
    await waitFor(() => !H("wwm-lobby-confirm").classList.contains("hidden"), "the confirm opens");
    check("X-1 the confirm offers Keep this game and Start over",
      !!H("btn-lobby-keep") && !!H("btn-lobby-restart")
      && H("wwm-lobby-confirm").getAttribute("role") === "dialog",
      H("wwm-lobby-sub").textContent);
    click("btn-lobby-keep");
    check("X-1 Keep this game returns to setup with the game parked",
      core() === null && !H("screen-setup").classList.contains("hidden")
      && H("wwm-lobby-confirm").classList.contains("hidden")
      && !H("btn-resume").classList.contains("hidden")
      && HW().WwmApp.state().resumable !== null,
      H("wwm-resume-note").textContent);
    click("btn-resume");
    check("X-1 Resume from the standings restores the state exactly",
      JSON.stringify(core()) === JSON.stringify(standings)
      && HW().WwmApp.state().resumable === null,
      `phase ${core().phase}`);

    // --- Start over keeps the roster, the questions and the settings ---
    const roster = HW().WwmApp.state().setup.players.map((pl) => pl.name).join(",");
    const title = HW().WwmApp.state().game.title;
    click("btn-game-lobby");
    click("btn-lobby-restart");
    check("X-1 Start over clears the game but keeps roster, content and settings",
      core() === null && HW().WwmApp.state().resumable === null
      && HW().WwmApp.state().setup.players.map((pl) => pl.name).join(",") === roster
      && HW().WwmApp.state().game.title === title
      && H("btn-resume").classList.contains("hidden"),
      `${roster} · ${title}`);

    // --- mid-question, with a live audience window: the deadline must survive ---
    await seatWithAudienceOpen();
    const live = JSON.parse(JSON.stringify(core()));
    const deadline = core().audience.deadline;
    click("btn-game-lobby");
    click("btn-lobby-keep");
    check("X-1 Keep works from the hot seat too, mid-lifeline",
      core() === null && HW().WwmApp.state().resumable.audience.open === true
      && H("wwm-audience").classList.contains("hidden"),
      H("wwm-resume-note").textContent);
    click("btn-resume");
    check("X-1 Resume restores an OPEN audience window with the same deadline",
      core().audience.open === true && core().audience.deadline === deadline
      && HW().WwmCore.chart(core()).total === 1
      && !H("wwm-audience").classList.contains("hidden")
      && JSON.stringify(core()) === JSON.stringify(live),
      `deadline ${core().audience.deadline === deadline ? "identical" : "CHANGED"}, `
      + `${HW().WwmCore.chart(core()).total} vote(s) kept`);

    // --- and the parked game survives a reload ---
    click("btn-game-lobby");
    click("btn-lobby-keep");
    await bootHost(false);
    await waitFor(() => HW().WwmApp.state().resumable, "the parked game comes back");
    check("X-1 a parked game survives a reload and still resumes",
      core() === null && !H("btn-resume").classList.contains("hidden")
      && HW().WwmApp.state().resumable.audience.deadline === deadline,
      H("wwm-resume-note").textContent);
    click("btn-resume");
    check("X-1 the resumed game is the one that was parked",
      core().audience.deadline === deadline && core().phase === "hotseat");
    click("btn-game-lobby");
    click("btn-lobby-restart");     // leave a clean setup for the library checks
    await waitFor(() => core() === null, "back to a clean setup");
  }

  /* ============================================================
     X-2 — the question-set library (docs/19 §2, §4)
     ============================================================ */

  async function scenarioLibrary() {
    const picker = HW().WwmApp.picker();
    check("X-2 the shared picker is mounted under the Questions section",
      !!picker && !!picker.el && picker.el.parentNode === H("wwm-library"),
      picker && picker.el ? picker.el.className : "not mounted");
    await picker.ready;
    const select = H("wwm-library").querySelector(".gsc-library-select");
    const names = [...select.options].map((o) => o.textContent).join(" | ");
    check("X-2 the picker lists the shipped sets",
      select.options.length === 2 && names.indexOf("Movies & TV") >= 0
      && names.indexOf("Kids' night") >= 0, names);
    check("X-2 the preview line describes the highlighted set",
      H("wwm-library").querySelector(".gsc-library-preview").textContent.indexOf("45 questions") > 0,
      H("wwm-library").querySelector(".gsc-library-preview").textContent);

    select.value = "movies-tv.json";
    select.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
    H("wwm-library").querySelector(".gsc-library-load").click();
    await waitFor(() => HW().WwmApp.state().sourceKind === "library", "the set loads");
    check("X-2 loading a set validates it and becomes the current content",
      HW().WwmApp.state().game.questions.length === 45
      && HW().WwmCore.validateGame(HW().WwmApp.state().game) === true
      && HW().WwmApp.state().core === null,
      `${HW().WwmApp.state().game.title}`);
    check("X-2 the source note names the set",
      HW().WwmApp.state().source === "set: Movies & TV"
      && H("wwm-source").textContent === "set: Movies & TV",
      H("wwm-source").textContent);

    // A manifest that is not a list, and a page with no server at all.
    const scratch = HD().createElement("div");
    HD().body.appendChild(scratch);
    const broken = HW().GSCLibrary.mountPicker(scratch, {
      gameDir: "", fetch: async () => ({ ok: true, json: async () => ({ nope: 1 }) }),
    });
    await broken.ready;
    check("X-2 a broken manifest hides the picker and says so in plain English",
      broken.el.classList.contains("gsc-library-off")
      && broken.el.querySelector(".gsc-library-error").textContent.length > 20
      && broken.el.querySelector(".gsc-library-row").classList.contains("hidden"),
      broken.el.querySelector(".gsc-library-error").textContent);
    broken.destroy();

    const offline = HW().GSCLibrary.mountPicker(scratch, {
      gameDir: "", fetch: async () => { throw new Error("file://"); },
    });
    await offline.ready;
    check("X-2 opened from disk the picker hides with a message, breaking nothing else",
      offline.el.classList.contains("gsc-library-off")
      && /web server/i.test(offline.el.querySelector(".gsc-library-error").textContent)
      && !H("screen-setup").classList.contains("hidden"),
      offline.el.querySelector(".gsc-library-error").textContent);
    offline.destroy();
    scratch.remove();
  }

  /* ============================================================
     X-3 — Download for the library (docs/19 §2, §4)
     ============================================================ */

  async function scenarioLibraryDownload() {
    click("btn-editor");
    await waitFor(() => !H("screen-editor").classList.contains("hidden"), "editor opens");
    click("btn-editor-reset");     // the shipped set, so the download is a real one

    let captured = null;
    let filename = "";
    const realCreate = HW().URL.createObjectURL;
    HW().URL.createObjectURL = (blob) => { captured = blob; return realCreate.call(HW().URL, blob); };
    const realClick = HW().HTMLAnchorElement.prototype.click;
    HW().HTMLAnchorElement.prototype.click = function spy() { filename = this.download; };
    click("btn-editor-library");
    await waitFor(() => captured, "the library download");
    HW().URL.createObjectURL = realCreate;
    HW().HTMLAnchorElement.prototype.click = realClick;

    const text = await captured.text();
    check("X-3 Download for the library produces a file that passes validateGame",
      HW().WwmCore.validateGame(JSON.parse(text)) === true
      && JSON.parse(text).questions.length === 45
      && /^[a-z0-9-]+\.json$/.test(filename),
      `${filename}, ${JSON.parse(text).questions.length} questions`);

    const box = H("wwm-editor-manifest");
    const codes = [...box.querySelectorAll(".manifest-code")].map((n) => n.textContent);
    check("X-3 it shows the path to commit and the exact manifest line",
      !box.classList.contains("hidden") && codes.length === 2
      && codes[0] === `games/millionaire/sets/${filename}`,
      codes.join("  ||  "));
    let entry = null;
    try { entry = JSON.parse(codes[1]); } catch (err) { entry = null; }
    check("X-3 the manifest line is valid JSON the shared library accepts",
      !!entry && entry.file === filename
      && HW().GSCLibrary.parseManifest([entry]).ok === true
      && HW().GSCLibrary.parseManifest([entry]).sets[0].file === filename,
      codes[1]);
    click("btn-editor-close");
    await waitFor(() => H("screen-editor").classList.contains("hidden"), "editor closes");

    // X-2 swapped the content for a library set and this scenario built an
    // editor draft from it. Put the harness fixture back so the M-I scenarios
    // that follow still see the game they were written against.
    const res = await HW().fetch("tests/fixtures/harness-game.json", { cache: "no-store" });
    const fixture = await res.json();
    HW().WwmApp.useGame(fixture, "Built-in questions (questions.json)", "default");
    HW().WwmEditor.setDraft(JSON.parse(JSON.stringify(HW().WwmApp.state().game)));
    check("X-3 the library round trip leaves the game exactly as it found it",
      HW().WwmApp.state().game.questions.length === 30
      && HW().WwmEditor.draft().questions.length === 30,
      `${HW().WwmApp.state().game.questions.length} questions back in play`);
  }

  return { scenarioLobby, scenarioLibrary, scenarioLibraryDownload };
};
