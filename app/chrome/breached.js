/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached's qutebrowser-style interface: a one-line status bar at the bottom
// of the window and a ":" command line in it. Loaded by browser.xhtml.

"use strict";

var Breached = {
  history: [],
  historyIndex: -1,
  messageTimer: null,

  get el() {
    delete this.el;
    let byId = id => document.getElementById(id);
    return (this.el = {
      bar: byId("breached-statusbar"),
      prompt: byId("breached-prompt"),
      input: byId("breached-commandline"),
      message: byId("breached-message"),
      url: byId("breached-url"),
      progress: byId("breached-progress"),
      tabIndex: byId("breached-tabindex"),
    });
  },

  init() {
    if (!window.gBrowser || !this.el.bar) {
      return;
    }
    gBrowser.addProgressListener(this.progressListener);
    let tabs = gBrowser.tabContainer;
    for (let type of ["TabSelect", "TabOpen", "TabClose", "TabMove"]) {
      tabs.addEventListener(type, () => this.updateTabIndex());
    }
    this.el.input.addEventListener("keydown", e => this.onCommandLineKey(e));
    this.el.input.addEventListener("blur", () => this.closeCommandLine({ refocus: false }));
    // ":" while focus is in the browser chrome (not a page or text field).
    window.addEventListener("keydown", e => this.onChromeKey(e), true);
    this.updateUrl();
    this.updateTabIndex();
  },

  // ---- Status bar ----

  progressListener: {
    onLocationChange() {
      Breached.updateUrl();
    },
    onSecurityChange() {
      Breached.updateUrl();
    },
    onStateChange(webProgress, request, flags) {
      if (!webProgress.isTopLevel) {
        return;
      }
      if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
        Breached.el.progress.textContent = "";
      }
    },
    onProgressChange(webProgress, request, curSelf, maxSelf, curTotal, maxTotal) {
      if (webProgress.isTopLevel && maxTotal > 0 && curTotal < maxTotal) {
        Breached.el.progress.textContent = `[${Math.floor((curTotal / maxTotal) * 100)}%]`;
      }
    },
    QueryInterface: ChromeUtils.generateQI([
      "nsIWebProgressListener",
      "nsISupportsWeakReference",
    ]),
  },

  updateUrl() {
    let uri = gBrowser.currentURI;
    let spec = uri?.spec ?? "";
    let url = this.el.url;
    url.textContent = spec == "about:blank" ? "" : spec;
    url.classList.toggle("secure", !!uri && uri.schemeIs("https"));
    url.classList.toggle("insecure", !!uri && uri.schemeIs("http"));
  },

  updateTabIndex() {
    let tabs = gBrowser.visibleTabs;
    let index = tabs.indexOf(gBrowser.selectedTab) + 1;
    this.el.tabIndex.textContent = `[${index}/${tabs.length}]`;
  },

  showMessage(text, kind = "info") {
    let message = this.el.message;
    message.textContent = text;
    message.className = kind;
    message.hidden = false;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (message.hidden = true), 4000);
  },

  // ---- Command line ----

  openCommandLine(text = "") {
    let { input, prompt, url } = this.el;
    this.el.message.hidden = true;
    prompt.hidden = false;
    input.hidden = false;
    url.hidden = true;
    input.value = text;
    this.historyIndex = -1;
    input.focus();
    input.setSelectionRange(text.length, text.length);
  },

  closeCommandLine({ refocus = true } = {}) {
    let { input, prompt, url } = this.el;
    if (input.hidden) {
      return;
    }
    input.hidden = true;
    prompt.hidden = true;
    url.hidden = false;
    if (refocus) {
      gBrowser.selectedBrowser.focus();
    }
  },

  onChromeKey(event) {
    if (event.key != ":" || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    let focused = document.activeElement;
    let inText =
      focused &&
      (focused.localName == "input" ||
        focused.localName == "textarea" ||
        focused.isContentEditable ||
        focused.closest?.("#urlbar, findbar"));
    // Pages handle their own ":" through the BreachedKeys actor.
    if (inText || focused == gBrowser.selectedBrowser) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openCommandLine();
  },

  onCommandLineKey(event) {
    let input = this.el.input;
    switch (event.key) {
      case "Escape":
        this.closeCommandLine();
        break;
      case "Enter": {
        let text = input.value.trim();
        this.closeCommandLine();
        if (text) {
          this.history.unshift(text);
          this.history.length = Math.min(this.history.length, 100);
          this.run(text);
        }
        break;
      }
      case "ArrowUp":
      case "ArrowDown": {
        let step = event.key == "ArrowUp" ? 1 : -1;
        let next = Math.min(Math.max(this.historyIndex + step, -1), this.history.length - 1);
        this.historyIndex = next;
        input.value = next == -1 ? "" : this.history[next];
        break;
      }
      case "Tab":
        this.complete();
        break;
      case "Backspace":
        if (!input.value) {
          this.closeCommandLine();
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  },

  // Completes a command name, or lists the candidates.
  complete() {
    let input = this.el.input;
    let [word, ...rest] = input.value.split(" ");
    if (rest.length) {
      return;
    }
    let names = Object.keys(this.commands).filter(n => n.startsWith(word));
    if (names.length == 1) {
      input.value = names[0] + " ";
    } else if (names.length > 1) {
      this.showMessage(names.join("  "));
    }
  },

  run(text) {
    let [name, ...args] = text.split(/\s+/);
    let command = this.commands[this.aliases[name] ?? name];
    if (!command) {
      this.showMessage(`${name}: no such command`, "error");
      return;
    }
    try {
      command.run.call(this, args, text.slice(name.length).trim());
    } catch (e) {
      console.error(e);
      this.showMessage(`${name}: ${e.message}`, "error");
    }
  },

  // ---- Commands ----

  // Turns typed text into a URL: an address, or a search with the default engine.
  urlFor(text) {
    let info = Services.uriFixup.getFixupURIInfo(
      text,
      Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP |
        Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
    );
    let uri = info.preferredURI;
    if (!uri || uri.schemeIs("javascript") || uri.schemeIs("data")) {
      throw new Error("can't open that");
    }
    return uri.spec;
  },

  tabAt(n) {
    let tabs = gBrowser.visibleTabs;
    let tab = tabs[n - 1];
    if (!tab) {
      throw new Error(`no tab ${n}`);
    }
    return tab;
  },

  aliases: {
    o: "open",
    O: "tabopen",
    q: "close",
    qa: "quit",
    d: "tab-close",
    u: "undo",
    b: "back",
    f: "forward",
    r: "reload",
  },

  commands: {
    open: {
      help: "open [-t] URL or search terms",
      run(args, rest) {
        let where = "current";
        if (args[0] == "-t") {
          where = "tab";
          rest = rest.slice(2).trim();
        }
        if (!rest) {
          throw new Error("give a URL or search terms");
        }
        openTrustedLinkIn(this.urlFor(rest), where);
      },
    },
    tabopen: {
      help: "tabopen URL or search terms (new tab)",
      run(args, rest) {
        if (!rest) {
          openTrustedLinkIn("about:blank", "tab");
          return;
        }
        openTrustedLinkIn(this.urlFor(rest), "tab");
      },
    },
    "tab-close": {
      help: "tab-close [N]",
      run(args) {
        let tab = args[0] ? this.tabAt(Number(args[0])) : gBrowser.selectedTab;
        gBrowser.removeTab(tab, { animate: false });
      },
    },
    "tab-only": {
      help: "tab-only: close all other tabs",
      run() {
        gBrowser.removeAllTabsBut(gBrowser.selectedTab);
      },
    },
    "tab-next": {
      help: "tab-next",
      run() {
        gBrowser.tabContainer.advanceSelectedTab(1, true);
      },
    },
    "tab-prev": {
      help: "tab-prev",
      run() {
        gBrowser.tabContainer.advanceSelectedTab(-1, true);
      },
    },
    "tab-focus": {
      help: "tab-focus N (or 'last')",
      run(args) {
        let tabs = gBrowser.visibleTabs;
        gBrowser.selectedTab =
          args[0] == "last" ? tabs[tabs.length - 1] : this.tabAt(Number(args[0]));
      },
    },
    "tab-pin": {
      help: "tab-pin: pin or unpin this tab",
      run() {
        let tab = gBrowser.selectedTab;
        if (tab.pinned) {
          gBrowser.unpinTab(tab);
        } else {
          gBrowser.pinTab(tab);
        }
      },
    },
    "tab-sleep": {
      help: "tab-sleep: unload every tab except this one",
      run() {
        let count = 0;
        for (let tab of gBrowser.visibleTabs) {
          if (!tab.selected && tab.linkedPanel && gBrowser.discardBrowser(tab)) {
            count++;
          }
        }
        this.showMessage(`${count} tab(s) asleep`);
      },
    },
    undo: {
      help: "undo: reopen the last closed tab",
      run() {
        SessionWindowUI.undoCloseTab(window);
      },
    },
    back: {
      help: "back",
      run() {
        BrowserCommands.back();
      },
    },
    forward: {
      help: "forward",
      run() {
        BrowserCommands.forward();
      },
    },
    reload: {
      help: "reload [-f] (-f skips the cache)",
      run(args) {
        if (args[0] == "-f") {
          BrowserCommands.reloadSkipCache();
        } else {
          BrowserCommands.reload();
        }
      },
    },
    stop: {
      help: "stop loading",
      run() {
        BrowserCommands.stop();
      },
    },
    "bookmark-add": {
      help: "bookmark-add: bookmark this page",
      run() {
        PlacesCommandHook.bookmarkPage();
      },
    },
    set: {
      help: "set PREF [VALUE]: show or change a setting",
      run(args) {
        let [name, ...valueParts] = args;
        if (!name) {
          throw new Error("usage: set PREF [VALUE]");
        }
        let prefs = Services.prefs;
        let type = prefs.getPrefType(name);
        if (!valueParts.length) {
          let value =
            type == prefs.PREF_BOOL ? prefs.getBoolPref(name)
            : type == prefs.PREF_INT ? prefs.getIntPref(name)
            : type == prefs.PREF_STRING ? prefs.getStringPref(name)
            : "(not set)";
          this.showMessage(`${name} = ${value}`);
          return;
        }
        let value = valueParts.join(" ");
        if (type == prefs.PREF_BOOL || (type == prefs.PREF_INVALID && /^(true|false)$/.test(value))) {
          prefs.setBoolPref(name, value == "true");
        } else if (type == prefs.PREF_INT || (type == prefs.PREF_INVALID && /^-?\d+$/.test(value))) {
          prefs.setIntPref(name, parseInt(value, 10));
        } else {
          prefs.setStringPref(name, value);
        }
        this.showMessage(`${name} = ${value}`);
      },
    },
    settings: {
      help: "settings: open the full settings page",
      run() {
        openPreferences();
      },
    },
    close: {
      help: "close: close this window",
      run() {
        window.close();
      },
    },
    quit: {
      help: "quit: quit Breached",
      run() {
        Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
      },
    },
    help: {
      help: "help [COMMAND]",
      run(args) {
        let command = this.commands[this.aliases[args[0]] ?? args[0]];
        this.showMessage(
          command ? command.help : Object.keys(this.commands).join("  ")
        );
      },
    },
  },
};

window.addEventListener("load", () => Breached.init(), { once: true });
