#!/usr/bin/env python3
"""Starts a packaged Breached build, checks the interface works, and saves screenshots.

Usage: python3 scripts/build/smoke-test.py <path-to-breached.exe-or-firefox> <out-dir>
Needs: pip install selenium (Selenium fetches geckodriver itself).
Prints a JSON report and exits non-zero if a check fails.
"""
import json
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options

binary, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

options = Options()
options.binary_location = binary
options.add_argument("-headless")
options.add_argument("-remote-allow-system-access")  # needed for chrome-context checks
options.set_preference("remote.prefs.recommended", True)

report = {"checks": {}}
driver = webdriver.Firefox(options=options)
driver.set_window_size(1280, 800)
try:
    driver.get("https://example.com/")
    time.sleep(2)

    with driver.context(driver.CONTEXT_CHROME):
        state = driver.execute_script(
            """
            let $ = id => document.getElementById(id);
            return {
              title: document.title,
              brand: Services.appinfo.name,
              hasBreached: typeof Breached == "object",
              statusbarHeight: $("breached-statusbar")?.getBoundingClientRect().height,
              url: $("breached-url")?.textContent,
              tabIndex: $("breached-tabindex")?.textContent,
              navBarHeight: $("nav-bar")?.getBoundingClientRect().height,
              sidebarShown: !!document.querySelector("#sidebar-container:not([hidden])")
                && getComputedStyle(document.querySelector("#sidebar-container")).display != "none",
            };
            """
        )
        report["state"] = state
        report["checks"]["interface script loaded"] = state["hasBreached"]
        report["checks"]["status bar visible"] = (state["statusbarHeight"] or 0) > 0
        report["checks"]["status bar shows URL"] = "example.com" in (state["url"] or "")
        report["checks"]["tab index shown"] = state["tabIndex"] == "[1/1]"
        report["checks"]["address bar hidden"] = (state["navBarHeight"] or 0) < 2
        report["checks"]["window title says Breached"] = "Breached" in (state["title"] or "")
        driver.save_screenshot(str(out / "1-page.png"))

        # Command line: open it, run ":open -t about:blank", check a tab opened.
        driver.execute_script("Breached.openCommandLine('tabopen about:blank')")
        driver.save_screenshot(str(out / "2-commandline.png"))
        opened = driver.execute_script(
            """
            Breached.run(document.getElementById("breached-commandline").value);
            Breached.closeCommandLine();
            return gBrowser.tabs.length;
            """
        )
        report["checks"]["command line opens a tab"] = opened == 2
        driver.execute_script("Breached.run('tab-focus 1')")
        time.sleep(0.5)
        report["checks"]["tab-focus works"] = driver.execute_script(
            "return document.getElementById('breached-tabindex').textContent"
        ) == "[1/2]"
        driver.execute_script("Breached.run('nonsense')")
        report["checks"]["unknown command reported"] = "no such command" in driver.execute_script(
            "return document.getElementById('breached-message').textContent"
        )
        driver.save_screenshot(str(out / "3-tabs-and-message.png"))

        report["errors"] = driver.execute_script(
            """
            return Services.console.getMessageArray()
              .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
              .map(m => m.errorMessage + " @ " + m.sourceName)
              .filter(s => /breached/i.test(s));
            """
        )
        report["checks"]["no Breached script errors"] = not report["errors"]
finally:
    driver.quit()

print(json.dumps(report, indent=2))
(out / "report.json").write_text(json.dumps(report, indent=2))
failed = [name for name, ok in report["checks"].items() if not ok]
if failed:
    print("FAILED: " + ", ".join(failed))
    sys.exit(1)
print("all checks passed")
