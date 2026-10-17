/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Hands a page's passkey requests to the Bitwarden mod in its window
// (Passkeys in mod.js). No answer means "let Gecko handle it".

export class BitwardenPasskeysParent extends JSWindowActorParent {
  receiveMessage(message) {
    let browser = this.browsingContext.top.embedderElement;
    let win = browser?.ownerGlobal;
    let passkeys = win?.ModHost?.loaded?.get("bitwarden")?.passkeys;
    if (!passkeys) {
      return null;
    }
    this._passkeys = passkeys;
    let topPrincipal = this.browsingContext.top.currentWindowGlobal?.documentPrincipal;
    let request = {
      ...message.data,
      topOrigin: topPrincipal?.originNoSuffix ?? message.data.origin,
    };
    request.crossOrigin = request.framed && request.topOrigin != request.origin;
    switch (message.name) {
      case "Passkey:get":
        return passkeys.get(this, browser, request);
      case "Passkey:create":
        return passkeys.create(this, browser, request);
      case "Passkey:Abort":
        passkeys.abort(this, request.id);
        return null;
    }
    return null;
  }

  didDestroy() {
    // The page went away: drop its waiting request, if any.
    this._passkeys?.forget(this);
  }
}
