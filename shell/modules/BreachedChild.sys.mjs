/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Breached content helper, one per frame:
// - ":" typed on a page (outside text fields) opens the command bar.
// - Esc in a text field leaves it (like leaving insert mode in qutebrowser),
//   so ":" works next without reaching for the mouse.
// - Ctrl+click or middle-click on a link opens it in a new background tab.
// - Pressing the mouse on a link starts connecting to its site, so the page
//   loads sooner once the click lands.
// - Right-click: what was clicked (link, image, selection, text field) goes
//   to the window, which shows the menu (contextmenu.js) and sends back
//   editing commands (copy, paste...) to run here.

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "email", "password", "tel", "number",
  "date", "datetime-local", "month", "time", "week",
]);

export class BreachedChild extends JSWindowActorChild {
  receiveMessage(message) {
    // Lets the window check this helper is running in a page.
    switch (message.name) {
      case "Breached:Ping":
        return "pong";
      case "Breached:Print":
        // Ctrl+P: the same as the page's own print button would do.
        this.contentWindow?.print();
        break;
      case "Breached:DoCommand":
        // cmd_copy, cmd_paste, cmd_selectAll... on the focused field or page.
        if (this.docShell.isCommandEnabled(message.data.command)) {
          this.docShell.doCommand(message.data.command);
        }
        break;
    }
    return undefined;
  }

  handleEvent(event) {
    if (event.type == "contextmenu") {
      this.#onContextMenu(event);
      return;
    }
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
    } else if (event.type == "mousedown") {
      this.#onMouseDown(event);
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

  #onContextMenu(event) {
    // A page with its own menu (a web app's) keeps it; Shift+right-click
    // shows Breached's anyway.
    if (!event.isTrusted || (event.defaultPrevented && !event.shiftKey)) {
      return;
    }
    let win = this.contentWindow;
    let path = event.composedPath();
    let target = path[0];
    if (!win || !target || target.nodeType != target.ELEMENT_NODE) {
      return;
    }
    let data = {
      pageURL: win.location.href, // the window puts the top page's here for frames
      frameURL: this.browsingContext.parent ? win.location.href : null,
      frameId: this.browsingContext.parent ? this.browsingContext.id : 0,
      principal: this.document.nodePrincipal,
      // Screen pixels (the window divides by its own scale).
      x: event.screenX * win.devicePixelRatio,
      y: event.screenY * win.devicePixelRatio,
      title: this.document.title,
    };
    let link = path.find(n => n.nodeType == 1 && (n.localName == "a" || n.localName == "area") && n.href);
    if (link && !/^javascript:/i.test(link.href)) {
      data.link = link.href;
      data.linkText = (link.textContent ?? "").trim().slice(0, 200);
    }
    let media = path.find(n => n.nodeType == 1 && ["img", "video", "audio"].includes(n.localName));
    if (media) {
      let src = media.currentSrc || media.src;
      if (src) {
        data.mediaType = media.localName == "img" ? "image" : media.localName;
        data.mediaURL = src;
      }
    }
    let editable = this.#isEditable(event);
    if (editable) {
      data.editable = true;
      data.password = target.localName == "input" && target.type == "password";
    }
    let selection = "";
    if (editable && typeof target.selectionStart == "number" && !data.password) {
      selection = target.value.substring(target.selectionStart, target.selectionEnd);
    } else if (!editable) {
      selection = win.getSelection()?.toString() ?? "";
    }
    data.selection = selection.trim().slice(0, 1000) || null;
    for (let command of ["cmd_undo", "cmd_cut", "cmd_copy", "cmd_paste", "cmd_delete"]) {
      data[command] = this.docShell.isCommandEnabled(command);
    }
    this.sendAsyncMessage("Breached:ContextMenu", data);
  }

  #onMouseDown(event) {
    if (event.button > 1) {
      return;
    }
    let link = event.composedPath().find(
      n => n.nodeType == 1 && (n.localName == "a" || n.localName == "area") && n.href
    );
    // Only other sites: this one's connection is already open.
    if (link && /^https?:/i.test(link.href) && link.origin != this.contentWindow?.location.origin) {
      this.sendAsyncMessage("Breached:Preconnect", { url: link.href });
    }
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
