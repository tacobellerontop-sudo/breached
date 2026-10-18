// Breached's website. The page works without this: links point at the
// latest release page until the GitHub API answers with the real files.
"use strict";

const REPO = "tacobellerontop-sudo/breached";
const MODS_URL = "https://tacobellerontop-sudo.github.io/breached-mods/mods.json";
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- latest release ---------- */
(async function release() {
  try {
    let res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    let rel = await res.json();
    let version = rel.tag_name.replace(/^v/, "");
    let mb = a => `${Math.round(a.size / 1048576)} MB`;
    let setup = rel.assets.find(a => /setup.*\.exe$/i.test(a.name));
    let zip = rel.assets.find(a => /\.zip$/i.test(a.name));
    if (setup) {
      $("dl-main").href = $("dl-installer").href = setup.browser_download_url;
      $("dl-meta").textContent = `v${version} · ${mb(setup)}`;
    }
    if (zip) $("dl-portable").href = zip.browser_download_url;
    let a = document.createElement("a");
    a.href = rel.html_url;
    a.textContent = `What's new in ${version}`;
    $("release-notes").replaceChildren(a);
  } catch (e) {
    // Offline or rate limited: the release page links still work.
  }
})();

/* ---------- mods ---------- */
(async function mods() {
  let names = ["Vim keys and link hints", "Protected video (DRM)", "Bitwarden", "Password manager", "Bookmarks", "Dark pages", "Screenshots", "Speed", "Firefox Sync"];
  try {
    let res = await fetch(MODS_URL);
    if (res.ok) {
      let data = await res.json();
      if (data.mods?.length) names = data.mods.map(m => m.name);
    }
  } catch (e) {}
  for (let name of names) {
    let li = document.createElement("li");
    li.textContent = name;
    $("mod-list").append(li);
  }
})();

/* ---------- the browser shot: one quiet loop ---------- */
(async function demo() {
  if (calm) return;
  let home = $("mock-home"), site = $("mock-site"), tabs = $("mock-tabs");
  let cmd = $("mock-cmd"), cmdText = $("mock-cmd-text");
  async function type(el, text) {
    for (let k = 1; k <= text.length; k++) {
      el.textContent = text.slice(0, k);
      await sleep(70 + Math.random() * 40);
    }
  }
  for (;;) {
    await sleep(2500);
    cmd.hidden = false;
    cmdText.textContent = ":";
    await sleep(400);
    await type(cmdText, ":open -t wikipedia.org");
    await sleep(600);
    cmd.hidden = true;
    let tab = document.createElement("span");
    tab.className = "tab sel";
    tab.textContent = "Wikipedia";
    tabs.firstElementChild.classList.remove("sel");
    tabs.append(tab);
    home.hidden = true;
    site.hidden = false;
    await sleep(4000);
    tab.remove();
    tabs.firstElementChild.classList.add("sel");
    site.hidden = true;
    home.hidden = false;
  }
})();

/* ---------- this page's own command bar ---------- */
const COMMANDS = {
  help: () => "download   get the installer\nportable   get the zip\nmods       open the mods site\nsource     open the code on GitHub\nquit       close this bar",
  download: () => { location.href = $("dl-installer").href; return "downloading the installer…"; },
  portable: () => { location.href = $("dl-portable").href; return "downloading the portable zip…"; },
  mods: () => { location.href = "https://tacobellerontop-sudo.github.io/breached-mods/"; return "opening mods…"; },
  source: () => { location.href = `https://github.com/${REPO}`; return "opening GitHub…"; },
  quit: () => { closeBar(); return ""; },
};
COMMANDS.q = COMMANDS.close = COMMANDS.quit;

const bar = $("cmdbar"), input = $("cmd-input"), out = $("cmd-out");
function openBar() {
  bar.hidden = false;
  out.textContent = "";
  input.value = "";
  input.focus();
}
function closeBar() {
  bar.hidden = true;
  input.blur();
}
input.addEventListener("keydown", e => {
  if (e.key == "Escape") closeBar();
  else if (e.key == "Enter") {
    let line = input.value.trim().replace(/^:/, "");
    if (!line) return closeBar();
    let fn = COMMANDS[line.split(/\s+/)[0].toLowerCase()];
    let result = fn ? fn() : `${line}: no such command (try help)`;
    input.value = "";
    if (bar.hidden) return;
    if (result) out.textContent = result;
    else closeBar();
  } else if (e.key == "Tab") {
    e.preventDefault();
    let match = Object.keys(COMMANDS).filter(c => c.startsWith(input.value) && c.length > 2);
    if (match.length == 1) input.value = match[0];
    else out.textContent = match.join("  ");
  }
});
addEventListener("keydown", e => {
  if (e.target != document.body && e.target != document.documentElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key == ":") {
    e.preventDefault();
    openBar();
  }
});
document.querySelector("footer kbd").addEventListener("click", openBar);
