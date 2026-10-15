/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// browserAction / action for Breached: each extension with a button gets a
// small icon in #ext-buttons (title bar, or the end of the tab bar), and its
// popup opens in a panel under (or above) it. ":ext <name>" opens it too.

var { ExtensionError, promiseEvent } = ExtensionUtils;
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { BrowserActionBase } = ChromeUtils.importESModule("resource://gre/modules/ExtensionActions.sys.mjs");
var { IconDetails } = ExtensionParent;

const browserActionMap = new WeakMap();
const PANEL_ID = "ext-popup-panel";


class BrowserAction extends BrowserActionBase {
  constructor(extension, buttonDelegate) {
    let tabContext = new TabContext(target => {
      if (ChromeUtils.getClassName(target) == "Window") {
        return this.getContextData(null);
      }
      return tabContext.get(target.documentGlobal);
    });
    super(tabContext, extension);
    this.buttonDelegate = buttonDelegate;
  }

  updateOnChange(target) {
    if (target) {
      if (ChromeUtils.getClassName(target) == "Window") {
        this.buttonDelegate.updateWindow(target);
      } else if (target.selected) {
        this.buttonDelegate.updateWindow(target.documentGlobal);
      }
    } else {
      for (let window of windowTracker.browserWindows()) {
        this.buttonDelegate.updateWindow(window);
      }
    }
  }

  getTab(tabId) {
    return tabId !== null ? tabTracker.getTab(tabId) : null;
  }

  getWindow(windowId) {
    return windowId !== null ? windowTracker.getWindow(windowId) : null;
  }

  dispatchClick(tab, clickInfo) {
    this.buttonDelegate.emit("click", tab, clickInfo);
  }

  isPanelShownBlockingOpenPopup(window) {
    return window.document.getElementById(PANEL_ID)?.state == "open";
  }
}

/** The popup panel and its <browser>. One at a time per window. */
const Popup = {
  async open(window, extension, url, anchor) {
    let doc = window.document;
    let panel = doc.getElementById(PANEL_ID);
    if (panel) {
      panel.hidePopup();
      panel.remove();
    }
    panel = doc.createXULElement("panel");
    panel.id = PANEL_ID;
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("consumeoutsideclicks", "false");
    panel.setAttribute("extension", extension.id);
    let browser = doc.createXULElement("browser");
    for (let [attr, value] of Object.entries({
      type: "content",
      disableglobalhistory: "true",
      messagemanagergroup: "webext-browsers",
      class: "ext-popup-browser",
      "webextension-view-type": "popup",
      autocompletepopup: "PopupAutoComplete",
      constrainpopups: "false",
      initialBrowsingContextGroupId: extension.policy.browsingContextGroupId,
    })) {
      browser.setAttribute(attr, value);
    }
    if (extension.remote) {
      browser.setAttribute("remote", "true");
      browser.setAttribute("remoteType", extension.remoteType);
      browser.setAttribute("maychangeremoteness", "true");
    }
    browser.style.width = "300px";
    browser.style.height = "200px";
    panel.append(browser);
    doc.getElementById("mainPopupSet").append(panel);

    let ready = extension.remote ? promiseEvent(browser, "XULFrameLoaderCreated") : Promise.resolve();
    let listener = {
      receiveMessage({ name, data }) {
        if (name == "Extension:BrowserResized") {
          browser.style.width = `${Math.ceil(data.width)}px`;
          browser.style.height = `${Math.ceil(data.height)}px`;
        }
      },
    };
    let init = () => {
      let mm = browser.messageManager;
      mm.addMessageListener("Extension:BrowserResized", listener);
      browser.addEventListener("DOMWindowClose", () => panel.hidePopup());
      ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
      mm.loadFrameScript("chrome://extensions/content/ext-browser-content.js", false, true);
      mm.sendAsyncMessage("Extension:InitBrowser", {
        allowScriptsToClose: true,
        blockParser: false,
        fixedWidth: false,
        maxWidth: 800,
        maxHeight: 600,
        stylesheets: [],
      });
    };
    browser.addEventListener("DidChangeBrowserRemoteness", init);
    panel.addEventListener(
      "popuphidden",
      () => {
        panel.remove();
      },
      { once: true }
    );

    let visible = anchor && anchor.getBoundingClientRect().width > 0;
    let atBottom = visible && anchor.getBoundingClientRect().top > window.innerHeight / 2;
    if (visible) {
      panel.openPopup(anchor, atBottom ? "before_end" : "after_end");
    } else {
      // No button showing (hidden tab bar): top right corner of the page.
      let content = doc.getElementById("content");
      panel.openPopup(content, "overlap", content.clientWidth - 8, 8);
    }
    await ready;
    init();
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: extension.principal });
    return panel;
  },

  close(window) {
    window.document.getElementById(PANEL_ID)?.hidePopup();
  },
};

this.browserAction = class extends ExtensionAPIPersistent {
  static for(extension) {
    return browserActionMap.get(extension);
  }

  async onManifestEntry() {
    let { extension } = this;
    this.action = new BrowserAction(extension, this);
    await this.action.loadIconData();
    this.id = `ext-button-${makeWidgetId(extension.id)}`;
    browserActionMap.set(extension, this);

    this._onWindowOpen = window => this.addButton(window);
    windowTracker.addOpenListener(this._onWindowOpen);
    for (let window of windowTracker.browserWindows()) {
      this.addButton(window);
    }
  }

  onShutdown() {
    browserActionMap.delete(this.extension);
    this.action.onShutdown();
    windowTracker.removeOpenListener(this._onWindowOpen);
    for (let window of windowTracker.browserWindows()) {
      window.document.getElementById(this.id)?.remove();
      let panel = window.document.getElementById(PANEL_ID);
      if (panel?.getAttribute("extension") == this.extension.id) {
        panel.hidePopup();
      }
    }
  }

  addButton(window) {
    let doc = window.document;
    let box = doc.getElementById("ext-buttons");
    if (!box || doc.getElementById(this.id)) {
      return;
    }
    let button = doc.createElement("button");
    button.id = this.id;
    button.className = "ext-button";
    button.setAttribute("tabindex", "-1");
    button.dataset.extensionId = this.extension.id;
    let img = doc.createElement("img");
    img.alt = "";
    let badge = doc.createElement("span");
    badge.className = "ext-badge";
    button.append(img, badge);
    button.addEventListener("click", event => {
      if (event.button == 0) {
        this.trigger(window, { button: 0, modifiers: clickModifiersFromEvent(event) });
      }
    });
    button.addEventListener("auxclick", event => {
      if (event.button == 1) {
        this.trigger(window, { button: 1, modifiers: clickModifiersFromEvent(event) });
      }
    });
    box.append(button);
    this.updateWindow(window);
  }

  /** Clicked (or :ext): open the popup, or tell the extension. */
  async trigger(window, clickInfo = { button: 0, modifiers: [] }) {
    let tab = shellOf(window).selected;
    let panel = window.document.getElementById(PANEL_ID);
    if (panel?.state == "open" && panel.getAttribute("extension") == this.extension.id) {
      panel.hidePopup();
      return;
    }
    let popupURL = this.action.triggerClickOrPopup(tab, clickInfo);
    if (popupURL) {
      await Popup.open(window, this.extension, popupURL, window.document.getElementById(this.id));
    }
  }

  updateWindow(window) {
    let button = window.document.getElementById(this.id);
    if (!button) {
      return;
    }
    let tab = shellOf(window).selected;
    let data = tab ? this.action.getContextData(tab) : this.action.getContextData(null);
    button.title = data.title || this.extension.name;
    button.disabled = !data.enabled;
    let icon = IconDetails.getPreferredIcon(data.icon ?? {}, this.extension, 16).icon;
    let img = button.querySelector("img");
    if (icon) {
      img.src = icon;
    } else {
      img.removeAttribute("src");
    }
    let badge = button.querySelector(".ext-badge");
    badge.textContent = data.badgeText || "";
    badge.hidden = !data.badgeText;
    let bg = data.badgeBackgroundColor;
    if (bg) {
      badge.style.backgroundColor = `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, ${bg[3] / 255})`;
      let fg = this.action.getTextColor(data);
      badge.style.color = `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${fg[3] / 255})`;
    }
  }

  PERSISTENT_EVENTS = {
    onClicked({ context, fire }) {
      const { extension } = this;
      const { tabManager } = extension;
      async function listener(_event, tab, clickInfo) {
        if (fire.wakeup) {
          await fire.wakeup();
        }
        context?.withPendingBrowser(tab.linkedBrowser, () => fire.sync(tabManager.convert(tab), clickInfo));
      }
      this.on("click", listener);
      return {
        unregister: () => {
          this.off("click", listener);
        },
        convert(newFire, extContext) {
          fire = newFire;
          context = extContext;
        },
      };
    },
    onUserSettingsChanged({ fire }) {
      return {
        unregister: () => {},
        convert(newFire) {
          fire = newFire;
        },
      };
    },
  };

  getAPI(context) {
    let { extension } = context;
    let { action } = this;
    let namespace = extension.manifestVersion < 3 ? "browserAction" : "action";

    return {
      [namespace]: {
        ...action.api(context),

        onClicked: new EventManager({
          context,
          module: "browserAction",
          event: "onClicked",
          inputHandling: true,
          extensionApi: this,
        }).api(),

        onUserSettingsChanged: new EventManager({
          context,
          module: "browserAction",
          event: "onUserSettingsChanged",
          extensionApi: this,
        }).api(),

        getUserSettings: () => ({ isOnToolbar: true }),

        openPopup: async options => {
          const window =
            typeof options?.windowId === "number"
              ? windowTracker.getWindow(options.windowId, context)
              : windowTracker.getTopNormalWindow(context);
          let tab = shellOf(window).selected;
          let url = action.getPopupUrl(tab, true);
          if (url) {
            action.throwIfOpenPopupIsBlockedByAnyAction(window);
            await Popup.open(window, extension, url, window.document.getElementById(this.id));
          }
        },
      },
    };
  }
};

global.browserActionFor = this.browserAction.for;

