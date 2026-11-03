/* ============================================================
   Weakest Link — cross-cutting harness scenarios (docs/19)

   X-1 the Game lobby control (Keep this game / Start over / Resume),
   X-2 the shared question-set library picker,
   X-3 the editor's "Download for the library",
   X-5 the ?store= storage namespace.

   Split out of tests/harness.html so that page stays under the
   800-line gate it enforces (V2). The harness hands us its own
   helpers, so every assertion still runs against the real game
   page in the real iframe.
   ============================================================ */

"use strict";

window.WLCross = function (ctx) {
  const { check, click, waitFor, H, HD, HW, core, bootHost, hostFrame, STORE, REAL_KEYS, REAL_BEFORE } = ctx;
  const HL = () => hostFrame.contentWindow.WlLobby;


  /** Drive a fresh game up to a known mid-round state, clock running. */
  async function toMidRound() {
    await bootHost();
    await waitFor(() => HW().WlApp.state().setup.players.length === 5, "roster");
    click("btn-start");
    await waitFor(() => core() && core().phase === "round", "round");
    click("btn-correct"); click("btn-correct"); click("btn-bank"); click("btn-wrong");
    click("btn-clock");
    await waitFor(() => core().clock.running, "clock running");
  }

  async function gameLobby() {
    await toMidRound();
    const before = JSON.parse(JSON.stringify(core()));
    check("X-1 the toolbar carries the Game lobby control",
      !!H("btn-game-lobby") && /Game lobby/.test(H("btn-game-lobby").textContent),
      H("btn-game-lobby").textContent.trim());

    click("btn-game-lobby");
    check("X-1 it opens a confirm offering Keep this game / Start over",
      HL().isOpen() && !H("btn-lobby-keep").disabled
      && /Start over/.test(H("btn-lobby-start-over").textContent),
      H("wl-lobby-text").textContent);

    click("btn-lobby-keep");
    check("X-1 Keep this game returns to setup and offers Resume",
      core() === null && !H("screen-setup").classList.contains("hidden")
      && !H("btn-resume").classList.contains("hidden")
      && /Resume round 1/.test(H("btn-resume").textContent),
      H("btn-resume").textContent);
    check("X-1 the parked clock is paused, not left running",
      HW().WlApp.state().resumable.clock.running === false
      && HW().WlApp.state().resumable.clock.remainingMs > 0,
      HW().WlApp.state().resumable.clock.remainingMs + "ms parked");

    click("btn-resume");
    await waitFor(() => core(), "resumed");
    const after = core();
    check("X-1 Resume restores the exact state",
      after.phase === before.phase && after.roundBank === before.roundBank
      && after.turnPid === before.turnPid && after.qIndex === before.qIndex
      && JSON.stringify(after.roundStats) === JSON.stringify(before.roundStats)
      && after.clock.running === false,
      "phase " + after.phase + ", bank " + after.roundBank + ", turn " + after.turnPid + ", clock paused");

    const roster = HW().WlApp.state().setup.players.map((p) => p.name).join(",");
    const questions = HW().WlApp.state().game.questions.length;
    click("btn-game-lobby");
    click("btn-lobby-start-over");
    check("X-1 Start over clears the game, keeping roster, content and settings",
      core() === null && !HW().WlApp.state().resumable
      && HW().WlApp.state().setup.players.map((p) => p.name).join(",") === roster
      && HW().WlApp.state().game.questions.length === questions
      && H("btn-resume").classList.contains("hidden"),
      roster + " / " + questions + " questions / no Resume offered");

    click("btn-start");
    await waitFor(() => core().phase === "round", "round again");
    click("btn-end-round");
    await waitFor(() => core().phase === "voting", "voting");
    click("btn-game-lobby"); click("btn-lobby-keep");
    check("X-1 it works from a later phase too (voting)",
      core() === null && HW().WlApp.state().resumable.phase === "voting");

    await bootHost(false);
    check("X-1 a parked game survives a reload and is still offered",
      !H("btn-resume").classList.contains("hidden")
      && HW().WlApp.state().resumable.phase === "voting",
      H("btn-resume").textContent);
    click("btn-resume");
    await waitFor(() => core() && core().phase === "voting", "resumed after reload");
    check("X-1 Resume after a reload lands back in the same phase", core().phase === "voting");
    click("btn-game-lobby"); click("btn-lobby-start-over");
  }

  async function library() {
    await bootHost();
    const picker = await waitFor(() => HD().querySelector("#wl-library .gsc-library"), "picker mounts");
    const options = [...picker.querySelectorAll("option")].map((o) => o.textContent);
    check("X-2 the library picker lists the shipped sets",
      options.length === 2 && options.indexOf("Pop culture") >= 0
      && options.indexOf("Science & nature") >= 0,
      options.join(", "));
    check("X-2 the picker previews the selected set",
      /Pop culture/.test(picker.querySelector(".gsc-library-preview").textContent),
      picker.querySelector(".gsc-library-preview").textContent);

    const select = picker.querySelector(".gsc-library-select");
    select.value = "science-nature.json";
    select.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
    picker.querySelector(".gsc-library-load").click();
    await waitFor(() => HW().WlApp.state().sourceKind === "library", "set loaded");
    check("X-2 loading a set validates it and becomes the current content",
      HW().WlApp.state().game.questions.length === 66
      && HW().WlApp.state().source === "set: Science & nature"
      && /set: Science & nature/.test(H("wl-source").textContent),
      HW().WlApp.state().game.questions.length + " questions — " + H("wl-source").textContent);
    click("btn-start");
    check("X-2 the loaded set really plays",
      core() !== null && core().phase === "round" && H("wl-q-text").textContent.length > 10,
      H("wl-q-text").textContent);
    click("btn-game-lobby"); click("btn-lobby-start-over");

    const box = HD().createElement("div");
    HD().body.appendChild(box);
    const bad = HW().GSCLibrary.mountPicker(box, {
      gameDir: "",
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ nope: 1 }) }),
    });
    await bad.ready;
    check("X-2 a broken manifest hides the picker and says so",
      box.querySelector(".gsc-library").classList.contains("gsc-library-off")
      && box.querySelector(".gsc-library-error").textContent.length > 10,
      box.querySelector(".gsc-library-error").textContent);

    const offline = HD().createElement("div");
    HD().body.appendChild(offline);
    const off = HW().GSCLibrary.mountPicker(offline, {
      gameDir: "", fetch: () => Promise.reject(new Error("file://")),
    });
    await off.ready;
    check("X-2 from disk the picker hides with a plain-English note",
      /web server/i.test(offline.querySelector(".gsc-library-error").textContent),
      offline.querySelector(".gsc-library-error").textContent);
    bad.destroy(); off.destroy(); box.remove(); offline.remove();
  }

  async function libraryDownload() {
    click("btn-editor");
    await waitFor(() => !H("screen-editor").classList.contains("hidden"), "editor");
    click("btn-editor-reset");
    // Capture the download instead of writing a file.
    let saved = null;
    const realCreate = HD().createElement.bind(HD());
    HD().createElement = (tag) => {
      const node = realCreate(tag);
      if (tag === "a") node.click = () => { saved = { name: node.download }; };
      return node;
    };
    const file = HW().WlLibrary.downloadForLibrary();
    HD().createElement = realCreate;
    const out = H("wl-ed-library-out").textContent;
    check("X-3 Download for the library saves a file and names the path to commit",
      !!saved && saved.name === file && /sets\//.test(out)
      && !H("wl-ed-library-out").classList.contains("bad"),
      (saved ? saved.name : "no file") + " — " + out.split("\n")[0]);

    let line = null;
    try { line = JSON.parse(out.slice(out.indexOf("{"))); } catch (err) { line = null; }
    check("X-3 the manifest line it prints is valid and passes GSCLibrary",
      !!line && HW().GSCLibrary.safeFile(line.file) === file
      && HW().GSCLibrary.parseManifest([line]).ok
      && line.counts.questions === 160,
      JSON.stringify(line));

    click("btn-editor-blank");
    HW().WlLibrary.downloadForLibrary();
    check("X-3 an invalid draft is refused with a plain-English reason",
      H("wl-ed-library-out").classList.contains("bad")
      && /at least 40 questions/.test(H("wl-ed-library-out").textContent),
      H("wl-ed-library-out").textContent);
    click("btn-editor-reset");
    click("btn-editor-close");
  }

  async function store() {
    check("X-5 the harness runs in its own storage namespace",
      HW().WlStore.STATE_KEY === "gsc-wl-state-v1-" + STORE
      && HW().WlStore.DRAFT_KEY === "gsc-wl-draft-v1-" + STORE,
      HW().WlStore.STATE_KEY + " / " + HW().WlStore.DRAFT_KEY);
    check("X-5 this run left the real host's keys untouched",
      REAL_KEYS.every((k, i) => localStorage.getItem(k) === REAL_BEFORE[i]),
      REAL_KEYS.map((k, i) => k + "=" + (localStorage.getItem(k) === REAL_BEFORE[i] ? "unchanged" : "CHANGED")).join(", "));
  }
  return { gameLobby, library, libraryDownload, store };
};
