/* The right-click menu, printing and saving.
 *
 * The page's Breached actor (BreachedChild.sys.mjs) says what was clicked;
 * ContextMenu shows what fits (link, image, selection, text field, or the
 * page itself) and adds extensions' items (extensions/parent/ext-menus.js).
 * Editing items (copy, paste...) run back in the page. */

"use strict";

var ContextMenu = {
  actor: null,
  data: null,
  browser: null,

  get $popup() {
    let popup = document.getElementById("contextmenu");
    if (!popup) {
      popup = document.createXULElement("menupopup");
      popup.id = "contextmenu";
      popup.addEventListener("popuphidden", event => {
        if (event.target == popup) {
          this.actor = this.data = this.browser = null;
        }
      });
      document.getElementById("mainPopupSet").append(popup);
    }
    return popup;
  },

  /** Called by BreachedParent with what was right-clicked. */
  show(actor, data) {
    let browser = actor.browsingContext.top.embedderElement;
    if (!browser?.tab) {
      return;
    }
    if (data.frameURL) {
      data.pageURL = browser.currentURI.spec;
    }
    this.actor = actor;
    this.data = data;
    this.browser = browser;

    let groups = this.groups(data, browser).map(g => g.filter(Boolean)).filter(g => g.length);
    // Extensions add theirs while the menu is made.
    let extensionItems = [];
    window.dispatchEvent(
      new CustomEvent("Breached:ContextMenu", {
        detail: {
          data,
          nativeTab: browser.tab,
          isPrivate: Breached.isPrivate,
          add: items => extensionItems.push(...items),
        },
      })
    );
    if (extensionItems.length) {
      groups.push(extensionItems);
    }
    Breached.emit("ContextMenuShowing", { data, groups });

    let popup = this.$popup;
    popup.replaceChildren();
    groups.forEach((group, i) => {
      if (i) {
        popup.append(document.createXULElement("menuseparator"));
      }
      for (let item of group) {
        popup.append(this.element(item));
      }
    });
    if (!popup.childElementCount) {
      return;
    }
    popup.openPopupAtScreen(data.x / window.devicePixelRatio, data.y / window.devicePixelRatio, true);
  },

  /** A menu entry: { label, run, disabled, checkbox, checked, icon, items, separator }. */
  element(item) {
    if (item.separator) {
      return document.createXULElement("menuseparator");
    }
    let el;
    if (item.items) {
      el = document.createXULElement("menu");
      let popup = document.createXULElement("menupopup");
      for (let child of item.items) {
        popup.append(this.element(child));
      }
      el.append(popup);
    } else {
      el = document.createXULElement("menuitem");
      if (item.checkbox) {
        el.setAttribute("type", "checkbox");
        if (item.checked) {
          el.setAttribute("checked", "true");
        }
      }
      el.addEventListener("command", () => {
        try {
          item.run();
        } catch (e) {
          console.error(e);
          Breached.showMessage(e.message, "error");
        }
      });
    }
    el.setAttribute("label", item.label);
    if (item.id) {
      el.id = "context-" + item.id;
    }
    if (item.disabled) {
      el.setAttribute("disabled", "true");
    }
    if (item.icon) {
      el.classList.add(item.items ? "menu-iconic" : "menuitem-iconic");
      el.setAttribute("image", item.icon);
    }
    return el;
  },

  /** In the page: cmd_copy, cmd_paste, cmd_selectAll... */
  doCommand(command) {
    try {
      this.actor?.sendAsyncMessage("Breached:DoCommand", { command });
    } catch (e) {
      // The page went away.
    }
  },

  /** The menu's own items, in groups split by lines. */
  groups(d, browser) {
    let open = (url, options = {}) =>
      Breached.openTab(url, { afterCurrent: true, triggeringPrincipal: d.principal, ...options });
    let groups = [];
    if (d.link) {
      groups.push([
        { id: "openlink", label: "Open link in new tab", run: () => open(d.link, { background: true }) },
        !Breached.isPrivate && {
          id: "openlinkprivate",
          label: "Open link in private window",
          run: () => Breached.openPrivateWindow(d.link),
        },
        { id: "copylink", label: "Copy link", run: () => Breached.copy(d.link, "Link copied") },
        { id: "savelink", label: "Save link", run: () => Breached.saveURL(d.link, { principal: d.principal }) },
      ]);
    }
    if (d.mediaType) {
      let what = d.mediaType == "image" ? "image" : d.mediaType;
      groups.push([
        { id: "openmedia", label: `Open ${what} in new tab`, run: () => open(d.mediaURL) },
        { id: "copymedia", label: `Copy ${what} address`, run: () => Breached.copy(d.mediaURL, "Address copied") },
        { id: "savemedia", label: `Save ${what}`, run: () => Breached.saveURL(d.mediaURL, { principal: d.principal }) },
      ]);
    }
    if (d.editable) {
      groups.push(
        [{ id: "undo", label: "Undo", disabled: !d.cmd_undo, run: () => this.doCommand("cmd_undo") }],
        [
          { id: "cut", label: "Cut", disabled: !d.cmd_cut, run: () => this.doCommand("cmd_cut") },
          { id: "copy", label: "Copy", disabled: !d.cmd_copy, run: () => this.doCommand("cmd_copy") },
          { id: "paste", label: "Paste", disabled: !d.cmd_paste, run: () => this.doCommand("cmd_paste") },
          { id: "delete", label: "Delete", disabled: !d.cmd_delete, run: () => this.doCommand("cmd_delete") },
        ],
        [{ id: "selectall", label: "Select all", run: () => this.doCommand("cmd_selectAll") }]
      );
    } else if (d.selection) {
      let shown = d.selection.length > 24 ? d.selection.slice(0, 24) + "…" : d.selection;
      groups.push([
        { id: "copy", label: "Copy", run: () => this.doCommand("cmd_copy") },
        {
          id: "search",
          label: `Search for “${shown.replace(/\s+/g, " ")}”`,
          run: () => open(Breached.searchURL(d.selection)),
        },
      ]);
    }
    if (!d.link && !d.mediaType && !d.editable && !d.selection) {
      groups.push(
        [
          { id: "back", label: "Back", disabled: !browser.canGoBack, run: () => Breached.run("back") },
          { id: "forward", label: "Forward", disabled: !browser.canGoForward, run: () => Breached.run("forward") },
          { id: "reload", label: "Reload", run: () => Breached.run("reload") },
        ],
        [
          { id: "savepage", label: "Save page", run: () => Breached.run("save") },
          { id: "print", label: "Print…", run: () => Breached.print(browser) },
          { id: "viewsource", label: "View page source", run: () => Breached.openTab("view-source:" + (d.frameURL || d.pageURL), { afterCurrent: true }) },
          { id: "copypage", label: "Copy page address", run: () => Breached.copy(d.pageURL, "Address copied") },
          d.frameURL && { id: "openframe", label: "Open frame in new tab", run: () => open(d.frameURL) },
        ],
        [{ id: "selectall", label: "Select all", run: () => this.doCommand("cmd_selectAll") }]
      );
    }
    return groups;
  },
};

Object.assign(Breached, {
  contextMenu: ContextMenu,

  /** Puts text on the clipboard. */
  copy(text, message) {
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
    if (message) {
      this.showMessage(message);
    }
  },

  searchURL(text) {
    return this.pref("searchUrl", "https://duckduckgo.com/?q=%s").replace("%s", encodeURIComponent(text.trim()));
  },

  // ---------------------------------------------------------------- saving

  /** A file name for url: its last path part, or the page title. */
  fileNameFor(url, title) {
    const { DownloadPaths } = ChromeUtils.importESModule("resource://gre/modules/DownloadPaths.sys.mjs");
    let name = "";
    try {
      let uri = Services.io.newURI(url);
      if (uri instanceof Ci.nsIURL) {
        name = decodeURIComponent(uri.fileName);
      }
    } catch (e) {
      // keep the fallback
    }
    if (!name && title) {
      name = title + ".html";
    }
    return DownloadPaths.sanitize(name) || "download";
  },

  /**
   * Downloads url to the downloads folder (or where the user picks, when
   * settings > downloads asks). principal is the page it came from, for
   * its cookies.
   */
  async saveURL(url, { principal, title } = {}) {
    const { Downloads: D } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const { DownloadPaths } = ChromeUtils.importESModule("resource://gre/modules/DownloadPaths.sys.mjs");
    let name = this.fileNameFor(url, title);
    let path;
    if (Services.prefs.getBoolPref("browser.download.useDownloadDir", true)) {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(PathUtils.join(await D.getPreferredDownloadsDirectory(), name));
      path = DownloadPaths.createNiceUniqueFile(file).path;
    } else {
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Save", Ci.nsIFilePicker.modeSave);
      fp.defaultString = name;
      let result = await new Promise(resolve => fp.open(resolve));
      if (result == Ci.nsIFilePicker.returnCancel) {
        return null;
      }
      path = fp.file.path;
    }
    let download = await D.createDownload({
      source: { url, isPrivate: this.isPrivate, loadingPrincipal: principal },
      target: path,
    });
    let list = await D.getList(this.isPrivate ? D.PRIVATE : D.PUBLIC);
    await list.add(download);
    download.start().catch(() => {
      // Downloads.watch says it failed.
    });
    return download;
  },

  // -------------------------------------------------------------- printing

  /** Print settings for the printer used last (or Windows' default one). */
  printSettings() {
    let PSSVC = Cc["@mozilla.org/gfx/printsettings-service;1"].getService(Ci.nsIPrintSettingsService);
    let settings = PSSVC.createNewPrintSettings();
    try {
      let printer =
        PSSVC.lastUsedPrinterName ||
        Cc["@mozilla.org/gfx/printerlist;1"].getService(Ci.nsIPrinterList).systemDefaultPrinterName;
      if (printer) {
        settings.printerName = printer;
        PSSVC.initPrintSettingsFromPrinter(printer, settings);
        PSSVC.initPrintSettingsFromPrefs(settings, true, Ci.nsIPrintSettings.kInitSaveAll);
      }
    } catch (e) {
      console.warn("Breached print settings:", e);
    }
    return settings;
  },

  /** Windows' print dialog. Resolves false if cancelled. (The self-test replaces it.) */
  async printDialog(settings, hasSelection) {
    let dialog = Cc["@mozilla.org/widget/printdialog-service;1"].getService(Ci.nsIPrintDialogService);
    try {
      await dialog.showPrintDialog(window, hasSelection, settings);
    } catch (e) {
      if (e.result == Cr.NS_ERROR_ABORT) {
        return false;
      }
      throw e;
    }
    try {
      let PSSVC = Cc["@mozilla.org/gfx/printsettings-service;1"].getService(Ci.nsIPrintSettingsService);
      PSSVC.maybeSavePrintSettingsToPrefs(settings, Ci.nsIPrintSettings.kInitSaveAll);
    } catch (e) {
      // Remembering the choices is a nicety.
    }
    return true;
  },

  /** Ctrl+P: prints the tab's page (or a page's own window.print() copy). */
  async print(browser = this.selectedBrowser, { clone } = {}) {
    if (!browser) {
      return;
    }
    let settings = this.printSettings();
    try {
      if (!(await this.printDialog(settings, false))) {
        return;
      }
      // The dialog has asked already.
      settings.printSilent = true;
      await browser.browsingContext.print(settings);
    } catch (e) {
      this._lastPrintError = String(e);
      if (e.result != Cr.NS_ERROR_ABORT) {
        console.error("Breached print:", e);
        this.showMessage(`Printing failed: ${e.message}`, "error");
      }
    } finally {
      // window.print() waits until its copy of the page is gone.
      clone?.remove();
    }
  },

  /**
   * A page called window.print(): Gecko makes a still copy of it in a new
   * browser (this one, kept out of sight), which is what gets printed.
   */
  printClone(openWindowInfo) {
    let parent = openWindowInfo.parent;
    let remoteType = parent.currentRemoteType || E10SUtils.NOT_REMOTE;
    let b = this.createBrowser({ remoteType, openWindowInfo });
    b.classList.add("print-clone");
    this.$content.append(b);
    setTimeout(() => this.print(b, { clone: b }), 0);
    return b;
  },
});

/** Gecko's printing actor reports failures through this (Firefox's name). */
var PrintUtils = {
  _displayPrintingError(nsresult, isPrinting) {
    Breached.showMessage(`${isPrinting ? "Printing" : "Print preview"} failed (error 0x${(nsresult >>> 0).toString(16)})`, "error");
  },
};

Object.assign(Commands, {
  print: {
    usage: "print  (also Ctrl+P)",
    run() {
      Breached.print();
    },
  },
  save: {
    usage: "save  (save the page to the downloads folder, also Ctrl+S)",
    run() {
      let b = Breached.selectedBrowser;
      if (!b) {
        return;
      }
      Breached.saveURL(b.currentURI.spec, { principal: b.contentPrincipal, title: b.contentTitle });
    },
  },
  yank: {
    usage: "yank  (copy the page's address)",
    run() {
      let url = Breached.selected?.url;
      if (url) {
        Breached.copy(url, "Address copied");
      }
    },
  },
  y: { alias: "yank" },
  "view-source": {
    usage: "view-source  (the page's HTML, also Ctrl+U)",
    run() {
      let url = Breached.selectedBrowser?.currentURI.spec;
      if (url && !url.startsWith("view-source:")) {
        Breached.openTab("view-source:" + url, { afterCurrent: true });
      }
    },
  },
});

Keys.bindings.push(
  ["p", "accel", () => Breached.print()],
  ["s", "accel", () => Breached.run("save")],
  ["u", "accel", () => Breached.run("view-source")]
);
