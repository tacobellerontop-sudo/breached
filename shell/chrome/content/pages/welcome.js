/* The first-run welcome page (breached:welcome): colours, where the tab bar
 * goes, and which mods to install. Colours and the tab bar change as you
 * pick them; mods install when you finish. */

"use strict";

const Theme = ChromeUtils.importESModule("resource://breached/Theme.sys.mjs");
const { Mods } = ChromeUtils.importESModule("resource://breached/Mods.sys.mjs");
const P = Services.prefs;

// Used when the mods site can't be reached, so the step still shows them.
const KNOWN_MODS = [
  { id: "passwords", name: "Password manager", description: "Saves the passwords you type into sites and fills them in next time." },
  { id: "bookmarks", name: "Bookmarks", description: "Ctrl+D saves the page, Ctrl+B lists your bookmarks." },
  { id: "drm", name: "Protected video (DRM)", description: "Plays Netflix, Disney+, Spotify and other protected video and music." },
  { id: "bitwarden", name: "Bitwarden", description: "Fill logins and use passkeys from your Bitwarden vault." },
  { id: "speed", name: "Speed", description: "Trades memory for speed: tabs stay loaded and new tabs open sooner." },
  { id: "sync", name: "Firefox Sync", description: "Sync history, bookmarks and passwords with Firefox.", experimental: true },
];

const POSITIONS = [
  ["bottom", "Bottom"],
  ["top", "Top"],
  ["left", "Left"],
  ["right", "Right"],
];

const $ = id => document.getElementById(id);

// ------------------------------------------------------------ colours

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  let k = n => (n + h / 30) % 12;
  let a = s * Math.min(l, 1 - l);
  let f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** A colour scheme around hue h, in the order of Theme.COLORS. */
function schemeFor(h, dark) {
  let s = rand(25, 70);
  let tint = s * rand(0.2, 0.4);
  if (dark) {
    let base = rand(10, 16);
    let text = hsl(h, 15, 90);
    return [
      hsl(h, tint, base), // bars
      text,
      hsl(h, tint, base + 5), // tabs
      hsl(h, tint, base + 8), // every other tab
      hsl(h, s + 15, rand(40, 50)), // current tab
      hsl(h, 20, 97),
      hsl(h, s + 20, 62), // highlights
      hsl(h + 150, 40, 62), // loading
      hsl(h, s + 20, 62), // loaded
      "#f07272",
    ];
  }
  let base = rand(84, 90);
  let text = hsl(h, 12, 18);
  return [
    hsl(h, tint, base),
    text,
    hsl(h, tint, base - 6),
    hsl(h, tint, base - 3),
    hsl(h, s + 15, rand(70, 78)),
    text,
    hsl(h, s + 20, 58),
    hsl(h + 150, 40, 62),
    hsl(h, s + 20, 58),
    "#e07b7b",
  ];
}

const Colours = {
  hue: Math.floor(Math.random() * 360),
  dark: false,

  init() {
    for (let [id, name] of Object.entries(Theme.PRESET_NAMES)) {
      let swatches = el("span", { class: "swatches" });
      for (let i of [0, 2, 4, 6, 1]) {
        swatches.append(el("span", { style: `background: ${Theme.PRESETS[id][i]}` }));
      }
      let button = el("button", { type: "button", class: "preset", id: "preset-" + id, onclick: () => this.preset(id) }, swatches, name);
      $("presets").append(button);
    }
    let dial = $("dial");
    let drag = event => {
      let r = dial.getBoundingClientRect();
      let angle = (Math.atan2(event.clientX - (r.left + r.width / 2), -(event.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
      this.setHue(Math.round((angle + 360) % 360));
    };
    dial.addEventListener("pointerdown", event => {
      dial.setPointerCapture(event.pointerId);
      drag(event);
    });
    dial.addEventListener("pointermove", event => {
      if (dial.hasPointerCapture(event.pointerId)) {
        drag(event);
      }
    });
    dial.addEventListener("keydown", event => {
      let step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[event.key];
      if (step) {
        event.preventDefault();
        this.setHue((this.hue + step + 360) % 360);
      }
    });
    $("shuffle").addEventListener("click", () => this.make());
    $("dark").addEventListener("change", () => {
      this.dark = $("dark").checked;
      this.make();
    });
    this.showHue();
    this.showSelected();
  },

  preset(id) {
    Theme.applyPreset(id);
    this.showSelected();
  },

  setHue(h) {
    this.hue = h;
    this.showHue();
    this.make();
  },

  /** Makes and applies a scheme from the dial's colour. */
  make() {
    let values = schemeFor(this.hue, this.dark);
    Theme.COLORS.forEach((c, i) => Theme.setColor(c.name, values[i]));
    this.showSelected();
  },

  showHue() {
    $("dial-knob").style.transform = `rotate(${this.hue}deg)`;
    $("dial-knob").style.background = hsl(this.hue, 75, 60);
    $("dial").setAttribute("aria-valuenow", this.hue);
  },

  showSelected() {
    let current = Theme.currentPreset();
    for (let button of document.querySelectorAll(".preset")) {
      button.toggleAttribute("selected", button.id == "preset-" + current);
    }
    $("custom").toggleAttribute("selected", !current);
  },
};

// ------------------------------------------------------------ tab bar

const TabBar = {
  init() {
    for (let [value, label] of POSITIONS) {
      let picture = el("span", { class: "window", "data-at": value }, el("span", { class: "bar" }), el("span"));
      let button = el("button", { type: "button", class: "position", id: "position-" + value, onclick: () => this.set(value) }, picture, label);
      $("positions").append(button);
    }
    $("autohide").checked = P.getBoolPref("breached.tabs.autohide", false);
    $("autohide").addEventListener("change", () => P.setBoolPref("breached.tabs.autohide", $("autohide").checked));
    $("nav-buttons").checked = P.getBoolPref("breached.tabs.navButtons", true);
    $("nav-buttons").addEventListener("change", () => P.setBoolPref("breached.tabs.navButtons", $("nav-buttons").checked));
    this.show();
  },

  set(value) {
    P.setStringPref("breached.tabs.position", value);
    this.show();
  },

  show() {
    let current = P.getStringPref("breached.tabs.position", "bottom");
    for (let [value] of POSITIONS) {
      $("position-" + value).toggleAttribute("selected", value == current);
    }
  },
};

// ------------------------------------------------------------ mods

const ModPicker = {
  async init() {
    let list = KNOWN_MODS;
    try {
      let response = await fetch(Mods.site + "mods.json", { cache: "no-cache", credentials: "omit" });
      let site = (await response.json()).mods;
      if (Array.isArray(site) && site.length) {
        list = site;
      }
    } catch (e) {
      // offline: the built-in list will do
    }
    let installed = new Set((await Mods.list()).filter(m => m.installed).map(m => m.id));
    let box = $("mods");
    box.textContent = "";
    for (let mod of list) {
      let id = "mod-" + mod.id;
      let check = el("input", { type: "checkbox", id, value: mod.id });
      if (installed.has(mod.id)) {
        check.checked = check.disabled = true;
      }
      let name = el("span", { class: "name" }, mod.name);
      if (mod.experimental) {
        name.append(el("span", { class: "tag" }, "experimental"));
      }
      if (installed.has(mod.id)) {
        name.append(el("span", { class: "tag" }, "installed"));
      }
      box.append(el("label", { class: "mod", for: id }, check, el("span", {}, name, el("span", { class: "description" }, mod.description ?? ""))));
    }
  },

  picked() {
    return [...document.querySelectorAll("#mods input:checked:not(:disabled)")].map(c => c.value);
  },
};

// ------------------------------------------------------------ steps

const Steps = {
  index: 0,

  get all() {
    return [...document.querySelectorAll(".step")];
  },

  init() {
    for (let step of this.all) {
      $("steps").append(el("li", {}, step.dataset.title));
    }
    $("back").addEventListener("click", () => this.go(this.index - 1));
    $("next").addEventListener("click", () => (this.index == this.all.length - 1 ? this.finish() : this.go(this.index + 1)));
    $("skip").addEventListener("click", () => this.done());
    this.go(0);
  },

  go(index) {
    this.index = Math.max(0, Math.min(this.all.length - 1, index));
    this.all.forEach((step, i) => (step.hidden = i != this.index));
    [...$("steps").children].forEach((li, i) => {
      li.toggleAttribute("current", i == this.index);
      li.toggleAttribute("done", i < this.index);
    });
    $("back").disabled = this.index == 0;
    $("next").textContent = this.index == this.all.length - 1 ? "Finish" : "Next";
  },

  async finish() {
    let ids = ModPicker.picked();
    let shell = window.browsingContext.topChromeWindow?.Breached;
    if (ids.length && shell) {
      for (let button of document.querySelectorAll("#buttons button")) {
        button.disabled = true;
      }
      let failed = [];
      for (let [i, id] of ids.entries()) {
        $("status").textContent = `Installing mods (${i + 1} of ${ids.length})…`;
        try {
          // Ticking the box was the yes; no second question in the command bar.
          await shell.mods.installFromSite(id, { confirm: false, quiet: true });
        } catch (e) {
          console.error(`Breached: installing ${id}`, e);
          failed.push(id);
        }
      }
      if (failed.length) {
        shell.showMessage(`Couldn't install ${failed.join(", ")}. Try again from settings > Mods > Get mods`, "error");
      } else {
        shell.showMessage(`Installed ${ids.length} mod${ids.length == 1 ? "" : "s"}. Settings > Mods has their settings`);
      }
    }
    this.done();
  },

  /** Leaves for the home page. */
  done() {
    P.setBoolPref("breached.welcome.done", true);
    let shell = window.browsingContext.topChromeWindow?.Breached;
    shell?.load(window.browsingContext.top.embedderElement, shell.homepage());
  },
};

window.addEventListener("DOMContentLoaded", () => {
  Colours.init();
  TabBar.init();
  ModPicker.init();
  Steps.init();
  const stop = Theme.watchColors(() => Colours.showSelected());
  window.addEventListener("unload", stop, { once: true });
});
