/* ============================================================
   Deal or No Deal — the cross-cutting scenarios (docs 19 §4)
   X-1 the Game lobby control, X-2 the set library picker, X-3 the
   editor's "Download for the library", X-4 the case animation
   fix. Split out of tests/harness.html only to keep both files
   well under the 800-line house cap; harness.html hands us its
   own helpers, so every assertion still runs against the real
   frames it loaded.
   ============================================================ */

"use strict";

window.DondHarnessX = function (ctx) {
  const { check, waitFor, HW, HD, H, core, click, hostCases, hostCase } = ctx;

  /** The case numbers currently carrying the one-shot flip class. */
  function flipping() {
    return hostCases().filter((b) => b.classList.contains("is-flipping")).map((b) => b.dataset.n);
  }

  /* ============ X-4 — only the case you clicked animates ============ */

  function animation() {
    hostCase(7).click();
    const one = flipping();
    check("N-I4 X-4 opening case 7 animates case 7 and nothing else",
      one.join(",") === "7", one.join(",") || "no case is animating");

    const next = HD().querySelector("#dond-cases .case:not(:disabled)");
    const n = next.dataset.n;
    next.click();
    const two = flipping();
    check("N-I4 X-4 the case opened a moment ago does not re-run its flip",
      two.length === 1 && two[0] === n, two.join(",") || "no case is animating");
  }

  function bankerAnimation() {
    const none = flipping();
    check("N-I4 X-4 the banker's call animates no case at all",
      none.length === 0, none.join(",") || "no case is animating");
  }

  /* ============ X-1 — the Game lobby control ============ */

  async function gameLobby() {
    const app = () => HW().DondApp.state();
    const btn = H("btn-game-lobby");
    check("N-I5 X-1 the toolbar carries a Game lobby control, live in play",
      !!btn && btn.disabled === false && btn.textContent.indexOf("Game lobby") > 0,
      btn ? `"${btn.textContent}" disabled=${btn.disabled}` : "missing");

    const before = JSON.stringify(core());
    click("btn-game-lobby");
    check("N-I5 X-1 it opens a confirm that names the phase and offers both ways out",
      !H("dond-lobby-modal").classList.contains("hidden")
      && H("dond-lobby-body").textContent.indexOf("cases") > 0
      && !!H("btn-lobby-keep") && !!H("btn-lobby-restart"),
      H("dond-lobby-body").textContent);
    click("btn-lobby-cancel");
    check("N-I5 X-1 Cancel leaves the game exactly where it was",
      H("dond-lobby-modal").classList.contains("hidden") && JSON.stringify(core()) === before);

    click("btn-game-lobby");
    click("btn-lobby-keep");
    check("N-I5 X-1 Keep this game parks it and shows setup with Resume",
      HW().DondApp.core() === null && !!app().resumable
      && !H("screen-setup").classList.contains("hidden")
      && !H("btn-resume").classList.contains("hidden")
      && H("dond-resume-note").textContent.indexOf("parked") > 0,
      H("dond-resume-note").textContent);
    const saved = JSON.parse(HW().localStorage.getItem(HW().DondApp.STORAGE_KEY));
    check("N-I5 X-1 the parked game is saved, so a refresh still offers Resume",
      JSON.stringify(saved.resumable) === before, saved.resumable ? "saved" : "NOT SAVED");

    click("btn-resume");
    check("N-I5 X-1 Resume restores the exact state it parked",
      JSON.stringify(core()) === before && app().resumable === null
      && H("screen-setup").classList.contains("hidden")
      && !H("screen-play").classList.contains("hidden"),
      core() ? `back at ${core().phase}` : "no game");

    const players = app().setup.players.length;
    const amounts = app().game.settings.amounts.length;
    click("btn-game-lobby");
    click("btn-lobby-restart");
    check("N-I5 X-1 Start over drops the game and keeps roster, board and rules",
      HW().DondApp.core() === null && app().resumable === null
      && app().setup.players.length === players
      && app().game.settings.amounts.length === amounts
      && H("btn-resume").classList.contains("hidden")
      && !H("screen-setup").classList.contains("hidden"),
      `${app().setup.players.length} contestants, ${app().game.settings.amounts.length} amounts`);
    check("N-I5 X-1 on setup the control is disabled — there is nothing to park",
      H("btn-game-lobby").disabled === true);
  }

  /* ============ X-2 — the set library picker ============ */

  /** Mount a throwaway picker with a fake fetch and read its error line. */
  async function pickerSaysNo(label, fakeFetch, expect) {
    const scratch = HD().createElement("div");
    HD().body.appendChild(scratch);
    const picker = HW().GSCLibrary.mountPicker(scratch, { gameDir: "", fetch: fakeFetch });
    const res = await picker.ready;
    const error = scratch.querySelector(".gsc-library-error").textContent;
    const off = scratch.querySelector(".gsc-library").classList.contains("gsc-library-off");
    picker.destroy();
    scratch.remove();
    check(label, res.ok === false && off && error.indexOf(expect) >= 0, error);
  }

  async function library() {
    const box = H("dond-library");
    const picker = box.querySelector(".gsc-library");
    check("N-I6 X-2 the setup screen mounts the shared library picker",
      !!picker && !picker.classList.contains("gsc-library-off"),
      picker ? picker.className : "not mounted");

    const select = box.querySelector(".gsc-library-select");
    const names = [...select.options].map((o) => o.textContent);
    check("N-I6 X-2 it lists the sets committed in sets/index.json",
      names.length >= 2 && names.indexOf("Quick 16") >= 0 && names.indexOf("High rollers") >= 0,
      names.join(", "));
    check("N-I6 X-2 the preview line describes the selected set",
      box.querySelector(".gsc-library-preview").textContent.indexOf("Quick 16") === 0,
      box.querySelector(".gsc-library-preview").textContent);

    select.value = "quick-16.json";
    select.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
    box.querySelector(".gsc-library-load").click();
    await waitFor(() => HW().DondApp.state().game.settings.amounts.length === 16, "the set loads");
    check("N-I6 X-2 loading a set validates it, adopts it and updates the source note",
      HW().DondApp.state().game.title === "Quick 16"
      && HW().DondApp.state().source === "set: Quick 16"
      && H("dond-source").textContent === "set: Quick 16"
      && HW().DondApp.core() === null,
      HW().DondApp.state().source);

    await pickerSaysNo("N-I6 X-2 a broken manifest says so and hides the picker",
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({ not: "a list" }) }),
      "not readable");
    await pickerSaysNo("N-I6 X-2 opened from disk, the picker hides with a plain-English note",
      () => Promise.reject(new Error("no server")), "web server");
  }

  /* ============ X-3 — Download for the library ============ */

  async function editorLibrary() {
    let captured = null;
    const real = HW().URL.createObjectURL;
    HW().URL.createObjectURL = (blob) => { captured = blob; return real.call(HW().URL, blob); };
    click("btn-editor-library");
    await waitFor(() => captured, "the library download blob");
    HW().URL.createObjectURL = real;
    const json = JSON.parse(await captured.text());
    check("N-I6 X-3 Download for the library produces a file that validates",
      HW().DondCore.validateBoard(json) === true && json.title === "Edited in the harness",
      `${json.title}, ${json.settings.amounts.length} amounts`);

    const path = H("dond-library-path").textContent;
    const line = H("dond-library-line").textContent;
    const entry = JSON.parse(line.slice(line.indexOf("{")));
    const parsed = HW().GSCLibrary.parseManifest([entry]);
    check("N-I6 X-3 it prints the path to commit and a manifest line that parses",
      !H("dond-editor-library").classList.contains("hidden")
      && path.indexOf("games/deal-or-no-deal/sets/edited-in-the-harness.json") > 0
      && parsed.ok === true && parsed.sets[0].name === "Edited in the harness"
      && entry.counts.cases === 10 && entry.counts.rounds === 4,
      `${path} || ${line}`);
  }

  return { animation, bankerAnimation, gameLobby, library, editorLibrary };
};
