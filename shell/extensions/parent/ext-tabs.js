/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The tabs API for Breached's tabs. Adapted from Firefox's
// browser/components/extensions/parent/ext-tabs.js, without the parts
// Breached has no equivalent for (tab groups, hiding, reader mode, sharing).

var { ExtensionError } = ExtensionUtils;

const allProperties = new Set([
  "audible",
  "discarded",
  "favIconUrl",
  "mutedInfo",
  "openerTabId",
  "pinned",
  "status",
  "title",
  "url",
]);
const restricted = new Set(["url", "favIconUrl", "title"]);


this.tabs = class extends ExtensionAPIPersistent {
  tabEventRegistrar({ event, listener }) {
    let { extension } = this;
    let { tabManager } = extension;
    return ({ fire }) => {
      let listener2 = (eventName, eventData, ...args) => {
        if (!tabManager.canAccessTab(eventData.nativeTab)) {
          return;
        }
        listener(fire, eventData, ...args);
      };
      tabTracker.on(event, listener2);
      return {
        unregister() {
          tabTracker.off(event, listener2);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    };
  }

  PERSISTENT_EVENTS = {
    onActivated: this.tabEventRegistrar({
      event: "tab-activated",
      listener: (fire, event) => {
        let { tabId, windowId, previousTabId } = event;
        fire.async({ tabId, previousTabId, windowId });
      },
    }),
    onCreated: this.tabEventRegistrar({
      event: "tab-created",
      listener: (fire, event) => {
        let { tabManager } = this.extension;
        fire.async(tabManager.convert(event.nativeTab, event.currentTabSize));
      },
    }),
    onRemoved: this.tabEventRegistrar({
      event: "tab-removed",
      listener: (fire, event) => {
        fire.async(event.tabId, {
          windowId: event.windowId,
          isWindowClosing: event.isWindowClosing,
        });
      },
    }),
    onMoved({ fire }) {
      let { tabManager } = this.extension;
      let moveListener = event => {
        let { tab: nativeTab, from, to } = event.detail;
        if (tabManager.canAccessTab(nativeTab)) {
          fire.async(tabTracker.getId(nativeTab), {
            windowId: windowTracker.getId(nativeTab.documentGlobal),
            fromIndex: from,
            toIndex: to,
          });
        }
      };
      windowTracker.addListener("Breached:TabMove", moveListener);
      return {
        unregister() {
          windowTracker.removeListener("Breached:TabMove", moveListener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },

    onHighlighted({ fire }) {
      let listener = (eventName, event) => {
        fire.async({ tabIds: [event.tabId], windowId: event.windowId });
      };
      tabTracker.on("tab-activated", listener);
      return {
        unregister() {
          tabTracker.off("tab-activated", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },

    onUpdated({ fire, context }, params) {
      let { extension } = this;
      let { tabManager } = extension;
      let [filterProps] = params;
      let filter = { ...filterProps };
      if (filter.urls) {
        filter.urls = new MatchPatternSet(filter.urls, { restrictSchemes: false });
      }
      filter.properties = filter.properties ? new Set(filter.properties) : allProperties;

      function sanitize(tab, changeInfo) {
        let result = {};
        let nonempty = false;
        for (let prop in changeInfo) {
          if (!restricted.has(prop) || tab.hasTabPermission) {
            nonempty = true;
            result[prop] = changeInfo[prop];
          }
        }
        return nonempty && result;
      }

      function getWindowID(windowId) {
        if (windowId === Window.WINDOW_ID_CURRENT) {
          let window = windowTracker.getTopWindow(context);
          return window ? windowTracker.getId(window) : undefined;
        }
        return windowId;
      }

      function matchFilters(tab) {
        if (!filterProps) {
          return true;
        }
        if (filter.tabId != null && tab.id != filter.tabId) {
          return false;
        }
        if (filter.windowId != null && tab.windowId != getWindowID(filter.windowId)) {
          return false;
        }
        if (filter.cookieStoreId != null && filter.cookieStoreId !== tab.cookieStoreId) {
          return false;
        }
        if (filter.urls) {
          return filter.urls.matches(tab._uri) && tab.hasTabPermission;
        }
        return true;
      }

      let fireForTab = (tab, changed, nativeTab) => {
        if (!tab || !matchFilters(tab)) {
          return;
        }
        let changeInfo = sanitize(tab, changed);
        if (changeInfo) {
          tabTracker.maybeWaitForTabOpen(nativeTab).then(() => {
            if (!nativeTab.closed) {
              fire.async(tab.id, changeInfo, tab.convert());
            }
          });
        }
      };

      let attrListener = event => {
        let { tab: nativeTab, changed } = event.detail;
        if (nativeTab.closed) {
          return;
        }
        let needed = [];
        if (changed.includes("label") && filter.properties.has("title")) {
          needed.push("title");
        }
        if (changed.includes("pinned") && filter.properties.has("pinned")) {
          needed.push("pinned");
        }
        if (changed.includes("discarded") && filter.properties.has("discarded")) {
          needed.push("discarded");
        }
        if (!needed.length) {
          return;
        }
        let tab = tabManager.getWrapper(nativeTab);
        let changeInfo = {};
        for (let prop of needed) {
          changeInfo[prop] = tab[prop];
        }
        fireForTab(tab, changeInfo, nativeTab);
      };

      let statusListener = ({ browser, status, url }) => {
        let nativeTab = tabTracker.getTabForBrowser(browser);
        if (!nativeTab) {
          return;
        }
        let changed = {};
        if (filter.properties.has("status")) {
          changed.status = status;
        }
        if (url && filter.properties.has("url")) {
          changed.url = url;
        }
        fireForTab(tabManager.wrapTab(nativeTab), changed, nativeTab);
      };

      let openerTabIdChangeListener = (_, { nativeTab, openerTabId }) => {
        fireForTab(tabManager.getWrapper(nativeTab), { openerTabId }, nativeTab);
      };

      windowTracker.addListener("status", statusListener);
      windowTracker.addListener("Breached:TabAttrModified", attrListener);
      tabTracker.on("tab-openerTabId", openerTabIdChangeListener);
      return {
        unregister() {
          windowTracker.removeListener("status", statusListener);
          windowTracker.removeListener("Breached:TabAttrModified", attrListener);
          tabTracker.off("tab-openerTabId", openerTabIdChangeListener);
        },
        convert(_fire, _context) {
          fire = _fire;
          context = _context;
        },
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    let { tabManager } = extension;
    let extensionApi = this;
    let module = "tabs";

    function getTabOrActive(tabId) {
      let tab = tabId !== null ? tabTracker.getTab(tabId) : tabTracker.activeTab;
      if (!tab || !tabManager.canAccessTab(tab)) {
        throw new ExtensionError(tabId === null ? "Cannot access activeTab" : `Invalid tab ID: ${tabId}`);
      }
      return tab;
    }

    function getNativeTabsFromIDArray(tabIds) {
      if (!Array.isArray(tabIds)) {
        tabIds = [tabIds];
      }
      return tabIds.map(tabId => {
        let tab = tabTracker.getTab(tabId);
        if (!tabManager.canAccessTab(tab)) {
          throw new ExtensionError(`Invalid tab ID: ${tabId}`);
        }
        return tab;
      });
    }

    async function promiseTabWhenReady(tabId) {
      let tab = tabId !== null ? tabManager.get(tabId) : tabManager.getWrapper(tabTracker.activeTab);
      if (!tab) {
        throw new ExtensionError(tabId == null ? "Cannot access activeTab" : `Invalid tab ID: ${tabId}`);
      }
      if (!tab.nativeTab.browser) {
        throw new ExtensionError("The tab is unloaded");
      }
      await tabTracker.awaitTabReady(tab.nativeTab);
      return tab;
    }

    function principalFor(url) {
      return Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(url), {});
    }

    let events = {};
    for (let event of ["onActivated", "onCreated", "onHighlighted", "onRemoved", "onMoved", "onUpdated"]) {
      events[event] = new EventManager({ context, module, event, extensionApi }).api();
    }
    for (let event of ["onAttached", "onDetached", "onReplaced", "onZoomChange"]) {
      events[event] = new EventManager({
        context,
        name: `tabs.${event}`,
        register: () => () => {},
      }).api();
    }

    return {
      tabs: {
        ...events,

        async create(createProperties) {
          let window =
            createProperties.windowId !== null
              ? windowTracker.getWindow(createProperties.windowId, context)
              : windowTracker.getTopNormalWindow(context);
          if (!window || !context.canAccessWindow(window)) {
            throw new ExtensionError("Not allowed to create tabs on the target window");
          }
          let B = shellOf(window);
          // The extension's own pages open as a pop-up window on top, not a tab.
          let resolved = createProperties.url !== null && context.uri.resolve(createProperties.url);
          if (resolved && ExtensionUtils.isExtensionUrl(resolved) && createProperties.windowId === null) {
            let popup = await openExtensionWindow(resolved, { width: 900, height: 700 });
            return tabManager.convert(shellOf(popup).selected);
          }
          let options = { triggeringPrincipal: context.principal };
          let url;
          if (createProperties.url !== null) {
            url = context.uri.resolve(createProperties.url);
            if (!ExtensionUtils.isExtensionUrl(url) && !context.checkLoadURL(url, { dontReportErrors: true })) {
              throw new ExtensionError(`Illegal URL: ${url}`);
            }
            if (ExtensionUtils.isExtensionUrl(url)) {
              options.triggeringPrincipal = principalFor(url);
            }
          } else {
            url = B.homepage();
            options.triggeringPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
          }
          if (createProperties.openerTabId !== null) {
            options.opener = tabTracker.getTab(createProperties.openerTabId);
          }
          if (createProperties.index != null) {
            options.index = Math.max(0, Math.min(createProperties.index, B.tabs.length));
          }
          let active = createProperties.active !== null ? createProperties.active : !createProperties.discarded;
          if (createProperties.discarded) {
            if (active) {
              throw new ExtensionError("Active tabs cannot be created and discarded.");
            }
            options.asleep = true;
            options.title = createProperties.title ?? "";
          }
          options.background = !active;
          let nativeTab = B.openTab(url, options);
          if (createProperties.pinned) {
            nativeTab.pinned = true;
            nativeTab.update();
          }
          if (nativeTab.browser) {
            tabTracker.addTabReadyBlocker(nativeTab);
          }
          return tabManager.convert(nativeTab);
        },

        async remove(tabIds) {
          for (let nativeTab of getNativeTabsFromIDArray(tabIds)) {
            shellOf(nativeTab.documentGlobal).closeTab(nativeTab);
          }
        },

        async discard(tabIds) {
          for (let nativeTab of getNativeTabsFromIDArray(tabIds)) {
            shellOf(nativeTab.documentGlobal).sleep(nativeTab);
          }
        },

        async update(tabId, updateProperties) {
          let nativeTab = getTabOrActive(tabId);
          let B = shellOf(nativeTab.documentGlobal);
          if (updateProperties.url !== null) {
            let url = context.uri.resolve(updateProperties.url);
            let triggeringPrincipal = context.principal;
            if (!context.checkLoadURL(url, { dontReportErrors: true })) {
              if (ExtensionUtils.isExtensionUrl(url)) {
                triggeringPrincipal = principalFor(url);
              } else {
                throw new ExtensionError(`Illegal URL: ${url}`);
              }
            }
            if (!nativeTab.browser) {
              nativeTab.history = null;
              nativeTab.url = url;
              B.wake(nativeTab);
            } else {
              nativeTab.url = url;
              B.load(nativeTab.browser, url, { triggeringPrincipal });
            }
          }
          if (updateProperties.active) {
            B.selectTab(nativeTab);
          }
          if (updateProperties.highlighted) {
            B.selectTab(nativeTab);
          }
          if (updateProperties.muted !== null && nativeTab.browser) {
            if (updateProperties.muted) {
              nativeTab.browser.mute();
            } else {
              nativeTab.browser.unmute();
            }
          }
          if (updateProperties.pinned !== null && updateProperties.pinned != nativeTab.pinned) {
            nativeTab.pinned = updateProperties.pinned;
            nativeTab.update();
            B.emit("TabAttrModified", { tab: nativeTab, changed: ["pinned"] });
          }
          if (updateProperties.openerTabId !== null) {
            tabTracker.setOpener(nativeTab, updateProperties.openerTabId);
          }
          return tabManager.convert(nativeTab);
        },

        async reload(tabId, reloadProperties) {
          let nativeTab = getTabOrActive(tabId);
          if (!nativeTab.browser) {
            shellOf(nativeTab.documentGlobal).wake(nativeTab);
            return;
          }
          let flags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
          if (reloadProperties && reloadProperties.bypassCache) {
            flags |= Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE;
          }
          nativeTab.browser.reloadWithFlags(flags);
        },

        async warmup() {},

        async get(tabId) {
          return tabManager.get(tabId).convert();
        },

        getCurrent() {
          let tabData;
          if (context.tabId) {
            tabData = tabManager.get(context.tabId).convert();
          }
          return Promise.resolve(tabData);
        },

        async query(queryInfo) {
          return Array.from(tabManager.query(queryInfo, context), tab => tab.convert());
        },

        async captureTab(tabId, options) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.capture(context, tab.nativeTab.browser.fullZoom, options);
        },

        async captureVisibleTab(windowId, options) {
          let window = windowId == null ? windowTracker.getTopWindow(context) : windowTracker.getWindow(windowId, context);
          let tab = tabManager.getWrapper(shellOf(window).selected);
          if (!extension.hasPermission("<all_urls>") && !tab.hasActiveTabPermission) {
            throw new ExtensionError("Missing activeTab permission");
          }
          await tabTracker.awaitTabReady(tab.nativeTab);
          return tab.capture(context, tab.nativeTab.browser.fullZoom, options);
        },

        async detectLanguage(tabId) {
          let tab = await promiseTabWhenReady(tabId);
          let results = await tab.queryContent("DetectLanguage", {});
          return results[0];
        },

        async executeScript(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.executeScript(context, details);
        },

        async insertCSS(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.insertCSS(context, details);
        },

        async removeCSS(tabId, details) {
          let tab = await promiseTabWhenReady(tabId);
          return tab.removeCSS(context, details);
        },

        async move(tabIds, moveProperties) {
          let moved = [];
          let nativeTabs = getNativeTabsFromIDArray(tabIds);
          let index = moveProperties.index;
          for (let nativeTab of nativeTabs) {
            let B = shellOf(nativeTab.documentGlobal);
            let to = index == -1 ? B.tabs.length - 1 : Math.min(index, B.tabs.length - 1);
            B.moveTab(nativeTab, to);
            moved.push(nativeTab);
            if (index != -1) {
              index = nativeTab.index + 1;
            }
          }
          return moved.map(nativeTab => tabManager.convert(nativeTab));
        },

        async duplicate(tabId, duplicateProperties) {
          let nativeTab = getTabOrActive(tabId);
          let B = shellOf(nativeTab.documentGlobal);
          let active = duplicateProperties?.active ?? true;
          let index = duplicateProperties?.index ?? nativeTab.index + 1;
          let copy = B.openTab(nativeTab.url, {
            index,
            background: !active,
            history: B.collectHistory(nativeTab),
          });
          return tabManager.convert(copy);
        },

        async getZoom(tabId) {
          let nativeTab = getTabOrActive(tabId);
          return nativeTab.browser?.fullZoom ?? 1;
        },

        async setZoom(tabId, zoom) {
          let nativeTab = getTabOrActive(tabId);
          if (nativeTab.browser) {
            nativeTab.browser.fullZoom = zoom === 0 ? 1 : zoom;
          }
        },

        async getZoomSettings() {
          return { mode: "automatic", scope: "per-tab", defaultZoomFactor: 1 };
        },

        async setZoomSettings() {
          throw new ExtensionError("Zoom settings can't be changed in Breached");
        },

        async goForward(tabId) {
          getTabOrActive(tabId).browser?.goForward();
        },

        async goBack(tabId) {
          getTabOrActive(tabId).browser?.goBack();
        },

        async highlight(highlightInfo) {
          let { windowId, tabs } = highlightInfo;
          let window = windowTracker.getWindow(windowId, context);
          let B = shellOf(window);
          let first = Array.isArray(tabs) ? tabs[0] : tabs;
          let nativeTab = B.tabs[first];
          if (!nativeTab) {
            throw new ExtensionError(`No tab at index: ${first}`);
          }
          B.selectTab(nativeTab);
          return extension.windowManager.convert(window, { populate: true });
        },

        show() {},
        hide() {
          return [];
        },
      },
    };
  }
};
