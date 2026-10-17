/* Breached settings page. Every control writes its setting straight away;
 * the browser window watches the settings it uses and updates itself. */

"use strict";

const Theme = ChromeUtils.importESModule("resource://breached/Theme.sys.mjs");
const { Mods } = ChromeUtils.importESModule("resource://breached/Mods.sys.mjs");
const Updates = ChromeUtils.importESModule("resource://breached/Updates.sys.mjs");
const Permissions = ChromeUtils.importESModule("resource://breached/Permissions.sys.mjs");

const SEARCH_ENGINES = [
  ["https://duckduckgo.com/?q=%s", "DuckDuckGo"],
  ["https://www.google.com/search?q=%s", "Google"],
  ["https://www.bing.com/search?q=%s", "Bing"],
  ["https://search.brave.com/search?q=%s", "Brave Search"],
  ["https://www.startpage.com/do/search?query=%s", "Startpage"],
  ["https://www.ecosia.org/search?q=%s", "Ecosia"],
];

// Tracker blocking levels and the Gecko settings behind them.
const TRACKING_PREFS = [
  "privacy.trackingprotection.enabled",
  "privacy.trackingprotection.socialtracking.enabled",
  "privacy.trackingprotection.emailtracking.enabled",
  "privacy.trackingprotection.fingerprinting.enabled",
  "privacy.trackingprotection.cryptomining.enabled",
  "network.cookie.cookieBehavior",
];
const TRACKING_LEVELS = {
  strict: [true, true, true, true, true, 5],
  standard: [false, true, false, true, true, 5],
  off: [false, false, false, false, false, 0],
};

// When a site asks for a permission: the values Gecko uses.
const ASK_OR_BLOCK = [
  ["0", "Ask"],
  ["2", "Block without asking"],
];

const SECTIONS = [
  {
    title: "look",
    page: "appearance",
    items: [
      {
        pref: "breached.tabs.position",
        label: "Tab bar position",
        type: "choice",
        options: [
          ["bottom", "Bottom"],
          ["top", "Top"],
        ],
      },
      {
        pref: "breached.tabs.autohide",
        label: "Hide the tab bar",
        hint: "It shows for a moment when you switch tabs, and while the command bar is open.",
        type: "bool",
      },
      {
        pref: "breached.titlebar",
        label: "Title bar",
        hint: "With Breached's own title bar, tabs on top share its row.",
        type: "choice",
        options: [
          ["custom", "Breached's own"],
          ["native", "Windows' standard one"],
        ],
      },
    ],
  },
  {
    title: "colours",
    page: "appearance",
    items: [{ id: "colors", type: "colors" }],
  },
  {
    title: "transparency",
    page: "appearance",
    items: [
      {
        pref: "breached.transparency",
        label: "See-through bars",
        hint: "Lets your desktop show through the title bar, tabs and command bar. Needs Windows 11.",
        type: "choice",
        options: [
          ["off", "Off"],
          ["mica", "Mica: tinted by your wallpaper"],
          ["acrylic", "Acrylic: blurred see-through"],
        ],
      },
      {
        pref: "breached.transparency.opacity",
        label: "Bar colour strength",
        hint: "Lower shows more of what's behind the window.",
        type: "range",
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
      },
    ],
  },
  {
    title: "start and search",
    page: "browsing",
    items: [
      {
        pref: "breached.homepage",
        label: "Home page",
        type: "choice-or-custom",
        options: [
          ["breached:home", "Breached home"],
          ["about:blank", "Blank page"],
        ],
        customLabel: "Another address…",
        placeholder: "https://example.com",
        validate: v => (/^(https?|file|about|breached):/i.test(v) ? null : "Start it with https://"),
      },
      {
        pref: "breached.newTab",
        label: "Ctrl+T opens",
        type: "choice",
        options: [
          ["home", "A new tab with the home page"],
          ["commandbar", "The command bar (:open -t)"],
        ],
      },
      {
        pref: "breached.searchUrl",
        label: "Search engine",
        hint: "Used when you type words instead of an address.",
        type: "choice-or-custom",
        options: SEARCH_ENGINES,
        customLabel: "Another search engine…",
        placeholder: "https://example.com/search?q=%s",
        validate: v =>
          !/^https?:\/\//i.test(v)
            ? "Start it with https://"
            : !v.includes("%s")
              ? "Put %s where the search words go"
              : null,
      },
      {
        pref: "breached.restoreSession",
        label: "Reopen my tabs when Breached starts",
        type: "bool",
      },
    ],
  },
  {
    title: "tabs and memory",
    page: "browsing",
    items: [
      {
        pref: "breached.tabs.unloadAfterMinutes",
        label: "Unload tabs I haven't used for",
        hint: "Minutes. Unloaded tabs keep their place and reload when you open them. 0 never unloads.",
        type: "int",
        min: 0,
        max: 1440,
      },
      {
        pref: "breached.tabs.maxAwake",
        label: "Most tabs kept loaded",
        hint: "Older tabs unload past this number. 0 means no limit.",
        type: "int",
        min: 0,
        max: 100,
      },
      {
        pref: "dom.ipc.processCount",
        label: "Processes for web pages",
        hint: "Fewer uses less memory; more keeps busy sites apart. Applies after a restart.",
        type: "int",
        min: 1,
        max: 8,
      },
    ],
  },
  {
    title: "privacy",
    page: "privacy",
    items: [
      { id: "tracking", label: "Block trackers", type: "tracking" },
      {
        pref: "dom.security.https_only_mode",
        label: "Only connect to sites over HTTPS",
        hint: "Asks before opening a site that has no secure version.",
        type: "bool",
      },
      {
        pref: "privacy.globalprivacycontrol.enabled",
        label: "Ask sites not to sell or share my data",
        type: "bool",
      },
      { id: "clear", label: "Clear browsing data", type: "clear" },
    ],
  },
  {
    title: "site permissions",
    page: "privacy",
    items: [
      {
        pref: "permissions.default.camera",
        label: "Camera",
        type: "choice",
        options: ASK_OR_BLOCK,
      },
      {
        pref: "permissions.default.microphone",
        label: "Microphone",
        type: "choice",
        options: ASK_OR_BLOCK,
      },
      {
        pref: "permissions.default.geo",
        label: "Location",
        type: "choice",
        options: ASK_OR_BLOCK,
      },
      {
        pref: "permissions.default.desktop-notification",
        label: "Notifications",
        type: "choice",
        options: ASK_OR_BLOCK,
      },
      { id: "site-permissions", label: "Saved answers", type: "site-permissions" },
    ],
  },
  {
    title: "downloads",
    page: "downloads",
    items: [
      { id: "download-dir", label: "Save files to", type: "download-dir" },
      {
        pref: "browser.download.useDownloadDir",
        label: "Save files without asking where",
        type: "bool",
      },
    ],
  },
  {
    title: "extensions",
    page: "add-ons",
    items: [{ id: "extensions", type: "extensions" }],
  },
  {
    title: "mods",
    page: "add-ons",
    items: [{ id: "mods", type: "mods" }],
  },
  {
    title: "updates",
    page: "updates",
    items: [
      { id: "updates", type: "updates" },
      {
        pref: "breached.update.autoCheck",
        label: "Check for updates once a day",
        hint: "Breached tells you in the message bar when a new version is out.",
        type: "bool",
      },
    ],
  },
  {
    title: "about",
    page: "about",
    items: [{ id: "about", type: "about" }],
  },
];

// The pages down the side, in order. Sections name theirs with "page".
const PAGES = [
  ["appearance", "Appearance"],
  ["browsing", "Browsing"],
  ["privacy", "Privacy"],
  ["downloads", "Downloads"],
  ["add-ons", "Extensions and mods"],
  ["updates", "Updates"],
  ["about", "About"],
];

const P = Services.prefs;
const shell = () => window.browsingContext.topChromeWindow?.Breached;

function read(pref) {
  switch (P.getPrefType(pref)) {
    case P.PREF_BOOL:
      return P.getBoolPref(pref);
    case P.PREF_INT:
      return P.getIntPref(pref);
    case P.PREF_STRING:
      return P.getStringPref(pref);
  }
  return undefined;
}

function write(pref, value) {
  if (typeof value == "boolean") {
    P.setBoolPref(pref, value);
  } else if (typeof value == "number") {
    P.setIntPref(pref, value);
  } else {
    P.setStringPref(pref, value);
  }
}

function el(tag, props = {}, ...children) {
  let e = document.createElement(tag);
  for (let [k, v] of Object.entries(props)) {
    if (k == "class") {
      e.className = v;
    } else if (k in e) {
      e[k] = v;
    } else {
      e.setAttribute(k, v);
    }
  }
  e.append(...children.filter(c => c != null));
  return e;
}

function labelBlock(item, forId) {
  let label = el(forId ? "label" : "div", forId ? { htmlFor: forId } : { class: "label" }, item.label);
  if (item.hint) {
    label.append(el("span", { class: "hint muted" }, item.hint));
  }
  return label;
}

function note(control) {
  let n = control.querySelector(".note") ?? el("span", { class: "note" });
  control.append(n);
  return (text, isError = false) => {
    n.textContent = text;
    n.classList.toggle("error", isError);
  };
}

const BUILD = {
  bool(item, id) {
    let box = el("input", { type: "checkbox", id, checked: !!read(item.pref) });
    box.addEventListener("change", () => write(item.pref, box.checked));
    let label = labelBlock(item, id);
    return el("div", { class: "row check" }, box, label);
  },

  choice(item, id) {
    let select = el("select", { id });
    for (let [value, text] of item.options) {
      select.append(el("option", { value }, text));
    }
    select.value = read(item.pref);
    select.addEventListener("change", () =>
      write(item.pref, P.getPrefType(item.pref) == P.PREF_INT ? Number(select.value) : select.value)
    );
    return el("div", { class: "row" }, labelBlock(item, id), el("div", { class: "control" }, select));
  },

  "choice-or-custom"(item, id) {
    let current = read(item.pref) ?? "";
    let select = el("select", { id });
    for (let [value, text] of item.options) {
      select.append(el("option", { value }, text));
    }
    select.append(el("option", { value: "" }, item.customLabel));
    let custom = el("input", { type: "text", placeholder: item.placeholder, spellcheck: false });
    let known = item.options.some(([v]) => v == current);
    select.value = known ? current : "";
    custom.value = known ? "" : current;
    custom.hidden = known;
    let control = el("div", { class: "control" }, select, custom);
    let say = note(control);
    select.addEventListener("change", () => {
      custom.hidden = select.value != "";
      if (select.value) {
        write(item.pref, select.value);
        say("");
      } else {
        custom.focus();
      }
    });
    custom.addEventListener("change", () => {
      let value = custom.value.trim();
      let problem = item.validate?.(value);
      if (problem) {
        say(problem, true);
        return;
      }
      write(item.pref, value);
      say("Saved");
    });
    return el("div", { class: "row" }, labelBlock(item, id), control);
  },

  int(item, id) {
    let input = el("input", {
      type: "number",
      id,
      min: item.min,
      max: item.max,
      step: 1,
      value: read(item.pref),
    });
    let control = el("div", { class: "control" }, input);
    let say = note(control);
    input.addEventListener("change", () => {
      let n = Number(input.value);
      if (!Number.isInteger(n) || n < item.min || n > item.max) {
        say(`Use a whole number from ${item.min} to ${item.max}`, true);
        return;
      }
      write(item.pref, n);
      say("");
    });
    return el("div", { class: "row" }, labelBlock(item, id), control);
  },

  range(item, id) {
    let input = el("input", {
      type: "range",
      id,
      min: item.min,
      max: item.max,
      step: item.step ?? 1,
      value: read(item.pref),
    });
    let shown = el("span", { class: "muted" }, `${input.value}${item.unit ?? ""}`);
    input.addEventListener("input", () => {
      shown.textContent = `${input.value}${item.unit ?? ""}`;
      write(item.pref, Number(input.value));
    });
    return el("div", { class: "row" }, labelBlock(item, id), el("div", { class: "control inline" }, input, shown));
  },

  colors() {
    let wrap = el("div", {});
    let preset = el("select", { id: "setting-color-preset" });
    for (let [name, text] of Object.entries(Theme.PRESET_NAMES)) {
      preset.append(el("option", { value: name }, text));
    }
    preset.append(el("option", { value: "" }, "Custom"));
    let pickers = {};
    let refresh = () => {
      preset.value = Theme.currentPreset() ?? "";
      for (let c of Theme.COLORS) {
        pickers[c.name].value = Theme.getColor(c.name);
      }
    };
    preset.addEventListener("change", () => {
      if (preset.value) {
        Theme.applyPreset(preset.value);
        refresh();
      }
    });
    wrap.append(
      el(
        "div",
        { class: "row" },
        labelBlock({ label: "Colour set", hint: "Pick a set, then change any colour below." }, preset.id),
        el("div", { class: "control" }, preset)
      )
    );
    for (let c of Theme.COLORS) {
      let id = "setting-color-" + c.name;
      let picker = el("input", { type: "color", id, value: Theme.getColor(c.name) });
      picker.addEventListener("input", () => {
        Theme.setColor(c.name, picker.value);
        preset.value = Theme.currentPreset() ?? "";
      });
      pickers[c.name] = picker;
      wrap.append(
        el("div", { class: "row" }, labelBlock({ label: c.label }, id), el("div", { class: "control inline" }, picker))
      );
    }
    let reset = el("button", { type: "button" }, "Reset to the default colours");
    reset.addEventListener("click", () => {
      Theme.applyPreset(Theme.DEFAULT_PRESET);
      refresh();
    });
    wrap.append(el("div", { class: "row" }, el("div", {}), el("div", { class: "control inline" }, reset)));
    refresh();
    return wrap;
  },

  tracking(item, id) {
    let select = el("select", { id });
    select.append(
      el("option", { value: "strict" }, "Strict: trackers, social and email trackers"),
      el("option", { value: "standard" }, "Standard: like Firefox's default"),
      el("option", { value: "off" }, "Off")
    );
    let values = TRACKING_PREFS.map(read);
    let level = Object.keys(TRACKING_LEVELS).find(k =>
      TRACKING_LEVELS[k].every((v, i) => v === values[i])
    );
    if (!level) {
      select.append(el("option", { value: "custom" }, "Custom"));
    }
    select.value = level ?? "custom";
    select.addEventListener("change", () => {
      let wanted = TRACKING_LEVELS[select.value];
      if (wanted) {
        TRACKING_PREFS.forEach((pref, i) => write(pref, wanted[i]));
      }
    });
    let item2 = { ...item, hint: "Built-in blocking. Reload open pages to apply." };
    return el("div", { class: "row" }, labelBlock(item2, id), el("div", { class: "control" }, select));
  },

  "site-permissions"(item) {
    let list = el("div", { class: "control", id: "site-permission-list" });
    let render = () => {
      list.textContent = "";
      let saved = Permissions.list();
      if (!saved.length) {
        list.append(el("span", { class: "muted" }, "None yet. Answer \"always\" or \"never\" when a site asks."));
      }
      for (let p of saved) {
        let forget = el("button", { type: "button", title: "Forget this answer" }, "Forget");
        forget.addEventListener("click", () => {
          Permissions.forget(p.principal, p.kind);
          render();
        });
        list.append(
          el(
            "div",
            { class: "site-permission" },
            el("span", { class: "site" }, p.host),
            el("span", { class: "muted" }, `${p.name}: ${p.allow ? "allowed" : "blocked"}`),
            forget
          )
        );
      }
    };
    render();
    let item2 = { ...item, hint: "What you told sites with \"always\" or \"never\"." };
    return el("div", { class: "row" }, labelBlock(item2), list);
  },

  clear(item) {
    const C = Ci.nsIClearDataService;
    let control = el("div", { class: "control inline" });
    let say;
    let button = (text, flags, done) => {
      let b = el("button", { type: "button" }, text);
      b.addEventListener("click", () => {
        b.disabled = true;
        Services.clearData.deleteData(flags, {
          onDataDeleted(failed) {
            b.disabled = false;
            say(failed ? "Some data couldn't be cleared" : done, !!failed);
          },
        });
      });
      return b;
    };
    control.append(
      button("History", C.CLEAR_HISTORY | C.CLEAR_DOWNLOADS, "History cleared"),
      button("Cookies and site data", C.CLEAR_COOKIES_AND_SITE_DATA, "Cookies and site data cleared"),
      button("Cache", C.CLEAR_ALL_CACHES, "Cache cleared")
    );
    let wrap = el("div", { class: "control" }, control);
    say = note(wrap);
    return el("div", { class: "row" }, labelBlock(item), wrap);
  },

  "download-dir"(item) {
    let path = el("span", {}, "…");
    let choose = el("button", { type: "button" }, "Choose…");
    let control = el("div", { class: "control" }, path, choose);
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    Downloads.getPreferredDownloadsDirectory().then(dir => (path.textContent = dir));
    choose.addEventListener("click", () => {
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Save files to", Ci.nsIFilePicker.modeGetFolder);
      fp.open(result => {
        if (result == Ci.nsIFilePicker.returnOK && fp.file) {
          P.setStringPref("browser.download.dir", fp.file.path);
          P.setIntPref("browser.download.folderList", 2);
          path.textContent = fp.file.path;
        }
      });
    });
    return el("div", { class: "row" }, labelBlock(item), control);
  },

  extensions() {
    let open = el("button", { type: "button", id: "open-extensions" }, "Manage extensions");
    open.addEventListener("click", () => shell()?.openPage("extensions"));
    return el(
      "div",
      { class: "row" },
      el(
        "div",
        { class: "label" },
        "Firefox extensions, such as uBlock Origin",
        el("span", { class: "hint muted" }, "Install from addons.mozilla.org or from a file.")
      ),
      el("div", { class: "control inline" }, open)
    );
  },

  mods(item) {
    let wrap = el("div", { id: "mods-list" });
    let render = async () => {
      let mods = await Mods.list();
      let rows = [];
      for (let mod of mods) {
        let id = "mod-" + mod.id;
        let button = el(
          "button",
          { type: "button", id: id + "-toggle" },
          mod.installed ? "Remove" : "Install"
        );
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await (mod.installed ? Mods.uninstall(mod.id) : Mods.install(mod.id));
          } catch (e) {
            button.disabled = false;
            say(e.message, true);
          }
        });
        let title = `${mod.name}${mod.version ? " " + mod.version : ""}`;
        let row = el(
          "div",
          { class: "row mod", id, "data-installed": mod.installed },
          labelBlock({ label: title, hint: mod.description }),
          el("div", { class: "control inline" }, mod.installed ? el("span", { class: "note" }, "installed") : null, button)
        );
        rows.push(row);
        if (mod.installed) {
          for (let setting of mod.settings) {
            if (!/^breached\.mods\./.test(setting.pref ?? "")) {
              continue; // mods only get their own settings
            }
            let settingId = "setting-" + setting.pref.replace(/\W/g, "-");
            let type = setting.type == "bool" ? "bool" : "text";
            let r = BUILD[type](setting, settingId);
            r.classList.add("mod-setting");
            rows.push(r);
          }
        }
      }
      if (!mods.length) {
        rows.push(el("p", { class: "muted" }, "No mods yet."));
      }
      wrap.replaceChildren(...rows);
    };
    let add = el("button", { type: "button", id: "mod-add" }, "Add a mod from a folder…");
    add.addEventListener("click", () => {
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Choose a mod folder", Ci.nsIFilePicker.modeGetFolder);
      fp.open(async result => {
        if (result == Ci.nsIFilePicker.returnOK && fp.file) {
          try {
            let mod = await Mods.installFromFolder(fp.file.path);
            say(`${mod.name} installed`);
          } catch (e) {
            say(e.message, true);
          }
        }
      });
    });
    let addControl = el("div", { class: "control" }, add);
    let say = note(addControl);
    let observer = () => render();
    P.addObserver("breached.mods.installed", observer);
    window.addEventListener("unload", () => P.removeObserver("breached.mods.installed", observer));
    render();
    return el(
      "div",
      {},
      el(
        "p",
        { class: "hint muted" },
        "Mods add optional features to Breached. They run with the browser's full access, so only add mods you trust."
      ),
      wrap,
      el("div", { class: "row" }, el("div", {}), addControl)
    );
  },

  text(item, id) {
    let input = el("input", { type: "text", id, spellcheck: false, placeholder: item.placeholder ?? "" });
    input.value = read(item.pref) ?? "";
    input.addEventListener("change", () => write(item.pref, input.value.trim()));
    return el("div", { class: "row" }, labelBlock(item, id), el("div", { class: "control" }, input));
  },

  updates() {
    let current = shell()?.version ?? "";
    let status = el("span", { id: "update-status", class: "hint muted" }, `You have Breached ${current}.`);
    let checkButton = el("button", { type: "button", id: "update-check" }, "Check for updates");
    let installButton = el("button", { type: "button", id: "update-install", hidden: true }, "Download and install");
    let pageButton = el("button", { type: "button", id: "update-page", hidden: true }, "Open the release page");
    let found = null;
    let say = (text, isError = false) => {
      status.textContent = text;
      status.classList.toggle("error", isError);
    };
    checkButton.addEventListener("click", async () => {
      checkButton.disabled = true;
      installButton.hidden = pageButton.hidden = true;
      say("Checking GitHub…");
      try {
        found = await Updates.check(window.fetch.bind(window), current);
        if (!found) {
          say(`You have the newest version (${current}).`);
        } else if (Updates.isInstalled() && found.installer) {
          say(`Breached ${found.version} is out.`);
          installButton.hidden = false;
          pageButton.hidden = false;
        } else {
          say(`Breached ${found.version} is out. This copy isn't installed, so get it from the release page.`);
          pageButton.hidden = false;
        }
      } catch (e) {
        say(`Couldn't check: ${e.message}`, true);
      } finally {
        checkButton.disabled = false;
      }
    });
    pageButton.addEventListener("click", () => found && shell()?.openTab(found.url));
    installButton.addEventListener("click", async () => {
      installButton.disabled = checkButton.disabled = true;
      try {
        let path = await Updates.download(window.fetch.bind(window), found, f =>
          say(`Downloading Breached ${found.version}… ${Math.round(f * 100)}%`)
        );
        say("Installing. Breached will close and start again.");
        Updates.install(path);
      } catch (e) {
        say(`Couldn't update: ${e.message}`, true);
        installButton.disabled = checkButton.disabled = false;
      }
    });
    if (location.hash == "#updates" && shell()?._checkUpdatesOnOpen) {
      shell()._checkUpdatesOnOpen = false;
      setTimeout(() => checkButton.click(), 0);
    }
    return el(
      "div",
      { class: "row" },
      el("div", { class: "label" }, "Updates come from Breached's releases on GitHub", status),
      el("div", { class: "control inline" }, checkButton, installButton, pageButton)
    );
  },

  about() {
    let version = window.browsingContext.topChromeWindow?.Breached?.version ?? "";
    let profile = Services.dirsvc.get("ProfD", Ci.nsIFile);
    let open = el("button", { type: "button" }, "Open profile folder");
    open.addEventListener("click", () => {
      try {
        profile.reveal();
      } catch (e) {
        profile.launch();
      }
    });
    return el(
      "div",
      { class: "row" },
      el(
        "div",
        { class: "label" },
        `Breached ${version} on Gecko ${Services.appinfo.platformVersion}`,
        el("span", { class: "hint muted" }, profile.path)
      ),
      el("div", { class: "control inline" }, open)
    );
  },
};

// :mods or :update while settings is already open only changes the hash.
window.addEventListener("hashchange", () => {
  let name = location.hash.slice(1);
  let target = document.getElementById(name);
  let page = target?.closest(".page")?.dataset.page;
  if (page) {
    showPage(page);
    if (target.localName == "section") {
      target.scrollIntoView();
    }
  }
  if (name == "updates" && shell()?._checkUpdatesOnOpen) {
    shell()._checkUpdatesOnOpen = false;
    document.getElementById("update-check")?.click();
  }
});

function showPage(name) {
  for (let page of document.querySelectorAll(".page")) {
    page.hidden = page.dataset.page != name;
  }
  for (let link of document.querySelectorAll("#nav button")) {
    link.toggleAttribute("selected", link.dataset.page == name);
  }
  document.documentElement.scrollTop = 0;
}

window.addEventListener("DOMContentLoaded", () => {
  let nav = document.getElementById("nav");
  let root = document.getElementById("sections");
  let pages = {};
  for (let [name, title] of PAGES) {
    let button = el("button", { type: "button", id: "nav-" + name }, title);
    button.dataset.page = name;
    button.addEventListener("click", () => {
      history.replaceState(null, "", "#" + name);
      showPage(name);
    });
    nav.append(button);
    pages[name] = el("div", { class: "page", id: "page-" + name }, el("h2", { class: "page-title" }, title));
    pages[name].dataset.page = name;
    root.append(pages[name]);
  }
  for (let section of SECTIONS) {
    let s = el("section", { id: section.title.replace(/\W+/g, "-") }, el("h3", {}, section.title));
    for (let item of section.items) {
      let id = "setting-" + (item.pref ?? item.id).replace(/\W/g, "-");
      let row = BUILD[item.type](item, id);
      if (item.pref && P.prefIsLocked(item.pref)) {
        row.querySelectorAll("input, select").forEach(c => (c.disabled = true));
      }
      row.dataset.setting = item.pref ?? item.id;
      s.append(row);
    }
    pages[section.page].append(s);
  }
  // "#mods" names a section, "#updates" a page: show the page holding it.
  let target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  let page = target?.closest(".page")?.dataset.page ?? (pages[location.hash.slice(1)] ? location.hash.slice(1) : PAGES[0][0]);
  showPage(page);
  if (target && target.localName == "section") {
    target.scrollIntoView();
  }
});
