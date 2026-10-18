// Breached's website. Everything here is decoration on top of a page that
// works without it: links point at the latest release page until the
// GitHub API answers with the real installer and zip.
"use strict";

const REPO = "tacobellerontop-sudo/breached";
const MODS_URL = "https://tacobellerontop-sudo.github.io/breached-mods/mods.json";
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Breached's own colour sets (shell/modules/Theme.sys.mjs), in its order:
// bars, text, tab, every other tab, current tab, current tab text,
// highlights, loading mark, loaded mark, errors.
const PRESETS = {
  pastel: ["#cfd3da", "#2f3136", "#bcc1c9", "#c6cad1", "#f5b183", "#2f3136", "#ee9f66", "#9db8d9", "#ee9f66", "#e07b7b"],
  qutebrowser: ["#000000", "#ffffff", "#808080", "#a9a9a9", "#000000", "#ffffff", "#00aa00", "#0000aa", "#00aa00", "#ff0000"],
  graphite: ["#1e1e1e", "#d4d4d4", "#2d2d2d", "#333333", "#0e639c", "#ffffff", "#3794ff", "#c5a332", "#3794ff", "#f14c4c"],
  nord: ["#2e3440", "#eceff4", "#3b4252", "#434c5e", "#88c0d0", "#2e3440", "#88c0d0", "#ebcb8b", "#a3be8c", "#bf616a"],
  gruvbox: ["#282828", "#ebdbb2", "#3c3836", "#504945", "#d79921", "#282828", "#fabd2f", "#83a598", "#b8bb26", "#fb4934"],
  solarized: ["#002b36", "#eee8d5", "#073642", "#0b3f4c", "#268bd2", "#fdf6e3", "#2aa198", "#b58900", "#859900", "#dc322f"],
  light: ["#f3f3f3", "#1f1f1f", "#e1e1e1", "#d6d6d6", "#ffffff", "#000000", "#0067c0", "#0067c0", "#107c10", "#c42b1c"],
};
const COLOR_VARS = ["--bar", "--text", "--tab", "--tab-alt", "--tab-sel", "--tab-sel-fg", "--hl", "--loading", "--loaded", "--error"];
const COLOR_LABELS = ["Bars", "Text", "Tabs", "Every other tab", "Current tab", "Current tab text", "Highlights", "Loading mark", "Loaded mark", "Errors"];

/* ---------- background: drifting points, and now and then a green crack ---------- */
(function background() {
  let canvas = $("bg");
  let ctx = canvas.getContext("2d");
  let w, h, dpr, points = [], cracks = [];
  let mouse = { x: -9999, y: -9999 };

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    let n = Math.round(Math.min(90, (innerWidth * innerHeight) / 18000));
    points = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.25 * dpr,
      vy: (Math.random() - 0.5) * 0.25 * dpr,
    }));
  }

  function crack() {
    // A jagged line from one edge, leaning like the slash in the icon.
    let y = Math.random() * h;
    let x = 0, segs = [[x, y]];
    while (x < w) {
      x += (40 + Math.random() * 90) * dpr;
      y -= (12 + (Math.random() - 0.3) * 40) * dpr;
      segs.push([x, y]);
    }
    cracks.push({ segs, life: 1 });
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    let link = 140 * dpr;
    for (let p of points) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      let dx = p.x - mouse.x, dy = p.y - mouse.y;
      let d = Math.hypot(dx, dy);
      if (d < 120 * dpr) {
        p.x += (dx / d) * 0.8 * dpr;
        p.y += (dy / d) * 0.8 * dpr;
      }
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        let a = points[i], b = points[j];
        let d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) {
          ctx.strokeStyle = `rgba(160,170,180,${(1 - d / link) * 0.16})`;
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(200,205,215,0.35)";
      ctx.fillRect(points[i].x, points[i].y, 1.5 * dpr, 1.5 * dpr);
    }
    for (let c of cracks) {
      let shown = Math.min(1, (1 - c.life) * 4);
      let upto = Math.max(1, Math.floor(c.segs.length * shown));
      ctx.strokeStyle = `rgba(24,212,92,${c.life * 0.55})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.shadowColor = "#18d45c";
      ctx.shadowBlur = 12 * dpr;
      ctx.beginPath();
      ctx.moveTo(...c.segs[0]);
      for (let k = 1; k < upto; k++) ctx.lineTo(...c.segs[k]);
      ctx.stroke();
      ctx.shadowBlur = 0;
      c.life -= 0.006;
    }
    cracks = cracks.filter(c => c.life > 0);
    if (!calm && Math.random() < 0.004 && cracks.length < 2) crack();
    if (!calm) requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  addEventListener("pointermove", e => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; });
  resize();
  crack();
  frame();
})();

/* ---------- hero words ---------- */
(async function swapWords() {
  let el = $("swap");
  let words = ["gets out of your way", "lets idle tabs sleep", "never phones home", "lives on the keyboard", "runs uBlock Origin", "stays light"];
  if (calm) return;
  let i = 0;
  for (;;) {
    await sleep(2600);
    let word = el.textContent;
    while (word.length) {
      word = word.slice(0, -1);
      el.textContent = word;
      await sleep(22);
    }
    let next = words[++i % words.length];
    for (let k = 1; k <= next.length; k++) {
      el.textContent = next.slice(0, k);
      await sleep(45);
    }
  }
})();

setInterval(() => {
  if (calm) return;
  for (let g of document.querySelectorAll(".glitch")) {
    g.classList.remove("jitter");
    void g.offsetWidth;
    g.classList.add("jitter");
  }
}, 5200);

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
    $("hero-version").textContent = `v${version} for Windows`;
    if (setup) {
      for (let id of ["dl-main", "dl-installer"]) $(id).href = setup.browser_download_url;
      $("dl-meta").textContent = `v${version} · installer · ${mb(setup)}`;
      $("dl-installer-meta").textContent = `${setup.name} · ${mb(setup)}`;
    }
    if (zip) {
      $("dl-portable").href = zip.browser_download_url;
      $("dl-portable-meta").textContent = `${zip.name} · ${mb(zip)}`;
    }
    let notes = $("release-notes-link");
    notes.innerHTML = "";
    let a = document.createElement("a");
    a.href = rel.html_url;
    a.textContent = `What's new in ${version}`;
    let all = document.createElement("a");
    all.href = `https://github.com/${REPO}/releases`;
    all.textContent = "all releases";
    notes.append(a, " · ", all);
  } catch (e) {
    // Offline or rate limited: the release page links still work.
  }
})();

/* ---------- mods ---------- */
const FALLBACK_MODS = [
  { name: "Vim keys and link hints", description: "qutebrowser-style keys on web pages: f for link hints, j/k to scroll, J/K to switch tabs." },
  { name: "Protected video (DRM)", description: "Plays Netflix, Disney+, Spotify and other protected video and music through Widevine." },
  { name: "Bitwarden", description: "Fill logins and use passkeys from your Bitwarden vault with :bw.exe." },
  { name: "Password manager", description: "Saves the passwords you type into sites and fills them in next time." },
  { name: "Bookmarks", description: "Ctrl+D saves the page you're on; Ctrl+B lists them to open." },
  { name: "Dark pages", description: "Makes web pages dark, keeping photos and videos in their own colours." },
  { name: "Screenshots", description: "Saves a picture of the page, or the whole page top to bottom." },
  { name: "Speed", description: "Trades memory for speed: tabs stay loaded, more processes, prefetching." },
  { name: "Firefox Sync", description: "Sync history, bookmarks and passwords with Firefox on your other devices." },
];

(async function mods() {
  let list = FALLBACK_MODS;
  try {
    let res = await fetch(MODS_URL);
    if (res.ok) {
      let data = await res.json();
      if (data.mods?.length) list = data.mods;
    }
  } catch (e) {}
  let box = $("mod-list");
  for (let m of list) {
    let el = document.createElement("article");
    el.className = "mod reveal";
    let h = document.createElement("h3");
    h.textContent = m.name;
    if (m.version) {
      let s = document.createElement("small");
      s.textContent = m.version;
      h.append(s);
    }
    let p = document.createElement("p");
    p.textContent = m.description;
    el.append(h, p);
    box.append(el);
    reveal(el);
  }
  let count = $("mod-count");
  count.dataset.count = list.length;
  if (count.dataset.done) count.textContent = list.length;
})();

/* ---------- marquee ---------- */
(function marquee() {
  let cmds = ["open", "tabopen", "close", "undo", "reader", "pin", "private", "permissions", "zoom 110", "print", "save", "yank", "update", "welcome", "bookmarks", "dark", "screenshot", "ext ublock", "back", "forward"];
  let track = $("marquee");
  for (let round = 0; round < 2; round++) {
    for (let c of cmds) {
      let s = document.createElement("span");
      s.textContent = c;
      track.append(s);
    }
  }
})();

for (let band of document.querySelectorAll(".band-track")) {
  for (let i = 0; i < 8; i++) {
    let s = document.createElement("span");
    s.textContent = "breached";
    band.append(s);
  }
}

/* ---------- scroll reveal and counters ---------- */
const seen = new IntersectionObserver(entries => {
  for (let e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    seen.unobserve(e.target);
    for (let b of e.target.querySelectorAll("[data-count]")) countUp(b);
  }
}, { threshold: 0.15 });
function reveal(el) { seen.observe(el); }
document.querySelectorAll(".reveal").forEach(reveal);

function countUp(el) {
  let start = performance.now();
  function step(t) {
    let target = Number(el.dataset.count);
    let k = calm ? 1 : Math.min(1, (t - start) / 1200);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
    else el.dataset.done = "1";
  }
  requestAnimationFrame(step);
}

/* ---------- pointer effects ---------- */
for (let card of document.querySelectorAll(".card")) {
  card.addEventListener("pointermove", e => {
    let r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
}
if (!calm && matchMedia("(pointer: fine)").matches) {
  for (let b of document.querySelectorAll(".magnetic")) {
    b.addEventListener("pointermove", e => {
      let r = b.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) * 0.18;
      let y = (e.clientY - r.top - r.height / 2) * 0.3;
      b.style.transform = `translate(${x}px, ${y}px)`;
    });
    b.addEventListener("pointerleave", () => { b.style.transform = ""; });
  }
  let mock = $("mock");
  $("stage").addEventListener("pointermove", e => {
    let r = mock.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width - 0.5;
    let y = (e.clientY - r.top) / r.height - 0.5;
    mock.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
  });
  $("stage").addEventListener("pointerleave", () => { mock.style.transform = ""; });
}

/* ---------- colours ---------- */
function applyColors(colors) {
  let mock = $("mock");
  colors.forEach((c, i) => mock.style.setProperty(COLOR_VARS[i], c));
  mock.style.setProperty("--page", colors[0]);
  showSwatches(colors);
}

function setPreset(name) {
  if (!PRESETS[name]) return false;
  applyColors(PRESETS[name]);
  $("mock").dataset.preset = name;
  for (let b of document.querySelectorAll(".preset")) b.setAttribute("aria-pressed", b.dataset.name == name);
  return true;
}

(function presets() {
  let box = $("presets");
  for (let [name, c] of Object.entries(PRESETS)) {
    let b = document.createElement("button");
    b.className = "preset";
    b.dataset.name = name;
    b.setAttribute("aria-pressed", name == "pastel");
    let dot = document.createElement("i");
    dot.style.setProperty("--a", c[0]);
    dot.style.setProperty("--b", c[6]);
    b.append(dot, name);
    b.addEventListener("click", () => setPreset(name));
    box.append(b);
  }
})();

function showSwatches(colors) {
  let bar = $("swatchbar");
  if (!bar.children.length) {
    for (let i of [0, 1, 4, 6, 7, 9]) {
      let row = document.createElement("div");
      row.className = "swatch-row";
      row.dataset.i = i;
      row.innerHTML = "<i></i><span></span><span></span>";
      row.children[1].textContent = COLOR_LABELS[i];
      bar.append(row);
    }
  }
  for (let row of bar.children) {
    let c = colors[row.dataset.i];
    row.children[0].style.background = c;
    row.children[2].textContent = c;
  }
}

// The dial builds a set around one hue, light bars with a strong highlight,
// the same idea as the dial on Breached's welcome page.
function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  let f = n => {
    let k = (n + h / 30) % 12;
    let c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function dialColors(h) {
  return [
    hsl(h, 14, 84), hsl(h, 10, 20), hsl(h, 12, 76), hsl(h, 12, 80),
    hsl(h, 80, 76), hsl(h, 10, 20), hsl(h, 72, 64), hsl((h + 180) % 360, 45, 72),
    hsl(h, 72, 64), hsl(0, 62, 68),
  ];
}

(function dial() {
  let dialEl = $("dial");
  let knob = $("dial-knob");
  let hue = 25;
  function set(h, apply = true) {
    hue = (h + 360) % 360;
    let r = dialEl.clientWidth / 2 - 22;
    let a = (hue - 90) * Math.PI / 180;
    knob.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`;
    knob.style.background = hsl(hue, 72, 64);
    dialEl.style.setProperty("--dial-glow", hsl(hue, 72, 64) + "88");
    dialEl.setAttribute("aria-valuenow", Math.round(hue));
    if (apply) {
      applyColors(dialColors(hue));
      for (let b of document.querySelectorAll(".preset")) b.setAttribute("aria-pressed", "false");
    }
  }
  function fromPointer(e) {
    let r = dialEl.getBoundingClientRect();
    let x = e.clientX - r.left - r.width / 2;
    let y = e.clientY - r.top - r.height / 2;
    set(Math.atan2(y, x) * 180 / Math.PI + 90);
  }
  dialEl.addEventListener("pointerdown", e => {
    dialEl.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  dialEl.addEventListener("pointermove", e => { if (dialEl.hasPointerCapture(e.pointerId)) fromPointer(e); });
  dialEl.addEventListener("keydown", e => {
    if (e.key == "ArrowRight" || e.key == "ArrowUp") { set(hue + 10); e.preventDefault(); }
    if (e.key == "ArrowLeft" || e.key == "ArrowDown") { set(hue - 10); e.preventDefault(); }
  });
  addEventListener("resize", () => set(hue, false));
  set(hue, false);
  showSwatches(PRESETS.pastel);
})();

/* ---------- the animated browser ---------- */
(async function demo() {
  if (calm) return;
  let home = $("mock-home"), site = $("mock-site"), reader = $("mock-reader");
  let tabs = $("mock-tabs"), cmd = $("mock-cmd"), cmdText = $("mock-cmd-text"), help = $("mock-cmd-help");
  let title = $("mock-title"), keycap = $("keycap"), search = $("mock-search-text");

  function key(label) {
    keycap.hidden = true;
    void keycap.offsetWidth;
    keycap.textContent = label;
    keycap.hidden = false;
    pressKey(label);
  }
  async function type(el, text, speed = 70) {
    for (let k = 1; k <= text.length; k++) {
      el.textContent = text.slice(0, k);
      await sleep(speed + Math.random() * 40);
    }
  }
  function show(page) {
    for (let p of [home, site, reader]) p.hidden = p != page;
  }
  function select(i) {
    [...tabs.querySelectorAll(".tab")].forEach((t, k) => t.classList.toggle("sel", k == i));
  }
  async function command(text, hint) {
    key(":");
    cmd.hidden = false;
    help.textContent = hint;
    cmdText.textContent = ":";
    await sleep(400);
    await type(cmdText, ":" + text);
    await sleep(500);
    key("↵");
    cmd.hidden = true;
  }
  function addTab(label) {
    let t = document.createElement("span");
    t.className = "tab load";
    t.textContent = label;
    tabs.append(t);
    return t;
  }

  for (;;) {
    show(home);
    tabs.querySelectorAll(".tab:not([data-i])").forEach(t => t.remove());
    select(0);
    title.textContent = "Home – Breached";
    search.textContent = "search or type an address";
    search.parentNode.classList.remove("typing");
    await sleep(1800);

    await command("open -t wikipedia.org", "open [-t|-b] <address or search>");
    let t = addTab("Wikipedia");
    select(1);
    show(site);
    site.classList.add("loading");
    title.textContent = "Wikipedia – Breached";
    await sleep(1300);
    site.classList.remove("loading");
    t.classList.remove("load");
    await sleep(1600);

    await command("reader", "show the article on its own");
    show(reader);
    await sleep(2400);

    key("Ctrl+T");
    let t2 = addTab("Home");
    t2.classList.remove("load");
    select(2);
    show(home);
    title.textContent = "Home – Breached";
    await sleep(700);
    search.parentNode.classList.add("typing");
    await type(search, "lightweight browser", 80);
    await sleep(900);

    key("Ctrl+W");
    t2.remove();
    select(1);
    show(reader);
    title.textContent = "Wikipedia – Breached";
    await sleep(1600);

    // Cycle the colour set, unless the visitor picked one.
    let mock = $("mock");
    if (mock.dataset.preset && !mock.dataset.touched) {
      let names = Object.keys(PRESETS);
      let next = names[(names.indexOf(mock.dataset.preset) + 1) % names.length];
      setPreset(next);
    }
    await sleep(1200);
  }
})();
$("presets").addEventListener("click", () => { $("mock").dataset.touched = "1"; });
$("dial").addEventListener("pointerdown", () => { $("mock").dataset.touched = "1"; });

/* ---------- keyboard ---------- */
const MAPPED = { ":": "cmd", "f": "hint", "j": "down", "k": "up", "h": "left", "l": "right", "J": "tab", "K": "tab", "d": "close", "u": "undo", "r": "load", "o": "open", "g": "top", "G": "end", "H": "back", "L": "fwd" };
(function keyboard() {
  let rows = ["qwertyuiop", "asdfghjkl;", "zxcvbnm,./"];
  let kb = $("keyboard");
  for (let row of rows) {
    let r = document.createElement("div");
    r.className = "kb-row";
    for (let ch of row) {
      let k = document.createElement("div");
      k.className = "key";
      k.dataset.k = ch == ";" ? ":" : ch;
      k.textContent = ch == ";" ? ":" : ch;
      let tip = MAPPED[k.dataset.k];
      if (tip) {
        k.classList.add("mapped");
        let s = document.createElement("small");
        s.textContent = tip;
        k.append(s);
      }
      r.append(k);
    }
    kb.append(r);
  }
  let space = document.createElement("div");
  space.className = "kb-row";
  space.innerHTML = '<div class="key" data-k="Ctrl" style="flex:1.6;aspect-ratio:auto">ctrl</div><div class="key" data-k=" " style="flex:6;aspect-ratio:auto"></div><div class="key" data-k="↵" style="flex:1.6;aspect-ratio:auto">enter</div>';
  kb.append(space);
})();

function pressKey(label) {
  let names = label.startsWith("Ctrl+") ? ["Ctrl", label.slice(5).toLowerCase()] : [label.length == 1 ? label.toLowerCase() : label];
  if (label == ":") names = [":"];
  for (let n of names) {
    let k = document.querySelector(`.key[data-k="${CSS.escape(n)}"]`);
    if (!k) continue;
    k.classList.add("down");
    setTimeout(() => k.classList.remove("down"), 220);
  }
}

/* ---------- this page's own command bar ---------- */
const COMMANDS = {
  help: () => "download   get the installer\nportable   get the zip\nmods       open the mods site\nsource     open the code on GitHub\ncolour <name|random>   recolour the browser above (" + Object.keys(PRESETS).join(", ") + ")\ntop        back to the top\nquit       close this bar",
  download: () => { location.href = $("dl-installer").href; return "downloading the installer…"; },
  portable: () => { location.href = $("dl-portable").href; return "downloading the portable zip…"; },
  mods: () => { location.href = "https://tacobellerontop-sudo.github.io/breached-mods/"; return "opening mods…"; },
  source: () => { location.href = `https://github.com/${REPO}`; return "opening GitHub…"; },
  open: arg => {
    if (!arg) return "open <address>";
    let url = /^https?:\/\//.test(arg) ? arg : /\.\w{2,}/.test(arg) && !/\s/.test(arg) ? "https://" + arg : "https://duckduckgo.com/?q=" + encodeURIComponent(arg);
    window.open(url, "_blank", "noopener");
    return "opened " + url;
  },
  colour: arg => {
    $("mock").dataset.touched = "1";
    if (arg == "random") arg = Object.keys(PRESETS)[Math.floor(Math.random() * 7)];
    if (setPreset(arg)) {
      $("top").scrollIntoView();
      return "colours: " + arg;
    }
    return "colour sets: " + Object.keys(PRESETS).join(", ");
  },
  top: () => { scrollTo(0, 0); return ""; },
  quit: () => { closeBar(); return ""; },
};
COMMANDS.color = COMMANDS.colour;
COMMANDS.q = COMMANDS.close = COMMANDS.quit;
COMMANDS.o = COMMANDS.open;

const bar = $("cmdbar"), input = $("cmd-input"), out = $("cmd-out");
let history = [], hpos = 0;
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
    history.push(line);
    hpos = history.length;
    let [name, ...rest] = line.split(/\s+/);
    let fn = COMMANDS[name.toLowerCase()];
    let result = fn ? fn(rest.join(" ")) : `${name}: no such command (try help)`;
    input.value = "";
    if (bar.hidden) return;
    if (result) out.textContent = result;
    else closeBar();
  } else if (e.key == "Tab") {
    e.preventDefault();
    let match = Object.keys(COMMANDS).filter(c => c.startsWith(input.value) && c.length > 2);
    if (match.length == 1) input.value = match[0] + " ";
    else out.textContent = match.join("  ");
  } else if (e.key == "ArrowUp" && hpos > 0) {
    input.value = history[--hpos];
    e.preventDefault();
  } else if (e.key == "ArrowDown") {
    hpos = Math.min(history.length, hpos + 1);
    input.value = history[hpos] || "";
    e.preventDefault();
  }
});

addEventListener("keydown", e => {
  if (e.target != document.body && e.target != document.documentElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  pressKey(e.key);
  if (e.key == ":") {
    e.preventDefault();
    openBar();
  } else if (e.key == "j") scrollBy({ top: 120 });
  else if (e.key == "k") scrollBy({ top: -120 });
  else if (e.key == "G") scrollTo({ top: document.body.scrollHeight });
  else if (e.key == "g") scrollTo({ top: 0 });
});

// Phones have no ":" key handy, so the hint opens the bar too.
document.querySelector(".hint kbd").addEventListener("click", openBar);
