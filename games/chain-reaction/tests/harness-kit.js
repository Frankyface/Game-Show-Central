/* ============================================================
   Chain Reaction — loopback harness plumbing
   The PASS/FAIL list, the summary line and the two async helpers
   every scenario in tests/harness.html uses. Split out of that
   page only to keep it under the 800-line house limit; there is
   no game logic here at all.

   Every node is built with createElement/textContent — the
   harness is held to the same no innerHTML rule as the game.
   ============================================================ */

"use strict";

(function (root) {
  /**
   * @param {{list:HTMLElement, summary:HTMLElement, name?:string}} nodes
   * @returns {{check:Function, render:Function, sleep:Function, waitFor:Function,
   *            setUncaught:Function, results:Array}}
   */
  function create(nodes) {
    const results = [];
    const list = nodes.list;
    const summary = nodes.summary;
    const key = nodes.name || "__CR_HARNESS__";
    let uncaught = null;

    function row(result) {
      const li = document.createElement("li");
      li.dataset.pass = String(result.pass);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = result.pass ? "PASS" : "FAIL";
      li.appendChild(tag);
      li.appendChild(document.createTextNode(result.label));
      if (result.detail) {
        const d = document.createElement("span");
        d.className = "detail";
        d.textContent = result.detail;
        li.appendChild(d);
      }
      return li;
    }

    function render() {
      list.replaceChildren();
      for (const r of results) list.appendChild(row(r));
      const failed = results.filter((r) => !r.pass).length;
      const ok = failed === 0 && !uncaught;
      summary.className = ok ? "ok" : "bad";
      summary.textContent = ok
        ? `All ${results.length} checks passed.`
        : `${failed} of ${results.length} checks FAILED${uncaught ? ` — uncaught: ${uncaught}` : ""}`;
      root[key] = { total: results.length, failed, uncaught, results };
    }

    function check(label, cond, detail) {
      results.push({ label, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
      render();
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /** Poll `fn` until it returns something truthy, or give up with a message. */
    async function waitFor(fn, label, timeout) {
      const limit = timeout || 5000;
      const start = Date.now();
      for (;;) {
        let value = null;
        try { value = fn(); } catch (err) { value = null; }
        if (value) return value;
        if (Date.now() - start > limit) throw new Error(`timed out waiting for ${label}`);
        await sleep(30);
      }
    }

    root.addEventListener("error", (e) => { uncaught = e.message; });
    root.addEventListener("unhandledrejection", (e) => { uncaught = String(e.reason); });

    return {
      results,
      check,
      render,
      sleep,
      waitFor,
      setUncaught(message) { uncaught = message; },
      get uncaught() { return uncaught; },
    };
  }

  /**
   * The shell side of the bridge protocol (architecture 00 §6): reply to each
   * frame's `ready` with `init`, and relay `send` between the host frame and
   * the phone frames. No PeerJS, no hub — the harness page IS the shell.
   * @param {{hostFrame:HTMLIFrameElement, phoneFrames:Map, room:{code:string, players:Array}}} options
   * @returns {{post:Function, shellLog:Array}}
   */
  function bridge(options) {
    const hostFrame = options.hostFrame;
    const phoneFrames = options.phoneFrames;
    const room = options.room;
    const shellLog = [];   // scores/title/exit frames the host sent up

    function post(frame, msg) {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(Object.assign({ gsc: 1 }, msg), location.origin);
    }

    function fromHost(d) {
      if (d.t === "ready") { post(hostFrame, { t: "init", mode: "embed-host", room }); return; }
      if (d.t === "send") {
        if (d.pid === "*") phoneFrames.forEach((f) => post(f, { t: "msg", m: d.m }));
        else post(phoneFrames.get(d.pid), { t: "msg", m: d.m });
        return;
      }
      shellLog.push(d);
    }

    function fromPhone(pid, d) {
      if (d.t === "ready") {
        const me = room.players.find((p) => p.pid === pid);
        post(phoneFrames.get(pid), { t: "init", mode: "embed-player", me, room: { code: room.code } });
        return;
      }
      if (d.t === "send") post(hostFrame, { t: "msg", pid, m: d.m });
    }

    root.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return;
      const d = event.data;
      if (!d || typeof d !== "object" || d.gsc !== 1 || typeof d.t !== "string") return;
      if (event.source === hostFrame.contentWindow) { fromHost(d); return; }
      for (const [pid, frame] of phoneFrames) {
        if (event.source === frame.contentWindow) { fromPhone(pid, d); return; }
      }
    });

    return { post, shellLog };
  }

  root.CRHarnessKit = { create, bridge };
})(typeof window !== "undefined" ? window : globalThis);
