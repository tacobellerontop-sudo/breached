/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Breached's side of the WebExtension tabs and windows APIs: what Firefox's
// browser/components/extensions/parent/ext-browser.js does for tabbrowser,
// done for Breached's own tabs (window.Breached.tabs, see shell.js).
//
// A "native tab" here is a Breached Tab object. A sleeping (unloaded) tab
// has no <browser>; extensions see it as discarded.

ChromeUtils.defineESModuleGetters(this, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

var { ExtensionError } = ExtensionUtils;

var { defineLazyGetter } = ExtensionCommon;

const WINDOW_TYPE = "breached:main";

let tabTracker;
let windowTracker;

var shellOf = window => window?.Breached;

global.makeWidgetId = id => {
  id = id.toLowerCase();
  return id.replace(/[^a-z0-9_-]/g, "_");
};

global.clickModifiersFromEvent = event => {
  const map = {
    shiftKey: "Shift",
    altKey: "Alt",
    metaKey: "Command",
    ctrlKey: "Ctrl",
  };
  return Object.keys(map)
    .filter(key => event[key])
    .map(key => map[key]);
};

/**
 * Opens an extension's page as a small window on top of Breached (LX: extensions
 * open as pop-ups, not tabs), and resolves with that window once its page is in.
 */
global.openExtensionWindow = async (url, size = {}) => {
  let window = windowTracker.getTopNormalWindow();
  if (!window) {
    throw new ExtensionUtils.ExtensionError("No browser window");
  }
  let popup = shellOf(window).openPopupWindow(url, size);
  await new Promise(resolve => {
    let ready = () => (popup.Breached?.selected ? resolve() : popup.setTimeout(ready, 20));
    if (popup.document.readyState == "complete") {
      ready();
    } else {
      popup.addEventListener("load", () => popup.setTimeout(ready, 0), { once: true });
    }
  });
  return popup;
};

/** Opens an extension's options page, as a pop-up window. */
global.openOptionsPage = async extension => {
  let window = windowTracker.topWindow;
  if (!window) {
    return Promise.reject({ message: "No browser window available" });
  }
  const { optionsPageProperties } = extension;
  if (!optionsPageProperties) {
    return Promise.reject({ message: "No options page" });
  }
  let url = optionsPageProperties.page;
  for (let win of Services.wm.getEnumerator(WINDOW_TYPE)) {
    let existing = shellOf(win)?.tabs.find(t => t.browser?.currentURI?.spec == url);
    if (existing) {
      shellOf(win).selectTab(existing);
      win.focus();
      return;
    }
  }
  await openExtensionWindow(url, { width: 900, height: 700 });
};

/* eslint-disable mozilla/balanced-listeners */
extensions.on("uninstalling", (msg, extension) => {
  if (extension.uninstallURL) {
    shellOf(windowTracker.topWindow)?.openTab(extension.uninstallURL, {
      afterCurrent: true,
      triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
    });
  }
});

extensions.on("page-shutdown", (type, context) => {
  // Close extension tabs when their extension goes away.
  if (context.viewType != "tab") {
    return;
  }
  if (context.extension.id !== context.xulBrowser.contentPrincipal.addonId) {
    return;
  }
  let window = context.xulBrowser.documentGlobal;
  let tab = shellOf(window)?.tabs.find(t => t.browser === context.xulBrowser);
  if (tab) {
    shellOf(window).closeTab(tab);
  }
});
/* eslint-enable mozilla/balanced-listeners */

/**
 * Per-tab and per-window data (browserAction badges and the like), and
 * tab-select / location-change events.
 */
global.TabContext = class extends EventEmitter {
  constructor(getDefaultPrototype) {
    super();
    this.getDefaultPrototype = getDefaultPrototype;
    this.tabData = new WeakMap();
    windowTracker.addListener("progress", this);
    windowTracker.addListener("Breached:TabSelect", this);
  }

  get(keyObject) {
    if (!this.tabData.has(keyObject)) {
      let data = Object.create(this.getDefaultPrototype(keyObject));
      this.tabData.set(keyObject, data);
    }
    return this.tabData.get(keyObject);
  }

  clear(keyObject) {
    this.tabData.delete(keyObject);
  }

  handleEvent(event) {
    if (event.type == "Breached:TabSelect") {
      let nativeTab = event.detail.tab;
      this.emit("tab-select", nativeTab);
      this.emit("location-change", nativeTab);
    }
  }

  onLocationChange(browser, webProgress, request, locationURI, flags) {
    if (!webProgress.isTopLevel) {
      return;
    }
    let tab = tabTracker.getTabForBrowser(browser);
    if (!tab) {
      return;
    }
    let fromBrowse = !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT);
    this.emit("location-change", tab, fromBrowse);
  }

  shutdown() {
    windowTracker.removeListener("progress", this);
    windowTracker.removeListener("Breached:TabSelect", this);
  }
};

class WindowTracker extends WindowTrackerBase {
  isBrowserWindow(window) {
    return window.document.documentElement?.getAttribute("windowtype") === WINDOW_TYPE;
  }

  get topWindow() {
    return Services.wm.getMostRecentWindow(WINDOW_TYPE);
  }

  get topNonPBWindow() {
    return Services.wm.getMostRecentNonPBWindow(WINDOW_TYPE);
  }

  /** The frontmost Breached window that isn't an extension's popup window. */
  getTopNormalWindow() {
    let top = this.topWindow;
    if (!top || !shellOf(top)?.isPopup) {
      return top;
    }
    // A popup window: the window it was opened over, or any other.
    let opener = top.breachedOpener;
    if (opener && !opener.closed) {
      return opener;
    }
    for (let win of Services.wm.getEnumerator(WINDOW_TYPE)) {
      if (!shellOf(win)?.isPopup && !win.closed) {
        return win;
      }
    }
    return top;
  }

  addProgressListener(window, listener) {
    shellOf(window)?.tabsProgressListeners.add(listener);
  }

  removeProgressListener(window, listener) {
    shellOf(window)?.tabsProgressListeners.delete(listener);
  }
}

class TabTracker extends TabTrackerBase {
  constructor() {
    super();
    this._tabs = new WeakMap();
    this._tabIds = new Map();
    this._nextId = 1;
    this._deferredTabOpenEvents = new WeakMap();
    this._handleTabDestroyed = this._handleTabDestroyed.bind(this);
  }

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this._handleWindowOpen = this._handleWindowOpen.bind(this);
    this._handleWindowClose = this._handleWindowClose.bind(this);

    windowTracker.addListener("Breached:TabClose", this);
    windowTracker.addListener("Breached:TabOpen", this);
    windowTracker.addListener("Breached:TabSelect", this);
    windowTracker.addOpenListener(this._handleWindowOpen);
    windowTracker.addCloseListener(this._handleWindowClose);

    /* eslint-disable mozilla/balanced-listeners */
    this.on("tab-removed", this._handleTabDestroyed);
    /* eslint-enable mozilla/balanced-listeners */
  }

  getId(nativeTab) {
    let id = this._tabs.get(nativeTab);
    if (id) {
      return id;
    }
    this.init();
    id = this._nextId++;
    this._tabs.set(nativeTab, id);
    this._tabIds.set(id, nativeTab);
    return id;
  }

  getTabForBrowser(browser) {
    let B = shellOf(browser?.documentGlobal);
    return B?.tabs.find(t => t.browser === browser) ?? null;
  }

  _handleTabDestroyed(event, { nativeTab }) {
    let id = this._tabs.get(nativeTab);
    if (id) {
      this._tabs.delete(nativeTab);
      if (this._tabIds.get(id) === nativeTab) {
        this._tabIds.delete(id);
      }
    }
  }

  getTab(tabId, default_ = undefined) {
    let nativeTab = this._tabIds.get(tabId);
    if (nativeTab) {
      return nativeTab;
    }
    if (default_ !== undefined) {
      return default_;
    }
    throw new ExtensionError(`Invalid tab ID: ${tabId}`);
  }

  setOpener(nativeTab, openerTabId) {
    let opener = openerTabId > -1 ? tabTracker.getTab(openerTabId) : null;
    if (nativeTab.opener !== opener) {
      nativeTab.opener = opener;
      this.emit("tab-openerTabId", { nativeTab, openerTabId });
    }
  }

  deferredForTabOpen(nativeTab) {
    let deferred = this._deferredTabOpenEvents.get(nativeTab);
    if (!deferred) {
      deferred = Promise.withResolvers();
      this._deferredTabOpenEvents.set(nativeTab, deferred);
      deferred.promise.then(() => {
        this._deferredTabOpenEvents.delete(nativeTab);
      });
    }
    return deferred;
  }

  async maybeWaitForTabOpen(nativeTab) {
    let deferred = this._deferredTabOpenEvents.get(nativeTab);
    return deferred && deferred.promise;
  }

  handleEvent(event) {
    let nativeTab = event.detail.tab;
    switch (event.type) {
      case "Breached:TabOpen": {
        // Wait a tick: the new tab may become selected right away, and
        // onCreated should then say active: true.
        let deferred = this.deferredForTabOpen(nativeTab);
        Promise.resolve().then(() => {
          deferred.resolve();
          if (!nativeTab.closed) {
            this.emitCreated(nativeTab);
          }
        });
        break;
      }
      case "Breached:TabClose":
        this.emitRemoved(nativeTab, false);
        break;
      case "Breached:TabSelect": {
        let previous = event.detail.previous;
        this.maybeWaitForTabOpen(nativeTab).then(() => {
          if (!nativeTab.closed) {
            this.emitActivated(nativeTab, previous);
          }
        });
        break;
      }
    }
  }

  _handleWindowOpen(window) {
    let B = shellOf(window);
    if (!B) {
      return;
    }
    for (let nativeTab of B.tabs) {
      this.emitCreated(nativeTab);
    }
    if (B.selected) {
      this.emitActivated(B.selected);
    }
  }

  _handleWindowClose(window) {
    for (let nativeTab of shellOf(window)?.tabs ?? []) {
      this.emitRemoved(nativeTab, true);
    }
  }

  emitActivated(nativeTab, previousTab = undefined) {
    let previousTabId;
    if (previousTab && !previousTab.closed) {
      previousTabId = this.getId(previousTab);
    }
    this.emit("tab-activated", {
      tabId: this.getId(nativeTab),
      previousTabId,
      previousTabIsPrivate: false,
      windowId: windowTracker.getId(nativeTab.documentGlobal),
      nativeTab,
    });
  }

  emitCreated(nativeTab, currentTabSize) {
    this.emit("tab-created", { nativeTab, currentTabSize });
  }

  emitRemoved(nativeTab, isWindowClosing) {
    let windowId = windowTracker.getId(nativeTab.documentGlobal);
    let tabId = this.getId(nativeTab);
    this.emit("tab-removed", { nativeTab, tabId, windowId, isWindowClosing });
  }

  getBrowserData(browser) {
    let window = browser.documentGlobal;
    if (!window) {
      return { tabId: -1, windowId: -1 };
    }
    let nativeTab = this.getTabForBrowser(browser);
    if (nativeTab) {
      return { tabId: this.getId(nativeTab), windowId: windowTracker.getId(window) };
    }
    // Extension popups belong to the window but not to a tab.
    window = window.browsingContext?.topChromeWindow;
    if (!window || !windowTracker.isBrowserWindow(window)) {
      return { tabId: -1, windowId: -1 };
    }
    return { tabId: -1, windowId: windowTracker.getId(window) };
  }

  get activeTab() {
    return shellOf(windowTracker.getTopNormalWindow())?.selected ?? null;
  }
}

windowTracker = new WindowTracker();
tabTracker = new TabTracker();

Object.assign(global, { tabTracker, windowTracker });

class Tab extends TabBase {
  get _favIconUrl() {
    return undefined;
  }

  get attention() {
    return false;
  }

  get audible() {
    let mc = this.nativeTab.browser?.browsingContext?.mediaController;
    return !!mc?.isAudible;
  }

  get autoDiscardable() {
    return !this.nativeTab.pinned;
  }

  get browser() {
    return this.nativeTab.browser;
  }

  get discarded() {
    return !this.nativeTab.browser;
  }

  get frameLoader() {
    return super.frameLoader || { lazyWidth: 0, lazyHeight: 0 };
  }

  get hidden() {
    return false;
  }

  get sharingState() {
    return { camera: false, microphone: false, screen: undefined };
  }

  get cookieStoreId() {
    return getCookieStoreIdForTab(this, this.nativeTab);
  }

  get openerTabId() {
    let opener = this.nativeTab.opener;
    return opener && !opener.closed ? tabTracker.getId(opener) : null;
  }

  get height() {
    return this.frameLoader.lazyHeight;
  }

  get width() {
    return this.frameLoader.lazyWidth;
  }

  get index() {
    return this.nativeTab.index;
  }

  get mutedInfo() {
    return { muted: !!this.nativeTab.browser?.audioMuted };
  }

  get lastAccessed() {
    return this.nativeTab.lastActive;
  }

  get pinned() {
    return this.nativeTab.pinned;
  }

  get active() {
    return this.nativeTab.selected;
  }

  get highlighted() {
    return this.nativeTab.selected;
  }

  get status() {
    return this.nativeTab.busy ? "loading" : "complete";
  }

  get window() {
    return this.nativeTab.documentGlobal;
  }

  get windowId() {
    return windowTracker.getId(this.window);
  }

  get isArticle() {
    return false;
  }

  get isInReaderMode() {
    return false;
  }

  get successorTabId() {
    return -1;
  }

  get groupId() {
    return -1;
  }

  get splitViewId() {
    return -1;
  }

  // A sleeping tab has no <browser>: answer from what the tab remembers.

  get innerWindowID() {
    return this.nativeTab.browser ? super.innerWindowID : null;
  }

  get _incognito() {
    return false;
  }

  get _url() {
    let b = this.nativeTab.browser;
    return b ? b.currentURI.spec : this._sleepingURI?.spec ?? this.nativeTab.url;
  }

  get _uri() {
    let b = this.nativeTab.browser;
    return b ? b.currentURI : this._sleepingURI;
  }

  get _sleepingURI() {
    try {
      return Services.io.newURI(this.nativeTab.url);
    } catch (e) {
      return Services.io.newURI("about:blank");
    }
  }

  get _title() {
    return this.nativeTab.browser?.contentTitle || this.nativeTab.label;
  }
}

class Window extends WindowBase {
  updateGeometry(options) {
    let { window } = this;
    if (options.left !== null || options.top !== null) {
      let left = options.left !== null ? options.left : window.screenX;
      let top = options.top !== null ? options.top : window.screenY;
      window.moveTo(left, top);
    }
    if (options.width !== null || options.height !== null) {
      let width = options.width !== null ? options.width : window.outerWidth;
      let height = options.height !== null ? options.height : window.outerHeight;
      window.resizeTo(width, height);
    }
  }

  get _title() {
    return this.window.document.title;
  }

  setTitlePreface() {}

  get focused() {
    return this.window.document.hasFocus();
  }

  get top() {
    return this.window.screenY;
  }

  get left() {
    return this.window.screenX;
  }

  get width() {
    return this.window.outerWidth;
  }

  get height() {
    return this.window.outerHeight;
  }

  get incognito() {
    return PrivateBrowsingUtils.isWindowPrivate(this.window);
  }

  get alwaysOnTop() {
    return false;
  }

  get isLastFocused() {
    return this.window === windowTracker.topWindow;
  }

  static getState(window) {
    const STATES = {
      [window.STATE_MAXIMIZED]: "maximized",
      [window.STATE_MINIMIZED]: "minimized",
      [window.STATE_FULLSCREEN]: "fullscreen",
      [window.STATE_NORMAL]: "normal",
    };
    return STATES[window.windowState];
  }

  get state() {
    return Window.getState(this.window);
  }

  async setState(state) {
    let { window } = this;
    switch (state) {
      case "maximized":
        window.maximize();
        break;
      case "minimized":
      case "docked":
        window.minimize();
        break;
      case "normal":
        window.fullScreen = false;
        window.restore();
        break;
      case "fullscreen":
        window.fullScreen = true;
        break;
      default:
        throw new Error(`Unexpected window state: ${state}`);
    }
  }

  *getTabs() {
    let { tabManager } = this.extension;
    for (let nativeTab of shellOf(this.window).tabs) {
      let tab = tabManager.getWrapper(nativeTab);
      if (tab) {
        yield tab;
      }
    }
  }

  *getHighlightedTabs() {
    let tab = this.activeTab;
    if (tab) {
      yield tab;
    }
  }

  get activeTab() {
    let selected = shellOf(this.window).selected;
    return selected ? this.extension.tabManager.getWrapper(selected) : null;
  }

  getTabAtIndex(index) {
    let nativeTab = shellOf(this.window).tabs[index];
    if (nativeTab) {
      return this.extension.tabManager.getWrapper(nativeTab);
    }
  }
}

Object.assign(global, { Tab, Window });

class TabManager extends TabManagerBase {
  get(tabId, default_ = undefined) {
    let nativeTab = tabTracker.getTab(tabId, default_);
    if (nativeTab) {
      if (!this.canAccessTab(nativeTab)) {
        throw new ExtensionError(`Invalid tab ID: ${tabId}`);
      }
      return this.getWrapper(nativeTab);
    }
    return default_;
  }

  addActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.addActiveTabPermission(nativeTab);
  }

  revokeActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.revokeActiveTabPermission(nativeTab);
  }

  canAccessTab(nativeTab) {
    return this.extension.canAccessWindow(nativeTab.documentGlobal);
  }

  wrapTab(nativeTab) {
    return new Tab(this.extension, nativeTab, tabTracker.getId(nativeTab));
  }
}

class WindowManager extends WindowManagerBase {
  get(windowId, context) {
    let window = windowTracker.getWindow(windowId, context);
    return this.getWrapper(window);
  }

  *getAll(context) {
    for (let window of windowTracker.browserWindows()) {
      if (!this.canAccessWindow(window, context)) {
        continue;
      }
      let wrapped = this.getWrapper(window);
      if (wrapped) {
        yield wrapped;
      }
    }
  }

  wrapWindow(window) {
    return new Window(this.extension, window, windowTracker.getId(window));
  }
}

// eslint-disable-next-line mozilla/balanced-listeners
extensions.on("startup", (type, extension) => {
  defineLazyGetter(extension, "tabManager", () => new TabManager(extension));
  defineLazyGetter(extension, "windowManager", () => new WindowManager(extension));
});
