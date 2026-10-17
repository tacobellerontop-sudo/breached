/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached updates from GitHub releases. A release is tagged v<version> and
// carries BreachedSetup-<version>.exe (see .github/workflows/release.yml).
// Installed copies download that installer and run it quietly; it closes
// Breached, replaces the files and starts Breached again. Portable copies
// get the release page instead.
//
// Network calls take the caller's fetch (a window's), so this module works
// the same from the browser window and from the settings page.

export const REPO = "tacobellerontop-sudo/breached";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PREF_AUTO = "breached.update.autoCheck";
const PREF_LAST = "breached.update.lastCheck";
const DAY = 24 * 60 * 60;

/** Compares "1.2.10" with "1.2.9": > 0 when a is newer. */
export function compare(a, b) {
  let pa = String(a).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  let pb = String(b).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    let d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) {
      return d;
    }
  }
  return 0;
}

/** The folder breached.exe is in. */
function appDir() {
  return Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
}

/** Installed with the installer (it leaves an uninstaller next to the app). */
export function isInstalled() {
  let uninstaller = appDir();
  uninstaller.append("unins000.exe");
  return uninstaller.exists();
}

/**
 * The newest release on GitHub:
 * { version, url (release page), notes, installer: { name, url, size } | null }
 */
export async function latest(fetchFn) {
  let response = await fetchFn(API, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (response.status == 403 || response.status == 429) {
    throw new Error("GitHub is limiting requests, try again later");
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}`);
  }
  let release = await response.json();
  let version = String(release.tag_name ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`unexpected release tag ${release.tag_name}`);
  }
  let asset = (release.assets ?? []).find(a => a.name == `BreachedSetup-${version}.exe`);
  return {
    version,
    url: release.html_url,
    notes: release.body ?? "",
    installer: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
  };
}

/** Checks for a newer version; resolves to the release, or null if none. */
export async function check(fetchFn, current) {
  let release = await latest(fetchFn);
  Services.prefs.setIntPref(PREF_LAST, Math.floor(Date.now() / 1000));
  return compare(release.version, current) > 0 ? release : null;
}

/** Whether the daily automatic check is due. */
export function autoCheckDue() {
  if (!Services.prefs.getBoolPref(PREF_AUTO, true)) {
    return false;
  }
  let last = Services.prefs.getIntPref(PREF_LAST, 0);
  return Date.now() / 1000 - last > DAY;
}

/**
 * Downloads the release's installer into the temp folder, calling
 * onProgress(fraction) on the way. Resolves to the file's path.
 */
export async function download(fetchFn, release, onProgress = () => {}) {
  if (!release.installer) {
    throw new Error("this release has no installer");
  }
  let response = await fetchFn(release.installer.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`download failed (${response.status})`);
  }
  let total = release.installer.size || Number(response.headers.get("Content-Length")) || 0;
  let reader = response.body.getReader();
  let chunks = [];
  let received = 0;
  for (;;) {
    let { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.length;
    if (total) {
      onProgress(Math.min(1, received / total));
    }
  }
  if (total && received != total) {
    throw new Error("the download was cut short");
  }
  let data = new Uint8Array(received);
  let offset = 0;
  for (let chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  let path = PathUtils.join(PathUtils.tempDir, release.installer.name);
  await IOUtils.write(path, data);
  return path;
}

/**
 * Runs a downloaded installer quietly and quits Breached so its files can be
 * replaced. The installer starts Breached again when it's done.
 */
export function install(path) {
  let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(file);
  process.runw(false, ["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/update=1"], 5);
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}
