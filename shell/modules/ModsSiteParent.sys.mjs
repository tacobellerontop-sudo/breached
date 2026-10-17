/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Mods } from "resource://breached/Mods.sys.mjs";

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class BreachedModsSiteParent extends JSWindowActorParent {
  async receiveMessage(message) {
    let browser = this.browsingContext.top.embedderElement;
    let shell = browser?.ownerGlobal?.Breached;
    let host = shell?.mods;
    if (!host || !Mods.onSite(this.manager.documentURI?.spec ?? "")) {
      return null;
    }
    switch (message.name) {
      case "ModsSite:State":
        return { version: shell.version, installed: await host.installedVersions() };
      case "ModsSite:Install": {
        let { id, href } = message.data;
        if (!ID_RE.test(id ?? "") || !Mods.onSite(href ?? "") || !/\.zip$/.test(href)) {
          return false;
        }
        try {
          return !!(await host.installFromSite(id, { url: href, browser, confirm: true }));
        } catch (e) {
          console.error("Breached: installing a mod from the site", e);
          shell.showMessage(`Couldn't install ${id}: ${e.message}`, "error");
          return false;
        }
      }
    }
    return null;
  }
}
