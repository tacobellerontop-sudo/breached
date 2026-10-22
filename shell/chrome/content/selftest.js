/* Breached self-test, used by CI. Runs only when the BREACHED_SELFTEST
 * environment variable names an output folder: it drives the real window
 * with real key presses, writes report.json and screenshots there, and quits.
 */

"use strict";

var SelfTest = {
  async run(outDir) {
    let report = { checks: {}, info: {} };
    let check = (name, ok) => {
      report.checks[name] = !!ok;
      dump(`SELFTEST ${ok ? "PASS" : "FAIL"} ${name}\n`);
    };
    let timeout = setTimeout(() => this.finish(outDir, report, "timed out"), 600 * 1000);
    try {
      await IOUtils.makeDirectory(outDir, { ignoreExisting: true });
      await this.steps(outDir, report, check);
    } catch (e) {
      report.exception = `${e}\n${e.stack}`;
      dump(`SELFTEST exception ${e}\n${e.stack}\n`);
    }
    clearTimeout(timeout);
    await this.finish(outDir, report);
  },

  async steps(outDir, report, check) {
    let B = Breached;
    let $ = id => document.getElementById(id);
    let rect = id => $(id).getBoundingClientRect();
    let wait = ms => new Promise(r => setTimeout(r, ms));
    let waitFor = async (fn, ms = 20000) => {
      let start = Date.now();
      while (Date.now() - start < ms) {
        try {
          let result = await fn();
          if (result) {
            return result;
          }
        } catch (e) {}
        await wait(100);
      }
      return false;
    };

    // Real key presses, through the same path as a keyboard.
    let tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    tip.beginInputTransactionForTests(window);
    let MODS = {
      Control: ["ControlLeft", KeyboardEvent.DOM_VK_CONTROL],
      Shift: ["ShiftLeft", KeyboardEvent.DOM_VK_SHIFT],
      Alt: ["AltLeft", KeyboardEvent.DOM_VK_ALT],
    };
    let press = (key, code, keyCode, mods = []) => {
      // Something else (the Bitwarden mod pasting) may have taken the window's input.
      tip.beginInputTransactionForTests(window);
      for (let m of mods) {
        tip.keydown(new KeyboardEvent("", { key: m, code: MODS[m][0], keyCode: MODS[m][1] }));
      }
      let ev = new KeyboardEvent("", { key, code, keyCode });
      tip.keydown(ev);
      tip.keyup(ev);
      for (let m of mods.reverse()) {
        tip.keyup(new KeyboardEvent("", { key: m, code: MODS[m][0], keyCode: MODS[m][1] }));
      }
    };
    let ctrl = (letter, extra = []) =>
      press(letter, "Key" + letter.toUpperCase(), KeyboardEvent["DOM_VK_" + letter.toUpperCase()], ["Control", ...extra]);

    window.focus();
    report.info.gecko = Services.appinfo.platformVersion;
    report.info.app = Services.appinfo.name;
    report.info.ua = navigator.userAgent;
    report.info.remoteTabs = window.docShell.QueryInterface(Ci.nsILoadContext).useRemoteTabs;
    report.info.fission = window.docShell.QueryInterface(Ci.nsILoadContext).useRemoteSubframes;

    // 1. The window and its first tab
    check("shell loaded with one tab", B.tabs.length == 1 && B.selectedBrowser);
    check("command bar hidden until ':'", $("commandbar").hidden);
    let homeDoc = () => B.selectedBrowser.contentDocument;
    let homeShown = await waitFor(
      () => B.selected.url == "breached:home" && homeDoc()?.getElementById("search")
    );
    check("the home page opens on start", homeShown);
    await waitFor(() => homeDoc().readyState == "complete", 5000);
    // How fast and how big: startup milestones (ms after the process started)
    // and memory with just the home page open.
    let startup = Services.startup.getStartupInfo();
    let since = t => (t && startup.process ? Math.round(t - startup.process) : null);
    report.info.speed = {
      mainMs: since(startup.main),
      firstPaintMs: since(startup.firstPaint2 ?? startup.firstPaint),
      homeReadyMs: since(new Date()),
    };
    await wait(500);
    report.info.speed.memoryAtStartMB = await this.memoryMB();
    report.info.speed.parentMemoryAtStart = await this.memoryBreakdown();
    await this.screenshot(outDir, "0-home.png");
    // Search box on the home page
    let typeOnHome = text => {
      let doc = homeDoc();
      doc.getElementById("search").value = text;
      doc.getElementById("search-form").requestSubmit();
    };
    let loadStart = Date.now();
    typeOnHome("example.com");
    let loaded = await waitFor(() => B.selected.title == "Example Domain");
    report.info.speed.firstPageMs = Date.now() - loadStart;
    check("the home page's box opens an address", loaded);
    check("a web page loads", loaded);
    report.info.remoteType = B.selectedBrowser.remoteType;
    check("pages run in a separate content process", B.selectedBrowser.isRemoteBrowser);
    check("window title shows the page", document.title.startsWith("Example Domain"));
    check(
      "tab bar at the bottom by default",
      rect("tabbar").top >= rect("content").bottom - 1 && rect("tabbar").height > 0
    );
    await wait(500);
    await this.screenshot(outDir, "1-page.png");

    // 2. ":" typed on the page opens the command bar at the bottom
    B.selectedBrowser.focus();
    await wait(300);
    report.info.focus = {
      element: Services.focus.focusedElement?.localName ?? null,
      windowActive: Services.focus.activeWindow === window,
      hasFocus: document.hasFocus(),
    };
    try {
      report.info.pageHelper = await B.selectedBrowser.browsingContext.currentWindowGlobal
        .getActor("Breached")
        .sendQuery("Breached:Ping");
    } catch (e) {
      report.info.pageHelper = String(e);
    }
    check("page helper runs in web pages", report.info.pageHelper == "pong");
    let fsActor = null;
    try {
      fsActor = B.selectedBrowser.browsingContext.currentWindowGlobal.getActor("DOMFullscreen");
    } catch (e) {
      report.info.fullscreenHelper = String(e);
    }
    check("page fullscreen helper runs in web pages", !!fsActor);
    press(":", "Semicolon", KeyboardEvent.DOM_VK_SEMICOLON, ["Shift"]);
    let opened = await waitFor(() => !$("commandbar").hidden, 5000);
    check("':' on a page opens the command bar", opened);
    if (!opened) {
      B.openCommandLine();
    }
    $("commandline").value = "open -t exam";
    B.updateCompletion();
    check(
      "command bar sits at the bottom of the window",
      Math.abs(rect("commandbar").bottom - window.innerHeight) < 2
    );
    await this.screenshot(outDir, "2-commandbar.png");
    press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
    check("Escape closes the command bar", await waitFor(() => $("commandbar").hidden, 3000));

    // 3. Ctrl+T: a new tab with the home page (or the command bar, if set)
    Services.prefs.setStringPref("breached.newTab", "commandbar");
    B.selectedBrowser.focus();
    await wait(200);
    ctrl("t");
    let ctrlT = await waitFor(() => !$("commandbar").hidden, 3000);
    check("Ctrl+T can open ':open -t' (setting)", ctrlT && $("commandline").value == "open -t ");
    press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
    Services.prefs.clearUserPref("breached.newTab");
    await wait(200);
    ctrl("t");
    check(
      "Ctrl+T opens a new tab with the home page",
      await waitFor(() => B.tabs.length == 2 && B.selected.url == "breached:home" && homeDoc()?.getElementById("search"))
    );
    check("the new tab is selected", B.tabs.indexOf(B.selected) == 1);
    await waitFor(() => homeDoc().readyState == "complete", 5000);
    check(
      "the home page's box has focus",
      Services.focus.focusedElement === homeDoc().getElementById("search")
    );
    typeOnHome("example.org");
    check("the new tab goes to the address", await waitFor(() => B.selected.title == "Example Domain"));

    // 4. Ctrl+W, Ctrl+Shift+T
    B.selectedBrowser.focus();
    await wait(200);
    ctrl("w");
    check("Ctrl+W closes the tab", await waitFor(() => B.tabs.length == 1, 3000));
    ctrl("t", ["Shift"]);
    check("Ctrl+Shift+T reopens it", await waitFor(() => B.tabs.length == 2, 3000));
    await waitFor(() => B.selected.title == "Example Domain");

    // 5. Commands
    B.run("tab-focus 1");
    check(":tab-focus switches tabs", B.selected === B.tabs[0]);
    let tabBg = t => getComputedStyle(t.el).backgroundColor;
    let selectedBg = tabBg(B.tabs[0]);
    check("the selected tab has its own colour", selectedBg != tabBg(B.tabs[1]));
    B.run("tab-focus 2");
    check("the colour follows the selected tab", tabBg(B.tabs[1]) == selectedBg && tabBg(B.tabs[0]) != selectedBg);
    B.run("tab-focus 1");
    B.run("tab-sleep 2");
    check(":tab-sleep unloads a tab", B.tabs[1].asleep && $("content").children.length == 1);
    B.run("tab-focus 2");
    check("a sleeping tab wakes when selected", !B.tabs[1].asleep);
    check(
      "it comes back on the same page",
      await waitFor(() => B.tabs[1].url.includes("example.org") && B.tabs[1].title == "Example Domain")
    );
    B.selectTab(B.tabs[0]);
    B.tabs[1].lastActive = 0;
    Services.prefs.setIntPref("breached.tabs.unloadAfterMinutes", 1);
    check("idle tabs unload on their own", B.unloadIdleTabs() == 1 && B.tabs[1].asleep);
    Services.prefs.clearUserPref("breached.tabs.unloadAfterMinutes");
    check("plain words search", B.urlFor("hello world").startsWith("https://duckduckgo.com/?q=hello%20world"));
    B.preconnectTyped("open -t example.org");
    check(
      "typing an address in the command bar starts connecting to it",
      await waitFor(() => [...B._preconnected.keys()].some(k => k.includes("example.org")), 2000)
    );
    check("addresses open as addresses", /^https?:\/\/example\.net\/$/.test(B.urlFor("example.net")));
    let blocked = false;
    try {
      B.urlFor("javascript:alert(1)");
    } catch (e) {
      blocked = true;
    }
    check("javascript: is refused", blocked);

    // 6. Settings page
    B.run("settings");
    let settingsDoc = () => B.selectedBrowser.contentDocument;
    check(
      ":settings opens the settings page",
      await waitFor(() => B.selected.url == "breached:settings" && settingsDoc()?.querySelector("[data-setting]"))
    );
    await wait(500);
    report.info.settings = [...settingsDoc().querySelectorAll("[data-setting]")].map(r => r.dataset.setting);
    await this.screenshot(outDir, "6-settings.png");
    // Settings is split into pages; the side list shows one at a time.
    let shownPages = () => [...settingsDoc().querySelectorAll(".page")].filter(p => !p.hidden).map(p => p.dataset.page);
    report.info.settingsPages = [...settingsDoc().querySelectorAll("#nav button")].map(b => b.textContent);
    check("settings opens on one page, Appearance", shownPages().join() == "appearance");
    let showSettingsPage = async name => {
      settingsDoc().getElementById("nav-" + name).click();
      await wait(200);
      return shownPages().join() == name;
    };
    check("settings: the side list switches pages", await showSettingsPage("browsing"));
    await this.screenshot(outDir, "6a-settings-browsing.png");
    check("settings: the side list goes back", await showSettingsPage("appearance"));
    // A dropdown on a page opens as a real popup list.
    let dropdownEl = settingsDoc().getElementById("setting-breached-tabs-position");
    let r = dropdownEl.getBoundingClientRect();
    let pageWin = settingsDoc().defaultView;
    pageWin.synthesizeMouseEvent("mousedown", r.left + 10, r.top + 5, { button: 0, buttons: 1, clickCount: 1 });
    pageWin.synthesizeMouseEvent("mouseup", r.left + 10, r.top + 5, { button: 0, buttons: 0, clickCount: 1 });
    let dropdown = () => document.getElementById("ContentSelectDropdown")?.menupopup;
    let dropdownOpen = await waitFor(() => dropdown()?.state == "open", 5000);
    report.info.dropdown = dropdown() ? {
      state: dropdown().state,
      items: dropdown().children.length,
      height: dropdown().getOuterScreenRect().height,
      inPage: dropdown().getBoundingClientRect().height,
    } : null;
    check("dropdowns open as a popup list", dropdownOpen && dropdown().getOuterScreenRect().height > 10);
    await wait(300);
    await this.screenshot(outDir, "6b-dropdown.png");
    if (dropdownOpen) {
      let items = [...dropdown().querySelectorAll("menuitem")];
      let top = items.find(i => i.label == "Top");
      dropdown().activateItem(top);
      check(
        "picking from a dropdown changes the setting",
        await waitFor(() => Services.prefs.getStringPref("breached.tabs.position") == "top", 3000)
      );
      Services.prefs.clearUserPref("breached.tabs.position");
      await wait(200);
    }
    let position = settingsDoc().getElementById("setting-breached-tabs-position");
    position.value = "top";
    position.dispatchEvent(new Event("change"));
    await wait(200);
    check(
      "settings: tab bar position moves the tab bar up",
      Services.prefs.getStringPref("breached.tabs.position") == "top" &&
        rect("tabbar").bottom <= rect("content").top + 1
    );
    let search = settingsDoc().getElementById("setting-breached-searchUrl");
    search.value = "https://www.google.com/search?q=%s";
    search.dispatchEvent(new Event("change"));
    check("settings: search engine changes searches", B.urlFor("a b").startsWith("https://www.google.com/search?q=a%20b"));
    Services.prefs.clearUserPref("breached.searchUrl");
    let tracking = settingsDoc().getElementById("setting-tracking");
    check("settings: tracker blocking starts at Strict", tracking.value == "strict");
    tracking.value = "standard";
    tracking.dispatchEvent(new Event("change"));
    check(
      "settings: tracker blocking level applies",
      !Services.prefs.getBoolPref("privacy.trackingprotection.enabled")
    );
    tracking.value = "strict";
    tracking.dispatchEvent(new Event("change"));

    // 7. Title bar, colours, transparency
    let root = document.documentElement;
    check("Breached's own title bar replaces the Windows one", root.hasAttribute("customtitlebar"));
    check(
      "the title bar sits at the top with window buttons",
      rect("titlebar").top < 1 && rect("titlebar").height > 0 && rect("titlebar-close").width > 0
    );
    check("tabs on top share the title bar's row", $("tabbar").parentNode.id == "titlebar-content");
    check("the title bar shows the page title", $("titlebar-title").textContent == document.title);
    await showSettingsPage("appearance");
    let rgb = hex => `rgb(${hex.slice(1).match(/../g).map(h => parseInt(h, 16)).join(", ")})`;
    let preset = settingsDoc().getElementById("setting-color-preset");
    check("settings: colours start as pastel silver and orange", preset.value == "pastel");
    preset.value = "nord";
    preset.dispatchEvent(new Event("change"));
    await wait(200);
    check(
      "settings: a colour set recolours the window",
      getComputedStyle(root).getPropertyValue("--bar-bg").trim() == "#2e3440" &&
        getComputedStyle(root).backgroundColor == rgb("#2e3440")
    );
    check(
      "settings: the settings page follows the colours",
      settingsDoc().defaultView.getComputedStyle(settingsDoc().documentElement).backgroundColor == rgb("#2e3440")
    );
    await this.screenshot(outDir, "7-colors-nord-tabs-in-titlebar.png");
    let accent = settingsDoc().getElementById("setting-color-accent");
    accent.value = "#ff00ff";
    accent.dispatchEvent(new Event("input"));
    check(
      "settings: one colour can be changed",
      Services.prefs.getStringPref("breached.colors.accent") == "#ff00ff" && preset.value == ""
    );
    let see = settingsDoc().getElementById("setting-breached-transparency");
    see.value = "acrylic";
    see.dispatchEvent(new Event("change"));
    check(
      "settings: transparency turns on the Windows backdrop",
      root.hasAttribute("transparency") &&
        Services.prefs.getBoolPref("widget.windows.mica") &&
        Services.prefs.getIntPref("widget.windows.mica.toplevel-backdrop") == 2
    );
    report.info.micaAvailable = window.matchMedia("(-moz-windows-mica)").matches;
    let strength = settingsDoc().getElementById("setting-breached-transparency-opacity");
    strength.value = "30";
    strength.dispatchEvent(new Event("input"));
    check("settings: bar colour strength applies", root.style.getPropertyValue("--transparency-opacity") == "30%");
    await wait(300);
    await this.screenshot(outDir, "8-transparency.png");
    see.value = "off";
    see.dispatchEvent(new Event("change"));
    check(
      "settings: transparency turns off",
      !root.hasAttribute("transparency") && !Services.prefs.getBoolPref("widget.windows.mica")
    );
    let titlebarSetting = settingsDoc().getElementById("setting-breached-titlebar");
    titlebarSetting.value = "native";
    titlebarSetting.dispatchEvent(new Event("change"));
    await wait(200);
    check(
      "settings: the Windows title bar can come back",
      !root.hasAttribute("customtitlebar") && rect("titlebar").height == 0 && $("tabbar").parentNode == document.body
    );
    ChromeUtils.importESModule("resource://breached/Theme.sys.mjs").applyPreset("pastel");
    for (let p of ["titlebar", "transparency", "transparency.opacity"]) {
      Services.prefs.clearUserPref("breached." + p);
    }
    await wait(200);
    await this.updates(B, check, waitFor, wait, outDir, report, settingsDoc, shownPages);
    B.run("close");
    B.run("set tabs.autohide true");
    await wait(2000);
    check(
      ":set tabs.autohide true hides the tab bar",
      getComputedStyle($("tabbar")).visibility == "hidden" && rect("content").top <= rect("titlebar").bottom + 1
    );
    B.run("tab-next");
    check("the hidden tab bar shows while switching", getComputedStyle($("tabbar")).visibility == "visible");
    await wait(300);
    await this.screenshot(outDir, "3-tabs-top-autohide-peek.png");
    B.run("set tabs.autohide false");
    await wait(200);
    await this.screenshot(outDir, "4-tabs-top.png");
    Services.prefs.clearUserPref("breached.tabs.position");
    Services.prefs.clearUserPref("breached.tabs.autohide");
    B.run("help");
    await this.screenshot(outDir, "5-help.png");

    // 7. :close
    B.run("close");
    check(":close closes the current tab", B.tabs.length == 1);

    // 8. History and downloads
    await this.historyAndDownloads(B, check, waitFor, wait, outDir, report);

    // 9. Mods: Bitwarden installs from the mods site, fills a login, and removes
    await this.mods(B, check, waitFor, wait, press, outDir, report);

    // 10. Extensions: a test extension uses the tabs API, a button and a popup
    await this.extensions(B, check, waitFor, wait, outDir, report);

    // 11. Site permissions (camera, location) and pinned sites
    await this.permissions(B, check, waitFor, wait, press, outDir, report);
    await this.pins(B, check, waitFor, wait, outDir, report);

    // 12. Private windows, the right-click menu, zoom per site, saving, printing
    await this.dailyDriver(B, check, waitFor, wait, outDir, report);

    // 13. Tabs in a column and the tab bar on hover, reader view, protected video
    await this.tabBarHover(B, check, waitFor, wait, outDir, report);
    await this.navButtons(B, check, waitFor, wait, outDir, report);
    await this.readerView(B, check, waitFor, wait, outDir, report);
    await this.drm(B, check, waitFor, wait, press, outDir, report);

    // 14. The other mods: passwords, bookmarks, Firefox Sync
    await this.moreMods(B, check, waitFor, wait, press, outDir, report);

    // 15. The first-start welcome page, importing, reopening last time's tabs
    await this.welcome(B, check, waitFor, wait, outDir, report);
    await this.importing(B, check, waitFor, wait, press, outDir, report);

    // 16. Opening files: a PDF handed over by Windows while Breached runs
    await this.openFiles(B, check, waitFor, wait, outDir, report);
    await this.lastMods(B, check, waitFor, wait, press, outDir, report);

    // 18. The official Bitwarden extension (from addons.mozilla.org): does it run?
    await this.bitwardenExtension(B, waitFor, wait, outDir, report);

    // 17. uBlock Origin (the real one, from addons.mozilla.org): sites still open
    await this.ublock(B, check, waitFor, wait, outDir, report);

    report.errors = Services.console
      .getMessageArray()
      .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
      .map(m => `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`);
    check(
      "no Breached script errors",
      !report.errors.some(e => /breached/i.test(e))
    );
  },

  /** Memory of all Breached processes (resident, MB) and how many there are. */
  async memoryMB() {
    let info = await ChromeUtils.requestProcInfo();
    let all = [info, ...info.children];
    return {
      total: Math.round(all.reduce((n, p) => n + (p.memory ?? 0), 0) / 1048576),
      processes: all.length,
      byType: all.map(p => `${p.type}:${Math.round((p.memory ?? 0) / 1048576)}`),
    };
  },

  /** The main process's memory reports, MB per part (like about:memory). */
  memoryBreakdown() {
    return new Promise(resolve => {
      let parts = {};
      let add = (key, bytes) => (parts[key] = (parts[key] ?? 0) + bytes);
      let mgr = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
      let finish = () => {
        let mb = {};
        for (let [k, v] of Object.entries(parts).sort((a, b) => b[1] - a[1])) {
          if (v > 1048576) {
            mb[k] = Math.round(v / 104857.6) / 10;
          }
        }
        resolve(mb);
      };
      mgr.getReports(
        (process, path, kind, units, amount) => {
          // The main process reports with an empty process name.
          if (process || units != Ci.nsIMemoryReporter.UNITS_BYTES || !path.startsWith("explicit/")) {
            return;
          }
          let [, first, second] = path.split("/");
          add(first, amount);
          if (["js-non-window", "window-objects", "gfx", "images", "atoms"].includes(first) && second) {
            add(`${first}/${second.replace(/\(.*$/, "")}`, amount);
          }
          if (first == "workers") {
            // explicit/workers/workers(chrome)/worker(<script url>, 0x...)/...
            let worker = path.split("/")[3]?.match(/^worker\(([^,]*)/)?.[1];
            if (worker) {
              add(`workers/${worker.replace(/\\/g, "/")}`, amount);
            }
          }
        },
        null,
        finish,
        null,
        true
      );
    });
  },

  // Settings > Updates asks GitHub for the newest release.
  async updates(B, check, waitFor, wait, outDir, report, settingsDoc, shownPages) {
    let Updates = ChromeUtils.importESModule("resource://breached/Updates.sys.mjs");
    check(
      "updates: versions compare by number",
      Updates.compare("0.1.10", "0.1.9") > 0 && Updates.compare("v0.1.1", "0.1.1") == 0 && Updates.compare("0.2", "0.10.0") < 0
    );
    check("updates: a test copy isn't an installed one", !Updates.isInstalled());
    B.run("update");
    check(
      ":update opens settings at Updates",
      await waitFor(() => shownPages().join() == "updates" && settingsDoc().getElementById("update-status"), 5000)
    );
    let status = () => settingsDoc().getElementById("update-status").textContent;
    // GitHub may limit CI's requests; any answer but "Checking" is a finished check.
    let done = await waitFor(() => !/Checking|^You have Breached/.test(status()), 20000);
    report.info.updateStatus = status();
    check("updates: checking GitHub finishes with an answer", done);
    await this.screenshot(outDir, "8b-updates.png");
    Services.prefs.clearUserPref("breached.update.lastCheck");
  },

  async historyAndDownloads(B, check, waitFor, wait, outDir, report) {
    let doc = () => B.selectedBrowser?.contentDocument;
    B.run("history");
    check(
      ":history opens the history page",
      await waitFor(() => B.selected.url == "breached:history" && doc()?.querySelector(".visit"))
    );
    let links = () => [...doc().querySelectorAll(".visit a")].map(a => a.href);
    check("history lists visited pages", links().some(h => h.includes("example.com")));
    let filter = doc().getElementById("filter");
    filter.value = "example.org";
    filter.dispatchEvent(new Event("input"));
    check(
      "history search narrows the list",
      await waitFor(() => links().length > 0 && links().every(h => h.includes("example.org")), 5000)
    );
    await wait(300);
    await this.screenshot(outDir, "9-history.png");

    // A real download, started by a page.
    let { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    let list = await Downloads.getList(Downloads.ALL);
    let downloaded = false;
    let view = {
      onDownloadChanged(d) {
        downloaded ||= d.succeeded;
      },
    };
    await list.addView(view);
    B.run("open -t https://github.com/git/git/archive/refs/tags/v0.99.zip");
    await waitFor(() => downloaded, 60000);
    await list.removeView(view);
    let all = await list.getAll();
    report.info.downloads = all.map(d => ({
      url: d.source.url,
      target: d.target.path,
      succeeded: d.succeeded,
      error: d.error ? String(d.error.message) : null,
    }));
    check("a download saves to the downloads folder", all.some(d => d.succeeded));
    if (!downloaded) {
      // Still check the page with a download made directly.
      let target = PathUtils.join(PathUtils.tempDir, "breached-test-download.html");
      let d = await Downloads.createDownload({ source: "https://example.com/", target });
      await list.add(d);
      await d.start().catch(() => {});
    }
    if (B.selected.url.includes("v0.99.zip") || B.selected.url == "about:blank") {
      B.closeTab(B.selected);
    }
    B.run("downloads");
    check(
      ":downloads opens the download manager",
      await waitFor(() => B.selected.url == "breached:downloads" && doc()?.querySelector(".download"))
    );
    let row = doc().querySelector(".download");
    check(
      "the download manager shows finished downloads with open and folder buttons",
      !!row?.querySelector(".action-open") && !!row?.querySelector(".action-folder")
    );
    await wait(300);
    await this.screenshot(outDir, "10-downloads.png");
    B.closeTab(B.selected);
    B.closeTab(B.tabs.find(t => t.url == "breached:history"));
  },

  /** The self-test's page helper (SelfTestChild.sys.mjs), registered once. */
  testActor(browser = Breached.selectedBrowser) {
    if (!this._testActor) {
      try {
        ChromeUtils.registerWindowActor("BreachedSelfTest", {
          child: { esModuleURI: "resource://breached/SelfTestChild.sys.mjs" },
          messageManagerGroups: ["browsers"],
          safeForUntrustedWebProcess: true,
        });
      } catch (e) {
        // registered by an earlier step
      }
      this._testActor = true;
    }
    return browser.browsingContext.currentWindowGlobal?.getActor("BreachedSelfTest");
  },

  /** A page element's text, attributes and place: { text, attrs, rect, root }. */
  async element(selector, browser = Breached.selectedBrowser) {
    try {
      return await this.testActor(browser).sendQuery("SelfTest:Element", { selector });
    } catch (e) {
      return null;
    }
  },

  /** Clicks a page element like a mouse would (in the page's own process). */
  async clickElement(selector, browser = Breached.selectedBrowser) {
    let found = await this.element(selector, browser);
    if (!found?.rect) {
      return false;
    }
    let x = found.rect.x + found.rect.width / 2;
    let y = found.rect.y + found.rect.height / 2;
    let actor = this.testActor(browser);
    await actor.sendQuery("SelfTest:Mouse", { type: "mousedown", x, y, button: 0 });
    await actor.sendQuery("SelfTest:Mouse", { type: "mouseup", x, y, button: 0 });
    return true;
  },

  async mods(B, check, waitFor, wait, press, outDir, report) {
    let info = (report.info.mods = {});
    let doc = () => B.selectedBrowser?.contentDocument;
    B.run("bw.exe");
    check(
      ":bw.exe without the mod says which mod it needs",
      /Bitwarden mod/.test(document.getElementById("message").textContent)
    );
    B.run("mods");
    check(
      ":mods opens settings at the mods section, with a link to the mods site",
      await waitFor(() => B.selected.url == "breached:settings#mods" && doc()?.getElementById("mods-site")?.checkVisibility())
    );
    check("settings: no mods come installed", !!doc().getElementById("mods-none"));
    await wait(500);
    await this.screenshot(outDir, "11-mods.png");
    let click = el => {
      let r = el.getBoundingClientRect();
      let win = el.ownerDocument.defaultView;
      win.synthesizeMouseEvent("mousedown", r.left + 5, r.top + 5, { button: 0, buttons: 1, clickCount: 1 });
      win.synthesizeMouseEvent("mouseup", r.left + 5, r.top + 5, { button: 0, buttons: 0, clickCount: 1 });
    };
    let settingsTab = B.selected;

    // The mods site (built from the breached-mods repository by CI).
    click(doc().getElementById("mods-site"));
    let site = ModHost.Mods.site;
    info.site = site;
    let siteTab = await waitFor(() => B.selected.url == site && B.selected.title == "Breached mods" && B.selected, 15000);
    check("settings: Get mods opens the mods site", !!siteTab);
    let marked = await waitFor(async () => (await this.element("a[data-breached-mod=bitwarden]"))?.root?.breached == B.version, 10000);
    if (!marked) {
      // Why not: is the site's helper there, and what does it answer?
      let wg = B.selectedBrowser.browsingContext.currentWindowGlobal;
      info.pageURI = wg?.documentURI?.spec;
      try {
        let actor = wg.getActor("BreachedModsSite");
        info.siteState = await actor.receiveMessage({ name: "ModsSite:State", data: {} });
        actor.sendAsyncMessage("ModsSite:Refresh", {});
        marked = await waitFor(async () => (await this.element("a[data-breached-mod=bitwarden]"))?.root?.breached == B.version, 5000);
        info.markedAfterRefresh = marked;
        info.siteChecks = {
          onSite: ModHost.Mods.onSite(info.pageURI),
          sameBrowser: actor.browsingContext.top.embedderElement === B.selectedBrowser,
          hasModHost: !!actor.browsingContext.top.embedderElement?.ownerGlobal?.ModHost,
          managerURI: actor.manager?.documentURI?.spec,
        };
      } catch (e) {
        info.siteActorError = String(e);
      }
    }
    let link = await this.element("a[data-breached-mod=bitwarden]");
    info.siteLink = link;
    check("the mods site knows it's open in Breached", marked && link?.text == "Install");
    await this.screenshot(outDir, "11b-mods-site.png");
    await this.clickElement("a[data-breached-mod=bitwarden]");
    let asked = await waitFor(
      () => !document.getElementById("picker").hidden && /Install the Bitwarden mod/.test(document.getElementById("prompt").textContent),
      15000
    );
    info.confirm = document.getElementById("prompt").textContent;
    check("Install on the mods site asks first", asked);
    await this.screenshot(outDir, "11c-mod-confirm.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let installed = await waitFor(() => ModHost.loaded.has("bitwarden") && Commands["bw.exe"], 15000);
    check("the mods site installs the Bitwarden mod, which adds :bw.exe", installed);
    if (!installed) {
      report.info.bitwardenLoadProblem = {
        message: document.getElementById("message").textContent,
        loaded: ModHost.loaded.has("bitwarden"),
        console: Services.console
          .getMessageArray()
          .map(m => m.message ?? m.errorMessage ?? "")
          .filter(m => /bitwarden|mod|passkey/i.test(m))
          .slice(-15),
      };
    }
    check(
      "the mods site then shows it as installed",
      await waitFor(async () => (await this.element("a[data-breached-mod=bitwarden]"))?.text == "Installed", 5000)
    );
    B.closeTab(siteTab);
    B.selectTab(settingsTab);
    check(
      "settings: the installed mod shows with its settings",
      await waitFor(() => doc().getElementById("setting-breached-mods-bitwarden-path") && doc().getElementById("mod-bitwarden-remove"), 3000)
    );
    await this.screenshot(outDir, "11d-mods-installed.png");

    let fakeBw = Services.env.get("BREACHED_TEST_BW");
    let loginPage = Services.env.get("BREACHED_TEST_LOGIN_PAGE");
    report.info.bitwardenTest = { fakeBw, loginPage };
    if (installed && fakeBw && loginPage) {
      Services.prefs.setStringPref("breached.mods.bitwarden.path", fakeBw);
      let bw = this.bitwardenKeys(press, waitFor);
      let { rows, type, shortcut, promptHas, pickRow } = bw;
      let field = async id => {
        let list = await this.testActor(B.selectedBrowser).sendQuery("SelfTest:Inputs", {}).catch(() => []);
        return list.find(i => i.id == id)?.value;
      };
      // Click into the username box, then Ctrl+Shift+L.
      B.openTab(loginPage);
      await waitFor(() => B.selected.title == "login" && !B.selected.el.hasAttribute("busy"), 10000);
      await this.clickElement("#user");
      shortcut();
      let asked = await promptHas("master password");
      report.info.bitwardenPrompt = document.getElementById("prompt").textContent;
      check("Ctrl+Shift+L asks for the Bitwarden master password", asked);
      if (asked) {
        await this.screenshot(outDir, "12-bitwarden-password.png");
        type("hunter2");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        let pin = await promptHas("choose a PIN");
        check("after the master password, Bitwarden offers a PIN", pin);
        type("1234");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        await promptHas("the PIN again");
        type("1234");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        // Two logins: they show as rows to pick from.
        let listed = await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000);
        check("then the site's logins show as rows", listed);
        check("the first row starts selected", rows()[0]?.hasAttribute("selected"));
        press("ArrowDown", "ArrowDown", KeyboardEvent.DOM_VK_DOWN);
        check("Down moves to the next row", rows()[1]?.hasAttribute("selected"));
        await this.screenshot(outDir, "13-bitwarden-pick.png");
        type("breached");
        check(
          "typing narrows the rows",
          rows().length == 1 && rows()[0].textContent.includes("breached-user") && rows()[0].hasAttribute("selected")
        );
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        let actions = await waitFor(() => /breached-user:/.test(document.getElementById("prompt").textContent) && rows().length >= 4, 10000);
        report.info.bitwardenActions = rows().map(r => r.textContent);
        check(
          "picking a login offers to paste both (username, Tab, password), or paste or copy each",
          actions && /paste both/.test(rows()[0].textContent) && rows().some(r => /paste username/.test(r.textContent))
        );
        await this.screenshot(outDir, "13b-bitwarden-actions.png");
        pickRow(/paste username/);
        let user = await waitFor(async () => (await field("user")) == "breached-user", 10000);
        check("paste username types it into the box you were in", user);
        // Then the password box.
        await this.clickElement("#pass");
        shortcut();
        await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000);
        type("breached");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        await waitFor(() => /breached-user:/.test(document.getElementById("prompt").textContent), 10000);
        pickRow(/paste password/);
        let filled = await waitFor(() => B.selected.title == "filled breached-user / breached-pass", 15000);
        report.info.bitwardenTitle = B.selected.title;
        report.info.bitwardenMessage = document.getElementById("message").textContent;
        check("paste password types it into the password box (not a hidden one), while the page changes its address", filled);
        check("the password isn't kept in the command history", !B.history.includes("hunter2"));
        // The password box has the focus: ":" types there, Esc leaves it.
        let colon = () => press(":", "Semicolon", KeyboardEvent.DOM_VK_SEMICOLON, ["Shift"]);
        B.selectedBrowser.focus();
        colon();
        await new Promise(r => setTimeout(r, 300));
        check("':' in a page's text field types there", document.getElementById("commandbar").hidden);
        press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
        await new Promise(r => setTimeout(r, 300));
        colon();
        check(
          "after Esc, ':' opens the command bar",
          await waitFor(() => !document.getElementById("commandbar").hidden, 3000)
        );
        press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
        await this.screenshot(outDir, "14-bitwarden-filled.png");
        // Copy the password instead.
        shortcut();
        await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000);
        type("breached");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        await waitFor(() => /breached-user:/.test(document.getElementById("prompt").textContent), 10000);
        pickRow(/copy password/);
        check("copy password puts it on the clipboard", await waitFor(() => bw.clipboard() == "breached-pass", 5000));
        // Locked: the PIN unlocks it.
        B.run("bw.exe lock");
        shortcut();
        let pinAsked = await promptHas("bitwarden PIN");
        check("once locked, Ctrl+Shift+L asks for the PIN", pinAsked);
        await this.screenshot(outDir, "14a-bitwarden-pin.png");
        type("1234");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        check(
          "the PIN unlocks Bitwarden",
          await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000)
        );
        press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
        // Paste both on an empty form (a reload would keep what's typed), as qutebrowser does: username, Tab, password.
        B.closeTab(B.selected);
        B.openTab(loginPage);
        await waitFor(() => B.selected.title == "login", 10000);
        await new Promise(r => setTimeout(r, 500));
        await this.clickElement("#user");
        shortcut();
        await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000);
        type("breached");
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        await waitFor(() => /breached-user:/.test(document.getElementById("prompt").textContent), 10000);
        pickRow(/paste both/);
        let both = await waitFor(() => B.selected.title == "filled breached-user / breached-pass", 15000);
        report.info.bitwardenBothTitle = B.selected.title;
        check("paste both fills the username, Tabs to the password box and fills it", both);
        await this.bitwardenAutofill(B, check, waitFor, press, outDir, report, loginPage, bw);
      }
      B.closeTab(B.selected);
      // The Speed mod (a spare page process waiting, more processes), as people use it.
      let speed = await ModHost.installFromSite("speed", { confirm: false, quiet: true }).then(
        () => waitFor(() => ModHost.loaded.has("speed"), 10000),
        e => (report.info.speedInstall = String(e))
      );
      report.info.speedForBitwarden = speed;
      if (asked) {
        await this.googleSignin(B, check, waitFor, press, outDir, report);
        // Again with uBlock Origin running, as people use it.
        let ublock = await this.installUblock(report.info, waitFor);
        if (ublock) {
          let first = report.info.google;
          await this.googleSignin(B, check, waitFor, press, outDir, report, " with uBlock Origin");
          report.info.googleWithUblock = report.info.google;
          report.info.google = first;
          await ublock.uninstall();
        }
      }
      await this.passkeys(B, check, waitFor, press, outDir, report, loginPage);
      if (speed === true) {
        await ModHost.Mods.uninstall("speed");
        await waitFor(() => !ModHost.loaded.has("speed"), 5000);
      }
      Services.prefs.clearUserPref("breached.mods.bitwarden.path");
    }

    B.selectTab(B.tabs.find(t => t.url.startsWith("breached:settings")));
    let remove = doc().getElementById("mod-bitwarden-remove");
    if (remove) {
      click(remove);
    } else {
      await ModHost.Mods.uninstall("bitwarden");
    }
    check(
      "settings: removing the mod takes :bw.exe away again",
      await waitFor(() => !ModHost.loaded.has("bitwarden") && !Commands["bw.exe"], 5000)
    );
    B.closeTab(B.selected);
  },

  // Only reports what happens (no checks yet): Breached's extension support
  // with the Bitwarden extension, which fills logins and answers passkeys.
  async bitwardenExtension(B, waitFor, wait, outDir, report) {
    let info = (report.info.bitwardenExtension = {});
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    let before = Services.console.getMessageArray().length;
    let addon;
    try {
      let install = await AddonManager.getInstallForURL(
        "https://addons.mozilla.org/firefox/downloads/latest/bitwarden-password-manager/latest.xpi",
        { telemetryInfo: { source: "internal" } }
      );
      addon = await install.install();
      info.id = addon.id;
      info.version = addon.version;
    } catch (e) {
      info.installError = String(e);
      return;
    }
    let policy = () => WebExtensionPolicy.getByID(addon.id);
    info.running = !!(await waitFor(() => policy()?.extension?.backgroundState == "running", 30000));
    await wait(5000);
    info.manifestVersion = policy()?.extension?.manifestVersion;
    info.permissions = policy()?.permissions;
    // A login page: does its content script add anything?
    let loginPage = Services.env.get("BREACHED_TEST_LOGIN_PAGE");
    if (loginPage) {
      let tab = B.openTab(loginPage);
      await waitFor(() => tab.title == "login" && !tab.el.hasAttribute("busy"), 10000);
      await wait(4000);
      try {
        await this.clickElement("#user");
        await wait(3000);
        info.page = await this.testActor(B.selectedBrowser).sendQuery("SelfTest:Extras", {});
      } catch (e) {
        info.pageError = String(e);
      }
      await this.screenshot(outDir, "41-bitwarden-extension-login.png");
      B.closeTab(tab);
    }
    // Its popup, as :ext opens it.
    try {
      B.run("ext bitwarden");
      await wait(5000);
      await this.screenshot(outDir, "42-bitwarden-extension-popup.png");
      document.getElementById("ext-popup-panel")?.hidePopup?.();
    } catch (e) {
      info.popupError = String(e);
    }
    info.log = Services.console
      .getMessageArray()
      .slice(before)
      .map(m => m.message ?? m.errorMessage ?? "")
      .filter(m => !/Content-Security-Policy|uBlock/.test(m))
      .slice(-40);
    await addon.uninstall();
  },

  async ublock(B, check, waitFor, wait, outDir, report) {
    let info = (report.info.ublock = {});
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    // How long :open takes, without and with uBlock Origin.
    let sites = ["https://example.com/", "https://www.wikipedia.org/", "https://www.youtube.com/", "https://www.youtube.com/watch?v=jNQXAC9IVRw", "https://github.com/"];
    let timeLoads = async () => {
      let times = {};
      let tab = B.openTab("about:blank");
      await wait(1000);
      for (let site of sites) {
        let browser = B.selectedBrowser;
        let start = Date.now();
        let shown = null;
        B.run("open " + site);
        // Shown: the address changed to the site (the page is drawing).
        // Loaded: done loading.
        let done = await waitFor(() => {
          let here = browser.currentURI?.spec.startsWith(site);
          if (here && shown == null) {
            shown = Date.now() - start;
          }
          return here && !browser.webProgress?.isLoadingDocument;
        }, 30000);
        times[site] = { shown: shown ?? "over 30s", loaded: done ? Date.now() - start : "over 30s" };
        await wait(500);
      }
      B.closeTab(tab);
      return times;
    };
    info.timesWithout = await timeLoads();
    let addon;
    try {
      let install = await AddonManager.getInstallForURL(
        "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi",
        { telemetryInfo: { source: "internal" } }
      );
      addon = await install.install();
      info.version = addon?.version;
    } catch (e) {
      info.installError = String(e);
      return;
    }
    // Let it load its filter lists.
    await waitFor(() => WebExtensionPolicy.getByID("uBlock0@raymondhill.net")?.extension?.backgroundState == "running", 30000);
    await wait(8000);
    info.timesWith = await timeLoads();
    let state = () => ({
      url: B.selected.url,
      title: B.selected.title,
      uri: B.selectedBrowser.currentURI?.spec,
      loading: B.selectedBrowser.webProgress?.isLoadingDocument,
      busy: B.selected.el.hasAttribute("busy"),
    });
    let tab = B.openTab(B.homepage());
    await wait(2000);
    info.home = state();
    B.run("open example.com");
    let fromHome = await waitFor(() => B.selected.title == "Example Domain", 20000);
    info.fromHome = state();
    await this.screenshot(outDir, "40-ublock-open-from-home.png");
    check("with uBlock Origin, :open from the home page opens the site", fromHome);
    B.run("open https://www.wikipedia.org/");
    let fromSite = await waitFor(() => /wikipedia/i.test(B.selected.title), 20000);
    info.fromSite = state();
    check("with uBlock Origin, :open from a site opens another site", fromSite);
    B.run("open -t example.org");
    let newTab = await waitFor(() => B.selected.title == "Example Domain" && /example\.org/.test(B.selected.url), 20000);
    info.newTab = state();
    check("with uBlock Origin, :open -t opens the site in a new tab", newTab);
    info.log = Services.console
      .getMessageArray()
      .map(m => m.message ?? m.errorMessage ?? "")
      .filter(m => /ublock|uBlock|NS_ERROR|blocked/i.test(m))
      .slice(-15);
    B.closeTab(B.selected);
    B.closeTab(tab);
    await addon.uninstall();
  },

  // The real Google sign-in page (needs the internet): the logins show
  // by themselves and picking one fills the email.
  /** Keys and rows for the Bitwarden tests. */
  // Gecko's own password manager filling from the unlocked vault, and how fast Ctrl+Shift+L is.
  async bitwardenAutofill(B, check, waitFor, press, outDir, report, loginPage, bw) {
    let info = (report.info.bitwardenAutofill = {});
    let { rows, shortcut, pickRow } = bw;
    let field = async id => {
      let list = await this.testActor(B.selectedBrowser).sendQuery("SelfTest:Inputs", {}).catch(() => []);
      return list.find(i => i.id == id)?.value;
    };
    // Ctrl+Shift+L with the vault unlocked: the rows come from memory, not bw.exe.
    B.closeTab(B.selected);
    B.openTab(loginPage);
    await waitFor(() => B.selected.title == "login", 10000);
    await new Promise(r => setTimeout(r, 500));
    await this.clickElement("#user");
    press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
    let started = Date.now();
    shortcut();
    let shown = await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 10000);
    info.shortcutMs = Date.now() - started;
    check(`Ctrl+Shift+L shows the logins quickly with the vault unlocked (${info.shortcutMs} ms)`, shown && info.shortcutMs < 1000);
    press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
    // Two logins for the site: clicking the username box lists them (Gecko's dropdown).
    B.selectedBrowser.focus();
    await this.clickElement("#pass");
    await this.clickElement("#user");
    let popup = () => document.getElementById("PopupAutoComplete");
    let listed = await waitFor(() => popup()?.state == "open", 8000);
    await new Promise(r => setTimeout(r, 300));
    // Rows are <richlistitem><autocomplete-row-item>, which draws its label in its shadow root.
    let rowText = r => {
      let item = r.querySelector("autocomplete-row-item");
      return [item?.label, item?.description, item?.shadowRoot?.textContent].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    };
    info.dropdown = popup()
      ? {
          state: popup().state,
          rows: [...popup().querySelectorAll("richlistitem")].map(r => ({
            text: rowText(r),
            upgraded: !!customElements.get("autocomplete-row-item"),
            style: r.getAttribute("originaltype"),
            height: r.getBoundingClientRect().height,
            shadow: !!r.querySelector("autocomplete-row-item")?.shadowRoot,
          })),
        }
      : null;
    check(
      "clicking a login box lists the vault's logins for the site",
      listed && info.dropdown.rows.some(r => r.text.includes("breached-user") && r.height > 0)
    );
    await this.screenshot(outDir, "14e-bitwarden-autofill-list.png");
    if (listed) {
      press("ArrowDown", "ArrowDown", KeyboardEvent.DOM_VK_DOWN);
      press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    }
    let filled = await waitFor(() => /^filled /.test(B.selected.title), 8000);
    info.dropdownTitle = B.selected.title;
    check("picking one fills the username and password", filled && B.selected.title == "filled breached-user / breached-pass");
    B.closeTab(B.selected);
    // One login for the site: filled in when the page loads.
    B.openTab(loginPage.replace("127.0.0.1", "localhost"));
    let auto = await waitFor(async () => (await field("pass")) > 0 && (await field("user")) == "single-user", 10000);
    info.loadFilled = { user: await field("user"), pass: await field("pass") };
    check("a site's only login is filled in when the page loads", auto);
    await this.screenshot(outDir, "14f-bitwarden-autofill-load.png");
    B.closeTab(B.selected);
    check("nothing is saved in Gecko's own password store", !(await Services.logins.getAllLogins()).some(l => /breached-user|other-user|single-user/.test(l.username)));
    B.openTab(loginPage);
  },

  bitwardenKeys(press, waitFor) {
    let rows = () => [...document.querySelectorAll("#picker .picker-row:not(.picker-empty)")];
    return {
      rows,
      /** Moves down to the row whose text matches, then Enter. */
      pickRow(label) {
        let at = rows().findIndex(r => label.test(r.textContent));
        for (let i = 0; i < at; i++) {
          press("ArrowDown", "ArrowDown", KeyboardEvent.DOM_VK_DOWN);
        }
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
      },
      type(text) {
        for (let c of text) {
          let code = /\d/.test(c) ? "Digit" + c : "Key" + c.toUpperCase();
          press(c, code, KeyboardEvent["DOM_VK_" + c.toUpperCase()]);
        }
      },
      shortcut: () => press("L", "KeyL", KeyboardEvent.DOM_VK_L, ["Control", "Shift"]),
      promptHas: text =>
        waitFor(() => !document.getElementById("commandbar").hidden && document.getElementById("prompt").textContent.includes(text), 15000),
      clipboard() {
        try {
          let trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
          trans.init(null);
          trans.addDataFlavor("text/plain");
          Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard, window.browsingContext.currentWindowContext);
          let data = {};
          trans.getTransferData("text/plain", data);
          return data.value?.QueryInterface(Ci.nsISupportsString).data ?? null;
        } catch (e) {
          return String(e);
        }
      },
    };
  },

  async installUblock(info, waitFor) {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    try {
      let install = await AddonManager.getInstallForURL(
        "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi",
        { telemetryInfo: { source: "internal" } }
      );
      let addon = await install.install();
      await waitFor(() => WebExtensionPolicy.getByID("uBlock0@raymondhill.net")?.extension?.backgroundState == "running", 30000);
      await new Promise(r => setTimeout(r, 8000));
      return addon;
    } catch (e) {
      info.ublockInstallError = String(e);
      return null;
    }
  },

  async googleSignin(B, check, waitFor, press, outDir, report, label = "") {
    let wait = ms => new Promise(r => setTimeout(r, ms));
    let info = (report.info.google = {});
    let errorsBefore = Services.console.getMessageArray().length;
    // Like signing in from YouTube: the same tab goes from YouTube to Google.
    B.openTab("https://www.youtube.com/");
    await waitFor(() => /youtube/i.test(B.selected.title) && !B.selected.el.hasAttribute("busy"), 30000);
    B.run("open https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/");
    let loaded = await waitFor(
      () => /accounts\.google\.com/.test(B.selectedBrowser.currentURI?.spec) && !B.selectedBrowser.webProgress?.isLoadingDocument,
      30000
    );
    await wait(1500);
    info.url = B.selectedBrowser.currentURI?.spec;
    let bc = B.selectedBrowser.browsingContext;
    let current = BrowsingContext.getCurrentTopByBrowserId(B.selectedBrowser.browserId);
    info.context = {
      tabTitle: B.selected.title,
      hasWindowGlobal: !!bc?.currentWindowGlobal,
      sameAsCurrentTop: bc === current,
      currentHasWindowGlobal: !!current?.currentWindowGlobal,
      discarded: bc?.isDiscarded,
    };
    if (!loaded) {
      info.skipped = "Google's sign-in didn't load";
      B.closeTab(B.selected);
      return;
    }
    let { rows, shortcut, pickRow } = this.bitwardenKeys(press, waitFor);
    let inputs = async () => {
      try {
        return await this.testActor(B.selectedBrowser).sendQuery("SelfTest:Inputs", {});
      } catch (e) {
        return String(e);
      }
    };
    let pasteEmail = async () => {
      await this.clickElement("#identifierId");
      shortcut();
      let shown = await waitFor(() => !document.getElementById("picker").hidden && rows().length >= 1, 15000);
      if (shown) {
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        await waitFor(() => rows().some(r => /paste username/.test(r.textContent)), 10000);
        pickRow(/paste username/);
      }
      let pasted = await waitFor(async () => {
        let list = await inputs();
        return Array.isArray(list) && list.some(i => i.id == "identifierId" && i.value == "breached-user");
      }, 10000);
      return { shown, pasted };
    };
    try {
      info.credentials = await this.testActor(B.selectedBrowser).sendQuery("SelfTest:Credentials", {});
    } catch (e) {
      info.credentials = String(e);
    }
    check(
      "on Google's sign-in, Breached answers passkey requests itself (not Windows)" + label,
      ChromeUtils.importESModule("resource://breached/Passkeys.sys.mjs").Passkeys.running &&
        Services.prefs.getBoolPref("security.webauth.webauthn_enable_softtoken")
    );
    // Google offers passkeys when the browser says it has a built-in authenticator.
    info.isUVPAA = await this.testActor(B.selectedBrowser)
      .sendQuery("SelfTest:UVPAA", {})
      .catch(e => String(e));
    let first = await pasteEmail();
    info.inputs = await inputs();
    info.message = document.getElementById("message").textContent;
    await this.screenshot(outDir, `14f-google-filled${label ? "-ublock" : ""}.png`);
    check("on Google's sign-in, Ctrl+Shift+L shows the logins" + label, first.shown);
    check("and pastes the username into Google's email box" + label, first.pasted);
    // After a reload too.
    B.selectedBrowser.reload();
    await wait(1500);
    await waitFor(() => !B.selectedBrowser.webProgress?.isLoadingDocument, 20000);
    await wait(1000);
    let again = await pasteEmail();
    info.afterReloadMessage = document.getElementById("message").textContent;
    check("after a reload, it still pastes into Google's email box" + label, again.pasted);
    B.closeTab(B.selected);
  },

  // Bitwarden makes a passkey for a page and signs in with it; the page
  // checks the signature itself (scripts/test/passkey.html).
  async passkeys(B, check, waitFor, press, outDir, report, loginPage) {
    const { Passkeys } = ChromeUtils.importESModule("resource://breached/Passkeys.sys.mjs");
    check(
      "with the Bitwarden mod, Breached answers passkey requests itself (Windows isn't asked)",
      Passkeys.running &&
        Services.prefs.getBoolPref("security.webauth.webauthn_enable_softtoken") &&
        !Services.prefs.getBoolPref("security.webauth.webauthn_enable_usbtoken")
    );
    // WebAuthn wants a domain, so localhost rather than 127.0.0.1.
    let page = loginPage.replace("127.0.0.1", "localhost").replace(/[^/]*$/, "passkey.html");
    let message = () => document.getElementById("message").textContent;
    B.openTab(page);
    let saved = await waitFor(() => /Saved a passkey/.test(message()), 20000);
    report.info.passkeySaveMessage = message();
    report.info.passkeyTitleAfterCreate = B.selected.title;
    check("a site making a passkey: Breached makes it and keeps it in Bitwarden", saved);
    await this.screenshot(outDir, "14b-passkey-save.png");
    let verified = await waitFor(() => /^passkey:(verified|not|bad|[A-Z])/.test(B.selected.title), 15000);
    report.info.passkeyResult = B.selected.title;
    report.info.passkeyLog = Services.console
      .getMessageArray()
      .map(m => m.message ?? m.errorMessage ?? "")
      .filter(m => /passkey|webauthn/i.test(m));
    check("signing in with it: the site accepts the passkey's signature", verified && B.selected.title == "passkey:verified");
    // The page's login box then offers passkeys (conditional mediation):
    // Ctrl+Shift+L shows the passkey first, then the logins.
    let bw = this.bitwardenKeys(press, waitFor);
    await new Promise(r => setTimeout(r, 1000));
    report.info.passkeyWaiting = Passkeys.waiting(B.selectedBrowser);
    bw.shortcut();
    let offered = await waitFor(
      () => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes("bitwarden:"),
      15000
    );
    report.info.passkeyOfferRows = [...document.querySelectorAll("#picker .picker-row")].map(r => r.textContent);
    check(
      "a login box offering passkeys: Ctrl+Shift+L shows Bitwarden's passkey and logins",
      offered && /passkey/.test(report.info.passkeyOfferRows[0])
    );
    await this.screenshot(outDir, "14d-passkey-offer.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let signedIn = await waitFor(() => /^passkey:conditional/.test(B.selected.title), 15000);
    report.info.passkeyConditional = B.selected.title;
    check("picking the passkey there signs in", signedIn && B.selected.title == "passkey:conditional verified");
    B.closeTab(B.selected);

    // Locked, as after a restart: the request asks to unlock, which loads the vault's passkeys.
    B.run("bw.exe lock");
    Passkeys.unload();
    B.openTab(page + "#signin");
    let asked = await waitFor(
      () => !document.getElementById("commandbar").hidden && /PIN|master password/.test(document.getElementById("prompt").textContent),
      15000
    );
    report.info.passkeyLockedResult = B.selected.title;
    report.info.passkeyLockedMessage = message();
    report.info.passkeyLockedPrompt = document.getElementById("prompt").textContent;
    check("a passkey request while Bitwarden is locked asks to unlock it", asked);
    if (/master password/.test(report.info.passkeyLockedPrompt)) {
      // (The PIN is kept in memory; a mod reloaded since has forgotten it.)
      bw.type("hunter2");
      press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
      if (await bw.promptHas("choose a PIN")) {
        press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
      }
    } else {
      bw.type("1234");
      press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    }
    check(
      "unlocking loads the vault's passkeys into Breached",
      await waitFor(() => Passkeys.loaded && [...Passkeys.known.values()].some(p => p.rpId == "localhost" && p.itemId), 15000)
    );
    report.info.passkeysLoaded = [...Passkeys.known.values()].map(p => ({ rpId: p.rpId, name: p.name, signCount: p.signCount }));
    B.selectedBrowser.reload();
    let again = await waitFor(() => /^passkey:signin /.test(B.selected.title), 15000);
    report.info.passkeyResultAgain = B.selected.title;
    check("then the site signs in with the passkey from the vault", again && B.selected.title == "passkey:signin 1,2,3,4");
    B.closeTab(B.selected);
  },

  // Sites ask in the command bar; "always" is remembered.
  async permissions(B, check, waitFor, wait, press, outDir, report) {
    let loginPage = Services.env.get("BREACHED_TEST_LOGIN_PAGE");
    if (!loginPage) {
      return;
    }
    let page = loginPage.replace(/[^/]*$/, "permissions.html");
    let origin = new URL(page).origin;
    let principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
    // Fake camera and microphone, still asking like real ones.
    Services.prefs.setBoolPref("media.navigator.streams.fake", true);
    Services.prefs.setBoolPref("media.navigator.permission.fake", true);
    let rows = () => [...document.querySelectorAll("#picker .picker-row:not(.picker-empty)")].map(r => r.textContent);
    let type = text => {
      for (let c of text) {
        press(c, "Key" + c.toUpperCase(), KeyboardEvent["DOM_VK_" + c.toUpperCase()]);
      }
    };
    let asking = what =>
      waitFor(() => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes(what), 10000);

    B.openTab(page + "#camera");
    let asked = await asking("wants to use your camera and microphone");
    report.info.permissionPrompt = document.getElementById("prompt").textContent;
    report.info.permissionRows = rows();
    check("a site asking for the camera and microphone asks in the command bar", asked);
    check("the question offers allow, always, block and never", rows().length == 4);
    await this.screenshot(outDir, "17-permission-prompt.png");
    type("always");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let allowed = await waitFor(() => B.selected.title.startsWith("camera:"), 15000);
    report.info.cameraResult = B.selected.title;
    check("allowing gives the page the camera and microphone", allowed && B.selected.title == "camera:ok");
    check(
      '"always" is remembered for the site',
      Services.perms.testExactPermissionFromPrincipal(principal, "camera") == Services.perms.ALLOW_ACTION &&
        Services.perms.testExactPermissionFromPrincipal(principal, "microphone") == Services.perms.ALLOW_ACTION
    );
    check(
      "the tab is marked while the camera is on",
      await waitFor(() => B.selected.el.hasAttribute("recording") && B.selected.recording.includes("camera"), 5000)
    );
    check("a tab using the camera isn't unloaded", !!B.keepAwakeReason(B.selected));
    await this.screenshot(outDir, "18-camera-on.png");
    B.closeTab(B.selected);

    B.openTab(page + "#camera");
    let again = await waitFor(() => B.selected.title.startsWith("camera:"), 15000);
    check("a remembered site isn't asked again", again && B.selected.title == "camera:ok" && document.getElementById("picker").hidden);
    B.closeTab(B.selected);

    B.openTab(page + "#geo");
    let geoAsked = await asking("wants to know your location");
    check("a site asking for your location asks in the command bar", geoAsked);
    press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
    let geoDone = await waitFor(() => B.selected.title.startsWith("geo:"), 10000);
    report.info.geoResult = B.selected.title;
    check("Escape blocks it this time", geoDone && B.selected.title == "geo:denied");
    check(
      "blocking once isn't remembered",
      Services.perms.testExactPermissionFromPrincipal(principal, "geo") == Services.perms.UNKNOWN_ACTION
    );
    B.closeTab(B.selected);

    B.run("permissions");
    let doc = () => B.selectedBrowser.contentDocument;
    let listed = await waitFor(
      () => B.selected.url == "breached:settings#site-permissions" &&
        doc()?.querySelectorAll("#site-permission-list .site-permission").length == 2,
      5000
    );
    check(":permissions lists the saved answers in settings", listed);
    await this.screenshot(outDir, "19-site-permissions.png");
    for (let button of doc()?.querySelectorAll("#site-permission-list button") ?? []) {
      button.click();
      await wait(100);
    }
    check(
      "settings: a saved answer can be forgotten",
      Services.perms.testExactPermissionFromPrincipal(principal, "camera") == Services.perms.UNKNOWN_ACTION
    );
    B.closeTab(B.selected);
    Services.prefs.clearUserPref("media.navigator.streams.fake");
    Services.prefs.clearUserPref("media.navigator.permission.fake");
  },

  // Pinned websites on the new tab page.
  async pins(B, check, waitFor, wait, outDir, report) {
    const Pins = ChromeUtils.importESModule("resource://breached/Pins.sys.mjs");
    B.openTab("breached:home");
    let doc = () => B.selectedBrowser.contentDocument;
    let tiles = () => doc()?.querySelectorAll("#pin-list .pin") ?? [];
    check("the new tab page has a pinned section", await waitFor(() => doc()?.getElementById("pin-empty") && !doc().getElementById("pin-empty").hidden, 5000));
    B.run("pin https://example.com/");
    B.run("pin example.org");
    check(":pin adds sites to the new tab page", await waitFor(() => tiles().length == 2, 3000));
    check("pinned sites keep their order", Pins.list().map(s => new URL(s.url).host).join() == "example.com,example.org");
    Pins.move(1, 0);
    check("pinned sites can be reordered", await waitFor(() => tiles()[0]?.title.includes("example.org"), 3000));
    await this.screenshot(outDir, "20-pinned-sites.png");
    doc().querySelector("#pin-list .unpin").click();
    check("a pinned site can be unpinned from the page", await waitFor(() => tiles().length == 1, 3000));
    B.run("unpin 1");
    check(":unpin takes one off", Pins.list().length == 0);
    B.closeTab(B.selected);
  },

  async dailyDriver(B, check, waitFor, wait, outDir, report) {
    const base = "http://127.0.0.1:8123/";
    const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    let info = (report.info.dailyDriver = {});

    // Private window: private pages, no history, closes with its last tab.
    let privateURL = base + "menu.html?private";
    let pwin = B.openPrivateWindow(privateURL);
    let pB = () => pwin.Breached;
    let privateLoaded = await waitFor(() => pB()?.selected?.title == "menu", 20000);
    check("private: :private opens a window with the page", privateLoaded);
    check("private: the window is private", PrivateBrowsingUtils.isWindowPrivate(pwin));
    let pb = pB()?.selectedBrowser;
    info.private = {
      usePrivateBrowsing: pb?.browsingContext.usePrivateBrowsing,
      privateBrowsingId: pb?.contentPrincipal?.privateBrowsingId,
      title: pwin.document.title,
      tabs: pB()?.tabs.map(t => t.url),
      remote: pb?.isRemoteBrowser,
    };
    check("private: its pages load privately", pb?.browsingContext.usePrivateBrowsing && pb.contentPrincipal.privateBrowsingId > 0);
    check("private: the title says so", pwin.document.title.includes("(private)"));
    await wait(1500);
    await this.screenshot(outDir, "12-private.png", pwin);
    check("private: no history kept", !(await PlacesUtils.history.hasVisits(privateURL)));
    pB().closeTab();
    check("private: closing its last tab closes it", await waitFor(() => pwin.closed, 5000));
    window.focus();
    await wait(500);

    // The right-click menu, with an extension's item
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    let extDir = PathUtils.join(PathUtils.tempDir, "breached-menu-extension");
    await IOUtils.remove(extDir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(extDir);
    await IOUtils.writeJSON(PathUtils.join(extDir, "manifest.json"), {
      manifest_version: 2,
      name: "Menu test",
      version: "1.0",
      browser_specific_settings: { gecko: { id: "menutest@breached.browser" } },
      permissions: ["menus", "tabs", "<all_urls>"],
      background: { scripts: ["background.js"] },
    });
    await IOUtils.writeUTF8(
      PathUtils.join(extDir, "background.js"),
      `browser.menus.create({ id: "link", title: "Menu test: link", contexts: ["link"] });
       browser.menus.onClicked.addListener((info, tab) => {
         browser.tabs.executeScript(tab.id, { code: "document.title = " + JSON.stringify("clicked:" + info.linkUrl) });
       });`
    );
    let menuAddon = null;
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(extDir);
      menuAddon = await AddonManager.installTemporaryAddon(file);
    } catch (e) {
      info.menuExtension = String(e);
    }
    await wait(1500);
    B.openTab(base + "menu.html");
    await waitFor(() => B.selected.title == "menu" && !B.selected.el.hasAttribute("busy"), 15000);
    await wait(500);
    let menu = () => document.getElementById("contextmenu");
    try {
      ChromeUtils.registerWindowActor("BreachedSelfTest", {
        child: { esModuleURI: "resource://breached/SelfTestChild.sys.mjs" },
        messageManagerGroups: ["browsers"],
        safeForUntrustedWebProcess: true,
      });
    } catch (e) {
      info.testActor = String(e);
    }
    // Mouse events made in the page's own process.
    let mouse = async (type, x, y, button = 0) =>
      B.selectedBrowser.browsingContext.currentWindowGlobal
        .getActor("BreachedSelfTest")
        .sendQuery("SelfTest:Mouse", { type, x, y, button });
    let realShow = B.contextMenu.show;
    info.menuShown = 0;
    B.contextMenu.show = function (...args) {
      info.menuShown++;
      try {
        let result = realShow.apply(this, args);
        let popup = menu();
        info.menuStates = info.menuStates ?? [];
        info.menuStates.push({ items: popup?.childElementCount, state: popup?.state, x: args[1]?.x, y: args[1]?.y });
        setTimeout(() => info.menuStates.push({ later: menu()?.state }), 500);
        return result;
      } catch (e) {
        info.menuError = `${e}\n${e.stack}`;
        throw e;
      }
    };
    let rightClick = async (x, y) => {
      let r = B.selectedBrowser.getBoundingClientRect();
      window.synthesizeMouseEvent("contextmenu", r.left + x, r.top + y, { button: 2, buttons: 0, clickCount: 1 });
      if (!(await waitFor(() => menu()?.state == "open", 1500))) {
        info.rightClickInPage = await mouse("contextmenu", x, y, 2).catch(e => String(e));
        if (!(await waitFor(() => menu()?.state == "open", 5000))) {
          return [];
        }
      }
      return [...menu().children].map(e => e.getAttribute("label") || "—");
    };
    let closeMenu = async () => {
      menu()?.hidePopup();
      await waitFor(() => !menu() || menu().state == "closed", 3000);
    };
    let choose = async id => {
      let item = document.getElementById("context-" + id);
      item?.doCommand();
      await closeMenu();
      return !!item;
    };

    let onLink = await rightClick(40, 30);
    info.linkMenu = onLink;
    check("menu: right-click on a link shows link items", onLink.includes("Open link in new tab") && onLink.includes("Copy link"));
    check("menu: extension items show", onLink.includes("Menu test: link"));
    await this.screenshot(outDir, "12a-menu-link.png");
    check("menu: Copy link", await choose("copylink"));

    // A real right-click presses the mouse first, which focuses the field.
    for (let type of ["mousedown", "mouseup"]) {
      await mouse(type, 40, 160).catch(e => (info.focusField = String(e)));
    }
    await wait(300);
    let onField = await rightClick(40, 160);
    info.fieldMenu = onField;
    check("menu: a text field gets cut, copy, paste", ["Cut", "Copy", "Paste", "Select all"].every(l => onField.includes(l)));
    await choose("paste");
    let pasted = await waitFor(() => B.selected.title == "field:" + base + "login.html", 5000);
    info.afterPaste = B.selected.title;
    check("menu: Paste pastes the copied link into the page", pasted);

    let onImage = await rightClick(40, 100);
    info.imageMenu = onImage;
    check("menu: an image gets image items", onImage.includes("Save image") && onImage.includes("Open image in new tab"));
    let list = await Downloads.getList(Downloads.PUBLIC);
    let before = (await list.getAll()).length;
    await choose("savemedia");
    let saved = null;
    await waitFor(() => {
      list.getAll().then(all => (saved = all.slice(before).find(d => d.succeeded && d.target.path.endsWith(".svg"))));
      return saved;
    }, 15000);
    info.saved = saved?.target.path ?? null;
    check("menu: Save image downloads it", saved && (await IOUtils.exists(saved.target.path)));
    if (saved) {
      await IOUtils.remove(saved.target.path, { ignoreAbsent: true });
      await list.remove(saved);
    }

    let onPage = await rightClick(500, 400);
    info.pageMenu = onPage;
    check("menu: the page gets back, reload, print, view source", ["Back", "Reload", "Print…", "View page source"].every(l => onPage.includes(l)));
    await closeMenu();

    // An extension's item gets the click, with the tab.
    await rightClick(40, 30);
    let extItem = [...(menu()?.children ?? [])].find(e => e.getAttribute("label") == "Menu test: link");
    extItem?.doCommand();
    await closeMenu();
    B.contextMenu.show = realShow;
    let extClicked = await waitFor(() => B.selected.title == "clicked:" + base + "login.html", 8000);
    info.afterExtensionClick = B.selected.title;
    check("menu: an extension's item tells the extension what was clicked", extClicked);
    await menuAddon?.uninstall();

    // Zoom per site: the same site follows, other sites keep their own.
    B.run("zoom 150");
    let sameSite = B.openTab(base + "login.html");
    await waitFor(() => sameSite.title && !sameSite.el.hasAttribute("busy"), 10000);
    info.zoomSameSite = sameSite.browser.fullZoom;
    check("zoom: kept for the site's other pages", Math.abs(sameSite.browser.fullZoom - 1.5) < 0.01);
    B.load(sameSite.browser, "http://localhost:8123/login.html");
    sameSite.url = "http://localhost:8123/login.html";
    await waitFor(() => sameSite.browser.currentURI.host == "localhost" && !sameSite.el.hasAttribute("busy"), 10000);
    info.zoomOtherSite = sameSite.browser.fullZoom;
    check("zoom: other sites aren't zoomed", Math.abs(sameSite.browser.fullZoom - 1) < 0.01);
    B.closeTab(sameSite);
    B.run("zoom 100");
    check("zoom: 100% forgets the site", !Services.prefs.getStringPref("breached.zoom.sites", "{}").includes("127.0.0.1"));

    // Printing, to a PDF instead of the printer (the dialog is skipped).
    let realDialog = B.printDialog;
    let pdfs = [];
    B.printDialog = async settings => {
      let path = PathUtils.join(outDir, `print-${pdfs.length + 1}.pdf`);
      pdfs.push(path);
      settings.outputDestination = Ci.nsIPrintSettings.kOutputDestinationFile;
      settings.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
      settings.toFileName = path;
      return true;
    };
    try {
      info.printDialogService = typeof Cc["@mozilla.org/widget/printdialog-service;1"]?.getService(Ci.nsIPrintDialogService)
        .showPrintDialog;
    } catch (e) {
      info.printDialogService = String(e);
    }
    let printed = async (n, what) => {
      let asked = await waitFor(() => pdfs.length >= n, 10000);
      let gone = asked && (await waitFor(() => !document.querySelector("browser.print-clone"), 15000));
      await wait(1000);
      let stat = pdfs[n - 1] ? await IOUtils.stat(pdfs[n - 1]).catch(() => null) : null;
      info[what] = { asked, gone, size: stat?.size ?? null, dialogs: pdfs.length };
      return gone && stat?.size > 500;
    };
    try {
      let tabsBefore = B.tabs.length;
      B.print();
      check("print: Ctrl+P prints the page", await printed(1, "ctrlP"));
      check("print: Ctrl+P asks once", pdfs.length == 1);
      // The page's own print button (window.print())
      for (let type of ["mousedown", "mouseup"]) {
        await mouse(type, 40, 220).catch(e => (info.printClick = String(e)));
      }
      check("print: a page's print button prints", await printed(2, "windowPrint"));
      check("print: no tab is left behind", B.tabs.length == tabsBefore && pdfs.length == 2);
    } finally {
      B.printDialog = realDialog;
    }
    B.closeTab(B.selected);
  },

  async tabBarHover(B, check, waitFor, wait, outDir, report) {
    let info = (report.info.tabBar = {});
    let $ = id => document.getElementById(id);
    let shown = () => getComputedStyle($("tabbar")).visibility == "visible";
    let P = Services.prefs;
    B.openTab("about:blank", { background: true });
    P.setStringPref("breached.tabs.position", "left");
    await wait(300);
    let bar = $("tabbar").getBoundingClientRect();
    let content = $("content").getBoundingClientRect();
    info.left = { bar: [bar.left, bar.top, bar.width, bar.height], content: [content.left, content.width] };
    check("tabs on the left: a column beside the page", bar.right <= content.left + 1 && bar.height > bar.width && bar.width > 50);
    await this.screenshot(outDir, "21-tabs-left.png");
    P.setStringPref("breached.tabs.position", "right");
    await wait(300);
    bar = $("tabbar").getBoundingClientRect();
    content = $("content").getBoundingClientRect();
    check("tabs on the right: a column beside the page", bar.left >= content.right - 1 && bar.height > bar.width);

    // Hidden, then shown by the mouse at the window's edge
    let move = (x, y) => window.synthesizeMouseEvent("mousemove", x, y, { button: 0, buttons: 0 });
    move(window.innerWidth / 2, window.innerHeight / 2);
    P.setBoolPref("breached.tabs.autohide", true);
    await wait(500);
    content = $("content").getBoundingClientRect();
    info.hiddenColumn = { shown: shown(), content: [content.left, content.width], window: window.innerWidth, peek: document.documentElement.hasAttribute("tabs-peek") };
    check("hidden column: the page takes the whole width", content.width >= window.innerWidth - 2);
    check("hidden column: hidden", await waitFor(() => !shown(), 3000));
    move(window.innerWidth - 1, window.innerHeight / 2);
    let hovered = await waitFor(shown, 3000);
    info.rightEdge = hovered;
    check("show on hover: the mouse at the right edge shows the column", hovered);
    await this.screenshot(outDir, "22-tabs-right-hover.png");
    move(window.innerWidth / 2, window.innerHeight / 2);
    check("show on hover: it goes again when the mouse leaves", await waitFor(() => !shown(), 3000));

    P.setStringPref("breached.tabs.position", "bottom");
    await wait(500);
    check("hidden bottom bar starts hidden", !shown());
    move(window.innerWidth / 2, window.innerHeight - 1);
    check("show on hover: the mouse at the bottom edge shows the tab bar", await waitFor(shown, 3000));
    move(window.innerWidth / 2, window.innerHeight / 2);
    await waitFor(() => !shown(), 3000);
    P.setBoolPref("breached.tabs.showOnHover", false);
    await wait(300);
    move(window.innerWidth / 2, window.innerHeight - 1);
    await wait(800);
    check("show on hover can be turned off", !shown());
    move(window.innerWidth / 2, window.innerHeight / 2);
    for (let name of ["breached.tabs.position", "breached.tabs.autohide", "breached.tabs.showOnHover"]) {
      P.clearUserPref(name);
    }
    await wait(300);
    B.closeTab(B.tabs[B.tabs.length - 1]);
  },

  async navButtons(B, check, waitFor, wait, outDir, report) {
    let $ = id => document.getElementById(id);
    let base = "http://127.0.0.1:8123/";
    let click = el => {
      let r = el.getBoundingClientRect();
      window.synthesizeMouseEvent("mousedown", r.left + r.width / 2, r.top + r.height / 2, { button: 0 });
      window.synthesizeMouseEvent("mouseup", r.left + r.width / 2, r.top + r.height / 2, { button: 0 });
    };
    let tab = B.openTab(base + "?nav=1");
    B.selectTab(tab);
    let at = n => waitFor(() => tab.browser?.currentURI?.spec == base + "?nav=" + n, 10000);
    await at(1);
    check("back and forward show in the tab bar", $("nav-back").getBoundingClientRect().width > 0 && $("nav-back").parentNode.parentNode == $("tabbar"));
    check("back is greyed out with nowhere to go", await waitFor(() => $("nav-back").disabled, 3000));
    B.load(tab.browser, base + "?nav=2");
    await at(2);
    check("back turns on after a second page", await waitFor(() => !$("nav-back").disabled, 5000));
    await this.screenshot(outDir, "22a-nav-buttons.png");
    click($("nav-back"));
    check("the back button goes back", await at(1));
    check("forward turns on after going back", await waitFor(() => !$("nav-forward").disabled, 5000));
    click($("nav-forward"));
    check("the forward button goes forward", await at(2));
    check("tabs stay in order beside the buttons", B.tabs.every((t, i) => $("tabbar").querySelectorAll(":scope > .tab")[i] == t.el));
    Services.prefs.setBoolPref("breached.tabs.navButtons", false);
    await wait(300);
    check("the buttons can be switched off", $("nav-back").getBoundingClientRect().width == 0);
    Services.prefs.clearUserPref("breached.tabs.navButtons");
    B.closeTab(tab);
  },

  async readerView(B, check, waitFor, wait, outDir, report) {
    let info = (report.info.reader = {});
    let base = "http://127.0.0.1:8123/";
    try {
      ChromeUtils.registerWindowActor("BreachedSelfTest", {
        child: { esModuleURI: "resource://breached/SelfTestChild.sys.mjs" },
        messageManagerGroups: ["browsers"],
        safeForUntrustedWebProcess: true,
      });
    } catch (e) {
      // registered by an earlier step
    }
    let tab = B.openTab(base + "article.html");
    await waitFor(() => tab.title == "A long walk" && !tab.el.hasAttribute("busy"), 15000);
    B.run("reader");
    let entered = await waitFor(() => tab.browser.currentURI.spec.startsWith("about:reader"), 10000);
    let page = null;
    await waitFor(() => {
      tab.browser.browsingContext.currentWindowGlobal
        ?.getActor("BreachedSelfTest")
        .sendQuery("SelfTest:Reader")
        .then(r => (page = r), e => (info.queryError = String(e)));
      return page?.chars > 1000;
    }, 15000);
    info.page = page;
    check("reader view: :reader opens the article in about:reader", entered && page?.chars > 1000);
    await wait(500);
    await this.screenshot(outDir, "23-reader.png");
    B.run("reader");
    let left = await waitFor(() => tab.browser.currentURI.spec == base + "article.html", 10000);
    check("reader view: :reader again goes back to the page", left);
    B.closeTab(tab);
  },

  async drm(B, check, waitFor, wait, press, outDir, report) {
    let info = (report.info.drm = {});
    let eme = () => Services.prefs.getBoolPref("media.eme.enabled", false);
    let widevine = () => Services.prefs.getStringPref("media.gmp-widevinecdm.version", "");
    info.before = { eme: eme(), modInstalled: ModHost.Mods.isInstalled("drm") };
    check("protected video starts off, without its mod", !eme() && !info.before.modInstalled);
    let tab = B.openTab("http://127.0.0.1:8123/drm.html");
    let asked = await waitFor(
      () => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes("Protected video mod"),
      15000
    );
    info.prompt = document.getElementById("prompt").textContent;
    check("a site wanting protected video offers the Protected video mod", asked);
    await this.screenshot(outDir, "24-drm-prompt.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let modLoaded = await waitFor(() => ModHost.loaded.has("drm") && Commands.drm, 20000);
    check("get the mod installs it from the mods site", modLoaded);
    // The first try fails (it was off); the reload after the download works.
    let played = await waitFor(() => tab.title == "drm:ok" || /Couldn't/.test(document.getElementById("message").textContent), 150000);
    info.title = tab.title;
    info.after = {
      eme: eme(),
      version: widevine(),
      lastFail: Services.prefs.getStringPref("media.gmp-widevinecdm.lastInstallFailReason", ""),
      message: document.getElementById("message").textContent,
    };
    check("the mod downloads Widevine", !!widevine());
    check("the page gets Widevine after the reload", played && tab.title == "drm:ok");
    B.closeTab(tab);
    await ModHost.Mods.uninstall("drm");
    check("removing the mod turns protected video off", await waitFor(() => !ModHost.loaded.has("drm") && !eme(), 5000));
  },

  // The other mods on the mods site: passwords, bookmarks, Firefox Sync.
  async openFiles(B, check, waitFor, wait, outDir, report) {
    let info = (report.info.openFiles = {});
    // A one-page PDF saying "Hello Breached".
    let text = "BT /F1 24 Tf 72 720 Td (Hello Breached) Tj ET";
    let objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    let offsets = [];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    let xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    let dir = PathUtils.join(PathUtils.tempDir, "breached open test");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    let path = PathUtils.join(dir, "hello world.pdf");
    await IOUtils.writeUTF8(path, pdf);

    let cmdLine = Cu.createCommandLine(["-app", "C:\\x\\application.ini", "-osint", path], null, Ci.nsICommandLine.STATE_REMOTE_AUTO);
    let urls = urlsFromCommandLine(cmdLine);
    info.urls = urls;
    check("files: a path on the command line becomes a file address", urls.length == 1 && urls[0].startsWith("file:///") && urls[0].endsWith("hello%20world.pdf"));

    let before = B.tabs.length;
    let handler = Cc["@breached/command-line-handler;1"].getService(Ci.nsICommandLineHandler);
    handler.handle(Cu.createCommandLine([path], null, Ci.nsICommandLine.STATE_REMOTE_AUTO));
    check("files: opening a file while Breached runs opens it in a new tab", B.tabs.length == before + 1);
    let tab = B.selected;
    let shown = await waitFor(async () => {
      try {
        let el = await this.testActor(tab.browser).sendQuery("SelfTest:Element", { selector: "#viewerContainer" });
        return el?.rect ? el : null;
      } catch (e) {
        return null;
      }
    }, 15000);
    info.pdfUrl = tab.browser?.currentURI?.spec;
    check("files: a PDF shows in the built-in PDF viewer", !!shown);
    // The toolbar icons are masks; a snapshot of the whole window leaves
    // out masks inside pages, so this looks at the page's own snapshot.
    let actor = this.testActor(tab.browser);
    let pageShot = async rect => {
      let bmp = await tab.browser.browsingContext.currentWindowGlobal.drawSnapshot(rect, 1, "white");
      let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      return canvas;
    };
    let ink = async selector => {
      let r = (await actor.sendQuery("SelfTest:Element", { selector })).rect;
      let canvas = await pageShot(new DOMRect(r.x, r.y, r.width, r.height));
      let data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        n += data[i] < 160 ? 1 : 0;
      }
      return n;
    };
    info.iconInk = { zoomOut: await ink("#zoomOutButton"), zoomIn: await ink("#zoomInButton") };
    check("files: the PDF viewer's toolbar icons are drawn", info.iconInk.zoomOut >= 8 && info.iconInk.zoomIn > info.iconInk.zoomOut);
    try {
      let canvas = await pageShot(null);
      let blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      await IOUtils.write(PathUtils.join(outDir, "37-pdf-page.png"), new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      dump(`SELFTEST page screenshot failed: ${e}\n`);
    }
    let banner = await this.testActor(tab.browser).sendQuery("SelfTest:Element", { selector: "#featuresNotification:not([hidden])" });
    info.pdfBanner = !!banner?.rect?.height;
    await wait(1000);
    await this.screenshot(outDir, "37-pdf.png");
    B.closeTab(tab);
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  },

  // Picture-in-picture, page translation and custom CSS per site.
  async lastMods(B, check, waitFor, wait, press, outDir, report) {
    let info = (report.info.lastMods = {});
    let D = Services.prefs.getDefaultBranch("");
    let install = async id => {
      try {
        await ModHost.installFromSite(id, { confirm: false });
      } catch (e) {
        info[id + "Error"] = String(e);
      }
      return waitFor(() => ModHost.loaded.has(id), 10000);
    };
    let open = async (url, title) => {
      let tab = B.openTab(url);
      B.selectTab(tab);
      await waitFor(() => title.test(tab.title) && !tab.el.hasAttribute("busy"), 15000);
      return tab;
    };
    let message = () => document.getElementById("message")?.textContent ?? "";

    // Picture-in-picture: Firefox's player window, found through gBrowser.
    {
      let before = D.getBoolPref("media.videocontrols.picture-in-picture.enabled", false);
      check("the Picture-in-picture mod installs", await install("pip"));
      let tab = await open("http://127.0.0.1:8123/video.html", /^video:/);
      info.videoTitle = tab.title;
      check("pip: the test video plays", tab.title == "video:playing");
      let player = () => Services.wm.getMostRecentWindow("Toolkit:PictureInPicture");
      B.run("pip");
      let win = await waitFor(() => player(), 10000);
      info.pipMessage = message();
      check(":pip opens the video in a window on top", !!win);
      check("pip: the tab is marked", await waitFor(() => tab.el.hasAttribute("pictureinpicture"), 5000));
      if (win) {
        await waitFor(() => win.document.readyState == "complete", 5000);
        await wait(1000);
        await this.screenshot(outDir, "38-pip.png", win);
        B.run("pip");
        check(":pip again closes it", await waitFor(() => !player(), 10000));
        check("pip: the tab mark goes", await waitFor(() => !tab.el.hasAttribute("pictureinpicture"), 5000));
      }
      B.closeTab(tab);
      await ModHost.Mods.uninstall("pip");
      await waitFor(() => !ModHost.loaded.has("pip"), 10000);
      check("pip: removing it puts Gecko's setting back", D.getBoolPref("media.videocontrols.picture-in-picture.enabled", false) === before);
    }

    // Translation: on this computer, after downloading the language once.
    {
      check("the Translate pages mod installs", await install("translate"));
      check("translate: turns Firefox's translation on", Services.prefs.getBoolPref("browser.translations.enable"));
      // Firefox keeps its translation offer to itself while a test drives it.
      let { TranslationsParent } = ChromeUtils.importESModule("resource://gre/actors/TranslationsParent.sys.mjs");
      TranslationsParent.testAutomaticPopup = true;
      let tab = await open("http://127.0.0.1:8123/french.html", /promenade/i);
      let text = async () => (await this.testActor(tab.browser).sendQuery("SelfTest:Element", { selector: "#text" }))?.text ?? "";
      let offered = await waitFor(
        () => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes("Translate it?"),
        20000
      );
      info.translateOffer = document.getElementById("prompt").textContent;
      check("translate: a French page offers to translate it", !!offered);
      press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
      B.run("translate en");
      let english = await waitFor(async () => /\b(the|we|and)\b/i.test(await text()), 180000);
      info.translated = (await text()).slice(0, 160);
      info.translateMessage = message();
      check(":translate en translates the page", !!english);
      await this.screenshot(outDir, "39-translated.png");
      B.run("translate off");
      check(":translate off puts the French back", await waitFor(async () => /\bnous\b/.test(await text()), 20000));
      B.closeTab(tab);
      await ModHost.Mods.uninstall("translate");
      await waitFor(() => !ModHost.loaded.has("translate"), 10000);
      check("translate: removing it turns translation off again", !Services.prefs.getBoolPref("browser.translations.enable"));
    }

    // Custom CSS per site
    {
      check("the Custom CSS per site mod installs", await install("sitecss"));
      let tab = await open("http://127.0.0.1:8123/keys.html", /^keys$/);
      let background = async () =>
        (await this.testActor(tab.browser).sendQuery("SelfTest:Style", { selector: "body", props: ["background-color"] }))?.["background-color"];
      B.run("css body { background: rgb(1, 2, 3) !important }");
      check(":css <rules> styles the site at once", await waitFor(async () => (await background()) == "rgb(1, 2, 3)", 5000));
      info.cssMessage = message();
      info.cssBackground = await background();
      info.cssRoot = (await this.testActor(tab.browser).sendQuery("SelfTest:Element", { selector: "html" }))?.attrs;
      tab.browser.reload();
      await wait(500);
      await waitFor(() => !tab.el.hasAttribute("busy"), 10000);
      check("css: the rules stay for the site's pages", await waitFor(async () => (await background()) == "rgb(1, 2, 3)", 5000));
      B.run("css");
      info.cssEdit = B.$commandline.value;
      check(":css puts the site's rules in the command bar", B.$commandline.value.startsWith("css body { background: rgb(1, 2, 3)"));
      press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
      B.run("css off");
      check(":css off removes them", await waitFor(async () => (await background()) != "rgb(1, 2, 3)", 5000));
      B.closeTab(tab);
      await ModHost.Mods.uninstall("sitecss");
      Services.prefs.clearUserPref("breached.mods.sitecss.sites");
    }
  },

  async importing(B, check, waitFor, wait, press, outDir, report) {
    let info = (report.info.importing = {});
    let Import = ChromeUtils.importESModule("resource://breached/Import.sys.mjs");
    let { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
    let { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    let tmp = PathUtils.join(PathUtils.tempDir, "breached-import-test-" + Date.now());
    let local = PathUtils.join(tmp, "local");
    let roaming = PathUtils.join(tmp, "roaming");
    let env = { LOCALAPPDATA: Services.env.get("LOCALAPPDATA"), APPDATA: Services.env.get("APPDATA") };
    let makeDb = async (path, sql) => {
      let db = await Sqlite.openConnection({ path });
      for (let s of sql) {
        await db.execute(s);
      }
      await db.close();
    };
    try {
      // A Chrome with two bookmarks (one in a folder) and two pages of history.
      let chrome = PathUtils.join(local, "Google", "Chrome", "User Data", "Default");
      await IOUtils.makeDirectory(chrome, { createAncestors: true });
      await IOUtils.writeJSON(PathUtils.join(chrome, "Bookmarks"), {
        roots: {
          bookmark_bar: {
            name: "Bookmarks bar",
            type: "folder",
            children: [
              { type: "url", name: "Chrome one", url: "https://chrome-one.example/" },
              { type: "folder", name: "Stuff", children: [{ type: "url", name: "Chrome two", url: "https://chrome-two.example/" }] },
              { type: "url", name: "settings", url: "chrome://settings/" },
            ],
          },
          other: { name: "Other", type: "folder", children: [] },
        },
      });
      let chromeTime = (Date.now() + 11644473600000) * 1000;
      await makeDb(PathUtils.join(chrome, "History"), [
        "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)",
        `INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES ('https://chrome-history-a.example/', 'A', 3, ${chromeTime - 1000000}), ('https://chrome-history-b.example/', 'B', 1, ${chromeTime - 2000000})`,
      ]);
      // A Firefox with one bookmark in its menu.
      let firefox = PathUtils.join(roaming, "Mozilla", "Firefox", "Profiles", "test.default-release");
      await IOUtils.makeDirectory(firefox, { createAncestors: true });
      let ffTime = (Date.now() - 60000) * 1000;
      await makeDb(PathUtils.join(firefox, "places.sqlite"), [
        "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0)",
        "CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT)",
        `INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (1, 'https://firefox-one.example/', 'Firefox one', ${ffTime})`,
        "INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________'), (2, 2, NULL, 1, 0, 'menu', 'menu________'), (3, 1, 1, 2, 0, 'Firefox one', 'aaaaaaaaaaaa')",
      ]);
      Services.env.set("LOCALAPPDATA", local);
      Services.env.set("APPDATA", roaming);

      let found = await Import.detect();
      info.found = found.map(b => b.id);
      check("import: finds Chrome and Firefox", info.found.includes("chrome") && info.found.includes("firefox"));
      let fromChrome = await Import.importFrom(found.find(b => b.id == "chrome"));
      info.chrome = fromChrome;
      check("import: Chrome's bookmarks come over (web addresses only)", fromChrome.bookmarks == 2);
      check("import: Chrome's history comes over", fromChrome.history == 2);
      check("import: an imported bookmark is a Breached bookmark", !!(await PlacesUtils.bookmarks.fetch({ url: "https://chrome-two.example/" })));
      let fromFirefox = await Import.importFrom(found.find(b => b.id == "firefox"));
      info.firefox = fromFirefox;
      check("import: Firefox's bookmarks and history come over", fromFirefox.bookmarks == 1 && fromFirefox.history == 1);
      check("import: imported history shows in Breached", !!(await PlacesUtils.history.fetch("https://chrome-history-a.example/")));

      // Passwords from an exported .csv (Chrome's columns, a quoted comma).
      let csv = PathUtils.join(tmp, "passwords.csv");
      await IOUtils.writeUTF8(
        csv,
        'name,url,username,password,note\r\nsite,https://csv-site.example/login,tester,"pa,ss",\r\nother,https://csv-other.example/,me,secret,\r\nbad,not a url,x,y,\r\n'
      );
      let pw = await Import.importPasswordsCSV(csv);
      info.passwords = pw;
      check("import: passwords come over from a .csv", pw.added == 2 && pw.skipped == 1);
      let saved = await Services.logins.searchLoginsAsync({ origin: "https://csv-site.example" });
      check("import: a password with a comma is kept whole", saved[0]?.password == "pa,ss");
      check("import: the same .csv twice adds nothing new", (await Import.importPasswordsCSV(csv)).added == 0);
      for (let origin of ["https://csv-site.example", "https://csv-other.example"]) {
        for (let login of await Services.logins.searchLoginsAsync({ origin })) {
          await Services.logins.removeLoginAsync(login);
        }
      }
      let tree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.unfiledGuid);
      for (let child of tree.children ?? []) {
        if (/^From (Chrome|Firefox)$/.test(child.title)) {
          await PlacesUtils.bookmarks.remove(child.guid);
        }
      }
    } catch (e) {
      info.error = String(e) + " " + e.stack;
      check("import: ran without errors", false);
    } finally {
      for (let [k, v] of Object.entries(env)) {
        Services.env.set(k, v ?? "");
      }
      await IOUtils.remove(tmp, { recursive: true, ignoreAbsent: true });
    }

    // Reopening last time's tabs: the command bar lists them.
    let url = "http://127.0.0.1:8123/keys.html?restored";
    let before = B.tabs.length;
    let asked = B.askToRestore({ tabs: [{ url, title: "restored tab" }, { url: url + "2", title: "another" }] });
    let listed = await waitFor(
      () => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes("Reopen last time"),
      5000
    );
    check("restore: asks which of last time's tabs to reopen", !!listed);
    info.restoreRows = document.getElementById("picker").textContent.slice(0, 200);
    await this.screenshot(outDir, "35-restore-ask.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    await asked;
    let reopened = B.tabs.filter(t => t.url?.startsWith(url));
    check("restore: all reopens every tab", reopened.length == 2 && B.tabs.length == before + 2);
    for (let t of reopened) {
      B.closeTab(t);
    }
  },

  async welcome(B, check, waitFor, wait, outDir, report) {
    let Theme = ChromeUtils.importESModule("resource://breached/Theme.sys.mjs");
    let { Mods } = ChromeUtils.importESModule("resource://breached/Mods.sys.mjs");
    let P = Services.prefs;
    let info = (report.info.welcome = {});
    P.setBoolPref("breached.welcome.done", false);
    check("the welcome page doesn't show for a profile that's been used", !B.firstRun(true));
    check("after that check it's marked done", P.getBoolPref("breached.welcome.done", false));
    P.setBoolPref("breached.welcome.done", false);
    B.run("welcome");
    let doc = () => B.selectedBrowser.contentDocument;
    let ready = await waitFor(() => B.selected.url == "breached:welcome" && doc()?.querySelector(".preset"));
    check(":welcome opens the welcome page", !!ready);
    if (!ready) {
      return;
    }
    let $ = id => doc().getElementById(id);
    let visible = id => !$(id).hidden;
    check("welcome: starts on colours", visible("step-colours") && !visible("step-tabs"));
    $("preset-nord").click();
    check("welcome: a colour scheme applies at once", Theme.currentPreset() == "nord");
    let before = Theme.getColor("accent");
    let dial = $("dial");
    dial.focus();
    for (let i = 0; i < 12; i++) {
      dial.dispatchEvent(new (doc().defaultView.KeyboardEvent)("keydown", { key: "ArrowRight", bubbles: true }));
    }
    info.dialAccent = Theme.getColor("accent");
    check("welcome: the dial makes its own scheme", Theme.currentPreset() == null && Theme.getColor("accent") != before);
    check("welcome: the dial's scheme is marked chosen", $("custom").hasAttribute("selected"));
    $("dark").click();
    let [r, g, b] = Theme.getColor("background").slice(1).match(/../g).map(h => parseInt(h, 16));
    check("welcome: Dark makes dark bars", r * 0.299 + g * 0.587 + b * 0.114 < 80);
    await wait(300);
    await this.screenshot(outDir, "30-welcome-colours.png");

    $("next").click();
    check("welcome: Next goes to the tab bar", visible("step-tabs") && !visible("step-colours"));
    $("position-top").click();
    check("welcome: picking a place moves the tab bar", P.getStringPref("breached.tabs.position", "") == "top" && $("position-top").hasAttribute("selected"));
    await wait(300);
    await this.screenshot(outDir, "31-welcome-tabs.png");

    $("next").click();
    check("welcome: Next goes to your stuff", visible("step-stuff"));
    check("welcome: it looks for other browsers", !!(await waitFor(() => !$("browsers").textContent.includes("Looking"), 10000)));
    info.browsers = $("browsers").textContent;
    doc().querySelector("input[name=startup][value=ask]").click();
    check("welcome: the start choice applies at once", P.getBoolPref("breached.restoreSession.ask", false));
    P.clearUserPref("breached.restoreSession.ask");
    P.clearUserPref("breached.restoreSession");
    await this.screenshot(outDir, "31a-welcome-stuff.png");
    $("next").click();
    check("welcome: Next goes to mods", visible("step-mods"));
    let free = await waitFor(() => doc().querySelector("#mods input:not(:disabled)"), 10000);
    info.mods = [...doc().querySelectorAll("#mods input")].map(i => `${i.value}${i.disabled ? " (installed)" : ""}`);
    check("welcome: lists the mods site's mods", info.mods.length >= 3);
    check("welcome: the last step says Finish", $("next").textContent == "Finish");
    await this.screenshot(outDir, "32-welcome-mods.png");
    if (free) {
      free.click();
      let id = free.value;
      info.installed = id;
      $("next").click();
      check("welcome: Finish installs the ticked mod", !!(await waitFor(async () => (await Mods.get(id))?.installed, 20000)));
      check("welcome: then goes to the home page", !!(await waitFor(() => B.selected.url == "breached:home", 10000)));
      await Mods.uninstall(id);
    }
    check("welcome: finishing marks it done", P.getBoolPref("breached.welcome.done", false));
    Theme.applyPreset(Theme.DEFAULT_PRESET);
    P.clearUserPref("breached.tabs.position");
    await wait(300);
  },

  async moreMods(B, check, waitFor, wait, press, outDir, report) {
    let info = (report.info.moreMods = {});
    let enter = () => press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let picking = what =>
      waitFor(() => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes(what), 15000);
    let install = async id => {
      try {
        await ModHost.installFromSite(id, { confirm: false });
      } catch (e) {
        info[id + "Error"] = String(e);
      }
      return waitFor(() => ModHost.loaded.has(id), 10000);
    };

    // Speed: turns Breached's trimmed helpers back on, and off again when removed.
    {
      let D = Services.prefs.getDefaultBranch("");
      let before = [D.getBoolPref("dom.ipc.processPrelaunch.enabled"), B.pref("tabs.unloadAfterMinutes", 15)];
      check("the Speed mod installs", await install("speed"));
      check("speed: a spare process waits", Services.prefs.getBoolPref("dom.ipc.processPrelaunch.enabled") === true);
      check("speed: tabs stay loaded", B.pref("tabs.unloadAfterMinutes", 15) === 0);
      check("speed: 256 MB memory cache", Services.prefs.getIntPref("browser.cache.memory.capacity") == 262144);
      Services.prefs.setBoolPref("breached.mods.speed.keepTabsLoaded", false);
      check("speed: its setting lets tabs sleep again", B.pref("tabs.unloadAfterMinutes", 0) == before[1]);
      Services.prefs.clearUserPref("breached.mods.speed.keepTabsLoaded");
      B.run("speed");
      check(":speed lists what it changed", !!(await picking("The Speed mod changed")));
      press("Escape", "Escape", KeyboardEvent.DOM_VK_ESCAPE);
      await ModHost.Mods.uninstall("speed");
      await waitFor(() => !ModHost.loaded.has("speed"), 10000);
      info.speedAfter = [D.getBoolPref("dom.ipc.processPrelaunch.enabled"), B.pref("tabs.unloadAfterMinutes", 15)];
      check("speed: removing it puts Breached's values back", info.speedAfter[0] === before[0] && info.speedAfter[1] === before[1]);
    }

    // Vim keys and link hints, dark pages, screenshots
    {
      let page = "http://127.0.0.1:8123/keys.html";
      check("the Vim keys mod installs", await install("keys"));
      let tab = B.openTab(page);
      B.selectTab(tab);
      await waitFor(() => tab.title == "keys" && !tab.el.hasAttribute("busy"), 10000);
      await wait(500);
      tab.browser.focus();
      let state = () => this.testActor(tab.browser).sendQuery("SelfTest:Page");
      let key = k => press(k, k.length == 1 ? "Key" + k.toUpperCase() : k, KeyboardEvent["DOM_VK_" + k.toUpperCase()], k != k.toLowerCase() ? ["Shift"] : []);
      key("j");
      key("j");
      check("keys: j scrolls down", await waitFor(async () => (await state()).scrollY > 50, 3000));
      key("G");
      check("keys: G goes to the bottom", await waitFor(async () => (await state()).scrollY > 3000, 3000));
      key("g");
      key("g");
      check("keys: gg goes back to the top", await waitFor(async () => (await state()).scrollY == 0, 3000));
      key("f");
      let hinted = await waitFor(async () => (await state()).hints, 3000);
      info.hints = hinted;
      check("keys: f puts letters on the links", hinted >= 3);
      await this.screenshot(outDir, "33-link-hints.png");
      // The first link gets the first label: "a" (or "aa" with many links).
      key("a");
      if (hinted > 9) {
        key("a");
      }
      check("keys: typing a hint follows its link", await waitFor(async () => (await state()).url.endsWith("?followed"), 5000));
      key("H");
      check("keys: H goes back", await waitFor(async () => (await state()).url == page, 5000));
      await waitFor(() => !tab.el.hasAttribute("busy"), 5000);
      await wait(300);
      await this.clickElement("#box", tab.browser);
      info.keysActive = (await state()).active;
      if (info.keysActive == "box") {
        let before = (await state()).scrollY;
        key("j");
        await wait(300);
        check("keys: typing in a text box isn't taken as keys", (await state()).scrollY == before);
      }

      check("the Dark pages mod installs", await install("dark"));
      B.selectTab(tab);
      tab.browser.reload();
      check("dark: a light page is darkened", await waitFor(async () => (await state()).dark, 8000));
      await wait(300);
      await this.screenshot(outDir, "34-dark-page.png");
      B.run("dark");
      check(":dark stops darkening the site", await waitFor(async () => !tab.el.hasAttribute("busy") && !(await state()).dark, 8000));
      Services.prefs.clearUserPref("breached.mods.dark.offSites");

      check("the Screenshots mod installs", await install("screenshot"));
      let shot = ModHost.hooks.get("screenshot");
      for (let [what, full] of [["visible", false], ["whole page", true]]) {
        let path = null;
        try {
          path = await shot.take({ full });
        } catch (e) {
          info["screenshot" + what] = String(e);
        }
        let bytes = path ? await IOUtils.read(path) : new Uint8Array();
        let png = bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47;
        // PNG height is bytes 20-23
        let height = png ? new DataView(bytes.buffer).getUint32(20) : 0;
        info["screenshot " + what] = { bytes: bytes.length, height };
        check(`screenshot: saves the ${what} as a PNG`, png && bytes.length > 1000);
        if (full) {
          check("screenshot: the whole page is taller than the window", height > 4000);
        }
        if (path) {
          await IOUtils.remove(path);
        }
      }
      B.closeTab(tab);
      for (let id of ["keys", "dark", "screenshot"]) {
        await ModHost.Mods.uninstall(id);
      }
      check("dark: removing it puts the page colour scheme back", await waitFor(() => Services.prefs.getIntPref("layout.css.prefers-color-scheme.content-override") != 0, 5000));
    }

    // Tab groups
    {
      check("the Tab groups mod installs", await install("groups"));
      let G = ModHost.hooks.get("groups");
      let a = B.openTab("about:blank", { background: true });
      let b = B.openTab("about:blank", { background: true });
      let c = B.openTab("about:blank", { background: true });
      B.selectTab(a);
      B.run("group work");
      B.selectTab(c);
      B.run("group work");
      check("groups: :group puts tabs in a group", G.groupOf(a) == "work" && G.groupOf(c) == "work" && !G.groupOf(b));
      check("groups: a group's tabs sit together", Math.abs(a.index - c.index) == 1);
      let label = document.querySelector('.group-label[data-group="work"]');
      check("groups: the group's name shows in the tab bar", !!label && label.nextElementSibling == B.tabs[Math.min(a.index, c.index)].el);
      await wait(200);
      await this.screenshot(outDir, "36-tab-groups.png");
      B.selectTab(b);
      label.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      check("groups: clicking the name folds the group away", getComputedStyle(a.el).display == "none" && getComputedStyle(c.el).display == "none");
      document.querySelector('.group-label[data-group="work"]').dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      check("groups: clicking again opens it", getComputedStyle(a.el).display != "none");
      B.selectTab(c);
      B.run("ungroup");
      check("groups: :ungroup takes a tab out", !G.groupOf(c) && G.groupOf(a) == "work");
      await wait(700);
      check("groups: groups are saved", Services.prefs.getStringPref("breached.mods.groups.state", "").includes('"work"'));
      for (let t of [a, b, c]) {
        B.closeTab(t);
      }
      await wait(100);
      check("groups: a group with no tabs is gone", !G.groups.has("work") && !document.querySelector(".group-label"));
      await ModHost.Mods.uninstall("groups");
    }

    // Password manager: asks to save a login, then fills it in next time.
    check("saved passwords are off without the Password manager mod", !Services.prefs.getBoolPref("signon.rememberSignons"));
    check("the Password manager mod installs", await install("passwords"));
    // Gecko saves only what a person typed (a real key press or click);
    // the test fills the form from here.
    Services.prefs.setBoolPref("signon.userInputRequiredToCapture.enabled", false);
    Services.prefs.setBoolPref("signon.debug", true);
    let loginPage = "http://127.0.0.1:8123/login.html";
    let tab = B.openTab(loginPage);
    await waitFor(() => tab.title == "login" && !tab.el.hasAttribute("busy"), 10000);
    await wait(500);
    info.loginSent = await this.testActor(tab.browser).sendQuery("SelfTest:Login", { username: "tester", password: "secret-1" });
    let save = await picking("Save the password for tester");
    info.savePrompt = document.getElementById("prompt").textContent;
    check("passwords: sending a login form asks to save it", save);
    try {
      info.loginActor = !!tab.browser.browsingContext.currentWindowGlobal?.getActor("LoginManager");
    } catch (e) {
      info.loginActor = String(e);
    }
    try {
      let { LoginManagerParent } = ChromeUtils.importESModule("resource://gre/modules/LoginManagerParent.sys.mjs");
      info.prompterPatched = !!LoginManagerParent.prototype._getPrompter()?.promptToChangePasswordWithUsernames?.toString().includes("Which saved login");
      info.loginLog = Cc["@mozilla.org/consoleAPI-storage;1"]
        .getService(Ci.nsIConsoleAPIStorage)
        .getEvents()
        .map(e => `${e.prefix ?? ""} ${(e.arguments ?? []).map(a => String(a)).join(" ")}`)
        .filter(m => /login|password|form/i.test(m))
        .slice(-60);
    } catch (e) {
      info.loginLogError = String(e);
    }
    await this.screenshot(outDir, "25-password-save.png");
    enter();
    let saved = await waitFor(async () => (await Services.logins.getAllLogins()).length == 1, 5000);
    check("passwords: save keeps it in the password store", saved);
    B.closeTab(tab);
    tab = B.openTab(loginPage);
    let filled = await waitFor(() => tab.title == "filled tester / secret-1", 10000);
    info.fillTitle = tab.title;
    check("passwords: the saved login fills in next time", filled);
    B.closeTab(tab);
    await Services.logins.removeAllUserFacingLoginsAsync();
    Services.prefs.clearUserPref("signon.userInputRequiredToCapture.enabled");
    Services.prefs.clearUserPref("signon.debug");
    await ModHost.Mods.uninstall("passwords");
    check(
      "passwords: removing the mod turns saved passwords off again",
      await waitFor(() => !ModHost.loaded.has("passwords") && !Services.prefs.getBoolPref("signon.rememberSignons"), 5000)
    );

    // Bookmarks: Ctrl+D saves the page, :bookmarks opens it again.
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    check("the Bookmarks mod installs", await install("bookmarks"));
    let article = "http://127.0.0.1:8123/article.html";
    tab = B.openTab(article);
    await waitFor(() => tab.title == "A long walk" && !tab.el.hasAttribute("busy"), 10000);
    press("d", "KeyD", KeyboardEvent.DOM_VK_D, ["Control"]);
    let bookmarked = await waitFor(async () => !!(await PlacesUtils.bookmarks.fetch({ url: article })), 5000);
    check("bookmarks: Ctrl+D bookmarks the page", bookmarked);
    B.closeTab(tab);
    B.run("bookmarks");
    let listed = await picking("open bookmark:");
    check("bookmarks: :bookmarks lists them as rows", listed && document.querySelector("#picker .picker-row")?.textContent.includes("A long walk"));
    await this.screenshot(outDir, "26-bookmarks.png");
    enter();
    check("bookmarks: picking one opens it", await waitFor(() => B.selected.url == article, 10000));
    B.closeTab(B.selected);
    await PlacesUtils.bookmarks.eraseEverything();
    await ModHost.Mods.uninstall("bookmarks");
    check("bookmarks: removing the mod takes Ctrl+D away", await waitFor(() => !Commands.bookmark, 5000));

    // Firefox Sync (experimental): the account code turns on and the
    // sign-in page opens; signing in needs a real account.
    check("Mozilla accounts are off without the Firefox Sync mod", !Services.prefs.getBoolPref("identity.fxaccounts.enabled"));
    check("the Firefox Sync mod installs", await install("sync"));
    try {
      let Sync = ChromeUtils.importESModule(ModHost.loaded.get("sync").url + "Sync.sys.mjs");
      info.sync = await Sync.selfCheck();
    } catch (e) {
      info.syncError = `${e}\n${e.stack}`;
    }
    check(
      "sync: the mod turns Mozilla accounts on, with history, bookmarks and passwords",
      info.sync?.accountsEnabled && info.sync.engines == "Bookmarks,History,Passwords"
    );
    B.run("sync in");
    let signIn = await waitFor(() => B.selected.url.startsWith("https://accounts.firefox.com/") && B.selected, 10000);
    info.signInURL = B.selected.url;
    check("sync: :sync in opens the Mozilla account sign-in page", signIn);
    if (signIn) {
      await waitFor(() => !signIn.el.hasAttribute("busy"), 20000);
      await wait(3000);
      info.signInTitle = signIn.title;
      await this.screenshot(outDir, "27-sync-sign-in.png");
      B.closeTab(signIn);
    }
    await ModHost.Mods.uninstall("sync");
    check(
      "sync: removing the mod turns Mozilla accounts off again",
      await waitFor(() => !ModHost.loaded.has("sync") && !Services.prefs.getBoolPref("identity.fxaccounts.enabled"), 5000)
    );
  },

  async extensions(B, check, waitFor, wait, outDir, report) {
    let { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    check("the extension manager is running", AddonManager.isReady);
    let dir = PathUtils.join(PathUtils.tempDir, "breached-test-extension");
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(dir);
    let manifest = {
      manifest_version: 2,
      name: "Breached Test",
      version: "1.0",
      browser_specific_settings: { gecko: { id: "selftest@breached.browser" } },
      permissions: ["tabs", "storage", "contextMenus", "<all_urls>"],
      background: { scripts: ["background.js"] },
      browser_action: { default_title: "Breached Test", default_popup: "popup.html" },
    };
    let background = `
      (async () => {
        let result = {};
        try {
          browser.contextMenus.create({ id: "test", title: "test", contexts: ["page"] });
          result.menus = true;
          let tabs = await browser.tabs.query({});
          result.count = tabs.length;
          let current = await browser.tabs.query({ active: true, currentWindow: true });
          result.active = current.length;
          let win = await browser.windows.getCurrent({ populate: true });
          result.windowTabs = win.tabs.length;
          let created = await browser.tabs.create({ url: "https://example.com/?from-extension", active: false });
          result.created = created.id > 0;
          await new Promise(resolve => {
            let listener = (id, info, tab) => {
              if (id == created.id && info.status == "complete") {
                browser.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            browser.tabs.onUpdated.addListener(listener);
          });
          let [title] = await browser.tabs.executeScript(created.id, { code: "document.title" });
          result.script = title;
          await browser.tabs.remove(created.id);
          // A popup window (Bitwarden's passkey window) opens on top, and closing it leaves this one.
          let before = await browser.windows.getAll();
          let pw = await browser.windows.create({ url: "popup.html", type: "popup", width: 400, height: 300 });
          await new Promise(r => setTimeout(r, 1500));
          let [popupTab] = await browser.tabs.query({ windowId: pw.id });
          result.popupWindow = {
            newWindow: pw.id != win.id,
            windows: (await browser.windows.getAll()).length - before.length,
            tabs: pw.tabs.length,
            url: popupTab?.url,
            title: popupTab?.title,
            mainTabs: (await browser.tabs.query({ windowId: win.id })).length - win.tabs.length,
          };
          await browser.windows.remove(pw.id);
          await new Promise(r => setTimeout(r, 500));
          result.popupWindow.afterClose = (await browser.windows.getAll()).length - before.length;
          // The extension's own pages from tabs.create also open as a pop-up window.
          let page = await browser.tabs.create({ url: "popup.html" });
          result.popupWindow.tabsCreate = page.windowId != win.id;
          await browser.windows.remove(page.windowId);
          browser.browserAction.setBadgeText({ text: "ok" });
        } catch (e) {
          result.error = String(e);
          browser.browserAction.setBadgeText({ text: "err" });
        }
        await browser.storage.local.set({ result });
        browser.tabs.create({ url: "https://example.org/#" + encodeURIComponent(JSON.stringify(result)) });
      })();`;
    await IOUtils.writeJSON(PathUtils.join(dir, "manifest.json"), manifest);
    await IOUtils.writeUTF8(PathUtils.join(dir, "background.js"), background);
    await IOUtils.writeUTF8(
      PathUtils.join(dir, "popup.html"),
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>test popup</title></head>
       <body style="width:220px;height:60px;font:14px monospace">extension popup</body></html>`
    );
    let addon;
    try {
      let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(dir);
      addon = await AddonManager.installTemporaryAddon(file);
    } catch (e) {
      report.info.extensionInstall = String(e);
    }
    check("a test extension installs", !!addon);
    if (!addon) {
      return;
    }
    // Screenshot the popup window while it's open.
    let popupObserver = (subject, topic) => {
      if (topic == "domwindowopened" && !report.info.popupWindowDom) {
        report.info.popupWindowDom = {};
        subject.addEventListener(
          "load",
          () =>
            subject.setTimeout(async () => {
              report.info.popupWindowDom = {
                popupAttr: subject.document.documentElement.getAttribute("popup"),
                tabbarShown: subject.document.getElementById("tabbar")?.getBoundingClientRect().height > 0,
                size: [subject.outerWidth, subject.outerHeight],
              };
              await this.screenshot(outDir, "16a-extension-popup-window.png", subject);
            }, 1000),
          { once: true }
        );
      }
    };
    Services.ww.registerNotification(popupObserver);
    let resultTab = () => B.tabs.find(t => t.url.startsWith("https://example.org/#"));
    let done = await waitFor(() => resultTab(), 30000);
    let result = {};
    try {
      result = JSON.parse(decodeURIComponent(resultTab().url.split("#")[1]));
    } catch (e) {}
    report.info.extensionResult = result;
    Services.ww.unregisterNotification(popupObserver);
    check("extensions: tabs.query, windows.getCurrent and tabs.create work", done && result.count > 0 && result.active == 1 && result.windowTabs > 0 && result.created);
    check("extensions: tabs.executeScript runs in pages", result.script == "Example Domain");
    check("extensions: contextMenus calls don't break extensions", result.menus === true);
    let pw = result.popupWindow;
    check(
      "extensions: a popup window (windows.create type popup) opens as its own window with the page, not a tab here",
      pw?.newWindow && pw.windows == 1 && pw.tabs == 1 && pw.title == "test popup" && pw.mainTabs == 0
    );
    check("extensions: the extension's own pages from tabs.create open as a pop-up window too", pw?.tabsCreate === true);
    check("extensions: closing the popup window leaves Breached's window open", pw?.afterClose == 0 && !window.closed);
    let button = document.querySelector("#ext-buttons .ext-button");
    check("extensions: the extension's button shows", !!button && button.getBoundingClientRect().width > 0);
    check("extensions: badges show on the button", button?.querySelector(".ext-badge")?.textContent == "ok");
    if (resultTab()) {
      B.closeTab(resultTab());
    }
    B.run("ext breached test");
    let panel = () => document.getElementById("ext-popup-panel");
    let popupShown = await waitFor(
      () => panel()?.state == "open" && panel().querySelector("browser")?.contentTitle == "test popup",
      15000
    );
    let pb = panel()?.querySelector("browser");
    report.info.popup = panel()
      ? {
          state: panel().state,
          title: pb?.contentTitle,
          uri: pb?.currentURI?.spec,
          frameLoader: !!pb?.frameLoader,
          remoteType: pb?.remoteType,
          size: pb ? [pb.clientWidth, pb.clientHeight] : null,
        }
      : null;
    check(":ext opens the extension's popup", popupShown);
    await wait(500);
    await this.screenshot(outDir, "15-extension-popup.png");
    panel()?.hidePopup();
    B.run("extensions");
    let doc = () => B.selectedBrowser?.contentDocument;
    check(
      ":extensions lists installed extensions",
      await waitFor(() => B.selected.url == "breached:extensions" && doc()?.querySelector('[data-id="selftest@breached.browser"]'))
    );
    await wait(300);
    await this.screenshot(outDir, "16-extensions.png");
    await addon.uninstall();
    check(
      "removing an extension removes its button",
      await waitFor(() => !document.querySelector("#ext-buttons .ext-button"), 5000)
    );
    B.closeTab(B.selected);
  },

  async screenshot(outDir, name, win = window) {
    try {
      let bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
      let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      let blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      await IOUtils.write(PathUtils.join(outDir, name), new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      dump(`SELFTEST screenshot ${name} failed: ${e}\n`);
    }
  },

  _finished: false,
  async finish(outDir, report, problem) {
    if (this._finished) {
      return;
    }
    this._finished = true;
    if (problem) {
      report.exception = problem;
    }
    if (report.info.speed) {
      report.info.speed.memoryAtEndMB = await this.memoryMB().catch(() => null);
    }
    report.passed = !report.exception && Object.values(report.checks).every(Boolean);
    try {
      await IOUtils.writeJSON(PathUtils.join(outDir, "report.json"), report);
    } catch (e) {
      dump(`SELFTEST could not write report: ${e}\n`);
    }
    dump(`SELFTEST ${report.passed ? "PASSED" : "FAILED"}\n`);
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  },
};
