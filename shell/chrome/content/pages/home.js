/* Breached home page: a search/address box, pinned sites and the most
 * visited sites. */

"use strict";

const shellWindow = () => window.browsingContext.topChromeWindow;
const Pins = ChromeUtils.importESModule("resource://breached/Pins.sys.mjs");

/** Opens an address or search in this tab, through the browser window. */
function go(text) {
  let shell = shellWindow()?.Breached;
  if (!shell) {
    return;
  }
  let url;
  try {
    url = shell.urlFor(text);
  } catch (e) {
    shell.showMessage(e.message, "error");
    return;
  }
  shell.load(window.browsingContext.top.embedderElement, url);
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (e) {
    return url;
  }
}

/** Opens url here, or in a new tab with Ctrl or the middle button. */
function linkTo(a, url) {
  a.href = url;
  // Pointing at a site starts connecting to it.
  a.addEventListener("mouseenter", () => shellWindow()?.Breached?.preconnect(url));
  a.addEventListener("click", event => {
    if (event.button == 0 && !event.ctrlKey) {
      event.preventDefault();
      go(url);
    }
  });
}

let dragFrom = -1;

/** The time of day, in words: the new tab page's one personal touch. */
function showGreeting() {
  let hour = new Date().getHours();
  let text = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = text;
}

/** How many tabs Breached has put to sleep: its lightness, made visible.
    Only shown when at least one tab is asleep. */
function showSleeping() {
  let shell = shellWindow()?.Breached;
  let el = document.getElementById("sleeping");
  let asleep = shell?.tabs?.filter(tab => tab.asleep).length ?? 0;
  el.hidden = asleep == 0;
  if (asleep) {
    el.textContent = `${asleep} tab${asleep == 1 ? "" : "s"} asleep`;
  }
}

function showPinned() {
  let list = document.getElementById("pin-list");
  list.textContent = "";
  let sites = Pins.list();
  sites.forEach((site, i) => {
    let host = hostOf(site.url);
    let a = document.createElement("a");
    a.className = "pin";
    a.title = site.url;
    linkTo(a, site.url);
    let badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = (site.title || host).charAt(0).toUpperCase();
    let name = document.createElement("span");
    name.className = "name";
    name.textContent = site.title || host;
    let sub = document.createElement("span");
    sub.className = "host";
    sub.textContent = host;
    a.append(badge, name, sub);
    let unpin = document.createElement("button");
    unpin.type = "button";
    unpin.className = "unpin";
    unpin.title = "Unpin " + (site.title || host);
    unpin.textContent = "\u00d7";
    unpin.addEventListener("click", () => Pins.remove(i + 1));
    let li = document.createElement("li");
    li.draggable = true;
    li.append(a, unpin);
    li.addEventListener("dragstart", event => {
      dragFrom = i;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/uri-list", site.url);
    });
    li.addEventListener("dragover", event => {
      if (dragFrom >= 0) {
        event.preventDefault();
        li.classList.add("drop");
      }
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop"));
    li.addEventListener("drop", event => {
      event.preventDefault();
      if (dragFrom >= 0 && dragFrom != i) {
        Pins.move(dragFrom, i);
      }
      dragFrom = -1;
    });
    li.addEventListener("dragend", () => (dragFrom = -1));
    list.append(li);
  });
  document.getElementById("pin-empty").hidden = sites.length > 0;
  for (let button of document.querySelectorAll("#site-list .pin-this")) {
    button.hidden = Pins.has(button.dataset.url);
  }
}

function setUpPinForm() {
  let form = document.getElementById("pin-form");
  let url = document.getElementById("pin-url");
  let title = document.getElementById("pin-title");
  let error = document.getElementById("pin-error");
  let close = () => {
    form.hidden = true;
    url.value = title.value = error.textContent = "";
    document.getElementById("search").focus();
  };
  document.getElementById("pin-add").addEventListener("click", () => {
    form.hidden = false;
    url.focus();
  });
  document.getElementById("pin-cancel").addEventListener("click", close);
  form.addEventListener("keydown", event => {
    if (event.key == "Escape") {
      close();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    let address = url.value.trim();
    if (!address) {
      return;
    }
    try {
      let full = shellWindow()?.Breached?.urlFor(address) ?? address;
      if (!Pins.add(full, title.value)) {
        error.textContent = "Already pinned";
        return;
      }
      close();
    } catch (e) {
      error.textContent = e.message;
    }
  });
}

async function showMostVisited() {
  let rows;
  try {
    const { PlacesUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/PlacesUtils.sys.mjs"
    );
    let db = await PlacesUtils.promiseDBConnection();
    rows = await db.execute(
      `SELECT url, title FROM moz_places
       WHERE hidden = 0 AND frecency > 0 AND url_hash BETWEEN hash('http', 'prefix_lo') AND hash('http', 'prefix_hi')
       ORDER BY frecency DESC LIMIT 8`
    );
  } catch (e) {
    console.error("Breached home: most visited", e);
    return;
  }
  let list = document.getElementById("site-list");
  for (let row of rows) {
    let url = row.getResultByName("url");
    let title = row.getResultByName("title");
    let host;
    try {
      host = new URL(url).host.replace(/^www\./, "");
    } catch (e) {
      continue;
    }
    let a = document.createElement("a");
    a.title = url;
    a.textContent = title || host;
    if (title) {
      let span = document.createElement("span");
      span.className = "host";
      span.textContent = "  " + host;
      a.append(span);
    }
    linkTo(a, url);
    let pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin-this link-button";
    pin.dataset.url = url;
    pin.title = "Pin to this page";
    pin.textContent = "pin";
    pin.hidden = Pins.has(url);
    pin.addEventListener("click", () => {
      try {
        Pins.add(url, title || "");
      } catch (e) {
        shellWindow()?.Breached?.showMessage(e.message, "error");
      }
    });
    let li = document.createElement("li");
    li.append(a, pin);
    list.append(li);
  }
  document.getElementById("sites").hidden = !list.children.length;
}

window.addEventListener("DOMContentLoaded", () => {
  let input = document.getElementById("search");
  input.addEventListener("input", () => shellWindow()?.Breached?.preconnectTyped(input.value));
  document.getElementById("search-form").addEventListener("submit", event => {
    event.preventDefault();
    if (input.value.trim()) {
      go(input.value);
    }
  });
  document.getElementById("settings-link").addEventListener("click", event => {
    event.preventDefault();
    shellWindow()?.Breached?.openSettings();
  });
  input.focus();
  showGreeting();
  showSleeping();
  setUpPinForm();
  showPinned();
  showMostVisited();
  Services.prefs.addObserver(Pins.PREF, showPinned);
  window.addEventListener("unload", () => Services.prefs.removeObserver(Pins.PREF, showPinned));
});
