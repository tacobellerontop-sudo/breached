/* Breached: the browser window.
 *
 * A tab bar, web pages, and a ":" command bar at the bottom, in the spirit of
 * qutebrowser. Everything here runs on plain Gecko: it uses toolkit pieces
 * (remote <browser> elements, toolkit actors, session history) and none of
 * Firefox's browser/ front end.
 */

"use strict";

const { E10SUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/E10SUtils.sys.mjs"
);
const Theme = ChromeUtils.importESModule("resource://breached/Theme.sys.mjs");
const Permissions = ChromeUtils.importESModule("resource://breached/Permissions.sys.mjs");
const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
const { SessionHistory } = ChromeUtils.importESModule(
  "resource://gre/modules/sessionstore/SessionHistory.sys.mjs"
);
// Registers toolkit's page helpers (find, forms, autocomplete, select
// dropdowns, date pickers, error pages, printing...). Safe to import twice.
ChromeUtils.importESModule("resource://gre/modules/ActorManagerParent.sys.mjs");

const PREF = "breached.";
const SESSION_FILE = "breached-session.json";
const MESSAGE_MS = 4000;
const PEEK_MS = 1500;
const BREACHED_VERSION = "0.1.9";

// Breached's own pages, shown as breached:<name> in the tab and command bar.
const PAGES = {
  "breached:home": "chrome://breached/content/pages/home.html",
  "breached:settings": "chrome://breached/content/pages/settings.html",
  "breached:history": "chrome://breached/content/pages/history.html",
  "breached:downloads": "chrome://breached/content/pages/downloads.html",
  "breached:extensions": "chrome://breached/content/pages/extensions.html",
};

/** The address to load for a breached: page, or the address itself. */
function realURL(url) {
  let [page, hash] = url.split("#", 2);
  return PAGES[page] ? PAGES[page] + (hash ? "#" + hash : "") : url;
}

/** The breached: name for one of our pages, or the address itself. */
function displayURL(spec) {
  let [page, hash] = spec.split("#", 2);
  for (let [name, real] of Object.entries(PAGES)) {
    if (page == real) {
      return name + (hash ? "#" + hash : "");
    }
  }
  return spec;
}

/** "https://host/path/*" for the mods site (breached.mods.site). */
function modsSitePattern() {
  try {
    let site = Services.io.newURI(Services.prefs.getStringPref("breached.mods.site", ""));
    return `${site.scheme}://${site.host}${site.filePath.replace(/\/?$/, "/")}*`;
  } catch (e) {
    return "https://invalid.invalid/*";
  }
}

/** Our own page helpers, registered once per app run. */
function registerActors() {
  const actors = {
    Breached: {
      parent: { esModuleURI: "resource://breached/BreachedParent.sys.mjs" },
      child: {
        esModuleURI: "resource://breached/BreachedChild.sys.mjs",
        events: {
          keydown: { capture: true },
          mousedown: { capture: true },
          click: { capture: true },
          auxclick: { capture: true },
          // After the page's own handlers, to see whether it showed its own menu.
          contextmenu: { mozSystemGroup: true },
        },
      },
      allFrames: true,
      messageManagerGroups: ["browsers"],
      // Allowed in the processes that run web pages.
      safeForUntrustedWebProcess: true,
    },
    // Reader view: finding the article in a page (made on demand)...
    BreachedReader: {
      parent: { esModuleURI: "resource://breached/ReaderParent.sys.mjs" },
      child: { esModuleURI: "resource://breached/ReaderChild.sys.mjs" },
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    },
    // ...and showing it in Gecko's about:reader page.
    BreachedReaderView: {
      parent: { esModuleURI: "resource://breached/ReaderParent.sys.mjs" },
      child: {
        esModuleURI: "resource://breached/ReaderChild.sys.mjs",
        events: { DOMContentLoaded: {} },
      },
      matches: ["about:reader*"],
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    },
    // The mods site's Install buttons (only on that site).
    BreachedModsSite: {
      parent: { esModuleURI: "resource://breached/ModsSiteParent.sys.mjs" },
      child: {
        esModuleURI: "resource://breached/ModsSiteChild.sys.mjs",
        events: { DOMContentLoaded: {}, click: { capture: true } },
      },
      // Match patterns have no port; ModsSiteParent checks the whole address.
      matches: [modsSitePattern()],
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    },
    // Page fullscreen (video players), copied from Firefox.
    DOMFullscreen: {
      parent: { esModuleURI: "resource://breached/DOMFullscreenParent.sys.mjs" },
      child: {
        esModuleURI: "resource://breached/DOMFullscreenChild.sys.mjs",
        events: {
          "MozDOMFullscreen:Request": {},
          "MozDOMFullscreen:Entered": {},
          "MozDOMFullscreen:NewOrigin": {},
          "MozDOMFullscreen:Exit": {},
          "MozDOMFullscreen:Exited": {},
          "MozDOMFullscreen:WarnAboutKeyboardLock": {},
          "MozDOMFullscreen:UpdateKeyboardLock": {},
        },
      },
      allFrames: true,
      messageManagerGroups: ["browsers"],
      // Allowed in the processes that run web pages.
      safeForUntrustedWebProcess: true,
    },
  };
  for (let [name, options] of Object.entries(actors)) {
    try {
      ChromeUtils.registerWindowActor(name, options);
    } catch (e) {
      // Already registered by an earlier window.
      if (!/already registered/i.test(e.message)) {
        console.error(`Breached: registering ${name}`, e);
      }
    }
  }
}

/** One tab: its bar entry and, while awake, its <browser>. */
class Tab {
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "tab";
    this.el.setAttribute("role", "tab");
    this.labelEl = document.createElement("span");
    this.labelEl.className = "tab-label";
    this.el.append(this.labelEl);
    this.el.tab = this;
    this.browser = null;
    this.url = "about:blank";
    this.title = "";
    this.history = null; // saved session history while asleep
    this.lastActive = Date.now();
    this.pinned = false;
    this.opener = null; // the Tab that opened this one, if any
    this.capture = new Map(); // page window id -> { camera, microphone, screen }
  }

  /** "camera and microphone" while the page uses them, else "". */
  get recording() {
    let using = new Set();
    for (let state of this.capture.values()) {
      for (let kind of ["camera", "microphone", "screen"]) {
        if (state[kind]) {
          using.add(kind == "screen" ? "screen sharing" : kind);
        }
      }
    }
    return [...using].join(" and ");
  }

  get asleep() {
    return !this.browser;
  }

  get index() {
    return Breached.tabs.indexOf(this);
  }

  get selected() {
    return Breached.selected === this;
  }

  get busy() {
    return this.el.hasAttribute("busy");
  }

  // For Gecko's extension code, which expects these names.
  get linkedBrowser() {
    return this.browser ?? { browsingContext: null };
  }

  get label() {
    return this.title || this.url;
  }

  get documentGlobal() {
    return window;
  }

  update() {
    this.labelEl.textContent = this.title || this.url;
    let recording = this.recording;
    this.el.toggleAttribute("recording", !!recording);
    this.el.title = recording ? `${this.url}\nUsing your ${recording}` : this.url;
    this.el.toggleAttribute("asleep", this.asleep);
    this.el.toggleAttribute("pinned", this.pinned);
  }
}

var Breached = {
  version: BREACHED_VERSION,
  // The window's mod host (mods.js), for modules that only see Breached.
  get mods() {
    return ModHost;
  },
  tabs: [],
  selected: null,
  closed: [], // for :undo
  history: [], // command line history
  historyIndex: -1,
  _messageTimer: null,
  _peekTimer: null,
  _saveTimer: null,
  // Listeners told about every tab's page loads, like Firefox's
  // gBrowser.addTabsProgressListener (extensions use this).
  tabsProgressListeners: new Set(),

  /** Fires "Breached:<type>" on the window, for extensions and mods. */
  emit(type, detail) {
    window.dispatchEvent(new CustomEvent("Breached:" + type, { detail }));
  },

  _tellTabsProgressListeners(method, browser, ...args) {
    for (let l of this.tabsProgressListeners) {
      try {
        l[method]?.(browser, ...args);
      } catch (e) {
        console.error(e);
      }
    }
  },

  get $tabbar() {
    return document.getElementById("tabbar");
  },
  get $content() {
    return document.getElementById("content");
  },
  get $commandbar() {
    return document.getElementById("commandbar");
  },
  get $commandline() {
    return document.getElementById("commandline");
  },
  get selectedBrowser() {
    return this.selected?.browser ?? null;
  },

  pref(name, fallback) {
    let full = PREF + name;
    switch (Services.prefs.getPrefType(full)) {
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(full);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(full);
      case Services.prefs.PREF_STRING:
        return Services.prefs.getStringPref(full);
    }
    return fallback;
  },

  // ---------------------------------------------------------------- startup

  init() {
    // A private window keeps no history, cookies or cache once it closes,
    // and saves no session.
    this.isPrivate = PrivateBrowsingUtils.isWindowPrivate(window) || !!this.windowArgs().private;
    if (this.isPrivate) {
      document.documentElement.setAttribute("private", "true");
    }
    registerActors();
    Permissions.init();
    window.browserDOMWindow = BrowserDOMWindow;
    this.applyLayout();
    Services.prefs.addObserver(PREF, this);
    this.applyTheme();
    this.initTitlebar();

    this.$tabbar.addEventListener("mousedown", this);
    this.$tabbar.addEventListener("auxclick", this);
    document.getElementById("nav-back").addEventListener("click", () => this.run("back"));
    document.getElementById("nav-forward").addEventListener("click", () => this.run("forward"));
    this.$commandline.addEventListener("input", this);
    this.$commandline.addEventListener("blur", this);
    window.addEventListener("keydown", this, true);
    window.addEventListener("MozDOMFullscreen:Entered", this, true);
    window.addEventListener("MozDOMFullscreen:Exited", this, true);
    window.addEventListener("unload", this);
    Keys.install();
    Downloads.watch();
    ModHost.init();
    Addons.init();

    let restored = !this.isPrivate && this.pref("restoreSession", true) && this.restoreSession();
    let urls = this.commandLineURLs();
    for (let url of urls) {
      this.openTab(url);
    }
    if (!restored && !urls.length) {
      this.openTab(this.homepage());
    }

    this._unloadTimer = setInterval(() => this.unloadIdleTabs(), 60 * 1000);

    let selftest = Services.env.get("BREACHED_SELFTEST");
    if (selftest && !this.isPrivate) {
      Services.scriptloader.loadSubScript("chrome://breached/content/selftest.js", window);
      window.SelfTest.run(selftest);
    } else if (!this.isPrivate) {
      setTimeout(() => this.autoCheckForUpdates(), 30 * 1000);
    }
  },

  /** The daily look at GitHub for a newer Breached (settings > updates). */
  async autoCheckForUpdates() {
    let Updates = ChromeUtils.importESModule("resource://breached/Updates.sys.mjs");
    if (!Updates.autoCheckDue()) {
      return;
    }
    try {
      let release = await Updates.check(window.fetch.bind(window), BREACHED_VERSION);
      if (release) {
        this.showMessage(`Breached ${release.version} is out. Type :update to get it.`);
      }
    } catch (e) {
      console.warn("Breached update check:", e);
    }
  },

  homepage() {
    return this.pref("homepage", "breached:home") || "about:blank";
  },

  /** Ctrl+T: the home page, or the command bar if that's the setting. */
  newTab() {
    if (this.pref("newTab", "home") == "commandbar") {
      this.openCommandLine("open -t ");
    } else {
      this.openTab(this.homepage());
    }
  },

  /** Shows one of our pages (breached:<name>), reusing an open one. */
  openPage(name, hash = "") {
    let page = "breached:" + name;
    let url = hash ? page + "#" + hash : page;
    let tab = this.tabs.find(t => t.url?.split("#")[0] == page);
    if (!tab) {
      return this.openTab(url, { afterCurrent: true });
    }
    this.selectTab(tab);
    if (hash && tab.url != url) {
      tab.url = url;
      this.load(tab.browser, url);
    }
    return tab;
  },

  openSettings(hash) {
    return this.openPage("settings", hash);
  },

  /** Opens a private window, showing url (or the home page). */
  openPrivateWindow(url) {
    let arg = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
    arg.data = JSON.stringify({ url: url || this.homepage(), private: true });
    return Services.ww.openWindow(null, window.location.href, "_blank", "chrome,all,dialog=no,private", arg);
  },

  /** What openPrivateWindow passed: { url, private }. */
  windowArgs() {
    let arg = window.arguments?.[0];
    try {
      // The window watcher hands a string argument over as a JS string.
      return JSON.parse(typeof arg == "string" ? arg : arg.QueryInterface(Ci.nsISupportsString).data);
    } catch (e) {
      return {};
    }
  },

  /** URLs passed on the command line ("breached.bat https://...") */
  commandLineURLs() {
    let urls = [];
    let opened = this.windowArgs().url;
    if (opened) {
      return [opened];
    }
    let cmdLine = window.arguments?.[0];
    try {
      cmdLine = cmdLine?.QueryInterface(Ci.nsICommandLine);
    } catch (e) {
      return urls;
    }
    if (!cmdLine) {
      return urls;
    }
    for (let i = 0; i < cmdLine.length; i++) {
      let arg = cmdLine.getArgument(i);
      if (!arg.startsWith("-") && (arg.includes("://") || arg.startsWith("about:"))) {
        urls.push(arg);
      }
    }
    return urls;
  },

  uninit() {
    clearInterval(this._unloadTimer);
    Services.prefs.removeObserver(PREF, this);
    Downloads.unwatch();
    ModHost.uninit();
    Addons.uninit();
    this.saveSessionNow();
  },

  // -------------------------------------------------------------- layout

  applyLayout() {
    let root = document.documentElement;
    let position = this.pref("tabs.position", "bottom");
    if (!["top", "bottom", "left", "right"].includes(position)) {
      position = "bottom";
    }
    let autohide = this.pref("tabs.autohide", false);
    let custom = this.pref("titlebar", "custom") != "native";
    root.setAttribute("tabs-position", position);
    root.toggleAttribute("tabs-vertical", position == "left" || position == "right");
    root.toggleAttribute("tabs-autohide", autohide);
    // A hidden tab bar shows while the mouse is at its edge of the window.
    root.toggleAttribute("tabs-hover-edge", autohide && this.pref("tabs.showOnHover", true));
    root.toggleAttribute("customtitlebar", custom);
    root.toggleAttribute("nav-buttons", this.pref("tabs.navButtons", true));
    // Tabs on top share the row with our title bar.
    let titlebarRow = document.getElementById("titlebar-content");
    let inTitlebar = custom && position == "top" && !autohide;
    if (inTitlebar && this.$tabbar.parentNode != titlebarRow) {
      titlebarRow.prepend(this.$tabbar);
    } else if (!inTitlebar && this.$tabbar.parentNode == titlebarRow) {
      this.$content.before(this.$tabbar);
    }
    // Extension buttons: in our title bar, or else at the end of the tab bar.
    let extButtons = document.getElementById("ext-buttons");
    if (custom) {
      titlebarRow.after(extButtons);
    } else {
      this.$tabbar.append(extButtons);
    }
  },

  /** Colours and see-through bars, from the settings. */
  applyTheme() {
    let root = document.documentElement;
    Theme.applyColors(root);
    let mode = this.pref("transparency", "off");
    let see = mode == "mica" || mode == "acrylic";
    let opacity = Math.max(0, Math.min(100, this.pref("transparency.opacity", 60)));
    root.style.setProperty("--transparency-opacity", opacity + "%");
    root.toggleAttribute("transparency", see);
    // Gecko's Windows 11 backdrop: 1 is Mica, 2 is Acrylic.
    if (Services.prefs.getBoolPref("widget.windows.mica", false) != see) {
      Services.prefs.setBoolPref("widget.windows.mica", see);
    }
    if (see) {
      let backdrop = mode == "acrylic" ? 2 : 1;
      if (Services.prefs.getIntPref("widget.windows.mica.toplevel-backdrop", 0) != backdrop) {
        Services.prefs.setIntPref("widget.windows.mica.toplevel-backdrop", backdrop);
      }
    }
  },

  initTitlebar() {
    let buttons = {
      "titlebar-min": () => window.minimize(),
      "titlebar-max": () => window.maximize(),
      "titlebar-restore": () => window.restore(),
      "titlebar-close": () => window.close(),
    };
    for (let [id, action] of Object.entries(buttons)) {
      document.getElementById(id).addEventListener("click", action);
    }
    let updateSizeMode = () => {
      let mode = {
        [window.STATE_MAXIMIZED]: "maximized",
        [window.STATE_MINIMIZED]: "minimized",
        [window.STATE_FULLSCREEN]: "fullscreen",
      }[window.windowState] ?? "normal";
      document.documentElement.setAttribute("sizemode", mode);
    };
    window.addEventListener("sizemodechange", updateSizeMode);
    updateSizeMode();
  },

  observe(subject, topic, data) {
    if (topic == "nsPref:changed") {
      if (data.startsWith(PREF + "colors.") || data.startsWith(PREF + "transparency")) {
        this.applyTheme();
      } else if (data.startsWith(PREF + "mods.") || data.startsWith(PREF + "zoom.")) {
        // mods.js watches mods.*; zoom.* is SiteZoom's
      } else {
        this.applyLayout();
      }
    }
  },

  /** Greys out back and forward in the tab bar when there's nowhere to go. */
  updateNavButtons() {
    let b = this.selectedBrowser;
    document.getElementById("nav-back").disabled = !b?.canGoBack;
    document.getElementById("nav-forward").disabled = !b?.canGoForward;
  },

  /** With an auto-hiding tab bar, show it briefly (tab switches). */
  peekTabs() {
    let root = document.documentElement;
    if (!root.hasAttribute("tabs-autohide")) {
      return;
    }
    root.setAttribute("tabs-peek", "true");
    clearTimeout(this._peekTimer);
    this._peekTimer = setTimeout(() => root.removeAttribute("tabs-peek"), PEEK_MS);
  },

  updateTitle() {
    let tab = this.selected;
    let name = this.isPrivate ? "Breached (private)" : "Breached";
    document.title = tab ? `${tab.title || tab.url} - ${name}` : name;
    document.getElementById("titlebar-title").textContent = document.title;
  },

  // -------------------------------------------------------------- browsers

  createBrowser({ remoteType, openWindowInfo, name, skipLoad = true } = {}) {
    let b = document.createXULElement("browser");
    b.permanentKey = new (Cu.getGlobalForObject(Services).Object)();
    for (let [attr, value] of Object.entries({
      type: "content",
      message: "true",
      messagemanagergroup: "browsers",
      manualactiveness: "true",
      maychangeremoteness: "true",
      autocompletepopup: "PopupAutoComplete",
    })) {
      b.setAttribute(attr, value);
    }
    if (remoteType && remoteType != E10SUtils.NOT_REMOTE) {
      b.setAttribute("remote", "true");
      b.setAttribute("remoteType", remoteType);
    }
    if (openWindowInfo) {
      b.openWindowInfo = openWindowInfo;
    }
    if (name) {
      b.setAttribute("name", name);
    }
    if (skipLoad) {
      b.setAttribute("nodefaultsrc", "true");
    }
    return b;
  },

  remoteTypeFor(url, preferredRemoteType) {
    return ChromeUtils.predictRemoteTypeForURI(url, {
      window,
      preferredRemoteType,
    });
  },

  /** Gives a sleeping tab its <browser> back. */
  attachBrowser(tab, { url, openWindowInfo, openerBrowser, name } = {}) {
    let remoteType = openWindowInfo && !openWindowInfo.isRemote
      ? E10SUtils.NOT_REMOTE
      : this.remoteTypeFor(realURL(url || tab.url), openerBrowser?.remoteType);
    let b = this.createBrowser({ remoteType, openWindowInfo, name });
    tab.browser = b;
    b.tab = tab;
    this.$content.append(b);
    this.listen(tab);
    if (tab === this.selected) {
      this.activate(tab);
    }
    tab.update();
    return b;
  },

  listen(tab) {
    let b = tab.browser;
    let listener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onStateChange(webProgress, request, flags, status) {
        Breached._tellTabsProgressListeners("onStateChange", b, webProgress, request, flags, status);
        if (!webProgress.isTopLevel || !(flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK)) {
          return;
        }
        if (flags & Ci.nsIWebProgressListener.STATE_START) {
          tab.el.setAttribute("busy", "true");
          Breached.emit("TabAttrModified", { tab, changed: ["status"] });
        } else if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
          tab.el.removeAttribute("busy");
          Breached.emit("TabAttrModified", { tab, changed: ["status"] });
          if (tab === Breached.selected) {
            Breached.updateNavButtons();
          }
          Breached.saveSession();
        }
      },
      onLocationChange(webProgress, request, location, flags) {
        Breached._tellTabsProgressListeners("onLocationChange", b, webProgress, request, location, flags);
        if (!webProgress.isTopLevel) {
          return;
        }
        tab.url = displayURL(location.spec);
        tab.title = b.contentTitle || "";
        if (!(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) {
          // A new page: the old one's camera or microphone use ended with it.
          tab.capture.clear();
          SiteZoom.apply(b, location);
        }
        tab.update();
        if (tab === Breached.selected) {
          Breached.updateTitle();
          Breached.updateNavButtons();
        }
        Breached.saveSession();
      },
      onProgressChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    };
    tab.progressListener = listener; // keep it alive (weak reference)
    b.addProgressListener(
      listener,
      Ci.nsIWebProgress.NOTIFY_STATE_NETWORK | Ci.nsIWebProgress.NOTIFY_STATE_WINDOW | Ci.nsIWebProgress.NOTIFY_LOCATION
    );
    // A page that moved to another process needs drawing turned back on.
    b.addEventListener("DidChangeBrowserRemoteness", () => {
      if (tab === this.selected) {
        this.activate(tab);
      }
    });
    b.addEventListener("pagetitlechanged", () => {
      tab.title = b.contentTitle || "";
      tab.update();
      if (tab === this.selected) {
        this.updateTitle();
      }
      this.emit("TabAttrModified", { tab, changed: ["label"] });
    });
  },

  activate(tab) {
    let b = tab.browser;
    if (!b) {
      return;
    }
    b.setAttribute("selected", "true");
    b.docShellIsActive = true;
  },

  deactivate(tab) {
    let b = tab.browser;
    if (!b) {
      return;
    }
    b.removeAttribute("selected");
    b.docShellIsActive = false;
  },

  // -------------------------------------------------------------- tabs

  /**
   * Opens a tab. Options: background, afterCurrent, index,
   * triggeringPrincipal, referrerInfo, policyContainer, openWindowInfo,
   * openerBrowser, name, skipLoad, history (saved session history).
   */
  openTab(url, options = {}) {
    let tab = new Tab();
    tab.url = url || "about:blank";
    let index = options.index ?? (options.afterCurrent && this.selected
      ? this.tabs.indexOf(this.selected) + 1
      : this.tabs.length);
    this.tabs.splice(index, 0, tab);
    this.placeTabEl(tab);

    if (options.asleep) {
      tab.title = options.title || "";
      tab.history = options.history || null;
      tab.update();
    } else {
      let b = this.attachBrowser(tab, options);
      if (options.history) {
        this.restoreHistory(tab, options.history);
      } else if (!options.skipLoad && tab.url != "about:blank") {
        this.load(b, tab.url, options);
      }
    }

    tab.opener = options.opener ?? null;
    this.emit("TabOpen", { tab });
    if (!options.background || (!this.selected && !options.asleep)) {
      this.selectTab(tab);
    } else {
      this.peekTabs();
    }
    this.saveSession();
    return tab;
  },

  load(browser, url, { triggeringPrincipal, referrerInfo, policyContainer } = {}) {
    url = realURL(url);
    let uri;
    try {
      uri = Services.io.newURI(url);
    } catch (e) {
      this.showMessage(`Can't open ${url}`, "error");
      return;
    }
    let params = {
      triggeringPrincipal:
        triggeringPrincipal || Services.scriptSecurityManager.getSystemPrincipal(),
    };
    if (referrerInfo) {
      params.referrerInfo = referrerInfo;
    }
    if (policyContainer) {
      params.policyContainer = policyContainer;
    }
    try {
      browser.loadURI(uri, params);
    } catch (e) {
      this.showMessage(`Can't open ${url}: ${e.message}`, "error");
    }
  },

  selectTab(tab) {
    if (!tab) {
      return;
    }
    let previous = this.selected;
    if (previous && previous !== tab) {
      previous.el.removeAttribute("selected");
      previous.lastActive = Date.now();
      this.deactivate(previous);
    }
    this.selected = tab;
    tab.lastActive = Date.now();
    tab.el.setAttribute("selected", "true");
    tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (tab.asleep) {
      this.wake(tab);
    }
    this.activate(tab);
    if (!this.$commandbar.hidden) {
      // keep focus in the command bar
    } else {
      tab.browser?.focus();
    }
    this.updateTitle();
    this.updateNavButtons();
    this.peekTabs();
    if (previous !== tab) {
      this.emit("TabSelect", { tab, previous });
    }
    this._nextPermission();
  },

  closeTab(tab = this.selected) {
    if (!tab) {
      return;
    }
    let index = this.tabs.indexOf(tab);
    this.closed.push({ url: tab.url, title: tab.title, index, history: this.collectHistory(tab) });
    if (this.closed.length > 20) {
      this.closed.shift();
    }
    this.emit("TabClose", { tab, index });
    this.tabs.splice(index, 1);
    tab.el.remove();
    let browser = tab.browser;
    tab.browser?.remove();
    tab.browser = null;
    tab.closed = true;
    if (browser) {
      this.cancelPermission(browser);
    }
    if (!this.tabs.length) {
      this.selected = null;
      if (this.isPrivate) {
        // Closing a private window's last tab ends it.
        window.close();
        return;
      }
      this.openTab(this.homepage());
      return;
    }
    if (tab === this.selected) {
      this.selected = null;
      this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)]);
    }
    this.peekTabs();
    this.saveSession();
  },

  undoCloseTab() {
    let last = this.closed.pop();
    if (!last) {
      this.showMessage("No closed tabs");
      return;
    }
    this.openTab(last.url, {
      index: Math.min(last.index, this.tabs.length),
      history: last.history,
    });
  },

  tabAt(n) {
    // 1-based; negative counts from the end
    if (n < 0) {
      return this.tabs[this.tabs.length + n];
    }
    return this.tabs[n - 1];
  },

  advance(step) {
    let i = this.tabs.indexOf(this.selected);
    let n = this.tabs.length;
    this.selectTab(this.tabs[(i + step + n) % n]);
  },

  /** Puts a tab's element in the tab bar at its place in this.tabs. */
  placeTabEl(tab) {
    let next = this.tabs[this.tabs.indexOf(tab) + 1]?.el ?? document.getElementById("ext-buttons");
    this.$tabbar.insertBefore(tab.el, next?.parentNode == this.$tabbar ? next : null);
  },

  moveTab(tab, to) {
    let from = this.tabs.indexOf(tab);
    to = Math.max(0, Math.min(this.tabs.length - 1, to));
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.placeTabEl(tab);
    this.peekTabs();
    this.saveSession();
    if (from != to) {
      this.emit("TabMove", { tab, from, to });
    }
  },

  // -------------------------------------------------------------- unloading

  collectHistory(tab) {
    if (tab.asleep) {
      return tab.history;
    }
    try {
      let bc = tab.browser.browsingContext;
      let data = SessionHistory.collectFromParent(tab.url, true, bc.sessionHistory);
      return data.entries.length ? data : null;
    } catch (e) {
      return null;
    }
  },

  restoreHistory(tab, history) {
    let b = tab.browser;
    try {
      SessionHistory.restoreFromParent(b.browsingContext.sessionHistory, history);
      b.browsingContext.sessionHistory.reloadCurrentEntry();
    } catch (e) {
      let entry = history.entries?.[history.index - 1];
      this.load(b, entry?.url || tab.url);
    }
  },

  /** Puts a tab to sleep: frees its page, keeps its place and history. */
  sleep(tab) {
    if (!tab || tab.asleep || tab === this.selected) {
      return false;
    }
    tab.history = this.collectHistory(tab);
    tab.browser.remove();
    tab.browser = null;
    tab.el.removeAttribute("busy");
    tab.update();
    this.emit("TabAttrModified", { tab, changed: ["discarded"] });
    return true;
  },

  wake(tab) {
    this.attachBrowser(tab);
    if (tab.history) {
      this.restoreHistory(tab, tab.history);
    } else {
      this.load(tab.browser, tab.url);
    }
    tab.history = null;
    this.emit("TabAttrModified", { tab, changed: ["discarded"] });
  },

  /** Why a tab must stay loaded, or null if it may sleep. */
  keepAwakeReason(tab) {
    if (tab === this.selected) {
      return "selected";
    }
    if (tab.pinned) {
      return "pinned";
    }
    if (tab.recording) {
      return "is using your " + tab.recording;
    }
    let mc = tab.browser?.browsingContext?.mediaController;
    if (mc?.isAudible || mc?.isPlaying) {
      return "playing media";
    }
    if (tab.browser?.browsingContext?.currentWindowGlobal?.hasBeforeUnload) {
      return "has unsaved changes";
    }
    return null;
  },

  unloadIdleTabs() {
    let minutes = this.pref("tabs.unloadAfterMinutes", 15);
    let maxAwake = this.pref("tabs.maxAwake", 0);
    let now = Date.now();
    let awake = this.tabs.filter(t => !t.asleep);
    let candidates = awake
      .filter(t => !this.keepAwakeReason(t))
      .sort((a, b) => a.lastActive - b.lastActive);
    let unloaded = 0;
    for (let tab of candidates) {
      let idle = minutes > 0 && now - tab.lastActive > minutes * 60 * 1000;
      let over = maxAwake > 0 && awake.length - unloaded > maxAwake;
      if ((idle || over) && this.sleep(tab)) {
        unloaded++;
      }
    }
    if (unloaded) {
      // Hand the unloaded tabs' memory back to Windows (garbage collection
      // and caches in every process), as Firefox does under memory pressure.
      Cc["@mozilla.org/memory-reporter-manager;1"]
        .getService(Ci.nsIMemoryReporterManager)
        .minimizeMemoryUsage(() => {});
    }
    return unloaded;
  },

  // -------------------------------------------------------------- session

  sessionPath() {
    return PathUtils.join(PathUtils.profileDir, SESSION_FILE);
  },

  sessionData() {
    return {
      selected: this.tabs.indexOf(this.selected),
      tabs: this.tabs.map(t => ({
        url: t.url,
        title: t.title,
        pinned: t.pinned,
        history: this.collectHistory(t),
      })),
    };
  },

  saveSession() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveSessionNow(), 2000);
  },

  saveSessionNow() {
    clearTimeout(this._saveTimer);
    if (this.isPrivate || !this.pref("restoreSession", true)) {
      return;
    }
    let json = JSON.stringify(this.sessionData());
    IOUtils.writeUTF8(this.sessionPath(), json, { tmpPath: this.sessionPath() + ".tmp" }).catch(
      e => console.error("Breached: saving session failed", e)
    );
  },

  /** Reopens the last session's tabs (asleep, except the selected one). */
  restoreSession() {
    let data;
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(this.sessionPath());
      if (!file.exists()) {
        return false;
      }
      let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      stream.init(file, -1, 0, 0);
      let text = NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" });
      stream.close();
      data = JSON.parse(text);
    } catch (e) {
      console.error("Breached: reading session failed", e);
      return false;
    }
    let tabs = (data.tabs || []).filter(t => t.url && t.url != "about:blank");
    if (!tabs.length) {
      return false;
    }
    let selected = Math.max(0, Math.min(data.selected ?? 0, tabs.length - 1));
    tabs.forEach((t, i) => {
      let tab = this.openTab(t.url, {
        asleep: true,
        background: true,
        title: t.title,
        history: t.history,
      });
      tab.pinned = !!t.pinned;
      tab.update();
    });
    this.selectTab(this.tabs[selected]);
    return true;
  },

  // ------------------------------------------------------ site permissions

  _permissionQueue: [],
  _permissionActive: null,

  /**
   * A site asks for access (camera, location...). Asks in the command bar
   * when its tab is showing. Resolves to "allow", "always", "block" or
   * "never" ("always" and "never" are remembered for the site).
   */
  async askPermission(browser, { host, what, canRemember }) {
    let items = [
      { label: "allow", detail: "this time", answer: "allow" },
      canRemember && { label: "always", detail: `allow ${host} from now on`, answer: "always" },
      { label: "block", detail: "this time", answer: "block" },
      canRemember && { label: "never", detail: `block ${host} from now on`, answer: "never" },
    ].filter(Boolean);
    let item = await this.pickForTab(browser, `${host} wants to ${what}:`, items);
    return item?.answer ?? "block";
  },

  /** Breached.pick, but only while browser's tab is the one showing. */
  pickForTab(browser, label, items) {
    return new Promise(resolve => {
      this._permissionQueue.push({ browser, label, items, resolve });
      this._nextPermission();
    });
  },

  _nextPermission() {
    if (this._permissionActive) {
      return;
    }
    let tabFor = browser => this.tabs.find(t => t.browser === browser);
    for (let entry of [...this._permissionQueue]) {
      let tab = tabFor(entry.browser);
      if (!tab) {
        this._permissionQueue.splice(this._permissionQueue.indexOf(entry), 1);
        entry.resolve(null);
      }
    }
    let entry = this._permissionQueue.find(e => tabFor(e.browser) === this.selected);
    if (!entry) {
      let waiting = this._permissionQueue[0];
      if (waiting) {
        let tab = tabFor(waiting.browser);
        this.showMessage(`Tab ${tab.index + 1} (${tab.label}) is asking for access. Switch to it to answer.`);
      }
      return;
    }
    this._permissionQueue.splice(this._permissionQueue.indexOf(entry), 1);
    this._permissionActive = entry;
    this.pick(entry.label, entry.items).then(item => {
      this._permissionActive = null;
      entry.resolve(item);
      this._nextPermission();
    });
  },

  /** Drops a page's open questions (it went away). */
  cancelPermission(browser) {
    for (let entry of this._permissionQueue.filter(e => e.browser === browser)) {
      this._permissionQueue.splice(this._permissionQueue.indexOf(entry), 1);
      entry.resolve(null);
    }
    if (this._permissionActive?.browser === browser && this._pick) {
      this._endPick(false);
      this.closeCommandLine();
    }
  },

  /** A page started or stopped using the camera, microphone or screen. */
  setCapture(browser, { windowID, camera, microphone, screen }) {
    let tab = this.tabs.find(t => t.browser === browser);
    if (!tab) {
      return;
    }
    if (camera || microphone || screen) {
      tab.capture.set(windowID, { camera, microphone, screen });
    } else {
      tab.capture.delete(windowID);
    }
    tab.update();
    this.emit("TabCapture", { tab, recording: tab.recording });
  },

  // -------------------------------------------------------------- command bar

  /**
   * Asks for one line of text in the command bar, e.g. a password.
   * Resolves to the text, or null if cancelled. Never stored in the history.
   */
  prompt(label, { password = false } = {}) {
    this._promptResolve?.(null);
    return new Promise(resolve => {
      this._promptResolve = resolve;
      this.openCommandLine("");
      document.getElementById("prompt").textContent = label;
      this.$commandline.type = password ? "password" : "text";
      document.getElementById("completion").textContent = "";
    });
  },

  /**
   * Shows choices as rows above the command bar, like qutebrowser's
   * completion list. Typing narrows the rows; Up/Down (or Tab/Shift+Tab)
   * move; Enter or a click picks. Resolves to the picked item, or null if
   * cancelled. Items are { label, detail } plus anything the caller needs.
   */
  pick(label, items) {
    this._pick?.resolve(null);
    return new Promise(resolve => {
      this._pick = { items, resolve, rows: items, selected: 0 };
      this.openCommandLine("");
      document.getElementById("prompt").textContent = label;
      document.getElementById("completion").textContent = "";
      this._renderPick();
    });
  },

  _renderPick() {
    let pick = this._pick;
    let list = document.getElementById("picker");
    if (!pick) {
      list.hidden = true;
      list.textContent = "";
      return;
    }
    let words = this.$commandline.value.toLowerCase().split(/\s+/).filter(Boolean);
    pick.rows = pick.items.filter(item => {
      let text = `${item.label} ${item.detail ?? ""}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
    pick.selected = Math.max(0, Math.min(pick.selected, pick.rows.length - 1));
    list.textContent = "";
    pick.rows.forEach((item, i) => {
      let row = document.createElement("div");
      row.className = "picker-row";
      row.toggleAttribute("selected", i == pick.selected);
      let label = document.createElement("span");
      label.className = "picker-label";
      label.textContent = item.label;
      let detail = document.createElement("span");
      detail.className = "picker-detail";
      detail.textContent = item.detail ?? "";
      row.append(label, detail);
      row.addEventListener("mousedown", event => {
        event.preventDefault();
        pick.selected = i;
        this._endPick(true);
      });
      list.append(row);
    });
    if (!pick.rows.length) {
      let row = document.createElement("div");
      row.className = "picker-row picker-empty";
      row.textContent = "no matches";
      list.append(row);
    }
    list.hidden = false;
    list.querySelector("[selected]")?.scrollIntoView({ block: "nearest" });
  },

  _movePick(step) {
    let pick = this._pick;
    if (pick.rows.length) {
      pick.selected = (pick.selected + step + pick.rows.length) % pick.rows.length;
      this._renderPick();
    }
  },

  _endPick(picked) {
    let pick = this._pick;
    this._pick = null;
    let item = picked ? pick.rows[pick.selected] ?? null : null;
    this._renderPick();
    document.getElementById("prompt").textContent = ":";
    if (picked) {
      this.closeCommandLine();
    }
    pick.resolve(item);
  },

  _endPrompt(value) {
    let resolve = this._promptResolve;
    this._promptResolve = null;
    document.getElementById("prompt").textContent = ":";
    this.$commandline.type = "text";
    resolve?.(value);
  },

  openCommandLine(text = "") {
    let input = this.$commandline;
    this.$commandbar.hidden = false;
    document.documentElement.setAttribute("commandbar-open", "true");
    this.hideMessage();
    input.value = text;
    this.historyIndex = -1;
    this.updateCompletion();
    input.focus();
    input.setSelectionRange(text.length, text.length);
  },

  closeCommandLine() {
    if (this._promptResolve) {
      this._endPrompt(null);
    }
    if (this._pick) {
      this._endPick(false);
    }
    this.$commandbar.hidden = true;
    document.documentElement.removeAttribute("commandbar-open");
    this.$commandline.value = "";
    this.selectedBrowser?.focus();
  },

  onCommandLineKey(event) {
    let input = this.$commandline;
    if (this._pick) {
      switch (event.key) {
        case "Enter":
          this._endPick(true);
          break;
        case "ArrowDown":
          this._movePick(1);
          break;
        case "ArrowUp":
          this._movePick(-1);
          break;
        case "Tab":
          this._movePick(event.shiftKey ? -1 : 1);
          break;
        case "Escape":
          this.closeCommandLine();
          break;
        case "Backspace":
          if (!input.value) {
            this.closeCommandLine();
            break;
          }
          return;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    switch (event.key) {
      case "Escape":
        this.closeCommandLine();
        break;
      case "Enter": {
        if (this._promptResolve) {
          let value = input.value;
          input.value = "";
          this._endPrompt(value);
          this.closeCommandLine();
          break;
        }
        let text = input.value.trim();
        this.closeCommandLine();
        if (text) {
          this.history = this.history.filter(h => h != text);
          this.history.unshift(text);
          this.history.length = Math.min(this.history.length, 100);
          this.run(text);
        }
        break;
      }
      case "ArrowUp":
      case "ArrowDown": {
        if (this._promptResolve) {
          break;
        }
        let step = event.key == "ArrowUp" ? 1 : -1;
        let i = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + step));
        this.historyIndex = i;
        input.value = i < 0 ? "" : this.history[i];
        break;
      }
      case "Tab": {
        if (this._promptResolve) {
          break;
        }
        let matches = this.completions(input.value);
        if (matches.length) {
          input.value = matches[0] + " ";
          this.updateCompletion();
        }
        break;
      }
      case "Backspace":
        if (!input.value) {
          this.closeCommandLine();
          break;
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  },

  completions(text) {
    if (text.includes(" ")) {
      return [];
    }
    return Object.keys(Commands)
      .filter(name => name.startsWith(text) && !Commands[name].alias)
      .sort();
  },

  updateCompletion() {
    if (this._pick) {
      this._pick.selected = 0;
      this._renderPick();
      return;
    }
    if (this._promptResolve) {
      return;
    }
    let text = this.$commandline.value;
    let el = document.getElementById("completion");
    if (!text || text.includes(" ")) {
      let name = text.split(" ")[0];
      el.textContent = Commands[name]?.usage ?? "";
      return;
    }
    el.textContent = this.completions(text).join("  ");
  },

  // ------------------------------------------------------------ preconnect

  _preconnected: new Map(), // host -> when, so each site is warmed once a minute

  /**
   * Opens the network connection (DNS, TCP, TLS) to a site the user is
   * about to visit, so the page starts loading sooner. Costs one idle socket
   * that closes by itself if it isn't used.
   */
  preconnect(url) {
    let uri;
    try {
      uri = Services.io.newURI(url);
    } catch (e) {
      return;
    }
    if (!uri.schemeIs("https") && !uri.schemeIs("http")) {
      return;
    }
    let key = uri.prePath;
    let now = Date.now();
    if (now - (this._preconnected.get(key) ?? 0) < 60 * 1000) {
      return;
    }
    this._preconnected.set(key, now);
    if (this._preconnected.size > 50) {
      this._preconnected.delete(this._preconnected.keys().next().value);
    }
    let principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
    try {
      Services.io.speculativeConnect(uri, principal, null, false);
    } catch (e) {
      // Speculative connections turned off (network.http.speculative-parallel-limit).
    }
  },

  /** Preconnects to what the command bar would open, while it's typed. */
  preconnectTyped(text) {
    clearTimeout(this._preconnectTimer);
    this._preconnectTimer = setTimeout(() => {
      let [name, ...rest] = text.trim().split(/\s+/);
      let target;
      if (name == "open" || name == "o") {
        target = rest.filter(w => !/^-[tbw]$/.test(w)).join(" ");
      } else if (name && !Commands[name] && !ModHost.modCommands.has(name)) {
        target = text;
      }
      if (target?.trim()) {
        try {
          this.preconnect(this.urlFor(target));
        } catch (e) {
          // not an address
        }
      }
    }, 150);
  },

  /** Runs a command line, e.g. "open -t example.com". */
  run(text) {
    let [name, ...rest] = text.trim().split(/\s+/);
    let args = rest.join(" ");
    let command = Commands[name];
    if (!command && ModHost.modCommands.has(name)) {
      this.showMessage(
        `${name} comes with the ${ModHost.modCommands.get(name)} mod: :mods get opens the mods site to install it`,
        "error"
      );
      return undefined;
    }
    if (!command) {
      // Not a command: open it as an address or a search.
      return Commands.open.run(text.trim());
    }
    if (command.alias) {
      return this.run(command.alias + (args ? " " + args : ""));
    }
    try {
      return command.run(args);
    } catch (e) {
      console.error(e);
      this.showMessage(`${name}: ${e.message}`, "error");
    }
    return undefined;
  },

  // -------------------------------------------------------------- messages

  showMessage(text, level = "info") {
    let el = document.getElementById("message");
    el.textContent = text;
    el.setAttribute("level", level);
    el.hidden = false;
    clearTimeout(this._messageTimer);
    this._messageTimer = setTimeout(() => this.hideMessage(), MESSAGE_MS);
  },

  hideMessage() {
    document.getElementById("message").hidden = true;
  },

  // -------------------------------------------------------------- addresses

  /** Turns typed text into a URL: an address, or a search. */
  urlFor(text) {
    text = text.trim();
    if (!text) {
      return this.homepage();
    }
    if (PAGES[text]) {
      return text;
    }
    let looksLikeAddress =
      /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]+:\s/i.test(text)
        ? true
        : !/\s/.test(text) && (/\./.test(text) || /^localhost(:\d+)?(\/|$)/.test(text));
    if (looksLikeAddress) {
      if (/^(javascript|data):/i.test(text)) {
        throw new Error("javascript: and data: addresses can't be opened from the command bar");
      }
      try {
        let info = Services.uriFixup.getFixupURIInfo(
          text,
          Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
        );
        if (info.preferredURI) {
          return info.preferredURI.spec;
        }
      } catch (e) {
        // fall through to search
      }
    }
    return this.pref("searchUrl", "https://duckduckgo.com/?q=%s").replace(
      "%s",
      encodeURIComponent(text)
    );
  },

  // -------------------------------------------------------------- events

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
        if (event.target === this.$commandline) {
          this.onCommandLineKey(event);
        } else if (
          event.key == ":" &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          event.target.ownerDocument === document &&
          event.target.localName != "browser" &&
          event.target.localName != "input"
        ) {
          // ":" while the window itself (not a page) has focus
          event.preventDefault();
          this.openCommandLine();
        }
        break;
      case "input":
        this.updateCompletion();
        this.preconnectTyped(this.$commandline.value);
        break;
      case "blur":
        // Clicking back into the page closes the command bar.
        setTimeout(() => {
          if (
            !this.$commandbar.hidden &&
            document.hasFocus() &&
            document.activeElement !== this.$commandline
          ) {
            this.closeCommandLine();
          }
        }, 0);
        break;
      case "mousedown": {
        let tab = event.target.closest(".tab")?.tab;
        if (tab && event.button == 0) {
          this.selectTab(tab);
          event.preventDefault();
        }
        break;
      }
      case "auxclick": {
        let tab = event.target.closest(".tab")?.tab;
        if (tab && event.button == 1) {
          this.closeTab(tab);
        }
        break;
      }
      case "MozDOMFullscreen:Entered":
      case "MozDOMFullscreen:Exited":
        // handled by the DOMFullscreen actor and FullScreen below
        break;
      case "unload":
        this.uninit();
        break;
    }
  },
};

var { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

/** Lets pages open tabs (target=_blank, window.open). */
var BrowserDOMWindow = {
  QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),

  _newTab(uri, { openWindowInfo, openerBrowser, where, triggeringPrincipal, referrerInfo, policyContainer, name, skipLoad }) {
    let background = where == Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_BACKGROUND;
    let tab = Breached.openTab(uri ? uri.spec : "about:blank", {
      openWindowInfo,
      openerBrowser,
      background,
      afterCurrent: true,
      triggeringPrincipal,
      referrerInfo,
      policyContainer,
      name,
      skipLoad,
    });
    return tab.browser;
  },

  createContentWindow(uri, openWindowInfo, where, flags, triggeringPrincipal, policyContainer) {
    return this.openURI(null, openWindowInfo, where, flags, triggeringPrincipal, policyContainer);
  },

  openURI(uri, openWindowInfo, where, flags, triggeringPrincipal, policyContainer) {
    if (where == Ci.nsIBrowserDOMWindow.OPEN_PRINT_BROWSER) {
      return Breached.printClone(openWindowInfo).browsingContext;
    }
    if (where == Ci.nsIBrowserDOMWindow.OPEN_CURRENTWINDOW && uri && Breached.selectedBrowser) {
      Breached.load(Breached.selectedBrowser, uri.spec, { triggeringPrincipal, policyContainer });
      return Breached.selectedBrowser.browsingContext;
    }
    let browser = this._newTab(uri, {
      openWindowInfo,
      where,
      triggeringPrincipal,
      policyContainer,
      skipLoad: !uri,
    });
    if (flags & Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL) {
      window.focus();
    }
    return browser?.browsingContext ?? null;
  },

  createContentWindowInFrame(uri, params, where, flags, name) {
    if (where == Ci.nsIBrowserDOMWindow.OPEN_PRINT_BROWSER) {
      return Breached.printClone(params.openWindowInfo);
    }
    return this._newTab(null, {
      openWindowInfo: params.openWindowInfo,
      openerBrowser: params.openerBrowser,
      where,
      triggeringPrincipal: params.triggeringPrincipal,
      referrerInfo: params.referrerInfo,
      policyContainer: params.policyContainer,
      name,
      skipLoad: true,
    });
  },

  openURIInFrame(uri, params, where, flags, name) {
    return this._newTab(uri, {
      openWindowInfo: params.openWindowInfo,
      openerBrowser: params.openerBrowser,
      where,
      triggeringPrincipal: params.triggeringPrincipal,
      referrerInfo: params.referrerInfo,
      policyContainer: params.policyContainer,
      name,
      skipLoad: false,
    });
  },

  canClose() {
    return true;
  },

  get tabCount() {
    return Breached.tabs.length;
  },
};

/** Page fullscreen (used by the DOMFullscreen actor), ported from Firefox. */
var FullScreen = {
  enterDomFullscreen(browser, actor) {
    if (!document.fullscreenElement) {
      actor.requestOrigin = null;
      return;
    }
    if (browser?.isRemoteBrowser) {
      let [target, inProcessBC] = this._nextRecipient(actor, false);
      if (!target) {
        this._abort(actor);
        return;
      }
      target.waitingForChildEnterFullscreen = true;
      target.sendAsyncMessage("DOMFullscreen:Entered", { remoteFrameBC: inProcessBC });
      if (inProcessBC) {
        return;
      }
    }
    if (!browser || browser !== Breached.selectedBrowser) {
      this._abort(actor);
      return;
    }
    document.documentElement.setAttribute("inDOMFullscreen", true);
  },

  cleanupDomFullscreen(actor) {
    let needToWait = false;
    let [target, inProcessBC] = this._nextRecipient(actor, true);
    if (target) {
      needToWait = true;
      target.waitingForChildExitFullscreen = true;
      target.sendAsyncMessage("DOMFullscreen:CleanUp", { remoteFrameBC: inProcessBC });
      if (inProcessBC) {
        return needToWait;
      }
    }
    document.documentElement.removeAttribute("inDOMFullscreen");
    return needToWait;
  },

  exitDomFullScreen() {
    if (document.fullscreen) {
      document.exitFullscreen();
    }
  },

  _abort(actor) {
    setTimeout(() => document.exitFullscreen().catch(() => {}), 0);
    actor.timerId = null;
  },

  _nextRecipient(actor, useCache) {
    if (useCache && actor.nextMsgRecipient) {
      let next = actor.nextMsgRecipient;
      while (next) {
        let [a] = next;
        if (!a.hasBeenDestroyed() && a.windowContext && !a.windowContext.isInBFCache) {
          return next;
        }
        next = a.nextMsgRecipient;
      }
    }
    if (actor.hasBeenDestroyed()) {
      return [null, null];
    }
    let childBC = actor.browsingContext;
    let parentBC = childBC.parent;
    while (parentBC) {
      if (!childBC.currentWindowGlobal || !parentBC.currentWindowGlobal) {
        break;
      }
      if (childBC.currentWindowGlobal.osPid == parentBC.currentWindowGlobal.osPid) {
        childBC = parentBC;
        parentBC = childBC.parent;
      } else {
        break;
      }
    }
    let target = null;
    let inProcessBC = null;
    if (parentBC && parentBC.currentWindowGlobal) {
      target = parentBC.currentWindowGlobal.getActor("DOMFullscreen");
      inProcessBC = childBC;
      actor.nextMsgRecipient = [target, inProcessBC];
    } else {
      target = actor.requestOrigin;
    }
    if (!target || target.hasBeenDestroyed() || target.windowContext?.isInBFCache) {
      return [null, null];
    }
    return [target, inProcessBC];
  },
};

/** The fullscreen actor shows Firefox's warning panel; we show a message. */
var PointerlockFsWarning = {
  showFullScreen() {
    Breached.showMessage("Fullscreen: press Esc to leave");
  },
  showPointerLock() {},
  close() {},
};

/** Reports finished downloads in the message line. */
var Downloads = {
  _list: null,
  _view: {
    onDownloadChanged(download) {
      if (download.succeeded && !download._breachedReported) {
        download._breachedReported = true;
        Breached.showMessage(`Downloaded ${PathUtils.filename(download.target.path)}`);
      } else if (download.error && !download._breachedReported) {
        download._breachedReported = true;
        Breached.showMessage(`Download failed: ${download.source.url}`, "error");
      }
    },
    onDownloadAdded(download) {
      if (!download.stopped) {
        Breached.showMessage(`Downloading ${PathUtils.filename(download.target.path)}`);
      }
    },
  },
  async watch() {
    try {
      let { Downloads: D } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      this._list = await D.getList(Breached.isPrivate ? D.PRIVATE : D.PUBLIC);
      await this._list.addView(this._view);
    } catch (e) {
      console.error("Breached: downloads", e);
    }
  },
  unwatch() {
    this._list?.removeView(this._view);
  },
};

/**
 * Zoom is kept per site (breached.zoom.sites, {"host": percent}), like
 * Firefox: zooming one page of a site zooms the site's other pages, and
 * pages elsewhere keep their own. A private window's zooming is forgotten
 * when it closes.
 */
var SiteZoom = {
  PREF: "breached.zoom.sites",
  _private: new Map(),

  siteOf(uri) {
    try {
      return uri.host || null;
    } catch (e) {
      return null; // about:, breached: and file: pages zoom one at a time
    }
  },

  saved() {
    try {
      return JSON.parse(Services.prefs.getStringPref(this.PREF, "{}"));
    } catch (e) {
      return {};
    }
  },

  /** The zoom for a site in percent (100 when never zoomed). */
  get(site) {
    if (Breached.isPrivate && this._private.has(site)) {
      return this._private.get(site);
    }
    return this.saved()[site] ?? 100;
  },

  /** A page loaded in b: zoom it as its site was zoomed. */
  apply(b, uri) {
    let site = this.siteOf(uri);
    if (site) {
      b.fullZoom = this.get(site) / 100;
    }
  },

  /** Remembers b's zoom for its site; returns the site (null if none). */
  set(b, pct) {
    let site = this.siteOf(b.currentURI);
    if (!site) {
      return null;
    }
    if (Breached.isPrivate) {
      this._private.set(site, pct);
    } else {
      let sites = this.saved();
      if (pct == 100) {
        delete sites[site];
      } else {
        sites[site] = pct;
      }
      Services.prefs.setStringPref(this.PREF, JSON.stringify(sites));
    }
    // Other tabs on the same site follow.
    for (let tab of Breached.tabs) {
      if (tab.browser && tab.browser != b && this.siteOf(tab.browser.currentURI) == site) {
        tab.browser.fullZoom = pct / 100;
      }
    }
    return site;
  },
};

/** Keyboard shortcuts. Reserved, so pages can't take them over. */
var Keys = {
  bindings: [
    // [key or keycode, modifiers, command]
    ["t", "accel", () => Breached.newTab()],
    ["w", "accel", () => Breached.closeTab()],
    ["t", "accel,shift", () => Breached.undoCloseTab()],
    ["p", "accel,shift", () => Breached.openPrivateWindow()],
    ["w", "accel,shift", () => window.close()],
    ["VK_TAB", "control", () => Breached.advance(1)],
    ["VK_TAB", "control,shift", () => Breached.advance(-1)],
    ["VK_PAGE_DOWN", "accel", () => Breached.advance(1)],
    ["VK_PAGE_UP", "accel", () => Breached.advance(-1)],
    ["l", "accel", () => Breached.openCommandLine("open " + (Breached.selected?.url ?? ""))],
    ["VK_F6", "", () => Breached.openCommandLine("open " + (Breached.selected?.url ?? ""))],
    ["r", "accel", () => Breached.run("reload")],
    ["VK_F5", "", () => Breached.run("reload")],
    ["r", "accel,shift", () => Breached.run("reload -f")],
    ["VK_F5", "accel", () => Breached.run("reload -f")],
    ["VK_LEFT", "alt", () => Breached.run("back")],
    ["VK_RIGHT", "alt", () => Breached.run("forward")],
    ["f", "accel", () => Breached.openCommandLine("find ")],
    ["VK_F3", "", () => Breached.run("find-next")],
    ["VK_F3", "shift", () => Breached.run("find-prev")],
    ["g", "accel", () => Breached.run("find-next")],
    ["=", "accel", () => Breached.run("zoom-in")],
    ["+", "accel", () => Breached.run("zoom-in")],
    ["-", "accel", () => Breached.run("zoom-out")],
    ["0", "accel", () => Breached.run("zoom 100")],
    ["VK_F11", "", () => Breached.run("fullscreen")],
    ["q", "accel", () => Breached.run("quit")],
    [",", "accel", () => Breached.openSettings()],
    ["h", "accel", () => Breached.openPage("history")],
    ["j", "accel", () => Breached.openPage("downloads")],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), "accel", () => Breached.run(`tab-focus ${n}`)]),
    ["9", "accel", () => Breached.run("tab-focus -1")],
  ],

  install() {
    let keyset = document.createXULElement("keyset");
    keyset.id = "breached-keys";
    for (let [key, modifiers, command] of this.bindings) {
      keyset.append(this.create(key, modifiers, command));
    }
    document.documentElement.append(keyset);
  },

  /** Adds a shortcut later on (mods). Returns an element to remove() to drop it. */
  add(key, modifiers, command) {
    // Gecko reads a keyset when it is inserted, so each later shortcut gets
    // its own keyset.
    let keyset = document.createXULElement("keyset");
    keyset.append(this.create(key, modifiers, command));
    document.documentElement.append(keyset);
    return keyset;
  },

  create(key, modifiers, command) {
    let el = document.createXULElement("key");
    el.setAttribute(key.startsWith("VK_") ? "keycode" : "key", key);
    if (modifiers) {
      el.setAttribute("modifiers", modifiers);
    }
    el.setAttribute("reserved", "true");
    el.addEventListener("command", () => {
      try {
        command();
      } catch (e) {
        console.error(e);
      }
    });
    return el;
  },
};

/** ":" commands. "alias" entries expand to another command line. */
var Commands = {
  open: {
    usage: "open [-t|-b|-p] <address or search>  (new tab, background tab, private window)",
    run(args) {
      let m = args.match(/^(-[tbwp])\s+(.*)$|^(-[tbwp])$/);
      let flag = m?.[1] || m?.[3];
      let text = m ? (m[2] ?? "") : args;
      let url = Breached.urlFor(text);
      if (flag == "-p") {
        Breached.openPrivateWindow(url);
      } else if (flag == "-t" || flag == "-w" || !Breached.selectedBrowser) {
        Breached.openTab(url);
      } else if (flag == "-b") {
        Breached.openTab(url, { background: true, afterCurrent: true });
      } else {
        Breached.selected.url = url;
        Breached.load(Breached.selectedBrowser, url);
      }
    },
  },
  tabopen: { alias: "open -t" },
  private: { alias: "open -p" },
  o: { alias: "open" },
  O: { alias: "open -t" },
  close: {
    usage: "close [n]  (close the current tab, or tab n)",
    run(args) {
      let tab = args ? Breached.tabAt(parseInt(args, 10)) : Breached.selected;
      if (!tab) {
        throw new Error(`no tab ${args}`);
      }
      Breached.closeTab(tab);
    },
  },
  "tab-close": { alias: "close" },
  d: { alias: "close" },
  undo: {
    usage: "undo  (reopen the last closed tab)",
    run() {
      Breached.undoCloseTab();
    },
  },
  u: { alias: "undo" },
  quit: {
    usage: "quit",
    run() {
      for (let win of Services.wm.getEnumerator("breached:main")) {
        win.Breached?.saveSessionNow();
      }
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    },
  },
  q: { alias: "quit" },
  qa: { alias: "quit" },
  wq: { alias: "quit" },
  "tab-next": {
    run() {
      Breached.advance(1);
    },
  },
  "tab-prev": {
    run() {
      Breached.advance(-1);
    },
  },
  "tab-focus": {
    usage: "tab-focus <n>  (-1 is the last tab)",
    run(args) {
      let tab = Breached.tabAt(parseInt(args, 10));
      if (!tab) {
        throw new Error(`no tab ${args}`);
      }
      Breached.selectTab(tab);
    },
  },
  buffer: { alias: "tab-focus" },
  "tab-move": {
    usage: "tab-move <n>",
    run(args) {
      Breached.moveTab(Breached.selected, parseInt(args, 10) - 1);
    },
  },
  "tab-only": {
    usage: "tab-only  (close all other tabs)",
    run() {
      for (let tab of [...Breached.tabs]) {
        if (tab !== Breached.selected && !tab.pinned) {
          Breached.closeTab(tab);
        }
      }
    },
  },
  pin: {
    usage: "pin [address]  (pin this page, or an address, to the new tab page)",
    run(args) {
      const Pins = ChromeUtils.importESModule("resource://breached/Pins.sys.mjs");
      let tab = Breached.selected;
      let url = args ? Breached.urlFor(args) : tab?.url;
      let title = args ? "" : tab?.title ?? "";
      if (Pins.add(url, title)) {
        Breached.showMessage(`Pinned ${title || url} to the new tab page`);
      } else {
        Breached.showMessage("Already pinned");
      }
    },
  },
  unpin: {
    usage: "unpin [address or number]  (take this page, or another, off the new tab page)",
    run(args) {
      const Pins = ChromeUtils.importESModule("resource://breached/Pins.sys.mjs");
      let which = /^\d+$/.test(args) ? Number(args) : args ? Breached.urlFor(args) : Breached.selected?.url;
      let site = Pins.remove(which);
      Breached.showMessage(site ? `Unpinned ${site.title || site.url}` : "That isn't pinned", site ? "info" : "error");
    },
  },
  permissions: {
    usage: "permissions  (what sites may use: camera, location...; in settings)",
    run() {
      Breached.openSettings("site-permissions");
    },
  },
  "tab-pin": {
    usage: "tab-pin  (pinned tabs never unload)",
    run() {
      let tab = Breached.selected;
      tab.pinned = !tab.pinned;
      tab.update();
      Breached.saveSession();
      Breached.emit("TabAttrModified", { tab, changed: ["pinned"] });
    },
  },
  "tab-sleep": {
    usage: "tab-sleep [n]  (unload tab n, or every idle tab)",
    run(args) {
      if (args) {
        let tab = Breached.tabAt(parseInt(args, 10));
        if (!tab) {
          throw new Error(`no tab ${args}`);
        }
        let why = tab === Breached.selected ? "selected" : null;
        Breached.showMessage(
          why ? `Tab ${args} is ${why}` : Breached.sleep(tab) ? `Tab ${args} unloaded` : `Tab ${args} is already asleep`
        );
        return;
      }
      let n = 0;
      for (let tab of Breached.tabs) {
        if (!Breached.keepAwakeReason(tab) && Breached.sleep(tab)) {
          n++;
        }
      }
      Breached.showMessage(`Unloaded ${n} tab${n == 1 ? "" : "s"}`);
    },
  },
  unload: { alias: "tab-sleep" },
  back: {
    run() {
      Breached.selectedBrowser?.goBack();
    },
  },
  forward: {
    run() {
      Breached.selectedBrowser?.goForward();
    },
  },
  reload: {
    usage: "reload [-f]  (-f skips the cache)",
    run(args) {
      let b = Breached.selectedBrowser;
      if (args.trim() == "-f") {
        b?.reloadWithFlags(
          Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE | Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY
        );
      } else {
        b?.reload();
      }
    },
  },
  r: { alias: "reload" },
  stop: {
    run() {
      Breached.selectedBrowser?.stop();
    },
  },
  home: {
    run() {
      Commands.open.run(Breached.homepage());
    },
  },
  find: {
    usage: "find <text>  (F3 / Ctrl+G for the next match)",
    _last: "",
    run(args) {
      let b = Breached.selectedBrowser;
      if (!b || !args) {
        return;
      }
      this._last = args;
      Commands.find._search(b, args, null);
    },
    _search(b, text, previous) {
      let finder = b.finder;
      finder.caseSensitive = /[A-Z]/.test(text);
      let listener = {
        onFindResult(data) {
          finder.removeResultListener(listener);
          if (data.result == Ci.nsITypeAheadFind.FIND_NOTFOUND) {
            Breached.showMessage(`Text not found: ${text}`, "error");
          } else if (data.result == Ci.nsITypeAheadFind.FIND_WRAPPED) {
            Breached.showMessage("Search wrapped");
          }
        },
        onMatchesCountResult() {},
        onHighlightFinished() {},
      };
      finder.addResultListener(listener);
      if (previous === null) {
        finder.fastFind(text, false, false);
      } else {
        finder.findAgain(text, previous, false, false);
      }
    },
  },
  "/": { alias: "find" },
  "find-next": {
    run() {
      let b = Breached.selectedBrowser;
      if (b && Commands.find._last) {
        Commands.find._search(b, Commands.find._last, false);
      }
    },
  },
  "find-prev": {
    run() {
      let b = Breached.selectedBrowser;
      if (b && Commands.find._last) {
        Commands.find._search(b, Commands.find._last, true);
      }
    },
  },
  zoom: {
    usage: "zoom <percent>",
    run(args) {
      let b = Breached.selectedBrowser;
      let pct = parseInt(args, 10);
      if (!b || !(pct >= 30 && pct <= 500)) {
        throw new Error("zoom takes a percentage from 30 to 500");
      }
      b.fullZoom = pct / 100;
      let site = SiteZoom.set(b, pct);
      Breached.showMessage(site ? `Zoom ${pct}% on ${site}` : `Zoom ${pct}%`);
    },
  },
  "zoom-in": {
    run() {
      let b = Breached.selectedBrowser;
      if (b) {
        Commands.zoom.run(String(Math.min(500, Math.round(b.fullZoom * 100) + 10)));
      }
    },
  },
  "zoom-out": {
    run() {
      let b = Breached.selectedBrowser;
      if (b) {
        Commands.zoom.run(String(Math.max(30, Math.round(b.fullZoom * 100) - 10)));
      }
    },
  },
  fullscreen: {
    usage: "fullscreen  (toggle, also F11)",
    run() {
      window.fullScreen = !window.fullScreen;
    },
  },
  set: {
    usage: "set [name] [value]  (e.g. set tabs.position top)",
    run(args) {
      let [name, ...rest] = args.split(/\s+/).filter(Boolean);
      let names = Services.prefs.getChildList(PREF).map(n => n.slice(PREF.length)).sort();
      if (!name) {
        Breached.showMessage(names.map(n => `${n}=${Breached.pref(n)}`).join("  "));
        return;
      }
      let full = PREF + name;
      let type = Services.prefs.getPrefType(full);
      if (type == Services.prefs.PREF_INVALID) {
        throw new Error(`unknown setting ${name} (try: ${names.join(", ")})`);
      }
      if (!rest.length) {
        Breached.showMessage(`${name}=${Breached.pref(name)}`);
        return;
      }
      let value = rest.join(" ");
      if (type == Services.prefs.PREF_BOOL) {
        if (value != "true" && value != "false") {
          throw new Error(`${name} is true or false`);
        }
        Services.prefs.setBoolPref(full, value == "true");
      } else if (type == Services.prefs.PREF_INT) {
        if (!/^-?\d+$/.test(value)) {
          throw new Error(`${name} is a number`);
        }
        Services.prefs.setIntPref(full, parseInt(value, 10));
      } else {
        if (name == "tabs.position" && value != "top" && value != "bottom") {
          throw new Error("tabs.position is top or bottom");
        }
        Services.prefs.setStringPref(full, value);
      }
      Breached.showMessage(`${name}=${Breached.pref(name)}`);
    },
  },
  settings: {
    usage: "settings  (open the settings page)",
    run() {
      Breached.openSettings();
    },
  },
  history: {
    usage: "history  (open the history page)",
    run() {
      Breached.openPage("history");
    },
  },
  downloads: {
    usage: "downloads  (open the download manager)",
    run() {
      Breached.openPage("downloads");
    },
  },
  extensions: {
    usage: "extensions  (open the extensions page; :ext <name> opens one's popup)",
    run() {
      Breached.openPage("extensions");
    },
  },
  mods: {
    usage: "mods [get]  (your mods, in settings; get: open the mods site)",
    run(args) {
      if (args.trim() == "get") {
        ModHost.openSite();
      } else {
        Breached.openSettings("mods");
      }
    },
  },
  update: {
    usage: "update  (check GitHub for a newer Breached, in settings)",
    run() {
      Breached._checkUpdatesOnOpen = true;
      Breached.openSettings("updates");
    },
  },
  version: {
    run() {
      Breached.showMessage(
        `Breached ${BREACHED_VERSION} (Gecko ${Services.appinfo.platformVersion})`
      );
    },
  },
  help: {
    usage: "help [command]",
    run(args) {
      if (args && Commands[args]) {
        let c = Commands[args];
        Breached.showMessage(c.alias ? `${args} = ${c.alias}` : c.usage || args);
        return;
      }
      Breached.showMessage(
        "Commands: " + Object.keys(Commands).filter(n => !Commands[n].alias).sort().join(" ")
      );
    },
  },
};

window.addEventListener("load", () => Breached.init(), { once: true });
