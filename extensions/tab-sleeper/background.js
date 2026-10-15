"use strict";
/* global DEFAULT_SETTINGS, keepAwakeReason */

const ALARM = "tab-sleeper-check";

async function getSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// Tabs with unsaved form input. Kept in session storage because this
// background page is unloaded when idle.
async function getDirty() {
  const { dirty = [] } = await browser.storage.session.get("dirty");
  return new Set(dirty);
}
async function setDirty(tabId, isDirty) {
  const dirty = await getDirty();
  if (isDirty) dirty.add(tabId);
  else dirty.delete(tabId);
  await browser.storage.session.set({ dirty: [...dirty] });
}

async function updateBadge() {
  const asleep = await browser.tabs.query({ discarded: true });
  await browser.browserAction.setBadgeText({ text: asleep.length ? String(asleep.length) : "" });
  await browser.browserAction.setBadgeBackgroundColor({ color: "#555" });
}

async function sleepTabs({ ignoreTimeout = false, windowId } = {}) {
  const settings = await getSettings();
  const dirtyTabIds = await getDirty();
  const query = { discarded: false };
  if (windowId !== undefined) query.windowId = windowId;
  const tabs = await browser.tabs.query(query);
  const now = Date.now();
  const toSleep = tabs
    .filter(tab => keepAwakeReason(tab, { now, settings, dirtyTabIds, ignoreTimeout }) === null)
    .map(tab => tab.id);
  if (toSleep.length) await browser.tabs.discard(toSleep);
  await updateBadge();
  return toSleep.length;
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) sleepTabs();
});

// Runs every time the background page wakes. Only creates the alarm if it's
// missing, since re-creating it would restart its one-minute countdown.
async function ensureAlarm() {
  if (!(await browser.alarms.get(ALARM))) browser.alarms.create(ALARM, { periodInMinutes: 1 });
}
ensureAlarm();

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg && msg.type) {
    case "form-dirty":
      if (sender.tab) return setDirty(sender.tab.id, msg.dirty);
      return;
    case "sleep-others":
      return sleepTabs({ ignoreTimeout: true, windowId: msg.windowId });
    case "status":
      return Promise.all([getSettings(), getDirty(), browser.tabs.query({ discarded: true })]).then(
        ([settings, dirty, asleep]) => {
          const tab = msg.tab;
          const reason = tab ? keepAwakeReason(tab, { now: Date.now(), settings, dirtyTabIds: dirty, ignoreTimeout: true }) : null;
          return { settings, asleepCount: asleep.length, reason };
        }
      );
  }
});

// A navigation or reload clears the page's form state.
browser.tabs.onUpdated.addListener(
  (tabId, changeInfo) => {
    if (changeInfo.status === "loading") setDirty(tabId, false);
    if ("discarded" in changeInfo) updateBadge();
  },
  { properties: ["status", "discarded"] }
);
browser.tabs.onRemoved.addListener(tabId => {
  setDirty(tabId, false);
  updateBadge();
});
