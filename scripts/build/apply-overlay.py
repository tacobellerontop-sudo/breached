#!/usr/bin/env python3
"""Turns a Firefox source checkout into the Breached app source.

Usage: python3 scripts/build/apply-overlay.py <firefox-source-dir>

Every change is an explicit, checked edit: if Firefox changes the code an
edit expects, this script stops with a clear error instead of silently
building something broken. Run it once on a fresh checkout.
"""
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
APP = REPO / "app"


def fail(msg):
    sys.exit(f"apply-overlay: {msg}")


def insert_after(path, anchor, text, count=1):
    """Inserts text right after the line containing anchor (which must be unique)."""
    src = path.read_text(encoding="utf-8")
    if text.strip() in src:
        fail(f"{path} already has this edit; use a fresh checkout")
    lines = src.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines) if anchor in line]
    if len(hits) != count:
        fail(f"expected {count} line(s) with {anchor!r} in {path}, found {len(hits)}")
    i = hits[0]
    lines.insert(i + 1, text if text.endswith("\n") else text + "\n")
    path.write_text("".join(lines), encoding="utf-8")


def replace_line(path, pattern, replacement):
    src = path.read_text(encoding="utf-8")
    new, n = re.subn(pattern, replacement, src, flags=re.M)
    if n == 0:
        fail(f"no match for {pattern!r} in {path}")
    path.write_text(new, encoding="utf-8")


def copy(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)


def branding(top):
    """browser/branding/breached: Firefox's unofficial branding renamed to Breached."""
    base = top / "browser/branding"
    dest = base / "breached"
    if dest.exists():
        fail(f"{dest} already exists; use a fresh checkout")
    shutil.copytree(base / "unofficial", dest)
    replace_line(dest / "configure.sh", r"^MOZ_APP_DISPLAYNAME=.*$", "MOZ_APP_DISPLAYNAME=Breached")
    replace_line(dest / "configure.sh", r"^MOZ_MACBUNDLE_ID=.*$", "MOZ_MACBUNDLE_ID=breached")
    ftl = dest / "locales/en-US/brand.ftl"
    for key in ("brand-shorter-name", "brand-short-name", "brand-shortcut-name",
                "brand-full-name", "brand-product-name"):
        replace_line(ftl, rf"^-{key} = .*$", f"-{key} = Breached")
    props = dest / "locales/en-US/brand.properties"
    for key in ("brandShorterName", "brandShortName", "brandFullName"):
        replace_line(props, rf"^{key}=.*$", f"{key}=Breached")


def interface(top):
    """The qutebrowser-style status bar and command line."""
    content = top / "browser/base/content"
    for name in ("breached.js", "breached.css"):
        copy(APP / "chrome" / name, content / "breached" / name)

    insert_after(
        top / "browser/base/jar.mn",
        "content/browser/browser-main.js",
        "        content/browser/breached/breached.js            (content/breached/breached.js)\n"
        "        content/browser/breached/breached.css           (content/breached/breached.css)",
    )

    xhtml = content / "browser.xhtml"
    insert_after(xhtml, '<link rel="stylesheet" href="chrome://browser/skin/" />',
                 '  <link rel="stylesheet" href="chrome://browser/content/breached/breached.css" />')
    insert_after(xhtml, '<script src="chrome://browser/content/browser-main.js"></script>',
                 '  <script src="chrome://browser/content/breached/breached.js"></script>')
    insert_after(xhtml, "#include browser-box.inc.xhtml",
                 (APP / "chrome/statusbar.inc.xhtml").read_text(encoding="utf-8"))


def actors(top):
    """BreachedKeys: lets ":" on a web page open the command line."""
    actors_dir = top / "browser/actors"
    for name in ("BreachedKeysChild.sys.mjs", "BreachedKeysParent.sys.mjs"):
        copy(APP / "actors" / name, actors_dir / name)
    # moz.build lists must stay alphabetical.
    insert_after(actors_dir / "moz.build", '"BlockedSiteParent.sys.mjs",',
                 '    "BreachedKeysChild.sys.mjs",\n    "BreachedKeysParent.sys.mjs",')
    insert_after(
        top / "browser/components/DesktopActorRegistry.sys.mjs",
        "let JSWINDOWACTORS = {",
        """  BreachedKeys: {
    parent: {
      esModuleURI: "resource:///actors/BreachedKeysParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/BreachedKeysChild.sys.mjs",
      events: {
        keydown: { capture: true },
      },
    },
    allFrames: true,
    messageManagerGroups: ["browsers"],
  },
""",
    )


def prefs(top):
    """Bakes config/breached.cfg into Breached's built-in defaults."""
    cfg = (REPO / "config/breached.cfg").read_text(encoding="utf-8")
    out = ["", "// ---- Breached defaults (generated from config/breached.cfg) ----"]
    for line in cfg.splitlines():
        m = re.match(r"\s*(lockPref|defaultPref)\((.*)\);(.*)$", line)
        if m:
            kind, args, comment = m.groups()
            locked = ", locked" if kind == "lockPref" else ""
            out.append(f"pref({args}{locked});{comment}")
    with open(top / "browser/app/profile/firefox.js", "a", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")


def main():
    if len(sys.argv) != 2:
        fail("usage: apply-overlay.py <firefox-source-dir>")
    top = Path(sys.argv[1]).resolve()
    if not (top / "browser/base/content/browser.xhtml").exists():
        fail(f"{top} doesn't look like a Firefox source checkout")
    branding(top)
    interface(top)
    actors(top)
    prefs(top)
    shutil.copyfile(APP / "mozconfig", top / "mozconfig")
    print("apply-overlay: done")


if __name__ == "__main__":
    main()
