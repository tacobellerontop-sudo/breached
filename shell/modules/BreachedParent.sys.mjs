/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export class BreachedParent extends JSWindowActorParent {
  receiveMessage(message) {
    let shell = this.browsingContext.topChromeWindow?.Breached;
    if (!shell) {
      return;
    }
    switch (message.name) {
      case "Breached:OpenCommandLine":
        shell.openCommandLine();
        break;
      case "Breached:Preconnect":
        shell.preconnect(message.data.url);
        break;
      case "Breached:ContextMenu":
        shell.contextMenu?.show(this, message.data);
        break;
      case "Breached:OpenLinkInTab":
        shell.openTab(message.data.url, {
          background: true,
          triggeringPrincipal: message.data.principal,
          afterCurrent: true,
        });
        break;
    }
  }
}
