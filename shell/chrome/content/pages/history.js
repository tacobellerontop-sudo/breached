/* Breached history page: every visit, newest first, with search. */

"use strict";

const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");

const PAGE_SIZE = 300;
let limit = PAGE_SIZE;

async function query(filter) {
  let db = await PlacesUtils.promiseDBConnection();
  let params = { limit: limit + 1 };
  let where = "";
  if (filter) {
    where = "AND (h.url LIKE :filter ESCAPE '/' OR h.title LIKE :filter ESCAPE '/')";
    params.filter = "%" + filter.replace(/[/%_]/g, "/$&") + "%";
  }
  let rows = await db.executeCached(
    `SELECT h.url, h.title, v.visit_date
       FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
      WHERE h.hidden = 0 ${where}
      ORDER BY v.visit_date DESC LIMIT :limit`,
    params
  );
  return rows.map(r => ({
    url: r.getResultByName("url"),
    title: r.getResultByName("title"),
    date: r.getResultByName("visit_date") / 1000,
  }));
}

let rendering = null;
async function render() {
  let filter = document.getElementById("filter").value.trim();
  let mine = (rendering = {});
  let visits;
  try {
    visits = await query(filter);
  } catch (e) {
    console.error("Breached history", e);
    visits = [];
  }
  if (rendering !== mine) {
    return; // a newer search replaced this one
  }
  let more = visits.length > limit;
  visits = visits.slice(0, limit);
  let list = document.getElementById("list");
  let groups = [];
  let ul = null;
  let lastDay = null;
  for (let visit of visits) {
    let day = dayLabel(visit.date);
    if (day != lastDay) {
      lastDay = day;
      ul = el("ul", { class: "items" });
      groups.push(el("h2", { class: "group" }, day), ul);
    }
    let host = "";
    try {
      host = new URL(visit.url).host;
    } catch (e) {}
    let remove = el("button", { type: "button", title: "Remove from history" }, "x");
    let li = el(
      "li",
      { class: "visit" },
      el("span", { class: "time" }, timeLabel(visit.date)),
      el(
        "span",
        { class: "main" },
        pageLink(visit.url, visit.title || visit.url),
        visit.title && host ? el("span", { class: "sub" }, "  " + host) : null
      ),
      el("span", { class: "actions" }, remove)
    );
    remove.addEventListener("click", async () => {
      await PlacesUtils.history.remove(visit.url);
      render();
    });
    ul.append(li);
  }
  list.replaceChildren(...groups);
  document.getElementById("empty").hidden = visits.length > 0;
  document.getElementById("more-row").hidden = !more;
}

window.addEventListener("DOMContentLoaded", () => {
  let filter = document.getElementById("filter");
  let timer;
  filter.addEventListener("input", () => {
    clearTimeout(timer);
    limit = PAGE_SIZE;
    timer = setTimeout(render, 150);
  });
  document.getElementById("more").addEventListener("click", () => {
    limit += PAGE_SIZE;
    render();
  });
  confirmButton(document.getElementById("clear-all"), "click again to clear everything", async () => {
    await PlacesUtils.history.clear();
    render();
  });
  filter.focus();
  render();
});
