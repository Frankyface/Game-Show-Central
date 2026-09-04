/* ============================================================
   shared/library.js — the in-repo question-set library
   (docs/19-cross-cutting-round.md §2). Zero npm deps: node:test +
   node:assert only, with a fake fetch injected through `{ fetch }`
   and a tiny fake DOM for the picker.
   Run from the repo root:  node --test
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import LIB from "../shared/library.js";

/* ---- a fake fetch ------------------------------------------- */

/**
 * @param {Record<string, {status?:number, body?:*, text?:string, throws?:boolean}>} routes
 */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return { ok: false, status: 404, async json() { throw new Error("no body"); } };
    if (route.throws) throw new TypeError("Failed to fetch");
    const status = route.status === undefined ? 200 : route.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        if (route.text !== undefined) return JSON.parse(route.text); // may throw → bad JSON
        return route.body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}

const DIR = "games/the-chase/";
const MANIFEST_URL = DIR + "sets/index.json";
const setUrl = (f) => DIR + "sets/" + f;

const GOOD = [
  { file: "kids.json", name: "Kids' night", description: "Nothing scary.", by: "GSC", counts: { rounds: 3 } },
  { file: "90s.json", name: "The 90s", description: "Dial-up era." },
];

/* ============ manifest shapes ============ */

test("load: a bare array manifest is the documented shape", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: GOOD } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, true);
  assert.equal(res.sets.length, 2);
  assert.deepEqual(res.sets.map((s) => s.file), ["kids.json", "90s.json"]);
  assert.equal(res.sets[0].name, "Kids' night");
  assert.deepEqual(res.sets[0].counts, [{ label: "rounds", value: 3 }]);
  assert.equal(res.sets[1].counts, null);
});

test("load: fetches the manifest with cache no-store, once", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: GOOD } });
  await LIB.load(DIR, { fetch });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, MANIFEST_URL);
  assert.equal(fetch.calls[0].init.cache, "no-store");
});

test("load: { sets: [...] } is tolerated as well as a bare array", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: { sets: GOOD } } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, true);
  assert.equal(res.sets.length, 2);
});

test("load: a manifest that is not a list is a plain-English failure", async () => {
  for (const body of [{ nope: 1 }, "a string", 42, null]) {
    const fetch = fakeFetch({ [MANIFEST_URL]: { body } });
    const res = await LIB.load(DIR, { fetch });
    assert.equal(res.ok, false, `body ${JSON.stringify(body)} should not load`);
    assert.match(res.error, /not a list of sets|not readable/i);
  }
});

test("load: a manifest with no usable rows reports an empty library", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: [{ file: "no-extension" }, null, 7, []] } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /empty/i);
});

test("load: at most 50 entries are kept", async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ file: `s${i}.json`, name: `Set ${i}` }));
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: many } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, true);
  assert.equal(res.sets.length, LIB.MAX_SETS);
  assert.equal(res.sets.length, 50);
  assert.equal(res.sets[49].file, "s49.json");
});

test("load: duplicate file names are collapsed", async () => {
  const fetch = fakeFetch({
    [MANIFEST_URL]: { body: [{ file: "a.json", name: "One" }, { file: "a.json", name: "Two" }] },
  });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.sets.length, 1);
  assert.equal(res.sets[0].name, "One");
});

test("load: name and description are capped, control characters stripped", async () => {
  const fetch = fakeFetch({
    [MANIFEST_URL]: {
      body: [{ file: "a.json", name: "N".repeat(200), description: "D".repeat(500), by: "B".repeat(200) }],
    },
  });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.sets[0].name.length, LIB.NAME_MAX);
  assert.equal(res.sets[0].name.length, 60);
  assert.equal(res.sets[0].description.length, LIB.DESC_MAX);
  assert.equal(res.sets[0].description.length, 200);
  assert.ok(res.sets[0].by.length <= 60);

  const dirty = LIB.parseManifest([{ file: "a.json", name: `Kids${String.fromCharCode(9)}night` }]);
  assert.equal(dirty.sets[0].name, "Kids night");
  assert.ok(!/[\u0000-\u001f]/.test(dirty.sets[0].name));
});

test("load: a row with no name falls back to the file's stem", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { body: [{ file: "office-party.json" }] } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.sets[0].name, "office-party");
});

/* ============ bad file names ============ */

test("safeFile: only a bare *.json name in sets/ is allowed", () => {
  const BACK = String.fromCharCode(92);
  for (const good of ["kids.json", "90s.json", "office_party.json", "a-b.JSON"]) {
    assert.equal(LIB.safeFile(good), good, `${good} should be allowed`);
  }
  const bad = [
    "sets/kids.json", "../secret.json", "/etc/passwd.json", "a" + BACK + "b.json",
    "kids.json?x=1", "kids.json#frag", "http://evil.test/x.json", "kids.txt",
    "kids", "", "   ", ".hidden.json", "..", ".", "kids json.json", "kid$.json",
    null, undefined, 42, {}, [],
  ];
  for (const value of bad) {
    assert.equal(LIB.safeFile(value), null, `${JSON.stringify(value)} should be rejected`);
  }
});

test("load: rows with unusable file names are dropped, the rest survive", async () => {
  const fetch = fakeFetch({
    [MANIFEST_URL]: {
      body: [
        { file: "../../etc/passwd.json", name: "Escape" },
        { file: "sets/nested.json", name: "Nested" },
        { file: "ok.json", name: "Fine" },
      ],
    },
  });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, true);
  assert.deepEqual(res.sets.map((s) => s.file), ["ok.json"]);
});

test("fetchSet: refuses a path-y file name without going near the network", async () => {
  const fetch = fakeFetch({});
  const res = await LIB.fetchSet(DIR, "../secret.json", { fetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /file name/i);
  assert.equal(fetch.calls.length, 0);
});

/* ============ fetch failures ============ */

test("load: a throwing fetch (file://) is a plain-English message, never a rejection", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { throws: true } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /web server|file/i);
  assert.ok(!/TypeError|undefined|\[object/.test(res.error));
});

test("load: a 404 manifest says there is no library yet", async () => {
  const fetch = fakeFetch({});
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /no saved sets/i);
});

test("load: a manifest that is not JSON fails cleanly", async () => {
  const fetch = fakeFetch({ [MANIFEST_URL]: { text: "<!doctype html>" } });
  const res = await LIB.load(DIR, { fetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /not readable|not a list/i);
});

test("load: with no fetch available at all it still resolves", async () => {
  const res = await LIB.load(DIR, { fetch: null });
  assert.equal(typeof res.ok, "boolean");
  assert.equal(typeof res.url, "string");
});

test("fetchSet: 404 and bad JSON both name the file in plain English", async () => {
  const missing = await LIB.fetchSet(DIR, "gone.json", { fetch: fakeFetch({}) });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /gone\.json/);

  const junk = await LIB.fetchSet(DIR, "junk.json", {
    fetch: fakeFetch({ [setUrl("junk.json")]: { text: "{oops" } }),
  });
  assert.equal(junk.ok, false);
  assert.match(junk.error, /junk\.json/);
});

test("fetchSet: a good set comes back parsed, from sets/<file>", async () => {
  const fetch = fakeFetch({ [setUrl("kids.json")]: { body: { rounds: [1, 2, 3] } } });
  const res = await LIB.fetchSet(DIR, "kids.json", { fetch });
  assert.equal(res.ok, true);
  assert.deepEqual(res.json, { rounds: [1, 2, 3] });
  assert.equal(fetch.calls[0].url, "games/the-chase/sets/kids.json");
  assert.equal(fetch.calls[0].init.cache, "no-store");
});

/* ============ gameDir shapes ============ */

test("load: gameDir with or without a trailing slash, or empty, builds one URL", async () => {
  const seen = [];
  const spy = async (url) => { seen.push(url); return { ok: false, status: 404, async json() { return null; } }; };
  await LIB.load("games/x/", { fetch: spy });
  await LIB.load("games/x", { fetch: spy });
  await LIB.load("", { fetch: spy });
  await LIB.load(".", { fetch: spy });
  await LIB.load(undefined, { fetch: spy });
  assert.deepEqual(seen, [
    "games/x/sets/index.json",
    "games/x/sets/index.json",
    "sets/index.json",
    "sets/index.json",
    "sets/index.json",
  ]);
});

/* ============ the picker, over a tiny fake DOM ============ */

/* Just enough DOM for mountPicker: createElement, textContent, classList,
   appendChild, addEventListener, and a <select> with a selectedIndex. */
function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      className: "",
      textContent: "",
      value: "",
      id: "",
      type: "",
      disabled: false,
      selectedIndex: -1,
      attrs: {},
      handlers: {},
      classList: {
        add(c) { if (!node.className.split(" ").includes(c)) node.className = (node.className + " " + c).trim(); },
        remove(c) { node.className = node.className.split(" ").filter((x) => x && x !== c).join(" "); },
        contains(c) { return node.className.split(" ").includes(c); },
      },
      setAttribute(k, v) { node.attrs[k] = String(v); },
      appendChild(child) {
        node.children.push(child);
        child.parentNode = node;
        if (node.tagName === "SELECT" && node.selectedIndex === -1) node.selectedIndex = 0;
        return child;
      },
      removeChild(child) {
        node.children = node.children.filter((c) => c !== child);
        child.parentNode = null;
        return child;
      },
      addEventListener(type, fn) { (node.handlers[type] = node.handlers[type] || []).push(fn); },
      fire(type) { for (const fn of node.handlers[type] || []) fn({ type }); },
      find(cls) {
        if (node.classList.contains(cls)) return node;
        for (const c of node.children) { const hit = c.find(cls); if (hit) return hit; }
        return null;
      },
    };
    return node;
  };
  globalThis.document = { createElement: make };
  return make("div");
}

function dropDom() { delete globalThis.document; }

const tick = () => new Promise((r) => setTimeout(r, 0));

test("mountPicker: builds a labelled select, a Load button, preview and error lines", async () => {
  const root = fakeDom();
  try {
    const picker = LIB.mountPicker(root, { gameDir: DIR, fetch: fakeFetch({ [MANIFEST_URL]: { body: GOOD } }) });
    await picker.ready;
    const box = root.children[0];
    const label = box.find("gsc-library-label");
    const select = box.find("gsc-library-select");
    const button = box.find("gsc-library-load");
    const preview = box.find("gsc-library-preview");
    const error = box.find("gsc-library-error");
    assert.ok(label && select && button && preview && error, "every part of the picker exists");
    assert.equal(label.attrs.for, select.id, "the label points at the select");
    assert.equal(button.type, "button");
    assert.equal(button.textContent, "Load set");
    assert.equal(select.children.length, 2, "one option per set");
    assert.equal(select.children[0].textContent, "Kids' night");
    assert.equal(select.children[0].value, "kids.json");
    assert.match(preview.textContent, /Kids' night — by GSC — Nothing scary\. — 3 rounds/);
    assert.equal(error.textContent, "");
    assert.equal(preview.attrs.role, "status");
    assert.equal(error.attrs.role, "alert");
  } finally { dropDom(); }
});

test("mountPicker: Load set fetches the chosen file and calls onPick with the manifest entry", async () => {
  const root = fakeDom();
  try {
    const picked = [];
    const fetch = fakeFetch({
      [MANIFEST_URL]: { body: GOOD },
      [setUrl("90s.json")]: { body: { rounds: ["dial-up"] } },
    });
    const picker = LIB.mountPicker(root, {
      gameDir: DIR, fetch,
      onPick: (json, meta) => picked.push({ json, meta }),
    });
    await picker.ready;
    const box = root.children[0];
    box.find("gsc-library-select").selectedIndex = 1;
    box.find("gsc-library-select").fire("change");
    assert.match(box.find("gsc-library-preview").textContent, /The 90s/);
    box.find("gsc-library-load").fire("click");
    await tick(); await tick();
    assert.equal(picked.length, 1);
    assert.deepEqual(picked[0].json, { rounds: ["dial-up"] });
    assert.equal(picked[0].meta.name, "The 90s");
    assert.equal(picked[0].meta.file, "90s.json");
    assert.equal(box.find("gsc-library-error").textContent, "");
    assert.equal(box.find("gsc-library-load").disabled, false, "the button is re-enabled");
    assert.equal(box.find("gsc-library-load").textContent, "Load set");
  } finally { dropDom(); }
});

test("mountPicker: validate rejecting a set shows its message and never calls onPick", async () => {
  const shapes = [
    [() => false, /checks/i],
    [() => null, /checks/i],
    [() => "Needs at least 3 rounds.", /3 rounds/],
    [() => ({ ok: false, error: "Missing questions." }), /Missing questions/],
    [() => ({ ok: false }), /checks/i],
    [() => { throw new Error("Round 2 has no answers."); }, /Round 2/],
  ];
  for (const [validate, re] of shapes) {
    const root = fakeDom();
    try {
      let picks = 0;
      const picker = LIB.mountPicker(root, {
        gameDir: DIR, validate,
        onPick: () => { picks += 1; },
        fetch: fakeFetch({ [MANIFEST_URL]: { body: GOOD }, [setUrl("kids.json")]: { body: { junk: true } } }),
      });
      await picker.ready;
      const box = root.children[0];
      box.find("gsc-library-load").fire("click");
      await tick(); await tick();
      assert.equal(picks, 0, "a rejected set never reaches the game");
      assert.match(box.find("gsc-library-error").textContent, re);
    } finally { dropDom(); }
  }
});

test("mountPicker: validate passing (true / undefined) lets the set through", async () => {
  for (const validate of [() => true, () => {}, () => ({ ok: true })]) {
    const root = fakeDom();
    try {
      let picks = 0;
      const picker = LIB.mountPicker(root, {
        gameDir: DIR, validate,
        onPick: () => { picks += 1; },
        fetch: fakeFetch({ [MANIFEST_URL]: { body: GOOD }, [setUrl("kids.json")]: { body: { ok: 1 } } }),
      });
      await picker.ready;
      root.children[0].find("gsc-library-load").fire("click");
      await tick(); await tick();
      assert.equal(picks, 1);
    } finally { dropDom(); }
  }
});

test("mountPicker: an unfetchable manifest hides the picker and says why in plain English", async () => {
  for (const route of [{ throws: true }, undefined]) {
    const root = fakeDom();
    try {
      const routes = route ? { [MANIFEST_URL]: route } : {};
      const picker = LIB.mountPicker(root, { gameDir: DIR, fetch: fakeFetch(routes) });
      await picker.ready;
      const box = root.children[0];
      assert.ok(box.find("gsc-library-select").parentNode.classList.contains("hidden"), "the select row is hidden");
      assert.ok(box.find("gsc-library-label").classList.contains("hidden"), "the label is hidden");
      assert.ok(box.find("gsc-library-preview").classList.contains("hidden"), "the preview is hidden");
      assert.ok(box.classList.contains("gsc-library-off"));
      const msg = box.find("gsc-library-error").textContent;
      assert.ok(msg.length > 20, "the message is a sentence, not a code");
      assert.ok(!/undefined|TypeError|\[object/.test(msg));
    } finally { dropDom(); }
  }
});

test("mountPicker: a failing set fetch shows the error and leaves the picker usable", async () => {
  const root = fakeDom();
  try {
    let picks = 0;
    const picker = LIB.mountPicker(root, {
      gameDir: DIR, onPick: () => { picks += 1; },
      fetch: fakeFetch({ [MANIFEST_URL]: { body: GOOD } }), // sets/kids.json 404s
    });
    await picker.ready;
    const box = root.children[0];
    box.find("gsc-library-load").fire("click");
    await tick(); await tick();
    assert.equal(picks, 0);
    assert.match(box.find("gsc-library-error").textContent, /kids\.json/);
    assert.equal(box.find("gsc-library-load").disabled, false);
  } finally { dropDom(); }
});

test("mountPicker: destroy removes the picker from the page", async () => {
  const root = fakeDom();
  try {
    const picker = LIB.mountPicker(root, { gameDir: DIR, fetch: fakeFetch({ [MANIFEST_URL]: { body: GOOD } }) });
    await picker.ready;
    assert.equal(root.children.length, 1);
    picker.destroy();
    assert.equal(root.children.length, 0);
  } finally { dropDom(); }
});

test("mountPicker: without a container or a document it is a safe no-op", async () => {
  const picker = LIB.mountPicker(null, { gameDir: DIR });
  assert.equal(picker.el, null);
  assert.equal(typeof picker.destroy, "function");
  const res = await picker.ready;
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, "string");
  picker.destroy(); // must not throw
});

/* ============ the module itself ============ */

test("the module is UMD and exposes exactly the documented API", () => {
  for (const name of ["load", "fetchSet", "mountPicker"]) {
    assert.equal(typeof LIB[name], "function", `${name} must be exported`);
  }
  assert.equal(LIB.MANIFEST, "sets/index.json");
  assert.equal(globalThis.GSCLibrary, LIB, "loading the file attaches globalThis.GSCLibrary");
});

test("previewText: name, by, description and counts, in that order", () => {
  assert.equal(
    LIB.previewText({ name: "Kids' night", by: "GSC", description: "Easy.", counts: [{ label: "rounds", value: 3 }] }),
    "Kids' night — by GSC — Easy. — 3 rounds",
  );
  assert.equal(LIB.previewText({ name: "Bare", by: "", description: "", counts: null }), "Bare");
  assert.equal(LIB.previewText(null), "");
});
