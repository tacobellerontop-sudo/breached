"use strict";

// Pure decision logic, shared by background.js and the Node tests.

const DEFAULT_SETTINGS = {
  enabled: true,
  timeoutMinutes: 30,
  protectPinned: true,
  allowlist: [], // hostnames; subdomains match too
};

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isAllowlisted(url, allowlist) {
  const host = hostOf(url);
  if (!host) return false;
  return allowlist.some(entry => {
    const e = entry.trim().toLowerCase().replace(/^\*\./, "");
    return e && (host === e || host.endsWith("." + e));
  });
}

// Returns null if the tab may sleep, otherwise a short reason it must stay awake.
// ignoreTimeout is used by "Sleep other tabs now".
function keepAwakeReason(tab, { now, settings, dirtyTabIds, ignoreTimeout = false }) {
  if (tab.discarded) return "already asleep";
  if (tab.active) return "active";
  if (!/^https?:/.test(tab.url || "")) return "not a web page";
  if (tab.pinned && settings.protectPinned) return "pinned";
  if (tab.audible) return "playing audio";
  const sharing = tab.sharingState || {};
  if (sharing.camera || sharing.microphone || sharing.screen) return "sharing camera, mic or screen";
  if (dirtyTabIds && dirtyTabIds.has(tab.id)) return "unsaved form input";
  if (isAllowlisted(tab.url, settings.allowlist)) return "site on never-sleep list";
  if (!ignoreTimeout) {
    if (!settings.enabled || !(settings.timeoutMinutes > 0)) return "sleeping disabled";
    if (typeof tab.lastAccessed !== "number") return "unknown last use";
    if (now - tab.lastAccessed < settings.timeoutMinutes * 60000) return "recently used";
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_SETTINGS, hostOf, isAllowlisted, keepAwakeReason };
}
