"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { DEFAULT_SETTINGS, isAllowlisted, keepAwakeReason } = require("../rules.js");

const now = 10 * 60 * 60000;
const old = now - 31 * 60000;
const base = { id: 1, url: "https://example.com/", active: false, pinned: false, audible: false, discarded: false, lastAccessed: old };
const ctx = (extra = {}) => ({ now, settings: { ...DEFAULT_SETTINGS }, dirtyTabIds: new Set(), ...extra });
const reason = (tab, extra) => keepAwakeReason({ ...base, ...tab }, ctx(extra));

test("idle background tab sleeps", () => assert.strictEqual(reason({}), null));
test("recently used tab stays awake", () => assert.strictEqual(reason({ lastAccessed: now - 5 * 60000 }), "recently used"));
test("active tab never sleeps", () => assert.strictEqual(reason({ active: true }), "active"));
test("pinned tab protected by default", () => assert.strictEqual(reason({ pinned: true }), "pinned"));
test("pinned tab sleeps when protection is off", () =>
  assert.strictEqual(reason({ pinned: true }, { settings: { ...DEFAULT_SETTINGS, protectPinned: false } }), null));
test("audible tab stays awake", () => assert.strictEqual(reason({ audible: true }), "playing audio"));
for (const kind of ["camera", "microphone", "screen"]) {
  test(`tab sharing ${kind} stays awake`, () =>
    assert.strictEqual(reason({ sharingState: { [kind]: kind === "screen" ? "Screen" : true } }), "sharing camera, mic or screen"));
}
test("tab with unsaved input stays awake", () =>
  assert.strictEqual(reason({}, { dirtyTabIds: new Set([1]) }), "unsaved form input"));
test("allowlisted site and subdomain stay awake", () => {
  assert.strictEqual(reason({}, { settings: { ...DEFAULT_SETTINGS, allowlist: ["example.com"] } }), "site on never-sleep list");
  assert.ok(isAllowlisted("https://mail.example.com/x", ["example.com"]));
  assert.ok(!isAllowlisted("https://notexample.com/", ["example.com"]));
});
test("non-web pages are left alone", () => assert.strictEqual(reason({ url: "about:preferences" }), "not a web page"));
test("already discarded tab is skipped", () => assert.strictEqual(reason({ discarded: true }), "already asleep"));
test("disabled setting stops automatic sleep but not manual", () => {
  const settings = { ...DEFAULT_SETTINGS, enabled: false };
  assert.strictEqual(reason({}, { settings }), "sleeping disabled");
  assert.strictEqual(reason({ lastAccessed: now }, { settings, ignoreTimeout: true }), null);
});
test("manual sleep still respects protections", () =>
  assert.strictEqual(reason({ audible: true }, { ignoreTimeout: true }), "playing audio"));
