/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached colours and transparency, shared by the window and its own pages.
// Each colour is a setting under breached.colors.<name> holding "#rrggbb";
// its default lives in defaults/preferences/shell.js.

const PREF = "breached.colors.";

export const COLORS = [
  { name: "background", label: "Bars", css: "--bar-bg" },
  { name: "text", label: "Text", css: "--fg" },
  { name: "tab", label: "Tabs", css: "--tab-odd" },
  { name: "tabAlt", label: "Every other tab", css: "--tab-even" },
  { name: "tabSelected", label: "Current tab", css: "--tab-selected" },
  { name: "tabSelectedText", label: "Current tab text", css: "--tab-selected-fg" },
  { name: "accent", label: "Highlights", css: "--accent" },
  { name: "loading", label: "Loading mark", css: "--loading" },
  { name: "loaded", label: "Loaded mark", css: "--loaded" },
  { name: "error", label: "Errors", css: "--error" },
];

// Order matches COLORS. The first one is the default.
export const DEFAULT_PRESET = "pastel";
export const PRESETS = {
  pastel: ["#cfd3da", "#2f3136", "#bcc1c9", "#c6cad1", "#f5b183", "#2f3136", "#ee9f66", "#9db8d9", "#ee9f66", "#e07b7b"],
  qutebrowser: ["#000000", "#ffffff", "#808080", "#a9a9a9", "#000000", "#ffffff", "#00aa00", "#0000aa", "#00aa00", "#ff0000"],
  graphite: ["#1e1e1e", "#d4d4d4", "#2d2d2d", "#333333", "#0e639c", "#ffffff", "#3794ff", "#c5a332", "#3794ff", "#f14c4c"],
  nord: ["#2e3440", "#eceff4", "#3b4252", "#434c5e", "#88c0d0", "#2e3440", "#88c0d0", "#ebcb8b", "#a3be8c", "#bf616a"],
  gruvbox: ["#282828", "#ebdbb2", "#3c3836", "#504945", "#d79921", "#282828", "#fabd2f", "#83a598", "#b8bb26", "#fb4934"],
  solarized: ["#002b36", "#eee8d5", "#073642", "#0b3f4c", "#268bd2", "#fdf6e3", "#2aa198", "#b58900", "#859900", "#dc322f"],
  light: ["#f3f3f3", "#1f1f1f", "#e1e1e1", "#d6d6d6", "#ffffff", "#000000", "#0067c0", "#0067c0", "#107c10", "#c42b1c"],
};

export const PRESET_NAMES = {
  pastel: "Pastel silver and orange (default)",
  qutebrowser: "qutebrowser",
  graphite: "Graphite",
  nord: "Nord",
  gruvbox: "Gruvbox",
  solarized: "Solarized dark",
  light: "Light",
};

const HEX = /^#[0-9a-f]{6}$/i;

export function getColor(name) {
  let value = Services.prefs.getStringPref(PREF + name, "");
  return HEX.test(value) ? value : Services.prefs.getDefaultBranch(PREF).getStringPref(name, "#000000");
}

export function setColor(name, value) {
  if (!HEX.test(value)) {
    throw new Error(`${value} isn't a #rrggbb colour`);
  }
  Services.prefs.setStringPref(PREF + name, value.toLowerCase());
}

export function applyPreset(preset) {
  let values = PRESETS[preset];
  if (!values) {
    throw new Error(`no colour preset called ${preset}`);
  }
  COLORS.forEach((c, i) => Services.prefs.clearUserPref(PREF + c.name));
  if (preset != DEFAULT_PRESET) {
    COLORS.forEach((c, i) => setColor(c.name, values[i]));
  }
}

/** The preset the current colours match, or null for custom colours. */
export function currentPreset() {
  let now = COLORS.map(c => getColor(c.name).toLowerCase());
  return Object.keys(PRESETS).find(p => PRESETS[p].every((v, i) => v == now[i])) ?? null;
}

/** Sets the colour variables on an element (usually a document's root). */
export function applyColors(element) {
  for (let c of COLORS) {
    element.style.setProperty(c.css, getColor(c.name));
  }
  // Light or dark form controls, from the bar colour's brightness.
  let [r, g, b] = getColor("background").slice(1).match(/../g).map(h => parseInt(h, 16));
  element.style.setProperty("color-scheme", r * 0.299 + g * 0.587 + b * 0.114 > 140 ? "light" : "dark");
}

/** Calls back whenever a colour changes; returns a function that stops it. */
export function watchColors(callback) {
  let observer = { observe: () => callback() };
  Services.prefs.addObserver(PREF, observer);
  return () => Services.prefs.removeObserver(PREF, observer);
}
