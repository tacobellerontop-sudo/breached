/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached mods: optional features users install from the mods site
// (breached.mods.site, the breached-mods repository's GitHub Pages) or from
// a zip or folder in settings > mods.
//
// A mod is a folder with a mod.json and a script:
//   { "id": "bitwarden", "name": "Bitwarden", "version": "1.0",
//     "description": "...", "script": "mod.js", "breached": "0.1.7",
//     "settings": [{ "pref": "breached.mods.bitwarden.path", "label": "...",
//                    "type": "text" | "bool" | "choice", "hint": "..." }] }
// Installed mods are copied to <profile>/breached-mods/<id>/ (mods shipped in
// <app>/mods/<id>/ would also be found). Each mod's folder is served as
// resource://breached-mod-<id>/. The ids of installed mods are kept in
// breached.mods.installed; every browser window loads and unloads the
// scripts when that pref changes (chrome/content/mods.js).
//
// Mods run with the browser's full rights, like the browser itself.

const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");

const INSTALLED_PREF = "breached.mods.installed";
const SITE_PREF = "breached.mods.site";
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function resolve(spec) {
  let handler = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  let fileURL = Services.io.newURI(handler.resolveURI(Services.io.newURI(spec)));
  return fileURL.QueryInterface(Ci.nsIFileURL).file.path;
}

export const Mods = {
  get bundledDir() {
    return resolve("resource://app/mods/");
  },

  get userDir() {
    return PathUtils.join(PathUtils.profileDir, "breached-mods");
  },

  /** Ids of installed mods, in install order. */
  installedIds() {
    try {
      let ids = JSON.parse(Services.prefs.getStringPref(INSTALLED_PREF, "[]"));
      return Array.isArray(ids) ? ids.filter(id => ID_RE.test(id)) : [];
    } catch (e) {
      return [];
    }
  },

  isInstalled(id) {
    return this.installedIds().includes(id);
  },

  _setInstalled(ids) {
    Services.prefs.setStringPref(INSTALLED_PREF, JSON.stringify([...new Set(ids)]));
  },

  /** Reads one mod folder's mod.json, or null if it isn't a mod. */
  async read(dir, source) {
    try {
      let info = await IOUtils.readJSON(PathUtils.join(dir, "mod.json"));
      if (!ID_RE.test(info.id ?? "") || !info.name || !info.script) {
        return null;
      }
      if (info.script.includes("/") || info.script.includes("\\") || info.script.includes("..")) {
        return null;
      }
      return {
        id: info.id,
        name: String(info.name),
        version: String(info.version ?? ""),
        description: String(info.description ?? ""),
        script: info.script,
        breached: String(info.breached ?? ""),
        experimental: !!info.experimental,
        settings: Array.isArray(info.settings) ? info.settings : [],
        commands: Array.isArray(info.commands) ? info.commands.map(String) : [],
        dir,
        source,
      };
    } catch (e) {
      return null;
    }
  },

  async _readAll(parent, source) {
    let mods = [];
    try {
      for (let dir of await IOUtils.getChildren(parent)) {
        let mod = await this.read(dir, source);
        if (mod && PathUtils.filename(dir) == mod.id) {
          mods.push(mod);
        }
      }
    } catch (e) {
      // no such folder
    }
    return mods;
  },

  /** Every mod Breached knows about: shipped ones and ones added from a folder. */
  async list() {
    let byId = new Map();
    for (let mod of await this._readAll(this.bundledDir, "bundled")) {
      byId.set(mod.id, mod);
    }
    for (let mod of await this._readAll(this.userDir, "user")) {
      byId.set(mod.id, mod);
    }
    let installed = this.installedIds();
    return [...byId.values()]
      .map(mod => ({ ...mod, installed: installed.includes(mod.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(id) {
    return (await this.list()).find(m => m.id == id) ?? null;
  },

  /** Serves the mod's folder at resource://breached-mod-<id>/ and returns that. */
  serve(mod) {
    let handler = Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    let host = "breached-mod-" + mod.id.replace(/_/g, "-");
    handler.setSubstitution(host, Services.io.newFileURI(new FileUtils.File(mod.dir)));
    return `resource://${host}/`;
  },

  async install(id) {
    if (!(await this.get(id))) {
      throw new Error(`no mod called ${id}`);
    }
    this._setInstalled([...this.installedIds(), id]);
  },

  /** Copies a mod folder into the profile and installs it. Returns the mod. */
  async installFromFolder(path) {
    let mod = await this.read(path, "user");
    if (!mod) {
      throw new Error("That folder has no valid mod.json");
    }
    let target = PathUtils.join(this.userDir, mod.id);
    if (PathUtils.normalize(path) != PathUtils.normalize(target)) {
      await IOUtils.makeDirectory(this.userDir, { ignoreExisting: true });
      await IOUtils.remove(target, { recursive: true, ignoreAbsent: true });
      await IOUtils.copy(path, target, { recursive: true });
    }
    this._setInstalled([...this.installedIds(), mod.id]);
    return mod;
  },

  /** The mods site (ends with "/"): the only place Breached installs from by itself. */
  get site() {
    let site = Services.prefs.getStringPref(SITE_PREF, "");
    return site.endsWith("/") ? site : site + "/";
  },

  /** Whether url is on the mods site. */
  onSite(url) {
    try {
      let site = Services.io.newURI(this.site);
      let uri = Services.io.newURI(url);
      return (
        /^https?$/.test(site.scheme) &&
        uri.prePath == site.prePath &&
        uri.filePath.startsWith(site.filePath) &&
        !uri.filePath.includes("..")
      );
    } catch (e) {
      return false;
    }
  },

  /** The site's zip for a mod. */
  zipURL(id) {
    return `${this.site}mods/${id}.zip`;
  },

  /**
   * Unpacks a mod's zip (bytes) into a temporary folder. Resolves to
   * { mod, dir, cleanup() }; call cleanup() when done with dir.
   */
  async unpack(bytes) {
    let base = PathUtils.join(PathUtils.tempDir, `breached-mod-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
    let zipPath = base + ".zip";
    let dir = base;
    let cleanup = async () => {
      await IOUtils.remove(zipPath, { ignoreAbsent: true });
      await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    };
    try {
      await IOUtils.write(zipPath, bytes);
      await IOUtils.makeDirectory(dir);
      let reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
      reader.open(new FileUtils.File(zipPath));
      try {
        let names = [...reader.findEntries("*")];
        if (names.length > 2000) {
          throw new Error("That zip has too many files to be a mod");
        }
        for (let name of names) {
          let parts = name.split("/").filter(Boolean);
          if (!parts.length || name.startsWith("/") || name.includes("\\") ||
              parts.some(p => p == "." || p == ".." || p.includes(":"))) {
            throw new Error(`That zip has a file outside its folder: ${name}`);
          }
          let target = PathUtils.join(dir, ...parts);
          if (reader.getEntry(name).isDirectory) {
            await IOUtils.makeDirectory(target, { ignoreExisting: true });
            continue;
          }
          await IOUtils.makeDirectory(PathUtils.parent(target), { ignoreExisting: true });
          reader.extract(name, new FileUtils.File(target));
        }
      } finally {
        reader.close();
      }
      // mod.json at the top, or in the zip's one folder.
      let modDir = dir;
      if (!(await IOUtils.exists(PathUtils.join(dir, "mod.json")))) {
        let children = await IOUtils.getChildren(dir);
        if (children.length == 1) {
          modDir = children[0];
        }
      }
      let mod = await this.read(modDir, "user");
      if (!mod) {
        throw new Error("That zip has no valid mod.json");
      }
      return { mod, dir: modDir, cleanup };
    } catch (e) {
      await cleanup();
      throw e;
    }
  },

  // Work every window asks for but that should run once (downloads).
  _once: new Map(),

  once(key, fn) {
    if (!this._once.has(key)) {
      this._once.set(key, Promise.resolve().then(fn).finally(() => this._once.delete(key)));
    }
    return this._once.get(key);
  },

  // Page helpers of mods: registered once however many windows load the mod.
  _actors: new Map(), // name -> windows using it

  registerActor(name, options) {
    let count = this._actors.get(name) ?? 0;
    if (!count) {
      ChromeUtils.registerWindowActor(name, options);
    }
    this._actors.set(name, count + 1);
  },

  unregisterActor(name) {
    let count = (this._actors.get(name) ?? 0) - 1;
    if (count > 0) {
      this._actors.set(name, count);
      return;
    }
    this._actors.delete(name);
    try {
      ChromeUtils.unregisterWindowActor(name);
    } catch (e) {
      // already gone
    }
  },

  /** Turns a mod off. Mods added from a folder are also deleted. */
  async uninstall(id) {
    this._setInstalled(this.installedIds().filter(i => i != id));
    let mod = await this.get(id);
    if (mod?.source == "user") {
      await IOUtils.remove(mod.dir, { recursive: true, ignoreAbsent: true });
    }
  },
};
