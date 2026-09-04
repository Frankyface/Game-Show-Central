/* ============================================================
   Game Show Central — the in-repo question-set library
   (docs/19-cross-cutting-round.md §2, docs/00-architecture.md §9.12)

   Every game ships `games/<id>/sets/index.json`, a manifest of the extra
   content files committed beside it:

     [{ "file": "kids.json", "name": "Kids' night",
        "description": "Nothing after 2005.", "by": "GSC",
        "counts": { "rounds": 3, "questions": 30 } }]

   This module fetches and validates that manifest, fetches one set, and
   mounts the shared picker onto a game's setup screen. Fourteen games
   code against this API, so the three exported functions and their
   return shapes are fixed — see docs/design-system.md "Library picker".

   Nothing here throws at the caller and nothing here rejects: every
   result is `{ ok, … , error }` with a plain-English `error`, because a
   page opened from disk (file://) or a game with no sets folder yet is a
   normal state, not a crash. No HTML strings anywhere: every node is
   built with document.createElement.
   ============================================================ */

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GSCLibrary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MANIFEST = "sets/index.json";
  const MAX_SETS = 50;
  const NAME_MAX = 60;
  const DESC_MAX = 200;
  const BY_MAX = 60;
  const FILE_MAX = 80;
  const COUNTS_MAX = 6;

  const NO_MANIFEST =
    "No saved sets for this game yet — add games/<id>/sets/index.json to build a library.";
  const NO_SERVER =
    "Saved sets need a web server: this page was opened straight from a file. " +
    "Open it over http:// (or on the published site) to load a set.";
  const BAD_MANIFEST =
    "The set library for this game is not readable — sets/index.json is not a list of sets.";
  const EMPTY_MANIFEST = "The set library for this game is empty.";

  /* ============ small helpers ============ */

  function fetcher(opts) {
    if (opts && typeof opts.fetch === "function") return opts.fetch;
    return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
  }

  /** `games/x/` `games/x` `` `.` → a prefix that always ends in exactly one "/". */
  function dirPrefix(gameDir) {
    if (typeof gameDir !== "string") return "";
    const trimmed = gameDir.trim();
    if (!trimmed || trimmed === "." || trimmed === "./") return "";
    return trimmed.endsWith("/") ? trimmed : trimmed + "/";
  }

  /** Strip control characters, collapse whitespace, trim, cap. */
  function text(value, max) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  /**
   * A manifest `file` must be a bare JSON file name sitting in sets/.
   * No slashes, no backslashes, no "..", no query, no scheme.
   * @returns {string|null}
   */
  function safeFile(value) {
    const name = text(value, FILE_MAX);
    if (!name || name.length > FILE_MAX) return null;
    if (/[/\\?#:]/.test(name)) return null;
    if (name === "." || name === ".." || name.startsWith(".")) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
    if (!/\.json$/i.test(name)) return null;
    return name;
  }

  /** Optional `counts` — a flat map of label → finite number, capped. */
  function safeCounts(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = [];
    for (const key of Object.keys(raw)) {
      const n = Number(raw[key]);
      if (!Number.isFinite(n)) continue;
      const label = text(key, 24);
      if (!label) continue;
      out.push({ label, value: Math.round(n) });
      if (out.length >= COUNTS_MAX) break;
    }
    return out.length ? out : null;
  }

  /** One manifest row → a clean entry, or null if it is unusable. */
  function cleanEntry(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const file = safeFile(raw.file);
    if (!file) return null;
    const name = text(raw.name, NAME_MAX) || file.replace(/\.json$/i, "");
    return {
      file,
      name,
      description: text(raw.description, DESC_MAX),
      by: text(raw.by, BY_MAX),
      counts: safeCounts(raw.counts),
    };
  }

  /**
   * Validate a parsed manifest. Accepts a bare array (the documented shape)
   * or `{ sets: [...] }`. Junk rows are dropped, not fatal; at most 50 are kept.
   * @returns {{ok:true, sets:Array}|{ok:false, error:string}}
   */
  function parseManifest(data) {
    const rows = Array.isArray(data) ? data : (data && Array.isArray(data.sets) ? data.sets : null);
    if (!rows) return { ok: false, error: BAD_MANIFEST };
    const sets = [];
    const seen = new Set();
    for (const raw of rows) {
      const entry = cleanEntry(raw);
      if (!entry || seen.has(entry.file)) continue;
      seen.add(entry.file);
      sets.push(entry);
      if (sets.length >= MAX_SETS) break; // §2: at most 50 entries
    }
    if (!sets.length) return { ok: false, error: EMPTY_MANIFEST };
    return { ok: true, sets };
  }

  /* ============ fetching ============ */

  /**
   * Fetch and validate `<gameDir>sets/index.json`.
   * Never rejects.
   * @returns {Promise<{ok:true, sets:Array, url:string}|{ok:false, error:string, url:string}>}
   */
  async function load(gameDir, opts) {
    const url = dirPrefix(gameDir) + MANIFEST;
    const doFetch = fetcher(opts);
    if (!doFetch) return { ok: false, error: NO_SERVER, url };
    let res;
    try {
      res = await doFetch(url, { cache: "no-store" });
    } catch (err) {
      // file:// and a blocked/offline origin both land here.
      return { ok: false, error: NO_SERVER, url };
    }
    if (!res || !res.ok) return { ok: false, error: NO_MANIFEST, url };
    let data;
    try {
      data = await res.json();
    } catch (err) {
      return { ok: false, error: BAD_MANIFEST, url };
    }
    const parsed = parseManifest(data);
    return parsed.ok ? { ok: true, sets: parsed.sets, url } : { ok: false, error: parsed.error, url };
  }

  /**
   * Fetch one set file named in the manifest. Never rejects.
   * @returns {Promise<{ok:true, json:*, url:string}|{ok:false, error:string, url:string}>}
   */
  async function fetchSet(gameDir, file, opts) {
    const name = safeFile(file);
    if (!name) return { ok: false, error: "That set has an unusable file name.", url: "" };
    const url = dirPrefix(gameDir) + "sets/" + name;
    const doFetch = fetcher(opts);
    if (!doFetch) return { ok: false, error: NO_SERVER, url };
    let res;
    try {
      res = await doFetch(url, { cache: "no-store" });
    } catch (err) {
      return { ok: false, error: NO_SERVER, url };
    }
    if (!res || !res.ok) return { ok: false, error: `Couldn't load ${name} — it isn't on the site.`, url };
    try {
      return { ok: true, json: await res.json(), url };
    } catch (err) {
      return { ok: false, error: `${name} isn't valid JSON.`, url };
    }
  }

  /* ============ the picker ============ */

  let pickerSeq = 0;

  function el(tag, cls, txt) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (txt !== undefined) node.textContent = txt;
    return node;
  }

  /** The Preview line: name, who made it, description, counts. */
  function previewText(entry) {
    if (!entry) return "";
    const bits = [entry.name];
    if (entry.by) bits.push("by " + entry.by);
    if (entry.description) bits.push(entry.description);
    if (entry.counts) bits.push(entry.counts.map((c) => `${c.value} ${c.label}`).join(" · "));
    return bits.join(" — ");
  }

  /**
   * Run the game's own validator over a loaded set.
   * A validator may throw, return a string error, return {ok:false,error},
   * or return false. Anything else (true, undefined, an object) is a pass.
   * @returns {string} "" when the set is good, else the message to show.
   */
  function runValidate(validate, json) {
    if (typeof validate !== "function") return "";
    let out;
    try {
      out = validate(json);
    } catch (err) {
      return (err && err.message) || "That set didn't pass this game's checks.";
    }
    if (out === false || out === null) return "That set didn't pass this game's checks.";
    if (typeof out === "string" && out) return out;
    if (out && typeof out === "object" && out.ok === false) {
      return (typeof out.error === "string" && out.error) || "That set didn't pass this game's checks.";
    }
    return "";
  }

  /**
   * Build the picker into `container`.
   * @param {HTMLElement} container
   * @param {{gameDir:string, onPick:Function, validate?:Function, label?:string, fetch?:Function}} options
   * @returns {{ready:Promise, destroy:Function, el:HTMLElement|null}}
   */
  function mountPicker(container, options) {
    const opts = options || {};
    if (!container || typeof document === "undefined") {
      return { ready: Promise.resolve({ ok: false, error: "No container to mount into." }), destroy() {}, el: null };
    }
    const id = "gsc-lib-select-" + (++pickerSeq);

    const box = el("div", "gsc-library");
    const label = el("label", "gsc-library-label", opts.label || "Saved sets");
    label.setAttribute("for", id);
    const row = el("div", "gsc-library-row");
    const select = el("select", "gsc-library-select");
    select.id = id;
    const loadBtn = el("button", "gsc-btn gsc-btn-primary gsc-library-load", "Load set");
    loadBtn.type = "button";
    row.appendChild(select);
    row.appendChild(loadBtn);
    const preview = el("p", "gsc-library-preview");
    preview.setAttribute("role", "status");
    const error = el("p", "gsc-library-error");
    error.setAttribute("role", "alert");

    box.appendChild(label);
    box.appendChild(row);
    box.appendChild(preview);
    box.appendChild(error);
    container.appendChild(box);

    let sets = [];
    let alive = true;

    const setError = (msg) => { error.textContent = msg || ""; };
    const hidePicker = () => {
      label.classList.add("hidden");
      row.classList.add("hidden");
      preview.classList.add("hidden");
      box.classList.add("gsc-library-off");
    };
    const showPreview = () => {
      preview.textContent = previewText(sets[select.selectedIndex]);
    };

    select.addEventListener("change", () => { setError(""); showPreview(); });

    loadBtn.addEventListener("click", async () => {
      const entry = sets[select.selectedIndex];
      if (!entry) return;
      setError("");
      loadBtn.disabled = true;
      const was = loadBtn.textContent;
      loadBtn.textContent = "Loading…";
      const got = await fetchSet(opts.gameDir, entry.file, opts);
      if (!alive) return;
      loadBtn.disabled = false;
      loadBtn.textContent = was;
      if (!got.ok) { setError(got.error); return; }
      const bad = runValidate(opts.validate, got.json);
      if (bad) { setError(bad); return; }
      if (typeof opts.onPick === "function") opts.onPick(got.json, entry);
    });

    const ready = load(opts.gameDir, opts).then((res) => {
      if (!alive) return res;
      if (!res.ok) { hidePicker(); setError(res.error); return res; }
      sets = res.sets;
      for (const entry of sets) {
        const option = el("option", null, entry.name);
        option.value = entry.file;
        select.appendChild(option);
      }
      showPreview();
      return res;
    });

    return {
      el: box,
      ready,
      destroy() {
        alive = false;
        if (box.parentNode) box.parentNode.removeChild(box);
      },
    };
  }

  return {
    load, fetchSet, mountPicker,
    // exposed for tests and for a game that wants to validate its own manifest
    parseManifest, safeFile, previewText,
    MANIFEST, MAX_SETS, NAME_MAX, DESC_MAX,
  };
});
