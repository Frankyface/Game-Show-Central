/* ============================================================
   Family Feud — cross-cutting harness scenarios (docs/19 §4)
   X-1 the Game lobby control, X-2 the question-set library and
   X-3 the editor's "Download for the library". Split out of
   tests/harness.html so both files stay under the 800-line house
   limit. tests/harness.html builds the shell and the helper kit
   and hands it to the factory below; nothing here runs on its own.
   ============================================================ */

"use strict";

window.FeudHarnessX = function (kit) {
  const {
    check, waitFor, sleep, HD, HW, hostState, bootHost, resetPhones,
    clickHost, dispatchHost, loadFrame, hostFrame, HOST_SRC, DRAFT_KEY, setHostReady,
  } = kit;

  /* ============ X-1 — the Game lobby control (19 §1) ============ */

  /** The game-relevant slice, for "restores the exact state" comparisons. */
  function gameShape(st) {
    return JSON.stringify({
      phase: st.phase, round: st.roundIndex, revealed: st.revealed, strikes: st.strikes,
      control: st.control, bank: st.bank, scores: st.teams.map((t) => t.score),
      awarded: st.awarded, steal: st.steal, history: st.history.length,
      fm: { stage: st.fastMoney.stage, slot: st.fastMoney.slot, rows: st.fastMoney.rows },
    });
  }

  const lobbyBtn = () => HD().getElementById("btn-game-lobby");
  const lobbyOpen = () => !HD().getElementById("game-lobby-modal").classList.contains("hidden");

  // Long by design: X-1 is one continuous story — park, resume, start over,
  // park again from Fast Money, reload — and every step depends on the state
  // the previous one left behind. Splitting it would hide that sequence.
  async function testGameLobby() {
    resetPhones();
    await bootHost();
    check("X-1 the toolbar carries a Game lobby control", !!lobbyBtn(),
      lobbyBtn() ? lobbyBtn().textContent : "missing");
    check("X-1 it is hidden on setup, where there is nothing to park",
      lobbyBtn().classList.contains("hidden"));

    // A hand-typed player + a custom team name must survive Start over.
    HD().getElementById("player-name-input").value = "Mo";
    clickHost("+ Add player");
    await waitFor(() => hostState().roster.length === 1, "manual player");
    const nameInput = HD().getElementById("team-a-name");
    nameInput.value = "Quiz Kids";
    nameInput.dispatchEvent(new (HW().Event)("input", { bubbles: true }));
    await waitFor(() => hostState().teams[0].name === "Quiz Kids", "team renamed");
    const title = hostState().game.title;

    // Mid-round.
    clickHost("Start the Feud");
    dispatchHost({ type: "giveControl", team: "A" });
    dispatchHost({ type: "play" });
    dispatchHost({ type: "reveal", index: 0 });
    dispatchHost({ type: "strike" });
    await sleep(50);
    check("X-1 it appears once a game is running", !lobbyBtn().classList.contains("hidden"));
    const midShape = gameShape(hostState());

    lobbyBtn().click();
    check("X-1 it opens a real modal confirm",
      lobbyOpen() &&
      HD().getElementById("game-lobby-modal").getAttribute("role") === "dialog" &&
      HD().getElementById("game-lobby-modal").getAttribute("aria-modal") === "true");
    check("X-1 the confirm says what is about to happen",
      /Round 1 of/.test(HD().getElementById("game-lobby-sub").textContent),
      HD().getElementById("game-lobby-sub").textContent);
    HD().getElementById("btn-lobby-cancel").click();
    check("X-1 Cancel closes it and changes nothing",
      !lobbyOpen() && gameShape(hostState()) === midShape);

    // Keep this game -> setup with a Resume that restores it exactly.
    lobbyBtn().click();
    HD().getElementById("btn-lobby-keep").click();
    await waitFor(() => hostState().phase === "setup", "keep then setup");
    check("X-1 Keep this game returns to setup with the game parked",
      hostState().phase === "setup" && !!hostState().resumable &&
      !HD().getElementById("resume-card").classList.contains("hidden"));
    check("X-1 the Resume card says what is parked",
      /Round 1 of 6/.test(HD().getElementById("resume-note").textContent),
      HD().getElementById("resume-note").textContent);
    check("X-1 Start is relabelled so the two paths are distinct",
      HD().getElementById("btn-start").textContent === "Start a fresh game",
      HD().getElementById("btn-start").textContent);
    HD().getElementById("btn-resume").click();
    await waitFor(() => hostState().phase === "play", "resume");
    check("X-1 Resume restores the exact state", gameShape(hostState()) === midShape,
      gameShape(hostState()));
    check("X-1 resuming clears the parked copy", hostState().resumable === null);

    // Start over -> clean setup, roster / content / settings intact.
    lobbyBtn().click();
    HD().getElementById("btn-lobby-restart").click();
    await waitFor(() => hostState().phase === "setup", "start over");
    const after = hostState();
    check("X-1 Start over clears the game but keeps roster, content and settings",
      after.phase === "setup" && after.resumable === null && after.bank === 0 &&
      after.strikes === 0 && after.roundIndex === 0 &&
      after.teams.every((t) => t.score === 0) &&
      after.roster.length === 1 && after.game.title === title &&
      after.teams[0].name === "Quiz Kids",
      `roster=${after.roster.length} title=${after.game.title} teamA=${after.teams[0].name}`);
    check("X-1 no Resume card is left behind after Start over",
      HD().getElementById("resume-card").classList.contains("hidden"));

    // ...and it works from Fast Money too, not just the board.
    clickHost("Start the Feud");
    dispatchHost({ type: "giveControl", team: "A" });
    dispatchHost({ type: "play" });
    hostState().revealed.forEach((_, i) => dispatchHost({ type: "reveal", index: i }));
    await waitFor(() => hostState().phase === "roundover", "round over");
    clickHost("Fast Money");
    await waitFor(() => hostState().phase === "fastmoney", "fast money");
    dispatchHost({ type: "fmAnswer", slot: 1, q: 0, text: "PARKED" });
    const fmShape = gameShape(hostState());
    lobbyBtn().click();
    check("X-1 the confirm describes a Fast Money game too",
      /Fast Money/.test(HD().getElementById("game-lobby-sub").textContent));
    HD().getElementById("btn-lobby-keep").click();
    await waitFor(() => hostState().phase === "setup", "keep from fast money");
    HD().getElementById("btn-resume").click();
    await waitFor(() => hostState().phase === "fastmoney", "resume fast money");
    check("X-1 Keep / Resume works from Fast Money as well",
      gameShape(hostState()) === fmShape &&
      hostState().fastMoney.rows[1][0].text === "PARKED");

    // A parked game survives a reload: it is part of the saved state.
    const parkedShape = gameShape(hostState());
    lobbyBtn().click();
    HD().getElementById("btn-lobby-keep").click();
    await waitFor(() => hostState().phase === "setup", "park before reload");
    setHostReady(false);
    await loadFrame(hostFrame, HOST_SRC);
    await waitFor(() => HW().FeudApp && hostState(), "host reboot");
    check("X-1 a parked game survives a reload", !!hostState().resumable &&
      !HD().getElementById("resume-card").classList.contains("hidden"));
    HD().getElementById("btn-resume").click();
    await waitFor(() => hostState().phase === "fastmoney", "resume after reload");
    check("X-1 and still resumes exactly", gameShape(hostState()) === parkedShape);
  }

  /* ============ X-2 — the question-set library (19 §2) ============ */

  // Long by design: the happy path and the three failure modes (a set the
  // validator rejects, a broken manifest, opened-from-disk) share one booted
  // host, and each mounts its own picker against a stubbed fetch.
  async function testLibrary() {
    resetPhones();
    await bootHost();
    const picker = HD().getElementById("questions-library");
    await waitFor(() => picker.querySelector("option"), "picker mounted");
    const options = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    check("X-2 the picker lists the sets committed in sets/index.json",
      options.length >= 2 && options.indexOf("Kids' night") !== -1 &&
      options.indexOf("Office party") !== -1, options.join(", "));
    const previewText = picker.querySelector(".gsc-library-preview").textContent;
    check("X-2 the Preview line describes the selected set",
      /Kids' night/.test(previewText) && /6 rounds/.test(previewText), previewText);

    const select = picker.querySelector("select");
    select.selectedIndex = 1; // Office party
    select.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
    picker.querySelector(".gsc-library-load").click();
    await waitFor(() => /set: Office party/.test(hostState().source), "set loaded");
    const loaded = hostState();
    check("X-2 loading a set makes it the current content",
      loaded.game.title === "Family Feud — Office Party" && loaded.game.rounds.length === 6 &&
      loaded.phase === "setup", `${loaded.game.title} / ${loaded.game.rounds.length} rounds`);
    check("X-2 the source note names the set",
      HD().getElementById("source-note").textContent === "Questions: set: Office party",
      HD().getElementById("source-note").textContent);
    check("X-2 the loaded set is playable",
      (() => {
        try { HW().FeudCore.validateGame(loaded.game); return true; } catch (e) { return e.message; }
      })() === true);
    check("X-2 the picker's error line is clear on success",
      picker.querySelector(".gsc-library-error").textContent === "");

    // A set that fails this game's validator must be refused, not loaded.
    const badBox = HD().createElement("div");
    HD().body.appendChild(badBox);
    const bad = HW().GSCLibrary.mountPicker(badBox, {
      gameDir: "",
      validate: (json) => HW().FeudCore.validateGame(json),
      onPick: () => { badBox.dataset.picked = "yes"; },
      fetch: (url) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(/index\.json$/.test(url)
          ? [{ file: "broken.json", name: "Broken set" }]
          : { rounds: [{ question: "Too few", answers: [{ text: "a", count: 1 }] }] }),
      }),
    });
    await bad.ready;
    badBox.querySelector(".gsc-library-load").click();
    await waitFor(() => badBox.querySelector(".gsc-library-error").textContent, "validator message");
    check("X-2 a set that fails validateGame is refused with the validator's own words",
      /between 3 and 8 answers/.test(badBox.querySelector(".gsc-library-error").textContent) &&
      badBox.dataset.picked !== "yes",
      badBox.querySelector(".gsc-library-error").textContent);
    bad.destroy();

    // A manifest that is not a list of sets.
    const junkBox = HD().createElement("div");
    HD().body.appendChild(junkBox);
    const junk = HW().GSCLibrary.mountPicker(junkBox, {
      gameDir: "",
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ nope: 1 }) }),
    });
    await junk.ready;
    check("X-2 a broken manifest shows a plain-English message and hides the picker",
      !!junkBox.querySelector(".gsc-library-error").textContent &&
      junkBox.querySelector(".gsc-library-row").classList.contains("hidden"),
      junkBox.querySelector(".gsc-library-error").textContent);
    junk.destroy();

    // Opened from disk: the fetch throws.
    const diskBox = HD().createElement("div");
    HD().body.appendChild(diskBox);
    const disk = HW().GSCLibrary.mountPicker(diskBox, {
      gameDir: "",
      fetch: () => Promise.reject(new Error("file protocol")),
    });
    await disk.ready;
    check("X-2 from disk the picker hides itself and says why",
      /web server/.test(diskBox.querySelector(".gsc-library-error").textContent) &&
      diskBox.querySelector(".gsc-library-label").classList.contains("hidden"),
      diskBox.querySelector(".gsc-library-error").textContent);
    disk.destroy();
    badBox.remove();
    junkBox.remove();
    diskBox.remove();
  }

  /* ============ X-3 — "Download for the library" (19 §2) ============ */

  // Long by design: one export is captured with stubs and then asserted from
  // several angles (file name, validity, draft equality, the manifest note and
  // line), all against that single captured blob.
  async function testLibraryExport() {
    localStorage.removeItem(DRAFT_KEY);
    resetPhones();
    await bootHost();
    clickHost("Question Editor");
    await waitFor(() => !HD().getElementById("screen-editor").classList.contains("hidden"),
      "editor open");
    const win = HW();
    HD().getElementById("editor-title").value = "Harness Library Set";
    HD().getElementById("editor-title").dispatchEvent(new win.Event("input", { bubbles: true }));

    let blob = null;
    let filename = null;
    const realCreate = win.URL.createObjectURL;
    const realClick = win.HTMLAnchorElement.prototype.click;
    win.URL.createObjectURL = (b) => { blob = b; return "blob:harness"; };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function capture() { filename = this.download; };
    clickHost("Download for the library");
    win.URL.createObjectURL = realCreate;
    win.HTMLAnchorElement.prototype.click = realClick;

    check("X-3 Download for the library saves a file named from the title",
      !!blob && filename === "harness-library-set.json", String(filename));
    const text = blob ? await blob.text() : "{}";
    let parsed = null;
    let valid = false;
    try {
      parsed = JSON.parse(text);
      win.FeudCore.validateGame(parsed);
      valid = true;
    } catch (err) { valid = err.message; }
    check("X-3 the downloaded set passes validateGame", valid === true, String(valid));
    check("X-3 it is the editor's draft, byte for byte",
      JSON.stringify(parsed) === JSON.stringify(win.FeudEditor.cleanDraft()));

    const note = HD().getElementById("editor-library-note");
    check("X-3 the manifest note appears with the path to commit",
      !note.classList.contains("hidden") &&
      note.textContent.indexOf("games/family-feud/sets/harness-library-set.json") !== -1 &&
      note.textContent.indexOf("games/family-feud/sets/index.json") !== -1,
      note.textContent.slice(0, 160));
    const line = note.querySelector(".editor-library-line code").textContent;
    let entry = null;
    try { entry = JSON.parse(line); } catch (err) { entry = null; }
    check("X-3 the manifest line is valid JSON with the fields index.json needs",
      !!entry && entry.file === "harness-library-set.json" &&
      entry.name === "Harness Library Set" && !!entry.counts &&
      entry.counts.rounds === parsed.rounds.length, line);
    check("X-3 that line is accepted by the shared manifest parser",
      HW().GSCLibrary.parseManifest([entry]).ok === true);

    // Editing again retires the note: it names a file that no longer matches.
    HD().getElementById("editor-title").value = "Changed";
    HD().getElementById("editor-title").dispatchEvent(new win.Event("input", { bubbles: true }));
    await sleep(40);
    check("X-3 the note is retired once the draft changes again",
      note.classList.contains("hidden"));
    clickHost("Close");
    localStorage.removeItem(DRAFT_KEY);
  }

  return { testGameLobby, testLibrary, testLibraryExport };
};
