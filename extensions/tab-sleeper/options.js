"use strict";
/* global DEFAULT_SETTINGS */

(async () => {
  const s = { ...DEFAULT_SETTINGS, ...(await browser.storage.local.get(DEFAULT_SETTINGS)) };
  const $ = id => document.getElementById(id);
  $("enabled").checked = s.enabled;
  $("timeoutMinutes").value = s.timeoutMinutes;
  $("protectPinned").checked = s.protectPinned;
  $("allowlist").value = s.allowlist.join("\n");

  const save = () => {
    const minutes = Math.round(Number($("timeoutMinutes").value));
    browser.storage.local.set({
      enabled: $("enabled").checked,
      timeoutMinutes: minutes > 0 ? minutes : DEFAULT_SETTINGS.timeoutMinutes,
      protectPinned: $("protectPinned").checked,
      allowlist: $("allowlist").value.split(/\s+/).map(h => h.trim().toLowerCase()).filter(Boolean),
    });
  };
  for (const id of ["enabled", "timeoutMinutes", "protectPinned", "allowlist"]) {
    $(id).addEventListener("change", save);
  }
})();
