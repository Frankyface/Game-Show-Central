/* ============================================================
   shared/icons.js — the v3 icon registry (docs/21 §2.5).
   node:test + node:assert only, with a tiny fake createElementNS.
   ============================================================ */

import test from "node:test";
import assert from "node:assert/strict";
import ICONS from "../shared/icons.js";

function fakeDoc() {
  const make = (ns, tag) => {
    const node = {
      ns, tag, attrs: {}, children: [], parentNode: null,
      setAttribute(k, v) { node.attrs[k] = String(v); },
      appendChild(c) { node.children.push(c); c.parentNode = node; return c; },
    };
    return node;
  };
  return { createElementNS: make };
}

const REQUIRED = [
  "sound", "sound-off", "settings", "back", "undo", "lobby", "edit", "phone",
  "check", "cross", "play", "pause", "chevron-down", "copy", "lock",
];

test("every icon the brief names is registered", () => {
  for (const name of REQUIRED) assert.ok(ICONS.has(name), `${name} is missing`);
  assert.deepEqual([...ICONS.names()].sort(), [...REQUIRED].sort());
});

test("make: an SVG in the SVG namespace, currentColor, 1.5 stroke, 18 px, no fill", () => {
  for (const name of REQUIRED) {
    const svg = ICONS.make(name, { doc: fakeDoc() });
    assert.equal(svg.ns, "http://www.w3.org/2000/svg");
    assert.equal(svg.tag, "svg");
    assert.equal(svg.attrs.stroke, "currentColor");
    assert.equal(svg.attrs["stroke-width"], "1.5");
    assert.equal(svg.attrs.fill, "none");
    assert.equal(svg.attrs.width, "18");
    assert.equal(svg.attrs.viewBox, "0 0 24 24");
    assert.equal(svg.attrs["aria-hidden"], "true");
    assert.match(svg.attrs.class, new RegExp(`gsc-icon gsc-icon-${name}`));
    assert.ok(svg.children.length >= 1);
    for (const child of svg.children) assert.equal(child.ns, "http://www.w3.org/2000/svg");
  }
});

test("make: size is clamped to 12–32 and defaults on junk", () => {
  const at = (size) => ICONS.make("check", { doc: fakeDoc(), size }).attrs.width;
  assert.equal(at(16), "16");
  assert.equal(at(20), "20");
  assert.equal(at(4), "12");
  assert.equal(at(400), "32");
  assert.equal(at("big"), "18");
});

test("make: a label turns the icon into an image with an accessible name", () => {
  const svg = ICONS.make("lock", { doc: fakeDoc(), label: "Locked" });
  assert.equal(svg.attrs.role, "img");
  assert.equal(svg.attrs["aria-label"], "Locked");
  assert.equal(svg.attrs["aria-hidden"], undefined);
});

test("make: an unknown name or no document returns null instead of throwing", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(ICONS.make("rocket", { doc: fakeDoc() }), null);
    assert.equal(ICONS.make("check"), null); // Node: no document
  } finally { console.warn = warn; }
});

test("the module is UMD", () => {
  assert.equal(globalThis.GSCIcons, ICONS);
  assert.equal(typeof ICONS.prepend, "function");
});
