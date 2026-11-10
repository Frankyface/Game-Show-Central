/* ============================================================
   Wheel of Fortune — host-phone harness checks (docs/22 §5.5)
   A self-contained second shell (its own three frames, its own
   ?store=harnesshp namespace) so the main run is untouched:
     host  ?embed=host   — the laptop game
     p1    ?embed=player — a contestant (Ana)
     h1    ?embed=player&role=host — the host phone (Hana)
   It implements the docs/00 §6 bridge plus the docs/22 additions:
   init.room.hostPhones / answersPrivate, `host-phones` posts to
   the host frame, `host-view` up from the host frame and down to
   host-role frames only. Exported as window.WheelHarnessHP.
   ============================================================ */

"use strict";

window.WheelHarnessHP = function (ctx) {
  "use strict";

  const { check, waitFor, sleep } = ctx;
  const ORIGIN = location.origin;
  const STORE = "harnesshp";
  const SRC = {
    host: `../index.html?embed=host&harness=1&store=${STORE}`,
    p1: `../index.html?embed=player&harness=1&store=${STORE}&pid=p1&name=Ana`,
    h1: `../index.html?embed=player&harness=1&store=${STORE}&role=host&pid=h1`,
  };
  const ANA = { pid: "p1", name: "Ana", color: "#2ec4b6", avatar: "", connected: true, manual: false };
  const HANA = { pid: "h1", name: "Hana", role: "host" };

  const shell = {
    players: [ANA],
    hostPhones: [{ pid: "h1", name: "Hana", connected: true }],
    heldView: null,
    hostViewsToP1: 0,
    sentByH1: 0,
    titles: [],
    relay: true, // paused only while a test injects its own view
  };

  /* ============ frames + the shell ============ */

  const box = document.createElement("div");
  box.className = "stage";
  document.body.appendChild(box);
  const frames = {};
  for (const key of ["host", "p1", "h1"]) {
    const f = document.createElement("iframe");
    f.title = `host-phone ${key}`;
    f.style.cssText = key === "host" ? "width:1100px;height:720px" : "width:360px;height:640px";
    box.appendChild(f);
    frames[key] = { el: f, ready: false };
  }
  const W = (k) => frames[k].el.contentWindow;
  const D = (k) => frames[k].el.contentDocument;
  const post = (k, m) => { if (W(k)) W(k).postMessage({ gsc: 1, ...m }, ORIGIN); };
  const keyOf = (src) => Object.keys(frames).find((k) => frames[k].el.contentWindow === src) || null;

  window.addEventListener("message", (event) => {
    if (event.origin !== ORIGIN) return;
    const d = event.data;
    if (!d || typeof d !== "object" || d.gsc !== 1 || typeof d.t !== "string") return;
    const from = keyOf(event.source);
    if (!from) return;
    if (d.t === "ready") {
      frames[from].ready = true;
      if (from === "host") {
        post("host", { t: "init", mode: "embed-host", room: {
          code: "HPWH", players: shell.players, hostPhones: shell.hostPhones,
          answersPrivate: shell.hostPhones.length > 0,
        } });
      } else if (from === "p1") {
        post("p1", { t: "init", mode: "embed-player", me: ANA, room: { code: "HPWH" } });
      } else {
        post("h1", { t: "init", mode: "embed-player", me: HANA, room: { code: "HPWH" } });
        if (shell.heldView) post("h1", { t: "host-view", m: shell.heldView }); // the hub re-delivers
      }
      return;
    }
    if (from === "host" && d.t === "host-view") {
      shell.heldView = d.m;
      if (shell.relay) post("h1", { t: "host-view", m: d.m }); // host-role frames only, never p1
      return;
    }
    if (from === "host" && d.t === "send") {
      if (d.pid === "*" || d.pid === "p1") post("p1", { t: "msg", m: d.m });
      return; // a host phone is never a contestant: no game payloads to h1
    }
    if (from === "host" && d.t === "title") { shell.titles.push(String(d.text)); return; }
    if (from === "p1" && d.t === "send") { post("host", { t: "msg", pid: "p1", m: d.m }); return; }
    if (from === "h1" && d.t === "send") { shell.sentByH1 += 1; }
  });

  async function load(key) {
    await fetch(SRC[key], { cache: "reload" });
    frames[key].ready = false;
    await new Promise((resolve) => { frames[key].el.onload = resolve; frames[key].el.src = SRC[key]; });
    await waitFor(() => frames[key].ready, `${key} bridge ready`);
  }

  const app = () => W("host").WheelApp;
  const state = () => app().getState();
  const $ = (k, id) => D(k).getElementById(id);

  async function bootHost() {
    await load("host");
    await waitFor(() => app() && state() && state().game, "host game loaded");
    await app().ready;
    await waitFor(() => W("host").WheelHostPhone && W("host").WheelRoom, "room glue attached");
  }

  /* ============ the leak scan (docs/22 §5.5) ============ */

  const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ");
  const ATTRS = /^(title|alt|aria-label|placeholder|value|data-.*)$/;

  /** Every place the answer could hide in a document; [] when clean. */
  function leaks(doc, answer) {
    const needle = norm(answer);
    const hits = [];
    if (norm(doc.title).includes(needle)) hits.push("document.title");
    if (norm(doc.body.textContent).includes(needle)) hits.push("text");
    for (const el of doc.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (ATTRS.test(a.name) && norm(a.value).includes(needle)) hits.push(`${el.tagName}[${a.name}]`);
      }
      if (typeof el.value === "string" && norm(el.value).includes(needle)) hits.push(`${el.tagName}#${el.id}.value`);
    }
    for (const o of doc.querySelectorAll("option")) if (norm(o.textContent).includes(needle)) hits.push("option");
    for (const t of shell.titles) if (norm(t).includes(needle)) hits.push(`setTitle("${t}")`);
    return [...new Set(hits)];
  }

  /* ============ the scenario ============ */

  async function run() {
    localStorage.removeItem(`gsc-wheel-state-v1-${STORE}`);
    localStorage.removeItem(`gsc-wheel-draft-v1-${STORE}`);
    await bootHost();
    await Promise.all([load("p1"), load("h1")]);
    await waitFor(() => W("p1").WheelPhone && W("h1").WheelPhone, "both phones booted");
    app().addPlayer("Max");

    // The editor DOM holds every puzzle once opened; open it at setup first.
    $("host", "btn-editor").click();
    await waitFor(() => D("host").querySelectorAll(".ed-round").length > 0, "editor rows");
    $("host", "btn-editor-close").click();
    $("host", "btn-start").click();
    await waitFor(() => state().phase === "tossup", "the toss-up");
    const answer = state().round.puzzle;
    const following = state().game.rounds[1].puzzle;

    await waitFor(() => W("h1").WheelPhone.getHostView()
      && W("h1").WheelPhone.getHostView().solution === answer, "the host phone got the view");
    const card = $("h1", "p-host");
    check("HP-1 the host-role frame receives the host view via onHostView",
      W("h1").WheelPhone.me.role === "host" && card.textContent.includes(answer)
        && D("h1").body.classList.contains("host-role"),
      `card answer: "${(card.querySelector(".hc-answer") || {}).textContent}"`);
    check("HP-1 the host card lays the solution out like the board and lists what is hidden",
      card.querySelectorAll(".hc-board-row").length === 4
        && card.querySelectorAll(".hc-tile.hc-hidden").length > 0
        && /Still hidden:/.test(card.textContent) && /Up next/.test(card.textContent),
      `${card.querySelectorAll(".hc-tile.hc-hidden").length} tiles still face-down`);
    check("HP-1 a contestant frame never receives a host view",
      W("p1").WheelPhone.getHostView() === null && shell.hostViewsToP1 === 0
        && !D("p1").body.textContent.includes(answer),
      "p1 saw no host-view and no solution");
    check("HP-1 the host phone sends nothing", shell.sentByH1 === 0, `${shell.sentByH1} sends`);

    // ---- answers private, host phone connected ----
    const status = $("host", "hp-status");
    check("HP-2 answers-private mode says the answer is on the host phone",
      !status.classList.contains("hidden")
        && $("host", "hp-status-text").textContent === "Answer is on your host phone"
        && $("host", "btn-hp-show").classList.contains("hidden"),
      `"${$("host", "hp-status-text").textContent}"`);
    let hit = leaks(D("host"), answer).concat(leaks(D("host"), following));
    check("HP-2 (connected) no solution anywhere in the host document before the solve",
      hit.length === 0, hit.join(", ") || `"${answer}" and the next puzzle absent from text, values, attributes, options, titles`);
    check("HP-2 the editor holds no puzzles while a game runs",
      D("host").querySelectorAll(".ed-round").length === 0 && $("host", "btn-editor").disabled,
      `editor rows ${D("host").querySelectorAll(".ed-round").length}, button disabled`);

    // ---- host phone disconnected ----
    shell.hostPhones = [{ pid: "h1", name: "Hana", connected: false }];
    post("host", { t: "host-phones", list: shell.hostPhones });
    post("h1", { t: "status", connected: false });
    await waitFor(() => $("host", "hp-status-text").textContent === "Host phone disconnected", "disconnected line");
    hit = leaks(D("host"), answer);
    check("HP-3 (disconnected) still no solution in the host document; the fallback button is offered",
      hit.length === 0 && !$("host", "btn-hp-show").classList.contains("hidden")
        && $("host", "hp-answer").textContent === "",
      hit.join(", ") || "clean; Show answer on this screen visible");
    await waitFor(() => card.classList.contains("hc-stale"), "stale card");
    check("HP-3 the host phone dims and says it may be out of date",
      /Reconnecting — this may be out of date/.test(card.textContent), "Reconnecting note shown");

    // ---- the fallback: current puzzle only, cleared on the next ----
    $("host", "btn-hp-show").click();
    check("HP-4 Show answer on this screen reveals the current puzzle",
      $("host", "hp-answer").textContent.includes(answer) && leaks(D("host"), answer).length > 0,
      `"${$("host", "hp-answer").textContent}"`);
    $("host", "btn-next-round").click();
    await waitFor(() => state().roundIndex === 1, "the next puzzle");
    hit = leaks(D("host"), answer).concat(leaks(D("host"), following));
    check("HP-4 the shown answer clears on the next puzzle, and the new one stays private",
      hit.length === 0 && $("host", "hp-answer").textContent === ""
        && !$("host", "btn-hp-show").classList.contains("hidden"),
      hit.join(", ") || "neither solution in the document");

    // ---- tooBig ----
    post("h1", { t: "status", connected: true });
    shell.relay = false; // the injected view must not be overwritten mid-check
    await sleep(300);
    post("h1", { t: "host-view", m: { t: "host", item: "round-2", tooBig: true } });
    await waitFor(() => /Too much to show/.test(card.textContent), "tooBig card");
    check("HP-5 a tooBig view renders the plain fallback line",
      /Too much to show — use the button on the laptop/.test(card.textContent), "tooBig handled");
    shell.relay = true;
    post("h1", { t: "host-view", m: shell.heldView });

    await seatChecks();
    await noHostPhoneChecks();
  }

  /* ============ docs/22 §5.6 — seat reconciliation ============ */

  async function seatChecks() {
    // Setup list: Ana (phone) and Max (typed in). Ana then becomes a host phone.
    $("host", "btn-game-lobby").click();
    $("host", "btn-lobby-reset").click();
    await waitFor(() => state().phase === "idle", "setup");
    shell.players = [ANA];
    shell.hostPhones = [{ pid: "h1", name: "Hana", connected: true }];
    await bootHost();
    shell.players = [];
    shell.hostPhones = [{ pid: "h1", name: "Hana", connected: true }, { pid: "p1", name: "Ana", connected: true }];
    await bootHost();
    await waitFor(() => !state().players.some((p) => p.pid === "p1"), "Ana dropped from setup");
    check("HP-6 a phone seat that is no longer a contestant leaves the saved setup",
      state().players.map((p) => p.name).join() === "Max"
        && $("host", "hp-notice").classList.contains("hidden"),
      `setup: ${state().players.map((p) => p.name).join(", ")}`);

    // A running game keeps the seat, phone-less, with one notice.
    shell.players = [ANA];
    shell.hostPhones = [{ pid: "h1", name: "Hana", connected: true }];
    await bootHost();
    await waitFor(() => state().players.some((p) => p.pid === "p1"), "Ana back from the roster");
    $("host", "btn-start").click();
    await waitFor(() => state().phase === "tossup", "a game running");
    shell.players = [];
    shell.hostPhones = [{ pid: "h1", name: "Hana", connected: true }, { pid: "p1", name: "Ana", connected: true }];
    await bootHost();
    await waitFor(() => !$("host", "hp-notice").classList.contains("hidden"), "the notice");
    check("HP-6 a running game keeps that seat, phone-less, and shows one notice",
      state().players.some((p) => p.pid === "p1") && !app().phonePids().has("p1")
        && /Ana is now the host phone/.test($("host", "hp-notice-text").textContent),
      `"${$("host", "hp-notice-text").textContent}"`);
  }

  /* ============ no host phone: identical behaviour ============ */

  async function noHostPhoneChecks() {
    shell.players = [ANA];
    shell.hostPhones = [];
    await bootHost();
    await waitFor(() => state().phase !== "idle", "the running game restored");
    check("HP-7 with no host phone the laptop is unchanged: no status line, editor available",
      $("host", "hp-status").classList.contains("hidden") && !$("host", "btn-editor").disabled
        && !W("host").WheelRoom.room.answersPrivate(),
      "answersPrivate=false, hp-status hidden, Editor enabled");
    $("host", "btn-game-lobby").click();
    $("host", "btn-lobby-reset").click();
    box.remove();
    localStorage.removeItem(`gsc-wheel-state-v1-${STORE}`);
    localStorage.removeItem(`gsc-wheel-draft-v1-${STORE}`);
  }

  return { run };
};
