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
    let timeout = setTimeout(() => this.finish(outDir, report, "timed out"), 180 * 1000);
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
    await wait(500);
    await this.screenshot(outDir, "0-home.png");
    // Search box on the home page
    let typeOnHome = text => {
      let doc = homeDoc();
      doc.getElementById("search").value = text;
      doc.getElementById("search-form").requestSubmit();
    };
    typeOnHome("example.com");
    let loaded = await waitFor(() => B.selected.title == "Example Domain");
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
    let rgb = hex => `rgb(${hex.slice(1).match(/../g).map(h => parseInt(h, 16)).join(", ")})`;
    let preset = settingsDoc().getElementById("setting-color-preset");
    check("settings: colours start as qutebrowser's", preset.value == "qutebrowser");
    preset.value = "nord";
    preset.dispatchEvent(new Event("change"));
    await wait(200);
    check(
      "settings: a colour set recolours the window",
      getComputedStyle($("titlebar")).backgroundColor == rgb("#2e3440")
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
    ChromeUtils.importESModule("resource://breached/Theme.sys.mjs").applyPreset("qutebrowser");
    for (let p of ["titlebar", "transparency", "transparency.opacity"]) {
      Services.prefs.clearUserPref("breached." + p);
    }
    await wait(200);
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

    report.errors = Services.console
      .getMessageArray()
      .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
      .map(m => `${m.errorMessage} @ ${m.sourceName}:${m.lineNumber}`);
    check(
      "no Breached script errors",
      !report.errors.some(e => /breached/i.test(e))
    );
  },

  async screenshot(outDir, name) {
    try {
      let bitmap = await window.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
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
