/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pinned websites on the new tab page (breached:home), kept in the
// breached.pinnedSites pref as JSON: [{ url, title }], in display order.

export const PREF = "breached.pinnedSites";
export const MAX = 24;

export function list() {
  try {
    let sites = JSON.parse(Services.prefs.getStringPref(PREF, "[]"));
    return Array.isArray(sites) ? sites.filter(s => typeof s?.url == "string") : [];
  } catch (e) {
    return [];
  }
}

function save(sites) {
  Services.prefs.setStringPref(PREF, JSON.stringify(sites));
}

/** Same site for pinning purposes: ignores a trailing slash and #hash. */
function same(a, b) {
  let clean = url => url.split("#")[0].replace(/\/$/, "");
  return clean(a) == clean(b);
}

export function has(url) {
  return list().some(s => same(s.url, url));
}

/** Pins a page (last in the list). Returns false if it already was. */
export function add(url, title = "") {
  if (!/^https?:\/\//.test(url)) {
    throw new Error("Only web pages (http or https) can be pinned");
  }
  let sites = list();
  if (sites.some(s => same(s.url, url))) {
    return false;
  }
  if (sites.length >= MAX) {
    throw new Error(`At most ${MAX} sites can be pinned`);
  }
  sites.push({ url, title: title.trim() });
  save(sites);
  return true;
}

/** Unpins by address or by 1-based position. Returns the removed site. */
export function remove(which) {
  let sites = list();
  let index = typeof which == "number" ? which - 1 : sites.findIndex(s => same(s.url, which));
  if (index < 0 || index >= sites.length) {
    return null;
  }
  let [site] = sites.splice(index, 1);
  save(sites);
  return site;
}

/** Moves the site at from to position to (both 0-based). */
export function move(from, to) {
  let sites = list();
  if (from < 0 || from >= sites.length) {
    return;
  }
  let [site] = sites.splice(from, 1);
  sites.splice(Math.max(0, Math.min(to, sites.length)), 0, site);
  save(sites);
}

/** Renames a pinned site. */
export function rename(url, title) {
  let sites = list();
  let site = sites.find(s => same(s.url, url));
  if (site) {
    site.title = title.trim();
    save(sites);
  }
}
