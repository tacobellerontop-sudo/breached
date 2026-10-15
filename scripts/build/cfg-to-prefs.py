#!/usr/bin/env python3
"""Turns config/breached.cfg into a Gecko default-preferences file.

Usage: python3 scripts/build/cfg-to-prefs.py <out.js>
lockPref(...) becomes a locked default, defaultPref(...) a plain default.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

out = ["// Generated from config/breached.cfg by scripts/build/cfg-to-prefs.py. Don't edit."]
for line in (REPO / "config/breached.cfg").read_text(encoding="utf-8").splitlines():
    m = re.match(r"\s*(lockPref|defaultPref)\((.*)\);(.*)$", line)
    if m:
        kind, args, comment = m.groups()
        locked = ", locked" if kind == "lockPref" else ""
        out.append(f"pref({args}{locked});{comment}")
Path(sys.argv[1]).write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"cfg-to-prefs: wrote {len(out) - 1} prefs to {sys.argv[1]}")
