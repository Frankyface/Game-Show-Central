/* ============================================================
   Weakest Link — host-phone harness scenario (docs/22 §5.5, §5.6, §5.7)

   HP-1 the host-role frame receives the view (question + answer);
   HP-2 contestant frames never do, and no `send` carries host data;
   HP-3 answers-private, host phone CONNECTED: the answer string is
        absent from the shared screen's text, value, placeholder,
        <option>, title, alt, aria-label, data-* and setTitle;
   HP-4 the same with the host phone DISCONNECTED; the fallback button
        reveals it, and it disappears on the next item;
   HP-5 the phone's stale and tooBig states;
   HP-6 seat reconciliation on boot.

   Loaded by tests/harness.html, which hands over its shell helpers.
   ============================================================ */

"use strict";

window.WLHostPhone = function (ctx) {
  const { check, click, waitFor, sleep, H, HD, HW, core, bootHost, post, loadFrame,
    ROOM, PLAYERS, STORE, phoneFrames, hostPhoneFrames, hostViewLog, sendLog, shellLog } = ctx;
  const HOST_PID = "h1";
  const SRC = `../index.html?embed=player&harness=1&store=${STORE}&role=host`;
  const ATTRS = ["value", "placeholder", "title", "alt", "aria-label"];

  /** Every place the answer could become visible (or spoken) on the shared screen. */
  function leaks(doc, s) {
    const hits = [];
    if (doc.documentElement.textContent.includes(s)) hits.push("text");
    for (const el of doc.querySelectorAll("*")) {
      if (typeof el.value === "string" && el.value.includes(s)) hits.push("value " + (el.id || el.tagName));
      for (const a of el.attributes) {
        if ((ATTRS.includes(a.name) || a.name.startsWith("data-")) && a.value.includes(s)) hits.push(a.name + " " + (el.id || el.tagName));
      }
    }
    for (const d of shellLog) if (d.t === "title" && String(d.text).includes(s)) hits.push("setTitle");
    return hits;
  }

  const answerNow = () => HW().WlHostView.currentAnswer(core());
  const phoneDoc = () => hostPhoneFrames.get(HOST_PID).contentDocument;
  const phoneText = () => phoneDoc().getElementById("wl-host-card").textContent;
  const note = () => HD().querySelector("#screen-round .hp-note-text, .hp-note-text");
  const showBtn = () => [...HD().querySelectorAll(".hp-show")].find((b) => b.offsetParent);

  function sendHostPhones(connected) {
    ROOM.hostPhones = [{ pid: HOST_PID, name: "Hal", connected }];
    post(ctx.hostFrame, { t: "host-phones", list: ROOM.hostPhones });
  }

  async function bootHostPhone() {
    const box = document.getElementById("phones");
    const frame = document.createElement("iframe");
    frame.title = "host phone";
    box.appendChild(frame);
    hostPhoneFrames.set(HOST_PID, frame);
    await loadFrame(frame, SRC);
  }

  async function connectedChecks() {
    await waitFor(() => /Host/.test(phoneText()) && phoneText().includes(answerNow()), "host phone shows the answer");
    const a = answerNow();
    check("HP-1 the host phone frame receives the view: question and answer",
      phoneText().includes(a) && phoneText().includes(core() ? HW().WlCore.currentQuestion(core()).q : "")
      && hostViewLog.length > 0 && hostViewLog[hostViewLog.length - 1].t === "host",
      `phone shows "${a}"; ${hostViewLog.length} host views sent up`);
    const contestantGotHost = [...phoneFrames.values()].some((f) => {
      const v = f.contentWindow.WlPhone && f.contentWindow.WlPhone.view();
      return (v && v.t === "host") || f.contentDocument.documentElement.textContent.includes(a);
    });
    const sentHost = sendLog.some((d) => d.m && (d.m.t === "host" || JSON.stringify(d.m).includes(a)));
    check("HP-2 contestant phones never get a host view, and no send carries host data",
      !contestantGotHost && !sentHost && !shellLog.some((d) => d.t === "host-phone-sent"),
      `${sendLog.length} sends checked`);
    check("HP-3 answers private, host phone connected: the answer is nowhere on the shared screen",
      leaks(HD(), a).length === 0 && !H("wl-answer") && !H("btn-show-answer") && !H("wl-final-answer")
      && note().textContent === "Answer is on your host phone" && !showBtn(),
      `answer "${a}"; leaks ${JSON.stringify(leaks(HD(), a))}; note "${note().textContent}"`);
    check("HP-3 the remembered keep-answers switch is ignored (hidden, not cleared)",
      HW().WlApp.state().keepAnswers === true && H("wl-keep-answers").disabled === true
      && H("wl-keep-answers").closest("label").classList.contains("hidden"));
  }

  async function disconnectedChecks() {
    sendHostPhones(false);
    await waitFor(() => note().textContent === "Host phone disconnected", "disconnected note");
    const a = answerNow();
    check("HP-4 host phone disconnected: still private, one fallback button, answer absent",
      HW().WlApp.state && ctx.hostFrame.contentWindow.WlHostPhone.isPrivate()
      && !!showBtn() && showBtn().textContent === "Show answer on this screen" && leaks(HD(), a).length === 0,
      `note "${note().textContent}", leaks ${JSON.stringify(leaks(HD(), a))}`);
    showBtn().click();
    await waitFor(() => HD().documentElement.textContent.includes(a), "fallback reveal");
    check("HP-4 Show answer on this screen reveals the current item's answer",
      [...HD().querySelectorAll(".hp-reveal")].some((n) => n.textContent === a && n.offsetParent) && !showBtn(), a);
    click("btn-correct");
    await sleep(100);
    const b = answerNow();
    check("HP-4 the revealed answer disappears on the next item, and the new one stays hidden",
      !HD().documentElement.textContent.includes(a) && leaks(HD(), b).length === 0 && !!showBtn(),
      `previous "${a}" gone; current "${b}" hidden`);
    sendHostPhones(true);
    await waitFor(() => note().textContent === "Answer is on your host phone", "reconnected note");
  }

  async function phoneStates() {
    const f = hostPhoneFrames.get(HOST_PID);
    post(f, { t: "status", connected: false });
    await waitFor(() => /Reconnecting — this may be out of date/.test(phoneText()), "stale");
    check("HP-5 the host phone dims and says it may be out of date when the link drops",
      phoneDoc().getElementById("wl-host-card").classList.contains("is-stale"));
    post(f, { t: "status", connected: true });
    post(f, { t: "host-view", m: { t: "host", item: "x", tooBig: true } });
    await waitFor(() => /Too much to show — use the button on the laptop/.test(phoneText()), "tooBig");
    check("HP-5 a refused oversize view reads 'Too much to show'", true);
    check("HP-5 the host phone has no buttons and no contestant card",
      phoneDoc().querySelectorAll("#wl-host-card button").length === 0
      && phoneDoc().getElementById("wl-phone-card").classList.contains("hidden"));
  }

  async function reconcileChecks() {
    // A saved phone seat whose phone is no longer a player in this room (here: a pid
    // the roster does not list) is dropped from setup; the running game keeps it.
    const app = HW().WlApp;
    app.set({ core: null, setup: Object.assign({}, app.state().setup, {
      players: app.state().setup.players.concat([{ pid: "p9", name: "Zed", manual: false }]) }) });
    click("btn-start");
    await waitFor(() => core() && core().players.some((p) => p.pid === "p9"), "game seats p9");
    await bootHost(false);
    await waitFor(() => HW().WlHostPhone && core(), "reload");
    await sleep(150);
    check("HP-6 seat reconciliation: a stale phone seat leaves setup, the game keeps it and says so once",
      !HW().WlApp.state().setup.players.some((p) => p.pid === "p9")
      && core().players.some((p) => p.pid === "p9")
      && /Zed is no longer a player/.test(H("wl-error").textContent),
      H("wl-error").textContent);
  }

  async function run() {
    ROOM.hostPhones = [{ pid: HOST_PID, name: "Hal", connected: true }];
    ROOM.answersPrivate = true;
    try {
      await bootHostPhone();
      await bootHost();
      await waitFor(() => HW().WlApp.state().setup.players.length === PLAYERS.length, "roster");
      HW().WlApp.set({ keepAnswers: true });   // a remembered switch that must be ignored
      click("btn-start");
      await waitFor(() => core() && core().phase === "round", "round");
      await connectedChecks();
      await disconnectedChecks();
      await phoneStates();
      await reconcileChecks();
    } finally {
      delete ROOM.hostPhones;
      delete ROOM.answersPrivate;
      hostPhoneFrames.forEach((f) => f.remove());
      hostPhoneFrames.clear();
    }
  }

  return { run };
};
