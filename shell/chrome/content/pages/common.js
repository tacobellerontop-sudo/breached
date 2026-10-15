/* Helpers shared by Breached's list pages (history, downloads, extensions). */

"use strict";

const shell = () => window.browsingContext.topChromeWindow?.Breached;

function el(tag, props = {}, ...children) {
  let e = document.createElement(tag);
  for (let [k, v] of Object.entries(props)) {
    if (k == "class") {
      e.className = v;
    } else if (k.startsWith("on")) {
      e.addEventListener(k.slice(2), v);
    } else if (k in e) {
      e[k] = v;
    } else {
      e.setAttribute(k, v);
    }
  }
  e.append(...children.filter(c => c != null));
  return e;
}

/** A link that opens in this tab, or a new one with Ctrl or the middle button. */
function pageLink(url, text) {
  let a = el("a", { href: url, title: url }, text);
  let open = event => {
    if (event.button > 1) {
      return;
    }
    event.preventDefault();
    let s = shell();
    if (!s) {
      return;
    }
    if (event.button == 1 || event.ctrlKey) {
      s.openTab(url, { background: true, afterCurrent: true });
    } else {
      s.load(window.browsingContext.top.embedderElement, url);
    }
  };
  a.addEventListener("click", open);
  a.addEventListener("auxclick", open);
  return a;
}

function formatBytes(n) {
  if (!(n >= 0)) {
    return "";
  }
  let units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function dayLabel(date) {
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  let day = new Date(date);
  day.setHours(0, 0, 0, 0);
  let diff = Math.round((today - day) / 86400000);
  if (diff == 0) {
    return "today";
  }
  if (diff == 1) {
    return "yesterday";
  }
  return day.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function timeLabel(date) {
  return new Date(date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** A button that asks for a second click before doing something drastic. */
function confirmButton(button, askText, action) {
  let text = button.textContent;
  let armed = false;
  let timer;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.textContent = askText;
      button.classList.add("armed");
      timer = setTimeout(() => {
        armed = false;
        button.textContent = text;
        button.classList.remove("armed");
      }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = text;
    button.classList.remove("armed");
    action();
  });
}
