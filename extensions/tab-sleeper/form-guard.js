"use strict";
// Tells Tab Sleeper when the page has text the user typed but hasn't submitted,
// so the tab is never unloaded with unsaved input.
(() => {
  let dirty = false;
  const send = value => {
    if (dirty === value) return;
    dirty = value;
    browser.runtime.sendMessage({ type: "form-dirty", dirty: value }).catch(() => {});
  };
  const isEditable = el =>
    el && (el.isContentEditable || el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(el.type)));
  document.addEventListener("input", e => { if (isEditable(e.target)) send(true); }, { capture: true, passive: true });
  document.addEventListener("submit", () => send(false), { capture: true, passive: true });
})();
