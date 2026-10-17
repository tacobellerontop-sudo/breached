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
    let timeout = setTimeout(() => this.finish(outDir, report, "timed out"), 300 * 1000);
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
          if (fn()) {
            return true;
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

    // 9. Mods: Bitwarden installs from settings, fills a login, and removes
    await this.mods(B, check, waitFor, wait, press, outDir, report);

    // 10. Extensions: a test extension uses the tabs API, a button and a popup
    await this.extensions(B, check, waitFor, wait, outDir, report);

    // 11. Site permissions (camera, location) and pinned sites
    await this.permissions(B, check, waitFor, wait, press, outDir, report);
    await this.pins(B, check, waitFor, wait, outDir, report);

    // 12. Private windows, the right-click menu, zoom per site, saving, printing
    await this.dailyDriver(B, check, waitFor, wait, outDir, report);

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

  async mods(B, check, waitFor, wait, press, outDir, report) {
    let doc = () => B.selectedBrowser?.contentDocument;
    B.run("bw.exe");
    check(
      ":bw.exe without the mod says which mod it needs",
      /Bitwarden mod/.test(document.getElementById("message").textContent)
    );
    B.run("mods");
    check(
      ":mods opens settings at the mods section",
      await waitFor(() => B.selected.url == "breached:settings#mods" && doc()?.getElementById("mod-bitwarden-toggle")?.checkVisibility())
    );
    await wait(500);
    await this.screenshot(outDir, "11-mods.png");
    let click = el => {
      let r = el.getBoundingClientRect();
      let win = el.ownerDocument.defaultView;
      win.synthesizeMouseEvent("mousedown", r.left + 5, r.top + 5, { button: 0, buttons: 1, clickCount: 1 });
      win.synthesizeMouseEvent("mouseup", r.left + 5, r.top + 5, { button: 0, buttons: 0, clickCount: 1 });
    };
    let toggle = doc().getElementById("mod-bitwarden-toggle");
    toggle.scrollIntoView();
    await wait(200);
    click(toggle);
    let installed = await waitFor(() => ModHost.loaded.has("bitwarden") && Commands["bw.exe"], 5000);
    check("settings: installing the Bitwarden mod adds :bw.exe", installed);
    check(
      "settings: the installed mod shows its settings",
      await waitFor(() => doc().getElementById("setting-breached-mods-bitwarden-path"), 3000)
    );

    let fakeBw = Services.env.get("BREACHED_TEST_BW");
    let loginPage = Services.env.get("BREACHED_TEST_LOGIN_PAGE");
    report.info.bitwardenTest = { fakeBw, loginPage };
    if (installed && fakeBw && loginPage) {
      Services.prefs.setStringPref("breached.mods.bitwarden.path", fakeBw);
      B.openTab(loginPage);
      await waitFor(() => B.selected.title == "login", 10000);
      B.run("bw.exe");
      let asked = await waitFor(
        () => !document.getElementById("commandbar").hidden && document.getElementById("commandline").type == "password",
        10000
      );
      check(":bw.exe asks for the master password", asked);
      if (asked) {
        await this.screenshot(outDir, "12-bitwarden-password.png");
        for (let c of "hunter2") {
          let code = /\d/.test(c) ? "Digit" + c : "Key" + c.toUpperCase();
          press(c, code, KeyboardEvent["DOM_VK_" + c.toUpperCase()]);
        }
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        // Two logins: they show as rows to pick from.
        let rows = () => [...document.querySelectorAll("#picker .picker-row:not(.picker-empty)")];
        let listed = await waitFor(() => !document.getElementById("picker").hidden && rows().length == 2, 15000);
        check(":bw.exe lists the site's logins as rows", listed);
        check("the first row starts selected", rows()[0]?.hasAttribute("selected"));
        press("ArrowDown", "ArrowDown", KeyboardEvent.DOM_VK_DOWN);
        check("Down moves to the next row", rows()[1]?.hasAttribute("selected"));
        await this.screenshot(outDir, "13-bitwarden-pick.png");
        for (let c of "breached") {
          press(c, "Key" + c.toUpperCase(), KeyboardEvent["DOM_VK_" + c.toUpperCase()]);
        }
        check(
          "typing narrows the rows",
          rows().length == 1 && rows()[0].textContent.includes("breached-user") && rows()[0].hasAttribute("selected")
        );
        press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
        let filled = await waitFor(() => B.selected.title == "filled breached-user / breached-pass", 15000);
        check("the rows close after picking", document.getElementById("picker").hidden);
        report.info.bitwardenTitle = B.selected.title;
        report.info.bitwardenMessage = document.getElementById("message").textContent;
        check(":bw.exe fills the page's login form", filled);
        check("the password isn't kept in the command history", !B.history.includes("hunter2"));
        // The fill left the password field focused: ":" types there, Esc leaves it.
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
      }
      B.closeTab(B.selected);
      await this.passkeys(B, check, waitFor, press, outDir, report, loginPage);
      Services.prefs.clearUserPref("breached.mods.bitwarden.path");
    }

    B.selectTab(B.tabs.find(t => t.url.startsWith("breached:settings")));
    click(doc().getElementById("mod-bitwarden-toggle"));
    check(
      "settings: removing the mod takes :bw.exe away again",
      await waitFor(() => !ModHost.loaded.has("bitwarden") && !Commands["bw.exe"], 5000)
    );
    B.closeTab(B.selected);
  },

  // Bitwarden makes a passkey for a page and signs in with it; the page
  // checks the signature itself (scripts/test/passkey.html).
  async passkeys(B, check, waitFor, press, outDir, report, loginPage) {
    // WebAuthn wants a domain, so localhost rather than 127.0.0.1.
    let page = loginPage.replace("127.0.0.1", "localhost").replace(/[^/]*$/, "passkey.html");
    let asking = what =>
      waitFor(() => !document.getElementById("picker").hidden && document.getElementById("prompt").textContent.includes(what), 15000);
    B.openTab(page);
    let save = await asking("wants to make a passkey for breached-user");
    report.info.passkeySavePrompt = document.getElementById("prompt").textContent;
    check("a site making a passkey offers to keep it in Bitwarden", save);
    await this.screenshot(outDir, "14b-passkey-save.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let pick = await asking("localhost passkey:");
    report.info.passkeyTitleAfterCreate = B.selected.title;
    report.info.passkeyRows = [...document.querySelectorAll("#picker .picker-row")].map(r => r.textContent);
    check("signing in shows Bitwarden's passkeys as rows", pick && report.info.passkeyRows[0]?.includes("breached-user"));
    await this.screenshot(outDir, "14c-passkey-pick.png");
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    let verified = await waitFor(() => /^passkey:(verified|not|bad|[A-Z])/.test(B.selected.title), 15000);
    report.info.passkeyResult = B.selected.title;
    report.info.passkeyMessage = document.getElementById("message").textContent;
    report.info.passkeyLog = Services.console
      .getMessageArray()
      .map(m => m.message ?? m.errorMessage ?? "")
      .filter(m => /passkey/i.test(m));
    check("the site accepts the Bitwarden passkey's signature", verified && B.selected.title == "passkey:verified");
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
    try {
      await B.print();
      await wait(1000);
      let stat = pdfs[0] ? await IOUtils.stat(pdfs[0]).catch(() => null) : null;
      info.printSize = stat?.size ?? null;
      check("print: Ctrl+P prints the page", stat?.size > 500);
      // The page's own print button (window.print())
      let tabsBefore = B.tabs.length;
      let realClone = B.printClone;
      info.printClones = 0;
      B.printClone = function (...args) {
        info.printClones++;
        return realClone.apply(this, args);
      };
      for (let type of ["mousedown", "mouseup"]) {
        await mouse(type, 40, 220).catch(e => (info.printClick = String(e)));
      }
      let started = await waitFor(() => pdfs.length == 2, 8000);
      info.titleAfterPrintClick = B.selected.title;
      B.printClone = realClone;
      let done = started && (await waitFor(() => !document.querySelector("browser.print-clone"), 15000));
      await wait(1000);
      let stat2 = pdfs[1] ? await IOUtils.stat(pdfs[1]).catch(() => null) : null;
      info.windowPrint = { started, done, size: stat2?.size ?? null, tabs: B.tabs.length - tabsBefore };
      check("print: a page's print button prints", done && stat2?.size > 500 && B.tabs.length == tabsBefore);
    } finally {
      B.printDialog = realDialog;
    }
    B.closeTab(B.selected);
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
    let resultTab = () => B.tabs.find(t => t.url.startsWith("https://example.org/#"));
    let done = await waitFor(() => resultTab(), 30000);
    let result = {};
    try {
      result = JSON.parse(decodeURIComponent(resultTab().url.split("#")[1]));
    } catch (e) {}
    report.info.extensionResult = result;
    check("extensions: tabs.query, windows.getCurrent and tabs.create work", done && result.count > 0 && result.active == 1 && result.windowTabs > 0 && result.created);
    check("extensions: tabs.executeScript runs in pages", result.script == "Example Domain");
    check("extensions: contextMenus calls don't break extensions", result.menus === true);
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
