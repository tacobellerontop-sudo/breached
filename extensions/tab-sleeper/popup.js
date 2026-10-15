"use strict";

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const host = (() => { try { return new URL(tab.url).hostname; } catch { return ""; } })();

  async function render() {
    const { settings, asleepCount } = await browser.runtime.sendMessage({ type: "status", tab });
    document.getElementById("count").textContent =
      asleepCount === 1 ? "1 tab asleep" : `${asleepCount} tabs asleep`;
    document.getElementById("this-tab").textContent = settings.enabled
      ? `Background tabs sleep after ${settings.timeoutMinutes} min.`
      : "Automatic sleeping is off.";
    const toggle = document.getElementById("toggle-site");
    const listed = settings.allowlist.includes(host);
    toggle.hidden = !/^https?:/.test(tab.url || "");
    toggle.textContent = listed ? `Allow ${host} to sleep` : `Never sleep ${host}`;
    toggle.onclick = async () => {
      const allowlist = listed
        ? settings.allowlist.filter(h => h !== host)
        : [...settings.allowlist, host];
      await browser.storage.local.set({ allowlist });
      render();
    };
  }

  document.getElementById("sleep-others").onclick = async () => {
    await browser.runtime.sendMessage({ type: "sleep-others", windowId: tab.windowId });
    render();
  };
  document.getElementById("options").onclick = e => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  };
  render();
})();
