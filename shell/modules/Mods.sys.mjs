/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached mods: optional features users install from the settings page.
//
// A mod is a folder with a mod.json and a script:
//   { "id": "bitwarden", "name": "Bitwarden", "version": "1.0",
//     "description": "...", "script": "mod.js",
//     "settings": [{ "pref": "breached.mods.bitwarden.path", "label": "...",
//                    "type": "text" | "bool", "hint": "..." }] }
// Mods that ship with Breached live in <app>/mods/<id>/; mods installed from
// a folder are copied to <profile>/breached-mods/<id>/. Each mod's folder is
// served as resource://breached-mod-<id>/. Installing only records the id in
// breached.mods.installed; the browser window loads and unloads the scripts
// when that pref changes.
//
// Mods run with the browser's full rights, like the browser itself.

const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");

const INSTALLED_PREF = "breached.mods.installed";
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

  /** Turns a mod off. Mods added from a folder are also deleted. */
  async uninstall(id) {
    this._setInstalled(this.installedIds().filter(i => i != id));
    let mod = await this.get(id);
    if (mod?.source == "user") {
      await IOUtils.remove(mod.dir, { recursive: true, ignoreAbsent: true });
    }
  },
};
