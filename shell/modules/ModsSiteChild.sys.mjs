/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// On the mods site only (breached.mods.site): marks the page as open in
// Breached, with the versions of installed mods, and turns a click on an
// Install link (<a data-breached-mod="id" href="mods/id.zip">) into an
// install. Only the user's own clicks count, not ones a script makes.

export class BreachedModsSiteChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type == "DOMContentLoaded") {
      this.mark();
      return;
    }
    if (event.type != "click" || event.button != 0 || !event.isTrusted) {
      return;
    }
    let link = event.target?.closest?.("a[data-breached-mod]");
    if (!link) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (link.hasAttribute("data-busy")) {
      return;
    }
    link.setAttribute("data-busy", "");
    this.sendQuery("ModsSite:Install", { id: link.getAttribute("data-breached-mod"), href: link.href })
      .catch(() => null)
      .finally(() => {
        link.removeAttribute("data-busy");
        this.mark();
      });
  }

  receiveMessage(message) {
    if (message.name == "ModsSite:Refresh") {
      this.mark();
    }
  }

  async mark() {
    let state = await this.sendQuery("ModsSite:State").catch(() => null);
    let doc = this.document;
    if (!state || !doc?.documentElement) {
      return;
    }
    doc.documentElement.setAttribute("data-breached", state.version);
    for (let link of doc.querySelectorAll("a[data-breached-mod]")) {
      let version = state.installed[link.getAttribute("data-breached-mod")];
      if (version) {
        link.setAttribute("data-installed", version);
      } else {
        link.removeAttribute("data-installed");
      }
    }
    doc.dispatchEvent(new this.contentWindow.Event("BreachedModsState"));
  }
}
