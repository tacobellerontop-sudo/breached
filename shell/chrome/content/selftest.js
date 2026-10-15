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
    B.run("open https://example.com/");
    let loaded = await waitFor(() => B.selected.title == "Example Domain");
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

    // 3. Ctrl+T, type an address, Enter
    B.selectedBrowser.focus();
    await wait(200);
    ctrl("t");
    let ctrlT = await waitFor(() => !$("commandbar").hidden, 3000);
    check("Ctrl+T opens ':open -t'", ctrlT && $("commandline").value == "open -t ");
    if (!ctrlT) {
      B.openCommandLine("open -t ");
    }
    $("commandline").value += "example.org";
    press("Enter", "Enter", KeyboardEvent.DOM_VK_RETURN);
    check("Enter opens the address in a new tab", await waitFor(() => B.tabs.length == 2));
    check("the new tab is selected", B.tabs.indexOf(B.selected) == 1);
    await waitFor(() => B.selected.title == "Example Domain");

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

    // 6. Tab bar options
    B.run("set tabs.position top");
    await wait(200);
    check(":set tabs.position top moves the tab bar up", rect("tabbar").bottom <= rect("content").top + 1);
    B.run("set tabs.autohide true");
    await wait(2000);
    check(
      ":set tabs.autohide true hides the tab bar",
      getComputedStyle($("tabbar")).visibility == "hidden" && rect("content").top < 1
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
