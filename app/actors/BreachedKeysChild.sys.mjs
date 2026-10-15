/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached: catches ":" typed on a web page (outside text fields) and asks
// the browser window to open the command line, like qutebrowser.

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "email", "password", "tel", "number",
  "date", "datetime-local", "month", "time", "week",
]);

export class BreachedKeysChild extends JSWindowActorChild {
  handleEvent(event) {
    if (
      event.type != "keydown" ||
      !event.isTrusted ||
      event.defaultPrevented ||
      event.key != ":" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }
    if (this.#isEditable(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sendAsyncMessage("Breached:OpenCommandLine");
  }

  #isEditable(event) {
    if (this.document?.designMode == "on") {
      return true;
    }
    let target = event.composedPath()[0];
    if (!target || target.nodeType != target.ELEMENT_NODE) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    let tag = target.localName;
    if (tag == "textarea" || tag == "select") {
      return true;
    }
    return tag == "input" && TEXT_INPUT_TYPES.has(target.type);
  }
}
