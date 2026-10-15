/* Bitwarden mod: fills logins from your vault through the Bitwarden CLI.
 *
 *   :bw.exe          fill the login for this page (asks for your master
 *                    password the first time; picks if there are several)
 *   :bw.exe <n>      fill login number n of the last list
 *   :bw.exe totp     copy this page's two-step code
 *   :bw.exe sync     fetch the latest vault
 *   :bw.exe lock     forget the unlock key
 *   :bw.exe login    log in to Bitwarden
 *   :bw.exe status
 *
 * The unlock key is kept in memory only, and the master password is passed
 * to bw.exe in an environment variable, never on its command line. */

"use strict";

const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");

const Bitwarden = {
  session: null,
  matches: [], // logins for the last page, for ":bw.exe <n>"
  matchesURL: null,
  _lockTimer: null,

  async exe() {
    let path = Mod.pref("breached.mods.bitwarden.path", "").trim();
    if (path) {
      if (!(await IOUtils.exists(path))) {
        throw new Error(`bw.exe isn't at ${path} (see settings > mods)`);
      }
      return path;
    }
    try {
      return await Subprocess.pathSearch("bw.exe");
    } catch (e) {
      throw new Error("bw.exe wasn't found. Install the Bitwarden CLI or set its place in settings > mods");
    }
  },

  /** Runs bw.exe; resolves to { code, stdout, stderr }. */
  async bw(args, env = {}) {
    let environment = { BW_NOINTERACTION: "true", ...env };
    if (this.session && !("BW_SESSION" in env)) {
      environment.BW_SESSION = this.session;
    }
    let proc = await Subprocess.call({
      command: await this.exe(),
      arguments: args,
      environment,
      environmentAppend: true,
      stderr: "pipe",
    });
    proc.stdin.close();
    let readAll = async pipe => {
      let out = "";
      for (let chunk; (chunk = await pipe.readString()); ) {
        out += chunk;
      }
      return out;
    };
    let [stdout, stderr, { exitCode }] = await Promise.all([
      readAll(proc.stdout),
      readAll(proc.stderr),
      proc.wait(),
    ]);
    return { code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  },

  async json(args) {
    let r = await this.bw(args);
    if (r.code != 0) {
      throw new Error(r.stderr || r.stdout || `bw.exe ${args[0]} failed`);
    }
    return JSON.parse(r.stdout);
  },

  async status() {
    return (await this.json(["status"])).status; // unauthenticated, locked, unlocked
  },

  touch() {
    clearTimeout(this._lockTimer);
    let minutes = parseInt(Mod.pref("breached.mods.bitwarden.lockMinutes", "0"), 10);
    if (minutes > 0) {
      this._lockTimer = setTimeout(() => this.lock(), minutes * 60 * 1000);
    }
  },

  lock() {
    clearTimeout(this._lockTimer);
    this.session = null;
    this.matches = [];
  },

  /** Makes sure the vault is unlocked, asking for the master password. */
  async unlock() {
    let status = await this.status();
    if (status == "unauthenticated") {
      throw new Error("not logged in: run :bw.exe login (or bw login in a terminal)");
    }
    if (status == "unlocked" && this.session) {
      return;
    }
    let password = await Breached.prompt("bitwarden master password:", { password: true });
    if (!password) {
      throw new Error("cancelled");
    }
    Breached.showMessage("Unlocking…");
    let r = await this.bw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
      BW_PASSWORD: password,
      BW_SESSION: null,
    });
    password = null;
    if (r.code != 0 || !r.stdout) {
      throw new Error(r.stderr || "couldn't unlock");
    }
    this.session = r.stdout;
  },

  async login() {
    let email = await Breached.prompt("bitwarden email:");
    if (!email) {
      return;
    }
    let password = await Breached.prompt("bitwarden master password:", { password: true });
    if (!password) {
      return;
    }
    let args = ["login", email.trim(), "--passwordenv", "BW_PASSWORD", "--raw"];
    let r = await this.bw(args, { BW_PASSWORD: password, BW_SESSION: "" });
    if (r.code != 0 && /two-step|two step|2fa|code/i.test(r.stderr + r.stdout)) {
      let code = await Breached.prompt("two-step code from your authenticator app:");
      if (!code) {
        return;
      }
      r = await this.bw([...args, "--method", "0", "--code", code.trim()], {
        BW_PASSWORD: password,
        BW_SESSION: null,
      });
    }
    password = null;
    if (r.code != 0 || !r.stdout) {
      throw new Error(r.stderr || "couldn't log in");
    }
    this.session = r.stdout;
    this.touch();
    Breached.showMessage("Logged in to Bitwarden");
  },

  currentURL() {
    let url = Breached.selectedBrowser?.currentURI?.spec;
    if (!url || !/^https?:/.test(url)) {
      throw new Error("open a website first");
    }
    return url;
  },

  async logins(url) {
    let items = await this.json(["list", "items", "--url", url]);
    return items.filter(i => i.type == 1 && i.login);
  },

  /** Fills a login into the page's frames from the same site. */
  async fill(item) {
    let browser = Breached.selectedBrowser;
    let top = browser.browsingContext;
    let site = siteOf(top.currentWindowGlobal?.documentPrincipal);
    let filled = false;
    for (let bc of top.getAllBrowsingContextsInSubtree()) {
      let wg = bc.currentWindowGlobal;
      if (!wg || !site || siteOf(wg.documentPrincipal) != site) {
        continue;
      }
      try {
        let r = await wg.getActor(ACTOR).sendQuery("Bitwarden:Fill", {
          username: item.login.username ?? "",
          password: item.login.password ?? "",
        });
        filled ||= r;
      } catch (e) {
        // frame went away
      }
    }
    let who = item.login.username || item.name;
    Breached.showMessage(filled ? `Filled ${who}` : `No login form found for ${who}`, filled ? "info" : "error");
  },

  async run(args) {
    let [sub, ...rest] = args.trim().split(/\s+/);
    switch (sub) {
      case "lock":
        this.lock();
        await this.bw(["lock"]);
        Breached.showMessage("Bitwarden locked");
        return;
      case "login":
        await this.login();
        return;
      case "status": {
        let status = await this.status();
        Breached.showMessage(`Bitwarden: ${status == "unlocked" && !this.session ? "locked" : status}`);
        return;
      }
      case "sync":
        await this.unlock();
        Breached.showMessage("Syncing…");
        await this.json(["sync"]).catch(() => null);
        Breached.showMessage("Bitwarden synced");
        this.touch();
        return;
      case "totp": {
        let url = this.currentURL();
        await this.unlock();
        let item = (await this.logins(url)).find(i => i.login.totp);
        if (!item) {
          throw new Error("no two-step code saved for this site");
        }
        let r = await this.bw(["get", "totp", item.id]);
        if (r.code != 0) {
          throw new Error(r.stderr || "couldn't get the code");
        }
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(r.stdout);
        Breached.showMessage("Two-step code copied");
        this.touch();
        return;
      }
    }
    let url = this.currentURL();
    if (/^\d+$/.test(sub ?? "")) {
      let item = this.matchesURL == url ? this.matches[parseInt(sub, 10) - 1] : null;
      if (!item) {
        throw new Error("no such login: run :bw.exe first");
      }
      await this.fill(item);
      return;
    }
    if (sub) {
      throw new Error(`unknown: ${sub} (try fill, lock, sync, totp, login, status)`);
    }
    await this.unlock();
    let logins = await this.logins(url);
    this.touch();
    this.matches = logins;
    this.matchesURL = url;
    if (!logins.length) {
      Breached.showMessage("No Bitwarden logins for this site", "error");
    } else if (logins.length == 1) {
      await this.fill(logins[0]);
    } else {
      Breached.showMessage(
        "Pick one with :bw.exe <n>: " +
          logins.map((l, i) => `${i + 1} ${l.login.username || l.name}`).join("  ")
      );
    }
  },
};

function siteOf(principal) {
  try {
    if (!principal || !/^https?$/.test(principal.scheme)) {
      return null;
    }
    return principal.baseDomain || principal.host;
  } catch (e) {
    return null;
  }
}

const ACTOR = Mod.actor("Bitwarden", {
  parent: "BitwardenParent.sys.mjs",
  child: "BitwardenChild.sys.mjs",
});

Mod.command("bw.exe", {
  usage: "bw.exe [n|totp|sync|lock|login|status]  (fill this page's login from Bitwarden)",
  run(args) {
    Bitwarden.run(args).catch(e => {
      if (e.message != "cancelled") {
        console.error("Bitwarden", e);
        Breached.showMessage(`bw.exe: ${e.message}`, "error");
      }
    });
  },
});
Mod.command("bw", { alias: "bw.exe" });
Mod.onUnload(() => Bitwarden.lock());
