/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only for the self-test (selftest.js registers it): makes mouse events
// inside a page, in the page's own process, like a real mouse would.

export class BreachedSelfTestChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name == "SelfTest:Reader") {
      let content = this.document.querySelector(".moz-reader-content");
      return { url: this.document.documentURI, chars: content?.textContent.length ?? 0, title: this.document.title };
    }
    if (message.name != "SelfTest:Mouse") {
      return null;
    }
    let { type, x, y, button } = message.data;
    let win = this.contentWindow;
    let buttons = type == "mousedown" ? 1 << (button == 2 ? 1 : 0) : 0;
    if (typeof win.synthesizeMouseEvent == "function") {
      win.synthesizeMouseEvent(type, x, y, { button, buttons, clickCount: 1 });
      return "synthesizeMouseEvent";
    }
    win.windowUtils.sendMouseEvent(type, x, y, button, 1, 0);
    return "sendMouseEvent";
  }
}
