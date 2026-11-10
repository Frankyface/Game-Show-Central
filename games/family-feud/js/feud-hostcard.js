/* ============================================================
   Family Feud — the host phone's card (docs/22 §5.3 + §5.7)
   Renders the `hostView` the laptop publishes: the current survey as
   a numbered list the host can match a spoken answer against at a
   glance (number · answer in the Feud accent · count, revealed ones
   ticked and dimmed), then strikes / bank / who is playing; in Fast
   Money, the five questions with their numbered answers and which
   one each sheet picked. Read-only: no buttons, nothing is sent.
   Every string goes in through textContent.
   ============================================================ */

"use strict";

const FeudHostCard = (function () {
  const { $, el, show } = window.FeudApp.helpers;

  let view = null;
  let connected = true;

  function setView(next) {
    view = next && typeof next === "object" ? next : null;
    paint();
  }

  function setConnected(isUp) {
    connected = !!isUp;
    paint();
  }

  function paint() {
    const card = $("player-host");
    if (!card) return;
    card.classList.toggle("is-stale", !connected);
    show($("host-stale"), !connected);
    $("host-answers").replaceChildren();
    $("host-fm").replaceChildren();
    $("host-meta").textContent = "";
    $("host-question").textContent = "";
    $("host-item").textContent = view && typeof view.item === "string" ? view.item : "";
    if (!view) return empty("Waiting for the game…");
    if (view.tooBig) return empty("Too much to show — use the button on the laptop.");
    if (view.kind === "survey" && view.survey) return paintSurvey(view.survey);
    if (view.kind === "fastmoney" && view.fastMoney) return paintFastMoney(view.fastMoney);
    return empty(`Nothing secret right now${view.phaseText ? ` · ${view.phaseText}` : ""}.`);
  }

  function empty(text) {
    $("host-empty").textContent = text;
    show($("host-empty"), true);
  }

  function answerRow(a, extra) {
    const li = el("li", a.revealed ? "is-revealed" : null);
    li.appendChild(el("span", "host-n", String(a.n)));
    li.appendChild(el("span", "host-answer", a.text));
    li.appendChild(el("span", "host-count", String(a.count)));
    if (a.revealed) li.appendChild(el("span", "host-tick", "On the board"));
    if (extra) li.appendChild(el("span", "host-tick", extra));
    return li;
  }

  function paintSurvey(s) {
    show($("host-empty"), false);
    $("host-question").textContent = s.question;
    const list = $("host-answers");
    (s.answers || []).forEach((a) => list.appendChild(answerRow(a)));
    const bits = [`Strikes ${s.strikes} of ${s.strikeLimit}`, `Bank ${s.bank}`];
    if (s.multiplier && s.multiplier !== 1) bits.push(`×${s.multiplier}`);
    if (s.stealing) bits.push(`${s.stealing} to steal`);
    else if (s.control) bits.push(`${s.control} playing`);
    $("host-meta").textContent = bits.join(" · ");
    if (s.nextQuestion) {
      $("host-fm").appendChild(el("p", "host-next", `Next round: ${s.nextQuestion}`));
    }
  }

  function paintFastMoney(fm) {
    show($("host-empty"), false);
    $("host-question").textContent =
      `Player ${fm.slot} · total ${fm.total} of ${fm.target}`;
    const host = $("host-fm");
    (fm.questions || []).forEach((q) => {
      const block = el("section", "host-fm-q");
      block.appendChild(el("p", "host-fm-question", `${q.n}. ${q.question}`));
      const list = el("ol", "host-answers host-answers-fm");
      const mine = q.picks && q.picks[fm.slot];
      const first = q.picks && q.picks[1];
      q.answers.forEach((a) => {
        let note = "";
        if (mine && mine.n === a.n) note = mine.duplicate ? "Picked — duplicate" : "Picked";
        else if (fm.slot === 2 && first && first.n === a.n) note = "Player 1's answer";
        list.appendChild(answerRow({ n: a.n, text: a.text, count: a.count, revealed: false }, note));
      });
      block.appendChild(list);
      host.appendChild(block);
    });
  }

  return { setView, setConnected, getView: () => view };
})();

window.FeudHostCard = FeudHostCard;
