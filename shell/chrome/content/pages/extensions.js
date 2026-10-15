/* Breached extensions page: installed Firefox extensions, with on/off,
 * options, popup and remove, plus installing from AMO or a file. */

"use strict";

const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");

function say(text, isError = false) {
  let p = document.getElementById("say");
  p.textContent = text;
  p.style.color = isError ? "var(--error)" : "";
}

async function render() {
  let addons = (await AddonManager.getAddonsByTypes(["extension"])).filter(a => !a.isBuiltin && !a.hidden);
  addons.sort((a, b) => a.name.localeCompare(b.name));
  let rows = addons.map(addon => {
    let button = (text, title, fn) =>
      el("button", { type: "button", title, class: "action-" + text.replace(/\W+/g, "-"), onclick: () => Promise.resolve().then(fn).catch(e => say(e.message, true)) }, text);
    let actions = [];
    if (addon.isActive) {
      actions.push(button("popup", "Open its popup (like :ext)", () => shell()?.run("ext " + addon.id)));
      if (addon.optionsURL) {
        actions.push(button("options", "Its settings", () => shell()?.openTab(addon.optionsURL, { afterCurrent: true })));
      }
    }
    actions.push(
      addon.userDisabled
        ? button("turn on", "Turn it back on", () => addon.enable())
        : button("turn off", "Turn it off without removing it", () => addon.disable())
    );
    let remove = button("remove", "Uninstall", () => {});
    confirmButton(remove, "click again to remove", () => addon.uninstall().catch(e => say(e.message, true)));
    actions.push(remove);
    let icon = el("img", { src: addon.iconURL || "chrome://mozapps/skin/extensions/extensionGeneric.svg", width: 16, height: 16, alt: "" });
    return el(
      "li",
      { class: "extension", "data-id": addon.id },
      icon,
      el(
        "span",
        { class: "main" },
        el("span", {}, addon.name),
        el("span", { class: "sub" }, `  ${addon.version}${addon.isActive ? "" : "  (off)"}`),
        addon.description ? el("br") : null,
        addon.description ? el("span", { class: "sub" }, addon.description) : null
      ),
      el("span", { class: "actions" }, ...actions)
    );
  });
  document.getElementById("list").replaceChildren(...rows);
  document.getElementById("empty").hidden = rows.length > 0;
}

const listener = {
  onEnabled: render,
  onDisabled: render,
  onInstalled: render,
  onUninstalled: render,
  onOperationCancelled: render,
};

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("get").addEventListener("click", () => {
    shell()?.openTab("https://addons.mozilla.org/firefox/extensions/", { afterCurrent: true });
  });
  document.getElementById("install-file").addEventListener("click", () => {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, "Install an extension", Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("Extensions (*.xpi)", "*.xpi");
    fp.open(result => {
      if (result == Ci.nsIFilePicker.returnOK && fp.file) {
        let win = window.browsingContext.topChromeWindow;
        win.Addons.installFile(fp.file, window.browsingContext.top.embedderElement).catch(e => say(e.message, true));
      }
    });
  });
  AddonManager.addAddonListener(listener);
  window.addEventListener("unload", () => AddonManager.removeAddonListener(listener));
  render();
});
