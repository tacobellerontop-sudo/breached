/* Breached home page: a search/address box and the most visited sites. */

"use strict";

const shellWindow = () => window.browsingContext.topChromeWindow;

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
    a.href = url;
    a.title = url;
    a.textContent = title || host;
    if (title) {
      let span = document.createElement("span");
      span.className = "host";
      span.textContent = "  " + host;
      a.append(span);
    }
    a.addEventListener("click", event => {
      if (event.button == 0 && !event.ctrlKey) {
        event.preventDefault();
        go(url);
      }
    });
    let li = document.createElement("li");
    li.append(a);
    list.append(li);
  }
  document.getElementById("sites").hidden = !list.children.length;
}

window.addEventListener("DOMContentLoaded", () => {
  let input = document.getElementById("search");
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
  showMostVisited();
});
