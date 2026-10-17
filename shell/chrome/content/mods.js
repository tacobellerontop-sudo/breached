/* Loads and unloads installed mods in the browser window, and installs mods
 * from the mods site. See modules/Mods.sys.mjs for what a mod is. */

"use strict";

// The mods on the mods site (github.com/tacobellerontop-sudo/breached-mods)
// and their commands, so ":sync" can say which mod it needs.
const SITE_MODS = {
  bitwarden: { name: "Bitwarden", commands: ["bw.exe", "bw"] },
  bookmarks: { name: "Bookmarks", commands: ["bookmark", "bookmarks"] },
  drm: { name: "Protected video (DRM)", commands: ["drm"] },
  passwords: { name: "Password manager", commands: ["passwords", "pw"] },
  sync: { name: "Firefox Sync", commands: ["sync"] },
};

const MAX_MOD_BYTES = 20 * 1024 * 1024;

/** a > b for versions like 0.1.7. */
function versionAbove(a, b) {
  let x = String(a).split(".").map(n => parseInt(n, 10) || 0);
  let y = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) != (y[i] ?? 0)) {
      return (x[i] ?? 0) > (y[i] ?? 0);
    }
  }
  return false;
}

var ModHost = {
  Mods: ChromeUtils.importESModule("resource://breached/Mods.sys.mjs").Mods,
  loaded: new Map(), // id -> Mod
  _syncing: Promise.resolve(),

  // Commands of mods that aren't installed, so ":bw.exe" can say which mod
  // it needs instead of opening it as an address.
  modCommands: new Map(), // command -> mod name

  // What installed mods offer Breached itself, e.g. "protectedVideo".
  hooks: new Map(), // name -> object

  init() {
    for (let { name, commands } of Object.values(SITE_MODS)) {
      for (let command of commands) {
        this.modCommands.set(command, name);
      }
    }
    this.migrate();
    if (!this.Mods.isInstalled("drm")) {
      this.allowProtectedVideo(false);
    }
    Services.prefs.addObserver("breached.mods.installed", this);
    Services.obs.addObserver(this, "breached-mod-updated");
    this.Mods.list().then(mods => {
      for (let mod of mods) {
        for (let name of mod.commands) {
          this.modCommands.set(name, mod.name);
        }
      }
    });
    return this.sync();
  },

  uninit() {
    Services.prefs.removeObserver("breached.mods.installed", this);
    Services.obs.removeObserver(this, "breached-mod-updated");
    for (let id of [...this.loaded.keys()]) {
      this.unload(id, false);
    }
  },

  /** Breached 0.1.6 had protected video built in: "on" there gets the mod. */
  migrate() {
    if (Services.prefs.getStringPref("breached.drm", "") == "on" && !this.Mods.isInstalled("drm")) {
      this.Mods._setInstalled([...this.Mods.installedIds(), "drm"]);
    }
    Services.prefs.clearUserPref("breached.drm");
  },

  observe(subject, topic, data) {
    if (topic == "breached-mod-updated") {
      // A newer version was copied in: load it again.
      if (this.loaded.has(data)) {
        this.unload(data, false);
        this.load(data);
      }
      return;
    }
    this.sync();
  },

  /** Loads newly installed mods and unloads removed ones. */
  sync() {
    this._syncing = this._syncing.then(async () => {
      let wanted = this.Mods.installedIds();
      for (let id of [...this.loaded.keys()]) {
        if (!wanted.includes(id)) {
          this.unload(id, true);
        }
      }
      for (let id of wanted) {
        if (!this.loaded.has(id)) {
          await this.load(id);
        }
      }
    });
    return this._syncing;
  },

  async load(id) {
    let info = await this.Mods.get(id);
    if (!info) {
      // Installed, but its files are gone (or it came with Breached before
      // the mods site): get it from the site again.
      info = await this.refetch(id);
      if (!info || this.loaded.has(id) || !this.Mods.isInstalled(id)) {
        return;
      }
    }
    let mod = new Mod(info, this.Mods.serve(info));
    this.loaded.set(id, mod);
    try {
      Services.scriptloader.loadSubScriptWithOptions(mod.url + info.script, {
        target: { Mod: mod },
        ignoreCache: true,
      });
    } catch (e) {
      console.error(`Breached: mod ${id} failed to load`, e);
      Breached.showMessage(`Mod ${info.name} failed to load: ${e.message}`, "error");
      this.unload(id, false);
    }
  },

  unload(id, uninstalled) {
    let mod = this.loaded.get(id);
    this.loaded.delete(id);
    mod?._unload(uninstalled);
  },

  async refetch(id) {
    try {
      // Every window asks; one download does for all.
      await this.Mods.once(`fetch:${id}`, async () => {
        if (!(await this.Mods.get(id))) {
          await this.installFromSite(id, { confirm: false, quiet: true });
        }
      });
    } catch (e) {
      console.error(`Breached: getting mod ${id} again`, e);
      Breached.showMessage(`The ${SITE_MODS[id]?.name ?? id} mod is missing and couldn't be downloaded again: ${e.message}`, "error");
    }
    return this.Mods.get(id);
  },

  /** { id: version } of installed mods, for the mods site's buttons. */
  async installedVersions() {
    let versions = {};
    for (let mod of await this.Mods.list()) {
      if (mod.installed) {
        versions[mod.id] = mod.version;
      }
    }
    return versions;
  },

  /** Downloads a mod's zip from the mods site and installs it. */
  async installFromSite(id, { url = this.Mods.zipURL(id), browser = null, confirm = true, quiet = false } = {}) {
    if (!this.Mods.onSite(url)) {
      throw new Error(`${url} isn't on the mods site (${this.Mods.site})`);
    }
    if (!quiet) {
      Breached.showMessage(`Getting the ${SITE_MODS[id]?.name ?? id} mod…`);
    }
    let response = await fetch(url, { cache: "no-cache", credentials: "omit" });
    if (!response.ok) {
      throw new Error(`the mods site answered ${response.status} for ${id}`);
    }
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_MOD_BYTES) {
      throw new Error("that mod is too big");
    }
    return this.installZip(bytes, { expectId: id, browser, confirm, quiet });
  },

  /** Installs a mod from its zip's bytes. Resolves to the mod, or null if cancelled. */
  async installZip(bytes, { expectId = null, browser = null, confirm = true, quiet = false } = {}) {
    let { mod, dir, cleanup } = await this.Mods.unpack(bytes);
    try {
      if (expectId && mod.id != expectId) {
        throw new Error(`expected the ${expectId} mod, got ${mod.id}`);
      }
      if (mod.breached && versionAbove(mod.breached, BREACHED_VERSION)) {
        throw new Error(`${mod.name} ${mod.version} needs Breached ${mod.breached} or newer (:update)`);
      }
      let existing = (await this.Mods.get(mod.id))?.installed ? await this.Mods.get(mod.id) : null;
      if (confirm) {
        let verb = !existing ? "Install" : existing.version == mod.version ? "Reinstall" : `Update (from ${existing.version})`;
        let question = `${verb} the ${mod.name} mod ${mod.version}? Mods can do anything Breached can:`;
        let items = [
          { label: existing ? "update" : "install", detail: mod.description, answer: "yes" },
          { label: "cancel", detail: "leave it", answer: "no" },
        ];
        let picked = browser ? await Breached.pickForTab(browser, question, items) : await Breached.pick(question, items);
        if (picked?.answer != "yes") {
          return null;
        }
      }
      await this.Mods.installFromFolder(dir);
      if (existing) {
        Services.obs.notifyObservers(null, "breached-mod-updated", mod.id);
      }
      if (!quiet) {
        Breached.showMessage(
          existing && existing.version != mod.version
            ? `Updated ${mod.name} to ${mod.version} (restart Breached if it acts up)`
            : `Installed ${mod.name} ${mod.version}. Settings > Mods has its settings`
        );
      }
      return mod;
    } finally {
      await cleanup();
    }
  },

  /** Opens the mods site in a new tab. */
  openSite() {
    Breached.openTab(this.Mods.site);
  },

  // ------------------------------------------------------ protected video

  allowProtectedVideo(on) {
    if (Services.prefs.getBoolPref("media.eme.enabled", false) != on) {
      Services.prefs.setBoolPref("media.eme.enabled", on);
    }
    Services.prefs.setBoolPref("media.gmp-widevinecdm.visible", on);
    Services.prefs.setBoolPref("media.gmp-widevinecdm.enabled", on);
  },

  _askedProtectedVideo: new Set(),

  /**
   * A page asked for protected video (DRM), from Gecko's mediakeys-request:
   * { keySystem, status }. The Protected video mod handles it; without the
   * mod Breached offers to get it, once per site and session.
   */
  async protectedVideo(browser, host, data) {
    let hook = this.hooks.get("protectedVideo");
    if (hook) {
      return hook.request(browser, host, data);
    }
    if (!data.keySystem?.startsWith("com.widevine.alpha")) {
      return null;
    }
    if (!["api-disabled", "cdm-disabled", "cdm-not-installed"].includes(data.status)) {
      return null;
    }
    if (!Services.prefs.getBoolPref("breached.mods.offerProtectedVideo", true) || this._askedProtectedVideo.has(host)) {
      return null;
    }
    this._askedProtectedVideo.add(host);
    let picked = await Breached.pickForTab(browser, `${host} wants to play protected video (DRM), which needs the Protected video mod:`, [
      { label: "get the mod", detail: "install it from the mods site; it downloads Google's Widevine (about 10 MB), then reloads", answer: "get" },
      { label: "not now", detail: "ask again next time", answer: "later" },
      { label: "never", detail: "don't offer it again (the mods site still has it)", answer: "never" },
    ]);
    if (picked?.answer == "never") {
      Services.prefs.setBoolPref("breached.mods.offerProtectedVideo", false);
      return null;
    }
    if (picked?.answer != "get") {
      this._askedProtectedVideo.delete(host);
      return null;
    }
    try {
      await this.installFromSite("drm", { confirm: false, quiet: true });
    } catch (e) {
      console.error("Breached: getting the Protected video mod", e);
      Breached.showMessage(`Couldn't get the Protected video mod: ${e.message}`, "error");
      return null;
    }
    // The mod loads when breached.mods.installed changes.
    await this.sync();
    return this.hooks.get("protectedVideo")?.request(browser, host, data);
  },
};

/** What a mod's script sees as `Mod`. */
class Mod {
  constructor(info, url) {
    this.info = info;
    this.id = info.id;
    this.url = url;
    this._cleanups = [];
    this._uninstallers = [];
  }

  /** Adds a ":" command, removed again when the mod is uninstalled. */
  command(name, definition) {
    if (Commands[name]) {
      throw new Error(`command ${name} already exists`);
    }
    Commands[name] = definition;
    this.onUnload(() => {
      if (Commands[name] === definition) {
        delete Commands[name];
      }
    });
  }

  /** Adds a keyboard shortcut, e.g. key("b", "accel,shift", fn). */
  key(key, modifiers, fn) {
    let el = Keys.add(key, modifiers, fn);
    this.onUnload(() => el.remove());
  }

  /**
   * Registers a page helper (JSWindowActor) whose modules are in the mod's
   * folder: actor("Name", { parent: "NameParent.sys.mjs", child:
   * "NameChild.sys.mjs", events: {...} }). Returns the actor's name.
   */
  actor(actorName, { parent, child, events, allFrames = true, matches }) {
    // Gecko looks for classes called <actorName>Parent and <actorName>Child.
    ModHost.Mods.registerActor(actorName, {
      parent: { esModuleURI: this.url + parent },
      child: { esModuleURI: this.url + child, events },
      allFrames,
      matches,
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    });
    this.onUnload(() => ModHost.Mods.unregisterActor(actorName));
    return actorName;
  }

  /** The current tab's actor of that name (in its top frame). */
  getActor(actorName, browsingContext = Breached.selectedBrowser?.browsingContext) {
    return browsingContext?.currentWindowGlobal?.getActor(actorName);
  }

  /** Offers Breached something it asks mods for, e.g. hook("protectedVideo", { request() {} }). */
  hook(name, object) {
    ModHost.hooks.set(name, object);
    this.onUnload(() => {
      if (ModHost.hooks.get(name) === object) {
        ModHost.hooks.delete(name);
      }
    });
  }

  pref(name, fallback) {
    switch (Services.prefs.getPrefType(name)) {
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(name);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(name);
      case Services.prefs.PREF_STRING:
        return Services.prefs.getStringPref(name);
    }
    return fallback;
  }

  /** Runs when the mod stops in this window: removed, or the window closes. */
  onUnload(fn) {
    this._cleanups.push(fn);
  }

  /** Runs only when the mod is removed (in each window that had it). */
  onUninstall(fn) {
    this._uninstallers.push(fn);
  }

  _unload(uninstalled) {
    let fns = [...(uninstalled ? this._uninstallers.reverse() : []), ...this._cleanups.reverse()];
    for (let fn of fns) {
      try {
        fn();
      } catch (e) {
        console.error(`Breached: unloading mod ${this.id}`, e);
      }
    }
    this._cleanups = [];
    this._uninstallers = [];
  }
}
