/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached content helper, one per frame:
// - ":" typed on a page (outside text fields) opens the command bar.
// - Esc in a text field leaves it (like leaving insert mode in qutebrowser),
//   so ":" works next without reaching for the mouse.
// - Ctrl+click or middle-click on a link opens it in a new background tab.

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "email", "password", "tel", "number",
  "date", "datetime-local", "month", "time", "week",
]);

export class BreachedChild extends JSWindowActorChild {
  receiveMessage(message) {
    // Lets the window check this helper is running in a page.
    if (message.name == "Breached:Ping") {
      return "pong";
    }
    return undefined;
  }

  handleEvent(event) {
    if (event.type == "keydown" && event.isTrusted && event.key == "Escape") {
      this.#onEscape(event);
      return;
    }
    if (!event.isTrusted || event.defaultPrevented) {
      return;
    }
    if (event.type == "keydown") {
      this.#onKey(event);
    } else if (event.type == "click" || event.type == "auxclick") {
      this.#onClick(event);
    }
  }

  #onKey(event) {
    if (
      event.key != ":" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      this.#isEditable(event)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sendAsyncMessage("Breached:OpenCommandLine");
  }

  #onEscape(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || !this.#isEditable(event)) {
      return;
    }
    let field = event.composedPath()[0];
    // The page sees Esc first (closing its own popup, say); then the field
    // lets go, whatever the page did with the key.
    this.contentWindow?.setTimeout(() => {
      let doc = this.document;
      if (!doc) {
        return;
      }
      if (field?.matches?.(":focus")) {
        field.blur();
      } else {
        doc.activeElement?.blur?.();
      }
    }, 0);
  }

  #onClick(event) {
    let newTab = event.button == 1 || (event.button == 0 && event.ctrlKey);
    if (!newTab) {
      return;
    }
    let link = event.composedPath().find(
      n => n.nodeType == 1 && (n.localName == "a" || n.localName == "area") && n.href
    );
    if (!link || /^(javascript|data):/i.test(link.href)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sendAsyncMessage("Breached:OpenLinkInTab", {
      url: link.href,
      principal: this.document.nodePrincipal,
    });
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
