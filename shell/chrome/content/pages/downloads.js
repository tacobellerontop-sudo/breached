/* Breached download manager: every download, newest first, with
 * open / show in folder / cancel / retry / remove. */

"use strict";

const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");

let list = null;
const rows = new Map(); // Download -> { li, update }

function state(d) {
  if (d.succeeded) {
    return d.target.exists === false ? ["file deleted", "error"] : ["done", "done"];
  }
  if (d.error) {
    return [d.error.becauseBlocked ? "blocked" : "failed", "error"];
  }
  if (d.canceled) {
    return [d.hasPartialData ? "paused" : "cancelled", ""];
  }
  if (!d.stopped) {
    let speed = d.speed ? `, ${formatBytes(d.speed)}/s` : "";
    let total = d.hasProgress ? ` of ${formatBytes(d.totalBytes)}` : "";
    return [`${formatBytes(d.currentBytes)}${total}${speed}`, ""];
  }
  return ["", ""];
}

function makeRow(d) {
  let name = el("span", { class: "name" });
  let sub = el("span", { class: "sub" });
  let stateEl = el("span", { class: "state" });
  let progress = el("progress", { max: 100 });
  let actions = el("span", { class: "actions" });
  let li = el(
    "li",
    { class: "download" },
    el("span", { class: "time" }, timeLabel(d.startTime)),
    el("span", { class: "main" }, name, sub, el("br"), stateEl, progress),
    actions
  );
  let button = (text, title, fn) =>
    el("button", { type: "button", title, class: "action-" + text, onclick: () => Promise.resolve().then(fn).catch(console.error) }, text);

  let update = () => {
    name.textContent = PathUtils.filename(d.target.path ?? "") || d.source.url;
    let host = "";
    try {
      host = new URL(d.source.url).host;
    } catch (e) {}
    sub.textContent = host ? "  " + host : "";
    let [text, cls] = state(d);
    stateEl.textContent = text;
    stateEl.className = "state " + cls;
    progress.hidden = d.stopped || !d.hasProgress;
    progress.value = d.progress;
    let b = [];
    if (d.succeeded && d.target.exists !== false) {
      b.push(button("open", "Open the file", () => d.launch()));
      b.push(button("folder", "Show in folder", () => d.showContainingDirectory()));
    }
    if (!d.stopped) {
      b.push(button("cancel", "Cancel", () => d.cancel()));
    }
    if (d.stopped && !d.succeeded && !d.error?.becauseBlocked) {
      b.push(button("retry", d.hasPartialData ? "Resume" : "Try again", () => d.start()));
    }
    if (d.stopped) {
      b.push(
        button("remove", "Remove from the list", async () => {
          await list.remove(d);
          await d.finalize(true);
        })
      );
    }
    actions.replaceChildren(...b);
  };
  update();
  return { li, update };
}

function refreshEmpty() {
  document.getElementById("empty").hidden = rows.size > 0;
}

const view = {
  onDownloadAdded(d) {
    let row = makeRow(d);
    rows.set(d, row);
    document.getElementById("list").prepend(row.li);
    refreshEmpty();
  },
  onDownloadChanged(d) {
    rows.get(d)?.update();
  },
  onDownloadRemoved(d) {
    rows.get(d)?.li.remove();
    rows.delete(d);
    refreshEmpty();
  },
};

window.addEventListener("DOMContentLoaded", async () => {
  let folder = await Downloads.getPreferredDownloadsDirectory();
  document.getElementById("folder").textContent = folder;
  document.getElementById("open-folder").addEventListener("click", async () => {
    let dir = new FileUtils.File(await Downloads.getPreferredDownloadsDirectory());
    try {
      dir.reveal();
    } catch (e) {
      dir.launch();
    }
  });
  document.getElementById("clear-finished").addEventListener("click", () => list?.removeFinished());
  list = await Downloads.getList(Downloads.ALL);
  // addView calls onDownloadAdded for each existing download, oldest first.
  await list.addView(view);
  refreshEmpty();
  window.addEventListener("unload", () => list.removeView(view));
});
