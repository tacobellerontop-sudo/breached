/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Passkeys inside Breached. Gecko's own WebAuthn code answers every site's
// passkey request with a software authenticator (the one WebDriver tests
// use) instead of Windows Hello. A provider, the Bitwarden mod, loads the
// vault's passkeys into it and saves the ones sites make. Nothing runs in
// the page, so a site can't get around it.
//
// The authenticator signs with a loaded passkey on its own. When a site's
// request matches several, Gecko asks which ("select-sign-result"), and
// Breached shows them as rows. A login box offering passkeys (conditional
// mediation) waits until the provider picks one with use().

const SOFT_TOKEN = "security.webauth.webauthn_enable_softtoken";
const USB_TOKEN = "security.webauth.webauthn_enable_usbtoken";
const POLL_MS = 1500;

const service = () => Cc["@mozilla.org/webauthn/service;1"].getService(Ci.nsIWebAuthnService);

const b64url = bytes => {
  let s = "";
  for (let b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The Breached window and browser showing a top browsing context id. */
function browserFor(browsingContextId) {
  let browser = BrowsingContext.get(browsingContextId)?.top?.embedderElement ?? null;
  let window = browser?.ownerGlobal;
  return { browser, Breached: window?.Breached ?? null };
}

export const Passkeys = {
  /**
   * The provider: {
   *   name,                       e.g. "Bitwarden"
   *   request(browser, origin),   a site asked while nothing is loaded (locked)
   *   created(passkey, browser),  a site made a passkey: keep it
   *   used(passkey),              a passkey signed in (its signCount went up)
   * }
   */
  provider: null,
  authenticator: null,
  // credentialId (base64url) -> { credentialId, rpId, userHandle, signCount, name, ... }
  known: new Map(),
  loaded: false,

  get running() {
    return !!this.provider;
  },

  /** Sends every site's passkey requests to Breached's authenticator. */
  start(provider) {
    this.provider = provider;
    Services.prefs.setBoolPref(SOFT_TOKEN, true);
    Services.prefs.setBoolPref(USB_TOKEN, false);
    let svc = service();
    if (!this.authenticator || !svc.hasVirtualAuthenticator(this.authenticator)) {
      // CTAP 2.1, built in, keeps discoverable passkeys, verifies the user
      // (the vault was unlocked) and says yes.
      this.authenticator = svc.addVirtualAuthenticator("ctap2_1", "internal", true, true, true, true);
      this.known.clear();
      this.loaded = false;
    }
    if (!this._observing) {
      Services.obs.addObserver(this, "webauthn-prompt");
      this._observing = true;
    }
    clearInterval(this._timer);
    this._timer = setInterval(() => this.sweep(), POLL_MS);
  },

  /** Back to Gecko's usual WebAuthn (Windows Hello, security keys). */
  stop() {
    this.provider = null;
    clearInterval(this._timer);
    if (this._observing) {
      Services.obs.removeObserver(this, "webauthn-prompt");
      this._observing = false;
    }
    if (this.authenticator) {
      try {
        service().removeVirtualAuthenticator(this.authenticator);
      } catch (e) {
        // already gone
      }
    }
    this.authenticator = null;
    this.known.clear();
    this.loaded = false;
    Services.prefs.clearUserPref(SOFT_TOKEN);
    Services.prefs.clearUserPref(USB_TOKEN);
  },

  /** At startup: undo a provider's settings left from last time. */
  reset() {
    if (!this.provider) {
      Services.prefs.clearUserPref(SOFT_TOKEN);
      Services.prefs.clearUserPref(USB_TOKEN);
    }
  },

  /**
   * Replaces the loaded passkeys. Each: { credentialId, rpId, privateKey,
   * userHandle (all base64url), signCount, discoverable, name, ...anything
   * the provider wants back }.
   */
  load(passkeys) {
    if (!this.authenticator) {
      return;
    }
    // Keep any passkey a site just made before clearing.
    this.sweep();
    let svc = service();
    svc.removeAllCredentials(this.authenticator);
    this.known.clear();
    for (let p of passkeys) {
      try {
        svc.addCredential(
          this.authenticator,
          p.credentialId,
          p.discoverable !== false,
          p.rpId,
          p.privateKey,
          p.userHandle ?? "",
          p.signCount ?? 0
        );
        this.known.set(p.credentialId, { ...p, signCount: p.signCount ?? 0 });
      } catch (e) {
        console.error(`Breached passkeys: couldn't load a passkey for ${p.rpId}`, e);
      }
    }
    this.loaded = true;
  },

  /** Takes the passkeys out (the vault locked for good). */
  unload() {
    this.load([]);
    this.loaded = false;
  },

  /** Finds passkeys sites made and sign counts that went up. */
  sweep() {
    if (!this.authenticator || !this.provider) {
      return;
    }
    let list;
    try {
      list = service().getCredentials(this.authenticator);
    } catch (e) {
      return;
    }
    for (let c of list) {
      let known = this.known.get(c.credentialId);
      if (!known) {
        let passkey = {
          credentialId: c.credentialId,
          rpId: c.rpId,
          privateKey: c.privateKey,
          userHandle: c.userHandle,
          signCount: c.signCount,
          discoverable: c.isResidentCredential,
        };
        this.known.set(c.credentialId, passkey);
        let browser = this.lastBrowser(c.rpId);
        Promise.resolve(this.provider.created(passkey, browser)).catch(e =>
          console.error("Breached passkeys: keeping a new passkey", e)
        );
      } else if (c.signCount > known.signCount) {
        known.signCount = c.signCount;
        Promise.resolve(this.provider.used?.(known)).catch(e => console.error("Breached passkeys: sign count", e));
      }
    }
  },

  /** The selected tab of a window showing a site under rpId, else the newest window's. */
  lastBrowser(rpId) {
    let fallback = null;
    for (let win of Services.wm.getEnumerator("breached:main")) {
      let browser = win.Breached?.selectedBrowser;
      let host = browser?.currentURI?.host ?? "";
      if (host == rpId || host.endsWith("." + rpId)) {
        return browser;
      }
      fallback ??= browser;
    }
    return Services.wm.getMostRecentWindow("breached:main")?.Breached?.selectedBrowser ?? fallback;
  },

  /** The name to show for a passkey of rpId with this user handle. */
  nameFor(rpId, userHandle) {
    for (let p of this.known.values()) {
      if (p.rpId == rpId && p.userHandle == userHandle && p.name) {
        return p.name;
      }
    }
    return null;
  },

  observe(subject, topic, data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      return;
    }
    let { prompt, tid, origin, browsingContextId } = message;
    let { browser, Breached } = browserFor(browsingContextId);
    let host = "";
    try {
      host = new URL(origin).hostname;
    } catch (e) {}
    switch (prompt?.type) {
      case "presence":
        if (!this.loaded && this.provider && browser) {
          this.provider.request(browser, origin);
        }
        break;
      case "select-sign-result":
        this.select(Breached, browser, tid, host, prompt.entities ?? []);
        break;
      case "already-registered":
        Breached?.showMessage(`You already have a passkey for this account on ${host}`, "error");
        break;
    }
  },

  /** Several passkeys match: rows to pick one. */
  async select(Breached, browser, tid, host, entities) {
    let svc = service();
    if (!Breached || !browser) {
      svc.cancel(tid);
      return;
    }
    let rows = entities.map((user, index) => {
      let handle = Array.isArray(user.id) ? b64url(user.id) : String(user.id ?? "");
      let name = user.name || user.displayName || this.nameForHost(host, handle) || `passkey ${index + 1}`;
      return { label: name, detail: `${this.provider?.name ?? "Breached"} passkey`, index };
    });
    let picked = await Breached.pickForTab(browser, `${host} passkey:`, rows);
    if (picked) {
      svc.selectionCallback(tid, picked.index);
    } else {
      svc.cancel(tid);
    }
  },

  nameForHost(host, handle) {
    for (let p of this.known.values()) {
      if ((host == p.rpId || host.endsWith("." + p.rpId)) && p.userHandle == handle && p.name) {
        return p.name;
      }
    }
    return null;
  },

  /** A login box in this tab waiting for a passkey (conditional mediation): its id, or 0. */
  waiting(browser) {
    if (!this.authenticator) {
      return 0;
    }
    let origin = browser?.contentPrincipal?.originNoSuffix;
    let id = browser?.browsingContext?.id;
    if (!origin || !id) {
      return 0;
    }
    try {
      return service().hasPendingConditionalGet(id, origin);
    } catch (e) {
      return 0;
    }
  },

  /** The loaded passkeys a waiting login box can use. */
  offers(tid) {
    return new Promise(resolve => {
      service().getAutoFillEntries(tid, {
        QueryInterface: ChromeUtils.generateQI(["nsIWebAuthnAutoFillEntriesCallback"]),
        resolve: entries =>
          resolve(
            entries.map(e => {
              let credentialId = b64url(e.credentialId);
              let known = this.known.get(credentialId);
              return { credentialId, rpId: e.rpId, name: known?.name || e.userName || e.rpId, passkey: known };
            })
          ),
        reject: () => resolve([]),
      });
    });
  },

  /** Signs the waiting login box in with this passkey. */
  use(tid, credentialId) {
    let s = atob(credentialId.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (credentialId.length % 4)) % 4));
    service().selectAutoFillEntry(tid, Array.from(s, c => c.charCodeAt(0)));
  },
};
