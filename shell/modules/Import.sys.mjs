/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Brings bookmarks and history over from Chrome, Edge, Brave and Firefox on
// this computer, and passwords from a .csv file those browsers export.
// (Their saved passwords are locked to them, so the .csv is the way over.)

import { PlacesUtils } from "resource://gre/modules/PlacesUtils.sys.mjs";
import { Sqlite } from "resource://gre/modules/Sqlite.sys.mjs";

const HISTORY_LIMIT = 5000;

// Chromium browsers keep their data in %LOCALAPPDATA%\<dir>\User Data.
const CHROMIUM = [
  { id: "chrome", name: "Chrome", dir: ["Google", "Chrome", "User Data"] },
  { id: "edge", name: "Edge", dir: ["Microsoft", "Edge", "User Data"] },
  { id: "brave", name: "Brave", dir: ["BraveSoftware", "Brave-Browser", "User Data"] },
  { id: "vivaldi", name: "Vivaldi", dir: ["Vivaldi", "User Data"] },
];

const WEB = /^(https?|ftp|file):/i;

async function exists(path) {
  try {
    return await IOUtils.exists(path);
  } catch (e) {
    return false;
  }
}

/** The profile folder a Chromium browser last used, or Default. */
async function chromiumProfile(root) {
  try {
    let state = await IOUtils.readJSON(PathUtils.join(root, "Local State"));
    let last = state?.profile?.last_used;
    if (last && (await exists(PathUtils.join(root, last, "Bookmarks")))) {
      return PathUtils.join(root, last);
    }
  } catch (e) {
    // no Local State: try Default
  }
  return PathUtils.join(root, "Default");
}

/** Firefox's profile with the most recently used places.sqlite. */
async function firefoxProfile() {
  let appData = Services.env.get("APPDATA");
  if (!appData) {
    return null;
  }
  let dir = PathUtils.join(appData, "Mozilla", "Firefox", "Profiles");
  if (!(await exists(dir))) {
    return null;
  }
  let best = null;
  for (let path of await IOUtils.getChildren(dir)) {
    let places = PathUtils.join(path, "places.sqlite");
    if (await exists(places)) {
      let { lastModified } = await IOUtils.stat(places);
      if (!best || lastModified > best.lastModified) {
        best = { path, lastModified };
      }
    }
  }
  return best?.path ?? null;
}

/** Browsers found on this computer: [{ id, name, profile, kind }]. */
export async function detect() {
  let found = [];
  let local = Services.env.get("LOCALAPPDATA");
  if (local) {
    for (let b of CHROMIUM) {
      let root = PathUtils.join(local, ...b.dir);
      if (!(await exists(root))) {
        continue;
      }
      let profile = await chromiumProfile(root);
      if ((await exists(PathUtils.join(profile, "Bookmarks"))) || (await exists(PathUtils.join(profile, "History")))) {
        found.push({ id: b.id, name: b.name, profile, kind: "chromium" });
      }
    }
  }
  let ff = await firefoxProfile();
  if (ff) {
    found.push({ id: "firefox", name: "Firefox", profile: ff, kind: "firefox" });
  }
  return found;
}

/** Opens a copy of a browser's database (the browser may have it locked). */
async function withCopy(path, fn) {
  if (!(await exists(path))) {
    return null;
  }
  let tmp = PathUtils.join(PathUtils.tempDir, `breached-import-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`);
  await IOUtils.copy(path, tmp);
  // Recent changes may still be in the write-ahead log.
  if (await exists(path + "-wal")) {
    await IOUtils.copy(path + "-wal", tmp + "-wal");
  }
  let db;
  try {
    db = await Sqlite.openConnection({ path: tmp });
    return await fn(db);
  } finally {
    await db?.close();
    for (let p of [tmp, tmp + "-wal", tmp + "-shm"]) {
      await IOUtils.remove(p, { ignoreAbsent: true });
    }
  }
}

// ------------------------------------------------------------ bookmarks

/** Chromium's Bookmarks file as Places tree nodes. */
async function chromiumBookmarks(profile) {
  let path = PathUtils.join(profile, "Bookmarks");
  if (!(await exists(path))) {
    return [];
  }
  let data = await IOUtils.readJSON(path);
  let convert = node => {
    if (node.type == "url") {
      return WEB.test(node.url) ? { url: node.url, title: node.name || node.url } : null;
    }
    let children = (node.children ?? []).map(convert).filter(Boolean);
    return children.length ? { type: PlacesUtils.bookmarks.TYPE_FOLDER, title: node.name || "Folder", children } : null;
  };
  let roots = data.roots ?? {};
  return ["bookmark_bar", "other", "synced"]
    .map(r => roots[r] && convert({ ...roots[r], name: roots[r].name || r }))
    .filter(Boolean);
}

/** Firefox's bookmarks (from places.sqlite) as Places tree nodes. */
async function firefoxBookmarks(profile) {
  let rows = await withCopy(PathUtils.join(profile, "places.sqlite"), db =>
    db.execute(
      `SELECT b.id, b.type, b.parent, b.title, b.position, b.guid, p.url
       FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id
       ORDER BY b.parent, b.position`
    )
  );
  if (!rows) {
    return [];
  }
  let byParent = new Map();
  let roots = [];
  for (let r of rows) {
    let row = {
      id: r.getResultByName("id"),
      type: r.getResultByName("type"),
      parent: r.getResultByName("parent"),
      title: r.getResultByName("title"),
      guid: r.getResultByName("guid"),
      url: r.getResultByName("url"),
    };
    if (["menu________", "toolbar_____", "unfiled_____", "mobile______"].includes(row.guid)) {
      roots.push(row);
    }
    if (!byParent.has(row.parent)) {
      byParent.set(row.parent, []);
    }
    byParent.get(row.parent).push(row);
  }
  let names = { menu________: "Menu", toolbar_____: "Toolbar", unfiled_____: "Other", mobile______: "Mobile" };
  let convert = (row, depth = 0) => {
    if (row.type == 1) {
      return row.url && WEB.test(row.url) ? { url: row.url, title: row.title || row.url } : null;
    }
    if (row.type != 2 || depth > 30) {
      return null;
    }
    let children = (byParent.get(row.id) ?? []).map(c => convert(c, depth + 1)).filter(Boolean);
    return children.length ? { type: PlacesUtils.bookmarks.TYPE_FOLDER, title: names[row.guid] ?? row.title ?? "Folder", children } : null;
  };
  return roots.map(r => convert(r)).filter(Boolean);
}

function count(nodes) {
  return nodes.reduce((n, node) => n + (node.children ? count(node.children) : 1), 0);
}

async function importBookmarks(source) {
  let nodes = source.kind == "firefox" ? await firefoxBookmarks(source.profile) : await chromiumBookmarks(source.profile);
  let n = count(nodes);
  if (!n) {
    return 0;
  }
  let folder = await PlacesUtils.bookmarks.insert({
    parentGuid: PlacesUtils.bookmarks.unfiledGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    title: `From ${source.name}`,
  });
  await PlacesUtils.bookmarks.insertTree({ guid: folder.guid, children: nodes });
  return n;
}

// ------------------------------------------------------------ history

async function importHistory(source) {
  let pages = [];
  if (source.kind == "firefox") {
    pages =
      (await withCopy(PathUtils.join(source.profile, "places.sqlite"), async db =>
        (
          await db.execute(
            `SELECT url, title, last_visit_date FROM moz_places
             WHERE last_visit_date > 0 AND hidden = 0
             ORDER BY last_visit_date DESC LIMIT ${HISTORY_LIMIT}`
          )
        ).map(r => ({
          url: r.getResultByName("url"),
          title: r.getResultByName("title"),
          date: new Date(r.getResultByName("last_visit_date") / 1000),
        }))
      )) ?? [];
  } else {
    // Chromium counts microseconds from 1601.
    const EPOCH_1601_MS = 11644473600000;
    pages =
      (await withCopy(PathUtils.join(source.profile, "History"), async db =>
        (
          await db.execute(
            `SELECT url, title, last_visit_time FROM urls
             WHERE last_visit_time > 0 AND hidden = 0
             ORDER BY last_visit_time DESC LIMIT ${HISTORY_LIMIT}`
          )
        ).map(r => ({
          url: r.getResultByName("url"),
          title: r.getResultByName("title"),
          date: new Date(r.getResultByName("last_visit_time") / 1000 - EPOCH_1601_MS),
        }))
      )) ?? [];
  }
  let now = Date.now();
  let infos = pages
    .filter(p => /^https?:/i.test(p.url) && p.date.getTime() > 0 && p.date.getTime() <= now)
    .map(p => ({
      url: p.url,
      title: p.title || undefined,
      visits: [{ date: p.date, transition: PlacesUtils.history.TRANSITIONS.LINK }],
    }));
  let added = 0;
  // In batches, so one bad address doesn't stop the rest.
  for (let i = 0; i < infos.length; i += 500) {
    try {
      await PlacesUtils.history.insertMany(infos.slice(i, i + 500), null, () => {});
      added += Math.min(500, infos.length - i);
    } catch (e) {
      console.error("Breached: importing history", e);
    }
  }
  return added;
}

/** Imports from one browser. what: { bookmarks, history }. */
export async function importFrom(source, what = { bookmarks: true, history: true }) {
  let result = { bookmarks: 0, history: 0, errors: [] };
  for (let kind of ["bookmarks", "history"]) {
    if (!what[kind]) {
      continue;
    }
    try {
      result[kind] = await (kind == "bookmarks" ? importBookmarks(source) : importHistory(source));
    } catch (e) {
      console.error(`Breached: importing ${kind} from ${source.name}`, e);
      result.errors.push(`${kind}: ${e.message}`);
    }
  }
  return result;
}

// ------------------------------------------------------------ passwords

/** Splits CSV text into rows of fields (quotes, commas and newlines in fields). */
export function parseCSV(text) {
  let rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (quoted) {
      if (c == '"' && text[i + 1] == '"') {
        field += '"';
        i++;
      } else if (c == '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c == '"') {
      quoted = true;
    } else if (c == ",") {
      row.push(field);
      field = "";
    } else if (c == "\n" || c == "\r") {
      if (c == "\r" && text[i + 1] == "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(f => f !== ""));
}

/**
 * Adds the logins in a passwords .csv (as Chrome, Edge, Brave and Firefox
 * export them) to Breached's password store. Resolves to { added, skipped }.
 */
export async function importPasswordsCSV(path) {
  let rows = parseCSV(await IOUtils.readUTF8(path));
  let header = (rows.shift() ?? []).map(h => h.trim().toLowerCase());
  let col = (...names) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1;
  let urlCol = col("url", "origin", "website", "login_uri");
  let userCol = col("username", "login", "login_username", "user");
  let passCol = col("password", "login_password");
  let realmCol = col("httprealm");
  let actionCol = col("formactionorigin");
  if (urlCol < 0 || passCol < 0) {
    throw new Error("that file doesn't look like a passwords export (no url and password columns)");
  }
  let added = 0;
  let skipped = 0;
  for (let r of rows) {
    let origin;
    try {
      origin = new URL(r[urlCol]).origin;
    } catch (e) {
      skipped++;
      continue;
    }
    let password = r[passCol] ?? "";
    if (!password || origin == "null") {
      skipped++;
      continue;
    }
    let username = userCol >= 0 ? r[userCol] ?? "" : "";
    let realm = realmCol >= 0 && r[realmCol] ? r[realmCol] : null;
    let action = realm ? null : actionCol >= 0 && r[actionCol] ? r[actionCol] : origin;
    let existing = await Services.logins.searchLoginsAsync({ origin });
    if (existing.some(l => l.username == username && l.password == password)) {
      skipped++;
      continue;
    }
    let login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
    login.init(origin, action, realm, username, password, "", "");
    try {
      await Services.logins.addLoginAsync(login);
      added++;
    } catch (e) {
      skipped++;
    }
  }
  return { added, skipped };
}
