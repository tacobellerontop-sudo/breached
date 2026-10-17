/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Protected video (DRM): Netflix, Disney+, Spotify and the like play through
// Google's Widevine, which Firefox downloads from Mozilla's update server.
// Breached keeps it off until a site needs it (breached.drm, "ask" by
// default), then asks once, downloads Widevine and reloads the page.
//
// Gecko tells the page's process about each request
// ("mediakeys-request", heard in PermissionsChild.sys.mjs); the answer
// comes to request() here through the page's BreachedPermissions actor.

const WIDEVINE = "gmp-widevinecdm";
const KEY_SYSTEM = "com.widevine.alpha";
const PREF = "breached.drm"; // "ask", "on" or "off"

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  GMPInstallManager: "resource://gre/modules/GMPInstallManager.sys.mjs",
});

export function setting() {
  return Services.prefs.getStringPref(PREF, "ask");
}

export function installed() {
  return !!Services.prefs.getStringPref(`media.${WIDEVINE}.version`, "");
}

/** Lets Gecko use Widevine (Firefox's own switches for it). */
function allow(on) {
  Services.prefs.setBoolPref("media.eme.enabled", on);
  Services.prefs.setBoolPref(`media.${WIDEVINE}.visible`, on);
  Services.prefs.setBoolPref(`media.${WIDEVINE}.enabled`, on);
}

let installing = null;

/** Downloads Widevine if it isn't here yet. Resolves true when it's ready. */
export function install() {
  if (installed()) {
    return Promise.resolve(true);
  }
  installing ??= (async () => {
    let manager = new lazy.GMPInstallManager();
    try {
      let { addons } = await manager.checkForAddons();
      let widevine = addons.find(a => a.id == WIDEVINE && a.isValid);
      if (!widevine) {
        throw new Error("Mozilla's update server didn't offer Widevine");
      }
      if (!widevine.isInstalled) {
        await manager.installAddon(widevine);
      }
      return installed();
    } finally {
      manager.uninit();
      installing = null;
    }
  })();
  return installing;
}

/** settings > privacy and ":drm": turns protected video on or off. */
export async function turn(on) {
  Services.prefs.setStringPref(PREF, on ? "on" : "off");
  allow(on);
  if (on) {
    return install();
  }
  return false;
}

/** At startup: Gecko's switches follow the setting ("ask" starts off). */
export function init() {
  let on = setting() == "on";
  if (Services.prefs.getBoolPref("media.eme.enabled", false) != on) {
    allow(on);
  }
}

// Sites asked about this session (asked once each).
const asked = new Set();

/**
 * A page asked for protected video. data: { keySystem, status } from
 * Gecko's mediakeys-request; status "api-disabled" while it's off,
 * "cdm-not-installed" while Widevine isn't downloaded yet.
 */
export async function request(shell, browser, host, { keySystem, status }) {
  if (!keySystem?.startsWith(KEY_SYSTEM)) {
    return;
  }
  let mode = setting();
  if (status == "cdm-not-installed" && mode == "on") {
    shell.showMessage("Getting Widevine for protected video…");
    if (await install().catch(e => fail(shell, e))) {
      shell.showMessage("Protected video is ready");
    }
    return;
  }
  if (!["api-disabled", "cdm-disabled", "cdm-not-installed"].includes(status) || mode == "off" || asked.has(host)) {
    return;
  }
  asked.add(host);
  let answer = await shell.pickForTab(browser, `${host} wants to play protected video (DRM):`, [
    { label: "turn on", detail: "download Google's Widevine (about 10 MB), then reload", answer: "on" },
    { label: "not now", detail: "ask again next time", answer: "later" },
    { label: "never", detail: "keep it off (settings > privacy turns it on)", answer: "off" },
  ]);
  if (answer?.answer == "off") {
    await turn(false);
    return;
  }
  if (answer?.answer != "on") {
    asked.delete(host);
    return;
  }
  shell.showMessage("Getting Widevine for protected video…");
  let ready = await turn(true).catch(e => fail(shell, e));
  if (ready) {
    shell.showMessage("Protected video is on");
    if (!browser.isConnected) {
      return;
    }
    browser.reload();
  }
}

function fail(shell, e) {
  console.error("Breached DRM:", e);
  shell.showMessage(`Couldn't get Widevine: ${e.message ?? e.type ?? e}`, "error");
  return false;
}
