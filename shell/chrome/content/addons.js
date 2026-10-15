/* Firefox extensions in Breached: install prompts (asked in the command
 * bar), install messages, and the ":ext" command. The extension APIs
 * themselves are in extensions/ (ext-breached.json). */

"use strict";

var Addons = {
  AddonManager: null,

  TOPICS: [
    "webextension-permission-prompt",
    "webextension-optional-permission-prompt",
    "webextension-install-notify",
    "addon-install-blocked",
    "addon-install-origin-blocked",
    "addon-install-disabled",
    "addon-install-policy-blocked",
    "addon-install-webapi-blocked",
    "addon-install-failed",
  ],

  init() {
    this.AddonManager = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
    for (let topic of this.TOPICS) {
      Services.obs.addObserver(this, topic);
    }
  },

  uninit() {
    for (let topic of this.TOPICS) {
      Services.obs.removeObserver(this, topic);
    }
  },

  /** Is a yes/no question's answer a yes? */
  async ask(question) {
    let answer = await Breached.prompt(question + " [y/N]:");
    return /^\s*y(es)?\s*$/i.test(answer ?? "");
  },

  /** "read and change your data on all websites, read your history" etc. */
  describePermissions(perms) {
    let parts = [];
    let origins = perms?.origins ?? [];
    if (origins.some(o => o == "<all_urls>" || /^\*:\/\/\*\//.test(o) || /^https?:\/\/\*\/\*$/.test(o))) {
      parts.push("all websites");
    } else if (origins.length) {
      let hosts = origins.map(o => o.replace(/^[^:]+:\/\//, "").replace(/\/.*$/, ""));
      parts.push(hosts.length > 3 ? `${hosts.slice(0, 3).join(", ")} and ${hosts.length - 3} more sites` : hosts.join(", "));
    }
    let named = (perms?.permissions ?? []).filter(p =>
      ["tabs", "history", "downloads", "bookmarks", "nativeMessaging", "privacy", "proxy", "management", "clipboardRead", "webNavigation"].includes(p)
    );
    parts.push(...named);
    return parts.length ? "uses " + parts.join(", ") : "needs no special access";
  },

  observe(subject, topic) {
    let data = subject?.wrappedJSObject;
    switch (topic) {
      case "webextension-permission-prompt": {
        let { info } = data;
        let name = info.addon?.name ?? "this extension";
        this.ask(`add ${name}? It ${this.describePermissions(info.permissions)}.`).then(yes => {
          if (yes) {
            info.resolve();
          } else {
            info.reject();
            Breached.showMessage(`${name} wasn't added`);
          }
        });
        break;
      }
      case "webextension-optional-permission-prompt":
        this.ask(`let ${data.name} use more? It ${this.describePermissions(data.permissions)}.`).then(yes =>
          data.resolve(yes)
        );
        break;
      case "webextension-install-notify":
        Breached.showMessage(`Added ${data.addon?.name ?? "the extension"}`);
        break;
      case "addon-install-blocked": {
        let host = data.originatingURI?.host || "this site";
        this.ask(`let ${host} install an extension?`).then(yes => (yes ? data.install() : data.cancel?.()));
        break;
      }
      case "addon-install-origin-blocked":
      case "addon-install-policy-blocked":
      case "addon-install-webapi-blocked":
        Breached.showMessage("This site isn't allowed to install extensions", "error");
        break;
      case "addon-install-disabled":
        Breached.showMessage("Installing extensions is turned off", "error");
        break;
      case "addon-install-failed": {
        let install = data.installs?.[0];
        let name = install?.addon?.name ?? install?.name ?? "The extension";
        Breached.showMessage(`${name} couldn't be installed (error ${install?.error ?? "?"})`, "error");
        break;
      }
    }
  },

  /** Installs an .xpi file the user picked. */
  async installFile(file, browser = Breached.selectedBrowser) {
    let install = await this.AddonManager.getInstallForFile(file, null, { source: "file-url" });
    if (install.error) {
      throw new Error(`not a valid extension (error ${install.error})`);
    }
    let docURI = browser?.currentURI ?? Services.io.newURI("chrome://breached/content/pages/extensions.html");
    this.AddonManager.installAddonFromAOM(browser, docURI, install);
  },

  /** Extensions, for the extensions page and ":ext". */
  async list() {
    let addons = await this.AddonManager.getAddonsByTypes(["extension"]);
    return addons.filter(a => !a.isBuiltin && !a.hidden);
  },

  /** Clicks an extension's button (opens its popup), found by name or id. */
  async openPopup(query) {
    let addons = await this.list();
    let q = query.toLowerCase();
    let addon =
      addons.find(a => a.id.toLowerCase() == q) ??
      addons.find(a => a.name.toLowerCase() == q) ??
      addons.find(a => a.name.toLowerCase().startsWith(q)) ??
      addons.find(a => a.name.toLowerCase().includes(q));
    if (!addon) {
      throw new Error(`no extension called ${query}`);
    }
    let id = "ext-button-" + addon.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    let button = document.getElementById(id);
    if (!button) {
      throw new Error(`${addon.name} has no button`);
    }
    button.click();
  },
};

Commands.ext = {
  usage: "ext <name>  (open an extension's popup, e.g. :ext ublock)",
  run(args) {
    if (!args) {
      Breached.openPage("extensions");
      return;
    }
    Addons.openPopup(args).catch(e => Breached.showMessage(`ext: ${e.message}`, "error"));
  },
};
