/* ============================================================
   The Price Is Right harness — result plumbing and async helpers
   Split out of tests/harness.html so that page stays under the
   800-line house cap while the scenario list grows. Loaded by a
   plain <script> tag before the harness's own script; everything
   it exposes hangs off window.HarnessLib.

   No assertions live here — only the PASS/FAIL list, the summary
   line the runner reads (window.__TPIR_HARNESS__) and two async
   helpers. Every node is built with createElement.
   ============================================================ */

"use strict";

window.HarnessLib = (function () {
  const results = [];
  let uncaught = null;

  window.addEventListener("error", (e) => { uncaught = e.message; render(); });
  window.addEventListener("unhandledrejection", (e) => { uncaught = String(e.reason); render(); });

  /** Record one success state. `detail` is the evidence shown under it. */
  function check(label, cond, detail) {
    results.push({ label, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
    render();
  }

  /** Note a thrown error so the summary can never read green over a crash. */
  function fail(message) {
    uncaught = message;
    render();
  }

  function render() {
    const list = document.getElementById("results");
    if (!list) return;
    list.replaceChildren();
    for (const r of results) {
      const li = document.createElement("li");
      li.dataset.pass = String(r.pass);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = r.pass ? "PASS" : "FAIL";
      li.appendChild(tag);
      li.appendChild(document.createTextNode(r.label));
      if (r.detail) {
        const d = document.createElement("span");
        d.className = "detail";
        d.textContent = r.detail;
        li.appendChild(d);
      }
      list.appendChild(li);
    }
    const failed = results.filter((r) => !r.pass).length;
    const summary = document.getElementById("summary");
    const ok = failed === 0 && !uncaught;
    if (summary) {
      summary.className = ok ? "ok" : "bad";
      summary.textContent = ok
        ? `All ${results.length} checks passed.`
        : `${failed} of ${results.length} checks FAILED${uncaught ? ` — uncaught: ${uncaught}` : ""}`;
    }
    window.__TPIR_HARNESS__ = { total: results.length, failed, uncaught, results };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Poll `fn` until it returns something truthy, then hand it back. */
  async function waitFor(fn, label, timeout) {
    const limit = timeout || 6000;
    const start = Date.now();
    for (;;) {
      let value = null;
      try { value = fn(); } catch (err) { value = null; }
      if (value) return value;
      if (Date.now() - start > limit) throw new Error(`timed out waiting for ${label}`);
      await sleep(30);
    }
  }

  return { check, fail, render, sleep, waitFor, results };
})();
