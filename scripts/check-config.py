#!/usr/bin/env python3
"""Checks config/ against the Firefox version we target.

- policies.json must validate against Firefox's enterprise policy schema.
- every pref in config/*.cfg must still exist in Firefox's pref files, so a
  rename upstream doesn't silently turn a setting into a no-op.

Usage: python3 scripts/check-config.py [firefox-branch-or-tag]   (default: release)
Needs: pip install jsonschema
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent.parent
REF = sys.argv[1] if len(sys.argv) > 1 else "release"
BASE = f"https://raw.githubusercontent.com/mozilla-firefox/firefox/{REF}/"
PREF_SOURCES = [
    "browser/app/profile/firefox.js",
    "modules/libpref/init/all.js",
    "modules/libpref/init/StaticPrefList.yaml",
    "toolkit/components/telemetry/app/TelemetryControllerBase.sys.mjs",
]
# Prefs that are real but defined outside the files above.
KNOWN_ELSEWHERE = {
    "browser.contentblocking.category",  # set by the content blocking settings code
}


def fetch(path):
    with urllib.request.urlopen(BASE + path) as r:
        return r.read().decode("utf-8")


def main():
    version = fetch("browser/config/version.txt").strip()
    print(f"Checking against Firefox {version} ({REF})")
    failures = 0

    schema = json.loads(fetch("browser/components/enterprisepolicies/schemas/policies-schema.json"))
    policies = json.loads((ROOT / "config/policies.json").read_text())["policies"]
    for name in policies:
        if name not in schema["properties"]:
            print(f"  unknown policy: {name}")
            failures += 1
    try:
        jsonschema.validate(policies, schema)
    except jsonschema.ValidationError as e:
        print(f"  policies.json invalid at {list(e.absolute_path)}: {e.message}")
        failures += 1

    sources = "\n".join(fetch(p) for p in PREF_SOURCES)
    newtab = fetch("browser/extensions/newtab/lib/ActivityStream.sys.mjs")
    prefs = set()
    for cfg in sorted((ROOT / "config").glob("*.cfg")):
        prefs |= set(re.findall(r'(?:lock|default)Pref\("([^"]+)"', cfg.read_text()))
    for pref in sorted(prefs - KNOWN_ELSEWHERE):
        # New tab prefs are declared without their "browser.newtabpage.activity-stream." prefix.
        found = f'"{pref}"' in sources or f"- name: {pref}\n" in sources
        prefix = "browser.newtabpage.activity-stream."
        if not found and pref.startswith(prefix):
            found = f'"{pref[len(prefix):]}"' in newtab
        if not found:
            print(f"  pref not found in Firefox source: {pref}")
            failures += 1

    print("OK" if not failures else f"{failures} problem(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
