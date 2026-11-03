/* ============================================================
   The Price Is Right harness — cross-cutting round scenarios
   (docs/19-cross-cutting-round.md): X-1 the Game lobby control,
   X-2 the committed set library, X-3 Download for the library,
   X-4 prize photos on the host and never on a phone.

   Split out of tests/harness.html so that page stays under the
   800-line house cap. It is handed the same helper bag the
   in-page scenarios use, so the checks read identically.
   ============================================================ */

"use strict";

window.HarnessX = function buildCrossCuttingScenarios(ctx) {
  "use strict";
  const { check, waitFor, sleep, H, HD, HW, PD, core, click, phoneView, phoneType } = ctx;

  /* ============================================================
   X-1 — the Game lobby control (docs/19 §1)
   X-4 — prize photos on the host, never on a phone (docs/19 §3)
   ============================================================ */

  async function scenarioGameLobby() {
  const before = JSON.stringify(core());
  const players = HW().TpirApp.state().setup.players.length;
  check("X-1 the Game lobby control is in the toolbar while a show is running",
    !!H("btn-game-lobby") && !H("btn-game-lobby").classList.contains("hidden"),
    H("btn-game-lobby") ? H("btn-game-lobby").textContent : "missing");

  click("btn-game-lobby");
  await waitFor(() => !H("tpir-lobby-modal").classList.contains("hidden"), "the confirm");
  check("X-1 it asks before it does anything",
    H("tpir-lobby-modal").querySelector("[role='dialog']") !== null
    && !!H("btn-lobby-keep") && !!H("btn-lobby-over") && !!H("btn-lobby-cancel"));

  click("btn-lobby-cancel");
  check("X-1 Cancel leaves the show exactly as it was",
    H("tpir-lobby-modal").classList.contains("hidden") && JSON.stringify(core()) === before);

  click("btn-game-lobby");
  click("btn-lobby-keep");
  await waitFor(() => !H("screen-setup").classList.contains("hidden"), "setup after Keep");
  check("X-1 Keep this game parks the show and offers Resume",
    core() === null && !H("btn-resume").classList.contains("hidden")
    && HW().TpirApp.state().setup.players.length === players,
    HW().TpirApp.state().resumable ? "show kept" : "show LOST");

  click("btn-resume");
  await waitFor(() => core(), "the show comes back");
  check("X-1 Resume restores the exact state",
    JSON.stringify(core()) === before && HW().TpirApp.state().resumable === null,
    core().phase + " segment " + core().segmentIndex);
  }

  async function scenarioStartOver() {
  const players = HW().TpirApp.state().setup.players.length;
  const title = HW().TpirApp.state().content.title;
  click("btn-game-lobby");
  click("btn-lobby-over");
  await waitFor(() => !H("screen-setup").classList.contains("hidden"), "setup after Start over");
  check("X-1 Start over clears the show but keeps the line-up and the prizes",
    core() === null && HW().TpirApp.state().resumable === null
    && HW().TpirApp.state().setup.players.length === players
    && HW().TpirApp.state().content.title === title
    && H("btn-resume").classList.contains("hidden"),
    players + " players, " + title);
  check("X-1 the toolbar control is put away when no show is running",
    H("btn-game-lobby").classList.contains("hidden"));
  }

  async function scenarioPhotos() {
  click("btn-start");
  await waitFor(() => core() && core().phase === "row", "a fresh row");
  await waitFor(() => HD().querySelector("#tpir-item-photo img"), "the One Bid photo");
  const img = HD().querySelector("#tpir-item-photo img");
  check("X-4 the One Bid card shows the item photo, with alt text",
    img.getAttribute("src") === core().row.item.image && img.alt === core().row.item.imageAlt
    && !H("tpir-item-photo").classList.contains("hidden"),
    img.getAttribute("src") + " — " + img.alt);

  await waitFor(() => phoneView("p1").screen === "bid", "the phones");
  const views = ["p1", "p2", "p3", "p4"].map((pid) => JSON.stringify(phoneView(pid)));
  check("X-4 no phone is sent the photo, or its file name",
    views.every((v) => v.indexOf("image") < 0 && v.indexOf(".svg") < 0),
    views.length + " views checked");
  check("X-4 no phone document contains an image element at all",
    ["p1", "p2", "p3", "p4"].every((pid) => PD(pid).querySelectorAll("img").length === 0));

  const price = core().row.item.price;
  await phoneType("p1", price, "Bid");
  await waitFor(() => core().row.bids.p1 === price, "a bid");
  click("btn-reveal-bids");
  click("btn-row-next");
  await waitFor(() => core().phase === "game", "a pricing game");
  HD().querySelector("#tpir-game-pick .btn[data-kind='cliffhangers']").click();
  await waitFor(() => HD().querySelector("#tpir-cliff-prize-photo img"), "the Cliff Hangers photos");
  check("X-4 Cliff Hangers shows the prize photo and one per small item",
    HD().querySelectorAll("#tpir-cliff-items .prize-photo img").length === 3
    && !!HD().querySelector("#tpir-cliff-prize-photo img"),
    HD().querySelectorAll("#tpir-cliff-items .prize-photo img").length + " item photos");
  check("X-4 an unvalidated reference can never reach an image element",
    HW().TpirMedia.buildValidatedImage("javascript:alert(1)", "x") === null
    && HW().TpirMedia.buildValidatedImage("img/espresso-machine.svg", "x") !== null);
  }
  /* ============================================================

  /* ============================================================
   X-2 — the committed set library · X-3 — Download for the library
   ============================================================ */

  async function scenarioLibrary() {
  const res = await HW().TpirSetup.picker.ready;
  check("X-2 the picker reads sets/index.json and lists the shipped sets",
    res.ok && res.sets.length >= 2,
    res.ok ? res.sets.map((s) => s.name).join(", ") : res.error);
  const box = HD().querySelector("#tpir-library .gsc-library");
  const options = [...box.querySelectorAll("option")].map((o) => o.textContent);
  check("X-2 every set is offered, with a Preview line",
    options.length === res.sets.length
    && box.querySelector(".gsc-library-preview").textContent.indexOf(res.sets[0].name) === 0,
    box.querySelector(".gsc-library-preview").textContent);

  const select = box.querySelector("select");
  select.selectedIndex = 1;
  select.dispatchEvent(new (HW().Event)("change"));
  box.querySelector(".gsc-library-load").click();
  await waitFor(() => HW().TpirApp.state().sourceKind === "set", "the set loads");
  const app = HW().TpirApp.state();
  check("X-2 loading a set validates it and updates the source note",
    HW().TpirCore.validateGame(app.content) === true
    && app.source === "set: " + res.sets[1].name
    && H("tpir-source").textContent === app.source,
    H("tpir-source").textContent);
  check("X-2 a loaded set clears any show in progress",
    app.core === null && app.resumable === null);

  let adopted = false;
  const bad = HW().GSCLibrary.mountPicker(HD().createElement("div"), {
    gameDir: "", validate: (j) => HW().TpirCore.validateGame(j),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([{ file: "x.json", name: "X" }]) }),
    onPick() { adopted = true; },
  });
  await bad.ready;
  bad.el.querySelector(".gsc-library-load").click();
  await sleep(120);
  check("X-2 a set that fails validateGame is refused inside the picker",
    adopted === false && bad.el.querySelector(".gsc-library-error").textContent.length > 10,
    bad.el.querySelector(".gsc-library-error").textContent);
  bad.destroy();
  }

  async function scenarioLibraryDownload() {
  click("btn-editor");
  await waitFor(() => !H("screen-editor").classList.contains("hidden"), "the editor");
  let captured = null;
  let named = "";
  const realCreate = HW().URL.createObjectURL;
  HW().URL.createObjectURL = (blob) => { captured = blob; return realCreate.call(HW().URL, blob); };
  const realClick = HW().HTMLAnchorElement.prototype.click;
  HW().HTMLAnchorElement.prototype.click = function capture() { named = this.download; };
  const draft = HW().TpirEditor.draft();
  draft.title = "Office party";
  HW().TpirEditor.setDraft(draft);
  click("btn-editor-library");
  await waitFor(() => captured, "the download");
  HW().URL.createObjectURL = realCreate;
  HW().HTMLAnchorElement.prototype.click = realClick;
  const text = await captured.text();
  check("X-3 Download for the library writes a file that passes validateGame",
    HW().TpirCore.validateGame(JSON.parse(text)) === true && named === "office-party.json",
    named + ", " + text.length + " bytes");

  const box = H("tpir-editor-manifest");
  const line = box.querySelector(".ed-manifest-line").textContent;
  const entry = JSON.parse(line);
  check("X-3 it prints a manifest row the shared library accepts",
    !box.classList.contains("hidden")
    && HW().GSCLibrary.parseManifest([entry]).ok
    && entry.file === "office-party.json" && entry.name === "Office party"
    && entry.counts["one bid"] === JSON.parse(text).oneBid.length,
    line.replace(/\s+/g, " ").slice(0, 90));
  check("X-3 it says where to commit the file",
    box.querySelector(".ed-manifest-lead").textContent.indexOf("sets/office-party.json") > 0,
    box.querySelector(".ed-manifest-lead").textContent);
  click("btn-editor-close");
  await waitFor(() => H("screen-editor").classList.contains("hidden"), "the editor closes");
  }

  return {
    gameLobby: scenarioGameLobby,
    startOver: scenarioStartOver,
    photos: scenarioPhotos,
    library: scenarioLibrary,
    libraryDownload: scenarioLibraryDownload,
  };
};
