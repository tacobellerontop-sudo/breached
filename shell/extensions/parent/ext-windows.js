/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The windows API. windows.create opens the page as a small window on top of
// Breached (like Bitwarden's passkey window), so the page you were on stays.

var { ExtensionError } = ExtensionUtils;

this.windows = class extends ExtensionAPIPersistent {
  windowEventRegistrar(event, listener) {
    let { extension } = this;
    return ({ fire }) => {
      let listener2 = (window, ...args) => {
        if (extension.canAccessWindow(window)) {
          listener(fire, window, ...args);
        }
      };
      windowTracker.addListener(event, listener2);
      return {
        unregister() {
          windowTracker.removeListener(event, listener2);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    };
  }

  PERSISTENT_EVENTS = {
    onCreated: this.windowEventRegistrar("domwindowopened", (fire, window) => {
      fire.async(this.extension.windowManager.convert(window));
    }),
    onRemoved: this.windowEventRegistrar("domwindowclosed", (fire, window) => {
      fire.async(windowTracker.getId(window));
    }),
    onFocusChanged({ fire }) {
      let { extension } = this;
      let last;
      let listener = () => {
        Promise.resolve().then(() => {
          let windowId = Window.WINDOW_ID_NONE;
          let window = Services.focus.activeWindow;
          if (window && extension.canAccessWindow(window) && windowTracker.isBrowserWindow(window)) {
            windowId = windowTracker.getId(window);
          }
          if (windowId !== last) {
            fire.async(windowId);
            last = windowId;
          }
        });
      };
      windowTracker.addListener("focus", listener);
      windowTracker.addListener("blur", listener);
      return {
        unregister() {
          windowTracker.removeListener("focus", listener);
          windowTracker.removeListener("blur", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    const { windowManager, tabManager } = extension;

    let event = name =>
      new EventManager({ context, module: "windows", event: name, extensionApi: this }).api();

    let currentWindow = () => {
      let window = context.currentWindow || windowTracker.topWindow;
      if (!window || !context.canAccessWindow(window)) {
        throw new ExtensionError("Invalid window");
      }
      return window;
    };

    return {
      windows: {
        onCreated: event("onCreated"),
        onRemoved: event("onRemoved"),
        onFocusChanged: event("onFocusChanged"),

        async get(windowId, getInfo) {
          let window = windowTracker.getWindow(windowId, context);
          if (!window || !context.canAccessWindow(window)) {
            throw new ExtensionError(`Invalid window ID: ${windowId}`);
          }
          return windowManager.convert(window, getInfo);
        },

        async getCurrent(getInfo) {
          return windowManager.convert(currentWindow(), getInfo);
        },

        async getLastFocused(getInfo) {
          let window = windowTracker.topWindow;
          if (!window || !context.canAccessWindow(window)) {
            throw new ExtensionError("Invalid window");
          }
          return windowManager.convert(window, getInfo);
        },

        async getAll(getInfo) {
          let doPopulate = getInfo && getInfo.populate;
          let windows = Array.from(windowManager.getAll(context), win => win.convert({ populate: doPopulate }));
          return windows;
        },

        async create(createData) {
          let window = windowTracker.topWindow;
          if (!window) {
            throw new ExtensionError("No browser window");
          }
          let B = window.Breached;
          if (createData.url != null) {
            let url = context.uri.resolve(Array.isArray(createData.url) ? createData.url[0] : createData.url);
            if (!ExtensionUtils.isExtensionUrl(url) && !context.checkLoadURL(url, { dontReportErrors: true })) {
              throw new ExtensionError(`Illegal URL: ${url}`);
            }
            let popup = await openExtensionWindow(url, createData);
            return windowManager.convert(popup, { populate: true });
          }
          let urls = createData.url == null ? [] : Array.isArray(createData.url) ? createData.url : [createData.url];
          if (createData.tabId != null) {
            let tab = tabTracker.getTab(createData.tabId);
            B.selectTab(tab);
          }
          let first = null;
          for (let url of urls) {
            url = context.uri.resolve(url);
            if (!ExtensionUtils.isExtensionUrl(url) && !context.checkLoadURL(url, { dontReportErrors: true })) {
              throw new ExtensionError(`Illegal URL: ${url}`);
            }
            let triggeringPrincipal = ExtensionUtils.isExtensionUrl(url)
              ? Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(url), {})
              : context.principal;
            let tab = B.openTab(url, { afterCurrent: true, background: !!first, triggeringPrincipal });
            first ??= tab;
          }
          if (!urls.length && createData.tabId == null) {
            B.newTab();
          }
          return windowManager.convert(window, { populate: true });
        },

        async update(windowId, updateInfo) {
          let window = windowTracker.getWindow(windowId, context);
          let win = windowManager.getWrapper(window);
          if (updateInfo.focused) {
            Services.focus.activeWindow = window;
          }
          if (updateInfo.state && updateInfo.state != "normal") {
            await win.setState(updateInfo.state);
          } else if (updateInfo.state == "normal") {
            await win.setState("normal");
          }
          if (updateInfo.left !== null || updateInfo.top !== null || updateInfo.width !== null || updateInfo.height !== null) {
            win.updateGeometry(updateInfo);
          }
          return win.convert();
        },

        async remove(windowId) {
          let window = windowTracker.getWindow(windowId, context);
          window.close();
        },
      },
    };
  }
};
