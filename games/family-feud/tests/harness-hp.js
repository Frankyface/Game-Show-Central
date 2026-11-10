/* ============================================================
   Family Feud — host-phone harness scenarios (docs/22 §5.5, review F10/F11/F13)
   HP-1 the host-role frame receives the view through onHostView and
        contestant frames never do; the host phone sends nothing; stale and
        tooBig render as specified.
   HP-2 answers-private mode on the shared screen: with a host phone
        assigned (connected AND disconnected) no answer string is in the
        host document's text, any value / placeholder / <option> / title /
        alt / aria-label / data-*, nor in setTitle or reportScores — until
        the public reveal or the "Show answer on this screen" fallback,
        which shows the current item only and clears on the next item.
        Fast Money's picker reads "Answer 1…N" (F10).
   HP-3 seat reconciliation on boot (F11).
   tests/harness.html builds the shell and the helper kit; nothing here
   runs on its own.
   ============================================================ */

"use strict";

window.FeudHarnessHP = function (kit) {
  const {
    check, waitFor, sleep, HD, HW, hostState, bootHost, resetPhones, clickHost, dispatchHost,
    addPhone, addHostPhone, setHostPhoneConnected, phones, post, hostLog, shellLog,
    loadFrame, hostFrame, HOST_SRC, setHostReady, setRoster, setHostPhoneList,
  } = kit;

  const ROUND1 = ["Check their phone", "Chat with someone", "Sigh loudly", "Read the signs", "Snack"];
  const ROUND2_TOP = "Kids' bedroom";
  const FM1 = ["Apple", "Strawberry", "Cherry", "Watermelon"];

  /** Every place a shared-screen answer could hide (review F13). */
  function leaks(needle) {
    const doc = HD();
    const hits = [];
    if (doc.body.textContent.indexOf(needle) !== -1) hits.push("text");
    doc.querySelectorAll("*").forEach((node) => {
      if (typeof node.value === "string" && node.value.indexOf(needle) !== -1) hits.push(`value#${node.id}`);
      Array.from(node.attributes).forEach((attr) => {
        if (/^(placeholder|title|alt|aria-label|data-.*)$/.test(attr.name) && attr.value.indexOf(needle) !== -1) {
          hits.push(attr.name);
        }
      });
    });
    doc.querySelectorAll("option").forEach((o) => { if (o.textContent.indexOf(needle) !== -1) hits.push("option"); });
    if (shellLog.titles.some((t) => String(t).indexOf(needle) !== -1)) hits.push("setTitle");
    if (shellLog.scores && JSON.stringify(shellLog.scores).indexOf(needle) !== -1) hits.push("reportScores");
    return hits;
  }

  const noneLeak = (list) => list.every((a) => leaks(a).length === 0);
  const leakReport = (list) => list.map((a) => `${a}:${leaks(a).join("+") || "-"}`).join(" ");
  const hostPhone = () => phones.get("h1").iframe;
  const hostCardView = () => hostPhone().contentWindow.FeudHostCard.getView();
  const privateText = () => HD().getElementById("private-text").textContent;
  const showBtn = () => HD().getElementById("btn-show-answer");
  const isShown = (node) => node && !node.classList.contains("hidden");

  async function seatTwo() {
    await addPhone("p1", "Ana");
    await addPhone("p2", "Ben");
    await waitFor(() => hostState().roster.length === 2, "two contestants");
    dispatchHost({ type: "setTeam", pid: "p1", team: "A" });
    dispatchHost({ type: "setTeam", pid: "p2", team: "B" });
  }

  // Long by design: one connected-then-disconnected host phone walked through
  // a round, with every assertion depending on the state the last step left.
  async function testHostPhone() {
    resetPhones();
    await addHostPhone("h1", "Hal");
    await bootHost();
    await seatTwo();
    check("HP-1 the game sees the host phone as private, not as a contestant",
      HW().FeudPrivate.isAssigned() && hostState().roster.every((p) => p.pid !== "h1"),
      hostState().roster.map((p) => p.pid).join(","));
    await waitFor(() => hostCardView(), "first host view");
    check("HP-1 setup: the host phone says nothing is secret",
      hostCardView().kind === "none" &&
      /Nothing secret right now/.test(hostPhone().contentDocument.getElementById("host-empty").textContent));

    clickHost("Start the Feud");
    await waitFor(() => hostCardView() && hostCardView().kind === "survey", "survey view");
    const hv = hostCardView();
    check("HP-1 the host-role frame receives the survey via onHostView",
      hv.t === "host" && typeof hv.seq === "number" && hv.item === "Round 1 of 6" &&
      hv.survey.answers.map((a) => a.text).join("|") === ROUND1.join("|"),
      JSON.stringify(hv.survey.answers.map((a) => [a.n, a.text, a.count])));
    const card = hostPhone().contentDocument;
    check("HP-1 the host phone lists the numbered answers with counts",
      card.querySelectorAll("#host-answers li").length === 5 &&
      card.querySelector("#host-answers .host-answer").textContent === "Check their phone" &&
      card.querySelector("#host-answers .host-count").textContent === "48");
    check("HP-1 contestant frames never receive a host view",
      ["p1", "p2"].every((pid) => phones.get(pid).iframe.contentWindow.FeudHostCard.getView() === null) &&
      ["p1", "p2"].every((pid) => phones.get(pid).iframe.contentDocument.body.textContent.indexOf(ROUND1[0]) === -1));
    check("HP-2 connected: no answer anywhere on the shared screen before the reveal",
      noneLeak(ROUND1), leakReport(ROUND1));
    check("HP-2 connected: the screen says where the answers are, with no fallback button",
      privateText() === "Answers are on your host phone." && !isShown(showBtn()), privateText());

    // A public reveal is unchanged.
    clickHost("Team Blue buzzed");
    HD().querySelectorAll("#board .tile")[1].click();
    await sleep(60);
    check("HP-2 a public reveal still shows that answer (and only that one)",
      leaks(ROUND1[1]).indexOf("text") !== -1 && noneLeak([ROUND1[0], ROUND1[2], ROUND1[3], ROUND1[4]]),
      leakReport(ROUND1));
    await waitFor(() => hostPhone().contentDocument.querySelectorAll("#host-answers li.is-revealed").length === 1,
      "host phone ticks the reveal");
    check("HP-1 the host phone ticks the revealed answer", true);

    // The host phone drops: still private, now with the fallback.
    setHostPhoneConnected("h1", false);
    post(hostPhone(), { t: "status", connected: false });
    await waitFor(() => /disconnected/.test(privateText()), "disconnected line");
    check("HP-2 disconnected: still no answer on the shared screen",
      noneLeak([ROUND1[0], ROUND1[2], ROUND1[3], ROUND1[4]]), leakReport(ROUND1));
    check("HP-2 disconnected: 'Host phone disconnected' and one Show answer button",
      privateText() === "Host phone disconnected." && isShown(showBtn()) &&
      showBtn().textContent === "Show answer on this screen");
    check("HP-1 the host phone dims and says it may be out of date",
      hostPhone().contentDocument.getElementById("player-host").classList.contains("is-stale") &&
      isShown(hostPhone().contentDocument.getElementById("host-stale")) &&
      hostPhone().contentDocument.getElementById("host-stale").textContent === "Reconnecting — this may be out of date");

    showBtn().click();
    await sleep(40);
    check("HP-2 the fallback shows the current round's answers on this screen",
      leaks(ROUND1[0]).indexOf("text") !== -1 && isShown(HD().getElementById("private-answers")) &&
      HD().querySelectorAll("#private-answers li").length === 5, leakReport(ROUND1));

    // Next item: the fallback clears.
    dispatchHost({ type: "notOnBoard" });
    dispatchHost({ type: "play" });
    [0, 2, 3, 4].forEach((index) => dispatchHost({ type: "reveal", index }));
    dispatchHost({ type: "nextRound" });
    await sleep(40);
    check("HP-2 the next round is a new item: the fallback is gone and its answers are hidden",
      leaks(ROUND2_TOP).length === 0 && !isShown(HD().getElementById("private-answers")) && isShown(showBtn()),
      `${ROUND2_TOP}:${leaks(ROUND2_TOP).join("+") || "-"}`);

    check("HP-1 the host phone sent nothing", hostLog.sentByHostPhone === 0, hostLog.sentByHostPhone);
    post(hostPhone(), { t: "host-view", m: { t: "host", item: "Round 2 of 6", tooBig: true } });
    await sleep(40);
    check("HP-1 tooBig renders as 'Too much to show'",
      /Too much to show — use the button on the laptop/.test(
        hostPhone().contentDocument.getElementById("host-empty").textContent));

    setHostPhoneConnected("h1", true);
    post(hostPhone(), { t: "status", connected: true });
    await waitFor(() => privateText() === "Answers are on your host phone.", "reconnected line");
    check("HP-2 reconnected: back to 'Answers are on your host phone', no button", !isShown(showBtn()));
  }

  /** Every option of every Fast Money picker on the shared screen. */
  const pickerLabels = () => Array.from(HD().querySelectorAll("#fm-table select option")).map((o) => o.textContent);

  // Long by design: Fast Money is walked from player 1's reveal through the
  // fallback to player 2, which is the "next item" the fallback must not reach.
  async function testPrivateFastMoney() {
    dispatchHost({ type: "giveControl", team: "A" });
    dispatchHost({ type: "play" });
    hostState().revealed.forEach((_, i) => dispatchHost({ type: "reveal", index: i }));
    await waitFor(() => hostState().phase === "roundover", "round over");
    clickHost("Fast Money");
    await waitFor(() => hostState().phase === "fastmoney", "fast money");
    clickHost("Lock in — reveal the answers");
    await waitFor(() => HD().querySelector("#fm-table select"), "pickers");
    const labels = pickerLabels();
    check("HP-2 F10 private Fast Money pickers read 'Answer 1…N', never the answers",
      labels.slice(0, 6).join("|") === "Pick the answer number…|Answer 1|Answer 2|Answer 3|Answer 4|No match → 0" &&
      noneLeak(FM1), `${labels.slice(0, 6).join("|")} / ${leakReport(FM1)}`);
    await waitFor(() => hostCardView() && hostCardView().kind === "fastmoney", "fast money host view");
    check("HP-1 the host phone lists the five questions with numbered answers and counts",
      hostCardView().fastMoney.questions.length === 5 &&
      hostCardView().fastMoney.questions[0].answers[0].text === "Apple" &&
      hostPhone().contentDocument.querySelectorAll(".host-fm-q").length === 5);

    // The picker still scores by number.
    const first = HD().querySelector("#fm-table select");
    first.value = "1";
    first.dispatchEvent(new (HW().Event)("change", { bubbles: true }));
    await sleep(40);
    check("HP-2 picking 'Answer 2' scores the second board answer (a public reveal)",
      hostState().fastMoney.rows[1][0].points === 24, hostState().fastMoney.rows[1][0].points);

    setHostPhoneConnected("h1", false);
    await waitFor(() => isShown(showBtn()), "fallback button in Fast Money");
    showBtn().click();
    await sleep(40);
    check("HP-2 the Fast Money fallback puts answer text in the pickers for this player only",
      pickerLabels().some((l) => l === "Butter — 44"), pickerLabels().slice(0, 6).join("|"));

    for (let q = 1; q < 5; q += 1) dispatchHost({ type: "fmReveal", slot: 1, q, answerIndex: null });
    clickHost("Bring in player 2");
    clickHost("Player 2 is ready");
    clickHost("Lock in — reveal the answers");
    await waitFor(() => hostState().fastMoney.slot === 2 && HD().querySelector("#fm-table select"), "player 2 pickers");
    check("HP-2 player 2 is a new item: the pickers are numbers again",
      pickerLabels().every((l) => l.indexOf(" — ") === -1) && pickerLabels()[1] === "Answer 1",
      pickerLabels().slice(0, 6).join("|"));
    setHostPhoneConnected("h1", true);
  }

  async function rebootWith(contestants, hostList) {
    setRoster(contestants);
    setHostPhoneList(hostList);
    setHostReady(false);
    await loadFrame(hostFrame, HOST_SRC);
    await waitFor(() => HW().FeudApp && hostState() && HW().FeudPrivate, "host reboot");
    await sleep(80);
  }

  const contestant = (pid, name) => ({ pid, name, color: "#fff", avatar: "🙂", connected: true, manual: false });

  async function testSeatReconciliation() {
    // A game in progress seats Ben; Ben is then made the host phone.
    resetPhones();
    await bootHost();
    await seatTwo();
    clickHost("Start the Feud");
    await rebootWith([contestant("p1", "Ana")], [{ pid: "p2", name: "Ben", connected: true }]);
    const s = hostState();
    const ben = s.roster.find((p) => p.pid === "p2");
    check("HP-3 a running game keeps the seat of a phone that became the host phone",
      s.teams[1].players.indexOf("p2") !== -1 && !!ben && ben.manual === true,
      `B=[${s.teams[1].players}] ben=${JSON.stringify(ben)}`);
    check("HP-3 and says so once",
      isShown(HD().getElementById("seat-notice")) &&
      /^Ben is now the host phone — play their turns from this screen/.test(
        HD().getElementById("seat-notice-text").textContent),
      HD().getElementById("seat-notice-text").textContent);

    // A plain setup simply drops the seat, with no notice.
    resetPhones();
    await bootHost();
    await seatTwo();
    await rebootWith([contestant("p1", "Ana")], [{ pid: "p2", name: "Ben", connected: true }]);
    check("HP-3 on a plain setup the departed phone seat is removed, without a notice",
      hostState().phase === "setup" && hostState().teams[1].players.indexOf("p2") === -1 &&
      !isShown(HD().getElementById("seat-notice")),
      `B=[${hostState().teams[1].players}]`);
  }

  return { testHostPhone, testPrivateFastMoney, testSeatReconciliation };
};
