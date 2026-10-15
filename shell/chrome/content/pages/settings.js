/* Breached settings page. Every control writes its setting straight away;
 * the browser window watches the settings it uses and updates itself. */

"use strict";

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

const SECTIONS = [
  {
    title: "look",
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
    ],
  },
  {
    title: "start and search",
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
    title: "downloads",
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
    title: "about",
    items: [{ id: "about", type: "about" }],
  },
];

const P = Services.prefs;

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
    select.addEventListener("change", () => write(item.pref, select.value));
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

window.addEventListener("DOMContentLoaded", () => {
  let root = document.getElementById("sections");
  for (let section of SECTIONS) {
    let s = el("section", {}, el("h2", {}, section.title));
    for (let item of section.items) {
      let id = "setting-" + (item.pref ?? item.id).replace(/\W/g, "-");
      let row = BUILD[item.type](item, id);
      if (item.pref && P.prefIsLocked(item.pref)) {
        row.querySelectorAll("input, select").forEach(c => (c.disabled = true));
      }
      row.dataset.setting = item.pref ?? item.id;
      s.append(row);
    }
    root.append(s);
  }
});
