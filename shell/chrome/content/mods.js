/* Loads and unloads installed mods in the browser window. See
 * modules/Mods.sys.mjs for what a mod is. */

"use strict";

var ModHost = {
  Mods: ChromeUtils.importESModule("resource://breached/Mods.sys.mjs").Mods,
  loaded: new Map(), // id -> Mod
  _syncing: Promise.resolve(),

  // Commands of mods that aren't installed, so ":bw.exe" can say which mod
  // it needs instead of opening it as an address.
  modCommands: new Map(), // command -> mod name

  init() {
    Services.prefs.addObserver("breached.mods.installed", this);
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
    for (let id of [...this.loaded.keys()]) {
      this.unload(id);
    }
  },

  observe() {
    this.sync();
  },

  /** Loads newly installed mods and unloads removed ones. */
  sync() {
    this._syncing = this._syncing.then(async () => {
      let wanted = this.Mods.installedIds();
      for (let id of [...this.loaded.keys()]) {
        if (!wanted.includes(id)) {
          this.unload(id);
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
      console.error(`Breached: installed mod ${id} is missing`);
      return;
    }
    let mod = new Mod(info, this.Mods.serve(info));
    this.loaded.set(id, mod);
    try {
      Services.scriptloader.loadSubScript(mod.url + info.script, { Mod: mod });
    } catch (e) {
      console.error(`Breached: mod ${id} failed to load`, e);
      Breached.showMessage(`Mod ${info.name} failed to load: ${e.message}`, "error");
      this.unload(id);
    }
  },

  unload(id) {
    let mod = this.loaded.get(id);
    this.loaded.delete(id);
    mod?._unload();
  },
};

/** What a mod's script sees as `Mod`. */
class Mod {
  constructor(info, url) {
    this.info = info;
    this.id = info.id;
    this.url = url;
    this._cleanups = [];
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
  actor(actorName, { parent, child, events, allFrames = true }) {
    // Gecko looks for classes called <actorName>Parent and <actorName>Child.
    ChromeUtils.registerWindowActor(actorName, {
      parent: { esModuleURI: this.url + parent },
      child: { esModuleURI: this.url + child, events },
      allFrames,
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    });
    this.onUnload(() => ChromeUtils.unregisterWindowActor(actorName));
    return actorName;
  }

  /** The current tab's actor of that name (in its top frame). */
  getActor(actorName, browsingContext = Breached.selectedBrowser?.browsingContext) {
    return browsingContext?.currentWindowGlobal?.getActor(actorName);
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

  onUnload(fn) {
    this._cleanups.push(fn);
  }

  _unload() {
    for (let fn of this._cleanups.reverse()) {
      try {
        fn();
      } catch (e) {
        console.error(`Breached: unloading mod ${this.id}`, e);
      }
    }
    this._cleanups = [];
  }
}
