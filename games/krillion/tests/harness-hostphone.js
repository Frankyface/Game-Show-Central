/* ============================================================
   Krillion — host-phone harness scenario (docs/22 §5.5, §5.6, §5.7)

   Uses tests/fixtures/hostphone-game.json, where EVERY rated answer
   starts with "Hpq" and no prompt does, so any "Hpq" on the shared
   screen before the reveal is a leaked answer.

   HP-1 the host-role frame receives the view: prompt, rated list,
        answers as they arrive with their tier or "pending";
   HP-2 contestant frames never do, and no send carries host data;
        `seq` bumps only when the view's content changes;
   HP-3 answers private, host phone CONNECTED: no answer in the shared
        screen's text, value, placeholder, <option>, title, alt,
        aria-label, data-* or setTitle; the rated-list panels and
        toggles are not rendered; the remembered switch is ignored;
   HP-4 the same DISCONNECTED; the fallback shows this prompt's list,
        and it is gone on the next prompt;
   HP-5 the phone's stale / tooBig states, no buttons, no contestant card;
   HP-6 seat reconciliation on boot.

   Loaded by tests/harness.html, which hands over its shell helpers.
   ============================================================ */

"use strict";

window.KRHostPhone = function (ctx) {
  const { check, click, waitFor, sleep, H, HD, HW, core, bootHost, post, loadFrame, phoneSays,
    ROOM, PLAYERS, PW, phoneFrames, hostPhoneFrames, hostViewLog, sendLog, shellLog } = ctx;
  const HOST_PID = "h1";
  const PREFIX = "Hpq";
  const SRC = "../index.html?embed=player&harness=1&store=harness&role=host";
  const HOST_SRC = "../index.html?embed=host&harness=1&store=harness&game=tests/fixtures/hostphone-game.json";
  const ATTRS = ["value", "placeholder", "title", "alt", "aria-label"];

  /** Every place a string could become visible (or spoken) on the shared screen. */
  function leaks(doc, s) {
    const hits = [];
    if (doc.documentElement.textContent.includes(s)) hits.push("text");
    for (const el of doc.querySelectorAll("*")) {
      if (typeof el.value === "string" && el.value.includes(s)) hits.push(`value ${el.id || el.tagName}`);
      for (const a of el.attributes) {
        if ((ATTRS.includes(a.name) || a.name.startsWith("data-")) && a.value.includes(s)) hits.push(`${a.name} ${el.id || el.tagName}`);
      }
    }
    for (const d of shellLog) if (d.t === "title" && String(d.text).includes(s)) hits.push("setTitle");
    return hits;
  }

  const phoneDoc = () => hostPhoneFrames.get(HOST_PID).contentDocument;
  const phoneText = () => phoneDoc().getElementById("kr-host-card").textContent;
  const visible = (n) => !!n && !n.classList.contains("hidden") && !!n.offsetParent;
  const note = () => [...HD().querySelectorAll(".kr-hp-note-text")].find((n) => n.offsetParent);
  const showBtn = () => [...HD().querySelectorAll(".kr-hp-show")].find(visible);
  const fallback = () => [...HD().querySelectorAll(".kr-hp-list")].find(visible);
  const listWords = () => HW().KrHostView.currentList(core()).flatMap((r) => r.answers);
  const lastView = () => hostViewLog[hostViewLog.length - 1];

  function sendHostPhones(connected) {
    ROOM.hostPhones = [{ pid: HOST_PID, name: "Hal", connected }];
    post(ctx.hostFrame, { t: "host-phones", list: ROOM.hostPhones });
  }

  async function bootHostPhone() {
    const frame = document.createElement("iframe");
    frame.title = "host phone";
    document.getElementById("phones").appendChild(frame);
    hostPhoneFrames.set(HOST_PID, frame);
    await loadFrame(frame, SRC);
  }

  async function connectedChecks() {
    click("btn-open");
    await waitFor(() => PLAYERS.every((p) => PW(p.pid).KrPhone.view().screen === "answer"), "answer screens");
    phoneSays("p1", "hpqapples");
    phoneSays("p2", "Zqoffhp");
    await waitFor(() => /Ann: hpqapples/.test(phoneText()) && /Bo: Zqoffhp/.test(phoneText()), "answers on the host phone");
    check("HP-1 the host phone shows the prompt, the rated list and each answer with its tier or “pending”",
      /Host/.test(phoneText()) && phoneText().includes("Name a fruit") && phoneText().includes("Hpqrambutan")
      && /Ann: hpqapplesPrawn \(Hpqapple\)/.test(phoneText()) && /Bo: Zqoffhppending/.test(phoneText())
      && lastView().t === "host" && typeof lastView().item === "string" && Number.isInteger(lastView().seq),
      phoneText().slice(0, 200));
    const pd = phoneDoc();
    const pw = hostPhoneFrames.get(HOST_PID).contentWindow;
    const px = (n) => parseFloat(pw.getComputedStyle(n).fontSize);
    const texts = [...pd.querySelectorAll("#kr-host-card *")].filter((n) => n.childElementCount === 0 && n.textContent.trim());
    check("HP-1 the host phone fits 320 px with no sideways scroll; answers ≥ 28 px, all text ≥ 16 px",
      pd.documentElement.scrollWidth <= pd.documentElement.clientWidth + 1
      && [...pd.querySelectorAll(".kr-host-answers")].every((n) => px(n) >= 28) && texts.every((n) => px(n) >= 16),
      `${pd.documentElement.scrollWidth}/${pd.documentElement.clientWidth}; smallest ${Math.min(...texts.map(px))} px`);
    const seq = lastView().seq;
    const views = hostViewLog.length;
    click("btn-pause");
    await sleep(80);
    click("btn-pause");
    await sleep(80);
    check("HP-2 seq bumps only on content change (pausing the clock changes nothing private)",
      lastView().seq === seq, `${views} → ${hostViewLog.length} views, seq ${seq} → ${lastView().seq}`);
    const contestantGotHost = [...phoneFrames.values()].some((f) => {
      const v = f.contentWindow.KrPhone && f.contentWindow.KrPhone.view();
      return (v && v.t === "host") || f.contentDocument.documentElement.textContent.includes("Hpqrambutan");
    });
    const sentHost = sendLog.some((d) => d.m && (d.m.t === "host" || JSON.stringify(d.m).includes("Hpqrambutan")));
    check("HP-2 contestant phones never get a host view, and no send carries host data",
      !contestantGotHost && !sentHost && !shellLog.some((d) => d.t === "host-phone-sent"), `${sendLog.length} sends checked`);
    check("HP-3 answers private, host phone connected: no answer anywhere on the shared screen",
      leaks(HD(), PREFIX).length === 0 && note() && note().textContent === "Answers are on your host phone" && !showBtn(),
      `leaks ${JSON.stringify(leaks(HD(), PREFIX))}; note "${note() && note().textContent}"`);
    check("HP-3 the rated-list panels and their toggles are not rendered; the remembered switch is ignored",
      ["btn-plist", "btn-list", "kr-plist-box", "kr-list-box"].every((id) => !H(id))
      && HW().KrApp.state().showList === true);
  }

  async function disconnectedChecks() {
    sendHostPhones(false);
    await waitFor(() => note() && note().textContent === "Host phone disconnected", "disconnected note");
    check("HP-4 host phone disconnected: still private, one fallback button, no answer on screen",
      HW().KrHostPhone.isPrivate() && !!showBtn() && showBtn().textContent === "Show answer on this screen"
      && leaks(HD(), PREFIX).length === 0, `leaks ${JSON.stringify(leaks(HD(), PREFIX))}`);
    const first = listWords();
    showBtn().click();
    await waitFor(() => fallback(), "fallback list");
    check("HP-4 Show answer on this screen shows this prompt's rated list",
      first.every((w) => fallback().textContent.includes(w)) && !showBtn(), fallback().textContent.slice(0, 120));
    ["p3", "p4", "p5"].forEach((pid) => phoneSays(pid, "hpqmango"));
    await waitFor(() => core().phase === "reveal", "the round closing");
    HD().querySelector('#kr-queue [data-tier="invalid"]').click();
    while (core().phase === "reveal") click("btn-reveal");
    click("btn-next-prompt");
    await waitFor(() => core().phase === "intro" && !!showBtn(), "the next prompt, before its clock");
    const unanswered = first.filter((w) => !["Hpqapple", "Hpqmango"].includes(w));
    check("HP-4 the shown list is gone on the next prompt, and the new prompt's list stays hidden",
      !fallback() && unanswered.every((w) => leaks(HD(), w).length === 0)
      && listWords().every((w) => leaks(HD(), w).length === 0) && !!showBtn(),
      `gone: ${unanswered.join(",")}; hidden: ${listWords().join(",")}`);
    // L5: before the clock starts the list is already secret, so the intro has
    // the same note and fallback, and an opened fallback survives Start the clock.
    check("L5 before the clock: “Host phone disconnected” and the fallback button on the intro",
      note() && note().textContent === "Host phone disconnected" && H("screen-intro").contains(showBtn())
      // (the previous prompt's revealed answers are public; only this prompt's list must be absent)
      && listWords().every((w) => leaks(HD(), w).length === 0), note() && note().textContent);
    const second = listWords();
    showBtn().click();
    await waitFor(() => fallback(), "the intro fallback");
    check("L5 the intro fallback shows this prompt's rated list",
      H("screen-intro").contains(fallback()) && second.every((w) => fallback().textContent.includes(w)) && !showBtn());
    click("btn-open");
    await waitFor(() => core().phase === "prompt", "the clock");
    check("L5 starting the clock is the same item: the list stays shown and the button does not re-arm",
      !!fallback() && H("screen-prompt").contains(fallback()) && !showBtn(), HW().KrHostView.itemKey(core()));
    sendHostPhones(true);
    await waitFor(() => note() && note().textContent === "Answers are on your host phone", "reconnected note");
  }

  async function phoneStates() {
    const f = hostPhoneFrames.get(HOST_PID);
    post(f, { t: "status", connected: false });
    await waitFor(() => /Reconnecting — this may be out of date/.test(phoneText()), "stale");
    check("HP-5 the host phone dims and says it may be out of date when the link drops",
      phoneDoc().getElementById("kr-host-card").classList.contains("is-stale"));
    post(f, { t: "status", connected: true });
    post(f, { t: "host-view", m: { t: "host", item: "x", tooBig: true } });
    await waitFor(() => /Too much to show — use the button on the laptop/.test(phoneText()), "tooBig");
    check("HP-5 a refused oversize view reads “Too much to show”", true);
    check("HP-5 the host phone has no buttons and no contestant card, and sent nothing",
      phoneDoc().querySelectorAll("#kr-host-card button").length === 0
      && !visible(phoneDoc().getElementById("kr-phone-card")) && !shellLog.some((d) => d.t === "host-phone-sent"));
  }

  async function reconcileChecks() {
    // A saved phone seat whose phone is no longer a player here (a pid the roster
    // does not list) leaves setup; the running game keeps it and says so once.
    const app = HW().KrApp;
    app.set({ core: null, resumable: null, setup: Object.assign({}, app.state().setup, {
      players: app.state().setup.players.concat([{ pid: "p9", name: "Zed", manual: false }]) }) });
    click("btn-start");
    await waitFor(() => core() && core().players.some((p) => p.pid === "p9"), "game seats p9");
    await bootHost(false, HOST_SRC);
    await waitFor(() => HW().KrHostPhone && core(), "reload");
    await sleep(300);
    check("HP-6 seat reconciliation: a stale phone seat leaves setup, the game keeps it and says so once",
      !HW().KrApp.state().setup.players.some((p) => p.pid === "p9") && core().players.some((p) => p.pid === "p9")
      && /Zed is no longer a player/.test(H("kr-error").textContent), H("kr-error").textContent);
  }

  async function run() {
    ROOM.hostPhones = [{ pid: HOST_PID, name: "Hal", connected: true }];
    ROOM.answersPrivate = true;
    try {
      await bootHostPhone();
      await bootHost(true, HOST_SRC);
      await waitFor(() => HW().KrApp.state().setup.players.length === PLAYERS.length, "roster");
      if (H("kr-set-shuffle").checked) H("kr-set-shuffle").click();
      if (H("kr-mode-deep").checked === false) H("kr-mode-deep").click();
      click("btn-start");
      await waitFor(() => core() && core().phase === "intro" && /Name a fruit/.test(phoneText()), "intro on the host phone");
      HW().KrApp.set({ showList: true });            // a remembered switch that must be ignored
      check("L5 before the clock, host phone connected: the intro says “Answers are on your host phone”",
        note() && H("screen-intro").contains(note()) && note().textContent === "Answers are on your host phone"
        && !showBtn() && leaks(HD(), PREFIX).length === 0, note() && note().textContent);
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
